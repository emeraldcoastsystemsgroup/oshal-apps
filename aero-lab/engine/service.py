"""
CHANGE LOG
-----------------------------------------------------------------------------
DATE/TIME           | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- aero-lab
                    |                             | engine service: JSON-lines stdio worker
                    |                             | wrapping the validated aerosim simulator
                    |                             | (capabilities / polar / evaluate / screen /
                    |                             | export / mission). Feature-detects every
                    |                             | module so a mid-edit engine tree degrades
                    |                             | to honest capability flags, never a crash.
2026-08-03 05:30:00 | maintainer@emeraldcoastsystemsgroup.com | Widen area_m2 / battery_mass_kg
                    |                             | lower bounds to the engine's own validated
                    |                             | small-craft envelope (TIER1/HYBRID studies:
                    |                             | AREA=0.52 m^2, battery swept to 0.100 kg).
                    |                             | The R6 box alone rejected three of the four
                    |                             | shipped presets -- all recorded engine runs.

aero-lab engine service -- the BUILD_CONTRACT section-5 worker.

Protocol (frozen): one JSON object per line, both directions.
  request : { "id": "...", "cmd": "...", "args": { ... } }
  response: { "id": "...", "ok": true,  "result": { ... } }
            { "id": "...", "ok": false, "error": { "code": "...", "message": "..." } }

Error codes (frozen): capability_unavailable | invalid_design |
inadmissible_input | engine_error.

stdout is the protocol channel; ALL logging goes to stderr. One request is
processed at a time (the adapter queues). Deterministic: same design in ->
same numbers out; no RNG, no wall-clock in results.

The evaluation chain is byte-for-byte the validated sweep chain
(R6_search.evaluate / R7): to_design -> validate_designs.build_solar_cruise ->
validate._run_window (integrate_energy, 24 h, 60 s) -> validate.usable_energy
-> validate_screen.screen_design. The R7 winner vector reproduces
min_soc 0.4366 / usable 1.0586 through this file.
"""

import hashlib
import json
import math
import os
import sys
import time
import traceback
import warnings

warnings.simplefilter("ignore")

# ---------------------------------------------------------------------------
# Footprint: BelowNormal priority (FP_01 pattern), guarded for non-Windows.
# ---------------------------------------------------------------------------
if sys.platform == "win32":
    try:
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL
    except Exception as _exc:  # pragma: no cover - priority is best-effort
        print(f"[service] priority downgrade failed: {_exc}", file=sys.stderr)


def _log(msg: str) -> None:
    """@description Log one line to stderr (stdout is the protocol channel).
    @param msg The message.
    @returns None."""
    print(f"[aero-lab-engine] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Engine-dir resolution (BUILD_CONTRACT 5a). Resolved ONCE, then committed to:
# switching trees mid-flight would report numbers from an engine other than
# the one named in `capabilities`.
# ---------------------------------------------------------------------------
_DEFAULT_ENGINE_DIR = (
    "C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/"
    "a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim"
)
_OWN_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_engine_dir() -> str:
    """@description Pick the aerosim tree: AERO_LAB_ENGINE_DIR, else the
        documented scratchpad default, else this package's own vendored copy
        (engine/aerosim ships with aero-lab so a fresh box still runs).
    @returns Absolute path of the chosen engine dir."""
    env = os.environ.get("AERO_LAB_ENGINE_DIR", "").strip()
    if env:
        return os.path.abspath(env)
    if os.path.isdir(os.path.join(_DEFAULT_ENGINE_DIR, "aerosim")):
        return _DEFAULT_ENGINE_DIR
    return _OWN_DIR


ENGINE_DIR = _resolve_engine_dir()
if os.path.normcase(ENGINE_DIR) != os.path.normcase(_OWN_DIR):
    # The vendored aerosim/ next to this file must never silently satisfy
    # imports meant for AERO_LAB_ENGINE_DIR (capabilities would then name one
    # tree while the numbers came from another). Python puts the SCRIPT's
    # directory -- this directory -- at sys.path[0], so strip every entry
    # that resolves here. export_build_files.py is loaded by explicit file
    # path instead (never via sys.path).
    sys.path[:] = [p for p in sys.path
                   if os.path.normcase(os.path.abspath(p or os.getcwd()))
                   != os.path.normcase(_OWN_DIR)]
sys.path.insert(0, ENGINE_DIR)


def _import_export_module():
    """@description Load export_build_files.py from THIS directory by explicit
        path (never via sys.path -- see the note above).
    @returns The module.
    @raises Exception when the file is missing/broken (feature-detected)."""
    import importlib.util
    path = os.path.join(_OWN_DIR, "export_build_files.py")
    spec = importlib.util.spec_from_file_location("export_build_files", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

G0 = 9.80665
DAY_S = 86400.0
DT_S = 60.0

# ---------------------------------------------------------------------------
# Design-vector bounds. Source: the union of the engine's validated study
# envelopes -- the R6_search.py BOX (the R6/R7 hostile-search contract the
# winner vector came from) widened DOWN to the validated small-craft studies:
# area_m2 lower bound 0.52 = TIER1_operator_eval / HYBRID_common AREA (the
# Tier-1 planform every hybrid run flew); battery_mass_kg lower bound 0.10 =
# the smallest pack the HYBRID_equinox_pack sweep actually ran (f=1.00
# batt=0.100 kg, honestly reported closed=False). buoyancy_fraction from the
# HYBRID_* study range (f in [0, 1], f = 1 exactly neutral -- HYBRID_common
# docstring). No engine-published param_bounds module exists (checked
# 2026-08-03), so this hardcoded box with sources is the sanctioned fallback.
# ---------------------------------------------------------------------------
BOUNDS = {
    "area_m2": (0.52, 195.0),
    "aspect_ratio": (4.05, 39.9),
    "taper_ratio": (0.35, 1.0),
    "battery_mass_kg": (0.10, 500.0),
    "pack_Wh_per_kg": (100.0, 499.99),
    "cell_eff": (0.10, 0.4999),
    "pv_density": (0.1501, 5.0),
    "pv_packing": (0.30, 0.999),
    "extra_CD0": (0.0001, 0.012),
    "fus_over_floor": (0.25, 8.0),
    "prop_max_W": (100.0, 20000.0),
    "prop_diameter_m": (0.2, 3.0),
    "altitude_m": (100.0, 20000.0),
    "latitude_deg": (-40.0, 60.0),
    "day_of_year": (1, 365),
    "payload_W": (0.001, 30.0),
    "payload_mass_kg": (0.001, 3.0),
    "twist_root_deg": (0.0, 4.0),
    "twist_tip_deg": (-3.0, 1.0),
    "buoyancy_fraction": (0.0, 1.0),
}
INT_KEYS = {"day_of_year"}
#: buoyancy_fraction is the only defaulted field (0.0 = pure fixed-wing).
OPTIONAL_DEFAULTS = {"buoyancy_fraction": 0.0}


class WorkerError(Exception):
    """@description A protocol-mappable failure.
    @param code One of the frozen error codes.
    @param message Human-readable reason, surfaced verbatim to the UI."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Feature detection (BUILD_CONTRACT 5c): guarded imports with short retries.
# A missing module is a capability flag, never a crash -- the engine tree is
# concurrently edited by a reality-upgrade workflow.
# ---------------------------------------------------------------------------
_M: dict = {"loaded": False}


def _try_import(name: str):
    """@description Import one module, guarded (a broken tree may raise anything).
    @param name Dotted module name.
    @returns (module | None, error string | None)."""
    try:
        return __import__(name, fromlist=["_"]), None
    except BaseException as exc:  # noqa: BLE001 - a broken tree may raise anything
        return None, f"{type(exc).__name__}: {str(exc)[:200]}"


def _load_engine() -> dict:
    """@description Lazily import every engine module once, recording per-module
        availability. The stable four get 3 retries; optional in-flight modules
        get one guarded attempt each.
    @returns The module registry dict (cached)."""
    if _M["loaded"]:
        return _M
    t0 = time.perf_counter()
    stable = {
        "validate_designs": "aerosim.validate_designs",
        "validate": "aerosim.validate",
        "validate_screen": "aerosim.validate_screen",
        "aeropolar": "aerosim.aeropolar",
        "integrate": "aerosim.integrate",
        "env": "aerosim.env",
        "vehicle": "aerosim.vehicle",
        "validate_bounds": "aerosim.validate_bounds",
        "structure": "aerosim.vehicle.structure",
    }
    optional = {
        "electrical": "aerosim.electrical",
        "prop": "aerosim.prop",
        "mission_runner": "aerosim.mission.runner",
        "mission_profile": "aerosim.mission.profile",
        "materials": "aerosim.vehicle.materials",
        "electrochem": "aerosim.vehicle.electrochem",
        "buoyancy": "aerosim.vehicle.buoyancy",
        "hybrid_common": "HYBRID_common",
        "hybrid_piecewise": "HYBRID_piecewise",
        "aerosandbox": "aerosandbox",
    }
    errors: dict = {}
    # Import-with-retry at PASS level (FP_01's idea, sized for a waiting web
    # request: 3 passes x 5 s, not 5 x 120 s, and the whole failed set retries
    # together so a fully broken tree still answers capabilities inside the
    # adapter's 30 s budget). The concurrent reality-upgrade workflow can leave
    # the tree mid-edit for a moment; one pass later it usually imports.
    pending = dict(stable)
    for attempt in range(3):
        if attempt > 0 and pending:
            _log(f"stable imports failed ({sorted(pending)}) -- retry in 5 s")
            time.sleep(5.0)
        still: dict = {}
        for key, name in pending.items():
            mod, err = _try_import(name)
            _M[key] = mod
            if err:
                errors[key] = err
                still[key] = name
            else:
                errors.pop(key, None)
        pending = still
        if not pending:
            break
    for key, name in optional.items():
        mod, err = _try_import(name)
        _M[key] = mod
        if err:
            errors[key] = err
    try:
        _M["export_build_files"] = _import_export_module()
    except Exception as exc:  # noqa: BLE001 - feature-detected like the rest
        _M["export_build_files"] = None
        errors["export_build_files"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    _M["errors"] = errors
    _M["loaded"] = True
    _log(f"engine load: {time.perf_counter() - t0:.1f} s from {ENGINE_DIR}; "
         f"unavailable: {sorted(errors) or 'none'}")
    return _M


def _caps() -> dict:
    """@description Compute the capability flags from the module registry.
    @returns {command/feature name: bool}."""
    m = _load_engine()
    evaluate_ok = bool(
        m["validate_designs"] and m["validate"] and m["integrate"]
        and m["structure"] and m["vehicle"])
    return {
        "polar": bool(m["aeropolar"] and m["validate_designs"] and m["env"]),
        "evaluate": evaluate_ok,
        "screen": bool(evaluate_ok and m["validate_screen"]),
        "mission": bool(evaluate_ok and m["mission_runner"] and m["mission_profile"]),
        "export": bool(evaluate_ok and m["aerosandbox"] and m["export_build_files"]),
        "hybrid": bool(evaluate_ok and m["buoyancy"] and m["hybrid_common"]
                       and m["hybrid_piecewise"]),
        "modules": {
            "electrical": bool(m["electrical"]),
            "prop": bool(m["prop"]),
            "mission": bool(m["mission_runner"]),
            "materials": bool(m["materials"]),
            "electrochem": bool(m["electrochem"]),
        },
    }


def _require(flag: str) -> dict:
    """@description Gate a command on a capability flag.
    @param flag Capability name.
    @returns The module registry.
    @raises WorkerError capability_unavailable with the recorded import error."""
    m = _load_engine()
    caps = _caps()
    if not caps.get(flag):
        details = "; ".join(f"{k}: {v}" for k, v in sorted(m["errors"].items()))
        raise WorkerError(
            "capability_unavailable",
            f"engine capability '{flag}' is not available from {ENGINE_DIR}"
            + (f" ({details})" if details else ""))
    return m


def _fingerprint() -> str | None:
    """@description Content hash of the four stable entry-point modules, so a
        result can be traced to the exact engine build that produced it.
    @returns 16-hex-char sha256 prefix, or None when files are unreadable."""
    h = hashlib.sha256()
    try:
        for rel in ("aerosim/validate_designs.py", "aerosim/integrate.py",
                    "aerosim/validate_screen.py", "aerosim/aeropolar.py"):
            with open(os.path.join(ENGINE_DIR, rel), "rb") as fh:
                h.update(fh.read())
        return h.hexdigest()[:16]
    except OSError:
        return None


# ---------------------------------------------------------------------------
# JSON hygiene: numpy scalars/arrays out, non-finite floats -> None (NaN is
# not JSON and must never reach the wire).
# ---------------------------------------------------------------------------
def _json_safe(obj):
    """@description Recursively convert a result structure to plain JSON types.
    @param obj Anything the engine returned.
    @returns JSON-serialisable equivalent."""
    import numpy as np
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_json_safe(v) for v in obj.tolist()]
    if isinstance(obj, np.generic):
        return _json_safe(obj.item())
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (bool, int, str)) or obj is None:
        return obj
    return str(obj)


# ---------------------------------------------------------------------------
# Design-vector validation + the vector -> _SolarCruiseDesign mapping.
# The mapping is the sweep's own (R6_search.to_design, verbatim math), which
# is the chain the R7 winner numbers certify.
# ---------------------------------------------------------------------------
def _validate_vector(design) -> dict:
    """@description Enforce the frozen wire shape: every field present (or
        defaulted), numeric, finite, inside the engine's sweep bounds; no
        unknown fields.
    @param design The request's design object.
    @returns Cleaned vector dict.
    @raises WorkerError invalid_design."""
    if not isinstance(design, dict):
        raise WorkerError("invalid_design", "design must be a JSON object")
    v: dict = {}
    unknown = [k for k in design if k not in BOUNDS and not str(k).startswith("_")]
    if unknown:
        raise WorkerError("invalid_design",
                          f"unknown design field(s): {', '.join(sorted(unknown))}")
    for key, (lo, hi) in BOUNDS.items():
        if key in design:
            raw = design[key]
        elif key in OPTIONAL_DEFAULTS:
            raw = OPTIONAL_DEFAULTS[key]
        else:
            raise WorkerError("invalid_design", f"missing design field: {key}")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise WorkerError("invalid_design", f"{key} must be a number")
        val = float(raw)
        if not math.isfinite(val):
            raise WorkerError("invalid_design", f"{key} must be finite")
        if val < lo or val > hi:
            raise WorkerError(
                "invalid_design",
                f"{key} = {val:g} outside engine bounds [{lo:g}, {hi:g}]")
        v[key] = int(round(val)) if key in INT_KEYS else val
    return v


def _to_design(m: dict, v: dict):
    """@description The sweep's vector -> _SolarCruiseDesign mapping
        (R6_search.to_design, verbatim math): span from AR*S, the wing billed
        by structure.wing_mass_kg, the fuselage as a multiplier over the
        structural floor, all-up mass as the sum of the billed elements.
    @param m Module registry.
    @param v Validated vector.
    @returns (design, wing_kg, fus_kg)."""
    import dataclasses
    vd = m["validate_designs"]
    st = m["structure"]
    S = v["area_m2"]
    b = math.sqrt(v["aspect_ratio"] * S)
    if b > 79.9:
        b = 79.9
    wing_kg = st.wing_mass_kg(b, S, 3.0)
    pv_kg = S * v["pv_density"]
    th = m["vehicle"].Thruster(
        diameter_m=v["prop_diameter_m"], max_electrical_power_W=v["prop_max_W"],
        n_rotors=1, figure_of_merit=0.85, eta_motor=0.85, eta_esc=0.95)
    carried = v["battery_mass_kg"] + v["payload_mass_kg"] + th.mass_kg
    fus_kg = (st.min_fuselage_boom_tail_mass_kg(carried, b)
              * v["fus_over_floor"])
    total = (v["battery_mass_kg"] + pv_kg + th.mass_kg + v["payload_mass_kg"]
             + wing_kg + fus_kg)
    design = dataclasses.replace(
        vd.DESIGN_A, name="aero-lab",
        span_m=b, area_m2=S, taper_ratio=v["taper_ratio"],
        twist_root_deg=v["twist_root_deg"], twist_tip_deg=v["twist_tip_deg"],
        extra_CD0=v["extra_CD0"], mass_all_up_kg=total,
        battery_mass_kg=v["battery_mass_kg"], pack_Wh_per_kg=v["pack_Wh_per_kg"],
        pv_efficiency=v["cell_eff"], pv_packing=v["pv_packing"],
        pv_areal_density_kg_m2=v["pv_density"],
        prop_diameter_m=v["prop_diameter_m"],
        prop_max_electrical_W=v["prop_max_W"],
        payload_W=v["payload_W"], payload_mass_kg=v["payload_mass_kg"],
        altitude_m=v["altitude_m"], latitude_deg=v["latitude_deg"],
        day_of_year=int(v["day_of_year"]),
    )
    return design, wing_kg, fus_kg


def _classify(exc: Exception) -> WorkerError:
    """@description Map an engine exception onto the frozen error codes.
        ParamBoundsError (a credible-range refusal) -> invalid_design;
        ValidationError / mass-closure / trim refusals -> inadmissible_input;
        anything else -> engine_error with type: message.
    @param exc The caught exception.
    @returns A WorkerError (never raises)."""
    if isinstance(exc, WorkerError):
        return exc
    name = type(exc).__name__
    msg = f"{name}: {str(exc)[:400]}"
    if name in ("ParamBoundsError",):
        return WorkerError("invalid_design", msg)
    if name in ("ValidationError", "MassClosureError", "NoValidPointError",
                "TrimConvergenceError", "MissionConfigError",
                "GustPlacardError", "ValueError"):
        return WorkerError("inadmissible_input", msg)
    return WorkerError("engine_error", msg)


# ---------------------------------------------------------------------------
# The shared evaluate chain (the validated sweep chain, plus the optional
# in-sim hybrid attachment ported from HYBRID_common.hybrid_build but
# PARAMETERIZED on the design instead of the Tier-1 constants).
# ---------------------------------------------------------------------------
def _attach_buoyancy(m: dict, build, design, f: float) -> dict:
    """@description Attach a helium sphere sized for buoyancy fraction f to an
        assembled build -- the HYBRID_common in-sim path (size_envelope fixed
        point + BuoyancyVolume + residual-weight retrim), parameterized on
        this design. The in-sim envelope is a SPHERE by construction (the
        shipped element); the study's streamlined-hull piecewise closure is
        not exposed here.
    @param m Module registry.  @param build The _Build from build_solar_cruise.
    @param design The mapped _SolarCruiseDesign.  @param f Buoyancy fraction.
    @returns Envelope info dict for the response."""
    H = m["hybrid_common"]
    bounds_mod = m["validate_bounds"]
    vd = m["validate_designs"]
    atmo = m["env"].atmosphere(design.altitude_m)
    rho, mu, p = float(atmo.rho_kgm3), float(atmo.mu_Pas), float(atmo.p_Pa)
    env_sz = H.size_envelope(f, design.mass_all_up_kg, rho, p, H.sphere_dims)
    bv = m["buoyancy"].BuoyancyVolume(
        volume_m3=env_sz["volume_m3"], film_mass_kg=env_sz["film_kg"],
        superpressure_Pa=H.SUPERPRESSURE_PA)
    build.vehicle.elements.append(bv)
    build.vehicle.bind_masses()
    residual_N = max((1.0 - f) * env_sz["M_allup_kg"] * G0, 0.0)
    ref_note = "float (residual weight ~ 0; no wing retrim)"
    ref2 = None
    if residual_N > 1.0e-6:
        geometry = vd._naca_geometry(
            design.span_m, design.area_m2, design.taper_ratio, 0.0,
            design.twist_root_deg, design.twist_tip_deg)
        try:
            ref2 = bounds_mod.reference_trim(
                geometry, residual_N, rho, mu, design.extra_CD0)
            surface = build.vehicle.elements[0]
            surface.incidence_deg = surface.best_endurance_alpha_deg(
                float(ref2.V_ms), rho, mu)
            build.meta["incidence_deg"] = float(surface.incidence_deg)
            ref_note = "residual-weight reference trim"
        except Exception as exc:  # noqa: BLE001 - honest degradation, reported
            ref2 = None
            ref_note = (f"reference_trim REFUSED at residual weight: "
                        f"{type(exc).__name__}: {str(exc)[:150]}")
    build.reference = ref2
    return {
        "buoyancy_fraction": f,
        "f_actual": float(env_sz["f_actual"]),
        "shape": "sphere (the shipped in-sim BuoyancyVolume)",
        "volume_m3": float(env_sz["volume_m3"]),
        "film_kg": float(env_sz["film_kg"]),
        "helium_kg": float(env_sz["gas_kg"]),
        "M_allup_kg": float(env_sz["M_allup_kg"]),
        "residual_weight_N": residual_N,
        "reference_note": ref_note,
    }


def _run_chain(m: dict, v: dict) -> dict:
    """@description Run the full validated chain on a cleaned vector: build,
        integrate the 24 h window, energy-split, admissibility screen.
    @param m Module registry.  @param v Validated vector.
    @returns dict with design/build/result/energy/verdict/hybrid objects."""
    vd = m["validate_designs"]
    val = m["validate"]
    f = float(v.get("buoyancy_fraction", 0.0))
    if f > 0.0:
        _require("hybrid")
    design, wing_kg, fus_kg = _to_design(m, v)
    build = vd.build_solar_cruise(design)
    hybrid_info = _attach_buoyancy(m, build, design, f) if f > 0.0 else None
    result, wall_s = val._run_window(build)
    energy = val.usable_energy(result)
    try:
        adm, reasons = val.screen_design(build, result,
                                         check_seasonal=(f <= 0.0))
    except Exception as exc:  # noqa: BLE001 - the sweep's own screen guard
        adm, reasons = False, [
            f"screen RAISED {type(exc).__name__}: {str(exc)[:150]}"]
    return {"design": design, "build": build, "wing_kg": wing_kg,
            "fus_kg": fus_kg, "result": result, "energy": energy,
            "admissible": bool(adm), "reasons": [str(s) for s in reasons],
            "hybrid": hybrid_info, "wall_s": wall_s}


def _mass_breakdown(chain: dict) -> list:
    """@description The billed mass ledger as label/kg rows for the UI bar.
    @param chain _run_chain output.
    @returns [{label, kg}] rows summing to the all-up mass."""
    mk = chain["build"].meta["mass_kg"]
    rows = [
        {"label": "wing structure", "kg": float(mk["wing_structural"])},
        {"label": "battery pack", "kg": float(mk["battery"])},
        {"label": "solar array", "kg": float(mk["pv_array"])},
        {"label": "propulsion", "kg": float(mk["propulsion"])},
        {"label": "payload + avionics", "kg": float(mk["payload"])},
        {"label": "fuselage / boom / tail",
         "kg": float(mk["fuselage_boom_tail_remainder"])},
    ]
    if chain["hybrid"]:
        rows.append({"label": "envelope film + tapes",
                     "kg": chain["hybrid"]["film_kg"]})
        rows.append({"label": "helium", "kg": chain["hybrid"]["helium_kg"]})
    return rows


def _cruise_block(build) -> dict | None:
    """@description The closed-form reference trim as a UI summary.
    @param build The assembled build.
    @returns {V_ms, CL, CD, Re} or None when no reference exists (hybrid
        retrim refused / float)."""
    ref = build.reference
    if ref is None:
        return None
    return {"V_ms": float(ref.V_ms), "CL": float(ref.CL),
            "CD": float(ref.CD), "Re": float(ref.Re)}


def _evaluate_result(chain: dict) -> dict:
    """@description Shape _run_chain output into the frozen /evaluate response.
    @param chain _run_chain output.
    @returns The result object (build / energy / closed / verdict + extras)."""
    r = chain["result"]
    build = chain["build"]
    design = chain["design"]
    all_up = (chain["hybrid"]["M_allup_kg"] if chain["hybrid"]
              else float(design.mass_all_up_kg))
    return {
        "build": {
            "massBreakdown": _mass_breakdown(chain),
            "massAllUpKg": all_up,
            "spanM": float(design.span_m),
            "areaM2": float(design.area_m2),
            "packWh": float(build.meta["battery_capacity_Wh"]),
        },
        "energy": {
            "t_s": r.t_s, "soc": r.soc,
            "p_gen_W": r.power_in_W, "p_load_W": r.power_out_W,
            "minSoc": float(r.min_soc),
            "usable": float(chain["energy"]["margin_ratio_usable"]),
        },
        "closed": bool(r.closed),
        "verdict": {"admissible": chain["admissible"],
                    "reasons": chain["reasons"]},
        # Additive diagnostics (frozen shape above is the minimum):
        "certified": bool(getattr(r, "certified", False)),
        "cruise": _cruise_block(build),
        "grossMargin": float(chain["energy"]["margin_ratio_gross"]),
        "spilledWh": float(chain["energy"]["spilled_Wh"]),
        "dayLengthH": float(build.meta["day_length_h"]),
        "incidenceDeg": float(build.meta.get("incidence_deg", float("nan"))),
        "hybrid": chain["hybrid"],
        "wallSeconds": round(float(chain["wall_s"]), 2),
    }


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------
def cmd_capabilities(_args: dict) -> dict:
    """@description Feature-detect the engine and report flags + bounds.
    @param _args Unused.
    @returns The frozen capabilities result (BUILD_CONTRACT 5b)."""
    m = _load_engine()
    aerosim_mod = m.get("validate_designs")
    version = None
    if aerosim_mod is not None:
        version = getattr(sys.modules.get("aerosim"), "__version__", None)
    return {
        "engineVersion": version,
        "engineFingerprint": _fingerprint(),
        "engineDir": ENGINE_DIR,
        "python": ".".join(str(n) for n in sys.version_info[:3]),
        "capabilities": _caps(),
        "bounds": {k: [lo, hi] for k, (lo, hi) in BOUNDS.items()},
        "importErrors": dict(m["errors"]),
    }


def cmd_polar(args: dict) -> dict:
    """@description Real wing polar for a design vector: the design is built
        (so incidence/trim are the engine's own), then aeropolar.wing_polar
        sweeps alpha at the reference trim speed.
    @param args {design}.
    @returns {polar, cruise, dragBuildup} (frozen shape 2a)."""
    import numpy as np
    m = _require("polar")
    _require("evaluate")  # the cruise point needs the builder
    v = _validate_vector(args.get("design"))
    if v.get("buoyancy_fraction", 0.0) > 0.0:
        raise WorkerError(
            "invalid_design",
            "polar is a wing computation: set buoyancy_fraction 0 (the hybrid "
            "envelope changes trim speed, not the wing polar itself)")
    design, _, _ = _to_design(m, v)
    build = m["validate_designs"].build_solar_cruise(design)
    ref = build.reference
    atmo = m["env"].atmosphere(design.altitude_m)
    ap = m["aeropolar"]
    up_w, lo_w, le_w, te_t = ap.naca_kulfan("2412")
    alpha = np.linspace(-4.0, 14.0, 25)
    wp = ap.wing_polar(
        design.span_m, design.area_m2, design.taper_ratio, 0.0,
        design.twist_root_deg, design.twist_tip_deg,
        np.asarray(up_w, dtype=float), np.asarray(lo_w, dtype=float),
        float(le_w), float(te_t), alpha, float(ref.V_ms),
        float(atmo.rho_kgm3), float(atmo.mu_Pas),
        n_crit=11.0, extra_CD0=design.extra_CD0)
    CL = np.asarray(wp.CL, dtype=float)
    CD = np.asarray(wp.CD, dtype=float)
    LD = np.where((CD > 0.0) & np.isfinite(CL), CL / CD, np.nan)
    valid = np.asarray(wp.valid, dtype=bool)
    # Drag buildup at the cruise point: nearest valid alpha to the trim CL.
    buildup = []
    if valid.any():
        idx = int(np.argmin(np.where(valid, np.abs(CL - float(ref.CL)),
                                     np.inf)))
        cdi = float(np.asarray(wp.CDi)[idx])
        cdp = float(np.asarray(wp.CDp)[idx])
        buildup = [
            {"label": "induced (CDi)", "CD": cdi},
            {"label": "wing profile (CDp - extra_CD0)",
             "CD": max(cdp - design.extra_CD0, 0.0)},
            {"label": "non-wing parasite (extra_CD0)",
             "CD": float(design.extra_CD0)},
        ]
    return {
        "polar": {"alpha_deg": np.degrees(np.asarray(wp.alpha_rad)),
                  "CL": CL, "CD": CD, "LD": LD, "valid": valid},
        "cruise": _cruise_block(build),
        "dragBuildup": buildup,
        "eOswald": float(wp.e_oswald),
        "slopeFlags": list(wp.slope_flags),
    }


def cmd_evaluate(args: dict) -> dict:
    """@description Build the vehicle and fly the 24 h energy limit cycle --
        the authoritative verdict on a design (the R6/R7 sweep chain).
    @param args {design}.
    @returns The frozen /evaluate response shape (2a)."""
    m = _require("evaluate")
    _require("screen")
    v = _validate_vector(args.get("design"))
    return _evaluate_result(_run_chain(m, v))


def cmd_screen(args: dict) -> dict:
    """@description Admissibility screen only. The screen needs a flown window
        (it certifies the RESULT, not just the build), so this runs the same
        chain as evaluate and returns the verdict slice.
    @param args {design}.
    @returns {admissible, reasons} + closed/minSoc diagnostics."""
    m = _require("evaluate")
    _require("screen")
    v = _validate_vector(args.get("design"))
    chain = _run_chain(m, v)
    return {"admissible": chain["admissible"], "reasons": chain["reasons"],
            "closed": bool(chain["result"].closed),
            "minSoc": float(chain["result"].min_soc),
            "certified": bool(getattr(chain["result"], "certified", False))}


def cmd_export(args: dict) -> dict:
    """@description Generate the physical build package (STL / DXF / dat /
        BOM / build sheet) for a design, under workDir/exports/<exportId>.
        The design is evaluated first so every exported number is the
        engine's own (FP-pattern: the snapshot is the ledger, never hand-typed).
    @param args {design, workDir}.
    @returns {exportId, files} -- bare file names; the route owns streaming."""
    m = _require("export")
    v = _validate_vector(args.get("design"))
    work_dir = args.get("workDir")
    if not work_dir or not isinstance(work_dir, str):
        raise WorkerError("invalid_design", "export needs args.workDir")
    chain = _run_chain(m, v)
    evaluation = _evaluate_result(chain)
    export_id = "exp-" + hashlib.sha256(
        json.dumps(v, sort_keys=True).encode()).hexdigest()[:12]
    out_dir = os.path.join(work_dir, "exports", export_id)
    os.makedirs(out_dir, exist_ok=True)
    files = m["export_build_files"].generate(
        vector=v, design=chain["design"], evaluation=_json_safe(evaluation),
        out_dir=out_dir)
    return {"exportId": export_id, "files": files}


def cmd_mission(args: dict) -> dict:
    """@description Multi-day realistic mission (wind shear, turbulence,
        cold-soaked pack, BEMT propulsion) through the in-flight mission
        module -- capability-gated; honest 503 until that module lands.
    @param args {design, days?, windMeanMs?, drydenSigmaMs?}.
    @returns evaluate-shaped energy block + missionReport passthrough."""
    m = _require("mission")
    v = _validate_vector(args.get("design"))
    days = float(args.get("days", 3.0))
    if not (0.0 < days <= 30.0):
        raise WorkerError("invalid_design", "days must be in (0, 30]")
    wind = float(args.get("windMeanMs", 0.0))
    dryden = float(args.get("drydenSigmaMs", 0.0))
    f = float(v.get("buoyancy_fraction", 0.0))
    if f > 0.0:
        _require("hybrid")
    design, _, _ = _to_design(m, v)
    build = m["validate_designs"].build_solar_cruise(design)
    hybrid_info = _attach_buoyancy(m, build, design, f) if f > 0.0 else None
    profile = m["mission_profile"].MissionProfile(
        start_utc_h=float(build.env.utc_hour_at_t0_h) % 24.0,
        duration_s=days * DAY_S, altitude_m=design.altitude_m,
        lat_deg=design.latitude_deg, day_of_year=int(design.day_of_year),
        wind_mean_ms=wind, shear=wind > 0.0, dryden_sigma_ms=dryden)
    mres = m["mission_runner"].fly_mission(build.vehicle, profile, dt_s=DT_S)
    sim = mres.sim
    energy = m["validate"].usable_energy(sim)
    return {
        "energy": {"t_s": sim.t_s, "soc": sim.soc,
                   "p_gen_W": sim.power_in_W, "p_load_W": sim.power_out_W,
                   "minSoc": float(sim.min_soc),
                   "usable": float(energy["margin_ratio_usable"])},
        "closed": bool(sim.closed),
        "certified": bool(getattr(sim, "certified", False)),
        "days": days,
        "hybrid": hybrid_info,
        "missionReport": {
            "ledgerWh": mres.ledger,
            "heaterWh": float(mres.heater_Wh),
            "converterLossWh": float(mres.converter_loss_Wh),
            "harnessLossWh": float(mres.harness_loss_Wh),
            "propEtaMean": float(mres.prop_eta_mean),
            "heliumLiftLossFrac": float(mres.helium_lift_loss_frac),
            "uvRetentionEnd": float(mres.uv_retention_end),
            "gustPlacardExceeded": bool(mres.gust_placard_exceeded),
            "packTempK": mres.pack_temp_K,
            "aging": mres.aging,
        },
    }


COMMANDS = {
    "capabilities": cmd_capabilities,
    "polar": cmd_polar,
    "evaluate": cmd_evaluate,
    "screen": cmd_screen,
    "export": cmd_export,
    "mission": cmd_mission,
}


# ---------------------------------------------------------------------------
# Protocol loop: one request line -> one response line; catch EVERYTHING per
# request (a bad design must never kill the worker); exit 0 on stdin EOF.
# ---------------------------------------------------------------------------
def _respond(obj: dict) -> None:
    """@description Emit exactly one protocol line on stdout.
    @param obj The response object."""
    sys.stdout.write(json.dumps(_json_safe(obj), allow_nan=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    """@description The service loop (one in-flight command at a time).
    @returns Process exit code (0 on clean EOF)."""
    _log(f"service up: python {sys.version.split()[0]}, engineDir={ENGINE_DIR}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd")
            handler = COMMANDS.get(cmd)
            if handler is None:
                raise WorkerError("invalid_design",
                                  f"unknown cmd: {cmd!r} (valid: "
                                  f"{', '.join(sorted(COMMANDS))})")
            t0 = time.perf_counter()
            result = handler(req.get("args") or {})
            _log(f"{cmd} ok in {time.perf_counter() - t0:.1f} s")
            _respond({"id": req_id, "ok": True, "result": result})
        except Exception as exc:  # noqa: BLE001 - the loop must survive anything
            we = _classify(exc)
            if we.code == "engine_error":
                _log("engine_error:\n" + traceback.format_exc())
            else:
                _log(f"{we.code}: {we}")
            _respond({"id": req_id, "ok": False,
                      "error": {"code": we.code, "message": str(we)}})
    _log("stdin EOF -- exiting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
