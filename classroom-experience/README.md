# Classroom experience

Classwork, class schedules and personal learning through existing school roles and roster rules.

Owns the entry, configuration, layout assets and skin. Reuses the established platform rendering and transport; member APIs, authorization, relationships, records and provider credentials remain with their owners.

One Learner, Teacher or School administrator application role includes Classroom,
Little Monsters, the full AI Office suite and Circuit Lab automatically. These four
applications form every version-2 composite; there are no optional component checkboxes.
The full Office package provides documents, spreadsheets and presentations, in addition
to Little Monsters’ own lecture player and PowerPoint export. A missing component or
invalid role blocks the complete reviewed assignment.

Little Monsters uses its exact student, teacher or admin role. Teacher/admin grants remain
sensitive, and current school roster relationships, class ownership and enrollment still
govern records. The role does not promote a learner’s school roster or enroll them in a
class. AI Office and Circuit Lab use the existing package-scoped `@app-admin` compatibility
role, with no Access Administration or swarm-default management. Provider/voice readiness
and personal connector consent remain separate setup requirements.

Requires core `experience`, `experience-roles`, and migration 185. Review named roles in Access, then open `/api/ui/experiences/classroom-experience/open`. Direct entry and assets independently require the session and own app.open permission. Composite revoke removes only that source; upgrades require a fresh review.

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
