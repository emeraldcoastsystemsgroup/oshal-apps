# Home experience

Owns the Home entry, configuration and Cozy Sage skin. Reuses the established platform renderer and member APIs. Member records and provider credentials stay with their owners.

Assign one Household adult, child or guest application role in Access. Each version-2
composite includes Home plus all ten component applications: Purchasing, Home dashboard,
Finance, Little Monsters, Movies, Spotify, Travel, AI Office, Calendar and Circuit Lab.
Circuit Lab is included through Little Monsters’ complete learning bundle. There are no
component-selection checkboxes. The review shows every exact package role and refuses the
whole assignment if a required component or role is unavailable.

Little Monsters uses its actual `student` role for every household role; school teacher/admin
relationships remain independently administered. Other catalog-less components use the
existing package-scoped `@app-admin` compatibility role. This grants no Access Administration,
portal administration or swarm-default management. Adult/child/guest labels establish no
family relationship or sharing permission. Connector sign-in, household membership and
provider readiness remain visible setup requirements; assigning an application role does
not invent those records or credentials.

Install on a core with `experience`, `experience-roles`, and migration 185. Assign a complete named application role through Access and review the full included bundle. Open `/api/ui/experiences/home-experience/open`. Direct routes remain session- and application-authorized. Revocation removes only this composite source.

Layout and configuration were extracted from OSHAL Home. Shared rendering/transport and business data ownership remain in OSHAL and the member packages. Source release does not claim installed acceptance.

The default front page starts with **Top Items Today**, then Today's Schedule, Recent Work
and Applications. Top Items Today lists only caller-readable tickets in the shared review,
approval, follow-up, escalation, blocked or failed status group, with exact owning-ticket
links. The six most recently changed tickets appear first; equal or missing update times
use ticket ID as a stable tie-break. This is a ticket-attention list, not a due-date or
per-learner completion aggregation. Empty requires a successful readable ticket feed with
known statuses. Missing or unknown states and unusable record links remain explicitly
incomplete; failed/unreadable reads stay unavailable and use the existing work retry.

The package's `home-attention.js` composes the exported `HOMEBASE_MODULES.create(ctx)`
factory after the shared modules load and before Homebase boots. It retains the original
module methods and adds its panel to the render-time `roomTabs()` output only on Home's
front page, before the shared columns. It reads the existing live snapshot/context and
per-source state, without extra API calls, renderer copies, DOM observers, member writes
or permission changes. Other pages and open member frames retain the shared behavior;
saved display choices still order/hide their existing modules. Use the registered isolated
browser/runtime proofs to verify the exact shipped package; installed acceptance and the
complete original audience/member/performance matrix remain separate.

The registered external runtime proof needs an explicit source checkout with the current
experience floors. Run its `tests/runtime-proof.test.ts` with that checkout's `tsx --test`
and `--tsconfig`, setting `OSHAL_FRAMEWORK` and `NODE_PATH` to the checkout and its
`node_modules`. It owns a copied temporary package, synthetic Purchasing reference and
loopback server, and closes/removes them. It never connects to a deployment database.
The sealed Test Lab profile withholds this external fixture; its pending reason is explicit.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **16 / 64 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| assistant-handoff | assistant request | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
