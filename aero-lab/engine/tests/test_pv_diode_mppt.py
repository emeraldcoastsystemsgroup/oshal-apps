"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Acceptance + regression tests
    for the electrical module's PV chain (SPEC_electrical sections 1, 2, 6.2):
    import-time C60 re-extraction against the datasheet bin table (MPP to
    1e-6 of Vmp*Imp, 1 % of the binned Pmpp, quartet recheck to 0.5 %),
    Lambert-W vs Newton < 1e-12 A, De Soto both-ways temperature honesty, the
    GV-5 converter anchors (>= 95 % at 4 W, peak <= 99.85 %, 2.7 mW night),
    the vendor-peak wall at construction AND at runtime, PVArrayDiode's
    bit-identical flat path, the required-argument walls, and the
    walked-parameter FreeEnergyError / recheck guards.

Runs under pytest AND standalone:
    .venv/Scripts/python.exe tests/test_pv_diode_mppt.py
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# FOOTPRINT rule: this process runs at BelowNormal priority.
if sys.platform == "win32":  # pragma: no branch
    try:
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )
    except Exception:
        pass

import numpy as np

from aerosim.electrical import (
    C60_BIN_TABLE,
    C60_CELL_AREA_M2,
    DiodeParams,
    G_REF_WM2,
    HarnessSegment,
    MAX_CONVERTER_ETA,
    MPPTConverter,
    T_REF_K,
    c60_stc_efficiency,
    desoto_scaled_params,
    extract_c60_params,
    gv5_converter,
    iv_current_A,
    string_mpp,
)
from aerosim.electrical.pv_diode import _voc_cell_V
from aerosim.env.atmosphere import AtmoSample
from aerosim.env.solar import SolarSample
from aerosim.env.wind import WindSample
from aerosim.powerplant import FreeEnergyError
from aerosim.vehicle import BodyState, PVArray, ParamBoundsError
from aerosim.vehicle.param_bounds import recheck_element_params
from aerosim.vehicle.pv_real import PVArrayDiode

# --------------------------------------------------------------------------- #
# IMPORT-TIME RE-EXTRACTION (SPEC 1.5): the parameters used by every test     #
# below are re-derived from the datasheet bin table when this module loads,   #
# never hardcoded. A broken extractor fails collection loudly.                #
# --------------------------------------------------------------------------- #
BIN_PARAMS: dict[str, DiodeParams] = {
    b: extract_c60_params(b, 1.0) for b in ("G", "H", "I")
}


def _sample_env(t_air_K: float = 288.15, sun_up: bool = True):
    """
    @description A daylight (or night) environment triple for element
        evaluate() calls: sea-level-ish atmosphere, still wind, and a solar
        sample whose orientation-independent components are self-consistent
        (GHI = DNI*sin(el) + DHI, the identity energy.py asserts).
    @param t_air_K Ambient air temperature, K.
    @param sun_up True for the daylight sample, False for the dark one.
    @returns (bodies, atmo, wind, sol) ready for evaluate().
    """
    atmo = AtmoSample(T_K=t_air_K, p_Pa=101325.0, rho_kgm3=1.225,
                      mu_Pas=1.79e-5, a_ms=340.3)
    wind = WindSample(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    if sun_up:
        el = math.radians(55.0)
        dni, dhi = 900.0, 90.0
        sol = SolarSample(elevation_rad=el, azimuth_rad=math.pi,
                          dni_Wm2=dni, dhi_Wm2=dhi,
                          ghi_Wm2=dni * math.sin(el) + dhi, poa_Wm2=0.0)
    else:
        sol = SolarSample(elevation_rad=-0.2, azimuth_rad=0.0, dni_Wm2=0.0,
                          dhi_Wm2=0.0, ghi_Wm2=0.0, poa_Wm2=0.0)
    body = BodyState(pos_m=np.array([0.0, 0.0, 500.0]),
                     vel_ms=np.array([10.0, 0.0, 0.0]), mass_kg=6.93)
    return [body], atmo, wind, sol


def _diode_array(**overrides) -> PVArrayDiode:
    """
    @description The baseline case-A-class diode array used across the element
        tests: AtlantikSolar planform numbers, 30-series C60 string, GV-5
        converter.
    @param overrides Constructor overrides.
    @returns PVArrayDiode.
    """
    kwargs = dict(
        area_m2=1.72,
        cell_efficiency_stc=0.237,
        packing_factor=0.802,
        areal_density_kg_m2=0.40,
        n_series_cells=30,
        mppt=gv5_converter(),
    )
    kwargs.update(overrides)
    return PVArrayDiode(**kwargs)


# --------------------------------------------------------------------------- #
# Section 1: single-diode extraction and solvers                              #
# --------------------------------------------------------------------------- #


def test_import_time_extraction_mpp_within_bands():
    """MPP to 1e-6 of Vmp*Imp and 1 % of the binned Pmpp, all three bins."""
    for bin_id, spec in C60_BIN_TABLE.items():
        p = BIN_PARAMS[bin_id]
        mpp = string_mpp(p, 1, G_REF_WM2, T_REF_K)
        vi = spec.vmp_V * spec.imp_A
        assert abs(mpp.p_W - vi) / vi < 1.0e-6, (bin_id, mpp.p_W, vi)
        assert abs(mpp.p_W - spec.pmpp_W) / spec.pmpp_W < 0.01, (bin_id, mpp)


def test_extraction_reproduces_datasheet_quartet():
    """(Voc, Isc, Vmp, Imp) reproduced to 0.5 % at recheck, all bins."""
    for bin_id, spec in C60_BIN_TABLE.items():
        p = BIN_PARAMS[bin_id]
        isc = iv_current_A(p, 0.0, G_REF_WM2, T_REF_K)
        voc = _voc_cell_V(desoto_scaled_params(p, G_REF_WM2, T_REF_K))
        mpp = string_mpp(p, 1, G_REF_WM2, T_REF_K)
        assert abs(isc - spec.isc_A) / spec.isc_A < 0.005
        assert abs(voc - spec.voc_V) / spec.voc_V < 0.005
        assert abs(mpp.v_V - spec.vmp_V) / spec.vmp_V < 0.005
        assert abs(mpp.i_A - spec.imp_A) / spec.imp_A < 0.005


def test_bin_i_reference_set_pinned():
    """The n = 1.00 bin-I set matches the SPEC 1.5 pinned values."""
    p = BIN_PARAMS["I"]
    assert abs(p.IL_ref_A - 6.2746) / 6.2746 < 5.0e-3
    assert abs(p.I0_ref_A - 1.561e-11) / 1.561e-11 < 5.0e-3
    assert abs(p.Rs_ohm - 4.147e-3) / 4.147e-3 < 5.0e-3
    assert abs(p.Rsh_ref_ohm - 5.673) / 5.673 < 5.0e-3
    assert abs(p.a_ref_V - 0.025693) / 0.025693 < 1.0e-4


def test_lambertw_newton_agreement():
    """The two solvers agree to < 1e-12 A across the curve, several (G, T)."""
    p = BIN_PARAMS["I"]
    worst = 0.0
    for g in (200.0, 600.0, 1000.0):
        for t in (250.0, 298.15, 340.0):
            voc = _voc_cell_V(desoto_scaled_params(p, g, t))
            for v in np.linspace(0.0, 0.999 * voc, 40):
                di = abs(iv_current_A(p, float(v), g, t, solver="lambertw")
                         - iv_current_A(p, float(v), g, t, solver="newton"))
                worst = max(worst, di)
    assert worst < 1.0e-12, worst


def test_ideality_bounds_refuse_free_diode():
    """n below 1 is a super-ideal diode (free power); above 2 unphysical."""
    for bad_n in (0.5, 0.999, 2.001, -1.0):
        try:
            extract_c60_params("I", bad_n)
            raise AssertionError(f"n_ideality={bad_n} constructed")
        except ParamBoundsError:
            pass


def test_desoto_both_ways_temperature_honesty():
    """Hot cells lose power, cold cells gain -- and the slope stays inside
    the c-Si band the ceiling guard cites (-0.29..-0.45 %/K)."""
    p = BIN_PARAMS["I"]
    p_stc = string_mpp(p, 1, G_REF_WM2, T_REF_K).p_W
    p_hot = string_mpp(p, 1, G_REF_WM2, T_REF_K + 25.0).p_W
    p_cold = string_mpp(p, 1, G_REF_WM2, T_REF_K - 50.0).p_W
    assert p_hot < p_stc < p_cold
    slope_hot = (p_hot / p_stc - 1.0) / 25.0
    slope_cold = (p_cold / p_stc - 1.0) / -50.0
    for slope in (slope_hot, slope_cold):
        assert -0.0045 < slope < -0.0029, slope


def test_night_and_low_light():
    """G <= 0 returns the exact zero point; low G collapses efficiency
    (shunt + logarithmic Voc), it does not scale linearly down."""
    p = BIN_PARAMS["I"]
    assert string_mpp(p, 30, 0.0, T_REF_K) == (0.0, 0.0, 0.0)
    assert iv_current_A(p, 0.5, 0.0, T_REF_K) == 0.0
    p_stc = string_mpp(p, 1, G_REF_WM2, T_REF_K).p_W
    p_dim = string_mpp(p, 1, 50.0, T_REF_K).p_W
    assert p_dim < p_stc * 50.0 / 1000.0  # worse than linear: real physics


def test_string_scaling_and_bad_series_counts():
    """String MPP scales V and P by n_series at identical current."""
    p = BIN_PARAMS["I"]
    one = string_mpp(p, 1, G_REF_WM2, T_REF_K)
    thirty = string_mpp(p, 30, G_REF_WM2, T_REF_K)
    assert abs(thirty.v_V - 30.0 * one.v_V) < 1.0e-9
    assert abs(thirty.p_W - 30.0 * one.p_W) < 1.0e-9
    assert abs(thirty.i_A - one.i_A) < 1.0e-12
    for bad in (0, -3, 501, 2.5, True):
        try:
            string_mpp(p, bad, G_REF_WM2, T_REF_K)
            raise AssertionError(f"n_series={bad!r} accepted")
        except ParamBoundsError:
            pass


# --------------------------------------------------------------------------- #
# Section 2: MPPT converter                                                    #
# --------------------------------------------------------------------------- #


def test_gv5_published_anchors():
    """GV-5 fit: eta_conv >= 0.95 at 4 W, peak <= 0.9985, night 2.7 mW."""
    gv5 = gv5_converter()
    assert gv5.eta_conv_at_output_W(4.0) >= 0.95
    eta_peak = 1.0 / (1.0 + gv5.k1 + 2.0 * math.sqrt(gv5.p_fix_W * gv5.k2_per_W))
    assert eta_peak <= MAX_CONVERTER_ETA
    assert abs(gv5.night_parasitic_W() - 2.7e-3) < 1.0e-9


def test_default_k2_hits_rated_efficiency():
    """H-2 defaults: k2 lands eta_conv(rated) = 0.97 exactly."""
    conv = MPPTConverter(p_rated_W=65.0)
    assert abs(conv.eta_conv_at_output_W(65.0) - 0.97) < 1.0e-9
    # And bus_power_W is consistent with the loss curve at rated: feeding the
    # input that produces 65 W out returns 65 W.
    p_in = (65.0 + conv.p_fix_W + conv.k1 * 65.0 + conv.k2_per_W * 65.0**2)
    assert abs(conv.bus_power_W(p_in / conv.eta_track) - 65.0) < 1.0e-9


def test_vendor_peak_wall_at_construction():
    """A curve that would beat the GV-5 99.85 % peak refuses to build."""
    try:
        MPPTConverter(p_rated_W=65.0, p_fix_W=0.01, k1=0.0, k2_per_W=1.0e-9)
        raise AssertionError("vendor-beating converter constructed")
    except ParamBoundsError:
        pass


def test_vendor_peak_wall_at_runtime():
    """A loss coefficient walked after construction trips FreeEnergyError."""
    conv = gv5_converter()
    conv.k1 = -0.5  # a proportional loss that PAYS the bus
    try:
        conv.bus_power_W(50.0)
        raise AssertionError("walked k1 delivered free energy silently")
    except FreeEnergyError:
        pass


def test_fixed_loss_floor_and_input_validation():
    """Below the fixed-loss floor the bus sees exactly 0; negative raises."""
    gv5 = gv5_converter()
    assert gv5.bus_power_W(0.0) == 0.0
    assert gv5.bus_power_W(0.04) == 0.0
    for bad in (-1.0, float("nan"), float("inf")):
        try:
            gv5.bus_power_W(bad)
            raise AssertionError(f"bus_power_W({bad}) accepted")
        except ParamBoundsError:
            pass


def test_converter_param_bounds():
    """eta_track and friends are range-checked (free-tracker excluded)."""
    for kwargs in (
        dict(p_rated_W=65.0, eta_track=1.0),
        dict(p_rated_W=65.0, eta_track=0.5),
        dict(p_rated_W=65.0, v_bus_V=5.0),
        dict(p_rated_W=-10.0),
        dict(p_rated_W=65.0, p_fix_W=0.0),
        dict(p_rated_W=65.0, k2_per_W=-1.0e-4),
    ):
        try:
            MPPTConverter(**kwargs)
            raise AssertionError(f"{kwargs} constructed")
        except ParamBoundsError:
            pass


def test_negative_default_k2_refused():
    """Fixed losses that already exceed the 97 % target cannot silently ship
    a negative (free-energy) k2."""
    try:
        MPPTConverter(p_rated_W=4.0)  # 0.2 W fixed on a 4 W rating
        raise AssertionError("negative derived k2 shipped")
    except ParamBoundsError:
        pass


# --------------------------------------------------------------------------- #
# Section 6.2: PVArrayDiode element                                            #
# --------------------------------------------------------------------------- #


def test_flat_path_bit_identical_to_parent():
    """pv_model='flat' reproduces PVArray.evaluate bit-for-bit."""
    common = dict(area_m2=1.72, cell_efficiency_stc=0.237,
                  packing_factor=0.802, areal_density_kg_m2=0.40)
    flat = PVArrayDiode(pv_model="flat", **common)
    parent = PVArray(**common)
    for sun_up in (True, False):
        bodies, atmo, wind, sol = _sample_env(sun_up=sun_up)
        f_out = flat.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
        p_out = parent.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
        assert f_out.power_elec_W == p_out.power_elec_W
        assert np.all(f_out.force_N == 0.0)


def test_diode_path_powers_and_stays_under_flat_ceiling():
    """The real chain generates, exerts exactly zero force, and lands below
    the parent flat chain at temperate conditions (the added converter +
    harness debits) while the ledger diagnostics decompose the drop."""
    el = _diode_array(pv_harness=(
        HarnessSegment("pv->mppt", awg=18, length_oneway_m=1.5,
                       n_connector_pairs=2),
    ))
    parent = PVArray(area_m2=1.72, cell_efficiency_stc=0.237,
                     packing_factor=0.802, areal_density_kg_m2=0.40)
    bodies, atmo, wind, sol = _sample_env()
    out = el.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
    ref = parent.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
    assert out.power_elec_W > 0.0
    assert np.all(out.force_N == 0.0)
    assert el.last_mpp_W > el.last_conv_W > out.power_elec_W
    assert el.last_harness_loss_W > 0.0
    # Same POA, same cell temperature (the parent's thermal model, reused).
    assert el.last_poa_Wm2 == parent.last_poa_Wm2
    assert el.last_cell_temp_K == parent.last_cell_temp_K
    # Temperate case: the real chain is a net debit vs the flat ideal.
    assert out.power_elec_W < ref.power_elec_W


def test_diode_night_is_zero_and_parasitic_is_billable():
    """Dark array: zero at the bus from the element; the MPPT night draw is
    exposed for the builder's explicit PayloadLoad line."""
    el = _diode_array()
    bodies, atmo, wind, sol = _sample_env(sun_up=False)
    out = el.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
    assert out.power_elec_W == 0.0
    assert abs(el.mppt.night_parasitic_W() - 2.7e-3) < 1.0e-9


def test_diode_requires_string_and_converter():
    """The real path has no silent defaults: missing n_series_cells or mppt
    refuses, naming the flat path as the explicit alternative."""
    for overrides in (dict(n_series_cells=None), dict(mppt=None),
                      dict(mppt="not-a-converter"),
                      dict(n_series_cells=2.5),
                      dict(pv_model="perfect")):
        try:
            _diode_array(**overrides)
            raise AssertionError(f"{overrides} constructed")
        except ParamBoundsError:
            pass


def test_declared_efficiency_band():
    """cell_efficiency_stc is the ceiling claim for the SAME hardware: below
    the diode set's own STC efficiency (or > +0.02 above) refuses."""
    eta_diode = c60_stc_efficiency(BIN_PARAMS["I"])
    for bad_eff in (eta_diode - 0.01, eta_diode + 0.03):
        try:
            _diode_array(cell_efficiency_stc=bad_eff)
            raise AssertionError(f"eff={bad_eff:.4f} constructed")
        except ParamBoundsError:
            pass


def test_walked_diode_param_trips_free_energy_guard():
    """IL doubled on the LIVE element (each value still inside its scalar
    band) doubles the power and blows the cited ceiling -> FreeEnergyError."""
    el = _diode_array()
    p = el._diode_params
    el._diode_params = DiodeParams(IL_ref_A=2.0 * p.IL_ref_A,
                                   I0_ref_A=p.I0_ref_A, Rs_ohm=p.Rs_ohm,
                                   Rsh_ref_ohm=p.Rsh_ref_ohm,
                                   a_ref_V=p.a_ref_V)
    bodies, atmo, wind, sol = _sample_env()
    try:
        el.evaluate(bodies, atmo, wind, sol, 0.0, 60.0)
        raise AssertionError("walked IL delivered free energy silently")
    except FreeEnergyError:
        pass


def test_recheck_catches_walked_diode_params():
    """recheck_element_params (the integrator's spec-extraction hook) catches
    the same mutation without running a step."""
    el = _diode_array()
    p = el._diode_params
    el._diode_params = DiodeParams(IL_ref_A=2.0 * p.IL_ref_A,
                                   I0_ref_A=p.I0_ref_A, Rs_ohm=p.Rs_ohm,
                                   Rsh_ref_ohm=p.Rsh_ref_ohm,
                                   a_ref_V=p.a_ref_V)
    try:
        recheck_element_params(el)
        raise AssertionError("recheck admitted a walked diode set")
    except ParamBoundsError:
        pass


def test_mass_billing_unchanged_from_parent():
    """The diode path re-uses the parent's mass bill exactly (harness and
    converter mass are the builder's explicit lines, ledger H-6c)."""
    el = _diode_array()
    assert abs(el.mass_kg - 1.72 * 0.40) < 1.0e-9
    recheck_element_params(el)  # clean instance passes the full recheck


if __name__ == "__main__":  # pragma: no cover
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - standalone reporter
                fails += 1
                print(f"FAIL {name}: {exc}")
    print("OVERALL", "PASS" if fails == 0 else f"FAIL ({fails})")
    raise SystemExit(0 if fails == 0 else 1)
