# Career Hunter — OSHAL app package

The job-hunting application, carved out of OSHAL core 2026-07-18 (**ADR-085 Wave 3 #1 —
the largest carve**: ~5,300 LOC of app code ships here; the engine chain stays
framework-resident).

Nightly shared scrape over ~1,240 companies → per-user keyword match → AI scoring →
title pass → approval queue → apply pipeline handoff; morning digest (Gmail/Twilio,
opt-out); native board / recruiters / strengthen / insights / approvals / settings /
resume-studio / profile-studio / mobile swipe surfaces; jobs knowledge graph.

## Shape

- `oshal-app.yaml` — manifest: TWO route mounts (`/api/career-hunter` service-or-oidc —
  data routes still resolve OIDC and 401 service callers, only `/run/refresh` honors the
  trusted service sub re-checked against career-admin; `/api/career-hunter/graph` oidc),
  the single `career-hunter` bot (registrar-registered at activate;
  `chatBot: career-hunter` drives the cockpit chat panel), the 12 CLI tools
  (`career_database` … `career_refresh_status`), 10 ribbon tiles, ticketType
  `career-application` + workflow, `guestTier: readonly` request.
- `src-routes/` — the 12 route modules (compiled to `routes/` by `oshal-app build`):
  the hub (`career-hunter-routes`), the cron (`career-hunter-cron` — 18:00 CT scrape +
  07:00 CT digest + boot catch-up, gated by `CAREER_HUNTER_CRON`, started at mount),
  digest, title-score, resume-studio, profile-studio, artifacts, job-guide, the
  jobs graph, plus the two the board leans on — `career-board-feed` (the feed's query
  planner) and `career-resume-preview` (the in-surface packet preview). Surfaces serve
  from this package's `tools/` (`__dirname`-relative).
- `tools/` — 11 surfaces + `career-hunter.css` (loaded via `/api/career-hunter/static/`).
- `migrations/` — idempotent copies of 031/077/082 + **new `090-career-rls.sql`**
  (closes the audit-found gap: digest + score settings shipped without owner RLS).
- `tests/` — 8 app-owned suites: the vitest specs (resume alias, digest ×2, title-score,
  board dismiss filter, graph ingestion) and the dependency-free `node --test` suites the
  `career-hunter` store-ci job runs against the COMPILED modules (`board-feed-plan`,
  `board-surface`, `resume-preview`, `migration-index-names`).
- `scripts/` — the graph + insights smoke scripts.

## Two things about the board that are not obvious from the code

**The feed is planned, not joined** (`career-board-feed`). The obvious query — join the corpus,
LEFT JOIN the user's signals, sort — took **50 seconds** on the live store (1.45M postings /
2.0GB `corpus.db`, of which **1.1GB is `description` text**, so every posting row SQLite touches
drags ~2.6KB the board never renders through the page cache). The feed instead drives from
`user_signals` through `idx_user_scored` in sort-key order, bounded by a candidate pool, and
reaches the corpus only for that bounded set; signal-side predicates are pushed INTO the pool so
the index walk is range-bounded. Same 150 rows, same order — **37ms**. Two rules that keep it
that way: predicates stay **sargable** (`p.target_role = 1`, never `COALESCE(p.target_role,0) = 1`
— equivalent, but no index can serve the second), and the board's SELECT never grows to include
`p.description`. The board indexes + `ANALYZE` live in `engine/jobhunter/db.py`'s schema, so a
fresh install gets them; if a board is slow on a new box, check `sqlite_stat1` exists first.

**The packet preview serves HTML, not the PDF** (`career-resume-preview`, `?as=html`). No mobile
browser renders a PDF in an `<iframe>` — iOS has no in-page PDF renderer at all and only hands
PDFs to its native viewer on *top-level* navigations, so the frame keeps its full CSS box and
paints nothing, while `load` still fires so the page cannot detect it. It renders fine on every
desktop, which is why the blank preview was reported more than once before it was found. The
generator writes the HTML *first* and prints the PDF from it, so a byte-exact source of every
packet is already on disk beside it; the preview serves that sibling with an appended
`@media screen` stylesheet (the templates are laid out for 8.5in). A missing sibling **404s and
must never fall back to the PDF** — a silent fallback restores the invisible preview with no way
to tell. The PDF stays the artifact of record and every surface keeps a link to open it.

## What deliberately stays in the framework (ADR-093 interim)

- **The engine chain:** `apps/career-hunter/` (the 8.5k-LOC Python `jobhunter` engine +
  templates + seeds), `scripts/oshal-jobhunter.js` (the wrapper this package's routes and
  the bots BOTH shell at `/app`), `careerHunterTool.js` / `applyOperatorTools.js` (bot
  toolkits), python3 in the image.
- **The bot's runtime:** inline packaged shape on the api (no dedicated containers, no kernel registry
  blocks, personas at `/app/ai-lab/bot-personas/`, migration 041-equivalent seed (031's
  agents rows).
- **The data:** the 9.8 GB SQLite store (shared `corpus.db` + per-user dbs) on the
  `api-output` volume at `/app/output/career-hunter-data` — `JOBHUNTER_STORE_ROOT`
  unchanged; Postgres `career_*` tables stay in place (backup
  `oshal-career-backup-verified-2026-07-18.sql` taken at carve).
- **Cross-app rails:** the apply pipeline (`job-apply` app, `oshal-apply.js`,
  apply-operator + linkedin-profile-operator remote bots), the Profile Studio feature
  slice + `/api/profile-studio` ingest callback, Portrait Studio.
- **The morning brief** consumes this app's hits through the kernel's
  `career-brief-bridge` (skip-if-absent — the brief survives the app being uninstalled).

## Engine-in-package follow-up

Plan §6's end-state ("engines ship IN the package, python3 on the node") waits on the
D1 container-placement decision; until then the ADR-093 interim disposition above is
deliberate. Moving the engine means: package `engine/`, `pip install -r requirements.txt`
in the node runtime (note: the CURRENT image never pip-installs — Flask/bs4/playwright
presence is inherited, an audit finding for the D1 work), and a dedicated data volume.
