"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Central real solar-aircraft
  |                                           | assembly: catalogued cells + PackEcm,
  |                                           | billed pack heater, C60 diode PV +
  |                                           | MPPT + harness, and BEMT + motor/ESC
  |                                           | + harness. The ideal builder path stays
  |                                           | separate, so no loss is multiplied twice.
2 | maintainer@emeraldcoastsystemsgroup.com   | Validate explicit pack topology as finite,
  |                                           | positive whole cell counts before conversion;
  |                                           | fractional/NaN/infinite values can no longer
  |                                           | truncate or leak int-conversion exceptions.

This module is intentionally an assembly seam. Component equations remain in
their cited owners; the builder chooses compatible catalogued parts, derives
their topology and bills every auxiliary mass/load once.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .electrical import (
    HarnessSegment,
    MPPTConverter,
    XT60_CONTACT_RESISTANCE_OHM,
    awg_resistance_ohm_per_m,
    harness_copper_mass_kg,
)
from .prop import EscParams, MOTOR_CATALOGUE, PROP_CATALOGUE, PropGeometry
from .vehicle.bemt_thruster import BEMTThruster
from .vehicle.electrochem import CELL_SPECS, PackThermalSpec
from .vehicle.energy import BatteryElement, PackHeaterLoad, PayloadLoad
from .vehicle.pv_real import PVArrayDiode

J_PER_WH: float = 3600.0
REAL_V_BUS_V: float = 21.6
REAL_PACK_NS: int = 6
REAL_PACK_MASS_FACTOR: float = 1.101
REAL_PACK_CLAIM_BAND: float = 0.15
REAL_PACK_T_INS_M: float = 0.005
REAL_PACK_K_INS_W_MK: float = 0.033
REAL_PACK_A_BOX_M2_A: float = 0.16
REAL_PACK_HEATER_MAX_W_A: float = 10.0
REAL_HEATER_INSTALL_KG_A: float = 0.060
REAL_PACK_MASS_A_KG: float = 36.0 * 0.0698 * REAL_PACK_MASS_FACTOR
REAL_PV_N_SERIES: int = 44

REAL_CHAIN_HONESTY: dict[str, str] = {
    "R-1": (
        "The +/-15% design-claim audit band spans the measured AS-2 bonded-cell "
        "claim and the certified cell/packaging floor; it is a declared judgment band."
    ),
    "R-2": (
        "Pack box area scales from the 36-cell 0.16 m2 layout estimate with "
        "mass^(2/3); XPS conductivity 0.033 W/(m K) is the cited material value."
    ),
    "R-3": (
        "Heater/insulation installation mass scales from a 0.060 kg A-class estimate."
    ),
    "R-4": (
        "PV and drive harness run lengths scale from 1.0 m and 0.8 m A-class "
        "layout estimates; AWG resistance and connector loss are cited component data."
    ),
    "R-5": (
        "Off-anchor prop diameters preserve the UIUC APC 11x4.7 dimensionless blade "
        "shape; the BEMT credibility remains the measured low-Re anchor band."
    ),
}


@dataclass(frozen=True)
class SolarChainAssembly:
    """@description One non-duplicated real electrical-chain assembly."""

    battery: BatteryElement
    array: PVArrayDiode
    thruster: BEMTThruster
    extra_loads: tuple[Any, ...]
    metadata: dict[str, Any]


def _select_chemistry(pack_claim_Wh_per_kg: float) -> str:
    """@description Select the nearest certified chemistry by pack specific energy."""
    candidates: list[tuple[float, str]] = []
    for key, cell in CELL_SPECS.items():
        pack_level = cell.nameplate_Wh / (
            cell.m_cell_kg * REAL_PACK_MASS_FACTOR
        )
        candidates.append((abs(pack_claim_Wh_per_kg - pack_level), key))
    return min(candidates)[1]


def _pack_topology(
    design_pack_mass_kg: float,
    chemistry: str,
    n_series: int | None,
    n_parallel: int | None,
) -> tuple[int, int, float, float]:
    """
    @description Resolve a catalogued cell topology from the design's stated pack mass.
    @returns (Ns, Np, capacity_Wh, installed_pack_mass_kg).
    """
    cell = CELL_SPECS[chemistry]

    def whole_count(name: str, value: Any) -> int:
        """@description Refuse non-finite/fractional topology before int conversion."""
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be a finite positive whole count") from exc
        if not math.isfinite(numeric) or numeric < 1.0 or not numeric.is_integer():
            raise ValueError(
                f"{name} must be a finite positive whole count, got {value!r}"
            )
        return int(numeric)

    ns = REAL_PACK_NS if n_series is None else whole_count(
        "pack_cells_series", n_series
    )
    if n_parallel is None:
        np_strings = max(
            1,
            int(round(
                float(design_pack_mass_kg)
                / (ns * cell.m_cell_kg * REAL_PACK_MASS_FACTOR)
            )),
        )
    else:
        np_strings = whole_count("pack_cells_parallel", n_parallel)
    n_cells = ns * np_strings
    return (
        ns,
        np_strings,
        n_cells * cell.nameplate_Wh,
        n_cells * cell.m_cell_kg * REAL_PACK_MASS_FACTOR,
    )


def _scaled_propeller(diameter_m: float) -> PropGeometry:
    """
    @description Scale the UIUC APC 11x4.7 dimensionless blade geometry to the
        design diameter. Chord/twist distributions remain the measured shape;
        this does not claim a new measurement anchor (REAL_CHAIN_HONESTY R-5).
    @param diameter_m Requested propeller diameter, m. @returns PropGeometry.
    """
    source = PROP_CATALOGUE["apcsf_11x47"]
    radius_m = float(diameter_m) / 2.0
    return PropGeometry(
        name=f"apcsf_11x47-scaled-{float(diameter_m):.6f}m",
        diameter_m=float(diameter_m),
        n_blades=source.n_blades,
        r_hub_m=source.r_hub_over_R * radius_m,
        r_over_R=np.asarray(source.r_over_R, dtype=float).copy(),
        c_over_R=np.asarray(source.c_over_R, dtype=float).copy(),
        beta_deg=np.asarray(source.beta_deg, dtype=float).copy(),
        section=source.section,
    )


def _select_motor(per_rotor_rating_W: float):
    """
    @description Pick the closest catalogued continuous motor rating. A request
        above the catalogue is deliberately clamped to the largest real part;
        integrated trim will then report unmet thrust rather than minting a motor.
    @returns MotorParams.
    """
    return min(
        MOTOR_CATALOGUE.values(),
        key=lambda motor: abs(float(motor.rating_W) - float(per_rotor_rating_W)),
    )


def _segment_resistance_ohm(segment: HarnessSegment) -> float:
    """@description Round-trip 20 C wire plus cited connector resistance, Ohm."""
    return (
        2.0
        * segment.length_oneway_m
        * awg_resistance_ohm_per_m(segment.awg)
        + segment.n_connector_pairs * XT60_CONTACT_RESISTANCE_OHM
    )


def build_real_solar_chain(
    design: Any,
    *,
    pv_efficiency: float,
    pv_packing: float,
    pack_claim_Wh_per_kg: float,
    soc_max: float,
    eta_charge_override: float | None,
    thruster_figure_of_merit: float | None,
    pack_chemistry: str | None = None,
    pack_cells_series: int | None = None,
    pack_cells_parallel: int | None = None,
) -> SolarChainAssembly:
    """
    @description Assemble the real storage, generation and propulsion path exactly once.
    @param design Solar-cruise design record (documented validate_designs fields).
    @param pv_efficiency Effective declared STC efficiency.
    @param pv_packing Effective cell coverage.
    @param pack_claim_Wh_per_kg Design's pack-level technology claim.
    @param soc_max Upper SOC rail. @param eta_charge_override Non-None only for
        mutation tests; the real BatteryElement refuses it because ECM owns losses.
    @param thruster_figure_of_merit Must be None; BEMT owns propeller physics.
    @param pack_chemistry Optional CELL_SPECS key; nearest catalogue row otherwise.
    @param pack_cells_series / pack_cells_parallel Optional explicit topology.
    @returns SolarChainAssembly.
    @raises ValueError When a flat-efficiency knob is supplied or the design claim
        disagrees with the selected catalogued cell/packaging combination.
    """
    if thruster_figure_of_merit is not None:
        raise ValueError(
            "the real chain has no figure_of_merit knob; BEMT blade geometry owns "
            "shaft power. Use chain='ideal' to exercise the actuator-disk parameter."
        )
    chemistry = (
        _select_chemistry(pack_claim_Wh_per_kg)
        if pack_chemistry is None else str(pack_chemistry)
    )
    if chemistry not in CELL_SPECS:
        raise ValueError(
            f"unknown real pack chemistry {chemistry!r}; choose one of "
            f"{sorted(CELL_SPECS)}"
        )
    ns, np_strings, capacity_Wh, pack_mass_kg = _pack_topology(
        design.battery_mass_kg,
        chemistry,
        pack_cells_series,
        pack_cells_parallel,
    )
    pack_specific_Wh_kg = capacity_Wh / pack_mass_kg
    claim_ratio = float(pack_claim_Wh_per_kg) / pack_specific_Wh_kg
    if abs(claim_ratio - 1.0) > REAL_PACK_CLAIM_BAND:
        raise ValueError(
            f"{design.name}: design pack claim {pack_claim_Wh_per_kg:.1f} Wh/kg "
            f"does not match {CELL_SPECS[chemistry].name} at the "
            f"{REAL_PACK_MASS_FACTOR:.3f}x packaging floor "
            f"({pack_specific_Wh_kg:.1f} Wh/kg; ratio {claim_ratio:.3f}, "
            f"allowed +/-{REAL_PACK_CLAIM_BAND:.0%})"
        )

    scale = max(pack_mass_kg / REAL_PACK_MASS_A_KG, 1.0e-6) ** (2.0 / 3.0)
    thermal = PackThermalSpec(
        m_pack_kg=pack_mass_kg,
        t_ins_m=REAL_PACK_T_INS_M,
        k_ins_W_per_mK=REAL_PACK_K_INS_W_MK,
        A_box_m2=REAL_PACK_A_BOX_M2_A * scale,
        p_heater_max_W=REAL_PACK_HEATER_MAX_W_A * scale,
    )
    battery = BatteryElement(
        capacity_J=capacity_Wh * J_PER_WH,
        initial_soc=1.0,
        specific_energy_Wh_per_kg=pack_specific_Wh_kg,
        chemistry=chemistry,
        n_series=ns,
        n_parallel=np_strings,
        thermal=thermal,
        soc_max=soc_max,
        eta_charge=eta_charge_override,
    )
    heater = PackHeaterLoad(
        battery,
        mass_kg=REAL_HEATER_INSTALL_KG_A * scale,
        label="pack-heater",
    )

    span_scale = max(float(design.span_m) / 5.65, 0.25)
    pv_harness = (
        HarnessSegment(
            "pv-feed", awg=16, length_oneway_m=1.0 * span_scale,
            n_connector_pairs=2,
        ),
    )
    drive_harness = (
        HarnessSegment(
            "drive-feed", awg=16, length_oneway_m=0.8 * span_scale,
            n_connector_pairs=2,
        ),
    )
    pv_peak_W = max(
        10.0,
        float(design.area_m2) * float(pv_packing) * float(pv_efficiency) * 1000.0,
    )
    mppt = MPPTConverter(p_rated_W=pv_peak_W, v_bus_V=REAL_V_BUS_V)
    array = PVArrayDiode(
        area_m2=design.area_m2,
        cell_efficiency_stc=pv_efficiency,
        packing_factor=pv_packing,
        tilt_deg=0.0,
        azimuth_deg=180.0,
        areal_density_kg_m2=design.pv_areal_density_kg_m2,
        pv_model="c60-single-diode",
        n_series_cells=REAL_PV_N_SERIES,
        mppt=mppt,
        pv_harness=pv_harness,
        diode_bin="I",
    )
    harness_mass_kg = harness_copper_mass_kg(pv_harness + drive_harness)
    mppt_night = PayloadLoad(
        mppt.night_parasitic_W(),
        mass_kg=harness_mass_kg,
        label="mppt-night-parasitic+harness-copper",
    )

    geom = _scaled_propeller(design.prop_diameter_m)
    requested_each_W = float(design.prop_max_electrical_W) / int(design.n_rotors)
    motor = _select_motor(requested_each_W)
    drive_resistance_ohm = sum(
        _segment_resistance_ohm(segment) for segment in drive_harness
    )
    thruster = BEMTThruster(
        geom,
        motor,
        EscParams(),
        v_bus_V=REAL_V_BUS_V,
        r_harness_ohm=drive_resistance_ohm,
        n_rotors=design.n_rotors,
        axis=np.array([1.0, 0.0, 0.0]),
    )

    metadata = {
        "model": "real",
        "storage_authority": "BatteryElement.step->PackEcm.step_power",
        "pack": {
            "chemistry": chemistry,
            "topology": f"{ns}s{np_strings}p",
            "capacity_Wh": battery.capacity_Wh,
            "mass_kg": battery.mass_kg,
            "pack_Wh_per_kg": battery.specific_energy_Wh_per_kg,
            "design_claim_Wh_per_kg": pack_claim_Wh_per_kg,
        },
        "pv": {
            "model": "c60-single-diode",
            "n_series_cells": REAL_PV_N_SERIES,
            "mppt_rated_W": mppt.p_rated_W,
            "v_bus_V": REAL_V_BUS_V,
        },
        "drive": {
            "model": "BEMT+motor+ESC+harness",
            "prop": geom.name,
            "motor": motor.name,
            "continuous_bus_ceiling_W": thruster.max_electrical_power_W,
            "requested_design_ceiling_W": design.prop_max_electrical_W,
            "r_harness_ohm": drive_resistance_ohm,
        },
        "billed_loads": [heater.label, mppt_night.label],
        "honesty": REAL_CHAIN_HONESTY,
    }
    return SolarChainAssembly(
        battery=battery,
        array=array,
        thruster=thruster,
        extra_loads=(heater, mppt_night),
        metadata=metadata,
    )


__all__ = [
    "REAL_CHAIN_HONESTY",
    "SolarChainAssembly",
    "build_real_solar_chain",
]
