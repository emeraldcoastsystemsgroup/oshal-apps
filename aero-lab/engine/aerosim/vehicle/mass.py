"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module: the mass-closure layer. Sourced specific-energy / areal-density / linear-density constants, the element mass-declaration protocol, per-body aggregation, the MassBudget record, and the credibility bounds that stop an optimizer from buying a massless pack.
2 | maintainer@emeraldcoastsystemsgroup.com   | Header truth update: the "AeroSurface is undeclared" statement is no longer true -- the wing mass model landed in vehicle/structure.py and AeroSurface now declares real mass. No code change in this file.
2 | maintainer@emeraldcoastsystemsgroup.com   | Credible bands for the gravimetric-power DIVISORS (motor / ESC / generator-class specific power). Round 2 found the class: any divided-by constructor number an optimizer can raise is a mass discount -- motor_specific_power_W_per_kg = 1e9 was a weightless drive. Bands are fail-closed like the pack ceiling; enforced by the elements through vehicle/param_bounds.py.

WHY THIS MODULE EXISTS
----------------------
Before it, BatteryElement took capacity_J with no mass and PVArray took area_m2
with no mass, so a design sweep could set battery Wh and panel area to any value
at ZERO weight cost. Measured consequence on the validation cases:

    case A battery 703 Wh -> 7030 Wh  (about 28 kg of cells on a 6.93 kg
    aircraft):  STILL PASSED, min_soc rose 0.4396 -> 0.9440, margin unchanged.
    case C battery  70 Wh -> 5000 Wh: the negative-control quadcopter CLOSED.

That is not a missing test. It is a missing conservation law: energy storage and
energy collection are the two things a sweep will always max out, and neither was
billed. Over 30,000 candidates an optimizer drives both to infinity and every
marginal design "closes".

THE THREE THINGS THIS MODULE DOES
---------------------------------
 1. TURNS ENERGY INTO MASS. battery_mass_kg() and pv_array_mass_kg() are the two
    conversions the sweep cannot avoid, because the specific energy and the areal
    density are REQUIRED constructor arguments on the elements (no default -- a
    default is just a slower way of being free).

 2. BOUNDS THE CONVERSION. specific energy and areal density are themselves
    numbers a sweep can vary, so they are range-checked against demonstrated
    hardware. An unbounded specific energy is the same free lunch one level up:
    set 1e9 Wh/kg and the pack is massless again. MAX_CREDIBLE_PACK_WH_PER_KG and
    MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2 are fail-closed, not advisory.

 3. AGGREGATES. Vehicle asks every element what it weighs, adds that to the
    per-body structure mass, and writes the TOTAL into BodyState.mass_kg -- which
    is what integrate.py already reads for gravity, for the trim weight and for
    the re-trim trigger. So a heavier pack immediately costs lift, drag, cruise
    power and trim speed with no change anywhere in the integrator.

DECLARATION IS OPT-IN AND THE OPT-OUT IS AUDITED
------------------------------------------------
An element joins the mass budget by setting the class attribute
`DECLARES_MASS_CLOSURE = True` and exposing `mass_kg` (or a `mass_distribution()`
returning {body_index: kg} for an element spanning two bodies).

Opt-in rather than "read .mass_kg off anything that has it" is deliberate and was
forced by a real collision: validate._HoverLoad carries `self.mass_kg` meaning
THE VEHICLE'S mass, not the element's. Duck-typing on the attribute name would
have doubled case C's weight silently. An element that is genuinely weightless
says so with `MASSLESS_BY_CONSTRUCTION = True`.

Anything that declares neither is UNDECLARED, and undeclared is reported, never
assumed to be zero: Vehicle warns by default and `assert_mass_declared()` raises.
A sweep harness must call the assert. The undeclared set is now EMPTY for the
shipped element kinds: the last holdout, AeroSurface, gained a real structural
mass model in vehicle/structure.py (Stender exponents calibrated to the measured
AtlantikSolar airframe), so wing span and area are billed design variables.

SOURCES FOR EVERY CONSTANT ARE IN THE CONSTANT'S OWN COMMENT. Where a number is
an engineering fit rather than a catalogue value it says so in the same comment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np

# ---------------------------------------------------------------------------
# Unit conversions
# ---------------------------------------------------------------------------

#: Joules per watt-hour, J/Wh. Exact by definition (1 Wh = 3600 J).
J_PER_WH: float = 3600.0


# ---------------------------------------------------------------------------
# Battery specific energy -- CELL level
#
# CELL vs PACK is the distinction that gets fudged most often, so it is explicit
# here. A cell's specific energy is measured on the bare cell. A PACK adds
# interconnects, a case or shrink wrap, a battery-management board, fusing and
# (on an aircraft) the structure that carries the pack's own inertia loads. The
# usual pack-to-cell ratio is 0.7-0.8; see PACK_FRACTION_TYPICAL below.
#
# EVERY ELEMENT IN THIS PROJECT TAKES A *PACK*-LEVEL NUMBER. The cell constants
# below exist so a design can derive one honestly via
# pack_specific_energy_Wh_per_kg(), not so it can quote a cell number as a pack.
# ---------------------------------------------------------------------------

#: Panasonic NCR18650B lithium-ion cell, Wh/kg at cell level. 3.35 Ah x 3.6 V
#: nominal = 12.06 Wh in a 47.5 g cell = 254 Wh/kg on the datasheet minimum;
#: 243 Wh/kg is the value AtlantikSolar's builders quote for the cells they flew
#: (Oettershagen et al., "Design of small hand-launched solar-powered UAVs",
#: J. Field Robotics 2017). Used for case A's class of pack.
CELL_LI_ION_NCR18650B_WH_PER_KG: float = 243.0

#: Hobby-grade lithium-polymer pouch cell, Wh/kg at cell level. 3.7 V nominal,
#: typical 180-210 Wh/kg for a low-C-rate pouch; 200 is the round number case C
#: narrates for its 70 Wh / 0.35 kg quadcopter pack.
CELL_LI_PO_HOBBY_WH_PER_KG: float = 200.0

#: Sion Power lithium-sulphur cell, Wh/kg at cell level. The chemistry flown on
#: the QinetiQ Zephyr; ~350-400 Wh/kg cell level is the published band.
CELL_LI_S_SION_WH_PER_KG: float = 400.0

#: Amprius silicon-anode cell, Wh/kg at CELL level. Amprius publishes 450 Wh/kg
#: (SiCore/SiMaxx) and has shipped cells to HAPS programmes. Case B's narration
#: of "450 Wh/kg" is this number -- i.e. a CELL number used as if it were a pack
#: number, which is exactly the fudge PACK_FRACTION_TYPICAL exists to price.
CELL_SI_ANODE_AMPRIUS_WH_PER_KG: float = 450.0

#: Pack-to-cell specific-energy ratio, dimensionless. 0.70-0.80 is the normal
#: aerospace band once interconnects, BMS, fusing and the pack case are counted;
#: 0.75 is the midpoint and the default here.
PACK_FRACTION_TYPICAL: float = 0.75

#: Pack-to-cell ratio for a pack with minimal packaging, dimensionless. Small
#: solar UAVs bond bare cells directly into the airframe and reach ~0.95-0.99.
#: AtlantikSolar AS-2: 703 Wh in a 2.92 kg pack = 241 Wh/kg pack level against
#: 243 Wh/kg cells, i.e. 0.99. Unusual, and only reachable when the airframe is
#: also the pack case -- never assume it for a new design.
PACK_FRACTION_MINIMAL_PACKAGING: float = 0.99

#: AtlantikSolar AS-2 pack, Wh/kg at PACK level: 703 Wh / 2.92 kg. This is the
#: number case A's aircraft actually flew, and the reason its battery is 42 % of
#: its 6.93 kg all-up mass.
PACK_ATLANTIKSOLAR_WH_PER_KG: float = 241.0

#: Conventional lithium-ion PACK, Wh/kg. 243 cell x 0.75 = 182. The default a
#: design should use when it has not identified a specific pack build.
PACK_LI_ION_WH_PER_KG: float = 182.0

#: Hobby lithium-polymer PACK, Wh/kg. 200 cell x 0.99 (a hobby pack is a shrink
#: wrap and two wires) = 198; case C's own narration of 70 Wh in 0.35 kg is
#: 200 Wh/kg at pack level, which is what is used so the case is not re-specified
#: by this module.
PACK_LI_PO_HOBBY_WH_PER_KG: float = 200.0

#: Silicon-anode PACK, Wh/kg. 450 cell x 0.75 = 337.5. Case B's 34 kg pack holds
#: 15.3 kWh only at the CELL number; at a credible pack fraction the same 34 kg
#: holds 11.5 kWh. Both are reported by the mass audit rather than argued about.
PACK_SI_ANODE_WH_PER_KG: float = 337.5

#: Hard ceiling on PACK specific energy, Wh/kg. FAIL-CLOSED BOUND, not advice.
#: The best cells demonstrated at any scale are ~450-500 Wh/kg and no pack has
#: exceeded its cells, so a pack above 500 Wh/kg is a modelling error or an
#: optimizer exploiting an unbounded design variable. Lithium metal's practical
#: theoretical ceiling is often quoted near 600 Wh/kg at CELL level; 500 at PACK
#: level is already beyond anything flown.
MAX_CREDIBLE_PACK_WH_PER_KG: float = 500.0

#: Floor on PACK specific energy, Wh/kg. Below lead-acid (~35 Wh/kg) the number
#: is almost certainly a unit error (J/kg or Wh/g).
MIN_CREDIBLE_PACK_WH_PER_KG: float = 20.0


# ---------------------------------------------------------------------------
# Photovoltaic array areal density
#
# DERIVATION, so 0.4 kg/m^2 is not a guess:
#   monocrystalline silicon density                     2330 kg/m^3
#   SunPower A-300/E60 back-contact cell thickness      ~150 um
#   -> bare cell areal mass = 2330 * 150e-6            = 0.350 kg/m^2
#   encapsulant + adhesive on a wing-skin laminate     ~0.05 kg/m^2
#   -> laminated flexible array                        ~0.40 kg/m^2
# which is the value the operator's brief quotes and which this derivation
# independently reproduces.
# ---------------------------------------------------------------------------

#: Monocrystalline silicon density, kg/m^3.
SILICON_DENSITY_KG_M3: float = 2330.0

#: SunPower-class back-contact cell thickness, m.
SILICON_CELL_THICKNESS_M: float = 150.0e-6

#: Encapsulant + adhesive areal mass for a wing-skin laminate, kg/m^2.
PV_ENCAPSULANT_KG_M2: float = 0.05

#: Laminated flexible silicon PV array, kg/m^2 (cells + encapsulation only, no
#: MPPT and no wiring). Derived above: 0.350 + 0.050 = 0.400.
PV_LAMINATED_FLEXIBLE_KG_M2: float = (
    SILICON_DENSITY_KG_M3 * SILICON_CELL_THICKNESS_M + PV_ENCAPSULANT_KG_M2
)

#: Complete solar MODULE including MPPTs and harness, kg/m^2, back-calculated
#: from AtlantikSolar AS-2: a 1.00 kg solar system over 1.38 m^2 of cells =
#: 0.72 kg/m^2. Use this when the design does not account for MPPTs separately.
PV_MODULE_WITH_MPPT_KG_M2: float = 0.72

#: Space-grade thin-film blanket (CIGS / triple-junction on polyimide), kg/m^2.
#: The lightest arrays that exist; ~0.20 kg/m^2 at blanket level.
PV_THIN_FILM_BLANKET_KG_M2: float = 0.20

#: Floor on PV areal density, kg/m^2. FAIL-CLOSED BOUND. Nothing lighter than a
#: bare polyimide thin-film blanket has flown, and a silicon cell alone is
#: 0.35 kg/m^2, so a value below 0.15 means the sweep found a free wing skin.
MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2: float = 0.15

#: Ceiling on PV areal density, kg/m^2. Rigid glass-fronted terrestrial panels
#: are ~12 kg/m^2; anything heavier is a unit error.
MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2: float = 15.0


# ---------------------------------------------------------------------------
# Propulsion mass
# ---------------------------------------------------------------------------

#: Brushless outrunner continuous gravimetric power, W/kg (ELECTRICAL input).
#: Small UAV outrunners run 2.5-5 kW/kg continuous; 3000 W/kg is a mid-band
#: value for the 100 W - 5 kW class this project sweeps. ENGINEERING BAND, not a
#: single catalogue part.
MOTOR_SPECIFIC_POWER_W_PER_KG: float = 3000.0

#: Electronic speed controller gravimetric power, W/kg. ESCs are far lighter per
#: watt than motors (a 60 A / 1.3 kW ESC is ~0.10 kg -> 13 kW/kg); 12000 W/kg is
#: the conservative end of that band.
ESC_SPECIFIC_POWER_W_PER_KG: float = 12000.0

#: Ceiling on motor gravimetric power, W/kg (ELECTRICAL input). FAIL-CLOSED
#: BOUND on a mass DIVISOR: the best small-UAV outrunners demonstrate
#: ~5 kW/kg continuous and ~8 kW/kg short-burst (T-Motor U/V series data
#: sheets); nothing flying beats 8 kW/kg sustained. Above this the sweep is
#: buying an ever-lighter drive with a typed number.
MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG: float = 8000.0

#: Floor on motor gravimetric power, W/kg. Below ~200 W/kg (industrial gearmotor
#: territory) the number is almost certainly a unit error for an aircraft drive.
MIN_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG: float = 200.0

#: Ceiling on ESC / rectifier gravimetric power, W/kg. Hobby ESCs reach
#: ~13 kW/kg (60 A / 1.3 kW at ~0.10 kg); the best race-class boards approach
#: 25-30 kW/kg with no heat sink. 30 kW/kg is the fail-closed edge of that band.
MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG: float = 30000.0

#: Floor on ESC / rectifier gravimetric power, W/kg.
MIN_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG: float = 1000.0

#: Propeller mass coefficient, kg/m^2, in m_prop = k * D^2. FIT, NOT A CATALOGUE
#: VALUE: an APC 14x8E (0.356 m) is ~0.019 kg and a 1.0 m carbon folding prop is
#: ~0.15 kg, both consistent with k ~ 0.15 kg/m^2. Deliberately at the LOW end so
#: this term can never mask the motor term, which dominates.
PROPELLER_MASS_COEFF_KG_M2: float = 0.15


# ---------------------------------------------------------------------------
# Tether / cable
# ---------------------------------------------------------------------------

#: Dyneema SK75 fibre density, kg/m^3 (DSM datasheet: 0.97-0.98 g/cm^3 -- it
#: floats, which is one of the reasons it is the standard kite line).
DYNEEMA_SK75_DENSITY_KG_M3: float = 975.0

#: Dyneema SK75 tensile modulus, Pa (DSM datasheet: 109 GPa).
DYNEEMA_SK75_MODULUS_PA: float = 109.0e9

#: Braided-rope solid-fraction, dimensionless. A 12-strand braid is not a solid
#: rod; ~0.85 of the circumscribed circle is fibre. Check: 2 mm SK75 line at
#: 975 * 0.85 * pi/4 * (0.002)^2 = 2.60 g/m, against ~2.4 g/m for real 2 mm
#: Dyneema line -- 8 % conservative, which is the right direction.
BRAID_SOLID_FRACTION: float = 0.85

#: Ceiling on the tensile modulus a cable may imply, Pa. FAIL-CLOSED BOUND on
#: the EA_N / diameter_m pair: the stiffest structural fibre in production is
#: high-modulus carbon at ~500 GPa (Zylon 270 GPa, Dyneema 109 GPa), so an
#: EA that implies more than 600 GPa over its own cross-section is a sweep
#: buying an infinitely stiff hair-thin cable.
MAX_CREDIBLE_FIBRE_MODULUS_PA: float = 600.0e9


# ---------------------------------------------------------------------------
# Errors and warnings -- all loud, none silent
# ---------------------------------------------------------------------------


class MassClosureError(ValueError):
    """
    @description Raised when a design's mass closure is impossible or physically
        incredible: a missing specific energy, a pack above the demonstrated
        energy ceiling, a PV skin lighter than silicon, a cable stiffer than
        carbon. Every one of these is a way for an optimizer to obtain a
        capability without paying its weight, so every one is fail-closed.
    """


class UndeclaredMassError(MassClosureError):
    """
    @description Raised by Vehicle.assert_mass_declared() when an element neither
        declares a mass nor declares itself massless. Undeclared is NOT zero: it
        is unknown, and unknown mass on a design sweep is unbilled mass.
    """


class UndeclaredMassWarning(UserWarning):
    """
    @description Emitted at Vehicle construction listing elements that have not
        joined the mass budget. Warning rather than error by default so that
        elements owned by other modules keep working, but it is on by default so
        the gap is never invisible. Sweeps should use assert_mass_declared().
    """


class FixedMassOverrideWarning(UserWarning):
    """
    @description Emitted every time the fixed-total-mass escape hatch is used.
        The hatch exists for tests that must pin a mass; it is never the default
        path and it never happens quietly.
    """


# ---------------------------------------------------------------------------
# Energy / area / power -> mass
# ---------------------------------------------------------------------------


def pack_specific_energy_Wh_per_kg(
    cell_specific_energy_Wh_per_kg: float,
    pack_fraction: float = PACK_FRACTION_TYPICAL,
) -> float:
    """
    @description Convert a CELL specific energy to a PACK specific energy.
    @param cell_specific_energy_Wh_per_kg Cell-level specific energy, Wh/kg.
    @param pack_fraction Pack-to-cell ratio, dimensionless 0..1. See
        PACK_FRACTION_TYPICAL (0.75) and PACK_FRACTION_MINIMAL_PACKAGING (0.99).
    @returns Pack-level specific energy, Wh/kg.
    @raises MassClosureError If the fraction is outside (0, 1].
    """
    if not (0.0 < float(pack_fraction) <= 1.0):
        raise MassClosureError(
            f"pack_fraction must be in (0, 1]; got {pack_fraction}. A pack cannot "
            f"be lighter than its own cells."
        )
    return float(cell_specific_energy_Wh_per_kg) * float(pack_fraction)


def check_pack_specific_energy_Wh_per_kg(specific_energy_Wh_per_kg: float) -> float:
    """
    @description Validate a PACK-level specific energy against the demonstrated
        hardware band. FAIL-CLOSED: an unbounded specific energy is the same free
        lunch as an unbilled pack, one level up.
    @param specific_energy_Wh_per_kg Pack-level specific energy, Wh/kg.
    @returns The same value, as a float, when it is credible.
    @raises MassClosureError When it is non-finite, non-positive, below
        MIN_CREDIBLE_PACK_WH_PER_KG or above MAX_CREDIBLE_PACK_WH_PER_KG.
    """
    value = float(specific_energy_Wh_per_kg)
    if not np.isfinite(value) or value <= 0.0:
        raise MassClosureError(
            f"specific_energy_Wh_per_kg must be a positive finite number, "
            f"got {specific_energy_Wh_per_kg!r}"
        )
    if value > MAX_CREDIBLE_PACK_WH_PER_KG:
        raise MassClosureError(
            f"specific_energy_Wh_per_kg = {value:g} Wh/kg exceeds the fail-closed "
            f"ceiling of {MAX_CREDIBLE_PACK_WH_PER_KG:g} Wh/kg (PACK level). The "
            f"best CELLS demonstrated are ~450-500 Wh/kg (Amprius silicon anode) "
            f"and no pack beats its cells. If you meant a cell number, convert it "
            f"with pack_specific_energy_Wh_per_kg(cell, PACK_FRACTION_TYPICAL)."
        )
    if value < MIN_CREDIBLE_PACK_WH_PER_KG:
        raise MassClosureError(
            f"specific_energy_Wh_per_kg = {value:g} Wh/kg is below the "
            f"{MIN_CREDIBLE_PACK_WH_PER_KG:g} Wh/kg floor (worse than lead-acid); "
            f"this is almost always a unit error -- the argument is Wh/kg, not "
            f"J/kg and not Wh/g."
        )
    return value


def battery_mass_kg(capacity_J: float, specific_energy_Wh_per_kg: float) -> float:
    """
    @description Mass of a battery pack of a given nameplate energy, kg.

            m = (capacity_J / 3600) / specific_energy_Wh_per_kg

        `capacity_J` is the pack's NAMEPLATE energy at soc = 1.0. A design that
        reserves a floor (soc_min) still carries the whole pack, which is why the
        mass is billed on nameplate and not on usable energy.

    @param capacity_J Pack nameplate energy, joules.
    @param specific_energy_Wh_per_kg PACK-level specific energy, Wh/kg. Range
        checked; see check_pack_specific_energy_Wh_per_kg.
    @returns Pack mass, kg, > 0.
    @raises MassClosureError On a non-positive capacity or an incredible specific
        energy.
    """
    energy_J = float(capacity_J)
    if not np.isfinite(energy_J) or energy_J <= 0.0:
        raise MassClosureError(f"capacity_J must be > 0, got {capacity_J!r}")
    specific = check_pack_specific_energy_Wh_per_kg(specific_energy_Wh_per_kg)
    return (energy_J / J_PER_WH) / specific


def check_pv_areal_density_kg_m2(areal_density_kg_m2: float) -> float:
    """
    @description Validate a PV areal density against real array hardware.
        FAIL-CLOSED: a sweep that drives areal density toward zero is buying a
        weightless wing skin.
    @param areal_density_kg_m2 Array areal density, kg/m^2.
    @returns The same value, as a float, when it is credible.
    @raises MassClosureError When it is non-finite, non-positive, below
        MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2 or above the terrestrial-panel
        ceiling.
    """
    value = float(areal_density_kg_m2)
    if not np.isfinite(value) or value <= 0.0:
        raise MassClosureError(
            f"areal_density_kg_m2 must be a positive finite number, "
            f"got {areal_density_kg_m2!r}"
        )
    if value < MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2:
        raise MassClosureError(
            f"areal_density_kg_m2 = {value:g} kg/m2 is below the fail-closed floor "
            f"of {MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2:g} kg/m2. A bare 150 um "
            f"silicon cell alone is {SILICON_DENSITY_KG_M3 * SILICON_CELL_THICKNESS_M:.3f} "
            f"kg/m2 and the lightest space thin-film blanket is "
            f"{PV_THIN_FILM_BLANKET_KG_M2:g} kg/m2."
        )
    if value > MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2:
        raise MassClosureError(
            f"areal_density_kg_m2 = {value:g} kg/m2 exceeds "
            f"{MAX_CREDIBLE_PV_AREAL_DENSITY_KG_M2:g} kg/m2, heavier than a rigid "
            f"glass terrestrial panel; check units."
        )
    return value


def pv_array_mass_kg(area_m2: float, areal_density_kg_m2: float) -> float:
    """
    @description Mass of a photovoltaic array, kg = GROSS area x areal density.

        Billed on gross area rather than on cell area (gross x packing_factor)
        because the laminate, encapsulant and harness cover the whole panel
        footprint. This is the conservative choice; it also means packing_factor
        trades power against nothing, so it cannot be gamed either way.

    @param area_m2 Gross array area, m^2.
    @param areal_density_kg_m2 Array areal density, kg/m^2. Range checked.
    @returns Array mass, kg, >= 0.
    @raises MassClosureError On a negative area or an incredible areal density.
    """
    area = float(area_m2)
    if not np.isfinite(area) or area < 0.0:
        raise MassClosureError(f"area_m2 must be >= 0 and finite, got {area_m2!r}")
    return area * check_pv_areal_density_kg_m2(areal_density_kg_m2)


def motor_drive_mass_kg(
    max_electrical_power_W: float,
    n_rotors: int = 1,
    motor_specific_power_W_per_kg: float = MOTOR_SPECIFIC_POWER_W_PER_KG,
    esc_specific_power_W_per_kg: float = ESC_SPECIFIC_POWER_W_PER_KG,
) -> float:
    """
    @description Mass of the electrical drive (motors + ESCs) sized for a power
        limit, kg. The power limit is a design variable a sweep will always push
        up, so it must cost weight:

            m = P_max / k_motor + P_max / k_esc

        with the power SHARED across n_rotors (each unit is sized for its share,
        and specific power is treated as scale-invariant across the 100 W - 5 kW
        band, which is the band where the 3 kW/kg figure holds).

    @param max_electrical_power_W Electrical power limit at the bus, W.
    @param n_rotors Number of motor/ESC units, dimensionless, >= 1.
    @param motor_specific_power_W_per_kg Motor gravimetric power, W/kg.
    @param esc_specific_power_W_per_kg ESC gravimetric power, W/kg.
    @returns Drive mass, kg, >= 0.
    @raises MassClosureError On non-positive specific powers or a bad rotor count.
    """
    power_W = float(max_electrical_power_W)
    if not np.isfinite(power_W) or power_W < 0.0:
        raise MassClosureError(
            f"max_electrical_power_W must be >= 0 and finite, got "
            f"{max_electrical_power_W!r}"
        )
    if int(n_rotors) < 1:
        raise MassClosureError(f"n_rotors must be >= 1, got {n_rotors!r}")
    if motor_specific_power_W_per_kg <= 0.0 or esc_specific_power_W_per_kg <= 0.0:
        raise MassClosureError(
            "motor/ESC specific power must be > 0 W/kg; a zero would make an "
            "arbitrarily powerful drive weightless"
        )
    return power_W / float(motor_specific_power_W_per_kg) + power_W / float(
        esc_specific_power_W_per_kg
    )


def propeller_mass_kg(
    diameter_m: float,
    n_rotors: int = 1,
    mass_coefficient_kg_m2: float = PROPELLER_MASS_COEFF_KG_M2,
) -> float:
    """
    @description Mass of the rotating hardware, kg, from m = k * D^2 per rotor.
        Disk area is the thing momentum theory rewards, so it must not be free:
        without this term a sweep buys hover efficiency by growing the disk.
    @param diameter_m Diameter of ONE rotor, m.
    @param n_rotors Number of rotors, dimensionless, >= 1.
    @param mass_coefficient_kg_m2 Fit coefficient k, kg/m^2. See
        PROPELLER_MASS_COEFF_KG_M2 for the two data points it is fitted to.
    @returns Total propeller mass, kg, >= 0.
    """
    d_m = float(diameter_m)
    if not np.isfinite(d_m) or d_m < 0.0:
        raise MassClosureError(f"diameter_m must be >= 0 and finite, got {diameter_m!r}")
    return float(mass_coefficient_kg_m2) * d_m * d_m * float(max(1, int(n_rotors)))


def rope_linear_density_kg_m(
    diameter_m: float,
    fibre_density_kg_m3: float = DYNEEMA_SK75_DENSITY_KG_M3,
    solid_fraction: float = BRAID_SOLID_FRACTION,
) -> float:
    """
    @description Mass per metre of a braided cable, kg/m, from its diameter:

            lambda = rho_fibre * solid_fraction * pi/4 * d^2

        A tether's LENGTH and DIAMETER are both design variables, and a cable of
        zero linear density is a rigid weightless link between two altitudes --
        which is precisely the mechanism archetype 3 uses to extract energy. It
        has to weigh something.

    @param diameter_m Cable outside diameter, m.
    @param fibre_density_kg_m3 Fibre density, kg/m^3.
    @param solid_fraction Fibre fraction of the circumscribed circle,
        dimensionless 0..1.
    @returns Linear density, kg/m, >= 0.
    """
    d_m = float(diameter_m)
    if not np.isfinite(d_m) or d_m < 0.0:
        raise MassClosureError(f"diameter_m must be >= 0 and finite, got {diameter_m!r}")
    return (
        float(fibre_density_kg_m3)
        * float(solid_fraction)
        * np.pi
        / 4.0
        * d_m
        * d_m
    )


def check_cable_stiffness(EA_N: float, diameter_m: float) -> float:
    """
    @description Validate that a cable's axial stiffness is achievable with its
        own cross-section. FAIL-CLOSED on the EA_N / diameter_m pair, because
        they are independent arguments and a sweep can otherwise buy an
        infinitely stiff hair-thin (and therefore nearly massless) tether.

            E_implied = EA / (pi/4 * d^2)

    @param EA_N Axial stiffness, N.
    @param diameter_m Cable outside diameter, m.
    @returns The implied tensile modulus, Pa.
    @raises MassClosureError When the implied modulus exceeds
        MAX_CREDIBLE_FIBRE_MODULUS_PA.
    """
    d_m = float(diameter_m)
    if d_m <= 0.0:
        raise MassClosureError(f"diameter_m must be > 0, got {diameter_m!r}")
    area_m2 = np.pi / 4.0 * d_m * d_m
    modulus_Pa = float(EA_N) / area_m2
    if modulus_Pa > MAX_CREDIBLE_FIBRE_MODULUS_PA:
        raise MassClosureError(
            f"EA_N = {float(EA_N):g} N over a {d_m * 1000.0:g} mm cable implies a "
            f"tensile modulus of {modulus_Pa / 1e9:.1f} GPa, above the fail-closed "
            f"ceiling of {MAX_CREDIBLE_FIBRE_MODULUS_PA / 1e9:.0f} GPa. The "
            f"stiffest production fibre is high-modulus carbon at ~500 GPa "
            f"(Dyneema SK75 is {DYNEEMA_SK75_MODULUS_PA / 1e9:.0f} GPa). Either "
            f"thicken the cable -- which costs mass -- or lower EA_N."
        )
    return modulus_Pa


# ---------------------------------------------------------------------------
# The element mass-declaration protocol
# ---------------------------------------------------------------------------

#: Class attribute an element sets to True to join the mass budget. It must then
#: expose `mass_kg` (float) or a `mass_distribution()` -> {body_index: kg}.
DECLARES_MASS_CLOSURE_ATTR: str = "DECLARES_MASS_CLOSURE"

#: Class attribute an element sets to True to assert it genuinely has no mass of
#: its own (an abstract electrical load, a lift bookkeeping element whose mass is
#: already inside the body's structure mass).
MASSLESS_BY_CONSTRUCTION_ATTR: str = "MASSLESS_BY_CONSTRUCTION"


@dataclass(frozen=True)
class MassContribution:
    """
    @description One element's contribution to one body's mass.
    @param element_name Class name of the contributing element.
    @param body_index Index of the body carrying the mass.
    @param mass_kg Mass contributed to that body, kg.
    @param detail Human-readable derivation, e.g. "703.0 Wh / 241 Wh/kg".
    """

    element_name: str
    body_index: int
    mass_kg: float
    detail: str = ""


def element_mass_distribution(element: Any) -> dict[int, float]:
    """
    @description Ask one element what it weighs and where.
    @param element Any force element.
    @returns {body_index: mass_kg}. EMPTY when the element has not opted in --
        empty means UNDECLARED, and the caller must treat that differently from a
        declared zero (see undeclared_elements).
    @raises MassClosureError When an element opts in but exposes no mass.
    """
    if not bool(getattr(element, DECLARES_MASS_CLOSURE_ATTR, False)):
        return {}
    distribution_fn = getattr(element, "mass_distribution", None)
    if callable(distribution_fn):
        raw = distribution_fn()
        return {int(k): float(v) for k, v in dict(raw).items()}
    if not hasattr(element, "mass_kg"):
        raise MassClosureError(
            f"{type(element).__name__} sets {DECLARES_MASS_CLOSURE_ATTR} = True but "
            f"exposes neither mass_kg nor mass_distribution()."
        )
    return {int(getattr(element, "body_index", 0)): float(element.mass_kg)}


def undeclared_elements(elements: Iterable[Any]) -> list[Any]:
    """
    @description Elements that have declared neither a mass nor masslessness.
    @param elements The vehicle's elements.
    @returns The undeclared elements, in order. A NON-EMPTY result means part of
        the vehicle's mass is unknown, not that it is zero.
    """
    out: list[Any] = []
    for element in elements:
        declares = bool(getattr(element, DECLARES_MASS_CLOSURE_ATTR, False))
        massless = bool(getattr(element, MASSLESS_BY_CONSTRUCTION_ATTR, False))
        if not declares and not massless:
            out.append(element)
    return out


def collect_mass_contributions(elements: Iterable[Any]) -> list[MassContribution]:
    """
    @description Flatten every element's declared mass into a list of per-body
        contributions.
    @param elements The vehicle's elements.
    @returns List of MassContribution, one per (element, body) pair.
    """
    contributions: list[MassContribution] = []
    for element in elements:
        detail = ""
        detail_fn = getattr(element, "mass_detail", None)
        if callable(detail_fn):
            detail = str(detail_fn())
        for body_index, mass_kg in element_mass_distribution(element).items():
            contributions.append(
                MassContribution(
                    element_name=type(element).__name__,
                    body_index=int(body_index),
                    mass_kg=float(mass_kg),
                    detail=detail,
                )
            )
    return contributions


# ---------------------------------------------------------------------------
# The budget
# ---------------------------------------------------------------------------


@dataclass
class MassBudget:
    """
    @description A vehicle's closed mass statement: what the structure weighs,
        what every declared element adds, what is still undeclared, and the
        total that becomes the vehicle's weight.
    @param structure_mass_kg Per-body structure mass, kg, shape (n_bodies,).
    @param contributions Every declared element contribution.
    @param undeclared_element_names Class names of elements with unknown mass.
    """

    structure_mass_kg: np.ndarray
    contributions: list[MassContribution] = field(default_factory=list)
    undeclared_element_names: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.structure_mass_kg = np.asarray(self.structure_mass_kg, dtype=float).reshape(-1)

    @property
    def n_bodies(self) -> int:
        """
        @description Number of bodies in the budget, dimensionless.
        @returns Body count.
        """
        return int(self.structure_mass_kg.size)

    def element_mass_by_body_kg(self) -> np.ndarray:
        """
        @description Declared element mass on each body, kg.
        @returns Array shape (n_bodies,), kg.
        """
        out = np.zeros(self.n_bodies, dtype=float)
        for contribution in self.contributions:
            out[contribution.body_index] += contribution.mass_kg
        return out

    def body_mass_kg(self) -> np.ndarray:
        """
        @description Total mass of each body, kg = structure + declared elements.
        @returns Array shape (n_bodies,), kg.
        """
        return self.structure_mass_kg + self.element_mass_by_body_kg()

    @property
    def total_structure_mass_kg(self) -> float:
        """
        @description Structure mass summed over bodies, kg.
        @returns Structure mass, kg.
        """
        return float(np.sum(self.structure_mass_kg))

    @property
    def total_element_mass_kg(self) -> float:
        """
        @description Declared element mass summed over bodies, kg.
        @returns Element mass, kg.
        """
        return float(sum(c.mass_kg for c in self.contributions))

    @property
    def total_mass_kg(self) -> float:
        """
        @description Vehicle all-up mass, kg.
        @returns Total mass, kg.
        """
        return self.total_structure_mass_kg + self.total_element_mass_kg

    def mass_fraction(self, element_name: str) -> float:
        """
        @description Fraction of all-up mass held by every element of one class.
        @param element_name Class name, e.g. "BatteryElement".
        @returns Mass fraction, dimensionless 0..1.
        """
        total = self.total_mass_kg
        if total <= 0.0:
            return 0.0
        own = sum(c.mass_kg for c in self.contributions if c.element_name == element_name)
        return float(own) / total

    def report(self) -> str:
        """
        @description Human-readable mass statement, one line per contribution.
        @returns Multi-line report string.
        """
        lines = ["MASS BUDGET (kg)", "-" * 62]
        for body_index, structure in enumerate(self.structure_mass_kg):
            lines.append(f"  body {body_index}: structure                 {structure:9.4f}")
            for contribution in self.contributions:
                if contribution.body_index != body_index:
                    continue
                suffix = f"   [{contribution.detail}]" if contribution.detail else ""
                lines.append(
                    f"            + {contribution.element_name:<22s} "
                    f"{contribution.mass_kg:9.4f}{suffix}"
                )
        lines.append("-" * 62)
        lines.append(f"  structure total                        {self.total_structure_mass_kg:9.4f}")
        lines.append(f"  declared element total                 {self.total_element_mass_kg:9.4f}")
        lines.append(f"  ALL-UP MASS                            {self.total_mass_kg:9.4f}")
        if self.undeclared_element_names:
            lines.append(
                "  UNDECLARED (mass unknown, NOT zero): "
                + ", ".join(sorted(set(self.undeclared_element_names)))
            )
        return "\n".join(lines)


def build_mass_budget(
    structure_mass_kg: Sequence[float] | np.ndarray,
    elements: Iterable[Any],
) -> MassBudget:
    """
    @description Assemble a MassBudget from per-body structure masses and the
        element list.
    @param structure_mass_kg Per-body structure mass, kg.
    @param elements The vehicle's elements.
    @returns The MassBudget.
    """
    element_list = list(elements)
    return MassBudget(
        structure_mass_kg=np.asarray(structure_mass_kg, dtype=float).reshape(-1),
        contributions=collect_mass_contributions(element_list),
        undeclared_element_names=[type(e).__name__ for e in undeclared_elements(element_list)],
    )
