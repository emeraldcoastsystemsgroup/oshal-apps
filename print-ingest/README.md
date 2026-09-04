# Print Ingest

Print a document to the swarm and decide where it belongs.

Everything printed lands in **one inbox**. A `print-queue` ticket proposes where the document should
be filed — a bot's corpus, the swarm's shared knowledge, or private to you — and **nothing is written
to any corpus until a human approves it**. An approved document can be filed to several destinations
at once, on purpose.

Design record: [ADR-135](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/135-print-to-swarm-and-print-to-rag.md).
Specification: [print-ingest-spec](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/print-ingest-spec.md).

**Status: 0.1.0, installs `inactive`.** A fresh install does nothing until an operator activates it.

---

## Why several copies of one document

Retrieval ranks *within a collection*. A document competes only with what shares its collection, so
the same page ranks high in a focused bot corpus and is buried in a large swarm one — for the
identical query. Filing a copy close to the bot that needs it is the difference between found and
not found.

Three rules keep that from becoming a mess:

1. **Every copy shares one document id** (`print:<sha256>` of the text), so results dedupe by
   document and every copy is reachable from a single value.
2. **The fan-out set is recorded** on the intake row. Core RAG has no per-document delete, so this
   record is the only thing standing between *retractable later* and *permanent by accident*.
3. **Fan-out is never silent.** The form lists every destination a copy will land in; approving one
   is not approving three.

## What it does not do

- **A bot corpus is routing, not privacy.** Anything filed there is readable by every signed-in
  user, because per-bot chunks carry no access control. The form says so at the point of choice.
  Put anything that must stay private in *Private to me*, where `owner_sub` and RLS enforce it.
- **It never infers ownership.** The printer's `requestingUser` and `clientIp` are whatever the
  printing machine declared; they are recorded for audit and shown as hints, and they never become
  `owner_sub`, a collection name, or a bot id.
- **It does not read images.** Documents arrive as recovered text. A document with no text layer is
  reported, not guessed at.

## Configuration

| Environment variable | Meaning |
|---|---|
| `PRINT_INGEST_BOT_DESTINATIONS` | The bot destinations offered, `;`-separated: `id\|Label\|collection\|topic,topic`. Adding a bot is configuration, never a release. A malformed entry is dropped rather than half-registered. |

Example:

```
PRINT_INGEST_BOT_DESTINATIONS="maintenance|Maintenance bot|agent-knowledge-maintenance|heat exchanger,service interval;finance|Finance bot|agent-knowledge-finance|invoice,accounts payable"
```

The two built-in destinations — *Private to me* (`my-knowledge`, owned) and *Swarm knowledge*
(`swarm-knowledge`, readable by everyone signed in) — are always present. The swarm level is
kernel-reserved, so it is **withheld from a non-admin approver** rather than offered and refused at
write time.

## Association rules

An admin can map a source (client IP, originating computer, printer) to a suggested user and default
destinations, stored in `print_intake_rule`. Rules make the common case one click instead of a
decision made twice a week. Their bounds are enforced, not documented:

- A rule **pre-ticks; it does not approve.**
- **No rule may auto-approve into the swarm-wide level** — that one is world-readable and always
  takes a human.
- A rule **never establishes ownership**; its suggested user is a hint.
- A rule with **no match criteria matches nothing**, because a rule that matched every document is
  never what an admin meant.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/print-ingest/destinations` | The destinations this caller may file into |
| `POST` | `/api/print-ingest/documents` | Intake: `{ text, sidecar }`. Idempotent on the text's hash |
| `GET` | `/api/print-ingest/documents?state=` | The inbox |
| `POST` | `/api/print-ingest/documents/:id/approve` | `{ destinations: [id], title? }` → fan-out |
| `POST` | `/api/print-ingest/documents/:id/reject` | Discard, and keep the decision |
| `GET` | `/api/print-ingest/app` | The inbox surface |

Intake takes **text, not the binary**: the printer already recovers a document's text, so the swarm
never parses untrusted binary and the original stays on the machine that produced it.

## Intake states

| State | Meaning |
|---|---|
| `awaiting_approval` | In the inbox. Nothing written |
| `ingested` | Every approved copy was written |
| `partially_ingested` | Some copies exist and some do not. Not an error dressed up — a written copy cannot be un-written, and a blind retry would duplicate the ones that succeeded |
| `rejected` | Discarded by a person; the decision is kept |
| `failed` | No copy was written |

## Development

```bash
# Compile src-routes/*.ts -> routes/*.js against a framework checkout
node <oshal>/scripts/oshal-app.js build print-ingest --framework <oshal>

# Validate the manifest
node <oshal>/scripts/oshal-app.js validate print-ingest

# Tests: plain node, zero dependencies, against the COMPILED routes/*.js
node print-ingest/tests/run.js
```

The decision logic lives in two dependency-free modules — `print-classify` (what to recommend and
why) and `print-fanout` (what to write and where it went) — precisely so it can be tested without a
database, a stack or a model. That is where the guards are, because that is where a wrong answer is
permanent.
