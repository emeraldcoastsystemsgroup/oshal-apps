"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Package entry point so `python -m aerosim.env` runs the acceptance self-test. Without this, `-m` raised "aerosim.env is a package and cannot be directly executed" while every sibling module supported -m; the self-test itself was always present in __init__.py.
"""

import sys

from . import _selftest

sys.exit(_selftest())
