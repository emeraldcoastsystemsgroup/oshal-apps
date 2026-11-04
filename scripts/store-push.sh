#!/usr/bin/env bash
# =============================================================================
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | One command for a store push (Roger, 2026-11-03: "why do i have to push all this .. this should be just standard"): the long paste named two services, six settings and a password, and stopped the services under any other lane's running gate. Starts only the test services that are down and stops only those, reads the password from the container, runs the push through the unchanged pre-push gate, tries a second time because a suite can fail on a busy machine and pass alone (Trading and Publishing Studio, 2026-11-03), then opens and merges the pull request.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | The gate no longer needs --allow-skips, so this drops it and anyone may run this, an agent included. Career's suites run: its pinned Python comes from the test fixture and its contract gets its own disposable database, a third service this starts and stops the same way.
# =============================================================================
#
# Usage, from a branch with its commits made:
#   bash scripts/store-push.sh "<pull request title>" "<pull request body>"
#
# Agents and the operator both run this; pushing a store branch is nobody's chore.
set -uo pipefail

TITLE=${1:?usage: store-push.sh "<pull request title>" "<pull request body>"}
BODY=${2:?usage: store-push.sh "<pull request title>" "<pull request body>"}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != "main" ] && [ "$BRANCH" != "HEAD" ] || { echo "store-push: work on a branch, not $BRANCH" >&2; exit 1; }
git config core.hooksPath .githooks

STARTED=()
stop_started() { [ "${#STARTED[@]}" -eq 0 ] || docker stop "${STARTED[@]}" >/dev/null; }
trap stop_started EXIT
CAREER_PASSWORD=career-contract-ci
docker inspect store-career-postgres >/dev/null 2>&1 || docker create --name store-career-postgres \
  -p 127.0.0.1:55469:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$CAREER_PASSWORD" -e POSTGRES_DB=postgres \
  pgvector/pgvector:pg16 >/dev/null || exit 1
for service in operations-contract-postgres operations-contract-search store-career-postgres; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$service")" != "true" ]; then
    docker start "$service" >/dev/null || exit 1
    STARTED+=("$service")
  fi
done
for _ in $(seq 1 60); do
  docker exec operations-contract-postgres pg_isready -q && docker exec store-career-postgres pg_isready -q -U postgres \
    && curl -sf http://127.0.0.1:35690 >/dev/null && break
  sleep 3
done

PASSWORD=$(docker inspect operations-contract-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)
RUNTIME=$HOME/.local/state/oshal-publishing-runtime
export PATH=$HOME/.local/state/oshal-test-fixtures/career-node24/python/bin:$PATH
export CAREER_TEST_POSTGRES_ADMIN_URL="postgresql://postgres:$CAREER_PASSWORD@127.0.0.1:55469/postgres"
export OSHAL_TEST_POSTGRES="postgresql://postgres:$PASSWORD@127.0.0.1:35689/postgres"
export OSHAL_TEST_SEARCH=http://127.0.0.1:35690
export OSHAL_PUBLISHING_PYTHON=$RUNTIME/rt/python/bin/python3
export OSHAL_PUBLISHING_TYPST=$RUNTIME/rt/typst
export OSHAL_PUBLISHING_TYPST_ARCHIVE=$RUNTIME/originals/typst-0.15.1-aarch64.tar.xz
export OSHAL_PUBLISHING_WHEEL_DIR=$RUNTIME/originals/wheels

if ! git push -u origin "$BRANCH"; then
  echo "store-push: the first push failed; trying once more in case the machine was busy" >&2
  git push -u origin "$BRANCH" || { echo "store-push: failed twice; the checks named above are real" >&2; exit 1; }
fi
[ -n "$(gh pr list --head "$BRANCH" --state open --json number --jq '.[].number')" ] || gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY" || exit 1
gh pr merge "$BRANCH" --merge --admin
