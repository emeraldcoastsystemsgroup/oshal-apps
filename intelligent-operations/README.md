# Intelligent Operations

An incident queue with a root-cause-analysis pipeline. File an incident as a ticket of type
`intelligent-operations`; three phases run:

1. **investigate** (`ops-rca-specialist`): classifies the incident (A remediation, B info-request,
   C escalate), states one root cause, the impact, and operator-run remediation or evidence
   collection steps.
2. **review** (`ops-incident-reviewer`): `approved`, `needs_revision` or `escalate`, with numbered
   findings.
3. **revise** (`ops-rca-specialist`): fixes the reviewer's findings.

Nothing is applied automatically. Remediation commands are proposals for an operator to run.

## On the native kernel

- The platform's reviewer loop (`reviewerBot: queue-bot`, `maxRevisions: 2`) is written out as the
  explicit phases above; one revision round runs.
- The bots reason over the ticket and its attachments only. The platform's runbook corpus
  (`infra-runbooks`), the graph tier and shell access are not available to a native bot, so paste
  the evidence you have into the ticket.
- The application has no screen of its own: opening it shows its concierge with the queue one
  click away.
- It replaces Issue RCA and Incident Remediation, which the platform unified into it (the header of
  the platform's `swarm-apps/intelligent-operations.yaml`). SAP Incident is not part of it, and it
  is not yet ported, so it stays turned off. Its manifest (`swarm-apps-incident/sap-incident.yaml`)
  and its `sap-rca-specialist` persona are in the archived core trunk at commit `41da137`, not in
  the current platform tree or either store. That persona grounds every claim in the `sap-runbooks`
  corpus, which an operator populated from SAP documentation; it is not one of the knowledge
  collections this installation searches. It also searched that corpus and the web from a shell.
  Until it is ported, file SAP incidents here.
  Intelligent Processing builds its alert queue on this application's bots.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **192 / 768 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| incident-rca | incident ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
