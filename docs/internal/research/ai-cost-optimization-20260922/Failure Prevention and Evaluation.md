# Failure prevention and trustworthy cost optimization

> Baseline correction: the initial code audit used the older `a56a6a7` checkout. Current `origin/main` at `34867fa` has substantial additional implementations. [Current-main reconciliation](Current%20Main%20Reconciliation.md) and the revised delivery plan supersede any older-code gap or new-feature claim below. Provider and research-source findings remain separately dated.

Research date: 2026-09-22. Status: research and proposed experiments, not an approved implementation spec. Sources below were opened on this date. Repository grounding: `AGENTS.md` and `specs/SPEC-0000-product.md`; existing shipped features cited here come from that inventory, not a fresh implementation audit.

The most useful next capability is an evidence-backed account of **what happened after a mistake and whether the final change was checked**. Repeated failed commands, stale verification, and unclosed child tasks are observable enough to support conservative receipts. Whether an agent misunderstood the objective, forgot a requirement, or could have used a cheaper model usually is not. A transcript analyzer should make that boundary visible.

The cost target should be **total cost per accepted task**, including unsuccessful attempts and subsequent repair. Token reductions that worsen outcomes or increase human review are not demonstrated improvements. A receipt can measure observed work and propose experiments; it cannot recover an unobserved counterfactual.

## What the evidence establishes

### Productivity measurements need current evidence and careful denominators

METR's July 2025 randomized trial involved 16 experienced maintainers completing 246 tasks in familiar repositories. Allowing early-2025 AI increased completion time by 19%; developers nevertheless believed AI helped. The study explicitly does not generalize this result to most developers, unfamiliar repositories, or future models. Its useful lesson for aireceipts is methodological: perceived savings and measured completion time can disagree substantially. [METR, 2025-07-10](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)

The February 2026 follow-up matters equally. METR reported that developers and tasks were increasingly selecting out of the no-AI condition, and concurrent agents made task-time reporting unreliable. The returning-developer estimate suggested 18% speedup but its confidence interval included slowdown; METR characterized the new data as an unreliable estimate of present productivity. Do not carry the 2025 slowdown forward as a claim about September 2026 tools, or present the follow-up as proof of acceleration. [METR, 2026-02-24](https://metr.org/blog/2026-02-24-uplift-update/)

### Failure taxonomies are useful; semantic diagnoses require more evidence

MAST version 2 classified 14 failure modes into specification problems, inter-agent misalignment, and verification problems, using seven frameworks and over 200 tasks. Examples include repeated steps, history loss, ignored inputs, premature termination, and inadequate verification. This is a helpful taxonomy, not a validated deterministic coding-transcript classifier. Its semantic labels depended on expert annotation and an LLM judging pipeline; aireceipts must not import that pipeline into its zero-model-call product. Version 2 is pinned deliberately because later revisions change the study population. [Cemri et al., v2, 2025-04-22](https://arxiv.org/html/2503.13657v2)

Anthropic's long-running harness work describes agents losing useful state across context boundaries and marking features complete without adequate testing. Its interventions included incremental work, persistent progress artifacts, and explicit end-to-end checks. These are engineering observations from an application-building harness, not a randomized estimate of savings or proof that a missing handoff caused a particular failure. They motivate measuring verification freshness and explicit recovery activity. [Anthropic, 2025-11-26](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

SWE-agent showed that the interface through which an agent searches, edits, and tests influences behavior and performance. The implication is to distinguish tool-interface problems from model capability when categorizing failed work. Its 2024 benchmark results do not establish the best present-day interface or a universal token reduction. [Yang et al., 2024-05-06](https://arxiv.org/abs/2405.15793)

### More agents can buy coverage, overhead, or both

Anthropic's research-agent system reported approximately 15 times chat token usage for multi-agent runs. The baseline is **chat**, not a comparable single coding agent, and the tasks were research tasks. Therefore this number is not an expected coding-swarm multiplier. The same account emphasizes task decomposition and explicitly bounded delegation. Measure each session's actual parent and child usage instead of embedding a generic multiplier. [Anthropic, 2025-06-13](https://www.anthropic.com/engineering/multi-agent-research-system)

An August 2026 Anthropic experiment compared coordinated vulnerability-discovery swarms with independent searches. The coordinated system found more vulnerabilities, but also searched beyond the independent agents' assigned directories. Restricting attention to shared core directories made tokens per vulnerability appear comparable. The work also distinguishes independent discovery from tightly interdependent software construction. This is strong motivation to record task scope before comparing swarm costs; raw findings per run can reward broader scope. It does not establish that coordination has no value. [Anthropic, 2026-08-13](https://www.anthropic.com/research/multiagent-systems)

### Evaluation infrastructure and graders can manufacture apparent gains

*AI Agents That Matter* argues for joint cost and accuracy evaluation, holdout sets, and reproducible evaluation setups. Its practical lesson is to compare configurations at a stated quality constraint, rather than celebrating accuracy purchased through unrestricted repeated sampling. The paper is evidence for an evaluation discipline, not for a specific savings percentage in aireceipts users' workloads. [Kapoor et al., 2024-07-01](https://arxiv.org/abs/2407.01502)

Anthropic's infrastructure study found a six-percentage-point Terminal-Bench 2.0 spread across resource configurations while holding model, harness, and tasks constant. Resources can both prevent infrastructure failures and enable different solving strategies. Record CPU, memory, timeout, concurrency, and environment versions in experiments; an out-of-memory failure is not automatically a model reasoning failure. The reported magnitude is specific to that experiment. [Anthropic, 2026-02-05](https://www.anthropic.com/engineering/infrastructure-noise)

OpenAI's February audit found flawed tests in at least 59.4% of a selected, often-failed subset of SWE-bench Verified, plus evidence of contamination. The percentage is **not** a random-sample estimate for the entire benchmark. Its then-recommendation of SWE-Bench Pro subsequently received an important qualification. [OpenAI, 2026-02-23](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)

In July, OpenAI audited SWE-Bench Pro and estimated roughly 30% of public tasks had breaking issues, including underspecification, excessive implementation specificity, insufficient tests, and contradictory prompts. This is a model provider's audit, not an independently settled universal error rate. For this project, the actionable conclusion is to audit the acceptance oracle and use fresh project-specific held-out tasks; replacing one leaderboard name with another does not solve evaluation validity. [OpenAI, 2026-07-08](https://openai.com/index/separating-signal-from-noise-coding-evaluations/)

Anthropic's evaluation guidance distinguishes transcripts from outcomes: a completion assertion is not a verified change in the environment. It recommends multiple trials and mixed grading approaches. Aireceipts can retain deterministic grading and human adjudication while leaving model graders outside the product path. [Anthropic, 2026-01-09](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

## Proposed measurement contract

The following is original product design, not a claim that the papers validated these rules. Build on the existing stuck-loop, context-thrash, handoff, and confidence surfaces rather than creating parallel definitions.

The initial audit used the older checkout; current main changes the implementation picture. `detectStuckLoops` at `src/pricing/waste.ts:105` still ignores outcomes, although `flattenCalls` at line 70 now retains status. `detectTrivialSpans` at line 270 preserves the short-output heuristic with stronger request-level pricing gates. Cost-shape and same-file reread diagnostics, loop text locations, and an overlap-safe non-savings handoff subtotal are already implemented. The narrower remaining evidence-export gap is loop/trivial span locations in JSON. Therefore sharpen and independently validate existing findings, then add verification chronology; do not rebuild the existing diagnostics. See the current-main reconciliation for exact references.

Every finding needs a versioned detector ID, ordered evidence references, explicit observation window, eligible-event count, missing-field reasons, and separate **evidence strength** and **actionability**. Evidence strength means structured outcome versus textual hint; it is not an invented probability that the work was wasteful. Preserve source offsets so users can inspect events locally. Prefer a structured `unknown` over an empty collection that appears to mean zero failures.

Minimum normalized fields, when available:

| Field group | Needed fields | Missing-data behavior |
|---|---|---|
| Identity | source adapter/version, session ID, event ID, tool-call ID, child/parent link | Never merge unrelated sessions by timestamp alone |
| Ordering | source sequence, start/end timestamps, explicit causal links | Local ordering can survive absent clocks; cross-agent order may remain unknown |
| Command | exact command/arguments, working directory, process/session ID | Do not equate commands run in different contexts |
| Result | terminal versus pending state, exit code/signal, structured error, output hash, truncation flag | Text-only success is weaker evidence; pending is not failure |
| State | observed edits, file/content hashes or revision IDs, environment changes | No claim that state stayed unchanged if mutations are unobserved |
| Usage | normalized usage event ID, model/date, token categories, allocation methodology | Tokens only without eligible price rows; no per-call dollars without attribution |
| Outcome | optional local task manifest, acceptance evidence, check scope, final revision | Session completion alone does not imply task acceptance |

Hashes and paths remain local. Hashing a transcript-derived value does not make it appropriate adoption telemetry. New sensitive analysis must remain outside the existing telemetry payload contract.

## Deterministic detectors worth testing

### 1. Repeated failed invocation without observed recovery

**Rule:** at least three terminal failures with the same conservative command signature, working directory, and comparable error fingerprint, without an intervening observed relevant edit, dependency installation, environment change, or changed arguments. Start with exact argument equality; do not normalize away quoted content, flags, or environment variables. Compare structured error codes before text fingerprints.

**Output:** “This invocation failed three times with the same recorded error; no intervening recovery change was recorded.” List attempts, failure kinds, and evidence gaps. If state visibility is incomplete, remove the implication that the underlying state was unchanged. Exclude pending process polling and result retrieval from the attempt count.

**Negative cases:** retrying a transient remote error, deliberately sampling a flaky test, waiting for a deployment, or testing repeated failures as the actual task. Suppress for explicit retry policies and reproducibility experiments; otherwise explain the ambiguity. Exit code 1 from a search command can mean no matches, so use tool-specific semantics rather than a universal nonzero-is-error rule.

**Intervention to test:** a handoff note suggesting inspection of the first error and a changed precondition before retrying. Show observed associated spend only; do not call all retries avoidable or convert tool-runtime milliseconds into dollars.

### 2. Verification made stale by later edits

**Rule:** a recognized successful check is followed by a recorded edit affecting its declared scope, with no later successful equivalent check before the observation window ends. Strong form requires revision or content hashes and a declared check scope. With only timestamps, report “edits followed the last observed successful check,” not “the final code was untested.”

**Output:** last successful check, checked revision if known, subsequent relevant edits, later pending/failed checks, and transcript completeness. A structured assertion tied to a revision is preferred to natural-language claims such as “tests passed.”

**Negative cases:** documentation-only edits outside check scope, formatter-only changes explicitly covered by policy, tests executed externally, an active session, or a truncated transcript. A successful unit test does not establish end-to-end acceptance, and a test command itself may mutate snapshots or generated files.

**Intervention:** include the precise stale check in the existing handoff. This can prevent mistakes in the next session without controlling the running agent. Initial release should describe chronology and scope; definitive requirement violations need an explicit project check manifest.

### 3. Terminal failures without observed resolution

**Rule:** group terminal failures by command and scope; identify groups with no later successful equivalent invocation or explicit structured dismissal. Separate failed, timed out, cancelled, and still running.

**Output:** “One check has no recorded passing rerun,” with a local evidence link. This is more defensible than detecting “false completion” from the assistant's prose. A failure followed by a narrower passing command does not close the broader failed check.

**Negative cases:** expected negative tests, baseline failures intentionally outside the task, user cancellation, and external CI. Baseline/current distinctions require captured baseline evidence. No grading of negligence or task correctness is justified by absence alone.

**Intervention:** a short open-check list in the handoff. Give users a structured local way to annotate expected failures without rewriting historical evidence.

### 4. Rework episodes and recovery latency

**Rule:** identify check failure → recorded edits → rerun sequences. Track elapsed tool intervals, number of edit/rerun cycles, and associated usage. A later pass closes the observed recovery episode; cancellation leaves it censored. Repeated full-suite runs between unchanged snapshots can be identified separately.

**Output:** “Three edit/check cycles preceded the first observed pass.” Report successful recovery as useful work. Where operations overlap, interval unions measure recorded elapsed activity; summing child durations measures aggregate tool time, which is different.

**Negative cases:** test-driven development, intentional mutation testing, benchmarking, and flaky-test diagnosis. High iteration counts do not demonstrate poor reasoning. Do not award “first-pass success” for skipping checks.

**Intervention:** compare targeted-check-first and full-suite-first policies prospectively. Any savings calculation includes the final full check and escaped regressions, preventing the metric from rewarding less verification.

### 5. Duplicate child reads and unresolved child lifecycles

**Rule:** require explicit parent/child relationships. Identify identical read-only commands on matching snapshots that return the same output hash, and count child tasks lacking a terminal result within a complete parent window. Account for child usage once through canonical usage-event identity.

**Output:** “Two child agents read the same snapshot” and “one child has no recorded terminal result.” Neither observation proves redundant reasoning or an abandoned task. Report overlap counts separately from total spend unless allocation is supportable.

**Negative cases:** independent review, security audits, deliberate replication, shared setup needed for distinct tasks, and results delivered outside captured logs. An identical file path does not establish identical contents. Parent-child wall-clock overlap is not a measurable speedup against a sequential counterfactual.

**Intervention:** test explicit work partitions and artifact handoffs against existing delegation. Require equal task scope and quality criteria. A swarm's wider search coverage must not be mistaken for better efficiency on an unchanged task.

### 6. Reacquisition after an explicit context boundary

**Rule:** after a recorded compaction or reset, identify exact repeated reads/searches of unchanged artifacts seen earlier. Record count, output bytes, and attributable usage within a predefined event window.

**Output:** “These artifacts were read again after compaction.” Avoid “the agent forgot”: reacquisition may be necessary, and the analyzer generally cannot inspect the retained internal context.

**Negative cases:** changed files, new subtask ownership, compliance review, and incomplete pre-compaction history. Bytes are not tokens; output truncation further weakens any volume estimate.

**Intervention:** enrich existing handoffs with completed checks, unresolved errors, revision, and artifact references. Compare subsequent recovery effort empirically. The detector supplies a candidate mechanism, not causal evidence that compaction increased costs.

## Avoid deceptive savings arithmetic

Partition cost reporting into observed spend, observed spend associated with a finding, and measured experimental change. Only the third supports “reduced cost,” and only for the studied population. Overlapping findings must reference shared event identities so their associated spend is not added twice. A verification gap has no meaningful recoverable-dollar amount by itself.

Define the experiment's primary cost statistic as total model/API spend across **all assigned attempts**, including failed and abandoned attempts, divided by accepted tasks. Show total assigned tasks, acceptance rate, and spend separately; when acceptance is zero the ratio is undefined. This ratio measures a workflow cohort, not the dollar value of a single failure. Preserve historical list-price comparisons separately from actual billing if subscriptions, credits, and quota constraints make the two differ.

Human review minutes, subsequent repair time, and elapsed time should remain separate outcomes. Monetize human time only with an explicitly supplied rate and label the calculation; never infer salary or imply that two minutes of waiting equal two minutes of human labor saved.

## Study protocol and shipment gates

**Stage A: validate the observations.** Assemble a consented local corpus with failures, successful runs, deliberately adversarial negative cases, truncated logs, and all supported adapter families. Hold out entire tasks, developers, and repositories where possible; never split neighboring events from the same session across train/tune and evaluation. Two humans independently label findings and actionable next steps, resolving disagreements against source evidence. Product execution remains deterministic and offline.

Measure precision separately for each detector, adapter, and evidence-strength tier; report coverage and abstention alongside it. Include findings the detector missed, so apparent precision is not purchased through invisible near-total abstention. A small pilot tunes rules; it does not authorize default waste labels. Require zero observed false waste labels on independently labeled held-out negative cases, adjudicate every ambiguity, and report the statistical bound and clustering limitations. For a proposed quantitative default-label gate, target a one-sided 95% lower precision bound of at least 99%; this operationalizes the repo's near-zero-false-positive requirement and is a proposed product tolerance, not a literature constant. If the corpus cannot support that claim, retain neutral observations in opt-in details and explicitly call reliability unestablished.

Correlated events do not create independent evidence. Confidence intervals should resample at the developer/repository cluster level when there are enough clusters; report task-level results within clusters. With few clusters, use exact/randomization methods where assignment supports them, show each cluster's result, and mark broad population claims as unsupported. A tiny corpus with zero false positives cannot certify a strict reliability bound. Determine required corpus size from desired precision and observed clustering before labeling a rule ready.

**Stage B: test whether advice helps.** Begin in shadow mode, then compare the existing receipt with a receipt containing one actionable finding. Predeclare one primary intervention and its quality criterion. For persistent advice that users learn and carry forward, randomize at developer level or use explicitly modeled blocks with washout; task-level randomization can contaminate controls. For tightly controlled offline harness experiments, pair fresh isolated checkouts of the same task, randomize execution order, and treat repeated runs as nested within task.

Keep model version, harness, task scope, price-table version, resources, retry budget, and acceptance oracle fixed or record them as blocked factors. Fresh tasks need independent acceptance review and regression checks. Log all assigned tasks, exclusions, dropouts, infra failures, and cancellations before viewing outcomes. Maintain intention-to-treat reporting; a per-protocol analysis can supplement it. Capture voluntary nonparticipation and missing outcome reasons, given the METR selection lesson.

Use acceptance rate, total cost per accepted task, human review/repair time, and escaped defects as separate outcomes. Predeclare a quality noninferiority margin justified by the use case, minimum meaningful cost reduction, and a sample-size/power calculation using a pilot. A suggested decision rule is: quality lower bound clears the chosen margin, the cost-reduction lower bound clears the predeclared minimum meaningful reduction, and no material harm signal appears in review burden or escaped defects. If intervals are wide, the result is inconclusive. Do not declare success from a nonsignificant quality difference.

Avoid repeatedly checking for significance and stopping on the first favorable batch. Choose a fixed analysis date/sample size or a valid sequential design. Adjust exploratory multiple-detector comparisons or clearly label them exploratory, then confirm promising interventions on new tasks. Run variants across several time blocks to expose model-service and infrastructure variation. Publish negative and inconclusive findings locally alongside positive ones.

## Concrete delivery sequence

1. **Evidence foundation:** audit which adapters preserve terminal status, tool identity, edits, and parent-child links; publish a capability/missingness matrix. Verify the remaining cost-attribution acceptance evidence without duplicating shipped documentation, tier support or scoped discovery handling. Deliver replay fixtures and an evidence schema proposal.
2. **Two conservative findings:** prototype stale-check chronology and unresolved terminal failures, initially JSON-only behind an explicit opt-in. Require evidence references, abstention, negative fixtures, byte stability, and all repository verification gates before shipping.
3. **Recovery and delegation measurements:** extend existing loop/context findings with state evidence, then add child overlap only where ancestry and deduplication are reliable. Do not bundle all these candidates into a universal “waste score.”
4. **Local outcome ledger:** propose a user-supplied task/revision/acceptance sidecar for `compare` and multi-session analysis. Study advice using fresh local tasks before announcing a savings percentage.
5. **Separate prevention decision:** a live warning hook, automatic cancellation, or model router would change aireceipts from a receipt reader into an execution participant. That requires a new architecture spec and explicit maintainer approval; it is not necessary for the initial postmortem/handoff capability. Do not add or modify skills as part of this research.

The highest-value near-term artifact is a receipt that can say: **this failed, this was retried, these edits followed the last check, and this remains unverified in the captured record**. Those observations are useful without pretending to know whether a different model, fewer agents, or fewer tests would have completed the task.
