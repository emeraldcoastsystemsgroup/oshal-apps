# ADR 0001: Operations is an OSHAL experience slice

Status: Accepted design, 20 October 2026. Implementation and installed acceptance remain tracked separately.

Context: The application should feel complete and focused while reusing OSHAL login, granular grants,
connections, tickets, tools, approvals and audit. A separate authentication or connection framework
would fragment user authority and duplicate shared behavior.

Decision: Evolve the existing intelligent-operations package into an independently navigable OSHAL
experience slice. Preserve its specialist identities and canonical ticket workflow. Render Operations
views of shared records and current-caller connections; do not create an alternate login, secret store,
privileged connector runtime or ticket engine. Shell/navigation ownership does not change authority.

Alternatives rejected: a new product identity/login; a second app duplicating the existing incident bots;
application routes that bypass shared connector write confirmation or tool authority.

Consequences: Native experience/current-caller APIs must be verified. Shared gaps belong at their owner
boundary. The app owns sources/mappings, operational inventory, decisions, evidence and the domain UX.
No manifest permission or connector allow-list is expanded just because a prototype displays a provider.

Acceptance: Signed-out access refuses; the signed-in caller sees only admitted records/connections;
another user cannot inherit the first user's grants; revocation clears access; existing bot/ticket IDs
stay intact. A browser role selector is never accepted as server authorization.
