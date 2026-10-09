# Intelligent Sports

`intelligent-sports` is a code-free ADR-141 application group: the front door that bundles
[`fantasy-football`](../fantasy-football/) and [`sports-edge`](../sports-edge/), as the operator
decided on ADR-146 Q4 (2026-09-27). It owns no route, bot, tool, migration or copied URL; every
toolbar tile is borrowed from a member by `{app, surface}` reference, and each member remains
responsible for its own API, authority, chat and data.

| Member | What it brings |
|---|---|
| `fantasy-football` | your own fantasy team: the lineup with the best chance of beating this week's opponent, and its graded ledger |
| `sports-edge` | follow a team, its next game's line built from the tape, and the review page |

Fantasy Football's per-person ownership is unchanged inside the group: every row it stores is walled
to its owner, and only the caller's own ESPN connection is spent. The group's connector allow-list is
exactly the union of its members' lists (`espn-fantasy`), declared rather than absent so the cockpit
does not offer the whole provider catalog inside this front door.

The group activates only when both members are installed and active. A missing member or a renamed
borrowed surface fails activation with the member or surface named; it never silently shrinks.

To verify an installation, open `/cockpit/?app=intelligent-sports` while signed in: the ribbon opens
on Fantasy Football, with Sports Edge under Odds and its review page in the bottom tray.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
