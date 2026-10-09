# Games

The focused OSHAL game launcher. It adds two entries to one cockpit toolbar:

- **D&D** opens the AI Dungeon Master table.
- **Game Show** opens the main game-night stage.

The launcher owns no routes, bots, or data. It depends on the existing `dnd` and
`game-show` packages and links directly to their authenticated surfaces.

After installation, open:

```text
/cockpit/?app=games
```

The toolbar inherits the operator's selected swarm control-plane theme.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
