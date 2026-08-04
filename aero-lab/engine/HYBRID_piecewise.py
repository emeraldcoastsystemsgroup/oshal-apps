"""PATH-2 piecewise 24 h closure of the hybrid, OUTSIDE the integrator.

WHY THIS PATH EXISTS (stated in the report): the in-sim BuoyancyVolume is a
SPHERE by construction (Clift & Gauvin drag on frontal area) -- the honest
in-sim sweep shows sphere drag alone makes every intermediate f energy-negative.
The only way the hybrid thesis can survive is a STREAMLINED hull, which the
shipped element cannot express and the package must not be edited to express.
So the 24 h loop is closed here from the outside, using the SAME modules the
sim uses for everything else:

  * atmosphere(500 m), env.solar via the shipped PVArray.evaluate on a 60 s
    grid (identical cells/packing/density to the Tier-1 wing),
  * the wing's trimmed polar point from validate_bounds.reference_trim at the
    RESIDUAL weight (1-f)*M_allup*g -- the same closed form the validation gate
    cross-checks the integrator against, with the same extra_CD0 floor x 1.2
    fixed-pointed at the residual-trim Re,
  * the shipped Thruster's electrical_power_W (actuator disk + motor/ESC chain)
    for propulsion pricing, drive mass billed off the same ladder,
  * battery round trip at the integrator's own eta_charge/discharge = 0.95,
    soc_min = 0.05, limit-cycle closure = start full at sunset, never touch the
    floor, and be FULL again by the next sunset.

ENVELOPE DRAG MODELS:
  sphere    -- the package's own sphere_drag_coefficient(Re_D) on frontal area
               (cross-check against the in-sim PATH-1 runs).
  ellipsoid -- 3:1 prolate spheroid at the flight Re: turbulent flat-plate
               ITTC-57 Cf = 0.075/(log10(Re_L)-2)^2 on the true wetted area,
               Hoerner form factor FF = 1 + 1.5/fr^1.5 + 7/fr^3 = 1.548 at
               fineness fr = 3 (Hoerner, Fluid-Dynamic Drag 1965, Ch. 6;
               streamlined airship hulls measure CD_vol ~ 0.02-0.03 on V^(2/3)
               at Re 1e6-1e8 -- the computed CD_vol is printed per f so the
               correlation can be checked against that band). Fully-turbulent
               Cf is the honest choice for a taped, seamed film hull.

Same buoyancy-fraction definition and film/tape/superpressure assumptions as
HYBRID_common. Superheat is ledgered at the end via the shipped
BuoyancyVolume._thermal_step on the same grid (sphere thermal geometry -- an
approximation for the ellipsoid, stated).
"""
import json
import math

import numpy as np

import HYBRID_common as H
from aerosim import validate_bounds as bounds
from aerosim import validate_designs as vd
from aerosim.env import atmosphere, make_uniform_field, solar
from aerosim.vehicle import BodyState, PVArray, Thruster
from aerosim.vehicle.buoyancy import BuoyancyVolume, sphere_drag_coefficient
from aerosim.vehicle.structure import min_extra_CD0, min_fuselage_boom_tail_mass_kg
from aerosim.validate_screen import min_avionics_draw_W

LON = 8.5
ETA_C = 0.95
ETA_D = 0.95
SOC_MIN = 0.05
DT_H = 60.0 / 3600.0
N_STEPS = 1440
FF_ELLIPSOID = 1.0 + 1.5 / 3.0 ** 1.5 + 7.0 / 3.0 ** 3   # Hoerner, fr = 3
PACK_WH_KG = 250.0


def pv_profile_Wh(lat: float, doy: int) -> np.ndarray:
    """Bus-side PV power on the 60 s grid, W, from the SHIPPED PVArray element.

    Window starts at local sunset (the sim's own convention) so the pack
    survives a whole night before it may recharge.
    """
    atmo = atmosphere(H.ALT_M)
    wind = make_uniform_field(0.0, 0.0, 0.0).sample(0.0, 0.0, H.ALT_M, 0.0)
    array = PVArray(area_m2=H.AREA, cell_efficiency_stc=0.227,
                    packing_factor=H.PV_PACKING, tilt_deg=0.0,
                    azimuth_deg=180.0, areal_density_kg_m2=0.45)
    body = BodyState(pos_m=np.array([0.0, 0.0, H.ALT_M]),
                     vel_ms=np.zeros(3), mass_kg=1.0)
    t0_utc_h = vd._sunset_utc_hour(lat, LON, doy)
    p = np.zeros(N_STEPS)
    for k in range(N_STEPS):
        utc_h = t0_utc_h + k * DT_H
        sol = solar(lat, LON, doy, utc_h, H.ALT_M, 0.0, 180.0)
        p[k] = max(float(array.evaluate([body], atmo, wind, sol,
                                        k * 60.0, 60.0).power_elec_W), 0.0)
    return p


def cycle_closes(cap_Wh: float, p_pv: np.ndarray, load_W: float) -> dict:
    """One 24 h limit cycle: start FULL at sunset. Closed iff no demand is
    unserved (the SOC floor is never pierced) AND the pack RETURNS TO FULL at
    some point during the day -- the state then repeats cycle after cycle
    (the sim's own sustainability criterion; requiring full at the WINDOW END
    would be wrong, because the window ends at the next sunset, after the
    evening discharge has already begun)."""
    store = cap_Wh
    spill = 0.0
    unserved = 0.0
    min_store = store
    went_below = False
    refulled = False
    for k in range(N_STEPS):
        net_W = p_pv[k] - load_W
        if net_W >= 0.0:
            room_bus_Wh = (cap_Wh - store) / ETA_C
            absorbed = min(net_W * DT_H, room_bus_Wh)
            store += absorbed * ETA_C
            spill += net_W * DT_H - absorbed
        else:
            take = (-net_W) * DT_H / ETA_D
            avail = store - SOC_MIN * cap_Wh
            if take > avail:
                unserved += (take - avail) * ETA_D
                take = avail
            store -= take
        if store < cap_Wh - 1.0e-6:
            went_below = True
        elif went_below:
            refulled = True
        min_store = min(min_store, store)
    return {"closed": bool(unserved <= 1.0e-9 and (refulled or not went_below)),
            "min_soc": min_store / cap_Wh if cap_Wh > 0 else 0.0,
            "spill_Wh": spill, "unserved_Wh": unserved,
            "end_soc": store / cap_Wh if cap_Wh > 0 else 0.0}


def min_cap_Wh(p_pv: np.ndarray, load_W: float) -> float | None:
    """Smallest capacity that closes, or None (energy-negative / cannot refull)."""
    cap = 1.0
    while cap < 60000.0:
        if cycle_closes(cap, p_pv, load_W)["closed"]:
            break
        cap *= 1.4
    else:
        return None
    lo, hi = cap / 1.4, cap
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        if cycle_closes(mid, p_pv, load_W)["closed"]:
            hi = mid
        else:
            lo = mid
    return hi


def evaluate_f(f: float, shape: str, p_pv: np.ndarray, verbose=True) -> dict:
    """Fixed point over pack mass: masses -> envelope -> trim -> load -> pack."""
    atmo = atmosphere(H.ALT_M)
    rho, mu, p_Pa = float(atmo.rho_kgm3), float(atmo.mu_Pas), float(atmo.p_Pa)
    dims_fn = H.sphere_dims if shape == "sphere" else H.ellipsoid3_dims
    geometry = vd._naca_geometry(H.SPAN, H.AREA, H.TAPER, 0.0, 0.0, 0.0)
    wing_kg = H.wing_mass_kg(H.SPAN, H.AREA, 3.0)
    pv_kg = H.AREA * 0.45

    batt_kg, prop_max_W = 0.10, 100.0
    out = {}
    for it in range(24):
        th = Thruster(diameter_m=H.PROP_D, max_electrical_power_W=prop_max_W,
                      n_rotors=1, figure_of_merit=0.85, eta_motor=0.85,
                      eta_esc=0.95)
        carried = batt_kg + H.PAYLOAD_KG + th.mass_kg
        fus = min_fuselage_boom_tail_mass_kg(carried, H.SPAN)
        m_wv = batt_kg + pv_kg + th.mass_kg + H.PAYLOAD_KG + wing_kg + fus
        env_sz = H.size_envelope(f, m_wv, rho, p_Pa, dims_fn)
        m_allup = env_sz["M_allup_kg"]
        payload_W = float(min_avionics_draw_W(m_allup))
        residual_N = max((1.0 - f) * m_allup * H.G0, 0.0)

        if f >= 1.0 or residual_N <= 1.0e-9:
            V = 0.0
            D_wing = D_env = 0.0
            ref_note, Re_env, cd_vol = "float (V=0)", 0.0, 0.0
        else:
            extra_CD0, ref2 = 0.010, None
            for _ in range(4):
                try:
                    ref2 = bounds.reference_trim(geometry, residual_N, rho, mu,
                                                 extra_CD0, max_iter=150)
                except Exception as exc:
                    out["ref_refused"] = f"{type(exc).__name__}: {str(exc)[:120]}"
                    ref2 = None
                    break
                new_cd0 = 1.2 * min_extra_CD0(carried, H.SPAN, H.AREA,
                                              float(ref2.Re))
                if abs(new_cd0 - extra_CD0) < 1.0e-6:
                    extra_CD0 = new_cd0
                    break
                extra_CD0 = new_cd0
            if ref2 is None:
                return {"f": f, "shape": shape, "FAILED": out.get("ref_refused")}
            V = float(ref2.V_ms)
            q = 0.5 * rho * V * V
            D_wing = q * H.AREA * float(ref2.CD)     # wing + extra_CD0, whole vehicle
            d = env_sz["dims"]
            if d is None:                            # f = 0: no envelope, no drag
                D_env, Re_env, cd_vol = 0.0, 0.0, 0.0
            elif shape == "sphere":
                Re_env = rho * V * d["diameter_m"] / mu
                cd_frontal = sphere_drag_coefficient(Re_env)
                D_env = q * cd_frontal * d["frontal_m2"]
                cd_vol = cd_frontal * d["frontal_m2"] / env_sz["volume_m3"] ** (2 / 3)
            else:
                Re_env = rho * V * d["length_m"] / mu
                cf = 0.075 / (math.log10(max(Re_env, 1.0e4)) - 2.0) ** 2
                D_env = q * FF_ELLIPSOID * cf * d["surface_m2"]
                cd_vol = (FF_ELLIPSOID * cf * d["surface_m2"]
                          / env_sz["volume_m3"] ** (2 / 3))
            out["ref"] = {"V": V, "CL": float(ref2.CL), "CD": float(ref2.CD),
                          "Re": float(ref2.Re), "extra_CD0": extra_CD0}

        D_total = D_wing + D_env
        P_prop = (th.electrical_power_W(D_total, V, rho) if D_total > 0.0 else 0.0)
        # honest drive rating: smallest ladder step covering the demand
        need_W = P_prop * 1.05
        new_prop = next((s for s in (100.0, 200.0, 400.0, 800.0) if s >= need_W),
                        800.0)
        load_W = P_prop + payload_W

        cap = min_cap_Wh(p_pv, load_W)
        if cap is None:
            return {"f": f, "shape": shape, "closes": False, "V": V,
                    "load_W": load_W, "P_prop_W": P_prop, "payload_W": payload_W,
                    "D_wing_N": D_wing, "D_env_N": D_env, "cd_vol": cd_vol,
                    "m_allup": m_allup, "env": env_sz,
                    "why": f"energy-negative: load {load_W:.1f} W x 24 h = "
                           f"{load_W * 24:.0f} Wh vs harvest "
                           f"{np.sum(p_pv) * DT_H:.0f} Wh"}
        new_batt = cap / PACK_WH_KG
        if abs(new_batt - batt_kg) < 1.0e-3 and new_prop == prop_max_W:
            batt_kg = new_batt
            break
        batt_kg = new_batt
        prop_max_W = new_prop

    cyc = cycle_closes(cap, p_pv, load_W)
    return {"f": f, "shape": shape, "closes": True, "iters": it,
            "V": V, "load_W": load_W, "P_prop_W": P_prop,
            "payload_W": payload_W, "D_wing_N": D_wing, "D_env_N": D_env,
            "cd_vol": cd_vol, "Re_env": Re_env,
            "cap_Wh": cap, "batt_kg": batt_kg, "prop_max_W": prop_max_W,
            "m_allup": m_allup, "m_wv": m_wv, "env": env_sz,
            "fus_kg": fus, "th_kg": th.mass_kg, "wing_kg": wing_kg,
            "min_soc": cyc["min_soc"], "spill_Wh": cyc["spill_Wh"],
            "harvest_Wh": float(np.sum(p_pv) * DT_H),
            "ref": out.get("ref")}


def superheat_ledger(f: float, V_air: float, lat: float, doy: int) -> dict:
    """Peak superheat / superpressure / film hoop stress over the 24 h grid,
    via the SHIPPED BuoyancyVolume thermal model (sphere geometry)."""
    atmo = atmosphere(H.ALT_M)
    rho, p_Pa = float(atmo.rho_kgm3), float(atmo.p_Pa)
    m_wv = 1.6   # representative; thermal result is insensitive to sizing detail
    env_sz = H.size_envelope(f, m_wv, rho, p_Pa, H.sphere_dims)
    bv = BuoyancyVolume(volume_m3=env_sz["volume_m3"],
                        film_mass_kg=env_sz["film_kg"],
                        superpressure_Pa=H.SUPERPRESSURE_PA)
    bv._inflate(atmo)
    t0_utc_h = vd._sunset_utc_hour(lat, LON, doy)
    peak = {"superheat_K": -1e9, "superpressure_Pa": -1e9}
    lows = {"superpressure_Pa": 1e9}
    for k in range(2 * N_STEPS):          # two days so the cycle settles
        utc_h = t0_utc_h + k * DT_H
        sol = solar(lat, LON, doy, utc_h, H.ALT_M, 0.0, 180.0)
        diag = bv._thermal_step(atmo, sol, V_air, 60.0)
        if k >= N_STEPS:
            sp = bv.superpressure_Pa(p_Pa)
            if diag["superheat_K"] > peak["superheat_K"]:
                peak["superheat_K"] = diag["superheat_K"]
            peak["superpressure_Pa"] = max(peak["superpressure_Pa"], sp)
            lows["superpressure_Pa"] = min(lows["superpressure_Pa"], sp)
    r = env_sz["dims"]["radius_m"]
    t_film = 38.0e-6
    hoop_MPa = peak["superpressure_Pa"] * r / (2.0 * t_film) / 1.0e6
    return {"volume_m3": env_sz["volume_m3"], "radius_m": r,
            "peak_superheat_K": peak["superheat_K"],
            "peak_superpressure_Pa": peak["superpressure_Pa"],
            "min_superpressure_Pa": lows["superpressure_Pa"],
            "hoop_stress_at_peak_MPa_38um": hoop_MPa}


def main() -> int:
    H.wait_for_ram()
    results = []
    for lat, doy, tag in ((47.6, 195, "A d195"), (47.6, 80, "B d80 equinox")):
        print(f"\n########## site {tag} ##########", flush=True)
        p_pv = pv_profile_Wh(lat, doy)
        print(f"  harvest available {np.sum(p_pv) * DT_H:.1f} Wh/day "
              f"(peak {np.max(p_pv):.1f} W)", flush=True)
        for shape in ("sphere", "ellipsoid"):
            print(f"\n  ---- {shape} ----", flush=True)
            for f in (0.0, 0.25, 0.50, 0.75, 0.90, 1.00):
                r = evaluate_f(f, shape, p_pv)
                r["site"] = tag
                results.append(r)
                if r.get("FAILED"):
                    print(f"   f={f:.2f}: reference REFUSED: {r['FAILED']}",
                          flush=True)
                    continue
                if not r["closes"]:
                    print(f"   f={f:.2f}: NO pack closes -- {r['why']} "
                          f"(V={r['V']:.2f} m/s D_wing={r['D_wing_N']:.2f} N "
                          f"D_env={r['D_env_N']:.2f} N cd_vol={r['cd_vol']:.3f})",
                          flush=True)
                    continue
                d = r["env"]["dims"]
                size = (f"dia {d['diameter_m']:.2f} m" if shape == "sphere" else
                        f"{d['length_m']:.2f} x {d['diameter_m']:.2f} m") if d else "-"
                print(f"   f={f:.2f}: pack {r['cap_Wh']:7.1f} Wh "
                      f"({r['batt_kg']:.3f} kg) M_allup {r['m_allup']:.3f} kg "
                      f"V {r['V']:.2f} m/s load {r['load_W']:.2f} W "
                      f"(prop {r['P_prop_W']:.2f} + pay {r['payload_W']:.2f}) "
                      f"D_w {r['D_wing_N']:.2f} D_e {r['D_env_N']:.2f} N "
                      f"cd_vol {r['cd_vol']:.3f} env {r['env']['volume_m3']:.2f} m3 "
                      f"{size} min_soc {r['min_soc']:.3f} "
                      f"spill {r['spill_Wh']:.0f} Wh", flush=True)

    print("\n#### superheat ledger (sphere thermal model, d195, f=0.75 size, "
          "airspeed = 4 m/s) ####", flush=True)
    sh = superheat_ledger(0.75, 4.0, 47.6, 195)
    print(json.dumps(sh, indent=1), flush=True)
    print("\n#### superheat at float (f=1.0, airspeed 0 -- worst convection) ####",
          flush=True)
    sh0 = superheat_ledger(1.0, 0.0, 47.6, 195)
    print(json.dumps(sh0, indent=1), flush=True)

    with open("HYBRID_piecewise_result.json", "w") as fh:
        json.dump(results, fh, indent=1, default=str)
    print("\nwrote HYBRID_piecewise_result.json", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
