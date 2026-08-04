"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module (SPEC_materials section 4): hull structural closure for the hybrid's measured 9-12 kPa superheat superpressure. Prolate-spheroid membrane stresses (hoop ~0.944*dP*b/t at the 3:1 equator), the fail-closed film-stress check that REFUSES the unlobed 38 um LLDPE skin at 12.35 kPa (~155 MPa hoop vs 5 MPa allowable -- the hull as previously billed cannot exist), and the two honest closures: Option A vented + air ballonet (+0.202 kg: ballonet 0.082 + valve/blower 0.120, setpoint 200 Pa, ~5 W blower duty) and Option B true-superpressure PET skin (~+1.0 kg incl. Dyneema tendon set). Pumpkin lobing is documented as NOT constructible at this scale (15 mm lobe radius) so nobody resurrects it.
"""

from __future__ import annotations

import math
from typing import NamedTuple

from .mass import MassClosureError
from .materials import MATERIAL_CATALOGUE
from .param_bounds import ParamBoundsError, require_in_range

# ---------------------------------------------------------------------------
# The hybrid design point (measured, HYBRID_piecewise superheat ledger)
# ---------------------------------------------------------------------------

#: Hybrid envelope volume, m^3 (3:1 teardrop, ellipsoid variant).
HYBRID_ENVELOPE_VOLUME_M3: float = 1.61

#: Prolate 3:1 semi-minor axis b, m: V = (4/3) pi a b^2 with a = 3 b.
HYBRID_SEMI_MINOR_M: float = (HYBRID_ENVELOPE_VOLUME_M3 / (4.0 * math.pi)) ** (1.0 / 3.0)

#: Prolate 3:1 semi-major axis a, m.
HYBRID_SEMI_MAJOR_M: float = 3.0 * HYBRID_SEMI_MINOR_M

#: Hybrid envelope surface area, m^2 -- exact prolate-spheroid closed form,
#: derived at import (never hand-typed): A = 2 pi b^2 (1 + (a/(b e)) asin e).
_ECC: float = math.sqrt(1.0 - (HYBRID_SEMI_MINOR_M / HYBRID_SEMI_MAJOR_M) ** 2)
HYBRID_SURFACE_AREA_M2: float = (
    2.0 * math.pi * HYBRID_SEMI_MINOR_M ** 2
    * (1.0 + (HYBRID_SEMI_MAJOR_M / (HYBRID_SEMI_MINOR_M * _ECC)) * math.asin(_ECC))
)

#: Measured peak superpressure at float, still air, Pa (HYBRID_piecewise.out:
#: peak superheat 35.2 K on the sealed cell).
HYBRID_PEAK_SUPERPRESSURE_PA: float = 12345.0

#: Measured peak superheat, K, and ambient temperature at ~500 m ISA, K --
#: they size the diurnal ballonet volume swing dV/V = dT/T = 0.124.
HYBRID_PEAK_SUPERHEAT_K: float = 35.2
HYBRID_AMBIENT_T_K: float = 285.0

#: Envelope film thickness, m (38 um LLDPE, StratoFilm-420 class).
HULL_FILM_THICKNESS_M: float = 38.0e-6

#: Vent-valve superpressure setpoint, Pa. SPEC_materials 4.1: a spring/servo
#: vent valve holds the helium cell at 100-200 Pa; 200 Pa is the design upper
#: edge (and the value the film-stress pass is demonstrated at). This also
#: supersedes the old 500 Pa constant inflation, which already put the 38 um
#: skin at 6.3 MPa hoop -- over the H7 long-duration allowable.
VENT_SETPOINT_PA: float = 200.0

#: Ballonet fabric areal density, kg/m^2. HONESTY H9: light urethane-coated
#: nylon class; vendor row needed before build.
BALLONET_FABRIC_KG_M2: float = 0.050

#: Vent valve + ballonet re-inflation blower, kg and W. HONESTY H10: COTS
#: class estimate; pick a real part before build. Blower duty is minutes/day
#: at ~5 W -- billed as an explicit PayloadLoad line by builders, never lost.
VALVE_BLOWER_MASS_KG: float = 0.120
BLOWER_DUTY_W: float = 5.0

#: Sphere surface per V^(2/3), dimensionless: (36 pi)^(1/3), isoperimetric
#: minimum -- the ballonet is billed at the least fabric that can hold its
#: volume, so the closure mass is a floor-side estimate.
_SPHERE_AREA_PER_V23: float = (36.0 * math.pi) ** (1.0 / 3.0)

#: Meridional tendon count and half-meridian length coefficient (~half
#: ellipse perimeter, 2.42*a) for the superpressure option's tendon set.
TENDON_COUNT: int = 12
TENDON_MERIDIAN_LENGTH_COEFF: float = 2.42

#: Rope-level Dyneema design strength for tendons, Pa: fibre 3.3 GPa (LOW end
#: of the DSM 3.3-3.9 band -- fail-closed, over-bills tendon mass) x 0.85
#: braid x 0.5 termination knockdown (H8), matching SPEC_materials_calc.py.
DYNEEMA_TENDON_DESIGN_PA: float = 3.3e9 * 0.85 * 0.5

#: Tendon safety factor (same visible FAR-23 1.5).
TENDON_SAFETY_FACTOR: float = 1.5


class HullClosure(NamedTuple):
    """
    @description One honest way to close the hull superpressure gap.
    @param added_mass_kg Mass added over the already-billed 38 um film +
        tapes, kg.
    @param setpoint_Pa Superpressure the film actually carries after the
        closure, Pa.
    @param blower_duty_W Ballonet blower electrical draw while running, W
        (minutes/day duty; billed by the mission module as a PayloadLoad).
    """

    added_mass_kg: float
    setpoint_Pa: float
    blower_duty_W: float


def hull_membrane_stress_Pa(
    dp_Pa: float, b_m: float, a_m: float, t_m: float
) -> tuple[float, float]:
    """
    @description Membrane stresses at the equator of a prolate spheroid under
        internal overpressure, Pa (SPEC_materials section 4; R_hoop = b,
        R_merid = a^2/b; sigma_m/R_m + sigma_h/R_h = dP/t):

            sigma_merid = dP * b / (2 t)
            sigma_hoop  = (dP * b / t) * (1 - b^2/(2 a^2))

        At 3:1 the hoop factor is 0.944 -- cylinder-like. Pasted anchor: at
        12.3 kPa on 38 um, hoop 155 MPa / meridional 82 MPa.
    @param dp_Pa Internal overpressure dP, Pa.
    @param b_m Semi-minor axis b, m.
    @param a_m Semi-major axis a, m (a >= b).
    @param t_m Film thickness t, m.
    @returns (sigma_hoop_Pa, sigma_merid_Pa).
    @raises ParamBoundsError On out-of-range inputs or a < b.
    """
    dp = require_in_range("dp_Pa", dp_Pa, 0.0, 1.0e5, unit="Pa",
                          element="hull",
                          why="negative overpressure is a slack envelope; "
                              "1 bar over ambient bursts anything here")
    b = require_in_range("b_m", b_m, 0.0, 50.0, lo_open=True, unit="m",
                         element="hull", why="hull radius of this class")
    a = require_in_range("a_m", a_m, 0.0, 150.0, lo_open=True, unit="m",
                         element="hull", why="hull length of this class")
    t = require_in_range("t_m", t_m, 1.0e-6, 5.0e-3, unit="m",
                         element="hull",
                         why="below 1 um no envelope film exists; above 5 mm "
                             "is not a film")
    if a < b:
        raise ParamBoundsError(
            f"hull semi-major a = {a:g} m < semi-minor b = {b:g} m: not a "
            f"prolate spheroid."
        )
    sigma_merid_Pa = dp * b / (2.0 * t)
    sigma_hoop_Pa = (dp * b / t) * (1.0 - b * b / (2.0 * a * a))
    return sigma_hoop_Pa, sigma_merid_Pa


def require_hull_film_ok(
    dp_Pa: float,
    b_m: float,
    a_m: float,
    t_m: float,
    sigma_allow_Pa: float,
) -> float:
    """
    @description FAIL-CLOSED film-stress gate: refuse a hull whose membrane
        stress exceeds the film's long-duration allowable. This is the check
        that kills the previously-billed bare 500 Pa / 12.35 kPa unlobed
        LLDPE skin (hoop ~155 MPa vs 5 MPa allowable, 2-6x BREAK stress --
        the hull cannot exist; SPEC_materials section 4). Pumpkin lobing does
        NOT rescue it: the required lobe radius at 38 um / 5 MPa is 15 mm --
        hundreds of lobes on a 1 m hull, not constructible at this scale.
    @param dp_Pa Overpressure the film must carry, Pa.
    @param b_m Semi-minor axis, m.
    @param a_m Semi-major axis, m.
    @param t_m Film thickness, m.
    @param sigma_allow_Pa Long-duration film allowable, Pa (H7: 5 MPa LLDPE;
        H11: 50 MPa PET).
    @returns The governing (hoop) stress, Pa, when it passes.
    @raises ParamBoundsError When the film is over its allowable.
    """
    allow = require_in_range("sigma_allow_Pa", sigma_allow_Pa, 1.0e5, 1.0e9,
                             unit="Pa", element="hull",
                             why="film allowables live between 0.1 MPa and "
                                 "1 GPa")
    hoop_Pa, merid_Pa = hull_membrane_stress_Pa(dp_Pa, b_m, a_m, t_m)
    governing_Pa = max(hoop_Pa, merid_Pa)
    if governing_Pa > allow:
        raise ParamBoundsError(
            f"hull film REFUSED: dP = {dp_Pa:g} Pa on t = {t_m * 1e6:.0f} um "
            f"gives hoop {hoop_Pa / 1e6:.1f} MPa / meridional "
            f"{merid_Pa / 1e6:.1f} MPa, over the {allow / 1e6:.1f} MPa "
            f"long-duration allowable. This hull cannot exist unlobed; close "
            f"the gap with hull_closure('vented_ballonet') (+0.202 kg, "
            f"200 Pa setpoint) or 'superpressure_pet' (~+1.0 kg)."
        )
    return governing_Pa


def vented_ballonet_mass_kg(volume_m3: float) -> float:
    """
    @description Vented-hull closure mass for an envelope of the given
        volume, kg: an air ballonet sized to the measured diurnal swing
        dV/V = dT_superheat/T_amb = 35.2/285 = 0.124, billed as the
        minimum-surface sphere of fabric (H9) plus the valve/blower (H10).
        For the hybrid's 1.61 m^3 this is the pasted 0.199 m^3 / 1.65 m^2 /
        0.082 kg + 0.120 kg = 0.202 kg.
    @param volume_m3 Envelope volume, m^3.
    @returns Closure mass, kg.
    @raises ParamBoundsError On out-of-range volume.
    """
    v = require_in_range("volume_m3", volume_m3, 0.0, 1.0e6, lo_open=True,
                         unit="m3", element="hull", why="a real envelope")
    dv_m3 = (HYBRID_PEAK_SUPERHEAT_K / HYBRID_AMBIENT_T_K) * v
    ballonet_area_m2 = _SPHERE_AREA_PER_V23 * dv_m3 ** (2.0 / 3.0)
    return BALLONET_FABRIC_KG_M2 * ballonet_area_m2 + VALVE_BLOWER_MASS_KG


def _superpressure_pet_closure() -> HullClosure:
    """
    @description Option B: carry the full measured 12.35 kPa in a PET (Mylar)
        skin at the H11 50 MPa allowable, sized on the hoop equation, plus
        the meridional Dyneema tendon set (axial load dP*pi*b^2 over 12
        tendons at the H8 rope design strength x SF 1.5). Added mass is the
        PET skin minus the already-billed 38 um LLDPE film, plus tendons --
        the pasted ~+1.0 kg. Plain thicker LLDPE (1.17 mm, 8.5 kg) is dead on
        arrival and not offered.
    @returns HullClosure for the PET superpressure hull.
    """
    pet = MATERIAL_CATALOGUE["mylar_25um"]     # PET family row: rho, allow
    b = HYBRID_SEMI_MINOR_M
    a = HYBRID_SEMI_MAJOR_M
    dp = HYBRID_PEAK_SUPERPRESSURE_PA
    t_pet_m = dp * b * (1.0 - b * b / (2.0 * a * a)) / pet.sigma_allow_Pa
    m_pet_kg = t_pet_m * pet.rho_kgm3 * HYBRID_SURFACE_AREA_M2
    lldpe_areal = float(MATERIAL_CATALOGUE["lldpe_38um"].areal_density_kg_m2)
    m_film_billed_kg = lldpe_areal * HYBRID_SURFACE_AREA_M2
    axial_N = dp * math.pi * b * b
    per_tendon_N = axial_N / TENDON_COUNT
    a_tendon_m2 = per_tendon_N * TENDON_SAFETY_FACTOR / DYNEEMA_TENDON_DESIGN_PA
    l_merid_m = TENDON_MERIDIAN_LENGTH_COEFF * a
    m_tendons_kg = (TENDON_COUNT * l_merid_m * a_tendon_m2
                    * MATERIAL_CATALOGUE["dyneema_sk75"].rho_kgm3)
    return HullClosure(
        added_mass_kg=m_pet_kg - m_film_billed_kg + m_tendons_kg,
        setpoint_Pa=dp,
        blower_duty_W=0.0,
    )


def hull_closure(option: str) -> HullClosure:
    """
    @description The honest mass/pressure closure of the hybrid hull at its
        measured superheat (SPEC_materials section 4). The bare 500 Pa sphere
        is never again an option -- a design must adopt one of:

        - 'vented_ballonet' (RECOMMENDED): vent the superheat; helium cell
          held at the 200 Pa valve setpoint, a 199 L air ballonet absorbs the
          diurnal swing (no helium lost). +0.202 kg (ballonet 0.082 +
          valve/blower 0.120), blower ~5 W minutes/day. The 38 um film at
          200 Pa sits at 2.5 MPa hoop -- under the 5 MPa H7 allowable.
        - 'superpressure_pet': carry 12.35 kPa in a sized PET skin + tendon
          set; ~+1.0 kg. Heavy but possible.
        - 'ideal': no closure, no added mass -- EXPLICIT regression /
          what-if path only, never a default.
    @param option One of {'vented_ballonet', 'superpressure_pet', 'ideal'}.
    @returns HullClosure(added_mass_kg, setpoint_Pa, blower_duty_W).
    @raises MassClosureError On an unknown option.
    """
    if option == "vented_ballonet":
        closure = HullClosure(
            added_mass_kg=vented_ballonet_mass_kg(HYBRID_ENVELOPE_VOLUME_M3),
            setpoint_Pa=VENT_SETPOINT_PA,
            blower_duty_W=BLOWER_DUTY_W,
        )
        # The vented film must actually pass at its own setpoint -- verified
        # here so the recommended option can never drift into refusal.
        require_hull_film_ok(
            closure.setpoint_Pa, HYBRID_SEMI_MINOR_M, HYBRID_SEMI_MAJOR_M,
            HULL_FILM_THICKNESS_M,
            MATERIAL_CATALOGUE["lldpe_38um"].sigma_allow_Pa,
        )
        return closure
    if option == "superpressure_pet":
        return _superpressure_pet_closure()
    if option == "ideal":
        return HullClosure(0.0, 0.0, 0.0)
    raise MassClosureError(
        f"hull_closure: unknown option {option!r}; use 'vented_ballonet', "
        f"'superpressure_pet', or the explicit 'ideal'."
    )


if __name__ == "__main__":  # pragma: no cover -- acceptance self-test
    ok = True
    hoop, merid = hull_membrane_stress_Pa(
        HYBRID_PEAK_SUPERPRESSURE_PA, HYBRID_SEMI_MINOR_M,
        HYBRID_SEMI_MAJOR_M, HULL_FILM_THICKNESS_M)
    good = abs(hoop / 1e6 - 155.0) / 155.0 < 0.02 and abs(merid / 1e6 - 82.0) / 82.0 < 0.02
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] 12.35 kPa unlobed: hoop "
          f"{hoop / 1e6:.1f} MPa, merid {merid / 1e6:.1f} MPa (anchors 155/82)")
    try:
        require_hull_film_ok(HYBRID_PEAK_SUPERPRESSURE_PA, HYBRID_SEMI_MINOR_M,
                             HYBRID_SEMI_MAJOR_M, HULL_FILM_THICKNESS_M, 5.0e6)
        print("  [FAIL] 155 MPa skin was not refused")
        ok = False
    except ParamBoundsError:
        print("  [PASS] 155 MPa unlobed LLDPE skin REFUSED")
    passed = require_hull_film_ok(200.0, HYBRID_SEMI_MINOR_M,
                                  HYBRID_SEMI_MAJOR_M,
                                  HULL_FILM_THICKNESS_M, 5.0e6)
    good = abs(passed / 1e6 - 2.5) / 2.5 < 0.03
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] vented 200 Pa passes at "
          f"{passed / 1e6:.2f} MPa (anchor 2.5)")
    c = hull_closure("vented_ballonet")
    good = abs(c.added_mass_kg - 0.202) <= 0.0015
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] vented closure adds "
          f"{c.added_mass_kg:.4f} kg (anchor 0.202), setpoint "
          f"{c.setpoint_Pa:.0f} Pa, blower {c.blower_duty_W:.0f} W")
    cb = hull_closure("superpressure_pet")
    good = cb.added_mass_kg >= 1.0
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] PET superpressure closure "
          f"{cb.added_mass_kg:.3f} kg (>= 1.0 kg verdict)")
    raise SystemExit(0 if ok else 1)
