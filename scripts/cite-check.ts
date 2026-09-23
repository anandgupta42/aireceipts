#!/usr/bin/env -S node --experimental-strip-types
// Mechanical gate for data/prices/*.json (I2/I3, AGENTS.md): every vendor file
// must be valid JSON in the documented schema, and every price_history row must
// carry a non-empty `sources` array whose entries each have a `url`.
//
// Usage: node --experimental-strip-types scripts/cite-check.ts [--no-network] [files...]
// With no file args, checks every data/prices/*.json. Exits 1 on any violation.
//
// Beyond schema, two SPEC-0005 (R3) checks:
//   - excerpt required on every cited source, so a reviewer can verify the number
//     against the quoted page text without re-fetching. (Unconditional rather than
//     gated on the optional `observed_at`, which a new row could omit or backdate
//     to slip an uncited number past the gate.)
//   - URL liveness: each cited url is fetched (GET, redirects followed) and must
//     return < 400. Offline-tolerant in local runs (a connection failure warns);
//     enforced in CI (a connection failure fails). `--no-network` skips liveness
//     for deliberately offline runs (the air-gapped dev) but is IGNORED under CI,
//     where liveness is always enforced.
//
// Price-appears-on-page matching stays TODO — pricing pages are unstructured;
// the human price-check duty (lead) covers the number itself. This gate proves
// the citation exists, carries an excerpt, and still resolves.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface PriceSource {
  url: string;
  observed_at: string;
  excerpt?: string;
}

interface PriceRow {
  input: number;
  output: number;
  input_cached?: number;
  from_date: string;
  to_date?: string | null;
  sources: PriceSource[];
}

const PRICES_DIR = "data/prices";

// Liveness fetch budget per URL.
const LIVENESS_TIMEOUT_MS = 12_000;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkSources(file: string, at: string, sources: unknown, errors: string[], urls: Map<string, string>): void {
  if (!Array.isArray(sources) || sources.length === 0) {
    fail(file, `${at}: sources must be a non-empty array`, errors);
    return;
  }
  sources.forEach((source: Partial<PriceSource>, i: number) => {
    const place = `${at}.sources[${i}]`;
    if (typeof source?.url !== "string" || !/^https?:\/\//.test(source.url)) fail(file, `${place}: url (http/https) is required`, errors);
    else urls.set(source.url, file);
    if (!validDate(source?.observed_at)) fail(file, `${place}: valid observed_at is required`, errors);
    if (typeof source?.excerpt !== "string" || !source.excerpt.trim()) fail(file, `${place}: non-empty excerpt required`, errors);
  });
}

function fail(file: string, msg: string, errors: string[]): void {
  errors.push(`${file}: ${msg}`);
}

/** Collect the cited urls for the current file into `urls` (deduped by the caller). */
function checkFile(file: string, errors: string[], urls: Map<string, string>): void {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, `invalid JSON — ${(e as Error).message}`, errors);
    return;
  }
  const table = doc as { vendor?: unknown; models?: Record<string, { price_history?: unknown; aliases?: unknown }>; comparison_candidates?: unknown };
  if (typeof table.vendor !== "string" || !table.vendor) {
    fail(file, `missing "vendor" string`, errors);
  }
  if (!table.models || typeof table.models !== "object") {
    fail(file, `missing "models" object`, errors);
    return;
  }
  for (const [model, entry] of Object.entries(table.models)) {
    const rows = entry?.price_history;
    if (!Array.isArray(rows) || rows.length === 0) {
      fail(file, `${model}: price_history must be a non-empty array`, errors);
      continue;
    }
    rows.forEach((row: Partial<PriceRow>, i: number) => {
      const at = `${model}.price_history[${i}]`;
      if (typeof row.input !== "number" || typeof row.output !== "number") {
        fail(file, `${at}: input/output must be numbers (usd per million tokens)`, errors);
      }
      if (typeof row.from_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.from_date)) {
        fail(file, `${at}: from_date must be YYYY-MM-DD`, errors);
      }
      checkSources(file, at, row.sources, errors, urls);
    });
    if (entry.aliases !== undefined && !Array.isArray(entry.aliases)) fail(file, `${model}.aliases must be an array`, errors);
    for (const [i, alias] of (Array.isArray(entry.aliases) ? entry.aliases : []).entries()) {
      const at = `${model}.aliases[${i}]`;
      if (typeof alias?.id !== "string" || !alias.id) fail(file, `${at}: id is required`, errors);
      if (!validDate(alias?.from_date) || !(alias?.to_date === null || validDate(alias?.to_date)) ||
        (typeof alias?.to_date === "string" && alias.to_date < alias.from_date)) fail(file, `${at}: invalid date window`, errors);
      checkSources(file, at, alias?.sources, errors, urls);
    }
  }
  if (table.comparison_candidates !== undefined && !Array.isArray(table.comparison_candidates)) fail(file, `comparison_candidates must be an array`, errors);
  for (const [i, candidate] of (Array.isArray(table.comparison_candidates) ? table.comparison_candidates : []).entries()) {
    const at = `comparison_candidates[${i}]`;
    if (typeof candidate?.model !== "string" || !table.models[candidate.model]) fail(file, `${at}: model must name a canonical entry`, errors);
    if (typeof candidate?.reason !== "string" || !candidate.reason.trim()) fail(file, `${at}: reason is required`, errors);
    checkSources(file, at, candidate?.sources, errors, urls);
  }
}

/**
 * GET each url (redirects followed) and require status < 400. Returns hard
 * failures (dead links, or — in CI — unreachable hosts) and soft warnings
 * (unreachable hosts on a local, offline-tolerant run).
 */
async function checkLiveness(
  urls: Map<string, string>,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inCi = Boolean(process.env.CI);
  for (const [url, file] of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          // Some vendor pages 403 an unadorned client; present a browser-ish UA.
          "user-agent":
            "Mozilla/5.0 (compatible; aireceipts-cite-check/1.0; +https://github.com/anandgupta42/receipts)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.status >= 400) {
        errors.push(`${file}: cited url is dead (HTTP ${res.status}) — ${url}`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const line = `${file}: cited url unreachable (${msg}) — ${url}`;
      if (inCi) {
        errors.push(line);
      } else {
        warnings.push(`${line} [tolerated: local offline run; enforced in CI]`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { errors, warnings };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const noNetwork = rawArgs.includes("--no-network");
  const args = rawArgs.filter((f) => f.endsWith(".json"));
  const files =
    args.length > 0
      ? args
      : existsSync(PRICES_DIR)
        ? readdirSync(PRICES_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => join(PRICES_DIR, f))
        : [];

  if (files.length === 0) {
    console.log("cite-check: no price tables to check.");
    return;
  }

  const errors: string[] = [];
  const urls = new Map<string, string>();
  for (const file of files) checkFile(file, errors, urls);

  // CI always enforces liveness — `--no-network` is a local/offline convenience,
  // never a way to land a dead link through CI (R3: enforced in CI).
  const inCi = Boolean(process.env.CI);
  const skipLiveness = noNetwork && !inCi;
  if (noNetwork && inCi) {
    console.warn("cite-check: WARN --no-network ignored under CI — liveness is enforced here.");
  }

  let warnings: string[] = [];
  if (skipLiveness) {
    console.log(`cite-check: --no-network — skipping URL liveness for ${urls.size} cited url(s).`);
  } else if (errors.length === 0) {
    // Only reach out once the files are structurally sound; a malformed file's
    // urls aren't worth probing.
    const live = await checkLiveness(urls);
    errors.push(...live.errors);
    warnings = live.warnings;
  }

  for (const w of warnings) console.warn(`cite-check: WARN ${w}`);

  if (errors.length > 0) {
    console.error(`cite-check: ${errors.length} violation(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const livenessNote = skipLiveness ? "" : ` (${urls.size} cited url(s) live)`;
  console.log(`cite-check: ${files.length} file(s) OK — every price row is cited${livenessNote}.`);
}

main().catch((e) => {
  console.error(`cite-check: unexpected failure — ${(e as Error).message}`);
  process.exit(1);
});
