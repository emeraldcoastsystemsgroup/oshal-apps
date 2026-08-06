"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression walls for the explicit
  |                                           | real solar-aircraft assembly, BEMT
  |                                           | motor/ESC/harness energy ordering,
  |                                           | direct-bus voltage ceiling, and the
  |                                           | single accepted PackEcm authority.
2 | maintainer@emeraldcoastsystemsgroup.com   | Pin explicit cell topology to finite,
  |                                           | positive whole Ns/Np values; fractional
  |                                           | and infinite inputs must fail before any
  |                                           | implicit integer conversion.
-------------------------------------------------------------------------------

tests.test_real_drive_authority -- one owner for every real electrical loss.

These tests deliberately separate topology from persistence. The builder tests
prove that chain='real' selects the physical component graph without silently
changing the legacy ideal path. The small dynamic fixtures then isolate storage
bookkeeping: RK4 trial evaluations may inspect the bus, but only one accepted
BatteryElement.step call may mutate electrochemistry per interval.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
import pytest

from aerosim.env.atmosphere import atmosphere
from aerosim.env.wind import make_uniform_field
from aerosim.integrate import EnvBundle, integrate_dynamic
from aerosim.real_chain import build_real_solar_chain
from aerosim.validate import assert_shipped_elements
from aerosim.validate_designs import DESIGN_A, build_solar_cruise
from aerosim.vehicle import BEMTThruster, PackHeaterLoad, PVArrayDiode
from aerosim.vehicle.electrochem import CELL_SPECS, PackThermalSpec
from aerosim.vehicle.energy import BatteryElement, PVArray, PayloadLoad
from aerosim.vehicle.state import BodyState
from aerosim.vehicle.thruster import Thruster


@dataclass
class _OneBodyVehicle:
    """Minimal documented vehicle surface needed by the dynamic integrator."""

    bodies: list
    elements: list


@pytest.fixture(scope="module")
def solar_builds():
    """Build each named chain once; the solver-backed wing construction is costly."""

    return {
        "real": build_solar_cruise(DESIGN_A, chain="real"),
        "ideal": build_solar_cruise(DESIGN_A, chain="ideal"),
    }


def _real_pack(*, initial_soc: float = 0.80) -> BatteryElement:
    """Construct a small, topology-consistent 6s1p M50 pack for plumbing tests."""

    cell = CELL_SPECS["nca_21700"]
    n_cells = 6
    capacity_Wh = n_cells * cell.nameplate_Wh
    pack_mass_kg = n_cells * cell.m_cell_kg * 1.101
    thermal = PackThermalSpec(
        m_pack_kg=pack_mass_kg,
        t_ins_m=0.005,
        k_ins_W_per_mK=0.033,
        A_box_m2=0.040,
        p_heater_max_W=10.0,
    )
    return BatteryElement(
        capacity_J=capacity_Wh * 3600.0,
        initial_soc=initial_soc,
        specific_energy_Wh_per_kg=capacity_Wh / pack_mass_kg,
        chemistry="nca_21700",
        n_series=6,
        n_parallel=1,
        thermal=thermal,
    )


def _dynamic_case(pack: BatteryElement, load_W: float) -> _OneBodyVehicle:
    """Place one real pack and one explicit bus load on a ballistic test body."""

    body = BodyState(
        pos_m=np.array([0.0, 0.0, 1000.0]),
        vel_ms=np.zeros(3),
        mass_kg=1.0,
    )
    load = PayloadLoad(load_W, mass_kg=0.0, label="authority-probe")
    return _OneBodyVehicle([body], [load, pack])


def _still_env() -> EnvBundle:
    """Deterministic environment for the isolated storage tests."""

    return EnvBundle(
        wind=make_uniform_field(0.0, 0.0, 0.0),
        latitude_deg=0.0,
        longitude_deg=0.0,
        day_of_year=80,
        utc_hour_at_t0_h=0.0,
    )


def test_real_builder_composes_one_nonduplicated_chain(solar_builds) -> None:
    """chain='real' must instantiate every physical owner exactly once."""

    build = solar_builds["real"]
    elements = build.vehicle.elements
    assert_shipped_elements(build.vehicle)

    packs = [el for el in elements if hasattr(el, "capacity_J")]
    thrusters = [el for el in elements if isinstance(el, BEMTThruster)]
    arrays = [el for el in elements if isinstance(el, PVArrayDiode)]
    heaters = [el for el in elements if isinstance(el, PackHeaterLoad)]

    assert len(packs) == len(thrusters) == len(arrays) == len(heaters) == 1
    pack = packs[0]
    assert heaters[0].pack is pack
    assert pack.chemistry == "nca_21700"
    assert not hasattr(pack, "eta_charge")
    assert not hasattr(pack, "eta_discharge")
    assert build.meta["chain"] == "real"
    assert build.meta["real_chain"]["model"] == "real"
    assert build.meta["real_chain"]["storage_authority"] == (
        "BatteryElement.step->PackEcm.step_power"
    )
    assert build.meta["real_chain"]["drive"]["model"] == (
        "BEMT+motor+ESC+harness"
    )
    assert build.meta["undeclared_mass_elements"] == []

    real_kwargs = {
        "pv_efficiency": DESIGN_A.pv_efficiency,
        "pv_packing": DESIGN_A.pv_packing,
        "pack_claim_Wh_per_kg": DESIGN_A.pack_Wh_per_kg,
        "soc_max": 1.0,
        "eta_charge_override": None,
        "thruster_figure_of_merit": None,
    }
    for override in (
        {"pack_cells_series": 6.5},
        {"pack_cells_series": math.inf},
        {"pack_cells_parallel": math.nan},
    ):
        with pytest.raises(ValueError, match="finite positive whole count"):
            build_real_solar_chain(DESIGN_A, **real_kwargs, **override)


def test_explicit_ideal_builder_remains_the_named_legacy_path(solar_builds) -> None:
    """The real selector must not silently alter the explicit ideal regression path."""

    build = solar_builds["ideal"]
    elements = build.vehicle.elements
    thruster = next(el for el in elements if hasattr(el, "max_electrical_power_W"))
    array = next(el for el in elements if hasattr(el, "packing_factor"))
    pack = next(el for el in elements if hasattr(el, "capacity_J"))

    assert type(thruster) is Thruster
    assert type(array) is PVArray
    assert pack.chemistry == "ideal"
    assert hasattr(pack, "eta_charge") and hasattr(pack, "eta_discharge")
    assert build.meta["chain"] == "ideal"
    assert "real_chain" not in build.meta


def test_bemt_chain_orders_losses_and_never_boosts_bus_voltage(solar_builds) -> None:
    """A certified thrust point must pay prop, motor, ESC and harness in order."""

    build = solar_builds["real"]
    thruster = next(
        el for el in build.vehicle.elements if isinstance(el, BEMTThruster)
    )
    body = build.vehicle.bodies[0]
    atmo = atmosphere(float(body.pos_m[2]))
    wind = build.env.wind.sample(*map(float, body.pos_m), 0.0)
    thruster.set_thrust_N(2.0)
    force = thruster.evaluate(
        [body], atmo, wind, SimpleNamespace(), 0.0, 0.0
    )

    chain = thruster.last_chain
    thrust_N = float(np.linalg.norm(force.force_N))
    wind_ms = np.array([wind.u_ms, wind.v_ms, wind.w_ms], dtype=float)
    airspeed_ms = float(np.linalg.norm(np.asarray(body.vel_ms) - wind_ms))
    induced_ms = 0.5 * (
        -airspeed_ms
        + math.sqrt(
            airspeed_ms**2
            + 2.0 * thrust_N / (float(atmo.rho_kgm3) * thruster.disk_area_m2)
        )
    )
    actuator_floor_W = thrust_N * (airspeed_ms + induced_ms)

    assert thrust_N == pytest.approx(2.0, rel=2.0e-3)
    assert chain["p_shaft_W"] >= actuator_floor_W * (1.0 - 1.0e-9)
    assert chain["p_shaft_W"] < chain["p_motor_elec_W"]
    assert chain["p_motor_elec_W"] < chain["p_esc_in_W"]
    assert chain["p_esc_in_W"] < chain["p_bus_W"]
    assert chain["p_harness_W"] > 0.0
    assert chain["motor_terminal_V"] <= thruster.v_bus_V * (1.0 + 1.0e-9)
    assert force.power_elec_W == pytest.approx(-chain["p_bus_W"])
    assert thruster.last_point_valid is True


def test_real_pack_steps_once_per_accepted_dynamic_interval(monkeypatch) -> None:
    """Four RK4 probes must collapse to one nonlinear PackEcm mutation per step."""

    pack = _real_pack(initial_soc=0.80)
    vehicle = _dynamic_case(pack, load_W=30.0)
    accepted_calls: list[tuple[float, float]] = []
    original_step = pack.step

    def counted_step(power_W: float, dt_s: float) -> float:
        accepted_calls.append((float(power_W), float(dt_s)))
        return original_step(power_W, dt_s)

    monkeypatch.setattr(pack, "step", counted_step)
    result = integrate_dynamic(vehicle, _still_env(), 0.0, 10.0, 2.0)

    assert len(accepted_calls) == 5
    assert [dt_s for _, dt_s in accepted_calls] == [2.0] * 5
    assert all(power_W == pytest.approx(-30.0) for power_W, _ in accepted_calls)
    assert result.detail["closure_mode"] == "accepted-real-ecm"
    assert result.detail["storage_authority"] == (
        "BatteryElement.step->PackEcm.step_power"
    )
    assert result.soc[-1] == pytest.approx(pack.soc)
    assert result.battery_energy_J[-1] == pytest.approx(pack.energy_J)
    assert pack.throughput_Ah > 0.0
    assert result.detail["unabsorbed_shortfall_J"] == pytest.approx(0.0)


def test_real_pack_rate_limit_surfaces_bus_shortfall() -> None:
    """Demand beyond the BU-410/voltage envelope is reported, never eta-replayed."""

    pack = _real_pack(initial_soc=0.50)
    result = integrate_dynamic(
        _dynamic_case(pack, load_W=10_000.0), _still_env(), 0.0, 1.0, 1.0
    )

    assert not hasattr(pack, "eta_discharge")
    assert result.detail["unabsorbed_shortfall_J"] > 9_000.0
    assert result.closed is False
    assert pack.throughput_Ah > 0.0
    assert pack.soc > pack.soc_min


def test_multiple_storage_elements_refuse_real_authority_split() -> None:
    """The integrator must not invent current sharing between nonlinear packs."""

    vehicle = _dynamic_case(_real_pack(), load_W=1.0)
    vehicle.elements.append(_real_pack())
    with pytest.raises(ValueError, match="exactly ONE storage authority"):
        integrate_dynamic(vehicle, _still_env(), 0.0, 1.0, 1.0)
