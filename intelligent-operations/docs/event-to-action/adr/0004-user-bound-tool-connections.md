# ADR 0004: CLI and background work retain user-bound OSHAL authority

Status: Accepted design, 20 October 2026. Provider/runner acceptance remains required.

Context: Kubernetes/cloud/host discovery and evidence collection require tool sessions. A global CLI
cache or an administrator's shell default would let one person's credential silently become everyone’s.
The experience is based on OSHAL user login and the standard connection framework.

Decision: Resolve admitted connections under the signed-in caller, with explicit named account and
resource scope. Interactive connection authorization belongs to the shared secure flow. Unattended
work requires explicit activation under an admitted principal and scoped connection; browser tokens
and personal terminal caches are not background service credentials. This uses shared authority, not
an independent Operations login. Personal connections and explicitly granted shared connections retain
their native ownership distinctions.

Verify runner/tool availability, actual principal, account/tenant/project/cluster incarnation and
capability-specific reads. A login does not prove inventory, evidence or write access. Changed binding,
expiry, revocation or wrong scope blocks new work. Shared refresh must preserve the bound identity.
Tools receive isolated configuration and explicit target selection, without inheriting shell defaults.

Alternatives rejected: application-owned OAuth/token storage, importing global CLI contexts, trusting
client-supplied user IDs, all-powerful background credentials and granting writes after a read probe.

Consequences: Connection and delegation metadata appear in topology freshness and collection receipts.
Source/webhook authentication still applies independently to background deliveries. The scanner
reconciles inventory only after a complete authorized scan; failure cannot delete unseen assets.

Acceptance: Cross-user and cross-account refusal, missing tool, expired/revoked session, withdrawn
grants, explicit target binding and no default fallback; prove an observer cannot mutate infrastructure.
Use installed shared services and real disposable provider acceptance separately from local UX fixtures.
