"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Package entry point so `python -m aerosim.vehicle` runs the acceptance self-test (a package cannot be executed from its __init__ alone).
"""

import sys

from . import _selftest

sys.exit(_selftest())
