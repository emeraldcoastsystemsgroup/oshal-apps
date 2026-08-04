"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module: the TECHNOLOGY CATALOGUE -- named, cited technology points that exist TOGETHER, and the joint-frontier checks that close round 4's boundary-rider (FATAL 2). Measured exploit: cell_efficiency 0.4999 at areal density 0.15 kg/m2 + a 499.9 Wh/kg pack + a 1-gram fuselage + extra_CD0 = 0.0 -- every parameter individually inside its scalar band, jointly a technology that has never existed -- built, closed and screened admissible at usable margin 1.585. Scalar bands cannot see joint impossibility; a catalogue of real hardware can.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): TOLERANCE COMPOUNDING closed. Measured corner (R6/R7): cell_efficiency 0.32999 at 0.1905 kg/m2 constructed -- the 5% density-class tolerance reached UP to the ELO point at 0.20 kg/m2 and the 10% efficiency tolerance then stacked ON TOP of it, minting a ~1730 W/kg specific-power cell no catalogue row contains (+4.1% usable on the frontier ship). Fix: PV_EFFICIENCY_TOL_FRAC now applies ONLY at or above the frontier point's OWN areal density; a design billing LIGHTER than the point it borrows (i.e. eligible only through the density-class tolerance) gets the frontier efficiency EXACTLY, no headroom -- tolerances no longer compound across the class edge. Also MAX_PV_PACKING_FACTOR = 0.92: packing_factor 0.999 was legal and rode the same corner; the best flown layouts (AtlantikSolar as-flown 0.802, Zephyr-class thin-film ~0.90) do not reach 0.92 -- cells cannot cover taper, spar caps and control-surface gaps. PVArray's declared bound now ends there. No band loosened; both changes strictly tighten.

WHY A CATALOGUE AND NOT MORE SCALAR BOUNDS
------------------------------------------
The round-3 scalar bands are each honest at their own edge: a 0.476-efficiency
cell EXISTS (NREL record multi-junction concentrator), a 0.15 kg/m2 blanket
EXISTS (bare CIGS thin film), and a ~445 Wh/kg pack is buildable from shipped
Amprius cells. What does NOT exist is the record concentrator cell AT thin-film
areal density: efficiency and mass per square metre are coupled through the
device physics (a multi-junction stack is a heavy III-V wafer or a concentrator
assembly; a 0.15 kg/m2 blanket is a thin-film chemistry whose champion modules
sit near 14 %). So the check is on the PAIR: a design's (efficiency, areal
density) must sit at or below the efficiency FRONTIER of catalogued hardware in
its areal-density class. Same for the pack: the Wh/kg a design claims must not
exceed the best catalogued cell times the best demonstrated packaging fraction.

THE FRONTIER RULE, PRECISELY
----------------------------
For PV: eligible technologies are the catalogue points whose areal density is at
most (1 + PV_DENSITY_CLASS_TOL_FRAC) x the design's billed areal density -- a
heavier lamination may always host a lighter class's cells, so the frontier is
the MAX efficiency over eligible points (monotone non-decreasing in density).
The claimed efficiency must be <= frontier x (1 + PV_EFFICIENCY_TOL_FRAC).
Below the lightest catalogued point the scalar band (mass.py, 0.15 kg/m2 floor)
has already refused the density itself.

For packs: frontier = best catalogued CELL x best demonstrated PACKAGING
fraction = 450 Wh/kg (Amprius SiMaxx) x 0.99 (AtlantikSolar bonded-in pack) =
445.5 Wh/kg. No extra tolerance: the frontier is ALREADY the most aggressive
combination of two real numbers, and case B sits exactly on it by construction.
The 500 Wh/kg scalar ceiling in mass.py is untouched (fail-closed backstop);
this check is strictly tighter, never looser.

UNITS: efficiencies dimensionless (STC fraction), areal density kg/m^2,
specific energy Wh/kg at PACK level.
"""

from __future__ import annotations

from dataclasses import dataclass

from .mass import (
    CELL_SI_ANODE_AMPRIUS_WH_PER_KG,
    MassClosureError,
    PACK_FRACTION_MINIMAL_PACKAGING,
)


class TechCatalogueError(MassClosureError):
    """
    @description Raised when a design's coupled technology parameters are each
        inside their scalar band but JOINTLY beyond anything in the catalogue of
        hardware that exists together -- the round-4 boundary-rider class.
        Subclasses MassClosureError (a ValueError) so every existing fail-closed
        handler catches it.
    """


@dataclass(frozen=True)
class CellTechnology:
    """
    @description One catalogued PV technology point: an efficiency and the areal
        density it has actually been built at, TOGETHER, with its citation.
    @param name Short technology name.
    @param cell_efficiency_stc Cell efficiency at STC, dimensionless.
    @param areal_density_kg_m2 Demonstrated array/laminate areal density, kg/m^2.
    @param source Citation for the pair.
    """

    name: str
    cell_efficiency_stc: float
    areal_density_kg_m2: float
    source: str


#: The PV technology catalogue: (efficiency, areal density) pairs that exist
#: TOGETHER. Every point cited. The frontier check interpolates NOTHING -- it
#: takes the max efficiency over technologies no heavier than the design bills.
PV_CELL_CATALOGUE: tuple[CellTechnology, ...] = (
    CellTechnology(
        name="flexible CIGS thin-film blanket",
        cell_efficiency_stc=0.14,
        areal_density_kg_m2=0.15,
        source="MiaSole/Ascent-class flexible CIGS: champion flexible modules "
               "13-17 % aperture, blanket-level ~0.15 kg/m2 (matches mass.py's "
               "MIN_CREDIBLE_PV_AREAL_DENSITY_KG_M2 floor); 0.14 is the "
               "shipping-product band, not a lab cell",
    ),
    CellTechnology(
        name="ELO triple-junction thin-film sheet (MicroLink class)",
        cell_efficiency_stc=0.30,
        areal_density_kg_m2=0.20,
        source="MicroLink Devices epitaxial-liftoff IMM triple-junction solar "
               "sheets flown on HALE UAVs: ~30-32 % AM0, blanket-level "
               "~0.2 kg/m2 (>1500 W/kg specific power)",
    ),
    CellTechnology(
        name="SunPower C60-class back-contact silicon, wing laminate",
        cell_efficiency_stc=0.227,
        areal_density_kg_m2=0.45,
        source="SunPower C60 datasheet top bin 22.7 %; laminated flexible "
               "array 0.45 kg/m2 (150 um wafer 0.35 + encapsulant 0.05 + "
               "adhesive/harness margin; see mass.py derivation)",
    ),
    CellTechnology(
        name="record laboratory silicon, laminated",
        cell_efficiency_stc=0.27,
        areal_density_kg_m2=0.55,
        source="LONGi/Kaneka-class silicon heterojunction lab records "
               "26.8-27.3 % (NREL best-research-cell chart, single-junction "
               "Si); on a standard wafer + lamination ~0.55 kg/m2",
    ),
    CellTechnology(
        name="complete module with MPPT (AtlantikSolar as-flown)",
        cell_efficiency_stc=0.237,
        areal_density_kg_m2=0.72,
        source="Oettershagen et al. 2018: 88 SunPower E60 cells at 23.7 %, "
               "1.00 kg solar system over 1.38 m2 of cells = 0.72 kg/m2",
    ),
)

#: Density-class tolerance, dimensionless FRACTION: a design may claim a
#: catalogued technology up to 5 % denser than it bills, covering lamination
#: variation between builds of the SAME technology -- not a class jump (the
#: thin-film point at 0.15 kg/m2 stays 25 % away from the ELO point at 0.20).
PV_DENSITY_CLASS_TOL_FRAC: float = 0.05

#: Efficiency headroom above the catalogue frontier, dimensionless FRACTION.
#: 10 % relative covers bin-to-bin and lab-to-record spread WITHIN a
#: technology (C60 bins span 21.8-22.7 %; CIGS champions reach ~15.4 % vs the
#: 14 % product band). It does NOT reach across chemistries: 0.14 x 1.10 =
#: 0.154 is still nowhere near the 0.4999 concentrator claim. ROUND 5: it
#: also does not reach across the DENSITY-CLASS edge -- it applies only when
#: the design bills at or above the frontier point's own areal density (see
#: check_pv_technology_pair), because a bin-spread claim about a technology
#: only makes sense at the density that technology is actually built at.
PV_EFFICIENCY_TOL_FRAC: float = 0.10

#: Ceiling on the PV cell-coverage (packing) fraction, dimensionless. The best
#: FLOWN layouts do not reach it: AtlantikSolar AS-2 flew 88 E60 cells over
#: 1.38 of 1.72 m2 = 0.802 (Oettershagen et al. 2018); Zephyr-class
#: full-chord thin-film wings reach ~0.90. Wing taper, spar caps, control
#: surfaces, hinge lines and harness runs are not collectable area, so a
#: claimed 0.999 (round-5 measured corner rider) is a panel that has never
#: been laid out. 0.92 = best flown + build tolerance. Enforced as
#: PVArray.PARAM_BOUNDS["packing_factor"].hi.
MAX_PV_PACKING_FACTOR: float = 0.92


@dataclass(frozen=True)
class PackTechnology:
    """
    @description One catalogued battery PACK point with its citation.
    @param name Short technology name.
    @param pack_Wh_per_kg PACK-level specific energy, Wh/kg.
    @param source Citation.
    """

    name: str
    pack_Wh_per_kg: float
    source: str


#: The pack catalogue -- named, cited PACK-level points (diagnostic listing;
#: the enforced frontier is PACK_FRONTIER_WH_PER_KG below).
PACK_CATALOGUE: tuple[PackTechnology, ...] = (
    PackTechnology(
        name="NCA 18650/21700 lithium-ion pack",
        pack_Wh_per_kg=182.0,
        source="Panasonic NCR18650B-class 243 Wh/kg cells x 0.75 typical "
               "aerospace pack fraction (mass.py PACK_LI_ION_WH_PER_KG)",
    ),
    PackTechnology(
        name="AtlantikSolar AS-2 bonded-in pack, as flown",
        pack_Wh_per_kg=241.0,
        source="Oettershagen et al. 2018: 703 Wh in a 2.92 kg pack",
    ),
    PackTechnology(
        name="Amprius SiMaxx silicon-anode, minimal packaging",
        pack_Wh_per_kg=CELL_SI_ANODE_AMPRIUS_WH_PER_KG
        * PACK_FRACTION_MINIMAL_PACKAGING,
        source="Amprius published 450 Wh/kg SiCore/SiMaxx cell (shipped to "
               "HAPS programmes) x the 0.99 bonded-into-airframe packaging "
               "fraction AtlantikSolar demonstrated",
    ),
)

#: The enforced pack frontier, Wh/kg at PACK level: best catalogued cell x best
#: demonstrated packaging. DERIVED, not hand-typed, so it cannot drift from the
#: cell constants it is built on. = 450 x 0.99 = 445.5 Wh/kg. No further
#: tolerance -- this is already the most aggressive combination of two real
#: numbers, and case B sits exactly ON it by construction.
PACK_FRONTIER_WH_PER_KG: float = max(p.pack_Wh_per_kg for p in PACK_CATALOGUE)

#: Relative float slack on the frontier comparisons, dimensionless. Covers
#: arithmetic round-off only (a design computing 450*0.99 its own way), never
#: a real headroom.
FRONTIER_REL_EPS: float = 1.0e-9


def _pv_frontier_point(areal_density_kg_m2: float) -> CellTechnology:
    """
    @description The catalogue point that sets the efficiency frontier for a
        billed areal density: the max-efficiency technology no heavier than
        (1 + PV_DENSITY_CLASS_TOL_FRAC) x the billed density. Returning the
        POINT (not just the number) is what lets check_pv_technology_pair ask
        whether the design actually bills at that technology's own density --
        the round-5 no-compounding rule needs the point's density, not only
        its efficiency.
    @param areal_density_kg_m2 The design's billed array areal density, kg/m^2.
    @returns The CellTechnology setting the frontier.
    @raises TechCatalogueError When NO catalogued technology fits the class --
        only possible below the lightest point, which the mass.py scalar floor
        already refuses; kept fail-closed here anyway.
    """
    d = float(areal_density_kg_m2)
    eligible = [
        p for p in PV_CELL_CATALOGUE
        if p.areal_density_kg_m2 <= d * (1.0 + PV_DENSITY_CLASS_TOL_FRAC)
    ]
    if not eligible:
        raise TechCatalogueError(
            f"no catalogued PV technology exists at {d:g} kg/m2 or lighter -- "
            f"the lightest point is "
            f"{min(p.areal_density_kg_m2 for p in PV_CELL_CATALOGUE):g} kg/m2 "
            f"({PV_CELL_CATALOGUE[0].name})"
        )
    return max(eligible, key=lambda p: p.cell_efficiency_stc)


def pv_frontier_efficiency(areal_density_kg_m2: float) -> tuple[float, str]:
    """
    @description The best catalogued cell efficiency available in a design's
        areal-density class (see _pv_frontier_point). Monotone non-decreasing
        in density -- a heavier laminate can always host a lighter class's
        cells, never the reverse.
    @param areal_density_kg_m2 The design's billed array areal density, kg/m^2.
    @returns (frontier efficiency, name of the technology that sets it).
    @raises TechCatalogueError When NO catalogued technology fits the class.
    """
    best = _pv_frontier_point(areal_density_kg_m2)
    return best.cell_efficiency_stc, best.name


def check_pv_technology_pair(
    cell_efficiency_stc: float, areal_density_kg_m2: float
) -> None:
    """
    @description THE joint check that closes FATAL 2's PV half: the claimed
        (efficiency, areal density) pair must sit within the tolerance envelope
        of the catalogue frontier for its density class. Called from
        PVArray.validate_cross_params (construction AND live-instance recheck)
        and from screen_design.
    @param cell_efficiency_stc Claimed cell efficiency at STC, dimensionless.
    @param areal_density_kg_m2 Billed array areal density, kg/m^2.
    @returns None. Raises on a joint point beyond the frontier.
    @raises TechCatalogueError When the pair is uncatalogued: e.g. the measured
        round-4 exploit, a 0.4999 concentrator-record efficiency claimed at
        0.15 kg/m2 thin-film density (frontier there: 0.14 CIGS).
    """
    eff = float(cell_efficiency_stc)
    d = float(areal_density_kg_m2)
    best = _pv_frontier_point(d)
    # ROUND 5, no cross-class compounding: the 10% bin-spread tolerance is a
    # claim about builds OF the frontier technology, so it applies only when
    # the design bills at (or above) that technology's own areal density. A
    # design billing LIGHTER -- eligible only through the 5% density-class
    # tolerance -- gets the frontier efficiency exactly. Measured corner this
    # closes: 0.32999 claimed at 0.1905 kg/m2 = the 0.30 @ 0.20 ELO point
    # stretched by BOTH tolerances at once, a ~1730 W/kg cell that does not
    # exist (+4.1% usable on the R6 frontier ship).
    same_class = d >= best.areal_density_kg_m2 * (1.0 - FRONTIER_REL_EPS)
    tol_frac = PV_EFFICIENCY_TOL_FRAC if same_class else 0.0
    ceiling = best.cell_efficiency_stc * (1.0 + tol_frac)
    if eff > ceiling * (1.0 + FRONTIER_REL_EPS):
        raise TechCatalogueError(
            f"technology catalogue: cell_efficiency_stc = {eff:g} at "
            f"{d:g} kg/m2 is beyond the catalogue frontier for its "
            f"areal-density class: best catalogued technology at or below "
            f"this density is '{best.name}' at {best.cell_efficiency_stc:g} "
            f"(x{1.0 + tol_frac:g} tolerance = {ceiling:.4g}"
            + (
                ""
                if same_class
                else f"; the {PV_EFFICIENCY_TOL_FRAC:.0%} bin-spread headroom "
                     f"does not apply because the design bills {d:g} kg/m2, "
                     f"lighter than the {best.areal_density_kg_m2:g} kg/m2 "
                     f"that technology is built at -- tolerances do not "
                     f"compound across the density-class edge"
            )
            + "). High efficiency and low areal density are COUPLED through "
            f"device physics; parameters must exist together, not merely "
            f"each be inside its own band."
        )


def check_pack_technology(specific_energy_Wh_per_kg: float) -> None:
    """
    @description THE joint check that closes FATAL 2's pack half: a PACK-level
        Wh/kg claim may not exceed the best catalogued cell x the best
        demonstrated packaging fraction (445.5 Wh/kg). Strictly tighter than
        mass.py's 500 Wh/kg scalar backstop, which is deliberately untouched.
        Called from BatteryElement.validate_cross_params (construction AND
        live-instance recheck) and from screen_design.
    @param specific_energy_Wh_per_kg Claimed PACK specific energy, Wh/kg.
    @returns None. Raises beyond the frontier.
    @raises TechCatalogueError When the claim exceeds the pack frontier: e.g.
        the measured round-4 exploit's 499.9 Wh/kg, a pack better than the best
        shipped cell in the best demonstrated packaging.
    """
    value = float(specific_energy_Wh_per_kg)
    if value > PACK_FRONTIER_WH_PER_KG * (1.0 + FRONTIER_REL_EPS):
        best = max(PACK_CATALOGUE, key=lambda p: p.pack_Wh_per_kg)
        raise TechCatalogueError(
            f"technology catalogue: pack specific energy {value:g} Wh/kg "
            f"exceeds the catalogue frontier {PACK_FRONTIER_WH_PER_KG:g} Wh/kg "
            f"('{best.name}': {best.source}). The 500 Wh/kg scalar ceiling is "
            f"a unit-error backstop, not a technology; no pack beyond "
            f"{PACK_FRONTIER_WH_PER_KG:g} Wh/kg exists to be bought."
        )
