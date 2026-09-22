# Net cache evidence, 22 September 2026

Implementation scope: SPEC-0090; complete parent-session observed-token arithmetic, never invoice savings or a lower bound.

## Real workload checks

A frozen private cohort of 77 Claude sessions was processed through the real adapter and receipt engine. Results: 27 complete priceable sessions (26 positive, one negative net difference); 47 withheld for unpriced/incomplete session evidence; two no-cache-activity sessions; one failed load. These are convenience-sample observations, not population rates. Whole-session eligibility follows selected request snapshots; raw streaming duplicates are not extra requests.

A three-request positive session and a one-request negative session were then processed twice through the built CLI dispatch with byte-identical JSON. A harness scoped only adapter discovery to the existing transcript directory via the public adapter registry; it did not mock parsing, pricing, command dispatch or rendering. Separately, Python Decimal arithmetic selected the raw whole usage snapshot with the greatest output per response ID, resolved the dated Anthropic rates, and independently reproduced both net results. Private transcripts, paths, prompts and dollar values are retained locally, not committed.

## Visual checks

The actual built CLI rendered the synthetic complete-cache fixture as PNG in light and dark themes. Both were visually inspected for legibility, clipping, sign wording, placement and caveats. The shared SVG output is committed as golden evidence; no existing golden changed. Text defaults stay compact, while details includes the signed row and its interpretation. New golden artifacts: `cache-economics-details.txt` and the light/dark SVG equivalents.

## Review and gates

Claude Fable (`claude-fable-5-1`) authored the exact design on 22 September. An independent spec critique found no blocker subject to the demonstrated occurrence gate. The preliminary independent Fable code review found two substantive integration issues: the honesty validator did not yet recognize signed arithmetic, and the shared methodology still described all dollars as floors. Both were fixed with an exact traced-row-plus-disclosures exception, adversarial validator tests, and consistent methodology/trust/pricing docs. A separate cold-reader agent caught nested-field documentation placement and introductory wording; both were corrected. At implementation commit `2d0f99e`, the same independent Fable reviewer returned PASS after personally running typecheck, lint, all 2,253 tests in 147 files, 105 goldens, spec lint, hygiene and 10-run determinism with exit 0. Scoped mutation on the new money module killed 144/154 mutants (93.51%), exit 0. A final documentation/test-assertion delta is separately reviewed before publication. Focused tests include an independent arithmetic property oracle, context boundary, both TTL premiums, missing-counter abstention, selected-snapshot provenance, real CLI dispatch and JSON schema parity.

No claim about avoided spending, task quality, provider invoices or causal cache benefit follows from these checks.

Known nonblocking limitation: an arithmetically nonfinite accumulated net amount
is withheld under the generic `unpriced-usage` reason. No finite amount is
substituted. The shipped rate tables and practical transcript sizes do not
approach this boundary.
