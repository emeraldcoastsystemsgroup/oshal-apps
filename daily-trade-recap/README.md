# Daily Trade Recap (daily-trade-recap) — OSHAL app package

After the closing bell: render the day's charted trade-recap video (real Alpaca
data → PowerPoint deck → narrated MP4) on the swarm render node, then email it to
the operator with the day's numbers and the video attached as a preview
(ADR-074). One bot, one tool, one call: a `daily-trade-recap` ticket instructs
the **vids-operator** to call `trade_recap_pipeline`, which hands the goal + the
day's authoritative data to the video PC's local agent and monitors it; an
approval gate holds the result before posting.

**NOTE: despite the name this is a VIDS-family media pipeline** — its only real
dependency is the shared vids-operator desktop worker — which is why it carves
with the media cluster and NOT the trading wave.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface" —
this app never had a route or a tile of its own):

- **In this package:** the app manifest (ticketType `daily-trade-recap` + the
  approval-gated graph workflow), the three `trade_recap_*` CLI tools, and a
  package copy of the vids-operator persona for the registrar (deliberately no
  `bots:` block — the loader backfills `agent_ids` from `workflow.workerBot`).
- **Stays in the OSHAL kernel:** the SHARED **vids-operator remote-client desktop
  worker** (`packages/oshal-vids-operator`) with its registry entries in BOTH
  `swarm-bot-registry` blocks; ALL trading engines, schedule pins, and the
  deck-data pipeline — the recap stage scripts (`scripts/oshal-recap-agent-remote.js`,
  `oshal-recap-render-remote.js`, `oshal-recap-email.js`, `oshal-trade-data.js`,
  `oshal-trade-recap.js`, `oshal-deck-data.js`) that the tools shell to; the
  5PM CT recap cron (a HOST scheduled task driving `scripts/run-daily-recap.ps1`);
  and the generic `workflow:<ticketType>` schedule-dispatch engine.

## Surfaces

None — this is a headless media pipeline (no route, no tile). Results arrive by
email and land in the queue's approval gate.

## Install

```bash
node scripts/oshal-app.js install daily-trade-recap
```

No routes and no migrations. Needs the render node online (the `@oshal/chat`
worker on the video PC) and the operator's Google connection for the email step.

## Schedule it

The production path is the kernel's 5PM CT host task. A swarm-side alternative:
create a Redis-backed schedule whose `taskType` is `workflow:daily-trade-recap` —
every fire creates an auto-started `daily-trade-recap` ticket.
