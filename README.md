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

## Apps

<!-- apps-table:begin (generated - run `node scripts/gen-readme-apps-table.mjs`; do not edit by hand) -->

All **47 packages**, shelved by ADR-097 suite. Versions and status come from
[`marketplace.json`](marketplace.json), which mirrors each package's `oshal-app.yaml`.

### AI Productivity

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Intelligent Communication** | [`email-summarizer/`](email-summarizer/) | 1.0.0 | ready | Your inbox, calendar, and day in one surface - the ADR-037 reference comms app. |
| **Feeds** | [`feeds/`](feeds/) | 1.0.0 | ready | Your connected message feeds in one place - live stream, activity trends, hot channels, and trending topics over your own Slack messages, with a curator bot that answers 'what did I miss'. |
| **Identity Hub** | [`identity/`](identity/) | 1.0.0 | ready | Every account you've connected, in one place - click to jump straight into Gmail, LinkedIn, your smart-home app, and more, reconnect a login that's expired, or connect a new one, plus an optional access review that flags what needs attention. |
| **Payments** | [`payments/`](payments/) | 1.0.0 | ready | Take payments through your own Square or PayPal account — Square runs a card charge, PayPal sends an invoice. |
| **AI Office** | [`presentations/`](presentations/) | 2.5.0 | ready | One outline, three artifacts — a themed PowerPoint deck, Word document, or live Excel workbook. |
| **Shopping** | [`purchasing/`](purchasing/) | 1.0.0 | ready | AI shopping concierge — search Walmart, build lists, learn your preferences, find deals, and hand off a ready-to-checkout cart you complete on the retailer's site. |
| **Social** | [`social/`](social/) | 1.0.0 | ready | Draft, review, and publish across your networks from one surface - the comms bot drafts a post in your voice, you approve, and it publishes on your per-user LinkedIn / X / Facebook token (nothing posts until you click Publish). |
| **Storage** | [`storage/`](storage/) | 1.1.0 | ready | Your storage hub — choose where OSHAL saves generated code vs files (GitHub / Dropbox / OSHAL-local), manage targets by chat with the Storage Assistant, and browse your files. |
| **Switchboard** | [`switchboard/`](switchboard/) | 0.3.0 | ready | Every line, one board. |
| **System** | [`system/`](system/) | 1.0.0 | ready | One desk for account infrastructure: Identity Hub, Storage, and Cloud accounts — each already its own app, gathered here so you don't have to hunt the full catalog. |

### AI Knowledge

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Intelligent Career** | [`career-hunter/`](career-hunter/) | 1.6.4 | ready | Reads openings from employers' own public ATS job feeds into a shared corpus, scores every posting against your private career profile, and turns the best fits into a human-in-the-loop application queue — approve, approve-with-OSHAL, or deny, then it writes a tailored resume + cover letter. |
| **Job Apply** | [`job-apply/`](job-apply/) | 1.0.0 | ready | Submit an approved, packet-ready job application by driving your real browser on a desktop worker node — push a ticket, it queues, the career-hunter worker submits it, and the ticket passes or fails. |
| **World Intelligence** | [`world/`](world/) | 1.0.3 | ready | Shared world intelligence (ADR-061 Layer B) - multi-source news feeds classified into a bias-aware sentiment graph (political + economic + outlet-kind axes), entity co-mention graph, and historical series. |

### AI Finance

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Daily Trade Recap** | [`daily-trade-recap/`](daily-trade-recap/) | 1.0.0 | ready | After the closing bell: render the day's charted trade-recap video (real Alpaca data -> PowerPoint deck -> narrated MP4) on the swarm render node, then email it to the operator with the day's numbers and the video attached as a preview. |
| **Finance** | [`finance/`](finance/) | 1.1.1 | ready | Link your banks and brokerages via Plaid and see everything in one place — net worth, accounts, holdings, spending — with a plain-English brief. |
| **Intelligent Trades** | [`trading/`](trading/) | 1.1.1 | ready | Signal-justified stock trading (ADR-052). |
| **Kalshi Prediction Markets** | [`kalshi/`](kalshi/) | 1.1.0 | ready | Find mispriced event contracts on Kalshi (ADR-094). |
| **Payroll** | [`payroll/`](payroll/) | 2.2.0 | ready | Run payroll for your team, ADP-style, then pay, file and RECONCILE from the same place. |
| **Venture Plan** | [`venture-plan/`](venture-plan/) | 1.0.0 | ready | Turn an idea into the venture document set a real decision needs — bill of materials, landed cost, channel margin, profit, cash and working capital, schedule, org, funding ask. |

### AI Creative

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Brand Graphics** | [`brand-graphics/`](brand-graphics/) | 1.0.1 | ready | On-brand OSHAL motion graphics — a short brief becomes the validated electric-"oshal" intro look via Google Vids on the operator's signed-in Chrome. |
| **Camera Ops** | [`camera/`](camera/) | 1.0.0 | ready | Remote camera control - connect a GoPro (Open GoPro HTTP) or other cameras as device nodes and drive them: record, photo, modes, settings, low-latency preview. |
| **Creative Studio** | [`creative-studio/`](creative-studio/) | 1.1.0 | ready | A creative bot that just keeps making short kid-safe videos - it rotates a public-domain library (fables, fairytales, famous sayings), animates each ~100-word story across ~10 continuous Google Vids Extend scenes on the remote worker (ADR-080), downloads the finished MP4, and saves it to your content folder + Google Drive. |
| **Dungeon Master** | [`dnd/`](dnd/) | 0.19.1 | ready | Play D&D with an AI Dungeon Master on a cinematic shared board: claimed heroes and visible AI companions follow an explicit move, action, target, dice, result, and advance loop with natural narration, saved characters, multiplayer join codes, playback, and rewind. |
| **Game Show** | [`game-show/`](game-show/) | 0.10.0 | ready | TV-style AI game night: Family Feud, Jeopardy, Wheel of Fortune and Whammy, each with its own television set — podium characters, sound cues and opening titles. |
| **Games** | [`games/`](games/) | 1.1.0 | ready | A focused cockpit toolbar with direct launchers for the AI Dungeon Master and Game Show. |
| **LoRA Studio** | [`lora/`](lora/) | 1.0.2 | ready | Train a reusable character (a "sprite") from images and captions, validate it on a fixed held-out matrix, and improve it by targeting its weak spots — every version scored so "better" is a number. |
| **Portrait Studio** | [`portrait-studio/`](portrait-studio/) | 1.3.0 | ready | Turn any photo into a portrait worth framing — 100 profiles × 100 backdrops: business, business casual, slice of life, work environments, history and fantasy, with interchangeable clothing, hats, props and finishes. |
| **Pumpkin** | [`pumpkin/`](pumpkin/) | 1.2.0 | ready | Animated talking jack-o'-lantern Halloween prop - project a glowing procedural pumpkin face into an inflatable, with a lip-syncing mouth. |
| **Video Studio** | [`video/`](video/) | 1.1.0 | ready | Make prompted short-form videos (TikTok / YouTube Shorts / Instagram Reels) from an idea - the director bot storyboards it and the studio renders a real .mp4 with voiceover and captions, saved to your Files storage; a series is written by the screenplay-writer, approval-gated on the script, then rendered one episode at a time on the remote Vids node. |
| **Vids Studio** | [`vids/`](vids/) | 1.1.1 | ready | Turn an idea into generated video - the Veo specialist drives Google Vids by clicking, in a remote operator's logged-in Chrome: describe the shot, it generates the clip and places it on the timeline. |

### AI Home & Lifestyle

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Drone Ops** | [`drone/`](drone/) | 1.1.0 | ready | Drone fleet automation control - arm, take off, fly waypoint missions, and coordinate multi-drone fleet plans inside a hard geofence with deterministic separation checks. |
| **Eats** | [`eats/`](eats/) | 1.0.0 | ready | AI Uber Eats concierge — search restaurants, browse menus, build an order, and hand off a ready Uber Eats checkout you confirm and pay in your own Uber app. |
| **Smart Home** | [`home/`](home/) | 1.1.0 | ready | Your smart home, one surface — read device state and scenes across SmartThings and Google Home, ask the home bot to run a routine, and let scheduled 'morning routine' tickets drive the house. |
| **Life** | [`life/`](life/) | 1.0.0 | ready | One desk for everything lifestyle: movies & TV, music, food delivery, rides, shopping, travel, payments, and the weekly AI Bake-Off — each already its own app, gathered here so you don't have to hunt the full catalog for them. |
| **Little Monsters** | [`little-monsters/`](little-monsters/) | 1.0.9 | ready | Voice-first ADHD study companion for K-12: lecture capture, flashcards, authoritative quizzes, and a Socratic tutor grounded in caller-owned or teacher/admin-approved class material. |
| **Movies & TV** | [`movies/`](movies/) | 1.0.0 | ready | AI movies & TV concierge — search films and shows, see where they're streaming, watch trailers, get recommendations, build a watchlist, and find showtimes. |
| **Get a Ride** | [`rides/`](rides/) | 1.1.0 | ready | AI Uber Rides concierge on a real map — set pickup and destination by pin or address, see the measured distance, compare ride types with labelled fare estimates, and hand off a ready deep link you confirm and pay in your own Uber app. |
| **Spaces** | [`spaces/`](spaces/) | 0.5.1 | ready | Turn a real space into an explorable 3D scene: film a walkthrough (or import an iPhone/LiDAR/drone capture) into a Gaussian-splat scene you walk in a WebGL viewer, get live walk/pan guidance while you film, mint a phone-pairing token for LiDAR ingest, paint Wi-Fi coverage onto the map, and fly a sim-drone scan orbit. |
| **Spotify** | [`spotify/`](spotify/) | 1.0.0 | ready | AI music concierge — search your Spotify, see what's playing and your playlists, get recommendations from your taste, and build playlists on your account. |
| **Travel** | [`travel/`](travel/) | 1.0.0 | ready | AI travel concierge (ADR-059) - search real flights (Duffel), see an honest price read from the swarm's shared price history, watch routes for a fare drop, and book via a deep-link handoff; hotels and cars are deep-link handoffs today. |
| **Kid Lens** | [`youtube-kids/`](youtube-kids/) | 1.0.0 | ready | Upload your YouTube Takeout watch history and get a parent-friendly brief on what your kid is into — top interests, decoded channels, gift ideas, conversation openers. |

### AI Engineering

| App | Folder | Version | Status | What it is |
|---|---|---|---|---|
| **Aero Lab** | [`aero-lab/`](aero-lab/) | 1.0.0 | ready | Persistent-flight design lab - shape a solar-endurance aircraft (span, area, aspect ratio, battery, cells, buoyancy fraction, site, season), run it through the validated aerosim engine (wing polar, 24 h energy limit cycle, admissibility screen), read the verdict with real plots (SOC trace, polar, drag buildup, margins), and download the build package (STL / DXF / BOM). |
| **AI Bake-Off** | [`bake-off/`](bake-off/) | 1.0.0 | ready | Race one job across every AI lane you already have, grade every output on the shared quality judge, and get the cheapest lane that still clears your quality bar. |
| **Cloud** | [`cloud/`](cloud/) | 1.0.0 | ready | Inspect and operate your Google Cloud by chat. |
| **Hello OSHAL** | [`hello-oshal/`](hello-oshal/) | 1.1.0 | ready | The minimal working example — one route, one ribbon tile. |
| **Ocean Lab** | [`ocean-lab/`](ocean-lab/) | 1.0.0 | ready | Ambient-energy design lab — model a machine that moves on tidal and current flow or on the soil thermal gradient, size its rotor with real blade-element momentum theory, and export printable geometry. |
| **Sat Ops** | [`sat-ops/`](sat-ops/) | 1.1.0 | ready | Satellite fleet plane - a 3D orbit console with fleet attitude telemetry (MEKF health, wheel momentum, ADCS mode), SGP4 ground tracks and pass windows, pairwise conjunction screening, and an approval-gated command console (point / detumble / desat / safe). |

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
