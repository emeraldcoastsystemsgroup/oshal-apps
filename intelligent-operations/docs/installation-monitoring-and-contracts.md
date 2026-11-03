# Monitoring, contracts and billing as one chain (design, 2026-11-02)

Written for: whoever builds it, and the operator who asked for it. Roger, 2026-11-02 evening: "we were working on remote monitoring through our
local bare metal box. We have a commitment to monitor gsquared and produce weekly reports ... connect our intelligent
operations ... attach the contracts to contract life cycle management ... associate billing to contracts ... we may
need to add some features when we do think about it and design them properly. We do have swarm to swarm comms maybe
that's not the right thing here."

Everything below is grounded in what is on disk tonight. Where a fact was read from code, the path is given. Where a
choice is mine, it says so and gives the reason, so it can be overturned in one line.

This is the design the next Operations lane builds from (Part A); Parts B to D describe the `contracts` package and the
support hand-off that follow it. The first installation it monitors is G-Squared Funding's CRM; the customer-specific pieces
(prober, keys, pastes) live in that customer's repository.

## The chain in one picture

```
 G-Squared production ──probe every 5 min──▶ prober (off-site droplet, dumb)
                                                 │ delivers each run's checks
                                                 ▼
 Spark, Intelligent Operations  ◀── Sunday restore test on the Spark (receipt)
   installation · checks · incidents · silence alarm · weekly evidence
                                                 │ evidence, by id and hash
                                                 ▼
 Spark, Contracts                 ◀── support requests (hand-off from the customer's swarm, later)
   agreement · commitments · requests · hours · invoices · weekly statement
                                                 │ one document a week, Roger presses Send
                                                 ▼
                                           Ira and Ron
```

The probe stays small and off-site. The record, the judgment and the report move onto the Spark. The contract is the
thing the report is measured against, and the invoice is what the contract earns.

## What exists tonight

| Piece | State | Where |
|---|---|---|
| Health monitor: 17 checks every 5 min, alerts, daily digest, weekly email | Running since 2026-09-11 on the staging droplet; **no email has ever been delivered** (relay URL empty: 0 sent, 59 unsent) | `oswarm-gsquared/ops/health-monitor`, README "State as of 2026-11-02" |
| Weekly proof: off-site copies, Sunday restore test on the Spark, patch pass, service-hours file, Monday draft email | Built and tested on branch `ops/weekly-proof` (78daf93, 72 files, 11.7k lines), **unmerged and unreviewed**; not on any box | `oswarm-gsquared`, branch `ops/weekly-proof`, `ops/weekly/README.md` |
| Commitments register: 65 promises across 4 papers, who owes whom, due, what proves it, state | Data as JSON, rendered to Markdown, held by tests; states from a read-only survey on 2026-11-02 (12 not met, 16 partly, 17 met, 6 unknown, 14 not due) | `oswarm-gsquared/internal/contracts/*.json`, `register.js`, `COMMITMENTS-REGISTER.md` |
| Hours log, support log, billing ledger | Markdown tables held consistent by `internal/invoice-workpaper.test.js`; the support log has no rows (nothing records reported-at and answered-at, so S16 to S18 read "unknown") | `oswarm-gsquared/internal/` |
| Intelligent Operations (native, store) | Live: unattended alert intake through the producer door (ADR-197), validated and deduplicated intake, percolation rules, automatic investigations, incident trace, Jarvis tools, swarm hand-off inbox (ADR-194), a processing schedule every minute. Its Systems tree is Kubernetes- and cloud-shaped | `oshal-apps/intelligent-operations`, `docs/event-to-action/FEATURES.md` |
| Kernel health primitives | Readiness per component, alert deduplication before a ticket (H-04), **silence as an alarm** (H-07: a source that stops reporting is not healthy), metrics inherited from declarations | `oshal-kernel/crates/health/src/{readiness,alerts,silence,metrics}.rs` |
| Producer door | A token for one person, one application, one `/ingest/` route; 120 deliveries a minute; the route runs as the owner under the application's own catalog | `oshal-kernel/docs/adr/197-producer-tokens.md` |
| Swarm-to-swarm | Inbound peer delegation inbox is live (ADR-194); a delivery files nothing by itself, the application reads the inbox and files a ticket. Outbound is a connector with the peer token and a confirmation per POST | `oshal-kernel/docs/adr/194-peer-delegation-inbox.md` |
| Contracts or billing application | **None.** `payments` collects money (Stripe, Square, PayPal invoice); `finance` reads banks; `payroll` is payroll | store `oshal-app.yaml` descriptions |
| Email from the Spark's kernel | An `email` channel kind exists but no email transport is registered on the Spark (`/readyz` lists `sms`, `telegram`); it needs an SMTP relay or an email webhook | `crates/api/src/notify_api.rs` lines 87-125, `curl 127.0.0.1:38788/readyz` |

## Decisions

1. **The prober stays off the Spark.** A server cannot report that it is down, and neither can a workstation that
   sleeps, reboots and runs ComfyUI. The staging droplet already probes every 5 minutes with a restricted key that can
   run one read-only collector and nothing else. It keeps doing exactly that, and only that.
2. **Intelligent Operations becomes the record.** Each run the prober delivers its evaluated checks to the Spark
   through the producer door, the same path Alertmanager uses today (R07, live). Operations deduplicates, decides
   what is a symptom, opens the incident, keeps the history, and raises the silence alarm when the prober itself goes
   quiet. The monitor's own alerting, digest and weekly email are retired one at a time, each in the same change that
   turns its Operations replacement on (the ADR-180 rule).
3. **Swarm-to-swarm is not the monitoring transport.** Roger's doubt is right: the customer's installation cannot
   report its own outage, and it should hold nothing that reaches our systems unprompted. It is the right transport
   for one thing: a **support request** raised inside the customer's CRM, delivered as a delegation to our swarm. That
   is the measurement the support agreement's §4 promises and the register cannot show today (S16 to S18 are "unknown"
   because nothing records when a request arrived and when it was answered). Part D.
4. **Contracts and billing are one application, `contracts`,** on the Spark. An invoice is what an agreement earns,
   and the hours balance is a clause of the agreement; splitting them makes a join that nobody needs. The data model
   is the one `internal/contracts/*.json` already proves on 65 real commitments. `payments` can collect an invoice
   later; it is not needed first.
5. **Nothing changes in the kernel.** Every rail needed is there: producer door, scheduled jobs under a principal
   (ADR-157, ADR-180), package egress, peer inbox, notification rail. The one gap is a non-Kubernetes system shape in
   Operations' Systems tree, which is application work.
6. **Build the process, not the product.** G-Squared is the first installation, the first agreement and the first
   customer. Every screen is written for "a monitored installation" and "an agreement", never for G-Squared.

## Part A: monitoring into Intelligent Operations

**What the prober delivers.** After each run, one JSON delivery to `POST /producers/v1/deliver` on
`https://oshal.agenticfederal.us` with a producer token issued for Operations' `/ingest/installation` route: the
installation id, the run time, and each check as `{check, state: ok|warn|fail|unknown, value, since}`, plus the facts
the weekly report prints (dump age and size, off-site copy age, restore receipt summary, record counts, version and
image, patch state, availability). No log line, no collection name, no hostname that is not already public. Deliveries
that cannot be made are queued on the droplet and replayed in order; Operations deduplicates by source, type and
resource, so a replay is safe. While the Spark is unreachable the prober's existing relay path still sends the alert
email directly, so the reflex survives a brain that is off.

**What Operations adds.**

| New in Operations | What it is | Why |
|---|---|---|
| Installation source kind | A source whose adapter maps the delivery above to alerts: one alert per check in `fail`, one warning per `warn`, resolved when the check returns to `ok` | Today's sources are Alertmanager-shaped; this is the same intake with a fixed mapping |
| Installation in Systems | A system of kind `installation` with components (kernel, database, account runtime, tunnel, backups, off-site copy, restore test, security updates), each carrying its last check and open alerts | The tree is cluster/namespace/pod-shaped; a plain installation needs its own shape |
| Silence expectation | "This installation reports every 10 minutes": a late report is an alert in its own right (crates/health silence, H-07) | A stopped prober must read as a problem, not as a quiet week |
| Rules for the 17 checks | Percolation rules that decide which alerts become symptoms (site down, crash loop, backup missing, restore failed) and which stay warnings (slow board, disk 80%) | Operations' existing rules engine, with trial against recorded deliveries before going live |
| Week-in-evidence | A scheduled job (Monday 05:30 Central) that assembles the week's facts into one evidence record with a stable id and hash: availability, incidents, backups, off-site, restore, security, record counts | This is what the weekly statement and the commitments are measured against |
| Receipt intake | The Sunday restore test on the Spark delivers its receipt to the same `/ingest/installation` route instead of scp to the droplet | One record, one hash, no second copy |

**Retired, each in the same change that replaces it:** the monitor's alert and recovery emails (replaced by Operations
incidents plus `notify.send` to Roger), the daily digest (replaced by Operations' attention view and a Jarvis morning
line), the weekly email built from the droplet's history (replaced by the Contracts weekly statement, Part B). Until
each replacement is on, the monitor keeps sending through the relay.

**What stays as it is:** the collector on production, the restricted SSH key, the nightly dump and its off-site pull,
the Sunday restore test on the Spark, the patch pass.

## Part B: Contracts

A store package `contracts` (display name Contracts, suite ai-productivity: it serves the business owner who runs
agreements with customers). Data is per installation; the Spark holds ECSG's agreements. The code is generic.

**Model.** Taken from `internal/contracts/*.json` and the three internal logs, which already describe the real thing:

- **Party:** ECSG, G-Squared Funding; people (Ira Graiser, Ron Gabbai), addresses for the invoice header.
- **Agreement:** id (`IS-SMA-001`), title, kind (statement of work, change order, support and maintenance, close-out,
  option), the page and its sha256, the signed file and its sha256, who signed when, effective date, term, renewal or
  notice rule, status: draft, sent, signed by one party, in force, notice given, ended. Amendments link to what they
  amend (a close-out moves a phase; an option becomes a change order).
- **Commitment:** who owes whom, clause references with the quoted words and line numbers, the due rule (monthly,
  weekly, on each event, on request, not due), what proves it, state (met, partly met, not met, unknown, not due),
  proof: links to evidence.
- **Evidence:** a record from somewhere else, kept by id and hash: an Operations week-in-evidence, an incident ticket,
  a restore receipt, a patch record, a support request, an invoice, a payment, an uploaded file (a signed scan, an
  email). Evidence is never retyped; the link is the proof.
- **Request (§4):** class (down, defect, modification), reported at, acknowledged at, answered at, result (on time,
  late, open), hours used, the ticket in Operations when there is one.
- **Hours ledger (§2, §3):** month, added, invoice, paid, good through, used on, lapsed, balance; change-order hours
  with "from balance" and "billed".
- **Invoice:** number, lines, each bound to a phase, a commitment or a month of hours; amount; terms; sent, paid,
  overdue; the balance block the agreement requires on every invoice (S13). **Payment:** date, amount, against which
  invoice.

**Lifecycle.** An agreement moves draft → sent → signed (per party) → in force → notice → ended, and only a signed
file with a hash moves it to "signed". Commitments are born from the agreement's clauses (the register's quoting rule:
every promise is a quote with a line range, checked against the page's hash, so a page edit after signing is caught).
A commitment's state is recomputed from its evidence by its due rule, never typed: "weekly restore test" is met when
the newest week-in-evidence holds a passing receipt under 8 days old.

**Screens**, in the house style (posters and one button; configuration only in a walkthrough and one Settings
screen):

1. **Agreements:** one card per agreement with its status, the next thing due and the count of unproven commitments.
2. **An agreement:** the paper's clauses down the page, each commitment's state beside its words, its evidence a click
   away, the signature block with both parties' states. A **Weekly statement** button.
3. **This week:** what is due, what is unproven, what is late, across every agreement.
4. **Requests:** the §4 clock per request, with Acknowledge and Answered buttons that stamp the time.
5. **Hours and invoices:** the ledger, a **New invoice** button that drafts from unbilled phases, hours and months,
   the printed invoice with the balance block, Sent and Paid buttons.
6. **Weekly statement:** the one document Ira and Ron receive, built from the week-in-evidence in fixed sentences, with
   the service-hour balance and "needed from you". Roger reads it and presses Send.

**Jarvis:** "what do we owe G-Squared this week", "is the restore test proven", "how many service hours does
G-Squared have", "which invoices are unpaid": read-only tools over the caller's own records, like Operations' tools.

**How Contracts reads Operations.** Both run on the Spark as the same person. Contracts declares Operations under
`dependencies.required.apps`, as Intelligent Processing does today, and reads the week-in-evidence through Operations'
own route under the person's authority. The exact rail (a route read under the person versus a scheduled service route)
is settled when it is built; both exist.

**Sending the statement.** The Spark's kernel has no email transport registered. Until one is (an administrator
SMTP relay or an email webhook at the kernel, `notify_api.rs` line 125), the statement goes out the way the monitor's
draft was designed to: the relay leaves a Gmail draft and Roger presses Send. That press is the dated record that a
person read it (S7).

## Part C: billing inside Contracts

Nothing separate: Part B's hours ledger, invoices and payments are the billing. What changes from today:

- The invoice is generated from the agreement's own lines and the ledger, not from a script in a scratch folder, and it
  carries the balance block every time (S13 "partly met" today).
- Paying an invoice moves the month's hour to "paid", which is when it starts counting (§2), and the twelve-month lapse
  is computed, not remembered (the hours log asks a person to do that by hand today).
- Provider cost (DigitalOcean) is a pass-through line from the provider's invoice as uploaded evidence (S19, S22).
- Collecting through `payments` (a PayPal invoice, a Stripe page) is one later button; the agreement says net 15 by
  email, which Roger does today.

## Part D: support requests over swarm-to-swarm (later)

Inside Intelligent Sales, under Admin, one button: **Ask ECSG for help**. It sends a delegation (ADR-194 envelope:
the person's words, the CRM's version and bundle, the last errors it can see, no data rows) to ECSG's swarm through a
connector on the customer's installation that holds a peer token Roger issued and can revoke. On the Spark, Operations
reads its peer inbox, files a support ticket, and Contracts opens a Request with reported-at stamped by the kernel. The
reply stamps answered-at. Hours used go to the ledger. S16 to S18 become measured instead of unknown, and Ben's FMCSA
request of this autumn would have a row.

Receiving is live in Operations today; sending needs the connector on the customer side and the button. It waits until
Parts A and B exist, because a request with nowhere to land is a ticket nobody sees.

## Build order and size

| Step | What lands | Size | Needs from Roger |
|---|---|---|---|
| 0 | Review and merge `ops/weekly-proof`; turn the relay on; start the off-site pull. This is already promised in today's email to Ira and Ron ("the restore test and one consolidated status email") and is not waiting on the design | Review 3 h; two 5-minute pastes | The Google paste (relay) and the key paste (off-site); both are prepared in the branch's READMEs |
| A | Prober delivers to Operations; installation source kind and Systems shape; silence expectation; rules for the 17 checks; week-in-evidence job; receipt intake; monitor alerts and digest retired | 35 to 45 h | Issue one producer token on the Spark (a confirmed click) |
| B | `contracts` package: model and migrations, loader from `internal/contracts/*.json` and the three logs, the six screens, Jarvis tools, weekly statement from the week-in-evidence; the monitor's weekly email retired | 60 to 70 h | Which address the statement goes from; the invoice header details from ECSG-IS-001 (not on this computer) |
| C | Invoices and payments inside Contracts, hours computed, provider pass-through | inside B, about 12 h of it | Nothing |
| D | Ask ECSG for help: peer token, connector on the customer side, the button, Request with the kernel's stamps | 15 to 20 h | Issue one peer token; approve the connector on G-Squared's installation |

About 115 to 140 hours in all, in four separate lanes that each leave something working. Subagents return on Thursday
2026-11-05 at 4 PM Central; A and B can run as parallel lanes from then. Each lane follows the store's rules: tests with
the feature, Test Lab registration, the gate, app-only delivery to the Spark, a handover file.

## What I would do first, unless told otherwise

Step 0 this week: review the weekly-proof branch properly (it is 11,700 lines I wrote in a hurry today), land it, hand
Roger the two pastes, and let the first Monday draft go out on 2026-11-09. Then Part A, because the week-in-evidence is
what Parts B and C are measured against.

## Open facts, to settle when built, not before

- Whether Operations' intake accepts a non-Alertmanager delivery shape through a mapping today, or needs the
  installation source kind first (`routes/intake.js`, `routes/ingest.js`).
- Whether the Spark's public hostname is stable enough for a producer that delivers every 5 minutes (the ingress chain
  broke once on reboot; `oshal-public-ingress-chain` in memory). A delivery that fails queues, so the risk is lateness,
  not loss.
- The package-to-package read rail for Contracts over Operations' evidence (a person-authority route read, or a
  scheduled service route).
- An email transport on the Spark's kernel, which would retire the Apps Script relay entirely.
