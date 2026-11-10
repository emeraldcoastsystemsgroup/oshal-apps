# Intelligent Operations

**Features at a glance:** see [docs/event-to-action/FEATURES.md](docs/event-to-action/FEATURES.md).
It lists every feature, where it is in the product, and its proof: live receipt, test, or the
input it still waits on. The judges' walk-through is in
[docs/event-to-action/DEMO.md](docs/event-to-action/DEMO.md).

Operations runs as an OSHAL experience slice. The first Kubernetes deployment uses native sign-in and roles, saved source mappings, durable alert records, historical pod/container topology and current-user connection status. See the [deployment and acceptance guide](deploy/README.md).
It uses the existing root-cause-analysis pipeline. File an incident as a ticket of type
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
- The Operations experience opens at `/api/ui/experiences/intelligent-operations/open`. Native `reader` and `operator` grants control access; records are scoped to the signed-in person.
- The incident workspace remains at `/apps/intelligent-operations/ui/index.html`.
  Overview and Incident tickets read the caller's authorized native ticket projection for Operations
  and Processing. Similar titles remain separate tickets. A finished workflow is not proof of recovery.
- The older incident workspace Source preview checks the draft JSON alert profile and explicit adapter field mappings entirely
  in the browser. Mapping errors block the preview; source and event ID remain envelope fields. It sends and saves
  nothing, does not authenticate a source, and does not resolve an asset or ingest an event.
- The experience saves immutable source/mapping revisions, original and normalized alerts with validation reasons, and timestamped Kubernetes captures. Exact payload retries reuse their record.
- **Remove a source.** Systems shows **Remove this source** on each monitored installation card, except a desk's own source: the first press says what goes and what stays, and the second press, below that note, removes it. `POST /api/intelligent-operations/sources/remove` with `{sourceId}` or `{name}` and `confirm: true` marks the caller's own source discarded, so Sources, Systems, the desks, the processing tick and the attention and systems summaries drop it (including topology scans recorded under the removed source), disables scheduled discovery if bound to the removed source, and refuses alerts sent to it with 410 Gone. Removing it from its Systems card also revokes, with the person's session, every producer token of Operations whose route names it; a revoke that fails is said in Monitor an installation with **Revoke again**. Nothing it recorded is deleted; a source registered in Sources comes back with its history when the same definition is saved there again. Jarvis does the same with `ops-remove-source`, held for the person's approval.
- **Device trust and headless enrolment (1.8.1).** Monitoring sources, readings, desks and history remain in their existing owner's scope; package routes never modify `oshal.current_sub`. On Systems, **Monitor an installation** adds headless device self-registration (`--register`, Windows `install-windows.ps1`, macOS `install-macos.sh`), configuration packs (`--config-pack alertmanager|prometheus|otel`), a pending-device approval queue showing each device's Ed25519 public key fingerprint and editable source IP/CIDR allow-list (`POST /api/v1/producer-tokens/{id}/approve`), and per-installation allowed-address controls (`POST /api/v1/producer-tokens/{id}/addresses`).
- **Monitor an installation** (oshal-kernel ADR-216). The manifest's `producers.enroll` lets a server start an enrolment into Operations; the person approves its code on the kernel's `/enroll` page with **Monitor this installation**. The kernel then runs `POST /api/intelligent-operations/installations/enroll` (`{name, client}`, records.write) as that person: it creates the source `urn:operations:source:<name>` (environment `<name>`), or reuses the person's source of that name with its history, saves the Alertmanager mapping (host, label `instance`, scope `<name>`), publishes the starting policy unless one is bound (one rule per alert type, critical captured and warning recorded, the lists that were in the kernel's `wire_producer.py`; a desk's own source gets its desk's default), and adds the source to processing without turning on a schedule the person switched off. It answers the one route the server's producer token will name: `/ingest/alertmanager/<source id>`, or `/ingest/otlp/<source id>` for an OpenTelemetry Collector (`client.agent` `otel`). A removed source is never reused. A processing list at its 32 sources and a detection engine that cannot publish are refused before anything is written. Systems shows the one-line installs for this installation's address, **Download an enrolment file** (the kernel's confirmed offline enrolment, saved as `oswarm-enrollment.json`), the servers approved but not yet reporting, and on each card when and with what its server was enrolled and when its producer token expires.
- **OpenTelemetry** (ADR-216 decision 6). `POST /api/intelligent-operations/ingest/otlp/<source id>` (records.write) takes an OpenTelemetry Collector's OTLP/HTTP JSON (`encoding: json`) through the kernel's producer door, which decompresses it, bounds it to 256 KiB and passes `x-oshal-producer-path` (`/v1/metrics`, `/v1/logs` or `/v1/traces`) when the collector used the door's paths; none means metrics. It reads `system.filesystem.utilization` at `/` (else `system.filesystem.usage`), `system.memory.utilization` (else `system.memory.usage`), `system.cpu.utilization` (busy is 100 minus idle, averaged over the CPUs), `system.cpu.load_average.5m`, `httpcheck.status` (up is a 2xx) and `httpcheck.duration` onto the heartbeat's keys `disk_used`, `memory_used`, `cpu_used`, `cpus`, `load5`, `site_up` and `site_seconds`, and records one heartbeat per delivery through the same path as `InstallationHeartbeat`, so the card, the charts, the telemetry banks and `InstallationSilent` work unchanged; checks a collector cannot read (Postgres, containers, backups) say "Not reported by its collector" and do not count against its health. The collector has no rule engine, so Operations evaluates `SiteDown`, `SiteSlow`, `DiskFull`, `DiskHigh`, `MemoryLow` and `LoadHigh` per host with the Prometheus rules' names and windows (5, 10, 10, 30, 10 and 15 minutes) and thresholds (`platform-ops.default.json`'s disk, site and load figures; memory under 5% of the total, at least 0.1 GiB, as the installer renders it), admits firing and resolved events through intake and the source's policy, and repeats a firing alert every 4 hours. Logs and traces answer `200 {}` and are ignored; a removed source answers 410, which ends the token at the door. Each card shows the token's last delivery and status, **Rotate token** (the kernel's `POST /api/v1/producer-tokens/{id}/rotate`; the server picks it up within 5 minutes) and **Disconnect** (two presses: it revokes the producer tokens naming the source, then stops watching it with `{stopWatching: true, disconnect: true}`, keeping its chart history and readings, so no `InstallationSilent` follows).
- Automated source intake, continuous discovery and automatic external ticket synchronization remain planned. Infrastructure execution exists only as the response stage (ADR0037): the accepted answer's generated `remediate.sh`/`verify.sh`/`rollback.md`/`verify.md` are extracted byte-exact, approved as exact artifacts for one observed pod, run once through the person's own confirmed Kubernetes connection, and verified against a resolved signal before the ticket is updated. Captured topology is historical, with explicit readiness and unknown states.
- It replaces Issue RCA and Incident Remediation, which the platform unified into it (the header of
  the platform's `swarm-apps/intelligent-operations.yaml`). SAP Incident is not part of it, and it
  is not yet ported, so it stays turned off. Its manifest (`swarm-apps-incident/sap-incident.yaml`)
  and its `sap-rca-specialist` persona are in the archived core trunk at commit `41da137`, not in
  the current platform tree or either store. That persona grounds every claim in the `sap-runbooks`
  corpus, which an operator populated from SAP documentation; it is not one of the knowledge
  collections this installation searches. It also searched that corpus and the web from a shell.
  Until it is ported, file SAP incidents here.
  Intelligent Processing builds its alert queue on this application's bots.

## Event to action delivery

The [project plan](docs/event-to-action/PROJECT-PLAN.md) defines milestones, dependencies,
test scenarios and acceptance. [Implementation status](docs/event-to-action/IMPLEMENTATION-STATUS.md)
records actual progress separately from the [design proposal and Visio drawing](docs/event-to-action/README.md).
The [local Kubernetes lab](lab/README.md) provides disposable services, monitoring and bounded noise scenarios.
The [alert profile](contracts/README.md) describes the local source preview and its limits.
The separate [interactive UX prototype](prototype/README.md) explores the full proposed journey
with synthetic data, including data decisions, topology, user-bound tool connections, external ticket
synchronization, scoped access, partial packets and invalidated approvals.
The [ADR log](docs/event-to-action/DECISIONS.md) records accepted architecture choices and open gates.

Run the foundation contracts from the store root:

```bash
node --test intelligent-operations/tests/package-contract.test.cjs intelligent-operations/tests/source-contract.test.cjs intelligent-operations/tests/surface-browser.test.cjs
```

The browser contract requires Chromium and the pinned store toolchain. It serves the shipped
assets with explicit loopback ticket fixtures; it does not certify installed kernel authorization
or provider access. All foundation suites are registered in Test Lab and the store CI command.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **192 / 768 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| incident-rca | incident ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->

New manual imports commit a delivery, attempt and pending processing item atomically. The source
URI and event ID identify a delivery; changed content under that identity is a visible conflict.
Data & decisions exposes attempts and preserves historical imports separately. Background
collection, symptom suppression and automatic action are not enabled by this intake increment.

Run the complete package contracts with `node --test intelligent-operations/tests/*.test.cjs`.
The SQL cases require `OSHAL_TEST_POSTGRES` pointing to a disposable PostgreSQL instance on
`127.0.0.1:35689` and the pinned `scripts/toolchain` dependencies/Chromium. They create isolated
fixture databases and roles; production database endpoints are refused. See implementation status
for the separate source-test and native-installation evidence.

## The four desks

Since 1.5.0 Intelligent Operations has four monitoring desks over its one pipeline, as spec
`lanes/monitoring-four-desks-spec-2026-11-08.md` asks: **App Ops**, **Sec Ops**, **Platform Ops** and
**Dev Ops**, four tabs after Overview. A desk is a saved source, one percolation policy, one
notification topic and one authorization composite; the intake, the detection engine, correlation,
runbooks and the rail are shared.

| Desk | Source | Topic | Role | Critical rules (capture) | Warning rules (record) |
|---|---|---|---|---|---|
| App Ops | `spark/app-ops` | `app-attention` | `ops-app` | PackageScheduleRefused, PackageScheduleMissed, PackageCostDurabilityFailed, PackageInstallFailed | PackageErrorBurst, PackageEgressSpike, PackageVersionDrift, PackageScheduleSkipped |
| Sec Ops | `spark/sec-ops` | `security-attention` | `ops-security` | SignInFailureBurst, RootTransferred, AdminTierGranted, ProducerTokenIssued, DoorSeatsExhausted, UncommittedCodeInProduction, PlainHttpListenerPresent | KernelRefusalStorm, RefusalCodeNew, TokenRevoked, LocationStepUp |
| Platform Ops | `spark/platform-ops` | `platform-attention` | `ops-platform` | SiteDown, KernelMetricsUnreachable, ContainerMissing, ContainerRestarting, ContainerOutOfMemory, DiskFull, MemoryLow, PostgresDown, MonitoringBlind, PrometheusCannotStore, InstallationSilent, SlotDown, TunnelDown | SiteSlow, DiskHigh, LoadHigh, RebootRequired, SecurityUpdatesPending, ContainerFactsStale, GpuThermal, EngineLinkStale |
| Dev Ops | `spark/dev-ops` | `release-attention` | `ops-release` | ReleaseRolledBack, ReleaseLabelMismatch, ReleaseVerifyFailed | ReleasePromoted, TrialBehindDev, DirtyTreeOnHost, PublishGateRed |

**Configured on activation.** The defaults ship in `deploy/policy.<desk>.default.json` (one rule per alert
type, `capture: true` on the critical column, a sliding 900-second window). The processing schedule
`operations-process-recorded-alerts` runs as the person it started for; on its tick it creates each desk's
source (`urn:operations:source:spark/<desk>`, environment `spark/<desk>`), maps it for Alertmanager
(`host`, label `instance`, scope `spark/<desk>`), publishes the default policy through the detection engine
and adds the source to the processing list, turning evidence capture, correlation and investigations on when
this is the person's first configuration. A desk already present is left as the person edited it; with the
engine down the desk stays pending, the phone hears "desk activation could not finish" once per failing
streak, and the next tick with the engine back finishes it. The source `read` of a fresh person's first
tick is therefore four engine publishes and nothing else: no message, no ticket, no connector
(`tests/first-use-processing.test.cjs`).

**Configurable in the tab.** Rules shows the bound policy with On and Capture per rule, adds a rule by alert
type, restores the defaults; saving publishes a new generation revision-checked against the binding and needs
the desk's `desk.<x>.write` permission. A query refined in Data pipeline survives a toggle here.

**Topics.** The four topics are registered for the person the first time a desk tab opens, through the
kernel's own `POST /api/notify/prefs` with `channel: none` (the sandbox cannot write a person's notification
preferences; the browser does it with the person's session). The kernel lists a topic with no channel as
`channel: none, enabled: false` until the person picks a channel on Notifications (`/cockpit/tools/notify.html`),
which the Settings panel links. When the tick tells the phone about a symptom from a desk's source, it sends
the same news to that desk's topic with the desk's name leading the message; `operations-attention` keeps
everything, as the umbrella the `ops-attention` tool reads.

**Composites.** `authorization.yaml` declares `desk.app`, `desk.security`, `desk.platform`, `desk.release`
(read, viewer) and `desk.<x>.write` (write, editor); roles `ops-app`, `ops-security`, `ops-platform`,
`ops-release` each grant `app.open` and the desk's two permissions; `operator` holds all. `GET /desks/<desk>`
and its Jarvis tool bind to `desk.<x>`, `POST /desks/<desk>/policy` to `desk.<x>.write`. A person holding only
`ops-security` opens the page, reads Sec Ops and saves its rules, and is refused on every other desk
(`tests/desks-authorization.test.cjs`).

**Screens.** Each tab has Firing now (symptoms newest first, a critical one opening its investigation ticket),
Sources (the desk's source with its standing, last heard, report count and the heartbeat's checks), Rules,
Runbooks (the owner's runbooks for the desk's alert types) and Settings (topic and channel, source id and URI,
ingest route, the producer tokens the kernel lists for that route, last delivery, and the host threshold file
`~/.local/state/oshal-native/monitoring/<desk>.json` shown as its path with the last snapshot a heartbeat
carried in its `thresholds` annotation, or that none was reported: the package reads no host file). Jarvis
tools `ops-app-desk`, `ops-security-desk`, `ops-platform-desk`, `ops-release-desk` read the same route.

**Not in this package.** The probes and consumers that post to the desks (spec sections 6.1 to 6.4: the
App Ops, Sec Ops and Dev Ops consumers, the Platform Ops stack on the Spark, the promotion script) and the
kernel's sign-in audit record (section 7) are kernel-side work; a desk with no producer shows its empty
state and raises nothing.

## Graph and processing inspection

Open `/cockpit/?app=intelligent-operations` for the YAML-defined Operations toolbar.
Graph explorer searches recorded source-owned nodes and opens their directed neighbors.
Data pipeline shows the latest returned evaluation cohort passing stored rules and noise
reduction, with event drill-downs and persisted correlation groups. The combined action
correlates admitted/escalated survivors; degraded graph evidence is explicitly labeled.
These are bounded manual evaluations, not continuous ingestion or automated healing.
See [ADR0013](docs/event-to-action/adr/0013-inspectable-processing-and-graph.md).

Background evaluation is opt-in per saved source revision with a published policy.
The personal minute schedule starts on first use by a person who holds Operations
write permission, under that person’s own authority. Use Data pipeline → Background
processing to enable evaluation and save the source selection. A paused or removed
native schedule stays stopped across later reads and releases; resume it explicitly
in Jobs when wanted. No administrator credential or another owner’s authority is copied. Disabling processing fences in-flight decision commits;
failed work receives bounded retries and an explicit recovery action.

Starting this job activates the four monitoring desks for the person (see "The four desks") and
otherwise enables no source evaluation, discovery, evidence capture, correlation or investigation by
itself. With nothing delivered, the ticks produce no work or messages. An
independently configured installation watch remains separate from the evaluation
checkbox: its pending notices can still be delivered while evaluation is disabled.
Pause or remove the native job in Jobs to stop all future ticks. A later application
read or release respects that stop. The first-use job uses the native default limits
(1 microdollar per run, 1,000 per day, 60-second timeout), not another owner's limits.
See
[ADR0014](docs/event-to-action/adr/0014-native-background-processing.md). Source tests and local native scheduled-run/pause/resume acceptance pass.
See implementation status for the exact source and runtime evidence.

The [daily operator guide](docs/event-to-action/OPERATOR-WORKSPACE.md) explains Operations attention, the Systems tree, pipeline tabs, source mappings and bounded-data labels.
