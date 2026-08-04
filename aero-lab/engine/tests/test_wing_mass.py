"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the wing structural mass model (vehicle/structure.py): anchor calibration, the round-2 exploit geometry billed heavy and no longer closing, span monotonicity / the bending penalty, AR-147.8 rejection, the explicit-mass floor, and the bypass-__init__ defense in depth.
2 | maintainer@emeraldcoastsystemsgroup.com   | Adjust test_exploit_winner_stops_closing to the round-3 builder: build_solar_cruise now bills the wing INSIDE declared_elements (subtracted from the as-flown total like every element), so the expected flown total is elem_kg + pod, with the wing asserted present via the meta wing_structural line. Intent unchanged: the exploit geometry carries its full bill and must not close.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4: the derived path now carries the same 0.4 kg/m2 floor as the explicit path (R4_probe_wingform measured 0.226 kg/m2 at 199.9 m2 -- the regression undercutting the module's own floor when extrapolated). Monotonicity test updated to the floored form (constant ON the floor, strictly increasing above it, never a discount), and the measured extrapolation point is pinned: 28.28 m / 199.9 m2 must bill >= 79.96 kg.

WHAT THESE TESTS PIN
--------------------
Round 2's optimizer converged on a massless airframe: span 20.71 m / 13.70 m^2
at 1.012 kg accepted, AR 147.8 accepted, structure 1e-6 kg accepted. Each of
the four acceptance criteria from that review is a named test here, plus the
round-3 invariant that a guard must hold even when __init__ is bypassed.
"""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from aerosim.vehicle import (
    AeroSurface,
    BodyState,
    MassClosureError,
    Vehicle,
    WingGeometry,
    naca4_geometry,
    wing_mass_kg,
    check_wing_structure_envelope,
    ANCHOR_WING_MASS_KG,
    MAX_STRUCTURAL_ASPECT_RATIO,
    MIN_WING_AREAL_DENSITY_KG_M2,
)
from aerosim.vehicle.structure import ExplicitWingMassWarning

#: Round-2 exploit winner (OPT_search.py seed 7, 96 evaluations).
EXPLOIT_SPAN_M = 20.712912830761518
EXPLOIT_AREA_M2 = 13.700489840972113

#: AtlantikSolar AS-2 planform, the calibration anchor.
AS2_SPAN_M = 5.65
AS2_AREA_M2 = 1.72


def _wing(span_m: float, area_m2: float, **kw) -> AeroSurface:
    """Build an AeroSurface on a NACA-2412 planform.

    @description Shared fixture: only the planform varies across these tests.
    @param span_m Span, m.
    @param area_m2 Area, m^2.
    @returns AeroSurface.
    """
    return AeroSurface(
        naca4_geometry("2412", span_m=span_m, area_m2=area_m2, taper_ratio=0.7),
        incidence_deg=3.0, extra_CD0=0.006, **kw,
    )


# ---------------------------------------------------------------------------
# Acceptance 1: the anchor
# ---------------------------------------------------------------------------


def test_case_A_wing_matches_measured_atlantiksolar_airframe() -> None:
    """The AS-2 planform must weigh ~2.29 kg (measured structure minus the
    documented 0.25 kg pod/boom/tail split). Tolerance 3%; the model is
    calibrated to this point so it lands exact, and the tolerance exists only
    so a legitimate recalibration does not need to touch this test."""
    m = wing_mass_kg(AS2_SPAN_M, AS2_AREA_M2)
    assert m == pytest.approx(2.2926475518672192, rel=0.03)
    assert m == pytest.approx(ANCHOR_WING_MASS_KG, rel=1e-9)
    # And the ELEMENT reports the same number through the mass protocol.
    surf = _wing(AS2_SPAN_M, AS2_AREA_M2)
    assert surf.DECLARES_MASS_CLOSURE is True
    assert surf.mass_kg == pytest.approx(m, rel=1e-12)


# ---------------------------------------------------------------------------
# Acceptance 2: the round-2 exploit geometry is billed heavy
# ---------------------------------------------------------------------------


def test_exploit_winner_wing_is_physically_heavy() -> None:
    """20.71 m / 13.70 m^2 (AR 31.3) must cost a real wing: ~15 kg, in the
    15-25 kg band the anchor scalings bracket (area rule 20.3 kg, b^3/S rule
    15.7 kg) -- not the 1.012 kg the optimizer bought."""
    m = wing_mass_kg(EXPLOIT_SPAN_M, EXPLOIT_AREA_M2)
    assert 12.0 <= m <= 25.0, f"exploit wing billed {m:.2f} kg"
    # 14x heavier than what round 2's winner paid for its entire airframe.
    assert m > 10.0 * 1.012


def test_exploit_winner_stops_closing() -> None:
    """CLOSED-LOOP consequence: with the wing billed, the winner design must
    fail the 24 h energy-closure gate. The round-2 audit showed closure dies
    above ~3 kg of structure; the billed wing alone is ~14.7 kg. Direction-safe
    even before the case-A regate: added mass can only hurt closure."""
    vd = pytest.importorskip("aerosim.validate_designs")
    from aerosim.validate import _run_window
    import dataclasses

    wing_kg = wing_mass_kg(EXPLOIT_SPAN_M, EXPLOIT_AREA_M2)
    probe = dataclasses.replace(
        vd.DESIGN_A, name="exploit-winner", span_m=EXPLOIT_SPAN_M,
        area_m2=EXPLOIT_AREA_M2, taper_ratio=0.7, mass_all_up_kg=1.0e4,
        battery_mass_kg=4.883217165067296, pv_packing=0.802,
        altitude_m=5510.610021508794, latitude_deg=-34.20010752252932,
        day_of_year=293, prop_max_electrical_W=2000.0,
    )
    probe_meta = vd.build_solar_cruise(probe).meta["mass_kg"]
    # ROUND-3 BUILDER: declared_elements now INCLUDES the billed wing (the
    # builder subtracts it from the as-flown total like every other element),
    # so the wing must show up inside that figure, not on top of it.
    elem_kg = float(probe_meta["declared_elements"])
    assert float(probe_meta["wing_structural"]) == pytest.approx(wing_kg, rel=1e-9), (
        "the builder's wing line is not the structural model's own bill"
    )
    # Grant only the 0.25 kg pod beyond the declared elements: the lightest
    # vehicle this geometry can legally be. The billed wing is inescapable --
    # it is inside elem_kg, and the derived total must carry it.
    design = dataclasses.replace(probe, mass_all_up_kg=elem_kg + 0.25)
    build = vd.build_solar_cruise(design)
    flown_kg = float(build.vehicle.total_mass_kg())
    assert flown_kg == pytest.approx(elem_kg + 0.25, rel=1e-6), (
        "the declared wing mass is not reaching the vehicle total"
    )
    assert flown_kg > wing_kg + 4.883217165067296, (
        "the flown total does not even carry pack + wing -- the bill leaked"
    )
    result, _ = _run_window(build)
    assert not result.closed, (
        f"the round-2 exploit still closes at its real mass "
        f"(wing {wing_kg:.2f} kg, flown {flown_kg:.2f} kg, "
        f"min_soc {result.min_soc:.3f})"
    )


# ---------------------------------------------------------------------------
# Acceptance 3: the bending penalty -- span costs mass at fixed area
# ---------------------------------------------------------------------------


def test_doubling_span_at_fixed_area_materially_increases_mass() -> None:
    """m ~ AR^0.467 = b^0.934 at fixed S: doubling span must cost ~1.9x."""
    base = wing_mass_kg(3.5, AS2_AREA_M2)
    doubled = wing_mass_kg(7.0, AS2_AREA_M2)
    assert doubled > 1.5 * base
    assert doubled == pytest.approx(base * 2.0 ** (2 * 0.467), rel=1e-9)


def test_wing_mass_is_monotonic_in_span_at_fixed_area() -> None:
    """Requirement (b) as a property, not two points. ROUND 4 nuance: the
    derived path now carries the same 0.4 kg/m2 areal floor as the explicit
    path (mass = max(regression, 0.4*S)), so at fixed area the mass is
    CONSTANT wherever the regression sits under the floor (stub spans) and
    STRICTLY increasing everywhere above it -- the bending penalty is intact
    where the regression is the binding bound, and the floor can only ever
    RAISE the bill, never discount it."""
    area = AS2_AREA_M2
    floor_kg = MIN_WING_AREAL_DENSITY_KG_M2 * area
    span_max = float(np.sqrt(MAX_STRUCTURAL_ASPECT_RATIO * area))
    spans = np.linspace(0.5, span_max * 0.999, 40)
    masses = [wing_mass_kg(float(b), area) for b in spans]
    # Never decreasing anywhere, and never below the floor.
    assert all(m2 >= m1 for m1, m2 in zip(masses, masses[1:]))
    assert all(m >= floor_kg for m in masses)
    # Strictly increasing on the regression-dominated region (above floor).
    above = [(m1, m2) for m1, m2 in zip(masses, masses[1:]) if m1 > floor_kg]
    assert above and all(m2 > m1 for m1, m2 in above)
    # The anchor span itself is regression-dominated (the floor did not eat
    # the calibration point).
    assert wing_mass_kg(5.65, area) > floor_kg


def test_derived_path_respects_the_areal_density_floor() -> None:
    """ROUND 4 regression (R4_probe_wingform): the S^0.778 regression
    extrapolated to 199.9 m2 / AR 4 implied 0.226 kg/m2 -- below the module's
    OWN 'no wing at this density has ever existed' floor -- and billed
    45.28 kg. The derived path must now bill at least 0.4 kg/m2."""
    m_kg = wing_mass_kg(28.28, 199.9, 3.0)
    assert m_kg >= 79.96 - 1e-9, f"billed {m_kg} kg, floor is 79.96 kg"
    assert m_kg >= MIN_WING_AREAL_DENSITY_KG_M2 * 199.9 - 1e-9
    # And the floor is a maximum, not a replacement: where the regression is
    # heavier (high AR), the regression still bills.
    m_high_ar = wing_mass_kg(77.44, 199.9, 3.0)  # AR 30
    assert m_high_ar > MIN_WING_AREAL_DENSITY_KG_M2 * 199.9


# ---------------------------------------------------------------------------
# Acceptance 4: AR 147.8 is rejected, not extrapolated
# ---------------------------------------------------------------------------


def test_ar_147_is_rejected_outright() -> None:
    """45 m span at 0.304 m chord (AR 147.8) is outside every aircraft ever
    built; the envelope rejects it fail-closed at both the function and the
    element constructor."""
    span_m, area_m2 = 45.0, 45.0 ** 2 / 147.8
    with pytest.raises(MassClosureError, match="aspect ratio"):
        wing_mass_kg(span_m, area_m2)
    with pytest.raises(MassClosureError, match="aspect ratio"):
        _wing(span_m, area_m2)
    # Doubling case A's span crosses the same wall (AR 74.2) -- also rejected.
    with pytest.raises(MassClosureError, match="aspect ratio"):
        wing_mass_kg(2 * AS2_SPAN_M, AS2_AREA_M2)


# ---------------------------------------------------------------------------
# The class, not just the instances: every knob is checked or billed
# ---------------------------------------------------------------------------


def test_explicit_mass_is_loud_and_floor_checked() -> None:
    """The explicit-mass hatch may not rebuild the massless airframe: below
    0.4 kg/m^2 it raises, and any explicit use warns with the model number."""
    with pytest.raises(MassClosureError, match="floor"):
        _wing(EXPLOIT_SPAN_M, EXPLOIT_AREA_M2, mass_kg=1.012)  # round-2 winner
    with pytest.raises(MassClosureError):
        _wing(AS2_SPAN_M, AS2_AREA_M2, mass_kg=1.0e-6)
    with pytest.warns(ExplicitWingMassWarning):
        pinned = _wing(AS2_SPAN_M, AS2_AREA_M2, mass_kg=2.5)
    assert pinned.mass_kg == pytest.approx(2.5)


def test_load_factor_is_range_checked_not_a_discount_knob() -> None:
    """n below 2 (or absurd) must raise -- turning the design load factor down
    is a wing-mass discount an optimizer will always take."""
    for bad_n in (0.0, 1.0, 1.99, -3.0, 1e6, float("nan")):
        with pytest.raises(MassClosureError):
            wing_mass_kg(AS2_SPAN_M, AS2_AREA_M2, load_factor=bad_n)


def test_nan_span_cannot_reach_the_mass_model() -> None:
    """A NaN span used to pass `span_m <= 0` (NaN compares False). Both layers
    now reject it by name."""
    with pytest.raises(ValueError, match="finite"):
        naca4_geometry("2412", span_m=float("nan"), area_m2=1.72)
    with pytest.raises(MassClosureError):
        check_wing_structure_envelope(float("nan"), 1.72)


def test_bypassing_init_is_caught_at_mass_read() -> None:
    """Round-3 defense in depth: an AeroSurface whose geometry is mutated AFTER
    construction (or built via object.__new__) must still be caught when the
    mass budget reads it, because mass_kg re-derives and re-checks."""
    surf = _wing(AS2_SPAN_M, AS2_AREA_M2)
    surf.geometry = WingGeometry(
        45.0, 45.0 ** 2 / 147.8, 0.7, 0.0, 2.0, 0.0,
        surf.geometry.kulfan_upper, surf.geometry.kulfan_lower,
        surf.geometry.leading_edge_weight, surf.geometry.TE_thickness,
    )
    with pytest.raises(MassClosureError, match="aspect ratio"):
        _ = surf.mass_kg
    # And growing the geometry re-bills automatically: no stale cached mass.
    honest = _wing(AS2_SPAN_M, AS2_AREA_M2)
    before = honest.mass_kg
    honest.geometry = naca4_geometry("2412", span_m=7.0, area_m2=1.72,
                                     taper_ratio=0.7)
    assert honest.mass_kg > before


def test_vehicle_budget_is_complete_with_a_real_wing() -> None:
    """assert_mass_declared() must pass because the wing mass is REAL -- not
    because a warning was suppressed -- and the budget total must move by
    exactly the wing's mass."""
    def build(span_m: float, area_m2: float) -> Vehicle:
        with warnings.catch_warnings():
            warnings.simplefilter("error")  # any undeclared-mass warning fails
            return Vehicle(
                bodies=[BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], 1.0)],
                elements=[_wing(span_m, area_m2)],
            )

    small = build(AS2_SPAN_M, AS2_AREA_M2)
    small.assert_mass_declared()  # raises if anything is undeclared
    assert small.undeclared_element_names() == []
    grown = build(EXPLOIT_SPAN_M, EXPLOIT_AREA_M2)
    delta = grown.total_mass_kg() - small.total_mass_kg()
    expected = (wing_mass_kg(EXPLOIT_SPAN_M, EXPLOIT_AREA_M2)
                - wing_mass_kg(AS2_SPAN_M, AS2_AREA_M2))
    assert delta == pytest.approx(expected, rel=1e-12)
