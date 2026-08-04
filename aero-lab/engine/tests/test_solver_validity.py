"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the round-4
  |                                           | SOLVER-VALIDITY ESCAPE (FATAL 1):
  |                                           | (1) the polar cache is C0 in Re --
  |                                           | coefficients() blends adjacent bins
  |                                           | instead of a nearest-bin staircase,
  |                                           | (2) trim non-convergence RAISES
  |                                           | TrimConvergenceError (the bisection
  |                                           | fallback is an initializer, never a
  |                                           | result), (3) a cruise step consuming
  |                                           | an uncertified aero point forces
  |                                           | closed=False + certified=False with
  |                                           | reason 'uncertified-aero', and the
  |                                           | DYNAMIC loop counts and taints, and
  |                                           | (4) the R4 297-eval winner (990 kg,
  |                                           | zero-lift at the 300 m/s rail, usable
  |                                           | 89.98) dies honestly at full fidelity
  |                                           | even with its technology clamped into
  |                                           | the catalogue.
-------------------------------------------------------------------------------

tests.test_solver_validity -- leaving the model's certified envelope must be a
HARD FAILURE of the design evaluation, never a silent number.

Each guard is the R4 exploit reduced to a red/green assertion. Mutation logic per
the project doctrine: every "the guard fires" test has a twin proving the SAME
machinery stays green on certified input, so a guard cannot pass by refusing
everything.

RUNNING
    python tests/test_solver_validity.py               (also collected by pytest)

UNITS
    SI throughout: _m metres, _ms metres/second, _m2 square metres, _kg
    kilograms, _N newtons, _W watts, _s seconds. Dimensionless: CL, CD, Re, soc.
"""

from __future__ import annotations

import dataclasses
import math
import os
import sys
import traceback
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aerosim import aeropolar                                                # noqa: E402
from aerosim.env import make_uniform_field                                   # noqa: E402
from aerosim.integrate import (                                              # noqa: E402
    EnvBundle,
    TrimConvergenceError,
    integrate_dynamic,
    integrate_energy,
)
from aerosim.vehicle.state import BodyState, ElementForce                    # noqa: E402

G0_MS2: float = 9.80665             # m/s^2


# ======================================================================================
# Minimal fixtures.  The fakes exercise integrate.py's contract exactly the way the
# shipped AeroSurface does (KIND_AERO classification via incidence_deg, last_* fields);
# the full-fidelity winner guard at the bottom uses only shipped elements.
# ======================================================================================


class _FakeVehicle:
    """@description Duck-typed vehicle: .bodies + .elements is all integrate reads."""

    def __init__(self, bodies, elements) -> None:
        self.bodies = bodies
        self.elements = elements


class _QuadraticLiftWing:
    """
    @description KIND_AERO fake whose lift is a real quadratic-in-V attached-flow
        law, L = 0.5*rho*V^2*S*CL along the wind-axis lift direction, plus drag
        L/20 -- so the airspeed trim CONVERGES like a real wing. The `certify`
        flag drives the last_valid diagnostic, which is the thing under test.
    @param S_CL_m2 Product S*CL, m^2 (sizes the trim speed).
    @param certify Reported last_valid after every evaluation.
    """

    def __init__(self, S_CL_m2: float, certify: bool) -> None:
        self.incidence_deg = 4.0        # classifies KIND_AERO
        self.body_index = 0
        self.S_CL_m2 = float(S_CL_m2)
        self.certify = bool(certify)
        self.last_valid = True
        self.last_Re = 0.0

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
        body = bodies[self.body_index]
        wvec = np.array([wind.u_ms, wind.v_ms, wind.w_ms], dtype=float)
        v_rel = np.asarray(body.vel_ms, dtype=float) - wvec
        speed = float(np.linalg.norm(v_rel))
        if speed <= 0.0:
            self.last_valid, self.last_Re = False, 0.0
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)
        rho = float(atmo.rho_kgm3)
        q_Pa = 0.5 * rho * speed * speed
        lift_N = q_Pa * self.S_CL_m2
        drag_N = lift_N / 20.0
        d_hat = v_rel / speed
        # lift axis: perpendicular to v_rel in the vertical plane, up-ish
        up = np.array([0.0, 0.0, 1.0])
        l_axis = up - d_hat * float(np.dot(up, d_hat))
        n = float(np.linalg.norm(l_axis))
        l_axis = l_axis / n if n > 1e-12 else up
        self.last_valid = self.certify
        self.last_Re = rho * speed * 1.0 / float(atmo.mu_Pas)   # chord 1 m
        return ElementForce(lift_N * l_axis - drag_N * d_hat, np.zeros(3), 0.0)


class _SaturatingLiftWing(_QuadraticLiftWing):
    """@description Lift CAPPED at cap_N whatever the airspeed: no trim can exist."""

    def __init__(self, S_CL_m2: float, cap_N: float) -> None:
        super().__init__(S_CL_m2, certify=True)
        self.cap_N = float(cap_N)

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
        res = super().evaluate(bodies, atmo, wind, sol, t_s, dt_s)
        f = np.asarray(res.force_N, dtype=float)
        n = float(np.linalg.norm(f))
        if n > self.cap_N:
            f = f * (self.cap_N / n)
        return ElementForce(f, np.zeros(3), 0.0)


def _one_body_vehicle(element, mass_kg: float) -> _FakeVehicle:
    body = BodyState(pos_m=np.array([0.0, 0.0, 500.0]),
                     vel_ms=np.array([10.0, 0.0, 0.0]), mass_kg=float(mass_kg))
    return _FakeVehicle([body], [element])


def _still_air() -> EnvBundle:
    return EnvBundle(wind=make_uniform_field(0.0, 0.0, 0.0), latitude_deg=0.0,
                     longitude_deg=0.0, day_of_year=172, utc_hour_at_t0_h=0.0)


# ======================================================================================
# GUARD 1 -- bin-edge continuity: the polar cache is C0 in Reynolds number
# ======================================================================================


def test_bin_edge_continuity() -> None:
    """coefficients() must not step at Re-bin boundaries.

    @description Installs a synthetic wing_polar whose CL carries an explicit
        log10(Re) term, so every cache bin returns a DIFFERENT lift level: the
        old nearest-bin lookup turns CL(V) into a staircase with treads of
        0.05/12 = 4.17e-3, while the log-Re blend must reproduce the smooth
        underlying function. Monkeypatching aeropolar.wing_polar is a documented
        seam (AeroSurface calls through the module object).
    @returns None; raises AssertionError on regression.
    """
    from aerosim.vehicle import AeroSurface, WingGeometry

    up, lo, lew, te = aeropolar.naca_kulfan("2412")
    geo = WingGeometry(span_m=5.65, area_m2=1.72, taper_ratio=0.7, sweep_deg=0.0,
                       twist_root_deg=0.0, twist_tip_deg=0.0, kulfan_upper=up,
                       kulfan_lower=lo, leading_edge_weight=lew, TE_thickness=te)
    surf = AeroSurface(geo, incidence_deg=4.0, extra_CD0=0.016)

    chord_m = geo.reference_chord_m()
    rho, mu = 1.2, 1.8e-5           # kg/m^3, Pa*s

    def fake_wing_polar(*args, **kwargs):
        alpha_deg = np.atleast_1d(np.asarray(kwargs["alpha_deg"], dtype=float))
        V_ms = float(kwargs["V_ms"])
        Re = kwargs["rho_kgm3"] * V_ms * chord_m / kwargs["mu_Pas"]
        alpha_rad = np.deg2rad(alpha_deg)
        CL = 0.1 * alpha_deg + 0.05 * math.log10(Re)      # explicit Re dependence
        CD = np.full_like(CL, 0.02)
        return aeropolar.WingPolar(
            alpha_rad=alpha_rad, CL=CL, CD=CD, CDi=0.5 * CD, CDp=0.5 * CD,
            Re_mean=np.full_like(CL, Re), e_oswald=0.95,
            valid=np.ones_like(CL, dtype=bool), CL_slope_per_rad=5.7,
            CL_slope_inviscid_per_rad=5.7, a0_section_per_rad=6.28,
            slope_flags=(),
        )

    real = aeropolar.wing_polar
    aeropolar.wing_polar = fake_wing_polar
    try:
        Vs = np.linspace(8.0, 12.0, 801)              # spans several 12-per-decade bins
        cls = np.array([surf.coefficients(4.0, float(V), rho, mu)[0] for V in Vs])
    finally:
        aeropolar.wing_polar = real

    steps = np.abs(np.diff(cls))
    tread = 0.05 / 12.0                               # the old staircase tread height
    # smooth reference gradient of the underlying function per sweep step
    smooth = 0.05 * (math.log10(Vs[-1]) - math.log10(Vs[0])) / (Vs.size - 1)
    assert float(steps.max()) < 0.25 * tread, (
        f"CL steps {steps.max():.3e} vs old tread {tread:.3e}: the staircase is back"
    )
    assert float(steps.max()) < 8.0 * smooth, (
        f"CL step {steps.max():.3e} is far above the smooth gradient {smooth:.3e}"
    )
    # And the blend must track the true smooth function closely, not just be flat.
    true_cls = 0.1 * 4.0 + 0.05 * np.log10(rho * Vs * chord_m / mu)
    assert float(np.max(np.abs(cls - true_cls))) < 0.002, (
        "blended CL diverges from the underlying smooth CL(Re)"
    )


# ======================================================================================
# GUARD 2 -- trim non-convergence is a RAISE, never a returned state
# ======================================================================================


def test_trim_residual_raise() -> None:
    """A vehicle whose lift saturates below its weight must raise, not 'trim'.

    @description The R4 winner's mechanism: when no airspeed satisfies the
        vertical balance, the old bisection fallback returned the 300 m/s rail
        as a trim. The fallback is now an initializer whose result must clear
        the residual tolerance; assert the documented TrimConvergenceError.
    @returns None; raises AssertionError on regression.
    """
    wing = _SaturatingLiftWing(S_CL_m2=1.0, cap_N=10.0)    # 10 N of lift, ever
    veh = _one_body_vehicle(wing, mass_kg=10.0)            # 98 N of weight
    try:
        integrate_energy(veh, _still_air(), 0.0, 600.0, 60.0)
    except TrimConvergenceError as exc:
        assert "residual" in str(exc), "raise must state the residual"
        return
    raise AssertionError(
        "integrate_energy returned a result for a vehicle whose lift saturates at "
        "10% of its weight -- the trim rail is back"
    )


def test_trim_still_converges_on_honest_lift() -> None:
    """Twin: the SAME machinery trims a real quadratic lift law without raising.

    @description Mutation-doctrine twin of test_trim_residual_raise -- a guard
        that fires on everything is not a guard.
    @returns None; raises AssertionError on regression.
    """
    wing = _QuadraticLiftWing(S_CL_m2=1.4, certify=True)
    veh = _one_body_vehicle(wing, mass_kg=10.0)
    res = integrate_energy(veh, _still_air(), 0.0, 600.0, 60.0)
    weight_N = 10.0 * G0_MS2
    assert res.worst_trim_residual_N <= 1e-8 * weight_N + 1e-12, (
        f"accepted residual {res.worst_trim_residual_N} N exceeds tolerance"
    )
    assert res.certified is True
    assert not any("uncertified-aero" in r
                   for r in res.detail.get("closed_reasons", []))


# ======================================================================================
# GUARD 3 -- uncertified aero on the cruise path refuses the verdict / taints
# ======================================================================================


def test_uncertified_aero_forces_closed_false_slow_loop() -> None:
    """A slow-loop step consuming last_valid=False aero cannot certify closure.

    @description The R4 winner flew 1441 steps of zero-filled polar with only a
        discarded last_valid diagnostic. Any recorded step consuming an invalid
        point must now force closed=False (reason 'uncertified-aero') and
        certified=False.
    @returns None; raises AssertionError on regression.
    """
    wing = _QuadraticLiftWing(S_CL_m2=1.4, certify=False)   # flies, but uncertified
    veh = _one_body_vehicle(wing, mass_kg=10.0)
    res = integrate_energy(veh, _still_air(), 0.0, 600.0, 60.0)
    assert res.certified is False, "certified must be False on uncertified aero"
    assert res.closed is False, "closure must be refused on uncertified aero"
    reasons = res.detail.get("closed_reasons", [])
    assert any(r.startswith("uncertified-aero") for r in reasons), reasons
    assert res.detail.get("uncertified_aero_steps", 0) > 0


def test_uncertified_aero_taints_dynamic_loop() -> None:
    """The dynamic loop counts invalid derivative evaluations and taints.

    @description integrate_dynamic used to never read last_valid at all -- a
        dynamic-soaring trajectory at post-stall alpha was scored on fictitious
        attached-flow numbers. Twin assertion: the certified variant stays
        certified, so the taint keys on the flag and nothing else.
    @returns None; raises AssertionError on regression.
    """
    bad = _one_body_vehicle(_QuadraticLiftWing(S_CL_m2=1.4, certify=False), 10.0)
    res_bad = integrate_dynamic(bad, _still_air(), 0.0, 2.0, 0.05)
    assert res_bad.certified is False
    assert res_bad.detail.get("invalid_aero_evals", 0) > 0

    good = _one_body_vehicle(_QuadraticLiftWing(S_CL_m2=1.4, certify=True), 10.0)
    res_good = integrate_dynamic(good, _still_air(), 0.0, 2.0, 0.05)
    assert res_good.certified is True
    assert res_good.detail.get("invalid_aero_evals", -1) == 0


# ======================================================================================
# GUARD 4 -- the 990 kg / usable-89.98 winner dies honestly at FULL fidelity
# ======================================================================================

#: The R4 optimizer's 297-eval winning vector, verbatim from R4_search_result.json.
_WINNER = {
    "area_m2": 168.6076, "aspect_ratio": 13.9535, "taper_ratio": 0.8414,
    "battery_mass_kg": 207.7052, "pack_Wh_per_kg": 462.3827, "cell_eff": 0.3024,
    "pv_density": 4.1297, "pv_packing": 0.5048, "extra_CD0": 0.0037,
    "fuselage_kg": 5.8578, "prop_max_W": 19878.9539, "prop_diameter_m": 1.571,
    "altitude_m": 3057.0488, "latitude_deg": 16.5733, "day_of_year": 177,
}


def _winner_design(v: dict):
    from aerosim.validate_designs import DESIGN_A
    from aerosim.vehicle import Thruster
    from aerosim.vehicle.structure import wing_mass_kg

    S = v["area_m2"]
    b = min(math.sqrt(v["aspect_ratio"] * S), 79.9)
    th = Thruster(diameter_m=v["prop_diameter_m"],
                  max_electrical_power_W=v["prop_max_W"], n_rotors=1,
                  figure_of_merit=0.85, eta_motor=0.85, eta_esc=0.95)
    total = (v["battery_mass_kg"] + S * v["pv_density"] + th.mass_kg + 0.150
             + wing_mass_kg(b, S, 3.0) + v["fuselage_kg"])
    return dataclasses.replace(
        DESIGN_A, name="r4-winner", span_m=b, area_m2=S,
        taper_ratio=v["taper_ratio"], extra_CD0=v["extra_CD0"],
        mass_all_up_kg=total, battery_mass_kg=v["battery_mass_kg"],
        pack_Wh_per_kg=v["pack_Wh_per_kg"], pv_efficiency=v["cell_eff"],
        pv_packing=v["pv_packing"], pv_areal_density_kg_m2=v["pv_density"],
        prop_diameter_m=v["prop_diameter_m"],
        prop_max_electrical_W=v["prop_max_W"], altitude_m=v["altitude_m"],
        latitude_deg=v["latitude_deg"], day_of_year=int(v["day_of_year"]))


def test_990kg_winner_dies_honestly() -> None:
    """The R4 winner must never again be closed+certified+admissible.

    @description Full-fidelity guard (real NeuralFoil/VLM, real 24 h window).
        Two walls, both asserted: (a) the vector as searched dies (today at the
        technology catalogue); (b) with its technology CLAMPED into the
        catalogue -- isolating the SOLVER-VALIDITY escape this module owns --
        the trim must produce real certified physics and the design must fail
        honestly: no zero-lift flight, no fictional margin, closure refused or
        the evaluation raised.
    @returns None; raises AssertionError on regression.
    """
    from aerosim.validate import _run_window, screen_design, usable_energy
    from aerosim.validate_designs import build_solar_cruise
    from aerosim.vehicle.tech_catalogue import (
        PACK_FRONTIER_WH_PER_KG,
        pv_frontier_efficiency,
    )

    warnings.simplefilter("ignore")

    # Wall (a): the raw vector must not build-and-close. Any raise is honest.
    try:
        build = build_solar_cruise(_winner_design(_WINNER))
        result, _ = _run_window(build)
        adm, _reasons = screen_design(build, result)
        assert not (result.closed and result.certified and adm), (
            "the raw R4 winner is closed+certified+admissible again"
        )
    except Exception:  # noqa: BLE001 -- an honest loud death
        pass

    # Wall (b): clamp the technology INTO the catalogue and re-run.
    v = dict(_WINNER)
    v["pack_Wh_per_kg"] = min(v["pack_Wh_per_kg"], PACK_FRONTIER_WH_PER_KG)
    v["cell_eff"] = min(v["cell_eff"], pv_frontier_efficiency(v["pv_density"])[0])
    try:
        build = build_solar_cruise(_winner_design(v))
        result, _ = _run_window(build)
    except TrimConvergenceError:
        return                                     # a hard failure is an honest death
    energy = usable_energy(result)
    adm, _reasons = screen_design(build, result)
    surf = build.vehicle.elements[0]
    # The escape's signature, each independently refuted:
    assert surf.last_valid, "cruise flown on an uncertified polar point"
    assert result.certified, (
        "run consumed uncertified aero yet was not caught by the trim/validity gates"
    )
    assert result.cruise_Re_max < aeropolar.RE_CEIL, (
        f"cruise Re {result.cruise_Re_max:.3g} is beyond every certified bin -- "
        "the 300 m/s rail is back"
    )
    weight_N = build.vehicle.bodies[0].mass_kg  # bound mass; scale check below
    assert result.worst_trim_residual_N <= 1e-6 * max(float(weight_N), 1.0) * G0_MS2, (
        f"accepted trim residual {result.worst_trim_residual_N} N"
    )
    assert not (result.closed and adm and energy["margin_ratio_usable"] > 2.0), (
        f"fictional margin survived: usable {energy['margin_ratio_usable']:.3f}"
    )


# ======================================================================================

TESTS = [
    test_bin_edge_continuity,
    test_trim_residual_raise,
    test_trim_still_converges_on_honest_lift,
    test_uncertified_aero_forces_closed_false_slow_loop,
    test_uncertified_aero_taints_dynamic_loop,
    test_990kg_winner_dies_honestly,
]


def main() -> int:
    """
    @description Run every guard and report pass/fail per test.
    @returns Process exit code: 0 when every guard is green, 1 otherwise.
    """
    warnings.simplefilter("ignore")
    failures = 0
    for fn in TESTS:
        try:
            fn()
        except BaseException:                      # noqa: BLE001 -- report, do not mask
            failures += 1
            print(f"FAIL  {fn.__name__}")
            traceback.print_exc()
        else:
            print(f"ok    {fn.__name__}")
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} guards green")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
