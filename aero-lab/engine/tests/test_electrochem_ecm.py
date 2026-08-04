"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression walls for the real-battery ECM (SPEC_chemistry sections 1-2): the Zhang/Xu/Jow 2003 cold-capacity bands at 0.2C (-20 C in [65, 90]% of rated, -40 C <= 35%) with the collapse shown to EMERGE from the ohmic cutoff crossing rather than the clamp alone; the R_int(25 C -> -30 C) ratio in [8, 13]; the Amprius 3000 W/kg @ 30% DOD pulse consistency check on the default R_norm = 0.15 Ohm*Ah; the BU-410 C-rate tables with the below-0-C plating wall (refuse + spill logged + the flagged 1%/Ah penalty ONLY when forced); OCV PCHIP monotonicity/no-overshoot; and the frozen BatteryElement chemistry contract (loud IdealChemistryWarning on a defaulted chemistry, eta refusal in real mode, Ns/Np/thermal required, nameplate and cell-mass cross-checks, frozen post-step attrs, exact-zeros evaluate).

Runs OFFLINE (no network, no fetched data). All anchors are cited in the
implementing modules; this file asserts the published bands, never re-derives
them from the model under test.
"""
from __future__ import annotations

import types

import numpy as np
import pytest

from aerosim.vehicle.electrochem import (
    ALL_CHEMISTRIES,
    CELL_SPECS,
    IdealChemistryWarning,
    PackEcm,
    PackThermalSpec,
    c_avail_frac,
    charge_limit_C,
    discharge_limit_C,
    f_soc_multiplier,
    ocv_V,
    ocv_branch_V,
    pulse_power_W_per_kg,
    r_int_ohm,
    usable_capacity_frac,
)
from aerosim.vehicle.energy import BatteryElement, PackHeaterLoad
from aerosim.vehicle.mass import J_PER_WH, MassClosureError
from aerosim.vehicle.param_bounds import ParamBoundsError


# ---------------------------------------------------------------------------
# Shared fixtures-by-construction (kept as plain helpers: the project's test
# style is standalone-runnable files).
# ---------------------------------------------------------------------------

def _m50_thermal() -> PackThermalSpec:
    """The SPEC 3.2 worked design point: 12x21700 + 20 mm aerogel."""
    return PackThermalSpec(
        m_pack_kg=12 * 0.0698 * 1.10,
        t_ins_m=0.020, k_ins_W_per_mK=0.020, A_box_m2=0.065,
        p_heater_max_W=10.0,
    )


def _m50_element(**overrides) -> BatteryElement:
    """A 12s1p LG M50 pack: 12 x 17.6 Wh = 211.2 Wh nameplate."""
    kwargs = dict(
        capacity_J=12 * 17.6 * J_PER_WH,
        initial_soc=0.5,
        specific_energy_Wh_per_kg=180.0,
        chemistry="nca_21700",
        n_series=12, n_parallel=1,
        thermal=_m50_thermal(),
    )
    kwargs.update(overrides)
    return BatteryElement(**kwargs)


def _atmo(T_K: float):
    """Minimal atmosphere sample stub: evaluate() reads only T_K."""
    return types.SimpleNamespace(T_K=float(T_K), rho_kgm3=1.225)


# ---------------------------------------------------------------------------
# 1. Cold-capacity walls (Zhang/Xu/Jow 2003, 0.2C protocol) -- SPEC 2.1/2.2
# ---------------------------------------------------------------------------

def test_usable_capacity_minus20C_in_zhang_band():
    frac = usable_capacity_frac("nca_21700", 253.15)
    assert 0.65 <= frac <= 0.90, f"-20 C usable {frac:.4f} outside [0.65, 0.90]"


def test_usable_capacity_minus40C_collapses():
    frac = usable_capacity_frac("nca_21700", 233.15)
    assert frac <= 0.35, f"-40 C usable {frac:.4f} above the 0.35 wall"


def test_usable_capacity_room_temp_near_rated():
    frac = usable_capacity_frac("nca_21700", 298.15)
    assert frac >= 0.95, f"25 C usable {frac:.4f} -- reference should be ~1"


def test_cold_collapse_emerges_beyond_the_clamp():
    # The clamp alone allows 0.88 at -20 C and 0.30 at -40 C. The DELIVERED
    # fraction must be strictly below the clamp at both points: the ohmic
    # cutoff crossing (OCV - I*R hitting 2.5 V early) is doing real work,
    # i.e. the collapse EMERGES from the ECM and the clamp is only the floor
    # (SPEC 2.2's non-double-counting requirement).
    for T_K in (253.15, 233.15):
        clamp = c_avail_frac(T_K)
        delivered = usable_capacity_frac("nca_21700", T_K)
        assert delivered < clamp, (
            f"at {T_K - 273.15:.0f} C delivered {delivered:.4f} did not fall "
            f"below the clamp {clamp:.4f}: the ohmic mechanism is dead and "
            f"the clamp is being used as the model"
        )


def test_c_avail_clamp_shape():
    assert c_avail_frac(298.15) == 1.0
    assert c_avail_frac(263.15) == 1.0          # -10 C: clamp not yet active
    assert abs(c_avail_frac(253.15) - 0.88) < 1e-12
    assert abs(c_avail_frac(233.15) - 0.30) < 1e-12
    assert c_avail_frac(218.15) == 0.0          # -55 C: electrolyte solid


# ---------------------------------------------------------------------------
# 2. Arrhenius resistance (Zhang 2003 measured x10 at -30 C) -- SPEC 1.4
# ---------------------------------------------------------------------------

def test_r_int_cold_ratio_in_measured_band():
    r_cold = r_int_ohm("nca_21700", 0.5, 243.15, 4.85)
    r_warm = r_int_ohm("nca_21700", 0.5, 298.15, 4.85)
    ratio = r_cold / r_warm
    assert 8.0 <= ratio <= 13.0, f"R(-30 C)/R(25 C) = {ratio:.2f} not in [8, 13]"


def test_r_int_reference_matches_m50_dcir():
    # R_norm 0.15 Ohm*Ah / 4.85 Ah = 30.9 mOhm at 50% SOC, 25 C -- inside the
    # published M50 DCIR 25-35 mOhm window (batterydesign.net M50 page).
    r = r_int_ohm("nca_21700", 0.5, 298.15, 4.85)
    assert 0.025 <= r <= 0.035, f"M50 DCIR {r * 1e3:.1f} mOhm outside 25-35"


def test_f_soc_multiplier_plateau_and_knee():
    assert f_soc_multiplier(0.5) == 1.0
    assert f_soc_multiplier(0.02) == 2.5
    assert f_soc_multiplier(1.0) == pytest.approx(1.1)
    # monotone non-increasing over the low knee
    assert f_soc_multiplier(0.05) > f_soc_multiplier(0.10) > f_soc_multiplier(0.20)


def test_r_int_rejects_nonsense():
    with pytest.raises(ValueError):
        r_int_ohm("ideal", 0.5, 298.15, 4.85)     # no ideal resistance
    with pytest.raises(ValueError):
        r_int_ohm("nca_21700", 0.5, 50.0, 4.85)   # T outside credible window
    with pytest.raises(ValueError):
        r_int_ohm("nca_21700", 0.5, 298.15, 0.0)  # zero capacity divisor


# ---------------------------------------------------------------------------
# 3. Amprius pulse-power consistency check -- SPEC 1.4 (H6)
# ---------------------------------------------------------------------------

def test_amprius_pulse_power_reaches_published_point():
    pp = pulse_power_W_per_kg("amprius_si", 0.30)
    assert pp >= 3000.0, (
        f"Amprius pulse at 30% DOD = {pp:.0f} W/kg < published 3000: the "
        f"chosen R_norm is too high, not the datasheet wrong (SPEC 1.4)"
    )


# ---------------------------------------------------------------------------
# 4. OCV curves -- SPEC 1.2/1.3
# ---------------------------------------------------------------------------

def test_ocv_hits_the_cited_knots():
    assert ocv_V("nca_21700", 0.0) == pytest.approx(2.55, abs=1e-9)
    assert ocv_V("nca_21700", 0.5) == pytest.approx(3.66, abs=1e-9)
    assert ocv_V("nca_21700", 1.0) == pytest.approx(4.20, abs=1e-9)
    assert ocv_V("amprius_si", 0.5) == pytest.approx(3.42, abs=1e-9)


def test_ocv_is_monotone_and_never_overshoots():
    # PCHIP mandate: monotone data in, monotone curve out; a free spline
    # overshoots the 0-10% knee below the 2.55 V endpoint (SPEC 1.2).
    for chem in ("nca_21700", "amprius_si"):
        soc = np.linspace(0.0, 1.0, 2001)
        v = np.array([ocv_V(chem, s) for s in soc])
        assert np.all(np.diff(v) >= -1e-12), f"{chem} OCV not monotone"
        assert v.min() >= ocv_V(chem, 0.0) - 1e-12, f"{chem} undershoots"
        assert v.max() <= ocv_V(chem, 1.0) + 1e-12, f"{chem} overshoots"


def test_ocv_hysteresis_band_si_only():
    # Si anode carries the +/-40 mV flat band (H2); M50 band is zero.
    rest = ocv_V("amprius_si", 0.5)
    assert ocv_branch_V("amprius_si", 0.5, charging=True) == pytest.approx(rest + 0.040)
    assert ocv_branch_V("amprius_si", 0.5, charging=False) == pytest.approx(rest - 0.040)
    assert ocv_branch_V("nca_21700", 0.5, charging=True) == pytest.approx(
        ocv_V("nca_21700", 0.5))


def test_ocv_refuses_ideal_and_nan():
    with pytest.raises(ValueError):
        ocv_V("ideal", 0.5)
    with pytest.raises(ValueError):
        ocv_V("nca_21700", float("nan"))


# ---------------------------------------------------------------------------
# 5. C-rate tables and the plating wall -- SPEC 1.5
# ---------------------------------------------------------------------------

def test_charge_limit_zero_below_freezing():
    for t_degC in (-56.0, -20.0, -5.0, -0.01):
        assert charge_limit_C("nca_21700", t_degC + 273.15) == 0.0, (
            f"charge allowed at {t_degC} C -- the plating wall is down")


def test_charge_limit_table_anchors():
    assert charge_limit_C("nca_21700", 2.0 + 273.15) == pytest.approx(0.1)
    assert charge_limit_C("nca_21700", 25.0 + 273.15) == pytest.approx(0.7)
    assert charge_limit_C("nca_21700", 50.0 + 273.15) == pytest.approx(0.3)
    assert charge_limit_C("nca_21700", 61.0 + 273.15) == 0.0


def test_amprius_overlay_caps_rates():
    assert charge_limit_C("amprius_si", 298.15) == pytest.approx(0.5)
    assert discharge_limit_C("amprius_si", 298.15) == pytest.approx(1.0)
    assert discharge_limit_C("nca_21700", 298.15) == pytest.approx(1.5)


def test_discharge_still_possible_cold_but_derated():
    assert discharge_limit_C("nca_21700", 233.15) == pytest.approx(0.2)
    assert discharge_limit_C("nca_21700", 263.15) == pytest.approx(0.5)


def test_plating_wall_refuses_spills_and_logs():
    pack = PackEcm("nca_21700", 12, 1, _m50_thermal(), 0.5, 0.05, 1.0)
    pack.pack_temp_K = 263.15  # -10 C
    unserved_W = pack.step_power(+50.0, 60.0)
    assert unserved_W == pytest.approx(50.0)      # every watt refused
    assert pack.cold_charge_spill_J == pytest.approx(3000.0)  # and logged
    assert pack.plating_violation_Ah == 0.0       # refusal is NOT plating
    assert pack.soc == pytest.approx(0.5)         # no free charge crept in


def test_forced_cold_charge_accrues_the_flagged_penalty():
    pack = PackEcm("nca_21700", 12, 1, _m50_thermal(), 0.5, 0.05, 1.0)
    pack.pack_temp_K = 263.15
    pack.force_cold_charge = True
    pack.step_power(+50.0, 600.0)
    assert pack.plating_violation_Ah > 0.0
    # 1% of the plated Ah, permanent (H8 order-of-magnitude placeholder).
    expected = 0.01 * pack.plating_violation_Ah / CELL_SPECS["nca_21700"].c_nom_Ah
    assert pack.capacity_fade_frac >= expected * (1.0 - 1e-9)


def test_warm_charge_is_served_with_i2r_heat():
    pack = PackEcm("nca_21700", 12, 1, _m50_thermal(), 0.5, 0.05, 1.0)
    pack.pack_temp_K = 298.15
    unserved_W = pack.step_power(+50.0, 60.0)
    assert unserved_W == pytest.approx(0.0, abs=1e-9)
    assert pack.last_heat_W > 0.0                 # losses are I^2*R, not eta
    assert pack.soc > 0.5


def test_discharge_shortfall_reported_when_empty():
    pack = PackEcm("nca_21700", 12, 1, _m50_thermal(), 0.06, 0.05, 1.0)
    unserved_W = pack.step_power(-500.0, 3600.0)
    assert unserved_W < 0.0, "an empty pack must report the shortfall"


# ---------------------------------------------------------------------------
# 6. The frozen BatteryElement chemistry contract (vehicle/energy.py)
# ---------------------------------------------------------------------------

def test_defaulted_chemistry_warns_loudly():
    with pytest.warns(IdealChemistryWarning):
        BatteryElement(703.0 * J_PER_WH, specific_energy_Wh_per_kg=241.0)


def test_explicit_ideal_is_silent_and_bit_compatible():
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("error", IdealChemistryWarning)
        el = BatteryElement(703.0 * J_PER_WH, specific_energy_Wh_per_kg=241.0,
                            chemistry="ideal")
    assert el.eta_charge == pytest.approx(0.95)
    assert el.eta_discharge == pytest.approx(0.95)
    # Ideal-path frozen attrs report zeros (no heater, no aging, no plating).
    assert el.last_heater_W == 0.0
    assert el.throughput_Ah == 0.0
    assert el.capacity_fade_frac == 0.0
    with pytest.raises(AttributeError):
        _ = el.pack_temp_K  # an ideal bucket has no temperature to report


def test_real_chemistry_refuses_flat_eta():
    with pytest.raises(ParamBoundsError):
        _m50_element(eta_charge=0.95)
    with pytest.raises(ParamBoundsError):
        _m50_element(eta_discharge=0.95)


def test_real_chemistry_requires_topology_and_thermal():
    for missing in ("n_series", "n_parallel", "thermal"):
        with pytest.raises(MassClosureError):
            _m50_element(**{missing: None})


def test_unknown_chemistry_refused():
    with pytest.raises(ParamBoundsError):
        _m50_element(chemistry="unobtanium")
    assert ALL_CHEMISTRIES == {"ideal", "nca_21700", "amprius_si"}


def test_capacity_must_match_the_stated_cells():
    # 12s1p M50 nameplate is 211.2 Wh; claiming 300 Wh from the same cells
    # is free energy and must refuse (frozen 5% consistency contract).
    with pytest.raises(ParamBoundsError):
        _m50_element(capacity_J=300.0 * J_PER_WH)


def test_billed_mass_must_weigh_the_cells():
    # 211.2 Wh at 300 Wh/kg bills 0.704 kg < 12 x 0.0698 x 1.10 = 0.921 kg:
    # a pack lighter than its own cells (cell Wh/kg worn as pack Wh/kg).
    with pytest.raises(ParamBoundsError):
        _m50_element(specific_energy_Wh_per_kg=300.0)


def test_real_element_step_and_frozen_attrs():
    el = _m50_element()
    unserved_W = el.step(-30.0, 60.0)             # discharge 30 W for 1 min
    assert unserved_W == pytest.approx(0.0, abs=1e-9)
    assert el.soc < 0.5
    assert el.throughput_Ah > 0.0
    for attr in ("pack_temp_K", "last_heater_W", "throughput_Ah",
                 "capacity_fade_frac", "resistance_growth_frac",
                 "plating_violation_Ah", "cold_charge_spill_J"):
        assert isinstance(getattr(el, attr), float), f"missing frozen {attr}"


def test_evaluate_is_exact_zero_force_and_advances_thermal():
    el = _m50_element()
    t0 = el.pack_temp_K
    out = el.evaluate([None], _atmo(217.15), None, None, 0.0, 600.0)
    assert np.array_equal(out.force_N, np.zeros(3))
    assert np.array_equal(out.moment_Nm, np.zeros(3))
    assert out.power_elec_W == 0.0
    assert el.pack_temp_K < t0, "cold ambient must pull the pack temperature"


def test_pack_heater_load_bills_the_pack_command():
    el = _m50_element()
    heater = PackHeaterLoad(el, mass_kg=0.15)
    el.ecm.last_heater_W = 7.5   # simulate a thermostat-on step
    out = heater.evaluate([None], _atmo(217.15), None, None, 0.0, 60.0)
    assert out.power_elec_W == pytest.approx(-7.5)
    assert np.array_equal(out.force_N, np.zeros(3))
    with pytest.raises(MassClosureError):
        PackHeaterLoad(el)       # a weightless heater is a free night


def test_cold_element_spills_and_ledgers_solar():
    el = _m50_element()
    el.ecm.pack_temp_K = 263.15
    unserved_W = el.step(+40.0, 60.0)
    assert unserved_W == pytest.approx(40.0)
    assert el.cold_charge_spill_J == pytest.approx(2400.0)


if __name__ == "__main__":  # standalone runner, project convention
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
