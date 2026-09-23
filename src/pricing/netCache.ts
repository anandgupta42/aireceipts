import type { Session, TokenUsage } from "../parse/types.js";
import type { PriceRow, ResolvedPrice } from "./types.js";
import { isoDateOf, isPriceableUsage, pricingUnitsForTurn, ratesForUsage, resolvePrice, vendorForTurn } from "./resolve.js";

export const NET_CACHE_INTERPRETATION = "hypothetical no-cache price minus observed cache price, same tokens; arithmetic, not a prediction";
export const NET_CACHE_REASONS = ["unsupported-adapter", "write-counters-unobserved", "incomplete-cache-evidence", "price-row-incomplete", "unpriced-usage", "no-cache-activity"] as const;
export type NetCacheReason = typeof NET_CACHE_REASONS[number];
export interface NetCache {
  usd: number | null;
  unavailableReason: NetCacheReason | null;
  interpretation: typeof NET_CACHE_INTERPRETATION;
  scope: "parent-session";
}

/** Signed arithmetic over a complete request, never the difference of two floors. */
export function netCacheAtRow(usage: TokenUsage, row: PriceRow): number | null {
  if (!usage.cacheEvidenceComplete || !isPriceableUsage(usage)
    || usage.cacheCreation5m === undefined || usage.cacheCreation1h === undefined
    || usage.cacheCreation5m + usage.cacheCreation1h !== usage.cacheCreation) return null;
  const rates = ratesForUsage(usage, row);
  const read = rates.input_cached;
  const write5m = rates.input_cache_write_5m ?? rates.input_cache_write;
  const write1h = rates.input_cache_write_1h ?? rates.input_cache_write;
  if ((usage.cacheRead > 0 && read === undefined)
    || (usage.cacheCreation5m > 0 && write5m === undefined)
    || (usage.cacheCreation1h > 0 && write1h === undefined)) return null;
  const delta = (usage.cacheRead * (rates.input - (read ?? rates.input))
    - usage.cacheCreation5m * ((write5m ?? rates.input) - rates.input)
    - usage.cacheCreation1h * ((write1h ?? rates.input) - rates.input)) / 1e6;
  return Number.isFinite(delta) ? delta : null;
}

export async function computeNetCache(
  session: Session,
  dataDir: string,
  resolvedRows?: readonly ResolvedPrice[],
): Promise<NetCache> {
  const result = (usd: number | null, unavailableReason: NetCacheReason | null): NetCache =>
    ({ usd, unavailableReason, interpretation: NET_CACHE_INTERPRETATION, scope: "parent-session" });
  if (session.source === "codex") return result(null, "write-counters-unobserved");
  if (session.source !== "claude-code") return result(null, "unsupported-adapter");
  if (session.unpriceable || session.usageReconciliationFailed || (session.droppedRecords ?? 0) > 0
    || (session.unattributedUsage?.total ?? 0) > 0 || (session.excludedUnattributedUsage?.total ?? 0) > 0
    || (session.conflictingAggregateUsage?.total ?? 0) > 0) return result(null, "unpriced-usage");
  let total = 0;
  let activity = false;
  for (const turn of session.turns) {
    // A tool-result-only turn is not an API request. A model-bearing record with
    // no usage is an observation gap, even when another request is complete.
    if (!turn.usage) {
      if (turn.model) return result(null, "incomplete-cache-evidence");
      continue;
    }
    const units = pricingUnitsForTurn(turn);
    if (!units) return result(null, "unpriced-usage");
    for (const unit of units) {
      if (!unit.usage.cacheEvidenceComplete) return result(null, "incomplete-cache-evidence");
      const date = isoDateOf(unit.timestamp);
      const vendor = vendorForTurn(session.source, unit.model, unit.pricingProvider);
      if (!unit.model || !date || vendor !== "anthropic") return result(null, "unpriced-usage");
      // The receipt builder has already resolved these dated rows. Reuse them
      // instead of rereading the price table once per request.
      const row = resolvedRows === undefined
        ? await resolvePrice(vendor, unit.model, date, dataDir)
        : resolvedRows.find((candidate) => candidate.vendor === vendor && (candidate.matched_id ?? candidate.model) === unit.model
          && candidate.from_date <= date && (candidate.to_date === null || date <= candidate.to_date));
      if (!row) return result(null, "unpriced-usage");
      const delta = netCacheAtRow(unit.usage, row);
      if (delta === null) return result(null, "price-row-incomplete");
      total += delta;
      activity ||= unit.usage.cacheRead + unit.usage.cacheCreation > 0;
    }
  }
  if (!activity) return result(null, "no-cache-activity");
  return Number.isFinite(total) ? result(total, null) : result(null, "unpriced-usage");
}
