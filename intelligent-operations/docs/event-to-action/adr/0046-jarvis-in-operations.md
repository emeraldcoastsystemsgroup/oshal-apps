# ADR0046: Jarvis in Operations

Status: implemented and accepted live, 22 October 2026; three tools added and all six accepted live
on 23 October 2026. On the owned lab, Jarvis answered one question per tool from the person's own
records: attention, degraded systems, response plans, anomalies, hand-offs and investigations.
Each answer handed off to Operations and carried the summary's facts
(`deploy/evidence/jarvis-tools.json`, `lab/jarvis_tools_live.py`). The first run showed that
"handed to us by another swarm" was not routed to Operations; routing words were added. On the owned lab, Jarvis answered two
questions from these tools, each with correct counts and a link to Operations: "What needs my
attention in operations?" and "What was handed to us by another swarm?"
(`deploy/evidence/jarvis-operations.json`). Guarded. Extends ADR0043.

Roger asked for swarm-to-swarm communication "over Jarvis". Jarvis is the assistant a person
talks to across their installation. Until now it could not answer anything about Operations,
because the package declared no tools.

## Decision

The package declares three read-only, route-backed Jarvis tools, all bound under `app.open`:

- **`ops-attention`** (`GET /attention`). One summary, from the person's own saved records, of
  what waits on them:
  - response plans to approve;
  - executions without verified recovery;
  - overdue break-glass reconciliations;
  - firing anomaly baselines;
  - investigations started automatically, or whose automatic start was refused or uncertain;
  - processing that needs review;
  - swarm hand-offs sent and received.

  The answer includes a summary sentence Jarvis can read aloud.
- **`ops-handoffs`** (`GET /delegations`). Hand-offs sent to peer swarms, with their delivery
  state, and delegations from other swarms filed as investigations.
- **`ops-investigations`** (`GET /investigations`). Evidence investigations with their
  canonical ticket state.

Added 23 October 2026, so Jarvis can carry a DevOps triage conversation end to end:

- **`ops-systems`** (`GET /summary/systems`). Inventory health: counts of healthy, degraded
  and unknown assets, the degraded and unknown assets themselves (at most 25, with cluster
  scope, namespace and pressure), and whether scheduled discovery (ADR0049) keeps the
  inventory current.
- **`ops-response-plans`** (`GET /summary/responses`). The newest 20 response plans: ticket,
  target pod, generated files, approval state, and each execution's result and verified
  recovery. Its answer says that approving and running happen only in Incident work, with a
  fresh confirmation.
- **`ops-anomalies`** (`GET /summary/anomalies`). Whether detection is on, and the baselines,
  firing first, with readiness and last score.

Routing words such as "needs my attention in operations", "swarm hand-off" and "delegation from
another swarm" send those requests to the Operations specialist. Every action stays on the
Operations pages and needs the person's confirmation: sending, filing, approving and starting.
Jarvis reads; it never sends or runs anything.

## Not claimed

- Jarvis sending a hand-off by name. That would be an approval-held write tool and is a later
  step.
- Jarvis reading the kernel inbox of unfiled delegations directly. That inbox is a kernel route,
  and package tools reach only package routes; the Swarm hand-off page shows it.
