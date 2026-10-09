# Jarvis experience

Your assistant briefing, conversations, agenda and admitted applications.

Owns the entry, configuration, layout assets and skin. Reuses the established platform rendering and transport; member APIs, authorization, relationships, records and provider credentials remain with their owners.

The version 3 **Complete workspace member** template provisions the host and all 39 shared product component applications in one reviewed atomic assignment. Studio, Jarvis, Orbit and Commons share the same functional bundle and differ in layout. No component checkbox or second manual role assignment is needed. The dynamic catalog continues to show the caller's current admitted applications; pins, suite rooms and selections do not add grants. Version 3 (1.1.1) differs from version 2 only in Scan to Print's role, now its catalog's `maker`.

The bundle includes:

- Home and learning: Smart Home, Shopping, Finance, Little Monsters, Movies & TV, Spotify, Travel, Calendar Preparation and Circuit Lab.
- Office and business: AI Office (PowerPoint, Word and Excel), Intelligent Communication, World Intelligence, Switchboard, Social, Calling Assistant, Marketing Engine, Venture Plan, Federal CRM with its required Federal Capture, Intelligent Sales and Government Contracting components, Payroll, Payments, Identity Hub and CAD Studio.
- Creation: Create, Portrait Studio, Video Studio, LoRA Studio, Vids, Creative Studio and Scan to Print.
- Cross-workspace functions: personal Storage, Intelligent Career, D&D, Game Show, Games, OSHAL Assistant and Workflow Studio.

Named catalogs use ordinary roles: Little Monsters `student`; Calling Assistant `caller`; LoRA `trainer`; Career and Venture Plan `member`; Federal CRM `crm_representative`; Intelligent Sales `sales_manager`; Government Contracting `administrator` (its existing ten owner-scoped application functions, not portal administration); Create `creator` + `editor` + `exporter` + `generator`; Portrait `creator` + `editor` + `deleter` + `mailer` + `artist`; Video `producer` + `creator` + `editor` + `exporter`. Several roles for one component are intentional: an editor alone cannot create or export. Every listed grant is scoped by that application's existing record rules. Create's project deletion and Video's pump management/deletion remain catalog-admin functions and are not included by pretending an ordinary role grants them.

Components without a named catalog use their existing explicit `@app-admin` compatibility adapter. That admits the member application's existing functions, not Swarm Admin, operator rights, Access Administration or another person's records. Built-in Jarvis and Workflow Studio retain their existing signed-in capability policy. The bundle does not enroll anybody in a school, household or business; configure an AI provider; connect a mailbox, bank or storage vendor; submit a purchase; place a trade; fly a device; or send anything. Existing membership, credentials, approvals and execution checks remain authoritative. Separately installed applications remain separately governed.

This is the defined shared user product, not every package on a catalog shelf. It excludes other experience hosts, operator/development infrastructure, example and inactive packages, and standalone trading/device extensions. If a required component is missing, inactive, denied or has an unmapped required dependency, provisioning refuses with the component named instead of creating a partly usable assignment. This broad product bundle is appropriate for a person entitled to the whole workspace; assign a narrower named application product role when that is the intended scope.

Existing version 1 assignments keep their original constituent grants until an authorized administrator reviews and applies an upgrade. Upgrades, expiry and revocation preserve independent grants and other product assignments through source-specific provenance. A newly provisioned person starts with no inherited component grants; the isolated runtime proof verifies the full role set and cleanup, not live school enrollment, personal OAuth or deployed acceptance.

Requires core `experience`, `experience-roles`, and migration 185. Review named roles in Access, then open `/api/ui/experiences/jarvis-experience/open`. Direct entry and assets independently require the session and own app.open permission. Composite revoke removes only that source; upgrades require a fresh review.

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
