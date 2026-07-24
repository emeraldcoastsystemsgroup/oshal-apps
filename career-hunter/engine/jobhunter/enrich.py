"""AI enrichment: a first-pass about / positives / negatives / score per company.

Uses whichever provider key is set (Anthropic preferred, else OpenAI). Output is
DIRECTIONAL and flagged AI-estimated — your manual edits always override it
(see db.company_view). No review sites are scraped.
"""
from __future__ import annotations
import json
import os

from . import config, db

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
    if _have_codex():
        return "codex"
    if _have_raw_anthropic() or _have_cli():
        return "anthropic"
    if config.OPENAI_API_KEY:
        return "openai"
    return None


_provider = provider  # backwards-compatible alias


def auth_kind() -> str | None:
    if _have_codex():
        return "codex"
    a = _have_raw_anthropic()
    if a:
        return a["kind"]            # 'api_key' or 'oauth' (fast raw calls)
    if _have_cli():
        return "cli"
    return "openai" if config.OPENAI_API_KEY else None


def model_name(model: str | None = None) -> str:
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
    """Single LLM completion. Prefers the platform's configured codex credential (off the
    operator's Claude subscription); else a connected Anthropic key / OAuth (falling back to
    the `claude` CLI on rate-limit); else OpenAI."""
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
