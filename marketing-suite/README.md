<!-- CHANGE LOG
SEQ | AUTHOR | DESCRIPTION
1 | maintainer@emeraldcoastsystemsgroup.com | The Marketing application group (ADR-141): one front door over the campaign engine, the compose desk, social presence and the creative studios, with a setup page driven by member readiness probes.
-->
# Marketing (marketing-suite) — OSHAL application GROUP

One front door for taking a product to market. This package carries **no code**: it binds
installed applications into one toolbar and one setup page, and every tile is borrowed from a
member by name, so a member that renames a surface fails this group instead of leaving a dead tile.

Design and phases: `docs/apps/marketing-suite-spec.md` in the core repo. Open work with done-when
criteria: [`marketing-engine/BACKLOG.md`](../marketing-engine/BACKLOG.md).

## Members

| Member | What it brings |
|---|---|
| marketing-engine | the campaign board, per-channel consent, the weekly scorecard, budget decisions |
| switchboard | the compose desk and the scheduled calendar |
| social | LinkedIn and Facebook presence, the signals you follow, connected accounts |
| brand-graphics | campaign graphics |
| presentations | decks and documents |
| video | video clips |

Installing the group resolves every member fail-closed, and a member cannot be uninstalled while
the group is active.

**Finance is deliberately not a member yet.** Holding a campaign budget as a finance project is
phase P2 in the spec; until that link exists, making finance a member would force a personal
finance app on anyone who installs this group.

## The setup page

The kernel renders it from `setup:`. Each step asks the member's own readiness probe in your
session, so a step is done only when the member says it is:

1. **Create your first campaign** — until one exists the daily ingest has no owner and no Monday
   review ticket is produced.
2. **Turn on a channel and set its daily cap** — a channel counts as armed only when it is enabled
   *and* its cap is at least one. A cap of zero means never.
3. **Set up email sending** — needs both the deployment's sender address and your own Resend
   connection.
4. **Connect Facebook** — from the social app.
5. **Pick the signals you follow** — from the social app.

## What this group does not do

It arms nothing. Every outward action still belongs to its member app and its gates: per-channel
consent that defaults OFF, a daily cap, an explicit confirm, and a run ledger that records refusals
as well as sends.
