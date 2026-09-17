"""
CHANGE LOG
-----------------------------------------------------------------------------
DATE/TIME           | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
2026-09-16 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- import the real
                    |                             | engine/service.py and print the engine dir its
                    |                             | own resolver chose, so the worker's half of the
                    |                             | engine-dir contract is proven on the shipped
                    |                             | file rather than restated in TypeScript.

Usage: python engine-dir-probe.py <path to engine/service.py>
"""

import importlib.util
import json
import sys


def main() -> int:
    """@description Load service.py by path and report its resolved ENGINE_DIR.
    @returns Process exit code."""
    target = sys.argv[1]
    spec = importlib.util.spec_from_file_location("aero_lab_service_probe", target)
    if spec is None or spec.loader is None:
        sys.stderr.write("cannot load %s\n" % target)
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.stdout.write(json.dumps({"engineDir": module.ENGINE_DIR}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
