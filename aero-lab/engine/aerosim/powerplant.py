"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation: PV thermal
  |                                           | + temperature-derated power, asymmetric
  |                                           | battery, blade-element/Froude propeller,
  |                                           | copper+iron-loss motor, level-flight and
  |                                           | momentum-theory hover power, and the
  |                                           | actuator-disk turbine power/drag PAIR that
  |                                           | makes negative control D impossible to fake.
-------------------------------------------------------------------------------

MODULE: aerosim.powerplant  --  every energy conversion in the system.

Design rule this module exists to enforce: NO ROUND TRIP IS EVER A SINGLE FUDGE
FACTOR. Each conversion is a separately named, separately defensible efficiency,
so that when validation case D reports 0.2209 the operator can point at the six
numbers that produced it.

Leaf module: imports nothing from the project, nothing outside the Python
standard library. Runnable directly:  python aerosim/powerplant.py

===============================================================================
INTERFACE OBJECTIONS (recorded per Rule 1 -- the interface is implemented
EXACTLY as specified regardless; nothing below changes a signature)
===============================================================================

OBJECTION 1 -- hover_power_W: the spec's formula and the spec's expected NUMBER
               disagree with each other, and I implemented the FORMULA.

  The spec states, on one line:
      hover_power_W(...) -> T**1.5/sqrt(2*rho*A)/(FM*eta_motor*eta_esc)
      must pass: hover_power_W(9.81, 1.225, 0.203, 0.65, 0.85, 0.95)
                 = 78.9 +/-3 W and in the operator's [65,90] W band

  Worked out exactly:
      T**1.5                = 9.81**1.5              = 30.72583 W-ish numerator
      sqrt(2*rho*A)         = sqrt(2*1.225*0.203)    =  0.705230
      ideal induced power   = 30.72583/0.705230      = 43.5691 W   (momentum theory)
      / FM 0.65             ->  67.0294 W  rotor shaft power
      / eta_motor 0.85      ->  78.8582 W  <-- THIS is the spec's "78.9"
      / eta_esc 0.95        ->  83.0086 W  <-- this is what the spec's FORMULA returns

  So 78.9 W is reachable only by DROPPING eta_esc, which the same line requires.
  78.9 +/- 3 = [75.9, 81.9] and the formula gives 83.01, i.e. the stated
  tolerance band cannot contain the stated formula's own output.

  Resolution: the formula is normative physics and is unambiguous; the 78.9 is a
  cross-check the spec author computed with one factor accidentally dropped. This
  module implements the FORMULA -> 83.01 W. The self-test reports both values and
  marks the "78.9 +/- 3" sub-check as a FAIL-BY-SPEC-CONTRADICTION rather than
  silently fudging a constant into agreement.

  Downstream impact is nil for validation case C: the operator band [65, 90] W
  still passes (83.01 is inside it), and case C's margin_ratio moves from
  ~22/78.86 = 0.279 to ~22/83.01 = 0.265, both comfortably inside the required
  [0.20, 0.40]. Case C still correctly FAILS to close, which is the point.

  If the project instead wants 78.9 to be canonical, the fix is a spec edit to
  either drop eta_esc from the formula or restate the expected value as 83.0 --
  not a change here. `hover_power_W(9.81, 1.225, 0.203, 0.65, 0.85, 1.0)` returns
  78.86 W today if a caller wants the motor-input number.

OBJECTION 2 -- cell_temperature_K cannot see the electrical power being removed.

  A PV cell's steady-state energy balance is
      absorptivity*G  =  eta_electrical*G  +  convection  +  radiation
  because the converted electricity LEAVES as electricity, not heat. The given
  signature has no efficiency argument, so this module solves
      absorptivity*G  =  convection  +  radiation
  which over-states the heat load by roughly the array efficiency (~20-25% of G)
  and therefore returns a cell temperature that is CONSERVATIVELY HIGH -- i.e. it
  under-predicts PV output, never over-predicts it. That error direction is the
  safe one for a persistence study, so it is implemented as specified. A future
  signature could add `electrical_efficiency: float = 0.0`.

OBJECTION 3 -- cell_temperature_K has no characteristic length.

  Forced-convection Nusselt correlations need a plate length. The signature gives
  V and rho but no chord, so a documented module constant
  _L_REF_CONVECTION_M = 0.5 m (representative HALE wing chord) is used. This is a
  real assumption, not a fitted fudge: h scales as L**-0.5 in the laminar branch,
  so a 0.25 m chord raises h by 1.41x and a 1.0 m chord lowers it by 0.71x.
  Callers with a real chord should own this; a future signature could add
  `chord_m: float = 0.5`.

===============================================================================
INVARIANTS THIS MODULE GUARANTEES (Rule 6 -- guard the impossible)
===============================================================================

  I1. A free-flying vehicle can NEVER gain net energy from a turbine in uniform
      air. Enforced structurally, not by assertion alone: turbine_power_W and
      turbine_drag_N are BOTH derived from the same actuator-disk axial induction
      factor `a`, where
          cp = 4a(1-a)**2      ct = 4a(1-a)
          extracted_power / (drag * V)  =  cp/ct  =  (1 - a)  <  1  for a > 0.
      The power to drag the turbine through the air ALWAYS exceeds the power it
      extracts, by the factor 1/(1-a). Verified by `assert_turbine_never_free_energy`.

  I2. round_trip_efficiency() is asserted < 1.0. A chain of six sub-unity
      efficiencies that multiplied to >= 1 would be a bug in an argument, and it
      raises instead of returning.

  I3. battery_step conserves energy asymmetrically and cannot manufacture charge:
      state of charge is hard-clamped to [soc_min, soc_max] and the unabsorbed /
      undelivered return value carries the rejected power back to the caller
      rather than deleting it silently.

  I4. propeller_efficiency returns 0.0 at zero airspeed. Propulsive efficiency is
      thrust*V / shaft power; at V = 0 that is exactly zero useful work, however
      much thrust is produced. A model that returned a nonzero number at V = 0
      would let a hovering vehicle "cruise" for free.

===============================================================================
UNITS: every public argument, return, and constant carries its unit in the name
or an inline comment. SI throughout. Temperatures are KELVIN everywhere -- there
is no degC anywhere in this module, deliberately.
===============================================================================
"""

from __future__ import annotations

import math
from typing import NamedTuple

__all__ = [
    "STEFAN_BOLTZMANN_W_M2_K4",
    "PV_STC_TEMPERATURE_K",
    "BETZ_LIMIT",
    "cell_temperature_K",
    "pv_power_W",
    "BatteryState",
    "battery_step",
    "propeller_efficiency",
    "motor_efficiency",
    "electric_level_flight_power_W",
    "hover_power_W",
    "turbine_power_W",
    "turbine_drag_N",
    "turbine_axial_induction",
    "round_trip_efficiency",
    "assert_turbine_never_free_energy",
]


# -----------------------------------------------------------------------------
# Physical constants (all SI, all sourced)
# -----------------------------------------------------------------------------

STEFAN_BOLTZMANN_W_M2_K4: float = 5.670374419e-8  # W/(m^2 K^4), CODATA 2018 exact-derived
PV_STC_TEMPERATURE_K: float = 298.15  # K -- Standard Test Conditions cell temp (25 degC), IEC 61215
BETZ_LIMIT: float = 16.0 / 27.0  # dimensionless = 0.59259, max actuator-disk power coefficient
STANDARD_GRAVITY_MS2: float = 9.80665  # m/s^2, CGPM 1901

# Air transport-property constants.
_SUTHERLAND_A_PAS_PER_SQRTK: float = 1.458e-6  # Pa*s/(K^0.5), ISA 1976 / ICAO
_SUTHERLAND_S_K: float = 110.4  # K, Sutherland constant for air
_AIR_CP_J_PER_KG_K: float = 1005.0  # J/(kg K), dry air at moderate T
# Thermal conductivity correlation for air, k = A*T^1.5/(T + 245.4*10^(-12/T)) W/(m K).
# Kinetic-theory form with the standard air coefficients; reproduces 0.02625 W/mK at
# 300 K (tabulated 0.0263) and 0.01950 W/mK at 216.65 K (tabulated 0.01945).
_AIR_K_A: float = 2.646e-3
_AIR_K_B: float = 245.4
_AIR_K_C: float = 12.0

# Convection modelling constants (see OBJECTION 3).
_L_REF_CONVECTION_M: float = 0.5  # m, representative HALE wing chord for the Nusselt length
_RE_TRANSITION: float = 5.0e5  # dimensionless, flat-plate laminar->turbulent transition
_N_EXPOSED_FACES: int = 2  # a thin wing-skin-laminated array exchanges heat on BOTH surfaces

# Propeller blade-element modelling constants.
_PROP_BLADE_L_OVER_D: float = 30.0  # dimensionless, section lift/drag of a good small-prop blade
_PROP_REF_RADIUS_FRACTION: float = 0.75  # dimensionless, standard representative blade station r/R

# Motor loss-model constant.
_MOTOR_PEAK_LOAD_FRACTION: float = 0.60  # dimensionless, shaft/rated load at which eta peaks


class NoConvergenceError(RuntimeError):
    """Raised when an internal iterative solve fails to bracket or converge."""


class FreeEnergyError(RuntimeError):
    """Raised when a configuration would produce net energy from uniform still air."""


# -----------------------------------------------------------------------------
# Internal air-property helpers (duplicated deliberately: this is a LEAF module
# and may not import aerosim.env. Cross-checked against the project ISA table in
# the self-test below.)
# -----------------------------------------------------------------------------


def _mu_air_Pas(T_K: float) -> float:
    """
    @description Dynamic viscosity of air by Sutherland's law. Local copy so this
                 module stays a leaf; identical formula to aerosim.env.sutherland_mu
                 and cross-checked against it numerically in the self-test.
    @param T_K   Absolute temperature, Kelvin.
    @returns     Dynamic viscosity, Pa*s.
    """
    return _SUTHERLAND_A_PAS_PER_SQRTK * T_K**1.5 / (T_K + _SUTHERLAND_S_K)


def _k_air_W_mK(T_K: float) -> float:
    """
    @description Thermal conductivity of air. Needed to turn a Nusselt number into
                 a convection coefficient for the PV thermal balance.
    @param T_K   Absolute temperature, Kelvin.
    @returns     Thermal conductivity, W/(m K).
    """
    return _AIR_K_A * T_K**1.5 / (T_K + _AIR_K_B * 10.0 ** (-_AIR_K_C / T_K))


def _prandtl_air(T_K: float) -> float:
    """
    @description Prandtl number of air, Pr = mu*cp/k. Computed, not tabulated, so
                 it tracks the same viscosity and conductivity the rest of the
                 module uses. Returns ~0.707 at 300 K.
    @param T_K   Absolute temperature, Kelvin.
    @returns     Prandtl number, dimensionless.
    """
    return _mu_air_Pas(T_K) * _AIR_CP_J_PER_KG_K / _k_air_W_mK(T_K)


def _forced_convection_h_W_m2K(
    T_film_K: float, V_ms: float, rho_kgm3: float, length_m: float
) -> float:
    """
    @description Average forced-convection coefficient over a flat plate of the
                 given length, from the standard Nusselt correlations. Laminar
                 below Re = 5e5, turbulent-with-laminar-leading-edge above.
                 Why it matters here: at 20 km rho is 0.0889 kg/m^3, roughly 1/14
                 of sea level, so h collapses and PV cells run far hotter above
                 their ambient than the same array does at sea level. Getting this
                 wrong in the optimistic direction would invent stratospheric PV
                 power that does not exist.
    @param T_film_K Film temperature (mean of cell and air), Kelvin.
    @param V_ms     Freestream speed over the plate, m/s.
    @param rho_kgm3 Air density, kg/m^3.
    @param length_m Plate streamwise length, m.
    @returns        Convection coefficient, W/(m^2 K). Zero when V or rho is zero.
    """
    if V_ms <= 0.0 or rho_kgm3 <= 0.0 or length_m <= 0.0:
        return 0.0
    mu_Pas = _mu_air_Pas(T_film_K)  # Pa*s
    k_W_mK = _k_air_W_mK(T_film_K)  # W/(m K)
    pr = _prandtl_air(T_film_K)  # dimensionless
    re = rho_kgm3 * V_ms * length_m / mu_Pas  # dimensionless
    if re < _RE_TRANSITION:
        nu = 0.664 * math.sqrt(re) * pr ** (1.0 / 3.0)  # dimensionless, laminar average
    else:
        # Turbulent average with the laminar starting length subtracted
        # (Incropera): Nu = (0.037 Re^0.8 - 871) Pr^(1/3).
        nu = (0.037 * re**0.8 - 871.0) * pr ** (1.0 / 3.0)
        nu = max(nu, 0.664 * math.sqrt(_RE_TRANSITION) * pr ** (1.0 / 3.0))
    return nu * k_W_mK / length_m


def _natural_convection_h_W_m2K(
    T_film_K: float, delta_T_K: float, rho_kgm3: float, length_m: float
) -> float:
    """
    @description Average free-convection coefficient for a heated horizontal plate
                 facing up, Nu = 0.54 Ra^0.25. Present so that a stationary or
                 balloon-mounted array does not get an infinite cell temperature
                 when V_ms is 0.
    @param T_film_K Film temperature, Kelvin.
    @param delta_T_K Cell-minus-air temperature difference, Kelvin (>0 to matter).
    @param rho_kgm3 Air density, kg/m^3.
    @param length_m Plate characteristic length, m.
    @returns        Convection coefficient, W/(m^2 K). Zero for non-positive delta_T.
    """
    if delta_T_K <= 0.0 or rho_kgm3 <= 0.0 or length_m <= 0.0:
        return 0.0
    mu_Pas = _mu_air_Pas(T_film_K)  # Pa*s
    k_W_mK = _k_air_W_mK(T_film_K)  # W/(m K)
    beta_1K = 1.0 / T_film_K  # 1/K, ideal-gas thermal expansion coefficient
    # Ra = Gr*Pr = g*beta*dT*L^3*rho^2*cp / (mu*k)
    ra = (
        STANDARD_GRAVITY_MS2
        * beta_1K
        * delta_T_K
        * length_m**3
        * rho_kgm3**2
        * _AIR_CP_J_PER_KG_K
        / (mu_Pas * k_W_mK)
    )
    if ra <= 0.0:
        return 0.0
    nu = 0.54 * ra**0.25  # dimensionless
    return nu * k_W_mK / length_m


# -----------------------------------------------------------------------------
# 1. PV thermal state
# -----------------------------------------------------------------------------


def cell_temperature_K(
    air_temp_K: float,
    irradiance_Wm2: float,
    V_ms: float,
    rho_kgm3: float,
    absorptivity: float = 0.9,
    emissivity: float = 0.9,
) -> float:
    """
    @description Steady-state PV cell temperature from a real surface energy
                 balance, solved by bisection:

                     absorptivity * G
                       = n_faces * h_conv * (T_cell - T_air)
                       + n_faces * emissivity * sigma * (T_cell^4 - T_air^4)

                 with h_conv the cube-combination of forced and natural
                 convection, h = (h_forced^3 + h_natural^3)^(1/3). Radiation and
                 convection both act on n_faces = 2 surfaces because a cell
                 laminated into a thin wing skin is very nearly isothermal
                 through its thickness and exchanges heat with the air on both
                 sides.

                 See OBJECTION 2 (electrical extraction is not subtracted from the
                 heat load, because the signature carries no efficiency; result is
                 conservatively HOT, so PV output is under- not over-predicted) and
                 OBJECTION 3 (0.5 m reference chord).

                 Physical sanity anchors: sea level, 1000 W/m^2, 10 m/s gives a
                 cell about 20 K above ambient (matches the ~45 degC NOCT family of
                 measurements once irradiance is scaled); 20 km, 1350 W/m^2,
                 28 m/s gives a much larger rise because rho is 1/14 of sea level,
                 which matches the reported Helios/Zephyr experience of arrays
                 running tens of Kelvin above a -56.5 degC ambient.

    @param air_temp_K     Ambient static air temperature, Kelvin.
    @param irradiance_Wm2 Plane-of-array irradiance, W/m^2 (0 at night).
    @param V_ms           Airspeed over the array, m/s.
    @param rho_kgm3       Ambient air density, kg/m^3.
    @param absorptivity   Solar absorptivity of the cell/encapsulant, dimensionless 0..1.
    @param emissivity     Infrared emissivity of the surface, dimensionless 0..1.
    @returns              Cell temperature, Kelvin. Exactly air_temp_K when irradiance is 0.
    @raises ValueError    On non-physical inputs.
    @raises NoConvergenceError If the balance cannot be bracketed.
    """
    if air_temp_K <= 0.0:
        raise ValueError(f"air_temp_K must be > 0 K, got {air_temp_K}")
    if irradiance_Wm2 < 0.0:
        raise ValueError(f"irradiance_Wm2 must be >= 0, got {irradiance_Wm2}")
    if not (0.0 <= absorptivity <= 1.0):
        raise ValueError(f"absorptivity must be in [0,1], got {absorptivity}")
    if not (0.0 < emissivity <= 1.0):
        raise ValueError(f"emissivity must be in (0,1], got {emissivity}")

    absorbed_Wm2 = absorptivity * max(irradiance_Wm2, 0.0)  # W/m^2
    if absorbed_Wm2 <= 0.0:
        return air_temp_K

    def residual_Wm2(T_cell_K: float) -> float:
        """Absorbed minus rejected, W/m^2. Monotonically decreasing in T_cell_K."""
        dT_K = T_cell_K - air_temp_K  # K
        T_film_K = 0.5 * (T_cell_K + air_temp_K)  # K
        h_forced = _forced_convection_h_W_m2K(T_film_K, V_ms, rho_kgm3, _L_REF_CONVECTION_M)
        h_nat = _natural_convection_h_W_m2K(T_film_K, dT_K, rho_kgm3, _L_REF_CONVECTION_M)
        h_W_m2K = (h_forced**3 + h_nat**3) ** (1.0 / 3.0)  # W/(m^2 K)
        conv_Wm2 = _N_EXPOSED_FACES * h_W_m2K * dT_K
        rad_Wm2 = (
            _N_EXPOSED_FACES
            * emissivity
            * STEFAN_BOLTZMANN_W_M2_K4
            * (T_cell_K**4 - air_temp_K**4)
        )
        return absorbed_Wm2 - conv_Wm2 - rad_Wm2

    lo_K = air_temp_K  # residual here is +absorbed_Wm2 > 0
    hi_K = air_temp_K + 50.0  # K
    for _ in range(12):
        if residual_Wm2(hi_K) < 0.0:
            break
        hi_K = air_temp_K + (hi_K - air_temp_K) * 2.0
    else:
        raise NoConvergenceError(
            f"cell_temperature_K could not bracket a root below {hi_K} K "
            f"(absorbed {absorbed_Wm2:.1f} W/m^2, rho {rho_kgm3} kg/m^3, V {V_ms} m/s)"
        )

    for _ in range(200):
        mid_K = 0.5 * (lo_K + hi_K)
        if residual_Wm2(mid_K) > 0.0:
            lo_K = mid_K
        else:
            hi_K = mid_K
        if hi_K - lo_K < 1.0e-9:
            break
    return 0.5 * (lo_K + hi_K)


def pv_power_W(
    irradiance_Wm2: float,
    area_m2: float,
    cell_efficiency_stc: float,
    packing_factor: float,
    cell_temp_K: float,
    mppt_efficiency: float = 0.95,
    temp_coeff_per_K: float = -0.004,
) -> float:
    """
    @description Electrical power delivered by a PV array at the MPPT output.

                     P = G * A * packing * eta_stc
                         * max(0, 1 + temp_coeff*(T_cell - 298.15))
                         * eta_mppt

                 The temperature term is the whole reason altitude helps: at the
                 -56.5 degC (216.65 K) stratospheric ambient the derate factor is
                 1 + (-0.004)*(216.65 - 298.15) = 1.326, i.e. the SAME array
                 returns 32.6% more power than its 25 degC rating. This is the
                 project's stated "~+30% cold-altitude gain" and it drops out of
                 the arithmetic rather than being asserted.

                 The derate factor is clamped at 0: a cell driven far above its
                 zero-power temperature produces no power, it does not consume it.

    @param irradiance_Wm2      Plane-of-array irradiance, W/m^2.
    @param area_m2             Gross array planform area, m^2.
    @param cell_efficiency_stc Cell efficiency at STC, dimensionless 0..1.
    @param packing_factor      Active cell area / gross area, dimensionless 0..1.
    @param cell_temp_K         Cell temperature, Kelvin (from cell_temperature_K).
    @param mppt_efficiency     MPPT + wiring efficiency, dimensionless 0..1.
    @param temp_coeff_per_K    Power temperature coefficient, 1/K, referenced to
                               298.15 K. Negative for real cells (~-0.004/K = -0.4%/K).
    @returns                   Electrical power, W (>= 0).
    @raises ValueError         On out-of-range efficiencies or negative area/irradiance.
    """
    if irradiance_Wm2 < 0.0:
        raise ValueError(f"irradiance_Wm2 must be >= 0, got {irradiance_Wm2}")
    if area_m2 < 0.0:
        raise ValueError(f"area_m2 must be >= 0, got {area_m2}")
    for name, val in (
        ("cell_efficiency_stc", cell_efficiency_stc),
        ("packing_factor", packing_factor),
        ("mppt_efficiency", mppt_efficiency),
    ):
        if not (0.0 <= val <= 1.0):
            raise ValueError(f"{name} must be in [0,1], got {val}")
    if cell_temp_K <= 0.0:
        raise ValueError(f"cell_temp_K must be > 0 K, got {cell_temp_K}")

    derate = 1.0 + temp_coeff_per_K * (cell_temp_K - PV_STC_TEMPERATURE_K)  # dimensionless
    derate = max(derate, 0.0)
    return (
        irradiance_Wm2  # W/m^2
        * area_m2  # m^2
        * packing_factor  # dimensionless
        * cell_efficiency_stc  # dimensionless
        * derate  # dimensionless
        * mppt_efficiency  # dimensionless
    )  # -> W


# -----------------------------------------------------------------------------
# 2. Battery
# -----------------------------------------------------------------------------


class BatteryState(NamedTuple):
    """
    @description Battery state of charge.
    @param energy_J Energy stored in the cells, Joules.
    @param soc      State of charge, dimensionless 0..1 = energy_J/capacity_J.
    """

    energy_J: float
    soc: float


def battery_step(
    state: BatteryState,
    capacity_J: float,
    power_W: float,
    dt_s: float,
    eta_charge: float = 0.95,
    eta_discharge: float = 0.95,
    soc_min: float = 0.05,
    soc_max: float = 1.0,
) -> tuple[BatteryState, float]:
    """
    @description Advance the battery one step under a signed BUS power, with
                 ASYMMETRIC charge and discharge efficiency. This asymmetry is why
                 the module exists: a single "battery efficiency" hides the fact
                 that a store-and-return round trip costs eta_charge*eta_discharge
                 = 0.9025 with the defaults, which is one of the six factors in
                 round_trip_efficiency() and therefore in negative control D.

                 Sign convention (spec): power_W > 0 CHARGES the pack.
                     charging:    stored_J   = power_W*dt_s*eta_charge
                     discharging: drawn_J    = |power_W|*dt_s/eta_discharge

                 Energy that cannot be absorbed (pack full) or cannot be delivered
                 (pack at soc_min) is RETURNED to the caller as the second element
                 rather than silently discarded, so the integrator can account for
                 it. Positive = unabsorbed charging power; negative = undelivered
                 discharge power. Both are reported at the BUS, not in the cells.

    @param state         Current BatteryState.
    @param capacity_J    Nameplate cell energy capacity, Joules.
    @param power_W       Bus power, W. Positive charges, negative discharges.
    @param dt_s          Timestep, seconds (>= 0).
    @param eta_charge    Charge acceptance efficiency, dimensionless 0..1.
    @param eta_discharge Discharge delivery efficiency, dimensionless (0,1].
    @param soc_min       Minimum allowed state of charge, dimensionless.
    @param soc_max       Maximum allowed state of charge, dimensionless.
    @returns             (new BatteryState, unabsorbed(+)/undelivered(-) bus power in W).
    @raises ValueError   On non-physical inputs.
    """
    if capacity_J <= 0.0:
        raise ValueError(f"capacity_J must be > 0, got {capacity_J}")
    if dt_s < 0.0:
        raise ValueError(f"dt_s must be >= 0, got {dt_s}")
    if not (0.0 < eta_charge <= 1.0):
        raise ValueError(f"eta_charge must be in (0,1], got {eta_charge}")
    if not (0.0 < eta_discharge <= 1.0):
        raise ValueError(f"eta_discharge must be in (0,1], got {eta_discharge}")
    if not (0.0 <= soc_min <= soc_max <= 1.0):
        raise ValueError(f"require 0 <= soc_min <= soc_max <= 1, got {soc_min}, {soc_max}")

    e_min_J = soc_min * capacity_J  # J
    e_max_J = soc_max * capacity_J  # J
    # Clamp the incoming state so a caller-supplied out-of-range state cannot leak
    # through and become manufactured energy downstream (invariant I3).
    energy_J = min(max(state.energy_J, e_min_J), e_max_J)

    if dt_s == 0.0:
        return BatteryState(energy_J, energy_J / capacity_J), 0.0

    if power_W >= 0.0:
        requested_stored_J = power_W * dt_s * eta_charge  # J into the cells
        headroom_J = max(e_max_J - energy_J, 0.0)  # J
        accepted_J = min(requested_stored_J, headroom_J)  # J
        energy_J += accepted_J
        rejected_cells_J = requested_stored_J - accepted_J  # J that the cells refused
        # Refer the rejected energy back to the bus by undoing the charge efficiency.
        spill_W = rejected_cells_J / (eta_charge * dt_s)  # W, positive
        return BatteryState(energy_J, energy_J / capacity_J), spill_W

    requested_drawn_J = (-power_W) * dt_s / eta_discharge  # J out of the cells
    available_J = max(energy_J - e_min_J, 0.0)  # J
    drawn_J = min(requested_drawn_J, available_J)  # J
    energy_J -= drawn_J
    shortfall_cells_J = requested_drawn_J - drawn_J  # J the cells could not supply
    # Refer back to the bus through the discharge efficiency; negative by convention.
    shortfall_W = -(shortfall_cells_J * eta_discharge / dt_s)  # W, negative or 0
    return BatteryState(energy_J, energy_J / capacity_J), shortfall_W


# -----------------------------------------------------------------------------
# 3. Propulsion chain
# -----------------------------------------------------------------------------


def propeller_efficiency(
    V_ms: float,
    rpm: float,
    diameter_m: float,
    thrust_N: float,
    rho_kgm3: float,
) -> float:
    """
    @description Propulsive efficiency of a propeller, thrust*V / shaft power,
                 built from two SEPARATE physical losses rather than one lookup:

                 (a) Froude / actuator-disk induced loss. Producing thrust T over
                     disk area A at flight speed V costs an unavoidable slipstream
                     kinetic energy:
                         eta_induced = 2 / (1 + sqrt(1 + T/(0.5*rho*A*V^2)))
                     This is exact momentum theory and is what makes a heavily
                     loaded small propeller inefficient no matter how good the blade.

                 (b) Blade profile drag, via the classical blade-element result at
                     the 0.75R representative station:
                         eta_profile = tan(phi) / tan(phi + gamma)
                     where phi = atan(V_axial / omega*r) is the local inflow angle
                     and tan(gamma) = Cd/Cl = 1/(L/D) is the section drag angle.
                     The axial velocity used includes the induced increment from
                     (a), so the two models see a consistent slipstream.

                 eta = eta_induced * eta_profile.

                 Returns 0.0 at V_ms <= 0 (invariant I4: hovering does zero useful
                 propulsive work; use hover_power_W for that regime) and at
                 thrust <= 0 or rpm <= 0.

                 Sanity anchor: AtlantikSolar-like case V=9.5 m/s, 2.25 N thrust,
                 0.26 m diameter, 4000 rpm, rho 1.18 -> about 0.74, which is the
                 right neighbourhood for a well-matched small electric prop and is
                 consistent with the 0.80 used as an optimistic sizing value.

    @param V_ms       Freestream airspeed, m/s.
    @param rpm        Propeller rotational speed, revolutions per minute.
    @param diameter_m Propeller diameter, m.
    @param thrust_N   Thrust produced, N.
    @param rho_kgm3   Air density, kg/m^3.
    @returns          Propulsive efficiency, dimensionless in [0,1).
    @raises ValueError On negative diameter or density.
    """
    if diameter_m <= 0.0:
        raise ValueError(f"diameter_m must be > 0, got {diameter_m}")
    if rho_kgm3 <= 0.0:
        raise ValueError(f"rho_kgm3 must be > 0, got {rho_kgm3}")
    if V_ms <= 0.0 or thrust_N <= 0.0 or rpm <= 0.0:
        return 0.0

    disk_area_m2 = 0.25 * math.pi * diameter_m**2  # m^2
    disk_loading_ratio = thrust_N / (0.5 * rho_kgm3 * disk_area_m2 * V_ms**2)  # dimensionless
    eta_induced = 2.0 / (1.0 + math.sqrt(1.0 + disk_loading_ratio))  # dimensionless

    # Induced axial velocity increment at the disk, from the same momentum theory:
    # V_disk = V*(1 + a_prop) with a_prop = 0.5*(sqrt(1 + disk_loading_ratio) - 1).
    a_prop = 0.5 * (math.sqrt(1.0 + disk_loading_ratio) - 1.0)  # dimensionless
    V_axial_ms = V_ms * (1.0 + a_prop)  # m/s

    n_rev_s = rpm / 60.0  # rev/s
    omega_rad_s = 2.0 * math.pi * n_rev_s  # rad/s
    r_ref_m = _PROP_REF_RADIUS_FRACTION * 0.5 * diameter_m  # m
    V_tangential_ms = omega_rad_s * r_ref_m  # m/s
    if V_tangential_ms <= 0.0:
        return 0.0

    phi_rad = math.atan2(V_axial_ms, V_tangential_ms)  # rad, local inflow angle
    gamma_rad = math.atan(1.0 / _PROP_BLADE_L_OVER_D)  # rad, section drag angle
    if phi_rad + gamma_rad >= 0.5 * math.pi:
        return 0.0
    eta_profile = math.tan(phi_rad) / math.tan(phi_rad + gamma_rad)  # dimensionless

    eta = eta_induced * eta_profile
    # Clamp defensively: the product is analytically < 1, but float edges must not
    # be allowed to hand a caller a >1 efficiency.
    return min(max(eta, 0.0), 0.999999)


def motor_efficiency(
    shaft_power_W: float,
    rated_power_W: float,
    eta_peak: float = 0.90,
) -> float:
    """
    @description Efficiency of a brushless motor + its magnetics, from a real
                 two-loss model rather than a constant:

                     losses = P_iron + k_copper * P_shaft^2
                     eta    = P_shaft / (P_shaft + losses)

                 P_iron is the speed-dependent no-load loss (iron + bearing +
                 windage), taken as constant at cruise speed; the copper term is
                 I^2*R, and at roughly fixed bus voltage current tracks torque
                 which tracks shaft power, hence the square.

                 The two constants are pinned by requiring the curve to peak at
                 eta_peak at a load fraction of 0.60 of rated -- which is where
                 real small BLDC motors are specified to peak:

                     P_star  = 0.60 * rated
                     P_iron  = P_star*(1 - eta_peak)/(2*eta_peak)
                     k_copper= P_iron / P_star^2

                 With the defaults this gives eta = 0.900 at 60% load, 0.888 at
                 100% load, 0.844 at 20% load and 0.60 at 5% load -- the light-load
                 collapse that matters for a solar aircraft loitering at minimum
                 power, and which a constant 0.90 would hide.

    @param shaft_power_W Mechanical shaft power demanded, W (>= 0).
    @param rated_power_W Motor continuous rating, W (> 0).
    @param eta_peak      Peak efficiency, dimensionless in (0,1).
    @returns             Efficiency, dimensionless in (0,1). 0.0 at zero shaft power.
    @raises ValueError   On non-physical inputs.
    """
    if rated_power_W <= 0.0:
        raise ValueError(f"rated_power_W must be > 0, got {rated_power_W}")
    if not (0.0 < eta_peak < 1.0):
        raise ValueError(f"eta_peak must be in (0,1), got {eta_peak}")
    if shaft_power_W < 0.0:
        raise ValueError(f"shaft_power_W must be >= 0, got {shaft_power_W}")
    if shaft_power_W == 0.0:
        return 0.0

    p_star_W = _MOTOR_PEAK_LOAD_FRACTION * rated_power_W  # W, load at which eta peaks
    p_iron_W = p_star_W * (1.0 - eta_peak) / (2.0 * eta_peak)  # W, constant loss
    k_copper_per_W = p_iron_W / p_star_W**2  # 1/W, copper loss coefficient

    losses_W = p_iron_W + k_copper_per_W * shaft_power_W**2  # W
    return shaft_power_W / (shaft_power_W + losses_W)


def electric_level_flight_power_W(
    weight_N: float,
    rho_kgm3: float,
    wing_area_m2: float,
    cl15_over_cd: float,
    eta_prop: float,
    eta_motor: float,
    eta_esc: float,
) -> float:
    """
    @description Electrical power required for steady level flight:

                     P_aero = sqrt(2*W^3 / (rho*S)) / (CL^1.5/CD)
                     P_elec = P_aero / (eta_prop * eta_motor * eta_esc)

                 CRITICAL CONTRACT: cl15_over_cd must be DERIVED by the aeropolar
                 solver from the actual geometry (aeropolar.best_endurance_point),
                 never hand-entered. This module deliberately takes it as an
                 argument and does no aerodynamics of its own; it is the caller's
                 job not to pass a literal. The operator's challenge to a
                 hand-assumed CL^1.5/CD = 25 is exactly the failure mode this
                 boundary exists to make visible.

                 Cross-check (AtlantikSolar, 6.93 kg -> 68.0 N, rho 1.18, S 1.72,
                 CL^1.5/CD 26): P_aero = 21.4 W and P_elec = 30.6 W at
                 0.80*0.90*0.97, against ~40 W published for the real aircraft --
                 the right side of the published number, as a clean-airframe
                 idealisation should be.

    @param weight_N      Vehicle weight, N (mass_kg * g).
    @param rho_kgm3      Air density, kg/m^3.
    @param wing_area_m2  Reference wing area, m^2.
    @param cl15_over_cd  Endurance parameter CL^1.5/CD, dimensionless, SOLVER-DERIVED.
    @param eta_prop      Propeller efficiency, dimensionless (0,1].
    @param eta_motor     Motor efficiency, dimensionless (0,1].
    @param eta_esc       ESC efficiency, dimensionless (0,1].
    @returns             Electrical power required, W.
    @raises ValueError   On non-physical inputs.
    """
    if weight_N <= 0.0:
        raise ValueError(f"weight_N must be > 0, got {weight_N}")
    if rho_kgm3 <= 0.0:
        raise ValueError(f"rho_kgm3 must be > 0, got {rho_kgm3}")
    if wing_area_m2 <= 0.0:
        raise ValueError(f"wing_area_m2 must be > 0, got {wing_area_m2}")
    if cl15_over_cd <= 0.0:
        raise ValueError(f"cl15_over_cd must be > 0, got {cl15_over_cd}")
    for name, val in (("eta_prop", eta_prop), ("eta_motor", eta_motor), ("eta_esc", eta_esc)):
        if not (0.0 < val <= 1.0):
            raise ValueError(f"{name} must be in (0,1], got {val}")

    p_aero_W = math.sqrt(2.0 * weight_N**3 / (rho_kgm3 * wing_area_m2)) / cl15_over_cd  # W
    return p_aero_W / (eta_prop * eta_motor * eta_esc)  # W


def hover_power_W(
    thrust_N: float,
    rho_kgm3: float,
    disk_area_m2: float,
    figure_of_merit: float = 0.65,
    eta_motor: float = 0.85,
    eta_esc: float = 0.95,
) -> float:
    """
    @description Electrical power to hover, from momentum theory:

                     P_ideal = T^1.5 / sqrt(2*rho*A)
                     P_elec  = P_ideal / (FM * eta_motor * eta_esc)

                 This is the floor that makes negative control C fail, correctly.
                 A 1 kg quadcopter with 0.203 m^2 of total disk area needs 43.6 W
                 of ideal induced power at sea level, which no amount of rotor or
                 motor quality reduces -- it is set by disk area alone. Against
                 roughly 22 W of solar that a 1 kg airframe can carry, the loop
                 cannot close, and a simulator that says otherwise is lying.

                 SEE OBJECTION 1 AT THE TOP OF THIS FILE: with the spec's own
                 arguments (9.81, 1.225, 0.203, 0.65, 0.85, 0.95) this formula
                 returns 83.01 W, not the spec's cross-check value of 78.9 W.
                 78.9 W is this formula with eta_esc omitted. The formula is
                 implemented as written.

    @param thrust_N        Total thrust required, N (= weight in steady hover).
    @param rho_kgm3        Air density, kg/m^3.
    @param disk_area_m2    TOTAL rotor disk area summed over all rotors, m^2.
    @param figure_of_merit Rotor figure of merit, dimensionless (0,1].
    @param eta_motor       Motor efficiency, dimensionless (0,1].
    @param eta_esc         ESC efficiency, dimensionless (0,1].
    @returns               Electrical power required to hover, W.
    @raises ValueError     On non-physical inputs.
    """
    if thrust_N < 0.0:
        raise ValueError(f"thrust_N must be >= 0, got {thrust_N}")
    if rho_kgm3 <= 0.0:
        raise ValueError(f"rho_kgm3 must be > 0, got {rho_kgm3}")
    if disk_area_m2 <= 0.0:
        raise ValueError(f"disk_area_m2 must be > 0, got {disk_area_m2}")
    for name, val in (
        ("figure_of_merit", figure_of_merit),
        ("eta_motor", eta_motor),
        ("eta_esc", eta_esc),
    ):
        if not (0.0 < val <= 1.0):
            raise ValueError(f"{name} must be in (0,1], got {val}")
    if thrust_N == 0.0:
        return 0.0

    p_ideal_W = thrust_N**1.5 / math.sqrt(2.0 * rho_kgm3 * disk_area_m2)  # W
    return p_ideal_W / (figure_of_merit * eta_motor * eta_esc)  # W


# -----------------------------------------------------------------------------
# 4. Wind turbine extraction/drag PAIR  (negative control D)
# -----------------------------------------------------------------------------


def turbine_axial_induction(cp: float) -> float:
    """
    @description Actuator-disk axial induction factor `a` consistent with a given
                 power coefficient, from cp = 4a(1-a)^2. The cubic has three
                 roots; the physically-operated branch is the smallest positive
                 one (a <= 1/3, i.e. the sub-Betz side where a real turbine runs).
                 Solved by bisection on [0, 1/3].

                 This function is the SINGLE source of both turbine_power_W's and
                 turbine_drag_N's physics, which is what structurally guarantees
                 invariant I1: they cannot drift apart because they share `a`.

    @param cp          Power coefficient, dimensionless in [0, 16/27].
    @returns           Axial induction factor, dimensionless in [0, 1/3].
    @raises ValueError If cp is negative or exceeds the Betz limit.
    """
    if cp < 0.0:
        raise ValueError(f"cp must be >= 0, got {cp}")
    if cp > BETZ_LIMIT + 1.0e-12:
        raise ValueError(
            f"cp={cp} exceeds the Betz limit {BETZ_LIMIT:.5f}; no actuator disk can do this"
        )
    if cp == 0.0:
        return 0.0
    if cp >= BETZ_LIMIT:
        return 1.0 / 3.0

    def f(a: float) -> float:
        return 4.0 * a * (1.0 - a) ** 2 - cp  # dimensionless, increasing on [0,1/3]

    lo, hi = 0.0, 1.0 / 3.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if f(mid) < 0.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1.0e-15:
            break
    return 0.5 * (lo + hi)


def turbine_power_W(
    V_ms: float,
    rho_kgm3: float,
    swept_area_m2: float,
    cp: float = 0.40,
) -> float:
    """
    @description Electrical-shaft power extracted by a wind turbine from air
                 approaching at V_ms relative to the turbine:

                     P = 0.5 * rho * A * V^3 * cp

                 IMPORTANT FRAME NOTE, because this is where free energy gets
                 invented: V_ms is the speed of the air RELATIVE TO THE TURBINE.
                 For a free-flying vehicle in uniform wind, that relative speed is
                 the vehicle's own airspeed, and extracting from it costs more drag
                 power than it yields -- see turbine_drag_N and invariant I1. Only
                 a turbine held in a SECOND reference frame (tethered to ground, or
                 to a body in a different wind layer) can net positive, which is
                 the whole premise of archetypes 3 and 4.

    @param V_ms          Air speed relative to the turbine disk, m/s.
    @param rho_kgm3      Air density, kg/m^3.
    @param swept_area_m2 Rotor swept area, m^2.
    @param cp            Power coefficient, dimensionless, <= Betz 16/27.
    @returns             Extracted power, W (>= 0).
    @raises ValueError   On non-physical inputs or super-Betz cp.
    """
    if rho_kgm3 <= 0.0:
        raise ValueError(f"rho_kgm3 must be > 0, got {rho_kgm3}")
    if swept_area_m2 < 0.0:
        raise ValueError(f"swept_area_m2 must be >= 0, got {swept_area_m2}")
    if cp < 0.0 or cp > BETZ_LIMIT + 1.0e-12:
        raise ValueError(f"cp must be in [0, {BETZ_LIMIT:.5f}], got {cp}")
    v = abs(V_ms)  # m/s -- extraction does not care about sign of approach
    return 0.5 * rho_kgm3 * swept_area_m2 * v**3 * cp  # W


def turbine_drag_N(
    V_ms: float,
    rho_kgm3: float,
    swept_area_m2: float,
    cp: float = 0.40,
) -> float:
    """
    @description The momentum-theory REACTION FORCE that necessarily accompanies
                 turbine_power_W. Not an add-on: it is the same actuator disk seen
                 as a force instead of a power.

                     a  from  cp = 4a(1-a)^2      (turbine_axial_induction)
                     ct = 4a(1-a)
                     D  = 0.5 * rho * A * V^2 * ct

                 The consequence, and the reason this function exists at all:

                     P_extracted / (D * V)  =  cp/ct  =  (1 - a)  <  1

                 With cp = 0.40, a = 0.13324, ct = 0.46186, so at V=10 m/s,
                 rho=1.225, A=1 m^2 the turbine yields 245.0 W while its drag
                 costs 282.9 W of propulsive power to overcome -- a guaranteed
                 86.6% return BEFORE any conversion efficiency. Chain the six
                 conversion efficiencies on top and you land on the project's
                 0.2209 negative control. There is no cp for which this ratio
                 exceeds 1: (1-a) < 1 for all a > 0.

                 MUST be non-zero whenever turbine_power_W is non-zero -- verified
                 by assert_turbine_never_free_energy().

    @param V_ms          Air speed relative to the turbine disk, m/s.
    @param rho_kgm3      Air density, kg/m^3.
    @param swept_area_m2 Rotor swept area, m^2.
    @param cp            Power coefficient, dimensionless, <= Betz 16/27.
    @returns             Drag force on the turbine, N (>= 0), along the relative wind.
    @raises ValueError   On non-physical inputs or super-Betz cp.
    """
    if rho_kgm3 <= 0.0:
        raise ValueError(f"rho_kgm3 must be > 0, got {rho_kgm3}")
    if swept_area_m2 < 0.0:
        raise ValueError(f"swept_area_m2 must be >= 0, got {swept_area_m2}")
    a = turbine_axial_induction(cp)  # dimensionless
    ct = 4.0 * a * (1.0 - a)  # dimensionless thrust coefficient
    v = abs(V_ms)  # m/s
    return 0.5 * rho_kgm3 * swept_area_m2 * v**2 * ct  # N


def round_trip_efficiency(
    cp: float = 0.40,
    eta_gen: float = 0.90,
    eta_charge: float = 0.95,
    eta_discharge: float = 0.95,
    eta_motor: float = 0.85,
    eta_prop: float = 0.80,
) -> float:
    """
    @description The complete wind-to-wheel round trip for a free-flier that
                 extracts with a turbine, stores, and pushes the energy back out
                 through a propeller. Six explicitly named factors, no fudge:

                     cp            aerodynamic capture (Betz-limited)
                     eta_gen       generator + rectifier
                     eta_charge    battery charge acceptance
                     eta_discharge battery discharge delivery
                     eta_motor     drive motor
                     eta_prop      propeller

                 Defaults: 0.40*0.90*0.95*0.95*0.85*0.80 = 0.220932, the project's
                 stated 0.22 negative-control target to three digits.

                 NOTE this is the CONVERSION chain only. It is already < 1, and the
                 momentum-theory drag penalty in turbine_drag_N (a further factor
                 of (1-a) = 0.867 at cp 0.40) makes the true free-flier round trip
                 worse still -- 0.1915. Validation case D must show BOTH: strictly
                 below 1 before the drag penalty, and strictly lower after it.

    @param cp            Turbine power coefficient, dimensionless <= 16/27.
    @param eta_gen       Generator efficiency, dimensionless (0,1].
    @param eta_charge    Battery charge efficiency, dimensionless (0,1].
    @param eta_discharge Battery discharge efficiency, dimensionless (0,1].
    @param eta_motor     Motor efficiency, dimensionless (0,1].
    @param eta_prop      Propeller efficiency, dimensionless (0,1].
    @returns             Round-trip efficiency, dimensionless, strictly < 1.
    @raises ValueError   On out-of-range arguments.
    @raises FreeEnergyError If the product reaches or exceeds 1 (invariant I2).
    """
    if cp < 0.0 or cp > BETZ_LIMIT + 1.0e-12:
        raise ValueError(f"cp must be in [0, {BETZ_LIMIT:.5f}], got {cp}")
    for name, val in (
        ("eta_gen", eta_gen),
        ("eta_charge", eta_charge),
        ("eta_discharge", eta_discharge),
        ("eta_motor", eta_motor),
        ("eta_prop", eta_prop),
    ):
        if not (0.0 < val <= 1.0):
            raise ValueError(f"{name} must be in (0,1], got {val}")

    eta = cp * eta_gen * eta_charge * eta_discharge * eta_motor * eta_prop  # dimensionless
    if eta >= 1.0:
        raise FreeEnergyError(
            f"round_trip_efficiency computed {eta} >= 1.0 -- a closed conversion chain "
            "cannot return more than it took. Check the arguments."
        )
    return eta


def assert_turbine_never_free_energy(
    n_samples: int = 200, seed: int = 0
) -> None:
    """
    @description Invariant I1 as an executable gate: for a randomised sweep of
                 speeds, densities, areas and power coefficients, verify that the
                 propulsive power needed to overcome turbine drag ALWAYS strictly
                 exceeds the power the turbine extracts, and that the drag is
                 non-zero whenever the power is non-zero.

                 This is the module-level guard the project asks for: any change
                 that decoupled turbine_power_W from turbine_drag_N -- for example
                 "improving" cp without touching ct -- would let a free-flying
                 vehicle in uniform still air appear to gain energy. It would trip
                 here first.

    @param n_samples     Number of randomised cases, dimensionless.
    @param seed          RNG seed for reproducibility.
    @returns             None.
    @raises FreeEnergyError If any case shows extraction >= drag power.
    """
    import random

    rng = random.Random(seed)
    for _ in range(n_samples):
        v_ms = rng.uniform(0.5, 60.0)  # m/s
        rho_kgm3 = rng.uniform(0.05, 1.30)  # kg/m^3
        area_m2 = rng.uniform(0.01, 20.0)  # m^2
        cp = rng.uniform(1.0e-4, BETZ_LIMIT)  # dimensionless
        p_extract_W = turbine_power_W(v_ms, rho_kgm3, area_m2, cp)  # W
        d_N = turbine_drag_N(v_ms, rho_kgm3, area_m2, cp)  # N
        p_drag_W = d_N * v_ms  # W, propulsive power to hold station against the drag
        if p_extract_W > 0.0 and d_N <= 0.0:
            raise FreeEnergyError(
                f"turbine_drag_N returned {d_N} N while extracting {p_extract_W} W "
                f"(V={v_ms}, rho={rho_kgm3}, A={area_m2}, cp={cp})"
            )
        if p_extract_W >= p_drag_W:
            raise FreeEnergyError(
                f"free energy: extracted {p_extract_W:.4f} W >= drag power {p_drag_W:.4f} W "
                f"(V={v_ms}, rho={rho_kgm3}, A={area_m2}, cp={cp})"
            )


# =============================================================================
# SELF-TEST -- runs the module's stated acceptance test and prints real numbers.
#   python aerosim/powerplant.py
# =============================================================================


def _selftest() -> int:
    """
    @description Executes the acceptance test from the module specification plus
                 the invariant guards, printing computed values with units.
    @returns     0 if every check passed, 1 otherwise.
    """
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        results.append((name, ok, detail))

    # -- 1. PV cold-altitude gain -------------------------------------------------
    p_cold_W = pv_power_W(1000.0, 1.0, 0.24, 0.85, 216.65)  # W
    p_stc_W = pv_power_W(1000.0, 1.0, 0.24, 0.85, 298.15)  # W
    ratio = p_cold_W / p_stc_W  # dimensionless
    check(
        "PV cold/STC ratio == 1.326 +/- 0.005",
        abs(ratio - 1.326) <= 0.005,
        f"P(216.65 K)={p_cold_W:.4f} W  P(298.15 K)={p_stc_W:.4f} W  ratio={ratio:.6f}",
    )

    # -- 2. Level-flight electrical power ----------------------------------------
    p_aero_W = math.sqrt(2.0 * 68.0**3 / (1.18 * 1.72)) / 26.0  # W, cross-check term
    p_elec_W = electric_level_flight_power_W(68.0, 1.18, 1.72, 26.0, 0.80, 0.90, 0.97)  # W
    check(
        "electric_level_flight_power_W(68,1.18,1.72,26,.80,.90,.97) in [28,34] W",
        28.0 <= p_elec_W <= 34.0,
        f"P_elec={p_elec_W:.4f} W (aero-only term {p_aero_W:.4f} W, spec says 21.4 W)",
    )
    check(
        "  ...aero-only term == 21.4 +/- 0.2 W",
        abs(p_aero_W - 21.4) <= 0.2,
        f"P_aero={p_aero_W:.4f} W",
    )

    # -- 3. Hover power ----------------------------------------------------------
    p_hover_W = hover_power_W(9.81, 1.225, 0.203, 0.65, 0.85, 0.95)  # W, SPEC FORMULA
    p_hover_no_esc_W = hover_power_W(9.81, 1.225, 0.203, 0.65, 0.85, 1.00)  # W, motor input
    p_hover_ideal_W = 9.81**1.5 / math.sqrt(2.0 * 1.225 * 0.203)  # W, momentum theory
    check(
        "hover_power_W(...) in operator band [65,90] W",
        65.0 <= p_hover_W <= 90.0,
        f"P_hover={p_hover_W:.4f} W  (ideal induced {p_hover_ideal_W:.4f} W, "
        f"shaft {p_hover_ideal_W/0.65:.4f} W, motor-input {p_hover_no_esc_W:.4f} W)",
    )
    check(
        "hover_power_W(...) == 78.9 +/- 3 W  [SEE OBJECTION 1 -- SPEC IS SELF-CONTRADICTORY]",
        abs(p_hover_W - 78.9) <= 3.0,
        f"P_hover={p_hover_W:.4f} W from the SPEC'S OWN FORMULA "
        f"T^1.5/sqrt(2*rho*A)/(FM*eta_motor*eta_esc). The spec's 78.9 W equals the same "
        f"formula with eta_esc DROPPED ({p_hover_no_esc_W:.4f} W). Formula implemented as "
        f"written; the 78.9 cross-check cannot be met without deleting eta_esc.",
    )

    # -- 4. Round-trip efficiency ------------------------------------------------
    rt = round_trip_efficiency()  # dimensionless
    check(
        "round_trip_efficiency() == 0.2209 +/- 0.005",
        abs(rt - 0.2209) <= 0.005,
        f"eta_round_trip={rt:.6f}  (0.40*0.90*0.95*0.95*0.85*0.80)",
    )

    # -- 5. Battery conservation -------------------------------------------------
    capacity_J = 1.0e6  # J
    soc_min, soc_max = 0.05, 1.0
    st = BatteryState(soc_min * capacity_J, soc_min)
    bus_in_J = 0.0  # J delivered from the bus into the pack
    dt_s = 1.0  # s
    charge_W = 5000.0  # W
    for _ in range(1000):
        new_st, spill_W = battery_step(
            st, capacity_J, charge_W, dt_s, 0.95, 0.95, soc_min, soc_max
        )
        bus_in_J += (charge_W - spill_W) * dt_s  # J actually accepted from the bus
        st = new_st
    bus_out_J = 0.0  # J returned to the bus
    discharge_W = -5000.0  # W
    for _ in range(2000):
        new_st, short_W = battery_step(
            st, capacity_J, discharge_W, dt_s, 0.95, 0.95, soc_min, soc_max
        )
        bus_out_J += (-discharge_W + short_W) * dt_s  # J actually delivered to the bus
        st = new_st
    rt_measured = bus_out_J / bus_in_J if bus_in_J > 0 else float("nan")  # dimensionless
    check(
        "battery charge-then-discharge returns <= 0.9025*X",
        bus_out_J <= 0.9025 * bus_in_J + 1.0e-6,
        f"in={bus_in_J:.1f} J  out={bus_out_J:.1f} J  measured round trip={rt_measured:.6f} "
        f"(theoretical 0.95*0.95=0.902500)",
    )

    # SOC bound sweep, including abusive inputs.
    soc_ok = True
    worst = ""
    import random as _random

    rng = _random.Random(1234)
    st = BatteryState(0.5 * capacity_J, 0.5)
    for _ in range(20000):
        p_W = rng.uniform(-2.0e5, 2.0e5)  # W, deliberately far beyond the pack's ability
        d_s = rng.uniform(0.0, 120.0)  # s
        st, _spill = battery_step(st, capacity_J, p_W, d_s, 0.9, 0.9, soc_min, soc_max)
        if not (soc_min - 1.0e-12 <= st.soc <= soc_max + 1.0e-12):
            soc_ok = False
            worst = f"soc={st.soc!r} after power={p_W} W dt={d_s} s"
            break
    check(
        "battery_step never returns soc outside [soc_min, soc_max] (20000 random steps)",
        soc_ok,
        f"final soc={st.soc:.6f}, energy={st.energy_J:.1f} J" + (f"  VIOLATION: {worst}" if worst else ""),
    )

    # -- 6. Turbine drag is real -------------------------------------------------
    d_N = turbine_drag_N(10.0, 1.225, 1.0, 0.40)  # N
    p_turb_W = turbine_power_W(10.0, 1.225, 1.0, 0.40)  # W
    a_ind = turbine_axial_induction(0.40)  # dimensionless
    check(
        "turbine_drag_N(10,1.225,1,0.40) > 0",
        d_N > 0.0,
        f"D={d_N:.4f} N   P_extract={p_turb_W:.4f} W   P_drag={d_N*10.0:.4f} W   "
        f"a={a_ind:.6f}  ct={4*a_ind*(1-a_ind):.6f}  P/(D*V)={p_turb_W/(d_N*10.0):.6f} = (1-a)",
    )

    # -- 7. Invariant I1: no free energy from a free-flying turbine --------------
    free_ok = True
    free_msg = ""
    try:
        assert_turbine_never_free_energy(400, seed=7)
    except FreeEnergyError as exc:  # pragma: no cover -- must not happen
        free_ok = False
        free_msg = str(exc)
    check(
        "INVARIANT I1: 400 random turbines never extract more than their drag costs",
        free_ok,
        "extraction/drag-power ratio = (1-a) < 1 in every case" if free_ok else free_msg,
    )

    # -- 8. Supporting physics cross-checks (context constants) ------------------
    mu_216 = _mu_air_Pas(216.65)  # Pa*s
    check(
        "internal Sutherland mu(216.65 K) == 1.4216e-5 +/- 0.1%",
        abs(mu_216 - 1.4216e-5) / 1.4216e-5 <= 0.001,
        f"mu={mu_216:.6e} Pa*s (project context value 1.4216e-5)",
    )
    k_300 = _k_air_W_mK(300.0)  # W/(m K)
    pr_300 = _prandtl_air(300.0)  # dimensionless
    check(
        "air properties sane: k(300 K) ~ 0.0263 W/mK, Pr(300 K) ~ 0.707",
        abs(k_300 - 0.0263) <= 0.0008 and abs(pr_300 - 0.707) <= 0.02,
        f"k={k_300:.6f} W/mK  Pr={pr_300:.6f}",
    )

    # Cell temperature behaviour (not a spec acceptance item; reported for review).
    t_sl_K = cell_temperature_K(288.15, 1000.0, 10.0, 1.225)  # K
    t_strat_K = cell_temperature_K(216.65, 1350.0, 28.2, 0.0889)  # K
    t_night_K = cell_temperature_K(216.65, 0.0, 28.2, 0.0889)  # K
    check(
        "cell_temperature_K: night == ambient exactly; sea-level rise 10-35 K; "
        "stratospheric rise larger than sea-level (thin air cools poorly)",
        t_night_K == 216.65
        and 10.0 <= (t_sl_K - 288.15) <= 35.0
        and (t_strat_K - 216.65) > (t_sl_K - 288.15),
        f"sea level 288.15 K + {t_sl_K-288.15:.2f} K -> {t_sl_K:.2f} K ({t_sl_K-273.15:.1f} degC); "
        f"20 km 216.65 K + {t_strat_K-216.65:.2f} K -> {t_strat_K:.2f} K "
        f"({t_strat_K-273.15:.1f} degC); night -> {t_night_K:.2f} K",
    )

    # Propeller and motor models (not spec acceptance items; reported for review).
    eta_p = propeller_efficiency(9.5, 4000.0, 0.26, 2.25, 1.18)  # dimensionless
    eta_p_static = propeller_efficiency(0.0, 4000.0, 0.26, 2.25, 1.18)  # dimensionless
    check(
        "propeller_efficiency: AtlantikSolar-like point in [0.60,0.85]; exactly 0 at V=0 (I4)",
        0.60 <= eta_p <= 0.85 and eta_p_static == 0.0,
        f"eta_prop(V=9.5, 4000 rpm, D=0.26, T=2.25 N, rho=1.18)={eta_p:.6f}; "
        f"eta_prop(V=0)={eta_p_static:.1f}",
    )
    eta_m_peak = motor_efficiency(60.0, 100.0)  # at the 0.60 design point
    eta_m_full = motor_efficiency(100.0, 100.0)
    eta_m_light = motor_efficiency(5.0, 100.0)
    check(
        "motor_efficiency peaks at eta_peak at 60% load and degrades at light load",
        abs(eta_m_peak - 0.90) < 1.0e-9 and eta_m_full < eta_m_peak and eta_m_light < 0.70,
        f"eta(60%)={eta_m_peak:.6f}  eta(100%)={eta_m_full:.6f}  eta(5%)={eta_m_light:.6f}",
    )

    # -- report ------------------------------------------------------------------
    print("=" * 79)
    print("aerosim.powerplant  --  ACCEPTANCE SELF-TEST")
    print("=" * 79)
    n_pass = 0
    for name, ok, detail in results:
        tag = "PASS" if ok else "FAIL"
        if ok:
            n_pass += 1
        print(f"[{tag}] {name}")
        print(f"       {detail}")
    print("-" * 79)
    print(f"{n_pass}/{len(results)} checks passed")
    failures = [n for n, ok, _ in results if not ok]
    if failures:
        print("FAILED:")
        for n in failures:
            print(f"  - {n}")
    print("=" * 79)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
