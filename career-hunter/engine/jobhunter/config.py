# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Fail closed when JOBHUNTER_STORE names an unsupported backend instead of silently writing SQLite.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: read the runner-minted rail entries (URL, run token, service secret, run id, client timeout) once and remove them from the process environment, so no browser or subprocess the engine starts inherits them. In multi-user mode the model-provider keys are dropped the same way — the engine's model calls go only to the dedicated Career bot through the rail.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Raise the rail client timeout clamp to 9030 s: the runner now hands the engine the rail's queue ceiling plus its per-call deadline (the deadline no longer covers time spent waiting for a Career bot slot), and the old 1900 s clamp would cut that off before the rail answered.
# 4 | maintainer@emeraldcoastsystemsgroup.com | The rail entry is a per-run callback grant (CAREER_RAIL_GRANT, `<run id>.<secret>`) the engine signs with, not a bearer token beside the fleet service secret (1.25.1). The retired 1.24.0 names are still removed from the environment on import, so nothing the engine starts can inherit a stale value, but they are never read.

"""Central configuration for the job-hunter pipeline."""
from __future__ import annotations
import os
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent          # .../job-hunter
DATA_DIR = Path(os.environ.get("JOBHUNTER_DATA", ROOT / "data"))
DB_PATH = Path(os.environ.get("JOBHUNTER_DB", DATA_DIR / "jobs.db"))
SEED_DIR = ROOT / "seeds"
CAREER_DB = Path(
    os.environ.get(
        "JOBHUNTER_CAREER_DB",
        ROOT.parent / "_career-db" / "career_db.json",   # the user's skills DB
    )
)

# ── Multi-user / multi-tenant (OSHAL swarm-app mode) ─────────────────────────
# When MULTIUSER is on, the jobs CORPUS (companies + objective posting data) is shared
# across all users in `corpus.db`, while every per-user signal (keyword/AI fit, status,
# resume/cover paths, lifecycle) lives in a per-user `user-{sub}.db`. A `postings` VIEW in
# the user DB joins the two so every existing read keeps working. When off (default), the
# legacy single-file `jobs.db` is used unchanged. `tenant` is reserved for true multi-tenant.
MULTIUSER = os.environ.get("JOBHUNTER_MULTIUSER", "").lower() in ("1", "true", "yes")
USER_SUB = os.environ.get("OSHAL_USER_SUB", "local")
TENANT = os.environ.get("OSHAL_TENANT", "default")
CORPUS_DB = Path(os.environ.get("JOBHUNTER_CORPUS_DB", DATA_DIR / "corpus.db"))
USER_DB = Path(os.environ.get("JOBHUNTER_USER_DB", DATA_DIR / f"user-{USER_SUB}.db"))

# ── Storage backend selector (JOBHUNTER_STORE) ───────────────────────────────
# 'sqlite' (DEFAULT) keeps the two SQLite shapes above EXACTLY as they were — the nightly
# scrape runs against them and nothing in the Postgres path may perturb that. 'postgres'
# routes every read and write to the swarm database (career_postings + the FORCE-RLS
# per-user tables, migrations 095/096/097) over DATABASE_URL.
#
# Deliberately a value, not a boolean flag: 'sqlite' vs 'postgres' reads unambiguously in
# a crontab and in a container env. An unknown value is a configuration error: falling back
# would send writes to the wrong durable store while the operator believes Postgres is active.
STORE = (os.environ.get("JOBHUNTER_STORE") or "sqlite").strip().lower()
if STORE not in {"sqlite", "postgres"}:
    raise RuntimeError(
        "Unsupported JOBHUNTER_STORE value "
        f"{STORE!r}; expected exactly 'sqlite' or 'postgres'. Refusing to select a fallback."
    )
POSTGRES = STORE == "postgres"

# Only consulted in postgres mode. This is the same connection string every other process
# in the api container uses, so the engine runs as the app role (oshal_app) — which is
# NOT a superuser and does NOT have BYPASSRLS, and therefore cannot escape the row
# policies even by accident. Never point this at a superuser DSN.
DATABASE_URL = os.environ.get("DATABASE_URL")

# Generated resume/cover PDFs. In OSHAL multi-user mode the node wrapper sets
# JOBHUNTER_DATA to the per-user dir on the persistent api-output volume, so resumes
# land there (DATA_DIR/applications) and SURVIVE container recreates. Legacy single-user
# keeps the old ROOT/applications. Override explicitly with JOBHUNTER_APP_DIR.
APP_DIR = Path(os.environ.get("JOBHUNTER_APP_DIR", (DATA_DIR if MULTIUSER else ROOT) / "applications"))

# ── HTTP politeness ──────────────────────────────────────────────────────────
USER_AGENT = os.environ.get(
    "JOBHUNTER_UA",
    "Mozilla/5.0 (compatible; jobhunter/1.0; personal job search; +mailto:contact@example.com)",
)
REQUEST_TIMEOUT = float(os.environ.get("JOBHUNTER_TIMEOUT", "20"))
# Minimum seconds between requests to the SAME host (per-host rate limit).
PER_HOST_DELAY = float(os.environ.get("JOBHUNTER_DELAY", "1.0"))
MAX_RETRIES = int(os.environ.get("JOBHUNTER_RETRIES", "3"))

# ── AI auth (score / enrich / apply) ─────────────────────────────────────────
# Auto-detected, in priority order:
#   1. ANTHROPIC_API_KEY env var  (console.anthropic.com pay-as-you-go key)
#   2. your Claude Code login      (OAuth token in ~/.claude/.credentials.json — your
#                                   Claude subscription; no separate API key needed)
#   3. OPENAI_API_KEY env var
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
CLAUDE_CREDENTIALS = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / ".credentials.json"
OAUTH_BETA_HEADER = "oauth-2025-04-20"

# Strong model for writing resumes/cover letters; fast model for bulk fit-scoring.
# Sonnet (not Opus) for generation: plenty powerful for resumes and far higher
# throughput on a Claude subscription (Opus rate-limits hard under OAuth).
ANTHROPIC_MODEL = os.environ.get("JOBHUNTER_ANTHROPIC_MODEL", "claude-sonnet-4-6")
ANTHROPIC_SCORE_MODEL = os.environ.get("JOBHUNTER_SCORE_MODEL", "claude-haiku-4-5-20251001")
OPENAI_MODEL = os.environ.get("JOBHUNTER_OPENAI_MODEL", "gpt-4o-mini")


# ── Career worker rail (multi-user / OSHAL mode) ─────────────────────────────
# The package runner registers every engine child as a run and hands it these entries. They are
# read ONCE here and popped from os.environ, so Playwright/Chromium and any subprocess the engine
# starts never inherit the run token or the service secret. The URL is the controller's own
# loopback listener; enrich.complete refuses any other host.
def _take_env(name: str) -> str:
    return (os.environ.pop(name, None) or "").strip()


RAIL_URL = _take_env("CAREER_RAIL_URL")
RAIL_GRANT = _take_env("CAREER_RAIL_GRANT")
RAIL_RUN_ID = _take_env("CAREER_RAIL_RUN_ID")
# The 1.24.0 bearer token and fleet secret: removed so no subprocess inherits a stale copy, never used.
for _retired_rail_name in ("CAREER_RAIL_TOKEN", "CAREER_RAIL_SERVICE_SECRET"):
    os.environ.pop(_retired_rail_name, None)
try:
    # The runner sets the rail's queue ceiling plus its per-call deadline plus 30 s; the upper clamp
    # is the largest value the package limits allow (7200 s queue + 1800 s deadline + 30 s).
    RAIL_TIMEOUT_S = max(5.0, min(9030.0, float(_take_env("CAREER_RAIL_TIMEOUT_S") or "330")))
except ValueError:
    RAIL_TIMEOUT_S = 330.0

if MULTIUSER:
    # Multi-user mode has exactly one model path: the rail. A provider key that reached this
    # process anyway is discarded and removed from the environment, never used as a fallback.
    for _provider_key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        os.environ.pop(_provider_key, None)
    ANTHROPIC_API_KEY = None
    OPENAI_API_KEY = None


def claude_bin():
    """Path to the `claude` CLI (drives your Claude subscription, handling OAuth+refresh).
    Returns (path, needs_shell) or None. Prefers the native exe, falls back to PATH."""
    import shutil
    exe = os.environ.get("CLAUDE_CODE_EXECPATH")
    if exe and Path(exe).exists():
        return (exe, False)
    # VS Code extension native binary (version dir varies)
    for p in sorted((Path.home() / ".vscode" / "extensions").glob(
            "anthropic.claude-code-*/resources/native-binary/claude.exe"), reverse=True):
        return (str(p), False)
    found = shutil.which("claude") or shutil.which("claude.cmd")
    if found:
        return (found, found.lower().endswith((".cmd", ".bat")))
    return None


def has_subscription_login() -> bool:
    """True if a Claude Code OAuth login exists (so the CLI can run unattended)."""
    try:
        import json
        creds = json.loads(CLAUDE_CREDENTIALS.read_text(encoding="utf-8"))
        return bool((creds.get("claudeAiOauth") or {}).get("accessToken"))
    except Exception:
        return False


def anthropic_auth():
    """Return dict(kind='api_key'|'oauth', secret=..., headers={...}) or None.
    Read fresh each call so a refreshed Claude Code token is picked up."""
    if ANTHROPIC_API_KEY:
        return {"kind": "api_key", "secret": ANTHROPIC_API_KEY, "headers": {}}
    try:
        import json
        creds = json.loads(CLAUDE_CREDENTIALS.read_text(encoding="utf-8"))
        tok = (creds.get("claudeAiOauth") or {}).get("accessToken")
        if tok:
            return {"kind": "oauth", "secret": tok,
                    "headers": {"anthropic-beta": OAUTH_BETA_HEADER}}
    except Exception:
        pass
    return None


# ── Google Programmable Search (find each company's careers URL — "the first link") ──
# Needs an API key AND a search-engine id (cx) set to "search the entire web".
#   https://programmablesearchengine.google.com  ->  create engine, copy the cx
#   https://console.cloud.google.com -> enable "Custom Search API", copy the key
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_SEARCH_API_KEY")
GOOGLE_CX = os.environ.get("GOOGLE_CX") or os.environ.get("GOOGLE_SEARCH_CX")

# Fallback: read from a local keys file (job-hunter/.google.json: {"api_key":..,"cx":..})
if not (GOOGLE_API_KEY and GOOGLE_CX):
    try:
        import json as _json
        _g = _json.loads((ROOT / ".google.json").read_text(encoding="utf-8"))
        GOOGLE_API_KEY = GOOGLE_API_KEY or _g.get("api_key")
        GOOGLE_CX = GOOGLE_CX or _g.get("cx")
    except Exception:
        pass

# ── Firecrawl (web search backend for recruiter-finding) ─────────────────────
# Google's Custom Search JSON API is closed to new projects, so we use Firecrawl's
# /v1/search. Key from env, or a local keys file (job-hunter/.firecrawl.json:
# {"api_key": "fc-..."}). Reuses the same key the Firecrawl MCP server uses.
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY")
if not FIRECRAWL_API_KEY:
    try:
        import json as _jsonf
        FIRECRAWL_API_KEY = _jsonf.loads(
            (ROOT / ".firecrawl.json").read_text(encoding="utf-8")).get("api_key")
    except Exception:
        pass

DATA_DIR.mkdir(parents=True, exist_ok=True)
