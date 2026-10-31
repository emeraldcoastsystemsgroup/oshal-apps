# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-203: an engine built from this package alone can play the certified gait. The certificate in policies/ must verify under THIS tree's build hash through the one door (load_certified), so moving an engine runtime file without re-certifying goes red here; the start script seeds a report directory with the policy, certificate and report, never the weights, and leaves a person's own reports alone.
"""The certified gait ships inside the engine. python -m pytest engine/tests/test_shipped_policies.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ENGINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "tasks"))
sys.path.insert(0, os.path.join(ENGINE, "container"))
POLICIES = os.path.join(ENGINE, "policies")
STEM = "hexapod-walk-ppo-shape-seed1"


class ShippedPolicies(unittest.TestCase):
    def test_the_certificate_verifies_under_this_trees_build(self):
        from embodied_engine_bridge import build_hash
        from hexapod_certify import load_certified, policy_sha256
        policy = os.path.join(POLICIES, f"{STEM}.zip")
        with open(os.path.join(POLICIES, f"{STEM}.certificate.json"), encoding="utf-8") as fh:
            cert = json.load(fh)
        self.assertTrue(cert["ok"])
        self.assertEqual(cert["buildHash"], build_hash(ENGINE), "an engine runtime file moved: re-certify the shipped gait")
        self.assertEqual(cert["policySha256"], policy_sha256(policy))
        self.assertTrue(load_certified(policy))

    def test_the_weights_are_the_certified_policys(self):
        from hexapod_certify import policy_sha256
        with open(os.path.join(POLICIES, f"{STEM}.weights.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["policySha256"], policy_sha256(os.path.join(POLICIES, f"{STEM}.zip")))

    def test_the_start_script_seeds_reports_and_keeps_a_persons_own(self):
        script = os.path.join(ENGINE, "container", "start-engine.sh")
        with tempfile.TemporaryDirectory() as reports:
            mine = os.path.join(reports, "plant-mine-reach-seed0.json")
            with open(mine, "w", encoding="utf-8") as fh:
                fh.write("{}")
            stale = os.path.join(reports, f"{STEM}.certificate.json")
            with open(stale, "w", encoding="utf-8") as fh:
                fh.write("stale")
            env = {**os.environ, "EMBODIED_ENGINE_DIR": ENGINE, "EMBODIED_REPORT_DIR": reports}
            out = subprocess.run(["sh", script, "sh", "-c", "echo started"], env=env, capture_output=True, text=True, check=True)
            self.assertEqual(out.stdout.strip(), "started", "the script hands over to the command it was given")
            names = sorted(os.listdir(reports))
            self.assertEqual(names, sorted([f"{STEM}.zip", f"{STEM}.certificate.json", "hexapod-walk-shape-seed1.json", "plant-mine-reach-seed0.json"]))
            with open(stale, encoding="utf-8") as fh:
                self.assertTrue(json.load(fh)["ok"], "an older certificate is replaced by the image's")


if __name__ == "__main__":
    unittest.main()
