"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression test for the mass-closure fix: battery capacity and PV area must move total mass, omitting specific energy or areal density must RAISE rather than default, the conversion factors themselves must be bounded, initial_soc must be a real attribute, and the fixed-mass escape hatch must be explicit and loud.
2 | maintainer@emeraldcoastsystemsgroup.com   | Round-3 upgrade of the initial_soc clip guard: out-of-[0,1] SOC now FAILS CLOSED at construction (vehicle/param_bounds.py) instead of clipping into legality; the guard keeps proving that a legal request below soc_min clips onto the rail visibly (initial_soc_requested).
3 | maintainer@emeraldcoastsystemsgroup.com   | Round-4 alignment: the "a real number still works" pack probe moves 450.0 -> 445.5 Wh/kg -- the technology-catalogue pack frontier (Amprius 450 cell x 0.99 packaging) now refuses the bare 450 CELL number used as a PACK number, which is the exact fudge mass.py documents.

WHAT THIS FILE IS GUARDING
--------------------------
Battery watt-hours and panel square metres used to be free design variables:
10x-ing case A's pack left the aircraft at 6.93 kg and the case still passed, and
5000 Wh on the 1 kg negative-control quadcopter made it close. Every test below
fails if any part of that comes back, including the second-order versions --
a DEFAULTED specific energy, an UNBOUNDED specific energy, an undeclared element
silently treated as weightless, or the escape hatch becoming quiet.

The tests are written for pytest (plain test_* functions and asserts) but the
project venv has no pytest today, so the file also runs standalone:

    .venv/Scripts/python.exe tests/test_mass_closure.py
"""
from __future__ import annotations

import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aerosim.vehicle import (  # noqa: E402
    FIXED_TOTAL_MASS_OVERRIDE,
    G0_MS2,
    J_PER_WH,
    MAX_CREDIBLE_PACK_WH_PER_KG,
    PACK_ATLANTIKSOLAR_WH_PER_KG,
    PACK_LI_ION_WH_PER_KG,
    PV_LAMINATED_FLEXIBLE_KG_M2,
    BatteryElement,
    BodyState,
    ElementForce,
    FixedMassOverrideWarning,
    MassClosureError,
    PVArray,
    Tether,
    Thruster,
    UndeclaredMassError,
    UndeclaredMassWarning,
    Vehicle,
    battery_mass_kg,
)

# --------------------------------------------------------------------------- #
# Fixtures: the AtlantikSolar AS-2 energy system, the case the reviewer mutated #
# --------------------------------------------------------------------------- #

AS_STRUCTURE_KG = 3.3258        # kg, 6.93 all-up minus pack minus array
AS_AREA_M2 = 1.72               # m^2, gross wing/array area
AS_BATTERY_WH = 703.0           # Wh, published pack


def _array(area_m2: float = AS_AREA_M2) -> PVArray:
    """@returns An AtlantikSolar-class laminated array of the given area."""
    return PVArray(
        area_m2=area_m2, cell_efficiency_stc=0.237, packing_factor=0.802,
        tilt_deg=0.0, azimuth_deg=180.0, body_index=0,
        areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2,
    )


def _pack(battery_Wh: float = AS_BATTERY_WH, initial_soc: float = 1.0) -> BatteryElement:
    """@returns An AtlantikSolar-class pack of the given nameplate energy."""
    return BatteryElement(
        capacity_J=battery_Wh * J_PER_WH, initial_soc=initial_soc, body_index=0,
        specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG,
    )


def _vehicle(battery_Wh: float = AS_BATTERY_WH, area_m2: float = AS_AREA_M2) -> Vehicle:
    """@returns A one-body vehicle carrying only the energy system."""
    return Vehicle(
        bodies=[BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], AS_STRUCTURE_KG)],
        elements=[_array(area_m2), _pack(battery_Wh)],
    )


class _UndeclaredElement:
    """A third-party element that never says what it weighs."""

    body_index = 0
    offset_m = np.zeros(3)

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s) -> ElementForce:  # noqa: ANN001
        """@returns Nothing at all; it exists only to be audited."""
        return ElementForce(np.zeros(3), np.zeros(3), 0.0)


# --------------------------------------------------------------------------- #
# 1. The headline: capacity and area both move the total mass                   #
# --------------------------------------------------------------------------- #


def test_battery_capacity_moves_total_mass() -> None:
    """A bigger pack must weigh more -- linearly, and by the right amount."""
    base = _vehicle(battery_Wh=703.0)
    ten_x = _vehicle(battery_Wh=7030.0)

    assert abs(base.total_mass_kg() - 6.93) < 0.01, (
        f"baseline must reproduce the published 6.93 kg aircraft, got "
        f"{base.total_mass_kg():.4f} kg"
    )
    delta_kg = ten_x.total_mass_kg() - base.total_mass_kg()
    expected_kg = (7030.0 - 703.0) / PACK_ATLANTIKSOLAR_WH_PER_KG
    assert abs(delta_kg - expected_kg) < 1e-9, (
        f"10x-ing a 703 Wh pack must add {expected_kg:.3f} kg of cells, added "
        f"{delta_kg:.3f} kg"
    )
    assert ten_x.total_mass_kg() > 4.0 * base.total_mass_kg(), (
        "28 kg of cells on a 6.93 kg aircraft must be a MATERIAL mass change, "
        f"got {base.total_mass_kg():.2f} -> {ten_x.total_mass_kg():.2f} kg"
    )
    # Strictly monotone across a sweep: no plateau an optimizer could sit on.
    masses = [_vehicle(battery_Wh=wh).total_mass_kg()
              for wh in (100.0, 703.0, 2000.0, 7030.0, 50000.0)]
    assert all(b > a for a, b in zip(masses, masses[1:])), (
        f"mass must increase strictly with capacity across a sweep, got {masses}"
    )


def test_pv_area_moves_total_mass() -> None:
    """A bigger array must weigh more -- linearly in gross area."""
    base = _vehicle(area_m2=1.72)
    doubled = _vehicle(area_m2=3.44)
    delta_kg = doubled.total_mass_kg() - base.total_mass_kg()
    assert abs(delta_kg - 1.72 * PV_LAMINATED_FLEXIBLE_KG_M2) < 1e-12, (
        f"doubling 1.72 m2 must add 1.72 x {PV_LAMINATED_FLEXIBLE_KG_M2:.4f} = "
        f"{1.72 * PV_LAMINATED_FLEXIBLE_KG_M2:.4f} kg, added {delta_kg:.4f} kg"
    )
    masses = [_vehicle(area_m2=a).total_mass_kg() for a in (0.5, 1.72, 5.0, 50.0)]
    assert all(b > a for a, b in zip(masses, masses[1:])), (
        f"mass must increase strictly with array area, got {masses}"
    )


def test_battery_mass_matches_an_independent_hand_calculation() -> None:
    """The conversion is m = Wh / (Wh/kg); nothing hidden in it."""
    pack = _pack(703.0)
    hand_kg = (703.0 * J_PER_WH / J_PER_WH) / PACK_ATLANTIKSOLAR_WH_PER_KG
    assert abs(pack.mass_kg - hand_kg) < 1e-12
    assert abs(pack.mass_kg - 2.9170) < 1e-3, (
        f"703 Wh at 241 Wh/kg is AtlantikSolar's published 2.92 kg pack, got "
        f"{pack.mass_kg:.4f} kg"
    )
    assert abs(battery_mass_kg(703.0 * J_PER_WH, 241.0) - pack.mass_kg) < 1e-12


def test_pv_mass_is_areal_density_times_gross_area() -> None:
    """Array mass is stated area x stated density, with no packing fudge."""
    array = _array(1.72)
    assert abs(array.mass_kg - 1.72 * PV_LAMINATED_FLEXIBLE_KG_M2) < 1e-12
    # packing_factor changes power, never mass: the laminate covers the panel.
    sparse = PVArray(area_m2=1.72, cell_efficiency_stc=0.237, packing_factor=0.10,
                     areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2)
    assert abs(sparse.mass_kg - array.mass_kg) < 1e-12


# --------------------------------------------------------------------------- #
# 2. Omission must RAISE, not default                                           #
# --------------------------------------------------------------------------- #


def test_omitting_specific_energy_raises_rather_than_defaulting() -> None:
    """The whole point: no silent default anywhere on the path."""
    try:
        BatteryElement(capacity_J=703.0 * J_PER_WH, initial_soc=1.0)
    except MassClosureError as exc:
        assert "specific_energy_Wh_per_kg" in str(exc)
        assert "no default" in str(exc)
    else:
        raise AssertionError(
            "BatteryElement built with NO specific energy. A pack without a "
            "stated specific energy is weightless and a sweep buys unlimited "
            "storage for free."
        )


def test_omitting_areal_density_raises_rather_than_defaulting() -> None:
    """Same for the array: no areal density, no array."""
    try:
        PVArray(area_m2=1.72, cell_efficiency_stc=0.237, packing_factor=0.802)
    except MassClosureError as exc:
        assert "areal_density_kg_m2" in str(exc)
        assert "no default" in str(exc)
    else:
        raise AssertionError(
            "PVArray built with NO areal density. A weightless array lets a "
            "sweep grow the panel without limit."
        )


def test_specific_energy_is_keyword_only() -> None:
    """It cannot be smuggled in positionally and mistaken for something else."""
    try:
        BatteryElement(703.0 * J_PER_WH, 1.0, 0, PACK_LI_ION_WH_PER_KG)
    except TypeError:
        pass
    else:
        raise AssertionError("specific_energy_Wh_per_kg must be keyword-only")


# --------------------------------------------------------------------------- #
# 3. The conversion factor is itself a design variable, so it is bounded        #
# --------------------------------------------------------------------------- #


def test_incredible_specific_energy_raises() -> None:
    """An unbounded Wh/kg is a massless pack one level up."""
    for bad in (1.0e9, 501.0, 0.0, -250.0, float("inf"), float("nan"), 1.0):
        try:
            BatteryElement(capacity_J=1.0e6,
                           specific_energy_Wh_per_kg=bad)
        except MassClosureError:
            continue
        raise AssertionError(
            f"specific_energy_Wh_per_kg = {bad} was accepted; the credible band "
            f"is [20, {MAX_CREDIBLE_PACK_WH_PER_KG:g}] Wh/kg at PACK level"
        )
    # ... and a real number still works. 445.5 = the tech-catalogue pack
    # frontier (Amprius 450 Wh/kg cell x 0.99 minimal packaging) -- the round-4
    # catalogue refuses anything above it, including the bare 450 CELL number
    # used as a pack number, which is exactly the fudge mass.py documents.
    assert BatteryElement(capacity_J=1.0e6,
                          specific_energy_Wh_per_kg=445.5).mass_kg > 0.0


def test_incredible_pv_areal_density_raises() -> None:
    """Nothing is lighter than the silicon it is made of."""
    for bad in (1.0e-9, 0.14, 0.0, -0.4, 16.0, float("nan")):
        try:
            PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85,
                    areal_density_kg_m2=bad)
        except MassClosureError:
            continue
        raise AssertionError(
            f"areal_density_kg_m2 = {bad} was accepted; a bare 150 um silicon "
            f"cell alone is 0.35 kg/m2"
        )
    assert PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85,
                   areal_density_kg_m2=0.20).mass_kg > 0.0


# --------------------------------------------------------------------------- #
# 4. The derived total has to reach the integrator                              #
# --------------------------------------------------------------------------- #


def test_body_mass_kg_carries_the_derived_total() -> None:
    """integrate.py reads b.mass_kg for gravity and trim; it must be the total."""
    vehicle = _vehicle(battery_Wh=7030.0)
    body = vehicle.bodies[0]
    assert abs(body.structure_mass_kg - AS_STRUCTURE_KG) < 1e-12, (
        "the structure input must be preserved verbatim"
    )
    assert abs(body.mass_kg - vehicle.total_mass_kg()) < 1e-12, (
        f"body.mass_kg = {body.mass_kg:.4f} but the vehicle masses "
        f"{vehicle.total_mass_kg():.4f} kg -- the integrator would fly the "
        f"lighter one"
    )
    assert body.mass_kg > 30.0, (
        f"a 7030 Wh pack is 29 kg of cells; body.mass_kg = {body.mass_kg:.3f}"
    )


def test_gravity_and_weight_use_the_derived_mass() -> None:
    """Weight and the gravity vector must both see the pack."""
    vehicle = _vehicle(battery_Wh=7030.0)
    expected_N = vehicle.total_mass_kg() * G0_MS2
    assert abs(vehicle.weight_N() - expected_N) < 1e-9
    gravity_N = vehicle.gravity_forces_N()
    assert gravity_N.shape == (1, 3)
    assert abs(float(gravity_N[0, 2]) + expected_N) < 1e-9
    assert float(gravity_N[0, 2]) < -300.0


def test_binding_is_idempotent() -> None:
    """Re-binding must not accumulate; a stale budget must not linger."""
    vehicle = _vehicle(battery_Wh=703.0)
    first = vehicle.total_mass_kg()
    for _ in range(5):
        vehicle.bind_masses()
    assert abs(vehicle.total_mass_kg() - first) < 1e-12
    # A pack added AFTER construction must still be billed.
    vehicle.elements.append(_pack(703.0))
    assert abs(vehicle.total_mass_kg() - (first + 703.0 / PACK_ATLANTIKSOLAR_WH_PER_KG)) < 1e-9


def test_two_body_tether_mass_lands_on_both_bodies() -> None:
    """A cable spans two bodies, so its mass must too."""
    cable = Tether(body_a=0, body_b=1, rest_length_m=1000.0, EA_N=5.0e4,
                   diameter_m=0.002)
    vehicle = Vehicle(
        bodies=[BodyState([0.0, 0.0, 1000.0], np.zeros(3), 5.0),
                BodyState([0.0, 0.0, 1500.0], np.zeros(3), 2.0)],
        elements=[cable],
    )
    half_kg = 0.5 * cable.mass_kg
    assert cable.mass_kg > 2.5, (
        f"1 km of 2 mm Dyneema is ~2.6 kg, got {cable.mass_kg:.4f} kg"
    )
    assert abs(vehicle.bodies[0].mass_kg - (5.0 + half_kg)) < 1e-12
    assert abs(vehicle.bodies[1].mass_kg - (2.0 + half_kg)) < 1e-12


# --------------------------------------------------------------------------- #
# 5. initial_soc must be a real attribute (integrate.py getattr's it)           #
# --------------------------------------------------------------------------- #


def test_initial_soc_is_stored_and_reaches_a_getattr_reader() -> None:
    """
    It used to be computed and discarded, so integrate.py's
    getattr(el, "initial_soc", 1.0) returned 1.0 for every pack ever built and
    every design started on a free full charge.
    """
    for requested, expected in ((0.05, 0.05), (0.5, 0.5), (1.0, 1.0), (0.4396, 0.4396)):
        pack = _pack(initial_soc=requested)
        assert hasattr(pack, "initial_soc"), (
            "BatteryElement has no initial_soc attribute; integrate.py's "
            "getattr default of 1.0 silently wins"
        )
        assert abs(getattr(pack, "initial_soc", 1.0) - expected) < 1e-12, (
            f"initial_soc={requested} must survive as {expected}, a reader saw "
            f"{getattr(pack, 'initial_soc', 1.0)}"
        )
        assert abs(pack.soc - expected) < 1e-12
        assert abs(pack.energy_J - expected * pack.capacity_J) < 1e-6


def test_initial_soc_is_clipped_into_the_usable_band_and_says_so() -> None:
    """
    In-band clipping is fine and must stay visible; OUT-OF-[0,1] now RAISES.

    Round 3 upgraded this guard: a state of charge is a fraction of nameplate,
    so initial_soc outside [0, 1] is no longer clipped quietly into legality --
    it fails closed (vehicle/param_bounds.py). What this test keeps proving is
    the round-2 half: a LEGAL request below soc_min still clips onto the rail
    and the unclipped request stays visible in initial_soc_requested.
    """
    pack = BatteryElement(capacity_J=1.0e6, initial_soc=0.02,
                          specific_energy_Wh_per_kg=PACK_LI_ION_WH_PER_KG,
                          soc_min=0.05, soc_max=1.0)
    assert abs(pack.initial_soc - 0.05) < 1e-12
    assert abs(pack.initial_soc_requested - 0.02) < 1e-12
    for bad_soc in (-3.0, 9.0):
        try:
            BatteryElement(capacity_J=1.0e6, initial_soc=bad_soc,
                           specific_energy_Wh_per_kg=PACK_LI_ION_WH_PER_KG)
        except ValueError:
            pass  # ParamBoundsError is a ValueError; fail-closed as required
        else:
            raise AssertionError(
                f"initial_soc={bad_soc} constructed; out-of-[0,1] SOC must "
                f"raise, not clip into legality"
            )


# --------------------------------------------------------------------------- #
# 6. Undeclared mass is reported, and the escape hatch is loud                   #
# --------------------------------------------------------------------------- #


def test_undeclared_element_is_reported_not_assumed_weightless() -> None:
    """Unknown mass must be visible; a sweep must be able to make it fatal."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        vehicle = Vehicle(
            bodies=[BodyState(np.zeros(3), np.zeros(3), 1.0)],
            elements=[_pack(), _UndeclaredElement()],
        )
    assert any(issubclass(w.category, UndeclaredMassWarning) for w in caught), (
        "an element with unknown mass must warn at construction"
    )
    assert vehicle.undeclared_element_names() == ["_UndeclaredElement"]
    try:
        vehicle.assert_mass_declared()
    except UndeclaredMassError as exc:
        assert "_UndeclaredElement" in str(exc)
    else:
        raise AssertionError(
            "assert_mass_declared() must raise -- it is the call a design sweep "
            "makes to refuse unbilled mass"
        )
    # An explicit allowance is the only way past it, and it has to name names.
    vehicle.assert_mass_declared(allow=["_UndeclaredElement"])


def test_fixed_mass_override_is_explicit_and_warns_every_time() -> None:
    """The escape hatch reproduces the old defect, so it must never be quiet."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        pinned = Vehicle(
            bodies=[BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], 6.93)],
            elements=[_array(), _pack(7030.0)],
            mass_closure=FIXED_TOTAL_MASS_OVERRIDE,
        )
    assert any(issubclass(w.category, FixedMassOverrideWarning) for w in caught), (
        "the fixed-mass hatch must warn on every use"
    )
    assert abs(pinned.total_mass_kg() - 6.93) < 1e-12, (
        "the hatch must actually pin the mass, or it is not an escape hatch"
    )
    # And the default path must NOT be the hatch.
    assert _vehicle().mass_closure != FIXED_TOTAL_MASS_OVERRIDE
    try:
        Vehicle(bodies=[BodyState(np.zeros(3), np.zeros(3), 1.0)],
                elements=[], mass_closure="whatever")
    except MassClosureError:
        pass
    else:
        raise AssertionError("an unrecognised mass_closure mode must raise")


# --------------------------------------------------------------------------- #
# 7. The other elements that have physical mass                                 #
# --------------------------------------------------------------------------- #


def test_thruster_mass_scales_with_installed_power_and_disk() -> None:
    """Installed power and disk area are design variables; both must cost."""
    small = Thruster(diameter_m=0.36, max_electrical_power_W=120.0)
    powerful = Thruster(diameter_m=0.36, max_electrical_power_W=1200.0)
    big_disk = Thruster(diameter_m=1.08, max_electrical_power_W=120.0)
    assert powerful.mass_kg > small.mass_kg, "10x the power must weigh more"
    assert big_disk.mass_kg > small.mass_kg, "3x the diameter must weigh more"
    assert small.mass_kg > 0.0
    try:
        Thruster(diameter_m=0.36, max_electrical_power_W=120.0, mass_kg=0.0)
    except MassClosureError:
        pass
    else:
        raise AssertionError("an explicitly weightless drive must be refused")


def test_tether_mass_scales_with_length_and_diameter() -> None:
    """A cable's length buys the shear archetype 3 lives on; it must weigh."""
    short = Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=5.0e4,
                   diameter_m=0.002)
    long_ = Tether(body_a=0, body_b=1, rest_length_m=1000.0, EA_N=5.0e4,
                   diameter_m=0.002)
    thick = Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=5.0e4,
                   diameter_m=0.004)
    assert abs(long_.mass_kg - 10.0 * short.mass_kg) < 1e-12
    assert abs(thick.mass_kg - 4.0 * short.mass_kg) < 1e-12
    assert short.mass_kg > 0.0, "the DEFAULT tether must not be weightless"
    split = long_.mass_distribution()
    assert abs(split[0] - split[1]) < 1e-15
    assert abs(split[0] + split[1] - long_.mass_kg) < 1e-15


def test_cable_stiffness_must_be_achievable_by_its_own_cross_section() -> None:
    """EA and diameter are independent arguments; an infinite EA is a free lunch."""
    try:
        Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=1.0e12,
               diameter_m=0.001)
    except MassClosureError as exc:
        assert "modulus" in str(exc)
    else:
        raise AssertionError(
            "EA = 1e12 N on a 1 mm line implies 1273 TPa and must be refused"
        )
    # Real Dyneema is fine: 109 GPa over 1 mm is EA ~ 8.6e4 N.
    Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=8.6e4, diameter_m=0.001)


def test_mass_did_not_break_the_pv_zero_force_invariant() -> None:
    """A panel now has weight, but it must still emit EXACTLY zero force."""
    from aerosim.env.atmosphere import atmosphere
    from aerosim.env.solar import SolarSample
    from aerosim.env.wind import WindSample

    array = _array()
    body = BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], 1.0)
    force = array.evaluate([body], atmosphere(500.0),
                           WindSample(0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
                           SolarSample(-0.5, 0.0, 0.0, 0.0, 0.0, 0.0), 0.0, 60.0)
    assert np.array_equal(force.force_N, np.zeros(3)), (
        "PV force must stay identically zero -- mass belongs in the budget, "
        "never in the force"
    )


def test_mass_budget_report_names_every_contribution() -> None:
    """The budget has to be readable, or nobody will read it."""
    budget = _vehicle().mass_budget()
    text = budget.report()
    assert "BatteryElement" in text and "PVArray" in text
    assert "703.0 Wh / 241.0 Wh/kg" in text
    assert abs(budget.total_mass_kg - 6.93) < 0.01
    assert abs(budget.mass_fraction("BatteryElement") - 0.421) < 0.01, (
        f"AtlantikSolar's pack is 42 % of all-up mass; budget says "
        f"{100 * budget.mass_fraction('BatteryElement'):.1f} %"
    )


# --------------------------------------------------------------------------- #
# Standalone runner (the venv has no pytest today)                              #
# --------------------------------------------------------------------------- #


def _main() -> int:
    """
    @description Run every test_* function in this module and report.
    @returns 0 when all passed, 1 otherwise.
    """
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    failures: list[tuple[str, str]] = []
    print("=" * 88)
    print(f"tests/test_mass_closure.py -- {len(tests)} regression tests")
    print("=" * 88)
    for name, fn in tests:
        try:
            fn()
        except AssertionError as exc:
            failures.append((name, str(exc)))
            print(f"  [FAIL] {name}\n         {exc}")
        except Exception as exc:  # pragma: no cover - unexpected error
            failures.append((name, f"{type(exc).__name__}: {exc}"))
            print(f"  [ERROR] {name}\n         {type(exc).__name__}: {exc}")
        else:
            print(f"  [PASS] {name}")
    print("-" * 88)
    print(f"  {len(tests) - len(failures)}/{len(tests)} passed")
    print("=" * 88)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(_main())
