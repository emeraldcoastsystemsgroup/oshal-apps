# Life

One desk for everything lifestyle. Life is a **pure launcher** (the `games/`
precedent): it owns no routes, bots, migrations, or data of its own — the package is
one manifest. It gathers the day-to-day lifestyle/spend apps that don't stand alone
as their own subdomain onto a single cockpit toolbar, and `life.oshal.ai` is
that front door.

Its eight tiles route straight to the installed sibling apps' own surfaces:

| Tile | Opens | App |
|---|---|---|
| Movies & TV | `/api/movies/app` | `movies` |
| Music | `/api/spotify/app` | `spotify` |
| Order Food | `/api/eats/app` | `eats` |
| Get a Ride | `/api/rides/app` | `rides` |
| Shopping | `/api/purchasing/chat` | `purchasing` |
| Travel | `/api/travel/app` | `travel` |
| Payments | `/api/payments/` | `payments` |
| AI Bake-Off | `/api/bake-off/` | `bake-off` |

Installing the launcher resolves all eight sibling apps as dependencies
(npm-style, fail-closed — the games-launcher precedent), so the tiles never point
at surfaces that aren't there.

After installation, open:

```text
/cockpit/?app=life
```

The ribbon hides the generic framework tabs and the chat panel; the default view is
Movies & TV. The package declares the `sakura` skin as its default; the operator's
chosen theme always wins.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
