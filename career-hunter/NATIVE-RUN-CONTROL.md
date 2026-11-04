# Native Career engine run control

Manual scoring acknowledges a retained original-owner run before returning HTTP
202. `GET /api/career-hunter/runs` reports that owner's active runs, recent stopped
receipts and the separately persisted manual-score success receipt. Match the
exact acknowledged run ID; an unidentified active run does not identify its task.

The native cancellation control is
`POST /api/career-hunter/_runtime/runs/{runId}/cancel`. Send `{}`, or the same
`runId` as the path. The source catalog binds it to `career.change`. The framework
checks the current admitted writer and package source, then handles this reserved
control before opening an owner-file writer. It executes no package handler, SQL
or file mutation. Another owner's run and a missing run both answer HTTP 404.

HTTP 202 with `state: cancelling` means a stop was requested. It does not prove
the process stopped. The sandbox's liveness fence ends the process, discards the
unpublished Career generation, releases the file lock and retires captured work.
Only then does run status report `state: cancelled`. A repeated stop reads that
receipt instead of reissuing work. Final publication and cancellation use one
atomic state transition; once publication begins, cancellation answers HTTP 409
with `state: finishing`, and the caller must check the saved result.

Stopped receipts retain no output or applicant content. They are limited to 256
entries per kernel, expire after 30 minutes and do not survive a kernel restart.
Missing or expired evidence is unconfirmed. The successful manual-score receipt
is independently durable in the original owner's published generation.

Settings offers Stop scoring only for the exact accepted score run while native
status says cancellation is available. The tab keeps a bounded acknowledgement
and resumes status polling after reload without starting another task. Cached ids
are not authority: a stale id cannot select or stop another current run. Jarvis
uses the same reserved API and must
read the matching stopped receipt before reporting cancellation. Older kernels
keep the stop control hidden. The legacy process-tree handler remains available
on legacy hosts; it cannot bypass a native owner's active writer lock.

Stopping an engine task does not withdraw an employer application or undo an
already published result. Employer submission approval, cancellation and recovery
remain separate operations described in [NATIVE-SUBMISSION.md](NATIVE-SUBMISSION.md).

The native unit and real sandbox fixtures exercise original-owner isolation,
request versus stopped states, publication races, discarded staged files and
writer-lock release without sending employer applications or using applicant
profiles. Installed acceptance is required after native activation.
