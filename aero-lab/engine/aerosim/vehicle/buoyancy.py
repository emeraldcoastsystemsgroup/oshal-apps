"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | BuoyancyVolume: sealed fixed-volume super-pressure gas cell with conduction+radiation superheat and Re-dependent sphere drag.
2 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS (round-3 class fix): film_mass_kg accepted NEGATIVE values -- film_mass_kg=-100 was 981 N of free lift typed into a constructor. Every numeric constructor parameter now validates against the declared PARAM_BOUNDS table (vehicle/param_bounds.py) at construction, re-checkable at spec extraction.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4: film_mass_kg no longer defaults to 0.0 -- a zero-mass envelope was the last unbilled element (every m^3 of displaced air was free lift with no film to pay for). The film is now DERIVED from the envelope surface area x a cited areal density (super-pressure balloon practice: NASA SPB StratoFilm 420 class, 38 um LLDPE at ~0.92 g/cm^3 = 0.035 kg/m^2), with a FLOOR of 0.018 kg/m^2 (20 um PE, the thinnest super-pressure film flown, before tapes/fittings). An explicit film_mass_kg is floor-checked against the same 0.018 kg/m^2 x surface area in validate_cross_params -- which re-derives the surface area from volume_m3, so a bypass-built or post-construction-mutated cell is caught at recheck. Exactly 0.0 raises.
5 | maintainer@emeraldcoastsystemsgroup.com   | REAL ENVELOPE CHEMISTRY (SPEC_chemistry sections 5-6, SPEC_materials section 4). New kwargs envelope_film ('lldpe_38um' DEFAULT | 'mylar_38um' | 'metallized_mylar_38um' | 'ideal' explicit-only), uv_grade ('stabilized' default | 'unstabilized'), hull_structure ('vented_ballonet' DEFAULT | 'superpressure_pet' | 'ideal' explicit-only). Helium permeation (LDPE-class 4.4 Barrer proxy, Lee/Kim/Jung 2023, E_P = 30 kJ/mol Arrhenius) drains the sealed charge every step; the displaced volume is slack-aware (min(V, m R T / p_amb): once the leaked cell goes slack, lift ~ n_He -- the SPEC_chemistry 5.2 limit); UV dose accrues in DAYLIGHT ONLY against exp(-D/D_c) retention; the hull closure mass (ballonet + valve/blower for vented, sized PET skin for superpressure) is billed in the force exactly like the film. 'ideal' film/hull reproduce the previous physics bit-for-bit and warn loudly (IdealEnvelopeWarning). Gas-state init moved from validate_cross_params into __init__: recheck on a live cell no longer re-inflates it (that was a silent free-makeup-gas channel).

PHYSICS NOTE -- WHY SUPERHEAT DOES NOT CHANGE LIFT HERE
-------------------------------------------------------
This is a SUPER-PRESSURE balloon: the envelope is a sealed, fixed-volume vessel.
Gas mass m_gas and volume V are both constant, so the gas density m_gas/V is
constant, and therefore

    gross lift = (rho_air - m_gas/V) * V * g

depends on the AMBIENT density only. Superheat changes the gas TEMPERATURE and
hence the internal PRESSURE (p = m R_spec T / V), which is a structural/burst
concern, not a lift concern. That is the defining difference from a zero-pressure
balloon, where the gas vents to hold p_gas = p_air and superheat directly moves
the lift. The thermal model below is therefore integrated for the burst margin
and for the film heat balance, and is deliberately NOT allowed to feed back into
the buoyancy force. Anyone "fixing" that has turned this into a zero-pressure
balloon.

Cross-check against the project's agreed numbers (both reproduced by the
self-test, not asserted here):
  1.97 m sphere  -> V = 4.003 m^3  at 15 km, rho_air = 0.19476 kg/m^3
        lift = 4.003 * 0.19476 * (1 - 0.13819) * 9.80665 = 6.589 N  (0.672 kg)
  4.41 m sphere  -> V = 44.907 m^3 at 20 km, rho_air = 0.08891 kg/m^3
        lift = 44.907 * 0.08891 * (1 - 0.13819) * 9.80665 = 33.74 N (3.441 kg)
"""

from __future__ import annotations

import math
import warnings
from typing import TYPE_CHECKING

import numpy as np

from .hull import vented_ballonet_mass_kg
from .materials import MATERIAL_CATALOGUE
from .param_bounds import Bounds, ParamBoundsError, validate_declared
from .state import (
    G0_MS2,
    ElementForce,
    BodyState,
    as_offset,
    moment_from_offset,
    relative_airspeed_vector,
)

if TYPE_CHECKING:  # pragma: no cover
    from ..env import AtmoSample, SolarSample, WindSample


# ---------------------------------------------------------------------------
# Gas and radiation constants (all cited)
# ---------------------------------------------------------------------------

#: Universal gas constant, J/(kmol*K). CODATA 2018: 8.314462618 J/(mol*K).
R_UNIVERSAL_J_KMOLK: float = 8314.462618

#: Mean molar mass of dry air, kg/kmol. US Standard Atmosphere 1976.
M_AIR_KG_KMOL: float = 28.9644

#: Molar mass of helium, kg/kmol. IUPAC standard atomic weight 4.002602.
M_HELIUM_KG_KMOL: float = 4.0026

#: Molar mass of hydrogen (H2), kg/kmol. IUPAC 2 * 1.00794.
M_HYDROGEN_KG_KMOL: float = 2.01588

#: Stefan-Boltzmann constant, W/(m^2*K^4). CODATA 2018.
SIGMA_SB_W_M2K4: float = 5.670374419e-8

#: Specific heat of air at constant pressure, J/(kg*K), near 200-300 K.
CP_AIR_J_KGK: float = 1005.0

#: Prandtl number of air, dimensionless, ~0.71-0.72 over 200-300 K.
PR_AIR: float = 0.72

#: Effective planetary IR emission temperature, K. sigma*254^4 = 236 W/m^2,
#: against the observed global-mean outgoing longwave radiation of ~239 W/m^2
#: (IPCC AR6 WG1 Ch.7 global energy budget). Drives the upward-facing IR load.
EARTH_IR_TEMP_K: float = 254.0

#: Helium density ratio rho_gas/rho_air at equal p and T, dimensionless.
#: = M_He / M_air = 4.0026 / 28.9644 = 0.138190, reproducing the project's
#: agreed 4.003/28.96 = 0.1382 to four significant figures.
HELIUM_DENSITY_RATIO: float = M_HELIUM_KG_KMOL / M_AIR_KG_KMOL

#: Default balloon envelope film areal density, kg/m^2 (round 4). Super-
#: pressure balloon practice: NASA SPB / StratoFilm 420 class film is 38 um
#: (1.5 mil) linear low-density polyethylene at ~920 kg/m^3:
#: 38e-6 m x 920 kg/m^3 = 0.035 kg/m^2, before load tapes and fittings.
BALLOON_FILM_AREAL_DENSITY_KG_M2: float = 0.035

#: FLOOR on envelope film areal density, kg/m^2. FAIL-CLOSED BOUND: the
#: thinnest super-pressure envelope film flown is ~20 um PE at ~0.92 g/cm^3 =
#: 0.0184 kg/m^2 (bare gauge, before tapes); 0.018 is the defensible edge. A
#: claimed envelope below it -- and above all a ZERO-mass envelope -- is free
#: displaced-air lift that never paid for its skin.
MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2: float = 0.018


# ---------------------------------------------------------------------------
# Envelope chemistry: helium permeation + UV dose (SPEC_chemistry sections 5-6)
# ---------------------------------------------------------------------------

#: Universal gas constant per MOLE, J/(mol*K). CODATA 2018.
R_GAS_J_MOLK: float = R_UNIVERSAL_J_KMOLK / 1000.0

#: 1 Barrer in SI permeability, mol/(m*s*Pa). SPEC_chemistry conventions
#: (dimensional conversion, self-checked there against LDPE O2 packaging data).
BARRER_TO_MOL_M_S_PA: float = 3.347e-16

#: Helium permeability at 25 C, mol/(m*s*Pa), per envelope film option.
#: 'lldpe_38um': D*S = 58.4e-11 m^2/s x 2.50 mol/(m^3*MPa) = 1.46e-9
#: mol/(m*s*MPa) (Lee, Kim & Jung 2023, Polymers 15(19):4019, measured LDPE
#: at 25 C; LLDPE proxy +-20%, HONESTY H15). 'mylar_38um': ~0.7 Barrer
#: (DuPont Teijin Mylar H-37250-1 Fig. 2, graph-read +-30%, HONESTY H16).
#: 'metallized_mylar_38um': /100 metallization factor (same document,
#: upper-bound factor, HONESTY H16).
HELIUM_PERMEABILITY_25C_MOL_M_S_PA: dict[str, float] = {
    "lldpe_38um": 1.46e-15,
    "mylar_38um": 0.7 * BARRER_TO_MOL_M_S_PA,
    "metallized_mylar_38um": 0.7 * BARRER_TO_MOL_M_S_PA / 100.0,
}

#: Envelope film areal density, kg/m^2, per option, for the DERIVED film
#: mass: LLDPE 38 um at 920 kg/m^3 = 0.035 (the shipped constant); PET 38 um
#: at 1390 kg/m^3 = 0.0528 (DuPont-Teijin Mylar density); metallization adds
#: negligible mass (~30 nm aluminium). 'ideal' keeps the legacy 0.035 so the
#: explicit ideal path is bit-identical to the pre-chemistry model.
ENVELOPE_FILM_AREAL_DENSITY_KG_M2: dict[str, float] = {
    "lldpe_38um": BALLOON_FILM_AREAL_DENSITY_KG_M2,
    "mylar_38um": 1390.0 * 38.0e-6,
    "metallized_mylar_38um": 1390.0 * 38.0e-6,
    "ideal": BALLOON_FILM_AREAL_DENSITY_KG_M2,
}

#: Envelope film thickness, m -- all three real options are 38 um class.
ENVELOPE_FILM_THICKNESS_M: float = 38.0e-6

#: Arrhenius activation energy for He permeation through polyethylene,
#: J/mol. HONESTY H15: classic Michaels & Bixler-era PE value, textbook; at
#: +5 C flux is x0.42 of 25 C, at -56 C x0.011 -- warm ground days dominate.
HE_PERMEATION_EA_J_MOL: float = 30000.0

#: Reference temperature of the permeability datum, K (25 C, Lee 2023).
HE_PERMEATION_REF_T_K: float = 298.15

#: Mole-count reference temperature, K, of the SPEC_chemistry 5.3 anchor
#: chain (n = pV/RT at 288 K launch state). HONESTY: the anchor holds the
#: sealed mole count at the launch temperature and scales ONLY permeability
#: with film temperature; the excluded linear T_gas factor is <= +-25% over
#: the mission envelope, far under the Arrhenius x90 swing. Flagged, not
#: silently dropped (module ledger B1).
HE_MOLE_COUNT_REF_T_K: float = 288.15

#: UV fraction of total solar irradiance (280-400 nm), dimensionless.
#: Gueymard 2004 reference spectrum: ~7.7% of TSI = ~105 W/m^2 above the
#: ozone layer. HONESTY H18: fraction from the standard spectrum.
UV_FRACTION_OF_TSI: float = 0.077

#: UV dose-to-failure scale D_c, MJ/m^2, by film grade: retention(D) =
#: exp(-D/D_c), structural failure at retention 0.5. HONESTY H17 -- BOUNDED,
#: not measured: 'unstabilized' 220 (band 90-430; one-outdoor-season
#: greenhouse-film experience + Eur. Polym. J. 2014 trend -> ~29 days at the
#: 5.3 MJ/m^2/day float dose); 'stabilized' 2100 (NASA ULDB StratoFilm-class
#: flights: GUSTO 57 d / SuperTIGER 55 d lower bound, ~5x design margin ->
#: >= 100 days design life). PET envelopes: D_c >= 3x unstabilized LLDPE
#: (comparative weathering literature ratio -- the weakest number in the
#: spec, H17).
UV_DC_MJ_M2: dict[str, float] = {"unstabilized": 220.0, "stabilized": 2100.0}
UV_DC_BAND_UNSTABILIZED_MJ_M2: tuple[float, float] = (90.0, 430.0)
UV_DC_PET_FACTOR: float = 3.0

#: Mission hard-end retention floor, dimensionless (SPEC_chemistry 6.2: no
#: gradual-leak model is invented without data; the mission module ends the
#: run when uv_retention < 0.5).
UV_RETENTION_MISSION_FLOOR: float = 0.5

#: Frozen option sets for the string kwargs.
ENVELOPE_FILM_OPTIONS: frozenset[str] = frozenset(
    {"lldpe_38um", "mylar_38um", "metallized_mylar_38um", "ideal"})
UV_GRADE_OPTIONS: frozenset[str] = frozenset({"stabilized", "unstabilized"})
HULL_STRUCTURE_OPTIONS: frozenset[str] = frozenset(
    {"vented_ballonet", "superpressure_pet", "ideal"})

#: HONESTY LEDGER (module-level additions for the envelope chemistry).
ENVELOPE_HONESTY_LEDGER: dict[str, str] = {
    "H15": "LDPE->LLDPE He permeability proxy +-20%; E_P = 30 kJ/mol "
           "textbook (Michaels & Bixler era).",
    "H16": "Mylar He permeability graph-read +-30%; metallization /100 is "
           "an upper-bound factor (real foils vary 10-100x).",
    "H17": "UV D_c values BOUNDED, not measured; PET 3x ratio is the "
           "weakest number in the spec.",
    "H18": "UV fraction 7.7% of TSI from the Gueymard 2004 standard "
           "spectrum.",
    "B1": "Permeation mole-count held at the 288 K anchor reference and the "
          "film temperature taken as the gas temperature; the excluded "
          "linear T factor is <= +-25%, inside the anchor's +-10% x proxy "
          "+-20% envelope.",
    "B2": "UV irradiance proxy = 0.077 x (DNI + DHI) while the sun is up; "
          "reproduces the 105 W/m^2 float dose rate; no envelope "
          "orientation model (dose is per unit film area).",
}


class IdealEnvelopeWarning(UserWarning):
    """
    @description Emitted whenever a BuoyancyVolume is built with the EXPLICIT
        'ideal' envelope film or hull structure: no permeation, no UV, no
        closure mass. The ideal path exists for regression comparison only
        and must never be silent (campaign rule: loud, never silent).
    """


def specific_gas_constant_J_kgK(gas: str) -> float:
    """
    @description Specific gas constant R_spec = R_universal / M for a lifting gas.
    @param gas One of {"helium", "hydrogen"}.
    @returns R_spec, J/(kg*K). Helium 2077.3; hydrogen 4124.4.
    """
    gas_key = gas.strip().lower()
    if gas_key == "helium":
        return R_UNIVERSAL_J_KMOLK / M_HELIUM_KG_KMOL
    if gas_key == "hydrogen":
        return R_UNIVERSAL_J_KMOLK / M_HYDROGEN_KG_KMOL
    raise ValueError(f"gas must be 'helium' or 'hydrogen', got {gas!r}")


def specific_heat_cv_J_kgK(gas: str) -> float:
    """
    @description Constant-volume specific heat of the lifting gas, J/(kg*K).
        Helium is monatomic: cv = (3/2) R_spec = 3115.9. Hydrogen is diatomic
        with rotational modes fully active above ~200 K: cv = (5/2) R_spec =
        10311. Vibrational modes are frozen out at balloon temperatures.
    @param gas One of {"helium", "hydrogen"}.
    @returns cv, J/(kg*K).
    """
    r_spec = specific_gas_constant_J_kgK(gas)
    gas_key = gas.strip().lower()
    if gas_key == "helium":
        return 1.5 * r_spec
    return 2.5 * r_spec


def sphere_drag_coefficient(reynolds_d: float) -> float:
    """
    @description Drag coefficient of a smooth sphere against diameter-based
        Reynolds number, dimensionless. Clift & Gauvin (1971) correlation:

            Cd = 24/Re * (1 + 0.15 Re^0.687) + 0.42 / (1 + 4.25e4 Re^-1.16)

        Reproduces Stokes flow at low Re, the ~0.44-0.47 subcritical plateau over
        1e3 < Re < 2e5, and the onset of the drag crisis. Valid to Re ~3e5, which
        covers every balloon case in this project (a 4.41 m sphere at 20 km in a
        20 m/s relative wind gives Re_D = 0.0889*20*4.41/1.4216e-5 = 5.5e5, at
        which the correlation is held at its Re = 3e5 value rather than
        extrapolated).
    @param reynolds_d Diameter-based Reynolds number, dimensionless.
    @returns Sphere drag coefficient, dimensionless.
    """
    re = float(reynolds_d)
    if re <= 0.0:
        return 0.0
    re_eval = min(re, 3.0e5)  # do not extrapolate past the drag crisis
    if re_eval < 1.0e-6:
        return 24.0 / 1.0e-6
    stokes_term = 24.0 / re_eval * (1.0 + 0.15 * re_eval ** 0.687)
    plateau_term = 0.42 / (1.0 + 4.25e4 * re_eval ** -1.16)
    return stokes_term + plateau_term


def sphere_nusselt(reynolds_d: float, prandtl: float, rayleigh: float) -> float:
    """
    @description Nusselt number for a sphere, dimensionless, taking the larger of
        forced and natural convection.

        Forced (Ranz & Marshall, 1952):
            Nu = 2 + 0.6 Re^0.5 Pr^(1/3)
        Natural (Churchill, sphere):
            Nu = 2 + 0.589 Ra^0.25 / [1 + (0.469/Pr)^(9/16)]^(4/9)

        The floor of 2 is the exact conduction limit for a sphere in a quiescent
        infinite medium, so a balloon drifting with the wind (Re -> 0) still
        exchanges heat instead of decoupling thermally, which is the bug that
        makes naive superheat models run away.
    @param reynolds_d Diameter-based Reynolds number, dimensionless.
    @param prandtl Prandtl number, dimensionless.
    @param rayleigh Rayleigh number, dimensionless.
    @returns Nusselt number, dimensionless.
    """
    re = max(float(reynolds_d), 0.0)
    nu_forced = 2.0 + 0.6 * np.sqrt(re) * prandtl ** (1.0 / 3.0)
    ra = max(float(rayleigh), 0.0)
    denom = (1.0 + (0.469 / prandtl) ** (9.0 / 16.0)) ** (4.0 / 9.0)
    nu_natural = 2.0 + 0.589 * ra ** 0.25 / denom
    return float(max(nu_forced, nu_natural))


class BuoyancyVolume:
    """
    @description A sealed, fixed-volume super-pressure gas cell: the balloon
        archetype's only force-producing element. Produces net buoyancy (gross
        Archimedes lift minus gas weight minus film weight), Re-dependent sphere
        drag against the local wind, and carries a conduction + radiation
        superheat state for the burst-pressure margin.

        MASS CONVENTION: this element accounts for BOTH the lifting-gas mass and
        the envelope film mass in its own force. Neither may appear in
        BodyState.mass_kg or the vehicle is weighed twice.
    """

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "volume_m3": Bounds(0.0, 1.0e6, lo_open=True, unit="m3",
                            why="a sealed cell has real volume; 1e6 m3 is "
                                "already a stratospheric giant"),
        "film_mass_kg": Bounds(0.0, 1.0e4, lo_open=True, unit="kg",
                               why="NEGATIVE film mass was free lift "
                                   "(film_mass_kg=-100 bought 981 N for "
                                   "nothing) and ZERO was a skinless envelope "
                                   "(round 4); the 0.018 kg/m2 areal floor is "
                                   "cross-checked against surface area"),
        "superpressure_Pa": Bounds(0.0, 1.0e5, unit="Pa",
                                   why="a negative superpressure is not a "
                                       "super-pressure cell; 1 bar over "
                                       "ambient bursts any envelope"),
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
        volume_m3: float,
        gas: str = "helium",
        film_mass_kg: float | None = None,
        superpressure_Pa: float = 0.0,
        absorptivity: float = 0.9,
        emissivity: float = 0.9,
        body_index: int = 0,
        offset_m: np.ndarray | None = None,
        ground_albedo: float = 0.2,
        envelope_film: str = "lldpe_38um",
        uv_grade: str = "stabilized",
        hull_structure: str = "vented_ballonet",
    ) -> None:
        """
        @description Construct a super-pressure gas cell.
        @param volume_m3 Enclosed gas volume V, m^3. Constant (super-pressure).
        @param gas Lifting gas, one of {"helium", "hydrogen"}.
        @param film_mass_kg Envelope film mass, kg. Subtracted from lift here,
            NOT carried in BodyState.mass_kg. Leave None (the normal path,
            round 4) and it is DERIVED as surface area x
            BALLOON_FILM_AREAL_DENSITY_KG_M2 (38 um LLDPE super-pressure
            practice). An explicit value is floor-checked at
            MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2 x surface area (20 um PE, the
            thinnest film flown); zero or negative RAISES -- a skinless
            envelope was free displaced-air lift.
        @param superpressure_Pa Design over-pressure at inflation, Pa: the gas is
            charged so p_gas = p_ambient + superpressure_Pa at ambient
            temperature on the first evaluation.
        @param absorptivity Solar absorptivity of the envelope, dimensionless 0..1.
        @param emissivity Infrared emissivity of the envelope, dimensionless 0..1.
            Also serves as the IR absorptivity by Kirchhoff's law.
        @param body_index Index of the body this cell is attached to.
        @param offset_m Attachment offset from the body reference point, m.
        @param ground_albedo Ground reflectance, dimensionless 0..1, for the
            upwelling shortwave term.
        @param envelope_film Envelope film for permeation/UV chemistry
            (SPEC_chemistry sections 5-6): 'lldpe_38um' (default, StratoFilm
            class), 'mylar_38um', 'metallized_mylar_38um', or the EXPLICIT
            'ideal' (no permeation, no UV -- regression path only, warns).
        @param uv_grade UV stabilization grade: 'stabilized' (default -- what
            anyone actually flies, NASA ULDB practice) or 'unstabilized'
            (the what-if/regression case, ~29 days at float dose).
        @param hull_structure Structural closure of the superheat pressure
            gap (SPEC_materials section 4): 'vented_ballonet' (default,
            RECOMMENDED: vent valve + air ballonet mass billed here),
            'superpressure_pet' (PET skin sized to carry the design
            superpressure, mass billed here), or the EXPLICIT 'ideal' (no
            closure mass -- regression path only, warns).
        """
        if envelope_film not in ENVELOPE_FILM_OPTIONS:
            raise ParamBoundsError(
                f"envelope_film {envelope_film!r} not in "
                f"{sorted(ENVELOPE_FILM_OPTIONS)}")
        if uv_grade not in UV_GRADE_OPTIONS:
            raise ParamBoundsError(
                f"uv_grade {uv_grade!r} not in {sorted(UV_GRADE_OPTIONS)}")
        if hull_structure not in HULL_STRUCTURE_OPTIONS:
            raise ParamBoundsError(
                f"hull_structure {hull_structure!r} not in "
                f"{sorted(HULL_STRUCTURE_OPTIONS)}")
        if envelope_film == "ideal" or hull_structure == "ideal":
            warnings.warn(
                "BuoyancyVolume built with an EXPLICIT ideal envelope "
                f"(envelope_film={envelope_film!r}, "
                f"hull_structure={hull_structure!r}): no permeation/UV "
                "and/or no hull-closure mass. Regression path only.",
                IdealEnvelopeWarning, stacklevel=2)
        self.envelope_film = envelope_film
        self.uv_grade = uv_grade
        self.hull_structure = hull_structure
        checked = validate_declared(
            type(self),
            volume_m3=volume_m3,
            superpressure_Pa=superpressure_Pa,
            absorptivity=absorptivity,
            emissivity=emissivity,
            ground_albedo=ground_albedo,
        )
        self.volume_m3 = checked["volume_m3"]
        self.gas = gas.strip().lower()
        self.design_superpressure_Pa = checked["superpressure_Pa"]
        self.absorptivity = checked["absorptivity"]
        self.emissivity = checked["emissivity"]
        self.body_index = int(body_index)
        self.offset_m = as_offset(offset_m)
        self.ground_albedo = checked["ground_albedo"]

        self.R_spec_J_kgK = specific_gas_constant_J_kgK(self.gas)
        self.cv_J_kgK = specific_heat_cv_J_kgK(self.gas)

        # Equivalent-sphere geometry from the enclosed volume.
        #: Sphere radius, m: r = (3V / 4pi)^(1/3).
        self.radius_m = (3.0 * self.volume_m3 / (4.0 * np.pi)) ** (1.0 / 3.0)
        #: Sphere diameter, m.
        self.diameter_m = 2.0 * self.radius_m
        #: Total envelope surface area, m^2 = 4 pi r^2.
        self.surface_area_m2 = 4.0 * np.pi * self.radius_m ** 2
        #: Area projected toward the sun, m^2 = pi r^2.
        self.projected_area_m2 = np.pi * self.radius_m ** 2

        if film_mass_kg is None:
            #: Envelope film mass, kg -- DERIVED (round 4): surface area x the
            #: cited areal density of the SELECTED envelope film (round-5
            #: chemistry: PET films weigh 1390/920 x the LLDPE default; the
            #: 'ideal' path keeps the legacy LLDPE constant bit-for-bit).
            #: The skin is billed like every other element mass; it is
            #: subtracted from lift in evaluate(), never carried in
            #: BodyState.mass_kg.
            self.film_mass_kg = (
                self.surface_area_m2
                * ENVELOPE_FILM_AREAL_DENSITY_KG_M2[self.envelope_film]
            )
        else:
            self.film_mass_kg = validate_declared(
                type(self), film_mass_kg=film_mass_kg
            )["film_mass_kg"]

        #: Hull structural closure mass, kg -- BILLED like the film
        #: (SPEC_materials section 4): the superheat pressure gap does not
        #: close for free. Re-derived at recheck in validate_cross_params.
        self.hull_closure_mass_kg = self._derive_hull_closure_mass_kg()

        # -- envelope chemistry accrued state (SPEC_chemistry 5-6) ----------
        #: Fraction of the inflation helium charge still in the cell, [-].
        self.helium_frac_remaining: float = 1.0
        #: Accumulated UV dose on the film, MJ/m^2 (daylight only).
        self.uv_dose_MJ_m2: float = 0.0
        #: Film strength retention exp(-D/D_c), [-]; the mission hard-ends
        #: below UV_RETENTION_MISSION_FLOOR (0.5).
        self.uv_retention: float = 1.0

        # Cross-parameter constraint: the film must clear the areal floor for
        # the surface area its own volume implies (re-derived at recheck).
        self.validate_cross_params()

        #: Sealed gas mass, kg. None until the first evaluate() fixes it from
        #: the ambient state (lazy inflation -- the cell cannot know its
        #: charge before it knows the atmosphere it was launched into).
        #: Round 5: initialised HERE, not in validate_cross_params, so a
        #: recheck on a live cell no longer re-inflates it (free makeup gas).
        self.gas_mass_kg: float | None = None
        #: Gas temperature, K. None until inflation.
        self.gas_temp_K: float | None = None
        #: Inflation charge, kg -- the denominator of helium_frac_remaining.
        self._gas_mass_inflated_kg: float | None = None

    def _derive_hull_closure_mass_kg(self) -> float:
        """
        @description Hull closure mass for THIS cell's volume and design
            superpressure, kg (SPEC_materials section 4, scaled from the
            hybrid design point by the same physics): 'vented_ballonet' =
            ballonet fabric over the diurnal volume swing + valve/blower
            (hull.vented_ballonet_mass_kg); 'superpressure_pet' = a PET skin
            sized on the sphere membrane equation t = dP*r/(2*sigma_allow)
            at the H11 50 MPa allowable, billed as ADDITIONAL structural
            skin over the permeation film (fail-closed: slightly over-bills);
            'ideal' = 0 (explicit regression path).
        @returns Closure mass, kg.
        """
        if self.hull_structure == "vented_ballonet":
            return vented_ballonet_mass_kg(self.volume_m3)
        if self.hull_structure == "superpressure_pet":
            pet = MATERIAL_CATALOGUE["mylar_25um"]  # PET-family rho + H11 allow
            t_pet_m = (self.design_superpressure_Pa * self.radius_m
                       / (2.0 * pet.sigma_allow_Pa))
            return t_pet_m * pet.rho_kgm3 * self.surface_area_m2
        return 0.0

    def validate_cross_params(self) -> None:
        """
        @description Constraint a single (lo, hi) bound cannot express,
            re-runnable on a live instance by
            param_bounds.recheck_element_params (round-4 defense in depth):
            the envelope film must weigh at least
            MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2 x its surface area -- and the
            surface area is RE-DERIVED here from volume_m3, so a bypass-built
            cell (or one whose volume/film was mutated after construction)
            cannot present a big displaced volume with a token skin.
        @returns None. Raises on violation.
        @raises ParamBoundsError When the film undercuts the 20 um-PE areal
            floor for the volume's own surface area.
        """
        radius_m = (3.0 * float(self.volume_m3) / (4.0 * np.pi)) ** (1.0 / 3.0)
        surface_area_m2 = 4.0 * np.pi * radius_m ** 2
        floor_kg = MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2 * surface_area_m2
        if self.film_mass_kg < floor_kg * (1.0 - 1.0e-9):
            raise ParamBoundsError(
                f"BuoyancyVolume film_mass_kg = {self.film_mass_kg:g} kg over a "
                f"{self.volume_m3:g} m3 envelope ({surface_area_m2:.2f} m2 of "
                f"skin) is below the "
                f"{MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2:g} kg/m2 areal floor "
                f"({floor_kg:.3f} kg): thinner than the 20 um PE film of any "
                f"super-pressure balloon flown. A skinless envelope is free "
                f"displaced-air lift. Pass film_mass_kg=None to derive an "
                f"honest film ({BALLOON_FILM_AREAL_DENSITY_KG_M2:g} kg/m2)."
            )

        # Round-5 (same round-4 pattern as the film): the hull closure mass
        # must match what this cell's OWN volume / superpressure / structure
        # option derive -- a bypass-built or mutated cell cannot present a
        # big envelope with a token (or stale) closure bill.
        if hasattr(self, "hull_closure_mass_kg"):
            derived_kg = self._derive_hull_closure_mass_kg()
            tol = 1.0e-6 * max(1.0, abs(derived_kg))
            if abs(self.hull_closure_mass_kg - derived_kg) > tol:
                raise ParamBoundsError(
                    f"BuoyancyVolume hull_closure_mass_kg = "
                    f"{self.hull_closure_mass_kg:g} kg is stale: the live "
                    f"volume {self.volume_m3:g} m3 / superpressure "
                    f"{self.design_superpressure_Pa:g} Pa / "
                    f"'{self.hull_structure}' closure derives {derived_kg:g} "
                    f"kg. The superheat gap does not close for free."
                )

    # -- derived state -------------------------------------------------------

    @property
    def gas_density_kgm3(self) -> float:
        """
        @description Gas density m_gas / V, kg/m^3. CONSTANT after inflation --
            this is what makes super-pressure lift independent of superheat.
        @returns Gas density, kg/m^3; 0.0 before inflation.
        """
        if self.gas_mass_kg is None:
            return 0.0
        return self.gas_mass_kg / self.volume_m3

    @property
    def gas_pressure_Pa(self) -> float:
        """
        @description Current internal gas pressure from the ideal gas law
            p = m R_spec T / V, Pa.
        @returns Internal pressure, Pa; 0.0 before inflation.
        """
        if self.gas_mass_kg is None or self.gas_temp_K is None:
            return 0.0
        return self.gas_mass_kg * self.R_spec_J_kgK * self.gas_temp_K / self.volume_m3

    def superpressure_Pa(self, ambient_p_Pa: float) -> float:
        """
        @description Current over-pressure relative to ambient, Pa. Negative means
            the envelope has gone slack and the fixed-volume assumption no longer
            holds -- the cell is then a zero-pressure balloon and this model is
            out of its validity range.
        @param ambient_p_Pa Ambient static pressure, Pa.
        @returns p_gas - p_ambient, Pa.
        """
        return self.gas_pressure_Pa - float(ambient_p_Pa)

    def displaced_air_mass_kg(self, rho_air_kgm3: float) -> float:
        """
        @description Mass of air displaced by the envelope, kg. Exposed for the
            integrator's added-mass handling: a balloon accelerating through air
            entrains roughly half the displaced mass, which materially changes
            the response of a tethered two-body system.
        @param rho_air_kgm3 Ambient density, kg/m^3.
        @returns Displaced air mass, kg.
        """
        return float(rho_air_kgm3) * self.volume_m3

    def gross_lift_N(self, rho_air_kgm3: float) -> float:
        """
        @description Gross Archimedes lift minus gas weight, newtons -- the
            "gross lift" the project's balloon cross-checks quote. Excludes film
            and payload weight.
        @param rho_air_kgm3 Ambient air density, kg/m^3.
        @returns Gross lift, N, positive up.
        """
        return (float(rho_air_kgm3) - self.gas_density_kgm3) * self.volume_m3 * G0_MS2

    # -- inflation and thermal state ----------------------------------------

    def _inflate(self, atmo: "AtmoSample") -> None:
        """
        @description Fix the sealed gas charge on first evaluation: the cell is
            filled to p_gas = p_ambient + design superpressure at ambient
            temperature. After this the gas mass never changes.
        @param atmo Ambient atmosphere sample at the inflation altitude.
        """
        p_gas_Pa = float(atmo.p_Pa) + self.design_superpressure_Pa
        t_gas_K = float(atmo.T_K)
        rho_gas_kgm3 = p_gas_Pa / (self.R_spec_J_kgK * t_gas_K)
        self.gas_mass_kg = rho_gas_kgm3 * self.volume_m3
        self.gas_temp_K = t_gas_K
        self._gas_mass_inflated_kg = self.gas_mass_kg
        self.helium_frac_remaining = 1.0

    def helium_loss_frac_per_day(self, t_film_K: float) -> float:
        """
        @description Fractional helium (= lift, once slack) loss rate of this
            envelope, 1/day, at the given film temperature (SPEC_chemistry
            5.2-5.3):

                frac/day = 86400 * P(T) * R * T_ref * A / (L * V)
                P(T) = P_25C * exp(-E_P/R * (1/T - 1/298.15))

            with the mole count held at the 288 K anchor reference (ledger
            B1) so the two-independent-unit-chain anchors reproduce: the
            1.37 m^3 / 38 um LLDPE hybrid loses 3.4 %/day at 25 C, 1.4 at
            +5 C, 0.04 at -56 C; a 10 m^3 sphere 1.8 %/day (loss scales with
            A/V); metallized Mylar ~0.006 %/day. The pressure cancels
            (Delta-p_He ~ p on both sides of the fraction), so altitude
            enters only through temperature.
        @param t_film_K Film temperature, K.
        @returns Fractional loss rate, 1/day (e.g. 0.034 = 3.4 %/day);
            exactly 0.0 for the explicit 'ideal' film.
        @raises ParamBoundsError When t_film_K is outside 150-400 K.
        """
        t = float(t_film_K)
        if not (150.0 <= t <= 400.0):
            raise ParamBoundsError(
                f"helium_loss_frac_per_day: t_film_K = {t_film_K!r} outside "
                f"[150, 400] K -- no balloon film operates there.")
        if self.envelope_film == "ideal":
            return 0.0
        p_25 = HELIUM_PERMEABILITY_25C_MOL_M_S_PA[self.envelope_film]
        p_T = p_25 * math.exp(
            -(HE_PERMEATION_EA_J_MOL / R_GAS_J_MOLK)
            * (1.0 / t - 1.0 / HE_PERMEATION_REF_T_K))
        return (86400.0 * p_T * R_GAS_J_MOLK * HE_MOLE_COUNT_REF_T_K
                * self.surface_area_m2
                / (ENVELOPE_FILM_THICKNESS_M * self.volume_m3))

    def _accrue_envelope_chemistry(self, sol: "SolarSample", dt_s: float) -> None:
        """
        @description Advance the permeation and UV state one step
            (SPEC_chemistry 5-6). Helium leaves at the film-temperature
            permeation rate (film temperature taken as the gas temperature,
            ledger B1); UV dose accrues ONLY while the sun is up, at the
            7.7%-of-TSI band irradiance (ledger B2), and the retention is
            exp(-D/D_c) with D_c set by film family and uv_grade (H17).
        @param sol Local solar sample (elevation + irradiance components).
        @param dt_s Timestep, s.
        """
        if self.envelope_film == "ideal" or self.gas_mass_kg is None or dt_s <= 0.0:
            return
        t_film_K = float(self.gas_temp_K)
        rate_per_day = self.helium_loss_frac_per_day(t_film_K)
        self.gas_mass_kg *= max(0.0, 1.0 - rate_per_day * dt_s / 86400.0)
        self.helium_frac_remaining = (
            self.gas_mass_kg / float(self._gas_mass_inflated_kg))
        elevation_rad = float(getattr(sol, "elevation_rad", 0.0))
        if elevation_rad > 0.0:
            uv_Wm2 = UV_FRACTION_OF_TSI * (
                float(getattr(sol, "dni_Wm2", 0.0))
                + float(getattr(sol, "dhi_Wm2", 0.0)))
            self.uv_dose_MJ_m2 += max(0.0, uv_Wm2) * dt_s * 1.0e-6
        d_c = UV_DC_MJ_M2[self.uv_grade]
        if self.envelope_film in ("mylar_38um", "metallized_mylar_38um"):
            d_c = max(d_c, UV_DC_PET_FACTOR * UV_DC_MJ_M2["unstabilized"])
        self.uv_retention = math.exp(-self.uv_dose_MJ_m2 / d_c)

    def _thermal_step(
        self,
        atmo: "AtmoSample",
        sol: "SolarSample",
        airspeed_ms: float,
        dt_s: float,
    ) -> dict:
        """
        @description Integrate the gas temperature one step under conduction and
            radiation. Reimplements the JSBSim FGGasCell heat-balance form
            (conduction + solar + IR) without adopting its 6-DOF coupling.

            Energy balance on the lumped gas+film mass:
                m cv dT/dt = Q_convection + Q_solar + Q_infrared
            with
                Q_convection = h A_surf (T_air - T_gas),  h = Nu k / D
                Q_solar      = alpha (DNI A_proj + DHI A_surf/2
                                      + albedo GHI A_surf/2)
                Q_infrared   = eps sigma A_surf (T_env^4 - T_gas^4)
                T_env^4      = 0.5 T_earth_ir^4 + 0.5 T_air^4

            Integrated with an exponential (exact for the linearised balance)
            update rather than explicit Euler, so a 60 s energy-loop timestep
            cannot overshoot into oscillation -- the convective time constant of
            a small balloon is far below 60 s and explicit Euler would go
            unstable there.

        @param atmo Ambient atmosphere sample.
        @param sol Local solar sample.
        @param airspeed_ms Air-relative speed of the balloon, m/s.
        @param dt_s Timestep, s.
        @returns Diagnostics dict with the heat terms in W and the equilibrium
            temperature in K.
        """
        t_air_K = float(atmo.T_K)
        rho_air = float(atmo.rho_kgm3)
        mu_air = float(atmo.mu_Pas)

        # Thermal conductivity of air from the Prandtl definition Pr = cp mu / k.
        k_air_W_mK = CP_AIR_J_KGK * mu_air / PR_AIR  # W/(m*K)

        # Forced-convection Reynolds number on the sphere diameter.
        re_d = rho_air * abs(airspeed_ms) * self.diameter_m / mu_air  # dimensionless

        # Rayleigh number for the natural-convection branch.
        # Ra = g beta dT D^3 rho^2 cp / (mu k), with beta = 1/T for an ideal gas.
        delta_T_K = abs((self.gas_temp_K or t_air_K) - t_air_K)
        rayleigh = (
            G0_MS2
            * (1.0 / t_air_K)
            * delta_T_K
            * self.diameter_m ** 3
            * rho_air ** 2
            * CP_AIR_J_KGK
            / (mu_air * k_air_W_mK)
        )

        nusselt = sphere_nusselt(re_d, PR_AIR, rayleigh)  # dimensionless
        h_W_m2K = nusselt * k_air_W_mK / self.diameter_m  # W/(m^2*K)

        # Convective conductance, W/K.
        conductance_W_K = h_W_m2K * self.surface_area_m2

        # Shortwave absorption, W. Sun below the horizon contributes no beam.
        elevation_rad = float(getattr(sol, "elevation_rad", 0.0))
        dni = float(getattr(sol, "dni_Wm2", 0.0)) if elevation_rad > 0.0 else 0.0
        dhi = float(getattr(sol, "dhi_Wm2", 0.0)) if elevation_rad > 0.0 else 0.0
        ghi = float(getattr(sol, "ghi_Wm2", 0.0)) if elevation_rad > 0.0 else 0.0
        q_solar_W = self.absorptivity * (
            dni * self.projected_area_m2
            + dhi * self.surface_area_m2 * 0.5
            + self.ground_albedo * ghi * self.surface_area_m2 * 0.5
        )

        # Longwave environment: lower hemisphere sees the Earth, upper sees the
        # atmosphere at roughly the local air temperature.
        t_env4 = 0.5 * EARTH_IR_TEMP_K ** 4 + 0.5 * t_air_K ** 4  # K^4
        ir_coeff_W_K4 = self.emissivity * SIGMA_SB_W_M2K4 * self.surface_area_m2

        # Linearise the T^4 emission about the current gas temperature so the
        # step can be solved exactly: eps sigma A (T_env^4 - T^4)
        #   ~= Q_ir0 - k_ir (T - T0),  k_ir = 4 eps sigma A T0^3
        t_gas_K = float(self.gas_temp_K if self.gas_temp_K is not None else t_air_K)
        q_ir0_W = ir_coeff_W_K4 * (t_env4 - t_gas_K ** 4)
        k_ir_W_K = 4.0 * ir_coeff_W_K4 * t_gas_K ** 3

        # dT/dt = [Q0 - K (T - T0)] / (m cv), where
        #   Q0 = conductance*(T_air - T0) + q_solar + q_ir0
        #   K  = conductance + k_ir
        q0_W = conductance_W_K * (t_air_K - t_gas_K) + q_solar_W + q_ir0_W
        k_total_W_K = conductance_W_K + k_ir_W_K

        thermal_mass_J_K = max(
            (self.gas_mass_kg or 0.0) * self.cv_J_kgK
            + self.film_mass_kg * 1500.0,  # film cp ~1500 J/(kg*K) for PE/mylar
            1.0e-9,
        )

        if k_total_W_K > 0.0 and dt_s > 0.0:
            t_equilibrium_K = t_gas_K + q0_W / k_total_W_K
            tau_s = thermal_mass_J_K / k_total_W_K  # time constant, s
            decay = float(np.exp(-dt_s / tau_s)) if tau_s > 0.0 else 0.0
            self.gas_temp_K = t_equilibrium_K + (t_gas_K - t_equilibrium_K) * decay
        else:
            t_equilibrium_K = t_gas_K

        return {
            "h_W_m2K": h_W_m2K,
            "nusselt": nusselt,
            "reynolds_d": re_d,
            "q_solar_W": q_solar_W,
            "q_ir_W": q_ir0_W,
            "q_conv_W": conductance_W_K * (t_air_K - t_gas_K),
            "t_equilibrium_K": t_equilibrium_K,
            "superheat_K": float(self.gas_temp_K) - t_air_K,
        }

    # -- the ForceElement contract ------------------------------------------

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
        @description Net force from the gas cell: buoyancy minus gas and film
            weight, plus sphere drag against the local relative wind.

            FREE-ENERGY GUARD: drag is computed from the air-relative velocity
            only (relative_airspeed_vector), so it is identically zero when the
            balloon moves with the air. A balloon in uniform wind therefore feels
            no force at all in the air's frame and can extract nothing, which is
            the correct physics and the reason archetype 2 needs no shear.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @param sol Local solar sample.
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns ElementForce; power_elec_W is exactly 0.0 (a balloon converts
            nothing electrically).
        """
        body = bodies[self.body_index]

        if self.gas_mass_kg is None:
            self._inflate(atmo)

        airspeed_vec_ms = relative_airspeed_vector(body, wind)
        airspeed_ms = float(np.linalg.norm(airspeed_vec_ms))

        if dt_s > 0.0:
            self._thermal_step(atmo, sol, airspeed_ms, dt_s)
            self._accrue_envelope_chemistry(sol, dt_s)

        rho_air = float(atmo.rho_kgm3)

        # Buoyancy: gross Archimedes lift, less the weight of the gas, film
        # and hull closure. Round-5 chemistry: with a REAL film the displaced
        # volume is slack-aware -- once permeation has drained the charge
        # below p_amb*V/(R_spec*T) the fixed-volume assumption ends and the
        # cell displaces only V_zp = m*R_spec*T/p_amb (zero-pressure limit,
        # lift ~ n_He, SPEC_chemistry 5.2). With the explicit 'ideal' film
        # (no permeation) V_disp == V always and this is bit-identical to
        # the previous model.
        displaced_m3 = self.volume_m3
        if (self.envelope_film != "ideal" and self.gas_mass_kg is not None
                and self.gas_temp_K is not None):
            v_zp_m3 = (self.gas_mass_kg * self.R_spec_J_kgK
                       * float(self.gas_temp_K) / float(atmo.p_Pa))
            displaced_m3 = min(self.volume_m3, v_zp_m3)
        gas_mass_kg = self.gas_mass_kg or 0.0
        net_lift_N = (
            (rho_air * displaced_m3 - gas_mass_kg) * G0_MS2
            - (self.film_mass_kg + self.hull_closure_mass_kg) * G0_MS2
        )
        force_N = np.array([0.0, 0.0, net_lift_N], dtype=float)

        # Sphere drag, opposing motion through the air.
        if airspeed_ms > 0.0:
            re_d = rho_air * airspeed_ms * self.diameter_m / float(atmo.mu_Pas)
            cd = sphere_drag_coefficient(re_d)  # dimensionless
            drag_N = 0.5 * rho_air * airspeed_ms ** 2 * cd * self.projected_area_m2
            force_N = force_N - drag_N * (airspeed_vec_ms / airspeed_ms)

        return ElementForce(
            force_N=force_N,
            moment_Nm=moment_from_offset(self.offset_m, force_N),
            power_elec_W=0.0,
        )
