"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | WingGeometry: the parametric design vector (CST/Kulfan weights + planform) that IS the geometry, plus derived trapezoidal planform quantities.
2 | maintainer@emeraldcoastsystemsgroup.com   | Range-check hardening (round-3 invariant): every scalar and every CST weight must be FINITE. A NaN span passed the old `span_m <= 0` guard (NaN compares False) and would have propagated silently through the whole polar and mass chain.

WHY THIS FILE EXISTS
--------------------
The design vector IS the geometry. There is no CAD model, no lofted surface and
no mesh in the sweep path: a candidate aircraft is 18 CST/Kulfan airfoil weights
plus span/area/taper/sweep/twist, and that is exactly what AeroSandbox and
NeuralFoil consume natively. This module holds that vector and derives the
planform scalars (chords, aspect ratio, MAC, Reynolds reference length) that
aerosurface.py needs to ask aeropolar for a polar.

NOTHING IN THIS FILE PRODUCES LIFT. Lift comes from aeropolar's solver, always.
The single most important invariant in the project is that no Cl, Cd or L/D
number is ever hand-entered, and geometry is deliberately the layer that carries
shape only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Number of CST/Kulfan weights per surface. AeroSandbox's KulfanAirfoil uses 8
#: upper + 8 lower + leading_edge_weight + TE_thickness = the 18-parameter
#: design vector named in the locked architecture.
N_KULFAN_WEIGHTS: int = 8


@dataclass
class WingGeometry:
    """
    @description The parametric design vector for one lifting surface. Planform
        is a straight-tapered trapezoid; section shape is a CST/Kulfan
        parameterisation shared by the whole span (twist varies linearly).
    @param span_m Full tip-to-tip span b, metres.
    @param area_m2 Reference (planform) area S, square metres.
    @param taper_ratio Tip chord / root chord, dimensionless, in (0, 1].
    @param sweep_deg Quarter-chord sweep, degrees, positive aft.
    @param twist_root_deg Geometric twist at the root, degrees, positive nose-up.
    @param twist_tip_deg Geometric twist at the tip, degrees, positive nose-up.
        Washout (root > tip) is the usual sign for stall behaviour.
    @param kulfan_upper Upper-surface CST weights, dimensionless (chord-
        normalised). Shape (8,).
    @param kulfan_lower Lower-surface CST weights, dimensionless. Shape (8,).
    @param leading_edge_weight CST leading-edge modification weight,
        dimensionless.
    @param TE_thickness Trailing-edge thickness, dimensionless (fraction of
        chord).
    """

    span_m: float
    area_m2: float
    taper_ratio: float
    sweep_deg: float
    twist_root_deg: float
    twist_tip_deg: float
    kulfan_upper: np.ndarray
    kulfan_lower: np.ndarray
    leading_edge_weight: float
    TE_thickness: float

    def __post_init__(self) -> None:
        self.span_m = float(self.span_m)
        self.area_m2 = float(self.area_m2)
        self.taper_ratio = float(self.taper_ratio)
        self.sweep_deg = float(self.sweep_deg)
        self.twist_root_deg = float(self.twist_root_deg)
        self.twist_tip_deg = float(self.twist_tip_deg)
        self.kulfan_upper = np.asarray(self.kulfan_upper, dtype=float).reshape(-1)
        self.kulfan_lower = np.asarray(self.kulfan_lower, dtype=float).reshape(-1)
        self.leading_edge_weight = float(self.leading_edge_weight)
        self.TE_thickness = float(self.TE_thickness)

        # FINITENESS FIRST: NaN compares False against every bound, so the
        # magnitude checks below would silently pass a NaN through to the
        # polar solver and the mass model. Non-finite is rejected by name.
        for scalar_name in (
            "span_m", "area_m2", "taper_ratio", "sweep_deg",
            "twist_root_deg", "twist_tip_deg", "leading_edge_weight",
            "TE_thickness",
        ):
            if not np.isfinite(getattr(self, scalar_name)):
                raise ValueError(
                    f"{scalar_name} must be finite, got {getattr(self, scalar_name)!r}"
                )
        if not (np.all(np.isfinite(self.kulfan_upper))
                and np.all(np.isfinite(self.kulfan_lower))):
            raise ValueError("kulfan weights must all be finite")

        if self.span_m <= 0.0:
            raise ValueError(f"span_m must be > 0, got {self.span_m}")
        if self.area_m2 <= 0.0:
            raise ValueError(f"area_m2 must be > 0, got {self.area_m2}")
        if not (0.0 < self.taper_ratio <= 1.0):
            raise ValueError(
                f"taper_ratio must be in (0, 1], got {self.taper_ratio}"
            )

    # -- derived planform scalars -------------------------------------------

    @property
    def aspect_ratio(self) -> float:
        """
        @description Geometric aspect ratio AR = b^2 / S, dimensionless.
            Cross-check from the project context: AtlantikSolar b = 5.65 m,
            S = 1.72 m^2 gives AR = 31.9225 / 1.72 = 18.56, which is the value
            the architecture brief derived independently.
        @returns Aspect ratio, dimensionless.
        """
        return self.span_m ** 2 / self.area_m2

    @property
    def mean_geometric_chord_m(self) -> float:
        """
        @description Mean geometric chord S / b, metres. This is the length scale
            used for the wing's reference Reynolds number.
        @returns Mean geometric chord, m.
        """
        return self.area_m2 / self.span_m

    @property
    def root_chord_m(self) -> float:
        """
        @description Root chord of the equivalent straight-tapered trapezoid, m.
            For a trapezoid S = (b/2)(c_root + c_tip) and c_tip = lambda*c_root,
            hence c_root = 2S / (b (1 + lambda)).
        @returns Root chord, m.
        """
        return 2.0 * self.area_m2 / (self.span_m * (1.0 + self.taper_ratio))

    @property
    def tip_chord_m(self) -> float:
        """
        @description Tip chord, m: c_tip = lambda * c_root.
        @returns Tip chord, m.
        """
        return self.taper_ratio * self.root_chord_m

    @property
    def mean_aerodynamic_chord_m(self) -> float:
        """
        @description Mean aerodynamic chord of a straight-tapered trapezoid, m:
            MAC = (2/3) c_root (1 + lambda + lambda^2) / (1 + lambda).
            Standard result, e.g. Raymer, "Aircraft Design: A Conceptual
            Approach", eq. for trapezoidal MAC.
        @returns Mean aerodynamic chord, m.
        """
        lam = self.taper_ratio
        return (2.0 / 3.0) * self.root_chord_m * (1.0 + lam + lam ** 2) / (1.0 + lam)

    @property
    def mean_twist_deg(self) -> float:
        """
        @description Area-weighted mean of a linear twist distribution over a
            trapezoid, degrees. For twist linear in the spanwise coordinate eta
            and chord c(eta) = c_root(1 - (1-lambda) eta), the area-weighted mean
            works out to
                twist_root + (twist_tip - twist_root) * (1 + 2*lambda)
                                                        / (3 * (1 + lambda)).
            Used as the incidence offset between the wing's reference incidence
            and the section angle of attack the polar is evaluated at.
        @returns Area-weighted mean twist, degrees.
        """
        lam = self.taper_ratio
        weight = (1.0 + 2.0 * lam) / (3.0 * (1.0 + lam))  # dimensionless 0..1
        return self.twist_root_deg + (self.twist_tip_deg - self.twist_root_deg) * weight

    def reference_chord_m(self) -> float:
        """
        @description The chord used for the wing's reference Reynolds number, m.
            Mean AERODYNAMIC chord is the conventional choice and is what the
            architecture's Zephyr cross-check uses (25 m span, ~20.8 m^2 gives
            ~0.83 m, and 0.0889*28.2*0.83/1.4216e-5 = 146k, matching the stated
            Re 146k).
        @returns Reference chord, m.
        """
        return self.mean_aerodynamic_chord_m

    def describe(self) -> dict:
        """
        @description Human-readable summary of the derived planform, for reports
            and self-test output.
        @returns Dict of derived scalars with units in the key names.
        """
        return {
            "span_m": self.span_m,
            "area_m2": self.area_m2,
            "aspect_ratio": self.aspect_ratio,
            "root_chord_m": self.root_chord_m,
            "tip_chord_m": self.tip_chord_m,
            "mean_aerodynamic_chord_m": self.mean_aerodynamic_chord_m,
            "mean_geometric_chord_m": self.mean_geometric_chord_m,
            "mean_twist_deg": self.mean_twist_deg,
            "taper_ratio": self.taper_ratio,
            "sweep_deg": self.sweep_deg,
        }


def naca4_geometry(
    code: str,
    span_m: float,
    area_m2: float,
    taper_ratio: float = 1.0,
    sweep_deg: float = 0.0,
    twist_root_deg: float = 0.0,
    twist_tip_deg: float = 0.0,
) -> WingGeometry:
    """
    @description Convenience constructor: build a WingGeometry whose section is a
        NACA 4-digit airfoil, by asking aeropolar for the CST weights. The
        weights are NOT computed here -- aeropolar.naca_kulfan owns the
        parameterisation, and this function only assembles the planform around
        them, so there is exactly one source of airfoil truth in the system.
    @param code NACA 4-digit code, e.g. "2412".
    @param span_m Span, m.
    @param area_m2 Reference area, m^2.
    @param taper_ratio Tip/root chord ratio, dimensionless.
    @param sweep_deg Quarter-chord sweep, degrees.
    @param twist_root_deg Root twist, degrees.
    @param twist_tip_deg Tip twist, degrees.
    @returns A populated WingGeometry.
    """
    from ..aeropolar import naca_kulfan  # local import: keeps geometry a leaf

    upper_w, lower_w, le_weight, te_thickness = naca_kulfan(code)
    return WingGeometry(
        span_m=span_m,
        area_m2=area_m2,
        taper_ratio=taper_ratio,
        sweep_deg=sweep_deg,
        twist_root_deg=twist_root_deg,
        twist_tip_deg=twist_tip_deg,
        kulfan_upper=np.asarray(upper_w, dtype=float),
        kulfan_lower=np.asarray(lower_w, dtype=float),
        leading_edge_weight=float(le_weight),
        TE_thickness=float(te_thickness),
    )
