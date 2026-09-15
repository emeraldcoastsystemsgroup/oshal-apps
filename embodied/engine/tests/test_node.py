"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the node-rail front against a loopback fake
    |                                           | controller (B20): off without the swarm service secret; commands
    |                                           | refused without or with the wrong secret; load/step/sense/clone
    |                                           | envelopes fly the real plant over HTTP and a missing session or a
    |                                           | malformed envelope is answered, never swallowed; the heartbeat
    |                                           | body carries identity, kind, the hello, the latest telemetry and
    |                                           | the events since the ack; heartbeats reach the controller, the
    |                                           | ack trims the events, and /health counts them.
2   | maintainer@emeraldcoastsystemsgroup.com   | The owner rides as the trusted service user-sub header (base64url, unpadded) and /health names it.
3   | maintainer@emeraldcoastsystemsgroup.com   | The heartbeat pace backs off while refused and returns to nominal on an ack.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))
from embodied_engine_bridge import Sessions, build_hash  # noqa: E402
from embodied_engine_node import COMMAND_PATH, HEARTBEAT_BACKOFF_MAX_S, HEARTBEAT_PATH, HEARTBEAT_S, next_heartbeat_delay, start_node_rail  # noqa: E402
from embodied_worker import hello  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "recon-mini.xml")
SECRET = "t3st-secret"
SETPOINT = {"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}


class FakeController:
    """A loopback api: records every heartbeat that carries the secret and answers the highest event seq as the ack."""

    def __init__(self) -> None:
        self.beats: list[dict] = []
        self.ack = 0
        self.lock = threading.Lock()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # noqa: D102
                return

            def do_POST(self):  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                if self.path != HEARTBEAT_PATH or self.headers.get("X-Service-Secret") != SECRET:
                    code, reply = 401, {"error": "This route requires a valid service secret"}
                else:
                    with outer.lock:
                        body["_ownerHeader"] = self.headers.get("X-Oshal-User-Sub-B64")
                        outer.beats.append(body)
                        for e in body.get("events", []):
                            outer.ack = max(outer.ack, int(e["seq"]))
                        code, reply = 200, {"ok": True, "nodeId": body.get("nodeId"), "ack": outer.ack}
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


@pytest.fixture
def rail():
    controller = FakeController()
    sessions = Sessions()
    env = {"SWARM_SERVICE_SECRET": SECRET, "EMBODIED_NODE_ID": "plant-test", "EMBODIED_NODE_HOST": "127.0.0.1",
           "EMBODIED_NODE_PORT": "0", "OSHAL_API_URL": controller.url, "EMBODIED_NODE_OWNER_SUB": "owner-1"}
    node = start_node_rail(sessions, lambda: hello(build_hash()), env)
    assert node is not None
    # the suite drives heartbeats itself: stop the loop and wait for it so no beat races the assertions
    node.stop.set()
    for t in node.threads:
        if t.name == "embodied-node-heartbeat":
            t.join(10)
    yield node, controller, sessions
    node.shutdown()
    controller.close()


def post(url: str, body: dict, secret: str | None = SECRET):
    headers = {"Content-Type": "application/json"}
    if secret is not None:
        headers["X-Service-Secret"] = secret
    req = urllib.request.Request(url + COMMAND_PATH, data=json.dumps(body).encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def test_the_rail_is_off_without_the_secret():
    assert start_node_rail(Sessions(), lambda: {}, {"SWARM_SERVICE_SECRET": ""}) is None
    with pytest.raises(ValueError):
        start_node_rail(Sessions(), lambda: {}, {"SWARM_SERVICE_SECRET": "x", "EMBODIED_NODE_ID": "../bad", "EMBODIED_NODE_PORT": "0", "EMBODIED_NODE_HOST": "127.0.0.1"})


def test_commands_need_the_secret(rail):
    node, _, _ = rail
    assert post(node.endpoint_url, {"id": 1, "command": "status", "args": {}}, secret=None)[0] == 401
    assert post(node.endpoint_url, {"id": 1, "command": "status", "args": {}}, secret="wrong")[0] == 401
    code, reply = post(node.endpoint_url, {"id": 1, "command": "status", "args": {}})
    assert code == 200 and reply["ok"] and reply["id"] == 1
    assert reply["result"]["engine"] == "mujoco" and reply["result"]["protocol"] == 1 and reply["result"]["buildHash"] == build_hash()


def test_envelopes_fly_the_plant_and_the_heartbeat_reports_it(rail):
    node, _, sessions = rail
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    _, loaded = post(node.endpoint_url, {"id": 2, "command": "load", "args": {"session": "w1", "mjcf": mjcf, "seed": 3, "controller": {"kind": "pid"}}})
    assert loaded["ok"] and abs(loaded["result"]["restZ"] - 0.03) < 1e-6 and loaded["result"]["controller"] == {"kind": "pid"}
    stepped = None
    for i in range(6):  # the climb is a takeoff (the floor is no strike there), then a hover -- as the sim phases it
        _, stepped = post(node.endpoint_url, {"id": 3, "command": "step", "args": {"session": "w1", "setpoint": SETPOINT, "phase": "takeoff" if i < 3 else "hover", "dt": 1.0}})
    assert stepped["ok"] and abs(stepped["result"]["z"] - 2.075) < 0.05 and stepped["result"]["settled"]
    _, sensed = post(node.endpoint_url, {"id": 4, "command": "sense", "args": {"session": "w1", "spec": {"ring": {"azimuthCount": 450, "elevationsDeg": [0], "maxRange": 12}}}})
    assert sensed["ok"] and len(sensed["result"]["ring"]["t"]) == 450
    _, cloned = post(node.endpoint_url, {"id": 5, "command": "clone", "args": {"session": "w2", "from": "w1"}})
    assert cloned["ok"] and len(sessions.plants) == 2
    _, missing = post(node.endpoint_url, {"id": 6, "command": "step", "args": {"session": "nope", "setpoint": SETPOINT, "phase": "hover", "dt": 0.05}})
    assert missing["ok"] is False and missing["id"] == 6 and "load it first" in missing["reason"]
    _, malformed = post(node.endpoint_url, {"id": 7, "command": 42})
    assert malformed["ok"] is False and "envelope" in malformed["reason"]
    body = node.heartbeat_body()
    assert body["nodeId"] == "plant-test" and body["kind"] == "plant" and body["endpointUrl"] == node.endpoint_url
    assert body["engine"] == "mujoco" and body["protocol"] == 1 and body["buildHash"] == build_hash() and body["sessions"] == 2
    assert body["telemetry"]["session"] == "w1" and body["telemetry"]["phase"] == "hover" and abs(body["telemetry"]["z"] - 2.075) < 0.05
    assert [e["kind"] for e in body["events"]] == ["load", "clone"]
    _, dropped = post(node.endpoint_url, {"id": 8, "command": "drop", "args": {"session": "w2"}})
    assert dropped["ok"] and len(sessions.plants) == 1


def test_heartbeats_reach_the_controller_and_the_ack_trims_the_events(rail):
    node, controller, _ = rail
    before = len(controller.beats)
    assert node.send_heartbeat() and node.heartbeats_acked >= 1
    assert len(controller.beats) == before + 1
    assert controller.beats[-1]["nodeId"] == "plant-test" and controller.beats[-1]["endpointUrl"] == node.endpoint_url
    encoded = controller.beats[-1]["_ownerHeader"]
    assert base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)) == b"owner-1", "the owner rides as the trusted service user sub (base64url, unpadded)"
    node.event("load", "w1")
    node.event("drop", "w1")
    assert node.send_heartbeat()
    assert [e["seq"] for e in controller.beats[-1]["events"]] == [1, 2] and node.ack == 2
    assert node.send_heartbeat() and controller.beats[-1]["events"] == []
    with urllib.request.urlopen(node.endpoint_url + "/health", timeout=5) as res:
        health = json.loads(res.read())
    assert health["ok"] and health["nodeId"] == "plant-test" and health["ownerSub"] == "owner-1"
    assert health["heartbeats"]["acked"] >= 3 and health["heartbeats"]["lastStatus"] == 200 and health["heartbeats"]["rejected"] == 0


def test_a_refused_node_backs_off_and_an_acknowledged_one_keeps_pace():
    delay = HEARTBEAT_S
    seen = []
    for _ in range(8):
        delay = next_heartbeat_delay(delay, False)
        seen.append(delay)
    assert seen == [4.0, 8.0, 16.0, 32.0, 60.0, 60.0, 60.0, 60.0] and seen[-1] == HEARTBEAT_BACKOFF_MAX_S
    assert next_heartbeat_delay(60.0, True) == HEARTBEAT_S
