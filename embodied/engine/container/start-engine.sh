#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-203: an engine installed from this package alone carries the certified gait. The policies the image ships go beside the engine's reports at every start, replacing an older copy so the certificate always matches this image's build; a person's own reports on the volume are left alone. The exported weights stay in policies/ for the node: the bridge reads every .json in the report directory as a report. Not an engine runtime file, so it never moves the build hash.
set -eu
ENGINE="${EMBODIED_ENGINE_DIR:-/opt/embodied/engine}"
REPORTS="${EMBODIED_REPORT_DIR:-/tmp/embodied-reports}"
mkdir -p "$REPORTS"
for shipped in "$ENGINE"/policies/*; do
  [ -f "$shipped" ] || continue
  case "$shipped" in *.weights.json) continue ;; esac
  cp -f "$shipped" "$REPORTS/"
done
exec "$@"
