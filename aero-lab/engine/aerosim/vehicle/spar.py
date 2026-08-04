"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module (SPEC_materials sections 2, 3, 5): exact elliptic root bending moment M = nWb/(3pi) (the /(2pi) shorthand is REJECTED -- it silently stacks 1.5x on top of the explicit SF), fully-stressed-vs-gauge CF tube spar sizing with the visible SF = 1.5 (14 CFR 23.303) and the H2 0.5 mm gauge floor, the bottom-up wing build-up retained ONLY as a fail-closed FLOOR (measured 0.57x / 0.64x of the Stender regression at Tier-1 / AS-2 scale -- the disagreement is REPORTED, the regression stays authoritative), and the FAR-23 discrete gust load factor (14 CFR 23.341 pre-Amdt 23-64 form, U_de per 23.333(c)).

WHY THE BOTTOM-UP IS A FLOOR, NOT AN ESTIMATE (SPEC_materials 2.4, measured)
----------------------------------------------------------------------------
Strength does not size these wings: at both anchor scales the required root
wall is 0.05-0.24 mm against the 0.5 mm gauge floor, so the buildable spar is
gauge-governed and a strength-only build-up is a structural LOWER BOUND. Real
wings of this class are sized by stiffness, gust loads above n = 3, and
non-optimum mass (Shanley, Weight-Strength Analysis of Aircraft Structures,
1952). The measured AS-2 airframe beats any paper build-up. Therefore:
bottom_up_wing_mass_floor_kg REFUSES a lighter wing (via
structure.check_wing_mass_floor) and never discounts the regression.
"""

from __future__ import annotations

import math
from typing import NamedTuple

from .mass import MassClosureError
from .materials import CF_TUBE_MIN_WALL_M, MATERIAL_CATALOGUE, get_material
from .param_bounds import require_in_range
from .state import G0_MS2

# ---------------------------------------------------------------------------
# Constants (each cited or HONESTY-ledgered; ledger at module bottom)
# ---------------------------------------------------------------------------

#: Ultimate factor of safety, dimensionless. 14 CFR 23.303 / classic FAR-23
#: practice. Applied ONCE, here, visibly (SPEC_materials 2.2): sigma_allow =
#: sigma_ult,design / SF. The elliptic M_root is EXACT, so the margin is this
#: factor and nothing hidden.
SPAR_SAFETY_FACTOR: float = 1.5

#: Spar radius fit within the section, dimensionless: r <= 0.95 * (t/c)*c / 2
#: at the max-thickness station (SPEC_materials 2.2 geometric ceiling).
SPAR_RADIUS_SECTION_FIT: float = 0.95

#: Default section thickness-to-chord, dimensionless (aero module's family).
SECTION_TC_DEFAULT: float = 0.12

#: Shear-web allowance as a fraction of spar mass, dimensionless. HONESTY H5:
#: engineering allowance, fail-closed (only adds mass).
SHEAR_WEB_MASS_FRACTION: float = 0.15

#: Rib pitch, m / rib thickness, m / D-box LE sheeting thickness, m / D-box
#: chord fraction. HONESTY H3: model-building convention, no formal source.
RIB_PITCH_M: float = 0.12
RIB_THICKNESS_M: float = 3.0e-3
DBOX_SHEET_THICKNESS_M: float = 1.5e-3
DBOX_CHORD_FRACTION: float = 0.30

#: Cambered-section area coefficient, dimensionless: A_section ~ K * c^2 *
#: (t/c). HONESTY H4: geometric fit, checkable against the aero module.
AIRFOIL_SECTION_AREA_COEFF: float = 0.68

#: Wetted area per unit planform for a closed covered wing, dimensionless.
WETTED_AREA_PER_PLANFORM: float = 2.05

#: Trailing-edge / misc stock, kg per m^2 of planform. HONESTY H3 class.
TE_STOCK_KG_PER_M2: float = 0.02

#: Assembly overhead (joints, glue, fasteners) fraction, dimensionless, band
#: [0.10, 0.35] (SPEC_materials section 5). HONESTY H6: Shanley non-optimum
#: concept + builder practice; deliberately NOT inflated to force agreement
#: with the regression -- the disagreement is reported instead.
ASSEMBLY_OVERHEAD_FRACTION: float = 0.18
ASSEMBLY_OVERHEAD_BAND: tuple[float, float] = (0.10, 0.35)

#: FAR-23 derived gust velocities, m/s: 25 fps (Vd gust) and 50 fps (Vc gust)
#: below 20 000 ft, per 14 CFR 23.333(c).
GUST_U_DE_VD_MS: float = 7.62
GUST_U_DE_VC_MS: float = 15.24


class SparSizing(NamedTuple):
    """
    @description Result of sizing one constant-radius CF tube spar.
    @param mass_kg Spar mass, kg, both halves, INCLUDING the 0.15 shear-web
        allowance (H5).
    @param t_req_root_m Stress-required wall at the root, m (before the gauge
        floor).
    @param governing Which constraint sized the tube: 'gauge' (t_req < t_min,
        the min-wall tube is heavier) or 'stress'.
    """

    mass_kg: float
    t_req_root_m: float
    governing: str


def root_bending_moment_Nm(n_limit: float, weight_N: float, span_m: float) -> float:
    """
    @description Root bending moment of one half-wing under ELLIPTIC loading,
        N*m: M_root = n*W*b/(3*pi) (SPEC_materials 2.1, exact derivation --
        half-span lift n*W/2 at the elliptic centroid 2b/(3*pi)). The common
        nWb/(2*pi) shorthand is exactly 1.5x this and is NOT used: this module
        applies its safety factor explicitly in size_spar instead of burying
        one in the load. Root relief from wing-borne mass is neglected --
        conservative, direction stated.
    @param n_limit Limit load factor, dimensionless.
    @param weight_N All-up weight n is applied to, N.
    @param span_m Full tip-to-tip span b, m.
    @returns M_root, N*m.
    @raises ParamBoundsError On out-of-range inputs.
    """
    n = require_in_range("n_limit", n_limit, 0.5, 10.0, unit="-",
                         element="spar", why="below 0.5 is not a flight load; "
                         "above 10 is beyond aerobatic practice")
    w = require_in_range("weight_N", weight_N, 0.0, 1.0e7, lo_open=True,
                         unit="N", element="spar",
                         why="a wing carrying nothing has no root moment")
    b = require_in_range("span_m", span_m, 0.0, 80.0, lo_open=True, unit="m",
                         element="spar",
                         why="Helios HP03 (75.3 m) is the largest flown")
    return n * w * b / (3.0 * math.pi)


def size_spar(
    n_limit: float,
    aum_kg: float,
    span_m: float,
    r_spar_m: float,
    material: str = "cf_pultruded_ud",
    sf: float = SPAR_SAFETY_FACTOR,
    t_min_m: float = CF_TUBE_MIN_WALL_M,
) -> SparSizing:
    """
    @description Size a constant-radius thin-wall CF tube spar for elliptic
        loading (SPEC_materials 2.2-2.3). Thin-wall tube: sigma = M/(pi r^2 t)
        so t_req(root) = M_root/(pi r^2 sigma_allow) with sigma_allow =
        sigma_ult,design/sf. Mass is the LARGER of the fully-stressed tapered
        integral m_FS = rho*n*W*b^2/(16 r sigma_allow) (both halves, exact for
        elliptic loading) and the min-gauge constant tube 2*pi*r*t_min*rho*b,
        plus the 0.15 shear-web allowance (H5).
    @param n_limit Limit load factor, dimensionless.
    @param aum_kg All-up mass the load factor applies to, kg.
    @param span_m Full span b, m.
    @param r_spar_m Spar tube outer radius, m (caller has already fitted it to
        the section; see spar_radius_for_section_m).
    @param material MATERIAL_CATALOGUE key for the tube stock.
    @param sf Ultimate factor of safety, dimensionless (14 CFR 23.303 = 1.5).
    @param t_min_m Minimum manufacturable wall, m (H2 catalogue floor 0.5 mm;
        explicit-override floor 0.3 mm per SPEC_materials 1.1 bounds).
    @returns SparSizing(mass_kg, t_req_root_m, governing).
    @raises ParamBoundsError / MassClosureError On out-of-range inputs or an
        uncatalogued material.
    """
    m_aum = require_in_range("aum_kg", aum_kg, 0.0, 1.0e5, lo_open=True,
                             unit="kg", element="spar",
                             why="a massless aircraft needs no spar")
    r = require_in_range("r_spar_m", r_spar_m, 1.0e-3, 0.5, unit="m",
                         element="spar",
                         why="below 1 mm radius no tube exists; above 0.5 m "
                             "is outside this size class")
    sf_v = require_in_range("sf", sf, 1.0, 3.0, unit="-", element="spar",
                            why="SF < 1 flies past ultimate; > 3 is not this "
                                "design practice (FAR-23 uses 1.5)")
    t_min = require_in_range("t_min_m", t_min_m, 0.3e-3, 5.0e-3, unit="m",
                             element="spar",
                             why="0.3 mm is the explicit-override floor of "
                                 "SPEC_materials 1.1; 5 mm is no longer "
                                 "thin-wall")
    mat = get_material(material)
    if mat.name not in ("cf_pultruded_ud", "cf_wrapped", "balsa"):
        raise MassClosureError(
            f"size_spar: {material!r} is not a bending-member stock (films, "
            f"foams and ropes cannot be a wing spar)."
        )
    weight_N = m_aum * G0_MS2
    m_root_Nm = root_bending_moment_Nm(n_limit, weight_N, span_m)
    b = float(span_m)
    sigma_allow_Pa = mat.sigma_ult_Pa / sf_v
    t_req_root_m = m_root_Nm / (math.pi * r * r * sigma_allow_Pa)
    # Fully-stressed tapered-wall spar, both halves (closed form, elliptic):
    # integral of M(y) over the half span is n*W*b^2/64.
    m_fs_kg = mat.rho_kgm3 * float(n_limit) * weight_N * b * b / (
        16.0 * r * sigma_allow_Pa
    )
    m_gauge_kg = 2.0 * math.pi * r * t_min * mat.rho_kgm3 * b
    governing = "gauge" if t_req_root_m < t_min else "stress"
    m_spar_kg = max(m_fs_kg, m_gauge_kg)
    return SparSizing(
        mass_kg=m_spar_kg * (1.0 + SHEAR_WEB_MASS_FRACTION),
        t_req_root_m=t_req_root_m,
        governing=governing,
    )


def spar_radius_for_section_m(
    chord_m: float, tc: float = SECTION_TC_DEFAULT
) -> float:
    """
    @description Largest spar tube radius that fits the wing section at its
        max-thickness station, m: r = 0.95 * (t/c) * c / 2 (SPEC_materials 2.2
        geometric ceiling).
    @param chord_m Local chord, m.
    @param tc Section thickness-to-chord ratio, dimensionless.
    @returns Spar radius, m.
    @raises ParamBoundsError On out-of-range inputs.
    """
    c = require_in_range("chord_m", chord_m, 0.0, 10.0, lo_open=True,
                         unit="m", element="spar",
                         why="a zero chord has no section to put a spar in")
    tc_v = require_in_range("tc", tc, 0.04, 0.30, unit="-", element="spar",
                            why="sections below 4% or above 30% t/c are "
                                "outside this project's aero family")
    return SPAR_RADIUS_SECTION_FIT * 0.5 * tc_v * c


def bottom_up_wing_mass_floor_kg(
    span_m: float,
    area_m2: float,
    aum_kg: float,
    n_limit: float = 3.0,
) -> float:
    """
    @description The strength + gauge bottom-up build-up of a built-up wing,
        kg -- retained ONLY as a fail-closed FLOOR on wing mass
        (SPEC_materials 2.4 verdict: measured 0.57x / 0.64x of the Stender
        regression at Tier-1 / AS-2 scale, consistently LOW because stiffness
        and non-optimum mass are unmodelled; the REGRESSION stays
        authoritative and this number must never discount it).

        Build-up: gauge/stress-governed CF spar (size_spar, incl. shear web)
        + 3 mm balsa ribs at 0.12 m pitch + 1.5 mm balsa D-box sheeting over
        30% chord both surfaces + Oracover film over 2.05*S wetted + TE stock
        + 18% assembly overhead (H6, band 15-25%).
    @param span_m Full span b, m.
    @param area_m2 Planform area S, m^2.
    @param aum_kg All-up mass, kg.
    @param n_limit Design limit load factor, dimensionless (default 3.0, the
        project's DESIGN_LOAD_FACTOR_DEFAULT -- walls unchanged).
    @returns Floor mass, kg.
    @raises ParamBoundsError On out-of-range inputs.
    """
    b = require_in_range("span_m", span_m, 0.0, 80.0, lo_open=True, unit="m",
                         element="spar", why="Helios ceiling")
    s = require_in_range("area_m2", area_m2, 0.0, 200.0, lo_open=True,
                         unit="m2", element="spar", why="Helios ceiling")
    chord_m = s / b
    r_m = spar_radius_for_section_m(chord_m)
    spar = size_spar(n_limit, aum_kg, b, r_m)
    m_spar_incl_web_kg = spar.mass_kg          # includes the 0.15 web (H5)
    balsa = MATERIAL_CATALOGUE["balsa"]
    film = MATERIAL_CATALOGUE["oracover"]
    n_ribs = int(b / RIB_PITCH_M) + 1
    rib_area_m2 = AIRFOIL_SECTION_AREA_COEFF * chord_m * chord_m * SECTION_TC_DEFAULT
    m_ribs_kg = n_ribs * rib_area_m2 * RIB_THICKNESS_M * balsa.rho_kgm3
    m_dbox_kg = (2.0 * DBOX_CHORD_FRACTION * s
                 * DBOX_SHEET_THICKNESS_M * balsa.rho_kgm3)
    m_film_kg = WETTED_AREA_PER_PLANFORM * s * float(film.areal_density_kg_m2)
    m_te_kg = TE_STOCK_KG_PER_M2 * s
    subtotal_kg = m_spar_incl_web_kg + m_ribs_kg + m_dbox_kg + m_film_kg + m_te_kg
    return subtotal_kg * (1.0 + ASSEMBLY_OVERHEAD_FRACTION)


def gust_load_factor(
    ws_Nm2: float,
    v_ms: float,
    rho_kgm3: float,
    c_mac_m: float,
    cla_per_rad: float,
    u_de_ms: float = GUST_U_DE_VD_MS,
) -> float:
    """
    @description FAR-23 discrete gust load factor, dimensionless (14 CFR
        23.341 pre-Amdt 23-64 form, SPEC_materials section 3):

            n = 1 + Kg * rho * U_de * V * a / (2 W/S)
            Kg = 0.88 mu / (5.3 + mu),  mu = 2 (W/S) / (rho c a g)

        Evaluated at local rho and TAS (the EAS/rho0 distinction is < 3% at
        500 m -- HONESTY H12, stated approximation). Low wing loading drives
        dn ~ 1/(W/S): the project's Tier-1 / AS-2 designs see n_gust 3.51 /
        3.13 at the MILDER 7.62 m/s gust, so n = 3 is NOT enough -- the
        mission layer must either design to n = 4 or carry the placard
        (SPEC_materials 3 disposition; DESIGN_LOAD_FACTOR_DEFAULT itself is
        unchanged -- walls never move as a side effect).
    @param ws_Nm2 Wing loading W/S, N/m^2.
    @param v_ms True airspeed V, m/s.
    @param rho_kgm3 Local air density, kg/m^3.
    @param c_mac_m Mean aerodynamic chord, m.
    @param cla_per_rad Lift-curve slope a, 1/rad (e.g. 2*pi*AR/(AR+2)).
    @param u_de_ms Derived gust velocity, m/s: 7.62 (Vd gust) or 15.24 (Vc
        gust), 14 CFR 23.333(c).
    @returns n_gust, dimensionless (>= 1).
    @raises ParamBoundsError On out-of-range inputs.
    """
    ws = require_in_range("ws_Nm2", ws_Nm2, 1.0, 5000.0, unit="N/m2",
                          element="gust",
                          why="below 1 N/m2 nothing flies; above 5 kN/m2 is "
                              "not this aircraft class")
    v = require_in_range("v_ms", v_ms, 0.0, 200.0, lo_open=True, unit="m/s",
                         element="gust", why="a parked aircraft feels no "
                         "aerodynamic gust load")
    rho = require_in_range("rho_kgm3", rho_kgm3, 1.0e-3, 1.5, unit="kg/m3",
                           element="gust", why="ISA sea level is 1.225")
    c = require_in_range("c_mac_m", c_mac_m, 0.0, 10.0, lo_open=True,
                         unit="m", element="gust", why="zero chord")
    a = require_in_range("cla_per_rad", cla_per_rad, 0.1, 2.0 * math.pi,
                         unit="1/rad", element="gust",
                         why="2*pi is the thin-airfoil ceiling")
    u = require_in_range("u_de_ms", u_de_ms, 0.0, 20.0, lo_open=True,
                         unit="m/s", element="gust",
                         why="FAR-23 derived gusts top out at 15.24 m/s "
                             "(50 fps) in this altitude band")
    mu = 2.0 * ws / (rho * c * a * G0_MS2)
    kg = 0.88 * mu / (5.3 + mu)
    dn = kg * rho * u * v * a / (2.0 * ws)
    return 1.0 + dn


#: HONESTY LEDGER (module-level) -- SPEC_materials section 6 items this module
#: owns. Every constant above cites its source or names one of these.
HONESTY_LEDGER: dict[str, str] = {
    "H2": "t_min 0.5 mm tube wall: catalogue availability, not physics.",
    "H3": "rib pitch 0.12 m / 3 mm ribs / 1.5 mm 30%-chord D-box / TE stock "
          "0.02 kg/m2: model-building convention, no formal source.",
    "H4": "section area coefficient 0.68*c^2*(t/c): geometric fit.",
    "H5": "shear-web allowance 0.15 * m_spar: engineering allowance, "
          "fail-closed.",
    "H6": "assembly overhead 18% (band 10-35): Shanley non-optimum concept + "
          "builder practice; NOT tuned to close the regression gap.",
    "H12": "gust evaluated at local rho / TAS, not EAS/rho0: < 3% at 500 m.",
}


if __name__ == "__main__":  # pragma: no cover -- acceptance self-test
    G = G0_MS2
    ok = True

    def _chk(name: str, got: float, want: float, tol: float) -> None:
        global ok
        rel = abs(got - want) / abs(want)
        good = rel <= tol
        ok = ok and good
        print(f"  [{'PASS' if good else 'FAIL'}] {name}: got {got:.4g} "
              f"vs {want:.4g} ({100 * rel:.2f}% off, tol {100 * tol:.0f}%)")

    print("spar.py self-test -- SPEC_materials pasted anchors, +-2%")
    _chk("Tier-1 M_root", root_bending_moment_Nm(3.0, 1.589 * G, 2.5),
         12.40, 0.02)
    _chk("AS-2 M_root", root_bending_moment_Nm(3.0, 6.93 * G, 5.65),
         122.22, 0.02)
    _chk("Tier-1 bottom-up floor",
         bottom_up_wing_mass_floor_kg(2.5, 0.52, 1.589, 3.0), 0.420, 0.02)
    _chk("AS-2 bottom-up floor",
         bottom_up_wing_mass_floor_kg(5.65, 1.72, 6.93, 3.0), 1.457, 0.02)
    ar1, ar2 = 2.5 ** 2 / 0.52, 5.65 ** 2 / 1.72
    a1 = 2.0 * math.pi * ar1 / (ar1 + 2.0)
    a2 = 2.0 * math.pi * ar2 / (ar2 + 2.0)
    _chk("Tier-1 n_gust @7.62",
         gust_load_factor(1.589 * G / 0.52, 7.62, 1.167, 0.52 / 2.5, a1),
         3.51, 0.01)
    _chk("AS-2 n_gust @7.62",
         gust_load_factor(6.93 * G / 1.72, 8.81, 1.167, 1.72 / 5.65, a2),
         3.13, 0.01)
    s1 = size_spar(3.0, 1.589, 2.5, spar_radius_for_section_m(0.52 / 2.5))
    print(f"  [{'PASS' if s1.governing == 'gauge' else 'FAIL'}] Tier-1 spar "
          f"gauge-governed (t_req {s1.t_req_root_m * 1e3:.3f} mm)")
    ok = ok and s1.governing == "gauge"
    raise SystemExit(0 if ok else 1)
