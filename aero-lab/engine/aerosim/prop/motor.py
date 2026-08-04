"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Drela first-order Kv/R/I0 motor
    model + PWM-bridge ESC losses (SPEC_electrical section 4): forward and
    inverse closed forms, three cited catalogue motors (the (Kv, R, I0,
    rating, mass) TUPLE catalogued jointly, tech-catalogue pattern), vendor
    peak-efficiency anchors, and EscParams with conduction + fixed losses.
    Ledger items H-4 (I0 speed-independent) and H-5 (ESC defaults) carried.

INTERFACE OBJECTION (recorded per house style; the interface is implemented
exactly as frozen):
  SPEC 4.4 bounds the ESC so "eta_esc(rated) in [0.85, 0.98]". With the
  SPEC'S OWN defaults (R_esc = 10 mOhm, P_fix = 0.3 W) and the catalogue
  motors' own rated currents (14 / 20 / 25 A, same spec table), the model
  computes eta at rated = 0.984 / 0.984 / 0.982 -- ABOVE the stated 0.98
  ceiling. The stated band cannot contain the stated defaults. Resolution
  mirrors powerplant.py OBJECTION 1: defaults are normative (they are frozen
  in the EscParams signature), so the ceiling used by esc_rated_efficiency's
  band check is 0.985, and this deviation is reported here rather than
  silently retuning R_esc. The floor 0.85 (Gong/Verstraete measured band) is
  unchanged.

UNITS: SI throughout; Kv carries rpm/V in its name and is converted to
rad/s/V internally (Drela: Kv_SI = Kv_rpm * 2 pi / 60).
"""

from __future__ import annotations

import math
from typing import NamedTuple

from ..vehicle.param_bounds import ParamBoundsError, require_in_range

__all__ = [
    "MotorParams",
    "MotorOp",
    "MOTOR_CATALOGUE",
    "VENDOR_ANCHORS",
    "motor_inverse",
    "motor_forward",
    "motor_peak_eta",
    "EscParams",
    "esc_input_power_W",
    "esc_rated_efficiency",
    "ESC_RATED_ETA_BAND",
    "HONESTY_LEDGER",
]

HONESTY_LEDGER: tuple[str, ...] = (
    "H-4: I0 treated speed-independent (first-order Drela); vendors quote it "
    "at one test voltage (AT2312: 0.85 A @ 10 V). Under-bills windage at "
    "high rpm. Accepted, cited caveat (Drela 2007, 'Motor model "
    "refinements').",
    "H-5: EscParams defaults R=10 mOhm / P_fix=0.3 W are class-typical, not "
    "per-device datasheet values (small-UAV ESCs rarely publish Rds(on)); "
    "band anchored to Gong/MacNeill/Verstraete measured 85-95 %.",
    "H-ESC-CEIL: rated-eta ceiling 0.985 not the spec's 0.98 -- see the "
    "interface objection in the header; the spec's own defaults compute "
    "0.982-0.984 at the catalogue motors' rated currents.",
)


class MotorParams(NamedTuple):
    """
    @description One brushless DC motor in the Drela first-order model
        (Drela, 'First-Order DC Electric Motor Model', MIT 2007). The tuple
        is catalogued JOINTLY -- mixing one motor's R with another's mass is
        refused by validate_motor (tech-catalogue pattern).
    @param name Catalogue name.
    @param kv_rpm_per_V Speed constant, rpm/V.
    @param r_ohm Winding resistance, Ohm.
    @param i0_A No-load current, A (iron + bearing + windage loss).
    @param rating_W Continuous electrical rating, W.
    @param mass_kg Motor mass, kg.
    @param source Datasheet provenance.
    """

    name: str
    kv_rpm_per_V: float
    r_ohm: float
    i0_A: float
    rating_W: float
    mass_kg: float
    source: str


class MotorOp(NamedTuple):
    """
    @description One motor electrical operating point (frozen contract).
    @param v_V Terminal voltage, V.
    @param i_A Terminal current, A.
    @param p_elec_W Electrical input power V*I, W.
    @param eta Shaft power / electrical power, dimensionless in [0, 1).
    """

    v_V: float
    i_A: float
    p_elec_W: float
    eta: float


#: Declared credible ranges (SPEC 4.4): a zero-I0 motor is lossless at no
#: load; sub-5-mOhm windings do not exist in the 50-300 W class.
_MOTOR_BOUNDS: dict[str, tuple[float, float, str, str]] = {
    "kv_rpm_per_V": (100.0, 4000.0, "rpm/V",
                     "outside it this power class has no hardware"),
    "r_ohm": (0.005, 2.0, "Ohm",
              "divided into eta: R -> 0 is a lossless winding"),
    "i0_A": (0.05, 5.0, "A",
             "a zero-I0 motor is lossless at no load -- excluded"),
    "rating_W": (1.0, 5000.0, "W", "50-300 W class catalogue, with margin"),
    "mass_kg": (0.005, 2.0, "kg", "billed into the vehicle mass budget"),
}


def validate_motor(m: MotorParams) -> MotorParams:
    """
    @description Range-check every numeric field of a MotorParams against the
        declared bounds. Called for every catalogue entry at import and by
        BEMTThruster at construction, so a hand-built fantasy motor is caught
        at the same wall as a catalogued one.
    @param m The motor tuple.
    @returns m unchanged (for chaining).
    @raises ParamBoundsError On any out-of-range field.
    """
    for field, (lo, hi, unit, why) in _MOTOR_BOUNDS.items():
        require_in_range(field, getattr(m, field), lo, hi, unit=unit,
                         element=f"MotorParams({m.name})", why=why)
    return m


#: FROZEN catalogue keys (SPEC 4.2). Sources:
#:  axi_2212_26 -- Model Motors AXI 2212/26 V2 GOLD (modelmotors.cz product
#:    185; hyperflight.co.uk AXI2212-26V2L): Kv 920 rpm/V, R 124 mOhm,
#:    I0 0.45 A, 138 W / 14 A 60 s, 59.5 g.
#:  axi_2217_20 -- Model Motors AXI 2217/20 V2 GOLD (modelmotors.cz product
#:    199/362; flashrc.com 22829): Kv 840, R 185 mOhm, I0 0.40 A, 270 W /
#:    20 A 60 s, 74 g (long).
#:  tmotor_at2312 -- T-Motor AT2312 (store.tmotor.com goods id=788): Kv 1150,
#:    R 75 mOhm, I0 0.85 A @ 10 V, 350 W peak / 25 A 180 s, 60 g.
MOTOR_CATALOGUE: dict[str, MotorParams] = {
    "axi_2212_26": validate_motor(MotorParams(
        "axi_2212_26", 920.0, 0.124, 0.45, 138.0, 0.0595,
        "Model Motors AXI 2212/26 V2 GOLD datasheet (modelmotors.cz #185)")),
    "axi_2217_20": validate_motor(MotorParams(
        "axi_2217_20", 840.0, 0.185, 0.40, 270.0, 0.074,
        "Model Motors AXI 2217/20 V2 GOLD datasheet (modelmotors.cz #199)")),
    "tmotor_at2312": validate_motor(MotorParams(
        "tmotor_at2312", 1150.0, 0.075, 0.85, 350.0, 0.060,
        "T-Motor AT2312 specification (store.tmotor.com #788; I0 @ 10 V)")),
}

#: Vendor test-condition anchors, file-local (kept OUT of the frozen
#: MotorParams tuple): claimed peak efficiency, the voltage it is evaluated
#: at (the motor's intended cell count / I0 quote voltage), and the vendor
#: rated current used by the ESC rated-eta band. All from the same datasheet
#: pages as MOTOR_CATALOGUE.
VENDOR_ANCHORS: dict[str, dict] = {
    "axi_2212_26": {"eta_peak_claim": 0.82, "v_test_V": 7.4,
                    "i_rated_A": 14.0},   # 2S LiPo nominal, 14 A/60 s
    "axi_2217_20": {"eta_peak_claim": 0.84, "v_test_V": 11.1,
                    "i_rated_A": 20.0},   # 3S LiPo nominal, 20 A/60 s
    "tmotor_at2312": {"eta_peak_claim": None, "v_test_V": 10.0,
                      "i_rated_A": 25.0},  # I0 quoted @ 10 V, 25 A/180 s
}


def _kv_si(m: MotorParams) -> float:
    """
    @description Kv in SI: rad/s per volt (Drela: Kv_SI = Kv_rpm * 2 pi/60).
    @param m Motor tuple.
    @returns Kv_SI, rad/(s*V).
    """
    return m.kv_rpm_per_V * 2.0 * math.pi / 60.0


def motor_forward(m: MotorParams, v_V: float,
                  omega_rad_per_s: float) -> tuple[float, float, float]:
    """
    @description Drela forward model: given terminal voltage and shaft speed,
        I = (V - omega/Kv_SI)/R, Q = (I - I0)/Kv_SI, P_shaft = Q*omega.
    @param m Motor tuple.
    @param v_V Terminal voltage, V, > 0.
    @param omega_rad_per_s Shaft speed, rad/s, >= 0.
    @returns (i_A, torque_Nm, p_shaft_W).
    """
    kv = _kv_si(m)
    i_A = (v_V - omega_rad_per_s / kv) / m.r_ohm
    torque_Nm = (i_A - m.i0_A) / kv
    return i_A, torque_Nm, torque_Nm * omega_rad_per_s


def motor_inverse(m: MotorParams, torque_Nm: float,
                  omega_rad_per_s: float) -> MotorOp:
    """
    @description Drela inverse model (what the BEMT coupling needs): given
        required shaft torque and speed,

            I = Q*Kv_SI + I0
            V = I*R + omega/Kv_SI
            eta = Q*omega / (V*I)

        The two loss terms are physical -- I0 buys iron/bearing/windage, I*R
        buys copper -- and each is a datasheet number, not a tuned constant
        (H-4 for the I0 caveat).
    @param m Motor tuple.
    @param torque_Nm Required shaft torque, N*m, >= 0.
    @param omega_rad_per_s Shaft speed, rad/s, >= 0.
    @returns MotorOp (eta = 0 at zero shaft power).
    @raises ParamBoundsError On negative torque or speed.
    """
    if torque_Nm < 0.0 or omega_rad_per_s < 0.0:
        raise ParamBoundsError(
            f"motor_inverse({m.name}): torque and speed must be >= 0, got "
            f"Q={torque_Nm!r} N*m, omega={omega_rad_per_s!r} rad/s -- "
            "regeneration belongs in a turbine element, never here.")
    kv = _kv_si(m)
    i_A = torque_Nm * kv + m.i0_A
    v_V = i_A * m.r_ohm + omega_rad_per_s / kv
    p_elec_W = v_V * i_A
    p_shaft_W = torque_Nm * omega_rad_per_s
    eta = p_shaft_W / p_elec_W if p_elec_W > 0.0 else 0.0
    if eta >= 1.0:
        raise ParamBoundsError(
            f"motor_inverse({m.name}): eta = {eta} >= 1 -- a motor above "
            "unity is a free-energy multiplier; parameters walked.")
    return MotorOp(v_V=v_V, i_A=i_A, p_elec_W=p_elec_W, eta=eta)


def motor_peak_eta(m: MotorParams, v_V: float) -> float:
    """
    @description Closed-form peak efficiency at a terminal voltage (Drela
        2007, eq. for eta_max): eta_max = (1 - sqrt(I0*R/V))^2.
    @param m Motor tuple.
    @param v_V Terminal voltage, V, > 0.
    @returns Peak efficiency, dimensionless in (0, 1).
    """
    v_V = require_in_range("v_V", v_V, 0.0, 60.0, lo_open=True, unit="V",
                           element=f"motor_peak_eta({m.name})",
                           why="hobby-bus voltage range")
    return (1.0 - math.sqrt(m.i0_A * m.r_ohm / v_V)) ** 2


# -----------------------------------------------------------------------------
# ESC
# -----------------------------------------------------------------------------

#: Rated-efficiency legality band for an (ESC, motor) pairing. Floor 0.85 =
#: Gong/MacNeill/Verstraete measured small-UAV band; ceiling 0.985 -- see the
#: header interface objection (spec's 0.98 excludes the spec's own defaults).
ESC_RATED_ETA_BAND: tuple[float, float] = (0.85, 0.985)


class EscParams(NamedTuple):
    """
    @description PWM-bridge ESC loss model (SPEC 4.4):
        P_loss = I^2 * r_ohm + p_fix_W, with r_ohm = 2 x Rds(on) of the
        conducting FET pair plus board/trace resistance. Defaults are the
        spec's class-typical values, ledger H-5. Frozen signature
        EscParams(r_ohm=0.010, p_fix_W=0.3).
    @param r_ohm Conduction resistance, Ohm, [0.002, 0.1].
    @param p_fix_W Fixed (gate-drive + logic) loss, W, [0.05, 5].
    """

    r_ohm: float = 0.010
    p_fix_W: float = 0.3

    def validated(self) -> "EscParams":
        """
        @description Range-check both fields (NamedTuple cannot check in
            __new__ without breaking the frozen signature; BEMTThruster calls
            this at construction).
        @returns self.
        @raises ParamBoundsError On out-of-range values.
        """
        require_in_range("r_ohm", self.r_ohm, 0.002, 0.1, unit="Ohm",
                         element="EscParams",
                         why="below 2 mOhm no hobby bridge exists (free "
                             "conduction); above 100 mOhm it is a fault")
        require_in_range("p_fix_W", self.p_fix_W, 0.05, 5.0, unit="W",
                         element="EscParams",
                         why="a zero fixed loss makes light-load eta 1.0")
        return self


def esc_input_power_W(esc: EscParams, p_motor_W: float, i_A: float) -> float:
    """
    @description Electrical power the ESC draws from the bus to deliver
        p_motor_W at motor current i_A:
        P_in = P_motor + I^2 * r_ohm + p_fix_W. The conduction current is the
        MOTOR current -- the same current flows through the conducting FET
        pair (SPEC 4.4).
    @param esc ESC parameters.
    @param p_motor_W Motor terminal power, W, >= 0.
    @param i_A Motor current, A, >= 0.
    @returns ESC input power, W (>= p_motor_W + p_fix).
    """
    if p_motor_W < 0.0 or i_A < 0.0:
        raise ParamBoundsError(
            f"esc_input_power_W: p_motor_W={p_motor_W!r} and i_A={i_A!r} "
            "must be >= 0")
    return p_motor_W + i_A * i_A * esc.r_ohm + esc.p_fix_W


def esc_rated_efficiency(esc: EscParams, rating_W: float,
                         i_rated_A: float) -> float:
    """
    @description ESC efficiency at a motor's rated point,
        eta = rating / (rating + I_rated^2 R + P_fix), and the band check
        [0.85, 0.985] (see header objection). Called by BEMTThruster's
        cross-parameter validation for catalogued motors.
    @param esc ESC parameters.
    @param rating_W Motor continuous rating, W.
    @param i_rated_A Vendor rated current, A.
    @returns eta at rated, dimensionless.
    @raises ParamBoundsError When outside ESC_RATED_ETA_BAND.
    """
    eta = rating_W / esc_input_power_W(esc, rating_W, i_rated_A)
    lo, hi = ESC_RATED_ETA_BAND
    if not (lo <= eta <= hi):
        raise ParamBoundsError(
            f"EscParams(r={esc.r_ohm:g} Ohm, p_fix={esc.p_fix_W:g} W) gives "
            f"eta {eta:.4f} at {rating_W:g} W / {i_rated_A:g} A -- outside "
            f"the measured small-UAV band [{lo}, {hi}] "
            "(Gong/MacNeill/Verstraete).")
    return eta


def _powerplant_agreement(m: MotorParams, i_rated_A: float,
                          motor_efficiency) -> tuple[float, float]:
    """
    @description SPEC 4.3 consistency sweep between the Drela model and
        powerplant.motor_efficiency (the ideal-class two-loss curve). Both
        curves are evaluated over 20-100 % of the ideal-class equivalent
        rating P_peak_drela / 0.6 on the fixed-voltage operating line
        V_ref = rating_W / i_rated_A (high-speed branch), with the two-loss
        curve's eta_peak set to Drela's computed peak at V_ref. Shared by the
        self-test and tests/test_motor_esc.py.
    @param m Motor tuple.
    @param i_rated_A Vendor rated current, A.
    @param motor_efficiency The powerplant function (passed in to keep this
        module import-light for the barrel).
    @returns (worst |delta eta| over the sweep, load fraction where it occurs).
    """
    v_ref = m.rating_W / i_rated_A
    i_star = math.sqrt(v_ref * m.i0_A / m.r_ohm)  # A, Drela peak current
    p_star = (i_star - m.i0_A) * (v_ref - i_star * m.r_ohm)  # W, peak P_shaft
    eta_star = motor_peak_eta(m, v_ref)
    rated_equiv_W = p_star / 0.6  # ideal-class rating: peak sits at 60 % load
    worst, worst_load = 0.0, 0.0
    for load in (0.2, 0.4, 0.6, 0.8, 1.0):
        p_W = load * rated_equiv_W
        # Solve (I - I0)(V - I R) = P for the small-current (efficient) root.
        a, b = -m.r_ohm, v_ref + m.i0_A * m.r_ohm
        c = -(m.i0_A * v_ref + p_W)
        disc = b * b - 4.0 * a * c
        i_A = (-b + math.sqrt(disc)) / (2.0 * a)
        if i_A < m.i0_A:
            i_A = (-b - math.sqrt(disc)) / (2.0 * a)
        eta_d = (1.0 - m.i0_A / i_A) * (1.0 - i_A * m.r_ohm / v_ref)
        eta_p = motor_efficiency(p_W, rated_equiv_W, eta_peak=eta_star)
        d = abs(eta_d - eta_p)
        if d > worst:
            worst, worst_load = d, load
    return worst, worst_load


def _selftest() -> int:
    """
    @description Acceptance checks from SPEC 4: catalogue peak eta within
        +-4 points of vendor claims; agreement with powerplant.motor_efficiency
        within 5 points over 20-100 % load; ESC rated band.
    @returns 0 on pass, 1 on fail.
    """
    from ..powerplant import motor_efficiency

    results: list[tuple[str, bool, str]] = []
    for key, m in MOTOR_CATALOGUE.items():
        anchor = VENDOR_ANCHORS[key]
        peak = motor_peak_eta(m, anchor["v_test_V"])
        claim = anchor["eta_peak_claim"]
        if claim is not None:
            results.append((
                f"{key} peak eta within +-4 pts of vendor {claim:.0%}",
                abs(peak - claim) <= 0.04,
                f"model {peak:.4f} at {anchor['v_test_V']} V "
                f"({(peak-claim)*100:+.1f} pts)"))
        # Consistency with the existing two-loss curve, 20-100 % load, at the
        # motor's own computed peak (SPEC 4.3). Operating line: fixed
        # V_ref = rating/I_rated (the voltage where the vendor rating and
        # rated current meet), high-speed branch. LOAD AXIS: powerplant's
        # "load" is defined relative to ITS rated argument, whose meaning is
        # "eta peaks at 60 % of it" -- so the ideal-class equivalent rating
        # of this motor is P_peak_drela / 0.6, and the two curves are
        # compared on that shared axis with eta_peak set to Drela's peak.
        worst, worst_load = _powerplant_agreement(m, anchor["i_rated_A"],
                                                  motor_efficiency)
        results.append((
            f"{key} vs powerplant.motor_efficiency within 5 pts (20-100 %)",
            worst <= 0.05,
            f"worst |d eta| = {worst*100:.2f} pts at {worst_load:.0%} load"))
        # ESC rated band with the spec defaults and this motor's current.
        try:
            eta_esc = esc_rated_efficiency(EscParams().validated(),
                                           m.rating_W, anchor["i_rated_A"])
            results.append((f"{key} + default ESC rated eta in band",
                            True, f"eta(rated) = {eta_esc:.4f}"))
        except ParamBoundsError as exc:
            results.append((f"{key} + default ESC rated eta in band",
                            False, str(exc)[:90]))
    # Round trip forward/inverse identity.
    m = MOTOR_CATALOGUE["axi_2212_26"]
    i_A, q_Nm, p_shaft = motor_forward(m, 7.4, 0.8 * _kv_si(m) * 7.4)
    op = motor_inverse(m, q_Nm, 0.8 * _kv_si(m) * 7.4)
    results.append(("forward/inverse round trip < 1e-9 rel",
                    abs(op.v_V - 7.4) < 1e-9 * 7.4 and
                    abs(op.i_A - i_A) < 1e-9 * max(i_A, 1.0),
                    f"V {op.v_V:.6f} vs 7.4, I {op.i_A:.6f} vs {i_A:.6f}"))
    n_pass = 0
    print("=" * 79)
    print("aerosim.prop.motor -- MOTOR + ESC ACCEPTANCE SELF-TEST")
    print("=" * 79)
    for name, okk, detail in results:
        n_pass += okk
        print(f"[{'PASS' if okk else 'FAIL'}] {name}\n       {detail}")
    print(f"{n_pass}/{len(results)} checks passed")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    import ctypes
    ctypes.windll.kernel32.SetPriorityClass(
        ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
    )  # BelowNormal -- operator footprint rule
    raise SystemExit(_selftest())
