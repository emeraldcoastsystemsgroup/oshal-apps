"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Guards for the closed validity-reason set
  |                                           | (aerosim.validity): the set refuses what it
  |                                           | does not declare; each refusal carries its
  |                                           | code from the line that raised it (param
  |                                           | bounds, real-chain claim band and knobs,
  |                                           | negative airframe, trim); both integrators
  |                                           | publish one code per closed reason with the
  |                                           | deciding numbers; and a source scan keeps
  |                                           | every reasons.append paired with its code,
  |                                           | so a new prose reason cannot ship uncoded.
  |                                           | Technology-catalogue refusals carry their
  |                                           | frontier; the mass-closure, free-energy and
  |                                           | no-valid-point families carry class codes.

Fixtures are the same duck-typed wings the solver-validity guards use and the
real-drive plumbing pack; nothing here flies a full day.
"""

from __future__ import annotations

import ast
import dataclasses
import inspect
import textwrap
from dataclasses import dataclass

import numpy as np
import pytest

from aerosim import integrate as integ
from aerosim import validate_screen, validity
from aerosim.env.wind import make_uniform_field
from aerosim.integrate import EnvBundle, TrimConvergenceError, integrate_dynamic, integrate_energy
from aerosim.real_chain import PackClaimBandError
from aerosim.validate_designs import DESIGN_A, ValidationError, build_solar_cruise
from aerosim.vehicle.electrochem import CELL_SPECS, PackThermalSpec
from aerosim.vehicle.energy import BatteryElement, PayloadLoad
from aerosim.vehicle.param_bounds import ParamBoundsError, require_in_range
from aerosim.vehicle.state import BodyState, ElementForce
from aerosim.vehicle.mass import UndeclaredMassError
from aerosim.vehicle.tech_catalogue import (
    PACK_FRONTIER_WH_PER_KG,
    TechCatalogueError,
    check_pack_technology,
    check_pv_technology_pair,
)
from aerosim.powerplant import FreeEnergyError
from aerosim.aeropolar import NoValidPointError


# --------------------------------------------------------------------------- #
# Fixtures                                                                     #
# --------------------------------------------------------------------------- #

@dataclass
class _Vehicle:
    """Duck-typed vehicle: .bodies + .elements is all the integrators read."""

    bodies: list
    elements: list


class _Wing:
    """KIND_AERO fake: lift 0.5 rho V^2 S_CL along the lift axis, drag L/20,
    capped at cap_N when given (then no trim can exist)."""

    def __init__(self, s_cl_m2: float, cap_N: float | None = None) -> None:
        self.incidence_deg = 4.0
        self.body_index = 0
        self.s_cl_m2 = float(s_cl_m2)
        self.cap_N = cap_N
        self.last_valid = True
        self.last_Re = 0.0

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
        v_rel = np.asarray(bodies[0].vel_ms, float) - np.array([wind.u_ms, wind.v_ms, wind.w_ms])
        speed = float(np.linalg.norm(v_rel))
        if speed <= 0.0:
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)
        lift_N = 0.5 * float(atmo.rho_kgm3) * speed * speed * self.s_cl_m2
        d_hat = v_rel / speed
        up = np.array([0.0, 0.0, 1.0])
        l_axis = up - d_hat * float(np.dot(up, d_hat))
        l_axis = l_axis / max(float(np.linalg.norm(l_axis)), 1e-12)
        force = lift_N * l_axis - (lift_N / 20.0) * d_hat
        if self.cap_N is not None and float(np.linalg.norm(force)) > self.cap_N:
            force = force * (self.cap_N / float(np.linalg.norm(force)))
        self.last_Re = float(atmo.rho_kgm3) * speed / float(atmo.mu_Pas)
        return ElementForce(force, np.zeros(3), 0.0)


def _still_air() -> EnvBundle:
    return EnvBundle(wind=make_uniform_field(0.0, 0.0, 0.0), latitude_deg=0.0,
                     longitude_deg=0.0, day_of_year=172, utc_hour_at_t0_h=0.0)


def _one_body(element, mass_kg: float, vel=(10.0, 0.0, 0.0)) -> _Vehicle:
    body = BodyState(pos_m=np.array([0.0, 0.0, 500.0]), vel_ms=np.array(vel, float),
                     mass_kg=float(mass_kg))
    return _Vehicle([body], [element])


def _real_pack(initial_soc: float = 0.50) -> BatteryElement:
    cell = CELL_SPECS["nca_21700"]
    mass_kg = 6 * cell.m_cell_kg * 1.101
    return BatteryElement(
        capacity_J=6 * cell.nameplate_Wh * 3600.0, initial_soc=initial_soc,
        specific_energy_Wh_per_kg=6 * cell.nameplate_Wh / mass_kg,
        chemistry="nca_21700", n_series=6, n_parallel=1,
        thermal=PackThermalSpec(m_pack_kg=mass_kg, t_ins_m=0.005, k_ins_W_per_mK=0.033,
                                A_box_m2=0.040, p_heater_max_W=10.0))


def _assert_paired(result) -> list[dict]:
    """Every closed reason has exactly one well-formed code, in the same order."""
    reasons = result.detail["closed_reasons"]
    codes = result.detail["closed_reason_codes"]
    assert len(codes) == len(reasons), (reasons, codes)
    assert all(validity.is_reason(c) for c in codes), codes
    return codes


# --------------------------------------------------------------------------- #
# The set itself                                                               #
# --------------------------------------------------------------------------- #

def test_reason_refuses_what_the_set_does_not_declare() -> None:
    with pytest.raises(validity.ValidityCodeError, match="unknown"):
        validity.reason("battery_sad")
    with pytest.raises(validity.ValidityCodeError, match="undeclared"):
        validity.reason("unmet_bus_demand_Wh", unmet_Wh=1.0, mood=2.0)
    with pytest.raises(validity.ValidityCodeError, match="missing"):
        validity.reason("soc_not_persistent", soc_start=1.0, soc_end=0.9)
    with pytest.raises(validity.ValidityCodeError, match="screen rule"):
        validity.screen_rule("vibes")
    with pytest.raises(validity.ValidityCodeError, match="number"):
        validity.reason("unmet_bus_demand_Wh", unmet_Wh="lots")


def test_reason_normalises_numbers_and_rejects_forged_dicts() -> None:
    r = validity.reason("dt_too_coarse", dt_s=np.float64(7200.0), ceiling_s=float("inf"))
    assert r == {"code": "dt_too_coarse", "dt_s": 7200.0, "ceiling_s": None}
    assert type(r["dt_s"]) is float
    assert validity.is_reason(r)
    assert not validity.is_reason({"code": "dt_too_coarse", "dt_s": 1.0})
    assert not validity.is_reason({"code": "not_a_code"})


def test_reason_of_reads_the_source_never_the_message() -> None:
    plain = ValueError("negative_airframe_mass soc_not_persistent")   # words, no code
    assert validity.reason_of(plain) is None
    wrapped = RuntimeError("wrapper")
    wrapped.__cause__ = validity.attach(ValueError("x"), "unmet_bus_demand_Wh", unmet_Wh=2.0)
    assert validity.reason_of(wrapped) == {"code": "unmet_bus_demand_Wh", "unmet_Wh": 2.0}


# --------------------------------------------------------------------------- #
# Refusals typed at their raise sites                                          #
# --------------------------------------------------------------------------- #

def test_param_bounds_refusal_carries_the_interval() -> None:
    with pytest.raises(ParamBoundsError) as info:
        require_in_range("eta", 1.5, 0.0, 1.0, element="Thing")
    assert info.value.validity_reason == {"code": "param_out_of_bounds",
                                          "param": "Thing.eta", "value": 1.5,
                                          "lo": 0.0, "hi": 1.0}


def test_negative_airframe_mass_is_coded_with_its_masses() -> None:
    light = dataclasses.replace(DESIGN_A, mass_all_up_kg=2.0)
    with pytest.raises(ValidationError) as info:
        build_solar_cruise(light)
    r = validity.reason_of(info.value)
    assert r["code"] == "negative_airframe_mass"
    assert r["as_flown_kg"] == pytest.approx(2.0)
    assert r["structure_kg"] == pytest.approx(r["as_flown_kg"] - r["element_mass_kg"])
    assert r["structure_kg"] < 0.0 < r["wing_mass_kg"] < r["element_mass_kg"]


def test_real_chain_claim_band_is_a_typed_error_through_the_builder() -> None:
    claim = dataclasses.replace(DESIGN_A, pack_Wh_per_kg=441.8)
    with pytest.raises(ValidationError) as info:
        build_solar_cruise(claim, chain="real", pack_chemistry="nca_21700")
    assert isinstance(info.value.__cause__, PackClaimBandError)
    assert isinstance(info.value.__cause__, ValueError)
    r = validity.reason_of(info.value)
    assert r["code"] == "pack_claim_outside_catalogue_band"
    assert r["chemistry"] == "nca_21700" and r["band"] == pytest.approx(0.15)
    assert r["ratio"] == pytest.approx(441.8 / r["catalogue_Wh_per_kg"])
    assert abs(r["ratio"] - 1.0) > r["band"]


def test_real_chain_knob_refusal_names_the_knob() -> None:
    with pytest.raises(ValidationError) as info:
        build_solar_cruise(DESIGN_A, chain="real", thruster_figure_of_merit=0.8)
    assert validity.reason_of(info.value) == {"code": "real_chain_config_refused",
                                              "knob": "thruster_figure_of_merit"}


def test_technology_catalogue_refusals_carry_the_frontier() -> None:
    with pytest.raises(TechCatalogueError) as info:
        check_pv_technology_pair(0.45, 3.0)
    r = validity.reason_of(info.value)
    assert (r["code"], r["kind"]) == ("technology_beyond_catalogue", "pv")
    assert r["value"] == 0.45 > r["ceiling"] and r["areal_density_kg_m2"] == 3.0
    with pytest.raises(TechCatalogueError) as info:
        check_pack_technology(499.0)
    r = validity.reason_of(info.value)
    assert (r["kind"], r["value"], r["ceiling"]) == ("pack", 499.0, PACK_FRONTIER_WH_PER_KG)


def test_refusal_families_declare_their_code_on_the_class() -> None:
    assert validity.reason_of(UndeclaredMassError("x")) == {"code": "mass_closure_refused"}
    assert validity.reason_of(FreeEnergyError("x")) == {"code": "free_energy_refused"}
    assert validity.reason_of(NoValidPointError("x")) == {"code": "aero_no_valid_point"}


def test_trim_refusal_carries_residual_and_tolerance() -> None:
    vehicle = _one_body(_Wing(1.0, cap_N=10.0), mass_kg=10.0)      # 10 N lift vs 98 N
    with pytest.raises(TrimConvergenceError) as info:
        integrate_energy(vehicle, _still_air(), 0.0, 600.0, 60.0)
    r = validity.reason_of(info.value)
    assert r["code"] == "trim_not_converged"
    assert abs(r["residual_N"]) > r["tol_N"] > 0.0


# --------------------------------------------------------------------------- #
# Closure codes published by both integrators                                  #
# --------------------------------------------------------------------------- #

def test_energy_loop_codes_the_sub_diurnal_window_and_the_real_pack() -> None:
    build = build_solar_cruise(DESIGN_A, chain="real")
    result = integrate_energy(build.vehicle, build.env, 0.0, 600.0, 60.0)
    codes = _assert_paired(result)
    window = [c for c in codes if c["code"] == "sub_diurnal_window"]
    assert window == [{"code": "sub_diurnal_window", "window_s": 600.0}]
    assert not result.closed


def test_energy_loop_codes_a_coarse_step() -> None:
    build = build_solar_cruise(DESIGN_A, chain="ideal")
    result = integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 7200.0)
    codes = _assert_paired(result)
    assert {"code": "dt_too_coarse", "dt_s": 7200.0,
            "ceiling_s": integ.MAX_CERTIFIED_SOLAR_DT_S} in codes
    assert result.certified is False


def test_dynamic_loop_codes_refused_demand() -> None:
    body = BodyState(pos_m=np.array([0.0, 0.0, 1000.0]), vel_ms=np.zeros(3), mass_kg=1.0)
    vehicle = _Vehicle([body], [PayloadLoad(10_000.0, mass_kg=0.0, label="probe"), _real_pack()])
    result = integrate_dynamic(vehicle, _still_air(), 0.0, 1.0, 1.0)
    codes = _assert_paired(result)
    demand = [c for c in codes if c["code"] == "unmet_bus_demand_Wh"]
    assert demand and demand[0]["unmet_Wh"] == pytest.approx(
        result.detail["unabsorbed_shortfall_J"] / 3600.0)


def test_energy_loop_codes_unmet_thrust_with_the_integrators_numbers() -> None:
    vehicle = _one_body(_Wing(1.4), mass_kg=10.0)       # trims, but nothing pushes it
    result = integrate_energy(vehicle, _still_air(), 0.0, 600.0, 60.0)
    codes = _assert_paired(result)
    unmet = [c for c in codes if c["code"] == "unmet_thrust"]
    assert unmet and unmet[0]["max_unmet_thrust_N"] == pytest.approx(
        result.detail["max_unmet_thrust_N"])
    assert unmet[0]["max_unmet_thrust_N"] > unmet[0]["tol_N"]


# --------------------------------------------------------------------------- #
# Source pairing: a prose reason cannot ship without its code                  #
# --------------------------------------------------------------------------- #

def _appends(fn, name: str) -> int:
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    return sum(1 for node in ast.walk(tree)
               if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
               and node.func.attr == "append" and isinstance(node.func.value, ast.Name)
               and node.func.value.id == name)


@pytest.mark.parametrize("fn", [integ.integrate_energy, integ.integrate_dynamic,
                                validate_screen.screen_design])
def test_every_reason_append_is_paired_with_a_code(fn) -> None:
    reasons = _appends(fn, "reasons")
    codes = _appends(fn, "codes")
    assert reasons > 0
    assert codes == reasons, f"{fn.__name__}: {reasons} reasons.append vs {codes} codes.append"
