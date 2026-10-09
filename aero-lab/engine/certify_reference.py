"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- certify the four
  |                                           | shipped reference presets on the REAL chain
  |                                           | (catalogued PackEcm, C60 diode PV + MPPT,
  |                                           | BEMT + motor/ESC/harness) and return, per
  |                                           | preset, pass or fail with every reason drawn
  |                                           | from the closed aerosim.validity set. Lives
  |                                           | beside service.py (already at its size limit)
  |                                           | and is driven by its 'certify' command. The
  |                                           | public evaluate default stays on the ideal
  |                                           | chain; this module never changes it.

aero-lab reference certification.

WHAT "PASS" MEANS HERE (and nothing more): the preset's design vector, mapped
exactly as the service maps it, assembles on build_solar_cruise(chain="real");
its 24 h / 60 s window (the evaluate chain's own window) integrates with
certified aerodynamics and CLOSES (SOC persistence, no unserved demand, no
unmet thrust); and the admissibility screen raises no HARD rule. The seasonal
re-closure is a FLAG in the screen, not a hard rule, and is not run here.

A preset that fails says why ONLY through structured reasons emitted where the
failure arose -- a build refusal's typed exception (validity.reason_of), the
integrator's detail["closed_reason_codes"], the screen's
detail["screen_reason_codes"]. Nothing here reads a message. A failure no
code explains is reported as outcome "error", never folded into "fail".

Deterministic: no RNG, no wall-clock in the result, presets in file order.
"""

from __future__ import annotations

import importlib
import json
import os
from dataclasses import dataclass
from typing import Any, Callable

#: The committed preset file (parity-tested against tools/aero-lab.html).
PRESETS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "reference_presets.json")

#: The evaluate chain's own window and step (service.cmd_evaluate ->
#: validate._run_window: 24 h at 60 s).
CERTIFY_WINDOW_S: float = 86400.0
CERTIFY_DT_S: float = 60.0

#: Result schema identifier.
SCHEMA = "aero-lab.reference-certification/1"


@dataclass(frozen=True)
class ServiceHooks:
    """@description The service's own vector handling, injected so a preset is
        mapped exactly as the /evaluate route maps it (never a second copy).
    @param modules The service's engine module registry.
    @param validate_vector service._validate_vector.
    @param to_design service._to_design.
    @param attach_buoyancy service._attach_buoyancy.
    @param fingerprint service._fingerprint() at call time."""

    modules: dict
    validate_vector: Callable[[Any], dict]
    to_design: Callable[[dict, dict], tuple]
    attach_buoyancy: Callable[..., dict]
    fingerprint: str | None


def load_presets(path: str = PRESETS_PATH) -> list[dict]:
    """@description Read the committed reference presets and refuse a malformed file.
    @param path JSON file path.
    @returns [{key, name, v}] in file order.
    @raises ValueError On a missing key/vector or a duplicate key."""
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    presets = doc.get("presets") if isinstance(doc, dict) else None
    if not isinstance(presets, list) or not presets:
        raise ValueError(f"{path}: no presets list")
    seen: set[str] = set()
    for p in presets:
        key = p.get("key") if isinstance(p, dict) else None
        if not isinstance(key, str) or not isinstance(p.get("v"), dict):
            raise ValueError(f"{path}: every preset needs a string key and a v object")
        if key in seen:
            raise ValueError(f"{path}: duplicate preset key {key!r}")
        seen.add(key)
    return presets


def _validity():
    """@description The closed reason set, imported from the resolved engine tree.
    @returns The aerosim.validity module."""
    return importlib.import_module("aerosim.validity")


def _refusal(exc: BaseException, stage: str) -> dict:
    """@description Turn an exception into a fail (typed at its source) or an
        error (nothing in its cause chain is coded).
    @param exc The caught exception.  @param stage 'build' or 'flight'.
    @returns Partial preset record {outcome, stage, reasons[, error]}."""
    coded = _validity().reason_of(exc)
    if coded is not None:
        return {"outcome": "fail", "stage": stage, "reasons": [coded]}
    return {"outcome": "error", "stage": stage, "reasons": [],
            "error": {"type": type(exc).__name__, "message": str(exc)[:400]}}


def _build(hooks: ServiceHooks, v: dict):
    """@description Map the vector and assemble it on the real chain, with the
        buoyant attachment when f > 0 (the service's own hybrid path).
    @param hooks Service hooks.  @param v Validated vector.
    @returns (build, pack_meta)."""
    m = hooks.modules
    design, _wing_kg, _fus_kg = hooks.to_design(m, v)
    build = m["validate_designs"].build_solar_cruise(design, chain="real")
    f = float(v.get("buoyancy_fraction", 0.0))
    if f > 0.0:
        hooks.attach_buoyancy(m, build, design, f)
    return build, dict(build.meta.get("real_chain", {}).get("pack", {}))


def _verdict(hooks: ServiceHooks, build, window_s: float, dt_s: float) -> dict:
    """@description Fly the window, screen it, and collect the coded reasons.
    @param hooks Service hooks.  @param build The real-chain build.
    @param window_s Window, s.  @param dt_s Slow-loop step, s.
    @returns Partial preset record {outcome, stage, reasons, flags, metrics}."""
    m = hooks.modules
    result = m["integrate"].integrate_energy(
        build.vehicle, build.env, 0.0, window_s, dt_s)
    admissible, _prose = m["validate_screen"].screen_design(
        build, result, check_seasonal=False)
    closed_codes = list(result.detail.get("closed_reason_codes", []))
    screen_codes = list(result.detail.get("screen_reason_codes", []))
    hard = [c for c in screen_codes
            if c.get("severity") == "hard" and c.get("rule") != "closure"]
    flags = [c for c in screen_codes if c.get("severity") == "flag"]
    passed = bool(result.closed) and bool(result.certified) and bool(admissible)
    reasons = closed_codes + hard
    soc = result.soc
    metrics = {"closed": bool(result.closed), "certified": bool(result.certified),
               "admissible": bool(admissible), "minSoc": float(result.min_soc),
               "socStart": float(soc[0]), "socEnd": float(soc[-1]),
               "usable": float(m["validate"].usable_energy(result)["margin_ratio_usable"])}
    if passed:
        return {"outcome": "pass", "stage": None, "reasons": [], "flags": flags,
                "metrics": metrics}
    stage = "flight" if closed_codes else "screen"
    if not reasons:
        return {"outcome": "error", "stage": stage, "reasons": [], "flags": flags,
                "metrics": metrics,
                "error": {"type": "UncodedVerdict",
                          "message": "the verdict failed and no structured reason explains it"}}
    return {"outcome": "fail", "stage": stage, "reasons": reasons, "flags": flags,
            "metrics": metrics}


def certify_preset(hooks: ServiceHooks, preset: dict,
                   window_s: float = CERTIFY_WINDOW_S,
                   dt_s: float = CERTIFY_DT_S) -> dict:
    """@description Certify one preset (or one sweep design) on the real chain.
    @param hooks Service hooks.  @param preset {key, name?, v}.
    @param window_s Window, s (a whole number of days).
    @param dt_s Slow-loop step, s.
    @returns {key, name, outcome, stage, reasons, flags, metrics, pack[, error]}."""
    v = hooks.validate_vector(preset["v"])
    record: dict = {"key": preset["key"], "name": preset.get("name", preset["key"]),
                    "flags": [], "metrics": None, "pack": None}
    try:
        build, pack = _build(hooks, v)
    except Exception as exc:  # noqa: BLE001 - typed refusal or honest error
        record.update(_refusal(exc, "build"))
        return record
    record["pack"] = pack
    try:
        record.update(_verdict(hooks, build, window_s, dt_s))
    except Exception as exc:  # noqa: BLE001 - e.g. trim_not_converged, typed at source
        record.update(_refusal(exc, "flight"))
    return record


def certify(hooks: ServiceHooks, keys: list[str] | None = None,
            path: str = PRESETS_PATH) -> dict:
    """@description Certify the reference presets (all, or the named subset).
    @param hooks Service hooks.  @param keys Optional preset keys, file order kept.
    @param path Preset file.
    @returns {schema, engineFingerprint, treeFingerprint, chain, windowS, dtS,
        presets[], summary{pass, fail, error}}.
    @raises ValueError On an unknown preset key."""
    presets = load_presets(path)
    known = [p["key"] for p in presets]
    if keys is not None:
        unknown = sorted(set(keys) - set(known))
        if unknown:
            raise ValueError(f"unknown preset key(s) {unknown}; known: {known}")
        presets = [p for p in presets if p["key"] in set(keys)]
    records = [certify_preset(hooks, p) for p in presets]
    summary = {k: sum(1 for r in records if r["outcome"] == k)
               for k in ("pass", "fail", "error")}
    return {
        "schema": SCHEMA,
        "engineFingerprint": hooks.fingerprint,
        "treeFingerprint": hooks.modules["validate_screen"].tree_fingerprint(),
        "chain": "real",
        "windowS": CERTIFY_WINDOW_S,
        "dtS": CERTIFY_DT_S,
        "presets": records,
        "summary": summary,
    }


__all__ = ["CERTIFY_DT_S", "CERTIFY_WINDOW_S", "PRESETS_PATH", "SCHEMA",
           "ServiceHooks", "certify", "certify_preset", "load_presets"]
