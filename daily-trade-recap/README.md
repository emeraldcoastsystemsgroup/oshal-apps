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

Initially carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a
surface"); package-owned review routes and integrations were added afterward:

- **In this package:** the app manifest (ticketType `daily-trade-recap` + the
  approval-gated graph workflow), the three `trade_recap_*` CLI tools, a
  package copy of the vids-operator persona, the Recap Review surface, Home
  summary, integration offers and the recorded-report briefing consumer.
- **Stays in the OSHAL kernel:** the SHARED **vids-operator remote-client desktop
  worker** (`packages/oshal-vids-operator`) with its registry entries in BOTH
  `swarm-bot-registry` blocks; ALL trading engines, schedule pins, and the
  deck-data pipeline — the recap stage scripts (`scripts/oshal-recap-agent-remote.js`,
  `oshal-recap-render-remote.js`, `oshal-recap-email.js`, `oshal-trade-data.js`,
  `oshal-trade-recap.js`, `oshal-deck-data.js`) that the tools shell to; the
  5PM CT recap cron (a HOST scheduled task driving `scripts/run-daily-recap.ps1`);
  and the generic `workflow:<ticketType>` schedule-dispatch engine.

## Surfaces

Open **Recap Review** from the installed application's navigation. Its route is
`/api/daily-trade-recap/review`; the application also supplies its Home summary
and document/video preparation integrations. These are separate from the
existing report generation and approval-gated delivery workflow.

## Install

```bash
node scripts/oshal-app.js install daily-trade-recap
```

Generation needs the render node online (the `@oshal/chat` worker on the video
PC), and the existing email step needs the operator's Google connection. The
recorded-report consumer needs an updated core with `saveCompletedBriefing`
and the registered Jarvis briefing service; it reports unavailable when that
runtime is missing. It does not create a second report or delivery pipeline.

## Schedule it

The production path is the kernel's 5PM CT host task. A swarm-side alternative:
create a Redis-backed schedule whose `taskType` is `workflow:daily-trade-recap` —
every fire creates an auto-started `daily-trade-recap` ticket.

## Recorded reports in Jarvis

The package's separate fifteen-minute service schedule examines at most the
newest 50 recorded `daily-report` journal entries from within 72 hours.
It stops admitting further rows after a ten-second budget; an in-flight
operation keeps the core service's own authority and timeout boundaries.
Older reports are not backfilled.

Each recipient comes from the recorded owner subject and must resolve to an
unambiguous current identity through the existing briefing service. Current
source authorization and briefing preferences still apply. A deterministic
owner/day identifier prevents overlapping runs and journal rewrites from
creating repeated briefings. The core stores the completed result atomically;
a failed transaction leaves no pending task behind, so a later run can retry.

The message says **report recorded**. Recording the journal does not prove email
or site delivery. Collection neither generates reports nor trades or sends
outward messages. It returns aggregate counts: only committed admissions count
as queued; suppressed, duplicate or failed admissions are reported as deferred
or already queued. Jarvis retains its normal delivery/claim lifecycle.

## Tests

Installation registers metadata readiness and the recorded-report regression in
AI Test Lab through `tests/test-lab.yaml`. The regression requires a framework
checkout and uses the actual compiled collector, core task helper and briefing
service with isolated SQL and HTTP fixtures. It does not call providers or use
live trading records. Registration is distinct from executing the suite.

```powershell
$env:OSHAL_CORE_DIR = 'C:/Projects/oshal'
node --test tests/completed-report-briefings.core.test.js
```
