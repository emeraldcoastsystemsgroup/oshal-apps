#!/usr/bin/env bash
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- fly one leg of the PX4 cross-check (BACKLOG B28)
#     |                                           | standalone: its own private docker network, the official PX4 SITL
#     |                                           | image as the vehicle, the harness in the engine image with THIS
#     |                                           | engine tree mounted read-only. Nothing joins the stack network,
#     |                                           | nothing publishes a port, and the containers and the network are
#     |                                           | removed on exit, whatever happened.
#
# Usage: bash engine/crosscheck/run-leg.sh sih|external <out-dir> [label]
#   sih       PX4 flies its own SIH physics (sihsim_quadx) with the declared F450 set by PARAM_SET.
#   external  PX4 none_iris dials a simulator already listening on TCP 4560 at EMBODIED_PX4_SIM_HOSTNAME
#             (default host.docker.internal: the Docker Desktop host) and runs in lockstep with it. That
#             simulator -- PteroSim -- is started, licensed and given the F450 with PX4 as its control
#             source by its operator; this script never downloads, starts or accepts anything for it.
# Writes <out-dir>/<leg>-trajectory.json and <out-dir>/<leg>-px4.log; exits with the harness's code.
# Then: python engine/crosscheck/divergence.py <out-dir>/sih-trajectory.json <out-dir>/external-trajectory.json
set -euo pipefail

leg="${1:-}"
out="${2:-}"
label="${3:-}"
case "$leg" in
  sih) model=sihsim_quadx; alias=embodied-px4; label="${label:-px4-sih}" ;;
  external) model=none_iris; alias=embodied-px4-external; label="${label:-external-simulator}" ;;
  *) echo "usage: run-leg.sh sih|external <out-dir> [label]" >&2; exit 2 ;;
esac
[ -n "$out" ] || { echo "usage: run-leg.sh sih|external <out-dir> [label]" >&2; exit 2; }
mkdir -p "$out"

# Docker Desktop on Windows needs a drive path for a bind mount; Git Bash's pwd -W gives one, elsewhere pwd does.
host_path() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
export MSYS_NO_PATHCONV=1
engine_dir="$(host_path "$(dirname "$0")/..")"
out_dir="$(host_path "$out")"
engine_image="${EMBODIED_ENGINE_IMAGE:-oshal-embodied-engine:local}"
px4_image="${EMBODIED_PX4_IMAGE:-px4io/px4-sitl:latest}"
sim_host="${EMBODIED_PX4_SIM_HOSTNAME:-host.docker.internal}"
run_id="xc-$leg-$$"
net="$run_id-net"

cleanup() {
  docker logs "$run_id-px4" > "$out/$leg-px4.log" 2>&1 || true
  docker rm -f "$run_id-harness" "$run_id-px4" > /dev/null 2>&1 || true
  docker network rm "$net" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" > /dev/null
# The px4 binary runs directly with stdin open, as the compose services run it: the image's entrypoint would aim every
# MAVLink link at host.docker.internal, and the pxh shell spins on EOF without stdin.
# Only the external leg names a simulator host: SIH is its own simulator.
sim_env=(-e "PX4_SIM_MODEL=$model")
if [ "$leg" = external ]; then sim_env+=(-e "PX4_SIM_HOSTNAME=$sim_host" -e PX4_SIM_SPEED_FACTOR=1); fi
docker run -d -i --init --name "$run_id-px4" --network "$net" --network-alias "$alias" --memory 512m \
  --entrypoint /opt/px4/bin/px4 "${sim_env[@]}" "$px4_image" > /dev/null

status=0
docker run --rm --name "$run_id-harness" --network "$net" --memory 768m \
  -v "$engine_dir:/xc/engine:ro" -v "$out_dir:/xc/out" \
  -e EMBODIED_ENGINE_DIR=/xc/engine -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint python "$engine_image" \
  /xc/engine/crosscheck/px4_crosscheck.py --backend "$leg" --simulator "$label" --px4 "$alias:14580" --listen 14540 \
  --out "/xc/out/$leg-trajectory.json" || status=$?
exit "$status"
