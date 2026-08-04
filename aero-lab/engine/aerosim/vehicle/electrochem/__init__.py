"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Barrel for the real-battery slice (SPEC_chemistry sections 1-4): OCV knots + cell specs (ocv.py), ECM with the plating wall and cold-collapse walls (ecm.py), lumped pack thermal + heater (thermal.py), Schmalstieg/Amprius aging (aging.py). Consolidated HONESTY ledger and the run_acceptance() self-test that executes the module's frozen acceptance anchors and prints PASS/FAIL with actual values.
"""

from __future__ import annotations

import math

from .aging import (
    AGING_HONESTY,
    AMPRIUS_CYCLE_PREFACTOR,
    AgingProjection,
    SCHMALSTIEG_REF_AH,
    amprius_cycle_fade_frac,
    calendar_alpha_per_day075,
    cycle_beta_per_sqrtAh,
    project_days_to_fade,
    resistance_growth_rate_per_day075,
)
from .ecm import (
    EA_R_J_PER_MOL,
    ELECTROCHEM_HONESTY,
    PLATING_LOSS_FRAC_PER_AH,
    R0_PULSE_FRACTION,
    R_NORM_OHM_AH,
    PackEcm,
    c_avail_frac,
    charge_limit_C,
    discharge_limit_C,
    f_soc_multiplier,
    pulse_power_W_per_kg,
    r_int_ohm,
    usable_capacity_frac,
)
from .ocv import (
    ALL_CHEMISTRIES,
    CELL_SPECS,
    CellSpec,
    IdealChemistryWarning,
    REAL_CHEMISTRIES,
    ocv_V,
    ocv_branch_V,
    require_real_chemistry,
    warn_defaulted_ideal,
)
from .thermal import (
    H_CONV_DEFAULT_W_M2K,
    HYSTERESIS_K,
    PackThermalSpec,
    THERMAL_HONESTY,
    p_hold_W,
    step_pack_temperature,
)

#: The module-level HONESTY ledger, consolidated (project rule: every
#: unsourced or bounded parameter is FLAGGED here, never silently defaulted).
HONESTY_LEDGER: dict[str, str] = {
    **ELECTROCHEM_HONESTY, **THERMAL_HONESTY, **AGING_HONESTY,
}

__all__ = [
    "AGING_HONESTY", "ALL_CHEMISTRIES", "AMPRIUS_CYCLE_PREFACTOR",
    "AgingProjection", "CELL_SPECS", "CellSpec", "EA_R_J_PER_MOL",
    "ELECTROCHEM_HONESTY", "H_CONV_DEFAULT_W_M2K", "HONESTY_LEDGER",
    "HYSTERESIS_K", "IdealChemistryWarning", "PLATING_LOSS_FRAC_PER_AH",
    "PackEcm", "PackThermalSpec", "R0_PULSE_FRACTION", "R_NORM_OHM_AH",
    "REAL_CHEMISTRIES", "SCHMALSTIEG_REF_AH", "THERMAL_HONESTY",
    "amprius_cycle_fade_frac", "c_avail_frac", "calendar_alpha_per_day075",
    "charge_limit_C", "cycle_beta_per_sqrtAh", "discharge_limit_C",
    "f_soc_multiplier", "ocv_V", "ocv_branch_V", "p_hold_W",
    "project_days_to_fade", "pulse_power_W_per_kg", "r_int_ohm",
    "require_real_chemistry", "resistance_growth_rate_per_day075",
    "run_acceptance", "step_pack_temperature", "usable_capacity_frac",
    "warn_defaulted_ideal",
]


def run_acceptance() -> int:
    """
    @description Execute the module's frozen acceptance anchors and print
        PASS/FAIL with the actual values (project rule: never claim a pass
        without pasted output). Returns a process exit code.
    @returns 0 when every anchor holds, 1 otherwise.
    """
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        results.append((name, bool(ok), detail))

    # 1. Cold-capacity walls (Zhang/Xu/Jow 2003 bands), ECM at 0.2C.
    u25 = usable_capacity_frac("nca_21700", 298.15)
    u20 = usable_capacity_frac("nca_21700", 253.15)
    u40 = usable_capacity_frac("nca_21700", 233.15)
    check("usable @ -20C in [0.65, 0.90] of rated (0.2C)",
          0.65 <= u20 <= 0.90, f"got {u20:.4f} (25C ref {u25:.4f})")
    check("usable @ -40C <= 0.35 of rated (0.2C)",
          u40 <= 0.35, f"got {u40:.4f}")

    # 2. R_int(25C -> -30C) ratio in [8, 13] (Zhang 2003 measured x10).
    ratio = (r_int_ohm("nca_21700", 0.5, 243.15, 4.85)
             / r_int_ohm("nca_21700", 0.5, 298.15, 4.85))
    check("R_int 25C->-30C ratio in [8, 13]", 8.0 <= ratio <= 13.0,
          f"got {ratio:.2f}")

    # 3. Amprius pulse power at 30% DOD >= 3000 W/kg (published point).
    pp = pulse_power_W_per_kg("amprius_si", 0.30)
    check("Amprius pulse @ 30% DOD >= 3000 W/kg (R_norm 0.15)",
          pp >= 3000.0, f"got {pp:.0f} W/kg")

    # 4. Aging sanity walls.
    m50 = project_days_to_fade("nca_21700", daily_throughput_Ah=2 * 4.85 * 3,
                               daily_dod_frac=0.8, mean_cell_V=3.7,
                               pack_temp_profile_K=[298.15])
    fec_m50 = 3.0 * m50.days_to_80pct
    check("M50-class 80% in 800-2000 FEC (25C, V 3.7, dDOD 0.8)",
          800.0 <= fec_m50 <= 2000.0,
          f"got {fec_m50:.0f} FEC ({m50.days_to_80pct:.0f} d at 3 FEC/d)")
    fec_pure = (0.20 / cycle_beta_per_sqrtAh(3.7, 0.8)) ** 2 / SCHMALSTIEG_REF_AH
    check("pure-cycle closed form ~1200 FEC", 1000.0 <= fec_pure <= 1400.0,
          f"got {fec_pure:.0f} FEC")
    amp = project_days_to_fade("amprius_si", daily_throughput_Ah=2 * 6.3 * 3,
                               daily_dod_frac=0.8, mean_cell_V=3.42,
                               pack_temp_profile_K=[298.15])
    fec_amp = 3.0 * amp.days_to_80pct
    check("Amprius 80% at 150-400 FEC", 150.0 <= fec_amp <= 400.0,
          f"got {fec_amp:.0f} FEC")

    # 5. Thermal design point: 12x21700 + 20 mm aerogel.
    spec = PackThermalSpec(m_pack_kg=12 * 0.0698 * 1.10,
                           t_ins_m=0.020, k_ins_W_per_mK=0.020,
                           A_box_m2=0.065, p_heater_max_W=10.0)
    hold = p_hold_W(spec.UA_W_per_K, 278.15, 217.15)
    hold_mild = p_hold_W(spec.UA_W_per_K, 278.15, 278.15)
    check("UA = 0.063 W/K +/-10%",
          0.9 * 0.063 <= spec.UA_W_per_K <= 1.1 * 0.063,
          f"got {spec.UA_W_per_K:.4f} W/K")
    check("P_hold(+5C vs -56C) = 3.9 W +/-10%", 3.51 <= hold <= 4.29,
          f"got {hold:.2f} W")
    check("P_hold(+5C vs +5C night) exactly 0 W", hold_mild == 0.0,
          f"got {hold_mild:.3f} W")

    # 6. The plating wall: charge below 0 C refused, spilled, logged; forced
    #    charge accrues the flagged penalty.
    pack = PackEcm("nca_21700", 12, 1, spec, 0.5, 0.05, 1.0)
    pack.pack_temp_K = 263.15
    unserved_W = pack.step_power(+50.0, 60.0)
    refused = (unserved_W == 50.0 and pack.cold_charge_spill_J == 3000.0
               and pack.plating_violation_Ah == 0.0)
    check("charge @ -10C refused and spilled to cold_charge_spill_J", refused,
          f"unserved {unserved_W:.1f} W, spill {pack.cold_charge_spill_J:.0f} J")
    pack.force_cold_charge = True
    pack.step_power(+50.0, 600.0)
    check("FORCED cold charge accrues plating_violation_Ah + 1%/Ah fade",
          pack.plating_violation_Ah > 0.0 and pack.capacity_fade_frac > 0.0,
          f"plated {pack.plating_violation_Ah:.4f} Ah, "
          f"fade {pack.capacity_fade_frac:.6f}")

    print("electrochem acceptance:")
    worst = 0
    for name, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
        worst |= 0 if ok else 1
    print(f"electrochem acceptance: "
          f"{'ALL PASS' if worst == 0 else 'FAILURES PRESENT'} "
          f"({sum(1 for _, ok, _ in results if ok)}/{len(results)})")
    return worst
