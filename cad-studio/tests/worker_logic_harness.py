# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Drive cad_worker's own orchestration with the
#   |                                           | kernel stubbed OUT (no CadQuery, so it runs in
#   |                                           | store CI): the per-feature budget (BACKLOG B5) and
#   |                                           | the refusals the worker makes BEFORE any kernel
#   |                                           | call (BACKLOG B1). The stub raises if the kernel is
#   |                                           | ever reached, so a refusal that leaks into CadQuery
#   |                                           | shows up as "kernel refused" and fails the spec.
#   |                                           | This proves branch logic only; the geometry is the
#   |                                           | engine image's real-kernel suite.
"""Print one JSON object describing the worker's behaviour; tests/worker-logic.test.js asserts it.
Usage: python worker_logic_harness.py <engine dir>"""
import json
import sys
import time
import types


class KernelReached(Exception):
    """Raised by the stub: the worker called into CadQuery."""


def _kernel(*_args, **_kwargs):
    raise KernelReached("the kernel was called")


stub = types.ModuleType("cadquery")
stub.Workplane = _kernel
stub.__version__ = "stub"
sys.modules["cadquery"] = stub
sys.path.insert(0, sys.argv[1])
import cad_worker as w  # noqa: E402


class Solid:
    def __init__(self, volume):
        self.volume = volume

    def Volume(self):  # noqa: N802 -- the OCCT spelling the worker calls
        return self.volume

    def isValid(self):  # noqa: N802
        return True


class Shape:
    def __init__(self, volume):
        self.solid = Solid(volume)

    def val(self):
        return self.solid


def timed(ms, volume):
    def run(_shape, _params):
        time.sleep(ms / 1000.0)
        return Shape(volume)
    return run


w.FEATURES.update({"slow": timed(300, 10.0), "fast": timed(0, 20.0)})
w.BASES["stub"] = lambda _p: Shape(100.0)


def run(features, budget=None):
    shape, statuses = w.build({"kind": "stub"}, features, budget)
    return {"volume": shape.val().Volume(), "features": statuses}


def refusal(ftype, params):
    return run([{"id": ftype, "type": ftype, "params": params}])["features"][0]


def budget_answer(value):
    try:
        return {"ok": w.feature_budget(value)}
    except w.FeatureError as err:
        return {"error": str(err)}


SQUARE = [[-5, -5], [5, -5], [5, 5], [-5, 5]]
out = {
    "overBudgetFirst": run([{"id": "s", "type": "slow"}, {"id": "f", "type": "fast"}], 150),
    "overBudgetLast": run([{"id": "f", "type": "fast"}, {"id": "s", "type": "slow"}], 150),
    "noBudget": run([{"id": "s", "type": "slow"}]),
    "generous": run([{"id": "s", "type": "slow"}], 600000),
    "disabledNeverRuns": run([{"id": "s", "type": "slow", "enabled": False}], 1),
    "budgets": {repr(v): budget_answer(v) for v in (None, 1, 600000, 0, 600001, 2.5, "60000", True)},
    "refusals": {
        "revolveAxisOffPlane": refusal("revolve", {"points": [[1, 0], [2, 0], [2, 3]], "axis": "y"}),
        "revolveXYAxisZ": refusal("revolve", {"points": [[1, 0], [2, 0], [2, 3]], "plane": "XY", "axis": "z"}),
        "revolveZeroDegrees": refusal("revolve", {"points": [[1, 0], [2, 0], [2, 3]], "degrees": 0}),
        "sweepOnePointPath": refusal("sweep", {"points": SQUARE, "path": [[0, 0]]}),
        "sweepBadPathPlane": refusal("sweep", {"points": SQUARE, "path": [[0, 0], [0, 9]], "pathPlane": "ZX"}),
        "loftOneSection": refusal("loft", {"sections": [{"points": SQUARE, "offset": 0}]}),
        "loftRepeatedOffset": refusal("loft", {"sections": [{"points": SQUARE, "offset": 5}, {"points": SQUARE, "offset": 5}]}),
        "loftSectionNotObject": refusal("loft", {"sections": [{"points": SQUARE}, "square"]}),
        "loftRuledNotBool": refusal("loft", {"sections": [{"points": SQUARE}, {"points": SQUARE, "offset": 5}], "ruled": "yes"}),
        "loftTooManySections": refusal("loft", {"sections": [{"points": SQUARE, "offset": i} for i in range(33)]}),
    },
    "validLoftReachesKernel": refusal("loft", {"sections": [{"points": SQUARE}, {"points": SQUARE, "offset": 5}]}),
}
print(json.dumps(out))
