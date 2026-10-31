"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the spider-18 controller without a robot or a
    |                                           | container (ADR-202, lane L4): the Python mirror rule equals the
    |                                           | fixture the TypeScript contract generated; the leg kinematics
    |                                           | round-trip; on the fake body a walk integrates forward with the
    |                                           | two tripods alternating, the inverted switch flips on a settled
    |                                           | gravity sign change and not on a transient, the flip sequence
    |                                           | completes and the mirror follows, pose/jump/sit/sense have the
    |                                           | brief's shapes; the real rail answers the command envelopes over
    |                                           | HTTP under its command key; the plant body speaks the brief's
    |                                           | hexapod.* protocol against a fake bridge (wrapped and flat
    |                                           | replies, no_spring passed through, a wrong actuator order
    |                                           | refused); the serial body drives a fake port (the sync write,
    |                                           | the read-back, torque, the latch servo). Runs itself: no pytest.
2   | maintainer@emeraldcoastsystemsgroup.com   | The pose/jump/sit/sense case split in two (pose and jump; sense,
    |                                           | sit and estop on a fresh node) to keep every function under the
    |                                           | fifty-line rule; the assertions are unchanged.
3   | maintainer@emeraldcoastsystemsgroup.com   | Guard: the heartbeat telemetry carries the node's inverted
    |                                           | decision as `inverted` and the body's truth as `bodyInverted`.
4   | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: the plant body loads `controller: policy:<file>` and, walking,
    |                                           | sends the command and reports the policy's targets as `sent`; an
    |                                           | uncertified policy is refused by the plant's name; the fake body
    |                                           | refuses `policy_needs_plant`.
5   | maintainer@emeraldcoastsystemsgroup.com   | B30: the fake body plays an exported policy -- a zero network is the
    |                                           | gait exactly, so the brain's targets equal cpg_targets on the geometry
    |                                           | fixture; the refusals by name; a serial load without a controller
    |                                           | still refuses.
"""
from __future__ import annotations

import json
import math
import os
import socket
import socketserver
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))
import hexapod_bus as B  # noqa: E402
import hexapod_spec as S  # noqa: E402
from embodied_engine_node import COMMAND_PATH, HEARTBEAT_PATH  # noqa: E402
from embodied_hexapod_backends import FakeBackend, PlantBackend, PlantRefusal, SerialBackend  # noqa: E402
from embodied_hexapod_node import COMMANDS, HEXAPOD_KIND, HexapodController, HexapodRail, InvertedSwitch, hexapod_build_hash, start_hexapod_node  # noqa: E402
from hexapod_gait import CYCLE_S, TripodGait, default_foot, leg_fk, leg_ik, sit_targets, stance_targets  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "hexapod-node-contract.json")
STATE_KEYS = ("timeS", "bodyPosM", "bodyQuatWXYZ", "bodyVelMps", "gyroRadS", "accelMps2", "jointPosRad", "jointVelRadS", "jointTorqueNm", "footContact", "inverted", "fell", "spring")
TOKEN = "oshal_pat_t3st-hexapod-credential"
KEY = "k3y-" + "h" * 40
DT = 0.02
G = 9.81


def close(a, b, tol=1e-9) -> bool:
    return len(a) == len(b) and all(abs(float(x) - float(y)) <= tol for x, y in zip(a, b))


def refused(fn, code: str):
    """Call fn and assert it raised the refusal `code` (the exception class is named after the code)."""
    try:
        fn()
    except PlantRefusal as error:
        assert type(error).__name__ == code and str(error).startswith(code + ":"), (type(error).__name__, str(error))
        return error
    raise AssertionError(f"expected the refusal {code}")


# -- the contract ------------------------------------------------------------------------------

def test_the_mirror_rule_equals_the_typescript_fixture() -> None:
    with open(FIXTURE, encoding="utf-8") as fh:
        fx = json.load(fh)
    assert fx["actuatorOrder"] == list(S.ACTUATOR_ORDER) and fx["legIds"] == list(S.LEG_IDS) and fx["legJoints"] == list(S.LEG_JOINTS)
    assert fx["mirrorLegRole"] == {leg: S.mirror_leg_role(leg) for leg in S.LEG_IDS}
    assert len(fx["cases"]) >= 8
    for case in fx["cases"]:
        assert close(S.inverted_joint_targets(case["targets"]), case["inverted"], 1e-12), case["name"]
        assert close(S.inverted_joint_targets(S.inverted_joint_targets(case["targets"])), case["targets"], 1e-12), "the rule is its own inverse"
    for joint in ("coxa", "femur", "tibia"):
        assert list(fx["limitsDeg"][f"{joint}Deg"]) == list(S.LIMITS_DEG[joint])
    lay = fx["layout"]
    assert (lay["coxaMm"], lay["femurMm"], lay["tibiaMm"], lay["standHeightMm"], lay["footRadiusMm"]) == (S.COXA_MM, S.FEMUR_MM, S.TIBIA_MM, S.STAND_HEIGHT_MM, S.FOOT_RADIUS_MM)
    for leg, m in lay["coxaMounts"].items():
        assert (m["xMm"], m["yMm"], m["neutralYawDeg"]) == S.COXA_MOUNTS[leg]
    assert fx["spring"]["storedJ"] == S.SPRING_STORED_J
    try:
        S.inverted_joint_targets([0.0] * 17)
        raise AssertionError("17 targets were accepted")
    except ValueError:
        pass


def test_leg_kinematics_round_trip_and_the_stance_is_inside_the_limits() -> None:
    for leg in S.LEG_IDS:
        for dx, dy, dz in ((0, 0, 0), (30, -20, 25), (-35, 25, -10), (40, 40, 30)):
            f = default_foot(leg)
            target = (f[0] + dx, f[1] + dy, f[2] + dz)
            c, fe, ti = leg_ik(leg, target)
            assert close(leg_fk(leg, c, fe, ti), target, 1e-6), (leg, target)
        c, fe, ti = leg_ik(leg, (default_foot(leg)[0], default_foot(leg)[1], -S.STAND_HEIGHT_MM))
        assert abs(c) < 1e-9, "the default foot lies on the neutral yaw: coxa 0"
        assert fe < 0 < ti, "knee up: the femur rises a little, the tibia bends down"
    forward = leg_ik("L1", (default_foot("L1")[0] + 30, default_foot("L1")[1], -S.STAND_HEIGHT_MM))[0]
    assert forward > 0 and leg_ik("R1", (default_foot("R1")[0] + 30, default_foot("R1")[1], -S.STAND_HEIGHT_MM))[0] > 0, "a foot moved forward is a positive coxa on either side"
    assert stance_targets() == S.clamp_targets(stance_targets()) and sit_targets() == S.clamp_targets(sit_targets())
    assert close(leg_fk("L2", 0.0, 0.0, 0.0), (0.0, 68 + 45 + 80 + 120, 0.0), 1e-9), "the zero pose: the leg straight out along its neutral yaw"


# -- the fake body ------------------------------------------------------------------------------

def test_a_walk_integrates_forward_and_the_tripods_alternate() -> None:
    node = HexapodController(FakeBackend(), tick_hz=50)
    assert node.hello()["kind"] == HEXAPOD_KIND and node.hello()["engine"] == "hexapod-fake" and node.hello()["buildHash"] == hexapod_build_hash()
    r = node.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
    assert r["node"]["mode"] == "walk" and r["node"]["command"] == {"vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0}
    contacts = set()
    for _ in range(100):
        st = node.tick()
        contacts.add(tuple(st["footContact"]))
        assert st["jointPosRad"] == S.clamp_targets(st["jointPosRad"]) and len(st["jointPosRad"]) == 18
    assert abs(st["bodyPosM"][0] - 0.2) < 1e-6 and abs(st["bodyPosM"][1]) < 1e-9, st["bodyPosM"]
    assert contacts == {(True, False, True, False, True, False), (False, True, False, True, False, True)}, "L1 L3 R2 against L2 R1 R3"
    assert 0.0 < node.gait.phase < 1.0 and node.ticks == 100
    node.handle({"op": "walk", "vxMps": 0.0, "vyMps": 0.0, "yawRateRadS": 1.0})
    for _ in range(25):
        st = node.tick()
    assert abs(st["bodyQuatWXYZ"][3] - math.sin(0.25)) < 1e-6, "a quarter second of 1 rad/s"
    r = node.handle({"op": "stop", "x": 1})
    assert r["node"]["mode"] == "idle"
    st = node.tick()
    assert st["footContact"] == [True] * 6 and close(node.sent, stance_targets(), 1e-12), "idle holds the stance"
    for bad in ({"vxMps": "fast"}, {"vxMps": float("nan")}, {"vxMps": True}):
        try:
            node.handle({"op": "walk", **bad})
            raise AssertionError(f"walk accepted {bad}")
        except ValueError:
            pass
    try:
        node.handle({"op": "takeoff"})
        raise AssertionError("an unknown command was accepted")
    except ValueError as error:
        assert "walk" in str(error)


def test_the_inverted_switch_flips_on_a_settled_sign_change_not_on_a_transient() -> None:
    sw = InvertedSwitch(threshold_mps2=3.0, settle_s=0.3)
    for _ in range(5):
        assert sw.update(-G, 0.02) is False, "a 0.1 s knock is not a flip"
    assert sw.update(G, 0.02) is False and sw.pending is None
    for _ in range(14):
        assert sw.update(-G, 0.02) is False
    assert sw.update(-G, 0.02) is True and sw.flips == 1, "0.3 s of the other sign is"
    for _ in range(50):
        assert sw.update(1.0, 0.02) is True, "readings inside the dead band change nothing"
    for _ in range(10):
        sw.update(G, 0.02)
    sw.update(0.5, 0.02)
    for _ in range(10):
        assert sw.update(G, 0.02) is True, "the settling clock restarts after a dead-band reading"
    for _ in range(5):
        sw.update(G, 0.02)
    assert sw.inverted is False and sw.flips == 2
    assert sw.settle_now(-G) is True and sw.settle_now(0.0) is True and sw.settle_now(G) is False
    # Through the node: the fake body's gravity sign follows its inverted flag; a pulse does not fool the node.
    fake = FakeBackend()
    node = HexapodController(fake, tick_hz=50)
    fake.pulse_accel([0.0, 0.0, -G], 8)
    for _ in range(20):
        st = node.tick()
    assert st["node"]["inverted"] is False and close(node.sent, stance_targets(), 1e-12)
    fake.inverted = True
    for _ in range(15):
        st = node.tick()
    assert st["node"]["inverted"] is False and st["inverted"] is True, "the body's truth is ahead of the node's decision while it settles"
    assert close(node.sent, stance_targets(), 1e-12), "and the targets are still the upright stance"
    st = node.tick()
    assert st["node"]["inverted"] is True and st["node"]["mirrored"] is True, "0.3 s of -g, read before this tick's plan"
    assert close(node.sent, S.inverted_joint_targets(stance_targets()), 1e-12), "the idle stance is the mirrored stance on the same tick"
    node.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
    gait = TripodGait()
    gait.set_command(0.1, 0.0, 0.0)
    gait.phase = node.gait.phase
    for _ in range(5):
        st = node.tick()
        assert close(node.sent, S.inverted_joint_targets(gait.tick(DT)), 1e-12), "every walking target is the mirror rule over the upright plan"


def test_the_flip_sequence_completes_and_the_mirror_follows_the_body() -> None:
    fake = FakeBackend()
    node = HexapodController(fake, tick_hz=50)
    node.tick()
    r = node.handle({"op": "flip"})
    assert r["node"]["mode"] == "flip" and r["flip"] == {"side": "right", "durationS": 3.6, "keyframes": 4, "fromInverted": False}
    refused(lambda: node.handle({"op": "walk", "vxMps": 0.1}), "busy")
    refused(lambda: node.handle({"op": "flip"}), "busy")
    refused(lambda: node.handle({"op": "jump"}), "busy")
    ticks = int(round(3.6 / DT))
    pushes = []
    for i in range(ticks):
        st = node.tick()
        if i == ticks // 2:
            fake.inverted = True  # the roll went over: the body reads -g from here on
            assert st["node"]["mode"] == "flip" and st["node"]["mirrored"] is False, "the push plays in the frame it started in"
        if 0.6 / DT < i < 2.1 / DT:
            pushes.append(st["jointPosRad"][S.actuator_index("R2", "femur")] - st["jointPosRad"][S.actuator_index("L2", "femur")])
    assert all(p > 0 for p in pushes[5:]), "the right legs push down while the left legs fold up"
    st = node.tick()
    assert st["node"]["mode"] == "idle" and st["node"]["flip"] is None and st["node"]["inverted"] is True
    assert close(node.sent, S.inverted_joint_targets(stance_targets()), 1e-12), "after the roll the stance stands on the other face"
    r = node.handle({"op": "flip", "side": "left"})
    assert r["flip"]["fromInverted"] is True and r["flip"]["side"] == "left"
    st = node.tick()
    assert st["node"]["mirrored"] is True, "a flip from the inverted body plays mirrored"
    try:
        node.handle({"op": "stop"})
        node.handle({"op": "flip", "side": "up"})
        raise AssertionError("a bad side was accepted")
    except ValueError:
        pass


def test_pose_and_jump_have_the_briefs_shapes() -> None:
    fake = FakeBackend()
    node = HexapodController(fake, tick_hz=50)
    targets = [0.1 * ((i % 3) - 1) for i in range(18)]
    r = node.handle({"op": "pose", "targetsRad": targets})
    assert r["node"]["mode"] == "pose"
    node.tick()
    assert close(node.sent, targets, 1e-12)
    for bad in ([0.0] * 17, [0.0] * 17 + ["x"], None, [0.0] * 17 + [float("inf")]):
        try:
            node.handle({"op": "pose", "targetsRad": bad})
            raise AssertionError("pose accepted a bad target set")
        except ValueError:
            pass
    fake.inverted = True
    for _ in range(16):
        node.tick()
    assert close(node.sent, S.inverted_joint_targets(targets), 1e-12), "a pose is upright intent: mirrored when the body is inverted"
    node.handle({"op": "pose", "targetsRad": targets, "raw": True})
    node.tick()
    assert close(node.sent, targets, 1e-12), "raw: sent as given"
    fake.inverted = False
    node.handle({"op": "reset"})
    assert node.switch.inverted is False
    r = node.handle({"op": "jump"})
    assert r["jumped"] is True and r["spring"] == {"storedJ": S.SPRING_STORED_J, "latched": False}
    peak = 0.0
    for _ in range(60):
        st = node.tick()
        peak = max(peak, st["bodyPosM"][2])
        if st["bodyPosM"][2] > fake.rest_z + 1e-6:
            assert st["footContact"] == [False] * 6, "no foot touches the ground in the air"
    assert fake.rest_z + 0.18 < peak <= fake.rest_z + 0.19 + 1e-9 and abs(st["bodyPosM"][2] - fake.rest_z) < 1e-9, "a hop of the brief's 19 cm (sampled at ticks), then back on the ground"
    refused(lambda: HexapodController(FakeBackend(has_spring=False)).handle({"op": "jump"}), "no_spring")


def test_sense_sit_and_estop_have_the_briefs_shapes() -> None:
    fake = FakeBackend()
    node = HexapodController(fake, tick_hz=50)
    node.handle({"op": "reset"})
    r = node.handle({"op": "sense"})
    for key in STATE_KEYS:
        assert key in r, key
    assert r["lidar"] == {"anglesRad": [], "rangesM": []} and r["lidarSource"] == "none" and r["node"]["mode"] == "idle", "a reset returns the node to idle"
    assert len(r["jointPosRad"]) == 18 and len(r["footContact"]) == 6 and len(r["bodyQuatWXYZ"]) == 4
    for op in ("sit", "land"):
        r = node.handle({"op": op})
        assert r["node"]["mode"] == "sit" and r["node"]["relaxed"] is False
    for _ in range(50):
        node.tick()
    assert fake.relaxed is False
    st = node.tick()
    assert fake.relaxed is True and st["node"]["relaxed"] is True and close(node.sent, sit_targets(), 1e-12), "after a second the legs are folded and the servos relaxed"
    r = node.handle({"op": "walk", "vxMps": 0.05, "vyMps": 0.0, "yawRateRadS": 0.0})
    assert r["node"]["relaxed"] is False, "a walk engages the servos again"
    node.tick()
    node.handle({"op": "flip"})
    r = node.handle({"op": "estop"})
    assert r["estopped"] is True and r["node"]["mode"] == "estop" and r["node"]["relaxed"] is True and r["node"]["flip"] is None, "e-stop interrupts even a flip"
    x = fake.pos[0]
    st = node.tick()
    assert close(node.sent, S.clamp_targets(r["jointPosRad"]), 1e-12) and st["node"]["mirrored"] is False and fake.pos[0] == x, "held where it stood, nothing moves"
    assert node.handle({"op": "walk", "vxMps": 0.05, "vyMps": 0.0, "yawRateRadS": 0.0})["node"]["relaxed"] is False
    assert set(COMMANDS) >= {"hello", "walk", "stop", "pose", "flip", "jump", "sense", "sit", "land", "estop"}


# -- the rail ---------------------------------------------------------------------------------------

class FakeApi:
    """A loopback api: records heartbeats carrying the credential and answers the command key."""

    def __init__(self) -> None:
        self.beats: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # noqa: D102
                return

            def do_POST(self):  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                if self.path != HEARTBEAT_PATH or self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    code, reply = 401, {"error": "a device credential is required"}
                else:
                    outer.beats.append(body)
                    ack = max([int(e["seq"]) for e in body.get("events", [])] + [0])
                    code, reply = 200, {"ok": True, "nodeId": body.get("nodeId"), "ack": ack, "commandKey": KEY}
                data = json.dumps(reply).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def post(url: str, body: dict, key: str | None = KEY):
    headers = {"Content-Type": "application/json"}
    if key is not None:
        headers["X-Node-Command-Key"] = key
    req = urllib.request.Request(url + COMMAND_PATH, data=json.dumps(body).encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def test_the_rail_answers_the_briefs_envelopes_over_http() -> None:
    api = FakeApi()
    env = {"EMBODIED_HEXAPOD_BACKEND": "fake", "EMBODIED_HEXAPOD_SPRING": "0", "EMBODIED_HEXAPOD_PACED": "0", "EMBODIED_NODE_HOST": "127.0.0.1",
           "EMBODIED_HEXAPOD_NODE_PORT": "0", "EMBODIED_HEXAPOD_NODE_ID": "spider-test", "OSHAL_API_URL": api.url, "EMBODIED_HEXAPOD_NODE_TOKEN": TOKEN}
    assert start_hexapod_node({**env, "EMBODIED_HEXAPOD_NODE_TOKEN": ""}) is None, "no credential, no rail"
    assert start_hexapod_node({**env, "EMBODIED_HEXAPOD_BACKEND": ""}) is None, "no backend, no node"
    rail = start_hexapod_node(env)
    assert rail is not None
    try:
        rail.stop.set()
        for t in rail.threads:
            if t.name == "hexapod-node-heartbeat":
                t.join(10)
        assert rail.send_heartbeat(), "the first heartbeat brings the command key"
        url = rail.endpoint_url
        assert post(url, {"id": 1, "command": "hello", "args": {}}, key=None)[0] == 401
        assert post(url, {"id": 1, "command": "hello", "args": {}}, key="wrong")[0] == 401
        code, hello = post(url, {"id": 1, "command": "hello", "args": {}})
        assert code == 200 and hello["ok"] and hello["id"] == 1 and hello["result"]["kind"] == "hexapod" and hello["result"]["backend"] == "fake"
        assert hello["result"]["protocol"] == 1 and hello["result"]["buildHash"] == hexapod_build_hash() and hello["result"]["hasSpring"] is False
        _, walk = post(url, {"id": 2, "command": "walk", "args": {"vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0}})
        assert walk["ok"] and walk["result"]["node"]["mode"] == "walk" and len(walk["result"]["jointPosRad"]) == 18
        for _ in range(50):
            _, ticked = post(url, {"id": 3, "command": "tick", "args": {"dtS": 0.02}})
        assert ticked["ok"] and abs(ticked["result"]["bodyPosM"][0] - 0.1) < 1e-6
        _, sensed = post(url, {"id": 4, "command": "sense", "args": {}})
        assert sensed["ok"] and sensed["result"]["lidar"] == {"anglesRad": [], "rangesM": []} and all(k in sensed["result"] for k in STATE_KEYS)
        _, bad = post(url, {"id": 5, "command": "pose", "args": {"targetsRad": [0.0] * 17}})
        assert bad["ok"] is False and bad["id"] == 5 and bad["error"] == "ValueError" and "18" in bad["reason"]
        _, jump = post(url, {"id": 6, "command": "jump", "args": {}})
        assert jump["ok"] is False and jump["error"] == "no_spring" and jump["reason"].startswith("no_spring:"), "the refusal code is the error"
        _, malformed = post(url, {"id": 7, "command": 42})
        assert malformed["ok"] is False and "envelope" in malformed["reason"]
        _, flipped = post(url, {"id": 8, "command": "flip", "args": {"side": "left"}})
        assert flipped["ok"] and flipped["result"]["flip"]["side"] == "left"
        _, stopped = post(url, {"id": 9, "command": "stop", "args": {}})
        assert stopped["ok"] and stopped["result"]["node"]["mode"] == "flip", "stop does not interrupt a flip"
        body = rail.heartbeat_body()
        assert body["nodeId"] == "spider-test" and body["kind"] == "hexapod" and body["endpointUrl"] == url and body["engine"] == "hexapod-fake"
        assert body["sessions"] == 1 and body["telemetry"]["mode"] == "flip" and abs(body["telemetry"]["x"] - 0.1) < 1e-6 and body["telemetry"]["inverted"] is False
        assert [e["kind"] for e in body["events"]] == ["flip"]
        assert rail.send_heartbeat() and api.beats[-1]["kind"] == "hexapod" and rail.ack == 1
        with urllib.request.urlopen(url + "/health", timeout=5) as res:
            health = json.loads(res.read())
        assert health["ok"] and health["kind"] == "hexapod" and health["credential"] is True and "oshal_pat" not in json.dumps(health)
    finally:
        rail.controller.close()
        rail.shutdown()
        api.close()


def test_the_heartbeat_telemetry_carries_the_nodes_decision_and_the_bodys_truth() -> None:
    node = HexapodController(FakeBackend(), tick_hz=50)
    rail = HexapodRail(node, node.hello, "spider-test", HEXAPOD_KIND, "", "http://127.0.0.1:1", None)
    rail.note_state({**node.last_state, "inverted": True, "node": {"mode": "idle", "inverted": False, "mirrored": False}})
    assert rail.telemetry["inverted"] is False and rail.telemetry["bodyInverted"] is True, "inverted is the node's decision; the body's truth rides as bodyInverted"
    assert rail.telemetry["mode"] == "idle" and rail.telemetry["z"] == node.last_state["bodyPosM"][2] and rail.telemetry["fell"] is False and "timeS" in rail.telemetry
    rail.note_state({"nope": 1})
    assert rail.telemetry["bodyInverted"] is True, "a reply without a body position changes nothing"


# -- the plant body -------------------------------------------------------------------------------------

class FakeBridge:
    """A JSON-lines plant speaking the brief's section 3.2: hexapod.load / reset / step / jump / state, the state's
    shape exact. `style` is how replies are framed: 'wrapped' ({id, ok, result}) as the engine bridge frames every
    reply, or 'flat' ({ok, ...fields} with `because` on refusal) as the brief writes them."""

    def __init__(self, style: str = "wrapped", has_spring: bool = True, actuators=None) -> None:
        self.style, self.has_spring = style, has_spring
        self.actuators = list(actuators if actuators is not None else S.ACTUATOR_ORDER)
        self.requests: list[dict] = []
        self.time = 0.0
        self.joints = [0.0] * 18
        self.inverted = False
        self.controller = "targets"
        outer = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):  # noqa: D102
                self.wfile.write((json.dumps({"protocol": 1, "engine": "fake-plant", "version": "0", "buildHash": "fake"}) + "\n").encode("utf-8"))
                while True:
                    line = self.rfile.readline()
                    if not line:
                        return
                    req = json.loads(line)
                    outer.requests.append(req)
                    self.wfile.write((json.dumps(outer.answer(req)) + "\n").encode("utf-8"))

        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        self.server = Server(("127.0.0.1", 0), Handler)
        self.host, self.port = self.server.server_address
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def state(self) -> dict:
        return {"timeS": self.time, "bodyPosM": [0.0, 0.0, 0.09], "bodyQuatWXYZ": [0.0, 1.0, 0.0, 0.0] if self.inverted else [1.0, 0.0, 0.0, 0.0], "bodyVelMps": [0.0] * 3,
                "gyroRadS": [0.0] * 3, "accelMps2": [0.0, 0.0, -G if self.inverted else G], "jointPosRad": list(self.joints), "jointVelRadS": [0.0] * 18, "jointTorqueNm": [0.1] * 18,
                "footContact": [True] * 6, "inverted": self.inverted, "fell": False, "spring": {"storedJ": 3.61, "latched": True} if self.has_spring else None}

    def answer(self, req: dict) -> dict:
        cmd = req.get("cmd")
        rid = req.get("id")
        ok = lambda payload: {"id": rid, "ok": True, "result": payload} if self.style == "wrapped" else {"id": rid, "ok": True, **payload}  # noqa: E731
        refuse = lambda code, because: {"id": rid, "ok": False, "error": code, "reason": because} if self.style == "wrapped" else {"id": rid, "ok": False, "error": code, "because": because}  # noqa: E731
        if cmd == "hexapod.load":
            controller = req.get("controller")
            if controller == "policy:uncertified.zip":
                return refuse("policy_not_certified", "uncertified.zip has no certificate -- POST /physics/hexapod/certify first")
            self.controller = controller or "targets"
            return ok({"actuators": self.actuators, "timestepS": 0.002, "hasSpring": self.has_spring, "controller": self.controller})
        if cmd == "hexapod.step" and "command" in req:
            assert "targetsRad" not in req and self.controller.startswith("policy:") and set(req["command"]) == {"vx", "vy", "yawRate"} and req["dtS"] > 0
            self.joints, self.time = [0.01 * (i + 1) for i in range(18)], self.time + req["dtS"]
            return ok({**self.state(), "targetsRad": list(self.joints), "controller": {"controller": self.controller, "inverted": self.inverted, "action": [0.0] * 8}})
        if cmd == "hexapod.reset":
            self.inverted, self.time, self.joints = req.get("pose") == "inverted", 0.0, [0.0] * 18
            return ok(self.state())
        if cmd == "hexapod.step":
            assert len(req["targetsRad"]) == 18 and req["dtS"] > 0
            self.joints, self.time = list(req["targetsRad"]), self.time + req["dtS"]
            return ok(self.state())
        if cmd == "hexapod.jump":
            return ok(self.state()) if self.has_spring else refuse("no_spring", "a legs-hop model has no spring")
        if cmd == "hexapod.state":
            return ok(self.state())
        return refuse("unknown_cmd", f"{cmd!r}")

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def _plant_node(bridge: FakeBridge) -> HexapodController:
    backend = PlantBackend(bridge.host, bridge.port, timeout_s=5)
    assert backend.hello["engine"] == "fake-plant"
    node = HexapodController(backend, tick_hz=50, build_hash="x")
    r = node.handle({"op": "load", "mjcf": "<mujoco/>", "seed": 3, "pose": "upright"})
    assert r["loaded"]["hasSpring"] == bridge.has_spring and r["loaded"]["actuators"] == list(S.ACTUATOR_ORDER) and backend.has_spring == bridge.has_spring
    return node


def test_the_plant_body_speaks_the_briefs_protocol_against_a_fake_bridge() -> None:
    for style in ("wrapped", "flat"):
        bridge = FakeBridge(style=style)
        try:
            node = _plant_node(bridge)
            assert [r["cmd"] for r in bridge.requests] == ["hexapod.load", "hexapod.reset"] and all(r["op"] == r["cmd"] for r in bridge.requests)
            assert bridge.requests[0] == {"id": 1, "cmd": "hexapod.load", "op": "hexapod.load", "mjcf": "<mujoco/>", "seed": 3}
            assert bridge.requests[1] == {"id": 2, "cmd": "hexapod.reset", "op": "hexapod.reset", "pose": "upright", "seed": 3}
            node.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
            st = node.tick()
            step = bridge.requests[-1]
            assert step["cmd"] == "hexapod.step" and step["dtS"] == 0.02 and len(step["targetsRad"]) == 18 and close(step["targetsRad"], node.sent, 1e-12)
            assert close(st["jointPosRad"], node.sent, 1e-12) and abs(st["timeS"] - 0.02) < 1e-9 and st["spring"] == {"storedJ": 3.61, "latched": True}
            assert all(k in st for k in STATE_KEYS) and st["node"]["inverted"] is False
            r = node.handle({"op": "reset", "pose": "inverted"})
            assert r["inverted"] is True and r["node"]["inverted"] is True, "a reset to the inverted pose settles the switch at once"
            st = node.tick()
            assert close(bridge.requests[-1]["targetsRad"], S.inverted_joint_targets(stance_targets()), 1e-12), "the inverted stance goes to the plant"
            r = node.handle({"op": "jump"})
            assert r["jumped"] is True and bridge.requests[-1]["cmd"] == "hexapod.jump"
            r = node.handle({"op": "sense"})
            assert bridge.requests[-1]["cmd"] == "hexapod.state" and r["lidarSource"] == "none" and r["lidar"] == {"anglesRad": [], "rangesM": []}
            node.close()
        finally:
            bridge.close()
    bridge = FakeBridge(style="flat", has_spring=False)
    try:
        node = _plant_node(bridge)
        error = refused(lambda: node.handle({"op": "jump"}), "no_spring")
        assert "legs-hop" in str(error), "the plant's because rides along"
        node.close()
    finally:
        bridge.close()
    bridge = FakeBridge(actuators=list(reversed(S.ACTUATOR_ORDER)))
    try:
        backend = PlantBackend(bridge.host, bridge.port, timeout_s=5)
        refused(lambda: backend.load("<mujoco/>", 1), "actuator_order")
        refused(lambda: backend.apply([0.0] * 18, 0.02), "not_loaded")
        backend.close()
    finally:
        bridge.close()


def test_a_certified_policy_on_the_plant_body_is_driven_by_the_nodes_command() -> None:
    bridge = FakeBridge(style="wrapped")
    try:
        backend = PlantBackend(bridge.host, bridge.port, timeout_s=5)
        node = HexapodController(backend, tick_hz=50, build_hash="x")
        error = refused(lambda: node.handle({"op": "load", "mjcf": "<mujoco/>", "seed": 3, "controller": "policy:uncertified.zip"}), "policy_not_certified")
        assert "certify first" in str(error) and backend.controller == "targets", "the plant's refusal rides through; the body stays on targets"
        r = node.handle({"op": "load", "mjcf": "<mujoco/>", "seed": 3, "controller": "policy:hexapod-walk-ppo-shape-seed0.zip"})
        assert r["loaded"]["controller"] == "policy:hexapod-walk-ppo-shape-seed0.zip" == backend.controller
        assert bridge.requests[-2]["controller"] == "policy:hexapod-walk-ppo-shape-seed0.zip"
        st = node.tick()
        assert "targetsRad" in bridge.requests[-1], "idle: the node's own stance goes to the plant as targets"
        node.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
        st = node.tick()
        step = bridge.requests[-1]
        assert step["cmd"] == "hexapod.step" and step["command"] == {"vx": 0.1, "vy": 0.0, "yawRate": 0.0} and "targetsRad" not in step
        assert close(node.sent, [0.01 * (i + 1) for i in range(18)], 1e-12) and close(st["jointPosRad"], node.sent, 1e-12), "the policy's targets are what the node reports as sent"
        assert "targetsRad" not in st and "controller" not in st and all(k in st for k in STATE_KEYS), "the state the node keeps is the brief's"
        node.handle({"op": "pose", "targetsRad": [0.0] * 18})
        node.tick()
        assert "targetsRad" in bridge.requests[-1] and "command" not in bridge.requests[-1], "a pose goes to the plant as targets again"
        node.close()
    finally:
        bridge.close()
    fake = HexapodController(FakeBackend(), tick_hz=50)
    refused(lambda: fake.handle({"op": "load", "controller": "policy:any.zip"}), "policy_not_found")  # the fake body looks for the policy's exported weights
    assert fake.handle({"op": "load"})["node"]["mode"] == "idle", "a load without a controller on the fake body is its reset"
    fake.close()


def test_the_fake_body_plays_an_exported_policy_through_the_nodes_mirror_rule() -> None:
    """The brain for the Pi: a weights file whose single layer is all zeros answers the zero action, and the zero action is
    the gait exactly (B30: GaitShape.from_action(zeros) == neutral), so the targets the node sends equal cpg_targets on the
    fixture's geometry, clock and command, upright and (after a settled roll) through the mirror rule."""
    import tempfile
    import numpy as np
    from hexapod_gaits import cpg_targets
    from hexapod_policy import geometry_from_dict
    with open(os.path.join(HERE, "fixtures", "spider-18-geometry.json"), encoding="utf-8") as fh:
        geometry = json.load(fh)["geometry"]
    out = tempfile.mkdtemp(prefix="hexapod-brain-")
    try:
        with open(os.path.join(out, "zero.weights.json"), "w", encoding="utf-8") as fh:
            json.dump({"policyFile": "zero.zip", "policySha256": "0" * 64, "recipe": "shape", "obsSize": 53, "actSize": 8,
                       "layers": [{"w": [[0.0] * 53] * 8, "b": [0.0] * 8, "act": None}], "geometry": geometry, "certificate": {"ok": True, "certifiedTask": "walk"}}, fh)
        with open(os.path.join(out, "refused.weights.json"), "w", encoding="utf-8") as fh:
            json.dump({"policyFile": "refused.zip", "layers": [], "geometry": geometry, "certificate": {"ok": False}}, fh)
        node = HexapodController(FakeBackend(), tick_hz=50)
        node.policy_dir = out
        refused(lambda: node.handle({"op": "load", "controller": "policy:missing.zip"}), "policy_not_found")
        refused(lambda: node.handle({"op": "load", "controller": "policy:refused.zip"}), "policy_not_certified")
        refused(lambda: node.handle({"op": "load", "controller": "pid"}), "bad_controller")
        refused(lambda: node.handle({"op": "load", "controller": "policy:../zero.zip"}), "bad_controller")
        r = node.handle({"op": "load", "controller": "policy:zero.zip"})
        assert r["loaded"] == {"controller": "policy:zero.zip", "runtime": "node", "policySha256": "0" * 64, "certifiedTask": "walk"} and r["node"]["mode"] == "idle"
        geo = geometry_from_dict(geometry)
        cmd = {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}
        r = node.handle({"op": "walk", "vxMps": 0.15, "vyMps": 0.0, "yawRateRadS": 0.0})
        assert r["controller"] == "policy:zero.zip"
        for k in range(10):
            node.tick()
            expected = [geo.clamp(n, v) for n, v in zip(S.ACTUATOR_ORDER, cpg_targets(geo, k * DT, cmd, False))]
            assert close(node.sent, expected, 1e-9), (k, node.sent[:3], expected[:3])
        assert node.sent != stance_targets(), "the brain's gait, not the node's own"
        node.handle({"op": "reset", "pose": "inverted"})
        assert node.brain.t == 0.0 and node.switch.inverted is True
        node.handle({"op": "walk", "vxMps": 0.15, "vyMps": 0.0, "yawRateRadS": 0.0})
        node.tick()
        assert close(node.sent, [geo.clamp(n, v) for n, v in zip(S.ACTUATOR_ORDER, cpg_targets(geo, 0.0, cmd, True))], 1e-9), "inverted: the brain goes through the mirror rule the node decided"
        node.handle({"op": "pose", "targetsRad": [0.0] * 18})
        node.tick()
        assert close(node.sent, [0.0] * 18, 1e-12), "a pose is the node's own targets again"
        node.close()
    finally:
        import shutil
        shutil.rmtree(out, ignore_errors=True)


# -- the serial body --------------------------------------------------------------------------------------

class ServoPort:
    """A bus of ideal servos on a fake port: a sync write sets every goal at once, a WRITE sets one and is acknowledged,
    a READ of present position answers the goal (the servo is already there), of present load answers 0, a PING answers."""

    def __init__(self, ids=range(1, 20)) -> None:
        self.goals = {sid: B.CENTER_STEPS for sid in ids}
        self.inbox = bytearray()
        self.packets: list[bytes] = []
        self.torque: dict[int, int] = {}

    def write(self, data: bytes) -> int:
        self.packets.append(bytes(data))
        sid, length, inst, params = data[2], data[3], data[4], data[5:-1]
        assert B.checksum(data[2:-1]) == data[-1] and length == len(params) + 2
        if inst == B.INST_SYNC_WRITE:
            addr, width = params[0], params[1]
            for i in range(2, len(params), width + 1):
                self._apply(params[i], addr, params[i + 1: i + 1 + width])
        elif inst == B.INST_WRITE:
            self._apply(sid, params[0], params[1:])
            self.inbox += self._status(sid, b"")
        elif inst == B.INST_READ:
            addr, count = params
            value = self.goals[sid] if addr == B.ADDR_PRESENT_POSITION else 0
            self.inbox += self._status(sid, B.encode_u16(value)[:count])
        elif inst == B.INST_PING and sid in self.goals:
            self.inbox += self._status(sid, b"")
        return len(data)

    def _apply(self, sid: int, addr: int, data: bytes) -> None:
        if addr == B.ADDR_GOAL_POSITION:
            self.goals[sid] = B.decode_u16(data[0:2])
        elif addr == B.ADDR_TORQUE_ENABLE:
            self.torque[sid] = data[0]

    @staticmethod
    def _status(sid: int, params: bytes) -> bytes:
        body = bytes([sid, len(params) + 2, 0]) + params
        return B.HEADER + body + bytes([B.checksum(body)])

    def read(self, count: int) -> bytes:
        out = bytes(self.inbox[:count])
        del self.inbox[:count]
        return out


def test_the_serial_body_drives_a_fake_port() -> None:
    port = ServoPort()
    slept: list[float] = []
    imu = {"accelMps2": [0.0, 0.0, G], "gyroRadS": [0.0, 0.0, 0.0], "quatWXYZ": [1.0, 0.0, 0.0, 0.0]}
    backend = SerialBackend(B.ServoBus(port, B.Calibration(offset_steps={1: 10})), imu=lambda: imu, has_spring=True, sleep=slept.append)
    assert backend.bus.scan() == list(B.SERVO_IDS)
    node = HexapodController(backend, tick_hz=50, build_hash="x")
    refused(lambda: node.handle({"op": "load", "mjcf": "<mujoco/>"}), "cannot_load")
    r = node.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
    assert port.torque == {sid: 1 for sid in B.SERVO_IDS} and r["node"]["relaxed"] is False, "a walk switches torque on for the eighteen legs"
    before = len(port.packets)
    st = node.tick()
    sync = [p for p in port.packets[before:] if p[4] == B.INST_SYNC_WRITE]
    reads = [p for p in port.packets[before:] if p[4] == B.INST_READ]
    assert len(sync) == 1 and sync[0][5:7] == bytes([B.ADDR_GOAL_POSITION, 6]) and len(reads) == 36, "one sync write, then position and load read from every leg servo"
    for i, sid in enumerate(B.SERVO_IDS):
        assert port.goals[sid] == backend.bus.calibration.rad_to_steps(sid, node.sent[i])
        assert abs(st["jointPosRad"][i] - node.sent[i]) <= math.pi / B.STEPS_PER_REV + 1e-12, "the read-back is the goal within half a step"
    assert st["bodyPosM"] == [0.0, 0.0, 0.0] and st["bodyPoseSource"] == "none" and st["footContactSource"] == "gait" and st["imu"] is True
    assert st["accelMps2"] == [0.0, 0.0, G] and st["node"]["inverted"] is False
    imu["accelMps2"] = [0.0, 0.0, -G]
    for _ in range(16):
        st = node.tick()
    assert st["node"]["inverted"] is True and st["node"]["mirrored"] is True and node.sent[1] > 0, "an inverted IMU mirrors the femurs (the upright femur is raised, knee up: negative)"
    assert port.goals[2] == backend.bus.calibration.rad_to_steps(2, node.sent[1]), "the mirrored goal reached the servo"
    r = node.handle({"op": "jump"})
    latch = [B.decode_u16(p[6:8]) for p in port.packets if p[2] == B.LATCH_SERVO_ID and p[4] == B.INST_WRITE]
    assert latch == [3072, 3584, 1024] and slept == [3.5, 0.4] and r["jumped"] is True, "wind, trip past the detent, back to rest"
    refused(lambda: HexapodController(SerialBackend(B.ServoBus(ServoPort()), has_spring=False), build_hash="x").handle({"op": "jump"}), "no_spring")
    node.handle({"op": "sit"})
    for _ in range(51):
        node.tick()
    assert port.torque == {sid: 0 for sid in B.SERVO_IDS} and backend.relaxed is True, "sitting relaxes the servos"
    before = len(port.packets)
    node.tick()
    assert not [p for p in port.packets[before:] if p[4] == B.INST_SYNC_WRITE], "a relaxed body gets no goals"
    bare = HexapodController(SerialBackend(B.ServoBus(ServoPort())), build_hash="x")
    st = bare.tick()
    assert st["imu"] is False and st["node"]["inverted"] is False, "no IMU: never inverted"


if __name__ == "__main__":  # the shipped engine image has no pytest
    import traceback

    names = sorted(name for name, value in list(globals().items()) if name.startswith("test_") and callable(value))
    if not names:
        print("FAIL: no test_* function was discovered in this module", file=sys.stderr)
        raise SystemExit(2)
    failures = 0
    for name in names:
        try:
            globals()[name]()
        except BaseException:  # every failure shape is reported
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print(f"{len(names) - failures} passed, {failures} failed")
    raise SystemExit(1 if failures else 0)
