# Preregistered focused-context workflow pilot

Registered 2026-09-22 before any trial model execution. The user authorized the
five-step implementation and real workflow checks; the lead approved this bounded
engineering pilot. Four real model executions repair two deliberately seeded,
small accounting bugs. This is a controlled coding workload, not a field study or
measurement of real-user effectiveness.

## Assignment and intervention

Exactly four assigned attempts: A-baseline, A-targeted, B-targeted, B-baseline,
executed sequentially in that order. Each pair receives byte-identical initial
files and task requirements in fresh directories and separate sessions. No prior
solution, output, hidden check, session history or reviewer feedback reaches the
paired run. The only treatment is one added instruction asking for focused reads
and relevant file inspection before broad repository reads. Both arms may use the
same tools, inspect the same files and run self-authored checks.

Use Claude Fable, high effort, identical tool allowlist and no nested agents.
Record resolved model identity; differing identities make the pair ineligible for
an effectiveness comparison but never remove its attempt from the ledger.
No agent can inspect the hidden acceptance script, which lives outside each trial
workspace and is first executed by the evaluator after the agent terminates.

## Tasks and independent acceptance

A repairs an inclusive date-range resolver: do not match before from_date; match
the inclusive end date; open end means no upper bound; unknown/gap returns null;
more than one matching row is ambiguous and returns null. Preserve source objects.
B repairs a usage normalizer: vendor input_tokens includes cached_input_tokens;
ordinary input excludes that subset exactly once, total equals original input plus
output plus cache_creation, an additional disjoint category only when supplied;
reject negative/nonfinite/noninteger or contradictory counters, preserve zero.
Both seeded modules are known-broken before assignment. Independent hidden checks
cover ordinary and adversarial cases, including no-price/contradictory evidence.

Acceptance is the evaluator's actual node test exit and assertion counts, plus an
allowed-file diff check. It is a manually recorded outcome supported by external
tests, never an aireceipts-generated correctness verdict. A timeout/abandonment,
wrong file edit or failed check remains a failed assigned attempt. All runs get at
most 8 minutes and one agent invocation. No repair round follows a hidden-check
failure; repair_count is zero by design, not an omitted failed rerun.

## Recorded fields and analysis

Keep attempt/task/arm IDs, original snapshot and output hashes, exact model and
configuration, UTC bounds, elapsed wall seconds, process exit, timeout, independent
check counts/exit, changed-file eligibility, repair count, children count and known
coverage, observed usage and receipt coverage. Retain every attempt, including
failed, abandoned, missing-usage or changed-model runs. Child usage is included
when present; absent ancestry evidence is unknown, never assumed complete.

Pair each task's existing aireceipts compare output with a manually authored local
JSON sidecar. Its validator rejects missing/duplicate assignments, denominator
changes, fabricated successful checks, unsupported dollar claims and invalid
numeric fields. Session identifiers and private paths stay local; public results
use preregistered aliases. Product parser/renderer output may be scrubbed only for
identifiers, paths and task titles, without changing accounting values.

Report task-specific outcomes and token categories, all-assigned acceptance count,
timeouts, repairs and unknown coverage. No p-value or population effect claim with
two pairs. No subtraction of floors, invoice savings, cost per accepted task, model
ranking, causal cost improvement, noninferiority or quality-safety claim. Provider
billing totals, subscriptions and API-equivalent floors are distinct. Unknown
pricing remains unknown. Different context-cache warmth and service load are
uncontrolled; elapsed time is descriptive, not productivity improvement.

Decision: the pilot validates the sidecar workflow only. A subsequent larger,
independently accepted study is required before shipping a product command or
recommending focused context as a proven savings intervention.
