import { formatUsd } from "./format.js";
import type { Block } from "./blocks.js";
import type { NetCache } from "../pricing/netCache.js";

/** The signed delta has no conservative bound direction: no ≥, ≈, or floor formatter. */
export function netCacheBlocks(net: NetCache | undefined): Block[] {
  if (net?.usd === null || net?.usd === undefined) return [];
  const amount = formatUsd(Math.abs(net.usd));
  const value = `$${amount}${amount === "0.00" ? "" : net.usd > 0 ? " lower" : " higher"}`;
  return [
    { kind: "row", label: "cache vs uncached", value },
    { kind: "note", text: "(hypothetical no-cache price, same tokens)", indent: 2, muted: true },
    { kind: "note", text: "(read discount minus write premium)", indent: 2, muted: true },
    { kind: "note", text: "(parent session; arithmetic, not a prediction)", indent: 2, muted: true },
  ];
}

/** Permit this exact traced arithmetic group only; arbitrary bare dollars still fail. */
export function isTracedNetCacheRow(blocks: Block[], index: number, net: NetCache | undefined): boolean {
  const expected = netCacheBlocks(net);
  return expected.length > 0
    && JSON.stringify(blocks.slice(index, index + expected.length)) === JSON.stringify(expected);
}
