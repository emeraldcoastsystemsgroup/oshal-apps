#!/usr/bin/env bash
# =============================================================================
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | The scheduled full run (Roger, 2026-11-14: "we ran the full suite today, we dont need to do it every time"). A push now runs the gate scoped to its change, so the whole suite has to run somewhere on a clock: this runs every store-ci job on a clean checkout of origin/main (never a working tree with someone's edits in it), under the coordination heavy lock so it never overlaps another lane's heavy work, writes a dated receipt and log, reruns only the failed jobs once (as store-push does), and exits non-zero when the suite is red. Started by the systemd user timer in scripts/systemd/.
# =============================================================================
#
# Usage, from any store clone (it fetches origin and tests origin/main, not this tree):
#   bash scripts/store-full-run.sh
#
# Receipts:  $STORE_FULL_RUN_RECEIPTS (default ~/.local/state/oshal-store-gate/full-runs/)
#            <UTC stamp>-<commit>.json   the gate's result: mode full, verdict, every failed test
#            <UTC stamp>-<commit>.log    everything the gate printed
#            latest.json                 a copy of the newest receipt
# Env:       STORE_FULL_RUN_REF          what to test (default origin/main)
#            STORE_FULL_RUN_LOCK         the lock (default /tmp/oshal-coordination-heavy.lock)
#            STORE_FULL_RUN_LOCK_WAIT    seconds to wait for it (default 14400); past that, exit 75
#            STORE_FULL_RUN_FETCH=0      do not fetch first (tests)
#            STORE_FULL_RUN_SERVICES=0   do not start the test services (tests)
#            STORE_FULL_RUN_INSTALL=0    do not install the gate's toolchain in the checkout (tests)
#            STORE_FULL_RUN_KEEP=1       keep the checkout afterwards
#            OSHAL_CORE_ROOT, STORE_CI_KERNEL_PLATFORM: the kernel exports some suites need, as for a push.
# Exit:      0 the whole suite passed; 1 it failed or did not complete; 75 the lock was busy too long.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$(cd "$HERE/.." && pwd)"
REF=${STORE_FULL_RUN_REF:-origin/main}
RECEIPTS=${STORE_FULL_RUN_RECEIPTS:-$HOME/.local/state/oshal-store-gate/full-runs}
LOCK=${STORE_FULL_RUN_LOCK:-/tmp/oshal-coordination-heavy.lock}
WAIT=${STORE_FULL_RUN_LOCK_WAIT:-14400}
say() { printf 'store-full-run: %s\n' "$*" >&2; }

mkdir -p "$RECEIPTS" || exit 1
exec 9>>"$LOCK" || { say "cannot open the lock $LOCK"; exit 1; }
say "waiting for $LOCK (up to ${WAIT}s)"
flock -w "$WAIT" 9 || { say "the lock $LOCK stayed busy for ${WAIT}s; no run, no receipt"; exit 75; }

if [ "${STORE_FULL_RUN_FETCH:-1}" != "0" ]; then
  git -C "$SOURCE" fetch -q origin || { say "git fetch origin failed in $SOURCE"; exit 1; }
fi
COMMIT=$(git -C "$SOURCE" rev-parse --verify --quiet "$REF^{commit}") || { say "$REF is not a commit in $SOURCE"; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="$STAMP-${COMMIT:0:8}"
WORK="$RECEIPTS/work-$NAME"
RECEIPT="$RECEIPTS/$NAME.json"
LOG="$RECEIPTS/$NAME.log"
cleanup() {
  declare -F store_gate_services_down >/dev/null && store_gate_services_down
  [ "${STORE_FULL_RUN_KEEP:-0}" = "1" ] || rm -rf "$WORK"
}
trap cleanup EXIT

# A clean checkout of exactly that commit: no working-tree edits, no untracked files, no hooks.
git clone -q --shared --no-checkout "$SOURCE" "$WORK" || { say "could not clone $SOURCE"; exit 1; }
git -C "$WORK" checkout -q --detach "$COMMIT" || { say "could not check out $COMMIT"; exit 1; }
git -C "$WORK" update-ref refs/remotes/origin/main "$COMMIT"
if [ "${STORE_FULL_RUN_INSTALL:-1}" != "0" ]; then
  npm ci --prefix "$WORK/scripts/toolchain" --no-audit --no-fund >/dev/null 2>&1 \
    || { say "npm ci --prefix scripts/toolchain failed in the checkout"; exit 1; }
fi
# The checkout's own copy of the services helper, so the run uses what that commit declares.
# shellcheck source=scripts/store-gate-services.sh
source "$WORK/scripts/store-gate-services.sh"
if [ "${STORE_FULL_RUN_SERVICES:-1}" = "0" ]; then
  store_gate_settings
else
  store_gate_services_up || { say "the test services could not be started"; exit 1; }
fi

say "full run of $REF $COMMIT in $WORK; log $LOG"
{
  echo "start $(date -u +%Y-%m-%dT%H:%M:%SZ) ref $REF commit $COMMIT"
  ( cd "$WORK" && STORE_CI_RESULT_FILE="$RECEIPTS/$NAME.first.json" node scripts/store-ci-local.mjs --full )
} > "$LOG" 2>&1
STATUS=$?
FINAL="$RECEIPTS/$NAME.first.json"
RETRYABLE=$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).retryable===true))}catch{process.stdout.write("false")}' "$FINAL")
if [ "$STATUS" -ne 0 ] && [ "$RETRYABLE" = "true" ]; then
  # One more try of the failed jobs only, on the same checkout, when every failure was a package suite
  # that ran and went red (a busy machine). A structural rule or a missing service fails the same way twice.
  echo "=== rerun of the failed jobs ===" >> "$LOG"
  ( cd "$WORK" && STORE_CI_RESULT_FILE="$RECEIPTS/$NAME.retry.json" node scripts/store-ci-local.mjs --full --retry-from "$FINAL" ) >> "$LOG" 2>&1
  STATUS=$?
  [ -f "$RECEIPTS/$NAME.retry.json" ] && FINAL="$RECEIPTS/$NAME.retry.json"
fi
echo "end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $STATUS" >> "$LOG"

# The receipt is the gate's own result, with where it ran and the first run's failures beside it.
if [ -f "$FINAL" ]; then
  node -e '
    const fs = require("fs");
    const [final, first, ref, commit, log, status] = process.argv.slice(1);
    const result = JSON.parse(fs.readFileSync(final, "utf8"));
    const firstRun = final === first ? null : JSON.parse(fs.readFileSync(first, "utf8"));
    const receipt = { kind: "store-full-run", ref, commit, log, exit: Number(status), ...result,
      ...(firstRun ? { firstRunFailed: firstRun.failed } : {}) };
    fs.writeFileSync(final.replace(/[.](first|retry)[.]json$/, ".json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  ' "$FINAL" "$RECEIPTS/$NAME.first.json" "$REF" "$COMMIT" "$LOG" "$STATUS" || STATUS=1
  rm -f "$RECEIPTS/$NAME.first.json" "$RECEIPTS/$NAME.retry.json"
else
  printf '{"kind":"store-full-run","ref":"%s","commit":"%s","log":"%s","exit":%s,"verdict":"no-result"}\n' \
    "$REF" "$COMMIT" "$LOG" "$STATUS" > "$RECEIPT"
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
cp "$RECEIPT" "$RECEIPTS/latest.json"
say "$(tail -n 2 "$LOG" | head -n 1)"
say "receipt $RECEIPT (exit $STATUS)"
exit "$STATUS"
