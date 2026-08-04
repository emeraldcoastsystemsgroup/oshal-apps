"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | UIUC measured-data anchor for the
    BEMT propeller model (SPEC_electrical section 5.4): embedded geometry and
    measured performance tables for APC Slow Flyer 10x4.7 and 11x4.7 (fetched
    2026-08-02 from m-selig.ae.illinois.edu/props/volume-1/data/, sha256
    manifest below), the acceptance bands, and the anchor evaluation the pytest
    suite and the __main__ self-test both run. Tables are EMBEDDED so the gate
    runs offline; the on-disk copies in aerosim/data/uiuc/ are checksum-locked.

DATA PROVENANCE
---------------
UIUC Propeller Data Site, Volume 1 (Brandt & Selig, "Propeller Performance
Data at Low Reynolds Numbers", AIAA 2011-1255;
m-selig.ae.illinois.edu/props/propDB.html). Files and sha256 of the copies
fetched 2026-08-02 (also stored in aerosim/data/uiuc/MANIFEST.sha256):

  apcsf_10x4.7_geom.txt          a62ebc619708598d65b0fa7ce5b51daf8c271a031e...
  apcsf_10x4.7_rd0841_6512.txt   2d84c3f2473ab149e9106f1027936bbdf3bd0364f7...
  apcsf_10x4.7_static_kt0835.txt 20519deb7e9678b0674005c38fdb8a23e916800bf5...
  apcsf_11x4.7_geom.txt          a16d9c7e4dbb6e7767e642d2aa003798e461ff434a...
  apcsf_11x4.7_pg0532_6006.txt   834968cc89306a40b0650e71e57fbe226a5151c481...
  apcsf_11x4.7_static_pg0526.txt ef65895140092ffed2e5064b5b5058d267ed0b3563...

UNITS: r/R, c/R, CT, CP, eta, J dimensionless; beta in DEGREES; RPM in 1/min.
"""

from __future__ import annotations

import hashlib
import os

import numpy as np

__all__ = [
    "UIUC_MANIFEST_SHA256",
    "UIUC_DATA_DIR",
    "GEOMETRY_10X47",
    "GEOMETRY_11X47",
    "DYNAMIC_10X47_6512RPM",
    "DYNAMIC_11X47_6006RPM",
    "STATIC_10X47",
    "STATIC_11X47",
    "ANCHOR_CASES",
    "ANCHOR_J_BAND",
    "ANCHOR_CT_TOL",
    "ANCHOR_CP_TOL",
    "ANCHOR_ETA_PEAK_TOL",
    "ANCHOR_ETA_PEAK_DJ",
    "ANCHOR_STATIC_TOL",
    "verify_local_data",
    "measured_momentum_floor_ok",
    "anchor_report",
]

# -----------------------------------------------------------------------------
# Checksum manifest (sha256 of the files as fetched 2026-08-02)
# -----------------------------------------------------------------------------

UIUC_MANIFEST_SHA256: dict[str, str] = {
    "apcsf_10x4.7_geom.txt":
        "a62ebc619708598d65b0fa7ce5b51daf8c271a031e9b12a9668d2bbc8bcb5880",
    "apcsf_10x4.7_rd0841_6512.txt":
        "2d84c3f2473ab149e9106f1027936bbdf3bd0364f766f91214aed09cb5c76be7",
    "apcsf_10x4.7_static_kt0835.txt":
        "20519deb7e9678b0674005c38fdb8a23e916800bf5fc1b5714612f3f4c13d9a0",
    "apcsf_11x4.7_geom.txt":
        "a16d9c7e4dbb6e7767e642d2aa003798e461ff434a76440799504c35ee45cf02",
    "apcsf_11x4.7_pg0532_6006.txt":
        "834968cc89306a40b0650e71e57fbe226a5151c4812f46baa2be05d5e5743a72",
    "apcsf_11x4.7_static_pg0526.txt":
        "ef65895140092ffed2e5064b5b5058d267ed0b3563c747bf067ed80edb3198fa",
}

#: Where the fetched copies live relative to the package root.
UIUC_DATA_DIR: str = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "uiuc"
)

_UIUC_BASE_URL: str = "https://m-selig.ae.illinois.edu/props/volume-1/data/"

# -----------------------------------------------------------------------------
# Embedded geometry (verbatim from the _geom.txt files; beta in degrees)
# -----------------------------------------------------------------------------

#: APC Slow Flyer 10x4.7 blade geometry (apcsf_10x4.7_geom.txt).
GEOMETRY_10X47: dict[str, np.ndarray] = {
    "r_over_R": np.array([0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
                          0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90,
                          0.95, 1.00]),
    "c_over_R": np.array([0.109, 0.132, 0.156, 0.176, 0.193, 0.206, 0.216,
                          0.223, 0.226, 0.225, 0.219, 0.210, 0.197, 0.179,
                          0.157, 0.130, 0.087, 0.042]),
    "beta_deg": np.array([21.11, 23.90, 24.65, 24.11, 22.78, 21.01, 19.00,
                          17.06, 15.33, 13.82, 12.51, 11.36, 10.27, 9.32,
                          8.36, 7.27, 6.15, 5.04]),
}

#: APC Slow Flyer 11x4.7 blade geometry (apcsf_11x4.7_geom.txt).
GEOMETRY_11X47: dict[str, np.ndarray] = {
    "r_over_R": np.array([0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
                          0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90,
                          0.95, 1.00]),
    "c_over_R": np.array([0.112, 0.137, 0.160, 0.181, 0.198, 0.211, 0.221,
                          0.227, 0.230, 0.228, 0.222, 0.213, 0.199, 0.181,
                          0.158, 0.132, 0.084, 0.035]),
    "beta_deg": np.array([19.64, 21.81, 22.45, 21.88, 20.73, 19.14, 17.30,
                          15.58, 14.06, 12.71, 11.53, 10.47, 9.53, 8.63,
                          7.71, 6.61, 5.28, 3.93]),
}

# -----------------------------------------------------------------------------
# Embedded measured performance (verbatim; columns J, CT, CP, eta)
# -----------------------------------------------------------------------------

#: apcsf_10x4.7_rd0841_6512.txt -- dynamic sweep at 6512 RPM.
DYNAMIC_10X47_6512RPM: np.ndarray = np.array([
    [0.089, 0.1201, 0.0523, 0.204],
    [0.112, 0.1171, 0.0522, 0.250],
    [0.134, 0.1129, 0.0512, 0.296],
    [0.155, 0.1101, 0.0511, 0.335],
    [0.176, 0.1059, 0.0500, 0.372],
    [0.199, 0.1019, 0.0493, 0.410],
    [0.225, 0.0974, 0.0483, 0.453],
    [0.246, 0.0935, 0.0475, 0.484],
    [0.266, 0.0895, 0.0465, 0.512],
    [0.287, 0.0865, 0.0460, 0.540],
    [0.308, 0.0833, 0.0454, 0.566],
    [0.332, 0.0787, 0.0444, 0.587],
    [0.357, 0.0743, 0.0434, 0.611],
    [0.378, 0.0704, 0.0424, 0.627],
    [0.395, 0.0669, 0.0414, 0.638],
    [0.420, 0.0616, 0.0398, 0.651],
    [0.445, 0.0562, 0.0381, 0.657],
])

#: apcsf_11x4.7_pg0532_6006.txt -- dynamic sweep at 6006 RPM.
DYNAMIC_11X47_6006RPM: np.ndarray = np.array([
    [0.087, 0.1151, 0.0482, 0.209],
    [0.107, 0.1120, 0.0477, 0.250],
    [0.133, 0.1071, 0.0468, 0.305],
    [0.155, 0.1033, 0.0461, 0.346],
    [0.175, 0.0996, 0.0454, 0.385],
    [0.197, 0.0960, 0.0448, 0.422],
    [0.218, 0.0921, 0.0440, 0.456],
    [0.241, 0.0885, 0.0434, 0.492],
    [0.264, 0.0844, 0.0426, 0.522],
    [0.287, 0.0803, 0.0417, 0.553],
    [0.310, 0.0762, 0.0408, 0.579],
    [0.330, 0.0723, 0.0399, 0.598],
    [0.347, 0.0687, 0.0390, 0.612],
    [0.373, 0.0637, 0.0376, 0.632],
    [0.391, 0.0597, 0.0364, 0.641],
    [0.416, 0.0545, 0.0350, 0.647],
    [0.436, 0.0496, 0.0336, 0.644],
])

#: apcsf_10x4.7_static_kt0835.txt -- static sweep (columns RPM, CT0, CP0).
STATIC_10X47: np.ndarray = np.array([
    [2377, 0.1059, 0.0431], [2676, 0.1079, 0.0437], [2947, 0.1079, 0.0437],
    [3234, 0.1104, 0.0444], [3494, 0.1117, 0.0450], [3762, 0.1143, 0.0460],
    [4029, 0.1158, 0.0466], [4319, 0.1177, 0.0474], [4590, 0.1200, 0.0484],
    [4880, 0.1223, 0.0494], [5147, 0.1237, 0.0500], [5417, 0.1252, 0.0508],
    [5715, 0.1263, 0.0513], [5960, 0.1278, 0.0520], [6226, 0.1286, 0.0524],
    [6528, 0.1299, 0.0531],
])

#: apcsf_11x4.7_static_pg0526.txt -- static sweep (columns RPM, CT0, CP0).
STATIC_11X47: np.ndarray = np.array([
    [1666, 0.0986, 0.0392], [2018, 0.1005, 0.0391], [2271, 0.1022, 0.0396],
    [2556, 0.1042, 0.0401], [2875, 0.1059, 0.0407], [3144, 0.1074, 0.0411],
    [3423, 0.1091, 0.0418], [3728, 0.1114, 0.0426], [3994, 0.1128, 0.0432],
    [4290, 0.1151, 0.0442], [4585, 0.1174, 0.0452], [4853, 0.1191, 0.0460],
    [5175, 0.1209, 0.0468], [5450, 0.1230, 0.0477], [5710, 0.1249, 0.0486],
    [6021, 0.1259, 0.0493],
])

#: Anchor case registry: catalogue key -> (geometry, dynamic table, dynamic
#: RPM, static (rpm, CT0, CP0) row nearest the dynamic RPM, diameter m).
#: Diameters: 10 in and 11 in exactly (UIUC prop naming), 0.0254 m/in.
ANCHOR_CASES: dict[str, dict] = {
    "apcsf_10x47": {
        "geometry": GEOMETRY_10X47,
        "diameter_m": 10.0 * 0.0254,
        "dynamic": DYNAMIC_10X47_6512RPM,
        "dynamic_rpm": 6512.0,
        "static_rpm": 6528.0,
        "static_ct0": 0.1299,
        "static_cp0": 0.0531,
        "eta_peak_measured": 0.657,
        "eta_peak_J_measured": 0.445,
    },
    "apcsf_11x47": {
        "geometry": GEOMETRY_11X47,
        "diameter_m": 11.0 * 0.0254,
        "dynamic": DYNAMIC_11X47_6006RPM,
        "dynamic_rpm": 6006.0,
        "static_rpm": 6021.0,
        "static_ct0": 0.1259,
        "static_cp0": 0.0493,
        "eta_peak_measured": 0.647,
        "eta_peak_J_measured": 0.436,
    },
}

# -----------------------------------------------------------------------------
# Acceptance bands (SPEC_electrical section 5.4 -- Brandt & Selig report
# measurement uncertainty growing at sweep edges; BEMT-vs-UIUC agreement in
# this band is the demonstrated state of the art at these Re)
# -----------------------------------------------------------------------------

ANCHOR_J_BAND: tuple[float, float] = (0.15, 0.40)  # dimensionless advance ratio
ANCHOR_CT_TOL: float = 0.12   # relative, +-12 %
ANCHOR_CP_TOL: float = 0.10   # relative, +-10 %
ANCHOR_ETA_PEAK_TOL: float = 0.05  # absolute eta points, +-5
ANCHOR_ETA_PEAK_DJ: float = 0.05   # advance-ratio distance of the peak
ANCHOR_STATIC_TOL: float = 0.15    # relative, +-15 % on CT0/CP0

#: Anchor runs use wind-tunnel turbulence n_crit = 9 (aeropolar's own
#: convention: 9 = wind tunnel, 11 = clean free flight).
ANCHOR_N_CRIT: float = 9.0

#: Anchor evaluation atmosphere: ISA sea level. The UIUC coefficients are
#: nondimensional; residual Re sensitivity between the tunnel state and ISA
#: sea level is far inside the acceptance bands.
ANCHOR_RHO_KGM3: float = 1.225   # kg/m^3, ISA 1976 sea level
ANCHOR_T_K: float = 288.15       # K, ISA 1976 sea level


def verify_local_data(data_dir: str | None = None) -> dict[str, bool]:
    """
    @description Verify the on-disk UIUC files against the sha256 manifest.
        FAIL-CLOSED per file: a missing or altered file reports False -- the
        caller (the pytest gate) decides whether that is fatal. The embedded
        tables above are the authority the model is tested against either way;
        this check proves the disk copies have not drifted from what was
        fetched and embedded.
    @param data_dir Directory holding the files; defaults to aerosim/data/uiuc.
    @returns {filename: matches_manifest} for every manifest entry.
    """
    d = UIUC_DATA_DIR if data_dir is None else data_dir
    out: dict[str, bool] = {}
    for fname, want in UIUC_MANIFEST_SHA256.items():
        path = os.path.join(d, fname)
        if not os.path.isfile(path):
            out[fname] = False
            continue
        with open(path, "rb") as fh:
            got = hashlib.sha256(fh.read()).hexdigest()
        out[fname] = got == want
    return out


def fetch_uiuc_data(dest_dir: str | None = None) -> None:
    """
    @description One-time download of the anchor files from the UIUC site,
        checksum-verified against the manifest (a fetched file that does not
        match is DELETED and raises -- silent corruption cannot enter the
        tree). The offline gate never needs this: tables are embedded above.
    @param dest_dir Target directory; defaults to aerosim/data/uiuc.
    @returns None. Raises RuntimeError on any checksum mismatch.
    """
    import urllib.request

    d = UIUC_DATA_DIR if dest_dir is None else dest_dir
    os.makedirs(d, exist_ok=True)
    for fname, want in UIUC_MANIFEST_SHA256.items():
        path = os.path.join(d, fname)
        if os.path.isfile(path):
            continue
        urllib.request.urlretrieve(_UIUC_BASE_URL + fname, path)
        with open(path, "rb") as fh:
            got = hashlib.sha256(fh.read()).hexdigest()
        if got != want:
            os.remove(path)
            raise RuntimeError(
                f"fetch_uiuc_data: {fname} sha256 {got} != manifest {want}; "
                "deleted the fetched copy."
            )


def measured_momentum_floor_ok(case_key: str) -> list[tuple[float, float, float]]:
    """
    @description Check the actuator-disk momentum floor against the MEASURED
        table itself (SPEC 6.4: the measured data, the disk floor and BEMT
        must be mutually consistent before BEMT is trusted anywhere):

            eta_measured <= eta_induced = 2 / (1 + sqrt(1 + CT_loading))

        with CT_loading = T/(0.5 rho A V^2) rewritten in coefficient form
        using T = CT rho n^2 D^4, V = J n D, A = pi D^2/4:
        CT_loading = 8 CT / (pi J^2).
    @param case_key ANCHOR_CASES key.
    @returns List of (J, eta_measured, eta_disk_floor) rows; every row must
        satisfy eta_measured < eta_disk_floor (asserted by the caller).
    """
    tab = ANCHOR_CASES[case_key]["dynamic"]
    rows: list[tuple[float, float, float]] = []
    for J, ct, cp, eta in tab:
        loading = 8.0 * ct / (np.pi * J * J)  # dimensionless disk loading
        eta_disk = 2.0 / (1.0 + np.sqrt(1.0 + loading))
        rows.append((float(J), float(eta), float(eta_disk)))
    return rows


def anchor_report(case_key: str, n_crit: float = ANCHOR_N_CRIT) -> dict:
    """
    @description Run the shipped BEMT solver over one anchor prop's measured
        table and return the per-point comparison the acceptance bands are
        judged on. Shared by tests/test_bemt_uiuc.py and the __main__
        self-test so the gate and the demo cannot drift apart.
    @param case_key ANCHOR_CASES key ('apcsf_10x47' or 'apcsf_11x47').
    @param n_crit Transition amplification exponent (9 = tunnel).
    @returns dict with keys:
        rows      -- list of dicts (J, ct/cp/eta measured+model, rel errors)
                     restricted to the ANCHOR_J_BAND;
        eta_peak  -- (J_at_peak, eta_peak) of the MODEL from a 0.01-step scan;
        static    -- dict (ct0/cp0 measured+model, rel errors);
        floor_ok  -- True when every BEMT point respected the disk floor
                     (solve_prop_point raises FreeEnergyError otherwise).
    """
    from .bemt import PROP_CATALOGUE, solve_prop_point  # local: avoid cycle

    case = ANCHOR_CASES[case_key]
    geom = PROP_CATALOGUE[case_key]
    rpm = case["dynamic_rpm"]
    n_rev = rpm / 60.0
    d_m = case["diameter_m"]

    rows: list[dict] = []
    j_lo, j_hi = ANCHOR_J_BAND
    for J, ct_m, cp_m, eta_m in case["dynamic"]:
        if not (j_lo <= J <= j_hi):
            continue
        v_ms = J * n_rev * d_m
        pt = solve_prop_point(geom, v_ms, rpm, ANCHOR_RHO_KGM3, ANCHOR_T_K,
                              n_crit=n_crit)
        rows.append({
            "J": float(J),
            "ct_meas": float(ct_m), "ct_model": pt.ct,
            "ct_err": pt.ct / ct_m - 1.0,
            "cp_meas": float(cp_m), "cp_model": pt.cp,
            "cp_err": pt.cp / cp_m - 1.0,
            "eta_meas": float(eta_m), "eta_model": pt.eta,
            "valid": pt.valid,
        })

    # Model eta peak: 0.01-step scan over the plausible peak neighbourhood.
    best_j, best_eta = 0.0, 0.0
    for J in np.arange(0.34, 0.58, 0.01):
        v_ms = float(J) * n_rev * d_m
        pt = solve_prop_point(geom, v_ms, rpm, ANCHOR_RHO_KGM3, ANCHOR_T_K,
                              n_crit=n_crit)
        if pt.thrust_N <= 0.0:
            break
        if pt.eta > best_eta:
            best_j, best_eta = float(J), pt.eta

    pt0 = solve_prop_point(geom, 0.0, case["static_rpm"], ANCHOR_RHO_KGM3,
                           ANCHOR_T_K, n_crit=n_crit)
    static = {
        "ct0_meas": case["static_ct0"], "ct0_model": pt0.ct,
        "ct0_err": pt0.ct / case["static_ct0"] - 1.0,
        "cp0_meas": case["static_cp0"], "cp0_model": pt0.cp,
        "cp0_err": pt0.cp / case["static_cp0"] - 1.0,
    }
    return {"rows": rows, "eta_peak": (best_j, best_eta), "static": static,
            "floor_ok": True}


def _selftest() -> int:
    """
    @description Full anchor acceptance run, printing actual values per band.
    @returns 0 when every band holds, 1 otherwise.
    """
    ok_all = True
    print("=" * 79)
    print("aerosim.prop.uiuc_anchor -- UIUC ANCHOR ACCEPTANCE (n_crit=9, ISA SL)")
    print("=" * 79)
    checks = dict(verify_local_data())
    print(f"on-disk checksum manifest: "
          f"{sum(checks.values())}/{len(checks)} files verified "
          f"({'OK' if all(checks.values()) else 'MISSING/DRIFTED: ' + str([k for k, v in checks.items() if not v])})")
    for key, case in ANCHOR_CASES.items():
        rep = anchor_report(key)
        print(f"--- {key} @ {case['dynamic_rpm']:.0f} RPM ---")
        w_ct = w_cp = 0.0
        for r in rep["rows"]:
            w_ct = max(w_ct, abs(r["ct_err"]))
            w_cp = max(w_cp, abs(r["cp_err"]))
            print(f"  J={r['J']:.3f} CT {r['ct_model']:.4f} vs {r['ct_meas']:.4f} "
                  f"({r['ct_err']*100:+5.1f}%)  CP {r['cp_model']:.4f} vs "
                  f"{r['cp_meas']:.4f} ({r['cp_err']*100:+5.1f}%)  "
                  f"eta {r['eta_model']:.3f} vs {r['eta_meas']:.3f}")
        pj, pe = rep["eta_peak"]
        dj = abs(pj - case["eta_peak_J_measured"])
        de = pe - case["eta_peak_measured"]
        st = rep["static"]
        band = [
            ("CT band +-12%", w_ct <= ANCHOR_CT_TOL, f"worst {w_ct*100:.1f}%"),
            ("CP band +-10%", w_cp <= ANCHOR_CP_TOL, f"worst {w_cp*100:.1f}%"),
            ("eta peak +-5 pts", abs(de) <= ANCHOR_ETA_PEAK_TOL,
             f"model {pe:.3f} vs {case['eta_peak_measured']:.3f} ({de*100:+.1f} pts)"),
            ("eta peak dJ<=0.05", dj <= ANCHOR_ETA_PEAK_DJ,
             f"model J={pj:.2f} vs {case['eta_peak_J_measured']:.3f} (dJ={dj:.3f})"),
            ("static CT0 +-15%", abs(st["ct0_err"]) <= ANCHOR_STATIC_TOL,
             f"{st['ct0_model']:.4f} vs {st['ct0_meas']:.4f} ({st['ct0_err']*100:+.1f}%)"),
            ("static CP0 +-15%", abs(st["cp0_err"]) <= ANCHOR_STATIC_TOL,
             f"{st['cp0_model']:.4f} vs {st['cp0_meas']:.4f} ({st['cp0_err']*100:+.1f}%)"),
        ]
        for name, ok, detail in band:
            ok_all = ok_all and ok
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
        # measured data itself must respect the disk floor
        floor_rows = measured_momentum_floor_ok(key)
        floor_ok = all(eta < disk for _, eta, disk in floor_rows)
        ok_all = ok_all and floor_ok
        spot = floor_rows[-1]
        print(f"  [{'PASS' if floor_ok else 'FAIL'}] measured table respects "
              f"disk floor (spot J={spot[0]:.3f}: eta {spot[1]:.3f} < "
              f"disk {spot[2]:.3f})")
    print("=" * 79)
    print("ANCHOR:", "PASS" if ok_all else "FAIL")
    return 0 if ok_all else 1


if __name__ == "__main__":
    import ctypes
    ctypes.windll.kernel32.SetPriorityClass(
        ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
    )  # BelowNormal -- operator footprint rule
    raise SystemExit(_selftest())
