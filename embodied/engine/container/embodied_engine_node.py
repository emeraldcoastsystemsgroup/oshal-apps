"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the plant on the swarm node rail (ADR-099,
    |                                           | BACKLOG B20), the shape of the core drone and camera nodes: a
    |                                           | heartbeat every two seconds to the api's package route
    |                                           | (POST /api/embodied/nodes/heartbeat, the swarm service secret
    |                                           | in X-Service-Secret: identity, kind, the endpoint the api dials
    |                                           | back, the bridge hello, the latest telemetry and the events
    |                                           | since the api's ack) and a command endpoint the api dials
    |                                           | (POST /api/drone-node/command, the same secret, envelopes
    |                                           | {id, command, args} answered {id, ok, result | error, reason})
    |                                           | over the same sessions the TCP bridge serves. Fail-closed: no
    |                                           | secret, no rail -- the bridge alone keeps serving. Stdlib only.
    |                                           | A real drone node answers the same envelopes and refuses `load`
    |                                           | and `clone` (cannot_load / cannot_clone): a body is one.
2   | maintainer@emeraldcoastsystemsgroup.com   | The node carries its OWNER (EMBODIED_NODE_OWNER_SUB) as the trusted service user-sub header on every heartbeat, the ADR-114 model (a node belongs to one person) and what the ADR-149 gate needs from a machine caller; unowned, the controller refuses it and the log says so, once.
3   | maintainer@emeraldcoastsystemsgroup.com   | Back off after a refused or unreachable heartbeat (doubling to a minute, nominal again on an ack): on the enforce box the two-second cadence put 1 800 refusal warnings an hour into the api log.
4   | maintainer@emeraldcoastsystemsgroup.com   | ADR-175 (B20 option D): the heartbeat carries the node's DEVICE CREDENTIAL
    |                                           | (Authorization: Bearer, from EMBODIED_NODE_TOKEN or EMBODIED_NODE_TOKEN_FILE,
    |                                           | minted by POST /api/join/enroll for this node id) instead of the service secret
    |                                           | plus an owner header; the owner comes from the credential. The secret now only
    |                                           | checks inbound commands. No credential: the rail stays off and says how to enroll.
5   | maintainer@emeraldcoastsystemsgroup.com   | ADR-175 hardening: inbound commands must carry the COMMAND KEY the api returned in
    |                                           | this node's last heartbeat reply (X-Node-Command-Key); the node no longer needs or
    |                                           | accepts SWARM_SERVICE_SECRET, so the machine secret never has to live in the engine.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

HEARTBEAT_S = 2.0
HEARTBEAT_BACKOFF_MAX_S = 60.0
EVENT_RETENTION = 100
MAX_BODY_BYTES = 64 * 1024 * 1024
NODE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$", re.IGNORECASE)
DEFAULT_NODE_ID = "embodied-plant"
DEFAULT_NODE_PORT = 7414
DEFAULT_API_URL = "http://oshal-api:5000"
HEARTBEAT_PATH = "/api/embodied/nodes/heartbeat"
COMMAND_PATH = "/api/drone-node/command"
REJECTION_LOG_EVERY = 30
TELEMETRY_KEYS = ("x", "y", "z", "yaw", "tiltRad", "speed", "contact", "settled")


def _log(msg: str) -> None:
    sys.stderr.write(f"[embodied-engine-node] {msg}\n")
    sys.stderr.flush()


class NodeRail:
    """@description One node on the rail: the sessions it commands, the events it has to tell, the ack cursor the api returned."""

    def __init__(self, sessions, hello: Callable[[], dict], node_id: str, kind: str, endpoint_url: str, api_url: str,
                 credential: str | None = None) -> None:
        self.sessions = sessions
        self._credential = credential or None
        self.rejections = 0
        self.hello = hello
        self.node_id = node_id
        self.kind = kind
        self.endpoint_url = endpoint_url.rstrip("/")
        self.api_url = api_url.rstrip("/")
        self._command_key: str | None = None
        self.lock = threading.Lock()
        self.events: list[dict] = []
        self.seq = 0
        self.ack = 0
        self.telemetry: dict | None = None
        self.heartbeats_sent = 0
        self.heartbeats_acked = 0
        self.last_status: int | None = None
        self.stop = threading.Event()
        self.server: ThreadingHTTPServer | None = None
        self.threads: list[threading.Thread] = []

    def authorized(self, provided: str) -> bool:
        """@description Constant-time check of the command key a command carries against the one the api last returned."""
        with self.lock:
            key = self._command_key
        return bool(key) and hmac.compare_digest(provided.encode("utf-8"), key.encode("utf-8"))

    def event(self, kind: str, text: str) -> None:
        with self.lock:
            self.seq += 1
            self.events.append({"seq": self.seq, "at": datetime.now(timezone.utc).isoformat(), "kind": kind, "text": text})
            del self.events[:-EVENT_RETENTION]

    def command(self, envelope: dict) -> dict:
        """@description Answer one {id, command, args} envelope over the shared sessions; note what happened as an event."""
        op = envelope.get("command") if isinstance(envelope, dict) else None
        args = envelope.get("args") if isinstance(envelope, dict) else None
        if not isinstance(op, str) or not isinstance(args, dict):
            raise ValueError("an envelope is {id, command, args}")
        result = self.sessions.handle({"op": op, **args})
        if op == "step":
            with self.lock:
                self.telemetry = {"session": args.get("session"), "phase": args.get("phase"), **{k: result[k] for k in TELEMETRY_KEYS if k in result}}
            if result.get("contact"):
                self.event("contact", f"{args.get('session')} touched {result['contact']}")
        elif op in ("load", "clone", "drop"):
            self.event(op, str(args.get("session")))
        return result

    def heartbeat_body(self) -> dict:
        with self.lock:
            pending = [e for e in self.events if e["seq"] > self.ack]
            telemetry = dict(self.telemetry) if self.telemetry else None
        return {"nodeId": self.node_id, "kind": self.kind, "endpointUrl": self.endpoint_url, **self.hello(),
                "sessions": len(self.sessions.plants), "telemetry": telemetry, "events": pending}

    def send_heartbeat(self) -> bool:
        """@description One heartbeat to the controller with the device credential; the ack cursor it returns trims the events.
        Never logs the credential."""
        body = json.dumps(self.heartbeat_body()).encode("utf-8")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._credential}"}
        req = urllib.request.Request(self.api_url + HEARTBEAT_PATH, data=body, method="POST", headers=headers)
        self.heartbeats_sent += 1
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                self.last_status = res.status
                reply = json.loads(res.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            self.last_status = error.code
            self.rejections += 1
            if self.rejections == 1 or self.rejections % REJECTION_LOG_EVERY == 0:
                why = {401: " -- the device credential was refused (revoked, expired, or the controller lacks ADR-175 node rails)",
                       403: " -- the credential is bound to another node id, or its owner has no access to the app"}.get(error.code, "")
                _log(f"heartbeat rejected by the controller: HTTP {error.code}{why} ({self.rejections} so far)")
            return False
        except (urllib.error.URLError, OSError, ValueError) as error:
            self.last_status = None
            _log(f"heartbeat failed (controller unreachable): {error}")
            return False
        ack = reply.get("ack") if isinstance(reply, dict) else None
        key = reply.get("commandKey") if isinstance(reply, dict) else None
        with self.lock:
            if isinstance(ack, int) and ack >= self.ack:
                self.ack = ack
            if isinstance(key, str) and 16 <= len(key) <= 256:
                self._command_key = key
            self.heartbeats_acked += 1
            first = self.heartbeats_acked == 1
        if first:
            _log(f"heartbeat acknowledged by {self.api_url} as {self.node_id}")
        return True

    def heartbeat_loop(self) -> None:
        delay = HEARTBEAT_S
        while not self.stop.is_set():
            delay = next_heartbeat_delay(delay, self.send_heartbeat())
            self.stop.wait(delay)

    def health(self) -> dict:
        return {"ok": True, "nodeId": self.node_id, "kind": self.kind, "endpointUrl": self.endpoint_url, "credential": bool(self._credential), "commandKey": bool(self._command_key), **self.hello(),
                "heartbeats": {"sent": self.heartbeats_sent, "acked": self.heartbeats_acked, "rejected": self.rejections, "lastStatus": self.last_status}}

    def shutdown(self) -> None:
        self.stop.set()
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
        for t in self.threads:
            t.join(5)


def next_heartbeat_delay(delay: float, ok: bool) -> float:
    """@description The pace of the next heartbeat: the nominal two seconds after an acknowledged one; doubling up to a minute
    after a refused or unreachable one, so a controller that will not have the node is not asked 1 800 times an hour."""
    return HEARTBEAT_S if ok else min(delay * 2.0, HEARTBEAT_BACKOFF_MAX_S)


def make_handler(rail: NodeRail):
    """@description The command endpoint and the health read, bound to one rail."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "embodied-node/1"

        def log_message(self, fmt, *args):  # envelopes are chatty and the header carries the command key: no request log
            return

        def _send(self, code: int, payload: dict) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):  # noqa: N802 -- http.server's name
            if self.path == "/health":
                self._send(200, rail.health())
            else:
                self._send(404, {"error": "not_found"})

        def do_POST(self):  # noqa: N802
            if self.path != COMMAND_PATH:
                self._send(404, {"error": "not_found"})
                return
            if not rail.authorized(self.headers.get("X-Node-Command-Key", "")):
                self._send(401, {"error": "command_key_required", "reason": "a command needs the key from this node's last heartbeat reply"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send(400, {"error": "bad_request", "reason": "a JSON envelope body is required"})
                return
            raw = self.rfile.read(length)
            rid = None
            try:
                envelope = json.loads(raw)
                rid = envelope.get("id") if isinstance(envelope, dict) else None
                self._send(200, {"id": rid, "ok": True, "result": rail.command(envelope)})
            except Exception as error:  # every failure is answered, never swallowed
                _log(f"command failed: {error}\n{traceback.format_exc()}")
                self._send(200, {"id": rid, "ok": False, "error": type(error).__name__, "reason": str(error)})

    return Handler


class NodeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def read_device_credential(env: dict, name: str) -> str | None:
    """@description The node's device credential: env[name], else the contents of the file env[name + "_FILE"].
    Read once at start, never logged. @param env Environment. @param name Variable name. @returns The credential or None."""
    value = (env.get(name) or "").strip()
    path = (env.get(name + "_FILE") or "").strip()
    if not value and path:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                value = fh.read().strip()
        except OSError as error:
            _log(f"{name}_FILE is set but unreadable: {error.strerror}")
    return value or None


def start_node_rail(sessions, hello: Callable[[], dict], env: dict | None = None) -> NodeRail | None:
    """@description Join the rail when the node has a device credential; otherwise say so and serve the bridge alone.
    @param sessions The bridge's Sessions. @param hello The hello builder. @param env Environment (os.environ by default).
    @returns The rail, or None when disabled."""
    env = os.environ if env is None else env
    node_id = (env.get("EMBODIED_NODE_ID") or DEFAULT_NODE_ID).strip()
    if not NODE_ID_RE.match(node_id):
        raise ValueError(f"EMBODIED_NODE_ID {node_id!r} is not a node id (letters, digits, - and _, up to 32)")
    host = (env.get("EMBODIED_NODE_HOST") or "0.0.0.0").strip()
    port = int(env.get("EMBODIED_NODE_PORT") or DEFAULT_NODE_PORT)
    api_url = (env.get("OSHAL_API_URL") or DEFAULT_API_URL).strip()
    credential = read_device_credential(env, "EMBODIED_NODE_TOKEN")
    if not credential:
        _log(f"node rail disabled: no device credential for {node_id} (enroll it once: POST /api/join/enroll {{\"clientId\": \"{node_id}\"}} while signed in, then reinstall with EMBODIED_NODE_TOKEN_FILE); the TCP bridge alone serves")
        return None
    rail = NodeRail(sessions, hello, node_id, "plant", "", api_url, credential)
    server = NodeServer((host, port), make_handler(rail))
    bound = server.server_address[1]
    reach = socket.gethostname() if host in ("0.0.0.0", "", "::") else host
    rail.endpoint_url = (env.get("EMBODIED_NODE_ENDPOINT") or f"http://{reach}:{bound}").rstrip("/")
    rail.server = server
    rail.threads = [threading.Thread(target=server.serve_forever, name="embodied-node-http", daemon=True),
                    threading.Thread(target=rail.heartbeat_loop, name="embodied-node-heartbeat", daemon=True)]
    for t in rail.threads:
        t.start()
    _log(f"node rail up: {node_id} at {rail.endpoint_url} (bound {host}:{bound}), heartbeating to {api_url}{HEARTBEAT_PATH} with its device credential (the owner comes from the credential)")
    return rail


def wait_for_ack(rail: NodeRail, timeout_s: float) -> bool:
    """@description Block until the controller has acknowledged a heartbeat, or the timeout passes (the installer's check)."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if rail.heartbeats_acked > 0:
            return True
        time.sleep(0.2)
    return rail.heartbeats_acked > 0
