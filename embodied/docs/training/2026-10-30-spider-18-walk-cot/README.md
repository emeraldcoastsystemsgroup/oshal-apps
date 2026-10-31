# Spider-18 walk: the shape recipe with the cost-of-transport reward (2026-10-30)

`engine/tasks/hexapod_walk.py --task walk --recipe shape --envs 4 --timesteps 1000000 --seed S` with
`EMBODIED_HEXAPOD_REWARD=cot` (W_COT 0.02), MuJoCo 3.3.5, the design-mass fixtures, Stable-Baselines3 PPO on the
box's CPU, nice 10, three seeds in parallel. Scored on the same five evaluation commands as the CPG baseline
(forward 0.05–0.25 m/s with sideways and yaw components). The three report files beside this page are the evidence;
the policies (`hexapod-walk-ppo-shape-seedS.zip`) are kept with the handover, not committed.

| seed | CPG tracking (m/s) | policy tracking | CPG cost of transport | policy CoT | CPG falls | policy falls | train |
|---|---|---|---|---|---|---|---|
| 0 | 0.0424 | 0.0246 | 12.48 | 8.40 | 0 | 0 | 57 min |
| 1 | 0.0424 | 0.0195 | 12.48 | 8.34 | 0 | 0 | 58 min |
| 2 | 0.0424 | 0.0189 | 12.48 | 8.02 | 0 | 0 | 58 min |

**Every facet, every seed: the policy wins** (B30's walk bar). What it learned is a gait with shorter, faster steps
than the hand-written one: it tracks the command with half the error at two thirds of the energy. Earlier recipes
on this page's lineage: 18 joint residuals (lost on every facet), the shape recipe with a per-joule energy term
(won tracking, lost energy), the same at three times the weight (the same). Charging energy per metre of commanded
progress — the currency the verdict measures — is what turned it.

Not yet: the inverted task's recovery bar (its three runs follow), and the certification gate before the node may
play a learned gait (B19's gate is drone-shaped; the hexapod needs its own, see B30).

## The inverted task, same recipe (three seeds, ~51 min each in parallel)

`--task inverted`: the body is rolled over at 1.5 s while walking 0.15 m/s; the detector reads the accelerometer,
the mirror rule switches the gait, and the score is tracking, cost of transport, falls and the seconds from the
roll to forward speed back at half the command.

| seed | CPG tracking | policy tracking | CPG CoT | policy CoT | CPG recovery (s) | policy recovery (s) | recovered |
|---|---|---|---|---|---|---|---|
| 0 | 0.0636 | 0.0504 | 13.53 | 10.23 | 0.34 | 0.41 | 5 / 5 of 5 |
| 1 | 0.0636 | 0.0560 | 13.53 | 9.23 | 0.34 | 0.46 | 5 / 5 of 5 |
| 2 | 0.0636 | 0.0518 | 13.53 | 9.05 | 0.34 | 0.36 | 5 / 5 of 5 |

Tracking, cost of transport and falls: the policy wins on every seed, and it recovers five of five times like the
gait. **Recovery time: the policy loses on every seed** (0.36–0.46 s against 0.34 s). The reward carries no term
for the recovery window, so the policy has no reason to hurry it; B30's inverted bar stays open with that as the
next change — tried in the next section.

## The inverted task with a recovery-time term (three seeds, ~68 min each in parallel)

The same recipe with `EMBODIED_HEXAPOD_W_RECOVER=2.0`: every control step between the roll and the recovery costs
2.0 × 0.02 s = 0.04 against the 0.5 alive bonus, so the policy is paid to hurry the recovery window. The reports are
`hexapod-inverted-shape-recover-seed{0,1,2}.json` beside this page.

| seed | CPG tracking | policy tracking | CPG CoT | policy CoT | CPG detect / recovery (s) | policy detect / recovery (s) | recovered |
|---|---|---|---|---|---|---|---|
| 0 | 0.0636 | 0.0559 | 13.53 | 9.06 | 0.28 / 0.34 | 0.26 / 0.42 | 5 of 5 |
| 1 | 0.0636 | 0.0541 | 13.53 | 8.68 | 0.28 / 0.34 | 0.24 / 0.37 | 5 of 5 |
| 2 | 0.0636 | 0.0728 | 13.53 | 15.87 | 0.28 / 0.34 | 0.28 / 0.49 | 5 of 5 |

**The term does not close the recovery bar.** Recovery is 0.37–0.49 s against the CPG's 0.34 s, no better than the
runs without the term (0.36–0.46 s). Seeds 0 and 1 keep the tracking and cost-of-transport wins; seed 2 loses those
too (mean return 35 against the CPG's 80). What the reports say about the window: the CPG detects the roll 0.28 s
after it and is back at half the commanded speed 0.06 s later; two of the policies detect sooner (0.24–0.26 s) and
then take 0.13–0.16 s from detection to speed. The policy's actions are the gait-shape scales (stride, swing, step
rate); the detector's hold and the mirror switch are not among them. B30 keeps the inverted bar open and lists the
next options.

## The certification gate on the three walk policies (2026-10-30, 0.19.3)

`POST /physics/hexapod/certify {file}` (engine/tasks/hexapod_certify.py) replays each policy and the CPG on the five
evaluation seeds through the fall limit and the servo's torque limits — RMS over an episode against the design's continuous
torque (1.47 N·m), peak against the stall (2.94 N·m) — re-measures the verdict, and rolls the walk policy over once. The
certificates `hexapod-walk-ppo-shape-seed{0,1,2}.certificate.json` are beside this page (the `buildHash` is the engine
build that wrote them; the gate refuses a certificate from another build).

| seed | control steps checked | beats the CPG (re-measured) | roll: recovered / falls / seconds | refusals | max RMS torque (actuator) | certified |
|---|---|---|---|---|---|---|
| 0 | 1631 | yes | yes / 0 / 0.64 | 10 | 2.10 N·m (L3-tibia) | **no** |
| 1 | 1631 | yes | yes / 0 / 0.84 | 9 | 1.92 N·m (R3-tibia) | **no** |
| 2 | 1631 | yes | yes / 0 / 0.70 | 7 | 1.93 N·m (L3-tibia) | **no** |

Every refusal is a tibia or femur servo whose RMS torque over an episode is above 1.47 N·m; no policy fell, and each one
recovered from the roll it was never trained for. The CPG itself reads 1.87 N·m on R1-tibia under the same gate (19
refusals over the same episodes), so the bar is one the hand-written gait does not meet either: BACKLOG B31. Until a gait or
a geometry passes it, the node plays the CPG, and `hexapod.load {controller: "policy:…"}` is refused by name.
