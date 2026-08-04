"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Wires and connectors
    (SPEC_electrical section 3): ASTM B258 AWG resistance table with the CRC
    copper temperature coefficient (both-ways honest: the harness IMPROVES at
    altitude while the battery worsens), round-trip I2R recomputed from the
    actual per-step current, AMASS XT60 contact resistance, and the billed
    copper + insulation mass. Flat-efficiency models silently drop the
    factor-of-2 return conductor; this module does not.

UNITS: ohms, metres, watts, kelvin, kilograms. Every name says its unit.

HONESTY LEDGER (module level)
-----------------------------
H-3   Insulation mass allowance +40 % over conductor copper: hobby
      silicone-insulated wire practice; no single citable datasheet. FLAGGED.
H-3b  Connector MASS is not billed here (only its contact RESISTANCE is): an
      XT60 pair is ~10 g and belongs to whoever bills the harness mass. A
      builder totalling harness_copper_mass_kg must add connector mass
      explicitly or state why it lives in structure mass. FLAGGED, loud.
H-3c  The linear temperature coefficient alpha_Cu = 0.00393/K is the 20 degC
      handbook slope; below ~-80 degC copper resistivity falls faster than
      linear toward the residual-resistivity floor, so the model slightly
      UNDER-credits the cold-altitude gain. Conservative direction; accepted.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..vehicle.param_bounds import ParamBoundsError, require_in_range

#: Solid annealed copper resistance at 20 degC, ohm/m, ASTM B258 nominal
#: values (reproduced in every standard wire table). Keys are the AWG sizes
#: stocked in the 50-300 W airframe class (SPEC_electrical section 3.2).
AWG_RESISTANCE_20C_OHM_PER_M: dict[int, float] = {
    12: 5.211e-3,
    14: 8.286e-3,
    16: 13.17e-3,
    18: 20.95e-3,
    20: 33.31e-3,
    22: 52.96e-3,
}

#: Temperature coefficient of resistance of annealed copper at 20 degC, 1/K.
#: CRC Handbook of Chemistry and Physics (resistivity of copper).
ALPHA_CU_PER_K: float = 0.00393

#: Reference temperature of the AWG table, K (20 degC).
T_AWG_TABLE_K: float = 293.15

#: Resistivity of annealed copper at 20 degC, ohm*m (CRC Handbook). Used to
#: recover the conductor cross-section from the ASTM B258 ohm/m values, so
#: the mass billing and the loss table cannot drift apart.
RHO_CU_20C_OHM_M: float = 1.724e-8

#: Density of copper, kg/m^3 (CRC Handbook).
RHO_CU_KG_M3: float = 8960.0

#: AMASS XT60 contact resistance per mated contact pair, ohm: <= 0.55 mohm
#: (AMASS XT60 datasheet; TME product data tme.com/us/en-us/details/xt60-m;
#: the XT60H variant publishes 0.50 mohm). Rated 30 A continuous.
XT60_CONTACT_RESISTANCE_OHM: float = 0.55e-3

#: Insulation mass allowance over conductor copper, dimensionless multiplier.
#: HONESTY ledger H-3 (hobby silicone-wire practice, flagged).
INSULATION_MASS_FACTOR: float = 1.40

#: Wire temperature validity band, K. Lower end covers the ISA tropopause
#: (216.65 K) with margin; H-3c documents the sub-linear behavior below it.
_T_WIRE_MIN_K: float = 150.0
_T_WIRE_MAX_K: float = 450.0


def awg_resistance_ohm_per_m(awg: int, t_wire_K: float = T_AWG_TABLE_K) -> float:
    """
    @description Resistance per metre of one conductor at temperature:

            R(T) = R_20C * [1 + alpha_Cu*(T - 293.15 K)]

        BOTH-WAYS honest: at the ISA tropopause (-56 degC) copper resistance
        DROPS ~30 % -- the harness gets better at altitude while the battery
        gets worse; neither is modeled without the other. FROZEN NAME
        (contract).
    @param awg Wire gauge, one of {12, 14, 16, 18, 20, 22} (ASTM B258 rows
        carried; anything else raises rather than interpolating).
    @param t_wire_K Wire temperature, K.
    @returns Resistance of ONE conductor, ohm/m.
    @raises ParamBoundsError On an uncatalogued gauge or out-of-band
        temperature.
    """
    if not isinstance(awg, (int,)) or isinstance(awg, bool) \
            or awg not in AWG_RESISTANCE_20C_OHM_PER_M:
        raise ParamBoundsError(
            f"awg_resistance_ohm_per_m awg must be one of "
            f"{sorted(AWG_RESISTANCE_20C_OHM_PER_M)}, got {awg!r} -- only "
            f"ASTM B258 rows this airframe class stocks are catalogued"
        )
    t = require_in_range("t_wire_K", t_wire_K, _T_WIRE_MIN_K, _T_WIRE_MAX_K,
                         unit="K", element="awg_resistance_ohm_per_m",
                         why="linear alpha_Cu band; below ~-80 degC the "
                             "residual-resistivity floor takes over (ledger "
                             "H-3c), above 450 K the insulation is on fire")
    return AWG_RESISTANCE_20C_OHM_PER_M[awg] * (
        1.0 + ALPHA_CU_PER_K * (t - T_AWG_TABLE_K)
    )


@dataclass(frozen=True)
class HarnessSegment:
    """
    @description One two-conductor power run: PV-string -> MPPT, MPPT -> pack,
        pack -> ESC, ESC -> motor. FROZEN NAME AND FIELDS (build contract).
        Loss is recomputed from the ACTUAL per-step current, never a
        design-point constant -- light-load I2R correctly vanishes as I^2.
    @param name Human-readable segment name, carried into ledgers.
    @param awg Wire gauge (ASTM B258 row).
    @param length_oneway_m Geometric run length ONE WAY, m; the loss and the
        mass both use 2x (out AND back -- the classic silently-dropped
        factor of 2).
    @param n_connector_pairs Number of mated XT60 contact pairs in the CIRCUIT
        (a connectorized segment has 2: one on + and one on -, SPEC 3.3).
    """

    name: str
    awg: int
    length_oneway_m: float
    n_connector_pairs: int

    def __post_init__(self) -> None:
        """
        @description Validate at construction (param_bounds pattern; a frozen
            dataclass cannot be mutated afterwards, and segment_loss_W
            re-validates the gauge on every call anyway).
        @returns None. Raises on violation.
        @raises ParamBoundsError On an uncatalogued gauge or out-of-range run.
        """
        if self.awg not in AWG_RESISTANCE_20C_OHM_PER_M:
            raise ParamBoundsError(
                f"HarnessSegment.awg must be one of "
                f"{sorted(AWG_RESISTANCE_20C_OHM_PER_M)}, got {self.awg!r}"
            )
        require_in_range("length_oneway_m", self.length_oneway_m, 0.0, 50.0,
                         lo_open=True, unit="m", element="HarnessSegment",
                         why="a zero run is a lossless wire; 50 m does not "
                             "fit in this aircraft class")
        if not isinstance(self.n_connector_pairs, int) \
                or isinstance(self.n_connector_pairs, bool):
            raise ParamBoundsError(
                f"HarnessSegment.n_connector_pairs must be an integer count, "
                f"got {self.n_connector_pairs!r}"
            )
        require_in_range("n_connector_pairs", float(self.n_connector_pairs),
                         0.0, 20.0, unit="-", element="HarnessSegment",
                         why="beyond 20 mated pairs in one run is a wiring "
                             "fault model, not a design")


def segment_loss_W(
    seg: HarnessSegment,
    p_W: float,
    v_bus_V: float,
    t_wire_K: float = T_AWG_TABLE_K,
) -> float:
    """
    @description I2R loss of one segment at the ACTUAL power it carries this
        step (SPEC 3.2). FROZEN NAME (contract).

            I      = P / V_bus
            R      = rho_awg(T) * 2 * L_oneway + n_pairs * R_XT60
            P_loss = I^2 * R

    @param seg The segment.
    @param p_W Power flowing through the segment THIS STEP, W, >= 0.
    @param v_bus_V Bus voltage, V, in the SPEC 3.1 band [7.2, 50.8].
    @param t_wire_K Wire temperature, K (use ambient: a thin harness in the
        airstream runs at air temperature to within a few kelvin).
    @returns Loss, W, >= 0.
    @raises ParamBoundsError On negative/non-finite power or an out-of-band
        bus voltage.
    """
    p = require_in_range("p_W", p_W, 0.0, 1.0e6, unit="W",
                         element="segment_loss_W",
                         why="a negative segment power is a sign error; the "
                             "loss is direction-independent and the caller "
                             "passes magnitude")
    v = require_in_range("v_bus_V", v_bus_V, 7.2, 50.8, unit="V",
                         element="segment_loss_W",
                         why="SPEC 3.1 bus band (2S..12S hardware catalogue)")
    i_A = p / v
    r_ohm = (
        awg_resistance_ohm_per_m(seg.awg, t_wire_K) * 2.0 * seg.length_oneway_m
        + seg.n_connector_pairs * XT60_CONTACT_RESISTANCE_OHM
    )
    return i_A * i_A * r_ohm


def awg_conductor_area_m2(awg: int) -> float:
    """
    @description Conductor cross-section recovered from the ASTM B258 ohm/m
        value and the CRC copper resistivity (A = rho/R'), so the mass billing
        cannot drift from the loss table. AWG16 recovers 1.31 mm^2, the
        standard tabulated value.
    @param awg Wire gauge (ASTM B258 row).
    @returns Conductor cross-section, m^2.
    @raises ParamBoundsError On an uncatalogued gauge.
    """
    if awg not in AWG_RESISTANCE_20C_OHM_PER_M:
        raise ParamBoundsError(
            f"awg_conductor_area_m2 awg must be one of "
            f"{sorted(AWG_RESISTANCE_20C_OHM_PER_M)}, got {awg!r}"
        )
    return RHO_CU_20C_OHM_M / AWG_RESISTANCE_20C_OHM_PER_M[awg]


def harness_copper_mass_kg(segments: tuple[HarnessSegment, ...] | list) -> float:
    """
    @description Billed harness mass, kg: copper at 8960 kg/m^3 (CRC) times
        conductor cross-section times ROUND-TRIP length (2 conductors), plus
        the +40 % insulation allowance (HONESTY ledger H-3). Connector mass
        is NOT included -- ledger H-3b, the builder adds it explicitly.
        FROZEN NAME (contract).
    @param segments The harness segments.
    @returns Total copper + insulation mass, kg.
    @raises ParamBoundsError When an entry is not a HarnessSegment.
    """
    total_kg = 0.0
    for seg in segments:
        if not isinstance(seg, HarnessSegment):
            raise ParamBoundsError(
                f"harness_copper_mass_kg expects HarnessSegment entries, got "
                f"{type(seg).__name__} -- an unvalidated segment shape would "
                f"bypass the gauge catalogue"
            )
        total_kg += (
            RHO_CU_KG_M3
            * awg_conductor_area_m2(seg.awg)
            * 2.0 * seg.length_oneway_m
        )
    return total_kg * INSULATION_MASS_FACTOR


if __name__ == "__main__":  # pragma: no cover
    # Self-test: the acceptance anchors of SPEC_electrical section 3, actual
    # values printed. FOOTPRINT rule: BelowNormal priority.
    import sys

    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )

    failures = 0

    # AWG16, 300 W on the 21.6 V bus (13.9 A), 1 m one-way, no connectors:
    # 13.9^2 x 2 x 0.01317 = 5.09 W +-1 %.
    seg = HarnessSegment("pack->esc", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    loss_W = segment_loss_W(seg, 300.0, 21.6)
    ok = abs(loss_W - 5.09) / 5.09 < 0.01
    failures += 0 if ok else 1
    print(f"AWG16 1 m at 300 W / 21.6 V: {loss_W:.3f} W (anchor 5.09 +-1%) "
          f"{'PASS' if ok else 'FAIL'}")

    # Cold-altitude credit: -56 degC drops copper resistance ~30 %.
    r_cold = awg_resistance_ohm_per_m(16, 216.65)
    r_20c = awg_resistance_ohm_per_m(16)
    drop = 1.0 - r_cold / r_20c
    ok = 0.28 < drop < 0.32
    failures += 0 if ok else 1
    print(f"copper at -56.5 degC: {100 * drop:.1f} % below 20 degC "
          f"(anchor ~30 %) {'PASS' if ok else 'FAIL'}")

    # XT60: 2 contact pairs at 13.9 A = 0.21 W, small but real.
    seg_conn = HarnessSegment("pack->esc", awg=16, length_oneway_m=1.0,
                              n_connector_pairs=2)
    conn_W = segment_loss_W(seg_conn, 300.0, 21.6) - loss_W
    ok = abs(conn_W - (300.0 / 21.6) ** 2 * 1.1e-3) < 1.0e-9
    failures += 0 if ok else 1
    print(f"2 XT60 pairs at 13.9 A: +{conn_W:.3f} W {'PASS' if ok else 'FAIL'}")

    # Mass: AWG16 recovers 1.31 mm^2; 1 m one-way = 2 m conductor.
    area_mm2 = 1.0e6 * awg_conductor_area_m2(16)
    mass_kg = harness_copper_mass_kg([seg])
    hand_kg = 8960.0 * 1.309e-6 * 2.0 * 1.40
    ok = abs(area_mm2 - 1.31) < 0.01 and abs(mass_kg - hand_kg) / hand_kg < 0.01
    failures += 0 if ok else 1
    print(f"AWG16 area {area_mm2:.3f} mm^2 (std 1.31), 1 m harness mass "
          f"{1e3 * mass_kg:.1f} g (hand {1e3 * hand_kg:.1f}) "
          f"{'PASS' if ok else 'FAIL'}")

    print("SELF-TEST", "PASS" if failures == 0 else f"FAIL ({failures})")
    raise SystemExit(0 if failures == 0 else 1)
