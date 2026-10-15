# Capability Ideation

A ticket queue for Capability Ideator: a ticket of type `capability-ideation` describes a business
process, and the imported `capability-ideator` bot proposes up to three tools or integrations for
it. The ticket then completes.

Opening the application shows Capability Ideator's review screen (`/api/capability-ideator/review`)
with `capability-ideator` as its concierge. Capability Ideator must be installed and active, and a
person needs access to it for the screen and concierge to be offered.

This was a Workflow Studio flow whose one-stage graph (start, execute capability-ideator, deliver)
is written here as the same two phases.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 64 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| capability-ideation-run | capability ideation ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
