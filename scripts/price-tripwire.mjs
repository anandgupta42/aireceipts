#!/usr/bin/env node
// Advisory check against the BerriAI/litellm model_prices community dataset.
// I3: vendor pages and cited rows in data/prices remain the only source of truth.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_DATASET_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DATASET_URL = process.env.PRICE_TRIPWIRE_DATASET_URL ?? DEFAULT_DATASET_URL;
const PRICES_DIR = "data/prices";
const EXIT_DRIFT = 3;
const PRICE_FIELDS = [
  ["input", ["input_cost_per_token"]],
  ["output", ["output_cost_per_token"]],
  ["input_cached", ["cache_read_input_token_cost", "input_cost_per_token_cache_hit"]],
  ["input_cache_write_5m", ["cache_creation_input_token_cost"]],
  ["input_cache_write_1h", ["cache_creation_input_token_cost_1h", "cache_creation_input_token_cost_1hr"]],
];
const VENDOR_MATCHERS = {
  anthropic: (modelId, row) => row.litellm_provider === "anthropic" || modelId.startsWith("claude-"),
  deepseek: (modelId, row) => row.litellm_provider === "deepseek" || modelId.startsWith("deepseek-"),
  google: (modelId, row) =>
    ["gemini", "google", "google_ai_studio", "vertex_ai", "vertex_ai_beta"].includes(row.litellm_provider) ||
    modelId.startsWith("gemini-") ||
    modelId.includes("/gemini-"),
  openai: (modelId, row) => row.litellm_provider === "openai" || /^(gpt-|o\d|chatgpt-)/.test(modelId),
};

function parseArgs(argv) {
  const opts = { report: null, summaryJson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") {
      opts.report = argv.at(i + 1);
      i += 1;
    } else if (arg === "--summary-json") {
      opts.summaryJson = argv.at(i + 1);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function toUsdPerMillion(value) {
  return Number.isFinite(value) ? value * 1_000_000 : null;
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) <= 1e-9;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isActiveToday(row, today) {
  return row.from_date <= today && (row.to_date === null || row.to_date === undefined || row.to_date >= today);
}

function comparableField(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return toUsdPerMillion(value);
  }
  return null;
}

// aireceipts prices coding-agent transcripts, which are chat/responses requests. Rows the
// community dataset labels with another modality are still listed (its labels are not
// authoritative: it marks at least one generative Gemini model as `embedding`), but they
// are grouped separately and not counted.
const TEXT_MODES = new Set(["chat", "responses"]);

// A canonical id must look like one of the vendor's own ids; otherwise it is a
// third-party model the vendor merely hosts (`vertex_ai/xai/grok-4.6`).
const VENDOR_ID_PATTERNS = {
  anthropic: /^claude-/,
  deepseek: /^deepseek-/,
  google: /^gemini-/,
  openai: /^(gpt-|o\d|chatgpt-)/,
};

function datasetEntriesForVendor(dataset, vendor) {
  const matches = VENDOR_MATCHERS[vendor];
  if (!matches) return [];
  return Object.entries(dataset)
    .filter(([modelId, row]) => {
      if (!row || typeof row !== "object" || modelId === "sample_spec") return false;
      if (!matches(modelId, row)) return false;
      return typeof row.input_cost_per_token === "number" || typeof row.output_cost_per_token === "number";
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

async function readPriceTables() {
  const files = (await readdir(PRICES_DIR)).filter((file) => file.endsWith(".json")).sort();
  const tables = [];
  for (const file of files) {
    const path = join(PRICES_DIR, file);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    tables.push({ file: path, ...parsed });
  }
  return tables;
}

async function fetchDataset() {
  const res = await fetch(DATASET_URL, {
    headers: {
      "user-agent": "aireceipts-price-tripwire/1.0",
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function currentRows(table, today) {
  return Object.entries(table.models ?? {}).flatMap(([modelId, entry]) => {
    const rows = Array.isArray(entry?.price_history) ? entry.price_history : [];
    return rows
      .filter((row) => isActiveToday(row, today))
      .filter((row) => Array.isArray(row.sources) && row.sources.length > 0)
      .map((row) => ({ modelId, row }));
  });
}

function compareRows(tables, dataset, today) {
  const drift = [];
  const skipped = [];
  for (const table of tables) {
    for (const { modelId, row } of currentRows(table, today)) {
      const datasetRow = dataset[modelId];
      if (!datasetRow || typeof datasetRow !== "object") {
        skipped.push(`${table.vendor}/${modelId}: not present in community dataset`);
        continue;
      }
      for (const [field, datasetKeys] of PRICE_FIELDS) {
        if (typeof row[field] !== "number") continue;
        const communityValue = comparableField(datasetRow, datasetKeys);
        if (communityValue === null) {
          skipped.push(`${table.vendor}/${modelId}.${field}: comparable community field absent`);
          continue;
        }
        if (!nearlyEqual(row[field], communityValue)) {
          drift.push({
            vendor: table.vendor,
            modelId,
            field,
            ours: row[field],
            community: communityValue,
          });
        }
      }
    }
  }
  return { drift, skipped };
}

// A vendor's dated-snapshot suffix (`-20251101`, `-2025-08-07`) stripped, so a snapshot
// of a model we already price can be grouped (never hidden: the resolver matches ids
// exactly, so an unlisted snapshot is still unpriced).
function undated(modelId) {
  return modelId.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

// The community dataset lists routing aliases (`deepseek/deepseek-chat`,
// `vertex_ai/gemini-2.5-pro`); the vendor id is the part after the last prefix.
function canonicalId(modelId) {
  return modelId.slice(modelId.lastIndexOf("/") + 1);
}

function isRetired(row, today) {
  const date = row?.deprecation_date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
}

/**
 * Four groups per vendor, all reported, nothing hidden: `newIds` (no row, no known base
 * model), `snapshotIds` (dated snapshot of a priced model; the exact id still has no row),
 * `otherModeIds` (the dataset labels every alias with a non-text modality; listed, not
 * counted) and `retiredIds` (every alias has a deprecation_date already passed; listed, not
 * counted). Aliases are aggregated per canonical id before classification, so one retired
 * routing alias cannot suppress an undated one.
 */
function discoveryFeed(tables, dataset, today) {
  const feed = [];
  for (const table of tables) {
    const known = new Set([
      ...Object.keys(table.models ?? {}),
      ...(Array.isArray(table.omitted) ? table.omitted.map((entry) => entry.model) : []),
    ]);
    const idPattern = VENDOR_ID_PATTERNS[table.vendor];
    const rowsById = new Map();
    for (const [rawId, row] of datasetEntriesForVendor(dataset, table.vendor)) {
      const modelId = canonicalId(rawId);
      // `ft:<base>` rows are fine-tuning price entries, not vendor model ids.
      if (modelId.startsWith("ft:") || known.has(modelId)) continue;
      if (idPattern && !idPattern.test(modelId)) continue;
      if (!rowsById.has(modelId)) rowsById.set(modelId, []);
      rowsById.get(modelId).push(row);
    }
    const newIds = [];
    const snapshotIds = [];
    const otherModeIds = [];
    const retiredIds = [];
    for (const [modelId, rows] of rowsById) {
      if (rows.every((row) => isRetired(row, today))) retiredIds.push(modelId);
      else if (rows.every((row) => typeof row.mode === "string" && !TEXT_MODES.has(row.mode))) otherModeIds.push(modelId);
      else if (known.has(undated(modelId))) snapshotIds.push(modelId);
      else newIds.push(modelId);
    }
    if (newIds.length + snapshotIds.length + otherModeIds.length + retiredIds.length > 0) {
      feed.push({ vendor: table.vendor, newIds, snapshotIds, otherModeIds, retiredIds });
    }
  }
  return feed;
}

function discoveryCount(feed) {
  return feed.reduce((sum, entry) => sum + entry.newIds.length + entry.snapshotIds.length, 0);
}

function renderReport({ drift, discovery, skipped, status }) {
  const lines = [
    "# Price Tripwire Report",
    "",
    "Advisory signal only: vendor pricing pages and cited `data/prices` rows remain authoritative under I3.",
    `Community dataset: ${DATASET_URL}`,
    "",
    `Status: ${status}`,
    `Drift count: ${drift.length}`,
    `Discovery count: ${discoveryCount(discovery)} (new ids ${discovery.reduce((s, e) => s + e.newIds.length, 0)}, dated snapshots of priced models ${discovery.reduce((s, e) => s + e.snapshotIds.length, 0)})`,
    "",
    "## Drift",
    "",
  ];

  if (drift.length === 0) {
    lines.push("No numeric drift found for cited rows with comparable community fields.");
  } else {
    for (const entry of drift) {
      lines.push(
        `- ${entry.vendor}/${entry.modelId}.${entry.field}: ours ${entry.ours} USD/MTok; community ${entry.community} USD/MTok`,
      );
    }
  }

  lines.push("", "## Discovery Feed", "");
  if (discovery.length === 0) {
    lines.push("No missing model ids found for vendors already tracked in `data/prices`.");
  } else {
    for (const entry of discovery) {
      lines.push(`### ${entry.vendor}`, "");
      if (entry.newIds.length > 0) {
        lines.push("New ids (no row, no priced base model):", "");
        for (const modelId of entry.newIds) lines.push(`- ${modelId}`);
        lines.push("");
      }
      if (entry.snapshotIds.length > 0) {
        lines.push("Dated snapshots of priced models (exact id has no row; the resolver matches ids exactly):", "");
        for (const modelId of entry.snapshotIds) lines.push(`- ${modelId}`);
        lines.push("");
      }
      if (entry.otherModeIds.length > 0) {
        lines.push(`Labeled a non-text modality by the community dataset (${entry.otherModeIds.length}, not counted; the label may be wrong): ${entry.otherModeIds.join(", ")}`, "");
      }
      if (entry.retiredIds.length > 0) {
        lines.push(`Retired per the community dataset (${entry.retiredIds.length}, not counted): ${entry.retiredIds.join(", ")}`, "");
      }
    }
  }

  lines.push("", "## Not Compared", "");
  if (skipped.length === 0) {
    lines.push("Every active cited row had comparable community fields.");
  } else {
    for (const item of skipped) lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderWarnReport(message) {
  return [
    "# Price Tripwire Report",
    "",
    "Status: warn",
    "",
    `WARN: ${message}`,
    "",
    "Advisory tripwire skipped. Vendor pricing pages and cited `data/prices` rows remain authoritative under I3.",
    "",
  ].join("\n");
}

async function maybeWrite(path, content) {
  if (path) await writeFile(path, content);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tables = await readPriceTables();
  let dataset;
  try {
    dataset = await fetchDataset();
  } catch (e) {
    const message = `price-tripwire: WARN community dataset fetch failed (${e.message}); advisory check skipped.`;
    const report = renderWarnReport(message);
    console.warn(message);
    console.log(report);
    await maybeWrite(opts.report, report);
    await maybeWrite(opts.summaryJson, `${JSON.stringify({ status: "warn", driftCount: 0, discoveryCount: 0 })}\n`);
    return;
  }

  const today = todayIso();
  const { drift, skipped } = compareRows(tables, dataset, today);
  const discovery = discoveryFeed(tables, dataset, today);
  const discovered = discoveryCount(discovery);
  const status = drift.length > 0 ? "drift" : discovered > 0 ? "discovery" : "clean";
  const report = renderReport({ drift, discovery, skipped, status });

  console.log(report);
  await maybeWrite(opts.report, report);
  await maybeWrite(opts.summaryJson, `${JSON.stringify({ status, driftCount: drift.length, discoveryCount: discovered })}\n`);

  if (drift.length > 0) process.exit(EXIT_DRIFT);
}

main().catch((e) => {
  console.error(`price-tripwire: unexpected failure: ${e.message}`);
  process.exit(1);
});
