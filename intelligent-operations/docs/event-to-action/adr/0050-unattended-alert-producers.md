# ADR0050: Unattended alert producers

Status: implemented and accepted live, 23 October 2026, on the kernel producer door (ADR-197). In the
end-to-end run (`deploy/evidence/e2e-live.json`) the firing and resolved alerts both arrived through it.
Closes the unattended-producer part of R07, R08 and R12.

## Context

Every alert in Operations so far reached intake through a person's session: the Sources page,
or the lab drivers acting as the operator. Alertmanager in the lab delivered only to a local
recorder. Event-to-Action needs a monitoring system to deliver alerts with nobody signed in,
without being given a person's credentials, and without widening what an application can do.

## Decision

**The kernel door (ADR-197).** The person issues a producer token for one of their applications,
with a confirmation, much like a peer token (ADR-194). The token is shown once and only its
digest is kept. A producer presents it to the kernel's producer door, which:

- admits the delivery as the token's owner, for that application only;
- forwards the body to one of the application's declared ingest routes;
- applies a body limit;
- refuses revoked tokens and suspended owners.

**The application side (this ADR).**

- `POST /ingest/alertmanager/:sourceId` accepts an Alertmanager webhook body (version 4). Each
  alert becomes one Operations alert envelope: a stable id per fingerprint and status, the
  alert name, severity, firing or resolved state, and the resource. The envelope then goes
  through the same validated intake as a hand-entered event: deduplication, quarantine and a
  processing item.
- The owner maps each source once (`POST /ingest/mapping`): the resource kind, the label that
  carries the resource id (for the lab, `pod_uid`), the scope (the cluster UID) and the severity
  label.
- A delivery for an unmapped source admits nothing. So does a delivery for a source the owner
  does not have, a delivery of more than 100 alerts, or a malformed body.
- A repeated notification of the same firing alert is the same delivery.
- An alert without a resource id is quarantined, not dropped.

Nothing here runs anything. Processing, capture and investigation follow from the admitted
alert exactly as before.

## Guards

`tests/ingest.test.cjs`: mapping, envelope identity, intake through real SQL, deduplication of
repeat notifications, quarantine, and refusals.
