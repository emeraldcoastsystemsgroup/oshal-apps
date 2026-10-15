# Intelligent Processing

A queue for self-monitoring alerts that need a root cause. A ticket of type
`intelligent-processing` runs the same three phases as Intelligent Operations (investigate, review,
revise) on Intelligent Operations' own bots, which this package imports
(`dependencies.required.bots`), so Intelligent Operations must be installed and active.

## On the native kernel

- No alert source opens these tickets here: the platform's Alertmanager intake
  (`/api/alerts/alertmanager`) has no native route. File the alert text as a ticket by hand.
- The platform screens Intelligent Processing (`/intelligent-processing`), System Health
  (`/system-health`) and Pipeline Admin (`/alert-pipeline-admin`) are platform TypeScript pages with
  no native route, so they are not offered. Opening the application shows its concierge with the
  queue one click away.
- Executing a container remediation stays an operator act; nothing is applied automatically.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| alert-rca | promoted alert ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
