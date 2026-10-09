# Business experience

Your schedule, projects, documents and explicitly connected business applications.

Owns the entry, configuration, layout assets and skin. Reuses the established platform rendering and transport; member APIs, authorization, relationships, records and provider credentials remain with their owners.

One Staff, Manager or Specialist application role includes Business and all eighteen
components automatically: AI Office, Email Summarizer, Calendar, World, Finance,
Switchboard, Social, Calling Assistant, Marketing Engine, Venture Plan, Capture CRM,
Payroll, Payments, Identity, CAD Studio, Federal Capture, Intelligent Sales and
Government Contracting. The last three are Capture CRM’s required dependencies. All version-2 templates cover the full bundle;
no component checkboxes are needed. A missing required application or role blocks the
whole reviewed assignment.

Calling uses its exact `caller` role; Venture Plan uses `member`. Capture CRM uses the
existing ordinary `crm_representative` role, which covers its own-record CRM reads,
authoring, imports and workflows. The former `viewer` mapping opened summaries while
leaving normal CRM work unavailable. It grants no team or tenant sharing and no CRM
administration. Intelligent Sales uses its ordinary `sales_manager` role for authoring,
imports and exports. Government Contracting uses its existing own-record `administrator`
business role; neither carries portal/swarm administration. Catalog-less components use their package-scoped `@app-admin` compatibility
role; none is a portal/swarm administrator. Staff/manager/specialist labels establish no
team membership. Connector consent, workspace membership and provider readiness are
separate setup facts and remain enforced by each component.

Requires core `experience`, `experience-roles`, and migration 185. Review named roles in Access, then open `/api/ui/experiences/business-experience/open`. Direct entry and assets independently require the session and own app.open permission. Composite revoke removes only that source; upgrades require a fresh review.

The registered source checks run without deployment data. Source release does not claim installed acceptance.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **16 / 64 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| assistant-handoff | assistant request | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
