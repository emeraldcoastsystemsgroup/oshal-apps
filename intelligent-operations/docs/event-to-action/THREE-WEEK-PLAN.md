# TriageNorth: three weeks to a convincing demonstration

Planning horizon supplied by the operator: three weeks. Weeks are relative to this
revision; the exact submission date is not confirmed. This is the prioritized
hackathon slice of PROJECT-PLAN.md, not a claim that all product scope fits in it.

The demonstration should let a reviewer replay an incident, see the noise shrink,
inspect connected resources, read the supporting evidence and authorize a specific
response. The business case is measured investigation effort and controlled action.
Visual polish should make those decisions easier to follow.

The operator's immediate build priority is **Systems**, using the existing
signed-in user's inventory and graph records. Kubernetes is its first lens:
cluster/node/workload/pod/container/service observations, source/time, health and
links to existing event decisions. Other observed system providers use the same
view. This is a projection of already admitted records, not a new collector, login
or broad cluster credential. Application scope comes from the verified session;
browser filters never establish authorization. The local native runtime is resumed; recorded observations still retain their
original times and do not become current health because the portal is running.

## Delivery sequence

| Week | Work | Exit evidence |
|---|---|---|
| 1: useful inspection and credible detection | Deliver Systems over existing user-owned inventory, then exercise its investigation journey. Finish the host/node/startup resource profile. Prepare immutable dataset replays and expected rule matches. Establish threshold, rolling median/MAD and EWMA baselines; add a seasonal baseline if the controls require it. Once runtime work resumes, exercise the existing real percolator through its standard relay. | An operator can find an affected resource and follow its recorded relationships and alerts. Reproducible data hashes, frozen splits/rules, explicit invalid-data decisions, per-rule precision/recall and anomaly-window results. No memory-limit violation; incomplete backend searches remain failures. |
| 2: evidence and economical analysis | Connect post-reduction correlation and conditional evidence consumption to the canonical workflow. Compare a deterministic report with two small local model candidates. Produce a workflow-owned remediation bundle and bind approval to the exact artifact and target. Select one external ticket integration using its standard connector. | One incident traced from input to packet, report and script; evidence citations, actual artifact handles, authorization denials and retry/reconciliation receipts. Measure model quality, latency, memory and calls avoided. |
| 3: experience and submission | Complete one bounded approved action and observed recovery. Add replay controls, an isometric estate view, the visible processing funnel and evidence-to-action timeline. Rehearse the live journey and a clearly labeled recorded fallback. Build the pitch deck and refresh Word/PDF/Visio exports. | A repeatable five-minute demonstration, matching results sheet, readable deck, current documentation and explicit limitations. Normal publication and installation gates pass before calling the release complete. |

Prioritize one complete incident path over breadth. All four ticket systems,
production cloud discovery and generalized predictive maintenance remain product
scope; the hackathon must identify which integration and detector actually ran.
If a week exits with an unfinished gate, keep that visible and reduce optional
visual/model work before weakening evidence or approval requirements.

## Functionality through repeated troubleshooting

Treat every improvement as a short cycle: define the user's investigation task,
reproduce the failure, capture the evidence, fix the smallest relevant behavior,
keep the regression test and rerun the original scenario. Preserve the existing
identity, workflow, connector and ticket services as the backbone. Build at the
application boundary unless a reproduced failure requires a foundation correction.

The first [Systems increment](SYSTEMS.md) is committed in source with twelve
focused checks. It is now installed/published; a separate Systems-specific live two-user browser
acceptance remains open. The sequence
below adds depth across environments without pretending that fixtures are live
cloud connections. Fault injection uses disposable, explicitly scoped targets
only after the resource/runtime gate is satisfied, one environment at a time.

| Scenario | Environment | What the user must be able to establish | Current evidence / next test |
|---|---|---|---|
| Same resource name, different identity | Multiple cluster scopes and cloud provider records | Correct asset and related alerts without cross-system merging | Systems fixtures pass; two real user accounts and distinct scans await runtime acceptance. |
| Pod readiness failure, restart or bad image | Disposable local Kubernetes namespace | Affected pod/container, image, owner and placement at the observation time; exact evidence behind diagnosis | Recorded fields render in fixtures; live fault → alert → investigation sequence remains open. |
| Scale down, replacement or rescheduling | Disposable Kubernetes workload | Old and new UIDs and time-specific placement; no attribution to the wrong replacement | Add before/failure/recovery scan sequence and incident association assertions. |
| Partial scan, stale data or revoked access | Kubernetes and provider-import fixtures | Unknown or partial state stays visible; stale relationships do not prove current health; withdrawn data clears | Partial-state and controller-refusal fixtures pass; collector timeout/RBAC and live session withdrawal remain open. |
| Repeated alert, reordered delivery, escalation | Named-source replay | Which events matched, which were suppressed, and which distinct incident survived | Native 100→40→4→2 dependency replay and saved cohorts pass. Add escalation/reordering and producer admission. |
| Drift, flatline, spike and normal daily pattern | Pinned metric datasets | Detection delay, false alarms, missed windows and warm-up without label leakage | Four-series pilot prepared; NAB statistical/anomaly evaluation has not run. The separate BGL severity/percolation baseline is measured. |
| Related host/service/cloud failure | Sanitized provider/host records, then one admitted environment | Source, native scope, relationship evidence and missing data | Generic Systems projection exists; no new live cloud scanner claimed. |
| Integration timeout, retry or concurrent ticket edit | One disposable external ticket account | Reconciled external identity and revision; no duplicate ticket or silent overwrite | Standard connector capability and live acceptance remain prerequisites. |
| Changed script, denied action or failed recovery | Isolated workflow workspace and registered target | Exact artifact approval, refusal when it changes, and a postcheck that can leave work open | Workflow-generated remediation and execution acceptance remain open. |

Keep a failure record with scenario ID, environment and source revisions, expected
and observed behavior, evidence handles, contributing cause, fix commit, regression
case and rerun result. Record unknown causes as unknown. A fix is complete only
when the original failure and relevant refusal cases pass; a more attractive
screen alone is not a closed defect. Track time to find the resource, assemble
evidence and reach a correct decision, alongside missed incidents and false alarms.

Review this evidence at each week's exit. Put broken investigation paths ahead
of extra model or visualization features. Carry unresolved failures into the
next week with their reproducible input and explicit acceptance condition.

## Datasets and provenance

The initial pilot uses four small series from the
[Numenta Anomaly Benchmark](https://github.com/numenta/NAB): two recorded cloud
series plus daily-pattern and flatline controls. Its
[data description](https://github.com/numenta/NAB/blob/master/data/README.md)
distinguishes recorded data from artificial controls. Original CSVs, anomaly
windows and the upstream license notice are kept in a separate local cache.
[evaluation-data.json](evaluation-data.json) records the immutable revision, URLs,
SHA-256 digests, byte counts, rows and timestamp-quality observations. Dataset
preparation has run; detector, percolator and model benchmarking have not.

Prepared pilot: 30,146 observations; 923,051 bytes including seven data/metadata
files. The CPU/autoscaling series has one labeled anomaly window and the EC2
failure series has three; the two artificial controls have none. The EC2 series
contains 11 adjacent repeated timestamps, retained unchanged. Preparation used the
enforced 25%-of-one-core/256-MiB scope and peaked at about 15.1 MiB of scope memory.
These are data-quality observations, not detector results.

| Input | Intended test | Boundary |
|---|---|---|
| NAB CPU/autoscaling misconfiguration series | Sustained shift, warm-up and detection delay | Historical external metric series, not this host's CPU or a new pressure test. |
| NAB EC2 failure series | Failure-associated change and detection timing | Preserve the upstream name. Confirm metric units before labeling charts or applying absolute thresholds. |
| NAB artificial daily-pattern and flatline controls | Seasonality and false positives on normal or constant data | Explicitly synthetic; never mixed into a real-fault count. |
| Existing sanitized local Alertmanager firing/resolved samples | Named source mapping, percolation, duplicate occurrence and incident replay | Existing lab evidence; replays carry a distinct run/source identity and original observation time. |
| New bounded local fault receipts, once allowed | Actual topology, disappearing containers, evidence capture and recovery | Required for end-to-end claims; public univariate datasets cannot prove causal graph accuracy. |

[Loghub](https://github.com/logpai/loghub) offers labeled system-log candidates,
including BGL and HDFS. Its [notice](https://github.com/logpai/loghub/blob/master/LICENSE)
specifies research/academic availability and retained attribution. Keep it an
optional internal research corpus; it is not included in the product or submission
bundle by this plan. The first demo can use our own sanitized lab logs.

Preserve raw bytes and row IDs. Record parsing failures, duplicate timestamps,
late samples, missing values and any derived ordering separately. Missing source
timezone or unit information stays unknown until an explicit mapping supplies it.
Do not silently repair the original evidence. NAB does not supply a Kubernetes
asset graph: any illustrative graph attached to a replay must be labeled separately.

## Three distinct evaluations

**Percolation:** freeze a rule generation and independently reviewed expected
match IDs for the normalized replay. Execute the actual OpenSearch backend;
report correct/incorrect matches per rule, unmatched inputs, errors, p50/p95
latency and events per second at stated concurrency and resource limits. Test
disabled rules, multiple result pages, schema errors and partial backend failure.
The [OpenSearch contract](https://docs.opensearch.org/latest/query-dsl/specialized/percolate/)
matches incoming documents against stored queries. It does not learn an anomaly
baseline. Existing immutable publication and failure semantics remain unchanged.

**Anomalies:** begin with inexpensive statistical comparators. Use chronological
development/calibration/evaluation partitions with a gap covering the longest
lookback; never shuffle future observations into the past. Keep labels out of
detector inputs and out of the local model prompt. Score before updating a baseline
with the current observation. Freeze parameters before evaluation. A four-series
pilot checks the machinery; expand to additional untouched series before claiming
general quality. Report detected/missed anomaly windows, alerts outside windows
per observed day, time to first detection, coverage, warm-up, missing/late-sample
handling and runtime cost. Do not call custom metrics an official NAB score or
point-adjust a whole window into perfect point-level recall.

**Reduction and correlation:** independently measure delivery retries, repeated
symptom suppression, incorrect merges, incident recall and correlation evidence.
Keep the denominator visible at every stage. An impressive suppression percentage
fails acceptance if it drops a real incident. Required edge cases include identical
text from different sources/assets, severity escalation, pod replacement, stale
relationships, shared hubs and resolved events that do not prove recovery.

Initial success gates are deterministic replay, no loss of an expected fixture
incident, no cross-source/asset merge in adversarial fixtures, and a complete receipt
for every decision. Report statistical quality honestly; choose numeric product
targets on calibration data, freeze them, then evaluate on the untouched holdout.

## Small local models with a bounded job

Compare a deterministic template with official GGUF candidates
[Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF) and
[Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF). These are evaluation
candidates, not selected production dependencies. Pin the actual quantized file,
model revision, license, prompt, runtime and hashes before running. No model weights
have been downloaded and no local inference service has been started.

There are two useful jobs:

1. Offline adapter assistance: suggest a mapping or parser from a small redacted
   sample; review it and deploy deterministic rules. Do not add an LLM call to
   every incoming event.
2. After reduction: extract a short structured incident summary, group recurring
   messages and explain the bounded evidence packet with item references. Keep
   original observations available beside every derived statement.

The model cannot change authoritative source/asset IDs, timestamps, measured
values, detector scores, severity or decisions. Unsupported facts become unknown;
schema-invalid or truncated output is rejected. Log text is data, including text
that looks like instructions. No shell, cluster credentials or execution tools are
available to this preprocessing step. These rules extend the existing isolated
worker contract, not a new connection or identity framework.

For a later authorized pilot, propose one CPU-only process, one inference thread,
one request at a time, a 2,048-token context and at most 256 output tokens. Start
with a 25%-of-one-core quota, nice level 15, a 3-GiB hard memory cap, no swap and a
60-second request deadline. These are proposed ceilings, not measured sizing or
permission to launch. Charge them to the full host profile first; do not increase
them automatically after a timeout. Use a CPU-only runtime build and no GPU device
access. The [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
documents thread, device, offload and concurrency controls; verify pinned flags and
effective isolation before execution, rather than relying on automatic defaults.

Evaluate the same redacted packets across the template and candidate models.
Measure valid structured outputs, field accuracy, evidence-reference validity,
unsupported statements, appropriate abstention, p50/p95 latency, peak RAM and
CPU-seconds per accepted packet. A valid reference alone does not establish that
the cited item supports the statement; manually review the held-out set. Compare
total cost per accepted incident, including retries, human review and hosted calls
avoided. Local inference is a cost hypothesis, not a free or proven-better service.

## Visual impact that explains the system

- **Replay desk:** select a labeled scenario, pause, step through time and compare
  before/failure/recovery. Distinguish recorded replay from current live intake.
- **Processing wall:** show input, matched, suppressed, correlated and investigated
  counts from the same durable cohort. Selecting a stage opens its actual decisions.
- **Estate view:** an isometric SVG layout gives nodes visual depth and groups
  cluster, node, workload and service. A time slider and selected incident show
  affected paths and evidence freshness. This is a 2.5D view, not delivered true 3D.
  Keep the accessible 2D graph/table. GPU/WebGL rendering is outside the current
  no-GPU constraint; no rendering work starts in this increment.
- **Evidence-to-action timeline:** selected source observations lead to an evidence
  packet, workflow report, proposed script, exact approval and post-action check.
  Unavailable or inferred relationships look different from observed ones.
- **Results card:** show measured reduction, missed incidents, false positives,
  investigation latency and model cost assumptions. Never fill missing measurements
  with attractive invented figures.

## Presentation and value statement

Build a concise deck: operational problem; product promise; inherited platform
boundary; pipeline; topology/evidence experience; benchmark method and measured
results; bounded AI analysis; approved response; cost/pilot case; next steps and
limitations. Use one incident throughout. Add a five-minute presenter script and
backup recording with its recording time. Refresh the value brief, proposal,
project plan and decision log in Word/PDF and the editable Visio drawing together.

Value statement: **TriageNorth converts noisy infrastructure signals into traceable
investigations and controlled responses, helping support teams spend less effort
assembling evidence while keeping authority and accountability visible.** Time and
cost savings remain pilot measurements, not a promised percentage.

## Present execution boundary

Dataset preparation and documentation can proceed within small CPU/memory limits.
The existing small-check authorization does not start Docker, Kubernetes, OpenSearch,
local inference, browsers or renderers. Full resource-profile completion and runtime
resumption remain prerequisites in ADR0017. Public dataset preparation is not a
passing anomaly benchmark, running pipeline, finished presentation or self-healing
claim. ADR0018 records these evaluation boundaries.

## 21 October checkpoint

Delivered ahead of the original sequence: exact-source retained context with three
protected banks and safe bounded growth; actual 15-minute reuse/packet survival;
standard Collector syslog/metric transport; native host/cloud dependency replay and
saved results; 8,000 sampled raw log lines plus metric controls; BGL severity baseline;
eight-slide PowerPoint and regenerated Word/PDF/14-page Visio exports. Native replay
is synthetic and accurately labeled. BGL baseline precision is 35.48% with 260 false
positives, so it is a starting point rather than a production detector claim.

The next product priority remains one automatic evidence-to-ticket/workflow path
with actual generated remediation artifacts, followed by exact approval/execution
and recovery acceptance. Permanent producers, calibrated anomaly evaluation and
cloud/provider integrations keep their separate gates. No paid cloud lab is created.
