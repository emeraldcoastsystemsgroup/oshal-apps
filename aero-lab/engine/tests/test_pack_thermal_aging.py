"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression walls for pack thermal + aging (SPEC_chemistry sections 3-4): the worked 12x21700 + 20 mm aerogel design point (UA = 0.063 W/K +/-10%, P_hold = 3.9 W +/-10% holding +5 C against -56 C, exactly 0 W against a +5 C night), thermostat hysteresis with the heater billed never free, the exact-exponential step's unconditional stability, PackThermalSpec's one-insulation-path and floor-ordering refusals, the Schmalstieg M50-class sanity wall (80% in 800-2000 FEC at 25 C / V_avg 3.7 / dDOD 0.8, ~1200 emergent), the Amprius 250-FEC band (150-400), Arrhenius aging direction, the aging-couples-back contract (fade shrinks C_nom, growth raises R_int), and the frozen AgingProjection surface.

Runs OFFLINE. Anchors are the spec's own worked examples and published bands.
"""
from __future__ import annotations

import pytest

from aerosim.vehicle.electrochem import (
    AgingProjection,
    HONESTY_LEDGER,
    HYSTERESIS_K,
    PackEcm,
    PackThermalSpec,
    amprius_cycle_fade_frac,
    calendar_alpha_per_day075,
    cycle_beta_per_sqrtAh,
    p_hold_W,
    project_days_to_fade,
    resistance_growth_rate_per_day075,
    step_pack_temperature,
    SCHMALSTIEG_REF_AH,
)
from aerosim.vehicle.param_bounds import ParamBoundsError


def _design_spec(p_heater_max_W: float = 10.0) -> PackThermalSpec:
    """The SPEC 3.2 worked design point: 12x21700 (0.92 kg) + 20 mm aerogel
    on a 0.065 m^2 box."""
    return PackThermalSpec(
        m_pack_kg=12 * 0.0698 * 1.10,
        t_ins_m=0.020, k_ins_W_per_mK=0.020, A_box_m2=0.065,
        p_heater_max_W=p_heater_max_W,
    )


# ---------------------------------------------------------------------------
# 1. The thermal design point -- SPEC 3.2 worked example (pytest wall)
# ---------------------------------------------------------------------------

def test_ua_matches_the_worked_design_point():
    spec = _design_spec()
    assert 0.9 * 0.063 <= spec.UA_W_per_K <= 1.1 * 0.063, (
        f"UA = {spec.UA_W_per_K:.4f} W/K not within 10% of the spec's 0.063")


def test_p_hold_stratospheric_night_tax():
    spec = _design_spec()
    hold = p_hold_W(spec.UA_W_per_K, 278.15, 217.15)  # +5 C vs -56 C
    assert 3.51 <= hold <= 4.29, f"P_hold = {hold:.2f} W not 3.9 +/-10%"


def test_p_hold_mild_night_is_exactly_free():
    spec = _design_spec()
    assert p_hold_W(spec.UA_W_per_K, 278.15, 278.15) == 0.0
    assert p_hold_W(spec.UA_W_per_K, 278.15, 283.15) == 0.0  # warmer than floor


def test_direct_ua_path_equivalent():
    spec = PackThermalSpec(m_pack_kg=0.92, UA_W_per_K=0.063,
                           p_heater_max_W=10.0)
    assert p_hold_W(spec.UA_W_per_K, 278.15, 217.15) == pytest.approx(
        0.063 * 61.0)


# ---------------------------------------------------------------------------
# 2. Thermostat + exact-exponential step -- SPEC 3.1
# ---------------------------------------------------------------------------

def test_thermostat_hysteresis_band():
    spec = _design_spec()
    floor = spec.T_floor_charge_K
    # Below floor: heater ON at rated power.
    _, p, on = step_pack_temperature(spec, floor - 1.0, 217.15, 0.0, 60.0,
                                     heater_was_on=False)
    assert on and p == spec.p_heater_max_W
    # Above floor + hysteresis: OFF.
    _, p, on = step_pack_temperature(spec, floor + HYSTERESIS_K + 0.1, 217.15,
                                     0.0, 60.0, heater_was_on=True)
    assert (not on) and p == 0.0
    # Inside the band: holds its previous state, both ways.
    for prev in (True, False):
        _, p, on = step_pack_temperature(spec, floor + 1.0, 217.15, 0.0, 60.0,
                                         heater_was_on=prev)
        assert on == prev and p == (spec.p_heater_max_W if prev else 0.0)


def test_exact_step_cannot_overshoot_equilibrium():
    # The exact-exponential update must land ON T_eq for dt -> inf, never
    # beyond it (an Euler step with dt >> tau would explode).
    spec = _design_spec()
    t_eq = 217.15  # no heat, no heater: equilibrium is ambient
    t_new, _, _ = step_pack_temperature(spec, 288.15, 217.15, 0.0, 1.0e9,
                                        heater_was_on=False)
    assert t_new == pytest.approx(t_eq, abs=1e-6)
    # Monotone approach from above: never below ambient at any dt.
    for dt in (60.0, 600.0, 6000.0, 60000.0):
        t_new, _, _ = step_pack_temperature(spec, 288.15, 217.15, 0.0, dt,
                                            heater_was_on=False)
        assert 217.15 <= t_new <= 288.15


def test_heater_holds_the_floor_through_a_stratospheric_night():
    # Closed loop: cold-soak from 288 K against -56 C with the thermostat
    # active; the pack must never fall below floor - hysteresis once the
    # heater engages (10 W rated >> 3.9 W hold), and the heater must engage.
    spec = _design_spec()
    t_K, on = 288.15, False
    engaged = False
    heater_Wh = 0.0
    dt = 300.0
    for _ in range(int(12 * 3600 / dt)):  # a 12 h night
        t_K, p_W, on = step_pack_temperature(spec, t_K, 217.15, 0.0, dt,
                                             heater_was_on=on)
        heater_Wh += p_W * dt / 3600.0
        engaged = engaged or p_W > 0.0
        if engaged:
            assert t_K >= spec.T_floor_charge_K - HYSTERESIS_K - 0.5
    assert engaged, "the heater never engaged on a -56 C night"
    # Order-of-magnitude: the night's heater energy is the P_hold tax class,
    # not zero and not the 10 W rated running flat out all night.
    assert 10.0 <= heater_Wh <= 60.0, f"night heater energy {heater_Wh:.1f} Wh"


def test_i2r_self_heating_warms_the_pack():
    spec = _design_spec()
    t_no_q, _, _ = step_pack_temperature(spec, 280.15, 278.15, 0.0, 600.0,
                                         heater_was_on=False)
    t_with_q, _, _ = step_pack_temperature(spec, 280.15, 278.15, 5.0, 600.0,
                                           heater_was_on=False)
    assert t_with_q > t_no_q


# ---------------------------------------------------------------------------
# 3. PackThermalSpec construction refusals -- frozen contract
# ---------------------------------------------------------------------------

def test_exactly_one_insulation_path():
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.92)                       # neither path
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.92, UA_W_per_K=0.063,     # both paths
                        t_ins_m=0.02, k_ins_W_per_mK=0.02, A_box_m2=0.065)
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.92, t_ins_m=0.02)         # partial triple


def test_inverted_floors_refused():
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.92, UA_W_per_K=0.063,
                        T_floor_charge_K=265.15, T_floor_discharge_K=270.15)


def test_free_thermos_refused():
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.92, UA_W_per_K=0.0)  # perfect insulation
    with pytest.raises(ParamBoundsError):
        PackThermalSpec(m_pack_kg=0.0, UA_W_per_K=0.063)  # massless pack


# ---------------------------------------------------------------------------
# 4. Aging walls -- SPEC 4 (Schmalstieg 2014 + Amprius overlay)
# ---------------------------------------------------------------------------

def test_m50_class_sanity_wall_800_2000_fec():
    # 3 FEC/day at 25 C, V_avg 3.7, dDOD 0.8: days x 3 must land in the
    # 800-2000 FEC field band (~1200 emergent per the spec).
    proj = project_days_to_fade(
        "nca_21700", daily_throughput_Ah=2 * 4.85 * 3, daily_dod_frac=0.8,
        mean_cell_V=3.7, pack_temp_profile_K=[298.15])
    fec = 3.0 * proj.days_to_80pct
    assert 800.0 <= fec <= 2000.0, f"M50-class hit 80% at {fec:.0f} FEC"


def test_pure_cycle_closed_form_near_1200_fec():
    beta = cycle_beta_per_sqrtAh(3.7, 0.8)
    fec = (0.20 / beta) ** 2 / SCHMALSTIEG_REF_AH
    assert 1000.0 <= fec <= 1400.0, f"closed-form cycle life {fec:.0f} FEC"


def test_amprius_hits_80pct_in_its_band():
    proj = project_days_to_fade(
        "amprius_si", daily_throughput_Ah=2 * 6.3 * 3, daily_dod_frac=0.8,
        mean_cell_V=3.42, pack_temp_profile_K=[298.15])
    fec = 3.0 * proj.days_to_80pct
    assert 150.0 <= fec <= 400.0, f"Amprius hit 80% at {fec:.0f} FEC"
    # And the pure prefactor reproduces its own anchor: 80% at 250 FEC.
    assert amprius_cycle_fade_frac(250.0) == pytest.approx(0.20, rel=0.01)


def test_aging_projection_surface_is_frozen():
    proj = project_days_to_fade(
        "nca_21700", daily_throughput_Ah=10.0, daily_dod_frac=0.5,
        mean_cell_V=3.7, pack_temp_profile_K=[298.15, 288.15])
    assert isinstance(proj, AgingProjection)
    assert proj.days_to_80pct < proj.days_to_70pct
    assert proj.fade_frac_per_day == pytest.approx(0.20 / proj.days_to_80pct)


def test_calendar_aging_arrhenius_direction():
    # Hotter storage ages faster; higher rest voltage ages faster
    # (Schmalstieg 2014 published form).
    a_25 = calendar_alpha_per_day075("nca_21700", 4.0, 298.15)
    a_40 = calendar_alpha_per_day075("nca_21700", 4.0, 313.15)
    assert a_40 > a_25 > 0.0
    assert (calendar_alpha_per_day075("nca_21700", 4.1, 298.15)
            > calendar_alpha_per_day075("nca_21700", 3.6, 298.15))
    # Amprius calendar penalty x2.0 (H14).
    assert calendar_alpha_per_day075("amprius_si", 4.0, 298.15) \
        == pytest.approx(2.0 * a_25)


def test_cycle_beta_shape():
    # dDOD raises fade; the V term is quadratic about 3.667 V.
    assert cycle_beta_per_sqrtAh(3.7, 0.9) > cycle_beta_per_sqrtAh(3.7, 0.1)
    assert cycle_beta_per_sqrtAh(4.1, 0.5) > cycle_beta_per_sqrtAh(3.667, 0.5)
    # Inside the 25-35 C window the published beta applies unmodified (H13).
    assert cycle_beta_per_sqrtAh(3.7, 0.5, 298.15) \
        == pytest.approx(cycle_beta_per_sqrtAh(3.7, 0.5, 308.15))
    with pytest.raises(ValueError):
        cycle_beta_per_sqrtAh(3.7, 1.5)


def test_resistance_growth_positive_and_hotter_is_worse():
    g_25 = resistance_growth_rate_per_day075("nca_21700", 4.0, 298.15)
    g_40 = resistance_growth_rate_per_day075("nca_21700", 4.0, 313.15)
    assert g_40 > g_25 > 0.0


# ---------------------------------------------------------------------------
# 5. Aging couples BACK into the ECM -- SPEC 4.1's closing loop
# ---------------------------------------------------------------------------

def _spec_small() -> PackThermalSpec:
    return PackThermalSpec(m_pack_kg=0.92, UA_W_per_K=0.063,
                           p_heater_max_W=10.0)


def test_fade_shrinks_capacity_and_growth_raises_resistance():
    pack = PackEcm("nca_21700", 12, 1, _spec_small(), 0.5, 0.05, 1.0)
    c0 = pack.c_nom_eff_Ah()
    r0 = pack._r_cell_ohm()
    pack.capacity_fade_frac = 0.10
    pack.resistance_growth_frac = 0.25
    assert pack.c_nom_eff_Ah() == pytest.approx(0.90 * c0)
    assert pack._r_cell_ohm() == pytest.approx(1.25 * r0)


def test_cycling_accrues_throughput_and_fade():
    pack = PackEcm("nca_21700", 12, 1, _spec_small(), 0.5, 0.05, 1.0)
    for _ in range(24):  # 24 h of alternating 30 W charge/discharge
        pack.step_power(+30.0, 1800.0)
        pack.step_power(-30.0, 1800.0)
    assert pack.throughput_Ah > 0.0
    assert pack.capacity_fade_frac > 0.0
    assert pack.resistance_growth_frac > 0.0


def test_honesty_ledger_carries_the_spec_flags():
    # Project rule: every unsourced/bounded parameter is FLAGGED, and the
    # consolidated ledger must carry the SPEC section-7 items this module
    # owns (H1-H14 classes) -- a deleted flag is a silently-defaulted number.
    joined = " ".join(HONESTY_LEDGER.keys())
    for item in ("H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9",
                 "H10", "H11", "H12", "H13", "H14"):
        assert any(k.startswith(item) or item in k.split("/")
                   for k in HONESTY_LEDGER), f"{item} missing from ledger"
    assert "A5" in joined and "A6" in joined  # implementation deviations too


if __name__ == "__main__":  # standalone runner, project convention
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
