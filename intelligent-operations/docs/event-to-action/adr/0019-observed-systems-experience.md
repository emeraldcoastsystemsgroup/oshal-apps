# ADR 0019: Systems over the current user's observed inventory

Status: First source increment implemented and tested on 21 October 2026.
Publication, deployment and browser acceptance are pending. Extends ADR0004,
ADR0009 and ADR0013; runtime work remains subject to ADR0017.

## Decision

Build the requested Kubernetes/systems inspection experience as a projection of
the existing user-scoped temporal graph and event page. Reuse the admitted session,
topology and record APIs. Preserve the existing estate toolbar identity and point
its Systems label at the new view; detailed topology remains linked inside it.

Filter by provider/scope, namespace, resource kind and observed health. Retain
native identity and capture time on every resource. Use recorded graph edges for
placement and ownership, and exact unambiguous resource identity for related
events. Keep unknown health, partial collection and bounded results visible.
An identity match is not a causal diagnosis or evidence of recovery.

## Reason and consequences

The operator wants useful inspection without duplicating data already entering
the application. A second collector, local credential store or privileged shell
would add a new boundary without improving this first inventory journey. Those
are excluded from this increment; future scoped diagnostic operations must use
the standard connection and tool framework.

The existing graph and latest event page limit coverage. Source freshness and
missing observations remain visible; this view does not imply continuous collection
or live cloud discovery. Data and authorization failures clear the new view rather
than leaving apparently current records on screen.

## Acceptance

Source `1e7141f1` implements the view and twelve focused behavioral tests, including
the actual controller's refusal and late-response handling. See [Systems](../SYSTEMS.md)
for the implemented journey, limits and pending browser/server checks. Measured
investigation time and collection overhead belong in the pilot; no commercial
savings percentage follows from adding the view.
