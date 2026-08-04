"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Lumped pack thermal balance (SPEC_chemistry section 3): PackThermalSpec with the insulation-derived UA (t_ins/k_ins/A_box conduction in series with the convective+radiative outer film), the closed-form p_hold_W design formula the pytest wall asserts (12x21700 + 20 mm aerogel -> UA 0.063 W/K, 3.9 W holding +5 C against -56 C, exactly 0 W against a +5 C night), and the exact-exponential thermostat step (unconditionally stable at mission timesteps) with 2 K hysteresis. Heater power is COMMANDED here but BILLED on the bus by PackHeaterLoad -- a heater that heats without billing is a free-energy violation.

WHY THE STEP IS EXACT-EXPONENTIAL, NOT EULER
--------------------------------------------
m*cp*dT/dt = Q + P_htr - UA*(T - T_amb) is linear in T within a step, so
T(t+dt) = T_eq + (T - T_eq) * exp(-UA*dt/(m*cp)) with
T_eq = T_amb + (Q + P_htr)/UA is the exact solution. Euler with a 60 s
mission step would be fine here (tau = m*cp/UA ~ 4 h), but exact costs the
same and cannot overshoot for any dt.
"""

from __future__ import annotations

import math

from ..param_bounds import Bounds, ParamBoundsError, validate_declared

#: Stefan-Boltzmann constant, W/(m^2 K^4). CODATA.
SIGMA_SB_W_M2K4: float = 5.670374419e-8

#: Outer-surface IR emissivity, dimensionless. Typical painted/plastic
#: surface, handbook value (SPEC 3.2, HONESTY H10).
EPSILON_SURFACE: float = 0.9

#: Default forced-convection film coefficient over the small pack box,
#: W/(m^2 K). SPEC 3.2 gives 10-25 at 500 m cruise and 2-5 at 20 km; 15 is
#: the mid-range single value used when the fuselage flow is not modelled
#: (HONESTY H10 -- correlation range, not a measurement).
H_CONV_DEFAULT_W_M2K: float = 15.0

#: Reference ambient for the radiative film coefficient in the DESIGN-POINT
#: UA (h_rad = 4*eps*sigma*T^3 = 3.2 W/m^2K at 250 K, exact arithmetic per
#: SPEC 3.2). 250 K is the stratospheric-night design ambient. HONESTY A5:
#: UA is evaluated once at this reference rather than re-linearized every
#: step; over 217-290 K the h_rad swing moves UA by under 3% because the
#: insulation resistance dominates by a factor ~18.
T_RAD_REF_K: float = 250.0

#: Thermostat hysteresis, K (SPEC 3.1: on below the floor, off above
#: floor + 2 K).
HYSTERESIS_K: float = 2.0

#: HONESTY ledger for this module (module-level, per the project rule).
THERMAL_HONESTY: dict[str, str] = {
    "H10": "cp default 1000 J/(kg K) (compilation range 800-1100); +10% pack "
           "mass overhead typical; epsilon = 0.9 handbook; h_conv 15 W/m2K "
           "mid-range of the 10-25 correlation band",
    "H11": "entropic heat term (reversible dOCV/dT * I * T) omitted -- "
           "sign-alternating, comparable to I^2R at low rate; net night "
           "heating slightly overestimated",
    "A5": "UA evaluated at the 250 K radiative reference, not re-linearized "
          "per step (<3% over 217-290 K; insulation-dominated)",
    "A6": "pack temperature initialized at ISA sea level 288.15 K; cold-soak "
          "by running evaluate() against ambient before the mission window",
}


class PackThermalSpec:
    """
    @description The pack's thermal design (SPEC 3): lumped mass and cp, an
        insulation path expressed either as a direct UA_W_per_K OR as the
        t_ins/k_ins/A_box triple (conduction in series with the outer
        convective+radiative film), the two temperature floors, and the
        heater's rated power. FROZEN contract name and constructor keywords.
    """

    #: Declared credible range for every numeric constructor parameter
    #: (frozen-contract rule d: every new numeric param joins PARAM_BOUNDS).
    PARAM_BOUNDS: dict[str, Bounds] = {
        "m_pack_kg": Bounds(0.0, 1.0e4, lo_open=True, unit="kg",
                            why="thermal inertia divisor; zero mass = "
                                "infinite heating rate"),
        "cp_J_per_kgK": Bounds(600.0, 2000.0, unit="J/(kg*K)",
                               why="Li-ion cell compilation range is "
                                   "800-1100 (batterydesign.net + J. Energy "
                                   "Storage 2021); band widened only for "
                                   "potting-heavy packs"),
        "UA_W_per_K": Bounds(0.0, 100.0, lo_open=True, unit="W/K",
                             why="a zero UA is a perfect thermos (free "
                                 "night survival); 100 W/K is bare metal"),
        "t_ins_m": Bounds(0.0, 0.5, lo_open=True, unit="m",
                          why="insulation thicker than the fuselage is a "
                              "geometry error"),
        "k_ins_W_per_mK": Bounds(0.010, 1.0, unit="W/(m*K)",
                                 why="0.020 aerogel (Aspen Pyrogel class) / "
                                     "0.033 EPS; below 0.010 is better than "
                                     "still air -- not purchasable"),
        "A_box_m2": Bounds(0.0, 100.0, lo_open=True, unit="m2",
                           why="loss area; zero area is a free thermos"),
        "T_floor_charge_K": Bounds(263.15, 320.0, unit="K",
                                   why="the plating wall is 273.15 K; a "
                                       "floor below it defeats the wall's "
                                       "purpose, 278.15 K (+5 C) is the "
                                       "BU-410 margin default"),
        "T_floor_discharge_K": Bounds(210.0, 320.0, unit="K",
                                      why="the -10 C derate knee default; "
                                          "bounded so inf/nan cannot enter "
                                          "the thermostat"),
        "p_heater_max_W": Bounds(0.0, 1.0e4, unit="W",
                                 why="billed on the bus via PackHeaterLoad; "
                                     "bounded so inf cannot ride the bill"),
    }

    def __init__(self, m_pack_kg: float, cp_J_per_kgK: float = 1000.0,
                 UA_W_per_K: float | None = None, *,
                 t_ins_m: float | None = None,
                 k_ins_W_per_mK: float | None = None,
                 A_box_m2: float | None = None,
                 T_floor_charge_K: float = 278.15,
                 T_floor_discharge_K: float = 263.15,
                 p_heater_max_W: float = 0.0) -> None:
        """
        @description Build the thermal spec. Exactly ONE of {UA_W_per_K, the
            full t_ins/k_ins/A_box triple} must be given; the triple derives
            UA = 1/(t/(k*A) + 1/(h_out*A)) with h_out = h_conv + 4*eps*sigma*
            T_ref^3 (SPEC 3.1/3.2).
        @param m_pack_kg Lumped pack thermal mass, kg (cells + overhead).
        @param cp_J_per_kgK Specific heat, J/(kg K). 1000 default (cited).
        @param UA_W_per_K Direct loss conductance, W/K (alternative to the
            insulation triple).
        @param t_ins_m Insulation thickness, m.
        @param k_ins_W_per_mK Insulation conductivity, W/(m K).
        @param A_box_m2 Box outer area, m^2.
        @param T_floor_charge_K Thermostat floor with charging enabled, K
            (278.15 = +5 C: plating wall + margin, SPEC 3.2).
        @param T_floor_discharge_K Discharge-only survival floor, K
            (263.15 = -10 C derate knee).
        @param p_heater_max_W Heater rated electrical power, W (from the bus).
        @raises ParamBoundsError On any out-of-band value or an over/under-
            determined insulation path.
        """
        triple = (t_ins_m, k_ins_W_per_mK, A_box_m2)
        have_triple = all(v is not None for v in triple)
        if (UA_W_per_K is None) == (not have_triple):
            raise ParamBoundsError(
                "PackThermalSpec needs exactly ONE insulation path: either "
                "UA_W_per_K directly, or the full t_ins_m / k_ins_W_per_mK / "
                "A_box_m2 triple -- an underdetermined UA is a free thermos, "
                "a doubly-given one is ambiguous."
            )
        maybe = {}
        if UA_W_per_K is not None:
            maybe["UA_W_per_K"] = UA_W_per_K
        if have_triple:
            maybe.update(t_ins_m=t_ins_m, k_ins_W_per_mK=k_ins_W_per_mK,
                         A_box_m2=A_box_m2)
        checked = validate_declared(
            type(self), m_pack_kg=m_pack_kg, cp_J_per_kgK=cp_J_per_kgK,
            T_floor_charge_K=T_floor_charge_K,
            T_floor_discharge_K=T_floor_discharge_K,
            p_heater_max_W=p_heater_max_W, **maybe)
        self.m_pack_kg = checked["m_pack_kg"]
        self.cp_J_per_kgK = checked["cp_J_per_kgK"]
        self.T_floor_charge_K = checked["T_floor_charge_K"]
        self.T_floor_discharge_K = checked["T_floor_discharge_K"]
        self.p_heater_max_W = checked["p_heater_max_W"]
        if have_triple:
            self.t_ins_m = checked["t_ins_m"]
            self.k_ins_W_per_mK = checked["k_ins_W_per_mK"]
            self.A_box_m2 = checked["A_box_m2"]
            h_rad = 4.0 * EPSILON_SURFACE * SIGMA_SB_W_M2K4 * T_RAD_REF_K ** 3
            h_out = H_CONV_DEFAULT_W_M2K + h_rad  # W/(m2 K)
            r_cond = self.t_ins_m / (self.k_ins_W_per_mK * self.A_box_m2)
            r_film = 1.0 / (h_out * self.A_box_m2)  # K/W
            #: Loss conductance, W/K (derived; SPEC 3.1 formula).
            self.UA_W_per_K = 1.0 / (r_cond + r_film)
        else:
            self.UA_W_per_K = checked["UA_W_per_K"]
        if self.T_floor_discharge_K > self.T_floor_charge_K:
            raise ParamBoundsError(
                f"PackThermalSpec floors are inverted: discharge floor "
                f"{self.T_floor_discharge_K:g} K above charge floor "
                f"{self.T_floor_charge_K:g} K"
            )


def p_hold_W(UA_W_per_K: float, T_floor_K: float, T_amb_K: float) -> float:
    """
    @description Steady heater power to hold a floor temperature against an
        ambient (SPEC 3.1 design formula and pytest wall):
        P_hold = UA * (T_floor - T_amb), floored at zero -- against a night
        at or above the floor the heater pays exactly nothing.
    @param UA_W_per_K Loss conductance, W/K.
    @param T_floor_K Floor temperature to hold, K.
    @param T_amb_K Ambient temperature, K.
    @returns Heater power, W, >= 0.
    """
    return max(0.0, float(UA_W_per_K) * (float(T_floor_K) - float(T_amb_K)))


def step_pack_temperature(spec: PackThermalSpec, T_b_K: float, T_amb_K: float,
                          q_int_W: float, dt_s: float, *,
                          heater_was_on: bool) -> tuple[float, float, bool]:
    """
    @description One thermostat + heat-balance step (SPEC 3.1). Thermostat:
        heater at p_heater_max_W when T_b < T_floor_charge_K, off above
        floor + 2 K, holding its previous state in the hysteresis band. The
        charge-enable floor governs by default (Yang & Wang PNAS 2018:
        heat-then-charge -- a pack allowed to cold-soak to the discharge
        floor cannot accept the morning's solar); the discharge floor is the
        survival diagnostic the mission report checks.
    @param spec The pack thermal spec.
    @param T_b_K Current pack temperature, K.
    @param T_amb_K Ambient temperature, K.
    @param q_int_W Internal I^2*R self-heating this step, W, >= 0.
    @param dt_s Timestep, s.
    @param heater_was_on Thermostat state memory (hysteresis).
    @returns (new pack temperature K, heater electrical power W, heater state).
    """
    if dt_s < 0.0:
        raise ValueError(f"dt_s must be >= 0, got {dt_s}")
    floor = spec.T_floor_charge_K
    if T_b_K < floor:
        heater_on = True
    elif T_b_K > floor + HYSTERESIS_K:
        heater_on = False
    else:
        heater_on = heater_was_on
    p_htr_W = spec.p_heater_max_W if heater_on else 0.0
    if dt_s == 0.0:
        return float(T_b_K), p_htr_W, heater_on
    # Exact solution of the linear ODE m*cp*dT/dt = q + p - UA*(T - T_amb).
    b_per_s = spec.UA_W_per_K / (spec.m_pack_kg * spec.cp_J_per_kgK)
    t_eq_K = T_amb_K + (max(0.0, q_int_W) + p_htr_W) / spec.UA_W_per_K
    t_new_K = t_eq_K + (T_b_K - t_eq_K) * math.exp(-b_per_s * dt_s)
    return float(t_new_K), p_htr_W, heater_on
