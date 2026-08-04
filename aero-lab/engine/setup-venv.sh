#!/usr/bin/env bash
# CHANGE LOG
# -----------------------------------------------------------------------------
# DATE/TIME           | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- rebuild
#                     |                             | the dedicated aerosim venv on a fresh
#                     |                             | POSIX box (Python 3.11 + exact pins).
#
# Usage:  bash setup-venv.sh [engine-dir]
# Builds <engine-dir>/.venv (default: this directory, which carries the
# vendored aerosim tree). Dedicated venv on purpose: exact pins keep the
# surrogate model's numbers reproducible.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="${1:-$SCRIPT_DIR}"
REQ="$SCRIPT_DIR/requirements.txt"
VENV="$ENGINE_DIR/.venv"

[ -f "$REQ" ] || { echo "requirements.txt not found at $REQ" >&2; exit 1; }

PY=python3.11
command -v "$PY" >/dev/null 2>&1 || PY=python3
echo "Creating venv at $VENV with $PY ..."
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$REQ"

echo "Verifying the engine imports from $ENGINE_DIR ..."
AERO_LAB_ENGINE_DIR="$ENGINE_DIR" "$VENV/bin/python" -c "
import sys, os
sys.path.insert(0, os.environ['AERO_LAB_ENGINE_DIR'])
import aerosim.validate_designs, aerosim.integrate
import aerosim.validate_screen, aerosim.aeropolar
print('aerosim stable entry points import OK')
"
echo "Done. Point AERO_LAB_PYTHON at $VENV/bin/python and AERO_LAB_ENGINE_DIR at $ENGINE_DIR"
