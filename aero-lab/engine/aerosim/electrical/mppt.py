"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | MPPT split into TWO separate
    multiplicative losses (SPEC_electrical section 2): eta_track (perturb &
    observe tracking, Femia 2005 / Genasun GV-5) and a Sandia three-term
    converter loss curve (King SAND2007-5036) with the GV-5 published anchors,
    plus the night parasitic draw the chain is billed even when dark. The
    vendor-peak ceiling (99.85 %) is a constructor AND runtime guard.

WHAT THIS MODULE IS
-------------------
    P_bus = P_mpp_available * eta_track * eta_conv(P)

never one flat number. eta_track is what the tracker captures of the MPP the
cell offers (0.98 default; Femia et al., IEEE Trans. Power Electron. 20(4)
2005: optimized P&O ~99 %, naive P&O loses 1-3 %; Genasun GV-5 datasheet:
"99+ % typical"). eta_conv is the power-electronics curve with the standard
fixed + proportional + resistive loss form (King, Boyson, Bower & Kratochvil,
"Performance Model for Grid-Connected Photovoltaic Inverters", SAND2007-5036,
Sandia National Laboratories, 2007):

    P_loss(P_out) = P_fix + k1*P_out + k2*P_out^2
    eta_conv      = P_out / (P_out + P_loss)

P_fix is what kills dawn/dusk light-load efficiency; k1 is the switch/diode
forward-drop term; k2 is I^2R in the inductor and FETs.

The dynamic eta_track penalty under Dryden turbulence (hold the operating
point for 1/f_track between re-solves, GV-5 updates at 15 Hz) is applied by
the MISSION runner, not here -- this module owns the steady losses.

UNITS: watts, volts, amps. Every name says its unit.

HONESTY LEDGER (module level)
-----------------------------
H-2  Converter-loss coefficients: the GV-5 datasheet publishes peak 99.85 %,
     "94-99.85 % typical", ">95 % down to a few watts" and quiescent draws
     (0.150 mA operating / 0.125 mA night) -- a curve shape, not a table. The
     DEFAULTS (P_fix = 0.20 W, k1 = 0.005, k2 set so eta(rated) = 0.97)
     reproduce 97 % at rated and ~94.7 % at 4 W for a 65 W-class unit;
     gv5_converter() ships a fit whose curve meets the three PUBLISHED GV-5
     anchors (>= 95 % at 4 W, peak 99.84 % <= 99.85 %, 2.7 mW night on the
     21.6 V bus). Both sets are FLAGGED digitized-from-datasheet-prose, to be
     replaced when the datasheet curve is digitized point-by-point.
"""

from __future__ import annotations

import math

from ..powerplant import FreeEnergyError
from ..vehicle.param_bounds import Bounds, ParamBoundsError, validate_declared

#: No converter beats its own vendor's published peak: the Genasun GV-5 peak
#: electrical efficiency is 99.85 % (Sunforge LLC GV-5 datasheet, 2021). Any
#: computed eta_conv above this RAISES FreeEnergyError.
MAX_CONVERTER_ETA: float = 0.9985

#: GV-5 night consumption, A, at battery voltage: 0.125 mA (GV-5 datasheet).
#: On the 21.6 V bus that is 2.7 mW, billed every dark step.
GV5_NIGHT_DRAW_A: float = 0.000125

#: Converter efficiency target the default k2 is fitted to at rated power,
#: dimensionless. HONESTY ledger H-2 (reproduces the GV-5 prose anchors for a
#: 65 W-class unit until the datasheet curve is digitized).
DEFAULT_ETA_AT_RATED: float = 0.97


class MPPTConverter:
    """
    @description One MPPT + boost converter channel: tracking efficiency,
        converter loss curve, and the night parasitic. FROZEN NAME AND
        SIGNATURE (build contract). Builders bill night_parasitic_W() as an
        explicit PayloadLoad line -- bus_power_W never returns negative.

        MASS: the converter's own mass is part of the PV module areal density
        (mass.PV_MODULE_WITH_MPPT_KG_M2 = 0.72 kg/m^2, the complete
        AtlantikSolar module) -- it is NOT billed here, and a builder using
        the bare-laminate 0.40 kg/m^2 with a real MPPTConverter must bill the
        converter mass explicitly. Stated loud so it cannot be dropped
        silently.
    """

    #: Declared credible range for every numeric constructor parameter
    #: (vehicle/param_bounds.py pattern).
    PARAM_BOUNDS: dict[str, Bounds] = {
        "p_rated_W": Bounds(0.0, 1.0e5, lo_open=True, unit="W",
                            why="the loss curve is anchored at the rating; a "
                                "100 kW wing MPPT is a units error"),
        # SPEC section 3.1: 2S floor (below it the 50 W class finds no
        # hardware), 12S + 2 ceiling (above it this aircraft class does not
        # exist) -- both hardware-catalogue facts.
        "v_bus_V": Bounds(7.2, 50.8, unit="V",
                          why="2S..12S pack-direct bus band, SPEC_electrical "
                              "3.1 (hardware catalogue, not physics)"),
        # Hi end = Femia 2005 optimized P&O; 1.0 exactly is a free-energy
        # multiplier and is excluded.
        "eta_track": Bounds(0.90, 0.995, unit="-",
                            why="P&O tracking band (Femia 2005; GV-5 99+% "
                                "typical); a 1.0 tracker grants the exact "
                                "MPP for free"),
        "p_fix_W": Bounds(0.01, 5.0, unit="W",
                          why="quiescent/gate-drive floor; 0 is a converter "
                              "with free housekeeping, 5 W is a broken unit "
                              "in this power class"),
        "k1": Bounds(0.0, 0.05, unit="-",
                     why="forward-drop proportional loss term (Sandia "
                         "three-term model); above 5 % the unit is broken"),
        "k2_per_W": Bounds(0.0, 1.0, unit="1/W",
                           why="resistive loss term; negative would be a "
                               "converter whose I2R heats the bus FOR free "
                               "at high power"),
        "night_draw_A": Bounds(0.0, 0.1, unit="A",
                               why="GV-5 publishes 0.125 mA; 100 mA of night "
                                   "draw is a fault model, not a design"),
    }

    def __init__(
        self,
        p_rated_W: float,
        v_bus_V: float = 21.6,
        eta_track: float = 0.98,
        p_fix_W: float = 0.20,
        k1: float = 0.005,
        k2_per_W: float | None = None,
        night_draw_A: float = GV5_NIGHT_DRAW_A,
    ) -> None:
        """
        @description Construct an MPPT channel.
        @param p_rated_W Converter rated output power, W.
        @param v_bus_V Battery-direct bus voltage, V (6S Li-ion 21.6 V nominal
            is the SPEC 3.1 choice).
        @param eta_track Tracking efficiency, dimensionless [0.90, 0.995].
        @param p_fix_W Fixed (quiescent + switching) loss, W.
        @param k1 Proportional loss coefficient, dimensionless.
        @param k2_per_W Resistive loss coefficient, 1/W. None (default)
            computes it so eta_conv(rated) = 0.97 (HONESTY ledger H-2); if the
            fixed + proportional losses already exceed that target at the
            stated rating the computation RAISES rather than shipping a
            negative (free-energy) k2.
        @param night_draw_A Night quiescent current at bus voltage, A.
        @raises ParamBoundsError On any out-of-range parameter, a negative
            derived k2, a curve whose peak exceeds the GV-5 vendor ceiling, or
            eta_conv(rated) < 0.90.
        """
        checked = validate_declared(
            type(self),
            p_rated_W=p_rated_W,
            v_bus_V=v_bus_V,
            eta_track=eta_track,
            p_fix_W=p_fix_W,
            k1=k1,
            night_draw_A=night_draw_A,
        )
        self.p_rated_W = checked["p_rated_W"]
        self.v_bus_V = checked["v_bus_V"]
        self.eta_track = checked["eta_track"]
        self.p_fix_W = checked["p_fix_W"]
        self.k1 = checked["k1"]
        self.night_draw_A = checked["night_draw_A"]

        if k2_per_W is None:
            # eta(rated) = DEFAULT_ETA_AT_RATED at P_out = p_rated:
            #   P_loss(rated) = p_rated*(1 - eta)/eta = p_fix + k1*p_rated
            #                   + k2*p_rated^2
            loss_rated_W = (
                self.p_rated_W * (1.0 - DEFAULT_ETA_AT_RATED) / DEFAULT_ETA_AT_RATED
            )
            k2_per_W = (
                loss_rated_W - self.p_fix_W - self.k1 * self.p_rated_W
            ) / self.p_rated_W**2
            if k2_per_W < 0.0:
                raise ParamBoundsError(
                    f"MPPTConverter default k2 is negative "
                    f"({k2_per_W:.3e} /W): p_fix = {self.p_fix_W:g} W and k1 "
                    f"= {self.k1:g} already lose more at {self.p_rated_W:g} W "
                    f"than the {DEFAULT_ETA_AT_RATED:.0%} rated-efficiency "
                    f"target allows -- a negative k2 is a converter whose "
                    f"I2R pays the bus back. State k2_per_W explicitly with "
                    f"a lower efficiency claim instead."
                )
        self.k2_per_W = validate_declared(type(self), k2_per_W=k2_per_W)["k2_per_W"]
        self.validate_cross_params()

    def validate_cross_params(self) -> None:
        """
        @description Cross-parameter constraints (re-runnable on a live
            instance, round-4 pattern): (a) the curve's PEAK efficiency must
            not exceed the vendor ceiling MAX_CONVERTER_ETA -- for k2 > 0 the
            peak is at P = sqrt(p_fix/k2), eta_peak = 1/(1 + k1 +
            2*sqrt(p_fix*k2)); for k2 = 0 the curve is monotone and the
            asymptote 1/(1 + k1) is the supremum. (b) eta_conv(rated) >= 0.90
            (SPEC 2.2 bound: worse is outside the measured small-converter
            band and means the parameters are mis-stated).
        @returns None. Raises on violation.
        @raises ParamBoundsError On a curve that beats the vendor peak or
            misses the rated-efficiency floor.
        """
        if self.k2_per_W > 0.0:
            eta_sup = 1.0 / (
                1.0 + self.k1 + 2.0 * math.sqrt(self.p_fix_W * self.k2_per_W)
            )
        else:
            eta_sup = 1.0 / (1.0 + self.k1)
        if eta_sup > MAX_CONVERTER_ETA:
            raise ParamBoundsError(
                f"MPPTConverter loss curve peaks at eta = {eta_sup:.5f} > "
                f"{MAX_CONVERTER_ETA} (GV-5 vendor peak, the best published "
                f"in class) -- no converter beats its own vendor's claim"
            )
        eta_rated = self.eta_conv_at_output_W(self.p_rated_W)
        if eta_rated < 0.90:
            raise ParamBoundsError(
                f"MPPTConverter eta_conv(rated {self.p_rated_W:g} W) = "
                f"{eta_rated:.4f} < 0.90: outside the measured small-"
                f"converter band (SPEC 2.2) -- the loss coefficients are "
                f"mis-stated for this rating"
            )

    def eta_conv_at_output_W(self, p_out_W: float) -> float:
        """
        @description Converter efficiency at a given OUTPUT power (diagnostic
            + test hook): eta = P_out/(P_out + P_loss(P_out)).
        @param p_out_W Output power, W, > 0.
        @returns Dimensionless converter efficiency.
        """
        if p_out_W <= 0.0:
            return 0.0
        loss_W = (
            self.p_fix_W + self.k1 * p_out_W + self.k2_per_W * p_out_W**2
        )
        return p_out_W / (p_out_W + loss_W)

    def bus_power_W(self, p_mpp_W: float) -> float:
        """
        @description Bus-side power delivered from an available array MPP:
            apply eta_track, then invert the Sandia loss curve for P_out
            (P_out + P_loss(P_out) = P_in is a quadratic in P_out, solved
            exactly). FROZEN NAME (contract). Below the fixed-loss floor the
            converter delivers exactly 0 -- the dawn/dusk collapse the flat
            model never showed.
        @param p_mpp_W Available maximum-power-point power, W, >= 0.
        @returns Bus-side power, W, >= 0.
        @raises ParamBoundsError On a negative or non-finite input.
        @raises FreeEnergyError When the computed eta_conv exceeds the GV-5
            vendor peak (a walked parameter, not a design).
        """
        if not isinstance(p_mpp_W, (int, float)) or isinstance(p_mpp_W, bool) \
                or not math.isfinite(float(p_mpp_W)) or p_mpp_W < 0.0:
            raise ParamBoundsError(
                f"bus_power_W p_mpp_W must be a finite power >= 0 W, got "
                f"{p_mpp_W!r} -- a negative MPP is a caller sign error"
            )
        p_in_W = float(p_mpp_W) * self.eta_track
        if p_in_W <= self.p_fix_W:
            return 0.0
        if self.k2_per_W > 0.0:
            b = 1.0 + self.k1
            p_out_W = (
                -b + math.sqrt(b * b + 4.0 * self.k2_per_W * (p_in_W - self.p_fix_W))
            ) / (2.0 * self.k2_per_W)
        else:
            p_out_W = (p_in_W - self.p_fix_W) / (1.0 + self.k1)
        eta_conv = p_out_W / p_in_W
        if eta_conv > MAX_CONVERTER_ETA + 1.0e-12:
            raise FreeEnergyError(
                f"MPPTConverter computed eta_conv = {eta_conv:.6f} > "
                f"{MAX_CONVERTER_ETA} (GV-5 vendor peak) at P_in = "
                f"{p_in_W:g} W -- a loss coefficient walked after "
                f"construction"
            )
        return p_out_W

    def night_parasitic_W(self) -> float:
        """
        @description The MPPT's own draw when the array is dark, W: quiescent
            current x bus voltage (GV-5: 0.125 mA -> 2.7 mW on 21.6 V).
            FROZEN NAME (contract). NOT subtracted inside bus_power_W --
            builders bill it as an explicit PayloadLoad line so the ledger
            names it (SPEC section 2.2 / cross-module rule c).
        @returns Night parasitic power, W, >= 0.
        """
        return self.night_draw_A * self.v_bus_V


def gv5_converter(v_bus_V: float = 21.6) -> MPPTConverter:
    """
    @description An MPPTConverter parameterized to the Genasun GV-5 published
        anchors (Sunforge LLC GV-5 datasheet, 2021): rated 5 A output (108 W
        on the 21.6 V bus), tracking "99+ % typical" (shipped 0.99, the
        conservative end), peak electrical efficiency 99.84 % <= the published
        99.85 %, > 95 % efficiency down to a few watts (98.7 % at 4 W out),
        night consumption 0.125 mA. Coefficients {P_fix = 0.05 W, k1 = 0.0006,
        k2 = 5.0e-6 /W} are a FIT to that prose curve -- HONESTY ledger H-2,
        flagged until the datasheet graph is digitized point-by-point.
    @param v_bus_V Bus voltage, V (default the SPEC 3.1 6S choice; the 5 A
        rating scales the rated power with the bus).
    @returns A validated MPPTConverter.
    """
    # GV-5 output rating is 5 A at battery voltage (GV-5 datasheet).
    return MPPTConverter(
        p_rated_W=5.0 * v_bus_V,
        v_bus_V=v_bus_V,
        eta_track=0.99,
        p_fix_W=0.05,
        k1=0.0006,
        k2_per_W=5.0e-6,
        night_draw_A=GV5_NIGHT_DRAW_A,
    )


if __name__ == "__main__":  # pragma: no cover
    # Self-test: the acceptance anchors of SPEC_electrical section 2, actual
    # values printed. FOOTPRINT rule: BelowNormal priority.
    import sys

    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )

    failures = 0

    gv5 = gv5_converter()
    eta_4W = gv5.eta_conv_at_output_W(4.0)
    eta_peak = 1.0 / (1.0 + gv5.k1 + 2.0 * math.sqrt(gv5.p_fix_W * gv5.k2_per_W))
    night_W = gv5.night_parasitic_W()
    ok = eta_4W >= 0.95 and eta_peak <= MAX_CONVERTER_ETA \
        and abs(night_W - 0.0027) < 1.0e-9
    failures += 0 if ok else 1
    print(f"GV-5 fit: eta(4 W) = {eta_4W:.4f} (>= 0.95), peak = "
          f"{eta_peak:.5f} (<= {MAX_CONVERTER_ETA}), night = "
          f"{1e3 * night_W:.2f} mW (= 2.70) {'PASS' if ok else 'FAIL'}")

    default = MPPTConverter(p_rated_W=65.0)
    eta_rated = default.eta_conv_at_output_W(65.0)
    ok = abs(eta_rated - DEFAULT_ETA_AT_RATED) < 1.0e-9
    failures += 0 if ok else 1
    print(f"H-2 default (65 W class): k2 = {default.k2_per_W:.4e} /W, "
          f"eta(rated) = {eta_rated:.4f} (= 0.97), eta(4 W) = "
          f"{default.eta_conv_at_output_W(4.0):.4f} (flagged H-2) "
          f"{'PASS' if ok else 'FAIL'}")

    # The vendor-peak wall: a curve that would beat 99.85 % refuses to build.
    try:
        MPPTConverter(p_rated_W=65.0, p_fix_W=0.01, k1=0.0, k2_per_W=1.0e-9)
        print("vendor-peak ceiling FAIL (constructed)")
        failures += 1
    except ParamBoundsError as exc:
        print(f"vendor-peak ceiling PASS (refused: {exc})")

    # Dawn collapse: below the fixed-loss floor the bus sees exactly zero.
    ok = gv5.bus_power_W(0.04) == 0.0 and gv5.bus_power_W(0.0) == 0.0
    failures += 0 if ok else 1
    print(f"fixed-loss floor: bus_power_W(0.04 W) = "
          f"{gv5.bus_power_W(0.04)} {'PASS' if ok else 'FAIL'}")

    print("SELF-TEST", "PASS" if failures == 0 else f"FAIL ({failures})")
    raise SystemExit(0 if failures == 0 else 1)
