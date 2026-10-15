#!/usr/bin/env bash
# =============================================================================
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial. store-ci.yml lost its `pull_request:` trigger because this repository is PRIVATE and every run is billed — 217 runs in the first sixteen days of September at ~18.9 billed minutes each. This is the gate that replaces it: the same checks, in the same order, against the working tree, before you push. It is a thin wrapper on purpose — the runner is scripts/store-ci-local.mjs because it PARSES store-ci.yml rather than restating it, and a YAML walk plus node:test TAP grading belongs in the same language as every other gate in scripts/.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Document the --allow-skips opt-out and the pre-push hook that actually runs this. Entry 1 shipped a gate nothing invoked: with store-ci.yml on workflow_dispatch and security.yml already there, the repository had no automatic check of any kind, and every reference to this script outside itself was prose.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | The gate's toolchain is its own: scripts/toolchain (pinned package.json + package-lock.json, `npm ci --prefix scripts/toolchain`), not an OSHAL_ROOT or sibling ../oshal checkout. The old TypeScript platform checkout is never resolved; inherited OSHAL_* / NODE_PATH variables are ignored, and a check that needs that platform's source reports SKIPPED naming it.
# =============================================================================
#
# store-ci-local.sh — run every store-ci check locally, as a pre-push habit.
#
# WHY THIS EXISTS
#   oshal-apps is a PRIVATE repository, so GitHub Actions minutes are billed. store-ci
#   fans out to ~30 jobs and fired on every `pull_request` event. The workflow is now
#   workflow_dispatch-only (see the comment at the top of .github/workflows/store-ci.yml) and
#   this script is the gate in its place. Same contract as the core repo's scripts/ci-local.sh.
#
# WHAT IT DOES NOT DO
#   It does not re-implement the workflow. It reads .github/workflows/store-ci.yml, derives the
#   command, working directory and glob for every job, and REFUSES to run when it meets a job or
#   command it has no policy for. A local gate that silently drifts from the cloud gate it
#   replaced is worse than no gate, so drift is a hard failure rather than a quiet skip.
#
#   In particular it never re-types a package's test glob. The house contract is ONE glob per
#   package (`tests/*.test.js` matches zero files in a .cjs or .mjs package, and `node --test`
#   would then exit 0 having run nothing). The globs come from the workflow, and the first check
#   to run is the repo's own scripts/security/check-store-test-discovery.mjs, which proves every
#   one of them resolves to a non-empty file set. On top of that the runner fails any suite whose
#   TAP summary reports zero tests, so a glob that matches nothing cannot report green here either.
#
# WHO RUNS IT
#   .githooks/pre-push, which is the only automatic gate this repository has left. That hook is
#   opt-in per clone and does nothing until you run, once:  git config core.hooksPath .githooks
#
# A SKIP IS NOT A PASS
#   A check that could not run exits NON-ZERO, because a hook and a human both read $?, not the
#   text above it. Pass --allow-skips to accept them deliberately; they are still printed.
#
# Usage:  bash scripts/store-ci-local.sh [--allow-skips]
# Setup:  npm ci --prefix scripts/toolchain
#                                 The gate's own pinned dev toolchain (TypeScript, Vitest, Playwright,
#                                 Express, Multer, pg, better-sqlite3, js-yaml). node_modules is
#                                 gitignored. Chromium for the browser contracts:
#                                 node scripts/toolchain/node_modules/playwright/cli.js install chromium
#                                 Without the toolchain the suites that need it report SKIPPED, never
#                                 PASS - and the run exits non-zero.
# Env:    STORE_CI_TOOLCHAIN      another directory whose node_modules holds the same pinned set.
#                                 Optional; the default is scripts/toolchain.
#                                 OSHAL_ROOT / OSHAL_FRAMEWORK / OSHAL_CORE_DIR / OSHAL_CORE_ROOT /
#                                 KALSHI_BROWSER_DEPS / CAREER_LOADER_NODE_PATH / NODE_PATH are NOT
#                                 read and are dropped from every suite: the old TypeScript platform
#                                 checkout is never resolved. A check that needs that platform's source
#                                 reports SKIPPED with a LEGACY reason naming what it needs.
#         CAREER_TEST_POSTGRES_ADMIN_URL
#                                 a DISPOSABLE PostgreSQL superuser URL for the Career storage
#                                 contract. Unset by default and that is deliberate: never point it
#                                 at oshal-local-db (:55433) or any database you care about - the
#                                 contract creates and drops databases. store-ci DOES run this half
#                                 with a service container, so skipping it locally is a real loss of
#                                 coverage; CONTRIBUTING.md carries a throwaway `docker run` recipe.
# Exit:   0 = every mirrored check ran and passed
#         1 = a check failed, a check could not run, or the runner drifted from store-ci.yml
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

command -v node >/dev/null 2>&1 || {
  echo "store-ci-local: node is not on PATH. store-ci runs these jobs on node 22 and 24." >&2
  exit 1
}

cd "$ROOT"
exec node scripts/store-ci-local.mjs "$@"
