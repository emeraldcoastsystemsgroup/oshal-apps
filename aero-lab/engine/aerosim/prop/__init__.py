"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Barrel for the real-propulsion
    package (SPEC_electrical sections 4-5): BEMT propeller solver anchored to
    UIUC measured data, Drela Kv/R/I0 motor model + cited catalogue, ESC loss
    model, and the UIUC anchor data/manifest module. The BEMTThruster ELEMENT
    lives in aerosim/vehicle/bemt_thruster.py (it is a force element, and
    element modules live with the vehicle).
2 | maintainer@emeraldcoastsystemsgroup.com   | Export the measured BEMT
    swirl and 25/51/101-station convergence contract for certification tests.
"""

from .bemt import (
    ALPHA_REF_OFFSET_DEG,
    HONESTY_LEDGER,
    INVALID_THRUST_FRAC_TOL,
    PROP_CATALOGUE,
    PropGeometry,
    PropPoint,
    SECTION_CATALOGUE,
    SWIRL_ABS_TOL_MS,
    SWIRL_REL_TOL,
    TIP_MACH_LIMIT,
    polar_cache_info,
    solve_prop_point,
)
from .certification import (
    BEMT_STABILITY_STATIONS,
    BEMT_STABILITY_TOLERANCES,
    station_stability_report,
)
from .motor import (
    ESC_RATED_ETA_BAND,
    MOTOR_CATALOGUE,
    VENDOR_ANCHORS,
    EscParams,
    MotorOp,
    MotorParams,
    esc_input_power_W,
    esc_rated_efficiency,
    motor_forward,
    motor_inverse,
    motor_peak_eta,
    validate_motor,
)
from .uiuc_anchor import (
    ANCHOR_CASES,
    ANCHOR_CP_TOL,
    ANCHOR_CT_TOL,
    ANCHOR_ETA_PEAK_DJ,
    ANCHOR_ETA_PEAK_TOL,
    ANCHOR_J_BAND,
    ANCHOR_STATIC_TOL,
    UIUC_MANIFEST_SHA256,
    anchor_report,
    measured_momentum_floor_ok,
    verify_local_data,
)

__all__ = [
    "ALPHA_REF_OFFSET_DEG",
    "BEMT_STABILITY_STATIONS",
    "BEMT_STABILITY_TOLERANCES",
    "ANCHOR_CASES",
    "ANCHOR_CP_TOL",
    "ANCHOR_CT_TOL",
    "ANCHOR_ETA_PEAK_DJ",
    "ANCHOR_ETA_PEAK_TOL",
    "ANCHOR_J_BAND",
    "ANCHOR_STATIC_TOL",
    "ESC_RATED_ETA_BAND",
    "EscParams",
    "HONESTY_LEDGER",
    "INVALID_THRUST_FRAC_TOL",
    "MOTOR_CATALOGUE",
    "MotorOp",
    "MotorParams",
    "PROP_CATALOGUE",
    "PropGeometry",
    "PropPoint",
    "SECTION_CATALOGUE",
    "SWIRL_ABS_TOL_MS",
    "SWIRL_REL_TOL",
    "TIP_MACH_LIMIT",
    "UIUC_MANIFEST_SHA256",
    "VENDOR_ANCHORS",
    "anchor_report",
    "esc_input_power_W",
    "esc_rated_efficiency",
    "measured_momentum_floor_ok",
    "motor_forward",
    "motor_inverse",
    "motor_peak_eta",
    "polar_cache_info",
    "solve_prop_point",
    "station_stability_report",
    "validate_motor",
    "verify_local_data",
]
