# ADR0038: Local anomaly service, automatic correlation and tick notifications

Status: implemented in source, 22 October 2026; SQL and detector guards pass; NAB pilot receipt
recorded in `deploy/evidence/anomaly-nab.json`. Extends ADR0007, ADR0014, ADR0018 and ADR0020.

**A real detector, local and explicit.** Two deterministic statistical detectors ship in the
package (`ui/anomaly-detector.js`, shared by the server tick and the offline evaluation): a rolling
robust z-score (median and MAD over the last N samples) and a seasonal time-of-day profile
(per-bucket median and MAD). Each new metric sample is scored against the baseline learned from
earlier samples only, then learned from unless it was anomalous. Readiness is explicit per resource
and metric: cold (warm-up), ready, stale (gap larger than the configured cadence budget, which
restarts the rolling baseline), late (older than the cursor, counted and skipped), invalid, failed.
No imported or rescored external result is counted as detection.

**Candidates are source alerts.** A candidate is admitted through the normal intake under a
dedicated alert source revision the operator chooses: `alertType = anomaly:<detector>:<metric>`,
status firing or resolved, severity by score, and the raw payload carries detector id/version,
window, baseline, score, confidence, readiness and the telemetry observation id. Candidates then
pass the same percolation rules and symptom reduction as any source alert, so a published policy
for the candidate source decides what becomes work.

**Durable, idempotent processing.** Detector state lives in `operations_anomaly_state`: the
configuration (compare-and-set), one compound cursor per telemetry source `(observed_at, id)`
locked for update per pass, and bounded baselines (at most 500 per person, at most 2000 samples per
rolling window, 64 per seasonal bucket). A pass reads at most 500 samples per source in cursor order,
admits candidates (idempotent by candidate id), and advances the cursor only after every admit of
the batch succeeded; a failure keeps the cursor, records the error on it, and the next tick retries.
Two concurrent replicas cannot both admit the same candidate.

**Automatic post-reduction correlation.** When the processing worker opts in, each scheduled tick
that admitted or escalated a symptom correlates the admitted firing cohort of the policy window
over the recorded temporal graph with a bounded versioned dependency policy. The cohort's newest
alert time keys the record, so an unchanged cohort is idempotent; events without a recorded asset
stay explicitly unresolved; nothing is dispatched.

**Tick notifications.** After each tick the package asks the kernel notification rail
(`uses: notify.send`) to tell the signed-in person about admitted symptoms, candidates and
failures. The rail chooses the channel from the person's preferences and may skip silently, so the
tick reports a request, never delivery.

**Measured, not tuned.** `lab/nab_evaluate.cjs` evaluates both detectors on the pinned NAB pilot:
a-priori parameters on whole series, and parameters calibrated on the first 30% of each series
with labels unread, evaluated on the remainder after a one-lookback gap. The receipt reports
detected and missed windows, first-detection lead time, alerts outside windows per observed day,
warm-up and runtime, and says it is not an official NAB score. The a-priori run detects every
labelled window with zero false alerts on both controls for the seasonal profile, but about twenty
alerts a day on the noisy CPU series; the calibrated run brings that to below one a day at the cost
of the EC2 latency windows and a much longer lead time. Both are recorded; neither is hidden.

Alternatives rejected: threshold rules presented as anomaly detection; importing archived detector
results; a cursor by timestamp only; learning from anomalous samples; silently advancing past a
failed admit; counting a notification request as delivery.
