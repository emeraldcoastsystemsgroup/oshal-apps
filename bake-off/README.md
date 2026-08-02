# AI Bake-Off

**Race one job across every AI lane you already have. Get one recommendation, or an honest refusal.**

A **lane** is one bot × harness × provider pairing — `research-bot · claude-code/claude-code` and
`weather-bot · codex-cli/openai-codex` are two different lanes on the same box. Mix-mode swarms
(ADR-033) are what make that true; a single-vendor stack cannot run this app at all, because its
optimizer is captive to its own models.

You describe a recurring job once — the prompt, a rubric, your quality bar, roughly how many times
a month you run it. The app races that prompt across your lanes, grades every output on the shared
quality judge against your rubric, and reports cost × quality per lane plus one recommendation:
the cheapest lane that still clears your bar, and what switching saves per month.

**No new credentials.** It uses the bots this deployment already runs, on the OAuth logins already
mounted. A local Ollama or LM Studio lane works the same way and is the interesting case — a free
local lane that clears the bar is the biggest number this app can print.

## Why this is not Token Chase

Token Chase (core, [ADR-046](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/046-token-chase-checkpoint-replay-optimization.md))
works **backwards**: it replays captured model-call frames from runs that already happened to prove
a cheaper path would have worked. This app works **forwards**: you have a job you are about to run
a thousand times, and no captured corpus yet. Same thesis, opposite direction, and they compose —
Token Chase's per-frame evidence is finer-grained; this is the one-click answer for a whole job.

## What it refuses to do

The table is easy. A table that refuses to lie is the product. All six rules live in
`src-routes/bake-off-scoring.ts` and every one has a guard in `tests/`:

| Situation | What happens |
|---|---|
| Some lanes graded by the LLM judge, others by the lexical fallback | **Blocked.** Different instruments; their scores are not comparable, so nothing is recommended. |
| A lane failed | Never a winner, however cheap a failure is. Named in the caveats. |
| A lane scored below your bar | Never a winner. Cheap wrong output is the expensive kind. |
| A lane reported `$0` | Treated as **unknown** cost, not free. Excluded from the savings math and named. |
| Fewer than two lanes qualified | **Blocked.** "Use the only lane you have" is not a finding. |
| Any run at all | Carries the sample-size caveat. One run per lane is a probe, not a benchmark. |

The whole run was graded by the deterministic lexical fallback (no judge bot reachable, or
`FORCE_LLM_PROVIDER=noop`)? You still get the table, labelled a smoke test in the first caveat.

## Who does the reasoning

Nothing in this package calls an LLM. Every model call lands on an accountable bot, which is what
puts the cost in `chat_tasks` under that bot's `agent_id` and what puts the run behind the
cost-governance budget gate ([ADR-036](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/036-bot-owned-application-architecture.md)):

- **Candidate output** → each candidate lane's own bot, via the framework's `executeBotOrInline`
  chokepoint (budget gate + execute-entitlement check + skill-profile carrier live there).
- **The grade** → the kernel's `quality-judge` concierge via `JudgeService`, wired exactly as
  `POST /api/judge` wires it.
- **The verdict narrative** → this package's own `bake-off-analyst`, and **only** on an explicit
  click (`POST /jobs/:id/verdict`), because narration spends money. The table stands on its own if
  the analyst is unavailable.

Lanes run **sequentially**. A parallel fan-out across eight bots would show the budget gate eight
simultaneous first-calls, each seeing pre-spend state, and could spike a month's budget in one
click.

## Auth posture

Every endpoint is behind `requiresAuth: true` **and** self-gates on `callerSub`, and every store
query is parameterised on that sub with owner-or-operator RLS underneath as the backstop. Nothing
here is anonymously callable: it all either exposes the caller's prompts, model outputs and spend,
or spends their money.

Two access controls worth naming:

- **Lane discovery is caller-scoped** (ADR-087). A normal caller sees only what user-facing
  delegation may reach (`isBotAccessibleTo(id, 'jarvis')`), so operator-scoped internal machinery —
  the planner, the queue bot, the developer bot — never shows up as somebody's "cheap lane". An
  operator sees the operator-scoped set.
- **A foreign id is indistinguishable from a missing one.** Reads are owner-scoped in the `WHERE`
  clause, so somebody else's job or run returns the same 404 as one that does not exist.

## What this package is

- `routes/bake-off-routes.js` (from `src-routes/bake-off-routes.ts`) — mounted at `/api/bake-off`:
  `GET /` (surface), `GET /lanes`, `GET`/`POST /jobs`, `DELETE /jobs/:id`,
  `POST /jobs/:id/run` (202, single-flighted), `GET /jobs/:id/report`, `GET /jobs/:id/runs`,
  `GET /runs/:runId/output/:agentId`, `POST /jobs/:id/verdict`.
- `routes/bake-off-engine.js` — lane discovery, sequential racing, grading, single-flight, the
  completion notification.
- `routes/bake-off-store.js` — the three owner-scoped tables and their CRUD.
- `routes/bake-off-scoring.js` — **the pure half**: validation, ranking, and the recommendation.
  No imports, so `tests/` covers it with plain `node --test`.
- `personas/bake-off-analyst.yaml` — the analyst, whose first rule is that the table outranks it.
- `tools/bake-off.html` — the console: lane roster, job editor, cost/quality table, per-lane
  output drawer.
- `migrations/001-bake-off.sql` — owned by this package; `bake-off-store` also self-heals it, so
  the app works whether or not `APP_PACKAGE_MIGRATIONS` is on.

## Kernel skills it declares

`uses: [tool-registry, notifications]` — the harness/LLM layer is the subject of the app, and the
owner is told when a multi-lane race lands.

It also imports `@/features/quality-judge` (`JudgeService`) and
`@/app/extensions/swarm/swarm-bot-registry` (`getActiveRegistry`, `isBotAccessibleTo`). Neither is a
*declared* kernel skill, so neither can go in `uses:` — the loader validates that list fail-closed
against the kernel registry. Both are anchored in `dist` by permanent app-layer importers
(`judge-routes.ts` mounts `/api/judge`; the bot registry is core boot), which is the same footing on
which shipped packages import `@/features/trading` and `@/features/prediction-markets`. If the
shared judge is ever promoted to a kernel skill, declare it here.

## Build & test

```bash
# from an OSHAL checkout — compiles src-routes/*.ts -> routes/*.js (@/ imports preserved)
node scripts/oshal-app.js build ../oshal-apps/bake-off --framework .
node scripts/oshal-app.js validate ../oshal-apps/bake-off

# the guards (dependency-free, and what store-ci runs)
cd bake-off && node --test "tests/*.test.js"
```

## Deliberately not built

- **No `schedules:`.** A recurring race is N paid model calls plus N paid grades; an app that
  shipped with a cron enabled would start spending on install. Re-baselining on a cadence ("models
  changed — is my lane still right?") is the obvious next increment and belongs behind an explicit
  per-user opt-in.
- **No multi-sample runs.** One sample per lane, which is why every report says so. Averaging k
  samples per lane is the single biggest accuracy improvement available and the natural v1.1.
- **No automatic promotion.** The app recommends; it never rewires anything. Choosing a lane for a
  real workload stays a human decision, and the platform has no per-app lane override to write to
  anyway.
- **No cross-user leaderboard.** Prompts and outputs are the caller's; there is no aggregate view
  and no "popular lane" telemetry.
