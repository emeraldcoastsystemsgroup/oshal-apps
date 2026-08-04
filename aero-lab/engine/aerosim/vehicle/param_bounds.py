"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module: the shared parameter-bounds layer. One range checker (require_in_range), a per-class declared-bounds protocol (PARAM_BOUNDS + validate_declared), and the spec-extraction re-check (recheck_element_params) so an element built by bypassing __init__ is still caught. Closes the round-2 class: every optimizer-turnable constructor number is now either range-checked here or billed in mass.py.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4: the (b) BILLED branch's re-check claim is now TRUE, not aspirational. R4_probe_bypass measured the gap: recheck walked PARAM_BOUNDS ranges but never asked whether mass_kg was CONSISTENT with the billed parameters, so capacity_J x3 on a live pack (723 Wh/kg effective) and area x2 on a live PVArray both screened admissible on stale bills. The fix lives in each element's validate_cross_params (which recheck_element_params already calls): BatteryElement / PVArray / Thruster now RE-DERIVE the billed mass from the live instance's own parameters and raise beyond 1e-6 relative; BuoyancyVolume re-derives its surface area and floors the film. AeroSurface was already honest (mass_kg is a re-deriving property).

THE CLASS THIS MODULE CLOSES
----------------------------
Round 2 measured it: Thruster(figure_of_merit=5.0, eta_motor=2.0, eta_esc=3.0)
constructed and returned 1.45 W for a hover whose actuator-disk floor is
43.57 W; BatteryElement(soc_max=3.0) turned a 16 kg pack into 940 Wh/kg
effective, past the project's own fail-closed 500 Wh/kg pack ceiling;
eta_charge=eta_discharge=2.0 gave a measured storage round trip of 4.0000.
Every one of those is the same defect: a numeric constructor parameter that an
optimizer can turn and that nothing bills or bounds.

THE GOVERNING INVARIANT, ENFORCED AS A CLASS
--------------------------------------------
Every numeric parameter on every shipped element must be either

  (a) RANGE-CHECKED at construction against a bound declared on the class
      (PARAM_BOUNDS), and RE-CHECKED at spec-extraction in the integrator via
      recheck_element_params() -- defense in depth, because an element built by
      object.__new__ + attribute assignment never ran __init__; or

  (b) BILLED -- it must cost mass or energy proportionally, with the physics
      that owns it (capacity_J through battery_mass_kg, area_m2 through
      pv_array_mass_kg, max_electrical_power_W through motor_drive_mass_kg...).
      Billed parameters STILL carry a finiteness/credibility bound here,
      because inf and nan are not billable.

And every exemption from an integrator guard must be an EXPLICIT declared
opt-in on the class (e.g. PVArray.non_mechanical_source = True), never inferred
from an attribute name.

HOW AN ELEMENT USES THIS MODULE
-------------------------------
    class Thing:
        PARAM_BOUNDS = {
            "eta_widget": Bounds(0.0, 1.0, lo_open=True, unit="-",
                                 why="an efficiency above 1 is a free source"),
        }
        def __init__(self, eta_widget=0.9):
            checked = validate_declared(type(self), eta_widget=eta_widget)
            self.eta_widget = checked["eta_widget"]

The declaration drives the check, so the documented range and the enforced
range cannot drift apart, and tests/test_param_bounds.py can walk PARAM_BOUNDS
by reflection and push every declared parameter out of range.

Cross-parameter constraints that a single (lo, hi) cannot express (soc_min <
soc_max, eta_charge*eta_discharge <= 1, an explicit mass no lighter than the
best demonstrated hardware could build it) live in the element's
`validate_cross_params()`, which recheck_element_params() also calls.

UNITS: every bound carries its unit string; dimensionless bounds say "-".
"""

from __future__ import annotations

import math
from typing import Any, Mapping, NamedTuple

from .mass import MassClosureError


class ParamBoundsError(MassClosureError):
    """
    @description Raised when a numeric element parameter is outside its declared
        credible range: an efficiency above 1, a figure of merit no rotor has
        demonstrated, an SOC rail outside [0, 1], a cp past the Betz limit, a
        gravimetric divisor that would make hardware massless. Subclasses
        MassClosureError (itself a ValueError) so every existing fail-closed
        handler catches it.
    """


class Bounds(NamedTuple):
    """
    @description A declared closed/open interval for one numeric parameter.
    @param lo Lower bound (inclusive unless lo_open).
    @param hi Upper bound (inclusive unless hi_open). math.inf is legal for a
        billed parameter whose growth costs mass; the value must still be
        finite -- require_in_range rejects inf/nan regardless of hi.
    @param lo_open True when the interval excludes lo (e.g. an efficiency
        must be > 0).
    @param hi_open True when the interval excludes hi.
    @param unit Unit string for the message, "-" for dimensionless.
    @param why One line saying what exploit the bound closes or which hardware
        anchors it. Printed in the error so a sweep log is self-explaining.
    """

    lo: float
    hi: float
    lo_open: bool = False
    hi_open: bool = False
    unit: str = "-"
    why: str = ""


#: Name of the class attribute holding the declared bounds table.
PARAM_BOUNDS_ATTR: str = "PARAM_BOUNDS"

#: Constructor parameters that are LIST INDICES, not physics quantities: they
#: select which body an element acts on and are validated by the container
#: (an out-of-range index is an immediate IndexError at evaluate time, not a
#: free-energy channel). Declared here, once, as an explicit contract so no
#: test or element infers the exemption from a name pattern ad hoc.
INDEX_PARAMS: frozenset[str] = frozenset({"body_index", "body_a", "body_b"})


def require_in_range(
    name: str,
    value: Any,
    lo: float,
    hi: float,
    *,
    lo_open: bool = False,
    hi_open: bool = False,
    unit: str = "-",
    element: str = "",
    why: str = "",
) -> float:
    """
    @description Validate one numeric parameter against a range. FAIL-CLOSED:
        non-numeric, nan, +/-inf and out-of-interval all raise. This is the ONE
        range checker every shipped element uses -- there is no second copy of
        the comparison logic to drift.
    @param name Parameter name, exactly as it appears in the constructor.
    @param value The value to validate. bool is rejected (True == 1 numerically
        but a bool where a physical quantity belongs is a caller bug).
    @param lo Lower bound (inclusive unless lo_open).
    @param hi Upper bound (inclusive unless hi_open); math.inf allowed, but the
        VALUE itself must always be finite.
    @param lo_open Exclude lo from the interval.
    @param hi_open Exclude hi from the interval.
    @param unit Unit string for the message.
    @param element Owning element class name, for the message.
    @param why One line naming the exploit the bound closes.
    @returns The validated value as a plain float.
    @raises ParamBoundsError When the value is not a finite real number inside
        the declared interval.
    """
    where = f"{element}.{name}" if element else name
    u = "" if unit in ("", "-") else f" {unit}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ParamBoundsError(
            f"{where} must be a real number{u or ' (dimensionless)'}, got {value!r}"
        )
    v = float(value)
    if not math.isfinite(v):
        raise ParamBoundsError(
            f"{where} must be finite, got {value!r}"
        )
    below = v < lo or (lo_open and v == lo)
    above = v > hi or (hi_open and v == hi)
    if below or above:
        lo_b = "(" if lo_open else "["
        hi_b = ")" if hi_open else "]"
        suffix = f" -- {why}" if why else ""
        raise ParamBoundsError(
            f"{where} = {v:g}{u} is outside the declared range "
            f"{lo_b}{lo:g}, {hi:g}{hi_b}{u}{suffix}"
        )
    return v


def declared_bounds(cls: type) -> Mapping[str, Bounds]:
    """
    @description The declared bounds table of a class, empty when it has none.
        Reads the attribute through the MRO so a subclass inherits (and may
        extend) its parent's declarations.
    @param cls The element class.
    @returns Mapping of parameter name to Bounds.
    """
    table = getattr(cls, PARAM_BOUNDS_ATTR, None)
    return table if isinstance(table, Mapping) else {}


def validate_declared(cls: type, **params: Any) -> dict[str, float]:
    """
    @description Validate a set of constructor parameters against the class's
        declared PARAM_BOUNDS. A parameter WITHOUT a declaration raises -- an
        element must not be able to route a number around its own table.
    @param cls The element class whose PARAM_BOUNDS applies.
    @param params name=value pairs to validate.
    @returns {name: validated float} for every parameter passed.
    @raises ParamBoundsError On any undeclared name or out-of-range value.
    """
    table = declared_bounds(cls)
    out: dict[str, float] = {}
    for name, value in params.items():
        bound = table.get(name)
        if bound is None:
            raise ParamBoundsError(
                f"{cls.__name__}.{name} has no declared bounds in "
                f"{cls.__name__}.{PARAM_BOUNDS_ATTR}; every numeric element "
                f"parameter must be range-checked or billed (declare it)."
            )
        out[name] = require_in_range(
            name,
            value,
            bound.lo,
            bound.hi,
            lo_open=bound.lo_open,
            hi_open=bound.hi_open,
            unit=bound.unit,
            element=cls.__name__,
            why=bound.why,
        )
    return out


def recheck_element_params(element: Any) -> None:
    """
    @description DEFENSE IN DEPTH: re-validate a LIVE element instance against
        its class's declared bounds, for the integrator to call at
        spec-extraction time. An element built by object.__new__ (or one whose
        attributes were reassigned after construction) never ran __init__'s
        checks; this catches it anyway. Also re-runs the element's
        cross-parameter constraints when it defines validate_cross_params().
    @param element Any shipped force element instance.
    @returns None. Raises on the first violation.
    @raises ParamBoundsError When any attribute named in PARAM_BOUNDS exists on
        the instance and is outside its declared range, or when a
        cross-parameter constraint fails.
    """
    cls = type(element)
    for name, bound in declared_bounds(cls).items():
        if not hasattr(element, name):
            # Constructor-only names (e.g. initial_soc is stored clipped-free
            # under the same name; a purely derived input would not be). A
            # missing attribute is not a violation -- the derived quantities it
            # fed (mass_kg, disk_area_m2) are themselves rechecked.
            continue
        if callable(getattr(element, name)):
            # The parameter was stored under a different attribute name and the
            # bare name is a METHOD (e.g. BuoyancyVolume.superpressure_Pa(p)).
            # The stored value is validated at construction; a method is not a
            # number to re-check.
            continue
        require_in_range(
            name,
            getattr(element, name),
            bound.lo,
            bound.hi,
            lo_open=bound.lo_open,
            hi_open=bound.hi_open,
            unit=bound.unit,
            element=cls.__name__,
            why=bound.why,
        )
    cross = getattr(element, "validate_cross_params", None)
    if callable(cross):
        cross()
