#!/usr/bin/env bash
# Local review only. Keep existing38820 alive; use an independent state file and port.
set -euo pipefail
review_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
source "${EDITOR_REVIEW_ENV_FILE:-$HOME/.local/state/oshal-editor-foundation/fixture.env}"
export OSHAL_CORE_ROOT="${OSHAL_CORE_ROOT:-$HOME/Documents/projects/oshal/src}"
export OSHAL_EDITOR_SHARP_ROOT="${OSHAL_EDITOR_SHARP_ROOT:-$HOME/.local/state/oshal-editor-foundation/native-office-runtime}"
export OSHAL_PDF_TEST_PYTHON="${OSHAL_PDF_TEST_PYTHON:-$HOME/.local/state/oshal-editor-buildout/pdf-runtime/bin/python}"
export MOTION_ENGINE_BINARY="${MOTION_ENGINE_BINARY:-$HOME/oshal-work/kernel-landing-fixtures/creative/oshal-motion-engine}"
export MOTION_RASTER_DEPS="${MOTION_RASTER_DEPS:-$OSHAL_CORE_ROOT}"
export EDITOR_FULL_REVIEW_PORT="${EDITOR_FULL_REVIEW_PORT:-38821}"
cd -- "$review_root"
exec "${EDITOR_REVIEW_NODE:-node}" scripts/editor-foundation/full-review-server.mjs
