"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation, carved out
  |                                           | of validate.py when that file reached
  |                                           | 1109 code lines against the project's
  |                                           | 1000-line hard cap. The seam is
  |                                           | deliberate: this module answers WHICH
  |                                           | VEHICLE, validate.py answers WHICH
  |                                           | VERDICT, and the two were tangled while
  |                                           | the cases were built from private
  |                                           | stand-ins.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 3: the wing now carries real mass
  |                                           | (vehicle/structure.py), so every builder
  |                                           | bills it: structure remainder = as-flown
  |                                           | total - elements - WING, and the
  |                                           | UndeclaredMassWarning suppressions are
  |                                           | DELETED -- every vehicle now passes
  |                                           | Vehicle.assert_mass_declared(). Case A's
  |                                           | 2.543 kg structure plug becomes wing
  |                                           | 2.293 kg + 0.250 kg pod/boom/tail, total
  |                                           | still the measured 6.93 kg. Case B: the
  |                                           | honest 19.96 kg wing makes the old fitted
  |                                           | 48 kg / 337.5 Wh/kg pack IMPOSSIBLE (it
  |                                           | no longer fits the 75 kg aircraft, and no
  |                                           | pack that fits closes -- measured, 122 Wh
  |                                           | short even at a 0.45 kg fuselage); the
  |                                           | case is re-pointed at 40 kg of 445.5
  |                                           | Wh/kg pack (Amprius 450 Wh/kg cell x the
  |                                           | 0.99 minimal-packaging fraction) and
  |                                           | relabeled a solution-existence demo, not
  |                                           | closure evidence -- see
  |                                           | validate.case_B_zephyr_s. Builders also
  |                                           | accept soc_max /
  |                                           | eta_charge / thruster_figure_of_merit
  |                                           | overrides so the round-3 constructor
  |                                           | guards can be mutation-tested through
  |                                           | the REAL builder path.

aerosim.validate_designs -- the vehicles the validation gate flies.

Every builder here assembles a Vehicle from PUBLIC aerosim.vehicle elements: the
exact objects a 30,000-design sweep instantiates. That is the whole point of the
module existing separately -- if a case cannot be expressed with shipped
elements, the fix is a missing feature in aerosim.vehicle, never a private
stand-in in the test suite. validate.assert_shipped_elements enforces it at
runtime on every case.

The ONE exception is _MagicGenerator, which is case E's adversary rather than a
vehicle component; its docstring carries the justification and the case discloses
it through a named allowance that appears in the JSON report.

MASS CLOSURE CONVENTION. Every builder states an AS-FLOWN total mass -- a
measured number for a real aircraft -- and derives the STRUCTURE mass as that
total minus every element's own declared mass. So growing the pack or the panel
really does eat the airframe, and a design whose elements outweigh the aircraft
raises instead of quietly flying anyway.

=============================================================================
UNITS -- every quantity carries SI units in its name or comment.
  *_m metres, *_m2 square metres, *_s seconds, *_h hours, *_K kelvin,
  *_N newtons, *_W watts, *_J joules, *_Wh watt-hours, *_kg kilograms,
  *_ms metres per second, *_deg degrees.
  Dimensionless: CL, CD, soc, Re, all eta_* and all *_scale factors.
=============================================================================
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import aeropolar, powerplant
from . import validate_bounds as bounds
from .env import atmosphere, day_length_h, make_uniform_field
from .integrate import EnvBundle
from .vehicle import (
    CELL_SI_ANODE_AMPRIUS_WH_PER_KG,
    PACK_ATLANTIKSOLAR_WH_PER_KG,
    PACK_FRACTION_MINIMAL_PACKAGING,
    PACK_LI_PO_HOBBY_WH_PER_KG,
    pack_specific_energy_Wh_per_kg,
    PV_LAMINATED_FLEXIBLE_KG_M2,
    PV_MODULE_WITH_MPPT_KG_M2,
    PV_THIN_FILM_BLANKET_KG_M2,
    AeroSurface,
    BatteryElement,
    BodyState,
    ElementForce,
    PayloadLoad,
    PVArray,
    Thruster,
    Vehicle,
    WindTurbine,
    WingGeometry,
)


# --------------------------------------------------------------------------- #
# Constants                                                                    #
# --------------------------------------------------------------------------- #

G0_MS2: float = 9.80665                 # standard gravity, m/s^2
SEC_PER_HOUR: float = 3600.0            # s/h
J_PER_WH: float = 3600.0                # J/Wh
DAY_S: float = 86400.0                  # s in one solar day
SLOW_DT_S: float = 60.0                 # s, slow-loop step

#: Electrical drive efficiencies. Individually named -- never one fudge factor.
ETA_MOTOR: float = 0.85                 # brushless motor, dimensionless
ETA_ESC: float = 0.95                   # speed controller, dimensionless

#: Blade profile efficiency of a CRUISE propeller, dimensionless. Thruster
#: applies its `figure_of_merit` as P_shaft = P_ideal / FM, which is the blade
#: PROFILE efficiency slot -- the same slot integrate._actuator_disk_power_W
#: fills with ETA_PROP_PROFILE = 0.85. Thruster's DEFAULT for that argument is
#: 0.65, which is a HOVER figure of merit; leaving it at the default on a
#: cruising aircraft measured 55.18 W against AtlantikSolar's published 40 W
#: (propulsive efficiency 0.466), while 0.85 measures 43.56 W (0.610). See
#: FINDINGS in the report. A hovering rotor is the one case where 0.65 is right,
#: and negative control C uses it.
ETA_PROP_CRUISE: float = 0.85
ETA_PROP_HOVER_FM: float = 0.65         # hover figure of merit, dimensionless

#: Electrical chain used to price the published-performance anchor: exactly the
#: chain the shipped Thruster runs on, so the anchor and the model are compared
#: on the same basis.
ETA_CHAIN_CRUISE: float = ETA_PROP_CRUISE * ETA_MOTOR * ETA_ESC

#: n_crit is a claim about the air the vehicle flies in, not a free knob. 11 is
#: the clean sailplane band.
N_CRIT_DEFAULT: float = 11.0

#: NACA 2412 -- a real 4-digit section, carried as Kulfan weights.
SECTION_CODE: str = "2412"

#: Randomised trajectories for case D's deep free-energy gate, dimensionless.
FREE_ENERGY_TRAJECTORIES: int = 60


class ValidationError(RuntimeError):
    """Raised when a case cannot be evaluated at all (as opposed to failing)."""


@dataclass
class _Build:
    """An assembled case: the vehicle, its world, and the reference numbers.

    @param vehicle The Vehicle, built from shipped elements only.
    @param env The environment bundle.
    @param reference The independent closed-form trim, or None for cases with
        no wing.
    @param meta Design-point bookkeeping (masses, site, bands, elements).
    """

    vehicle: Vehicle
    env: EnvBundle
    reference: Any
    meta: dict


def _sunset_utc_hour(latitude_deg: float, longitude_deg: float, day_of_year: int) -> float:
    """UTC hour of local sunset.

    @description Every closure case starts at sunset with a full battery: the
        only start that makes the vehicle survive a WHOLE night before it is
        allowed to recharge. Starting at midnight tests half a night.
    @param latitude_deg Degrees north, positive north.
    @param longitude_deg Degrees east, positive east.
    @param day_of_year 1..365.
    @returns UTC hour (h) of sunset; may fall outside 0..24, which is harmless
        because the solar hour angle is periodic.
    """
    length_h = float(day_length_h(latitude_deg, day_of_year))
    return (12.0 - longitude_deg / 15.0) + 0.5 * length_h


def _sanitize(obj: Any) -> Any:
    """Make a nested structure JSON-serialisable.

    @param obj Any object.
    @returns The same structure with numpy types and non-finite floats converted.
    """
    if isinstance(obj, dict):
        return {str(k): _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _sanitize(obj.tolist())
    if isinstance(obj, np.generic):          # covers np.bool_, np.float64, np.int64
        return _sanitize(obj.item())
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return str(obj)
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _sanitize(getattr(obj, k)) for k in obj.__dataclass_fields__}
    return obj


def _naca_geometry(
    span_m: float,
    area_m2: float,
    taper_ratio: float,
    sweep_deg: float,
    twist_root_deg: float,
    twist_tip_deg: float,
    code: str = SECTION_CODE,
) -> WingGeometry:
    """Build a WingGeometry whose section is carried as Kulfan weights.

    @description The design vector IS the geometry, so the section travels as a
        CST weight vector, never as a name a downstream module has to interpret.
    @param span_m Span, m.  @param area_m2 Reference area, m^2.
    @param taper_ratio Tip chord / root chord, dimensionless.
    @param sweep_deg Quarter-chord sweep, degrees.
    @param twist_root_deg Root twist, degrees.  @param twist_tip_deg Tip twist, degrees.
    @param code 4-digit NACA designation.
    @returns The WingGeometry.
    """
    up_w, lo_w, le_w, te_t = aeropolar.naca_kulfan(code)
    return WingGeometry(
        span_m=float(span_m), area_m2=float(area_m2), taper_ratio=float(taper_ratio),
        sweep_deg=float(sweep_deg), twist_root_deg=float(twist_root_deg),
        twist_tip_deg=float(twist_tip_deg),
        kulfan_upper=np.asarray(up_w, dtype=float),
        kulfan_lower=np.asarray(lo_w, dtype=float),
        leading_edge_weight=float(le_w), TE_thickness=float(te_t),
    )


# --------------------------------------------------------------------------- #
# Case E's adversary -- the ONE private class, and why it is legitimate         #
# --------------------------------------------------------------------------- #


class _MagicGenerator:
    """A zero-force element that manufactures electricity from nothing.

    @description THE ONE private class in this module, and it is not a stand-in
        for a shipped element -- it is the ATTACK. Case E exists to prove the
        integrator rejects it, so it must be something the product deliberately
        does NOT ship: a shipped magic generator would be the bug.

        It is the exact shape of the defect integrate._GENERATION_REACTION_RULE
        was written to catch: it reports positive electrical power while emitting
        exactly zero force, so it removes no momentum from the flow and pays for
        nothing. It also does not claim the photovoltaic exemption
        (``non_mechanical_source`` is absent, and it is not classified KIND_PV),
        because that exemption is the honest route for a solar array and this
        element is not one.

        Before the FATAL-3 fix the integrator computed the violation and then
        discarded it: this element produced a run reporting closed = True with
        min_soc = 1.0. Case E is the regression guard for that, and it is the
        only end-to-end coverage archetypes 3 and 4 have.

        It is disclosed to ``assert_shipped_elements`` through a named allowance,
        so the allowance appears in the JSON report rather than being silent.
    """

    def __init__(self, power_W: float = 1000.0, body_index: int = 0) -> None:
        """
        @description Construct the adversary.
        @param power_W Electricity to manufacture, W, > 0.
        @param body_index Body it pretends to sit on.
        """
        self.power_W = float(power_W)
        self.body_index = int(body_index)
        self.offset_m = np.zeros(3, dtype=float)
        #: It weighs nothing either -- declared, so mass closure stays complete
        #: and case E fails for the free-ENERGY reason, not a mass reason.
        self.MASSLESS_BY_CONSTRUCTION = True

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s) -> ElementForce:  # noqa: ANN001
        """
        @description Zero force, zero moment, positive power. Free energy.
        @returns ElementForce(zeros(3), zeros(3), +power_W).
        """
        return ElementForce(np.zeros(3), np.zeros(3), +self.power_W)


# --------------------------------------------------------------------------- #
# Builders -- vehicles assembled from shipped elements                          #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _SolarCruiseDesign:
    """Design point of a solar fixed-wing endurance aircraft. Every field sourced.

    @param name Case name.  @param span_m Span, m.  @param area_m2 Wing area, m^2.
    @param taper_ratio Dimensionless.  @param twist_root_deg / twist_tip_deg Degrees.
    @param extra_CD0 Non-wing parasite CD on wing area, dimensionless.
    @param mass_all_up_kg As-flown all-up mass, kg -- a MEASURED number; the
        structure mass is the remainder after every element declares its own.
    @param battery_mass_kg Pack mass, kg. Capacity is DERIVED from it and the
        chemistry, never stated independently.
    @param pack_Wh_per_kg Pack-level specific energy, Wh/kg.
    @param pv_efficiency Cell efficiency at STC, dimensionless.
    @param pv_packing Fraction of gross area covered by cells, dimensionless.
    @param pv_areal_density_kg_m2 Array mass per m^2 of gross area, kg/m^2.
    @param payload_W Avionics + payload draw, W.
    @param payload_mass_kg Avionics + payload mass, kg.
    @param prop_diameter_m One rotor's diameter, m.  @param n_rotors Count.
    @param prop_max_electrical_W Drive power limit, W.
    @param altitude_m Cruise altitude, m MSL.
    @param latitude_deg / longitude_deg Site, degrees.  @param day_of_year 1..365.
    """

    name: str
    span_m: float
    area_m2: float
    taper_ratio: float
    twist_root_deg: float
    twist_tip_deg: float
    extra_CD0: float
    mass_all_up_kg: float
    battery_mass_kg: float
    pack_Wh_per_kg: float
    pv_efficiency: float
    pv_packing: float
    pv_areal_density_kg_m2: float
    payload_W: float
    payload_mass_kg: float
    prop_diameter_m: float
    n_rotors: int
    prop_max_electrical_W: float
    altitude_m: float
    latitude_deg: float
    longitude_deg: float
    day_of_year: int


def build_solar_cruise(
    design: _SolarCruiseDesign,
    pv_efficiency_scale: float = 1.0,
    pack_specific_energy_scale: float = 1.0,
    extra_CD0_scale: float = 1.0,
    pv_packing_override: float | None = None,
    soc_max: float = 1.0,
    eta_charge: float = 0.95,
    thruster_figure_of_merit: float | None = None,
) -> _Build:
    """Assemble a solar endurance aircraft from SHIPPED elements only.

    @description The vehicle is AeroSurface + Thruster + PVArray + PayloadLoad +
        BatteryElement -- five public classes, no stand-ins. The wing's incidence
        is set to the solver's own best-endurance angle of attack, so the
        cruise CL, speed and Reynolds number are consequences of the polar rather
        than inputs to it.

        MASS CLOSURE (round 3): the wing is now a BILLED element -- AeroSurface
        derives its structural mass from the planform (Stender exponents
        calibrated to the measured AtlantikSolar airframe). The body's structure
        mass is therefore the as-flown total MINUS every element INCLUDING the
        wing: what remains is the fuselage/boom/tail line only. Growing the
        pack, the panel, the drive OR THE SPAN eats that remainder, and a design
        whose elements outweigh the aircraft raises. Every vehicle built here
        passes Vehicle.assert_mass_declared() -- nothing is suppressed.
    @param design The design point.
    @param pv_efficiency_scale Multiplier on cell efficiency, dimensionless
        (1.0 normally; the mutation harness moves it).
    @param pack_specific_energy_scale Multiplier on pack Wh/kg, dimensionless.
    @param extra_CD0_scale Multiplier on non-wing parasite drag, dimensionless.
    @param pv_packing_override Cell coverage fraction to use instead of the
        design's own, dimensionless 0..1, or None to keep the design value. It
        exists so a regression fixture can shrink the array on the REAL case-B
        vehicle instead of maintaining a divergent copy of it -- the copy is how
        a guard quietly stops testing what it was written for.
    @param soc_max Battery upper SOC rail, dimensionless (1.0 normally; the
        mutation harness sets 3.0 to prove BatteryElement raises at
        construction THROUGH this builder, not just in a unit test).
    @param eta_charge Battery charge efficiency, dimensionless (0.95 normally;
        the mutation harness sets 2.0 to prove the same).
    @param thruster_figure_of_merit Propeller profile-efficiency slot override,
        dimensionless, or None for ETA_PROP_CRUISE (the mutation harness sets
        5.0 to prove Thruster raises at construction).
    @raises ValidationError When the declared element masses -- wing included --
        exceed the as-flown mass, which would need a negative airframe.
    """
    extra_CD0 = design.extra_CD0 * float(extra_CD0_scale)
    geometry = _naca_geometry(
        design.span_m, design.area_m2, design.taper_ratio, 0.0,
        design.twist_root_deg, design.twist_tip_deg,
    )
    atmo = atmosphere(design.altitude_m)
    weight_N = design.mass_all_up_kg * G0_MS2

    # The INDEPENDENT reference: closed form, different algorithm, never used to
    # build the vehicle -- only to cross-check it and to feed the closed-form
    # bounds. See validate_bounds.reference_trim.
    reference = bounds.reference_trim(
        geometry=geometry, weight_N=weight_N, rho_kgm3=float(atmo.rho_kgm3),
        mu_Pas=float(atmo.mu_Pas), extra_CD0=extra_CD0, n_crit=N_CRIT_DEFAULT,
    )

    pack_Wh_per_kg = design.pack_Wh_per_kg * float(pack_specific_energy_scale)
    battery = BatteryElement(
        capacity_J=design.battery_mass_kg * pack_Wh_per_kg * J_PER_WH,
        initial_soc=1.0, specific_energy_Wh_per_kg=pack_Wh_per_kg,
        soc_max=soc_max, eta_charge=eta_charge,
    )
    pv_packing = (design.pv_packing if pv_packing_override is None
                  else float(pv_packing_override))
    array = PVArray(
        area_m2=design.area_m2,
        cell_efficiency_stc=design.pv_efficiency * float(pv_efficiency_scale),
        packing_factor=pv_packing, tilt_deg=0.0, azimuth_deg=180.0,
        areal_density_kg_m2=design.pv_areal_density_kg_m2,
    )
    thruster = Thruster(
        diameter_m=design.prop_diameter_m,
        max_electrical_power_W=design.prop_max_electrical_W,
        n_rotors=design.n_rotors,
        figure_of_merit=(ETA_PROP_CRUISE if thruster_figure_of_merit is None
                         else float(thruster_figure_of_merit)),
        eta_motor=ETA_MOTOR, eta_esc=ETA_ESC, axis=np.array([1.0, 0.0, 0.0]),
    )
    payload = PayloadLoad(
        design.payload_W, mass_kg=design.payload_mass_kg, label="avionics+payload",
    )
    # The wing is a BILLED element (round 3): construct it before the mass
    # closure so its structural mass comes out of the as-flown total like every
    # other element's. Its incidence is set after the reference trim below.
    surface = AeroSurface(geometry, incidence_deg=0.0, extra_CD0=extra_CD0,
                          n_crit=N_CRIT_DEFAULT)
    wing_mass_kg = surface.mass_kg
    element_mass_kg = (battery.mass_kg + array.mass_kg + thruster.mass_kg
                       + payload.mass_kg + wing_mass_kg)
    structure_mass_kg = design.mass_all_up_kg - element_mass_kg
    if structure_mass_kg <= 0.0:
        raise ValidationError(
            f"{design.name}: declared element mass {element_mass_kg:.3f} kg "
            f"(of which wing {wing_mass_kg:.3f} kg) exceeds the as-flown "
            f"{design.mass_all_up_kg:.3f} kg -- the fuselage/boom/tail would have "
            f"to weigh {structure_mass_kg:.3f} kg. The honest wing bill cannot be "
            f"absorbed by this design point."
        )

    surface.incidence_deg = surface.best_endurance_alpha_deg(
        reference.V_ms, float(atmo.rho_kgm3), float(atmo.mu_Pas)
    )

    body = BodyState(
        pos_m=np.array([0.0, 0.0, design.altitude_m], dtype=float),
        vel_ms=np.array([reference.V_ms, 0.0, 0.0], dtype=float),
        mass_kg=structure_mass_kg,
    )
    # No warning suppression: every element declares its mass, and the assert
    # below is the round-3 guarantee that stays true.
    vehicle = Vehicle(bodies=[body],
                      elements=[surface, thruster, array, payload, battery])
    vehicle.assert_mass_declared()

    env = EnvBundle(
        wind=make_uniform_field(0.0, 0.0, 0.0),
        latitude_deg=design.latitude_deg, longitude_deg=design.longitude_deg,
        day_of_year=design.day_of_year,
        utc_hour_at_t0_h=_sunset_utc_hour(design.latitude_deg, design.longitude_deg,
                                          design.day_of_year),
    )
    meta = {
        "design": _sanitize(design),
        "scales": {"pv_efficiency": pv_efficiency_scale,
                   "pack_specific_energy": pack_specific_energy_scale,
                   "extra_CD0": extra_CD0_scale,
                   "soc_max": soc_max, "eta_charge": eta_charge,
                   "thruster_figure_of_merit": thruster_figure_of_merit},
        "pv_packing_effective": pv_packing,
        "extra_CD0_effective": extra_CD0,
        "incidence_deg": surface.incidence_deg,
        "battery_capacity_Wh": battery.capacity_Wh,
        "mass_kg": {
            "as_flown_total": design.mass_all_up_kg,
            "wing_structural": wing_mass_kg,
            "fuselage_boom_tail_remainder": structure_mass_kg,
            "structure_fraction": ((structure_mass_kg + wing_mass_kg)
                                   / design.mass_all_up_kg),
            "battery": battery.mass_kg, "pv_array": array.mass_kg,
            "propulsion": thruster.mass_kg, "payload": payload.mass_kg,
            "declared_elements": element_mass_kg,
            "battery_fraction": battery.mass_kg / design.mass_all_up_kg,
            "derived_total": vehicle.total_mass_kg(),
        },
        "mass_budget": str(vehicle.mass_budget()),
        "undeclared_mass_elements": vehicle.undeclared_element_names(),
        "atmosphere": {"rho_kgm3": float(atmo.rho_kgm3), "T_K": float(atmo.T_K),
                       "mu_Pas": float(atmo.mu_Pas)},
        "day_length_h": float(day_length_h(design.latitude_deg, design.day_of_year)),
        "site": {"lat_deg": design.latitude_deg, "lon_deg": design.longitude_deg,
                 "day_of_year": design.day_of_year, "altitude_m": design.altitude_m},
        "aspect_ratio": design.span_m ** 2 / design.area_m2,
        "eta_chain_cruise": ETA_CHAIN_CRUISE,
    }
    return _Build(vehicle=vehicle, env=env, reference=reference, meta=meta)


#: AtlantikSolar AS-2, as flown for 81.5 h from 14 July 2015 near Rafz,
#: Switzerland (Oettershagen et al., J. Field Robotics 35(4), 2018): 5.65 m span,
#: 1.72 m^2 wing, 6.93 kg, 88 SunPower E60 cells at 23.7 % over 1.38 m^2
#: (packing 0.802), 703 Wh pack, 5.8 W avionics.
DESIGN_A = _SolarCruiseDesign(
    name="A_AtlantikSolar", span_m=5.65, area_m2=1.72, taper_ratio=0.7,
    twist_root_deg=2.0, twist_tip_deg=0.0, extra_CD0=0.006,
    mass_all_up_kg=6.93,
    battery_mass_kg=703.0 / PACK_ATLANTIKSOLAR_WH_PER_KG,
    pack_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG,
    pv_efficiency=0.237, pv_packing=0.802,
    pv_areal_density_kg_m2=PV_MODULE_WITH_MPPT_KG_M2,
    payload_W=5.8, payload_mass_kg=0.150,
    prop_diameter_m=0.36, n_rotors=1, prop_max_electrical_W=150.0,
    altitude_m=500.0, latitude_deg=47.6, longitude_deg=8.5, day_of_year=195,
)

#: Zephyr S class HAPS: 25 m span and 75 kg all-up are the PUBLISHED Airbus
#: Zephyr S figures (wing loading 3.6 kg/m^2); 20.8 m^2 makes aspect ratio 30;
#: 20 km on the solstice at 10 N. THE PACK IS THE DECLARED ASSUMPTION, not a
#: published number: 40 kg (53 % battery fraction, inside the 45-55 % HAPS band)
#: at 445.5 Wh/kg pack level = the published Amprius 450 Wh/kg silicon-anode
#: CELL (shipped to HAPS programmes) x the 0.99 minimal-packaging pack fraction
#: AtlantikSolar demonstrated by bonding cells into the airframe. mass.py warns
#: "never assume 0.99 for a new design" -- case B assumes it ANYWAY, on purpose,
#: which is exactly why validate.case_B_zephyr_s is labelled a solution-existence
#: demonstration and NOT closure evidence. MEASURED boundary (round 3, honest
#: 19.96 kg wing billed): at the catalogued PACK_SI_ANODE_WH_PER_KG = 337.5 the
#: design cannot close at ANY pack that fits the 75 kg aircraft -- 46.5 kg
#: (a 0.45 kg fuselage) is still 122 Wh short on the limit cycle.
DESIGN_B = _SolarCruiseDesign(
    name="B_ZephyrS", span_m=25.0, area_m2=20.8, taper_ratio=0.7,
    twist_root_deg=2.0, twist_tip_deg=0.0, extra_CD0=0.004,
    mass_all_up_kg=75.0, battery_mass_kg=40.0,
    pack_Wh_per_kg=pack_specific_energy_Wh_per_kg(
        CELL_SI_ANODE_AMPRIUS_WH_PER_KG, PACK_FRACTION_MINIMAL_PACKAGING),
    pv_efficiency=0.24, pv_packing=0.90,
    pv_areal_density_kg_m2=PV_THIN_FILM_BLANKET_KG_M2,
    payload_W=50.0, payload_mass_kg=3.0,
    prop_diameter_m=1.0, n_rotors=2, prop_max_electrical_W=1500.0,
    altitude_m=20000.0, latitude_deg=10.0, longitude_deg=0.0, day_of_year=172,
)


def build_quadcopter_hover(
    pv_efficiency_scale: float = 1.0,
    pack_specific_energy_scale: float = 1.0,
) -> _Build:
    """Assemble negative control C: a 1 kg solar quadcopter, from shipped elements.

    @description Thruster + PVArray + PayloadLoad + BatteryElement. The lifting
        rotor is the SHIPPED Thruster with axis [0,0,1] and the hover figure of
        merit 0.65 -- the one configuration where 0.65 is the right number,
        because here it really is a hover.

        The panel is deliberately OVER-credited: 0.42 m^2 gross is 47 % larger
        than the 0.285 m^2 circumscribed footprint of a 0.53 m quad, and the site
        is the most favourable in the suite. Over-crediting a negative control is
        the conservative direction.
    @param pv_efficiency_scale Multiplier on cell efficiency, dimensionless.
    @param pack_specific_energy_scale Multiplier on pack Wh/kg, dimensionless.
    @returns The assembled _Build (reference is None: this vehicle has no wing).
    """
    mass_all_up_kg = 1.0
    n_rotors, rotor_diameter_m = 4, 0.254
    disk_area_m2 = n_rotors * math.pi * (rotor_diameter_m / 2.0) ** 2
    altitude_m, latitude_deg, longitude_deg, day_of_year = 0.0, 10.0, 0.0, 172
    pack_Wh_per_kg = PACK_LI_PO_HOBBY_WH_PER_KG * float(pack_specific_energy_scale)

    thruster = Thruster(
        diameter_m=rotor_diameter_m, max_electrical_power_W=400.0,
        n_rotors=n_rotors, figure_of_merit=ETA_PROP_HOVER_FM,
        eta_motor=ETA_MOTOR, eta_esc=ETA_ESC, axis=np.array([0.0, 0.0, 1.0]),
    )
    array = PVArray(
        area_m2=0.42, cell_efficiency_stc=0.237 * float(pv_efficiency_scale),
        packing_factor=0.85, tilt_deg=0.0, azimuth_deg=180.0,
        areal_density_kg_m2=PV_LAMINATED_FLEXIBLE_KG_M2,
    )
    battery = BatteryElement(capacity_J=70.0 * J_PER_WH, initial_soc=1.0,
                             specific_energy_Wh_per_kg=pack_Wh_per_kg)
    payload = PayloadLoad(2.0, mass_kg=0.050, label="flight controller")
    element_mass_kg = (thruster.mass_kg + array.mass_kg + battery.mass_kg
                       + payload.mass_kg)
    structure_mass_kg = mass_all_up_kg - element_mass_kg
    if structure_mass_kg <= 0.0:
        raise ValidationError(
            f"case C: declared element mass {element_mass_kg:.4f} kg exceeds the "
            f"1.0 kg airframe"
        )

    body = BodyState(pos_m=np.array([0.0, 0.0, altitude_m], dtype=float),
                     vel_ms=np.zeros(3, dtype=float), mass_kg=structure_mass_kg)
    vehicle = Vehicle(bodies=[body], elements=[thruster, array, payload, battery])
    vehicle.assert_mass_declared()
    env = EnvBundle(
        wind=make_uniform_field(0.0, 0.0, 0.0), latitude_deg=latitude_deg,
        longitude_deg=longitude_deg, day_of_year=day_of_year,
        utc_hour_at_t0_h=_sunset_utc_hour(latitude_deg, longitude_deg, day_of_year),
    )
    rho0_kgm3 = float(atmosphere(altitude_m).rho_kgm3)
    meta = {
        "site": {"lat_deg": latitude_deg, "lon_deg": longitude_deg,
                 "day_of_year": day_of_year, "altitude_m": altitude_m},
        "rotors": {"count": n_rotors, "diameter_m": rotor_diameter_m,
                   "total_disk_area_m2": disk_area_m2,
                   "figure_of_merit": ETA_PROP_HOVER_FM},
        "mass_kg": {"as_flown_total": mass_all_up_kg,
                    "structure_remainder": structure_mass_kg,
                    "thruster": thruster.mass_kg, "pv_array": array.mass_kg,
                    "battery": battery.mass_kg, "payload": payload.mass_kg,
                    "derived_total": vehicle.total_mass_kg()},
        "mass_budget": str(vehicle.mass_budget()),
        "undeclared_mass_elements": vehicle.undeclared_element_names(),
        # Two INDEPENDENT hover-power computations: validate_bounds' closed form
        # (no powerplant call) and the shipped Thruster's own actuator disk.
        "hover_ideal_power_W": bounds.ideal_hover_power_W(
            mass_all_up_kg * G0_MS2, rho0_kgm3, disk_area_m2),
        "hover_electrical_power_W": thruster.electrical_power_W(
            mass_all_up_kg * G0_MS2, 0.0, rho0_kgm3),
        "hover_powerplant_cross_check_W": float(powerplant.hover_power_W(
            mass_all_up_kg * G0_MS2, rho0_kgm3, disk_area_m2,
            ETA_PROP_HOVER_FM, ETA_MOTOR, ETA_ESC)),
        "pv": {"gross_area_m2": 0.42, "packing": 0.85,
               "airframe_footprint_m2": 0.285,
               "note": "canopy deliberately 47 % larger than the airframe footprint"},
        "battery_capacity_Wh": battery.capacity_Wh,
        "day_length_h": float(day_length_h(latitude_deg, day_of_year)),
    }
    return _Build(vehicle=vehicle, env=env, reference=None, meta=meta)


def build_turbine_free_flier() -> _Build:
    """Assemble negative control D: a turbine on a free-flier in UNIFORM wind.

    @description AeroSurface + WindTurbine + Thruster + BatteryElement, all
        shipped. The turbine is the SHIPPED WindTurbine, whose extraction and
        momentum-theory reaction drag come from one cp through powerplant, and
        the station-keeping is the SHIPPED Thruster driven by the integrator's
        own autothrottle -- not a private class that priced its own thrust.

        The wing carries real drag rather than the old ``_IdealLiftSupport``'s
        drag-free idealisation. That is the honest direction for a negative
        control: real drag only pushes the ratio further below 1.0.
    @returns The assembled _Build.
    """
    altitude_m = 1000.0
    atmo = atmosphere(altitude_m)
    rho_kgm3 = float(atmo.rho_kgm3)
    mass_all_up_kg = 5.0
    wind_u_ms, airspeed_ms = 8.0, 15.0
    swept_area_m2, cp, eta_gen = 0.5, 0.40, 0.90
    extra_CD0 = 0.010

    bounds.assert_below_betz(cp)
    geometry = _naca_geometry(3.0, 0.6, 0.7, 0.0, 2.0, 0.0)
    turbine = WindTurbine(swept_area_m2=swept_area_m2, generator_rated_power_W=600.0,
                          cp=cp, eta_gen=eta_gen)
    battery = BatteryElement(capacity_J=1.0e6, initial_soc=1.0,
                             specific_energy_Wh_per_kg=PACK_LI_PO_HOBBY_WH_PER_KG)
    thruster = Thruster(diameter_m=0.4, max_electrical_power_W=3000.0,
                        figure_of_merit=ETA_PROP_CRUISE, eta_motor=ETA_MOTOR,
                        eta_esc=ETA_ESC, axis=np.array([1.0, 0.0, 0.0]))
    surface = AeroSurface(geometry, incidence_deg=0.0, extra_CD0=extra_CD0,
                          n_crit=N_CRIT_DEFAULT)
    # The wing is billed like every other element (round 3): the 3.0 m / 0.6 m2
    # planform costs its Stender/AS-2 mass, and the structure line is what is
    # left of the 5.0 kg after ALL declared elements.
    element_mass_kg = (turbine.mass_kg + battery.mass_kg + thruster.mass_kg
                       + surface.mass_kg)
    structure_mass_kg = mass_all_up_kg - element_mass_kg
    if structure_mass_kg <= 0.0:
        raise ValidationError(
            f"case D: declared element mass {element_mass_kg:.3f} kg (of which "
            f"wing {surface.mass_kg:.3f} kg) exceeds the {mass_all_up_kg:.1f} kg "
            f"as-flown mass"
        )

    surface.incidence_deg = surface.trim_alpha_for_lift_N(
        mass_all_up_kg * G0_MS2, airspeed_ms, rho_kgm3, float(atmo.mu_Pas)
    )
    body = BodyState(
        pos_m=np.array([0.0, 0.0, altitude_m], dtype=float),
        # Ground velocity = wind + airspeed, so the turbine sees exactly
        # `airspeed_ms` of relative flow whatever the wind is.
        vel_ms=np.array([wind_u_ms + airspeed_ms, 0.0, 0.0], dtype=float),
        mass_kg=structure_mass_kg,
    )
    # No warning suppression: every element declares its mass.
    vehicle = Vehicle(bodies=[body],
                      elements=[surface, turbine, thruster, battery])
    vehicle.assert_mass_declared()
    env = EnvBundle(
        wind=make_uniform_field(wind_u_ms, 0.0, 0.0), latitude_deg=10.0,
        longitude_deg=0.0, day_of_year=172, utc_hour_at_t0_h=0.0,
    )
    meta = {
        "wind_field": {"type": "uniform", "u_ms": wind_u_ms,
                       "note": "one reference frame only -- extraction is forbidden"},
        "operating_point": {"relative_airspeed_ms": airspeed_ms,
                            "rho_kgm3": rho_kgm3, "swept_area_m2": swept_area_m2,
                            "altitude_m": altitude_m},
        "turbine": {"cp": cp, "eta_gen": eta_gen,
                    "axial_induction": turbine.axial_induction(),
                    "thrust_coefficient": 4.0 * turbine.axial_induction()
                    * (1.0 - turbine.axial_induction()),
                    "shaft_power_W": turbine.shaft_power_W(airspeed_ms, rho_kgm3),
                    "reaction_drag_N": turbine.reaction_drag_N(airspeed_ms, rho_kgm3),
                    "mass_kg": turbine.mass_kg, "mass_detail": turbine.mass_detail()},
        "mass_kg": {"as_flown_total": mass_all_up_kg,
                    "wing_structural": surface.mass_kg,
                    "structure_remainder": structure_mass_kg,
                    "derived_total": vehicle.total_mass_kg()},
        "incidence_deg": surface.incidence_deg,
        "extra_CD0": extra_CD0,
        "efficiencies": {"cp": cp, "eta_gen": eta_gen,
                         "eta_charge": battery.eta_charge,
                         "eta_discharge": battery.eta_discharge,
                         "eta_motor": thruster.eta_motor, "eta_esc": thruster.eta_esc,
                         "eta_prop_profile": thruster.figure_of_merit},
    }
    return _Build(vehicle=vehicle, env=env, reference=None, meta=meta)


def build_magic_generator() -> _Build:
    """Assemble adversarial control E: AtlantikSolar plus a magic generator.

    @description The airframe is case A's, built from shipped elements by the
        shared builder, flown in STILL AIR at night with one ``_MagicGenerator``
        bolted on. Every physics invariant says a free-flier in a uniform field
        (still air is one) extracts exactly zero, so the +1000 W the adversary
        reports must be rejected.
    @returns The assembled _Build; its vehicle carries the ONE allowed private
        element, which the case discloses to assert_shipped_elements.
    """
    build = build_solar_cruise(DESIGN_A)
    # No suppression needed: the adversary declares MASSLESS_BY_CONSTRUCTION, so
    # the budget stays complete and the assert below still holds -- case E must
    # fail for the free-ENERGY reason, never a mass bookkeeping one.
    build.vehicle.elements.append(_MagicGenerator(power_W=1000.0))
    build.vehicle.bind_masses()
    build.vehicle.assert_mass_declared()
    # Still air, at local midnight, so nothing solar can mask the manufactured
    # power: the ONLY generation available is the adversary's.
    build.env = EnvBundle(
        wind=make_uniform_field(0.0, 0.0, 0.0),
        latitude_deg=DESIGN_A.latitude_deg, longitude_deg=DESIGN_A.longitude_deg,
        day_of_year=DESIGN_A.day_of_year,
        utc_hour_at_t0_h=(0.0 - DESIGN_A.longitude_deg / 15.0),
    )
    build.meta["adversary"] = {
        "class": "_MagicGenerator", "power_W": 1000.0,
        "force_N": [0.0, 0.0, 0.0],
        "why_private": "it is the attack, not a stand-in: a SHIPPED magic "
                       "generator would itself be the bug",
    }
    return build
