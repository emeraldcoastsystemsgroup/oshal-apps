# ADR0025: Manual workflow step to external issue handoff

Accepted, 21 October 2026; server-readback extension 23 October 2026. Source SQL/browser checks pass; installed acceptance is pending.

Use immutable original-person links to existing Jira, GitLab or ServiceNow records.
The link binds provider identity, the exact selected personal account, endpoint/auth revision and explicit
status:phase mappings. Canonical ticket type, status, phase and revision come from
the existing owner-checked ticket port. The application stores no credential or
caller-selectable URL, header or operation template. At most32 links are admitted
per owner under a serialized SQL capacity guard.

A person reviews the mapped operation, then confirms its push. The application
reserves that exact snapshot plan before dispatch. The browser rechecks current
service realm/account and canonical revision, uses the standard fresh native
confirmation and connector Actions. An already
matching state makes no external write. Lost responses remain held; read-only
reconciliation never authorizes another transition for the same plan. A workflow
can advance during a distributed request; this is a manual snapshot handoff, not
an atomic cross-system transaction or an automatic production subscription.

Native Actions provides credential/owner/tier/marketplace admission and protected
endpoint binding. After the person's confirmed write, the package asks the kernel's
`connector.read` port for the frozen issue using the saved personal account and
`expectedTargetRevision`. The kernel refuses a changed service realm before provider
I/O. The package stores only the bounded observed state, observation time, digest and
fixed read operation. `verifiedByServer=true` means that remote state was observed
by the server; `writeDeliveryVerifiedByServer=false` remains explicit. A refused or
unavailable read leaves the held attempt unchanged. An operator report cannot
overwrite a server observation. Neither a browser report nor a matching remote
state proves this particular write caused it, changes canonical status or inflates
recovery metrics. Unattended reconciliation and provider webhooks remain separate
work. Declared one-way mappings do not imply webhook verification,
bidirectional changes, comments, conflict resolution or echo suppression.

The UI includes Jira transition discovery, phase/status mapping controls, saved-link
review, held attempts and read-only reconciliation. GitLab uses numeric project
and issue IDs with close/reopen; ServiceNow uses an explicit state value and its
expected displayed value. No default state numbers are guessed. Splunk On-Call
needs reviewed credential handling; GitHub status handoff is not added here.

Proof: actual SQL forced-owner isolation, concurrent reservations, lost commit
acknowledgement, bounded link capacity and stale revision rejection. Actual shipped
browser tests exercise native-API seams for review/confirm/server-readback, lost provider
response without duplicate write and withdrawal during final refresh. These are
isolated fixtures; no external issue was changed. Core ADR187 separately proves
fixed provider transport over actual owned TLS through native Actions; core ADR196
defines the package's read-only port and saved service-revision pin.

Named account selection is passed as the standard Actions account query and enforced by the kernel selection ladder, including its connection tier and original owner. A kernel without advertised named-account support is refused before dispatch; a UI preflight alone is not account binding.
