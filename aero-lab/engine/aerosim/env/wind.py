# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Wind fields with ANALYTIC vertical
#   |                                           | gradients: uniform, monotone-C1 PCHIP
#   |                                           | shear layers, and a Dryden turbulence
#   |                                           | overlay. Leaf module: no project-internal
#   |                                           | imports.
# -----------------------------------------------------------------------------
"""Wind answer-machine.  Returns a wind VECTOR and its analytic d/dz at any point.

WHY THIS MODULE IS THE RISKIEST ONE IN THE SIMULATOR
----------------------------------------------------
Archetypes 3 (tethered two-body "sky sailboat") and 4 (dynamic soarer) extract
energy from wind SHEAR.  Their entire power budget is a difference of wind
between two altitudes.  That makes the interpolation scheme a physics decision,
not a numerics detail:

* A **step discontinuity** in wind hands a vehicle free kinetic energy every time
  it crosses the step.  The JSBSim recon on this box measured +16,313 ft2/s2 of
  manufactured specific energy from exactly that.  Forbidden here.
* **Linear-segment interpolation** is C0 only: du/dz is a staircase with jumps at
  every node.  The force on a wing is a function of the wind, so the force is
  continuous, but the *shear power* an optimizer sees is discontinuous, and a
  gradient-based optimizer will happily park a design on a node boundary and
  harvest the kink.  Forbidden here.
* **Monotone C1 PCHIP** gives a continuous wind AND a continuous, analytically
  differentiated gradient, and (unlike a natural cubic spline) it will not
  overshoot between nodes and invent a jet that the operator never specified.
  This is what :func:`make_shear_layer_field` uses, and the C1 guard in the
  self-test measures the analytic derivative against a central difference.

THE FREE-ENERGY INVARIANT (module-level, enforced in the self-test)
-------------------------------------------------------------------
A vehicle flying freely in a UNIFORM, STEADY wind field can extract exactly zero
energy: uniform wind is a Galilean frame change and nothing more.  The invariant
this module owns is therefore:

    make_uniform_field(u, v, w).sample(any x, y, z, t) returns
        - the SAME (u, v, w) for every argument, bit-for-bit, and
        - dudz_1s == dvdz_1s == dwdz_1s == 0.0 EXACTLY (not 1e-17)

Downstream, ``integrate.assert_no_free_energy`` relies on that exactness: if the
gradients were merely small instead of zero, a shear-extraction term multiplied
by 1e-17 and integrated over 86,400 s of a slow loop is still a nonzero power,
and the guard would report a lie as a pass.  Do not "improve" the uniform field
by routing it through the interpolator.

UNITS AND FRAME
---------------
World frame is ENU: u = EAST m/s, v = NORTH m/s, w = UP m/s.  Gradients are
d/dz in 1/s, z being GEOMETRIC altitude in metres (positive up).  Positions are
metres, time is seconds.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from typing import NamedTuple, Optional, Protocol, Sequence, runtime_checkable

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.linalg import expm, solve_continuous_lyapunov

__all__ = [
    "WindSample",
    "WindField",
    "make_uniform_field",
    "make_shear_layer_field",
    "make_dryden_turbulence",
    "UniformWindField",
    "ShearLayerWindField",
    "DrydenTurbulenceField",
]


class WindSample(NamedTuple):
    """Wind vector plus its analytic vertical gradient at one point in space-time."""

    u_ms: float       # east component, m/s
    v_ms: float       # north component, m/s
    w_ms: float       # up component, m/s
    dudz_1s: float    # d(u)/dz, 1/s
    dvdz_1s: float    # d(v)/dz, 1/s
    dwdz_1s: float    # d(w)/dz, 1/s


@runtime_checkable
class WindField(Protocol):
    """Anything that can answer 'what is the wind at (x, y, z, t)?'."""

    def sample(self, x_m: float, y_m: float, z_m: float, t_s: float) -> WindSample:
        """@description Wind vector and analytic vertical gradient at a point.
        @param x_m East position, m.
        @param y_m North position, m.
        @param z_m GEOMETRIC altitude above MSL, m (positive up).
        @param t_s Time, s.
        @returns WindSample in ENU with d/dz in 1/s.
        """
        ...


# --------------------------------------------------------------------------- #
# 1. Uniform field                                                             #
# --------------------------------------------------------------------------- #
class UniformWindField:
    """Spatially and temporally constant wind.  The negative-control field.

    @description Every gradient is the literal float 0.0, and the returned vector
        is independent of all four arguments.  This is the field
        ``integrate.assert_no_free_energy`` runs its 100 random trajectories in;
        any nonzero extracted power in this field is a bug in the caller, never
        in the environment.
    """

    __slots__ = ("_u_ms", "_v_ms", "_w_ms")

    def __init__(self, u_ms: float, v_ms: float, w_ms: float) -> None:
        for name, value in (("u_ms", u_ms), ("v_ms", v_ms), ("w_ms", w_ms)):
            if not math.isfinite(value):
                raise ValueError(f"make_uniform_field: {name} must be finite")
        self._u_ms = float(u_ms)   # m/s, east
        self._v_ms = float(v_ms)   # m/s, north
        self._w_ms = float(w_ms)   # m/s, up

    def sample(self, x_m: float, y_m: float, z_m: float, t_s: float) -> WindSample:
        """@description See :class:`WindField`.  Arguments are accepted and ignored
            by construction - that is the whole point of a uniform field.
        @returns WindSample with gradients that are exactly 0.0.
        """
        return WindSample(
            u_ms=self._u_ms,
            v_ms=self._v_ms,
            w_ms=self._w_ms,
            dudz_1s=0.0,
            dvdz_1s=0.0,
            dwdz_1s=0.0,
        )

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (f"UniformWindField(u={self._u_ms} m/s, v={self._v_ms} m/s, "
                f"w={self._w_ms} m/s)")


def make_uniform_field(u_ms: float, v_ms: float, w_ms: float) -> WindField:
    """Build a uniform (zero-gradient) wind field.

    @description The reference field for the no-free-energy guard.
    @param u_ms East wind component, m/s.
    @param v_ms North wind component, m/s.
    @param w_ms Up wind component, m/s.
    @returns A WindField whose gradients are exactly 0.0 everywhere.
    """
    return UniformWindField(u_ms, v_ms, w_ms)


# --------------------------------------------------------------------------- #
# 2. Sheared layer field (monotone C1 PCHIP in z)                              #
# --------------------------------------------------------------------------- #
class ShearLayerWindField:
    """Horizontally uniform, steady wind profile that varies with altitude only.

    @description u(z) and v(z) are monotone piecewise-cubic Hermite (PCHIP)
        interpolants of the supplied nodes; the reported gradients are the
        interpolant's own analytic derivative, not a finite difference of it.
        PCHIP is chosen over a natural cubic because it cannot overshoot: with
        nodes 0, 10, 10 m/s it returns 10 m/s between the last two nodes, where a
        natural cubic would invent a 10.4 m/s jet that no one specified.

        Outside the node range the profile is continued with a C-infinity
        saturating extension that matches the endpoint value AND the endpoint
        slope, then decays to a finite asymptote over ``extrapolation_length_m``:

            u(z > z_N) = u_N + s_N * L * (1 - exp(-(z - z_N)/L))

        so the field stays C1 at the boundary (no free-energy kink) and cannot
        run away to a 500 m/s wind if a trajectory strays above the table.
    """

    __slots__ = ("_z_nodes_m", "_u_pchip", "_v_pchip", "_du_pchip", "_dv_pchip",
                 "_L_m", "_edge", "_breaks", "_u_coef", "_v_coef", "_du_coef",
                 "_dv_coef", "_n_intervals")

    def __init__(
        self,
        nodes_z_m: Sequence[float],
        nodes_u_ms: Sequence[float],
        nodes_v_ms: Sequence[float],
        extrapolation_length_m: Optional[float] = None,
    ) -> None:
        z = np.asarray(nodes_z_m, dtype=float)   # m, geometric altitude
        u = np.asarray(nodes_u_ms, dtype=float)  # m/s, east
        v = np.asarray(nodes_v_ms, dtype=float)  # m/s, north
        if z.ndim != 1 or u.shape != z.shape or v.shape != z.shape:
            raise ValueError(
                "make_shear_layer_field: nodes_z_m, nodes_u_ms and nodes_v_ms must be "
                "1-D sequences of equal length"
            )
        if z.size < 2:
            raise ValueError("make_shear_layer_field: need at least 2 altitude nodes")
        if not np.all(np.diff(z) > 0.0):
            raise ValueError("make_shear_layer_field: nodes_z_m must be strictly increasing")
        if not (np.all(np.isfinite(z)) and np.all(np.isfinite(u)) and np.all(np.isfinite(v))):
            raise ValueError("make_shear_layer_field: node values must be finite")

        self._z_nodes_m = z
        self._u_pchip = PchipInterpolator(z, u, extrapolate=False)
        self._v_pchip = PchipInterpolator(z, v, extrapolate=False)
        self._du_pchip = self._u_pchip.derivative(1)   # 1/s
        self._dv_pchip = self._v_pchip.derivative(1)   # 1/s

        # Pure-Python copies of the piecewise-polynomial coefficients.  scipy's
        # PPoly.__call__ costs ~30 us for a single scalar, essentially all of it
        # array-boxing overhead; the fast loop samples the wind several times per
        # 0.05 s step, so that overhead would dominate the dynamic integrator.
        # Horner evaluation of the SAME coefficients is ~1 us and is verified
        # against scipy in the self-test.
        self._breaks = [float(b) for b in self._u_pchip.x]                 # m
        self._u_coef = [[float(c) for c in row] for row in self._u_pchip.c]
        self._v_coef = [[float(c) for c in row] for row in self._v_pchip.c]
        self._du_coef = [[float(c) for c in row] for row in self._du_pchip.c]
        self._dv_coef = [[float(c) for c in row] for row in self._dv_pchip.c]
        self._n_intervals = len(self._breaks) - 1

        if extrapolation_length_m is None:
            # Default decay length = mean node spacing: the extension "forgets" the
            # endpoint slope over roughly the same scale the table resolves.
            extrapolation_length_m = float((z[-1] - z[0]) / (z.size - 1))
        if not (extrapolation_length_m > 0.0 and math.isfinite(extrapolation_length_m)):
            raise ValueError("make_shear_layer_field: extrapolation_length_m must be > 0")
        self._L_m = float(extrapolation_length_m)

        # Cache the endpoint values and slopes used by the saturating extension.
        self._edge = {
            "z_lo_m": float(z[0]),
            "z_hi_m": float(z[-1]),
            "u_lo_ms": float(self._u_pchip(z[0])),
            "u_hi_ms": float(self._u_pchip(z[-1])),
            "v_lo_ms": float(self._v_pchip(z[0])),
            "v_hi_ms": float(self._v_pchip(z[-1])),
            "dudz_lo_1s": float(self._du_pchip(z[0])),
            "dudz_hi_1s": float(self._du_pchip(z[-1])),
            "dvdz_lo_1s": float(self._dv_pchip(z[0])),
            "dvdz_hi_1s": float(self._dv_pchip(z[-1])),
        }

    def _component(self, z_m: float, which: str) -> tuple[float, float]:
        """@description Evaluate one horizontal component and its d/dz at altitude z.
        @param z_m Geometric altitude, m.
        @param which "u" (east) or "v" (north).
        @returns (value_ms, gradient_1s).
        """
        e = self._edge
        if z_m < e["z_lo_m"]:
            # Below the table: saturating extension, mirrored (dz is negative).
            dz_m = z_m - e["z_lo_m"]                       # m, <= 0
            slope_1s = e[f"d{which}dz_lo_1s"]              # 1/s
            decay = math.exp(dz_m / self._L_m)             # -> 0 as z -> -inf
            value = e[f"{which}_lo_ms"] - slope_1s * self._L_m * (1.0 - decay)
            gradient = slope_1s * decay
            return value, gradient
        if z_m > e["z_hi_m"]:
            dz_m = z_m - e["z_hi_m"]                       # m, >= 0
            slope_1s = e[f"d{which}dz_hi_1s"]              # 1/s
            decay = math.exp(-dz_m / self._L_m)
            value = e[f"{which}_hi_ms"] + slope_1s * self._L_m * (1.0 - decay)
            gradient = slope_1s * decay
            return value, gradient
        # Inside the table: Horner evaluation of the cached PPoly coefficients.
        # scipy's PPoly convention is  S(z) = sum_m c[m, i] * (z - breaks[i])^(k-m)
        # on interval i, so the coefficient rows run highest power first.
        i = bisect_right(self._breaks, z_m) - 1
        if i < 0:
            i = 0
        elif i >= self._n_intervals:
            i = self._n_intervals - 1
        d_m = z_m - self._breaks[i]                                   # m
        val_c = self._u_coef if which == "u" else self._v_coef
        der_c = self._du_coef if which == "u" else self._dv_coef
        value = ((val_c[0][i] * d_m + val_c[1][i]) * d_m + val_c[2][i]) * d_m + val_c[3][i]
        gradient = (der_c[0][i] * d_m + der_c[1][i]) * d_m + der_c[2][i]
        return value, gradient

    def sample(self, x_m: float, y_m: float, z_m: float, t_s: float) -> WindSample:
        """@description See :class:`WindField`.  Horizontally homogeneous and steady,
            so only ``z_m`` is used; x, y and t are accepted for interface parity.
        @returns WindSample; the vertical component and its gradient are exactly 0.0
            because a layered horizontal-wind profile carries no mean updraft.
        """
        if not math.isfinite(z_m):
            raise ValueError("ShearLayerWindField.sample: z_m must be finite")
        u_ms, dudz_1s = self._component(z_m, "u")
        v_ms, dvdz_1s = self._component(z_m, "v")
        return WindSample(
            u_ms=u_ms,
            v_ms=v_ms,
            w_ms=0.0,
            dudz_1s=dudz_1s,
            dvdz_1s=dvdz_1s,
            dwdz_1s=0.0,
        )

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (f"ShearLayerWindField({self._z_nodes_m.size} nodes, "
                f"z {self._z_nodes_m[0]:.0f}..{self._z_nodes_m[-1]:.0f} m, "
                f"L_extrap={self._L_m:.0f} m)")


def make_shear_layer_field(
    nodes_z_m: Sequence[float],
    nodes_u_ms: Sequence[float],
    nodes_v_ms: Sequence[float],
    *,
    extrapolation_length_m: Optional[float] = None,
) -> WindField:
    """Build a monotone-C1 sheared wind profile from altitude nodes.

    @description Monotone PCHIP in z with an analytic derivative.  Explicitly NOT
        linear-segment interpolation: see the module docstring for why a staircase
        gradient is a physics bug for archetypes 3 and 4.
    @param nodes_z_m Strictly increasing geometric altitudes, m.
    @param nodes_u_ms East wind at each node, m/s.
    @param nodes_v_ms North wind at each node, m/s.
    @param extrapolation_length_m Keyword-only, optional.  Decay length, m, of the
        C1 saturating extension used outside the node range.  Defaults to the mean
        node spacing.  Additive to the specified signature; the 3-positional-argument
        call behaves exactly as specified.
    @returns A WindField with C1-continuous u(z), v(z) and analytic du/dz, dv/dz.
    """
    return ShearLayerWindField(
        nodes_z_m, nodes_u_ms, nodes_v_ms, extrapolation_length_m=extrapolation_length_m
    )


# --------------------------------------------------------------------------- #
# 3. Dryden turbulence overlay                                                 #
# --------------------------------------------------------------------------- #
def _dryden_axis_matrices(tau_s: float, sigma_ms: float, order: int) -> tuple[
    np.ndarray, np.ndarray, np.ndarray
]:
    """Continuous-time state-space of one Dryden axis, normalised to exact sigma.

    @description Longitudinal (order 1) shaping filter  H(s) = 1/(1 + tau*s), whose
        output autocorrelation is sigma^2 * exp(-|t|/tau) - i.e. the Dryden
        longitudinal PSD  2*sigma^2*tau/(1 + (omega*tau)^2).
        Lateral/vertical (order 2)  H(s) = (1 + sqrt(3)*tau*s)/(1 + tau*s)^2, the
        Dryden v/w form (MIL-F-8785C).  The output matrix is scaled so the
        stationary output standard deviation is EXACTLY sigma_ms; the scaling is
        computed from the Lyapunov solution rather than a transcribed gain, so it
        cannot drift.
    @param tau_s Correlation time, s (= L / V_reference).
    @param sigma_ms Target RMS turbulence, m/s.
    @param order 1 for the longitudinal axis, 2 for lateral/vertical.
    @returns (A, B, C) with unit-intensity white-noise input; C already scaled.
    """
    if order == 1:
        a = np.array([[-1.0 / tau_s]])
        b = np.array([[1.0]])
        c = np.array([[1.0]])
    elif order == 2:
        a = np.array([[0.0, 1.0], [-1.0 / tau_s**2, -2.0 / tau_s]])
        b = np.array([[0.0], [1.0]])
        c = np.array([[1.0, math.sqrt(3.0) * tau_s]])
    else:  # pragma: no cover - guarded by callers
        raise ValueError("_dryden_axis_matrices: order must be 1 or 2")

    # Stationary state covariance:  A P + P A' + B B' = 0
    p_inf = solve_continuous_lyapunov(a, -(b @ b.T))
    var_out = float((c @ p_inf @ c.T)[0, 0])   # (m/s)^2 with the unscaled C
    if var_out <= 0.0:  # pragma: no cover - numerically impossible for these forms
        raise RuntimeError("_dryden_axis_matrices: non-positive stationary variance")
    c_scaled = c * (sigma_ms / math.sqrt(var_out))
    return a, b, c_scaled


def _van_loan_discretise(a: np.ndarray, b: np.ndarray, dt_s: float) -> tuple[
    np.ndarray, np.ndarray
]:
    """Exact zero-order-hold discretisation of a stochastic LTI system.

    @description Van Loan (1978): for dx = A x dt + B dw with unit-intensity dw,
        the exact discrete propagation is x[n+1] = Ad x[n] + w, w ~ N(0, Qd).
    @param a Continuous state matrix.
    @param b Continuous noise input matrix.
    @param dt_s Time step, s.
    @returns (Ad, Qd).
    """
    n = a.shape[0]
    upper = np.hstack([-a, b @ b.T])
    lower = np.hstack([np.zeros((n, n)), a.T])
    m = expm(np.vstack([upper, lower]) * dt_s)
    a_d = m[n:, n:].T
    q_d = a_d @ m[:n, n:]
    return a_d, 0.5 * (q_d + q_d.T)   # symmetrise against round-off


class DrydenTurbulenceField:
    """A base wind field plus a Dryden-spectrum gust overlay.

    @description Three shaping filters driven by white noise produce a stationary,
        zero-mean gust vector in ENU.  The process is generated on a fixed ``dt_s``
        grid, cached by step index, and linearly interpolated in time between
        grid points, so:

        * repeated ``sample`` calls at the same ``t_s`` return identical values,
        * sampling order does not change the realisation (RK4 sub-steps are safe),
        * the gust vector is CONTINUOUS in t - no step discontinuity, hence no
          free kinetic energy handed to a crossing vehicle.

        LIMITATION, stated rather than hidden: the Dryden model is a TEMPORAL
        spectrum (a spectrum along the flight path), not a resolved 3-D spatial
        field.  It therefore contributes 0.0 to the reported analytic d/dz.  A
        dynamic soarer feeding on gusts must take its energy from the TIME
        variation of the wind in the fast (dt = 0.05 s) loop, which is real and
        present here; it must not expect the turbulence to show up in the shear
        gradient, which would be an invented number.
    """

    __slots__ = ("_base", "_sigma_ms", "_L_m", "_dt_s", "_rng", "_ad", "_chol",
                 "_c", "_states", "_outputs", "_orders", "_tau_s", "_max_steps")

    # Refuse to generate more than this many steps: catches a caller asking for
    # t = 1e9 s at dt = 0.05 s, which would otherwise silently eat all memory.
    _MAX_STEPS_DEFAULT = 20_000_000

    def __init__(
        self,
        base: WindField,
        sigma_ms: tuple[float, float, float],
        L_m: tuple[float, float, float],
        dt_s: float,
        seed: int,
        reference_speed_ms: Optional[float] = None,
    ) -> None:
        if not hasattr(base, "sample"):
            raise TypeError("make_dryden_turbulence: base must implement sample()")
        if len(sigma_ms) != 3 or len(L_m) != 3:
            raise ValueError("make_dryden_turbulence: sigma_ms and L_m must be 3-tuples")
        if not (dt_s > 0.0 and math.isfinite(dt_s)):
            raise ValueError("make_dryden_turbulence: dt_s must be > 0 s")
        if any(s < 0.0 for s in sigma_ms):
            raise ValueError("make_dryden_turbulence: sigma_ms must be >= 0 m/s")
        if any(l <= 0.0 for l in L_m):
            raise ValueError("make_dryden_turbulence: L_m must be > 0 m")

        self._base = base
        self._sigma_ms = tuple(float(s) for s in sigma_ms)   # m/s, (u, v, w)
        self._L_m = tuple(float(l) for l in L_m)             # m, (u, v, w)
        self._dt_s = float(dt_s)                             # s
        self._rng = np.random.default_rng(int(seed))
        self._max_steps = self._MAX_STEPS_DEFAULT

        # Taylor's frozen-turbulence hypothesis converts the SPATIAL scale L into a
        # temporal correlation time tau = L / V.  V is properly the vehicle's
        # airspeed, which a position-only WindField signature cannot see (see the
        # interface objection at the end of this module).  Absent an explicit
        # reference speed we use the base wind magnitude at the origin combined in
        # quadrature with sigma, which reduces to the eddy-turnover time L/sigma in
        # still air (where advection cannot set the timescale) and to L/U in a
        # strong mean wind.  Floored at 1 m/s so tau can never blow up.
        if reference_speed_ms is None:
            b0 = base.sample(0.0, 0.0, 0.0, 0.0)
            u_base_ms = math.sqrt(b0.u_ms**2 + b0.v_ms**2 + b0.w_ms**2)   # m/s
        else:
            u_base_ms = float(reference_speed_ms)
            if not (u_base_ms > 0.0 and math.isfinite(u_base_ms)):
                raise ValueError("make_dryden_turbulence: reference_speed_ms must be > 0")

        self._orders = (1, 2, 2)   # Dryden: longitudinal 1st order, lateral/vertical 2nd
        self._tau_s = []
        self._ad = []
        self._chol = []
        self._c = []
        for axis in range(3):
            v_ref_ms = max(1.0, math.hypot(u_base_ms, self._sigma_ms[axis]))
            tau_s = self._L_m[axis] / v_ref_ms
            self._tau_s.append(tau_s)
            sigma = self._sigma_ms[axis]
            if sigma == 0.0:
                # Degenerate axis: no filter, no noise, exact pass-through.
                self._ad.append(None)
                self._chol.append(None)
                self._c.append(None)
                continue
            a, b, c = _dryden_axis_matrices(tau_s, sigma, self._orders[axis])
            a_d, q_d = _van_loan_discretise(a, b, self._dt_s)
            # Cholesky with a jitter floor: Qd is PSD by construction but can lose
            # positive-definiteness to round-off when dt << tau.
            jitter = 1e-18 * max(1.0, float(np.max(np.abs(q_d))))
            chol = np.linalg.cholesky(q_d + jitter * np.eye(q_d.shape[0]))
            self._ad.append(a_d)
            self._chol.append(chol)
            self._c.append(c)

        # Initial states drawn from the STATIONARY distribution so the realisation
        # is statistically correct from t = 0 with no spin-up transient.
        self._states = []
        for axis in range(3):
            if self._c[axis] is None:
                self._states.append(None)
                continue
            a, b, _ = _dryden_axis_matrices(self._tau_s[axis], self._sigma_ms[axis],
                                            self._orders[axis])
            p_inf = solve_continuous_lyapunov(a, -(b @ b.T))
            p_inf = 0.5 * (p_inf + p_inf.T)
            jitter = 1e-18 * max(1.0, float(np.max(np.abs(p_inf))))
            l0 = np.linalg.cholesky(p_inf + jitter * np.eye(p_inf.shape[0]))
            self._states.append([l0 @ self._rng.standard_normal(p_inf.shape[0])])

        # Cached gust OUTPUT per step index, m/s: [[u0,v0,w0], [u1,v1,w1], ...]
        self._outputs: list[np.ndarray] = [self._output_at_index(0)]

    def _output_at_index(self, n: int) -> np.ndarray:
        """@description Gust vector, m/s, from the currently held state of step n.
        @param n Step index (used only for the degenerate all-zero case).
        @returns ndarray[3] gust in ENU, m/s.
        """
        out = np.zeros(3)
        for axis in range(3):
            if self._c[axis] is None:
                continue
            out[axis] = float((self._c[axis] @ self._states[axis][-1])[0])
        return out

    def _advance_to(self, n: int) -> None:
        """@description Extend the cached gust sequence to at least step index n.
        @param n Target step index (>= 0).
        """
        if n < len(self._outputs):
            return
        if n > self._max_steps:
            raise ValueError(
                f"make_dryden_turbulence: requested step index {n} exceeds the "
                f"{self._max_steps} step generation cap (t = {n * self._dt_s:.3g} s at "
                f"dt = {self._dt_s} s). Rebuild the field with a larger dt_s."
            )
        while len(self._outputs) <= n:
            for axis in range(3):
                if self._c[axis] is None:
                    continue
                x = self._states[axis][-1]
                noise = self._chol[axis] @ self._rng.standard_normal(x.shape[0])
                self._states[axis][-1] = self._ad[axis] @ x + noise
            self._outputs.append(self._output_at_index(len(self._outputs)))

    def gust(self, t_s: float) -> np.ndarray:
        """@description Gust vector at time t, linearly interpolated between the two
            bracketing filter steps (continuous in t: no step discontinuity, so no
            manufactured kinetic energy).
        @param t_s Time, s.  Negative times clamp to the t = 0 sample.
        @returns ndarray[3] gust in ENU, m/s.
        """
        if not math.isfinite(t_s):
            raise ValueError("DrydenTurbulenceField.gust: t_s must be finite")
        if t_s <= 0.0:
            self._advance_to(0)
            return self._outputs[0]
        pos = t_s / self._dt_s
        n = int(math.floor(pos))
        frac = pos - n
        self._advance_to(n + 1)
        lo = self._outputs[n]
        hi = self._outputs[n + 1]
        return lo + (hi - lo) * frac

    def sample(self, x_m: float, y_m: float, z_m: float, t_s: float) -> WindSample:
        """@description See :class:`WindField`.  Base field plus the gust overlay.
        @returns WindSample; d/dz is the BASE field's gradient unchanged, because a
            temporal Dryden spectrum carries no defensible vertical gradient
            (documented limitation, see the class docstring).
        """
        base = self._base.sample(x_m, y_m, z_m, t_s)
        g = self.gust(t_s)
        return WindSample(
            u_ms=base.u_ms + float(g[0]),
            v_ms=base.v_ms + float(g[1]),
            w_ms=base.w_ms + float(g[2]),
            dudz_1s=base.dudz_1s,
            dvdz_1s=base.dvdz_1s,
            dwdz_1s=base.dwdz_1s,
        )

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (f"DrydenTurbulenceField(sigma={self._sigma_ms} m/s, L={self._L_m} m, "
                f"tau={tuple(round(t, 3) for t in self._tau_s)} s, dt={self._dt_s} s)")


def make_dryden_turbulence(
    base: WindField,
    sigma_ms: tuple[float, float, float],
    L_m: tuple[float, float, float],
    dt_s: float,
    seed: int,
    *,
    reference_speed_ms: Optional[float] = None,
) -> WindField:
    """Overlay Dryden-spectrum turbulence on an existing wind field.

    @description Shaping filters on white noise: 1st order longitudinal, 2nd order
        lateral and vertical (MIL-F-8785C forms), exactly discretised by Van Loan
        and started from their stationary distribution.  Deterministic for a given
        seed and sampling-order independent.
    @param base The mean field the gusts ride on.
    @param sigma_ms RMS gust intensity per axis (east, north, up), m/s.  A zero
        entry disables that axis exactly.
    @param L_m Turbulence length scale per axis, m.
    @param dt_s Filter step, s.  Should be well below the smallest L/V correlation
        time; the fast loop's 0.05 s is appropriate.
    @param seed PRNG seed, int.
    @param reference_speed_ms Keyword-only, optional.  Speed, m/s, used for Taylor's
        frozen-turbulence conversion tau = L / V.  Defaults to the base wind
        magnitude at the origin combined in quadrature with sigma.  Additive to the
        specified signature; the 5-positional-argument call behaves as specified.
    @returns A WindField whose mean is ``base`` and whose fluctuation has the
        requested RMS and spectrum.
    """
    return DrydenTurbulenceField(
        base, sigma_ms, L_m, dt_s, seed, reference_speed_ms=reference_speed_ms
    )


# --------------------------------------------------------------------------- #
# Self-test                                                                    #
# --------------------------------------------------------------------------- #
def _selftest() -> int:
    """Run the module acceptance test; print PASS/FAIL with computed values.

    @returns 0 if every check passed, 1 otherwise.
    """
    failures = 0

    def report(name: str, ok: bool, detail: str) -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<52s} {detail}")

    print("=" * 92)
    print("aerosim.env.wind self-test")
    print("=" * 92)

    print("\n-- uniform field: gradients must be EXACTLY zero --")
    uf = make_uniform_field(12.0, -3.0, 0.5)
    rng = np.random.default_rng(12345)
    exact_zero = True
    same_vector = True
    for _ in range(10000):
        x, y = rng.uniform(-1e5, 1e5, 2)
        z = rng.uniform(-4000.0, 46000.0)
        t = rng.uniform(0.0, 1e6)
        s = uf.sample(float(x), float(y), float(z), float(t))
        if not (s.dudz_1s == 0.0 and s.dvdz_1s == 0.0 and s.dwdz_1s == 0.0):
            exact_zero = False
        if not (s.u_ms == 12.0 and s.v_ms == -3.0 and s.w_ms == 0.5):
            same_vector = False
    report("dudz/dvdz/dwdz == 0.0 exactly (10000 samples)", exact_zero,
           "identity comparison, not a tolerance")
    report("wind vector invariant over x, y, z, t", same_vector,
           "bit-for-bit identical across 10000 samples")

    print("\n-- shear layer: C1 guard (analytic d/dz vs central difference) --")
    nodes_z = [0.0, 200.0, 400.0, 700.0, 1200.0]          # m
    nodes_u = [2.0, 6.0, 16.0, 19.0, 20.0]                # m/s east
    nodes_v = [0.0, -1.0, -4.0, -6.5, -7.0]               # m/s north
    sf = make_shear_layer_field(nodes_z, nodes_u, nodes_v)
    h = 1.0e-4                                            # m, central-difference step
    worst_u = 0.0
    worst_v = 0.0
    zs = rng.uniform(nodes_z[0], nodes_z[-1], 10000)
    for z in zs:
        s = sf.sample(0.0, 0.0, float(z), 0.0)
        up = sf.sample(0.0, 0.0, float(z) + h, 0.0)
        dn = sf.sample(0.0, 0.0, float(z) - h, 0.0)
        cd_u = (up.u_ms - dn.u_ms) / (2.0 * h)            # 1/s
        cd_v = (up.v_ms - dn.v_ms) / (2.0 * h)            # 1/s
        worst_u = max(worst_u, abs(cd_u - s.dudz_1s) / max(1.0, abs(s.dudz_1s)))
        worst_v = max(worst_v, abs(cd_v - s.dvdz_1s) / max(1.0, abs(s.dvdz_1s)))
    ok = worst_u < 1e-6 and worst_v < 1e-6
    report("|central diff - analytic| < 1e-6 (10000 z)", ok,
           f"worst u = {worst_u:.3e}, worst v = {worst_v:.3e}")

    print("\n-- shear layer: C1 across the extrapolation seams and value continuity --")
    # Straddle each table edge with +/-eps and compare the SECANT slope to the
    # analytic gradient at the edge.  A jump in value shows up as a secant blowing
    # up like 1/eps; a jump in gradient shows up as a finite secant offset.  Merely
    # measuring |u(+eps) - u(-eps)| would only re-measure the physical shear.
    seam_ok = True
    seam_detail = []
    eps_m = 1e-6
    for z_seam in (nodes_z[0], nodes_z[-1]):
        centre = sf.sample(0.0, 0.0, z_seam, 0.0)
        up = sf.sample(0.0, 0.0, z_seam + eps_m, 0.0)
        dn = sf.sample(0.0, 0.0, z_seam - eps_m, 0.0)
        secant_1s = (up.u_ms - dn.u_ms) / (2.0 * eps_m)                 # 1/s
        grad_jump_1s = abs(up.dudz_1s - dn.dudz_1s)                     # 1/s
        secant_err = abs(secant_1s - centre.dudz_1s)                    # 1/s
        seam_detail.append(
            f"z={z_seam:.0f}m secant-analytic={secant_err:.2e} 1/s, grad jump={grad_jump_1s:.2e} 1/s"
        )
        if secant_err > 1e-6 or grad_jump_1s > 1e-6:
            seam_ok = False
    report("value AND gradient continuous at table edges", seam_ok, "; ".join(seam_detail))
    far_hi = sf.sample(0.0, 0.0, 20000.0, 0.0)
    far_lo = sf.sample(0.0, 0.0, -3000.0, 0.0)
    bounded = abs(far_hi.u_ms) < 100.0 and abs(far_lo.u_ms) < 100.0
    report("extrapolation saturates instead of running away", bounded,
           f"u(20 km) = {far_hi.u_ms:.3f} m/s, u(-3 km) = {far_lo.u_ms:.3f} m/s")

    print("\n-- shear layer: monotone, no invented jets --")
    flat = make_shear_layer_field([0.0, 100.0, 200.0], [0.0, 10.0, 10.0], [0.0, 0.0, 0.0])
    probe = [flat.sample(0.0, 0.0, z, 0.0).u_ms for z in np.linspace(100.0, 200.0, 501)]
    overshoot = max(probe) - 10.0                          # m/s above the node value
    report("PCHIP does not overshoot a flat top segment", overshoot <= 1e-12,
           f"max overshoot = {overshoot:.3e} m/s (a natural cubic gives ~ +0.4 m/s)")

    print("\n-- shear layer: a real 0.05 1/s shear across 200-400 m --")
    # Archetype-3 test bench referenced by the integrate module.
    lin = make_shear_layer_field([0.0, 200.0, 400.0, 600.0],
                                 [5.0, 5.0, 15.0, 15.0],
                                 [0.0, 0.0, 0.0, 0.0])
    mid = lin.sample(0.0, 0.0, 300.0, 0.0)
    du = lin.sample(0.0, 0.0, 400.0, 0.0).u_ms - lin.sample(0.0, 0.0, 200.0, 0.0).u_ms
    report("du/dz reaches 0.05 1/s in the 200-400 m layer",
           abs(mid.dudz_1s - 0.075) < 0.05 and abs(du - 10.0) < 1e-9,
           f"du/dz(300 m) = {mid.dudz_1s:.4f} 1/s, mean = {du / 200.0:.4f} 1/s")

    print("\n-- Horner fast path == scipy PchipInterpolator reference --")
    # The sample() hot path evaluates cached PPoly coefficients directly instead of
    # calling scipy. If those two ever disagree, the "monotone C1 PCHIP" guarantee
    # is being made by code that is not the code actually running.
    zc = np.linspace(nodes_z[0], nodes_z[-1], 50001)
    ref_u = sf._u_pchip(zc)
    ref_du = sf._du_pchip(zc)
    worst_val = 0.0
    worst_grad = 0.0
    for k, zz in enumerate(zc):
        s = sf.sample(0.0, 0.0, float(zz), 0.0)
        worst_val = max(worst_val, abs(s.u_ms - float(ref_u[k])))
        worst_grad = max(worst_grad, abs(s.dudz_1s - float(ref_du[k])))
    report("Horner path matches scipy to < 1e-12",
           worst_val < 1e-12 and worst_grad < 1e-12,
           f"worst |du| = {worst_val:.3e} m/s, worst |d(du/dz)| = {worst_grad:.3e} 1/s "
           f"over {len(zc)} altitudes")

    print("\n-- Dryden turbulence --")
    base = make_uniform_field(15.0, 0.0, 0.0)
    sigma = (1.5, 1.5, 0.9)      # m/s
    lscale = (200.0, 200.0, 60.0)  # m
    dt = 0.05                    # s
    turb = make_dryden_turbulence(base, sigma, lscale, dt, seed=7)
    n_samp = 200000
    series = np.array([turb.gust(i * dt) for i in range(n_samp)])   # m/s
    got_sigma = series.std(axis=0)
    got_mean = series.mean(axis=0)
    sig_err = np.abs(got_sigma - np.array(sigma)) / np.array(sigma)
    report("gust RMS matches requested sigma within 5%", bool(np.all(sig_err < 0.05)),
           f"sigma got = {np.round(got_sigma, 4)} m/s, want = {sigma} m/s")
    report("gust mean is ~zero (< 0.05*sigma)",
           bool(np.all(np.abs(got_mean) < 0.05 * np.array(sigma))),
           f"mean = {np.round(got_mean, 4)} m/s")

    # Autocorrelation time of the longitudinal axis vs the analytic tau = L/V.
    v_ref = math.hypot(15.0, sigma[0])                 # m/s
    tau_expect = lscale[0] / v_ref                     # s
    x0 = series[:, 0] - series[:, 0].mean()
    lag = int(round(tau_expect / dt))
    rho = float(np.dot(x0[:-lag], x0[lag:]) / np.dot(x0, x0))
    report("longitudinal autocorrelation at lag tau ~= 1/e",
           abs(rho - math.exp(-1.0)) < 0.08,
           f"rho(tau={tau_expect:.2f} s) = {rho:.4f}, exp(-1) = {math.exp(-1):.4f}")

    # Determinism and order independence.
    t_probe = [0.0, 3.7, 101.35, 12.5, 999.9, 3.7]
    a_vals = [make_dryden_turbulence(base, sigma, lscale, dt, seed=7).gust(t).copy()
              for t in t_probe]
    shuffled = make_dryden_turbulence(base, sigma, lscale, dt, seed=7)
    b_vals = {}
    for t in sorted(t_probe, reverse=True):
        b_vals[t] = shuffled.gust(t).copy()
    same_field = make_dryden_turbulence(base, sigma, lscale, dt, seed=7)
    c_vals = [same_field.gust(t).copy() for t in t_probe]
    det_ok = all(np.array_equal(c_vals[i], c_vals[j])
                 for i in range(len(t_probe)) for j in range(len(t_probe))
                 if t_probe[i] == t_probe[j])
    reseed_ok = np.array_equal(a_vals[0], c_vals[0])
    order_ok = all(np.allclose(b_vals[t], c_vals[i], rtol=0, atol=0)
                   for i, t in enumerate(t_probe))
    report("same t -> same gust within one field", det_ok, "repeat sample identical")
    report("same seed -> same realisation across fields", reseed_ok,
           f"gust(0) = {np.round(c_vals[0], 6)} m/s")
    report("descending-time sampling gives identical values", order_ok,
           "RK4 sub-step ordering is safe")

    # Continuity in time: no step discontinuity that could hand out free energy.
    # The discriminating test is SCALING, not magnitude.  Over a probe spacing h the
    # largest sample-to-sample change of a continuous (piecewise-linear) signal is
    # proportional to h; a genuine step discontinuity contributes a fixed jump that
    # does not shrink when h shrinks.  So halving-by-ten the probe spacing must
    # divide the observed maximum change by ~10.  This is the test that would have
    # caught the JSBSim +16,313 ft2/s2 wind-step bug.
    def max_change(n_points: int) -> tuple[float, float]:
        ts = np.linspace(10.0, 12.0, n_points)
        vals = np.array([turb.gust(float(t))[0] for t in ts])       # m/s
        return float(np.max(np.abs(np.diff(vals)))), float(ts[1] - ts[0])

    coarse_jump, h_coarse = max_change(8001)      # h = 250 us
    fine_jump, h_fine = max_change(80001)         # h = 25 us
    ratio = coarse_jump / fine_jump if fine_jump > 0 else float("inf")
    report("gust is continuous in t (no wind steps)", 4.0 < ratio < 14.0,
           f"max |dU| = {coarse_jump:.3e} m/s at h={h_coarse * 1e6:.0f} us vs "
           f"{fine_jump:.3e} m/s at h={h_fine * 1e6:.0f} us -> ratio {ratio:.2f} "
           f"(10 = continuous, 1 = step discontinuity)")

    # sigma = 0 must be an exact pass-through of the base field.
    quiet = make_dryden_turbulence(base, (0.0, 0.0, 0.0), lscale, dt, seed=1)
    q = quiet.sample(1.0, 2.0, 300.0, 55.5)
    report("sigma = 0 is an exact base-field pass-through",
           q.u_ms == 15.0 and q.v_ms == 0.0 and q.w_ms == 0.0
           and q.dudz_1s == 0.0 and q.dvdz_1s == 0.0 and q.dwdz_1s == 0.0,
           f"got u={q.u_ms}, v={q.v_ms}, w={q.w_ms}, dudz={q.dudz_1s}")

    print("\n-- Protocol conformance --")
    conform = all(isinstance(f, WindField) for f in (uf, sf, turb))
    report("uniform / shear / dryden all satisfy WindField", conform,
           "runtime_checkable Protocol")

    print("\n-- input validation --")
    rejected = 0
    for bad in (
        lambda: make_shear_layer_field([0.0], [1.0], [0.0]),
        lambda: make_shear_layer_field([100.0, 0.0], [1.0, 2.0], [0.0, 0.0]),
        lambda: make_shear_layer_field([0.0, 100.0], [1.0], [0.0, 0.0]),
        lambda: make_dryden_turbulence(base, (1.0, 1.0, 1.0), (0.0, 1.0, 1.0), dt, 0),
        lambda: make_dryden_turbulence(base, (1.0, 1.0, 1.0), (1.0, 1.0, 1.0), -1.0, 0),
    ):
        try:
            bad()
        except (ValueError, TypeError):
            rejected += 1
    report("malformed field specs rejected", rejected == 5, f"{rejected}/5 raised")

    print("\n" + "=" * 92)
    print(f"wind.py: {'ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED'}")
    print("=" * 92)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
