"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the materials module (vehicle/materials.py + vehicle/spar.py + the structure.py floor hook): frozen catalogue keys and cited rows, the exact elliptic M_root = nWb/(3pi) anchors (Tier-1 12.40 / AS-2 122.22 N*m), gauge-governed spar sizing, the bottom-up build-up as a FAIL-CLOSED floor only (0.420 / 1.457 kg, ratios 0.57/0.64 vs the authoritative Stender regression REPORTED never absorbed), FAR-23 discrete gust n_gust 3.51 / 3.13 at U_de 7.62 m/s (n = 3 is NOT enough), and the fail-closed bounds on every knob.

Every number here is a SPEC_materials pasted anchor (SPEC_materials_calc.py,
run 2026-08-02) -- +-2% on masses/moments, +-1% on gust factors.
"""

from __future__ import annotations

import math

import pytest

from aerosim.vehicle.mass import MassClosureError
from aerosim.vehicle.materials import (
    MATERIAL_CATALOGUE,
    MIN_COVERING_AREAL_DENSITY_KG_M2,
    ULTIMATE_SAFETY_FACTOR,
    get_material,
)
from aerosim.vehicle.param_bounds import ParamBoundsError
from aerosim.vehicle.spar import (
    ASSEMBLY_OVERHEAD_BAND,
    ASSEMBLY_OVERHEAD_FRACTION,
    GUST_U_DE_VC_MS,
    GUST_U_DE_VD_MS,
    bottom_up_wing_mass_floor_kg,
    gust_load_factor,
    root_bending_moment_Nm,
    size_spar,
    spar_radius_for_section_m,
)
from aerosim.vehicle.state import G0_MS2
from aerosim.vehicle.structure import check_wing_mass_floor, wing_mass_kg

#: The two SPEC_materials anchor planforms.
TIER1 = dict(b=2.5, s=0.52, aum=1.589, v=7.62, rho=1.167)
AS2 = dict(b=5.65, s=1.72, aum=6.93, v=8.81, rho=1.167)

FROZEN_KEYS = {
    "cf_pultruded_ud", "cf_wrapped", "balsa", "xps", "oracover", "oralight",
    "icarex_pc31", "mylar_12um", "mylar_25um", "lldpe_38um", "dyneema_sk75",
    "kevlar_49",
}


def _cla(b: float, s: float) -> float:
    """Lift-curve slope a = 2*pi*AR/(AR+2), 1/rad."""
    ar = b * b / s
    return 2.0 * math.pi * ar / (ar + 2.0)


# --------------------------------------------------------------------------- #
# 1. Catalogue: frozen keys, cited rows, fail-closed lookup                    #
# --------------------------------------------------------------------------- #


def test_catalogue_keys_frozen_and_rows_cited() -> None:
    assert set(MATERIAL_CATALOGUE) == FROZEN_KEYS
    for key, m in MATERIAL_CATALOGUE.items():
        assert m.name == key
        assert m.source.strip(), f"{key} has no source"
        assert 0.0 < m.sigma_allow_Pa <= m.sigma_ult_Pa
        if m.areal_density_kg_m2 is not None:
            assert m.areal_density_kg_m2 >= MIN_COVERING_AREAL_DENSITY_KG_M2


def test_uncatalogued_material_refused() -> None:
    with pytest.raises(MassClosureError):
        get_material("unobtainium")


def test_cf_allowable_is_ultimate_over_sf_once() -> None:
    """The SF 1.5 is applied ONCE, visibly -- no silent 1.5 x 1.5 stack."""
    cf = get_material("cf_pultruded_ud")
    assert cf.sigma_allow_Pa == pytest.approx(800.0e6 / ULTIMATE_SAFETY_FACTOR)
    assert ULTIMATE_SAFETY_FACTOR == 1.5


def test_rope_rows_carry_the_h8_knockdowns() -> None:
    """Rope design strength = fibre x 0.85 braid x 0.5 termination."""
    dy = get_material("dyneema_sk75")
    assert dy.sigma_allow_Pa == pytest.approx(dy.sigma_ult_Pa * 0.85 * 0.5)
    kv = get_material("kevlar_49")
    assert kv.sigma_allow_Pa == pytest.approx(3.0e9 * 0.85 * 0.5)


# --------------------------------------------------------------------------- #
# 2. Root bending moment: the EXACT elliptic nWb/(3pi)                         #
# --------------------------------------------------------------------------- #


def test_root_bending_moment_anchors() -> None:
    m1 = root_bending_moment_Nm(3.0, TIER1["aum"] * G0_MS2, TIER1["b"])
    m2 = root_bending_moment_Nm(3.0, AS2["aum"] * G0_MS2, AS2["b"])
    assert m1 == pytest.approx(12.40, rel=0.02)
    assert m2 == pytest.approx(122.22, rel=0.02)


def test_root_bending_moment_is_3pi_not_2pi() -> None:
    """The nWb/(2pi) shorthand silently stacks 1.5x on the explicit SF; the
    module must use the exact elliptic 3pi form."""
    w_N, b_m = 100.0, 4.0
    assert root_bending_moment_Nm(1.0, w_N, b_m) == pytest.approx(
        w_N * b_m / (3.0 * math.pi))


# --------------------------------------------------------------------------- #
# 3. Spar sizing: gauge-governed at both anchors, +-2% masses                  #
# --------------------------------------------------------------------------- #


def test_spar_tier1_gauge_governed() -> None:
    r_m = spar_radius_for_section_m(TIER1["s"] / TIER1["b"])
    assert r_m == pytest.approx(0.0119, rel=0.02)          # 11.9 mm pasted
    siz = size_spar(3.0, TIER1["aum"], TIER1["b"], r_m)
    assert siz.governing == "gauge"
    assert siz.t_req_root_m == pytest.approx(0.053e-3, rel=0.02)
    # 149 g gauge tube + 15% shear web (H5)
    assert siz.mass_kg == pytest.approx(0.149 * 1.15, rel=0.02)


def test_spar_as2_gauge_governed() -> None:
    r_m = spar_radius_for_section_m(AS2["s"] / AS2["b"])
    assert r_m == pytest.approx(0.0174, rel=0.02)          # 17.4 mm pasted
    siz = size_spar(3.0, AS2["aum"], AS2["b"], r_m)
    assert siz.governing == "gauge"
    assert siz.t_req_root_m == pytest.approx(0.242e-3, rel=0.02)
    assert siz.mass_kg == pytest.approx(0.493 * 1.15, rel=0.02)


def test_spar_stress_governs_when_gauge_cannot() -> None:
    """Enough load on a small radius must flip governing to 'stress' and
    bill MORE than the gauge tube -- the floor works in both directions."""
    siz = size_spar(3.0, 500.0, 10.0, 0.012)
    assert siz.governing == "stress"
    gauge_only = size_spar(3.0, 0.5, 10.0, 0.012)
    assert siz.mass_kg > gauge_only.mass_kg


def test_spar_rejects_non_bending_stock_and_junk() -> None:
    with pytest.raises(MassClosureError):
        size_spar(3.0, 1.589, 2.5, 0.012, material="oracover")
    with pytest.raises(MassClosureError):
        size_spar(3.0, 1.589, 2.5, 0.012, material="nonsense")
    with pytest.raises(ParamBoundsError):
        size_spar(3.0, 1.589, 2.5, 0.012, sf=0.5)          # flies past ultimate
    with pytest.raises(ParamBoundsError):
        size_spar(3.0, -1.0, 2.5, 0.012)                   # negative aircraft


# --------------------------------------------------------------------------- #
# 4. Bottom-up build-up: a FLOOR, never a discount                             #
# --------------------------------------------------------------------------- #


def test_bottom_up_anchors_and_reported_ratio() -> None:
    floor1 = bottom_up_wing_mass_floor_kg(TIER1["b"], TIER1["s"], TIER1["aum"], 3.0)
    floor2 = bottom_up_wing_mass_floor_kg(AS2["b"], AS2["s"], AS2["aum"], 3.0)
    assert floor1 == pytest.approx(0.420, rel=0.02)
    assert floor2 == pytest.approx(1.457, rel=0.02)
    # The measured disagreement is REPORTED, not absorbed: the build-up sits
    # at 0.57x / 0.64x of the authoritative regression, strictly BELOW it.
    reg1 = wing_mass_kg(TIER1["b"], TIER1["s"], 3.0)
    reg2 = wing_mass_kg(AS2["b"], AS2["s"], 3.0)
    assert floor1 / reg1 == pytest.approx(0.57, abs=0.03)
    assert floor2 / reg2 == pytest.approx(0.64, abs=0.03)
    assert floor1 < reg1 and floor2 < reg2


def test_overhead_stays_in_its_honest_band() -> None:
    lo, hi = ASSEMBLY_OVERHEAD_BAND
    assert lo <= ASSEMBLY_OVERHEAD_FRACTION <= hi
    assert ASSEMBLY_OVERHEAD_FRACTION == pytest.approx(0.18)


def test_check_wing_mass_floor_refuses_and_passes() -> None:
    # The regression's own masses clear their build-up floor at both anchors.
    assert check_wing_mass_floor(
        wing_mass_kg(TIER1["b"], TIER1["s"], 3.0),
        TIER1["b"], TIER1["s"], TIER1["aum"], 3.0) > 0.0
    assert check_wing_mass_floor(
        wing_mass_kg(AS2["b"], AS2["s"], 3.0),
        AS2["b"], AS2["s"], AS2["aum"], 3.0) > 0.0
    # A wing lighter than its own bill of materials is REFUSED.
    with pytest.raises(MassClosureError):
        check_wing_mass_floor(0.30, TIER1["b"], TIER1["s"], TIER1["aum"], 3.0)
    with pytest.raises(MassClosureError):
        check_wing_mass_floor(1.0, AS2["b"], AS2["s"], AS2["aum"], 3.0)


# --------------------------------------------------------------------------- #
# 5. FAR-23 discrete gust: n = 3 is NOT enough                                 #
# --------------------------------------------------------------------------- #


def test_gust_anchors_vd() -> None:
    n1 = gust_load_factor(TIER1["aum"] * G0_MS2 / TIER1["s"], TIER1["v"],
                          TIER1["rho"], TIER1["s"] / TIER1["b"],
                          _cla(TIER1["b"], TIER1["s"]), GUST_U_DE_VD_MS)
    n2 = gust_load_factor(AS2["aum"] * G0_MS2 / AS2["s"], AS2["v"],
                          AS2["rho"], AS2["s"] / AS2["b"],
                          _cla(AS2["b"], AS2["s"]), GUST_U_DE_VD_MS)
    assert n1 == pytest.approx(3.51, rel=0.01)
    assert n2 == pytest.approx(3.13, rel=0.01)
    # The finding itself, pinned: even the MILDER 7.62 m/s gust exceeds the
    # n = 3 default at both anchors.
    assert n1 > 3.0 and n2 > 3.0


def test_gust_anchors_vc() -> None:
    n1 = gust_load_factor(TIER1["aum"] * G0_MS2 / TIER1["s"], TIER1["v"],
                          TIER1["rho"], TIER1["s"] / TIER1["b"],
                          _cla(TIER1["b"], TIER1["s"]), GUST_U_DE_VC_MS)
    n2 = gust_load_factor(AS2["aum"] * G0_MS2 / AS2["s"], AS2["v"],
                          AS2["rho"], AS2["s"] / AS2["b"],
                          _cla(AS2["b"], AS2["s"]), GUST_U_DE_VC_MS)
    assert n1 == pytest.approx(6.02, rel=0.01)
    assert n2 == pytest.approx(5.26, rel=0.01)


def test_gust_low_wing_loading_is_the_driver() -> None:
    """dn ~ 1/(W/S): halving the wing loading must increase n_gust."""
    args = (TIER1["v"], TIER1["rho"], TIER1["s"] / TIER1["b"],
            _cla(TIER1["b"], TIER1["s"]))
    assert gust_load_factor(15.0, *args) > gust_load_factor(30.0, *args)


def test_gust_bounds_fail_closed() -> None:
    good = (TIER1["v"], TIER1["rho"], TIER1["s"] / TIER1["b"],
            _cla(TIER1["b"], TIER1["s"]))
    with pytest.raises(ParamBoundsError):
        gust_load_factor(-30.0, *good)
    with pytest.raises(ParamBoundsError):
        gust_load_factor(30.0, TIER1["v"], TIER1["rho"],
                         TIER1["s"] / TIER1["b"], 10.0)  # a > 2*pi
    with pytest.raises(ParamBoundsError):
        gust_load_factor(30.0, *good[:3], good[3], u_de_ms=50.0)
