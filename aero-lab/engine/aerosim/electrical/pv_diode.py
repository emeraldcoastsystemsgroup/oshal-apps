"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | SunPower C60 5-parameter
    single-diode model (SPEC_electrical section 1): bin table from the C60
    datasheet, 4-unknown parameter extraction at fixed ideality, Jain-Kapoor
    Lambert-W explicit solution with a damped-Newton fallback, De Soto 2006
    irradiance/temperature scaling, and a golden-section MPP search. Every
    constant carries its citation; the one uncited constant (alpha_Isc) is in
    the HONESTY ledger, flagged, per the project rules.

WHAT THIS MODULE IS
-------------------
The REAL photovoltaic cell for the electrical chain: the standard 5-parameter
single-diode equivalent circuit

    I = IL - I0*[exp((V + I*Rs)/a) - 1] - (V + I*Rs)/Rsh          (De Soto 2006)

parameterized for the SunPower C60 Maxeon cell from its own datasheet bins and
solved fast enough to sit inside a mission loop. It replaces nothing: the flat
model (powerplant.pv_power_W) stays as the explicit ideal class; this module is
what PVArrayDiode (aerosim/vehicle/pv_real.py) runs by default.

UNITS: volts, amps, ohms, W/m^2, kelvin. Every name says its unit.

HONESTY LEDGER (module level)
-----------------------------
H-1  ALPHA_ISC_FRAC_PER_K = +0.05 %/degC: the C60 datasheet publishes only
     dVoc/dT (-1.8 mV/degC) and dPmpp/dT (-0.32 %/degC), not dIsc/dT. +0.05
     %/degC is the typical crystalline-silicon value (De Soto 2006 reference
     cell data; consistent with the C60's own coefficients via dP/dT ~ dV/dT +
     dI/dT). FLAGGED -- replace if a fuller C60 laminated-cell table is
     obtained. Applied as alpha_A_per_K = ALPHA_ISC_FRAC_PER_K * IL_ref (IL_ref
     approximates Isc_ref to <0.2 % for every bin, so the approximation error
     is second-order on an already-flagged constant).
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import NamedTuple

import numpy as np
from scipy.optimize import fsolve, minimize_scalar
from scipy.special import lambertw

from ..powerplant import NoConvergenceError
from ..vehicle.param_bounds import ParamBoundsError, require_in_range

# --------------------------------------------------------------------------- #
# Physical constants                                                          #
# --------------------------------------------------------------------------- #

#: Boltzmann constant, J/K. CODATA 2018, exact by SI definition.
K_BOLTZMANN_J_PER_K: float = 1.380649e-23

#: Elementary charge, C. CODATA 2018, exact by SI definition.
Q_ELEMENTARY_C: float = 1.602176634e-19

#: Boltzmann constant in eV/K (ratio of the two exact constants above).
K_BOLTZMANN_EV_PER_K: float = K_BOLTZMANN_J_PER_K / Q_ELEMENTARY_C

#: STC reference temperature, K (25 degC). C60 datasheet test condition.
T_REF_K: float = 298.15

#: STC reference irradiance, W/m^2 (AM1.5g). C60 datasheet test condition.
G_REF_WM2: float = 1000.0

#: Silicon band gap at the reference temperature, eV. De Soto, Klein & Beckman,
#: Solar Energy 80 (2006) 78-88, eq. for E_g(T).
EG_REF_EV: float = 1.121

#: Band-gap temperature coefficient, 1/K: E_g(T) = 1.121*[1 - 0.0002677*(T -
#: T_ref)]. De Soto 2006 (silicon).
EG_TCOEFF_PER_K: float = 0.0002677

#: C60 cell area, m^2 -- 153 cm^2 (125 mm x 125 mm back-contact Maxeon cell).
#: SunPower C60 datasheet #001-53920.
C60_CELL_AREA_M2: float = 0.0153

#: dIsc/dT as a FRACTION of Isc per kelvin (+0.05 %/degC). HONESTY LEDGER H-1:
#: not in the C60 datasheet; typical c-Si value (De Soto 2006 reference cells).
ALPHA_ISC_FRAC_PER_K: float = 0.0005

#: Ceiling on irradiance accepted by the scaling equations, W/m^2. The solar
#: constant is 1361 W/m^2 (Kopp & Lean 2011 TIM value); with cloud-edge and
#: albedo enhancement POA can transiently exceed 1-sun but a value past 2000
#: is a units error, not weather.
MAX_IRRADIANCE_WM2: float = 2000.0


class C60BinSpec(NamedTuple):
    """
    @description One row of the C60 datasheet bin table at STC (1000 W/m^2,
        AM1.5g, 25 degC). Source: SunPower C60 datasheet #001-53920 (bins
        G/H/I sheet; mirrors: scribd.com/document/376502418,
        enfsolar.com/pv/cell-datasheet/2442, ResearchGate tbl1_351843963).
    @param pmpp_W Binned maximum power, W (a bin FLOOR, hence the 1 % band in
        the acceptance test while Vmp*Imp is held to 1e-6).
    @param vmp_V Voltage at maximum power, V.
    @param imp_A Current at maximum power, A.
    @param voc_V Open-circuit voltage, V.
    @param isc_A Short-circuit current, A.
    """

    pmpp_W: float
    vmp_V: float
    imp_A: float
    voc_V: float
    isc_A: float


#: The C60 datasheet bin table (see C60BinSpec for the source).
C60_BIN_TABLE: dict[str, C60BinSpec] = {
    "G": C60BinSpec(pmpp_W=3.34, vmp_V=0.574, imp_A=5.83, voc_V=0.682, isc_A=6.24),
    "H": C60BinSpec(pmpp_W=3.38, vmp_V=0.577, imp_A=5.87, voc_V=0.684, isc_A=6.26),
    "I": C60BinSpec(pmpp_W=3.40, vmp_V=0.581, imp_A=5.90, voc_V=0.686, isc_A=6.27),
}


class DiodeParams(NamedTuple):
    """
    @description The five reference parameters of the single-diode model at STC
        (De Soto 2006). FROZEN NAME AND FIELD ORDER (build contract).
    @param IL_ref_A Photocurrent at STC, A.
    @param I0_ref_A Diode saturation current at STC, A.
    @param Rs_ohm Series resistance, ohm (constant over G and T; De Soto).
    @param Rsh_ref_ohm Shunt resistance at STC, ohm.
    @param a_ref_V Modified ideality factor a = n*Ns*k*T/q at STC, V (Ns = 1:
        these are SINGLE-CELL parameters; string_mpp applies the series count).
    """

    IL_ref_A: float
    I0_ref_A: float
    Rs_ohm: float
    Rsh_ref_ohm: float
    a_ref_V: float


class MppPoint(NamedTuple):
    """
    @description A maximum-power-point operating point. FROZEN NAME (contract).
    @param v_V String voltage at MPP, V.
    @param i_A String current at MPP, A.
    @param p_W String power at MPP, W (= v_V * i_A).
    """

    v_V: float
    i_A: float
    p_W: float


def validate_diode_params(p: DiodeParams) -> None:
    """
    @description Range-check a DiodeParams set against the declared bounds of
        SPEC_electrical section 1.6 (the param_bounds pattern applied to a
        non-element parameter object). Called at extraction AND by every public
        entry point, so a mutated live set is caught the same way the round-4
        battery bypass was.
    @param p The reference parameter set.
    @returns None. Raises on violation.
    @raises ParamBoundsError When any parameter is outside its declared range.
    """
    require_in_range("IL_ref_A", p.IL_ref_A, 0.0, 20.0, lo_open=True, unit="A",
                     element="DiodeParams",
                     why="a 153 cm2 cell at 1000 W/m2 cannot source 20 A")
    require_in_range("I0_ref_A", p.I0_ref_A, 1.0e-15, 1.0e-6, lo_open=True,
                     unit="A", element="DiodeParams",
                     why="saturation-current band for c-Si at 25 degC")
    require_in_range("Rs_ohm", p.Rs_ohm, 1.0e-4, 1.0, unit="ohm",
                     element="DiodeParams",
                     why="Rs->0 is a lossless cell; >1 ohm is a broken cell")
    require_in_range("Rsh_ref_ohm", p.Rsh_ref_ohm, 0.5, 1.0e4, unit="ohm",
                     element="DiodeParams",
                     why="a shunt below 0.5 ohm cannot reproduce any C60 bin")
    require_in_range("a_ref_V", p.a_ref_V, 0.0245, 0.052, unit="V",
                     element="DiodeParams",
                     why="a = n*k*T/q at 298.15 K with n in [1, 2]; below 1 "
                         "is a super-ideal diode (free power)")


class _ScaledParams(NamedTuple):
    """
    @description The five parameters after De Soto scaling to operating (G, T).
        Internal: every solver below works on this, never on raw references.
    """

    IL_A: float
    I0_A: float
    Rs_ohm: float
    Rsh_ohm: float
    a_V: float


def desoto_scaled_params(
    p: DiodeParams, g_Wm2: float, t_cell_K: float
) -> _ScaledParams:
    """
    @description De Soto 2006 (eqs. 2-9) reference-to-operating scaling:

            IL(G,T) = (G/G_ref) * [IL_ref + alpha_Isc*(T - T_ref)]
            a(T)    = a_ref * (T/T_ref)
            I0(T)   = I0_ref * (T/T_ref)^3
                      * exp(Eg(T_ref)/(k*T_ref) - Eg(T)/(k*T))
            Eg(T)   = 1.121 eV * [1 - 0.0002677*(T - T_ref)]
            Rsh(G)  = Rsh_ref * (G_ref/G)
            Rs      = const

        alpha_Isc = ALPHA_ISC_FRAC_PER_K * IL_ref (HONESTY ledger H-1).
    @param p Reference parameter set (validated here).
    @param g_Wm2 Plane-of-array irradiance, W/m^2, in (0, 2000].
    @param t_cell_K Cell temperature, K, in [150, 400].
    @returns Scaled parameter set at (G, T).
    @raises ParamBoundsError On out-of-range irradiance or temperature.
    """
    validate_diode_params(p)
    g = require_in_range("g_Wm2", g_Wm2, 0.0, MAX_IRRADIANCE_WM2, lo_open=True,
                         unit="W/m2", element="desoto_scaled_params",
                         why="0 has no operating point (dark cell handled by "
                             "the caller); >2000 W/m2 on Earth is a units "
                             "error, not weather")
    t = require_in_range("t_cell_K", t_cell_K, 150.0, 400.0, unit="K",
                         element="desoto_scaled_params",
                         why="below 150 K / above 400 K no laminated wing "
                             "cell survives; also brackets the De Soto "
                             "validation envelope")

    alpha_A_per_K = ALPHA_ISC_FRAC_PER_K * p.IL_ref_A  # A/K, ledger H-1
    il_A = (g / G_REF_WM2) * (p.IL_ref_A + alpha_A_per_K * (t - T_REF_K))
    a_V = p.a_ref_V * (t / T_REF_K)
    eg_T_eV = EG_REF_EV * (1.0 - EG_TCOEFF_PER_K * (t - T_REF_K))
    i0_A = (
        p.I0_ref_A
        * (t / T_REF_K) ** 3
        * math.exp(
            EG_REF_EV / (K_BOLTZMANN_EV_PER_K * T_REF_K)
            - eg_T_eV / (K_BOLTZMANN_EV_PER_K * t)
        )
    )
    rsh_ohm = p.Rsh_ref_ohm * (G_REF_WM2 / g)
    return _ScaledParams(
        IL_A=il_A, I0_A=i0_A, Rs_ohm=p.Rs_ohm, Rsh_ohm=rsh_ohm, a_V=a_V
    )


# --------------------------------------------------------------------------- #
# Solvers for I(V): Lambert-W closed form, Newton fallback                     #
# --------------------------------------------------------------------------- #

#: Natural-log threshold above which exp(theta_log) would overflow float64
#: (ln(1.79e308) ~ 709.8; margin kept below it). Beyond this the Lambert-W
#: argument is not representable and the Newton path is used instead.
_LAMBERTW_LOG_ARG_MAX: float = 690.0


def _newton_current_A(sp: _ScaledParams, v_V: float) -> float:
    """
    @description Damped Newton on the implicit diode equation

            f(I) = IL - I0*expm1((V + I*Rs)/a) - (V + I*Rs)/Rsh - I = 0

        f is strictly decreasing in I (f' <= -1 everywhere), so the root is
        unique and Newton from I = 0.9*IL converges monotonically after at
        most one overshoot; steps are capped at IL per iteration as damping.
        SPEC_electrical section 1.3 (<= 80 iterations).
    @param sp Scaled parameters at the operating (G, T).
    @param v_V Terminal voltage, V (per cell).
    @returns Terminal current, A.
    @raises NoConvergenceError If 80 iterations do not converge (never seen
        for in-bounds parameters; fail-closed, never silently patched).
    """
    i_A = 0.9 * sp.IL_A
    step_cap_A = max(sp.IL_A, 1.0)
    for _ in range(80):
        x = (v_V + i_A * sp.Rs_ohm) / sp.a_V
        exp_x = math.exp(x)
        f = sp.IL_A - sp.I0_A * (exp_x - 1.0) - (v_V + i_A * sp.Rs_ohm) / sp.Rsh_ohm - i_A
        fp = -sp.I0_A * exp_x * sp.Rs_ohm / sp.a_V - sp.Rs_ohm / sp.Rsh_ohm - 1.0
        step = f / fp
        if abs(step) > step_cap_A:
            step = math.copysign(step_cap_A, step)
        i_next = i_A - step
        # Convergence: |f| < 1e-13 A bounds the current error by the same
        # amount because |f'(I)| >= 1 everywhere (the -I term alone). A
        # tighter step-based test sits BELOW the ~1e-16-A cancellation noise
        # of f near Voc (terms of size IL cancel) and never fires -- measured:
        # G = 200 W/m^2, T = 340 K, V ~ Voc cycled at the noise floor.
        if abs(f) < 1.0e-13 or abs(step) < 5.0e-14 * max(1.0, abs(i_next)):
            return i_next
        i_A = i_next
    raise NoConvergenceError(
        f"single-diode Newton failed to converge at V = {v_V:g} V "
        f"(IL = {sp.IL_A:g} A, a = {sp.a_V:g} V) after 80 iterations"
    )


def _lambertw_current_A(sp: _ScaledParams, v_V: float) -> float:
    """
    @description Jain & Kapoor explicit solution (Sol. Energy Mater. Sol.
        Cells 81 (2004) 269-277):

            I(V) = (Rsh*(IL + I0) - V)/(Rs + Rsh) - (a/Rs)*W(theta)
            theta = (Rs*I0*Rsh)/(a*(Rs+Rsh))
                    * exp(Rsh*(Rs*IL + Rs*I0 + V)/(a*(Rs+Rsh)))

        computed in log space so the overflow guard is exact, with
        scipy.special.lambertw principal branch (real part taken).
    @param sp Scaled parameters at the operating (G, T).
    @param v_V Terminal voltage, V (per cell).
    @returns Terminal current, A.
    @raises OverflowError Internally converted by the caller into the Newton
        fallback when theta exceeds float range (never raises out of here --
        the caller checks the log first).
    """
    rsum = sp.Rs_ohm + sp.Rsh_ohm
    theta_log = (
        math.log(sp.Rs_ohm * sp.I0_A * sp.Rsh_ohm / (sp.a_V * rsum))
        + sp.Rsh_ohm * (sp.Rs_ohm * sp.IL_A + sp.Rs_ohm * sp.I0_A + v_V)
        / (sp.a_V * rsum)
    )
    w = float(np.real(lambertw(math.exp(theta_log))))
    return (sp.Rsh_ohm * (sp.IL_A + sp.I0_A) - v_V) / rsum - (sp.a_V / sp.Rs_ohm) * w


def iv_current_A(
    p: DiodeParams,
    v_V: float,
    g_Wm2: float,
    t_cell_K: float,
    *,
    solver: str = "auto",
) -> float:
    """
    @description Terminal current of ONE C60 cell at voltage v_V under
        (g_Wm2, t_cell_K), single-diode model with De Soto scaling. FROZEN
        NAME (contract). Lambert-W closed form by default; damped Newton when
        the W argument would overflow (or on request, for the agreement test).
    @param p Reference parameter set (STC).
    @param v_V Cell terminal voltage, V. Negative current past Voc is real
        physics (the cell becomes a load) and is returned as computed.
    @param g_Wm2 Plane-of-array irradiance, W/m^2. Values <= 0 (night) return
        exactly 0.0 A: the dark array contributes nothing at the bus and the
        MPPT's own night draw is billed separately (SPEC section 2.2).
    @param t_cell_K Cell temperature, K.
    @param solver 'auto' (Lambert-W with overflow fallback), 'lambertw', or
        'newton'. The two agree to < 1e-12 A (acceptance-tested).
    @returns Terminal current, A.
    @raises ParamBoundsError On out-of-range parameters or an unknown solver.
    """
    if g_Wm2 <= 0.0:
        return 0.0
    sp = desoto_scaled_params(p, g_Wm2, t_cell_K)
    if solver == "newton":
        return _newton_current_A(sp, float(v_V))
    if solver in ("auto", "lambertw"):
        rsum = sp.Rs_ohm + sp.Rsh_ohm
        theta_log = (
            math.log(sp.Rs_ohm * sp.I0_A * sp.Rsh_ohm / (sp.a_V * rsum))
            + sp.Rsh_ohm * (sp.Rs_ohm * sp.IL_A + sp.Rs_ohm * sp.I0_A + float(v_V))
            / (sp.a_V * rsum)
        )
        if theta_log > _LAMBERTW_LOG_ARG_MAX:
            if solver == "lambertw":
                raise ParamBoundsError(
                    f"Lambert-W argument overflows (log theta = {theta_log:.1f}"
                    f" > {_LAMBERTW_LOG_ARG_MAX}); use solver='auto' or "
                    f"'newton' for this pathological Rs*Rsh corner"
                )
            return _newton_current_A(sp, float(v_V))
        return _lambertw_current_A(sp, float(v_V))
    raise ParamBoundsError(
        f"iv_current_A solver must be 'auto'|'lambertw'|'newton', got {solver!r}"
    )


def _voc_cell_V(sp: _ScaledParams) -> float:
    """
    @description Open-circuit voltage of one cell at operating (G, T) by
        bisection on I(V) = 0. Upper bracket a*log1p(IL/I0) is the shunt-free
        Voc, which strictly exceeds the shunted one, so the bracket is proven.
    @param sp Scaled parameters.
    @returns Voc, V.
    """
    v_hi = sp.a_V * math.log1p(sp.IL_A / sp.I0_A)
    v_lo = 0.0
    for _ in range(100):
        v_mid = 0.5 * (v_lo + v_hi)
        if _lambertw_current_A(sp, v_mid) > 0.0:
            v_lo = v_mid
        else:
            v_hi = v_mid
        if v_hi - v_lo < 1.0e-12:
            break
    return 0.5 * (v_lo + v_hi)


def string_mpp(
    p: DiodeParams, n_series: int, g_Wm2: float, t_cell_K: float
) -> MppPoint:
    """
    @description Maximum power point of a series string of n_series identical
        C60 cells at (g_Wm2, t_cell_K). FROZEN NAME (contract). P(V) of the
        single-diode curve is unimodal on [0, Voc] (De Soto 2006), so a
        bounded golden-section search finds the MPP without derivatives; the
        string scales the per-cell voltage by n_series (a = n*Ns*k*T/q).
        Per-cell mismatch and bypass-diode behavior under partial shadowing
        are NOT modeled (string = ideal series; SPEC HONESTY ledger H-6,
        deferred loud).
    @param p Reference parameter set (STC).
    @param n_series Number of series cells, integer >= 1.
    @param g_Wm2 Plane-of-array irradiance, W/m^2. <= 0 (night) returns the
        exact zero point MppPoint(0, 0, 0).
    @param t_cell_K Cell temperature, K.
    @returns MppPoint(v_V, i_A, p_W) at STRING level.
    @raises ParamBoundsError On a non-integer or out-of-range series count.
    """
    if not isinstance(n_series, (int, np.integer)) or isinstance(n_series, bool):
        raise ParamBoundsError(
            f"string_mpp n_series must be an integer cell count, got {n_series!r}"
        )
    require_in_range("n_series", float(n_series), 1.0, 500.0, unit="-",
                     element="string_mpp",
                     why="a 500-cell string at 0.7 V/cell is a 350 V bus; "
                         "beyond it is a units error for this aircraft class")
    if g_Wm2 <= 0.0:
        return MppPoint(v_V=0.0, i_A=0.0, p_W=0.0)

    sp = desoto_scaled_params(p, g_Wm2, t_cell_K)
    voc_V = _voc_cell_V(sp)

    def neg_power_W(v_V: float) -> float:
        return -v_V * _lambertw_current_A(sp, v_V)

    res = minimize_scalar(
        neg_power_W, bounds=(0.0, voc_V), method="bounded",
        options={"xatol": 1.0e-11},
    )
    v_cell_V = float(res.x)
    i_A = _lambertw_current_A(sp, v_cell_V)
    return MppPoint(
        v_V=v_cell_V * n_series, i_A=i_A, p_W=v_cell_V * i_A * n_series
    )


# --------------------------------------------------------------------------- #
# Parameter extraction from the datasheet bin table                           #
# --------------------------------------------------------------------------- #


@lru_cache(maxsize=None)
def extract_c60_params(bin: str = "I", n_ideality: float = 1.0) -> DiodeParams:
    """
    @description Extract the 5 reference parameters from the C60 datasheet bin
        table at a FIXED ideality factor (SPEC_electrical section 1.2): solve
        the 4 unknowns {IL, I0, Rs, Rsh} from the 4 datasheet conditions --
        short circuit, open circuit, the MPP current, and dP/dV = 0 at the MPP
        -- with scipy fsolve on [IL, ln(I0), Rs, Rsh] (I0 in log space keeps
        it positive through the iteration). FROZEN NAME (contract).

        n = 1.00 solves cleanly for the C60 (SPEC section 1.5 pins the bin-I
        result: IL = 6.2746 A, I0 = 1.561e-11 A, Rs = 4.147 mohm, Rsh =
        5.673 ohm) and is the set the implementation ships.
    @param bin Datasheet bin, one of 'G' | 'H' | 'I'.
    @param n_ideality Diode ideality factor, dimensionless, range-checked to
        [1.0, 2.0] (diffusion/recombination physics, De Soto 2006 section 2;
        below 1 is a super-ideal diode, i.e. free power).
    @returns DiodeParams at STC, validated against the section-1.6 bounds and
        re-checked to reproduce the bin's own (Voc, Isc, Vmp, Imp) to 0.5 %.
    @raises ParamBoundsError On an unknown bin, out-of-range ideality, or an
        extracted set that fails its own recheck.
    @raises NoConvergenceError When fsolve does not meet the 1e-9 residual.
    """
    if bin not in C60_BIN_TABLE:
        raise ParamBoundsError(
            f"extract_c60_params bin must be one of "
            f"{sorted(C60_BIN_TABLE)}, got {bin!r}"
        )
    n = require_in_range("n_ideality", n_ideality, 1.0, 2.0, unit="-",
                         element="extract_c60_params",
                         why="diode physics; below 1 is a super-ideal diode "
                             "(free power), above 2 is outside the "
                             "diffusion/recombination band (De Soto 2006)")
    spec = C60_BIN_TABLE[bin]
    a_ref_V = n * K_BOLTZMANN_J_PER_K * T_REF_K / Q_ELEMENTARY_C  # = n*0.025693 V

    isc, voc, vmp, imp = spec.isc_A, spec.voc_V, spec.vmp_V, spec.imp_A

    def residuals(x: np.ndarray) -> list[float]:
        il_A, ln_i0, rs_ohm, rsh_ohm = x
        i0_A = math.exp(ln_i0)
        # (1) short circuit
        r1 = il_A - i0_A * math.expm1(isc * rs_ohm / a_ref_V) \
            - isc * rs_ohm / rsh_ohm - isc
        # (2) open circuit
        r2 = il_A - i0_A * math.expm1(voc / a_ref_V) - voc / rsh_ohm
        # (3) MPP current
        vt = vmp + imp * rs_ohm
        r3 = il_A - i0_A * math.expm1(vt / a_ref_V) - vt / rsh_ohm - imp
        # (4) dP/dV = 0 at MPP: Imp + Vmp*dI/dV = 0, dI/dV = -g/(1 + Rs*g)
        g = (i0_A / a_ref_V) * math.exp(vt / a_ref_V) + 1.0 / rsh_ohm
        r4 = imp - vmp * g / (1.0 + rs_ohm * g)
        return [r1, r2, r3, r4]

    # Initial guess: IL ~ Isc; I0 from the shunt-free open-circuit condition;
    # Rs/Rsh at the SPEC 1.5 order of magnitude.
    x0 = np.array([
        isc,
        math.log(isc / math.expm1(voc / a_ref_V)),
        4.0e-3,
        6.0,
    ])
    x, info, ier, msg = fsolve(residuals, x0, full_output=True, xtol=1.0e-13)
    resid = max(abs(r) for r in residuals(x))
    if ier != 1 or resid > 1.0e-9:
        raise NoConvergenceError(
            f"C60 bin-{bin} extraction failed (ier={ier}, max residual "
            f"{resid:.3e}): {msg}"
        )

    params = DiodeParams(
        IL_ref_A=float(x[0]),
        I0_ref_A=float(math.exp(x[1])),
        Rs_ohm=float(x[2]),
        Rsh_ref_ohm=float(x[3]),
        a_ref_V=a_ref_V,
    )
    validate_diode_params(params)
    _recheck_extraction(params, spec, bin)
    return params


def _recheck_extraction(p: DiodeParams, spec: C60BinSpec, bin: str) -> None:
    """
    @description Cross-param recheck (tech-catalogue pattern): the extracted
        set must reproduce its own claimed (Voc, Isc, Vmp, Imp) to 0.5 % when
        the model is re-solved from scratch at STC -- a mutated live set is
        caught the same way the round-4 battery bypass was.
    @param p Extracted parameters.
    @param spec The datasheet bin row they claim to reproduce.
    @param bin Bin letter, for the error message.
    @returns None. Raises on violation.
    @raises ParamBoundsError When any of the four datasheet quantities is
        reproduced worse than 0.5 %.
    """
    isc_model_A = iv_current_A(p, 0.0, G_REF_WM2, T_REF_K)
    sp = desoto_scaled_params(p, G_REF_WM2, T_REF_K)
    voc_model_V = _voc_cell_V(sp)
    mpp = string_mpp(p, 1, G_REF_WM2, T_REF_K)
    checks = [
        ("Isc", isc_model_A, spec.isc_A, "A"),
        ("Voc", voc_model_V, spec.voc_V, "V"),
        ("Vmp", mpp.v_V, spec.vmp_V, "V"),
        ("Imp", mpp.i_A, spec.imp_A, "A"),
    ]
    for name, model, sheet, unit in checks:
        rel = abs(model - sheet) / abs(sheet)
        if rel > 0.005:
            raise ParamBoundsError(
                f"C60 bin-{bin} extracted set fails its own recheck: {name} = "
                f"{model:.5g} {unit} vs datasheet {sheet:.5g} {unit} "
                f"({100 * rel:.2f} % > 0.5 %) -- a parameter walked"
            )


def c60_stc_efficiency(p: DiodeParams) -> float:
    """
    @description Equivalent STC cell efficiency of a diode parameter set:
        per-cell MPP at (1000 W/m^2, 25 degC) over the 153 cm^2 cell area
        (bin I: 3.428/15.3 = 0.224, matching the datasheet's 22.3 % label).
        Used by PVArrayDiode's cross-param check against the technology
        catalogue (SPEC section 6.2).
    @param p Reference parameter set.
    @returns Dimensionless STC efficiency.
    """
    mpp = string_mpp(p, 1, G_REF_WM2, T_REF_K)
    return mpp.p_W / (C60_CELL_AREA_M2 * G_REF_WM2)


if __name__ == "__main__":  # pragma: no cover
    # Self-test: the acceptance anchors of SPEC_electrical section 1.5, with
    # actual values printed. FOOTPRINT rule: BelowNormal priority.
    import sys

    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )

    failures = 0
    for bin_id, spec in C60_BIN_TABLE.items():
        p = extract_c60_params(bin_id, 1.0)
        mpp = string_mpp(p, 1, G_REF_WM2, T_REF_K)
        vi = spec.vmp_V * spec.imp_A
        err_vi = abs(mpp.p_W - vi) / vi
        err_bin = abs(mpp.p_W - spec.pmpp_W) / spec.pmpp_W
        ok = err_vi < 1.0e-6 and err_bin < 0.01
        failures += 0 if ok else 1
        print(
            f"bin {bin_id}: IL={p.IL_ref_A:.4f} A I0={p.I0_ref_A:.3e} A "
            f"Rs={1e3 * p.Rs_ohm:.3f} mohm Rsh={p.Rsh_ref_ohm:.3f} ohm | "
            f"MPP {mpp.p_W:.4f} W at V={mpp.v_V:.4f} I={mpp.i_A:.4f} | "
            f"err vs Vmp*Imp {100 * err_vi:.2e} % vs Pmpp {100 * err_bin:.3f} % "
            f"{'PASS' if ok else 'FAIL'}"
        )

    # Lambert-W vs Newton agreement across the curve, several (G, T).
    p = extract_c60_params("I", 1.0)
    worst = 0.0
    for g in (200.0, 600.0, 1000.0):
        for t in (250.0, 298.15, 340.0):
            sp = desoto_scaled_params(p, g, t)
            voc = _voc_cell_V(sp)
            for v in np.linspace(0.0, 0.999 * voc, 60):
                di = abs(
                    iv_current_A(p, v, g, t, solver="lambertw")
                    - iv_current_A(p, v, g, t, solver="newton")
                )
                worst = max(worst, di)
    ok = worst < 1.0e-12
    failures += 0 if ok else 1
    print(f"Lambert-W vs Newton max |dI| = {worst:.3e} A "
          f"{'PASS' if ok else 'FAIL'} (< 1e-12 A)")
    print("SELF-TEST", "PASS" if failures == 0 else f"FAIL ({failures})")
    raise SystemExit(0 if failures == 0 else 1)
