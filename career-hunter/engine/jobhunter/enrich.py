# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: in multi-user (OSHAL) mode every completion is one POST to the package's loopback worker rail, carrying the trusted-service header, the exact OSHAL_USER_SUB and the runner-minted run token, and the rail runs it on the dedicated Career bot. No codex/claude subprocess, Anthropic SDK or OpenAI path is reachable in that mode; a failed rail call raises CareerWorkerUnavailable and every later call in the same process refuses without a request. The standalone single-user engine keeps its legacy providers unchanged.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Sign every rail request with the per-run callback grant instead of presenting the fleet service secret and a bearer token (1.25.1). The kernel's signed-package-callbacks rail admits a completion only when its grant id names a live run of the asserted owner and the HMAC (key = SHA-256 of the grant domain plus the secret) over the method, the path, a fresh timestamp, a single-use nonce and the body hash verifies; under ADR-149 enforce the previous secret-plus-subject contract was refused before the package ran. The five contract headers mirror lib/career-engine-runs.js verifyRailRequest.

"""AI enrichment: a first-pass about / positives / negatives / score per company.

Also the engine's single model chokepoint: every model call in the engine goes through
complete(). In multi-user (OSHAL) mode that is the Career worker rail and nothing else; the
standalone single-user engine uses whichever provider is configured (codex, Anthropic, OpenAI).
Output is DIRECTIONAL and flagged AI-estimated — your manual edits always override it
(see db.company_view). No review sites are scraped.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
from urllib.parse import urlsplit

from . import config, db

# ── Career worker rail (multi-user / OSHAL mode) ─────────────────────────────
RAIL_CONTENT_TYPE = "application/vnd.oshal.career-rail+json"
_RAIL_HOSTS = ("http://127.0.0.1:", "http://localhost:", "http://[::1]:")
_RAIL_LOCK = threading.Lock()
_RAIL_FAILURE = None
# The signed rail contract (lib/career-engine-runs.js): a grant is `<run id>.<secret>`; the key is
# SHA-256("oshal-career-rail-grant-v1:" + secret); the signature is HMAC-SHA256(key,
# "POST|<path>|<unix seconds>|<nonce>|<hex sha256(body)>"), sent as five headers.
_RAIL_GRANT_RE = re.compile(r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$", re.I)
_RAIL_KEY_DOMAIN = b"oshal-career-rail-grant-v1:"


class CareerWorkerUnavailable(RuntimeError):
    """The Career worker rail could not complete a model call.

    Raised in multi-user mode only. The run must end here: there is no fallback provider, and
    after the first failure every later call in this process refuses without a request.
    """

    def __init__(self, reason: str, status: int | None = None):
        super().__init__(f"career worker unavailable: {reason}")
        self.reason = reason
        self.status = status


def _rail_mode() -> bool:
    """Multi-user (OSHAL) mode has exactly one model path: the Career worker rail."""
    return bool(config.MULTIUSER)


def _rail_grant() -> tuple[str, str] | None:
    match = _RAIL_GRANT_RE.match(config.RAIL_GRANT or "")
    return (match.group(1).lower(), match.group(2)) if match else None


def _rail_configured() -> bool:
    url = config.RAIL_URL or ""
    return bool(url.startswith(_RAIL_HOSTS) and _rail_grant() is not None)


def _rail_trip(reason: str, status: int | None) -> None:
    """Open the circuit for this process and raise; the first recorded failure is kept."""
    global _RAIL_FAILURE
    with _RAIL_LOCK:
        if _RAIL_FAILURE is None:
            _RAIL_FAILURE = CareerWorkerUnavailable(reason, status)
            print(f"career worker unavailable: {reason}", file=sys.stderr, flush=True)
        failure = _RAIL_FAILURE
    raise CareerWorkerUnavailable(failure.reason, failure.status)


def _rail_headers(body: bytes) -> dict:
    """The five signed-rail headers for one exact body, plus the content type. Each call mints a
    fresh nonce, so a captured request can never be replayed."""
    grant = _rail_grant()
    if grant is None:
        _rail_trip("rail-not-configured", None)
    grant_id, secret = grant
    key = hashlib.sha256(_RAIL_KEY_DOMAIN + secret.encode("ascii")).digest()
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    target = urlsplit(config.RAIL_URL).path or "/"
    body_hash = hashlib.sha256(body or b"").hexdigest()
    canonical = f"POST|{target}|{timestamp}|{nonce}|{body_hash}".encode("utf-8")
    owner = base64.urlsafe_b64encode(config.USER_SUB.encode("utf-8")).decode("ascii").rstrip("=")
    return {
        "Content-Type": RAIL_CONTENT_TYPE,
        "X-Career-Rail-Grant": grant_id,
        "X-Career-Rail-Owner": owner,
        "X-Career-Rail-Timestamp": timestamp,
        "X-Career-Rail-Nonce": nonce,
        "X-Career-Rail-Signature": hmac.new(key, canonical, hashlib.sha256).hexdigest(),
    }


def _json_or_empty(raw: bytes) -> dict:
    try:
        value = json.loads((raw or b"{}").decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _rail_post(body: bytes) -> tuple[int, dict]:
    """POST one completion to the loopback rail. Proxies are bypassed on purpose: the request is
    signed with this run's grant and must never leave the controller's own listener."""
    import urllib.error
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(config.RAIL_URL, data=body, headers=_rail_headers(body), method="POST")
    try:
        with opener.open(request, timeout=config.RAIL_TIMEOUT_S) as response:
            return response.status, _json_or_empty(response.read())
    except urllib.error.HTTPError as err:
        return err.code, _json_or_empty(err.read())
    except (urllib.error.URLError, OSError, ValueError):
        return 0, {"error": "career-worker-unavailable"}


def _complete_rail(system, prompt, max_tokens, json_mode) -> str:
    """One completion on the dedicated Career bot through the package's worker rail."""
    if _RAIL_FAILURE is not None:
        raise CareerWorkerUnavailable(_RAIL_FAILURE.reason, _RAIL_FAILURE.status)
    if not _rail_configured():
        _rail_trip("rail-not-configured", None)
    body = json.dumps({
        "system": system or "", "prompt": prompt or "",
        "maxTokens": int(max_tokens or 900), "jsonMode": bool(json_mode),
    }).encode("utf-8")
    status, payload = _rail_post(body)
    if status == 200 and payload.get("ok") is True and isinstance(payload.get("text"), str):
        return payload["text"]
    error = payload.get("error")
    _rail_trip(error if isinstance(error, str) and error else f"http-{status}", status or None)
    return ""  # unreachable: _rail_trip always raises

SYSTEM = (
    "You assess employers for a job seeker. Be balanced and honest. "
    "Base your answer on widely known, public information about the company as an employer. "
    "If you are not confident, say so via a lower score. Never invent specifics."
)

PROMPT = """Company: {name}
Industry: {industry}
Public context (optional): {context}

Return STRICT JSON only, no prose:
{{
  "about": "2-3 sentence neutral description of the company as an employer",
  "positives": ["3-5 concrete positives of working there"],
  "negatives": ["3-5 concrete negatives / common complaints"],
  "score": <integer 0-100 overall 'good place to work' estimate>
}}"""


def _have_raw_anthropic():
    """Can we make fast raw API calls? Returns an auth dict or None."""
    if config.ANTHROPIC_API_KEY:
        return {"kind": "api_key", "secret": config.ANTHROPIC_API_KEY, "headers": {}}
    return config.anthropic_auth()  # OAuth token from the Claude Code login


def _have_cli():
    return bool(config.claude_bin() and config.has_subscription_login())


# ── codex provider ───────────────────────────────────────────────────────────
# Drives the platform's configured `codex` credential (ChatGPT/codex plan via the
# mounted ~/.codex/auth.json — the SAME credential world-classify and the other
# OSHAL features use). Keeps all jobs AI OFF the operator's Claude subscription.
# Set JOBHUNTER_USE_CODEX=0 to fall back to a connected Anthropic key / OpenAI.

def _codex_cmd():
    """How to invoke codex on this box, as an argv prefix.
    On Windows the `.cmd`/`.ps1` shim breaks spawn, so we run `node bin/codex.js`."""
    import shutil
    from pathlib import Path
    node = shutil.which("node")
    override = os.environ.get("CODEX_CLI_PATH")
    if override and override != "codex" and Path(override).exists():
        return [node, override] if override.endswith(".js") and node else [override]
    cands = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        cands.append(Path(appdata) / "npm" / "node_modules" / "@openai" / "codex" / "bin" / "codex.js")
    shim = shutil.which("codex")
    if shim:
        cands.append(Path(shim).parent / "node_modules" / "@openai" / "codex" / "bin" / "codex.js")
    if node:
        for c in cands:
            if c.exists():
                return [node, str(c)]
    return [shim] if shim else ["codex"]


def _have_codex() -> bool:
    if os.environ.get("JOBHUNTER_USE_CODEX", "1") == "0":
        return False
    from pathlib import Path
    home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return (home / "auth.json").exists() or bool(os.environ.get("OPENAI_API_KEY"))


def _extract_codex_message(raw: str) -> str:
    """codex --json emits JSONL events; the answer is the last item.completed agent_message."""
    last = ""
    for line in (raw or "").splitlines():
        t = line.strip()
        if not t.startswith("{"):
            continue
        try:
            ev = json.loads(t)
        except json.JSONDecodeError:
            continue
        item = ev.get("item") or {}
        if ev.get("type") == "item.completed" and item.get("type") == "agent_message" and item.get("text"):
            last = item["text"]
    return last


def _complete_codex(system, prompt, json_mode=True, max_tokens=900):
    """One completion via `codex exec`. Read-only sandbox; the prompt is fed over STDIN
    (an argv has length caps a resume-gen prompt would blow). Reasoning effort defaults
    low for cheap bulk scoring, medium for the big generation prompts (override with
    JOBHUNTER_CODEX_EFFORT). Raises on hard failure so we never silently fall through
    to the operator's Claude subscription."""
    import time
    import tempfile
    import subprocess
    full = (system + "\n\n" + prompt) if system else prompt
    if json_mode:
        full += "\n\nRespond with ONLY a single JSON object, no prose, no code fence."
    effort = os.environ.get("JOBHUNTER_CODEX_EFFORT") or ("medium" if (max_tokens or 0) >= 2000 else "low")
    args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only",
            "-c", f"model_reasoning_effort={effort}",
            "-"]   # "-" => read the prompt from stdin
    cmd = _codex_cmd() + args
    last_err = ""
    for attempt in range(3):
        try:
            proc = subprocess.run(cmd, input=full, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace",
                                  timeout=600, cwd=tempfile.gettempdir(), shell=False)
        except subprocess.TimeoutExpired:
            last_err = "timeout"
            time.sleep(2 ** attempt)
            continue
        text = _extract_codex_message(proc.stdout)
        if text:
            return text
        last_err = (proc.stderr or "")[:200] or "no agent_message in output"
        time.sleep(2 ** attempt)
    raise RuntimeError(f"codex exec failed: {last_err}")


def provider():
    if _rail_mode():
        return "oshal-bot"
    if _have_codex():
        return "codex"
    if _have_raw_anthropic() or _have_cli():
        return "anthropic"
    if config.OPENAI_API_KEY:
        return "openai"
    return None


_provider = provider  # backwards-compatible alias


def auth_kind() -> str | None:
    if _rail_mode():
        return "oshal-bot"
    if _have_codex():
        return "codex"
    a = _have_raw_anthropic()
    if a:
        return a["kind"]            # 'api_key' or 'oauth' (fast raw calls)
    if _have_cli():
        return "cli"
    return "openai" if config.OPENAI_API_KEY else None


def model_name(model: str | None = None) -> str:
    if _rail_mode():
        return "oshal-career-bot"
    if _have_codex():
        return os.environ.get("JOBHUNTER_CODEX_MODEL", "codex")
    if provider() == "anthropic":
        return model or config.ANTHROPIC_MODEL
    return config.OPENAI_MODEL


def _complete_raw(system, prompt, max_tokens, model):
    """Fast raw API call via API key or OAuth token. Raises RateLimitError so the
    caller can fall back to the CLI (which has --fallback-model)."""
    import time
    import anthropic
    a = _have_raw_anthropic()
    if a["kind"] == "api_key":
        client = anthropic.Anthropic(api_key=a["secret"], max_retries=0)
    else:
        client = anthropic.Anthropic(auth_token=a["secret"], default_headers=a["headers"], max_retries=0)
    for attempt in range(3):
        try:
            msg = client.messages.create(
                model=model or config.ANTHROPIC_MODEL, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text
        except (anthropic.InternalServerError, anthropic.APITimeoutError):
            time.sleep(2 ** attempt)
    return None


def _complete_cli(system, prompt, model):
    """Drive the `claude` CLI in headless print mode — uses your Claude subscription,
    handles OAuth refresh itself, and --fallback-model dodges overload 429s."""
    import time
    import json as _json
    import tempfile
    import subprocess
    binpath, needs_shell = config.claude_bin()
    args = [binpath, "-p", "--output-format", "json", "--no-session-persistence",
            "--fallback-model", "haiku"]
    if model:
        args += ["--model", model]
    if system:
        args += ["--system-prompt", system]
    last_err = ""
    for attempt in range(4):
        try:
            proc = subprocess.run(args, input=prompt, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace",
                                  timeout=300, cwd=tempfile.gettempdir(), shell=needs_shell)
        except subprocess.TimeoutExpired:
            last_err = "timeout"; continue
        d = parse_json(proc.stdout) if proc.stdout else None
        if d and not d.get("is_error") and not d.get("api_error_status"):
            return d.get("result")
        last_err = (d or {}).get("result") or proc.stderr[:200] if (d or proc.stderr) else "no output"
        time.sleep(min(2 ** attempt * 3, 20))
    raise RuntimeError(f"claude CLI failed: {last_err}")


def complete(system: str, prompt: str, max_tokens: int = 900, json_mode: bool = True,
             model: str | None = None) -> str | None:
    """Single LLM completion. In multi-user (OSHAL) mode: the Career worker rail, only — no
    subprocess, SDK or fallback is reachable, and a rail failure raises CareerWorkerUnavailable.
    Standalone: prefers the platform's configured codex credential (off the operator's Claude
    subscription); else a connected Anthropic key / OAuth (falling back to the `claude` CLI on
    rate-limit); else OpenAI."""
    if _rail_mode():
        return _complete_rail(system, prompt, max_tokens, json_mode)
    if _have_codex():
        return _complete_codex(system, prompt, json_mode=json_mode, max_tokens=max_tokens)
    if _have_raw_anthropic():
        import anthropic
        try:
            return _complete_raw(system, prompt, max_tokens, model)
        except anthropic.RateLimitError:
            if _have_cli():
                return _complete_cli(system, prompt, model)
            raise
    if _have_cli():
        return _complete_cli(system, prompt, model)
    if config.OPENAI_API_KEY:
        from openai import OpenAI
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
        resp = client.chat.completions.create(
            model=config.OPENAI_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            **kwargs,
        )
        return resp.choices[0].message.content
    return None


def parse_json(text: str) -> dict | None:
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


_parse = parse_json  # backwards-compatible alias


def enrich_one(name: str, industry: str | None, context: str = "") -> dict | None:
    if not provider():
        return None
    prompt = PROMPT.format(name=name, industry=industry or "unknown", context=context or "n/a")
    data = parse_json(complete(SYSTEM, prompt, max_tokens=700, model=config.ANTHROPIC_SCORE_MODEL))
    if not data:
        return None
    data["_model"] = model_name(config.ANTHROPIC_SCORE_MODEL)
    return data


def enrich_missing(limit: int | None = None, refresh: bool = False) -> tuple[int, int]:
    """Enrich companies lacking AI reputation. Returns (done, skipped)."""
    if not _provider():
        raise RuntimeError(
            "No AI key set. Export ANTHROPIC_API_KEY or OPENAI_API_KEY, "
            "or use `set-manual` to fill reputation by hand."
        )
    done = skipped = 0
    with db.connect() as conn:
        q = """SELECT c.id, c.name, c.industry
               FROM companies c LEFT JOIN company_reputation r ON r.company_id = c.id
               WHERE %s ORDER BY c.id""" % (
            "1=1" if refresh else "r.ai_score IS NULL"
        )
        rows = conn.execute(q).fetchall()
        if limit:
            rows = rows[:limit]
        for row in rows:
            data = enrich_one(row["name"], row["industry"])
            if not data:
                skipped += 1
                continue
            db.save_ai_reputation(
                conn, row["id"], data.get("about"), data.get("positives", []),
                data.get("negatives", []), data.get("score"), data.get("_model"),
            )
            done += 1
    return done, skipped
