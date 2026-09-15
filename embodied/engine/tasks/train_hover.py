"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- train a PPO policy on the hover-and-leg task
    |                                           | (Stable-Baselines3, CPU), then evaluate it and the plant's own
    |                                           | controller on the same seeded episodes and write one report the
    |                                           | package routes can read. Deterministic for a seed. The report
    |                                           | says which one tracked better; nothing here decides that a
    |                                           | policy may fly -- that is the kinematic sim's gate (ADR-152 D4).
2   | maintainer@emeraldcoastsystemsgroup.com   | --residual trains the bounded correction; the report carries the mode, the policy file name and both flight paths.
3   | maintainer@emeraldcoastsystemsgroup.com   | The verdict has three facets (mean error, both endpoints, crashes) and needs all three; --rescore re-evaluates a saved policy without training.
4   | maintainer@emeraldcoastsystemsgroup.com   | --interface ctbr (the SimpleFlight recipe: collective thrust + body rates, the reference look-ahead, the smoothness penalty, thrust jitter) and --envs N parallel environments; the report records the interface, the smoothness weight, the jitter and the environment count; the mode names the files (hover-leg-ctbr-seedN).
Usage:
    python tasks/train_hover.py --timesteps 300000 --seed 0 --out /tmp/embodied-reports
    python tasks/train_hover.py --residual --timesteps 200000 --seed 0
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tasks.hover_leg import OBS_SIZE, OBS_SIZE_CTBR, RESIDUAL_SCALE, SMOOTH_LAMBDA, THRUST_JITTER, HoverLegEnv, baseline_policy, evaluate, verdict  # noqa: E402

EVAL_SEEDS = list(range(100, 110))


def main() -> int:
    parser = argparse.ArgumentParser(description="train and evaluate the hover-and-leg policy")
    parser.add_argument("--timesteps", type=int, default=300_000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=os.environ.get("EMBODIED_REPORT_DIR", "/tmp/embodied-reports"))
    parser.add_argument("--baseline-only", action="store_true", help="score the plant's controller and stop")
    parser.add_argument("--residual", action="store_true", help="learn a bounded correction on top of the plant's controller instead of absolute thrusts")
    parser.add_argument("--interface", default="motors", choices=["motors", "ctbr"], help="the action space: motor fractions (absolute or residual) or collective thrust + body rates")
    parser.add_argument("--envs", type=int, default=1, help="parallel environments (subprocesses) for training")
    parser.add_argument("--rescore", default=None, help="skip training: load this saved policy (a .zip in --out) and write a fresh report for it")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    import mujoco
    interface = args.interface
    residual = bool(args.residual) and interface == "motors"
    mode = "ctbr" if interface == "ctbr" else ("residual" if residual else "absolute")
    report: dict = {"task": "hover-leg", "mode": mode, "interface": interface, "residualScale": RESIDUAL_SCALE if residual else None, "seed": args.seed, "timesteps": 0,
                    "smoothLambda": SMOOTH_LAMBDA if interface == "ctbr" else 0.02, "thrustJitter": THRUST_JITTER if interface == "ctbr" else 0.0, "envs": args.envs,
                    "evalSeeds": EVAL_SEEDS, "mujoco": mujoco.__version__, "obsSize": OBS_SIZE_CTBR if interface == "ctbr" else OBS_SIZE,
                    "baseline": evaluate(baseline_policy, EVAL_SEEDS, residual=False, interface=interface), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if not args.baseline_only:
        import torch
        from stable_baselines3 import PPO
        import stable_baselines3
        torch.manual_seed(args.seed)
        env = HoverLegEnv(seed=args.seed, residual=residual, interface=interface)
        if args.envs > 1 and not args.rescore:
            from stable_baselines3.common.vec_env import SubprocVecEnv
            env = SubprocVecEnv([(lambda k=k: HoverLegEnv(seed=args.seed + 1000 * k, residual=residual, interface=interface)) for k in range(args.envs)])
        t0 = time.time()
        if args.rescore:
            policy_file = os.path.basename(args.rescore)
            policy_path = os.path.join(args.out, policy_file)
            model = PPO.load(policy_path, device="cpu")
            report["rescoredFrom"] = policy_file
        else:
            model = PPO("MlpPolicy", env, seed=args.seed, n_steps=2048 if args.envs == 1 else max(256, 8192 // args.envs), batch_size=64 if args.envs == 1 else 256, learning_rate=3e-4, gamma=0.99, verbose=0, device="cpu")
            model.learn(total_timesteps=args.timesteps)
            policy_file = f"hover-leg-ppo-{mode}-seed{args.seed}.zip"
            policy_path = os.path.join(args.out, policy_file)
            model.save(policy_path)

        def policy(obs: np.ndarray, _env: HoverLegEnv) -> np.ndarray:
            action, _ = model.predict(obs, deterministic=True)
            return action

        report.update({"timesteps": 0 if args.rescore else args.timesteps, "trainWallS": 0.0 if args.rescore else round(time.time() - t0, 1), "policyPath": policy_path, "policyFile": policy_file,
                       "sb3": stable_baselines3.__version__, "torch": torch.__version__, "policy": evaluate(policy, EVAL_SEEDS, residual=residual, interface=interface)})
        v = verdict(report["baseline"], report["policy"])
        report["verdict"] = v["facets"]
        report["policyBeatsBaseline"] = v["beats"]
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path = os.path.join(args.out, f"hover-leg-{mode}-seed{args.seed}.json" if not args.rescore else os.path.splitext(os.path.basename(args.rescore))[0].replace("ppo-", "") + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
