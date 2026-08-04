"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation. Turns "the
  |                                           | acceptance bands are tight enough" from
  |                                           | a claim into a measurement: each closure
  |                                           | case is RE-RUN with a 2x error injected
  |                                           | into one dominant parameter, and the gate
  |                                           | fails unless the mutated design fails.
  |                                           | Measured before this existed: halving
  |                                           | pv_cell_efficiency (0.237 -> 0.1185) left
  |                                           | case A PASSING -- margin 2.7355 -> 1.3677,
  |                                           | inside the [1.2, 4.0] band, min_soc 0.4396
  |                                           | -> 0.4153, gate ALLPASS.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 3: five new required mutations,
  |                                           | each verified to bite. pack x2.0 -- the
  |                                           | closure verdict and the usable margin
  |                                           | are STRUCTURALLY blind to it (measured:
  |                                           | margin 1.1201 to 4 decimals either way,
  |                                           | because a closed limit cycle returns the
  |                                           | pack to its starting charge and pins
  |                                           | usable/out at ~1/(eta_c*eta_d) whatever
  |                                           | the capacity); caught by the new
  |                                           | pack-chemistry catalogue audit on case A
  |                                           | and the 500 Wh/kg construction ceiling
  |                                           | on case B.
  |                                           | soc_max=3.0, eta_charge=2.0 and thruster
  |                                           | FM=5.0 (each must RAISE at construction
  |                                           | through the real builder -- the round-3
  |                                           | constructor guards proven on the gate
  |                                           | path, not just in unit tests); and air
  |                                           | density x2.0 via scaled_atmosphere (was
  |                                           | passing case B silently -- caught now by
  |                                           | the hand-typed USSA-1976 density anchor
  |                                           | in validate_bounds, which is the one
  |                                           | number that does not move with the
  |                                           | model). Mutation gains rho_scale.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 integration: MutationOutcome
  |                                           | gains a typed `raised` flag so consumers
  |                                           | can tell "the constructor REFUSED the
  |                                           | mutant" (a named wall fired -- e.g. the
  |                                           | new tech-catalogue frontier refusing a
  |                                           | 0.474 cell at thin-film density) from
  |                                           | "the gate ran the mutant and failed it".
  |                                           | Both are catches; negative controls need
  |                                           | the distinction because for them the only
  |                                           | forbidden outcome is the mutant CLOSING.
  |                                           | No band or refusal was loosened.

aerosim.validate_sensitivity -- a band you have not mutation-tested is decoration.

WHAT THIS MODULE ASSERTS
-----------------------------------------------------------------------------
For every case that is supposed to CLOSE, injecting a factor-of-two error into
any single dominant parameter must make the case FAIL. If it does not, the band
is wider than the model's own uncertainty and the gate cannot tell a working
simulator from a broken one.

The parameters swept are the ones that dominate a solar-endurance budget:

  pv_cell_efficiency          harvest, linear
  pack specific energy        how much of the harvest survives to dawn, linear
  extra_CD0                   cruise power, superlinear through the trim
  CD (whole polar)            cruise power, direct
  CL (whole polar)            trim speed and therefore power, direct

The last two are injected by WRAPPING aeropolar.wing_polar, so they mutate what
the solver hands back without touching the solver -- which is precisely the
failure the closed-form bounds in validate_bounds exist to catch, and this is
where that catching gets demonstrated rather than asserted.

WHY THIS IS NOT PART OF THE SWEEP
-----------------------------------------------------------------------------
Each mutation is a full 24 h integration. This is gate-time work (a handful of
seconds per case), not sweep-time work. A 30,000-design sweep is protected by
integrate._assert_generation_budget and by the per-case bounds, both of which are
per-step and cheap.

UNITS: dimensionless scale factors throughout; every underlying quantity keeps
the units of the case that owns it.
"""

from __future__ import annotations

import sys
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterator

import numpy as np

from . import aeropolar
from .env import atmosphere as _atmosphere_original


@dataclass(frozen=True)
class Mutation:
    """One injected error and what it is supposed to do.

    @param name Short identifier, e.g. "pv_efficiency x0.5".
    @param overrides Keyword overrides handed to the case builder.
    @param cl_scale Multiplier applied to every CL the solver returns,
        dimensionless. 1.0 leaves the polar alone.
    @param cd_scale Multiplier applied to every CD the solver returns,
        dimensionless. 1.0 leaves the polar alone.
    @param rho_scale Multiplier applied to every air density the atmosphere
        model returns, dimensionless. 1.0 leaves the atmosphere alone.
    @param rationale Why this particular error is the one worth injecting.
    """

    name: str
    overrides: dict
    cl_scale: float = 1.0
    cd_scale: float = 1.0
    rho_scale: float = 1.0
    rationale: str = ""


@dataclass(frozen=True)
class MutationOutcome:
    """What the gate did when the mutation was injected.

    @param name The mutation's identifier.
    @param caught True when the mutated design FAILED the gate -- the desired
        outcome, because the injected error is real.
    @param detail How it failed (or, when caught is False, the numbers it passed
        with, which is the diagnosis).
    @param raised True when the catch happened by an EXCEPTION out of the
        build-and-gate call (a constructor wall or closed-form bound refusing
        the mutant by name) rather than by the gate running the mutant and
        failing it. For closure cases both flavours are equally a catch; for a
        NEGATIVE control the distinction is load-bearing -- the only forbidden
        outcome there is the mutant closing, and a refusal at construction can
        never be that.
    """

    name: str
    caught: bool
    detail: str
    raised: bool = False


@contextmanager
def scaled_polar(cl_scale: float = 1.0, cd_scale: float = 1.0) -> Iterator[None]:
    """Temporarily corrupt every polar the solver returns.

    @description Wraps ``aeropolar.wing_polar`` at the module attribute, so every
        consumer -- validate_bounds.reference_trim, vehicle.AeroSurface, and the
        integrator through it -- sees the corrupted polar. This is the mutation
        that the old "level-flight power cross-check" could not see: both sides
        of that identity moved together. The closed-form bounds do not move with
        it, which is what makes them a test.

        CDi and CDp are scaled alongside CD so the returned polar stays
        internally consistent; a corrupted polar whose parts do not add up would
        be caught for the wrong reason.
    @param cl_scale Multiplier on CL, dimensionless.
    @param cd_scale Multiplier on CD (and its CDi / CDp parts), dimensionless.
    @returns Context manager; the patch is removed on exit, including on error.
    """
    if cl_scale == 1.0 and cd_scale == 1.0:
        yield
        return

    original = aeropolar.wing_polar

    def _wrapped(*args: Any, **kwargs: Any):
        polar = original(*args, **kwargs)
        return polar._replace(
            CL=np.asarray(polar.CL, dtype=float) * float(cl_scale),
            CD=np.asarray(polar.CD, dtype=float) * float(cd_scale),
            CDi=np.asarray(polar.CDi, dtype=float) * float(cd_scale),
            CDp=np.asarray(polar.CDp, dtype=float) * float(cd_scale),
        )

    aeropolar.wing_polar = _wrapped  # type: ignore[assignment]
    try:
        yield
    finally:
        aeropolar.wing_polar = original  # type: ignore[assignment]


@contextmanager
def scaled_atmosphere(rho_scale: float = 1.0) -> Iterator[None]:
    """Temporarily corrupt every air density the atmosphere model returns.

    @description The round-3 sibling of scaled_polar. Round 2 measured an
        air-density x2 error passing case B silently: trim speed, Reynolds
        number and cruise power all move WITH the corrupted density, so every
        cross-check between them stays green. The one check that catches it is
        the hand-typed USSA-1976 table anchor in validate_bounds, and this
        context manager is how that catching gets demonstrated rather than
        asserted.

        MECHANICS. Consumers reach the atmosphere two ways: `_env().atmosphere`
        resolved from the aerosim.env module object at call time (integrate.py),
        and `from .env import atmosphere` bound at import time (validate_*.py,
        per-element diagnostics). One wrapped function is therefore installed on
        EVERY loaded aerosim module whose `atmosphere` attribute is the original
        function -- found by scanning sys.modules, so a future consumer module
        cannot silently escape the mutation by being missing from a hand-kept
        list. Only rho_kgm3 is scaled; T, p and mu stay honest so the corruption
        is a pure density error, not a different (self-consistent) atmosphere.
    @param rho_scale Multiplier on rho_kgm3, dimensionless.
    @returns Context manager; every patch is removed on exit, including on error.
    """
    if rho_scale == 1.0:
        yield
        return

    def _wrapped(altitude_m: Any):
        sample = _atmosphere_original(altitude_m)
        return sample._replace(rho_kgm3=sample.rho_kgm3 * float(rho_scale))

    patched: list[Any] = []
    for module in list(sys.modules.values()):
        name = getattr(module, "__name__", "")
        if not isinstance(name, str) or not name.startswith("aerosim"):
            continue
        if getattr(module, "atmosphere", None) is _atmosphere_original:
            setattr(module, "atmosphere", _wrapped)
            patched.append(module)
    try:
        yield
    finally:
        for module in patched:
            setattr(module, "atmosphere", _atmosphere_original)


#: The mutation set applied to every case that is expected to close. Each is a
#: factor of two (or its reciprocal) in ONE DOMINANT parameter -- the size of
#: error the bands are required to detect. Every one of these MUST be caught.
CLOSURE_MUTATIONS: tuple[Mutation, ...] = (
    Mutation(
        name="pv_cell_efficiency x0.5",
        overrides={"pv_efficiency_scale": 0.5},
        rationale="harvest is linear in cell efficiency and is the single "
                  "largest term in a solar endurance budget",
    ),
    Mutation(
        name="pv_cell_efficiency x2.0",
        overrides={"pv_efficiency_scale": 2.0},
        rationale="the optimistic direction must be detectable too: a band that "
                  "only bites downward rewards over-claimed harvest",
    ),
    Mutation(
        name="pack_specific_energy x0.5",
        overrides={"pack_specific_energy_scale": 0.5},
        rationale="halves the pack that survives the night at constant mass",
    ),
    Mutation(
        name="polar CD x2.0",
        overrides={},
        cd_scale=2.0,
        rationale="the exact mutation the retired algebraic cross-check passed "
                  "silently (P_elec 34.890 -> 69.780 W, check still green)",
    ),
    Mutation(
        name="polar CD x0.5",
        overrides={},
        cd_scale=0.5,
        rationale="drag below the elliptic + laminar floor is physically "
                  "impossible; the closed-form bound must say so",
    ),
    Mutation(
        name="polar CL x1.5",
        overrides={},
        cl_scale=1.5,
        rationale="the other mutation the retired cross-check passed silently "
                  "(P_elec -> 19.866 W)",
    ),
    # ---- round-3 additions, each verified to bite (see the change log) ----
    Mutation(
        name="pack_specific_energy x2.0",
        overrides={"pack_specific_energy_scale": 2.0},
        rationale="the optimistic twin of x0.5, and it was INVISIBLE before "
                  "round 3: MEASURED, the usable margin is identical to 4 "
                  "decimals either way, because a closed limit cycle returns "
                  "the pack to its starting charge and pins usable/out at "
                  "~1/(eta_chg*eta_dis) whatever the capacity -- no energy "
                  "ratio can see a storage-size error. Catch paths (round 4): "
                  "case A (241 -> 482 Wh/kg) and case B (445.5 -> 891 Wh/kg) "
                  "both RAISE at construction against the technology-"
                  "catalogue pack frontier (445.5 Wh/kg, tighter than the 500 "
                  "scalar backstop); the pack-chemistry spec-vs-instance "
                  "audit remains as the second net for in-frontier drift.",
    ),
    Mutation(
        name="battery soc_max = 3.0",
        overrides={"soc_max": 3.0},
        rationale="round 2's stored-energy multiplier: mass is billed on "
                  "nameplate, so a rail above 1 is free energy (measured: a "
                  "16 kg pack cycled 940 Wh/kg effective). Must RAISE "
                  "ParamBoundsError at construction THROUGH the real builder.",
    ),
    Mutation(
        name="battery eta_charge = 2.0",
        overrides={"eta_charge": 2.0},
        rationale="round 2's >1 efficiency: 2.0 x 0.95 is a 1.9 storage round "
                  "trip. Must RAISE at construction through the real builder.",
    ),
    Mutation(
        name="thruster figure_of_merit = 5.0",
        overrides={"thruster_figure_of_merit": 5.0},
        rationale="round 2's divided-by exploit: FM=5.0 made propulsion 5.9x "
                  "cheaper than the actuator-disk ideal. Must RAISE at "
                  "construction (band [0.3, 0.9]) through the real builder.",
    ),
    Mutation(
        name="air density x2.0",
        overrides={},
        rho_scale=2.0,
        rationale="round 2 measured this passing case B silently -- trim, "
                  "Reynolds and power all move WITH the corrupted rho, so no "
                  "internal cross-check can see it. The hand-typed USSA-1976 "
                  "density anchor (validate_bounds family 5) is the number "
                  "that does not move.",
    ),
)


#: Mutations that are MEASURED and REPORTED but NOT required to be caught,
#: each with the reason stated. Keeping them in a separate tuple is the point:
#: a mutation nobody expects the gate to catch must never sit in the required
#: set, because the tempting fix is to tighten a band until it passes -- which
#: buys a green gate with a claim the underlying number cannot support.
REPORTED_SENSITIVITIES: tuple[Mutation, ...] = (
    Mutation(
        name="extra_CD0 x2.0",
        overrides={"extra_CD0_scale": 2.0},
        rationale="NOT a 2x error in a dominant parameter: extra_CD0 is 17.9 % "
                  "of case A's total CD, so doubling it is an 18 % error in the "
                  "dominant quantity (total drag). Measured effect: usable "
                  "margin 1.1201 -> 1.1019, CL^1.5/CD 24.293 -> 20.700 (-13.1 % "
                  "against the published anchor, inside its honest +/-20 % "
                  "uncertainty). Reported, not claimed as caught.",
    ),
    Mutation(
        name="extra_CD0 x0.5",
        overrides={"extra_CD0_scale": 0.5},
        rationale="the optimistic twin of the above, for symmetry of evidence",
    ),
)


def run_mutations(
    build_and_gate: Callable[..., tuple[bool, str]],
    mutations: tuple[Mutation, ...] = CLOSURE_MUTATIONS,
) -> tuple[MutationOutcome, ...]:
    """Inject each mutation and record whether the gate caught it.

    @description ``build_and_gate`` must build the case under the given
        overrides, run it, and return (passed, one_line_summary). A mutation is
        CAUGHT when passed is False, or when the case raised at all -- a design
        that violates a closed-form physical bound is entitled to raise.
    @param build_and_gate Callable taking the mutation's overrides as keyword
        arguments and returning (passed, summary).
    @param mutations The mutation set to apply.
    @returns One MutationOutcome per mutation, in order.
    """
    outcomes: list[MutationOutcome] = []
    for mut in mutations:
        try:
            with scaled_polar(mut.cl_scale, mut.cd_scale), \
                    scaled_atmosphere(mut.rho_scale):
                passed, summary = build_and_gate(**mut.overrides)
            outcomes.append(
                MutationOutcome(
                    name=mut.name,
                    caught=not passed,
                    detail=(f"gate FAILED the mutant: {summary}" if not passed
                            else f"NOT CAUGHT -- mutant still passed: {summary}"),
                )
            )
        except Exception as exc:  # noqa: BLE001 - a raise is a legitimate catch
            outcomes.append(
                MutationOutcome(
                    name=mut.name,
                    caught=True,
                    detail=f"raised {type(exc).__name__}: {str(exc)[:180]}",
                    raised=True,
                )
            )
    return tuple(outcomes)
