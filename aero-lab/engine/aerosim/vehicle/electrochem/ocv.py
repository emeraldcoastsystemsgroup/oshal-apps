"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Open-circuit-voltage layer of the real battery model (SPEC_chemistry section 1.2/1.3): cited cell specs for the two real chemistries, PCHIP-interpolated OCV(SOC) knot tables (monotone cubic per the spec -- a free spline overshoots the 0-10% knee), the Si-anode hysteresis band, and the IdealChemistryWarning that makes the ideal-bucket default LOUD.

WHY PCHIP AND NOT A FREE SPLINE
-------------------------------
The 0-10% SOC knee of a Li-ion OCV curve drops ~0.6 V in 5% SOC. A natural
cubic spline through those knots overshoots below the 2.55 V endpoint and
invents a non-monotone wiggle, which the ECM then reads as free voltage.
scipy's PchipInterpolator is shape-preserving: monotone data in, monotone
curve out. SPEC_chemistry section 1.2 mandates exactly this.
"""

from __future__ import annotations

import warnings
from typing import NamedTuple

import numpy as np
from scipy.interpolate import PchipInterpolator


class IdealChemistryWarning(UserWarning):
    """
    @description Emitted when a BatteryElement is constructed WITHOUT an
        explicit chemistry and therefore falls back to the ideal
        flat-efficiency energy bucket. The ideal model stays available for
        regression comparison, but defaulting into it must be loud, never
        silent (operator directive: no ideal-bucket stand-ins as silent
        defaults). Passing chemistry='ideal' EXPLICITLY does not warn -- that
        is a deliberate, visible declaration.
    """


#: The chemistry names the real models ship under. FROZEN contract values.
REAL_CHEMISTRIES: frozenset[str] = frozenset({"nca_21700", "amprius_si"})

#: Every legal chemistry value, real or explicitly ideal. FROZEN.
ALL_CHEMISTRIES: frozenset[str] = REAL_CHEMISTRIES | {"ideal"}


class CellSpec(NamedTuple):
    """
    @description Cited nameplate data for one reference cell.
    @param name Human-readable cell name.
    @param c_nom_Ah Nameplate capacity, Ah.
    @param m_cell_kg Cell mass, kg.
    @param nameplate_Wh Nameplate cell energy, Wh (c_nom_Ah x nominal V).
    @param v_cutoff_V Discharge cutoff voltage, V (datasheet end-of-discharge).
    @param v_max_V Charge termination voltage, V.
    @param hysteresis_V Flat OCV hysteresis half-band, V (charge branch =
        rest + hysteresis_V, discharge branch = rest - hysteresis_V).
    @param source Citation for every number in the row.
    """

    name: str
    c_nom_Ah: float
    m_cell_kg: float
    nameplate_Wh: float
    v_cutoff_V: float
    v_max_V: float
    hysteresis_V: float
    source: str


#: Reference cells for the two real chemistries. Every number cited; the one
#: assumption (Amprius capacity) is flagged in ELECTROCHEM_HONESTY (ecm.py
#: hosts the module ledger).
CELL_SPECS: dict[str, CellSpec] = {
    # LG INR21700 M50: 4.85 Ah, 68.6-69.8 g, NMC-811/graphite-SiOx, 3.63 V
    # nominal -> 17.6 Wh. Chen et al. 2020, J. Electrochem. Soc. 167 080534
    # (DOI 10.1149/1945-7111/ab9050) + LG M50 datasheet values via
    # batterydesign.net/lg-21700-m50 (cutoff 2.5 V, max 4.2 V).
    "nca_21700": CellSpec(
        name="LG INR21700 M50 (Ni-rich 21700 class)",
        c_nom_Ah=4.85,
        m_cell_kg=0.0698,
        nameplate_Wh=17.6,
        v_cutoff_V=2.50,
        v_max_V=4.20,
        hysteresis_V=0.0,
        source="Chen 2020 JES 167 080534; LG M50 datasheet via batterydesign.net",
    ),
    # Amprius SiCore 450 Wh/kg class (Amprius 2024 press release + Product
    # Catalog). Capacity 6.3 Ah is a catalog-CLASS assumption (HONESTY H-A3 in
    # ecm.ELECTROCHEM_HONESTY); mass is DERIVED from the published 450 Wh/kg:
    # 6.3 Ah x 3.42 V nominal = 21.5 Wh -> 21.5/450 = 0.0479 kg. Cutoff 2.75 V
    # chosen to match the catalog discharge-curve floor (= the SOC-0 knot).
    "amprius_si": CellSpec(
        name="Amprius SiCore 450 Wh/kg class (Si anode)",
        c_nom_Ah=6.3,
        m_cell_kg=0.0479,
        nameplate_Wh=21.5,
        v_cutoff_V=2.75,
        v_max_V=4.15,
        # +/-40 mV flat hysteresis band, literature-typical for Si anodes
        # (SPEC_chemistry 1.3, HONESTY H2 -- not Amprius-specific).
        hysteresis_V=0.040,
        source="Amprius SiCore 450 press release 2024 + Amprius Product Catalog",
    ),
}

# ---------------------------------------------------------------------------
# OCV knot tables (SPEC_chemistry 1.2 / 1.3). SOC dimensionless, OCV volts.
# ---------------------------------------------------------------------------

#: LG M50 pseudo-OCV knots, digitized +/-30 mV from Chen 2020 (GITT; same data
#: ships as PyBaMM's "Chen2020" set). HONESTY H1.
_OCV_KNOTS_NCA_21700: tuple[tuple[float, float], ...] = (
    (0.00, 2.55), (0.05, 3.17), (0.10, 3.31), (0.20, 3.45),
    (0.30, 3.55), (0.40, 3.61), (0.50, 3.66), (0.60, 3.74),
    (0.70, 3.84), (0.80, 3.94), (0.90, 4.06), (1.00, 4.20),
)

#: Amprius SiCore pseudo-OCV knots: catalog C/5-class discharge curve
#: digitized and IR-corrected, +/-50 mV, NOT a measured OCV. HONESTY H2.
_OCV_KNOTS_AMPRIUS_SI: tuple[tuple[float, float], ...] = (
    (0.00, 2.75), (0.05, 2.95), (0.10, 3.06), (0.20, 3.18),
    (0.30, 3.27), (0.40, 3.35), (0.50, 3.42), (0.60, 3.50),
    (0.70, 3.58), (0.80, 3.68), (0.90, 3.83), (1.00, 4.15),
)

_KNOTS: dict[str, tuple[tuple[float, float], ...]] = {
    "nca_21700": _OCV_KNOTS_NCA_21700,
    "amprius_si": _OCV_KNOTS_AMPRIUS_SI,
}

#: Lazily built monotone-cubic interpolants, one per chemistry.
_INTERPOLANTS: dict[str, PchipInterpolator] = {}


def require_real_chemistry(chemistry: str) -> str:
    """
    @description Validate a chemistry name for the REAL model paths. 'ideal'
        is legal at the element level but has no OCV curve -- asking this
        module for one is a caller bug, and it raises rather than inventing a
        flat curve.
    @param chemistry One of REAL_CHEMISTRIES.
    @returns The validated chemistry string.
    @raises ValueError On 'ideal' or any unknown name.
    """
    if chemistry not in REAL_CHEMISTRIES:
        raise ValueError(
            f"chemistry {chemistry!r} has no electrochemical model; real "
            f"chemistries are {sorted(REAL_CHEMISTRIES)} ('ideal' is the "
            f"explicit flat-efficiency bucket and owns no OCV curve)"
        )
    return chemistry


def _interpolant(chemistry: str) -> PchipInterpolator:
    """
    @description The cached PCHIP interpolant for one chemistry's knot table.
    @param chemistry A real chemistry name.
    @returns Monotone cubic interpolant OCV(SOC).
    """
    chem = require_real_chemistry(chemistry)
    interp = _INTERPOLANTS.get(chem)
    if interp is None:
        knots = np.asarray(_KNOTS[chem], dtype=float)
        interp = PchipInterpolator(knots[:, 0], knots[:, 1], extrapolate=False)
        _INTERPOLANTS[chem] = interp
    return interp


def ocv_V(chemistry: str, soc: float) -> float:
    """
    @description Rest (zero-current) open-circuit voltage at a state of
        charge. FROZEN contract signature. Monotone-cubic through the cited
        knot tables; SOC is clipped to [0, 1] (the ECM's own rails keep SOC in
        band -- the clip here only guards float round-off at the ends).
    @param chemistry One of REAL_CHEMISTRIES.
    @param soc State of charge, dimensionless 0..1.
    @returns Open-circuit voltage, V.
    @raises ValueError On an unknown or 'ideal' chemistry, or non-finite soc.
    """
    if not np.isfinite(soc):
        raise ValueError(f"soc must be finite, got {soc!r}")
    s = float(np.clip(soc, 0.0, 1.0))
    return float(_interpolant(chemistry)(s))


def ocv_branch_V(chemistry: str, soc: float, *, charging: bool) -> float:
    """
    @description Branch OCV including the flat hysteresis band: charge branch
        = rest + hysteresis, discharge branch = rest - hysteresis. Zero band
        for the M50 (graphite staging hysteresis is small at mission rates);
        +/-40 mV for the Si anode (SPEC 1.3, HONESTY H2).
    @param chemistry One of REAL_CHEMISTRIES.
    @param soc State of charge, dimensionless 0..1.
    @param charging True for the charge branch, False for discharge.
    @returns Branch open-circuit voltage, V.
    """
    spec = CELL_SPECS[require_real_chemistry(chemistry)]
    rest = ocv_V(chemistry, soc)
    return rest + spec.hysteresis_V if charging else rest - spec.hysteresis_V


def warn_defaulted_ideal(context: str) -> None:
    """
    @description Emit the loud IdealChemistryWarning for a construction that
        DEFAULTED into the ideal bucket instead of stating a chemistry.
    @param context Short description of who defaulted (element + capacity).
    @returns None.
    """
    warnings.warn(
        f"{context}: no chemistry stated -- falling back to the IDEAL "
        f"flat-efficiency energy bucket. Real builders should pass "
        f"chemistry='nca_21700' or 'amprius_si' (with n_series/n_parallel/"
        f"thermal); pass chemistry='ideal' explicitly to silence this in a "
        f"deliberate regression comparison.",
        IdealChemistryWarning,
        stacklevel=3,
    )
