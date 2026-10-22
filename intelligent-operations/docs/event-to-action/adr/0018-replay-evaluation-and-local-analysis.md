# ADR 0018: Replay evaluation and bounded local text analysis

Status: Evaluation design recorded following the operator's three-week improvement
request. Dataset preparation, a measured BGL percolation baseline and native synthetic
replay are implemented. NAB anomaly evaluation and model selection remain pending.
Extends ADR0007, ADR0010 and ADR0017.

## Decision

Use versioned, hash-identified datasets and frozen replay manifests to evaluate
percolation, anomaly detection and reduction/correlation separately. Preserve the
original inputs and record transformations. Keep labels outside detector/model
inputs and calibration separate from untouched evaluation data. Historical external
metrics do not supply or validate the local Kubernetes topology.

Retain actual OpenSearch percolation behind the existing engine relay. Benchmark
statistical anomaly baselines separately, then feed detector candidates into the
normal alert/filter/reduction path. Thresholds, rules and labels must not be
silently adjusted to improve holdout results. Partial backend failures remain
failed evaluations, never no-match results.

Evaluate a deterministic summary against small local model candidates for offline
mapping assistance and post-reduction evidence summarization. Inbound processing
keeps its deterministic identity/format contract and durable reductions before
expensive investigation. Model output cannot rewrite authoritative measurements,
identity, severity, decisions or labels. It has no execution authority. All runtime
model use goes through existing admitted framework provider/worker facilities.

Use existing source/provenance and temporal graph projections for a replay desk,
stage counts and an isometric SVG estate view. The latter is a visual-depth design,
not a true 3D implementation claim. Keep accessible 2D navigation and explicit
observed/inferred/unknown and historical/live distinctions. No GPU rendering or
inference is authorized by this decision.

## Rationale and alternatives

Dataset replay makes incorrect filtering, missed incidents and false alarms
measurable before a polished presentation hides them. Lightweight statistical
baselines establish whether additional model complexity earns its resource cost.
Reject an LLM call for every raw event, label-assisted evaluation, destructive
rewriting of original logs, fabricated topology and local-cost claims without
memory, latency, retry and review measurements.

## Acceptance and consequences

THREE-WEEK-PLAN.md owns the ordered work, scorecards, dataset sources, candidate
models and proposed bounded inference profile. evaluation-data.json records the
prepared upstream pilot and explicitly records no detector/percolator/model run.
Normal Store checks remain required before publication. Binary exports and the
PowerPoint deck remain separately tracked deliverables; adding this ADR does not
make them current or complete. Full runtime acceptance remains subject to ADR0017.
