# Ambient Recall (person-model)

Ambient Recall (`person-model`) gives each signed-in person an opt-in, owner-private surface over their own ambient transcripts, continuously learned personal profile, and Eavesdrop Business Cards on oshal:
- **Continuous Profile Learning (`GET/POST /api/person-model/profile-cards`):** Maintains the owner's continuously learned identity, home/mailing address, contact details, role, organization, clearance, education, and learned preferences/household facts under `OSHAL_PACKAGE_DATA_DIR/person-model-cards.json`, with inline `Teach Fact` and `Edit Profile` controls.
- **Eavesdrop People & Business Cards (`Profile & Cards` tab):** Synthesizes structured business cards for people heard across ambient transcripts (Name, Role/Title, Organization, Relationship, Topics Discussed, Open Commitments, Utterance Count, and Verbatim Quote Receipts), merging package-stored cards with `/api/jarvis/ambient/person/{business-cards,people,asks}`.
- **Exact Transcript Recall, Open Asks, Consent & Trends:** Exact mention counts with verbatim quoted receipts, assistant-voice playback without storing audio or cloning voices, open asks and commitments paired with their source quotes, per-person consent controls, and weekly topic trends.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| ambient-recall-concierge | concierge answer | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
