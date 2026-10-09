# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for the engine half of the Career worker rail, against the production enrich/config/score modules: in multi-user mode every completion is one POST to the rail with the exact trusted-service headers and run token (proxies bypassed), no codex/claude subprocess, Anthropic SDK or OpenAI path is reachable (tripwires), model keys and rail entries are removed from the environment, a rail failure raises CareerWorkerUnavailable through the real scorer instead of being counted as a skipped posting, and every later call refuses without a request.
# 2 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): every request carries the five grant headers and no service secret, subject or bearer token; the fixture recomputes the HMAC from the grant secret it planted over the exact bytes it received (the canonical string of lib/career-engine-runs.js), two completions never share a nonce, the timestamp is fresh, a malformed grant is rail-not-configured, and the retired 1.24.0 names are removed from the environment on import.
"""Career model-rail contract, exercised against the production engine modules.

The rail is a local HTTP fixture that records each request and answers from a scripted queue.
subprocess and the provider SDK modules are replaced with tripwires BEFORE the engine is imported,
so any codex/claude/Anthropic/OpenAI path taken in multi-user mode fails the contract loudly.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import json
import os
import subprocess
import sys
import re
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))

CHECKS: list[tuple[str, bool]] = []
TRIPPED: list[str] = []
REQUESTS: list[dict] = []
RESPONSES: list[tuple[int, dict]] = []
SUBJECT = "auth0|user-é-1"
RUN_ID = "0f0f0f0f-1111-4222-8333-444444444444"
GRANT_SECRET = "t" * 43
GRANT = f"{RUN_ID}.{GRANT_SECRET}"
GRANT_KEY = hashlib.sha256(b"oshal-career-rail-grant-v1:" + GRANT_SECRET.encode("ascii")).digest()
RETIRED_TOKEN = "r" * 43
RETIRED_SECRET = "rail-contract-secret"


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


def install_tripwires() -> None:
    def tripwire(name):
        def refuse(*_args, **_kwargs):
            TRIPPED.append(name)
            raise AssertionError(f"tripwire: {name} reached in multi-user mode")
        return refuse

    for attr in ("run", "Popen", "call", "check_call", "check_output"):
        setattr(subprocess, attr, tripwire(f"subprocess.{attr}"))

    class TripwireModule(types.ModuleType):
        def __getattr__(self, attr):
            TRIPPED.append(f"{self.__name__}.{attr}")
            raise AssertionError(f"tripwire: {self.__name__}.{attr} reached in multi-user mode")

    sys.modules["anthropic"] = TripwireModule("anthropic")
    sys.modules["openai"] = TripwireModule("openai")


class RailFixture(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 — http.server's handler name
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) or b"{}"
        REQUESTS.append({"headers": {k.lower(): v for k, v in self.headers.items()},
                         "path": self.path, "raw": raw, "body": json.loads(raw)})
        status, payload = RESPONSES.pop(0) if RESPONSES else (500, {"ok": False, "error": "unscripted"})
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        return


def start_fixture() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), RailFixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def prepare_environment(port: int, workdir: Path) -> None:
    codex_home = workdir / "codex"
    codex_home.mkdir()
    (codex_home / "auth.json").write_text("{}", encoding="utf-8")  # a login the engine must ignore
    os.environ.update({
        "JOBHUNTER_MULTIUSER": "1",
        "OSHAL_USER_SUB": SUBJECT,
        "JOBHUNTER_DATA": str(workdir / "data"),
        "CAREER_RAIL_URL": f"http://127.0.0.1:{port}/api/career-hunter/engine/complete",
        "CAREER_RAIL_GRANT": GRANT,
        "CAREER_RAIL_RUN_ID": RUN_ID,
        "CAREER_RAIL_TIMEOUT_S": "10",
        # The retired 1.24.0 names, planted so their removal on import is what is measured.
        "CAREER_RAIL_TOKEN": RETIRED_TOKEN,
        "CAREER_RAIL_SERVICE_SECRET": RETIRED_SECRET,
        "ANTHROPIC_API_KEY": "trap-anthropic",
        "OPENAI_API_KEY": "trap-openai",
        "CODEX_HOME": str(codex_home),
        "HTTP_PROXY": "http://127.0.0.1:9",
        "HTTPS_PROXY": "http://127.0.0.1:9",
        "NO_PROXY": "",
    })


BATCH_ROWS = [
    {"id": n, "company_id": 3, "description": "Build systems", "title": "Engineer", "location": "Remote"}
    for n in (21, 22, 23)
]
AI_FIT_WRITES: list[int] = []


@contextlib.contextmanager
def fake_company_connection():
    class Rows:
        def fetchone(self):
            return {"name": "Acme", "ats_type": "greenhouse", "ats_token": "acme"}

        def fetchall(self):
            return [dict(row) for row in BATCH_ROWS]

    class Conn:
        def execute(self, *_args, **_kwargs):
            return Rows()

    yield Conn()


def check_identity(enrich, config) -> None:
    check("provider is the Career bot rail", enrich.provider() == "oshal-bot")
    check("auth kind is the Career bot rail", enrich.auth_kind() == "oshal-bot")
    check("model label names the Career bot", enrich.model_name() == "oshal-career-bot")
    check("model keys are dropped from config", config.ANTHROPIC_API_KEY is None and config.OPENAI_API_KEY is None)
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CAREER_RAIL_GRANT", "CAREER_RAIL_URL", "CAREER_RAIL_RUN_ID",
                "CAREER_RAIL_TOKEN", "CAREER_RAIL_SERVICE_SECRET"):
        check(f"{key} is removed from the environment a subprocess would inherit", key not in os.environ)
    check("the retired bearer token and fleet secret are not configuration",
          not hasattr(config, "RAIL_TOKEN") and not hasattr(config, "RAIL_SERVICE_SECRET"))
    check("the grant is read once", config.RAIL_GRANT == GRANT)


def expected_signature(request: dict) -> str:
    headers = request["headers"]
    body_hash = hashlib.sha256(request["raw"]).hexdigest()
    canonical = f"POST|{request['path']}|{headers.get('x-career-rail-timestamp')}|{headers.get('x-career-rail-nonce')}|{body_hash}"
    return hmac.new(GRANT_KEY, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def check_success(enrich, score) -> None:
    RESPONSES.append((200, {"ok": True, "text": '{"fit_score": 88, "rationale": "fits"}'}))
    text = enrich.complete("SYSTEM", "PROMPT", max_tokens=700)
    check("complete returns the rail text", text == '{"fit_score": 88, "rationale": "fits"}')
    check("exactly one rail request per completion", len(REQUESTS) == 1)
    request = REQUESTS[-1]
    headers = request["headers"]
    encoded = base64.urlsafe_b64encode(SUBJECT.encode("utf-8")).decode("ascii").rstrip("=")
    check("rail path", request["path"] == "/api/career-hunter/engine/complete")
    check("grant id header names the run", headers.get("x-career-rail-grant") == RUN_ID)
    check("exact canonical base64url owner", headers.get("x-career-rail-owner") == encoded)
    check("fresh timestamp", abs(int(headers.get("x-career-rail-timestamp") or 0) - int(time.time())) < 60)
    check("single-use nonce shape", bool(re.fullmatch(r"[A-Za-z0-9_-]{16,64}", headers.get("x-career-rail-nonce") or "")))
    check("signature verifies over the exact bytes under the grant key", headers.get("x-career-rail-signature") == expected_signature(request))
    for retired in ("x-service-secret", "x-oshal-user-sub-b64", "x-career-run-token"):
        check(f"no {retired} header", retired not in headers)
    check("rail content type", headers.get("content-type") == enrich.RAIL_CONTENT_TYPE)
    check("completion body", request["body"] == {"system": "SYSTEM", "prompt": "PROMPT", "maxTokens": 700, "jsonMode": True})
    RESPONSES.append((200, {"ok": True, "text": '{"fit_score": 91}'}))
    row = {"id": 7, "company_id": 3, "description": "Build systems", "title": "Engineer", "location": "Remote"}
    score.db.connect = fake_company_connection
    result = score._score_one(row, "PROFILE")
    check("the real scorer records a rail answer", result["data"] == {"fit_score": 91})
    check("every completion spends a fresh nonce", len({r["headers"].get("x-career-rail-nonce") for r in REQUESTS}) == len(REQUESTS))
    check("every completion is signed", all(r["headers"].get("x-career-rail-signature") == expected_signature(r) for r in REQUESTS))


def check_failure(enrich, score) -> None:
    before = len(REQUESTS)
    RESPONSES.append((503, {"ok": False, "error": "career-worker-unavailable", "detail": "heartbeat-stale"}))
    row = {"id": 8, "company_id": 3, "description": "Build systems", "title": "Engineer", "location": "Remote"}
    try:
        score._score_one(row, "PROFILE")
        check("a lost worker ends the scoring run", False)
    except enrich.CareerWorkerUnavailable as err:
        check("a lost worker ends the scoring run", err.reason == "career-worker-unavailable" and err.status == 503)
    try:
        enrich.complete("SYSTEM", "PROMPT")
        check("after a failure every later call refuses", False)
    except enrich.CareerWorkerUnavailable as err:
        check("after a failure every later call refuses", err.reason == "career-worker-unavailable")
    check("the open circuit sends no further request", len(REQUESTS) == before + 1)


def check_batch(enrich, score) -> None:
    """The real score_batch, thread pool included, must surface a lost worker instead of
    returning (scored, skipped) counts that would let the nightly cursor advance."""
    enrich._RAIL_FAILURE = None
    RESPONSES.extend([(503, {"ok": False, "error": "career-worker-unavailable"})] * 3)
    score.db.connect = fake_company_connection
    score.db.save_ai_fit = lambda _conn, posting_id, *_rest: AI_FIT_WRITES.append(posting_id)
    score.profile.summary = lambda **_kwargs: "PROFILE"
    try:
        result = score.score_batch(limit=3, workers=2)
        check("score_batch surfaces the lost worker instead of counts", False)
        check(f"score_batch returned {result!r}", False)
    except enrich.CareerWorkerUnavailable as err:
        check("score_batch surfaces the lost worker instead of counts", err.reason == "career-worker-unavailable")
    check("no AI fit is recorded for a posting the worker never scored", AI_FIT_WRITES == [])
    RESPONSES.clear()


def expect_refusal(enrich, label: str, reason: str) -> None:
    enrich._RAIL_FAILURE = None
    before = len(REQUESTS)
    try:
        enrich.complete("SYSTEM", "PROMPT")
        check(label, False)
    except enrich.CareerWorkerUnavailable as err:
        check(label, err.reason == reason)
    check(f"{label}: no rail request", len(REQUESTS) == before)


def check_misconfiguration(enrich, config) -> None:
    url, grant = config.RAIL_URL, config.RAIL_GRANT
    config.RAIL_URL = "http://192.168.50.10:5000/api/career-hunter/engine/complete"
    expect_refusal(enrich, "a non-loopback rail URL is refused", "rail-not-configured")
    config.RAIL_URL = url
    config.RAIL_GRANT = ""
    expect_refusal(enrich, "a missing grant is refused", "rail-not-configured")
    config.RAIL_GRANT = "not-a-grant"
    expect_refusal(enrich, "a malformed grant is refused", "rail-not-configured")
    config.RAIL_GRANT = grant
    closed = start_fixture()
    port = closed.server_address[1]
    closed.shutdown()
    closed.server_close()
    config.RAIL_URL = f"http://127.0.0.1:{port}/api/career-hunter/engine/complete"
    enrich._RAIL_FAILURE = None
    try:
        enrich.complete("SYSTEM", "PROMPT")
        check("a transport failure raises the named error", False)
    except enrich.CareerWorkerUnavailable as err:
        check("a transport failure raises the named error", err.reason == "career-worker-unavailable")
    config.RAIL_URL = url


def main() -> int:
    install_tripwires()
    server = start_fixture()
    with tempfile.TemporaryDirectory() as tmp:
        prepare_environment(server.server_address[1], Path(tmp))
        from jobhunter import config, enrich, score
        check_identity(enrich, config)
        check_success(enrich, score)
        check_failure(enrich, score)
        check_batch(enrich, score)
        check_misconfiguration(enrich, config)
    server.shutdown()
    check("no codex/claude subprocess, Anthropic SDK or OpenAI path was reached", TRIPPED == [])
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed, "tripped": TRIPPED}))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
