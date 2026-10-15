# Bot Forge (codex-packer)

An interview that drafts a single-purpose application: one bot, one ticket queue, and the bot's
quality contract in its persona. Open Bot Forge and talk to its concierge; after eight questions it
drafts `<name>/oshal-app.yaml` and `<name>/personas/<name>.yaml`.

## On the native kernel

- The platform's Forge screen (`/api/forge`) and its one-click Inject were platform TypeScript routes
  that wrote packs into the platform workspace. Neither exists natively, so Bot Forge opens as its
  concierge and installs nothing.
- To use a draft: save the two files as a package directory in the store checkout, commit, then
  preview and install it from App Loader (which shows its permissions first).
- Drafted bots reason over what their ticket or conversation gives them; they cannot run commands
  or hold credentials.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| packing-interview | packing interview | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
