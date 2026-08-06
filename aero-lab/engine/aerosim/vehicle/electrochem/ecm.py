"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Equivalent-circuit model of the real battery (SPEC_chemistry sections 1-2): Arrhenius R_int(SOC,T) with Ea = 26 kJ/mol fitted to Zhang 2003's measured x10 @ -30 C / x20 @ -40 C, the BU-410 charge/discharge C-rate tables with the below-0-C lithium-plating wall (refuse + spill + logged 1%/Ah penalty when forced), the cold-capacity clamp re-anchored to Zhang 2003's own good-electrolyte table (the spec's single 0.006/K slope cannot reproduce the spec's own -40 C wall -- arithmetic in c_avail_frac), pulse power via the R0 fraction of DCIR, the 0.2C usable-capacity integrator the pytest walls call, and PackEcm -- the per-step pack state machine BatteryElement delegates to in real mode. Module HONESTY ledger consolidated here (H1-H14 + the deviations A1-A8).
2 | maintainer@emeraldcoastsystemsgroup.com   | Added the missing H3 flag (Amprius 0.80 packaging factor, carried by mass.py's pack constants, never billed twice) to ELECTROCHEM_HONESTY so every SPEC section-7 item H1-H14 lands in the module ledger; tests/test_pack_thermal_aging.py asserts the full set.
3 | maintainer@emeraldcoastsystemsgroup.com   | Made the documented -55 C electrolyte
  |                                           | solidification boundary return exact zero;
  |                                           | Kelvin-to-Celsius subtraction previously
  |                                           | left a 5.68e-16 interpolation residue.

WHY THE COLD COLLAPSE IS EMERGENT AND WHERE THE CLAMP SITS
----------------------------------------------------------
Under load V = OCV(SOC) - I*R(SOC,T). R grows Arrhenius-cold (x6.5 at -20 C,
x10.7 at -30, x18.6 at -40 vs 25 C), so the terminal voltage hits the cutoff
at a higher SOC and capacity collapses WITHOUT a second derating being
multiplied on top. The rate-independent c_avail_frac clamp below -10 C is the
diffusion-limit FLOOR only (Li+ transport freezing out, which no DC-IR term
sees at 0.2C); the delivered capacity is the ECM cutoff crossing times that
floor, and whichever predicts less wins.
"""

from __future__ import annotations

import math

import numpy as np

from .aging import (
    amprius_cycle_fade_frac,
    calendar_alpha_per_day075,
    cycle_beta_per_sqrtAh,
    resistance_growth_rate_per_day075,
)
from .ocv import CELL_SPECS, ocv_V, ocv_branch_V, require_real_chemistry
from .thermal import PackThermalSpec, step_pack_temperature

#: Universal gas constant, J/(mol*K). CODATA.
R_GAS_J_PER_MOLK: float = 8.314

#: Arrhenius activation energy of the DC internal resistance, J/mol. DERIVED,
#: not assumed: Zhang, Xu & Jow, J. Power Sources 2003 (S0378775303003549)
#: measured DC resistance x~10 at -30 C and x~20 at -40 C vs room temperature;
#: fitting exp(Ea/R*(1/T-1/298)) gives 25.2 and 26.6 kJ/mol respectively
#: (+/-3%), so one Ea = 26 kJ/mol reproduces both. Chen 2020's M50 EIS
#: activation energies corroborate the order.
EA_R_J_PER_MOL: float = 26.0e3

#: Capacity-normalized reference DC resistance at 50% SOC / 25 C, Ohm*Ah.
#: M50: 0.15/4.85 = 31 mOhm, matching the published M50 DCIR 25-35 mOhm
#: (batterydesign.net M50 page). Amprius: same default, +/-50% (HONESTY H6),
#: constrained by the 3000 W/kg pulse check below.
R_NORM_OHM_AH: float = 0.15

#: Fraction of the lumped DC resistance a short pulse actually sees (R0 of
#: the R0 + R1 Thevenin split; the RC pair with tau ~ 20-60 s has not charged
#: during a seconds-class pulse). HONESTY A2: 0.7 is a typical R0/DCIR split
#: from EIS/DCIR literature (SPEC 1.1's H4 carries the same tau caveat), not
#: cell-specific.
R0_PULSE_FRACTION: float = 0.7

#: f_SOC multiplier knots for R_int (SPEC 1.4 table; HONESTY H5 -- typical
#: DCIR-vs-SOC shape from Schmalstieg 2014 / Chen 2020, +/-20%). Linear
#: interpolation between rows, per the spec.
_F_SOC_KNOTS: tuple[tuple[float, float], ...] = (
    (0.00, 2.5), (0.02, 2.5), (0.05, 1.8), (0.10, 1.3),
    (0.20, 1.0), (0.90, 1.0), (1.00, 1.1),
)

#: Cold-capacity clamp knots, (T degC, fraction of nameplate available).
#: Piecewise-linear through the GOOD-ELECTROLYTE EDGE of Zhang 2003's
#: measured 0.2C table (+25: 100%, -20: 67-88%, -30: 2-70%, -40: 0-30%),
#: chosen at the good edge because modern 21700s outperform the 2003 median
#: (SPEC 2.2's own argument). HONESTY A1 -- DEVIATION from SPEC 2.2's single
#: 0.006/K slope, with the arithmetic: that slope gives 0.82 at -40 C, and
#: with the ECM cutoff crossing at SOC ~0.09 the delivered fraction would be
#: 0.91 x 0.82 = 0.75, violating the spec's OWN -40 C wall (<= 0.35, SPEC
#: 2.1/2.2). The spec's fallback-bound clause ("if the ECM already predicts
#: less, the ECM wins") cannot rescue it because the Ea = 26 kJ/mol ohmic
#: collapse alone reaches only ~0.75 at 0.2C. The table below keeps the spec
#: value shape near -20 and follows Zhang's measured edge below it; the -55 C
#: zero is the EC-electrolyte solidification region (Zhang 2003 discussion).
_C_AVAIL_KNOTS_DEGC: tuple[tuple[float, float], ...] = (
    (-55.0, 0.00), (-40.0, 0.30), (-30.0, 0.70), (-20.0, 0.88), (-10.0, 1.00),
)

#: BU-410 charge-rate table, (lower edge T degC, max charge C-rate). Applies
#: at T in [edge, next edge). Below 0 C the rate is ZERO -- the lithium
#: plating wall (BU-410; Yang & Wang PNAS 2018). Steps between the 0/5/15 C
#: anchors are interpolated conservatively (HONESTY H7).
_CHARGE_LIMIT_STEPS_DEGC: tuple[tuple[float, float], ...] = (
    (-273.15, 0.0),   # plating wall: no charge below freezing (BU-410)
    (0.0, 0.1),       # BU-410 "reduce below 5 C"; conservative edge (H7)
    (5.0, 0.2),       # BU-410 window edge (H7 interpolated step)
    (10.0, 0.5),      # H7 interpolated step
    (15.0, 0.7),      # LG M50 datasheet class max charge 0.7C
    (45.0, 0.3),      # BU-410 high-T derate (H7 step shape)
    (60.0, 0.0),      # datasheet operating limit
)

#: Discharge-rate table, (lower edge T degC, max discharge C-rate).
#: Zhang 2003 cold collapse below -20 C; M50 datasheet ~1.5C continuous.
_DISCHARGE_LIMIT_STEPS_DEGC: tuple[tuple[float, float], ...] = (
    (-273.15, 0.2),
    (-20.0, 0.5),
    (0.0, 1.0),
    (5.0, 1.5),
    (45.0, 1.0),
    (60.0, 0.0),
)

#: Amprius overlays (SPEC 1.5): energy-optimized Si cell, max charge 0.5C
#: (catalog-class, HONESTY within H14's band), discharge capped 1C continuous
#: for aging sanity.
_AMPRIUS_MAX_CHARGE_C: float = 0.5
_AMPRIUS_MAX_DISCHARGE_C: float = 1.0

#: Permanent capacity loss per plated Ah when charge is FORCED below 0 C,
#: as a fraction of the plated Ah. HONESTY H8: order-of-magnitude placeholder
#: (plating efficiency is strongly rate/T dependent; no single published
#: coefficient exists). Exists to make the failure mode visible, never as a
#: design trade -- the default controller refuses cold charge outright.
PLATING_LOSS_FRAC_PER_AH: float = 0.01

#: C-rate used when a caller has EXPLICITLY forced charging below 0 C
#: (force_cold_charge = True): the 0-5 C table rate, applied below freezing
#: as the "controller bug under test" rate. HONESTY A8.
_FORCED_COLD_CHARGE_C: float = 0.1

#: MODULE HONESTY LEDGER (SPEC_chemistry section 7 H-items owned by this
#: module, plus the implementation's own flagged assumptions). Every entry is
#: a parameter or convention with no clean primary source; nothing here is a
#: silent default.
ELECTROCHEM_HONESTY: dict[str, str] = {
    "H1": "M50 OCV knots digitized +/-30 mV from Chen 2020 (verify vs PyBaMM "
          "Chen2020 set)",
    "H2": "Amprius OCV = IR-corrected catalog discharge curve +/-50 mV; "
          "+/-40 mV hysteresis is literature-typical Si, not Amprius data",
    "H3": "Amprius pack Wh/kg = cell x 0.80 packaging factor "
          "(industry-typical, not Amprius data) -- carried by mass.py's "
          "PACK_SI_ANODE_WH_PER_KG family, never billed twice: this module "
          "bills cell mass via CELL_SPECS, the element bills pack mass via "
          "specific_energy_Wh_per_kg, and validate_cross_params ties the two",
    "H4": "RC time constant 20-60 s typical EIS/DCIR range, not cell-specific "
          "(lumped R_int at mission timesteps)",
    "H5": "f_SOC resistance multipliers +/-20%, shape from Schmalstieg/Chen",
    "H6": "Amprius R_norm = 0.15 Ohm*Ah +/-50%, constrained by the published "
          "3000 W/kg @ 30% DOD pulse point",
    "H7": "charge-limit steps at 0-15 C interpolated between BU-410 anchors",
    "H8": "plating penalty 1% per plated Ah = order-of-magnitude placeholder",
    "H9/A1": "cold-capacity clamp re-anchored to Zhang 2003's good-electrolyte "
             "edge (piecewise linear -10/-20/-30/-40/-55 C = "
             "1.00/0.88/0.70/0.30/0.00); the spec's single 0.006/K slope "
             "fails the spec's own -40 C <= 35% wall (0.91 x 0.82 = 0.75)",
    "A2": "pulse resistance = 0.7 x DCIR (typical R0 share; tau 20-60 s so a "
          "seconds-class pulse does not charge the RC pair)",
    "A3": "Amprius cell nameplate 6.3 Ah is catalog-CLASS, not a datasheet "
          "number; cell mass DERIVED from the published 450 Wh/kg",
    "A8": "forced cold-charge rate 0.1C (the 0-5 C table rate) -- only "
          "reachable via the explicit force_cold_charge flag",
}


def _piecewise_linear(knots: tuple[tuple[float, float], ...], x: float) -> float:
    """
    @description Linear interpolation through sorted (x, y) knots, clamped to
        the end values outside the table.
    @param knots Sorted (x, y) pairs.
    @param x Query point.
    @returns Interpolated y.
    """
    xs = [k[0] for k in knots]
    ys = [k[1] for k in knots]
    return float(np.interp(x, xs, ys))


def _step_table(steps: tuple[tuple[float, float], ...], t_degC: float) -> float:
    """
    @description Step-table lookup: the value of the last row whose edge
        temperature is <= t_degC; above the final edge the final value holds
        until the >60 C zero row applies.
    @param steps Sorted (edge degC, value) rows.
    @param t_degC Cell temperature, degC.
    @returns Table value at t_degC.
    """
    value = steps[0][1]
    for edge, v in steps:
        if t_degC >= edge:
            value = v
        else:
            break
    if t_degC > 60.0:
        return 0.0  # datasheet operating limit, both tables
    return float(value)


def f_soc_multiplier(soc: float) -> float:
    """
    @description The SOC shape multiplier on R_int (SPEC 1.4, HONESTY H5).
    @param soc State of charge, dimensionless 0..1.
    @returns Dimensionless multiplier, 1.0 over the 0.20-0.90 plateau.
    """
    return _piecewise_linear(_F_SOC_KNOTS, float(np.clip(soc, 0.0, 1.0)))


def r_int_ohm(chemistry: str, soc: float, T_K: float, c_nom_Ah: float) -> float:
    """
    @description Lumped DC internal resistance of one cell (SPEC 1.4):
        R = (R_norm / C_nom) * f_SOC(SOC) * exp[(Ea/R_gas)(1/T - 1/298.15)].
        FROZEN contract signature.
    @param chemistry One of REAL_CHEMISTRIES (validates; no ideal resistance).
    @param soc State of charge, dimensionless 0..1.
    @param T_K Cell temperature, K.
    @param c_nom_Ah Nameplate capacity of the cell, Ah.
    @returns Internal resistance, Ohm.
    @raises ValueError On unknown chemistry or non-physical T/capacity.
    """
    require_real_chemistry(chemistry)
    if not (100.0 < T_K < 400.0):
        raise ValueError(f"T_K = {T_K!r} outside the credible 100-400 K window")
    if not (0.0 < c_nom_Ah < 1.0e4):
        raise ValueError(f"c_nom_Ah = {c_nom_Ah!r} must be in (0, 1e4)")
    r_ref = R_NORM_OHM_AH / c_nom_Ah  # Ohm at 50% SOC, 25 C
    arrhenius = math.exp((EA_R_J_PER_MOL / R_GAS_J_PER_MOLK)
                         * (1.0 / T_K - 1.0 / 298.15))
    return r_ref * f_soc_multiplier(soc) * arrhenius


def c_avail_frac(T_K: float) -> float:
    """
    @description Rate-independent temperature-available capacity fraction --
        the diffusion-limit FLOOR of SPEC 2.2, re-anchored to Zhang 2003's
        good-electrolyte measured edge (HONESTY H9/A1; deviation arithmetic in
        the knot-table comment). 1.0 at and above -10 C; zero by -55 C
        (electrolyte solidification). FROZEN contract signature.
    @param T_K Cell temperature, K.
    @returns Available fraction of nameplate capacity, dimensionless 0..1.
    """
    t_degC = float(T_K) - 273.15
    if t_degC >= -10.0:
        return 1.0
    if t_degC <= -55.0 + 1.0e-12:
        # 218.15 K - 273.15 K is -54.99999999999997 in binary floating point.
        # The table's physical endpoint is a hard zero, not a positive epsilon.
        return 0.0
    return max(0.0, _piecewise_linear(_C_AVAIL_KNOTS_DEGC, t_degC))


def charge_limit_C(chemistry: str, T_K: float) -> float:
    """
    @description Maximum charge C-rate at a cell temperature (SPEC 1.5 table,
        BU-410 anchored; ZERO below 0 C -- the lithium-plating wall). FROZEN
        contract signature.
    @param chemistry One of REAL_CHEMISTRIES.
    @param T_K Cell temperature, K.
    @returns Max charge rate, 1/h (C-rate).
    """
    require_real_chemistry(chemistry)
    limit = _step_table(_CHARGE_LIMIT_STEPS_DEGC, float(T_K) - 273.15)
    if chemistry == "amprius_si":
        limit = min(limit, _AMPRIUS_MAX_CHARGE_C)
    return limit


def discharge_limit_C(chemistry: str, T_K: float) -> float:
    """
    @description Maximum continuous discharge C-rate at a cell temperature
        (SPEC 1.5 table). FROZEN contract signature.
    @param chemistry One of REAL_CHEMISTRIES.
    @param T_K Cell temperature, K.
    @returns Max discharge rate, 1/h (C-rate).
    """
    require_real_chemistry(chemistry)
    limit = _step_table(_DISCHARGE_LIMIT_STEPS_DEGC, float(T_K) - 273.15)
    if chemistry == "amprius_si":
        limit = min(limit, _AMPRIUS_MAX_DISCHARGE_C)
    return limit


def pulse_power_W_per_kg(chemistry: str, dod_frac: float,
                         t_K: float = 298.15) -> float:
    """
    @description Peak specific pulse power at a depth of discharge: the
        maximum-power-transfer point OCV^2 / (4 * R_pulse) of the discharge
        branch, with R_pulse = R0_PULSE_FRACTION x DCIR (a seconds-class
        pulse does not charge the RC pair -- HONESTY A2/H4). This is the
        consistency check SPEC 1.4 mandates for the Amprius R_norm: the model
        must reach the published 3000 W/kg at 30% DOD, and it is asserted as
        a pytest wall.
    @param chemistry One of REAL_CHEMISTRIES.
    @param dod_frac Depth of discharge, dimensionless 0..1 (SOC = 1 - DOD).
    @param t_K Cell temperature, K.
    @returns Specific pulse power, W/kg of cell mass.
    """
    chem = require_real_chemistry(chemistry)
    if not (0.0 <= dod_frac <= 1.0):
        raise ValueError(f"dod_frac = {dod_frac!r} must be in [0, 1]")
    spec = CELL_SPECS[chem]
    soc = 1.0 - float(dod_frac)
    v = ocv_branch_V(chem, soc, charging=False)
    r_pulse = R0_PULSE_FRACTION * r_int_ohm(chem, soc, t_K, spec.c_nom_Ah)
    p_cell_W = v * v / (4.0 * r_pulse)
    return p_cell_W / spec.m_cell_kg


def usable_capacity_frac(chemistry: str, T_K: float, c_rate: float = 0.2,
                         dt_s: float = 10.0) -> float:
    """
    @description Constant-current discharge of one cell from SOC = 1 to the
        datasheet cutoff at a fixed cell temperature: the Zhang 2003 test
        protocol, run on the ECM. The cold collapse EMERGES from
        OCV - I*R(SOC,T) hitting the cutoff early; c_avail_frac(T) is only
        the diffusion floor on the SOC integrator (SPEC 2.2). This is the
        function the -20 C / -40 C pytest walls call.
    @param chemistry One of REAL_CHEMISTRIES.
    @param T_K Cell temperature, K (held fixed: chamber test, bare cell).
    @param c_rate Discharge rate relative to NAMEPLATE capacity, 1/h.
    @param dt_s Integration step, s.
    @returns Delivered capacity as a fraction of nameplate, dimensionless.
    """
    chem = require_real_chemistry(chemistry)
    spec = CELL_SPECS[chem]
    c_eff_Ah = spec.c_nom_Ah * c_avail_frac(T_K)  # diffusion-floored capacity
    if c_eff_Ah <= 0.0:
        return 0.0
    i_A = float(c_rate) * spec.c_nom_Ah  # protocol current is on NAMEPLATE
    soc = 1.0
    delivered_Ah = 0.0
    max_steps = int(2.0 * 3600.0 / (c_rate * dt_s)) + 10  # 2x nominal duration
    for _ in range(max_steps):
        v_V = (ocv_branch_V(chem, soc, charging=False)
               - i_A * r_int_ohm(chem, soc, T_K, spec.c_nom_Ah))
        if v_V <= spec.v_cutoff_V or soc <= 0.0:
            break
        d_Ah = i_A * dt_s / 3600.0
        soc -= d_Ah / c_eff_Ah
        delivered_Ah += d_Ah
    return delivered_Ah / spec.c_nom_Ah


class PackEcm:
    """
    @description The real pack's per-step state machine: Ns x Np cells of one
        chemistry, first-order ECM electrical solve, temperature-available
        capacity, the plating wall, lumped thermal state, and coupled aging.
        BatteryElement (vehicle/energy.py) owns the frozen element contract
        and delegates every real-mode step here so energy.py stays thin.

        Losses are OWNED here as I^2*R -- there is no flat eta anywhere on
        this path (passing eta_charge/eta_discharge with a real chemistry
        raises at the element).
    """

    def __init__(self, chemistry: str, n_series: int, n_parallel: int,
                 thermal: PackThermalSpec, initial_soc: float,
                 soc_min: float, soc_max: float) -> None:
        """
        @description Build the pack state.
        @param chemistry One of REAL_CHEMISTRIES.
        @param n_series Cells in series, >= 1.
        @param n_parallel Parallel strings, >= 1.
        @param thermal The pack thermal spec (insulation + heater + floors).
        @param initial_soc Starting state of charge, dimensionless.
        @param soc_min Discharge rail, dimensionless.
        @param soc_max Charge rail, dimensionless.
        """
        self.chemistry = require_real_chemistry(chemistry)
        self.spec = CELL_SPECS[self.chemistry]
        self.n_series = int(n_series)
        self.n_parallel = int(n_parallel)
        self.thermal = thermal
        self.soc = float(initial_soc)
        self.soc_min = float(soc_min)
        self.soc_max = float(soc_max)
        #: Lumped pack temperature, K. HONESTY A6: initialized at the ISA
        #: sea-level 288.15 K; a mission that launches cold-soaked must
        #: pre-soak by running evaluate() against ambient before takeoff.
        self.pack_temp_K: float = 288.15
        #: Heater electrical power commanded THIS step, W (billed on the bus
        #: by PackHeaterLoad, never applied silently).
        self.last_heater_W: float = 0.0
        #: Whether the thermostat was on last step (2 K hysteresis memory).
        self._heater_on: bool = False
        #: Internal I^2*R heat of the LAST electrical step, W (pack total).
        self.last_heat_W: float = 0.0
        #: Total per-cell charge throughput, Ah (charge + discharge legs).
        self.throughput_Ah: float = 0.0
        #: Permanent capacity fade, fraction of nameplate (aging + plating).
        self.capacity_fade_frac: float = 0.0
        #: Permanent resistance growth, fraction of fresh R_int.
        self.resistance_growth_frac: float = 0.0
        #: Ah accepted below 0 C (the plating ledger). Nonzero ONLY when a
        #: caller forced cold charge.
        self.plating_violation_Ah: float = 0.0
        #: Energy refused at the plating wall, J (spilled solar, logged).
        self.cold_charge_spill_J: float = 0.0
        #: Charge is REFUSED below 0 C by default; set True only to expose a
        #: controller bug (accrues the flagged H8 plating penalty).
        self.force_cold_charge: bool = False
        # Aging bookkeeping.
        self._t_days: float = 0.0
        self._fade_calendar: float = 0.0
        self._fade_cycle: float = 0.0
        self._fade_plating: float = 0.0
        self._soc_lo_seen: float = self.soc
        self._soc_hi_seen: float = self.soc
        self._v_i_integral: float = 0.0   # sum |I|*dt*V for V_avg under load
        self._i_dt_integral: float = 0.0  # sum |I|*dt

    # -- derived quantities ---------------------------------------------------

    def c_nom_eff_Ah(self) -> float:
        """
        @description Aged nameplate capacity, Ah (fade coupled back per SPEC
            4.1: C_nom <- C_nom * (C/C0)).
        @returns Aged capacity, Ah.
        """
        return self.spec.c_nom_Ah * max(0.0, 1.0 - self.capacity_fade_frac)

    def _c_step_Ah(self) -> float:
        """
        @description Capacity governing THIS step's SOC integrator: aged
            nameplate floored by the cold diffusion clamp.
        @returns Effective capacity, Ah.
        """
        return self.c_nom_eff_Ah() * c_avail_frac(self.pack_temp_K)

    def _r_cell_ohm(self) -> float:
        """
        @description Aged cell resistance at the current SOC and temperature
            (growth coupled back per SPEC 4.1: R <- R * (R/R0)).
        @returns Cell resistance, Ohm.
        """
        return (r_int_ohm(self.chemistry, self.soc, self.pack_temp_K,
                          self.spec.c_nom_Ah)
                * (1.0 + self.resistance_growth_frac))

    # -- electrical step ------------------------------------------------------

    def step_power(self, power_W: float, dt_s: float) -> float:
        """
        @description Advance the pack one timestep under a signed BUS power
            (positive charges, matching powerplant.battery_step's frozen sign
            convention). The electrical solve is per-cell on the branch OCV
            and aged R; losses are I^2*R; limits are the BU-410 C-rate
            tables, the datasheet voltage window, the SOC rails, and the
            below-0-C plating wall.
        @param power_W Bus power, W. Positive charges the pack.
        @param dt_s Timestep, s, >= 0.
        @returns Unserved bus power, W: positive = charge the pack refused,
            negative = discharge it could not deliver.
        """
        if dt_s < 0.0:
            raise ValueError(f"dt_s must be >= 0, got {dt_s}")
        self.last_heat_W = 0.0  # a refused/idle step self-heats nothing
        if dt_s == 0.0 or power_W == 0.0:
            self._advance_aging(dt_s)
            return 0.0
        n_cells = self.n_series * self.n_parallel
        p_cell_W = abs(float(power_W)) / n_cells
        r = self._r_cell_ohm()
        c_step = self._c_step_Ah()
        t_K = self.pack_temp_K

        if power_W > 0.0:
            served_W = self._charge_cell(p_cell_W, dt_s, r, c_step, t_K) * n_cells
            unserved_W = float(power_W) - served_W
            if (t_K < 273.15) and unserved_W > 0.0:
                # The plating wall refused it: spilled, and LOGGED as such.
                self.cold_charge_spill_J += unserved_W * dt_s
            self._advance_aging(dt_s)
            return unserved_W

        served_W = self._discharge_cell(p_cell_W, dt_s, r, c_step) * n_cells
        self._advance_aging(dt_s)
        return -(abs(float(power_W)) - served_W)

    def _charge_cell(self, p_cell_W: float, dt_s: float, r: float,
                     c_step_Ah: float, t_K: float) -> float:
        """
        @description One cell's charge leg: solve I from p = (OCV_c + I*R)*I,
            clip to the BU-410 rate limit (ZERO below 0 C unless explicitly
            forced -- then the H8 plating penalty accrues), the SOC headroom
            and the charge-termination voltage.
        @param p_cell_W Offered charge power per cell, W.
        @param dt_s Timestep, s.
        @param r Cell resistance, Ohm.
        @param c_step_Ah Effective capacity for the SOC integrator, Ah.
        @param t_K Cell temperature, K.
        @returns Power actually accepted per cell, W.
        """
        limit_C = charge_limit_C(self.chemistry, t_K)
        forced = False
        if limit_C <= 0.0:
            if not self.force_cold_charge:
                return 0.0  # the plating wall: refuse, caller sees the spill
            limit_C, forced = _FORCED_COLD_CHARGE_C, True
        v_oc = ocv_branch_V(self.chemistry, self.soc, charging=True)
        # p = (v_oc + I r) I  ->  I = (-v_oc + sqrt(v_oc^2 + 4 r p)) / (2 r)
        i_req = (-v_oc + math.sqrt(v_oc * v_oc + 4.0 * r * p_cell_W)) / (2.0 * r)
        i_lim = limit_C * self.c_nom_eff_Ah()
        # Charge-termination voltage cap: v_oc + I r <= v_max.
        i_vmax = max(0.0, (self.spec.v_max_V - v_oc) / r)
        if c_step_Ah <= 0.0:
            return 0.0
        i_soc = max(0.0, (self.soc_max - self.soc)) * 3600.0 * c_step_Ah / dt_s
        i_A = min(i_req, i_lim, i_vmax, i_soc)
        if i_A <= 0.0:
            return 0.0
        d_Ah = i_A * dt_s / 3600.0
        self.soc = min(self.soc_max, self.soc + d_Ah / c_step_Ah)
        self.throughput_Ah += d_Ah
        self.last_heat_W = i_A * i_A * r * self.n_series * self.n_parallel
        if forced and t_K < 273.15:
            # Plated lithium: permanent, flagged, never a design trade (H8).
            self.plating_violation_Ah += d_Ah
            self._fade_plating += (PLATING_LOSS_FRAC_PER_AH * d_Ah
                                   / self.spec.c_nom_Ah)
            self._recompute_fade()
        self._track_load(i_A, dt_s)
        return (v_oc + i_A * r) * i_A

    def _discharge_cell(self, p_cell_W: float, dt_s: float, r: float,
                        c_step_Ah: float) -> float:
        """
        @description One cell's discharge leg: solve I from p = (OCV_d - I*R)*I
            (smaller root), clip to the rate limit, the cutoff voltage, the
            maximum-power point and the SOC floor. What cannot be delivered is
            returned to the caller as shortfall, never silently dropped.
        @param p_cell_W Demanded terminal power per cell, W.
        @param dt_s Timestep, s.
        @param r Cell resistance, Ohm.
        @param c_step_Ah Effective capacity for the SOC integrator, Ah.
        @returns Power actually delivered per cell, W.
        """
        if c_step_Ah <= 0.0 or self.soc <= self.soc_min:
            return 0.0  # frozen electrolyte or empty: nothing to deliver
        v_oc = ocv_branch_V(self.chemistry, self.soc, charging=False)
        if v_oc <= self.spec.v_cutoff_V:
            return 0.0
        disc = v_oc * v_oc - 4.0 * r * p_cell_W
        if disc >= 0.0:
            i_req = (v_oc - math.sqrt(disc)) / (2.0 * r)  # smaller root
        else:
            i_req = v_oc / (2.0 * r)  # demand beyond peak: deliver the peak
        i_lim = discharge_limit_C(self.chemistry, self.pack_temp_K) \
            * self.c_nom_eff_Ah()
        i_vcut = (v_oc - self.spec.v_cutoff_V) / r
        i_soc = max(0.0, self.soc - self.soc_min) * 3600.0 * c_step_Ah / dt_s
        i_A = min(i_req, i_lim, i_vcut, i_soc)
        if i_A <= 0.0:
            return 0.0
        d_Ah = i_A * dt_s / 3600.0
        self.soc = max(self.soc_min, self.soc - d_Ah / c_step_Ah)
        self.throughput_Ah += d_Ah
        self.last_heat_W = i_A * i_A * r * self.n_series * self.n_parallel
        self._track_load(i_A, dt_s)
        return (v_oc - i_A * r) * i_A

    # -- thermal step ---------------------------------------------------------

    def advance_thermal(self, t_amb_K: float, dt_s: float) -> None:
        """
        @description Advance the lumped pack temperature one step (SPEC 3.1
            heat balance: I^2*R self-heating + heater - UA loss) and run the
            2 K hysteresis thermostat against the charge-enable floor. The
            heater power set here is BILLED on the bus by PackHeaterLoad --
            it is never free heat.
        @param t_amb_K Ambient temperature, K (from the atmosphere sample).
        @param dt_s Timestep, s.
        @returns None. Updates pack_temp_K and last_heater_W.
        """
        self.pack_temp_K, self.last_heater_W, self._heater_on = \
            step_pack_temperature(
                self.thermal, self.pack_temp_K, float(t_amb_K),
                self.last_heat_W, dt_s, heater_was_on=self._heater_on,
            )

    # -- aging ----------------------------------------------------------------

    def _track_load(self, i_A: float, dt_s: float) -> None:
        """
        @description Accumulate the |I|-weighted mean cell voltage and the SOC
            envelope that feed the Schmalstieg cycle term.
        @param i_A Cell current magnitude, A.
        @param dt_s Timestep, s.
        """
        self._v_i_integral += ocv_V(self.chemistry, self.soc) * i_A * dt_s
        self._i_dt_integral += i_A * dt_s
        self._soc_lo_seen = min(self._soc_lo_seen, self.soc)
        self._soc_hi_seen = max(self._soc_hi_seen, self.soc)

    def _advance_aging(self, dt_s: float) -> None:
        """
        @description Accrue calendar + cycle aging (SPEC 4.1, Schmalstieg
            2014 family) and couple it back into C_nom and R_int. Calendar
            integrates alpha at the INSTANTANEOUS rest voltage and pack
            temperature (per the spec, not one mean V). The cycle term uses
            the |I|-weighted mean voltage and the lifetime SOC envelope as
            dDOD -- the spec's slow-diurnal-cycling allowance (SPEC 4.1).
        @param dt_s Timestep, s.
        """
        if dt_s <= 0.0:
            return
        t0, t1 = self._t_days, self._t_days + dt_s / 86400.0
        self._t_days = t1
        v_rest = ocv_V(self.chemistry, self.soc)
        d_t075 = t1 ** 0.75 - t0 ** 0.75
        alpha = calendar_alpha_per_day075(self.chemistry, v_rest,
                                          self.pack_temp_K)
        self._fade_calendar += alpha * d_t075
        self.resistance_growth_frac += resistance_growth_rate_per_day075(
            self.chemistry, v_rest, self.pack_temp_K) * d_t075
        if self._i_dt_integral > 0.0:
            if self.chemistry == "amprius_si":
                fec = self.throughput_Ah / (2.0 * self.spec.c_nom_Ah)
                self._fade_cycle = amprius_cycle_fade_frac(fec)
            else:
                v_avg = self._v_i_integral / self._i_dt_integral
                ddod = self._soc_hi_seen - self._soc_lo_seen
                beta = cycle_beta_per_sqrtAh(v_avg, ddod, self.pack_temp_K)
                # Charge-only-equivalent throughput normalized to the 2.05 Ah
                # Schmalstieg reference cell (convention H12/A4, aging.py).
                q_norm = (self.throughput_Ah / 2.0) \
                    * (2.05 / self.spec.c_nom_Ah)
                self._fade_cycle = beta * math.sqrt(q_norm)
        self._recompute_fade()

    def _recompute_fade(self) -> None:
        """
        @description Total permanent fade = calendar + cycle + plating,
            clamped to [0, 1].
        """
        self.capacity_fade_frac = float(np.clip(
            self._fade_calendar + self._fade_cycle + self._fade_plating,
            0.0, 1.0))


if __name__ == "__main__":  # pragma: no cover
    from aerosim.vehicle.electrochem import run_acceptance
    raise SystemExit(run_acceptance())
