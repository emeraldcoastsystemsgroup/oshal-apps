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
