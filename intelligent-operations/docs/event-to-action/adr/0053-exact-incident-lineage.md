# ADR 0053 — Exact, bounded incident lineage by canonical ticket

Status: installed and accepted on the native lab for exact ticket lineage and an automatically correlated future ticket (`../../../deploy/evidence/incident-trace-exact-live.json`, `../../../deploy/evidence/incident-correlation-live.json`).

## Context

The Incident work trace originally joined six recent-list endpoints in the browser. A legitimate older decision or graph cohort disappears from a 200-record page as traffic accumulates; a missing row in that page cannot distinguish absence from rollover. The recovered CPU-pressure ticket already demonstrated this limit. The operator needs to reopen a ticket and see its actual alert, reduction, correlation, packet, generated files and handoff, even after newer alerts arrive.

## Decision

The browser makes one authenticated `GET /incidents/:ticketId/trace` read. The package first asks the native ticket port for that canonical Operations ticket. It then queries durable records under the original caller's `user_sub`, following exact ticket, investigation, delivery, reservation, plan and external-link IDs. Ticket, plan, decision and link expression indexes, the delivery ID column index and a GIN index for recorded cohort delivery IDs support those joins. The response projects existing records without creating a second ticket state or modifying any workflow. It includes each linked set's 20-record cap, with 100-record caps for approvals, executions and handoff attempts. The UI distinguishes an exact empty set from an unavailable or truncated set and preserves provenance labels for operator-reported actions and provider readback.

The endpoint is read-only under the application's `app.open` grant for GET and HEAD. A malformed ticket ID and a ticket outside the current caller's canonical Operations scope are refused. PostgreSQL owner policies remain forced, and every query also includes the caller's `user_sub`; the route never accepts a client-supplied owner.

## Installed correlation acceptance

The owned lab enabled automatic correlation at processing revision 19, created one bounded CPU-pressure Job and let the personal schedule handle its Alertmanager delivery. Ticket `fc5a5443-1ae8-4d6c-a83f-68b3996e6b92` has an exact alert, admitted decision, packet and stored correlation ID joined by its delivery; the signed-in Incident work browser reopened all four. The correlation has one group but status `degraded` and method `exact-asset-fallback` because one graph coverage problem was recorded. The view and scheduled-tick receipt now use that stored status instead of inferring coverage from obsolete `degraded`/`fallback` booleans. The pressure Job was removed and no approval or execution was recorded at the recheck. This is a live correlation path, not proof of a complete dependency graph for that alert.

## Limits and follow-ups

One ticket can still exceed an exact set cap, in which case the view names the cap rather than implying absence. The native ticket port's own read authorization is part of this boundary. Linked source rows that were never recorded or have been deleted remain unavailable; the trace does not infer them from timestamps or resource names. Exact lineage improves the operator's evidence view; it does not implement server-verified external ticket synchronization or Workflow Studio phase lineage.
