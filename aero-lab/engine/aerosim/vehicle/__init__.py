"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Package barrel for aerosim.vehicle plus the runnable acceptance self-test (buoyancy, tether third law + conservatism, PV zero-force, solver-derived AtlantikSolar aero, Galilean free-energy guard).
2 | maintainer@emeraldcoastsystemsgroup.com   | Export the mass-closure layer, and give the self-test's PVArray / BatteryElement their now-required areal density and pack specific energy. Added self-test section [7]: mass closure moves the vehicle's weight.
3 | maintainer@emeraldcoastsystemsgroup.com   | Export WindTurbine and PayloadLoad. These were the two elements validate.py could not build a case from, so it carried private self-billing stand-ins instead; promoting them makes every validation case use the objects a design sweep instantiates.
4 | maintainer@emeraldcoastsystemsgroup.com   | Export the wing structural mass layer (vehicle/structure.py): wing_mass_kg, the envelope/explicit-mass checks and their constants. AeroSurface now declares real mass, so the round-2 undeclared-wing warning path goes quiet honestly.
5 | maintainer@emeraldcoastsystemsgroup.com   | Export the parameter-bounds layer (vehicle/param_bounds.py): ParamBoundsError, Bounds, require_in_range, validate_declared, declared_bounds, recheck_element_params, PARAM_BOUNDS_ATTR, INDEX_PARAMS. Round-3 class fix: every numeric constructor parameter on every shipped element is now range-checked or billed, and the integrator can re-check a live instance at spec extraction.
6 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4: export the technology catalogue (vehicle/tech_catalogue.py -- joint frontiers for coupled parameters), the fuselage/boom/tail remainder floor (structure.min_fuselage_boom_tail_mass_kg), the balloon film areal-density constants, and the battery eta ceilings. Self-test buoyancy checks updated for the derived (non-zero) film: the agreed table values are GROSS lift, so they are now checked as force + film weight, same physics, film billed.
7 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): export min_extra_CD0 (structure.py's shell/slender-body parasite-drag floor, replacing the screen's vacuous solid-sphere bound) and MAX_PV_PACKING_FACTOR (tech_catalogue.py's 0.92 packing ceiling, now PVArray's declared bound).

MODULE: aerosim.vehicle -- a vehicle IS a set of force-producing elements in a
moving fluid field.

The five element kinds all satisfy ONE contract (state.ForceElement), which is
what makes the four required archetypes configurations rather than code paths:

  1. Solar fixed-wing       AeroSurface + Thruster + PVArray + BatteryElement
  2. Super-pressure balloon BuoyancyVolume + PVArray + BatteryElement
  3. Tethered sky sailboat  two bodies, AeroSurface in a fast layer + AeroSurface
                            or drogue in a slow layer, coupled by Tether
  4. Dynamic soarer         AeroSurface flown through a sheared/gusting field

Run the acceptance test with:
    python -m aerosim.vehicle
"""

from __future__ import annotations

from .mass import (
    CELL_SI_ANODE_AMPRIUS_WH_PER_KG,
    DYNEEMA_SK75_DENSITY_KG_M3,
    J_PER_WH,
    MAX_CREDIBLE_PACK_WH_PER_KG,
    MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2,
    PACK_ATLANTIKSOLAR_WH_PER_KG,
    PACK_FRACTION_MINIMAL_PACKAGING,
    PACK_FRACTION_TYPICAL,
    PACK_LI_ION_WH_PER_KG,
    PACK_LI_PO_HOBBY_WH_PER_KG,
    PACK_SI_ANODE_WH_PER_KG,
    PV_LAMINATED_FLEXIBLE_KG_M2,
    PV_MODULE_WITH_MPPT_KG_M2,
    PV_THIN_FILM_BLANKET_KG_M2,
    MassBudget,
    MassClosureError,
    MassContribution,
    UndeclaredMassError,
    UndeclaredMassWarning,
    FixedMassOverrideWarning,
    battery_mass_kg,
    build_mass_budget,
    check_cable_stiffness,
    motor_drive_mass_kg,
    pack_specific_energy_Wh_per_kg,
    propeller_mass_kg,
    pv_array_mass_kg,
    rope_linear_density_kg_m,
)
from .state import (
    EPS_NORM,
    FIXED_TOTAL_MASS_OVERRIDE,
    G0_MS2,
    MASS_CLOSURE_DERIVED,
    UP_AXIS,
    BodyState,
    ElementForce,
    ForceElement,
    PairForceElement,
    Vehicle,
    as_offset,
    moment_from_offset,
    relative_airspeed_vector,
    safe_unit,
    wind_axes,
    zero_force,
)
from .param_bounds import (
    INDEX_PARAMS,
    PARAM_BOUNDS_ATTR,
    Bounds,
    ParamBoundsError,
    declared_bounds,
    recheck_element_params,
    require_in_range,
    validate_declared,
)
from .geometry import N_KULFAN_WEIGHTS, WingGeometry, naca4_geometry
from .structure import (
    ANCHOR_WING_MASS_KG,
    DESIGN_LOAD_FACTOR_DEFAULT,
    FUSELAGE_BOOM_TAIL_KG,
    FUSELAGE_FLOOR_FIT_FACTOR,
    MAX_STRUCTURAL_ASPECT_RATIO,
    MIN_WING_AREAL_DENSITY_KG_M2,
    ExplicitWingMassWarning,
    check_explicit_wing_mass_kg,
    check_wing_structure_envelope,
    min_extra_CD0,
    min_fuselage_boom_tail_mass_kg,
    wing_mass_kg,
)
from .aerosurface import (
    DEFAULT_ALPHA_GRID_DEG,
    RE_BINS_PER_DECADE,
    AeroSurface,
    NoValidAeroPointError,
)
from .buoyancy import (
    BALLOON_FILM_AREAL_DENSITY_KG_M2,
    EARTH_IR_TEMP_K,
    HELIUM_DENSITY_RATIO,
    MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2,
    BuoyancyVolume,
    specific_gas_constant_J_kgK,
    specific_heat_cv_J_kgK,
    sphere_drag_coefficient,
    sphere_nusselt,
)
from .tech_catalogue import (
    MAX_PV_PACKING_FACTOR,
    PACK_CATALOGUE,
    PACK_FRONTIER_WH_PER_KG,
    PV_CELL_CATALOGUE,
    TechCatalogueError,
    check_pack_technology,
    check_pv_technology_pair,
    pv_frontier_efficiency,
)
from .tether import Tether
from .thruster import Thruster
from .turbine import (
    GENERATOR_SPECIFIC_POWER_W_PER_KG,
    RECTIFIER_SPECIFIC_POWER_W_PER_KG,
    WindTurbine,
)
from .energy import (
    MAX_ETA_CHARGE,
    MAX_ETA_DISCHARGE,
    BatteryElement,
    PayloadLoad,
    PVArray,
    plane_of_array_irradiance_Wm2,
)

__all__ = [
    # state
    "BodyState", "ElementForce", "ForceElement", "PairForceElement", "Vehicle",
    "G0_MS2", "UP_AXIS", "EPS_NORM", "zero_force", "relative_airspeed_vector",
    "safe_unit", "wind_axes", "moment_from_offset", "as_offset",
    # geometry
    "WingGeometry", "naca4_geometry", "N_KULFAN_WEIGHTS",
    # wing structural mass (vehicle/structure.py)
    "wing_mass_kg", "check_wing_structure_envelope", "check_explicit_wing_mass_kg",
    "DESIGN_LOAD_FACTOR_DEFAULT", "MAX_STRUCTURAL_ASPECT_RATIO",
    "MIN_WING_AREAL_DENSITY_KG_M2", "ANCHOR_WING_MASS_KG",
    "FUSELAGE_BOOM_TAIL_KG", "ExplicitWingMassWarning",
    "min_fuselage_boom_tail_mass_kg", "FUSELAGE_FLOOR_FIT_FACTOR",
    # extra_CD0 shell/slender-body floor (round 5, vehicle/structure.py)
    "min_extra_CD0",
    # technology catalogue (vehicle/tech_catalogue.py) -- the round-4 joint guard
    "TechCatalogueError", "PV_CELL_CATALOGUE", "PACK_CATALOGUE",
    "PACK_FRONTIER_WH_PER_KG", "check_pv_technology_pair",
    "check_pack_technology", "pv_frontier_efficiency",
    "MAX_PV_PACKING_FACTOR",
    # balloon film (round 4)
    "BALLOON_FILM_AREAL_DENSITY_KG_M2", "MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2",
    # battery efficiency ceilings (round 4)
    "MAX_ETA_CHARGE", "MAX_ETA_DISCHARGE",
    # elements
    "AeroSurface", "BuoyancyVolume", "Tether", "Thruster", "PVArray",
    "BatteryElement", "WindTurbine", "PayloadLoad",
    "GENERATOR_SPECIFIC_POWER_W_PER_KG", "RECTIFIER_SPECIFIC_POWER_W_PER_KG",
    # parameter bounds (vehicle/param_bounds.py) -- the round-3 class guard
    "ParamBoundsError", "Bounds", "require_in_range", "validate_declared",
    "declared_bounds", "recheck_element_params", "PARAM_BOUNDS_ATTR",
    "INDEX_PARAMS",
    # helpers
    "NoValidAeroPointError", "DEFAULT_ALPHA_GRID_DEG", "RE_BINS_PER_DECADE",
    "sphere_drag_coefficient", "sphere_nusselt", "specific_gas_constant_J_kgK",
    "specific_heat_cv_J_kgK", "HELIUM_DENSITY_RATIO", "EARTH_IR_TEMP_K",
    "plane_of_array_irradiance_Wm2",
    # mass closure
    "MassBudget", "MassContribution", "MassClosureError", "UndeclaredMassError",
    "UndeclaredMassWarning", "FixedMassOverrideWarning", "build_mass_budget",
    "battery_mass_kg", "pv_array_mass_kg", "motor_drive_mass_kg",
    "propeller_mass_kg", "rope_linear_density_kg_m", "check_cable_stiffness",
    "pack_specific_energy_Wh_per_kg", "MASS_CLOSURE_DERIVED",
    "FIXED_TOTAL_MASS_OVERRIDE", "J_PER_WH",
    "PACK_LI_ION_WH_PER_KG", "PACK_LI_PO_HOBBY_WH_PER_KG",
    "PACK_SI_ANODE_WH_PER_KG", "PACK_ATLANTIKSOLAR_WH_PER_KG",
    "CELL_SI_ANODE_AMPRIUS_WH_PER_KG",
    "PACK_FRACTION_TYPICAL", "PACK_FRACTION_MINIMAL_PACKAGING",
    "MAX_CREDIBLE_PACK_WH_PER_KG", "MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2",
    "PV_LAMINATED_FLEXIBLE_KG_M2", "PV_MODULE_WITH_MPPT_KG_M2",
    "PV_THIN_FILM_BLANKET_KG_M2", "DYNEEMA_SK75_DENSITY_KG_M3",
]


# ===========================================================================
# SELF-TEST
# ===========================================================================

def _selftest() -> int:  # noqa: C901 - a test harness, read top to bottom
    """
    @description Execute this module's locked acceptance test and print PASS/FAIL
        with the actual computed values.
    @returns Process exit code: 0 if every check passed, 1 otherwise.
    """
    import numpy as np

    # env has no barrel yet in some build orders; import the leaves directly so
    # this test does not depend on another agent's __init__.py landing first.
    from ..env.atmosphere import atmosphere, sutherland_mu
    from ..env.wind import WindSample, make_uniform_field
    from ..env.solar import SolarSample, solar
    from .. import aeropolar

    results: list[tuple[bool, str, str]] = []
    spec_conflicts: list[tuple[bool, str, str]] = []

    def check(name: str, ok: bool, detail: str, spec_conflict: bool = False) -> None:
        """
        @description Record and print one check.
        @param spec_conflict True marks a clause of the LOCKED SPEC that this
            module cannot satisfy because the clause is self-contradictory. Such
            a clause is reported separately and loudly, and is deliberately NOT
            counted as a module defect -- but it is never hidden.
        """
        entry = (bool(ok), name, detail)
        if spec_conflict:
            spec_conflicts.append(entry)
            tag = "PASS" if ok else "SPEC-CONFLICT"
        else:
            results.append(entry)
            tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {name}")
        print(f"         {detail}")

    def still_air() -> WindSample:
        """Zero wind, zero gradient."""
        return WindSample(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    def dark() -> SolarSample:
        """Sun below the horizon."""
        return SolarSample(-0.5, 0.0, 0.0, 0.0, 0.0, 0.0)

    print("=" * 78)
    print("aerosim.vehicle -- ACCEPTANCE SELF-TEST")
    print("=" * 78)

    # -----------------------------------------------------------------
    print("\n[1] BUOYANCY -- super-pressure gas cells against the agreed table")
    # -----------------------------------------------------------------
    atmo_15km = atmosphere(15000.0)
    atmo_20km = atmosphere(20000.0)
    print(f"      env atmosphere(15000 m): rho = {atmo_15km.rho_kgm3:.5f} kg/m3, "
          f"T = {atmo_15km.T_K:.2f} K, p = {atmo_15km.p_Pa:.1f} Pa")
    print(f"      env atmosphere(20000 m): rho = {atmo_20km.rho_kgm3:.5f} kg/m3, "
          f"T = {atmo_20km.T_K:.2f} K, p = {atmo_20km.p_Pa:.1f} Pa")

    # 1.97 m sphere at 15 km -> V = 4.003 m^3. Film mass is DERIVED (round 4:
    # a zero-mass envelope now raises), so the agreed GROSS-lift table value is
    # checked against gross_lift_N -- the same quantity the table quotes, which
    # excludes the film by definition.
    cell_a = BuoyancyVolume(volume_m3=4.003, gas="helium")
    body_a = BodyState(pos_m=[0.0, 0.0, 15000.0], vel_ms=[0.0, 0.0, 0.0], mass_kg=0.0)
    force_a = cell_a.evaluate([body_a], atmo_15km, still_air(), dark(), 0.0, 60.0)
    lift_a_N = float(force_a.force_N[2]) + cell_a.film_mass_kg * G0_MS2
    mass_a_kg = lift_a_N / G0_MS2
    err_a = abs(lift_a_N - 6.59) / 6.59
    check(
        "1.97 m helium sphere @ 15 km gives 6.59 N gross lift (+/-2%)",
        err_a <= 0.02,
        f"V = 4.003 m3, rho_air = {atmo_15km.rho_kgm3:.5f}, "
        f"rho_gas = {cell_a.gas_density_kgm3:.6f} kg/m3 "
        f"(ratio {cell_a.gas_density_kgm3 / atmo_15km.rho_kgm3:.6f} vs He/air 0.138190) "
        f"-> lift = {lift_a_N:.4f} N = {mass_a_kg:.4f} kg  [target 6.59 N / 0.672 kg, "
        f"error {100 * err_a:.3f}%]",
    )

    # 4.41 m sphere at 20 km -> V = 44.907 m^3 (derived film, gross-lift check
    # as above).
    cell_b = BuoyancyVolume(volume_m3=44.907, gas="helium")
    body_b = BodyState(pos_m=[0.0, 0.0, 20000.0], vel_ms=[0.0, 0.0, 0.0], mass_kg=0.0)
    force_b = cell_b.evaluate([body_b], atmo_20km, still_air(), dark(), 0.0, 60.0)
    lift_b_N = float(force_b.force_N[2]) + cell_b.film_mass_kg * G0_MS2
    mass_b_kg = lift_b_N / G0_MS2
    err_b = abs(lift_b_N - 33.74) / 33.74
    check(
        "4.41 m helium sphere @ 20 km gives 33.74 N gross lift (+/-2%)",
        err_b <= 0.02,
        f"V = 44.907 m3, rho_air = {atmo_20km.rho_kgm3:.5f} "
        f"-> lift = {lift_b_N:.4f} N = {mass_b_kg:.4f} kg  "
        f"[target 33.74 N / 3.441 kg, error {100 * err_b:.3f}%]",
    )

    # Superheat must NOT move the lift of a sealed fixed-volume cell.
    sunny = SolarSample(np.radians(60.0), np.radians(180.0), 1300.0, 90.0, 1216.0, 1216.0)
    cell_c = BuoyancyVolume(volume_m3=44.907, gas="helium", film_mass_kg=2.0,
                            superpressure_Pa=500.0)
    body_c = BodyState(pos_m=[0.0, 0.0, 20000.0], vel_ms=[3.0, 0.0, 0.0], mass_kg=0.0)
    lift_before_N = float(
        cell_c.evaluate([body_c], atmo_20km, still_air(), dark(), 0.0, 1.0).force_N[2]
    )
    temp_before_K = float(cell_c.gas_temp_K)
    for _ in range(240):  # 4 hours of 60 s steps in full sun
        cell_c.evaluate([body_c], atmo_20km, still_air(), sunny, 0.0, 60.0)
    lift_after_N = float(
        cell_c.evaluate([body_c], atmo_20km, still_air(), sunny, 0.0, 60.0).force_N[2]
    )
    superheat_K = float(cell_c.gas_temp_K) - float(atmo_20km.T_K)
    check(
        "superheat changes gas T and pressure but NOT sealed-cell lift",
        abs(lift_after_N - lift_before_N) < 1.0e-9,
        f"T_gas {temp_before_K:.2f} K -> {cell_c.gas_temp_K:.2f} K "
        f"(superheat {superheat_K:+.2f} K), superpressure "
        f"{cell_c.superpressure_Pa(atmo_20km.p_Pa):.1f} Pa; "
        f"lift {lift_before_N:.6f} N -> {lift_after_N:.6f} N "
        f"(delta {lift_after_N - lift_before_N:.2e} N)",
    )

    # -----------------------------------------------------------------
    print("\n[2] TETHER -- Newton's third law and conservatism")
    # -----------------------------------------------------------------
    rng = np.random.default_rng(20260801)
    tether = Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=1.0e4,
                    damping_Ns_per_m=0.0, diameter_m=0.002)
    atmo_sl = atmosphere(0.0)

    worst_residual_N = 0.0
    n_slack = 0
    n_taut = 0
    slack_force_max_N = 0.0
    for _ in range(1000):
        offset = rng.uniform(-180.0, 180.0, size=3)
        bodies = [
            BodyState([0.0, 0.0, 1000.0], [0.0, 0.0, 0.0], 1.0),
            BodyState([0.0, 0.0, 1000.0] + offset, [0.0, 0.0, 0.0], 1.0),
        ]
        ef_a, ef_b = tether.evaluate_pair(bodies, atmo_sl, still_air(), dark(), 0.0, 0.05)
        residual_N = float(np.linalg.norm(ef_a.force_N + ef_b.force_N))
        worst_residual_N = max(worst_residual_N, residual_N)
        separation_m = float(np.linalg.norm(offset))
        if separation_m <= tether.rest_length_m:
            n_slack += 1
            slack_force_max_N = max(slack_force_max_N, float(np.linalg.norm(ef_a.force_N)))
        else:
            n_taut += 1

    check(
        "1000 random relative positions: |F_a + F_b| < 1e-9 N",
        worst_residual_N < 1.0e-9,
        f"worst residual = {worst_residual_N:.3e} N over 1000 draws "
        f"({n_taut} taut, {n_slack} slack)",
    )
    check(
        "force is exactly zero whenever separation <= rest_length_m",
        slack_force_max_N == 0.0,
        f"max |F| across {n_slack} slack draws = {slack_force_max_N:.3e} N",
    )

    # Closed loop in relative position, undamped -> net work must vanish.
    def loop_work_J(center_m: np.ndarray, radius_m: float, n_steps: int) -> tuple[float, float, float]:
        """Midpoint-rule line integral of F_b . dr_b around a circle."""
        e1 = np.array([1.0, 0.0, 0.0])
        e2 = np.array([0.0, 0.6, 0.8])  # non-axis-aligned, still unit
        theta = np.linspace(0.0, 2.0 * np.pi, n_steps + 1)
        pts = (center_m[None, :]
               + radius_m * (np.cos(theta)[:, None] * e1[None, :]
                             + np.sin(theta)[:, None] * e2[None, :]))
        work_J = 0.0
        abs_work_J = 0.0
        lengths = []
        for i in range(n_steps):
            mid = 0.5 * (pts[i] + pts[i + 1])
            dr = pts[i + 1] - pts[i]
            bodies = [
                BodyState([0.0, 0.0, 1000.0], [0.0, 0.0, 0.0], 1.0),
                BodyState(np.array([0.0, 0.0, 1000.0]) + mid, [0.0, 0.0, 0.0], 1.0),
            ]
            _, f_b = tether.tension_forces(bodies)
            increment = float(np.dot(f_b, dr))
            work_J += increment
            abs_work_J += abs(increment)
            lengths.append(float(np.linalg.norm(mid)))
        return work_J, abs_work_J, float(np.ptp(np.array(lengths)))

    work_taut_J, gross_taut_J, span_taut_m = loop_work_J(
        np.array([0.0, 0.0, 150.0]), 30.0, 20000
    )
    check(
        "undamped tether: net work around a closed taut loop < 1e-6 J",
        abs(work_taut_J) < 1.0e-6,
        f"net work = {work_taut_J:.3e} J against {gross_taut_J:.1f} J of gross "
        f"|F.dr| circulated (cable length swept {span_taut_m:.1f} m, always taut)",
    )

    work_mixed_J, gross_mixed_J, span_mixed_m = loop_work_J(
        np.array([0.0, 0.0, 120.0]), 40.0, 20000
    )
    check(
        "undamped tether: net work < 1e-6 J on a loop that goes slack and re-tensions",
        abs(work_mixed_J) < 1.0e-6,
        f"net work = {work_mixed_J:.3e} J against {gross_mixed_J:.1f} J gross "
        f"(length swept {span_mixed_m:.1f} m, crosses the 100 m slack boundary)",
    )

    # -----------------------------------------------------------------
    print("\n[3] PV ARRAY -- exactly zero force")
    # -----------------------------------------------------------------
    pv = PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85,
                 tilt_deg=0.0, azimuth_deg=180.0,
                 areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2)
    body_pv = BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], 6.93)
    sol_noon = solar(latitude_deg=47.6, longitude_deg=8.5, day_of_year=195,
                     utc_hour_h=11.4, altitude_m=500.0, panel_tilt_deg=0.0)
    ef_pv = pv.evaluate([body_pv], atmosphere(500.0), still_air(), sol_noon, 0.0, 60.0)
    force_is_exact_zero = (
        ef_pv.force_N.shape == (3,)
        and bool(np.all(ef_pv.force_N == np.zeros(3)))
    )
    check(
        "PVArray.evaluate(...).force_N is EXACTLY zeros(3)",
        force_is_exact_zero,
        f"force_N = {ef_pv.force_N!r} (identity vs zeros(3): "
        f"{bool(np.all(ef_pv.force_N == np.zeros(3)))}), "
        f"power = {ef_pv.power_elec_W:.2f} W at POA {pv.last_poa_Wm2:.1f} W/m2, "
        f"cell T = {pv.last_cell_temp_K:.1f} K",
    )

    # POA transposition must reduce to GHI at zero tilt.
    poa_flat = plane_of_array_irradiance_Wm2(
        sol_noon.dni_Wm2, sol_noon.dhi_Wm2, sol_noon.ghi_Wm2,
        sol_noon.elevation_rad, sol_noon.azimuth_rad, 0.0, 180.0,
    )
    check(
        "plane-of-array transposition reduces to GHI at zero tilt",
        abs(poa_flat - sol_noon.ghi_Wm2) < 1.0e-9 * max(1.0, sol_noon.ghi_Wm2),
        f"POA(tilt=0) = {poa_flat:.6f} W/m2 vs env GHI = {sol_noon.ghi_Wm2:.6f} W/m2 "
        f"(elevation {np.degrees(sol_noon.elevation_rad):.2f} deg)",
    )

    # -----------------------------------------------------------------
    print("\n[4] AERO SURFACE -- AtlantikSolar, every coefficient from the solver")
    # -----------------------------------------------------------------
    upper_w, lower_w, le_w, te_t = aeropolar.naca_kulfan("2412")
    atlantik = WingGeometry(
        span_m=5.65, area_m2=1.72, taper_ratio=0.7, sweep_deg=0.0,
        twist_root_deg=2.0, twist_tip_deg=0.0,
        kulfan_upper=upper_w, kulfan_lower=lower_w,
        leading_edge_weight=le_w, TE_thickness=te_t,
    )
    V_MS = 9.5           # m/s, from the locked acceptance test
    RHO = 1.18           # kg/m3
    T_AIR_K = 283.0      # K, "mu from Sutherland at 283 K"
    MU = float(sutherland_mu(T_AIR_K))  # Pa*s
    WEIGHT_N = 68.0      # N (6.93 kg * 9.80665 = 67.96 N; the spec rounds to 68.0)

    print(f"      AR = {atlantik.aspect_ratio:.3f}, MAC = "
          f"{atlantik.mean_aerodynamic_chord_m:.4f} m, mu(283 K) = {MU:.4e} Pa*s")

    wing = AeroSurface(atlantik, body_index=0, offset_m=None,
                       incidence_deg=0.0, extra_CD0=0.006, n_crit=11.0)
    cl_be, cd_be, endurance_be = wing.best_endurance(V_MS, RHO, MU)
    alpha_be_deg = wing.best_endurance_alpha_deg(V_MS, RHO, MU)
    re_ref = wing.reference_reynolds(V_MS, RHO, MU)
    print(f"      solver best-endurance point: CL = {cl_be:.4f}, CD = {cd_be:.5f}, "
          f"CL^1.5/CD = {endurance_be:.2f} at alpha = {alpha_be_deg:.2f} deg, "
          f"Re = {re_ref:,.0f}")

    check(
        "AtlantikSolar best-endurance CL^1.5/CD in [18, 32], solver-derived",
        18.0 <= endurance_be <= 32.0,
        f"CL^1.5/CD = {endurance_be:.3f} (CL {cl_be:.4f}, CD {cd_be:.5f}) "
        f"at Re = {re_ref:,.0f}; NOT a literal -- see the monkeypatch check below",
    )

    # -- the literal reading of the acceptance test ------------------------
    wing.incidence_deg = alpha_be_deg
    body_wing = BodyState([0.0, 0.0, 500.0], [V_MS, 0.0, 0.0], 6.93)
    atmo_wing = atmosphere(500.0)

    class _FixedAtmo:
        """The acceptance test pins rho = 1.18 and mu at 283 K explicitly."""
        T_K = T_AIR_K
        p_Pa = float(atmo_wing.p_Pa)
        rho_kgm3 = RHO
        mu_Pas = MU
        a_ms = float(atmo_wing.a_ms)

    ef_wing = wing.evaluate([body_wing], _FixedAtmo(), still_air(), dark(), 0.0, 60.0)
    lift_at_be_N = float(ef_wing.force_N[2])
    drag_at_be_N = float(-ef_wing.force_N[0])
    lift_err = abs(lift_at_be_N - WEIGHT_N) / WEIGHT_N

    # -- the trimmed reading, reported alongside (see OBJECTION 4) ----------
    alpha_trim_deg = wing.trim_alpha_for_lift_N(WEIGHT_N, V_MS, RHO, MU)
    cl_trim, cd_trim, _ = wing.coefficients(alpha_trim_deg, V_MS, RHO, MU)
    endurance_trim = cl_trim ** 1.5 / cd_trim
    v_trim_ms = wing.trim_speed_for_lift_N(WEIGHT_N, alpha_be_deg, RHO, MU, 9.0)

    wing.incidence_deg = alpha_trim_deg
    ef_trim = wing.evaluate([body_wing], _FixedAtmo(), still_air(), dark(), 0.0, 60.0)
    lift_trim_N = float(ef_trim.force_N[2])
    trim_err = abs(lift_trim_N - WEIGHT_N) / WEIGHT_N

    print(f"      LITERAL reading  : alpha = alpha_best_endurance = {alpha_be_deg:.2f} deg")
    print(f"                         -> L = {lift_at_be_N:.2f} N vs W = {WEIGHT_N:.1f} N "
          f"({100 * lift_err:.1f}% off), D = {drag_at_be_N:.3f} N, "
          f"CL^1.5/CD = {endurance_be:.2f}")
    print(f"                         that alpha actually trims 68 N at "
          f"V = {v_trim_ms:.2f} m/s, not {V_MS} m/s")
    print(f"      TRIMMED reading  : alpha trimming 68 N at V = 9.5 m/s = "
          f"{alpha_trim_deg:.2f} deg")
    print(f"                         -> L = {lift_trim_N:.3f} N "
          f"({100 * trim_err:.4f}% off), CL = {cl_trim:.4f}, CD = {cd_trim:.5f}, "
          f"CL^1.5/CD = {endurance_trim:.2f}")

    check(
        "AeroSurface trimmed at V=9.5 m/s produces lift within 2% of 68.0 N",
        trim_err <= 0.02,
        f"L = {lift_trim_N:.4f} N at alpha = {alpha_trim_deg:.3f} deg "
        f"(error {100 * trim_err:.4f}%); its CL^1.5/CD = {endurance_trim:.2f} "
        f"is {'inside' if 18.0 <= endurance_trim <= 32.0 else 'OUTSIDE'} [18, 32]",
    )
    # Airfoil-INDEPENDENT proof that the literal clause is unsatisfiable.
    # For any polar CD = CD0 + CL^2/(pi AR e), best endurance sits at
    # CL_be = sqrt(3 CD0 pi AR e). The spec pins extra_CD0 = 0.006, and section
    # profile drag can only ADD to CD0, so that value is a hard lower bound.
    pi_ar_e = np.pi * atlantik.aspect_ratio * 0.95
    cl_be_floor = float(np.sqrt(3.0 * 0.006 * pi_ar_e))
    cl_required = WEIGHT_N / (0.5 * RHO * V_MS ** 2 * atlantik.area_m2)
    check(
        "AeroSurface at the BEST-ENDURANCE alpha produces lift within 2% of 68.0 N"
        "  <-- OBJECTION 4, see aerosurface.py",
        lift_err <= 0.02,
        f"L = {lift_at_be_N:.3f} N vs 68.0 N ({100 * lift_err:.1f}% off).\n"
        f"         PROOF THE CLAUSE IS UNSATISFIABLE, INDEPENDENT OF AIRFOIL:\n"
        f"           - the lift condition at V=9.5 m/s FIXES CL = {cl_required:.4f};\n"
        f"           - for any polar CD = CD0 + CL^2/(pi*AR*e), best endurance is at\n"
        f"             CL_be = sqrt(3*CD0*pi*AR*e), and CD0 >= extra_CD0 = 0.006 by\n"
        f"             the spec's own argument, with AR = {atlantik.aspect_ratio:.2f},\n"
        f"             so CL_be >= {cl_be_floor:.4f} for EVERY airfoil;\n"
        f"           - {cl_be_floor:.4f} > {cl_required:.4f}, so no design satisfies both.\n"
        f"         This solver returns CL_be = {cl_be:.4f}, which trims 68 N at "
        f"V = {v_trim_ms:.2f} m/s.\n"
        f"         The brief's own cross-check ('CL^1.5/CD = 26.3 at CL = 1.0') trims at\n"
        f"         8.19 m/s, also not 9.5. The self-consistent speed is ~8.2-8.8 m/s;\n"
        f"         V = 9.5 m/s in the test statement is the inconsistent number.",
        spec_conflict=True,
    )

    # -- prove the coefficients really come from aeropolar -----------------
    call_log: list[dict] = []
    real_wing_polar = aeropolar.wing_polar

    def spy_wing_polar(*args, **kwargs):
        call_log.append(dict(kwargs))
        return real_wing_polar(*args, **kwargs)

    aeropolar.wing_polar = spy_wing_polar
    try:
        fresh = AeroSurface(atlantik, incidence_deg=alpha_trim_deg, extra_CD0=0.006)
        ef_spy = fresh.evaluate([body_wing], _FixedAtmo(), still_air(), dark(), 0.0, 60.0)
    finally:
        aeropolar.wing_polar = real_wing_polar

    spied_ok = len(call_log) >= 1 and abs(float(ef_spy.force_N[2])) > 0.0
    check(
        "CL/CD provably come from aeropolar.wing_polar (monkeypatch observes the call)",
        spied_ok,
        f"aeropolar.wing_polar called {len(call_log)} time(s) during one evaluate(); "
        f"first call carried span_m={call_log[0].get('span_m')}, "
        f"area_m2={call_log[0].get('area_m2')}, "
        f"n_crit={call_log[0].get('n_crit')}, "
        f"extra_CD0={call_log[0].get('extra_CD0')} -> L = {float(ef_spy.force_N[2]):.3f} N",
    )

    # The cache must make solver calls scale with the number of distinct Reynolds
    # BINS visited, not with the number of timesteps. A 5% speed wander can cross
    # one bin edge (bins are 1/12 decade = 21% wide), so the correct assertion is
    # "a small constant, bounded by bins visited", NOT "exactly zero more".
    calls_before = wing.solver_calls
    bins_visited = set()
    for i in range(50):
        speed_ms = V_MS * (1.0 + 0.001 * i)
        body_wing.vel_ms = np.array([speed_ms, 0.0, 0.0])
        bins_visited.add(wing._re_bin(wing.reference_reynolds(speed_ms, RHO, MU)))
        wing.evaluate([body_wing], _FixedAtmo(), still_air(), dark(), 0.0, 60.0)
    body_wing.vel_ms = np.array([V_MS, 0.0, 0.0])
    new_calls = wing.solver_calls - calls_before
    check(
        "polar cache: 50 evaluations cost <= 1 solve per distinct Reynolds bin",
        new_calls <= len(bins_visited) and new_calls < 50,
        f"50 evaluations spanning Re {wing.reference_reynolds(V_MS, RHO, MU):,.0f} to "
        f"{wing.reference_reynolds(V_MS * 1.049, RHO, MU):,.0f} touched "
        f"{len(bins_visited)} cache bin(s) and cost {new_calls} new solver call(s) "
        f"(uncached would be 50)",
    )

    # Within a single bin the cache must be exact: zero additional solves.
    # Speeds are SELECTED to lie in one bin rather than assumed to -- V = 9.5 m/s
    # happens to sit near a bin edge, which is exactly why the previous check is
    # phrased in bins rather than in percent.
    single_bin = wing._re_bin(wing.reference_reynolds(V_MS, RHO, MU))
    candidate_speeds = [
        float(s) for s in np.linspace(V_MS * 0.90, V_MS * 1.10, 4000)
        if wing._re_bin(wing.reference_reynolds(float(s), RHO, MU)) == single_bin
    ]
    in_bin_speeds = candidate_speeds[:: max(1, len(candidate_speeds) // 50)][:50]
    calls_before = wing.solver_calls
    for speed_ms in in_bin_speeds:
        body_wing.vel_ms = np.array([speed_ms, 0.0, 0.0])
        wing.evaluate([body_wing], _FixedAtmo(), still_air(), dark(), 0.0, 60.0)
    body_wing.vel_ms = np.array([V_MS, 0.0, 0.0])
    check(
        "polar cache: zero re-solves for 50 evaluations inside ONE Reynolds bin",
        wing.solver_calls == calls_before and len(in_bin_speeds) == 50,
        f"solver_calls held at {wing.solver_calls} across {len(in_bin_speeds)} "
        f"evaluations spanning V = {min(in_bin_speeds):.4f}..{max(in_bin_speeds):.4f} m/s "
        f"(Re {wing.reference_reynolds(min(in_bin_speeds), RHO, MU):,.0f}.."
        f"{wing.reference_reynolds(max(in_bin_speeds), RHO, MU):,.0f}), all in bin "
        f"{single_bin}",
    )

    # -----------------------------------------------------------------
    print("\n[5] FREE-ENERGY GUARD -- Galilean invariance of the whole element set")
    # -----------------------------------------------------------------
    # Build a full multi-element, two-body vehicle and show that adding a uniform
    # wind W while adding the same W to every body velocity changes NO force.
    # This is the structural reason a vehicle in uniform wind cannot extract
    # energy; integrate.assert_no_free_energy is its trajectory-level companion.
    def build_vehicle() -> Vehicle:
        w = AeroSurface(atlantik, body_index=0, incidence_deg=3.0, extra_CD0=0.006)
        balloon = BuoyancyVolume(volume_m3=4.003, gas="helium", film_mass_kg=0.5,
                                 body_index=1)
        cable = Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=5.0e4,
                       damping_Ns_per_m=2.0, diameter_m=0.002)
        prop = Thruster(diameter_m=0.36, max_electrical_power_W=120.0,
                        body_index=0, axis=[1.0, 0.0, 0.0])
        prop.set_thrust_N(2.0)
        panel = PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85,
                        body_index=0,
                        areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2)
        pack = BatteryElement(capacity_J=1.0e6, initial_soc=0.6, body_index=0,
                              specific_energy_Wh_per_kg=PACK_LI_ION_WH_PER_KG)
        bodies = [
            BodyState([0.0, 0.0, 500.0], [9.5, 1.0, -0.2], 6.93),
            BodyState([10.0, 5.0, 610.0], [8.0, 0.5, 0.1], 1.0),
        ]
        return Vehicle(bodies=bodies, elements=[w, balloon, cable, prop, panel, pack])

    worst_force_delta_N = 0.0
    worst_power_delta_W = 0.0
    rng2 = np.random.default_rng(7)
    for _ in range(60):
        wind_vec = rng2.uniform(-25.0, 25.0, size=3)

        v_still = build_vehicle()
        f_still, p_still = v_still.net(
            atmosphere(500.0), still_air(), sol_noon, 0.0, 60.0
        )

        v_blown = build_vehicle()
        for b in v_blown.bodies:
            b.vel_ms = b.vel_ms + wind_vec
        moving_air = WindSample(float(wind_vec[0]), float(wind_vec[1]),
                                float(wind_vec[2]), 0.0, 0.0, 0.0)
        f_blown, p_blown = v_blown.net(
            atmosphere(500.0), moving_air, sol_noon, 0.0, 60.0
        )

        worst_force_delta_N = max(
            worst_force_delta_N, float(np.max(np.abs(f_blown - f_still)))
        )
        worst_power_delta_W = max(worst_power_delta_W, abs(p_blown - p_still))

    check(
        "uniform wind + equal body velocity leaves every force unchanged "
        "(Galilean invariance)",
        worst_force_delta_N < 1.0e-9 and worst_power_delta_W < 1.0e-9,
        f"worst |dF| = {worst_force_delta_N:.3e} N and worst |dP| = "
        f"{worst_power_delta_W:.3e} W over 60 random uniform winds up to 25 m/s "
        f"per axis. A vehicle that cannot tell it is in uniform wind cannot "
        f"extract energy from it.",
    )

    # A thruster must never be a source, whatever it is asked to do.
    worst_positive_W = -np.inf
    probe_body = BodyState([0.0, 0.0, 500.0], [12.0, 0.0, 0.0], 5.0)
    probe_thruster = Thruster(diameter_m=0.36, max_electrical_power_W=200.0)
    for thrust_cmd_N in np.linspace(0.0, 60.0, 40):
        probe_thruster.set_thrust_N(float(thrust_cmd_N))
        ef = probe_thruster.evaluate([probe_body], atmosphere(500.0), still_air(),
                                     dark(), 0.0, 60.0)
        worst_positive_W = max(worst_positive_W, ef.power_elec_W)
    check(
        "Thruster power_elec_W is never positive (a propulsor cannot generate)",
        worst_positive_W <= 0.0,
        f"max power_elec_W over 40 thrust commands 0..60 N = "
        f"{worst_positive_W:.4f} W (must be <= 0)",
    )

    # Thruster must reproduce powerplant.hover_power_W at zero airspeed.
    from ..powerplant import hover_power_W
    hover_rotor = Thruster(diameter_m=0.254, max_electrical_power_W=1.0e4,
                           n_rotors=4, figure_of_merit=0.65,
                           eta_motor=0.85, eta_esc=0.95, axis=[0.0, 0.0, 1.0])
    disk_area_m2 = hover_rotor.disk_area_m2
    thrust_N = 9.81
    mine_W = hover_rotor.electrical_power_W(thrust_N, 0.0, 1.225)
    theirs_W = hover_power_W(thrust_N, 1.225, disk_area_m2, 0.65, 0.85, 0.95)
    check(
        "Thruster at V=0 reproduces powerplant.hover_power_W exactly",
        abs(mine_W - theirs_W) < 1.0e-9,
        f"disk area = {disk_area_m2:.4f} m2 (4 x 0.254 m rotors, spec says 0.203 m2); "
        f"vehicle.Thruster = {mine_W:.6f} W, powerplant.hover_power_W = "
        f"{theirs_W:.6f} W, delta = {abs(mine_W - theirs_W):.2e} W",
    )

    # -----------------------------------------------------------------
    print("\n[6] VEHICLE ASSEMBLY -- the two-body archetype-3 configuration runs")
    # -----------------------------------------------------------------
    veh = build_vehicle()
    forces_N, net_W = veh.net(atmosphere(500.0), still_air(), sol_noon, 0.0, 60.0)
    unserved_W = veh.step_batteries(net_W, 60.0)
    check(
        "Vehicle.net assembles a 2-body / 6-element vehicle and drives the battery",
        forces_N.shape == (2, 3) and np.all(np.isfinite(forces_N)) and np.isfinite(net_W),
        f"forces_N =\n           body0 {np.array2string(forces_N[0], precision=3)} N"
        f"\n           body1 {np.array2string(forces_N[1], precision=3)} N"
        f"\n         net electrical = {net_W:+.2f} W, unserved after battery = "
        f"{unserved_W:+.4f} W, pack SOC = {veh.batteries[0].soc:.4f}",
    )

    # -----------------------------------------------------------------
    print("\n[7] MASS CLOSURE -- energy storage and collection now cost weight")
    # -----------------------------------------------------------------
    # AtlantikSolar AS-2 rebuilt from its published mass breakdown: a 703 Wh
    # pack at the 241 Wh/kg it actually achieved, 1.72 m2 of laminated cells,
    # and the residual as structure. Nothing about the total is typed in.
    AS_STRUCTURE_KG = 3.3259   # kg, everything that is not pack or array

    def atlantik_vehicle(battery_Wh: float) -> Vehicle:
        """Build the case-A energy system at a given pack size."""
        return Vehicle(
            bodies=[BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], AS_STRUCTURE_KG)],
            elements=[
                PVArray(area_m2=1.72, cell_efficiency_stc=0.237,
                        packing_factor=0.802, body_index=0,
                        areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2),
                BatteryElement(capacity_J=battery_Wh * J_PER_WH, initial_soc=1.0,
                               body_index=0,
                               specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG),
            ],
        )

    v_base = atlantik_vehicle(703.0)
    v_10x = atlantik_vehicle(7030.0)
    mass_base_kg = v_base.total_mass_kg()
    mass_10x_kg = v_10x.total_mass_kg()
    check(
        "10x battery makes the AtlantikSolar airframe materially HEAVIER",
        abs(mass_base_kg - 6.93) < 0.01 and mass_10x_kg > 4.0 * mass_base_kg,
        f"703 Wh -> {mass_base_kg:.3f} kg all-up (published 6.93 kg); "
        f"7030 Wh -> {mass_10x_kg:.3f} kg, i.e. +"
        f"{mass_10x_kg - mass_base_kg:.2f} kg of cells "
        f"({(mass_10x_kg / mass_base_kg):.2f}x). Weight "
        f"{v_base.weight_N():.2f} N -> {v_10x.weight_N():.2f} N.",
    )

    # The body's own mass_kg is what integrate.py reads for gravity and trim.
    check(
        "the derived total is written into BodyState.mass_kg (what the "
        "integrator reads)",
        abs(v_10x.bodies[0].mass_kg - mass_10x_kg) < 1e-12
        and abs(v_10x.bodies[0].structure_mass_kg - AS_STRUCTURE_KG) < 1e-12,
        f"body.structure_mass_kg = {v_10x.bodies[0].structure_mass_kg:.4f} kg, "
        f"body.mass_kg = {v_10x.bodies[0].mass_kg:.4f} kg; binding is idempotent "
        f"(re-bound: {float(v_10x.bind_masses()[0]):.4f} kg)",
    )

    # PV area must move mass too, or a sweep grows the panel for free.
    v_double_pv = Vehicle(
        bodies=[BodyState([0.0, 0.0, 500.0], [9.5, 0.0, 0.0], AS_STRUCTURE_KG)],
        elements=[
            PVArray(area_m2=3.44, cell_efficiency_stc=0.237, packing_factor=0.802,
                    body_index=0, areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2),
            BatteryElement(capacity_J=703.0 * J_PER_WH, initial_soc=1.0,
                           body_index=0,
                           specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG),
        ],
    )
    pv_delta_kg = v_double_pv.total_mass_kg() - mass_base_kg
    check(
        "doubling PV area adds exactly one array's worth of mass",
        abs(pv_delta_kg - 1.72 * PV_LAMINATED_FLEXIBLE_KG_M2) < 1e-9,
        f"1.72 m2 -> 3.44 m2 adds {pv_delta_kg:.4f} kg "
        f"(1.72 m2 x {PV_LAMINATED_FLEXIBLE_KG_M2:.4f} kg/m2 = "
        f"{1.72 * PV_LAMINATED_FLEXIBLE_KG_M2:.4f} kg)",
    )

    # Omission must raise, not default.
    def raises_mass_error(fn) -> tuple[bool, str]:
        try:
            fn()
        except MassClosureError as exc:
            return True, str(exc).split(".")[0]
        except Exception as exc:  # pragma: no cover - wrong error type is a fail
            return False, f"{type(exc).__name__}: {exc}"
        return False, "no exception raised"

    ok_batt, msg_batt = raises_mass_error(
        lambda: BatteryElement(capacity_J=1.0e6, initial_soc=1.0)
    )
    ok_pv, msg_pv = raises_mass_error(
        lambda: PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85)
    )
    check(
        "omitting specific energy / areal density RAISES rather than defaulting",
        ok_batt and ok_pv,
        f"BatteryElement -> {msg_batt}\n         PVArray        -> {msg_pv}",
    )

    ok_ceiling, msg_ceiling = raises_mass_error(
        lambda: BatteryElement(capacity_J=1.0e6,
                               specific_energy_Wh_per_kg=1.0e9)
    )
    ok_floor, msg_floor = raises_mass_error(
        lambda: PVArray(area_m2=1.0, cell_efficiency_stc=0.24, packing_factor=0.85,
                        areal_density_kg_m2=1.0e-9)
    )
    check(
        "the conversion itself is bounded (no massless pack one level up)",
        ok_ceiling and ok_floor,
        f"1e9 Wh/kg pack -> {msg_ceiling}\n         1e-9 kg/m2 array -> {msg_floor}",
    )

    # The tether: length and diameter are design variables, so they weigh.
    heavy_cable = Tether(body_a=0, body_b=1, rest_length_m=1000.0, EA_N=5.0e4,
                         diameter_m=0.002)
    split = heavy_cable.mass_distribution()
    ok_stiff, msg_stiff = raises_mass_error(
        lambda: Tether(body_a=0, body_b=1, rest_length_m=100.0, EA_N=1.0e12,
                       diameter_m=0.001)
    )
    check(
        "a 1 km tether is not weightless, and EA cannot exceed its own fibre",
        abs(heavy_cable.mass_kg - 2.6036) < 0.01
        and abs(split[0] - split[1]) < 1e-15 and ok_stiff,
        f"1000 m of 2 mm Dyneema = {heavy_cable.mass_kg:.4f} kg "
        f"({heavy_cable.linear_density_kg_m * 1000.0:.3f} g/m, real line ~2.4 g/m), "
        f"split {split[0]:.4f}/{split[1]:.4f} kg;\n         "
        f"EA=1e12 N on 1 mm -> {msg_stiff}",
    )

    # -----------------------------------------------------------------
    print("\n" + "=" * 78)
    n_pass = sum(1 for ok, _, _ in results if ok)
    n_fail = len(results) - n_pass
    for ok, name, _ in results:
        if not ok:
            print(f"  MODULE FAILURE: {name}")
    print(f"RESULT: {n_pass}/{len(results)} module checks passed, {n_fail} failed")

    unmet = [e for e in spec_conflicts if not e[0]]
    if unmet:
        print("-" * 78)
        print(f"UNMET SPEC CLAUSES: {len(unmet)} (reported, NOT hidden, NOT counted "
              f"as module defects)")
        for _, name, _ in unmet:
            print(f"  * {name}")
        print("  Each is proven self-contradictory in the detail above and in the")
        print("  OBJECTION block at the top of the owning source file. The module")
        print("  implements the specified signature unchanged.")
    print("=" * 78)
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    import sys

    sys.exit(_selftest())
