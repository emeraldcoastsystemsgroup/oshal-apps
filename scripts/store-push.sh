#!/usr/bin/env bash
# =============================================================================
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | One command for a store push (Roger, 2026-11-03: "why do i have to push all this .. this should be just standard"): the long paste named two services, six settings and a password, and stopped the services under any other lane's running gate. Starts only the test services that are down and stops only those, reads the password from the container, runs the push through the unchanged pre-push gate, tries a second time because a suite can fail on a busy machine and pass alone (Trading and Publishing Studio, 2026-11-03), then opens and merges the pull request.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | The gate no longer needs --allow-skips, so this drops it and anyone may run this, an agent included. Career's suites run: its pinned Python comes from the test fixture and its contract gets its own disposable database, a third service this starts and stops the same way.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | The Operations step hung for its full 15 minutes on two lanes at once (2026-11-10): the shared test search, 512 MB and up all day, was full of indices killed runs had left and answered HTTP 429. This creates that container with 1 GB when it is missing and, before each push, removes what earlier runs left and prints how its memory stands (scripts/sweep-test-search.mjs).
# 4 | maintainer@emeraldcoastsystemsgroup.com   | Scoped gate (Roger, 2026-11-14: "we dont need to do it every time"). The services and their settings moved to scripts/store-gate-services.sh, shared with the scheduled full run; this asks the gate for its plan first and starts only the services that plan names, so a change that touches no database starts none. The second try reruns only the jobs that failed in the first (STORE_CI_RETRY_FROM: same tree, package suites only, publish wall again), not the whole suite. OSHAL_STORE_CI_FULL=1 runs every job.
# =============================================================================
#
# Usage, from a branch with its commits made:
#   bash scripts/store-push.sh "<pull request title>" "<pull request body>"
#   OSHAL_STORE_CI_FULL=1 bash scripts/store-push.sh ...     every store-ci job, whatever changed
#
# The gate the push runs (.githooks/pre-push) is scoped to the change by default: the publish wall and
# every structural rule, plus the suites of the packages the branch changes or reaches. The whole suite
# runs on a schedule (scripts/store-full-run.sh). The hook's last line says which ran.
#
# Agents and the operator both run this; pushing a store branch is nobody's chore.
set -uo pipefail

TITLE=${1:?usage: store-push.sh "<pull request title>" "<pull request body>"}
BODY=${2:?usage: store-push.sh "<pull request title>" "<pull request body>"}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != "main" ] && [ "$BRANCH" != "HEAD" ] || { echo "store-push: work on a branch, not $BRANCH" >&2; exit 1; }
git config core.hooksPath .githooks
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/store-gate-services.sh
source "$HERE/store-gate-services.sh"

RESULTS=$(mktemp -d "${TMPDIR:-/tmp}/store-push.XXXXXX")
trap 'store_gate_services_down; rm -rf "$RESULTS"' EXIT
PLAN_ARGS=(--plan)
[ "${OSHAL_STORE_CI_FULL:-0}" = "1" ] && PLAN_ARGS+=(--full)
# The plan is what the hook will decide on this same tree: which jobs run and which services they need.
STORE_CI_RESULT_FILE="$RESULTS/plan.json" node "$HERE/store-ci-local.mjs" "${PLAN_ARGS[@]}" >&2 \
  || { echo "store-push: the gate could not make its plan" >&2; exit 1; }
store_gate_planned_services "$RESULTS/plan.json" > "$RESULTS/services.txt" \
  || { echo "store-push: the plan named no services list" >&2; exit 1; }
mapfile -t SERVICES < "$RESULTS/services.txt"
if [ "${#SERVICES[@]}" -gt 0 ]; then
  echo "store-push: starting the services the plan needs: ${SERVICES[*]}" >&2
  store_gate_services_up "${SERVICES[@]}" || exit 1
else
  echo "store-push: the plan needs no test service" >&2
  store_gate_settings
fi

if ! STORE_CI_RESULT_FILE="$RESULTS/first.json" git push -u origin "$BRANCH"; then
  echo "store-push: the first push failed; trying once more in case the machine was busy (only the jobs that failed run again)" >&2
  STORE_CI_RETRY_FROM="$RESULTS/first.json" STORE_CI_RESULT_FILE="$RESULTS/second.json" git push -u origin "$BRANCH" \
    || { echo "store-push: failed twice; the checks named above are real" >&2; exit 1; }
fi
[ -n "$(gh pr list --head "$BRANCH" --state open --json number --jq '.[].number')" ] || gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY" || exit 1
gh pr merge "$BRANCH" --merge --admin
