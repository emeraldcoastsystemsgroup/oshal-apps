"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module (SPEC_materials section 1): the cited material property catalogue. Twelve frozen entries (CF tubes with the H1 thin-wall compression-buckling knockdown, balsa, XPS, covering films, LLDPE envelope film, Dyneema/Kevlar line) each carrying density, modulus, ultimate and long-duration-allowable strength, areal density where the material is used by the square metre, and its source string. Import-time bounds walk refuses a drifted row; get_material() refuses an uncatalogued name. HONESTY ledger carries every value without a hard citation (H1, H2, H7, H8, H11, M1).

WHAT THIS CATALOGUE IS
----------------------
DESIGN values for the metre-scale-UAV / small-envelope size class this project
builds -- not coupon best-cases. The CF sigma_ult rows are the SPEC_materials
section 1.1 ENGINEERING KNOCKDOWN (thin-wall tubes in bending fail on the
compression side by local wall buckling well below coupon flexural strength);
the direction is fail-closed -- it can only over-bill spar mass. The rope rows
store the ROPE-LEVEL design strength (fibre x 0.85 braid solid fraction x 0.5
termination/creep knockdown, H8) in sigma_allow_Pa, so a tendon sized from the
catalogue already carries rigging practice, not fibre-coupon fantasy.
"""

from __future__ import annotations

from typing import NamedTuple

from .mass import MassClosureError


class MaterialSpec(NamedTuple):
    """
    @description One frozen catalogue row: the design properties of a
        structural or covering material, with its source. Rows are consumed by
        spar.py (tube sizing), hull.py (membrane checks, tendons) and the
        bottom-up wing build-up.
    @param name Catalogue key, also stored in the row for self-describing logs.
    @param rho_kgm3 Density, kg/m^3.
    @param E_Pa Tensile modulus in the governing direction, Pa.
    @param sigma_ult_Pa Design ultimate strength, Pa (governing direction and
        any engineering knockdown stated in `source`).
    @param sigma_allow_Pa Long-duration / design allowable, Pa. For CF tubes
        this is sigma_ult / 1.5 (14 CFR 23.303 ultimate factor); for creeping
        films it is the SPEC_materials H7/H11 sustained-stress choice; for
        ropes it is the fibre strength x braid x termination knockdown (H8).
    @param areal_density_kg_m2 Applied areal density, kg/m^2, for materials
        used by the square metre (films, coverings); None for bulk stock.
    @param source Citation or HONESTY-ledger reference. Never empty.
    """

    name: str
    rho_kgm3: float
    E_Pa: float
    sigma_ult_Pa: float
    sigma_allow_Pa: float
    areal_density_kg_m2: float | None
    source: str


#: 14 CFR 23.303 / classic FAR-23 ultimate factor of safety, dimensionless.
#: Applied ONCE, visibly (SPEC_materials section 2.2) -- the catalogue stores
#: sigma_allow = sigma_ult / SF for the tube stock so the margin is never
#: silently stacked.
ULTIMATE_SAFETY_FACTOR: float = 1.5

#: Braid solid fraction for fibre rope, dimensionless (checked in mass.py
#: against real 2 mm SK75 line at 2.4 g/m; mildly conservative for aramid).
ROPE_BRAID_SOLID_FRACTION: float = 0.85

#: Termination/creep/bend-over-sheave knockdown on rope strength,
#: dimensionless. HONESTY H8: marine/rigging practice quotes 40-60 % retained
#: strength at a spliced termination; 0.5 is the middle of that band.
ROPE_TERMINATION_KNOCKDOWN: float = 0.5

#: Thinnest commodity pultruded/wrapped CF tube wall, m. HONESTY H2: a
#: catalogue-availability floor (vendor listings bottom out at 0.5 mm), not
#: physics; revisit if a thinner real tube is sourced.
CF_TUBE_MIN_WALL_M: float = 0.5e-3

#: Floor on any covering areal density, kg/m^2 (SPEC_materials section 1.4):
#: 12 um PET at 0.017 kg/m^2 is the thinnest anyone covers a flying panel
#: with; below 0.015 is a sweep buying skinless wings.
MIN_COVERING_AREAL_DENSITY_KG_M2: float = 0.015


#: The frozen catalogue. KEYS ARE FROZEN by the build contract -- renaming one
#: breaks every consumer. Values are cited in each row's `source`.
MATERIAL_CATALOGUE: dict[str, MaterialSpec] = {
    "cf_pultruded_ud": MaterialSpec(
        "cf_pultruded_ud", 1600.0, 135.0e9, 800.0e6,
        800.0e6 / ULTIMATE_SAFETY_FACTOR, None,
        "Exel Composites pultruded profiles / Rock West Composites tube "
        "datasheets (rho 1580-1620, E 130-140 GPa, coupon flexural "
        "1000-1500 MPa); sigma_ult 800 MPa is the H1 ENGINEERING KNOCKDOWN "
        "for thin-wall compression-side local buckling (fail-closed: "
        "over-bills spar mass)."),
    "cf_wrapped": MaterialSpec(
        "cf_wrapped", 1550.0, 90.0e9, 550.0e6,
        550.0e6 / ULTIMATE_SAFETY_FACTOR, None,
        "Rock West Composites roll-wrapped 0/90+-45 tube datasheets (rho "
        "1500-1580, E 60-100 GPa, coupon 600-900 MPa); H1 knockdown to "
        "550 MPa design."),
    "balsa": MaterialSpec(
        "balsa", 160.0, 3.4e9, 20.0e6,
        20.0e6 / ULTIMATE_SAFETY_FACTOR, None,
        "Forest Products Laboratory, Wood Handbook FPL-GTR-190, balsa at "
        "rho 0.16 g/cm^3, 12% MC (modulus of rupture ~20 MPa). ONE-ROW RULE: "
        "rho, E and MOR all from this row -- balsa scales ~linearly with "
        "density and mixed-density cherry-picking is refused."),
    "xps": MaterialSpec(
        "xps", 32.0, 15.0e6, 275.0e3,
        275.0e3 / ULTIMATE_SAFETY_FACTOR, None,
        "ASTM C578 Type VI (275 kPa compressive); Owens Corning FOAMULAR / "
        "DuPont Styrofoam datasheets (rho 28-45, E 10-20 MPa). Cores and "
        "ribs ONLY -- never a primary bending member."),
    "oracover": MaterialSpec(
        "oracover", 1390.0, 3.8e9, 200.0e6, 50.0e6, 0.060,
        "Lanitz-Prena ORACOVER datasheet: ~59.5 g/m^2 applied (band "
        "0.059-0.062). rho/E/sigma are PET-family class values (DuPont-"
        "Teijin Mylar datasheet family) -- HONESTY M1; the load-bearing "
        "number for coverings is the areal density."),
    "oralight": MaterialSpec(
        "oralight", 1390.0, 3.8e9, 200.0e6, 50.0e6, 0.034,
        "Lanitz-Prena ORALIGHT datasheet (0.031-0.036 kg/m^2 applied); "
        "rho/E/sigma PET-family class values, HONESTY M1."),
    "icarex_pc31": MaterialSpec(
        "icarex_pc31", 1390.0, 3.8e9, 200.0e6, 50.0e6, 0.031,
        "Icarex product spec: PC31 ripstop polyester, 31 g/m^2; rho/E/sigma "
        "polyester-family class values, HONESTY M1."),
    "mylar_12um": MaterialSpec(
        "mylar_12um", 1390.0, 3.8e9, 200.0e6, 50.0e6, 0.017,
        "DuPont-Teijin Mylar datasheet: rho 1390 kg/m^3, E ~3.8 GPa, break "
        "~200 MPa; 12 um x 1390 = 0.017 kg/m^2. sigma_allow 50 MPa is the "
        "H11 creep-motivated 1/4-of-break ENGINEERING CHOICE (fail-closed)."),
    "mylar_25um": MaterialSpec(
        "mylar_25um", 1390.0, 3.8e9, 200.0e6, 50.0e6, 0.035,
        "Same DuPont-Teijin Mylar datasheet row, 25 um x 1390 = "
        "0.035 kg/m^2; H11 allowable."),
    "lldpe_38um": MaterialSpec(
        "lldpe_38um", 920.0, 300.0e6, 30.0e6, 5.0e6, 0.035,
        "NASA SPB StratoFilm-420-class 38 um LLDPE at ~920 kg/m^3 = "
        "0.035 kg/m^2 (already the buoyancy.py film constant); generic LLDPE "
        "blown-film band E 200-400 MPa, break 20-45 MPa (SPEC_materials "
        "1.5). sigma_allow 5 MPa is the H7 long-duration ENGINEERING CHOICE "
        "(~1/2 yield floor; LLDPE creeps -- Rand & Sterling SF420 "
        "constitutive literature motivates, no single quotable number)."),
    "dyneema_sk75": MaterialSpec(
        "dyneema_sk75", 975.0, 109.0e9, 3.6e9,
        3.6e9 * ROPE_BRAID_SOLID_FRACTION * ROPE_TERMINATION_KNOCKDOWN, None,
        "DSM Dyneema fact sheet: rho 975 kg/m^3, E 109 GPa, fibre sigma_ult "
        "3.3-3.9 GPa (3.6 mid-band). sigma_allow = fibre x 0.85 braid x 0.5 "
        "termination knockdown (H8) = rope-level design strength."),
    "kevlar_49": MaterialSpec(
        "kevlar_49", 1440.0, 112.0e9, 3.0e9,
        3.0e9 * ROPE_BRAID_SOLID_FRACTION * ROPE_TERMINATION_KNOCKDOWN, None,
        "DuPont Kevlar Aramid Fiber Technical Guide: rho 1440 kg/m^3, E "
        "112 GPa, fibre sigma_ult 3.0 GPa; same H8 rope knockdowns. "
        "Cross-check (SPEC_materials 1.6): 2 mm braid -> 3.85 g/m vs vendor "
        "2.8-3.5 g/m -- braid fraction mildly conservative, over-bills."),
}


#: HONESTY LEDGER -- catalogue values without a hard citation, flagged per the
#: campaign rule (never silently defaulted). Keys reference SPEC_materials
#: section 6 items where they exist.
HONESTY_LEDGER: dict[str, str] = {
    "H1": "CF sigma_ult design 800/550 MPa: engineering knockdown from vendor "
          "coupon band for thin-wall compression buckling; fail-closed "
          "(over-bills spar).",
    "H2": "CF_TUBE_MIN_WALL_M = 0.5 mm: catalogue-availability floor, not "
          "physics.",
    "H7": "LLDPE long-duration sigma_allow 5 MPa: ~1/2 yield floor, "
          "creep-motivated engineering choice; fail-closed.",
    "H8": "Rope termination/creep knockdown 0.5: rigging practice 40-60 % "
          "spliced retention.",
    "H11": "PET sigma_allow 50 MPa: 1/4 of datasheet break, creep-motivated "
           "engineering choice; fail-closed.",
    "M1": "Covering-film rho/E/sigma entries (oracover, oralight, "
          "icarex_pc31) are PET/polyester-family class values from the Mylar "
          "datasheet family, not per-product datasheets; only their areal "
          "densities are design-load-bearing (those ARE cited).",
}


def get_material(name: str) -> MaterialSpec:
    """
    @description Fetch a catalogue row by its frozen key. FAIL-CLOSED: an
        uncatalogued material name raises instead of defaulting -- a spar or
        tendon sized on a typo must refuse, not silently use CF.
    @param name One of the frozen MATERIAL_CATALOGUE keys.
    @returns The MaterialSpec row.
    @raises MassClosureError When the name is not in the catalogue.
    """
    try:
        return MATERIAL_CATALOGUE[name]
    except KeyError:
        raise MassClosureError(
            f"material {name!r} is not in MATERIAL_CATALOGUE (keys: "
            f"{sorted(MATERIAL_CATALOGUE)}). Add a CITED row; do not "
            f"improvise properties."
        ) from None


def _walk_catalogue_bounds() -> None:
    """
    @description Import-time bounds walk over every catalogue row (the
        param_bounds discipline applied to a frozen table: the check runs when
        the values are DECLARED, since rows have no constructor). Generic
        credibility bands plus the SPEC_materials section 1.1 CF-specific
        bands. A drifted row refuses to import.
    @returns None. Raises MassClosureError on the first violation.
    """
    for key, m in MATERIAL_CATALOGUE.items():
        ok = (
            m.name == key
            and 10.0 <= m.rho_kgm3 <= 20000.0
            and 1.0e6 <= m.E_Pa <= 600.0e9      # 600 GPa = mass.py fibre ceiling
            and 1.0e3 <= m.sigma_ult_Pa <= 10.0e9
            and 0.0 < m.sigma_allow_Pa <= m.sigma_ult_Pa
            and bool(m.source.strip())
        )
        if m.areal_density_kg_m2 is not None:
            ok = ok and (
                MIN_COVERING_AREAL_DENSITY_KG_M2
                <= m.areal_density_kg_m2 <= 10.0
            )
        if not ok:
            raise MassClosureError(
                f"MATERIAL_CATALOGUE[{key!r}] fails its credibility bounds: "
                f"{m}. A catalogue row drifted; fix the row, not the walk."
            )
    for key in ("cf_pultruded_ud", "cf_wrapped"):
        m = MATERIAL_CATALOGUE[key]
        if not (1400.0 <= m.rho_kgm3 <= 1800.0
                and 50.0e9 <= m.E_Pa <= 300.0e9
                and 200.0e6 <= m.sigma_ult_Pa <= 1500.0e6):
            raise MassClosureError(
                f"CF row {key!r} outside the SPEC_materials 1.1 bands: {m}"
            )


_walk_catalogue_bounds()


if __name__ == "__main__":  # pragma: no cover -- acceptance self-test
    print("materials.py self-test")
    frozen = {"cf_pultruded_ud", "cf_wrapped", "balsa", "xps", "oracover",
              "oralight", "icarex_pc31", "mylar_12um", "mylar_25um",
              "lldpe_38um", "dyneema_sk75", "kevlar_49"}
    ok = set(MATERIAL_CATALOGUE) == frozen
    print(f"  [{'PASS' if ok else 'FAIL'}] frozen keys exact: "
          f"{sorted(MATERIAL_CATALOGUE)}")
    try:
        get_material("unobtainium")
        print("  [FAIL] uncatalogued name did not raise")
        ok = False
    except MassClosureError:
        print("  [PASS] uncatalogued name refused")
    cf = get_material("cf_pultruded_ud")
    print(f"  [{'PASS' if abs(cf.sigma_allow_Pa - 800e6 / 1.5) < 1 else 'FAIL'}]"
          f" CF allow = sigma_ult/1.5 = {cf.sigma_allow_Pa / 1e6:.1f} MPa")
    raise SystemExit(0 if ok else 1)
