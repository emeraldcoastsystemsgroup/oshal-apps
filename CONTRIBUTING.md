# Contributing to the store repo

## Turn the gate on — once per clone

```bash
git config core.hooksPath .githooks
```

**Nothing is enforced until you run that.** Git only runs hooks from a path the clone has been told
to use, and this is not set by default — it was set in **no** clone of this repository when the
local gate landed, which means the attribution gate below was inert too. `.githooks/pre-push` is now
the **only automatic gate this repository has**: `store-ci` is `workflow_dispatch`-only, `security.yml`
already was, there is no root `package.json`, and required status checks are not available on this
plan. One command, once, per clone.

## Run the CI locally before you push

```bash
bash scripts/store-ci-local.sh
```

`.githooks/pre-push` runs this for you. Run it by hand whenever you want the answer sooner.

**This is the gate.** `store-ci` no longer runs on `pull_request`, because this repository is
**private** and every Actions minute is billed. The workflow fans out to ~30 jobs and GitHub bills
**each job rounded up to a whole minute**, so a run with a few minutes of real work is billed at
roughly nineteen.

| measured, 1–16 September 2026 | |
|---|---|
| runs | **217**, 100% `pull_request` |
| billed minutes per run | **~18.9** |
| billed minutes month-to-date | **~4,100** |
| projected per 30-day month | **~7,700** (~**$62**) |

Basis: per-job `started_at`/`completed_at` from `actions/runs/{id}/jobs` over a 55-run sample, each
job rounded up to a minute, priced at the published **$0.008/min** Linux rate. `skipped` jobs are
excluded — they never allocate a runner. **That is the spend, not the percentage of the limit** the
75% warning was measured against: the included-minutes allowance cannot be read, because the Actions
billing endpoints return *Not Found* for this token and plan.

`security.yml` and `scripts/publish-store.sh` already carried this constraint; `store-ci.yml` was
the hole.

The script runs the **same checks the workflow runs, in the same order**, against your working tree.
It takes about two minutes and needs no cloud, no secrets and no network.

It does not restate the workflow — it **parses** `.github/workflows/store-ci.yml` and derives the
command, working directory and glob for every job. Three properties follow, and they are the reason
to trust it:

- **It cannot silently drift.** A job, command or glob it has no policy for is a hard refusal, not a
  quiet skip. If you add a job to `store-ci.yml`, the script stops until you map it.
- **It reproduces the `needs:` gate.** `test-discovery` and `catalog-parity` gate every package job.
  When one of them fails, the package checks report **BLOCKED** — they are never reported green just
  because they did not run.
- **It never re-types a glob.** The house contract is **one glob per package** (`tests/*.test.js`
  matches zero files in a `.cjs` or `.mjs` package, and `node --test` would then exit 0 having run
  nothing). The globs come from the workflow, the first check to run is
  `scripts/security/check-store-test-discovery.mjs` which proves each one resolves to a non-empty
  file set, and any suite whose TAP summary shows **zero tests** is failed outright.

### Reading the verdicts

| verdict | meaning | exit code |
|---|---|---|
| `PASS` | ran, everything green | 0 |
| `PARTIAL` | ran and passed, but the suite **skipped** cases — the reason is printed | **non-zero** |
| `SKIPPED` | **did not run**: a prerequisite is missing | **non-zero** |
| `BLOCKED` | a `needs:` gate failed, so store-ci would not have run this job either | non-zero |
| `FAIL` | red. Do not push | non-zero |

**A skip is not a pass, and the exit code says so.** A hook and a human both read `$?`, not the
prose above it. If you have decided a skip is acceptable on your box, say so explicitly:

```bash
bash scripts/store-ci-local.sh --allow-skips     # exits 0, still names everything that did not run
```

The hook passes that for you when `OSHAL_STORE_CI_ALLOW_SKIPS=1` is set. `scripts/store-ci-local.test.mjs`
pins both halves of this contract.

### Prerequisites, and what you lose without them

- **A kernel checkout** — for a TypeScript compiler, `playwright`/`express`, and the real `multer`
  (`little-monsters`, `career-hunter`, `kalshi`). Found automatically in the sibling `../oshal`
  checkout, which is where it already is on an operator workstation; set `OSHAL_ROOT` if your layout
  differs. Without it those checks report `SKIPPED`, never `PASS` — including the **little-monsters
  security suite**. With it you run *two cases store-ci itself cannot*: the real-Multer resume cases
  skip on a runner, which has no kernel checkout.
- **A disposable PostgreSQL** for the Career storage contract. **store-ci runs this** — it declares a
  `pgvector/pgvector:pg16` service and `career-hunter/tests/career-storage-contract.test.mjs` asserts
  the URL is present when `CI` is set — so skipping it locally is a **real loss of coverage**, not a
  skip you share with CI. Spin up a throwaway on a port that is **not** 55433 or 55434:

  ```bash
  docker run -d --rm --name career-contract-pg -p 55460:5432 \
    -e POSTGRES_PASSWORD=career-contract-ci pgvector/pgvector:pg16
  export CAREER_TEST_POSTGRES_ADMIN_URL=postgresql://postgres:career-contract-ci@127.0.0.1:55460/postgres
  # when you are done:  docker rm -f career-contract-pg
  ```

  **Never point that variable at `oshal-local-db`** (`:55433`) or any database you care about — the
  contract creates and drops databases.

### Which local skips are real losses

Do not assume a skip is shared with CI. Checked against the workflow:

| skip | also skipped in CI? |
|---|---|
| `career-hunter` — real-Multer resume cases (2) | **yes** — a runner has no kernel checkout |
| `career-hunter` — PostgreSQL storage contract | **no** — CI runs it with a service container |
| `career-hunter` — symlink cases | **no** — these are `catch (EPERM/EACCES)` clauses, so they run on Linux and skip only on Windows |
| `embodied` — `EMBODIED_PYTHON` / `EMBODIED_ENGINE_ADDR` (2) | **yes** — that job sets neither |

`workflow_dispatch` stays available for a deliberate cloud run — a second opinion on clean Linux
runners, or a check that genuinely wants a service container. Do not re-add `pull_request:`.

## Work identifies the LANE, never a model

Standing operator directive: **no model attribution anywhere** — not in a file, not in a commit
message, not in a PR body, not in a `COLLABORATE.md` entry. Identify the lane doing the work
(`LANE B`, `@game-show-backlog`, `trading lane`), never the model running it.

Two gates enforce it here. Both fail closed.

| where | what it reads | what it refuses |
|---|---|---|
| `.githooks/pre-push` | the commit messages **this push publishes** | a `*-by:` trailer naming the vendor or the model, the vendor no-reply address, a "generated with" tool footer |
| `store-ci` job **no model attribution** (`scripts/check-no-model-attribution.test.mjs`) | every tracked text file | the shapes above, plus a Change Log AUTHOR column naming a model, plus a `COLLABORATE.md` entry whose byline names one |

### Turn the hook on — once per clone

```bash
git config core.hooksPath .githooks
```

The hook is not automatic: git only runs hooks from a path the clone has been told to use. Without
this line you have no push-time gate at all.

### What is *not* attribution

The guard matches the **shape** of an attribution, never the bare identifier, because the identifier
is legitimate product vocabulary throughout this repo and gating on it would flag correct content
until somebody switched the gate off:

- `claude-code` is a real `harnessType` in this product, and packages declare it in manifests and personas.
- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_MODEL` are real environment variables.
- `CLAUDE.md` is a filename.
- `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` are real model ids in persona YAML.
- `Co-authored-by: oshal maintainers <maintainer@emeraldcoastsystemsgroup.com>` is the sanctioned
  house identity and names no model.
- `career-hunter/engine/jobhunter/data/us_cities.tsv` carries the real towns of **Claude, Texas** and
  **Haiku, Hawaii**.

Every one of those has a green regression case in `scripts/check-no-model-attribution.test.mjs`. If
the guard ever flags one of them, fix the rule's shape — never delete the green case.

### The tree was cleaned in the same change — keep it that way

The guard did not land on a clean repo. When it was written, `origin/main` carried **165 attributed
lines in 5 files**: 161 `COLLABORATE.md` entry bylines naming a model (`## claude-opus-5 …`,
`[…] Claude Fable 5.1 (session …)`, `@handle (Claude Fable)`, `LANE D (Claude Opus 5)`) and four
Change Log AUTHOR cells reading `| Claude Opus |` (`brand-graphics/tools/oshal-brand.js`,
`little-monsters/tests/unit/education-serve-file.spec.ts`, `vids/routes/vids-routes.js`,
`vids/src-routes/vids-routes.ts`).

All 165 were corrected in the same change that added the guard, so the job lands **green**. The
bylines keep their lane, their session id and their topic and lose only the model name; the four
AUTHOR cells read `maintainer@emeraldcoastsystemsgroup.com`. Nothing was exempted and no pattern
was narrowed — a gate that is red from the day it lands trains everyone to ignore red, and a gate
narrowed to the files that tripped it is what `CLAUDE.md` forbids: *"never 'fix' a hit by narrowing
a pattern to the file that tripped it. Gate on the identifier, not on where it has appeared."*

So when this job goes red, your change introduced the line. **Do not add an exemption, an allowlist,
or a `continue-on-error`.** Rewrite the byline to name your lane, or set the AUTHOR cell to
`maintainer@emeraldcoastsystemsgroup.com`.

Because the tree is clean, `.githooks/pre-push` runs the tree spec too (`SCAN_TREE` defaults to 1),
so a push is refused before CI ever sees it. Set `OSHAL_ATTRIBUTION_SCAN_TREE=0` only to unblock a
push while a tree-wide cleanup is mid-flight — never as a way past your own change.

The commit-message half of the hook is scoped to the commits a push publishes, so history the
remote already holds is out of scope and nobody is blocked from working.
