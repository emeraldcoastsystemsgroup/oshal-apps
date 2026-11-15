#!/usr/bin/env bash
# =============================================================================
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | The disposable test services and the settings a store gate run needs, in one place for store-push.sh and the scheduled full run (scripts/store-full-run.sh), moved here unchanged from store-push.sh. A scoped run names the services its plan needs (STORE_CI_RESULT_FILE "services"), so a push that touches no database starts none: only those containers are created when missing and started when down, only the ones this started are stopped, and only their settings are exported.
# =============================================================================
#
# Sourced, never run:
#   source scripts/store-gate-services.sh
#   store_gate_services_up OSHAL_TEST_POSTGRES OSHAL_TEST_SEARCH CAREER_TEST_POSTGRES_ADMIN_URL
#   ... run the gate ...
#   store_gate_services_down        # stops only what store_gate_services_up started
#
# Each argument is the variable a suite reads; with none, every service starts. The publishing
# runtime and Career's pinned Python are settings, not services, and are always exported.

STORE_GATE_STARTED=()
STORE_GATE_CAREER_PASSWORD=career-contract-ci

# @description The container that answers one service variable.
# @param $1 The variable name.
# @returns The container name on stdout; non-zero for a variable no container answers.
store_gate_container() {
  case "$1" in
    OSHAL_TEST_POSTGRES) echo operations-contract-postgres ;;
    OSHAL_TEST_SEARCH) echo operations-contract-search ;;
    CAREER_TEST_POSTGRES_ADMIN_URL) echo store-career-postgres ;;
    *) return 1 ;;
  esac
}

# @description Create the containers that may be missing, with the shapes the suites expect.
# @param $1 The container name.
# @returns Non-zero when docker could not create it.
store_gate_create() {
  docker inspect "$1" >/dev/null 2>&1 && return 0
  case "$1" in
    store-career-postgres)
      docker create --name store-career-postgres -p 127.0.0.1:55469:5432 -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD="$STORE_GATE_CAREER_PASSWORD" -e POSTGRES_DB=postgres pgvector/pgvector:pg16 >/dev/null ;;
    operations-contract-search)
      docker create --name operations-contract-search -p 127.0.0.1:35690:9200 -e discovery.type=single-node \
        -e DISABLE_INSTALL_DEMO_CONFIG=true -e DISABLE_SECURITY_PLUGIN=true -e node.store.allow_mmap=false \
        -e "OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g" opensearchproject/opensearch:3.3.2 >/dev/null ;;
    *) echo "store-gate-services: $1 is missing and is not one this script creates" >&2; return 1 ;;
  esac
}

# @description Start the named services that are down, wait until they answer, and export their settings.
# @param $@ Service variables; none means every service.
# @returns Non-zero when a service could not be created or started.
store_gate_services_up() {
  local wanted=("$@") variable container
  [ "${#wanted[@]}" -gt 0 ] || wanted=(OSHAL_TEST_POSTGRES OSHAL_TEST_SEARCH CAREER_TEST_POSTGRES_ADMIN_URL)
  for variable in "${wanted[@]}"; do
    container=$(store_gate_container "$variable") || { echo "store-gate-services: no service answers $variable" >&2; return 1; }
    store_gate_create "$container" || return 1
    if [ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]; then
      docker start "$container" >/dev/null || return 1
      STORE_GATE_STARTED+=("$container")
    fi
  done
  local ready
  for _ in $(seq 1 60); do
    ready=1
    for variable in "${wanted[@]}"; do
      case "$variable" in
        OSHAL_TEST_POSTGRES) docker exec operations-contract-postgres pg_isready -q || ready=0 ;;
        OSHAL_TEST_SEARCH) curl -sf http://127.0.0.1:35690 >/dev/null || ready=0 ;;
        CAREER_TEST_POSTGRES_ADMIN_URL) docker exec store-career-postgres pg_isready -q -U postgres || ready=0 ;;
      esac
    done
    [ "$ready" = 1 ] && break
    sleep 3
  done
  for variable in "${wanted[@]}"; do
    case "$variable" in
      OSHAL_TEST_POSTGRES)
        local password
        password=$(docker inspect operations-contract-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)
        export OSHAL_TEST_POSTGRES="postgresql://postgres:$password@127.0.0.1:35689/postgres" ;;
      OSHAL_TEST_SEARCH)
        export OSHAL_TEST_SEARCH=http://127.0.0.1:35690
        # What killed runs left in the shared test search goes before this run starts; a refusing engine is named here.
        node "$(dirname "${BASH_SOURCE[0]}")/sweep-test-search.mjs" http://127.0.0.1:35690 || true ;;
      CAREER_TEST_POSTGRES_ADMIN_URL)
        export CAREER_TEST_POSTGRES_ADMIN_URL="postgresql://postgres:$STORE_GATE_CAREER_PASSWORD@127.0.0.1:55469/postgres" ;;
    esac
  done
  store_gate_settings
}

# @description Export the settings every gate run needs that are not services.
# @returns 0.
store_gate_settings() {
  local runtime=$HOME/.local/state/oshal-publishing-runtime
  export PATH=$HOME/.local/state/oshal-test-fixtures/career-node24/python/bin:$PATH
  export OSHAL_PUBLISHING_PYTHON=$runtime/rt/python/bin/python3
  export OSHAL_PUBLISHING_TYPST=$runtime/rt/typst
  export OSHAL_PUBLISHING_TYPST_ARCHIVE=$runtime/originals/typst-0.15.1-aarch64.tar.xz
  export OSHAL_PUBLISHING_WHEEL_DIR=$runtime/originals/wheels
}

# @description Stop the containers store_gate_services_up started, and no other.
# @returns 0.
store_gate_services_down() {
  [ "${#STORE_GATE_STARTED[@]}" -eq 0 ] || docker stop "${STORE_GATE_STARTED[@]}" >/dev/null
  STORE_GATE_STARTED=()
}

# @description The service variables a gate plan names, read from its result file.
# @param $1 The result file a --plan run wrote.
# @returns The variables, one per line; non-zero when the file cannot be read.
store_gate_planned_services() {
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    if(!Array.isArray(r.services))process.exit(1);for(const s of r.services)console.log(s)' "$1"
}
