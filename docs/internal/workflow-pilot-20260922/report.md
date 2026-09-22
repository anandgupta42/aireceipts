# Controlled workflow pilot: accounting validated, efficacy inconclusive

Four real Claude Fable 5.1 executions repaired two deliberately seeded accounting
bugs. All four passed independently executed acceptance checks and changed only
the allowed implementation file. Existing aireceipts compare/JSON output reconciled
with each execution's input, output, cache-read and cache-write counters. This
validates the local harness and outcome sidecar, not treatment effectiveness.

| Task and assigned arm | Independent checks | Receipt tokens | Process wall seconds | Price coverage |
|---|---:|---:|---:|---|
| A baseline | 10/10 | 174,164 | 91.523 | unpriced |
| A focused-context | 10/10 | 174,953 | 62.536 | unpriced |
| B focused-context | 11/11 | 177,567 | 67.930 | unpriced |
| B baseline | 11/11 | 177,576 | 62.578 | unpriced |

The denominator is all four assigned attempts: 4 accepted, 0 timed out, 0
post-acceptance-check repair rounds, 0 omitted. Acceptance means only these checks
passed; it is not a broader code-quality claim. All resolved primary model IDs
were `claude-fable-5-1`, which has no matching row in the pinned price data.
Dollar savings and cost per accepted task remain null. Child coverage remains
unknown: no nested-agent tool call was observed, but complete ancestry is not
proven. Recorded usage is the observable session ledger, not a complete invoice.

## What the workload actually exercised

Task A repairs an inclusive tariff-date resolver and its ambiguous-overlap case.
The seeded implementation failed 3/10 checks. Task B repairs cached-input subset
normalization and validation; its seeded implementation failed 9/11 checks.
The local launcher records say both pairs began from identical committed seed
trees and separate session IDs.
The two accepted Task A modules are also byte-identical. Their small canonical
fix produced the same output; this observation does not establish whether either
agent used the intended context strategy.
The evaluator's hidden checks lived outside the execution directories and were
run only after the model process ended. A metadata audit found no tool input
referencing the hidden-check file. Final repaired modules and acceptance outputs
are committed so the check results can be rerun independently.

The preregistered `snapshotSha256` values establish paired equality in the
recorded sidecar, but their original directory-hash recipe was not retained and
cannot be recomputed from the published seeds. The independently reproducible
seed identities are the Git tree objects in pre-execution commit `e25ed66`:
Task A `8f80b16927f1b0cfada5afd9cfbbab1059def447` and Task B
`022249df792ce43973c791c3fc9652a6c05f0166`. Reviewers can check both
with `git rev-parse e25ed66:docs/internal/workflow-pilot-20260922/seed/A`
and the corresponding `/seed/B` command, then compare them with the current
tree objects. The validator checks the declared pair hashes; it does not prove
that the private execution directories matched these committed trees.

The two tasks are synthetic reproductions of meaningful accounting defects. They
are actual executed coding work, not real-user product issues or a field study.
The agents may perform self-checks; the hidden-check result remains independent.

## Why no optimization conclusion follows

The intended intervention was one extra sentence requesting focused reads. The
runner constructed that targeted argv, but the stored user-message text did not
contain the exact treatment sentence; rendered titles instead reflected launcher
text. Delivery of that instruction is not independently observable from the saved
trace. This alone prevents an efficacy claim.

The transcript join was checked rather than assumed: for every attempt, the
Claude result session_id equals the assigned ID; every transcript sessionId equals
that same ID; transcript timestamps are within the subprocess start/end; and the
full usage category vector equals the built CLI receipt. The wrong outer session
was not selected. These checks establish accounting correspondence, not prompt
fidelity. No previous solution was copied between paired workspaces.

Cache warmth also differs sharply: A baseline created 60,837 cache tokens, whereas
A targeted created 18,210 and read more cached tokens. Service load and process
startup are uncontrolled. Wall time includes process/hook startup and shutdown;
the receipt's internal session duration intentionally differs. A targeted used
789 more observed tokens than baseline; B targeted used 9 fewer. Two pairs,
uncertain treatment observability, unknown child coverage and unknown tariffs do
not establish causal cost improvement, quality noninferiority or productivity.
There is no subtraction of cost floors and no model ranking.

## Reproduce the local evidence

Run from the repository root:

```sh
node docs/internal/workflow-pilot-20260922/validate.mjs docs/internal/workflow-pilot-20260922/outcomes.json
node --test docs/internal/workflow-pilot-20260922/validate.test.mjs
node docs/internal/workflow-pilot-20260922/hidden-checks.mjs A docs/internal/workflow-pilot-20260922/results/A-baseline.mjs
node docs/internal/workflow-pilot-20260922/hidden-checks.mjs A docs/internal/workflow-pilot-20260922/results/A-targeted.mjs
node docs/internal/workflow-pilot-20260922/hidden-checks.mjs B docs/internal/workflow-pilot-20260922/results/B-baseline.mjs
node docs/internal/workflow-pilot-20260922/hidden-checks.mjs B docs/internal/workflow-pilot-20260922/results/B-targeted.mjs
```

[Outcomes](outcomes.json) preserve all assignments, hashes, independent outcomes,
full token categories, join evidence and unknowns. [Compare A](compare-A.txt) and
[compare B](compare-B.txt) are actual built CLI outputs; only session title labels
were replaced with the preregistered attempt aliases to remove launcher paths.
Accounting values and floor/unknown wording are unchanged. Raw transcripts,
process result JSON and private session/path mappings stay local.

The sidecar validator is a structural consistency check, not cryptographic proof
that a person ran a test. Accepted artifacts and their SHA256 values make the
record reviewable. It rejects missing/duplicate assignments, contradictory
acceptance, negative/nonfinite measurements and dollar claims. No new product
command or pricing engine was added.

## Registration and deviations

The protocol, assignments, seeded bugs and hidden checks were committed in
`989eca9`; `e25ed66` clarified that self-checks must use inline Node commands,
and changed the seed READMEs and snapshot hashes, before any model execution.
The original `registeredAt` predates that amendment; the committed amendment is
the final preregistered seed version. Both commits remain immutable. A Python
launcher syntax error
occurred before any process started and was corrected; no model attempt was
launched or removed at that point. Four model invocations then ran in the declared
A-baseline, A-targeted, B-targeted, B-baseline order.

After execution, the spec ID was administratively renamed from SPEC-0086 to
SPEC-0092 because a global open-PR audit found another branch reserving 0086.
This changed no assignment, prompt, snapshot, check or analysis plan. Treatment
observability and cache imbalance are reported deviations/limitations, not reasons
to discard runs.

Builder validation: typecheck, lint, all 2,224 repository tests with one worker,
102 byte-identical goldens, ten determinism runs, spec lint and hygiene passed.
The sidecar's separate Node tests pass. Final independent review and CI are tracked
in the PR. The practical next step is to make delivered intervention metadata
observable before another trial; this pilot does not justify a new CLI command or
a recommendation that focused context saves money.
