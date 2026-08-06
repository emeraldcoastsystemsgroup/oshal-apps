"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | fly_mission: the realistic end-to-end
  |                                           | flight (shear + Dryden + day/night +
  |                                           | cold pack + real electrical chain +
  |                                           | BEMT propulsion + He/UV decay), built
  |                                           | as chunked calls into the FROZEN
  |                                           | integrate.integrate_energy -- the
  |                                           | integrator is reused, never edited.
  |                                           | Mission-level storage replay with a
  |                                           | 0 C charge gate (spilled solar is
  |                                           | SPILLED, never free charge), gust
  |                                           | placard enforcement, ledger assembly
  |                                           | via mission/report.py.
2 | maintainer@emeraldcoastsystemsgroup.com   | Accepted-state integration alignment:
  |                                           | integrate_energy now advances pack thermal
  |                                           | and envelope chemistry once per accepted
  |                                           | step. Mission chunks remain the altitude,
  |                                           | boundary-sampling, hard-end and storage-
  |                                           | replay authority; they no longer compensate
  |                                           | for a dead integrator state path. Clarified
  |                                           | that real-ECM electrical authority remains
  |                                           | open rather than claiming it here.
3 | maintainer@emeraldcoastsystemsgroup.com   | SINGLE STORAGE AUTHORITY: real-chemistry
  |                                           | missions consume integrate_energy's accepted
  |                                           | BatteryElement.step -> PackEcm.step_power
  |                                           | trajectory directly. Mission replay is retained
  |                                           | only for explicit ideal storage, so real SOC,
  |                                           | I2R loss, rate refusal, throughput and aging are
  |                                           | never recomputed through flat efficiencies or
  |                                           | stepped a second time.
4 | maintainer@emeraldcoastsystemsgroup.com   | Make persistence diagnostics name their
  |                                           | actual authority: real packs report the
  |                                           | observed final-day ECM trajectory, while only
  |                                           | the ideal bucket describes a re-seeded replay.
-------------------------------------------------------------------------------

aerosim.mission.runner -- fly the wind-tunnel-perfected wing through real air.

DESIGN NOTES (why chunks)
    integrate.py advances pack thermal and envelope chemistry exactly once per
    accepted step, while its numerical trim/RK probes remain state-pure. It
    still does not command a varying altitude, so fly_mission integrates the
    order as short windows (default 900 s) through the PUBLIC integrate_energy
    API, samples those slow states at boundaries, applies hard-end checks and
    chains the battery's declared initial_soc. Bus power in level trim is
    independent of state of charge, so the chunked bus tape equals the
    monolithic one. Explicitly ideal storage is replayed once at mission level
    with its declared flat efficiencies. A real pack is different: every accepted
    interval has already passed exactly once through BatteryElement.step and
    PackEcm.step_power inside integrate_energy, so the mission concatenates that
    physical trajectory and MUST NOT replay or re-step it.

HONESTY LEDGER (module-level)
    H-R1  Climb billing chain efficiency: climbs commanded by an altitude
          profile are billed at the previous chunk's MEASURED propulsion
          chain efficiency, floored at 0.5 (no citation for the floor; it is
          deliberately LOW so a climb can only be over-billed, never under-
          billed). Descents credit nothing (no regen -- conservative).
    H-R2  Pack/envelope states are sampled at chunk boundaries (default
          900 s). The night heater hold and He/UV decay vary over hours, so
          boundary sampling resolves them to well under the +-10 % acceptance
          bands; sub-chunk transients are not resolved and are not claimed.
"""

from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from ..env.atmosphere import atmosphere
from ..integrate import EnvBundle, SimResult, integrate_energy
from .profile import (
    MissionProfile,
    build_wind_field,
    check_gust_placard,
    eta_track_dynamic_penalty,
)
from . import report as _report

# ------------------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------------------

#: Default mission chunk, s. 900 s resolves the diurnal heater/thermal cycle
#: to ~1 % of a night while keeping the chunk count of a week-long mission in
#: the hundreds (footprint rule: one python process, bounded work).
CHUNK_S_DEFAULT: float = 900.0

#: Charging below 0 C plates metallic lithium on the anode -- the industry
#: charge floor. Zhang, Xu & Jow, J. Power Sources 115 (2003); JEITA/battery
#: charging guidelines. The mission runner refuses to book charge below this
#: temperature into its storage replay: the energy SPILLS.
CHARGE_FLOOR_K: float = 273.15

#: Mission hard-end: SPEC_materials/BuoyancyVolume contract -- the flight ends
#: when envelope UV retention falls below 0.5.
UV_RETENTION_HARD_END: float = 0.5

#: Free-RAM floor, bytes, and the wait when below it (operator footprint rule).
_FREE_RAM_FLOOR_B: int = int(1.5 * 1024**3)
_RAM_WAIT_S: float = 60.0

_J_PER_WH: float = 3600.0


class MissionConfigError(RuntimeError):
    """Raised when the vehicle cannot fly the requested mission as configured.

    @description Wrong element mix (no battery, several batteries), an
        altitude order outside the atmosphere model, etc. Loud and early --
        never a quiet partial flight.
    """


@dataclass
class MissionResult:
    """The realistic flight's outcome. FROZEN field set (build contract).

    @param sim Concatenated SimResult (unchanged shape) over the mission;
        detail carries energy_in_J / energy_out_J / unabsorbed_* so
        validate.usable_energy applies to a mission unchanged.
    @param pack_temp_K Pack temperature at chunk boundaries, K.
    @param heater_Wh Total pack-heater energy, Wh.
    @param converter_loss_Wh MPPT converter loss, Wh (= ledger['mppt_converter']).
    @param harness_loss_Wh Copper + connector I^2R loss, Wh (= ledger['harness']).
    @param prop_eta_mean Energy-weighted mean propeller efficiency T*V/P_shaft.
    @param helium_lift_loss_frac Fraction of helium lift lost over the
        mission, dimensionless (0 for a pure fixed-wing).
    @param uv_retention_end Envelope UV strength retention at mission end
        (1.0 for a pure fixed-wing).
    @param aging Days-to-fade projection from the electrochemistry module.
    @param gust_placard_exceeded True when the environment exceeded the
        SPEC_materials section-3 placard (only reachable with an n>=4 design;
        an n=3 design raises GustPlacardError instead).
    @param ledger Wh per named debit. KEYS FROZEN: 'prop','motor','esc',
        'harness','mppt_converter','mppt_track','heater','night_parasitic',
        'payload'.
    @param extras Additional diagnostics (climb billing, cold-charge spill,
        reconciliation) -- additive, not part of the frozen contract.
    """

    sim: SimResult
    pack_temp_K: np.ndarray
    heater_Wh: float
    converter_loss_Wh: float
    harness_loss_Wh: float
    prop_eta_mean: float
    helium_lift_loss_frac: float
    uv_retention_end: float
    aging: Any
    gust_placard_exceeded: bool
    ledger: dict
    extras: dict = field(default_factory=dict)


# ------------------------------------------------------------------------------
# Footprint guard (operator rule: BelowNormal, free-RAM check)
# ------------------------------------------------------------------------------


def _footprint_guard() -> None:
    """@description Drop this process to BelowNormal priority and wait while
        free RAM is under 1.5 GB (operator footprint rule). Windows-only via
        ctypes; a silent no-op elsewhere.
    @returns None."""
    if not sys.platform.startswith("win"):  # pragma: no cover - dev box is win
        return
    try:
        import ctypes
        from ctypes import wintypes

        k32 = ctypes.windll.kernel32
        k32.SetPriorityClass(k32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL

        class _MemStat(ctypes.Structure):
            _fields_ = [("dwLength", wintypes.DWORD),
                        ("dwMemoryLoad", wintypes.DWORD),
                        ("ullTotalPhys", ctypes.c_uint64),
                        ("ullAvailPhys", ctypes.c_uint64),
                        ("ullTotalPageFile", ctypes.c_uint64),
                        ("ullAvailPageFile", ctypes.c_uint64),
                        ("ullTotalVirtual", ctypes.c_uint64),
                        ("ullAvailVirtual", ctypes.c_uint64),
                        ("ullAvailExtendedVirtual", ctypes.c_uint64)]

        stat = _MemStat()
        stat.dwLength = ctypes.sizeof(stat)
        for _ in range(3):
            if not k32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return
            if stat.ullAvailPhys >= _FREE_RAM_FLOOR_B:
                return
            time.sleep(_RAM_WAIT_S)
    except Exception:  # pragma: no cover - the guard must never kill physics
        return


# ------------------------------------------------------------------------------
# Element discovery (duck-typed on the FROZEN contract names)
# ------------------------------------------------------------------------------


def _find_battery(vehicle: Any) -> Any:
    """@description The mission's single storage element.
    @param vehicle The vehicle. @returns The battery element.
    @raises MissionConfigError With no or several packs (one mission, one
        accounting authority; split packs need explicit design work)."""
    packs = [el for el in getattr(vehicle, "elements", [])
             if hasattr(el, "capacity_J")]
    if len(packs) != 1:
        raise MissionConfigError(
            f"fly_mission needs exactly ONE storage element, found "
            f"{len(packs)}. A multi-pack mission needs its own accounting "
            "design; refusing to guess.")
    return packs[0]


def _find_buoyancy(vehicle: Any) -> Optional[Any]:
    """@description The envelope element, when the vehicle carries one.
    @returns The BuoyancyVolume-like element or None."""
    for el in getattr(vehicle, "elements", []):
        if hasattr(el, "volume_m3"):
            return el
    return None


def _design_n_limit(vehicle: Any) -> float:
    """@description The design load factor the vehicle states.
    @param vehicle The vehicle (attr design_load_factor_n, set explicitly by
        the mission-design layer for an n=4 build).
    @returns Declared n, dimensionless; structure.py's default 3.0 otherwise."""
    from ..vehicle.structure import DESIGN_LOAD_FACTOR_DEFAULT
    return float(getattr(vehicle, "design_load_factor_n",
                         DESIGN_LOAD_FACTOR_DEFAULT))


def _pack_is_real(pack: Any) -> bool:
    """@description Does this pack run a real electrochemistry?
    @returns True when pack.chemistry exists and is not 'ideal'."""
    return str(getattr(pack, "chemistry", "ideal")) != "ideal"


# ------------------------------------------------------------------------------
# Mission-level storage replay -- the accounting authority
# ------------------------------------------------------------------------------


def _replay_mission_storage(
    t_s: np.ndarray,
    p_in_W: np.ndarray,
    p_out_W: np.ndarray,
    pack: Any,
    charge_ok: np.ndarray,
    soc0: float,
) -> dict:
    """Replay the pack over the mission bus tape with the 0 C charge gate.

    @description Same storage physics integrate.py applies (eta asymmetry,
        SOC rails) at step resolution, PLUS the plating gate: a step whose
        pack temperature is below CHARGE_FLOOR_K refuses charge -- the bus
        surplus spills (bus-side units, the change-log-#6 convention:
        surplus += overshoot/eta_charge, shortfall += deficit*eta_discharge).
        Acceptance anchor 4: commanded cold charge is SPILLED solar in the
        ledger, never free charge.
    @param t_s [N] s. @param p_in_W / p_out_W [N] W, bus-side tapes.
    @param pack The storage element (rails and etas read off it).
    @param charge_ok [N] bool, False where pack temperature forbids charging.
    @param soc0 Starting state of charge for THIS replay, dimensionless.
    @returns dict: soc [N], surplus_J, shortfall_J, cold_spill_bus_J,
        min_soc, soc_start, soc_end.
    """
    cap_J = float(pack.capacity_J)
    eta_c = float(getattr(pack, "eta_charge", 0.95))
    eta_d = float(getattr(pack, "eta_discharge", 0.95))
    soc_min = float(getattr(pack, "soc_min", 0.05))
    soc_max = float(getattr(pack, "soc_max", 1.0))
    soc0 = float(soc0)

    n = t_s.size
    soc = np.zeros(n)
    soc[0] = soc0
    E_J = soc0 * cap_J
    E_min_J, E_max_J = soc_min * cap_J, soc_max * cap_J
    surplus_J = 0.0
    shortfall_J = 0.0
    cold_spill_bus_J = 0.0
    for k in range(1, n):
        h = float(t_s[k] - t_s[k - 1])
        p_net = 0.5 * ((p_in_W[k] + p_in_W[k - 1])
                       - (p_out_W[k] + p_out_W[k - 1]))
        if p_net >= 0.0:
            if charge_ok[k]:
                E_J += p_net * eta_c * h
            else:
                # Plating gate: the charge is REFUSED and the bus surplus
                # spills in full (bus-side meter).
                cold_spill_bus_J += p_net * h
                surplus_J += p_net * h
        else:
            E_J += p_net / eta_d * h
        if E_J > E_max_J:
            surplus_J += (E_J - E_max_J) / eta_c   # bus-side conversion
            E_J = E_max_J
        elif E_J < E_min_J:
            shortfall_J += (E_min_J - E_J) * eta_d  # bus-side conversion
            E_J = E_min_J
        soc[k] = E_J / cap_J
    return {
        "soc": soc, "surplus_J": surplus_J, "shortfall_J": shortfall_J,
        "cold_spill_bus_J": cold_spill_bus_J,
        "min_soc": float(np.min(soc)), "soc_start": soc0,
        "soc_end": float(soc[-1]),
    }


# ------------------------------------------------------------------------------
# fly_mission
# ------------------------------------------------------------------------------


def fly_mission(
    vehicle: Any,
    profile: MissionProfile,
    dt_s: float = 60.0,
) -> MissionResult:
    """Fly a vehicle through the FULL realistic mission. FROZEN signature.

    @description Wind shear + Dryden turbulence + day-night solar + accepted
        cold-pack/envelope state, integrated through integrate_energy in chunks (see
        the module docstring), with:
          * gust placard enforcement (SPEC_materials section 3) BEFORE flight;
          * the GV-5 15 Hz eta_track dynamic penalty computed from the Dryden
            spectrum and applied to the MPPT (footprint rule: closed form);
          * a 0 C plating gate in the mission storage replay (cold charge
            spills, acceptance anchor 4);
          * per-debit Wh ledger with the FROZEN key set.
    @param vehicle The assembled vehicle (exactly one storage element).
    @param profile The MissionProfile order.
    @param dt_s Slow-loop step, s (default 60 -- the certified solar step).
    @returns MissionResult.
    @raises GustPlacardError When the environment exceeds the placard on an
        n < 4 design.
    @raises MissionConfigError On an unflyable configuration.
    """
    _footprint_guard()
    t_wall0 = time.perf_counter()

    pack = _find_battery(vehicle)
    envelope = _find_buoyancy(vehicle)
    placard_exceeded = check_gust_placard(profile, _design_n_limit(vehicle))

    # ---- environment -------------------------------------------------------
    wind = build_wind_field(profile, dt_s)
    env = EnvBundle(
        wind=wind,
        latitude_deg=profile.lat_deg,
        longitude_deg=0.0,          # site longitude shifts solar phase only;
        # the profile pins the phase via start_utc_h, so 0.0 loses nothing.
        day_of_year=profile.day_of_year,
        utc_hour_at_t0_h=profile.start_utc_h,
    )

    # ---- the GV-5 15 Hz hold rule (spectrum-computed, applied to the MPPT) --
    eta_track_note = _apply_eta_track_penalty(vehicle, profile)

    # ---- chunk plan --------------------------------------------------------
    chunk_s = max(float(dt_s), round(CHUNK_S_DEFAULT / dt_s) * float(dt_s))
    n_chunks = max(1, int(math.ceil(profile.duration_s / chunk_s)))

    body0 = vehicle.bodies[0]
    z0 = profile.cruise_altitude_m()
    body0.pos_m = np.asarray(body0.pos_m, dtype=float).copy()
    body0.pos_m[2] = z0

    soc_max_original = float(getattr(pack, "soc_max", 1.0))
    pack_real = _pack_is_real(pack)
    throughput0_Ah = float(getattr(pack, "throughput_Ah", 0.0))
    cold_spill0_J = float(getattr(pack, "cold_charge_spill_J", 0.0))
    soc_mission_start = float(pack.initial_soc)   # BEFORE chunk chaining
    # mutates it -- the replay must be seeded with what the mission started at

    # histories
    t_hist: list[np.ndarray] = []
    pos_hist: list[np.ndarray] = []
    vel_hist: list[np.ndarray] = []
    pin_hist: list[np.ndarray] = []
    pout_hist: list[np.ndarray] = []
    re_means: list[float] = []
    pack_temp_samples: list[float] = [
        float(getattr(pack, "pack_temp_K",
                      atmosphere(z0).T_K))]
    heater_samples_W: list[float] = [float(getattr(pack, "last_heater_W", 0.0))]
    chunk_records: list[dict] = []
    charge_ok_hist: list[np.ndarray] = []
    real_soc_hist: list[np.ndarray] = []
    real_surplus_J = 0.0
    real_shortfall_J = 0.0
    reasons: list[str] = []
    certified = True
    worst_resid_N = 0.0
    re_lo, re_hi = math.inf, -math.inf
    climb_bus_J = 0.0
    eta_chain_meas = 0.5   # HONESTY H-R1 floor until measured
    uv_hard_end = False

    t0 = 0.0
    z_cmd_prev = z0
    for ic in range(n_chunks):
        t1 = min(t0 + chunk_s, profile.duration_s)
        # -- altitude for this chunk + climb billing (H-R1) ------------------
        # Only COMMANDED altitude changes are billed: gust-induced altitude
        # wander inside a chunk is re-pinned to the command at the boundary
        # (altitude hold at chunk resolution), not taxed as a climb -- a
        # vertical-gust random walk is not a climb order.
        z_cmd = profile.altitude_at_frac(t0 / max(profile.duration_s, 1e-9))
        dz = z_cmd - z_cmd_prev
        z_cmd_prev = z_cmd
        if dz > 1e-6:
            mass_kg = sum(float(b.mass_kg) for b in vehicle.bodies)
            e_bus_J = mass_kg * 9.80665 * dz / max(eta_chain_meas, 0.5)
            climb_bus_J += e_bus_J
            if pack_real:
                # The climb is one accepted electrical event. Route it through the same
                # PackEcm authority as cruise instead of subtracting a flat-eta SOC delta.
                climb_dt_s = max(float(dt_s), 1.0)
                unserved_W = float(pack.step(-e_bus_J / climb_dt_s, climb_dt_s))
                if unserved_W < 0.0:
                    real_shortfall_J += -unserved_W * climb_dt_s
                pack.initial_soc = float(pack.soc)
            else:
                eta_d = float(getattr(pack, "eta_discharge", 0.95))
                d_soc = e_bus_J / eta_d / float(pack.capacity_J)
                pack.initial_soc = max(float(pack.initial_soc) - d_soc,
                                       float(getattr(pack, "soc_min", 0.05)))
        body0.pos_m[2] = z_cmd

        # -- cold-charge clamp so the storage replay cannot book charge ------
        temp_K = float(getattr(pack, "pack_temp_K", atmosphere(z_cmd).T_K))
        chunk_charge_ok = (not pack_real) or (temp_K >= CHARGE_FLOOR_K)
        # A real PackEcm owns the below-0-C plating wall. Mutating the wrapper's
        # soc_max here would create a second, flat clamp that disagrees with ecm.soc_max.
        # `charge_ok` remains a recorded diagnostic and the ideal replay input only.

        res = integrate_energy(vehicle, env, t0, t1, dt_s)

        certified = certified and bool(res.certified)
        worst_resid_N = max(worst_resid_N,
                            float(res.worst_trim_residual_N)
                            if math.isfinite(res.worst_trim_residual_N) else 0.0)
        if math.isfinite(res.cruise_Re_min):
            re_lo = min(re_lo, float(res.cruise_Re_min))
            re_hi = max(re_hi, float(res.cruise_Re_max))
        if math.isfinite(res.mean_cruise_Re):
            re_means.append(float(res.mean_cruise_Re))
        unmet_N = float(res.detail.get("max_unmet_thrust_N", 0.0))
        if unmet_N > 1e-6:
            reasons.append(f"chunk {ic}: unmet thrust {unmet_N:.4g} N -- the "
                           "installed propulsion cannot fly this trim")

        # -- record (drop the duplicated boundary point after chunk 0) -------
        s = 0 if ic == 0 else 1
        t_hist.append(res.t_s[s:])
        pos_hist.append(res.pos_m[s:])
        vel_hist.append(res.vel_ms[s:])
        pin_hist.append(res.power_in_W[s:])
        pout_hist.append(res.power_out_W[s:])
        charge_ok_hist.append(
            np.full(res.t_s.size - s, chunk_charge_ok, dtype=bool))
        if pack_real:
            real_soc_hist.append(
                np.asarray(res.detail["soc_as_seeded"], dtype=float)[s:]
            )
            real_surplus_J += float(
                res.detail.get("unabsorbed_surplus_J", 0.0)
            )
            real_shortfall_J += float(
                res.detail.get("unabsorbed_shortfall_J", 0.0)
            )

        # -- chain the pack + sample the slow states -------------------------
        soc_seeded = np.asarray(res.detail["soc_as_seeded"], dtype=float)
        soc_end = float(soc_seeded[-1]) if soc_seeded.size else \
            float(pack.initial_soc)
        pack.initial_soc = min(max(soc_end,
                                   float(getattr(pack, "soc_min", 0.05))),
                               float(getattr(pack, "soc_max", 1.0)))
        state = getattr(pack, "state", None)
        if not pack_real and state is not None and hasattr(state, "soc") \
                and hasattr(state, "energy_J"):
            # BatteryState is an immutable NamedTuple: rebuild, don't mutate.
            pack.state = type(state)(
                energy_J=pack.initial_soc * float(pack.capacity_J),
                soc=pack.initial_soc,
            )

        pack_temp_samples.append(
            float(getattr(pack, "pack_temp_K", atmosphere(z_cmd).T_K)))
        heater_samples_W.append(float(getattr(pack, "last_heater_W", 0.0)))

        atmo_c = atmosphere(z_cmd)
        h_s = t1 - t0
        chunk_records.append({
            "t0_s": t0, "t1_s": t1, "h_s": h_s,
            "z_m": z_cmd,
            "rho_kgm3": float(atmo_c.rho_kgm3),
            "T_amb_K": float(atmo_c.T_K),
            "V_air_ms": float(res.detail.get("trim_V_ms", float("nan"))),
            "p_in_mean_W": float(np.mean(res.power_in_W)),
            "p_out_mean_W": float(np.mean(res.power_out_W)),
            "heater_W": heater_samples_W[-1],
            "pack_temp_K": pack_temp_samples[-1],
            "charge_ok": bool(chunk_charge_ok),
        })

        # -- position/velocity continuity ------------------------------------
        body0.pos_m = np.asarray(res.pos_m[-1], dtype=float).copy()
        body0.vel_ms = np.asarray(res.vel_ms[-1], dtype=float).copy()

        # -- envelope hard-end (UV) ------------------------------------------
        if envelope is not None:
            uv_ret = float(getattr(envelope, "uv_retention", 1.0))
            if uv_ret < UV_RETENTION_HARD_END:
                uv_hard_end = True
                reasons.append(
                    f"mission hard-ended at t = {t1:.0f} s: envelope UV "
                    f"retention {uv_ret:.3f} fell below "
                    f"{UV_RETENTION_HARD_END} (SPEC_materials UV "
                    "photodegradation contract)")
                t0 = t1
                break
        t0 = t1

    if pack_real:
        pack.soc_max = soc_max_original

    # ---- assemble the mission tapes ----------------------------------------
    t_all = np.concatenate(t_hist)
    pin_all = np.concatenate(pin_hist)
    pout_all = np.concatenate(pout_hist)
    charge_ok_all = np.concatenate(charge_ok_hist)

    if pack_real:
        # The accepted ECM trajectory IS the answer. Replaying it would advance aging
        # twice and replace nonlinear voltage/current loss with a flat eta. Persistence is
        # observed over the final full day when the mission is multi-day; a 72 h flight
        # therefore compares day three's phase-aligned endpoints without fabricating a
        # fixed point from a mutable electrochemical state machine.
        soc_actual = np.concatenate(real_soc_hist)
        cold_spill_J = max(
            0.0, float(getattr(pack, "cold_charge_spill_J", 0.0)) - cold_spill0_J
        )
        replay = {
            "soc": soc_actual,
            "surplus_J": real_surplus_J,
            "shortfall_J": real_shortfall_J,
            "cold_spill_bus_J": cold_spill_J,
            "min_soc": float(np.min(soc_actual)),
            "soc_start": float(soc_actual[0]),
            "soc_end": float(soc_actual[-1]),
        }
        period_start_s = max(float(t_all[0]), float(t_all[-1]) - DAY_S_LOCAL)
        period_i = int(np.searchsorted(t_all, period_start_s, side="left"))
        period_soc = soc_actual[period_i:]
        replay_lc = {
            "soc": period_soc,
            "surplus_J": real_surplus_J,
            "shortfall_J": real_shortfall_J,
            "cold_spill_bus_J": cold_spill_J,
            "min_soc": float(np.min(period_soc)),
            "soc_start": float(period_soc[0]),
            "soc_end": float(period_soc[-1]),
        }
    else:
        # Explicit ideal storage has no element-owned nonlinear state, so the mission's
        # flat-efficiency replay remains its one accounting authority.
        replay = _replay_mission_storage(t_all, pin_all, pout_all, pack,
                                         charge_ok_all, soc_mission_start)
        replay_lc = _replay_mission_storage(t_all, pin_all, pout_all, pack,
                                            charge_ok_all, replay["soc_end"])

    trapz = getattr(np, "trapezoid", None) or np.trapz  # numpy-2 safe
    energy_in_J = float(trapz(pin_all, t_all)) if t_all.size > 1 else 0.0
    energy_out_J = float(trapz(pout_all, t_all)) if t_all.size > 1 else 0.0

    # Mission-level closure: serve every demand, keep off the floor, preserve charge
    # over the relevant persistence window, and consume only certified aerodynamics.
    # The persistence window is the observed final day for a real ECM and a re-seeded
    # replay only for the explicitly ideal bucket.
    if replay["shortfall_J"] > 1e-6 or replay_lc["shortfall_J"] > 1e-6:
        reasons.append(
            f"{max(replay['shortfall_J'], replay_lc['shortfall_J']) / _J_PER_WH:.1f} "
            "Wh of demand went unserved over the mission")
    if replay_lc["soc_end"] < replay_lc["soc_start"] - 1e-6 \
            and profile.duration_s >= DAY_S_LOCAL:
        if pack_real:
            reasons.append(
                f"no sustainable real-ECM trajectory: over the observed final day "
                f"the pack loses ground ({replay_lc['soc_start']:.4f} -> "
                f"{replay_lc['soc_end']:.4f})")
        else:
            reasons.append(
                f"no sustainable periodic state: re-seeded at its own end state "
                f"({replay_lc['soc_start']:.4f}) the pack still loses ground "
                f"({replay_lc['soc_end']:.4f})")
    if not certified:
        reasons.append("one or more chunks consumed uncertified aerodynamics")
    closed = not reasons

    cap_J = float(pack.capacity_J)
    sim = SimResult(
        t_s=t_all,
        pos_m=np.concatenate(pos_hist),
        vel_ms=np.concatenate(vel_hist),
        soc=replay["soc"],
        power_in_W=pin_all,
        power_out_W=pout_all,
        battery_energy_J=replay["soc"] * cap_J,
        closed=closed,
        min_soc=replay["min_soc"],
        mean_cruise_Re=float(np.mean(re_means)) if re_means else float("nan"),
        certified=certified,
        worst_trim_residual_N=worst_resid_N,
        cruise_Re_min=re_lo if math.isfinite(re_lo) else float("nan"),
        cruise_Re_max=re_hi if math.isfinite(re_hi) else float("nan"),
        detail={
            "mode": "mission",
            "dt_s": dt_s,
            "chunk_s": chunk_s,
            "closed_reasons": reasons,
            "energy_in_J": energy_in_J,
            "energy_out_J": energy_out_J,
            "energy_margin_J": energy_in_J - energy_out_J,
            "unabsorbed_surplus_J": replay["surplus_J"],
            "unabsorbed_shortfall_J": replay["shortfall_J"],
            "cold_charge_spill_bus_J": replay["cold_spill_bus_J"],
            "soc_start": replay["soc_start"],
            "soc_end": replay["soc_end"],
            "limit_cycle_soc0": replay_lc["soc_start"],
            "limit_cycle_soc_end": replay_lc["soc_end"],
            "limit_cycle_min_soc": replay_lc["min_soc"],
            "storage_authority": (
                "BatteryElement.step->PackEcm.step_power"
                if pack_real else "mission-flat-efficiency-replay"
            ),
            "uv_hard_end": uv_hard_end,
            "eta_track_note": eta_track_note,
            "wall_clock_s": time.perf_counter() - t_wall0,
        },
    )

    # ---- ledger + chain decomposition (mission/report.py) ------------------
    ledger, extras = _report.build_ledger(vehicle, chunk_records,
                                          heater_samples_W)
    eta_chain_meas = extras.get("eta_chain_measured", eta_chain_meas)

    extras.update({
        "climb_Wh": climb_bus_J / _J_PER_WH,
        "cold_charge_spill_Wh": replay["cold_spill_bus_J"] / _J_PER_WH,
        "pack_cold_charge_spill_J": float(
            getattr(pack, "cold_charge_spill_J", 0.0)),
        "plating_violation_Ah": float(
            getattr(pack, "plating_violation_Ah", 0.0)),
        "throughput_Ah": float(getattr(pack, "throughput_Ah", 0.0))
        - throughput0_Ah,
        "capacity_fade_frac": float(getattr(pack, "capacity_fade_frac", 0.0)),
        "resistance_growth_frac": float(
            getattr(pack, "resistance_growth_frac", 0.0)),
        "eta_track_note": eta_track_note,
    })

    aging = _project_aging(pack, replay, extras, pack_temp_samples,
                           profile.duration_s)

    he_loss = 0.0
    uv_end = 1.0
    if envelope is not None:
        he_loss = 1.0 - float(getattr(envelope, "helium_frac_remaining", 1.0))
        uv_end = float(getattr(envelope, "uv_retention", 1.0))

    return MissionResult(
        sim=sim,
        pack_temp_K=np.asarray(pack_temp_samples, dtype=float),
        heater_Wh=float(ledger["heater"]),
        converter_loss_Wh=float(ledger["mppt_converter"]),
        harness_loss_Wh=float(ledger["harness"]),
        prop_eta_mean=float(extras.get("prop_eta_mean", float("nan"))),
        helium_lift_loss_frac=he_loss,
        uv_retention_end=uv_end,
        aging=aging,
        gust_placard_exceeded=placard_exceeded,
        ledger=ledger,
        extras=extras,
    )


#: One solar day, s (kept module-local so the closure test above reads plainly).
DAY_S_LOCAL: float = 86400.0


def _apply_eta_track_penalty(vehicle: Any, profile: MissionProfile) -> dict:
    """@description Compute the GV-5 15 Hz hold-rule penalty from the Dryden
        spectrum and apply it to the vehicle's MPPT eta_track (restored by the
        caller owning the vehicle; the mutation is recorded, never silent).
    @param vehicle The vehicle. @param profile The mission order.
    @returns A note dict {applied, penalty, eta_track_before/after}."""
    note = {"applied": False, "penalty": 0.0}
    if profile.dryden_sigma_ms <= 0.0:
        return note
    mppt = None
    for el in getattr(vehicle, "elements", []):
        cand = getattr(el, "mppt", None)
        if cand is not None and hasattr(cand, "bus_power_W"):
            mppt = cand
            break
    if mppt is None or not hasattr(mppt, "eta_track"):
        return note
    # Airspeed reference: the trim speed is unknown before flight; the mean
    # wind + 8 m/s solar-plane cruise floor is a conservative (slow) proxy --
    # slower V means MORE penalty, so this can only over-bill.
    v_ref = max(8.0, profile.wind_mean_ms)
    pen = eta_track_dynamic_penalty(profile.dryden_sigma_ms, v_ref)
    before = float(mppt.eta_track)
    mppt.eta_track = max(0.90, before * (1.0 - pen))  # spec lower bound 0.90
    note.update({"applied": True, "penalty": pen,
                 "eta_track_before": before,
                 "eta_track_after": float(mppt.eta_track),
                 "v_ref_ms": v_ref})
    return note


def _project_aging(pack: Any, replay: dict, extras: dict,
                   pack_temp_samples: list, duration_s: float) -> Any:
    """@description Days-to-fade projection through the electrochemistry
        module's own project_days_to_fade, from the mission's measured daily
        throughput and DOD. An ideal pack does not age -- that IS the fidelity
        gap, reported loudly as an infinite projection, never hidden.
    @returns AgingProjection (electrochem's, when available)."""
    days = max(duration_s / DAY_S_LOCAL, 1e-9)
    chem = str(getattr(pack, "chemistry", "ideal"))
    if chem != "ideal":
        try:
            from ..vehicle.electrochem import project_days_to_fade
            soc = replay["soc"]
            dod = float(np.max(soc) - np.min(soc))
            mean_v = _mean_cell_V(chem)
            return project_days_to_fade(
                chem,
                daily_throughput_Ah=extras.get("throughput_Ah", 0.0) / days,
                daily_dod_frac=dod,
                mean_cell_V=mean_v,
                pack_temp_profile_K=np.asarray(pack_temp_samples, dtype=float),
            )
        except ImportError as exc:
            raise MissionConfigError(
                f"pack declares chemistry {chem!r} but the electrochemistry "
                f"module is not available: {exc}") from exc
    from collections import namedtuple
    _NoAging = namedtuple("AgingProjection",
                          ["days_to_80pct", "days_to_70pct",
                           "fade_frac_per_day"])
    return _NoAging(math.inf, math.inf, 0.0)


def _mean_cell_V(chem: str) -> float:
    """@description Mid-SOC open-circuit voltage from the electrochemistry
        module's own OCV curve -- never a hand-typed number.
    @param chem Chemistry key. @returns OCV at SOC 0.5, V."""
    from ..vehicle.electrochem import ocv_V
    return float(ocv_V(chem, 0.5))
