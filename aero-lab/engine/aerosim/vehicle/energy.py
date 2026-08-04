"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | PVArray (plane-of-array transposition + powerplant PV chain) and BatteryElement (buffer over powerplant.battery_step).
2 | maintainer@emeraldcoastsystemsgroup.com   | MASS CLOSURE: BatteryElement now REQUIRES specific_energy_Wh_per_kg and PVArray REQUIRES areal_density_kg_m2, both range-checked; both elements declare mass into the vehicle budget. Fixed initial_soc being computed and then thrown away, which made every design start on a free full pack.
3 | maintainer@emeraldcoastsystemsgroup.com   | Added PayloadLoad, the shipped constant electrical draw. Every validation case needs an avionics/payload term and there was no public element for one, so validate.py carried a private _ConstantElectricalLoad -- a stand-in whose mass nobody billed. PayloadLoad requires its mass, so avionics is no longer a weightless watt sink.
4 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS (round-3 class fix). Measured exploits closed: BatteryElement(soc_max=3.0) constructed and turned a 16 kg pack into 940 Wh/kg effective (past the project's own fail-closed 500 Wh/kg pack ceiling) because mass is billed on nameplate but the integrator's upper rail was capacity*soc_max; eta_charge=eta_discharge=2.0 constructed and gave a measured storage ROUND TRIP of 4.0000. Now: 0 <= soc_min < soc_max <= 1 and each eta in (0, 1] with eta_charge*eta_discharge <= 1, all via the declared PARAM_BOUNDS tables in vehicle/param_bounds.py, re-checkable on a live instance. PVArray gains the same treatment (cell efficiency capped at 0.50 -- NREL best-research-cell multi-junction record is ~0.476 -- packing/mppt/albedo/thermo bounded) plus the EXPLICIT integrator-guard opt-in `non_mechanical_source = True` (frozen contract name), replacing exemption-by-attribute-name.
5 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4. (a) DERIVED-MASS CONSISTENCY: validate_cross_params on BatteryElement and PVArray now RE-DERIVES the billed mass from the live instance's own parameters (battery: capacity_J / specific energy; PV: area x areal density) and raises beyond 1e-6 relative -- measured exploit closed: post-construction capacity_J x3 at the stale 2.917 kg bill screened admissible at 723 Wh/kg EFFECTIVE; PVArray area x2 with the stale mass likewise. recheck_element_params calls validate_cross_params, so the param_bounds.py header's claim that billed quantities are re-checked at spec extraction is now TRUE for these elements. (b) TECHNOLOGY CATALOGUE (vehicle/tech_catalogue.py): the (cell_efficiency, areal_density) PAIR and the pack Wh/kg are checked against cited hardware frontiers in the same cross-params hooks -- individually-in-band but jointly-uncatalogued points (0.4999 concentrator efficiency at 0.15 kg/m2 thin film; a 499.9 Wh/kg pack) now refuse at construction AND at recheck. (c) eta_charge/eta_discharge upper bounds become EXCLUSIVE of 1.0 with cited real ceilings: MAX_ETA_CHARGE = 0.995 / MAX_ETA_DISCHARGE = 0.98 (see the constants for the citation); a 1.0 leg was a lossless store the physics does not sell. No band anywhere is loosened; every change tightens.
6 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): packing_factor's declared ceiling drops 1.0 -> MAX_PV_PACKING_FACTOR = 0.92 (vehicle/tech_catalogue.py). Measured: packing 0.999 was legal and rode the tolerance-compounding corner (0.32999 @ 0.1905 kg/m2) to +4.1% usable; the best flown layouts are AS-2's 0.802 and Zephyr-class ~0.90 -- taper, spar caps and control surfaces are not collectable area. Strictly tighter, no other bound moved.
7 | maintainer@emeraldcoastsystemsgroup.com   | REAL ELECTROCHEMISTRY (SPEC_chemistry, electrochem module). BatteryElement gains chemistry='ideal'|'nca_21700'|'amprius_si': the real chemistries run the vehicle/electrochem ECM (OCV(SOC) PCHIP knots, Arrhenius R_int with Ea = 26 kJ/mol, BU-410 C-rate tables, the below-0-C plating wall with logged spill, lumped pack thermal + thermostat heater, Schmalstieg/Amprius aging coupled back into C_nom and R_int) and REQUIRE n_series/n_parallel/thermal; passing eta_charge/eta_discharge with a real chemistry RAISES because the ECM owns the losses as I^2*R. DEFAULTING to 'ideal' now emits IdealChemistryWarning -- loud, never silent; explicit chemistry='ideal' keeps the flat-eta bucket bit-identical for regression. New PackHeaterLoad element bills the pack heater's electrical draw on the bus (a heater that heats without billing is a free-energy violation). validate_cross_params additionally requires (real mode) capacity_J within 5% of Ns*Np*cell nameplate and mass_kg >= Ns*Np*m_cell*1.10. PVArray and PayloadLoad are untouched.

WHY THE ENERGY SYSTEM NOW HAS MASS, AND WHY THERE IS NO DEFAULT
---------------------------------------------------------------
This module used to take capacity_J and area_m2 with no weight attached. Battery
watt-hours and panel square metres were therefore FREE design variables, and the
measured consequence was not subtle:

    case A pack 703 Wh -> 7030 Wh (about 28 kg of cells on a 6.93 kg aircraft):
      the case STILL PASSED, min_soc merely rose 0.4396 -> 0.9440.
    case C pack  70 Wh -> 5000 Wh: the negative-control quadcopter CLOSED.

The fix is a required argument, not a defaulted one. A default specific energy is
the same defect with a longer fuse: every design that forgets to state its
chemistry silently inherits somebody else's, and the sweep never sees an error.
Both arguments are keyword-only with no usable default -- omitting one raises
MassClosureError naming the constants in vehicle/mass.py that could be used.

BOTH ARE RANGE-CHECKED, because they are themselves numbers a sweep can vary: an
unbounded specific energy buys a massless pack one level up. See
MAX_CREDIBLE_PACK_WH_PER_KG and MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2 in mass.py.

CELL vs PACK: specific_energy_Wh_per_kg is a PACK-level number. Pack is typically
0.70-0.80 of cell (interconnects, BMS, fusing, case); mass.py carries both the
cell constants and pack_specific_energy_Wh_per_kg() to convert honestly. Case B's
narrated "450 Wh/kg" is Amprius's CELL number being used as a pack number, which
is exactly the fudge the two constant families exist to make visible.

WHY PVArray RE-DERIVES PLANE-OF-ARRAY IRRADIANCE
------------------------------------------------
env.solar() takes panel_tilt_deg / panel_azimuth_deg and returns a poa_Wm2 for
THAT orientation. But a vehicle can carry several arrays at different
orientations -- wing upper surface flat, a fuselage-side panel, a tilted tail
fin -- and the integrator calls env.solar() once per step, not once per panel.
Trusting the sample's poa_Wm2 would silently give every array the orientation of
whichever one happened to be asked for.

So PVArray transposes from the ORIENTATION-INDEPENDENT components the sample
also carries (dni_Wm2, dhi_Wm2, ghi_Wm2 and the sun angles) onto its own tilt
and azimuth, using the standard isotropic-sky model:

    cos(AOI) = sin(el) cos(tilt) + cos(el) sin(tilt) cos(az_sun - az_panel)
    POA = DNI max(0, cos AOI) + DHI (1 + cos tilt)/2 + GHI rho_g (1 - cos tilt)/2

Consistency check built into the algebra: at tilt = 0 this reduces to
DNI sin(el) + DHI = GHI exactly, so a flat array agrees with the sample's own
GHI with no tuning. The self-test asserts that identity numerically.

Isotropic sky is deliberately chosen over Perez/Hay-Davies: those need
circumsolar and horizon-brightening coefficients fitted to ground stations, and
at 20 km the diffuse fraction is small enough that the model choice is worth
under a percent of array output -- while the fitted models would import
unvalidated coefficients into a design sweep.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from .mass import (
    J_PER_WH,
    MAX_CREDIBLE_PACK_WH_PER_KG,
    MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2,
    MIN_CREDIBLE_PACK_WH_PER_KG,
    MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2,
    MassClosureError,
    PV_LAMINATED_FLEXIBLE_KG_M2,
    PACK_LI_ION_WH_PER_KG,
    battery_mass_kg,
    pv_array_mass_kg,
)
from .electrochem import (
    ALL_CHEMISTRIES,
    CELL_SPECS,
    PackEcm,
    PackThermalSpec,
    warn_defaulted_ideal,
)
from .param_bounds import Bounds, ParamBoundsError, validate_declared
from .tech_catalogue import (
    MAX_PV_PACKING_FACTOR,
    check_pack_technology,
    check_pv_technology_pair,
)
from .state import BodyState, ElementForce, as_offset

if TYPE_CHECKING:  # pragma: no cover
    from ..env import AtmoSample, SolarSample, WindSample


class _Required:
    """
    @description Sentinel for a constructor argument that has NO default. It
        exists so the failure can name the missing quantity and point at the
        sourced constants in mass.py instead of raising a bare TypeError. It is
        never a value: every code path that sees it raises.
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - diagnostic only
        return "<REQUIRED: no default, see aerosim.vehicle.mass>"


#: The no-default sentinel. See _Required.
REQUIRED: _Required = _Required()


#: Ceiling on battery CHARGE energy efficiency, dimensionless -- EXCLUSIVE of
#: 1.0 (round 4). Li-ion coulombic efficiency at low rate is ~0.999, but the
#: ENERGY efficiency of the charge leg pays charge-transfer overpotential plus
#: IR: >= ~0.5 % even at C/10 (standard Li-ion energy-efficiency measurements,
#: e.g. the ~94-95 % round trips reported for NCA/NMC cells split roughly
#: evenly between the legs). A 1.0 charge leg is a lossless store no cell
#: sells.
MAX_ETA_CHARGE: float = 0.995

#: Ceiling on battery DISCHARGE energy efficiency, dimensionless -- EXCLUSIVE
#: of 1.0 (round 4). Discharge delivery at cruise-class rates (C/5..C/2) runs
#: ~0.97-0.98 energy efficiency (same literature basis as MAX_ETA_CHARGE; the
#: discharge leg carries the larger IR share because bus voltage sags under
#: load).
MAX_ETA_DISCHARGE: float = 0.98


def plane_of_array_irradiance_Wm2(
    dni_Wm2: float,
    dhi_Wm2: float,
    ghi_Wm2: float,
    sun_elevation_rad: float,
    sun_azimuth_rad: float,
    panel_tilt_deg: float,
    panel_azimuth_deg: float,
    ground_albedo: float = 0.2,
) -> float:
    """
    @description Transpose orientation-independent irradiance components onto an
        arbitrarily oriented plane, W/m^2. Isotropic-sky diffuse model.
    @param dni_Wm2 Direct normal irradiance, W/m^2.
    @param dhi_Wm2 Diffuse horizontal irradiance, W/m^2.
    @param ghi_Wm2 Global horizontal irradiance, W/m^2.
    @param sun_elevation_rad Solar elevation above the horizon, radians.
    @param sun_azimuth_rad Solar azimuth, radians, clockwise from North.
    @param panel_tilt_deg Panel tilt from horizontal, degrees. 0 = facing up.
    @param panel_azimuth_deg Panel azimuth, degrees clockwise from North; 180 =
        facing South.
    @param ground_albedo Ground reflectance, dimensionless 0..1.
    @returns Plane-of-array irradiance, W/m^2, >= 0.
    """
    if sun_elevation_rad <= 0.0:
        # Sun below the horizon: no beam, and the diffuse components are
        # themselves zero in any physical solar model, so the array is dark.
        return 0.0

    tilt_rad = np.radians(panel_tilt_deg)
    panel_az_rad = np.radians(panel_azimuth_deg)

    cos_aoi = (
        np.sin(sun_elevation_rad) * np.cos(tilt_rad)
        + np.cos(sun_elevation_rad) * np.sin(tilt_rad)
        * np.cos(sun_azimuth_rad - panel_az_rad)
    )  # dimensionless

    beam_Wm2 = dni_Wm2 * max(0.0, float(cos_aoi))
    sky_diffuse_Wm2 = dhi_Wm2 * (1.0 + np.cos(tilt_rad)) / 2.0
    ground_reflected_Wm2 = ghi_Wm2 * ground_albedo * (1.0 - np.cos(tilt_rad)) / 2.0

    return float(max(0.0, beam_Wm2 + sky_diffuse_Wm2 + ground_reflected_Wm2))


class PayloadLoad:
    """
    @description A constant electrical draw with no force: avionics, autopilot,
        radios, a camera, a science payload. The one thing on the bus that is
        neither propulsion nor generation.

        It exists as a SHIPPED element because every real design has one and
        every validation case needs one. It previously lived in validate.py as a
        private stand-in, which meant the payload term the gate exercised was not
        the payload term a sweep would instantiate.

        MASS IS REQUIRED, not defaulted. A payload that draws watts and weighs
        nothing is a design an optimizer will happily load up: more payload draw
        costs only energy, never lift. Stating the mass makes the trade real.
        Pass mass_kg = 0.0 explicitly ONLY when the draw genuinely belongs to
        hardware already inside the body's structure mass -- that is a legal
        declaration of zero, and it is recorded as such in the mass budget rather
        than being silently assumed.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "power_W": Bounds(0.0, 1.0e6, unit="W",
                          why="a draw is billed in energy; bounded so inf/nan "
                              "cannot enter the bus"),
        "mass_kg": Bounds(0.0, 1.0e4, unit="kg",
                          why="zero is a LEGAL declared value (hardware inside "
                              "the structure mass) but must be finite and "
                              "non-negative"),
    }

    def __init__(
        self,
        power_W: float,
        body_index: int = 0,
        *,
        mass_kg: float | _Required = REQUIRED,
        label: str = "payload",
        offset_m: np.ndarray | None = None,
    ) -> None:
        """
        @description Construct a constant electrical load.
        @param power_W Electrical draw at the bus, W, >= 0. Reported as a
            NEGATIVE power_elec_W, per the ElementForce sign convention.
        @param body_index Index of the body carrying the payload.
        @param mass_kg REQUIRED, keyword-only, kg, >= 0. The installed mass of
            the hardware doing the drawing. Zero is legal but must be stated.
        @param label Human-readable name, carried into the mass budget detail.
        @param offset_m Offset from the body reference point, m (bookkeeping
            only; the force is exactly zero so the moment is zero too).
        @raises ValueError On a negative or non-finite draw.
        @raises MassClosureError When mass_kg is omitted or negative.
        """
        if isinstance(mass_kg, _Required):
            raise MassClosureError(
                "PayloadLoad requires mass_kg (kg) -- there is no default. A "
                "payload that draws watts and weighs nothing is free to grow: an "
                "optimizer pays for it in energy but never in lift. If the "
                "hardware is genuinely already inside the body's structure mass, "
                "pass mass_kg = 0.0 explicitly so the declaration is visible in "
                "the mass budget."
            )
        checked = validate_declared(type(self), power_W=power_W, mass_kg=mass_kg)

        self.power_W = checked["power_W"]
        self.body_index = int(body_index)
        self.mass_kg = checked["mass_kg"]
        self.label = str(label)
        self.offset_m = as_offset(offset_m)

    def mass_detail(self) -> str:
        """
        @description One-line derivation of this payload's mass for the budget
            report.
        @returns e.g. "avionics, 5.8 W draw, 0.150 kg".
        """
        return f"{self.label}, {self.power_W:.1f} W draw, {self.mass_kg:.3f} kg"

    def evaluate(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> ElementForce:
        """
        @description A constant bus draw, independent of state.
        @param bodies All vehicle bodies (unused).
        @param atmo Ambient atmosphere sample (unused).
        @param wind Local wind sample (unused).
        @param sol Local solar sample (unused).
        @param t_s Simulation time, s (unused).
        @param dt_s Timestep, s (unused).
        @returns ElementForce with force_N exactly zeros(3) and
            power_elec_W = -power_W (consumption).
        """
        return ElementForce(
            force_N=np.zeros(3),
            moment_Nm=np.zeros(3),
            power_elec_W=-self.power_W,
        )


class PVArray:
    """
    @description A photovoltaic array: the vehicle's only source of energy in
        archetypes 1 and 2. Produces electrical power and EXACTLY ZERO force --
        a solar panel laminated into a wing skin adds neither lift nor drag of
        its own, and pretending otherwise would double-count the wing's polar.

        It does, however, have WEIGHT. Zero force is not zero mass: the array is
        billed into the vehicle's mass budget at areal_density_kg_m2 x gross
        area, which is why growing the panel now costs lift and cruise power.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: EXPLICIT integrator-guard exemption contract -- THE FLAG NAME IS FROZEN
    #: as `non_mechanical_source`. The integrator's generation-reaction rule
    #: says an element converting MECHANICAL energy may not report more
    #: electrical generation than the mechanical power its own reaction force
    #: removes from the flow. A PV array converts SUNLIGHT, not flow momentum,
    #: so it legitimately generates with exactly zero force -- and it declares
    #: that exemption HERE, deliberately, as a class attribute. It is a
    #: DECLARED OPT-IN, never inferred from an attribute name (the previous
    #: scheme granted the exemption to anything exposing packing_factor /
    #: cell_efficiency_stc, which any hostile element could imitate for free).
    #: The integrator must require this flag AND still bound the claimed output
    #: against the irradiance actually available.
    non_mechanical_source: bool = True

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "area_m2": Bounds(0.0, 1000.0, unit="m2",
                          why="billed via pv_array_mass_kg; bounded so inf/nan "
                              "cannot ride the billed path"),
        # NREL best-research-cell chart: the all-time record is a ~47.6%
        # multi-junction concentrator cell; nothing laminatable on a wing
        # exceeds 0.35. 0.50 is the fail-closed edge of physics-as-demonstrated.
        "cell_efficiency_stc": Bounds(0.0, 0.50, lo_open=True, unit="-",
                                      why="multiplies harvest; NREL record "
                                          "cell is ~0.476"),
        # ROUND 5: capped at the technology catalogue's 0.92 -- best FLOWN
        # layouts are AS-2 0.802 and Zephyr-class ~0.90; a 0.999 packing
        # (measured corner rider) is a panel that has never been laid out.
        "packing_factor": Bounds(0.0, MAX_PV_PACKING_FACTOR, lo_open=True,
                                 unit="-",
                                 why="cells cannot cover taper, spar caps and "
                                     "control surfaces; best flown ~0.90 "
                                     "(Zephyr-class), AS-2 as-flown 0.802"),
        "tilt_deg": Bounds(0.0, 180.0, unit="deg",
                           why="0 = facing up, 180 = facing down; outside "
                               "this the orientation is double-counted"),
        "azimuth_deg": Bounds(-360.0, 360.0, unit="deg",
                              why="one full turn either way; beyond it is a "
                                  "units error"),
        "areal_density_kg_m2": Bounds(MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2,
                                      MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2,
                                      unit="kg/m2",
                                      why="mass DIVISOR band, mirrors "
                                          "mass.check_pv_areal_density_kg_m2"),
        "mppt_efficiency": Bounds(0.0, 1.0, lo_open=True, unit="-",
                                  why="an MPPT above 1 is a free energy "
                                      "multiplier"),
        "temp_coeff_per_K": Bounds(-0.02, 0.0, unit="1/K",
                                   why="silicon is -0.0029..-0.0045/K; a "
                                       "positive coefficient pays a bonus for "
                                       "hot cells"),
        "absorptivity": Bounds(0.0, 1.0, lo_open=True, unit="-",
                               why="surface property; >1 absorbs more than "
                                   "arrives"),
        "emissivity": Bounds(0.0, 1.0, lo_open=True, unit="-",
                             why="surface property; >1 out-radiates a "
                                 "blackbody"),
        "ground_albedo": Bounds(0.0, 1.0, unit="-",
                                why="reflectance; >1 reflects more than "
                                    "arrives"),
    }

    def __init__(
        self,
        area_m2: float,
        cell_efficiency_stc: float,
        packing_factor: float,
        tilt_deg: float = 0.0,
        azimuth_deg: float = 180.0,
        body_index: int = 0,
        *,
        areal_density_kg_m2: float | _Required = REQUIRED,
        mppt_efficiency: float = 0.95,
        temp_coeff_per_K: float = -0.004,
        absorptivity: float = 0.9,
        emissivity: float = 0.9,
        ground_albedo: float = 0.2,
        offset_m: np.ndarray | None = None,
    ) -> None:
        """
        @description Construct a PV array.
        @param area_m2 Gross array area, m^2 (before packing).
        @param cell_efficiency_stc Cell efficiency at Standard Test Conditions,
            dimensionless 0..1. ~0.24 for the SunPower-class cells AtlantikSolar
            used; ~0.30+ for multi-junction space cells.
        @param packing_factor Fraction of gross area actually covered by cells,
            dimensionless 0..1.
        @param tilt_deg Panel tilt from horizontal, degrees. 0 = facing up, which
            is the wing-skin case.
        @param azimuth_deg Panel azimuth, degrees clockwise from North.
        @param body_index Index of the body carrying the array.
        @param areal_density_kg_m2 REQUIRED, keyword-only, kg/m^2. Mass of the
            array per square metre of GROSS area. There is no default: an array
            without a stated areal density is a weightless energy source and a
            sweep will grow it without limit. Reference values in mass.py, all
            sourced: PV_LAMINATED_FLEXIBLE_KG_M2 = 0.40 (silicon cells +
            encapsulation, derived from 150 um wafers at 2330 kg/m^3),
            PV_MODULE_WITH_MPPT_KG_M2 = 0.72 (AtlantikSolar's complete module),
            PV_THIN_FILM_BLANKET_KG_M2 = 0.20 (space-grade thin film).
            Range-checked against MIN/MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2.
        @param mppt_efficiency Maximum-power-point-tracker efficiency,
            dimensionless 0..1.
        @param temp_coeff_per_K Power temperature coefficient, per KELVIN,
            referenced to 298.15 K. -0.004/K is the project's agreed -0.4%/degC.
        @param absorptivity Solar absorptivity for the cell thermal balance,
            dimensionless.
        @param emissivity IR emissivity for the cell thermal balance,
            dimensionless.
        @param ground_albedo Ground reflectance, dimensionless 0..1.
        @param offset_m Offset from the body reference point, m (bookkeeping
            only; the force is zero so the moment is zero too).
        """
        if isinstance(areal_density_kg_m2, _Required):
            raise MassClosureError(
                "PVArray requires areal_density_kg_m2 (kg/m2) -- there is no "
                "default. Without it the array has zero mass and a design sweep "
                "buys unlimited solar power for free. Sourced values in "
                "aerosim.vehicle.mass: PV_LAMINATED_FLEXIBLE_KG_M2 = "
                f"{PV_LAMINATED_FLEXIBLE_KG_M2:.2f} (silicon cells + "
                "encapsulation), PV_MODULE_WITH_MPPT_KG_M2 = 0.72 (complete "
                "AtlantikSolar module), PV_THIN_FILM_BLANKET_KG_M2 = 0.20 "
                "(space-grade thin film)."
            )

        checked = validate_declared(
            type(self),
            area_m2=area_m2,
            cell_efficiency_stc=cell_efficiency_stc,
            packing_factor=packing_factor,
            tilt_deg=tilt_deg,
            azimuth_deg=azimuth_deg,
            areal_density_kg_m2=areal_density_kg_m2,
            mppt_efficiency=mppt_efficiency,
            temp_coeff_per_K=temp_coeff_per_K,
            absorptivity=absorptivity,
            emissivity=emissivity,
            ground_albedo=ground_albedo,
        )

        self.area_m2 = checked["area_m2"]
        self.areal_density_kg_m2 = checked["areal_density_kg_m2"]
        #: Array mass, kg -- gross area x areal density. Range-checked (both
        #: here against PARAM_BOUNDS and in mass.py against the same band).
        self.mass_kg = pv_array_mass_kg(self.area_m2, self.areal_density_kg_m2)
        self.cell_efficiency_stc = checked["cell_efficiency_stc"]
        self.packing_factor = checked["packing_factor"]
        self.tilt_deg = checked["tilt_deg"]
        self.azimuth_deg = checked["azimuth_deg"]
        self.body_index = int(body_index)
        self.mppt_efficiency = checked["mppt_efficiency"]
        self.temp_coeff_per_K = checked["temp_coeff_per_K"]
        self.absorptivity = checked["absorptivity"]
        self.emissivity = checked["emissivity"]
        self.ground_albedo = checked["ground_albedo"]
        self.offset_m = as_offset(offset_m)

        #: Last computed plane-of-array irradiance, W/m^2 (diagnostic).
        self.last_poa_Wm2: float = 0.0
        #: Last computed cell temperature, K (diagnostic).
        self.last_cell_temp_K: float = 0.0

        # Cross-parameter constraints (round 4): derived-mass consistency and
        # the technology-catalogue joint frontier.
        self.validate_cross_params()

    def validate_cross_params(self) -> None:
        """
        @description Constraints a single (lo, hi) bound cannot express,
            re-runnable on a live instance by
            param_bounds.recheck_element_params (round-4 defense in depth):

            (a) DERIVED-MASS CONSISTENCY -- mass_kg must equal
                pv_array_mass_kg(area_m2, areal_density_kg_m2) to 1e-6
                relative. Measured exploit closed: area_m2 x2 on the LIVE
                element kept the stale 1.238 kg bill and screened admissible
                (usable 1.2457) -- twice the panel at half the billed density.
            (b) TECHNOLOGY CATALOGUE -- the (cell_efficiency_stc,
                areal_density_kg_m2) PAIR must sit within the frontier of
                hardware that exists together (tech_catalogue). Measured
                exploit closed: 0.4999 concentrator-record efficiency at
                0.15 kg/m2 thin-film density, each inside its scalar band,
                jointly a technology that has never existed.
        @returns None. Raises on violation.
        @raises ParamBoundsError When the billed mass is inconsistent with the
            billed area x density, or the technology pair is uncatalogued.
        """
        check_pv_technology_pair(self.cell_efficiency_stc, self.areal_density_kg_m2)
        derived_mass_kg = pv_array_mass_kg(self.area_m2, self.areal_density_kg_m2)
        if abs(self.mass_kg - derived_mass_kg) > 1.0e-6 * max(derived_mass_kg, 1e-12):
            raise ParamBoundsError(
                f"PVArray billed mass {self.mass_kg:g} kg is inconsistent with "
                f"its own parameters: {self.area_m2:g} m2 x "
                f"{self.areal_density_kg_m2:g} kg/m2 derives "
                f"{derived_mass_kg:.6f} kg. An area or density changed after "
                f"construction without re-billing the mass -- free panel is "
                f"the round-4 bypass exploit."
            )

    def mass_detail(self) -> str:
        """
        @description One-line derivation of this array's mass for the budget
            report.
        @returns e.g. "1.720 m2 x 0.400 kg/m2".
        """
        return f"{self.area_m2:.3f} m2 x {self.areal_density_kg_m2:.3f} kg/m2"

    def evaluate(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> ElementForce:
        """
        @description Electrical power generated by the array this step.

            The full chain, every stage from powerplant so there is no second
            copy of the physics: transpose irradiance to the array plane, solve
            the cell's steady-state temperature from its surface energy balance,
            then apply the STC efficiency, packing, temperature derate and MPPT
            efficiency.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample (for the convective cooling airspeed).
        @param sol Local solar sample.
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns ElementForce with force_N EXACTLY zeros(3) and power_elec_W >= 0.
        """
        from ..powerplant import cell_temperature_K, pv_power_W
        from .state import relative_airspeed_vector

        poa_Wm2 = plane_of_array_irradiance_Wm2(
            dni_Wm2=float(getattr(sol, "dni_Wm2", 0.0)),
            dhi_Wm2=float(getattr(sol, "dhi_Wm2", 0.0)),
            ghi_Wm2=float(getattr(sol, "ghi_Wm2", 0.0)),
            sun_elevation_rad=float(getattr(sol, "elevation_rad", 0.0)),
            sun_azimuth_rad=float(getattr(sol, "azimuth_rad", 0.0)),
            panel_tilt_deg=self.tilt_deg,
            panel_azimuth_deg=self.azimuth_deg,
            ground_albedo=self.ground_albedo,
        )
        self.last_poa_Wm2 = poa_Wm2

        body = bodies[self.body_index]
        airspeed_ms = float(np.linalg.norm(relative_airspeed_vector(body, wind)))

        cell_temp_K = cell_temperature_K(
            air_temp_K=float(atmo.T_K),
            irradiance_Wm2=poa_Wm2,
            V_ms=airspeed_ms,
            rho_kgm3=float(atmo.rho_kgm3),
            absorptivity=self.absorptivity,
            emissivity=self.emissivity,
        )
        self.last_cell_temp_K = cell_temp_K

        power_W = pv_power_W(
            irradiance_Wm2=poa_Wm2,
            area_m2=self.area_m2,
            cell_efficiency_stc=self.cell_efficiency_stc,
            packing_factor=self.packing_factor,
            cell_temp_K=cell_temp_K,
            mppt_efficiency=self.mppt_efficiency,
            temp_coeff_per_K=self.temp_coeff_per_K,
        )

        # force_N is constructed as an exact zero array, never as a computed
        # quantity that happens to round to zero. The acceptance test checks
        # identity with zeros(3), not closeness to it.
        return ElementForce(
            force_N=np.zeros(3),
            moment_Nm=np.zeros(3),
            power_elec_W=float(power_W),
        )


class BatteryElement:
    """
    @description An energy buffer. See OBJECTION 2 in state.py: a battery cannot
        be evaluated as a peer element because its power flow depends on the net
        of every other element, which it cannot observe from inside evaluate().
        It therefore reports zero force and zero power, and the integrator moves
        energy through it explicitly via `step()` (or Vehicle.step_batteries).

        Zero force is not zero mass. The pack is the single heaviest item on most
        of the archetypes this project sweeps -- 42 % of AtlantikSolar's all-up
        mass, 45 % of a Zephyr-class HAPS -- and it is now billed as such.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    #: MEASURED round-2 exploits these bounds close: soc_max=3.0 constructed
    #: and made a 16 kg pack cycle 940 Wh/kg effective (the mass is billed on
    #: nameplate, the integrator rail was capacity*soc_max); eta_charge =
    #: eta_discharge = 2.0 constructed and returned a 4.0000 storage round trip.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "capacity_J": Bounds(0.0, 3.6e10, lo_open=True, unit="J",
                             why="billed via battery_mass_kg; bounded so "
                                 "inf/nan cannot ride the billed path "
                                 "(3.6e10 J = 10 MWh)"),
        "initial_soc": Bounds(0.0, 1.0, unit="-",
                              why="a state of charge is a fraction of "
                                  "nameplate; above 1 is free stored energy"),
        "specific_energy_Wh_per_kg": Bounds(MIN_CREDIBLE_PACK_WH_PER_KG,
                                            MAX_CREDIBLE_PACK_WH_PER_KG,
                                            unit="Wh/kg",
                                            why="mass DIVISOR band, mirrors "
                                                "mass.check_pack_specific_"
                                                "energy_Wh_per_kg"),
        "eta_charge": Bounds(0.0, MAX_ETA_CHARGE, lo_open=True, unit="-",
                             why="above 1 the pack returns more than it "
                                 "stored (measured: 2.0/2.0 gave a 4.0000 "
                                 "round trip); 1.0 exactly is a lossless leg "
                                 "no cell sells -- see MAX_ETA_CHARGE"),
        "eta_discharge": Bounds(0.0, MAX_ETA_DISCHARGE, lo_open=True, unit="-",
                                why="above 1 the pack returns more than it "
                                    "stored; 1.0 exactly is a lossless leg "
                                    "no cell sells -- see MAX_ETA_DISCHARGE"),
        "soc_min": Bounds(0.0, 1.0, hi_open=True, unit="-",
                          why="the reserve floor is a fraction of nameplate"),
        "soc_max": Bounds(0.0, 1.0, lo_open=True, unit="-",
                          why="mass is billed on nameplate (soc = 1); a rail "
                              "above 1 is stored energy the pack never paid "
                              "for (measured: soc_max=3.0 = 940 Wh/kg "
                              "effective vs the 500 Wh/kg ceiling)"),
        "n_series": Bounds(1.0, 10000.0, unit="-",
                           why="cell count in series; the capacity/mass "
                               "cross-checks divide by it, so inf/nan/zero "
                               "cannot enter the pack topology"),
        "n_parallel": Bounds(1.0, 10000.0, unit="-",
                             why="parallel string count; same cross-check "
                                 "divisor rationale as n_series"),
    }

    def __init__(
        self,
        capacity_J: float,
        initial_soc: float = 1.0,
        body_index: int = 0,
        *,
        specific_energy_Wh_per_kg: float | _Required = REQUIRED,
        chemistry: str | None = None,
        n_series: int | None = None,
        n_parallel: int | None = None,
        thermal: PackThermalSpec | None = None,
        eta_charge: float | None = None,
        eta_discharge: float | None = None,
        soc_min: float = 0.05,
        soc_max: float = 1.0,
        offset_m: np.ndarray | None = None,
    ) -> None:
        """
        @description Construct a battery pack.

            CHEMISTRY CONTRACT (frozen): chemistry in {'ideal', 'nca_21700',
            'amprius_si'}. Omitting it falls back to 'ideal' and emits
            IdealChemistryWarning -- loud, never silent. A REAL chemistry
            requires n_series, n_parallel AND thermal, and REFUSES
            eta_charge/eta_discharge: the electrochem ECM owns the losses as
            I^2*R(SOC, T), so a flat eta on top would double-bill (or, worse,
            under-bill) the same physics. eta_charge/eta_discharge keep their
            0.95 defaults on the ideal path.
        @param capacity_J NAMEPLATE pack energy at soc = 1.0, joules. Mass is
            billed on this, not on the usable slice above soc_min: reserving a
            floor does not make the reserved cells lighter.
        @param initial_soc Initial state of charge, dimensionless, RANGE [0, 1]
            (out of range RAISES -- above 1 is free stored energy). Clipped
            into [soc_min, soc_max] and STORED as `self.initial_soc` -- see the
            note on the attribute; integrate.py reads it off the element.
        @param body_index Index of the body carrying the pack.
        @param specific_energy_Wh_per_kg REQUIRED, keyword-only, PACK-level
            Wh/kg. There is no default: a pack without a stated specific energy
            is weightless, and a sweep then buys unlimited storage. Sourced
            values in mass.py -- PACK_LI_ION_WH_PER_KG = 182 (243 Wh/kg cells at
            the typical 0.75 pack fraction), PACK_ATLANTIKSOLAR_WH_PER_KG = 241
            (703 Wh in a 2.92 kg pack, as flown), PACK_LI_PO_HOBBY_WH_PER_KG =
            200, PACK_SI_ANODE_WH_PER_KG = 337.5. Range-checked against
            MIN/MAX_CREDIBLE_PACK_WH_PER_KG, so an unbounded value cannot be used
            to make the pack massless one level up.
        @param eta_charge Charge efficiency, dimensionless (0, 0.995] -- the
            ceiling EXCLUDES 1.0 (round 4; see MAX_ETA_CHARGE for the cited
            basis). Out of range RAISES.
        @param eta_discharge Discharge efficiency, dimensionless (0, 0.98] --
            the ceiling EXCLUDES 1.0 (see MAX_ETA_DISCHARGE). Out of range
            RAISES. The PRODUCT of the two is the store-and-return round
            trip (0.9025 with defaults), is one of the six factors in negative
            control D, and is explicitly asserted <= 1 in
            validate_cross_params().
        @param soc_min Minimum usable state of charge, dimensionless [0, 1),
            strictly below soc_max. Out of range RAISES.
        @param soc_max Maximum state of charge, dimensionless (0, 1]. Out of
            range RAISES: mass is billed on nameplate, so a rail above 1 is
            stored energy the pack never paid for.
        @param offset_m Offset from the body reference point, m.
        """
        if isinstance(specific_energy_Wh_per_kg, _Required):
            raise MassClosureError(
                "BatteryElement requires specific_energy_Wh_per_kg (PACK-level "
                "Wh/kg) -- there is no default. Without it the pack has zero mass "
                "and a design sweep buys unlimited storage for free: 10x-ing case "
                "A's 703 Wh pack used to leave the aircraft at 6.93 kg and the "
                "case still passed. Sourced values in aerosim.vehicle.mass: "
                f"PACK_LI_ION_WH_PER_KG = {PACK_LI_ION_WH_PER_KG:.0f}, "
                "PACK_ATLANTIKSOLAR_WH_PER_KG = 241, "
                "PACK_LI_PO_HOBBY_WH_PER_KG = 200, PACK_SI_ANODE_WH_PER_KG = "
                "337.5; convert a CELL number with "
                "pack_specific_energy_Wh_per_kg(cell, PACK_FRACTION_TYPICAL)."
            )
        from ..powerplant import BatteryState

        if chemistry is None:
            warn_defaulted_ideal(
                f"BatteryElement({float(capacity_J) / J_PER_WH:.0f} Wh)")
            chemistry = "ideal"
        if chemistry not in ALL_CHEMISTRIES:
            raise ParamBoundsError(
                f"BatteryElement chemistry {chemistry!r} is unknown; legal "
                f"values are {sorted(ALL_CHEMISTRIES)} (frozen contract)."
            )
        real = chemistry != "ideal"
        if real and (eta_charge is not None or eta_discharge is not None):
            raise ParamBoundsError(
                f"BatteryElement(chemistry={chemistry!r}) refuses "
                f"eta_charge/eta_discharge: the electrochem ECM owns the "
                f"losses as I^2*R(SOC, T). A flat efficiency on top of the "
                f"real chain is the double-billing (or free-lunch) defect the "
                f"real model exists to remove."
            )
        if real and (n_series is None or n_parallel is None or thermal is None):
            raise MassClosureError(
                f"BatteryElement(chemistry={chemistry!r}) requires n_series, "
                f"n_parallel AND thermal (PackThermalSpec) -- the real model "
                f"bills capacity against Ns x Np x cell nameplate, weighs the "
                f"cells, and cannot survive a cold night without a declared "
                f"insulation + heater budget."
            )
        if real and not isinstance(thermal, PackThermalSpec):
            raise ParamBoundsError(
                f"BatteryElement thermal must be a PackThermalSpec, got "
                f"{type(thermal).__name__}"
            )

        maybe: dict[str, float] = {}
        if n_series is not None:
            maybe["n_series"] = n_series
        if n_parallel is not None:
            maybe["n_parallel"] = n_parallel
        checked = validate_declared(
            type(self),
            capacity_J=capacity_J,
            initial_soc=initial_soc,
            specific_energy_Wh_per_kg=specific_energy_Wh_per_kg,
            eta_charge=0.95 if eta_charge is None else eta_charge,
            eta_discharge=0.95 if eta_discharge is None else eta_discharge,
            soc_min=soc_min,
            soc_max=soc_max,
            **maybe,
        )
        for cnt in ("n_series", "n_parallel"):
            if cnt in checked and checked[cnt] != int(checked[cnt]):
                raise ParamBoundsError(
                    f"BatteryElement.{cnt} must be a whole cell count, got "
                    f"{checked[cnt]:g}"
                )

        #: The declared chemistry, one of ALL_CHEMISTRIES (frozen values).
        self.chemistry: str = chemistry
        self.capacity_J = checked["capacity_J"]
        self.specific_energy_Wh_per_kg = checked["specific_energy_Wh_per_kg"]
        #: Pack mass, kg -- nameplate energy / pack specific energy. Range-checked
        #: (both here against PARAM_BOUNDS and in mass.py against the same band).
        self.mass_kg = battery_mass_kg(self.capacity_J, self.specific_energy_Wh_per_kg)
        self.body_index = int(body_index)
        if not real:
            # The ideal bucket keeps the flat legs; a real pack deliberately
            # does NOT own eta attributes (recheck skips absent names, and
            # nothing on the real path may consult a flat efficiency).
            self.eta_charge = checked["eta_charge"]
            self.eta_discharge = checked["eta_discharge"]
        else:
            self.n_series = int(checked["n_series"])
            self.n_parallel = int(checked["n_parallel"])
            #: The pack thermal design (insulation, floors, heater rating).
            self.thermal = thermal
        self.soc_min = checked["soc_min"]
        self.soc_max = checked["soc_max"]
        self.offset_m = as_offset(offset_m)

        # Cross-parameter constraints (rail ordering + round trip <= 1 +, in
        # real mode, the Ns x Np nameplate/mass consistency).
        self.validate_cross_params()

        soc0 = float(np.clip(checked["initial_soc"], self.soc_min, self.soc_max))
        if real:
            #: The live electrochemical state machine (ECM + thermal + aging).
            self.ecm = PackEcm(
                chemistry, self.n_series, self.n_parallel, thermal,
                initial_soc=soc0, soc_min=self.soc_min, soc_max=self.soc_max,
            )
        #: THE STARTING STATE OF CHARGE, dimensionless, AS AN ATTRIBUTE.
        #: It used to be computed into self.state and never stored, so
        #: `hasattr(pack, "initial_soc")` was False and integrate.py's
        #: `getattr(el, "initial_soc", 1.0)` silently returned 1.0 for every
        #: pack ever built -- measured: initial_soc 0.05 / 0.50 / 1.00 all
        #: produced soc[0] = 1.0000. Every design therefore began the window on
        #: a free full pack, which is the same free-energy defect as a massless
        #: pack wearing different clothes. The value stored is the CLIPPED one,
        #: because that is the charge the pack actually starts with.
        self.initial_soc: float = soc0
        #: The unclipped argument, kept for diagnostics so a silent clip is
        #: still visible after the fact.
        self.initial_soc_requested: float = float(initial_soc)
        self.state = BatteryState(energy_J=soc0 * self.capacity_J, soc=soc0)
        #: Lowest state of charge seen so far, dimensionless (closure diagnostic).
        self.min_soc_seen: float = soc0

    def validate_cross_params(self) -> None:
        """
        @description Constraints a single (lo, hi) bound cannot express,
            re-runnable on a live instance by
            param_bounds.recheck_element_params (defense in depth):
            0 <= soc_min < soc_max <= 1, and the store-and-return round trip
            eta_charge * eta_discharge <= 1. The individual bounds
            already imply the product bound, but the product is what the
            round-2 exploit multiplied (measured round trip 4.0000), so it is
            asserted EXPLICITLY -- if either per-parameter bound is ever
            loosened, this check still refuses a >1 round trip.

            ROUND 4 additions, both re-derived from the LIVE instance so a
            bypass-built or post-construction-mutated pack is caught at
            recheck: (a) DERIVED-MASS CONSISTENCY -- mass_kg must equal
            battery_mass_kg(capacity_J, specific_energy_Wh_per_kg) to 1e-6
            relative (measured exploit: capacity_J x3 on the live element kept
            the stale 2.917 kg bill = 723 Wh/kg effective, screened
            admissible); (b) the PACK TECHNOLOGY FRONTIER -- specific energy
            must not exceed the catalogue's best cell x best packaging
            (tech_catalogue.check_pack_technology, 445.5 Wh/kg), closing the
            499.9 Wh/kg boundary-rider inside the 500 scalar backstop.
        @returns None. Raises on violation.
        @raises ParamBoundsError When the SOC rails are not strictly ordered,
            the round trip exceeds unity, the billed mass is inconsistent with
            the billed capacity/chemistry, or the chemistry is beyond the
            technology-catalogue frontier.
        """
        check_pack_technology(self.specific_energy_Wh_per_kg)
        derived_mass_kg = battery_mass_kg(
            self.capacity_J, self.specific_energy_Wh_per_kg
        )
        if abs(self.mass_kg - derived_mass_kg) > 1.0e-6 * max(derived_mass_kg, 1e-12):
            raise ParamBoundsError(
                f"BatteryElement billed mass {self.mass_kg:g} kg is inconsistent "
                f"with its own parameters: {self.capacity_Wh:.1f} Wh at "
                f"{self.specific_energy_Wh_per_kg:g} Wh/kg derives "
                f"{derived_mass_kg:.6f} kg. A capacity or chemistry changed "
                f"after construction without re-billing the mass -- the "
                f"effective {self.capacity_Wh / max(self.mass_kg, 1e-12):.0f} "
                f"Wh/kg pack is the round-4 bypass exploit."
            )
        if not (0.0 <= self.soc_min < self.soc_max <= 1.0):
            raise ParamBoundsError(
                f"BatteryElement SOC rails must satisfy 0 <= soc_min < soc_max "
                f"<= 1, got soc_min = {self.soc_min:g}, soc_max = "
                f"{self.soc_max:g}. Mass is billed on NAMEPLATE (soc = 1): a "
                f"rail above 1 stores energy the pack never paid for "
                f"(measured: soc_max = 3.0 made a 16 kg pack cycle 940 Wh/kg "
                f"effective, past the {MAX_CREDIBLE_PACK_WH_PER_KG:g} Wh/kg "
                f"fail-closed ceiling), and an inverted pair is an empty pack "
                f"wearing a full one's mass."
            )
        if hasattr(self, "eta_charge") and hasattr(self, "eta_discharge"):
            round_trip = self.eta_charge * self.eta_discharge
            if round_trip > 1.0:
                raise ParamBoundsError(
                    f"BatteryElement eta_charge * eta_discharge = {round_trip:g} "
                    f"> 1: the pack would return more energy than it stored "
                    f"(measured exploit: 2.0 x 2.0 gave a 4.0000 round trip)."
                )
        if getattr(self, "chemistry", "ideal") != "ideal":
            # REAL-MODE CONSISTENCY (frozen contract): the stated capacity
            # must BE the stated cells, and the billed mass must weigh at
            # least the bare cells plus the +10% pack overhead (SPEC 3.2,
            # HONESTY H10) -- a 445 Wh/kg CELL number worn as a PACK number
            # is exactly the fudge this check makes visible.
            spec = CELL_SPECS[self.chemistry]
            n_cells = int(self.n_series) * int(self.n_parallel)
            nameplate_J = n_cells * spec.nameplate_Wh * J_PER_WH
            if abs(self.capacity_J - nameplate_J) > 0.05 * nameplate_J:
                raise ParamBoundsError(
                    f"BatteryElement capacity_J = {self.capacity_J:g} J is not "
                    f"within 5% of its own cells: {self.n_series}s"
                    f"{self.n_parallel}p x {spec.nameplate_Wh:g} Wh "
                    f"({spec.name}) = {nameplate_J:g} J. State the topology "
                    f"the capacity actually comes from."
                )
            min_mass_kg = n_cells * spec.m_cell_kg * 1.10
            if self.mass_kg < min_mass_kg * (1.0 - 1.0e-9):
                raise ParamBoundsError(
                    f"BatteryElement billed mass {self.mass_kg:.4f} kg is "
                    f"below its own cells: {n_cells} x {spec.m_cell_kg:g} kg "
                    f"x 1.10 pack overhead = {min_mass_kg:.4f} kg "
                    f"({spec.name}; overhead per SPEC_chemistry 3.2, H10). "
                    f"The stated pack Wh/kg is better than the cells allow."
                )

    @property
    def capacity_Wh(self) -> float:
        """
        @description Nameplate pack energy, watt-hours.
        @returns Capacity, Wh.
        """
        return self.capacity_J / J_PER_WH

    def mass_detail(self) -> str:
        """
        @description One-line derivation of this pack's mass for the budget
            report.
        @returns e.g. "703.0 Wh / 241.0 Wh/kg (pack)".
        """
        return (
            f"{self.capacity_Wh:.1f} Wh / {self.specific_energy_Wh_per_kg:.1f} "
            f"Wh/kg (pack)"
        )

    @property
    def soc(self) -> float:
        """
        @description Current state of charge, dimensionless 0..1.
        @returns State of charge.
        """
        return float(self.state.soc)

    @property
    def energy_J(self) -> float:
        """
        @description Current stored energy, joules.
        @returns Stored energy, J.
        """
        return float(self.state.energy_J)

    def step(self, power_W: float, dt_s: float) -> float:
        """
        @description Advance the pack one timestep under a signed bus power.
        @param power_W Bus power, watts. Positive charges the pack.
        @param dt_s Timestep, seconds.
        @returns Unserved power, W: positive when generation could not be
            absorbed (pack full), negative when demand could not be met (pack
            empty). Ideal chemistry delegates entirely to
            powerplant.battery_step so the asymmetric charge/discharge
            efficiency lives in exactly one place; a real chemistry delegates
            to the electrochem PackEcm, where the losses are I^2*R(SOC, T),
            the BU-410 rate tables clip, and charge below 0 C is refused and
            logged (cold_charge_spill_J), never silently absorbed.
        """
        from ..powerplant import BatteryState, battery_step

        if self.chemistry != "ideal":
            unserved_W = self.ecm.step_power(float(power_W), float(dt_s))
            soc = float(self.ecm.soc)
            # Mirror into the frozen BatteryState so soc/energy_J diagnostics
            # keep one shape across both models (energy on NAMEPLATE; the
            # deliverable slice below it shrinks with cold and age inside the
            # ECM, which is the honest direction).
            self.state = BatteryState(energy_J=soc * self.capacity_J, soc=soc)
            self.min_soc_seen = min(self.min_soc_seen, soc)
            return float(unserved_W)

        self.state, unserved_W = battery_step(
            state=self.state,
            capacity_J=self.capacity_J,
            power_W=float(power_W),
            dt_s=float(dt_s),
            eta_charge=self.eta_charge,
            eta_discharge=self.eta_discharge,
            soc_min=self.soc_min,
            soc_max=self.soc_max,
        )
        self.min_soc_seen = min(self.min_soc_seen, float(self.state.soc))
        return float(unserved_W)

    def evaluate(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> ElementForce:
        """
        @description A battery exerts no force and, within one force pass,
            contributes no net electrical power (it is a buffer between the
            generators and the loads, and Vehicle.net excludes it by design).
            A REAL pack additionally advances its lumped thermal state from
            the ambient sample here (SPEC_chemistry 3.1) and sets
            last_heater_W -- which PackHeaterLoad bills on the bus; this
            element itself still reports exactly zero power.
        @returns ElementForce of exact zeros.
        """
        if self.chemistry != "ideal":
            self.ecm.advance_thermal(float(atmo.T_K), float(dt_s))
        return ElementForce(np.zeros(3), np.zeros(3), 0.0)

    # -- frozen post-step attributes (real electrochemistry) ----------------

    @property
    def pack_temp_K(self) -> float:
        """
        @description Lumped pack temperature, K (frozen contract attr). An
            ideal bucket has no temperature -- asking for one raises rather
            than inventing a comfortable number.
        @returns Pack temperature, K.
        @raises AttributeError On an ideal-chemistry pack.
        """
        if self.chemistry == "ideal":
            raise AttributeError(
                "an ideal-chemistry BatteryElement has no pack temperature; "
                "build it with chemistry='nca_21700' or 'amprius_si'"
            )
        return float(self.ecm.pack_temp_K)

    @property
    def last_heater_W(self) -> float:
        """
        @description Heater electrical power commanded this step, W (frozen
            contract attr; 0.0 on the ideal path -- no heater exists to run).
        @returns Heater draw, W.
        """
        return float(self.ecm.last_heater_W) if self.chemistry != "ideal" else 0.0

    @property
    def throughput_Ah(self) -> float:
        """
        @description Total per-cell charge throughput, Ah (frozen contract
            attr; the aging odometer). 0.0 on the ideal path.
        @returns Throughput, Ah.
        """
        return float(self.ecm.throughput_Ah) if self.chemistry != "ideal" else 0.0

    @property
    def capacity_fade_frac(self) -> float:
        """
        @description Permanent capacity fade, fraction of nameplate (frozen
            contract attr; calendar + cycle + plating). 0.0 on the ideal path.
        @returns Fade fraction, dimensionless.
        """
        return (float(self.ecm.capacity_fade_frac)
                if self.chemistry != "ideal" else 0.0)

    @property
    def resistance_growth_frac(self) -> float:
        """
        @description Permanent internal-resistance growth, fraction of fresh
            (frozen contract attr). 0.0 on the ideal path.
        @returns Growth fraction, dimensionless.
        """
        return (float(self.ecm.resistance_growth_frac)
                if self.chemistry != "ideal" else 0.0)

    @property
    def plating_violation_Ah(self) -> float:
        """
        @description Ah accepted below 0 C (frozen contract attr) -- nonzero
            ONLY when a caller explicitly forced cold charge past the wall.
        @returns Plated charge, Ah.
        """
        return (float(self.ecm.plating_violation_Ah)
                if self.chemistry != "ideal" else 0.0)

    @property
    def cold_charge_spill_J(self) -> float:
        """
        @description Energy refused at the below-0-C plating wall, J (frozen
            contract attr) -- spilled solar the mission ledger must show.
        @returns Spilled energy, J.
        """
        return (float(self.ecm.cold_charge_spill_J)
                if self.chemistry != "ideal" else 0.0)


class PackHeaterLoad:
    """
    @description The battery heater's presence on the power bus: bills
        -pack.last_heater_W every step, so the thermostat's watts appear in
        the energy budget the same way any payload draw does. A heater that
        heats without billing is a free-energy violation (SPEC_chemistry
        3.1) -- the pack's thermal model COMMANDS the heater, this element
        PAYS for it, and the existing free-energy guards see the flow.

        MASS IS REQUIRED: heater film, its wiring and the pack insulation
        weigh something (frozen contract), and a weightless heater is a free
        stratospheric night.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py). Frozen contract.
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible range for every numeric constructor parameter.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "mass_kg": Bounds(0.0, 100.0, lo_open=True, unit="kg",
                          why="heater film + wiring + insulation are real "
                              "hardware; zero mass would make the "
                              "stratospheric night free to survive"),
    }

    def __init__(
        self,
        pack: BatteryElement,
        *,
        mass_kg: float | _Required = REQUIRED,
        body_index: int = 0,
        label: str = "pack-heater",
        offset_m: np.ndarray | None = None,
    ) -> None:
        """
        @description Construct the heater's bus billing element.
        @param pack The BatteryElement whose last_heater_W this element bills
            (a real-chemistry pack; an ideal pack never commands heat, which
            makes this element a legal 0 W no-op on it).
        @param mass_kg REQUIRED, keyword-only, kg > 0: installed heater +
            insulation mass.
        @param body_index Index of the body carrying the heater.
        @param label Human-readable name for the mass budget.
        @param offset_m Offset from the body reference point, m (bookkeeping
            only; the force is exactly zero).
        @raises MassClosureError When mass_kg is omitted.
        @raises ParamBoundsError When mass_kg is out of band or pack is not a
            BatteryElement.
        """
        if isinstance(mass_kg, _Required):
            raise MassClosureError(
                "PackHeaterLoad requires mass_kg (kg) -- there is no default. "
                "Heater film, wiring and pack insulation weigh something; a "
                "weightless heater buys the stratospheric night for free."
            )
        if not isinstance(pack, BatteryElement):
            raise ParamBoundsError(
                f"PackHeaterLoad needs a BatteryElement to bill, got "
                f"{type(pack).__name__}"
            )
        checked = validate_declared(type(self), mass_kg=mass_kg)
        self.pack = pack
        self.mass_kg = checked["mass_kg"]
        self.body_index = int(body_index)
        self.label = str(label)
        self.offset_m = as_offset(offset_m)

    def mass_detail(self) -> str:
        """
        @description One-line derivation of this element's mass for the
            budget report.
        @returns e.g. "pack-heater + insulation, 0.180 kg".
        """
        return f"{self.label} + insulation, {self.mass_kg:.3f} kg"

    def evaluate(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> ElementForce:
        """
        @description Bill the pack's thermostat command on the bus.
        @param bodies All vehicle bodies (unused).
        @param atmo Ambient atmosphere sample (unused -- the PACK advances
            the thermal state; this element only pays the bill).
        @param wind Local wind sample (unused).
        @param sol Local solar sample (unused).
        @param t_s Simulation time, s (unused).
        @param dt_s Timestep, s (unused).
        @returns ElementForce with force_N exactly zeros(3) and
            power_elec_W = -pack.last_heater_W (consumption).
        """
        return ElementForce(
            force_N=np.zeros(3),
            moment_Nm=np.zeros(3),
            power_elec_W=-float(self.pack.last_heater_W),
        )
