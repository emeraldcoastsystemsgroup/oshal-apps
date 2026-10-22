# Jarvis-to-Jarvis change promotion roadmap

Proposed delivery scope, 21 October 2026. Not implemented or enabled by this plan.

TriageNorth should turn an observed production issue into a reproducible, reviewed
change. GitHub and GitLab connections belong in the standard user-bound connection
framework. A workstation's Git login is not the portal's authorization. Existing
external ticket synchronization does not establish permission to write repository
content, open a pull request, merge, or deploy.

The upper swarm owns the operational incident and the target environment. Its
Jarvis delegates a defined investigation to a lower development or test swarm's
Jarvis. “Upper” and “lower” describe environment and promotion responsibility;
they do not imply that all administrators or all child tasks inherit authority.
An upper swarm with a fault must remain recoverable through a separate control
plane and lower environment; it must not be required to repair itself first.

## Intended operator experience

1. Open an incident and its sealed evidence packet. Select the connected repository,
   target environment, approved lower swarm, branch baseline and allowed operations.
2. Review a delegation card: original requester, affected resources, sanitized
   evidence, task deadline, token/cost ceiling and proposed acceptance checks.
3. Lower Jarvis creates a linked child ticket, reproduces the issue and proposes a
   branch and pull/merge request. Its workflow generates scripts and artifacts in
   the standard shared workspace. The agent receives the selected packet and
   explicitly granted tools; it does not browse the upper cluster freely.
4. See reproduction, patch, CI, security checks and lower-environment verification
   on one parent/child evidence chain. An unproven cause remains an unproven cause.
5. Upper Jarvis presents the exact commit, artifact digest, test results, deployment
   plan, rollback target and remaining uncertainty for the configured approval.
6. Promote that tested artifact after current permission and environment checks.
   Record health verification, rollback if required, and synchronize linked ticket
   status through the selected connector's established field mapping.

## Proposed communication contract

Use a versioned delegation envelope over the registered swarm/node communication
boundary, rather than treating a chat message as authority. Each request names:
original user and tenant, parent/child ticket IDs, delegation ID, sender/receiver
swarm IDs, workflow revision, repository/ref and environment scope, immutable
input digests, allowed tool operations, deadline, maximum hops and resource budget.
Only necessary evidence crosses the boundary; credentials remain with their
owning environment. Tool execution rechecks current authorization.

Return a durable result envelope with the same delegation ID, exact commit and
build digests, evidence/artifact references, test receipts, observations, proposed
rollback and explicit success/failure/unknown state. Correlate parent and child
activity without merging their identities. Durable inbox/outbox records and
idempotency keys prevent duplicate work and promotion. Cancellation, expiry,
revocation, stale source revisions and uncertain network outcomes hold the task
for reconciliation. A child result never grants deployment authority.

## Delivery sequence and dependencies

| Item | Deliverable | Done when |
|---|---|---|
| H1 — Git connection | User-bound GitHub/GitLab repository selection and operation grants; branch/PR/MR links in the incident | Original-user read/write scopes verified; revoked or wrong-repository access refused; no reliance on operator CLI credentials |
| H2 — Delegation | Registered Jarvis endpoints, versioned envelopes, linked tickets, durable bounded delivery | Two isolated swarms exchange a task/result; duplicates, expiry, cancellation, wrong tenant and lost acknowledgements are exercised |
| H3 — Lower validation | Reproduction scenario, workspace-generated patch/scripts, CI and test-environment verification | A seeded lab incident reproduces, fails before the patch and passes after it; all receipts name the same commit/artifact |
| H4 — Promotion | Exact-change approval, deployment receipt, health check and rollback | Red CI, changed patch, withdrawn permission or stale approval prevents deployment; rollback restores the previous known artifact |
| H5 — Recovery | Independent recovery entry point and bounded hierarchy | Upper Jarvis outage does not erase incident/delegation state; a separately authorized recovery workflow can restore it; hop/budget limits terminate cycles |

Dependencies: standard connections/vault and granular grants; registered swarm
identities and enrollment; canonical workflow/tickets; shared workspace artifacts;
CI/build attestations; environment-specific deploy/rollback adapters; durable
transport and audit receipts. Protocol and authority gaps belong in reusable
platform services. TriageNorth owns incident policy, evidence presentation,
repository/environment selection and the promotion experience.

For the hackathon, demonstrate two isolated lab environments and one reviewed
promotion. Do not describe a single local swarm, a mocked exchange, ticket sync,
or a successful lower test as a deployed hierarchy. Production auto-remediation
requires an explicit policy for that action; otherwise the promotion gate remains
human approval. No new remote writes or cloud provisioning occur from this roadmap.

## Response-policy extension

[ADR0031](adr/0031-response-paths-and-verification-branch.md) and the [four-screen response design](RESPONSE-PATH-DESIGN.md) add paired mitigation/permanent repair, emergency runtime patches, expedited Git hotfixes and a bounded verification branch. These are proposed paths, not deployed capabilities.
