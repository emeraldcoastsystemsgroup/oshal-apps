# Operations UX prototype

This is the proposed application journey, separate from the installed workspace. Every record and
outcome is synthetic. Controls change browser memory only; reloading resets the demo. No API,
credential, Splunk, approval or execution service is contacted.

Open `prototype/index.html` through a static server rooted at `intelligent-operations` (bind to loopback).
For example, from this repository:

```bash
python3 -m http.server 8079 --bind 127.0.0.1 --directory intelligent-operations
```

Then open <http://127.0.0.1:8079/prototype/index.html>. Stop the server with Ctrl+C.
The production workspace remains `ui/index.html`; the prototype is not a registered ribbon item.

## Review the journey

1. **Incidents:** inspect the partial information packet; simulate retrying external enrichment.
2. **Estate:** switch historical observations and Kubernetes/AWS/Azure/GCP/data center scopes. Filter
   by layer and observed health; inspect nodes, typed edges and observation source. Try an empty view
   and preview a discovery interval. Unknown telemetry stays unknown.
3. **Data & decisions:** replay synthetic deliveries, change the severity threshold, compare delivery
   retries with symptom updates, inspect scoped keys and snapshot decisions, and switch to separate
   telemetry observations. This demonstrator does not run the established production algorithm.
4. **Sources & access:** inspect scoped credential references and explicit identifier mapping. Try missing
   and ambiguous matches; both require identity review. OTLP remains labeled as planned.
5. **Connections & CLI:** compare operator and background identity flows, then simulate sign-in,
   verify the actual scope and test inventory/evidence independently. Try a missing tool, wrong scope,
   expired session, viewer role and revocation. No real login or command runs.
6. **Ticket synchronization:** select a current-caller ServiceNow/GitHub/GitLab/Jira connection,
   inspect coverage and field direction, preview and confirm a demo operation. Try expiry, provider
   denial, revision conflict and uncertain-create reconciliation. Changing policy cannot bypass the
   existing create/link identity. No provider is contacted.
7. **Approval review:** change the simulated session to Viewer, then Scoped approver. Acknowledge and
   record a demo approval, then change the timeout. The changed revision requires a new review.
8. **Work delivery:** inspect the current bundle digest and download the serialized demo manifest.
   Its actual SHA-256 matches the displayed digest. It requests no execution and contains no secret.

The demo bundle contains a read-only readiness command. It is not a remediation bundle and cannot
prove that an incident recovered. A real executor must check target incarnation, caller and delegated
principal, policy, digest, parameters, expiry and separation of duties, and retain a durable receipt.
The local approval is deliberately not an authorization implementation.

## UX acceptance and next implementation

Navigation, unknown/partial states, viewer refusal, revision invalidation, the download hash and
all eight pages at 1440, 390 and 320 pixels are exercised in `tests/surface-browser.test.cjs`.
Screenshots can be regenerated with `OPERATIONS_UX_SCREENSHOTS=/tmp/operations-ux` on that test.
These tests use a disposable static server, not installed OSHAL permissions or backend services.

Build from these flows in milestone order: local adapter mapping preview; authenticated named-source
registration and saved mapping versions; durable intake and quarantine; temporal inventory; detection;
evidence packets; exact server-bound approvals; registered execution and recovery verification.
Do not promote the mock controls into production without those service contracts and acceptance gates.

[Connection, runner and topology requirements](../docs/event-to-action/CONNECTIONS-AND-TOPOLOGY.md)
define the service contracts and activation acceptance behind these mockups.

The application is an OSHAL experience slice. Real connection discovery, authority and writes stay
with the standard framework. The shared connector coverage review is in ADR 0003; simulations do
not assert that every declared provider has complete admitted bidirectional sync.

## Change response concept

Open `change-response/index.html` for four proposed response choices, exact-change
review, sustained recovery watching and Jarvis-to-Jarvis permanent-fix delivery.
All content and interactions are synthetic/local; no service operations are called.
Browser regression: `node --test intelligent-operations/tests/change-response-prototype.test.cjs`.
