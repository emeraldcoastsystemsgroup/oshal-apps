# CHANGE LOG
# -----------------------------------------------------------------------------
# DATE/TIME           | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 2026-08-03 00:55:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — live-engine
#                     |                             | probe worker for the LIVE round-trip spec ONLY. It
#                     |                             | speaks the frozen BUILD_CONTRACT §5b protocol and
#                     |                             | computes REAL numbers with the REAL aerosim engine
#                     |                             | (wing_polar) from the dedicated venv — it fakes the
#                     |                             | packaging (agent A's engine/aero_lab_worker.py),
#                     |                             | never the physics. The live spec prefers agent A's
#                     |                             | worker when it exists on disk; this file bridges the
#                     |                             | concurrent-build window so the adapter's transport +
#                     |                             | the engine's numbers are proven together TODAY.
"""Live-probe §5b worker: capabilities + polar against the real aerosim tree."""

import json
import math
import os
import sys
import warnings

warnings.simplefilter("ignore")

if sys.platform == "win32":  # BelowNormal priority — FP_01 sanctioned pattern
    try:
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )
    except Exception as exc:  # noqa: BLE001 — priority is best-effort
        print(f"live-probe: priority set failed: {exc}", file=sys.stderr)

sys.path.insert(0, os.environ.get("AERO_LAB_ENGINE_DIR", os.getcwd()))

_POLAR_OK = False
_POLAR_WHY = "not attempted"
try:
    import numpy as np
    from aerosim import aeropolar

    _POLAR_OK = True
    _POLAR_WHY = ""
except Exception as exc:  # noqa: BLE001 — feature-detect, never crash (§5c)
    _POLAR_WHY = f"{type(exc).__name__}: {exc}"
    print(f"live-probe: aeropolar import failed: {_POLAR_WHY}", file=sys.stderr)


def _capabilities() -> dict:
    """Honest minimal capability report: this probe implements polar only."""
    return {
        "engineVersion": None,
        "python": "%d.%d.%d" % sys.version_info[:3],
        "capabilities": {
            "polar": _POLAR_OK,
            "evaluate": False,
            "screen": False,
            "mission": False,
            "export": False,
            "hybrid": False,
            "modules": {},
            "probe": "live-probe-worker (tests-only bridge; polar only)",
        },
        "bounds": None,
    }


def _polar(design: dict) -> dict:
    """Real wing polar for the wire-shape design vector (§2a response shape)."""
    span_m = math.sqrt(float(design["aspect_ratio"]) * float(design["area_m2"]))
    up_w, lo_w, le_w, te_t = aeropolar.naca_kulfan("2412")
    alpha = np.arange(-2.0, 12.5, 1.0)
    p = aeropolar.wing_polar(
        span_m=span_m,
        area_m2=float(design["area_m2"]),
        taper_ratio=float(design["taper_ratio"]),
        sweep_deg=0.0,
        twist_root_deg=float(design["twist_root_deg"]),
        twist_tip_deg=float(design["twist_tip_deg"]),
        kulfan_upper=np.asarray(up_w, dtype=float),
        kulfan_lower=np.asarray(lo_w, dtype=float),
        leading_edge_weight=float(le_w),
        TE_thickness=float(te_t),
        alpha_deg=alpha,
        V_ms=10.0,
        rho_kgm3=1.225,
        mu_Pas=1.81e-5,
        extra_CD0=float(design.get("extra_CD0", 0.0)),
    )
    cl = [float(x) for x in np.asarray(p.CL)]
    cd = [float(x) for x in np.asarray(p.CD)]
    cdi = [float(x) for x in np.asarray(p.CDi)]
    cdp = [float(x) for x in np.asarray(p.CDp)]
    ld = [c / d if d > 0 else 0.0 for c, d in zip(cl, cd)]
    best = max(range(len(ld)), key=lambda i: ld[i])
    return {
        "polar": {"alpha_deg": [float(a) for a in alpha], "CL": cl, "CD": cd, "LD": ld},
        "cruise": None,
        "dragBuildup": [
            {"label": "induced", "CD": cdi[best]},
            {"label": "profile + extra_CD0", "CD": cdp[best]},
        ],
    }


def main() -> None:
    """Frozen loop: one request line in, one response line out; EOF exits 0."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            cmd = req.get("cmd")
            args = req.get("args") or {}
            if cmd == "capabilities":
                out = {"id": rid, "ok": True, "result": _capabilities()}
            elif cmd == "polar":
                if not _POLAR_OK:
                    out = {"id": rid, "ok": False, "error": {
                        "code": "capability_unavailable",
                        "message": f"aeropolar not importable: {_POLAR_WHY}"}}
                else:
                    out = {"id": rid, "ok": True, "result": _polar(args["design"])}
            else:
                out = {"id": rid, "ok": False, "error": {
                    "code": "capability_unavailable",
                    "message": f"live-probe worker implements capabilities+polar only (got {cmd!r})"}}
        except Exception as exc:  # noqa: BLE001 — a bad request must never kill the worker
            out = {"id": rid, "ok": False, "error": {
                "code": "engine_error", "message": f"{type(exc).__name__}: {exc}"}}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
