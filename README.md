# oshal-apps — the OSHAL app store

Installable **app packages** for [OSHAL](https://github.com/emeraldcoastsystemsgroup/oshal).
This repo is the *store*: each top-level folder is one self-contained app package that a
swarm installs from git and hot-loads — **nothing is compiled into the swarm's core image**.

The model is [ADR-085](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/085-remote-app-packages-and-registries.md):
a base swarm ships empty of apps (kernel = ticket system, loader/registries, auth, baseline
bots, APM); you grow it by installing packages from here. This is the same git-subdir
marketplace shape OSHAL already uses for connectors (ADR-067).

## Build an extension

**[BUILDING-EXTENSIONS.md](BUILDING-EXTENSIONS.md)** is the full, self-contained authoring guide
(readable by a human or an LLM) — every `oshal-app.yaml` feature, the routes rules, the
dependency lifecycle, and the CLI. Start from the example, read the reference app.

See [APP-HOME-EXTRACTION-PLAN.md](APP-HOME-EXTRACTION-PLAN.md) for the per-package configurable Home rollout and source assessment.

**Turn the gate on, once per clone:** `git config core.hooksPath .githooks`. This repo is private,
so Actions minutes are billed — `store-ci` is `workflow_dispatch`-only, and `.githooks/pre-push` is
the only automatic gate left. It runs `bash scripts/store-ci-local.sh`, which mirrors every workflow
job against your working tree in about two minutes with no cloud and no secrets. Until you run that
one command, **nothing checks your push**. See
[CONTRIBUTING.md](CONTRIBUTING.md#turn-the-gate-on--once-per-clone).

## Apps

<!-- apps-table:begin (generated - run `node scripts/gen-readme-apps-table.mjs`; do not edit by hand) -->

All **87 packages**, shelved by ADR-097 suite. Versions and status come from
[`marketplace.json`](marketplace.json), which mirrors each package's `oshal-app.yaml`.

### AI Productivity

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Business** | [`business-experience/`](business-experience/) | 1.0.4 | ready | Your schedule, projects, documents and explicitly connected business applications. |
| **Calling Assistant** | [`calling-assistant/`](calling-assistant/) | 0.1.14 | ready | Configurable phone tasks with a reusable tool, operator bot, workflow, audio tests and call reports. |
| **Capability Ideation** | [`capability-ideation/`](capability-ideation/) | 1.0.1 | ready | A ticket queue for Capability Ideator: describe a business process and get up to three sourced tool or integration proposals; opens Capability Ideator's review screen. |
| **Intelligent Communication** | [`email-summarizer/`](email-summarizer/) | 1.8.1 | ready | Your inbox, calendar, social channels and day in one surface. |
| **Fantasy Football** | [`fantasy-football/`](fantasy-football/) | 0.4.0 | ready | Manage the fantasy football team you actually have. |
| **Feeds** | [`feeds/`](feeds/) | 1.2.6 | ready | Your connected message feeds in one place - live stream, activity trends, hot channels, and trending topics over your own Slack messages, with a curator bot that answers 'what did I miss'. |
| **Identity Hub** | [`identity/`](identity/) | 1.2.7 | ready | Every account you've connected, in one place - click to jump straight into Gmail, LinkedIn, your smart-home app, and more, reconnect a login that's expired, or connect a new one, plus an optional access review that flags what needs attention. |
| **Intelligent Sports** | [`intelligent-sports/`](intelligent-sports/) | 1.0.3 | ready | One front door for sport: manage your own fantasy football team, and follow a team's next game with an odds maker that is graded on closing-line value before it may stake anything. |
| **Marketing Engine** | [`marketing-engine/`](marketing-engine/) | 0.5.8 | ready | Takes a built oshal product to traffic, users, and revenue: campaign board with stage-gated intake, per-channel consent (explicit opt-in, default OFF), UTM-tagged links, a deterministic metrics scorecard, experiment registry, budget proposals a human approves, and weekly review tickets worked by inline concierge bots only after human approval. |
| **Marketing** | [`marketing-suite/`](marketing-suite/) | 1.1.3 | ready | One front door for taking a product to market: the campaign board with its consent gates and weekly scorecard, the compose desk and scheduled calendar, your social presence and the signals you follow, and the graphics, decks and clips a launch needs — with a setup page that shows what is armed and what still needs you. |
| **Orbit** | [`orbit-experience/`](orbit-experience/) | 1.1.7 | ready | Explore your admitted applications, relationships and recent work in the Orbit map. |
| **Payments** | [`payments/`](payments/) | 1.1.5 | ready | Take payments through your own Stripe, Square or PayPal account — Stripe makes a hosted payment page from your own pasted key (test or clearly marked LIVE), Square runs a card charge, PayPal sends an invoice. |
| **Phone & Device Control** | [`phone-control/`](phone-control/) | 1.18.0 | pending | Unified live-image console for computers (pointer in touch or mouse mode, keyboard, special keys, monitors, file transfer, clipboard, lock on end), RDP host setup with a port check, Android phones and Fire TV / Android TV over Wi-Fi, and iPhone AirPlay screen mirroring (UxPlay) with calibrated Bluetooth pointer & keyboard (OSHAL-KB), dedicated Phone/TV and Connection Concierge, screenshots, session recordings, quality presets, chat and whiteboard overlays. |
| **AI Office** | [`presentations/`](presentations/) | 2.20.3 | ready | Edit PowerPoint slides, Word documents and Excel workbooks in place, with selectable content, typed properties, revision history, real Office exports and a pinned Concierge. |
| **Shopping** | [`purchasing/`](purchasing/) | 1.4.8 | ready | AI shopping concierge — search Walmart, build lists, learn your preferences, find deals, and hand off a ready-to-checkout cart you complete on the retailer's site. |
| **Social** | [`social/`](social/) | 1.7.3 | ready | Draft, review, and publish across your networks from one surface - the comms bot drafts a post in your voice, you approve, and it publishes on your per-user LinkedIn / X / Facebook token (nothing posts until you click Publish). |
| **Storage** | [`storage/`](storage/) | 1.4.2 | ready | Your storage hub: choose where OSHAL saves generated code vs files (GitHub / Dropbox / OSHAL-local), upload files to your connected cloud storage (Dropbox, Google Drive, OneDrive, GitHub, or OSHAL-local), and browse your files. |
| **Studio** | [`studio-experience/`](studio-experience/) | 1.1.7 | ready | Applications, recent work and conversations in your established Studio workspace. |
| **Switchboard** | [`switchboard/`](switchboard/) | 0.7.0 | ready | Every line, one board. |
| **System** | [`system/`](system/) | 1.0.2 | ready | One desk for account infrastructure: Identity Hub, Storage, and Cloud accounts — each already its own app, gathered here so you don't have to hunt the full catalog. |

### AI Knowledge

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Intelligent Career** | [`career-hunter/`](career-hunter/) | 1.60.9 | ready | Search employers' public job feeds, score selected recent openings against your private career profile, and save jobs to your board. |
| **Classroom** | [`classroom-experience/`](classroom-experience/) | 1.0.6 | ready | Classwork, class schedules and personal learning through existing school roles and roster rules. |
| **Intelligent Career** | [`intelligent-career/`](intelligent-career/) | 1.1.13 | ready | One front door for your job search: the board, search, resume and strengthen tools, your profile picture, and your LinkedIn and Facebook presence — with a setup page that shows what is connected and what still needs you. |
| **Job Apply** | [`job-apply/`](job-apply/) | 1.1.10 | ready | Submit an approved, packet-ready job application by driving your real browser on a desktop worker node — push a ticket, it queues, the career-hunter worker submits it, and the ticket passes or fails. |
| **Ambient Recall** | [`person-model/`](person-model/) | 1.2.4 | pending | Ask what someone said across your own ambient transcripts, maintain your continuously learned personal profile (identity, address, contact details, preferences, and household facts), and build Eavesdrop Business Cards for people in your conversations — exact counts, verbatim quoted receipts with assistant-voice playback, open asks and commitments beside their source quotes, per-person consent controls, and weekly topic trends. |
| **Print Ingest** | [`print-ingest/`](print-ingest/) | 0.4.0 | ready | An inbound virtual printer for the swarm: a document printed to the oshal virtual printer, or sent to its inbox, is filed into the swarm's knowledge, never printed on paper. |
| **World Intelligence** | [`world/`](world/) | 1.4.8 | ready | Shared world intelligence (ADR-061 Layer B) - multi-source news feeds classified into a bias-aware sentiment graph read through oshal's own observed outlet ratings (each source's lean and reliability against the other sources, with the counts and dates behind it), entity co-mention graph, and historical series. |

### AI Finance

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Daily Trade Recap** | [`daily-trade-recap/`](daily-trade-recap/) | 1.3.9 | ready | Review saved trade-recap work and receive owner-qualified recorded-report updates in Jarvis. |
| **Finance** | [`finance/`](finance/) | 1.6.3 | ready | Your household money in one place: link your banks and brokerages via Plaid to see balances, net worth and spending, with a plain-English brief. |
| **Finance** | [`finance-experience/`](finance-experience/) | 1.0.1 | ready | Opens Finance as one application, with your money, trades, markets and world events and the work running on them. |
| **Futures Research** | [`futures-research/`](futures-research/) | 1.1.1 | ready | Opt-in, tool-less queued review of owner-scoped Futures studies. |
| **Intelligent Trades** | [`trading/`](trading/) | 1.57.0 | ready | Your stock portfolio and trading desk. |
| **Kalshi Prediction Markets** | [`kalshi/`](kalshi/) | 1.9.1 | ready | Browse Kalshi's open event contracts with a verdict on every one, and ask the quant why a bet is bad or good. |
| **Payroll** | [`payroll/`](payroll/) | 2.3.7 | ready | Run payroll for your team, ADP-style, then pay, file and RECONCILE from the same place. |
| **Sports Edge** | [`sports-edge/`](sports-edge/) | 0.12.1 | ready | Follow a team and really know its next game. |
| **Venture Plan** | [`venture-plan/`](venture-plan/) | 1.5.4 | ready | Turn an idea into the venture document set a real decision needs — bill of materials, landed cost, channel margin, profit, cash and working capital, schedule, org, funding ask. |

### AI Creative

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Animatronics** | [`animatronics/`](animatronics/) | 0.2.6 | ready | The motion layer for a Halloween prop or any servo animatronic. |
| **Audio Studio** | [`audio/`](audio/) | 1.2.1 | pending | Multitrack audio workstation, stem isolation, DSP effects, dynamic mixing, and mastering with Jarvis and concierge voice assistant. |
| **Brand Graphics** | [`brand-graphics/`](brand-graphics/) | 1.4.1 | ready | Edit and save brand briefs with an AI partner, retain generated evidence, and hand the source into document and graphics editing. |
| **Camera Ops** | [`camera/`](camera/) | 1.2.1 | ready | Remote camera control — connect to a GoPro (and other Wi-Fi/USB cameras) and drive it: start/stop recording, take photos, switch modes, change settings, and run a low-latency preview. |
| **Create** | [`create/`](create/) | 1.20.1 | ready | Edit layered image and vector documents with selectable shapes, rich appearance controls, real exports and a shared AI editor workspace. |
| **Creative Studio** | [`creative-studio/`](creative-studio/) | 1.5.1 | ready | Edit and save story briefs and selectable storyboard scenes, with revision history, an AI partner and real editing handoffs. |
| **Dungeon Master** | [`dnd/`](dnd/) | 0.22.4 | ready | Play D&D with an AI Dungeon Master on a cinematic shared board: claimed heroes and visible AI companions follow an explicit move, action, target, dice, result, and advance loop with natural narration, saved characters, multiplayer join codes, playback, and rewind. |
| **Game Show** | [`game-show/`](game-show/) | 0.13.3 | ready | TV-style AI game night: Family Feud, Jeopardy, Wheel of Fortune and Whammy, each with its own television set — podium characters, sound cues and opening titles. |
| **Games** | [`games/`](games/) | 1.1.1 | ready | A focused cockpit toolbar with direct launchers for the AI Dungeon Master and Game Show. |
| **LoRA Studio** | [`lora/`](lora/) | 1.10.4 | ready | Owned character identity and dataset captions with in-place editing, worker-confirmed synchronization and guarded training. |
| **Motion Studio** | [`motion-studio/`](motion-studio/) | 0.4.2 | ready | Edit saved motion compositions with selectable layers, native properties, inline captions, keyframes, masks and photos. |
| **PDF Workbench** | [`pdf-workbench/`](pdf-workbench/) | 0.4.1 | pending | Select and edit actual PDF text, images and shapes with owned source assets, forms, revision history and native PDF exports. |
| **Portrait Studio** | [`portrait-studio/`](portrait-studio/) | 1.17.6 | ready | Edit face crops and generation settings in a saved source project, retain original photos, and hand rendered results into the image editor. |
| **Publishing Studio** | [`publishing-studio/`](publishing-studio/) | 0.5.3 | pending | Editable page layouts, text stories and objects with native Typst/PDF output and complete manual/AI undo history. |
| **Pumpkin** | [`pumpkin/`](pumpkin/) | 1.4.0 | ready | Animated talking jack-o'-lantern Halloween prop - project a glowing procedural pumpkin face into an inflatable, with a lip-syncing mouth. |
| **Scene Studio** | [`scene-studio/`](scene-studio/) | 0.4.4 | ready | Edit Blender objects, materials and keyframes, and Godot scene-node transforms, within saved native projects. |
| **Video Studio** | [`video/`](video/) | 1.14.1 | ready | Edit video clips, captions, audio and transforms on a saved timeline; export real video and bring generated clips into the editor. |
| **Vids Studio** | [`vids/`](vids/) | 1.6.6 | ready | Saved editable video briefs with native AI source operations, recorded clip preview and handoff to the Video editor. |

### AI Home & Lifestyle

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Calendar Preparation** | [`calendar/`](calendar/) | 1.2.3 | ready | Sync your upcoming primary-calendar events explicitly, prepare reviewed gift, meal, travel and meeting plans, and receive an opt-in cited brief before a meeting. |
| **Commons** | [`commons-experience/`](commons-experience/) | 1.1.7 | ready | Your applications, shared rooms and conversations, with existing household and team boundaries. |
| **Drone Ops** | [`drone/`](drone/) | 1.4.0 | ready | Drone fleet automation control - arm, take off, fly waypoint missions, and coordinate multi-drone fleet plans inside a hard geofence with deterministic separation checks. |
| **Eats** | [`eats/`](eats/) | 1.5.5 | ready | AI food-delivery concierge: the real restaurants near your delivery address from Google Places, your tastes and allergies remembered, and a one-tap hand-off into Uber Eats at your address with the restaurant you chose. |
| **Smart Home** | [`home/`](home/) | 1.8.0 | ready | Control your smart home by chat. |
| **Home** | [`home-experience/`](home-experience/) | 1.0.7 | ready | Your schedule, shopping list, household updates and explicitly connected applications in the established Home layout. |
| **Jarvis** | [`jarvis-experience/`](jarvis-experience/) | 1.1.6 | ready | Your assistant briefing, conversations, agenda and admitted applications. |
| **Life** | [`life/`](life/) | 1.0.2 | ready | One desk for everything lifestyle: movies & TV, music, food delivery, rides, shopping, travel, payments, and the weekly AI Bake-Off — each already its own app, gathered here so you don't have to hunt the full catalog for them. |
| **Little Monsters** | [`little-monsters/`](little-monsters/) | 1.9.2 | ready | SAT and ACT Study Lab with a shared question bank, private answer and timing history, progress dashboard, saved topic training, monster-taught lesson videos and a Jarvis study coach, plus class lectures, flashcards and tutoring. |
| **Movies & TV** | [`movies/`](movies/) | 1.1.7 | ready | AI movies & TV concierge — search films and shows, see where they're streaming, watch trailers, get recommendations, build a watchlist, and find showtimes. |
| **Get a Ride** | [`rides/`](rides/) | 1.5.8 | ready | AI Uber Rides concierge on a real map — set pickup and destination by pin or address, see the measured distance, compare ride types with labelled fare estimates, and hand off a ready deep link you confirm and pay in your own Uber app. |
| **Spaces** | [`spaces/`](spaces/) | 0.10.1 | ready | Turn a real space into an explorable 3D scene: film a walkthrough (or import an iPhone/LiDAR/drone capture) into a Gaussian-splat scene you walk in a WebGL viewer, get live walk/pan guidance while you film, mint a phone-pairing token for LiDAR ingest, paint Wi-Fi coverage onto the map, and fly a sim-drone scan orbit. |
| **Spotify** | [`spotify/`](spotify/) | 1.1.8 | ready | AI music concierge — search your Spotify, see what's playing and your playlists, get recommendations from your taste, and build playlists on your account. |
| **Travel** | [`travel/`](travel/) | 1.3.3 | ready | AI travel concierge (ADR-059) - search real flights (Duffel), see an honest price read from the swarm's shared price history, watch routes for a fare drop, and book via a deep-link handoff; hotels and cars are deep-link handoffs today. |
| **Home Workspace** | [`workspace/`](workspace/) | 1.0.1 | ready | One home ribbon for Smart Home, Switchboard, Social, Intelligent Career, Storage and Video Studio. |
| **Kid Lens** | [`youtube-kids/`](youtube-kids/) | 1.4.0 | ready | Upload your YouTube Takeout watch history and get a parent-friendly brief on what your kid is into — top interests, decoded channels, gift ideas, conversation openers. |

### AI Engineering

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Aero Lab** | [`aero-lab/`](aero-lab/) | 1.4.5 | ready | Persistent-flight design lab - shape a solar-endurance aircraft (span, area, aspect ratio, battery, cells, buoyancy fraction, site, season), run it through the validated aerosim engine (wing polar, 24 h energy limit cycle, admissibility screen), read the verdict with real plots (SOC trace, polar, drag buildup, margins), and download the build package (STL / DXF / BOM). |
| **AI Bake-Off** | [`bake-off/`](bake-off/) | 1.1.9 | ready | Race one job across every AI lane you already have, grade every output on the shared quality judge, and get the cheapest lane that still clears your quality bar. |
| **CAD Studio** | [`cad-studio/`](cad-studio/) | 0.5.1 | ready | Build parametric CAD parts with selectable base and feature properties, native geometry rebuilds and STEP exports. |
| **Capability Ideator** | [`capability-ideator/`](capability-ideator/) | 1.1.9 | ready | Discover sourced tools and integration opportunities for business processes, grounded in installed applications and explicit connection requirements. |
| **Circuit Lab** | [`circuit-lab/`](circuit-lab/) | 0.9.3 | ready | A local circuit and mechanism lab the swarm can drive. |
| **Cloud** | [`cloud/`](cloud/) | 1.3.1 | ready | Inspect and operate your Google Cloud by chat. |
| **Bot Forge** | [`codex-packer/`](codex-packer/) | 1.3.1 | ready | Describe a task you want automated and the Forge interviews you (the task, its input, what it produces, how you know it worked, the trigger, what it may change and what it must not keep), then drafts a single-purpose application and lets you Inject it live into your personal scope after reviewing a clear Permission Preview — with zero git commit or manual App Loader step required. |
| **Design Studio** | [`design-studio/`](design-studio/) | 0.4.10 | ready | The design-to-build process as one application, for anything. |
| **Developer Workspace Index** | [`dev-workspace-index/`](dev-workspace-index/) | 0.2.5 | ready | Build a bounded, dev-console-only index of the local OSHAL documentation and ask Jarvis for cited developer references. |
| **Drone Relay** | [`drone-relay/`](drone-relay/) | 0.5.1 | ready | Design a chain of mini drones that relays commands and telemetry drone to drone so one can work beyond the base link: size the hop from a link budget on ESP-NOW, Wi-Fi Direct, Wi-Fi mesh, BLE, LoRa or Wi-Fi HaLow, place the relay slots and spares, fail a relay in a simulated scenario and read how long the tip was out of reach and when the chain closed the gap and was restored — with the on-board and controller rules a companion firmware carries, and the signed, source-routed envelope shown hop by hop. |
| **Embodied Swarm** | [`embodied/`](embodied/) | 0.20.3 | ready | Drones are the eyes, a detached rolling six-axis arm is the hands, the swarm plans and you hold command — and the machine knows only what its sensors have seen. |
| **Hello OSHAL** | [`hello-oshal/`](hello-oshal/) | 1.2.5 | ready | The minimal working example — one route, one ribbon tile. |
| **Intelligent Operations** | [`intelligent-operations/`](intelligent-operations/) | 1.9.1 | ready | Watch monitored installations and recorded server health, inspect incident tickets, and review alert evidence in the Operations workspace. |
| **Intelligent Processing** | [`intelligent-processing/`](intelligent-processing/) | 1.1.0 | ready | A queue for self-monitoring alerts that need a root cause, run on Intelligent Operations' RCA pipeline. |
| **Ocean Lab** | [`ocean-lab/`](ocean-lab/) | 1.3.5 | ready | Ambient-energy design lab — model a machine that moves on tidal and current flow or on the soil thermal gradient, size its rotor with real blade-element momentum theory, and export printable geometry. |
| **Sat Ops** | [`sat-ops/`](sat-ops/) | 1.2.5 | ready | Satellite fleet plane - a 3D orbit console with fleet attitude telemetry (MEKF health, wheel momentum, ADCS mode), SGP4 ground tracks and pass windows, pairwise conjunction screening, and an approval-gated command console (point / detumble / desat / safe). |
| **Scan to Print** | [`scan-to-print/`](scan-to-print/) | 0.10.1 | ready | Scans and 3D-prints objects. |

<!-- apps-table:end -->

## What a package contains

- `oshal-app.yaml` — the manifest (bots, toolbar/UI, routes, migrations, workflow, theme,
  `settings`, `dependencies`, `provides`/`uses`). All paths package-relative.
- `personas/` — the app's bots' personas (bundled).
- `routes/` — compiled-JS Express routes, mounted in-process at activation (ADR-085 P1).
- `migrations/` — the app's own schema, applied on install.
- `ui/` — surfaces + shared CSS. `theme` selects an existing cockpit skin.
- `tools/` — the app's bundled tools.

## Catalog

[`marketplace.json`](marketplace.json) is the catalog index — the list the swarm's App
Registry reads to browse/install (each entry is a git-subdir `source`).

## Installing

**Today's working path is the CLI** (from an OSHAL checkout, where `scripts/oshal-app.js` lives):

```bash
node scripts/oshal-app.js install <app-folder>        # e.g. portrait-studio
```

It sparse-clones the pinned git-subdir, validates the package, resolves `dependencies.apps`
npm-style (fail-closed), copies it into the swarm's `deployed-apps/` and stamps
`.oshal-install.json` provenance (repo + ref + sha). The swarm auto-loads `deployed-apps/` on
boot, or hot-load via `POST /api/swarm/apps/load {path}`.

Two deployment notes:
- The install target is `$CLINE_WORKSPACE_ROOT/deployed-apps`. On the Docker stack that dir
  lives inside the `oshal_workspace` volume, and the api container holds **no GitHub
  credentials** — so run the install on the host with `--dest <staging-dir>`, `docker cp` the
  result into `oshal-local-api:/app/workspace-shared/deployed-apps/`, and restart the api.
- `POST /api/swarm/apps/install-remote` (one-call install from the catalog) is **planned, not
  built** — see the swarm-store migration plan (D7) in the OSHAL repo.

Uninstall is dependency-aware (reverse-dep check + orphan-only removal — never auto-cascade):
`node scripts/oshal-app.js uninstall <name>`.

<!-- CHANGE LOG: 2026-11-13 | maintainer@emeraldcoastsystemsgroup.com | Synchronize Career 1.60.6 with the saved-preparation choice release. -->

<!-- CHANGE LOG: 2026-11-13 | maintainer@emeraldcoastsystemsgroup.com | Synchronize Career 1.60.7 nightly matching and removal release. -->
<!-- CHANGE LOG: 2026-11-13 | maintainer@emeraldcoastsystemsgroup.com | Synchronize Career 1.60.9 concierge module fix. -->
