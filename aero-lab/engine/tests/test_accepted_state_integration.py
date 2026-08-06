"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for accepted-state
  |                                           | integration: buoyant trim probes cannot
  |                                           | consume thermal/permeation time, the real
  |                                           | f=0.2/0.4/0.6/0.8 boundary converges at
  |                                           | the unchanged 1e-8 force tolerance, the
  |                                           | current 4.4-4.5 m/s polar brackets certify
  |                                           | the Floater incidence, and a 72 h cold
  |                                           | mission advances real pack thermal state
  |                                           | once per accepted step and bills its heater.
2 | maintainer@emeraldcoastsystemsgroup.com   | Extend the 72 h guard through the electrical
  |                                           | authority: BatteryElement.step is called once
  |                                           | per accepted interval, the mission exposes the
  |                                           | PackEcm authority, and returned SOC is the live
  |                                           | pack state rather than a flat replay.
-------------------------------------------------------------------------------

tests.test_accepted_state_integration -- numerical probes are not physical time.

The trim root solver and RK4 stages may evaluate a state many times before one step is
accepted. Stateful elements must therefore see dt=0 on those probes and exactly one real dt
at the accepted midpoint. These tests use the shipped Floater builder, AeroSurface,
BuoyancyVolume, BatteryElement, PackEcm and mission runner; the small analytic wing in the
thermal test isolates the integration plumbing from an expensive polar solve over 72 hours.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pytest

import HYBRID_common as hybrid
from aerosim.env.atmosphere import atmosphere
from aerosim.integrate import integrate_energy
from aerosim.mission import MissionProfile, fly_mission
from aerosim.mission import runner as mission_runner
from aerosim.vehicle.electrochem import CELL_SPECS, PackThermalSpec
from aerosim.vehicle.energy import BatteryElement, PackHeaterLoad
from aerosim.vehicle.state import BodyState, ElementForce


G0_MS2: float = 9.80665
TRIM_REL_TOL: float = 1.0e-8


@pytest.fixture(scope="module")
def buoyant_sweep() -> dict[float, tuple]:
    """Run the real four-point Floater boundary once and retain its diagnostics."""
    outcomes: dict[float, tuple] = {}
    for buoyancy_fraction in (0.2, 0.4, 0.6, 0.8):
        build, _ = hybrid.hybrid_build(
            buoyancy_fraction,
            batt_kg=0.409,
            lat=47.5,
            doy=195,
            prop_max_W=100.0,
        )
        envelope = next(
            el for el in build.vehicle.elements if hasattr(el, "volume_m3")
        )
        chemistry_steps_s: list[float] = []
        accrue = envelope._accrue_envelope_chemistry

        def counted_accrue(sol, dt_s, *, _accrue=accrue, _steps=chemistry_steps_s):
            _steps.append(float(dt_s))
            return _accrue(sol, dt_s)

        envelope._accrue_envelope_chemistry = counted_accrue
        result = integrate_energy(build.vehicle, build.env, 0.0, 60.0, 60.0)
        surface = next(
            el for el in build.vehicle.elements if hasattr(el, "geometry")
        )
        outcomes[buoyancy_fraction] = (
            build,
            result,
            surface,
            envelope,
            chemistry_steps_s,
        )
    return outcomes


def test_buoyant_trim_probes_do_not_advance_physical_time(buoyant_sweep) -> None:
    """All four real trims converge while chemistry advances one accepted minute only."""
    for fraction, (build, result, surface, envelope, chemistry_steps_s) in \
            buoyant_sweep.items():
        weight_N = sum(body.mass_kg for body in build.vehicle.bodies) * G0_MS2
        assert result.worst_trim_residual_N <= TRIM_REL_TOL * weight_N, fraction
        assert surface.last_valid is True, fraction
        assert surface.last_Re >= 30_000.0, fraction
        assert chemistry_steps_s == [60.0], fraction
        assert result.detail["accepted_state_advances"] == 2, fraction
        assert 0.0 < envelope.helium_frac_remaining < 1.0, fraction


def test_floater_low_speed_polar_is_currently_certified(buoyant_sweep) -> None:
    """The alleged 4.4-4.5 m/s refusal is stale: both live Re brackets certify it.

    This deliberately inspects the existing conjunctive polar gate instead of widening any
    Reynolds, alpha, confidence or stall bound. A failure names the bin and certified span.
    """
    build, _, surface, _, _ = buoyant_sweep[0.8]
    atmo = atmosphere(hybrid.ALT_M)
    for speed_ms in (4.4, 4.5):
        reynolds = surface.reference_reynolds(
            speed_ms, atmo.rho_kgm3, atmo.mu_Pas
        )
        assert reynolds >= 30_000.0
        bin_lo, bin_hi, _ = surface._re_bin_bracket(reynolds)
        for re_bin in (bin_lo, bin_hi):
            polar = surface._polar_for_bin(re_bin, atmo.rho_kgm3, atmo.mu_Pas)
            valid = np.asarray(polar.valid, dtype=bool)
            alpha_deg = np.degrees(np.asarray(polar.alpha_rad, dtype=float))
            assert valid.any(), f"Re bin {re_bin} has no certified rows"
            valid_span = alpha_deg[valid]
            assert valid_span.min() <= surface.incidence_deg <= valid_span.max(), (
                re_bin,
                surface.incidence_deg,
                (valid_span.min(), valid_span.max()),
            )
            _, _, bracket_ok = surface._interp_certified(
                polar, surface.incidence_deg
            )
            assert bracket_ok, re_bin
        _, _, point_ok = surface.coefficients(
            surface.incidence_deg, speed_ms, atmo.rho_kgm3, atmo.mu_Pas
        )
        assert point_ok is True


class _LiftOnlyWing:
    """Analytic attached-flow lift used only to isolate 72 h state plumbing."""

    incidence_deg: float = 4.0  # KIND_AERO classifier
    body_index: int = 0

    def __init__(self, area_times_cl_m2: float) -> None:
        self.area_times_cl_m2 = float(area_times_cl_m2)
        self.last_valid = True
        self.last_Re = 0.0

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s) -> ElementForce:
        """Return L=q*S*CL vertically; no drag or electrical power."""
        del sol, t_s, dt_s
        wind_ms = np.array([wind.u_ms, wind.v_ms, wind.w_ms], dtype=float)
        speed_ms = float(np.linalg.norm(np.asarray(bodies[0].vel_ms) - wind_ms))
        self.last_Re = float(atmo.rho_kgm3) * speed_ms / max(
            float(atmo.mu_Pas), 1.0e-12
        )
        self.last_valid = speed_ms > 0.0
        lift_N = 0.5 * float(atmo.rho_kgm3) * speed_ms**2 * self.area_times_cl_m2
        return ElementForce(np.array([0.0, 0.0, lift_N]), np.zeros(3), 0.0)


@dataclass
class _OneBodyVehicle:
    """Minimal public vehicle contract used by integrate_energy/fly_mission."""

    bodies: list
    elements: list


def test_real_pack_thermal_and_heater_are_live_over_72h(monkeypatch) -> None:
    """A 72 h cold mission changes pack temperature and bills non-zero heater energy."""
    # The Windows free-RAM guard can deliberately wait 3x60 s on a busy CI host; it is an
    # operational throttle, not mission physics, so bypass only that wait in this regression.
    monkeypatch.setattr(mission_runner, "_footprint_guard", lambda: None)

    cell = CELL_SPECS["nca_21700"]
    n_cells = 12
    capacity_Wh = n_cells * cell.nameplate_Wh
    pack_mass_kg = n_cells * cell.m_cell_kg * 1.10
    thermal = PackThermalSpec(
        m_pack_kg=pack_mass_kg,
        t_ins_m=0.020,
        k_ins_W_per_mK=0.020,
        A_box_m2=0.065,
        p_heater_max_W=10.0,
    )
    pack = BatteryElement(
        capacity_J=capacity_Wh * 3600.0,
        initial_soc=0.90,
        specific_energy_Wh_per_kg=capacity_Wh / pack_mass_kg,
        chemistry="nca_21700",
        n_series=n_cells,
        n_parallel=1,
        thermal=thermal,
    )
    heater = PackHeaterLoad(pack, mass_kg=0.15)
    body = BodyState(
        pos_m=np.array([0.0, 0.0, 20_000.0]),
        vel_ms=np.array([10.0, 0.0, 0.0]),
        mass_kg=2.0,
    )
    vehicle = _OneBodyVehicle([body], [_LiftOnlyWing(4.5), pack, heater])
    profile = MissionProfile(
        start_utc_h=18.0,
        duration_s=72.0 * 3600.0,
        altitude_m=20_000.0,
        lat_deg=47.6,
        day_of_year=15,
        wind_mean_ms=0.0,
        shear=False,
        dryden_sigma_ms=0.0,
    )

    accepted_thermal_steps_s: list[float] = []
    advance_thermal = pack.ecm.advance_thermal
    accepted_electrical_steps_s: list[float] = []
    electrical_step = pack.step

    def counted_advance(t_amb_K, dt_s):
        accepted_thermal_steps_s.append(float(dt_s))
        return advance_thermal(t_amb_K, dt_s)

    def counted_electrical_step(power_W, dt_s):
        accepted_electrical_steps_s.append(float(dt_s))
        return electrical_step(power_W, dt_s)

    monkeypatch.setattr(pack.ecm, "advance_thermal", counted_advance)
    monkeypatch.setattr(pack, "step", counted_electrical_step)
    mission = fly_mission(vehicle, profile, dt_s=300.0)

    assert sum(accepted_thermal_steps_s) == pytest.approx(profile.duration_s)
    assert accepted_thermal_steps_s == [300.0] * 864
    assert sum(accepted_electrical_steps_s) == pytest.approx(profile.duration_s)
    assert accepted_electrical_steps_s == [300.0] * 864
    assert np.ptp(mission.pack_temp_K) > 5.0
    assert mission.pack_temp_K.min() < mission.pack_temp_K[0] - 5.0
    assert mission.heater_Wh > 0.0
    assert mission.ledger["heater"] == pytest.approx(mission.heater_Wh)
    assert mission.sim.detail["storage_authority"] == (
        "BatteryElement.step->PackEcm.step_power"
    )
    assert mission.sim.soc[-1] == pytest.approx(pack.soc)
    assert pack.throughput_Ah > 0.0
    assert mission.sim.certified is True
