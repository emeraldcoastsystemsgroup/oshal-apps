# Spider-18: the first certified gait (2026-10-30, embodied 0.19.4)

Since 0.20.1 the certified seed's policy, certificate, report and weights live in `engine/policies/` so the engine image carries them; the other seeds' evidence stays here.

`engine/tasks/hexapod_walk.py --task walk --recipe shape --envs 4 --timesteps 1000000 --seed S` with
`EMBODIED_HEXAPOD_REWARD=cot`, `EMBODIED_HEXAPOD_W_TORQUE=1.0`, `EMBODIED_HEXAPOD_TORQUE_LIMIT_NM=1.47` (the design's usable
torque, `GET /build/hexapod` joints[].usableNm, stated by the run) and `EMBODIED_HEXAPOD_ROLL_FRACTION=0.5`, MuJoCo 3.3.5,
the design-mass fixtures, Stable-Baselines3 PPO on the box's CPU, three seeds in parallel, about 40 minutes each. Each
policy then went through the certification gate (`hexapod.certify`, continuous torque 1.47 N·m): the plain walk episodes on
the five evaluation seeds plus the roll replay. The files beside this page are the evidence: the training reports
(`hexapod-walk-shape-seedS.json`), the certificates (`hexapod-walk-ppo-shape-seedS.certificate.json`) and, for the
certified seed, the policy itself (`hexapod-walk-ppo-shape-seed1.zip`, 221 KB) so the live engine can play it.

| seed | certified | refusals | max RMS torque, walk / roll (N·m) | gate tracking (CPG → policy) | gate CoT (CPG → policy) | falls | roll recovered in |
|---|---|---|---|---|---|---|---|
| 0 | **yes** | 0 | 1.35 / 0.99 | 0.042 → 0.060 (loses) | 12.5 → 7.9 | 0 | 0.46 s |
| 1 | **yes** | 0 | 1.13 / 0.94 | 0.042 → 0.040 | 12.5 → 6.8 | 0 | 0.50 s |
| 2 | no | 2 | 1.50 / 1.48 | 0.042 → 0.055 (loses) | 12.5 → 8.2 | 0 | 0.46 s |

**Seed 1 is the first gait that is both certified and better than the hand-written one**: B30's bar (a policy that wins,
through the gate) and B31's done-when (a gait under the continuous torque with the walk bar still met). The report's own
`policyBeatsBaseline` reads false for every seed because the report's evaluation rolls half its episodes (the training
distribution; the CPG baseline there is 0.066 m/s / 16.3); the gate's plain walk replay plus the explicit roll is the
authority, and the certificate carries both.

## The step before: the torque term without the roll

`torque-only-*` beside this page: the same recipe without `EMBODIED_HEXAPOD_ROLL_FRACTION`. All three seeds walked under the
limit (max RMS 1.03 / 1.06 / 1.38 N·m) and beat the CPG on every facet (tracking 0.038 / 0.028 / 0.031, cost of transport
7.4 / 6.6 / 7.4, no falls), and all three were refused only in the roll replay (three tibia servos at 1.50–1.79 N·m while
inverted), because a walk policy had never been inverted during training. Rolling half the training episodes is what
closed that.

## Playing it

`hexapod-walk-ppo-shape-seed1.weights.json` beside this page is the same policy exported for the Pi by
`engine/hexapod_policy.export_policy` (through the gate's door; NumPy actor within 5.8e-7 of the torch one; the geometry
it was certified on inside). The node plays it on the fake and serial bodies: put it in `EMBODIED_HEXAPOD_POLICY_DIR` and
`load {controller: "policy:hexapod-walk-ppo-shape-seed1.zip"}`, then `walk`.

On the plant body: `load {mjcf, controller: "policy:hexapod-walk-ppo-shape-seed1.zip"}` through the node (the plant
refuses it by name unless the certificate beside the policy is ok, carries the zip's sha256 and this engine's build hash),
then `walk`. The policy and its certificate must be in the engine's report directory (`EMBODIED_REPORT_DIR`,
`/tmp/embodied-reports` in the container); the spider-18 promote script copies them there after it rebuilds the engine.

## Re-certified for embodied 0.20.0 (ADR-203 D9)

The generic plant (`engine/embodied_plant.py`) and its reach task (`engine/tasks/plant_reach.py`) joined the engine's
runtime files, so the build hash moved from `7346d37a…` to `5d9e7068…` and every certificate bound to the old build
stopped opening the plant's policy door. Seed 1 was run through the gate again on the new build with the same design
limit (1.47 N·m, the design's usable torque) and the same evaluation seeds: `ok`, 1631 control steps, 0 refusals, max RMS
torque 1.134 N·m on R3-tibia, peak 2.942 N·m, the roll recovered in 0.50 s, the policy beating the CPG on every facet —
the same numbers as the first certificate, under the new `buildHash`. `hexapod-walk-ppo-shape-seed1.certificate.json`
beside this page is that run; the policy, its weights file and the report are unchanged. Seeds 0 and 2 and the
`torque-only-*` certificates keep the old build hash as the record of what the 0.19.4 gate measured; they are not
loaded by any door.
