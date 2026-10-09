"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the CLOSED set
  |                                           | of structured validity reasons. A verdict
  |                                           | used to be a list of prose strings, so a
  |                                           | sweep or a certification report could only
  |                                           | tell WHY a design failed by reading English.
  |                                           | Every refusal and every closure reason now
  |                                           | also emits one of these codes, with its
  |                                           | numbers, at the line where it arises; no
  |                                           | caller ever maps a message to a code.

aerosim.validity -- the structured "why" behind every verdict.

A reason is a plain dict: {"code": <one of REASON_FIELDS>, <declared fields>...}.
The set is CLOSED: reason() refuses an unknown code, an undeclared field or a
missing one, so a new failure mode cannot slip out uncoded -- it has to be
added here first, with its fields, and a test names it.

Two ways a reason leaves the engine, both at the source:

  * A verdict list -- integrate_energy / integrate_dynamic put
    detail["closed_reason_codes"] beside detail["closed_reasons"], and
    validate_screen.screen_design puts detail["screen_reason_codes"] beside its
    reasons. The code is appended on the line after the prose, never derived
    from it.
  * An exception -- the raise site either attaches a reason to the instance
    (attach()) or the exception CLASS declares its code (VALIDITY_CODE).
    reason_of() reads those, following the __cause__ chain, so a wrapper such
    as validate_designs' real-chain ValidationError keeps the typed cause.

This module imports nothing from aerosim: every other module may import it.
"""

from __future__ import annotations

import math
from typing import Any

#: Numeric fields per code (float or None). Every declared field must be given.
REASON_FIELDS: dict[str, tuple[str, ...]] = {
    # -- build refusals (the vehicle cannot be assembled) ---------------------
    "negative_airframe_mass": (
        "element_mass_kg", "wing_mass_kg", "as_flown_kg", "structure_kg"),
    "pack_claim_outside_catalogue_band": (
        "claim_Wh_per_kg", "catalogue_Wh_per_kg", "ratio", "band"),
    "param_out_of_bounds": ("value", "lo", "hi"),
    "real_chain_config_refused": (),
    "technology_beyond_catalogue": ("value", "ceiling", "areal_density_kg_m2"),
    "mass_closure_refused": (),
    # -- trim / aerodynamics --------------------------------------------------
    "trim_not_converged": ("residual_N", "tol_N", "V_ms"),
    "aero_no_valid_point": (),
    "aero_uncertified_steps": ("steps", "of_steps"),
    "dt_too_coarse": ("dt_s", "ceiling_s"),
    "free_energy_refused": (),
    # -- energy closure -------------------------------------------------------
    "uncommanded_forward_force": ("max_excess_thrust_N", "tol_N"),
    "unmet_thrust": ("max_unmet_thrust_N", "tol_N"),
    "sub_diurnal_window": ("window_s",),
    "soc_floor_breached": ("min_soc", "soc_min"),
    "unmet_bus_demand_Wh": ("unmet_Wh",),
    "soc_not_persistent": ("soc_start", "soc_end", "min_soc"),
    "no_sustainable_periodic_state": (),
    "storage_absent_deficit": ("deficit_W",),
    # -- admissibility screen (validate_screen.screen_design) ----------------
    "screen_rule": (),
}

#: Label (string) fields per code. Every declared label must be given.
REASON_LABELS: dict[str, tuple[str, ...]] = {
    "param_out_of_bounds": ("param",),
    "pack_claim_outside_catalogue_band": ("chemistry",),
    "real_chain_config_refused": ("knob",),
    "technology_beyond_catalogue": ("kind",),
    "screen_rule": ("rule", "severity"),
}

#: The screen's rules, one per failure branch of screen_design, closed.
SCREEN_RULES: frozenset[str] = frozenset({
    "mass_declaration", "param_recheck", "closure", "soc_standoff",
    "unmet_thrust", "excess_thrust", "drag_floor", "harvest_bound",
    "wing_loading", "aspect_ratio", "pv_technology", "pack_technology",
    "fuselage_floor", "extra_cd0_floor", "payload_floor", "payload_mass",
    "solstice_only",
})

#: screen_rule severities: a hard rule refuses admissibility, a flag informs.
SCREEN_SEVERITIES: frozenset[str] = frozenset({"hard", "flag"})

#: Every code a reason may carry.
CODES: frozenset[str] = frozenset(REASON_FIELDS)

#: The codes an exception at BUILD time may carry (the vehicle never flew).
BUILD_CODES: frozenset[str] = frozenset({
    "negative_airframe_mass", "pack_claim_outside_catalogue_band",
    "param_out_of_bounds", "real_chain_config_refused",
    "technology_beyond_catalogue", "mass_closure_refused",
})

_MAX_CAUSE_DEPTH = 8


class ValidityCodeError(TypeError):
    """@description Raised when a caller emits a reason outside the closed set,
        with an undeclared field, or without a declared one. It is a
        programming error at the emission site, never a design verdict."""


def _number(code: str, name: str, value: Any) -> float | None:
    """@description Normalise one numeric field: numpy scalars to float, a
        non-finite value to None (NaN is not JSON), None kept.
    @param code The reason code (for the error message).
    @param name The field name.  @param value The raw value.
    @returns A finite float or None.
    @raises ValidityCodeError When the value is not a number."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValidityCodeError(f"{code}.{name} must be a number, got a bool")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidityCodeError(
            f"{code}.{name} must be a number, got {value!r}") from exc
    return number if math.isfinite(number) else None


def _label(code: str, name: str, value: Any) -> str:
    """@description Validate one label field against its closed vocabulary.
    @param code The reason code.  @param name The label name.
    @param value The raw label.
    @returns The label as a string.
    @raises ValidityCodeError When the label is not a string, or a screen
        rule / severity is outside its closed set."""
    if not isinstance(value, str) or not value:
        raise ValidityCodeError(f"{code}.{name} must be a non-empty string")
    if code == "screen_rule" and name == "rule" and value not in SCREEN_RULES:
        raise ValidityCodeError(f"unknown screen rule {value!r}")
    if code == "screen_rule" and name == "severity" and value not in SCREEN_SEVERITIES:
        raise ValidityCodeError(f"unknown screen severity {value!r}")
    return value


def reason(code: str, **fields: Any) -> dict[str, Any]:
    """@description Build one structured reason from the closed set.
    @param code One of CODES.
    @param fields Exactly the declared numeric fields and labels for the code.
    @returns {"code": code, **fields} with numbers as float|None and labels as str.
    @raises ValidityCodeError On an unknown code, an undeclared field or a
        missing declared one."""
    if code not in REASON_FIELDS:
        raise ValidityCodeError(f"unknown validity reason code {code!r}")
    numeric = REASON_FIELDS[code]
    labels = REASON_LABELS.get(code, ())
    declared = set(numeric) | set(labels)
    extra = sorted(set(fields) - declared)
    missing = sorted(declared - set(fields))
    if extra or missing:
        raise ValidityCodeError(
            f"{code}: undeclared field(s) {extra}, missing field(s) {missing}")
    out: dict[str, Any] = {"code": code}
    for name in labels:
        out[name] = _label(code, name, fields[name])
    for name in numeric:
        out[name] = _number(code, name, fields[name])
    return out


def screen_rule(rule: str, hard: bool = True) -> dict[str, Any]:
    """@description Shorthand for a screen_rule reason.
    @param rule One of SCREEN_RULES.  @param hard False for an informational flag.
    @returns The reason dict."""
    return reason("screen_rule", rule=rule, severity="hard" if hard else "flag")


def attach(exc: BaseException, code: str, **fields: Any) -> BaseException:
    """@description Attach a structured reason to an exception at its raise site.
    @param exc The exception about to be raised.
    @param code One of CODES.  @param fields The code's declared fields.
    @returns The same exception, carrying .validity_reason."""
    exc.validity_reason = reason(code, **fields)  # type: ignore[attr-defined]
    return exc


def is_reason(obj: Any) -> bool:
    """@description True when obj is a well-formed reason from the closed set.
    @param obj Anything.
    @returns bool."""
    if not isinstance(obj, dict) or obj.get("code") not in REASON_FIELDS:
        return False
    fields = {k: v for k, v in obj.items() if k != "code"}
    try:
        return reason(obj["code"], **fields) == obj
    except ValidityCodeError:
        return False


def reason_of(exc: BaseException | None) -> dict[str, Any] | None:
    """@description The structured reason an exception carries, emitted at its
        source: an instance .validity_reason, else the class's VALIDITY_CODE
        (a code with no fields), searched along the __cause__/__context__
        chain so a wrapping exception keeps its typed cause. Never reads the
        message.
    @param exc The caught exception (or None).
    @returns The reason dict, or None when nothing in the chain is coded."""
    seen = 0
    while exc is not None and seen < _MAX_CAUSE_DEPTH:
        carried = getattr(exc, "validity_reason", None)
        if isinstance(carried, dict) and is_reason(carried):
            return dict(carried)
        code = getattr(type(exc), "VALIDITY_CODE", None)
        if isinstance(code, str) and code in REASON_FIELDS and not REASON_FIELDS[code] \
                and not REASON_LABELS.get(code):
            return reason(code)
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return None


__all__ = [
    "BUILD_CODES",
    "CODES",
    "REASON_FIELDS",
    "REASON_LABELS",
    "SCREEN_RULES",
    "SCREEN_SEVERITIES",
    "ValidityCodeError",
    "attach",
    "is_reason",
    "reason",
    "reason_of",
    "screen_rule",
]
