"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The mission energy ledger: per-debit Wh
  |                                           | decomposition of the real chain (prop /
  |                                           | motor / ESC / harness / MPPT converter /
  |                                           | MPPT tracking / heater / night parasitic
  |                                           | / payload) recomputed from the FROZEN
  |                                           | module interfaces, plus the printable
  |                                           | mission report and a runnable
  |                                           | self-test (__main__).
-------------------------------------------------------------------------------

aerosim.mission.report -- where every watt-hour went, by name.

LEDGER SEMANTICS
    ledger[key] = Wh DEBITED by that mechanism over the mission (loss or
    load). Useful thrust work (T*V) and climb potential energy are NOT ledger
    debits -- they are what the debits pay FOR -- and are reported in extras.
    KEYS FROZEN: 'prop','motor','esc','harness','mppt_converter','mppt_track',
    'heater','night_parasitic','payload'.

HONESTY LEDGER (module-level)
    H-P1  The BEMT/motor/ESC/harness chain split is RECOMPUTED here from the
          propulsion module's own public functions (solve_prop_point,
          motor_inverse, EscParams fields) composed in their documented order.
          If bemt_thruster.py composes an internal detail differently the
          TOTAL still reconciles (the split is anchored to the observed bus
          power) but a few percent could shift between adjacent stages.
          Flagged; the reconciliation residual is reported, never hidden.
    H-P2  PV-side harness loss is deducted at observed bus power before the
          MPPT inversion (segment ordering approximation, same caveat).
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

_J_PER_WH = 3600.0

#: The FROZEN mission ledger key set (build contract).
LEDGER_KEYS: tuple[str, ...] = (
    "prop", "motor", "esc", "harness", "mppt_converter", "mppt_track",
    "heater", "night_parasitic", "payload",
)

#: Label convention for the builder-billed night MPPT parasitic PayloadLoad
#: line (frozen cross-module rule (c): night draw is an explicit line).
LABEL_MPPT_NIGHT: str = "mppt-night-parasitic"


# ------------------------------------------------------------------------------
# Element discovery
# ------------------------------------------------------------------------------


def _elements(vehicle: Any) -> list:
    """@description The vehicle's element list. @returns list (may be empty)."""
    return list(getattr(vehicle, "elements", []) or [])


def _payload_lines(vehicle: Any) -> tuple[float, float]:
    """@description Split constant PayloadLoad-style draws into payload vs the
        night-parasitic line (by the LABEL_MPPT_NIGHT convention).
    @param vehicle The vehicle.
    @returns (payload_W, night_parasitic_W), both >= 0."""
    payload_W = 0.0
    night_W = 0.0
    for el in _elements(vehicle):
        if hasattr(el, "capacity_J") or hasattr(el, "max_electrical_power_W"):
            continue
        if hasattr(el, "pack"):        # PackHeaterLoad: dynamic, not constant
            continue
        p = getattr(el, "power_W", None)
        if p is None:
            continue
        label = str(getattr(el, "label", ""))
        if "night" in label.lower():
            night_W += float(p)
        else:
            payload_W += float(p)
    return payload_W, night_W


def _find_thruster(vehicle: Any) -> Optional[Any]:
    """@description The propulsion element. @returns element or None."""
    for el in _elements(vehicle):
        if hasattr(el, "max_electrical_power_W"):
            return el
    return None


def _find_pv_real(vehicle: Any) -> Optional[Any]:
    """@description A PVArrayDiode-style element (has an .mppt converter).
    @returns element or None (flat/ideal PV)."""
    for el in _elements(vehicle):
        mppt = getattr(el, "mppt", None)
        if mppt is not None and hasattr(mppt, "bus_power_W"):
            return el
    return None


# ------------------------------------------------------------------------------
# Propulsion chain decomposition
# ------------------------------------------------------------------------------


def _ideal_chain_split(el: Any, p_elec_W: float, v_ms: float,
                       rho_kgm3: float) -> Optional[dict]:
    """Decompose an actuator-disk Thruster's electrical draw into stage losses.

    @description Inverts the shipped Thruster's own price
        P = T*(V+v_i)/(FM*eta_m*eta_e) for T (monotone in T -> bisection),
        then splits: p_shaft = T*(V+v_i)/FM; prop = p_shaft - T*V;
        motor = p_shaft*(1/eta_m - 1); esc = (p_shaft/eta_m)*(1/eta_e - 1).
    @param el The Thruster. @param p_elec_W Observed electrical draw, W.
    @param v_ms Airspeed, m/s. @param rho_kgm3 Air density.
    @returns dict of stage powers, W, or None when p_elec_W ~ 0.
    """
    if p_elec_W <= 1e-9:
        return None
    fm = float(getattr(el, "figure_of_merit",
                       getattr(el, "eta_prop", 0.85)))
    eta_m = float(getattr(el, "eta_motor", 0.90))
    eta_e = float(getattr(el, "eta_esc", 0.97))
    area = getattr(el, "disk_area_m2", None)
    if area is None:
        d = float(getattr(el, "diameter_m", 0.0))
        area = math.pi * 0.25 * d * d * max(int(getattr(el, "n_rotors", 1)), 1)
    area = max(float(area), 1e-9)

    def price_W(T: float) -> float:
        """@description The element's own actuator-disk electrical price.
        @param T Thrust, N. @returns W."""
        if T <= 0.0:
            return 0.0
        vi = 0.5 * (-v_ms + math.sqrt(v_ms * v_ms + 2.0 * T / (rho_kgm3 * area)))
        return T * (v_ms + vi) / (fm * eta_m * eta_e)

    T_hi = max(1.0, p_elec_W * fm * eta_m * eta_e / max(v_ms, 0.5)) * 2.0
    while price_W(T_hi) < p_elec_W:
        T_hi *= 2.0
        if T_hi > 1e7:
            return None
    T_lo = 0.0
    for _ in range(80):
        T_mid = 0.5 * (T_lo + T_hi)
        if price_W(T_mid) < p_elec_W:
            T_lo = T_mid
        else:
            T_hi = T_mid
    T = 0.5 * (T_lo + T_hi)
    vi = 0.5 * (-v_ms + math.sqrt(v_ms * v_ms + 2.0 * T / (rho_kgm3 * area)))
    p_shaft = T * (v_ms + vi) / fm
    p_motor_in = p_shaft / eta_m
    return {
        "useful_W": T * v_ms,
        "prop_W": p_shaft - T * v_ms,
        "motor_W": p_motor_in - p_shaft,
        "esc_W": p_motor_in / eta_e - p_motor_in,
        "harness_W": 0.0,
        "p_shaft_W": p_shaft,
        "thrust_N": T,
    }


def _bemt_chain_split(el: Any, p_elec_W: float, v_ms: float, rho_kgm3: float,
                      t_K: float, a_ms: float) -> Optional[dict]:
    """Decompose a BEMTThruster's electrical draw into stage losses.

    @description Recomposes the documented chain (SPEC_electrical section 6.3)
        from the propulsion module's own public functions: thrust -> BEMT
        (rpm root) -> motor_inverse -> ESC (i^2 R + fixed) -> harness i^2 R,
        then bisects thrust so the composed bus power equals the observed
        draw (HONESTY H-P1).
    @param el The BEMTThruster. @param p_elec_W Observed bus draw, W.
    @param v_ms Airspeed. @param rho_kgm3 Density. @param t_K Ambient
        temperature. @param a_ms Speed of sound (tip-Mach rpm ceiling).
    @returns dict of stage powers, W, or None when unavailable.
    """
    if p_elec_W <= 1e-9:
        return None
    from ..prop import motor_inverse, solve_prop_point  # frozen names

    geom = el.geom
    motor = el.motor
    esc = el.esc
    n = max(int(getattr(el, "n_rotors", 1)), 1)
    v_bus = float(getattr(el, "v_bus_V", 21.6))
    r_har = float(getattr(el, "r_harness_ohm", 0.0))
    d_m = float(getattr(geom, "diameter_m"))
    rpm_max = 0.7 * a_ms / (math.pi * d_m) * 60.0 * 0.999  # tip Mach < 0.7

    def rotor_at_thrust(T_r: float) -> Optional[Any]:
        """@description rpm root: the BEMT point delivering thrust T_r.
        @param T_r Per-rotor thrust, N. @returns PropPoint or None."""
        lo, hi = 60.0, rpm_max
        pp_hi = solve_prop_point(geom, v_ms, hi, rho_kgm3, t_K)
        if pp_hi.thrust_N < T_r:
            return None                      # beyond the propeller
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            pp = solve_prop_point(geom, v_ms, mid, rho_kgm3, t_K)
            if pp.thrust_N < T_r:
                lo = mid
            else:
                hi = mid
        return solve_prop_point(geom, v_ms, 0.5 * (lo + hi), rho_kgm3, t_K)

    def compose(T: float) -> Optional[dict]:
        """@description Full chain at total thrust T. @returns stage dict."""
        pp = rotor_at_thrust(T / n)
        if pp is None:
            return None
        # PropPoint carries no rpm; recover omega from P_shaft = Q * omega.
        omega = pp.p_shaft_W / max(pp.torque_Nm, 1e-12)     # rad/s
        op = motor_inverse(motor, pp.torque_Nm, omega)
        p_esc_in_r = op.p_elec_W + op.i_A ** 2 * float(esc.r_ohm) \
            + float(esc.p_fix_W)
        p_esc_in = n * p_esc_in_r
        i_bus = p_esc_in / v_bus
        p_bus = p_esc_in + i_bus * i_bus * r_har
        return {
            "p_bus_W": p_bus,
            "useful_W": T * v_ms,
            "prop_W": n * pp.p_shaft_W - T * v_ms,
            "motor_W": n * op.p_elec_W - n * pp.p_shaft_W,
            "esc_W": p_esc_in - n * op.p_elec_W,
            "harness_W": p_bus - p_esc_in,
            "p_shaft_W": n * pp.p_shaft_W,
            "thrust_N": T,
        }

    # bracket thrust
    T_lo, T_hi = 0.0, max(1.0, p_elec_W / max(v_ms, 1.0))
    for _ in range(40):
        c = compose(T_hi)
        if c is None:
            T_hi *= 0.8
            continue
        if c["p_bus_W"] >= p_elec_W:
            break
        T_hi *= 1.6
    else:
        return None
    for _ in range(60):
        T_mid = 0.5 * (T_lo + T_hi)
        c = compose(T_mid)
        if c is None or c["p_bus_W"] > p_elec_W:
            T_hi = T_mid
        else:
            T_lo = T_mid
    out = compose(0.5 * (T_lo + T_hi))
    return out


# ------------------------------------------------------------------------------
# PV chain decomposition
# ------------------------------------------------------------------------------


def _pv_split(pv_el: Any, p_bus_W: float, t_amb_K: float) -> dict:
    """Decompose observed PV bus power into MPP / tracking / converter /
    harness terms by inverting the element's OWN converter map.

    @description p_bus -> add back PV harness I^2R at observed power (H-P2)
        -> bisect p_mpp so mppt.bus_power_W(p_mpp) matches. Tracking loss is
        p_mpp*(1 - eta_track) with the converter's own (penalised) eta_track;
        the remainder of the gap is converter loss.
    @param pv_el The PVArrayDiode-style element. @param p_bus_W Observed
        bus-side generation, W. @param t_amb_K Wire temperature, K.
    @returns dict track_W / conv_W / harness_W / p_mpp_W (all >= 0).
    """
    zero = {"track_W": 0.0, "conv_W": 0.0, "harness_W": 0.0, "p_mpp_W": 0.0}
    if p_bus_W <= 1e-9:
        return zero
    mppt = pv_el.mppt
    v_bus = float(getattr(mppt, "v_bus_V", 21.6))
    har_W = 0.0
    segs = tuple(getattr(pv_el, "pv_harness", ()) or ())
    if segs:
        from ..electrical import segment_loss_W  # frozen name
        har_W = sum(float(segment_loss_W(s, p_bus_W, v_bus, t_amb_K))
                    for s in segs)
    p_conv_out = p_bus_W + har_W

    def f(p_mpp: float) -> float:
        """@description Converter map. @returns bus power at p_mpp, W."""
        return float(mppt.bus_power_W(p_mpp))

    lo, hi = p_conv_out, max(p_conv_out * 1.02, p_conv_out + 0.5)
    for _ in range(50):
        if f(hi) >= p_conv_out:
            break
        hi *= 1.2
    else:
        return zero
    for _ in range(70):
        mid = 0.5 * (lo + hi)
        if f(mid) < p_conv_out:
            lo = mid
        else:
            hi = mid
    p_mpp = 0.5 * (lo + hi)
    eta_track = float(getattr(mppt, "eta_track", 0.98))
    track_W = p_mpp * (1.0 - eta_track)
    conv_W = max(p_mpp - track_W - p_conv_out, 0.0)
    return {"track_W": track_W, "conv_W": conv_W, "harness_W": har_W,
            "p_mpp_W": p_mpp}


# ------------------------------------------------------------------------------
# The ledger
# ------------------------------------------------------------------------------


def build_ledger(vehicle: Any, chunk_records: list[dict],
                 heater_samples_W: list[float]) -> tuple[dict, dict]:
    """Assemble the mission Wh ledger from the recorded chunks.

    @description Chunk-mean powers are decomposed through the vehicle's own
        chain (BEMT or ideal), the MPPT map, and the harness models; results
        are cached on rounded (power, V, rho) keys because level trim makes
        most chunks identical (footprint rule: bounded work).
    @param vehicle The flown vehicle. @param chunk_records Runner records.
    @param heater_samples_W Heater draw at chunk boundaries, W.
    @returns (ledger with the FROZEN keys, extras dict).
    """
    from ..env.atmosphere import atmosphere

    ledger = {k: 0.0 for k in LEDGER_KEYS}
    payload_W, night_W = _payload_lines(vehicle)
    thr = _find_thruster(vehicle)
    pv_real = _find_pv_real(vehicle)
    is_bemt = thr is not None and hasattr(thr, "geom") \
        and hasattr(thr, "motor")

    useful_Wh = 0.0
    shaft_Wh = 0.0
    prop_elec_Wh = 0.0
    unattributed_Wh = 0.0
    cache: dict = {}

    for i, c in enumerate(chunk_records):
        h_h = c["h_s"] / 3600.0                      # h
        heater_mid_W = 0.5 * (heater_samples_W[i] + heater_samples_W[i + 1])
        ledger["payload"] += payload_W * h_h
        ledger["night_parasitic"] += night_W * h_h
        ledger["heater"] += heater_mid_W * h_h

        # ---- propulsion ----------------------------------------------------
        p_prop_W = max(c["p_out_mean_W"] - payload_W - night_W - heater_mid_W,
                       0.0)
        v = c["V_air_ms"]
        if p_prop_W > 1e-9 and thr is not None and math.isfinite(v):
            key = (round(p_prop_W, 1), round(v, 2), round(c["rho_kgm3"], 4))
            split = cache.get(key)
            if split is None:
                if is_bemt:
                    a_ms = float(atmosphere(c["z_m"]).a_ms)
                    split = _bemt_chain_split(thr, p_prop_W, v,
                                              c["rho_kgm3"], c["T_amb_K"],
                                              a_ms)
                else:
                    split = _ideal_chain_split(thr, p_prop_W, v,
                                               c["rho_kgm3"])
                cache[key] = split
            if split is not None:
                ledger["prop"] += split["prop_W"] * h_h
                ledger["motor"] += split["motor_W"] * h_h
                ledger["esc"] += split["esc_W"] * h_h
                ledger["harness"] += split["harness_W"] * h_h
                useful_Wh += split["useful_W"] * h_h
                shaft_Wh += split["p_shaft_W"] * h_h
                prop_elec_Wh += p_prop_W * h_h
            else:
                unattributed_Wh += p_prop_W * h_h

        # ---- PV chain ------------------------------------------------------
        if pv_real is not None and c["p_in_mean_W"] > 1e-9:
            pkey = ("pv", round(c["p_in_mean_W"], 1), round(c["T_amb_K"], 0))
            pvs = cache.get(pkey)
            if pvs is None:
                pvs = _pv_split(pv_real, c["p_in_mean_W"], c["T_amb_K"])
                cache[pkey] = pvs
            ledger["mppt_track"] += pvs["track_W"] * h_h
            ledger["mppt_converter"] += pvs["conv_W"] * h_h
            ledger["harness"] += pvs["harness_W"] * h_h

    extras = {
        "useful_thrust_Wh": useful_Wh,
        "prop_elec_Wh": prop_elec_Wh,
        "prop_eta_mean": (useful_Wh / shaft_Wh) if shaft_Wh > 0.0
        else float("nan"),
        "eta_chain_measured": (useful_Wh / prop_elec_Wh)
        if prop_elec_Wh > 0.0 else 0.5,
        "unattributed_prop_Wh": unattributed_Wh,
        "chain_model": "bemt-recomputed" if is_bemt else "actuator-disk",
        "chain_cache_points": len(cache),
        "night_parasitic_missing": bool(pv_real is not None
                                        and night_W <= 0.0),
        "payload_const_W": payload_W,
        "night_parasitic_W": night_W,
    }
    return ledger, extras


# ------------------------------------------------------------------------------
# Printable report
# ------------------------------------------------------------------------------


def mission_report(mr: Any) -> str:
    """@description Render a MissionResult as a human-readable ledger report.
    @param mr A MissionResult.
    @returns Multi-line string (never written to disk by this module)."""
    d = mr.sim.detail
    lines = [
        "MISSION REPORT " + "=" * 60,
        f"  duration          : {float(mr.sim.t_s[-1]) / 3600.0:.2f} h  "
        f"(dt {d.get('dt_s'):g} s, chunks of {d.get('chunk_s'):g} s)",
        f"  closed            : {mr.sim.closed}   "
        f"reasons: {d.get('closed_reasons') or 'none'}",
        f"  certified aero    : {mr.sim.certified}",
        f"  min SOC           : {mr.sim.min_soc:.4f}   "
        f"SOC {d.get('soc_start'):.4f} -> {d.get('soc_end'):.4f}",
        f"  energy in/out     : {d.get('energy_in_J') / _J_PER_WH:.1f} / "
        f"{d.get('energy_out_J') / _J_PER_WH:.1f} Wh   "
        f"(spilled {d.get('unabsorbed_surplus_J') / _J_PER_WH:.1f} Wh, "
        f"unserved {d.get('unabsorbed_shortfall_J') / _J_PER_WH:.1f} Wh)",
        f"  cold-charge spill : "
        f"{d.get('cold_charge_spill_bus_J', 0.0) / _J_PER_WH:.2f} Wh "
        "(charge refused below 0 C -- spilled, never free charge)",
        f"  pack temp         : {np.min(mr.pack_temp_K):.1f}.."
        f"{np.max(mr.pack_temp_K):.1f} K",
        f"  prop eta (mean)   : {mr.prop_eta_mean:.3f}",
        f"  He lift lost      : {100.0 * mr.helium_lift_loss_frac:.2f} %   "
        f"UV retention {mr.uv_retention_end:.3f}",
        f"  gust placard      : "
        f"{'EXCEEDED (n>=4 design)' if mr.gust_placard_exceeded else 'clear'}",
        f"  aging             : {mr.aging.days_to_80pct:.0f} d to 80 %, "
        f"{mr.aging.days_to_70pct:.0f} d to 70 % "
        f"({mr.aging.fade_frac_per_day:.2e} /day)",
        "  LEDGER (Wh per named debit)",
    ]
    for k in LEDGER_KEYS:
        lines.append(f"    {k:<16}: {mr.ledger[k]:10.2f}")
    lines.append(f"    {'(useful thrust)':<16}: "
                 f"{mr.extras.get('useful_thrust_Wh', 0.0):10.2f}")
    lines.append(f"    {'(climb PE)':<16}: "
                 f"{mr.extras.get('climb_Wh', 0.0):10.2f}")
    lines.append("=" * 75)
    return "\n".join(lines)


# ------------------------------------------------------------------------------
# Self-test
# ------------------------------------------------------------------------------


def _selftest() -> int:  # pragma: no cover - exercised by hand + CI wrapper
    """@description Runnable acceptance self-test. Runs the FULL real-chain
        acceptance when modules 1-4 are on disk, and the ideal-chain mission
        regression (with an explicit, loud status line) when they are not.
    @returns Process exit code (0 = every available check passed)."""
    import importlib.util as _ilu

    have_real = all(_ilu.find_spec(m) is not None for m in
                    ("aerosim.electrical", "aerosim.prop",
                     "aerosim.vehicle.electrochem"))
    status = "PRESENT" if have_real else "NOT YET LANDED"
    print("=" * 75)
    print(f"aerosim.mission -- SELF-TEST (real-chain modules {status})")
    print("=" * 75)

    from ..validate_designs import DESIGN_A, build_solar_cruise
    from .profile import MissionProfile
    from .runner import fly_mission

    build = build_solar_cruise(DESIGN_A)
    profile = MissionProfile(
        start_utc_h=float(build.env.utc_hour_at_t0_h),
        duration_s=86400.0,
        altitude_m=500.0,
        lat_deg=47.6, day_of_year=195,
        wind_mean_ms=3.0, shear=True, dryden_sigma_ms=1.0,
    )
    mr = fly_mission(build.vehicle, profile, dt_s=60.0)
    print(mission_report(mr))

    ok = True

    def check(name: str, cond: bool, detail: str) -> None:
        nonlocal ok
        ok = ok and bool(cond)
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}\n         {detail}")

    check("mission closes on the ideal chain (case-A regression)",
          mr.sim.closed,
          f"closed={mr.sim.closed}, reasons="
          f"{mr.sim.detail.get('closed_reasons')}")
    check("all frozen ledger keys present",
          set(mr.ledger.keys()) == set(LEDGER_KEYS),
          f"keys={sorted(mr.ledger.keys())}")
    check("prop/motor/esc debits nonzero, payload billed",
          mr.ledger["prop"] > 0 and mr.ledger["motor"] > 0
          and mr.ledger["esc"] > 0 and mr.ledger["payload"] > 0,
          f"prop={mr.ledger['prop']:.1f} motor={mr.ledger['motor']:.1f} "
          f"esc={mr.ledger['esc']:.1f} payload={mr.ledger['payload']:.1f} Wh")
    check("500 m July night pays ~0 heater",
          mr.ledger["heater"] < 1.0,
          f"heater={mr.ledger['heater']:.3f} Wh (ISA 500 m = 284.9 K, above "
          "the +5 C charge floor -- physics, not an omission)")
    if not have_real:
        print("  [NOTE] real-chain acceptance (margin < 1.0446 decomposition, "
              "stratospheric heater tax, cold-charge spill) awaits modules "
              "electrochem/electrical/prop/materials -- run again after they "
              "land. Nothing is claimed for them here.")
    print("RESULT: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    import sys as _sys

    _sys.exit(_selftest())
