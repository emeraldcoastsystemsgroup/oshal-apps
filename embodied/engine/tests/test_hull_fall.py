"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1 on the REAL plant: the explorer hull, generated as
    |                                           | one solid into the air medium, loaded into MuJoCo and stepped.
    |                                           | The boat falls at g and lands on the floor; the gravity the
    |                                           | controller reads back out of the model is the medium's vector;
    |                                           | and the scene carries no fluid model at all, because this
    |                                           | package emits neither <option> density nor viscosity and has
    |                                           | never run one. The TypeScript guard (tests/engine-medium.test.js)
    |                                           | owns the generator and the refusals; this file owns the one
    |                                           | claim only MuJoCo can settle -- that the emitted scene actually
    |                                           | falls at the medium's g.
2   | maintainer@emeraldcoastsystemsgroup.com   | The fall case asserts a DISCRETE trajectory. As first committed it
    |                                           | had never been executed and could not pass at the fixture's step:
    |                                           | it compared data.cvel to the continuous -g*t under abs_tol=5e-3,
    |                                           | but cvel trails the integrator's own velocity by exactly one
    |                                           | velocity update, a CONSTANT g*dt = 1.962e-2 m/s, so no run of it
    |                                           | could ever have gone green; and its height bound of 2e-3 was
    |                                           | smaller than the g*dt*t/2 by which the discrete trajectory leads
    |                                           | the closed form past about half the fall. Both bounds are now
    |                                           | derived from model.opt.timestep with the derivation written beside
    |                                           | them, and the fall itself is asserted on qvel, which carries no
    |                                           | discretization error at all. Adds a pytest-free __main__ runner:
    |                                           | the shipped engine image has no pytest, so this is how the guard
    |                                           | is executed on the real plant. BACKLOG B25.
"""
from __future__ import annotations

import math
import os

import mujoco

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "explorer-hull-air.xml")

# The hull as the design study publishes it, and the air row's gravity. Both are asserted against the
# fixture rather than typed twice: these are what the numbers MUST be, and a drift in either fails here.
ENVELOPE_M = 0.300
ALL_UP_MASS_KG = 24.7
G_MPS2 = 9.81
RELEASE_UNDERSIDE_M = 2.0

# Float accumulation, not physics. Every quantity compared below is an n-fold sum over the steps of
# the fall (n <= 239 at the shipped step), so the round-off separating it from the same value
# computed in closed form is of order n * eps * |value|. Measured on MuJoCo 3.3.5 it is at most
# 7.2e-15 across the three samples; this allowance sits six orders above that. It is NOT cover for a
# discretization term -- those are written out explicitly at the assertions that carry them.
ROUNDOFF = 1e-9


def _model() -> mujoco.MjModel:
    return mujoco.MjModel.from_xml_path(FIXTURE)


def test_the_scene_carries_the_mediums_gravity_and_no_fluid_model() -> None:
    model = _model()
    assert list(model.opt.gravity) == [0.0, 0.0, -G_MPS2]
    # ADR-160 D7: the generator emits no density and no viscosity, so MuJoCo's own fluid model does
    # not run and this scene makes no fluid claim of any kind. Defaults are zero; anything else would
    # mean the slice had started making one.
    assert model.opt.density == 0.0
    assert model.opt.viscosity == 0.0
    with open(FIXTURE, "r", encoding="utf-8") as handle:
        xml = handle.read()
    assert "density=" not in xml and "viscosity=" not in xml


def test_the_hull_is_one_solid_of_the_published_envelope_and_mass() -> None:
    model = _model()
    body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "explorer-hull")
    assert body != -1
    assert math.isclose(model.body_mass[body], ALL_UP_MASS_KG, rel_tol=1e-9)
    geom = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, "explorer-hull-solid")
    assert geom != -1
    for half in model.geom_size[geom][:3]:
        assert math.isclose(half, ENVELOPE_M / 2, rel_tol=1e-9)
    # ONE solid: the eleven-part parts model is explicitly out of this slice.
    assert model.nbody == 2  # world + the hull
    assert model.nu == 0  # nothing drives it; it only falls


def test_the_boat_falls_at_g_and_lands_on_the_floor() -> None:
    model = _model()
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    half = ENVELOPE_M / 2
    assert math.isclose(data.xpos[1][2], RELEASE_UNDERSIDE_M + half, abs_tol=ROUNDOFF)

    dt = model.opt.timestep
    fall_time = math.sqrt(2 * RELEASE_UNDERSIDE_M / G_MPS2)

    # WHAT IS ASSERTED, AND WHY EACH BOUND HAS THE FORM IT HAS.
    #
    # The claim this file exists to settle is that the EMITTED scene falls at the medium's g. The
    # closed form h - g t^2 / 2 is what the TypeScript side hands the operator, but MuJoCo integrates
    # in discrete steps and does not sit on that curve. The gap is not noise to be absorbed by a
    # tolerance somebody picked until the run went green -- it is two exactly known terms, each
    # proportional to the step, and each bound below is that term written down:
    #
    #   qvel   The integrator applies ONE velocity update per step, v <- v + a*dt, so after n steps
    #          the free joint's vertical velocity is -g*n*dt = -g*t with NO discretization error at
    #          all. That is the quantity which states "it falls at g", so the fall is asserted on it,
    #          under ROUNDOFF alone (measured residual <= 7.2e-15, MuJoCo 3.3.5).
    #   cvel   data.cvel is the body's spatial velocity as of the last forward pass, and is therefore
    #          exactly one velocity update behind qvel: it differs from -g*t by g*dt -- a CONSTANT
    #          1.962e-2 m/s at this fixture's 2 ms step, measured identical at every sample and equal
    #          to mj_objectVelocity. The original abs_tol=5e-3 against -g*t was SMALLER than an error
    #          that never shrinks, so that assertion could not pass at this timestep and never had.
    #          Bounding the lag by g*dt keeps the channel checked and admits exactly one stale step.
    #   xpos   Summing velocity across a step rather than integrating the parabola leaves half a
    #          velocity-step per elapsed second, so the discrete height LEADS the closed form by
    #          exactly g*dt*t/2 (measured 4.68918e-3 m at t = 0.478 s). The original abs_tol=2e-3
    #          cleared that at a quarter of the fall and would have failed at three quarters; it
    #          escaped notice only because the velocity assertion fired first.
    #
    # Every bound is therefore g, dt and t, with dt read from model.opt.timestep, so it tightens on
    # its own if the plant's step ever changes. Shrinking dt is NOT the fix and is not done here: the
    # 2 ms step is the plant this package ships, and the scene under test is that one.
    for fraction in (0.25, 0.5, 0.75):
        target_t = fall_time * fraction
        while data.time < target_t - dt / 2:
            mujoco.mj_step(model, data)
        t = data.time
        where = (t, data.xpos[1][2], data.qvel[2], data.cvel[1][5])

        # It falls at g: the integrator's own vertical velocity IS -g*t.
        assert math.isclose(data.qvel[2], -G_MPS2 * t, rel_tol=0.0, abs_tol=ROUNDOFF), where
        # The body-frame channel agrees with it to within its one stale velocity update.
        assert abs(data.cvel[1][5] - (-G_MPS2 * t)) <= G_MPS2 * dt + ROUNDOFF, where
        # And the height is the operator's analytic prediction to within the integrator's own lead.
        expected = RELEASE_UNDERSIDE_M + half - G_MPS2 * t * t / 2
        assert math.isclose(
            data.xpos[1][2], expected, rel_tol=0.0, abs_tol=G_MPS2 * dt * t / 2 + ROUNDOFF
        ), (where, expected)

    while data.time < 3.0:
        mujoco.mj_step(model, data)
    # It is ON THE GROUND, not hovering and not through it. 5 mm is the contact allowance: MuJoCo's
    # default soft contact lets the box settle a fraction of a millimetre into the plane (measured
    # 5.7e-5 m), while a hull that had punched through or bounced to rest above the floor misses this
    # by centimetres.
    assert math.isclose(data.xpos[1][2], half, abs_tol=5e-3), data.xpos[1][2]
    assert abs(data.cvel[1][5]) < 1e-2, data.cvel[1][5]


if __name__ == "__main__":  # the shipped engine image has no pytest; see README "Build and test"
    import sys
    import traceback

    names = sorted(
        name for name, value in list(globals().items()) if name.startswith("test_") and callable(value)
    )
    if not names:
        # A runner that discovers nothing and exits 0 is a guard that does not exist.
        print("FAIL: no test_* function was discovered in this module", file=sys.stderr)
        raise SystemExit(2)
    failures = 0
    for name in names:
        try:
            globals()[name]()
        except BaseException:  # a runner reports every failure shape, assertions included
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print(f"{len(names) - failures} passed, {failures} failed")
    raise SystemExit(1 if failures else 0)
