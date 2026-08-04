"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Calendar + cycle aging (SPEC_chemistry section 4, Schmalstieg et al. 2014 J. Power Sources 257:325-334 closed form) with the Amprius Si-anode overlay (calendar x2.0, sqrt-FEC cycle fade to 80% at 250 FEC -- both HONESTY H14), the temperature extension of the cycle prefactor clamped to unity inside the 25-35 C parameterization window (H13), the charge-only-equivalent throughput convention (H12/A4 -- the spec's charge+discharge convention lands the M50 sanity case at ~600 FEC, outside Schmalstieg's own 800-2000 FEC field band; arithmetic in the beta docstring), and project_days_to_fade -- the "fly until the parts break" day-integrator returning the frozen AgingProjection.

VALIDITY LIMITS, STATED HONESTLY (SPEC 4.2)
-------------------------------------------
Parameterized on ONE NMC 18650 chemistry, T 25-50 C, V 3.5-4.15, dDOD
10-100%. Cold aging is NOT covered: exp(-6976/T) says cold storage ages
slower -- true for SEI growth, FALSE once cold charging plates lithium; the
ecm.py plating wall is the guard, and below 0 C this model is invalid for
charging, full stop.
"""

from __future__ import annotations

import math
from typing import NamedTuple, Sequence

import numpy as np

from .ocv import CELL_SPECS, require_real_chemistry

#: Schmalstieg 2014 reference-cell capacity, Ah (Sanyo UR18650E). Throughput
#: is normalized to this cell before entering the sqrt term.
SCHMALSTIEG_REF_AH: float = 2.05

#: Calendar Arrhenius exponent, K (Schmalstieg 2014 as published).
_CAL_EA_OVER_R_K: float = 6976.0

#: Resistance-growth Arrhenius exponent, K (Schmalstieg 2014 as published).
_RES_EA_OVER_R_K: float = 5986.0

#: Cycle-prefactor temperature window, K: Schmalstieg cycled near 25-35 C;
#: inside this window the published beta applies unmodified, outside it the
#: calendar activation energy is borrowed (SPEC 4.1, HONESTY H13).
_BETA_T_WINDOW_K: tuple[float, float] = (298.15, 308.15)

#: Amprius Si-anode calendar penalty multiplier (HONESTY H14: assumption --
#: Si SEI is less stable; no public Amprius calendar data).
_AMPRIUS_CALENDAR_MULT: float = 2.0

#: Amprius cycle-fade prefactor per sqrt(FEC): dC = 0.01265*sqrt(FEC), i.e.
#: 80% retention at 250 FEC -- back-derived from the Amprius catalog
#: cycle-life class for the 450 Wh/kg cell (HONESTY H14, band 150-400 FEC
#: carried in the pytest wall).
AMPRIUS_CYCLE_PREFACTOR: float = 0.01265

#: HONESTY ledger for this module.
AGING_HONESTY: dict[str, str] = {
    "H12/A4": "throughput convention = CHARGE-ONLY EQUIVALENT (total Ah / 2). "
              "The spec's charge+discharge reading gives sqrt(Q)-fade 0.20 at "
              "Q_norm = 2459 Ah = 600 FEC for the M50 sanity case -- outside "
              "Schmalstieg's own 800-2000 FEC field band; the /2 convention "
              "lands at ~1200 FEC, matching the spec's '~1200 emergent'",
    "H13": "cycle beta outside 25-35 C borrows the calendar activation "
           "energy, clamped to 1.0 inside the parameterization window",
    "H14": "Amprius calendar x2.0 and the 250-FEC sqrt cycle class are "
           "catalog-class assumptions, not measured Amprius data",
    "A9": "fade_frac_per_day reported as the MEAN rate to 80% "
          "(0.20 / days_to_80pct); the instantaneous t^0.75 rate diverges "
          "at t = 0 and would be meaningless as a single number",
}


class AgingProjection(NamedTuple):
    """
    @description The answer to "fly until the parts break". FROZEN contract.
    @param days_to_80pct Days until capacity retention reaches 80%, d
        (math.inf when not reached inside the 100-year horizon).
    @param days_to_70pct Days until retention reaches 70%, d.
    @param fade_frac_per_day Mean fade rate to the 80% point, 1/day.
    """

    days_to_80pct: float
    days_to_70pct: float
    fade_frac_per_day: float


def calendar_alpha_per_day075(chemistry: str, v_cell_V: float,
                              T_K: float) -> float:
    """
    @description Schmalstieg 2014 calendar prefactor:
        alpha = (7.543*V - 23.75) * 1e6 * exp(-6976/T)  [per day^0.75],
        floored at zero (below ~3.15 V the published line goes negative --
        storage at very low V does not UN-age a cell). Amprius: x2.0 (H14).
    @param chemistry One of REAL_CHEMISTRIES.
    @param v_cell_V Cell rest voltage, V (instantaneous, per SPEC 4.1).
    @param T_K Cell temperature, K.
    @returns Calendar prefactor, per day^0.75.
    """
    chem = require_real_chemistry(chemistry)
    alpha = max(0.0, (7.543 * float(v_cell_V) - 23.75)) * 1.0e6 \
        * math.exp(-_CAL_EA_OVER_R_K / float(T_K))
    if chem == "amprius_si":
        alpha *= _AMPRIUS_CALENDAR_MULT
    return alpha


def resistance_growth_rate_per_day075(chemistry: str, v_cell_V: float,
                                      T_K: float) -> float:
    """
    @description Schmalstieg 2014 resistance growth:
        R/R0 - 1 = (5.270*V - 16.32) * 1e5 * exp(-5986/T) * t^0.75,
        returned as the per-day^0.75 prefactor, floored at zero. The Amprius
        overlay reuses the NMC form (no public Amprius data -- rides H14).
    @param chemistry One of REAL_CHEMISTRIES.
    @param v_cell_V Cell rest voltage, V.
    @param T_K Cell temperature, K.
    @returns Resistance-growth prefactor, per day^0.75.
    """
    require_real_chemistry(chemistry)
    return max(0.0, (5.270 * float(v_cell_V) - 16.32)) * 1.0e5 \
        * math.exp(-_RES_EA_OVER_R_K / float(T_K))


def cycle_beta_per_sqrtAh(v_avg_V: float, ddod_frac: float,
                          T_K: float = 298.15) -> float:
    """
    @description Schmalstieg 2014 cycle prefactor:
        beta = 7.348e-3*(V_avg - 3.667)^2 + 7.600e-4 + 4.081e-3*dDOD
        [per sqrt(Ah), Ah normalized to the 2.05 Ah reference cell], times
        the H13 temperature extension exp(-6976/T)/exp(-6976/T_clamp) with
        T_clamp the nearest edge of the 25-35 C parameterization window
        (factor = 1 inside the window -- the published beta IS the 25-35 C
        value; SPEC 4.1's "far from 25-35 C" clause).
    @param v_avg_V Mean cell voltage over the cycling, V.
    @param ddod_frac Cycle depth, dimensionless 0..1 (daily SOC swing is the
        acceptable proxy for slow diurnal cycling, SPEC 4.1).
    @param T_K Cycling temperature, K.
    @returns Cycle prefactor, per sqrt(normalized Ah).
    """
    if not (0.0 <= ddod_frac <= 1.0):
        raise ValueError(f"ddod_frac = {ddod_frac!r} must be in [0, 1]")
    beta = (7.348e-3 * (float(v_avg_V) - 3.667) ** 2
            + 7.600e-4 + 4.081e-3 * float(ddod_frac))
    t_clamp = min(max(float(T_K), _BETA_T_WINDOW_K[0]), _BETA_T_WINDOW_K[1])
    beta *= math.exp(-_CAL_EA_OVER_R_K / float(T_K)) \
        / math.exp(-_CAL_EA_OVER_R_K / t_clamp)
    return beta


def amprius_cycle_fade_frac(fec: float) -> float:
    """
    @description Amprius Si-anode cycle fade: dC = 0.01265 * sqrt(FEC)
        (80% at 250 FEC; HONESTY H14, band 150-400).
    @param fec Full equivalent cycles (charge-only-equivalent throughput /
        nameplate).
    @returns Capacity fade fraction from cycling.
    """
    if fec < 0.0:
        raise ValueError(f"fec = {fec!r} must be >= 0")
    return AMPRIUS_CYCLE_PREFACTOR * math.sqrt(float(fec))


def project_days_to_fade(chemistry: str, daily_throughput_Ah: float,
                         daily_dod_frac: float, mean_cell_V: float,
                         pack_temp_profile_K: Sequence[float]
                         ) -> AgingProjection:
    """
    @description Integrate one representative mission day forward until the
        pack reaches 80% (and 70%) retention -- the operator's actual
        question. Per-day increments alpha*d(t^0.75) + beta*d(sqrt(Q)) per
        SPEC 4.1, with alpha and the beta temperature factor averaged over
        the day's pack-temperature profile. FROZEN contract signature.
    @param chemistry One of REAL_CHEMISTRIES.
    @param daily_throughput_Ah TOTAL per-cell Ah moved per day, charge +
        discharge legs (converted internally to the charge-only-equivalent
        convention, H12/A4).
    @param daily_dod_frac Daily SOC swing, dimensionless 0..1.
    @param mean_cell_V Mean cell voltage over the day, V.
    @param pack_temp_profile_K Pack temperatures sampled over the day, K
        (any length >= 1; equal weights).
    @returns AgingProjection (days to 80%, days to 70%, mean fade rate).
    @raises ValueError On an unknown chemistry or empty/invalid inputs.
    """
    chem = require_real_chemistry(chemistry)
    temps = np.asarray(list(pack_temp_profile_K), dtype=float)
    if temps.size == 0 or not np.all(np.isfinite(temps)):
        raise ValueError("pack_temp_profile_K must be non-empty finite temps")
    if daily_throughput_Ah < 0.0:
        raise ValueError("daily_throughput_Ah must be >= 0")
    spec = CELL_SPECS[chem]
    alpha = float(np.mean([
        calendar_alpha_per_day075(chem, mean_cell_V, t) for t in temps]))
    # Charge-only-equivalent throughput per day (H12/A4).
    q_ce_daily_Ah = daily_throughput_Ah / 2.0
    fec_daily = q_ce_daily_Ah / spec.c_nom_Ah
    if chem == "amprius_si":
        cyc = lambda d: amprius_cycle_fade_frac(fec_daily * d)  # noqa: E731
    else:
        beta = float(np.mean([
            cycle_beta_per_sqrtAh(mean_cell_V, daily_dod_frac, t)
            for t in temps]))
        q_norm_daily = q_ce_daily_Ah * (SCHMALSTIEG_REF_AH / spec.c_nom_Ah)
        cyc = lambda d: beta * math.sqrt(q_norm_daily * d)  # noqa: E731

    horizon_days = 36500  # 100 years: past this the pack is not the limit
    days_80 = math.inf
    days_70 = math.inf
    for d in range(1, horizon_days + 1):
        fade = alpha * d ** 0.75 + cyc(d)
        if math.isinf(days_80) and fade >= 0.20:
            days_80 = float(d)
        if fade >= 0.30:
            days_70 = float(d)
            break
    rate = 0.20 / days_80 if math.isfinite(days_80) else 0.0  # A9: mean rate
    return AgingProjection(days_to_80pct=days_80, days_to_70pct=days_70,
                           fade_frac_per_day=rate)
