# ADR0037: Approved response, isolated execution and verified recovery

Status: implemented in source, 22 October 2026; SQL and shipped-browser guards pass; installed
acceptance on the owned lab is recorded separately in IMPLEMENTATION-STATUS.md. Extends ADR0011,
ADR0023, ADR0025, ADR0031 and ADR0034.

The response stage closes the gap between an accepted report and a measured recovery without
adding cluster authority to any bot or package service.

**Generated files are extracted byte-exact, never invented.** The workflow's accepted answer
(the revise phase's actual `answer.md` work artifact) names its response files as fenced blocks
whose info string is `file=NAME`: `remediate.sh`, `verify.sh`, `rollback.md`, `verify.md`
(optional `diagnose.sh`). The package stores those bytes with SHA-256 digests, byte ranges,
the producing ticket, work record, phase and answer digest. The answer bytes reach the package
through the operator's browser from the canonical work read, so the record is labeled
`answerProvenance: operator-forwarded-canonical-work`; the kernel has no package port for work
reads or artifact registration. Prose is not parsed into files; a missing file, a duplicate, an
oversize script or a `remediate.sh` without a preceding "approval required" statement makes
the answer non-executable, and the UI says so.

**A plan binds one observed target.** The target pod is accepted only when the caller's own
recorded inventory (the temporal graph) has observed its UID and name; namespace and container
are explicit. The plan identity is the digest of ticket, canonical revision, work record,
answer digest, artifacts and target. The exec input is fixed at plan time:
`/bin/sh -eu -c <remediate.sh>` inside that container, which keeps the executor within the
namespace-scoped pod exec RBAC the standard pod-connect installer grants.

**Approval binds principal, digests, target, revision and expiry.** An approval is recorded by
the signed-in person against the plan's artifact digests, target and canonical ticket revision
and expires after thirty minutes. A changed revision or digest refuses approval and dispatch
before anything runs. Report acceptance remains a separate canonical gate (ADR0011).

**One dispatch per approval, reserved before the native action.** Reservation precedes the
browser's fresh native confirmation and `kubernetes-exec` through the person's own Kubernetes
connection (ADR0034). Twelve concurrent callers reserve once; a lost commit acknowledgement
leaves the reservation in place and refuses a second dispatch. The pre-dispatch identity readback
must return the same pod UID. The action result the browser reports is stored as an operator
report (`verifiedByServer: false`); it never changes canonical status or counts as recovery.

**Recovery is measured, with four outcomes (ADR0031).** A verification is a reserved read-only
exec of `verify.sh` plus a current pod readback. `regressed` when the check fails, `inconclusive`
when its outcome is unknown, the identity differs or no resolved signal exists yet, `timed-out`
after fifteen minutes without one, and `healthy` only when the check passes, the identity
matches and a validated `resolved` delivery for the same resource (and alert type, when the plan
is linked to an investigation) was admitted after the action. The signal half is read by the
server from the caller's own deliveries. Up to ten verifications per execution.

**The ticket update is server-read.** After a healthy outcome the browser approves the canonical
report gate with a fresh confirmation; the package then re-reads the ticket through its ticket
port and records status and revision as `verifiedByServer: true`. External issue handoff stays
the manual snapshot flow of ADR0025.

**Downloads.** Every artifact and the execution receipt are authenticated own-scope downloads
with `Content-Disposition: attachment` and the digest in a response header. They are package
records, not kernel ticket-workspace artifacts: the kernel materializes only worker results.

Alternatives rejected: parsing prose or supplied lab proposals into files; a package-held cluster
credential or kubectl executor; approval without expiry or digest binding; counting command exit
as recovery; automatic re-dispatch after an unknown outcome; changing canonical status from a
client report.

Proof: `tests/execution.test.cjs` (real PostgreSQL forced-owner isolation, concurrent and
lost-acknowledgement reservations, expiry and revision invalidation, outcome rules with firing
versus resolved deliveries, server-read ticket update, and the shipped panel against explicit
native confirmation/exec/approve fixtures).
