"""
CHANGE LOG
-----------------------------------------------------------------------------
DATE/TIME           | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- the
                    |                             | BUILD_CONTRACT 5a spawn target. The
                    |                             | implementation lives in service.py;
                    |                             | this file exists so the frozen worker
                    |                             | path <package>/engine/aero_lab_worker.py
                    |                             | stays stable even if the service is
                    |                             | ever decomposed further.

aero_lab_worker -- entry point the Node adapter spawns (BUILD_CONTRACT 5a).
Delegates to service.main(): the JSON-lines stdio protocol worker.
"""

from service import main

if __name__ == "__main__":
    raise SystemExit(main())
