"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Package barrel for aerosim.mission: the
  |                                           | realistic end-to-end flight (profile,
  |                                           | runner, ledger report). Self-test:
  |                                           | python -m aerosim.mission.report
-------------------------------------------------------------------------------

aerosim.mission -- fly a validated design through REAL air on the REAL chain.

    MissionProfile   what to fly: site, season, altitude, wind, turbulence,
                     and the SPEC_materials section-3 gust placard.
    fly_mission      the flight: shear + Dryden + day/night + cold pack +
                     diode PV/MPPT/harness + BEMT propulsion + He/UV decay,
                     integrated through the frozen integrate_energy.
    MissionResult    the outcome, with the frozen per-debit Wh ledger.
    mission_report   the outcome, printable.
"""

from __future__ import annotations

from .profile import (
    DRYDEN_L_HIGH_ALT_M,
    F_TRACK_HZ_DEFAULT,
    GUST_PEAK_FACTOR,
    GUST_PLACARD_MS_DEFAULT,
    GustPlacardError,
    MissionProfile,
    build_wind_field,
    check_gust_placard,
    dryden_variance_fraction_above_Hz,
    eta_track_dynamic_penalty,
)
from .runner import (
    CHARGE_FLOOR_K,
    MissionConfigError,
    MissionResult,
    fly_mission,
)
from .report import LABEL_MPPT_NIGHT, LEDGER_KEYS, build_ledger, mission_report

__all__ = [
    "MissionProfile", "fly_mission", "MissionResult", "mission_report",
    "build_ledger", "build_wind_field", "check_gust_placard",
    "eta_track_dynamic_penalty", "dryden_variance_fraction_above_Hz",
    "GustPlacardError", "MissionConfigError",
    "LEDGER_KEYS", "LABEL_MPPT_NIGHT",
    "GUST_PLACARD_MS_DEFAULT", "GUST_PEAK_FACTOR", "F_TRACK_HZ_DEFAULT",
    "DRYDEN_L_HIGH_ALT_M", "CHARGE_FLOOR_K",
]
