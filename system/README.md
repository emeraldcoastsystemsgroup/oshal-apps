# System

One desk for account infrastructure. System is a **pure launcher** (the `games/`
precedent): it owns no routes, bots, migrations, or data of its own — the package is
one manifest. It gathers the account-infrastructure apps that are useful on their
own but don't each need a dedicated subdomain onto a single cockpit toolbar, and
`system.oshal.ai` is that front door.

Its three tiles route straight to the installed sibling apps' own surfaces:

| Tile | Opens | App |
|---|---|---|
| Identity Hub | `/api/identity/` | `identity` |
| Storage | `/api/storage/assistant/ui` | `storage` |
| Cloud Accounts | `/utilities` | `cloud` (the connector hub is a core framework surface; cloud's own tile points at the same place) |

Installing the launcher resolves all three sibling apps as dependencies
(npm-style, fail-closed — the games-launcher precedent), so the tiles never point
at surfaces that aren't there.

After installation, open:

```text
/cockpit/?app=system
```

The ribbon hides the generic framework tabs and the chat panel; the default view is
Identity Hub. The package declares the `gray` skin as its default; the operator's
chosen theme always wins.
