# Job Apply (job-apply) — OSHAL app package

A workflow-only app (ADR-085 Wave 3, "skill with a surface" — ADR-093). It adds the
`job-apply` ticket type + queue and nothing else — no surface route, no html, no
queue-classification literal in the kernel. Push a `job-apply` ticket (with a clear
description: job URL, ATS, posting id) and the QueueManager routes it to the
already-carved **career-hunter** worker bot (manifest-worker, self-gating). The bot
gathers the job + the user's canonical apply values + the packet, hands the browser
submission to a desktop worker node (screen/mouse via `codex.exec`), and the ticket
PASSES or FAILS on the result. The operator just watches the queue.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3):

- **In this package:** the app manifest only — the `job-apply` ticketType + the Job
  Application Submission workflow bound to the career-hunter worker bot.
- **Stays in the OSHAL kernel:** the `career-hunter` worker bot (registered by the
  career-hunter app + `swarm-bot-registry`; declared here as a `dependencies.apps`
  entry so the installer resolves it), the apply-operator / apply-ingest **engine**
  (the OIDC-side `/api/apply-operator` dispatch, the service-secret `/api/apply/ingest`
  desktop callback, and the shared `apply-inflight` watchdog), and the apply CLIs +
  toolkits (`scripts/oshal-apply.js`, `applyOperatorTools`) the bots run.

## Dependencies

Requires the **career-hunter** app (its worker bot is this app's `workerBot`). The
installer resolves it npm-style, fail-closed.

## Install

```bash
node scripts/oshal-app.js install job-apply
```

No routes to build (workflow-only) and no migrations — the queue rides the kernel's
QueueManager and the career-hunter engine chain, both framework-resident.
