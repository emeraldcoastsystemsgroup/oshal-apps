"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | FINAL GATE guard for the spill-meter
  |                                           | units defect (integrate.py change log
  |                                           | #6): unabsorbed_surplus_J was
  |                                           | accumulated in STORED-energy units
  |                                           | (post eta_charge) while
  |                                           | validate.usable_energy subtracts it
  |                                           | from BUS-side energy_in_J, crediting
  |                                           | 1-eta_charge of every spilled joule as
  |                                           | usable -- the R7 convergence search
  |                                           | farmed it to a fictitious 1.5477 at
  |                                           | 85.8% spill.  Three tests, each RED
  |                                           | under the old accounting: exact
  |                                           | synthetic-tape surplus and shortfall
  |                                           | unit identities, and the case-A bus
  |                                           | conservation identity
  |                                           | usable_in - out == C*(1/eta_c - eta_d).

tests.test_usable_ledger -- the spill meter must read the same units as the
harvest meter, or "usable" quietly rewards spilling.
"""

from __future__ import annotations

import warnings

import numpy as np
import pytest

warnings.simplefilter("ignore")

from aerosim.integrate import (  # noqa: E402
    _BatterySpec,
    _StorageTape,
    _replay_storage,
    integrate_energy,
)
from aerosim.validate import usable_energy  # noqa: E402
from aerosim.validate_designs import (  # noqa: E402
    DAY_S,
    DESIGN_A,
    SLOW_DT_S,
    build_solar_cruise,
)


def _tape(h_s: float, gen_W: float, load_W: float, n: int = 1) -> _StorageTape:
    """One-rate tape: constant generation and load at every RK4 stage.

    @description Makes the storage ODE exactly integrable by hand, so the
        surplus/shortfall unit identities below are exact, not approximate.
    @param h_s Step size, s. @param gen_W Generation, W. @param load_W Load, W.
    @param n Number of steps.
    @returns The tape.
    """
    return _StorageTape(
        h_s=np.full(n, h_s, dtype=float),
        gen_W=np.full((n, 4), gen_W, dtype=float),
        load_W=np.full((n, 4), load_W, dtype=float),
    )


def test_surplus_is_reported_in_bus_units() -> None:
    """A FULL pack fed 50 W of pure surplus for 100 s has refused exactly
    50 W x 100 s = 5000 J of BUS generation. The old meter reported the
    stored-equivalent 4500 J (x eta_charge = 0.9) and usable_energy then
    credited the 500 J difference as usable harvest."""
    spec = _BatterySpec(capacity_J=3600.0, initial_soc=1.0, eta_charge=0.9,
                        eta_discharge=0.9, soc_min=0.0, soc_max=1.0)
    _, surplus_J, shortfall_J = _replay_storage(_tape(100.0, 50.0, 0.0), spec, 1.0)
    assert surplus_J == pytest.approx(5000.0, rel=1e-12), (
        "spill must be the BUS generation the full pack could not take "
        "(gen x h), not the stored-equivalent overshoot")
    assert shortfall_J == 0.0


def test_shortfall_is_reported_in_bus_units() -> None:
    """An EMPTY pack asked for 50 W for 100 s failed to serve exactly 5000 J
    of BUS demand. The old meter reported the stored deficit 5555.6 J
    (/ eta_discharge)."""
    spec = _BatterySpec(capacity_J=3600.0, initial_soc=0.0, eta_charge=0.9,
                        eta_discharge=0.9, soc_min=0.0, soc_max=1.0)
    _, surplus_J, shortfall_J = _replay_storage(_tape(100.0, 0.0, 50.0), spec, 0.0)
    assert shortfall_J == pytest.approx(5000.0, rel=1e-12), (
        "unserved demand must be the BUS demand (load x h), not the stored "
        "deficit")
    assert surplus_J == 0.0


def test_case_a_usable_obeys_bus_conservation() -> None:
    """On a closed limit cycle, bus conservation fixes the usable ledger:
    usable_in - energy_out == C x (1/eta_charge - eta_discharge), where C is
    the stored energy cycled through the pack (from the SOC trace itself).
    Measured under the old meter: case A violated this by ~79 Wh (7.6% of
    energy_out); the honest identity holds to well under 1%."""
    build = build_solar_cruise(DESIGN_A)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    assert result.closed, "fixture drift: case A must close"
    e = usable_energy(result)

    batt = [el for el in build.vehicle.elements
            if hasattr(el, "eta_charge") and hasattr(el, "capacity_J")]
    assert batt, "case A lost its battery element"
    eta_c = float(batt[0].eta_charge)
    eta_d = float(batt[0].eta_discharge)
    cap_J = float(batt[0].capacity_J)

    soc = np.asarray(result.soc, dtype=float)
    cycled_J = float(np.sum(np.clip(np.diff(soc), 0.0, None)) * cap_J)
    loss_J = cycled_J * (1.0 / eta_c - eta_d)
    usable_in_J = float(e["energy_in_usable_J"])
    out_J = float(e["energy_out_J"])
    assert usable_in_J - out_J == pytest.approx(loss_J, abs=0.01 * out_J), (
        f"usable ledger violates bus conservation: usable_in - out = "
        f"{(usable_in_J - out_J) / 3600.0:.1f} Wh but battery losses are "
        f"{loss_J / 3600.0:.1f} Wh -- the spill meter is mis-counting")
