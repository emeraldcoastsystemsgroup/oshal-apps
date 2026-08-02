#!/usr/bin/env bash
# Verify that career-hunter ("Intelligent Career") is genuinely installed and working on a
# local swarm. Read-only: it changes nothing and is safe to run any time.
#
# WHY THIS EXISTS
#
# This app has been "reinstalled" repeatedly because there was no way to answer "is it
# actually working?" without an archaeology session. Every check below corresponds to a
# failure that really happened:
#
#   v1.3.0 was declared carved and done while the volume still held v1.1.0 with ZERO engine
#   files -- so REPO STATE IS NOT INSTALL STATE, and this hashes the two.
#
#   A leftover `career-hunter.bak-v140` directory inside deployed-apps/ re-registered the
#   app at the OLD version, because the loader scans every subdirectory and does not dedupe
#   by manifest name. Silent: newest version staged, older version registered.
#
#   The board timed out at 120s because sqlite_stat1 was missing from BOTH databases and
#   the corpus had only single-column indexes on ~50%-selective flags.
#
#   `corpus.db` cannot be opened standalone (company_view hardcodes a `corpus.` prefix),
#   so any check that does so reports "malformed database schema" on a perfectly good file.
#   Everything here goes through the engine's own db.connect().
#
# Usage:  bash scripts/verify-install.sh [user_sub]
# Exit:   0 = all checks passed, 1 = at least one FAIL.

set -uo pipefail

API="${OSHAL_API_CONTAINER:-oshal-local-api}"
DB="${OSHAL_DB_CONTAINER:-oshal-local-db}"
APP="career-hunter"
PKG="/app/workspace-shared/deployed-apps/${APP}"
ENGINE="${PKG}/engine"
DATA_ROOT="${CAREER_DATA_ROOT:-/app/output/career-hunter-data/default}"
SUB="${1:-${OSHAL_USER_SUB:-}}"

pass=0; fail=0; warn=0
ok()   { printf '  \033[32m[PASS]\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  \033[33m[WARN]\033[0m %s\n' "$1"; warn=$((warn+1)); }
hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

hdr "1. containers"
for c in "$API" "$DB"; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    ok "$c running"
  else
    bad "$c NOT running — start the stack first (bash scripts/oshal-up.sh in the core repo)"
    echo; echo "aborting: nothing else can be checked"; exit 1
  fi
done

hdr "2. registration (DB) vs staged package (volume)"
DB_VER=$(docker exec "$DB" psql -U oshal -d oshal -t -A \
          -c "select version from swarm_applications where name='${APP}';" 2>/dev/null | tr -d ' \r')
DB_STATUS=$(docker exec "$DB" psql -U oshal -d oshal -t -A \
          -c "select status from swarm_applications where name='${APP}';" 2>/dev/null | tr -d ' \r')
VOL_VER=$(docker exec "$API" sh -lc "grep -m1 '^version:' ${PKG}/oshal-app.yaml 2>/dev/null | awk '{print \$2}'" | tr -d ' \r')

[ -n "$DB_VER" ] && ok "registered in swarm_applications (v${DB_VER}, ${DB_STATUS})" \
                 || bad "NOT registered in swarm_applications — the app never loaded"
[ "$DB_STATUS" = "active" ] || note "status is '${DB_STATUS}', expected 'active'"
[ -n "$VOL_VER" ] && ok "staged on the volume (v${VOL_VER})" \
                  || bad "no manifest at ${PKG}/oshal-app.yaml — the package is not staged"

if [ -n "$DB_VER" ] && [ -n "$VOL_VER" ]; then
  [ "$DB_VER" = "$VOL_VER" ] \
    && ok "registered version == staged version" \
    || bad "VERSION DRIFT: registered v${DB_VER} but staged v${VOL_VER} (see check 3 — a stray package dir usually causes this)"
fi

hdr "3. no stray directory claiming the same app name"
# The loader scans EVERY subdirectory of deployed-apps and registers by manifest `name:`.
# A backup/staging copy therefore silently overwrites the real registration.
CLAIMERS=$(docker exec "$API" sh -lc "
  for f in /app/workspace-shared/deployed-apps/*/oshal-app.yaml; do
    n=\$(grep -m1 '^name:' \"\$f\" 2>/dev/null | awk '{print \$2}')
    [ \"\$n\" = '${APP}' ] && dirname \"\$f\"
  done" 2>/dev/null)
N_CLAIM=$(printf '%s\n' "$CLAIMERS" | grep -c . || true)
if [ "$N_CLAIM" -eq 1 ]; then
  ok "exactly one directory declares name: ${APP}"
elif [ "$N_CLAIM" -eq 0 ]; then
  bad "no directory declares name: ${APP}"
else
  bad "${N_CLAIM} directories declare name: ${APP} — the last one loaded WINS and silently overwrites:"
  printf '           %s\n' $CLAIMERS
  echo "           move backups OUT of deployed-apps/ (e.g. to /app/output/_pkg-backups/)"
fi

hdr "4. engine present and importable"
N_ENGINE=$(docker exec "$API" sh -lc "ls -1 ${ENGINE}/jobhunter/*.py 2>/dev/null | wc -l" | tr -d ' \r')
[ "${N_ENGINE:-0}" -gt 20 ] \
  && ok "engine shipped (${N_ENGINE} jobhunter modules)" \
  || bad "engine missing or truncated (${N_ENGINE} modules) — this is the v1.3.0 failure shape"

if docker exec "$API" sh -lc "cd ${ENGINE} && PYTHONPATH=${ENGINE} python3 -c 'import jobhunter, jobhunter.db, jobhunter.score' " >/dev/null 2>&1; then
  ok "engine imports cleanly inside the container"
else
  bad "engine FAILS to import — a runtime dependency is missing from the image"
fi

hdr "5. package migrations applied"
for m in $(docker exec "$API" sh -lc "ls -1 ${PKG}/migrations/*.sql 2>/dev/null | xargs -n1 basename"); do
  n=$(docker exec "$DB" psql -U oshal -d oshal -t -A \
        -c "select count(*) from app_package_migrations where app_name='${APP}' and file_name like '%${m}';" 2>/dev/null | tr -d ' \r')
  [ "${n:-0}" -ge 1 ] && ok "migration applied: ${m}" || note "migration not recorded: ${m}"
done

hdr "6. data stores readable (via the engine, never standalone)"
if [ -z "$SUB" ]; then
  note "no user_sub given — skipping per-user checks. Pass one: bash scripts/verify-install.sh <sub>"
else
  docker exec "$API" sh -lc "
    cd ${ENGINE}; export PYTHONPATH=${ENGINE}
    export JOBHUNTER_MULTIUSER=1 OSHAL_USER_SUB=${SUB}
    export JOBHUNTER_CORPUS_DB=${DATA_ROOT}/corpus.db
    export JOBHUNTER_USER_DB=${DATA_ROOT}/${SUB}/user-${SUB}.db
    python3 - <<'PYEOF'
import time
from jobhunter import db
try:
    with db.connect() as c:
        posts = c.execute('select count(*) from corpus.postings_corpus').fetchone()[0]
        newest = c.execute('select max(first_seen_at) from corpus.postings_corpus').fetchone()[0]
        sigs = c.execute('select count(*) from user_signals').fetchone()[0]
        scored = c.execute('select count(*) from user_signals where ai_fit_score is not null').fetchone()[0]
        print(f'DATA corpus={posts} newest={newest} signals={sigs} scored={scored}')
        for sch in ('main', 'corpus'):
            n = c.execute(f\"select count(*) from {sch}.sqlite_master where name='sqlite_stat1'\").fetchone()[0]
            print(f'STATS {sch}={\"present\" if n else \"MISSING\"}')
        t0 = time.perf_counter()
        c.execute('''SELECT pc.id FROM corpus.postings_corpus pc
                     JOIN user_signals us ON us.posting_id = pc.id
                     WHERE pc.active=1 AND pc.target_role=1 AND us.ai_fit_score IS NOT NULL
                     ORDER BY us.ai_fit_score DESC LIMIT 50''').fetchall()
        print(f'BOARDMS {(time.perf_counter()-t0)*1000:.0f}')
except Exception as e:
    print(f'ERROR {e}')
PYEOF" 2>/dev/null | while read -r line; do
    case "$line" in
      DATA*)  ok "stores readable — ${line#DATA }" ;;
      STATS*present) ok "ANALYZE stats ${line#STATS }" ;;
      STATS*MISSING) bad "ANALYZE never run (${line#STATS }) — planner is blind; run engine/_optimize_swarm_db.py" ;;
      BOARDMS*) ms=${line#BOARDMS }
                if [ "${ms%.*}" -lt 1000 ]; then ok "board query ${ms}ms"
                else bad "board query ${ms}ms — too slow; run engine/_optimize_swarm_db.py"; fi ;;
      ERROR*) bad "store read failed: ${line#ERROR }" ;;
    esac
  done
fi

hdr "7. the tool the bot actually calls"
if [ -n "$SUB" ]; then
  if docker exec "$API" sh -lc "OSHAL_USER_SUB=${SUB} OSHAL_TENANT=default timeout 180 node ${PKG}/bin/oshal-jobhunter.js query" 2>/dev/null \
       | grep -q '"topMatches"'; then
    ok "career_database tool returns per-user data"
  else
    bad "career_database tool returned nothing usable — the bot cannot answer job questions"
  fi
fi

hdr "8. nightly automation (the in-swarm cron)"
# TWO switches are required and neither is sufficient alone. With the cron on but nobody
# opted in, the evening chain runs every night and does NOTHING -- no scrape, no score, no
# drafts -- and says so only at info level. That combination looks healthy and produces no
# data, which is the worst failure shape here.
CRON=$(docker exec "$API" sh -lc 'echo -n "$CAREER_HUNTER_CRON"' 2>/dev/null | tr -d ' \r')
case "$CRON" in
  1|true|yes|TRUE|YES) ok "CAREER_HUNTER_CRON=${CRON} (cron enabled)" ;;
  "")  bad "CAREER_HUNTER_CRON unset — no nightly ingest; the app only refreshes when asked" ;;
  *)   bad "CAREER_HUNTER_CRON=${CRON} — nightly ingest is OFF" ;;
esac

OPTED=$(docker exec "$DB" psql -U oshal -d oshal -t -A \
         -c "select count(*) from career_automation_settings where auto_generate;" 2>/dev/null | tr -d ' \r')
if [ "${OPTED:-0}" -ge 1 ]; then
  ok "${OPTED} user(s) opted in to automation — the evening chain will run"
else
  bad "NO user has auto_generate=true — a cron-triggered evening chain skips the scrape ENTIRELY (silent no-op)"
fi

SUBMIT=$(docker exec "$DB" psql -U oshal -d oshal -t -A \
          -c "select count(*) from career_automation_settings where auto_submit;" 2>/dev/null | tr -d ' \r')
[ "${SUBMIT:-0}" -eq 0 ] \
  && ok "auto_submit off for everyone — nothing is submitted without a human" \
  || note "${SUBMIT} user(s) have auto_submit=true — applications submit automatically"

# The burst caps. Unset is not fatal (code defaults apply) but it means the nightly LLM
# spend is implicit rather than declared.
for v in CAREER_SCORE_FIRST_SEEN_DAYS CAREER_SCORE_CATCHUP_LIMIT CAREER_TITLE_PASS_LIMIT; do
  val=$(docker exec "$API" sh -lc "echo -n \"\$$v\"" 2>/dev/null | tr -d ' \r')
  [ -n "$val" ] && ok "burst cap ${v}=${val}" || note "${v} unset — using the code default"
done

# A completed evening chain writes this marker; catch-up re-fires whenever it predates the
# most recent 18:00 CT window. Its absence on a fresh install is normal, not a failure.
MARKER=$(docker exec "$API" sh -lc "cat ${DATA_ROOT}/.last-evening-run 2>/dev/null" | tr -d ' \r')
[ -n "$MARKER" ] \
  && ok "last completed evening chain: ${MARKER}" \
  || note "no .last-evening-run marker yet — the chain has not completed since it was enabled"

hdr "9. ingest is not running twice"
# Once the swarm owns ingest, the old Windows JobHunter* tasks scrape the SAME employers.
# This check only applies on the operator's Windows box; elsewhere it is a no-op.
if command -v powershell.exe >/dev/null 2>&1; then
  ENABLED_TASKS=$(powershell.exe -NoProfile -Command \
    "(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { \$_.TaskName -match 'JobHunter' -and \$_.State -ne 'Disabled' }).TaskName" 2>/dev/null | tr -d '\r')
  if [ -z "$ENABLED_TASKS" ]; then
    ok "no enabled Windows JobHunter* tasks — the swarm is the only ingest"
  else
    note "Windows tasks still enabled (duplicate nightly ingest against the same employers):"
    printf '           %s\n' $ENABLED_TASKS
  fi
else
  ok "not the Windows operator box — duplicate-ingest check not applicable"
fi

hdr "result"
printf '  %d passed, %d failed, %d warnings\n\n' "$pass" "$fail" "$warn"
[ "$fail" -eq 0 ] || exit 1
