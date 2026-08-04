"""HYBRID solar-dynastat study -- shared machinery (NEW file, package untouched).

Baseline airframe = the operator's Tier-1 wing exactly as TIER1_operator_eval.py
derives it (2.5 m / 0.52 m2 / AR 12 / taper 1, C60 cells 0.227 at packing
0.6923, pv_density 0.45, prop 0.30 m, payload 0.10 kg, honest floors:
payload_W = min_avionics_draw_W(total), extra_CD0 = 1.2 x min_extra_CD0 at the
trim Re, fus = 1.0 x min_fuselage_boom_tail_mass_kg). The ONLY changes here:
a BuoyancyVolume is added, the battery is free, and the wing incidence +
reference trim are re-derived for the RESIDUAL weight the wing actually carries.

BUOYANCY FRACTION DEFINITION (stated, used everywhere):
    f = gross Archimedes lift / all-up physical weight
      = rho_air * V * g / (M_allup * g)
with M_allup = wing-vehicle mass + envelope film (incl. tapes) + lifting gas.
At f = 1.0 the vehicle is exactly neutrally buoyant (trim V = 0, float).
The wing's residual lift requirement is then exactly (1-f) * M_allup * g:
the trim solver balances M_body*g (which excludes film+gas -- BuoyancyVolume
carries both inside its force term) against net element lift
rho_air*V*g - m_gas*g - m_film*g, and the algebra collapses to (1-f)*M_allup*g.

ENVELOPE ASSUMPTIONS (ledgered):
  * film areal density 0.035 kg/m2 (BALLOON_FILM_AREAL_DENSITY_KG_M2, 38 um
    LLDPE super-pressure practice, cited in buoyancy.py), x 1.10 for load
    tapes + fill valve (stated assumption).
  * superpressure at inflation 500 Pa (small SPB night margin).
  * in-sim shape is a SPHERE -- that is what BuoyancyVolume is; drag is the
    package's own Clift & Gauvin correlation on frontal area.
  * gas: helium, density ratio 0.13819 at equal p,T, charged at
    p_amb + 500 Pa -> rho_gas = rho_air * 0.13819 * (1 + dp/p).

FOOTPRINT: one process, BelowNormal priority, RAM guard before heavy loops.
"""
import ctypes
ctypes.windll.kernel32.SetPriorityClass(
    ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL

import dataclasses
import math
import time
import warnings

warnings.simplefilter("ignore")

import numpy as np

from aerosim import validate_bounds as bounds
from aerosim import validate_designs as vd
from aerosim.integrate import integrate_energy
from aerosim.validate import usable_energy, screen_design
from aerosim.validate_screen import min_avionics_draw_W
from aerosim.env import atmosphere
from aerosim.vehicle import Thruster
from aerosim.vehicle.buoyancy import (
    BALLOON_FILM_AREAL_DENSITY_KG_M2,
    HELIUM_DENSITY_RATIO,
    BuoyancyVolume,
    sphere_drag_coefficient,
)
from aerosim.vehicle.structure import (
    min_extra_CD0,
    min_fuselage_boom_tail_mass_kg,
    wing_mass_kg,
)

G0 = 9.80665
SPAN = 2.5
AREA = 0.52
TAPER = 1.0
PV_PACKING = 0.36 / AREA          # 21 x C60 cells = 0.36 m2 active
PAYLOAD_KG = 0.10
PROP_D = 0.30
ALT_M = 500.0
TAPE_FACTOR = 1.10                # tapes + valve on top of bare film (assumption)
SUPERPRESSURE_PA = 500.0
DAY_S = 86400.0
DT_S = 60.0
SOC_MIN = 0.05


def wait_for_ram(min_free_gb: float = 1.5) -> None:
    """Block until at least min_free_gb of physical RAM is free (footprint rule)."""
    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    st = MEMORYSTATUSEX()
    st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    while True:
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        if st.ullAvailPhys / 2**30 >= min_free_gb:
            return
        print(f"[ram-guard] {st.ullAvailPhys / 2**30:.2f} GB free < "
              f"{min_free_gb} GB -- waiting 30 s", flush=True)
        time.sleep(30.0)


# ---------------------------------------------------------------------------
# Envelope geometry + sizing
# ---------------------------------------------------------------------------

def sphere_dims(volume_m3: float) -> dict:
    r = (3.0 * volume_m3 / (4.0 * math.pi)) ** (1.0 / 3.0)
    return {"shape": "sphere", "radius_m": r, "diameter_m": 2.0 * r,
            "length_m": 2.0 * r, "surface_m2": 4.0 * math.pi * r * r,
            "frontal_m2": math.pi * r * r}


def ellipsoid3_dims(volume_m3: float) -> dict:
    """3:1 prolate spheroid: a = 3b, V = (4/3) pi a b^2 = 4 pi b^3."""
    b = (volume_m3 / (4.0 * math.pi)) ** (1.0 / 3.0)
    a = 3.0 * b
    e = math.sqrt(1.0 - (b / a) ** 2)
    surface = 2.0 * math.pi * b * b * (1.0 + (a / (b * e)) * math.asin(e))
    return {"shape": "3:1 ellipsoid", "radius_m": b, "diameter_m": 2.0 * b,
            "length_m": 2.0 * a, "surface_m2": surface,
            "frontal_m2": math.pi * b * b}


def size_envelope(f: float, m_wing_vehicle_kg: float, rho_air: float,
                  p_Pa: float, dims_fn=sphere_dims) -> dict:
    """Solve V such that rho_air * V = f * M_allup(V) (fixed point).

    M_allup(V) = M_wv + TAPE_FACTOR*afd*A(V) + rho_gas*V, with
    rho_gas = rho_air * 0.13819 * (1 + dp/p) (charged at p_amb + dp, ambient T).
    At f = 1.0 a +1e-6 relative excess is added so the float branch of the trim
    (lift >= weight - 1e-9 N) is numerically robust.
    """
    if f <= 0.0:
        return {"volume_m3": 0.0, "film_kg": 0.0, "gas_kg": 0.0,
                "M_allup_kg": m_wing_vehicle_kg, "f_actual": 0.0, "dims": None}
    rho_gas = rho_air * HELIUM_DENSITY_RATIO * (1.0 + SUPERPRESSURE_PA / p_Pa)
    boost = 1.0 + (1.0e-6 if f >= 1.0 else 0.0)
    V = f * m_wing_vehicle_kg / rho_air           # seed ignoring envelope self-mass
    for _ in range(200):
        d = dims_fn(V)
        film = TAPE_FACTOR * BALLOON_FILM_AREAL_DENSITY_KG_M2 * d["surface_m2"]
        gas = rho_gas * V
        m_allup = m_wing_vehicle_kg + film + gas
        V_new = boost * f * m_allup / rho_air
        if abs(V_new - V) < 1.0e-12 * max(V, 1.0):
            V = V_new
            break
        V = V_new
    d = dims_fn(V)
    film = TAPE_FACTOR * BALLOON_FILM_AREAL_DENSITY_KG_M2 * d["surface_m2"]
    gas = rho_gas * V
    m_allup = m_wing_vehicle_kg + film + gas
    return {"volume_m3": V, "film_kg": film, "gas_kg": gas,
            "M_allup_kg": m_allup, "f_actual": rho_air * V / m_allup, "dims": d}


# ---------------------------------------------------------------------------
# Hybrid build (in-sim path: wing vehicle + spherical BuoyancyVolume)
# ---------------------------------------------------------------------------

def hybrid_build(f: float, batt_kg: float, lat: float, doy: int,
                 prop_max_W: float = 100.0):
    """Assemble the hybrid: Tier-1 wing vehicle (honest floors) + helium sphere.

    Returns (build, info). build.reference / incidence are re-derived for the
    RESIDUAL weight (1-f)*M_allup*g where the closed-form reference trim
    certifies a point there; otherwise reference is set to None (reported).
    """
    atmo = atmosphere(ALT_M)
    rho, mu, p = float(atmo.rho_kgm3), float(atmo.mu_Pas), float(atmo.p_Pa)

    th = Thruster(diameter_m=PROP_D, max_electrical_power_W=prop_max_W,
                  n_rotors=1, figure_of_merit=0.85, eta_motor=0.85, eta_esc=0.95)
    wing = wing_mass_kg(SPAN, AREA, 3.0)
    pv_kg = AREA * 0.45
    carried = batt_kg + PAYLOAD_KG + th.mass_kg
    fus = min_fuselage_boom_tail_mass_kg(carried, SPAN) * 1.0
    m_wv = batt_kg + pv_kg + th.mass_kg + PAYLOAD_KG + wing + fus

    env_sz = size_envelope(f, m_wv, rho, p, sphere_dims)
    m_allup = env_sz["M_allup_kg"]
    payload_W = float(min_avionics_draw_W(m_allup))   # floor on the FULL mass

    # extra_CD0 fixed point at the RESIDUAL-weight reference Re (the wing flies
    # slower under buoyant offload; lower Re -> higher friction floor).
    geometry = vd._naca_geometry(SPAN, AREA, TAPER, 0.0, 0.0, 0.0)
    residual_N = max((1.0 - f) * m_allup * G0, 0.0)
    extra_CD0 = 0.010
    ref2 = None
    ref_note = "full-weight reference (residual trim not certified)"
    Re_floor = 104277.0                                # f = 0 fallback anchor
    if residual_N > 1.0e-6:
        for _ in range(4):
            try:
                ref2 = bounds.reference_trim(geometry, residual_N, rho, mu,
                                             extra_CD0)
            except Exception as exc:
                ref2 = None
                ref_note = f"reference_trim REFUSED: {type(exc).__name__}: {str(exc)[:120]}"
                break
            Re_floor = float(ref2.Re)
            new_cd0 = 1.2 * min_extra_CD0(carried, SPAN, AREA, Re_floor)
            if abs(new_cd0 - extra_CD0) < 1.0e-6:
                extra_CD0 = new_cd0
                break
            extra_CD0 = new_cd0
        if ref2 is not None:
            ref_note = "residual-weight reference"
    if ref2 is None:
        extra_CD0 = 1.2 * min_extra_CD0(carried, SPAN, AREA, Re_floor)

    design = dataclasses.replace(
        vd.DESIGN_A, name=f"hybrid_f{f:.2f}",
        span_m=SPAN, area_m2=AREA, taper_ratio=TAPER,
        twist_root_deg=0.0, twist_tip_deg=0.0,
        extra_CD0=extra_CD0, mass_all_up_kg=m_wv,
        battery_mass_kg=batt_kg, pack_Wh_per_kg=250.0,
        pv_efficiency=0.227, pv_packing=PV_PACKING,
        pv_areal_density_kg_m2=0.45,
        payload_W=payload_W, payload_mass_kg=PAYLOAD_KG,
        prop_diameter_m=PROP_D, n_rotors=1, prop_max_electrical_W=prop_max_W,
        altitude_m=ALT_M, latitude_deg=lat, day_of_year=int(doy),
    )
    build = vd.build_solar_cruise(design)

    if f > 0.0:
        bv = BuoyancyVolume(volume_m3=env_sz["volume_m3"],
                            film_mass_kg=env_sz["film_kg"],
                            superpressure_Pa=SUPERPRESSURE_PA)
        build.vehicle.elements.append(bv)
        build.vehicle.bind_masses()     # BuoyancyVolume: film+gas live in its force
        surface = build.vehicle.elements[0]
        if ref2 is not None:
            surface.incidence_deg = surface.best_endurance_alpha_deg(
                float(ref2.V_ms), rho, mu)
            build.meta["incidence_deg"] = float(surface.incidence_deg)
        build.reference = ref2          # residual-weight reference or None

    info = {"f": f, "batt_kg": batt_kg, "prop_max_W": prop_max_W,
            "m_wing_vehicle_kg": m_wv, "m_allup_kg": m_allup,
            "payload_W": payload_W, "extra_CD0": extra_CD0,
            "wing_kg": wing, "fus_kg": fus, "thruster_kg": th.mass_kg,
            "pv_kg": pv_kg, "residual_N": residual_N, "ref_note": ref_note,
            "envelope": env_sz}
    return build, info


def run_hybrid(build, info) -> dict:
    """One 24 h limit-cycle window + screens + diagnostics."""
    r = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, DT_S)
    e = usable_energy(r)
    try:
        adm, reasons = screen_design(build, r, check_seasonal=False)
    except Exception as exc:
        adm, reasons = False, [f"screen RAISED {type(exc).__name__}: {str(exc)[:140]}"]
    pin = np.asarray(r.power_in_W)
    pout = np.asarray(r.power_out_W)
    night = pin < 0.5
    day = ~night
    out = {
        "closed": bool(r.closed), "certified": bool(getattr(r, "certified", False)),
        "admissible": bool(adm), "reasons": [s[:160] for s in reasons],
        "min_soc": float(r.min_soc),
        "cap_Wh": float(build.meta["battery_capacity_Wh"]),
        "usable": float(e["margin_ratio_usable"]),
        "gross": float(e["margin_ratio_gross"]),
        "in_Wh": float(e["energy_in_gross_Wh"]),
        "out_Wh": float(e["energy_out_Wh"]),
        "spill_Wh": float(e["spilled_Wh"]),
        "unserved_Wh": float(e["unserved_Wh"]),
        "spill_pct": 100.0 * float(e["spilled_fraction_of_gross"]),
        "trim_V_ms": float(r.detail.get("trim_V_ms", float("nan"))),
        "night_W": float(np.mean(pout[night])) if night.any() else float("nan"),
        "day_out_W": float(np.mean(pout[day])) if day.any() else float("nan"),
        "unmet_N": float(r.detail.get("max_unmet_thrust_N", 0.0)),
        "uncert_steps": int(r.detail.get("uncertified_aero_steps",
                                         r.detail.get("n_uncertified_aero_steps", -1))),
        "closed_reasons": list(r.detail.get("closed_reasons", [])),
        "day_length_h": float(build.meta["day_length_h"]),
    }
    return out


def find_min_pack(f: float, lat: float, doy: int,
                  grid=(0.02, 0.05, 0.10, 0.20, 0.40, 0.70, 1.00, 1.50, 2.20, 3.00),
                  bisect_steps: int = 6, verbose: bool = True):
    """Smallest battery mass whose 24 h limit cycle closes, at buoyancy f.

    The propulsion rating is the smallest of a ladder {100, 200, 400, 800} W
    with zero unmet thrust (each step honestly re-billed in drive mass).
    Returns (best_pack_kg or None, result_at_best or last, info_at_best).
    """
    def evaluate(batt):
        for pmax in (100.0, 200.0, 400.0, 800.0):
            wait_for_ram()
            build, info = hybrid_build(f, batt, lat, doy, prop_max_W=pmax)
            res = run_hybrid(build, info)
            tol = 1.0e-6 * max(1.0, info["m_allup_kg"] * G0)
            if res["unmet_N"] <= tol:
                return res, info
        return res, info    # even 800 W saturated -- report as-is

    lo, hi, res_hi, info_hi = None, None, None, None
    prev = grid[0]
    for batt in grid:
        res, info = evaluate(batt)
        if verbose:
            print(f"    f={f:.2f} batt={batt:.3f} kg ({batt*250:5.1f} Wh) "
                  f"closed={res['closed']} min_soc={res['min_soc']:.4f} "
                  f"V={res['trim_V_ms']:.2f} night={res['night_W']:.2f} W "
                  f"unmet={res['unmet_N']:.2g} N prop={info['prop_max_W']:.0f} W",
                  flush=True)
        if res["closed"]:
            lo_val = prev if batt != grid[0] else None
            hi, res_hi, info_hi = batt, res, info
            lo = lo_val
            break
        prev = batt
    if hi is None:
        return None, res, info
    if lo is None:
        return hi, res_hi, info_hi          # closes at the smallest grid point
    for _ in range(bisect_steps):
        mid = 0.5 * (lo + hi)
        res, info = evaluate(mid)
        if verbose:
            print(f"    f={f:.2f} batt={mid:.3f} kg ({mid*250:5.1f} Wh) "
                  f"closed={res['closed']} min_soc={res['min_soc']:.4f}", flush=True)
        if res["closed"]:
            hi, res_hi, info_hi = mid, res, info
        else:
            lo = mid
    return hi, res_hi, info_hi
