"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Barrel for the real electrical
    chain (SPEC_electrical sections 1-3): C60 single-diode PV model, MPPT
    tracking + converter curve, and the AWG harness. The vehicle-facing
    element wrapper (PVArrayDiode) lives in aerosim/vehicle/pv_real.py; the
    propulsion side (BEMT, motor) is a SEPARATE module partition and imports
    nothing from here (harness resistance crosses that boundary as a float).
"""

from .harness import (
    ALPHA_CU_PER_K,
    AWG_RESISTANCE_20C_OHM_PER_M,
    HarnessSegment,
    INSULATION_MASS_FACTOR,
    RHO_CU_KG_M3,
    XT60_CONTACT_RESISTANCE_OHM,
    awg_conductor_area_m2,
    awg_resistance_ohm_per_m,
    harness_copper_mass_kg,
    segment_loss_W,
)
from .mppt import (
    GV5_NIGHT_DRAW_A,
    MAX_CONVERTER_ETA,
    MPPTConverter,
    gv5_converter,
)
from .pv_diode import (
    ALPHA_ISC_FRAC_PER_K,
    C60_BIN_TABLE,
    C60_CELL_AREA_M2,
    C60BinSpec,
    DiodeParams,
    G_REF_WM2,
    MppPoint,
    T_REF_K,
    c60_stc_efficiency,
    desoto_scaled_params,
    extract_c60_params,
    iv_current_A,
    string_mpp,
    validate_diode_params,
)

__all__ = [
    "ALPHA_CU_PER_K",
    "ALPHA_ISC_FRAC_PER_K",
    "AWG_RESISTANCE_20C_OHM_PER_M",
    "C60BinSpec",
    "C60_BIN_TABLE",
    "C60_CELL_AREA_M2",
    "DiodeParams",
    "GV5_NIGHT_DRAW_A",
    "G_REF_WM2",
    "HarnessSegment",
    "INSULATION_MASS_FACTOR",
    "MAX_CONVERTER_ETA",
    "MPPTConverter",
    "MppPoint",
    "RHO_CU_KG_M3",
    "T_REF_K",
    "XT60_CONTACT_RESISTANCE_OHM",
    "awg_conductor_area_m2",
    "awg_resistance_ohm_per_m",
    "c60_stc_efficiency",
    "desoto_scaled_params",
    "extract_c60_params",
    "gv5_converter",
    "harness_copper_mass_kg",
    "iv_current_A",
    "segment_loss_W",
    "string_mpp",
    "validate_diode_params",
]
