"""Generate a powerful, tailored resume + cover letter for one job, as PDF.

Pipeline: pull the job + the candidate's full career_db -> ask the LLM to select and sharpen
the most relevant real experience into structured JSON (no fabrication) -> render
HTML via Jinja2 -> Chromium -> PDF. Files land in applications/<Company>__<id>/.
"""
from __future__ import annotations
import json
import re
import subprocess
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import db, enrich, profile, config

TEMPLATES = Path(__file__).parent / "templates"
# Resume/cover output dir — config.APP_DIR points at the per-user persistent volume in
# OSHAL multi-user mode (survives recreates), legacy ROOT/applications otherwise.
APP_DIR = config.APP_DIR

_env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))

# Selectively bold the quantified impact in a bullet ($, %, multipliers, k/M/B, plain counts)
# so a skimming recruiter's eye lands on outcomes — exactly what executive-resume guidance advises.
_METRIC = re.compile(
    r"(\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]?\b|"        # $4.2M, $40,000
    r"\d[\d,]*(?:\.\d+)?\s?%|"                       # 28%, 99.98%
    r"\b\d+(?:\.\d+)?x\b|"                            # 3x
    r"\b\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|million|billion|thousand)\b|"  # 12M, 5 million
    r"(?<![A-Za-z/])\d[\d,]{2,}\b)",                  # 1,200  4173 — but NOT AS/400, IL4, S/4
    re.I)


def _bold_metrics(text):
    from markupsafe import Markup, escape
    if not text:
        return text
    out, last = [], 0
    for m in _METRIC.finditer(str(text)):
        out.append(escape(text[last:m.start()]))
        out.append(Markup("<b>") + escape(m.group(0)) + Markup("</b>"))
        last = m.end()
    out.append(escape(text[last:]))
    return Markup("").join(out)


_env.filters["boldmetrics"] = _bold_metrics

# ─────────────────────────────────────────────────────────────────────────────
# Prompt framing.
#
# GENERAL resume-writing craft stays hardcoded below — mirroring limits, bullet craft,
# voice, punctuation and the never-invent rule are true for every candidate.
#
# Anything that is a FACT ABOUT ONE PERSON — their name, real titles, org scale, comp
# band, employer, home city, or which side projects are embargoed — is read from the
# profile's optional `prompt_framing` block. It is NEVER hardcoded here. A user who has
# only uploaded a résumé gets a correct generic prompt; a user who fills in
# `prompt_framing` gets the same tightly-tuned behaviour this module used to hardcode
# for a single person. This restores the design the prompt already assumed when it said
# "framed per the profile's framing_notes".
# ─────────────────────────────────────────────────────────────────────────────

_FRAMING_DEFAULTS = {
    "candidate": "the candidate",   # given name used inside prompt rules
    "comp_band": "",                # e.g. "~$200K-level"
    "seniority_altitude": "",       # e.g. "Program Manager / SRE Lead, Principal Solutions Architect"
    "org_scale": "",                # e.g. "40-person orgs, $50M presales"
    "player_coach": "",             # e.g. "leads a 40-person organization (several PMs plus dotted-line reports)"
    "contact_location": "",         # e.g. "Springfield, IL" — the fixed contact-line geography
    "banned_titles": "",            # titles the candidate must never be shown as holding
    "true_titles": "",              # derived from roles[] when absent
    "employer": "",                 # current employer, derived from roles[0].org when absent
    "ai_exceptions": "",            # employer AI work that MAY appear despite the side-project embargo
    "oss_name": "",                 # independent open-source project name
    "oss_site": "",                 # its site
    "oss_capabilities": "",         # factual capability list for the opt-in section
    "oss_embargo_terms": "",        # comma-separated terms the embargo must also suppress
    "employer_aliases": "",         # exact legal/company names the letter may use
    "compliance_notes": "",         # domain accuracy rules (e.g. which controls are prod-enforced)
    "domain_depth_example": "",     # an illustrative "surface earlier-role depth" example
}


def _framing(prof: dict) -> dict:
    """Person-specific prompt facts, sourced from the profile.

    Precedence: an explicit `prompt_framing` block wins; otherwise we derive what we can
    from the parsed résumé (name, location, titles, employer) so the tool is useful with
    zero configuration. Every value has a neutral fallback, so nothing about any specific
    person is ever baked into this file.
    """
    f = dict(_FRAMING_DEFAULTS)
    prof = prof or {}
    for k, v in (prof.get("prompt_framing") or {}).items():
        if k in f and str(v or "").strip():
            f[k] = str(v).strip()

    p = prof.get("profile") or {}
    if f["candidate"] == _FRAMING_DEFAULTS["candidate"] and p.get("name"):
        f["candidate"] = str(p["name"]).split()[0]
    if not f["contact_location"] and p.get("location"):
        f["contact_location"] = str(p["location"])

    roles = prof.get("roles") or []
    if not f["true_titles"] and roles:
        seen, titles = set(), []
        for r in roles:
            t = str(r.get("title") or "").strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                titles.append(t)
        f["true_titles"] = ", ".join(titles[:6])
    if not f["employer"] and roles:
        f["employer"] = str(roles[0].get("org") or "").strip()

    oss = prof.get("oss_portfolio") or {}
    if not f["oss_name"] and oss.get("name"):
        f["oss_name"] = str(oss["name"]).strip()
    if not f["oss_site"] and oss.get("site"):
        f["oss_site"] = str(oss["site"]).strip()
    return f


def _sys_pre(f: dict) -> str:
    who = f["candidate"]
    band = f", {f['comp_band']}" if f["comp_band"] else ""
    s = (
        f"You are an elite executive resume writer for a senior{band} technology leader. "
        "You tailor their REAL experience to a specific job at the RIGHT altitude: for senior/leadership "
        "roles lead with executive scope — revenue, scale, P&L-style outcomes, org leadership, "
        "transformation; for hands-on build/automation/IC roles lead with deep technical delivery, "
        "AI-driven automation, and fast, low-cost turnaround. Never undersell them; never inflate. "
        "Absolute rule: use ONLY facts in the candidate profile — never invent employers, titles, "
        "dates, metrics, or skills. Reorder, emphasize, and rephrase for impact and to mirror the "
        "job's exact language and keywords. MIRRORING LIMIT (critical): mirror the JD's wording ONLY "
        f"for skills, tools, titles, and experience {who} genuinely has per the profile. A phrase, tool, "
        "title, or credential appearing in the JD is NOT permission to claim it. If it is not in the "
        "candidate profile, it does NOT go in the resume or cover, even rephrased or hedged. "
        "Strong, concrete, executive, active voice. "
    )
    altitude = ", ".join(x for x in (f["seniority_altitude"], f["org_scale"]) if x)
    if altitude:
        s += (
            f"Default to their TRUE senior altitude — {altitude} — and present them as a player-coach "
            "who LEADS and builds; do NOT down-level them to a junior individual contributor even when "
            "the target title sounds hands-on, and never silently drop their strongest differentiators "
            "— keep them visible, framed per the profile's framing_notes. "
        )
    else:
        s += (
            "Default to the seniority the profile actually supports; do NOT down-level them when the "
            "target title sounds hands-on, and never silently drop their strongest differentiators — "
            "keep them visible, framed per the profile's framing_notes. "
        )
    loc = f["contact_location"]
    if loc:
        s += (
            "LOCATION: put NO city/state in the headline or summary at all — geography belongs only in "
            f"the contact line, which is fixed to {loc}. Never mention the job's location or relocation "
            f"in the résumé body, and never imply they live anywhere other than {loc}. "
        )
    else:
        s += (
            "LOCATION: put NO city/state in the headline or summary — geography belongs only in the "
            "contact line, taken from the profile. Never mention the job's location or relocation in "
            "the résumé body. "
        )
    return s


def _oshal_ban(f: dict) -> str:
    """Default: embargo the candidate's personal/unreleased side project."""
    who = f["candidate"]
    named = f" this includes {f['oss_name']}, and" if f["oss_name"] else " this includes"
    extra = ""
    if f["oss_embargo_terms"]:
        extra = f" Also suppress: {f['oss_embargo_terms']}. "
    allowed = ""
    if f["ai_exceptions"]:
        allowed = f"The ONLY AI work that may appear is {f['ai_exceptions']}. "
    return (
        "HONOR the profile's 'framing_notes' exactly. NEVER present any PERSONAL or UNRELEASED side "
        f"project as work, a skill, or a metric —{named} ANY personal multi-agent / agent-orchestration "
        "platform, agent-to-agent (A2A) or swarm framework, and figures like agents-per-container or "
        "percent-faster/cheaper. Do NOT surface these even unnamed or described generically. This ALSO "
        "bans 'agentic AI engineering', 'agentic coding', 'custom CLI agent automation', 'AI agents', "
        "agent orchestration, and any 'pioneered AI ahead of the mainstream' framing, even attributed to "
        f"an employer — that is {who}'s personal work and NEVER appears, with NO exception. " + extra +
        allowed +
        "Never overstate beta/initiative work as adopted or quantified impact. "
    )


def _sys_post(f: dict) -> str:
    who = f["candidate"]
    s = (
        "REFERRALS/CONTACTS (hard rule): NEVER claim the candidate has a referral, an internal contact, "
        "an introduction, a sponsor, or ANY pre-existing relationship to the company, team, or hiring "
        "manager. Do NOT infer one from the company name or any internal tag. They have NO referral or "
        "inside contact unless the profile explicitly names a specific person. "
    )
    if f["banned_titles"]:
        s += (
            f"TITLES (hard rule): NEVER claim {who} held or 'served as' {f['banned_titles']}, and never put "
            "such a title in the headline, summary, competencies, or bullets. "
        )
    else:
        s += (
            "TITLES (hard rule): NEVER claim a title the profile does not explicitly list, and never put "
            "an unearned title in the headline, summary, competencies, or bullets. "
        )
    if f["true_titles"]:
        s += f"Use their REAL titles exclusively ({f['true_titles']}). "
    s += (
        "BULLET CRAFT (apply to EVERY experience bullet): start with a strong PAST-TENSE action verb "
        "(e.g. Led, Built, Designed, Directed, Drove, Established, Delivered, Recovered, Orchestrated, "
        "Generated, Grew, Advised) — use a DIFFERENT lead verb for each bullet, NEVER repeating one; "
        "lead with the outcome/metric; keep each bullet to 1-2 lines; and avoid filler or weak words "
        "(just, responsible for, various, successfully, helped, worked on, assisted). The summary is a "
        "tight 3-4 sentence paragraph, not a list. "
        "VOICE (hard rule): write the resume and cover in FIRST PERSON, implied (no pronoun) or 'I'. NEVER "
        f"refer to the candidate in the THIRD PERSON anywhere - no 'he', 'she', 'they', or '{who}'. Bullets "
        "carry no pronoun ('Designed and ran the Innovation Control Center'), never 'he designed and ran'. "
    )
    if f["player_coach"]:
        s += (
            f"PLAYER-COACH FRAMING (critical): {who} {f['player_coach']} and is hands-on, but is NOT a solo "
            "individual contributor. Frame big platform/program accomplishments as LEADERSHIP of the work: "
            "'led the design and build of', 'directed the team that delivered', 'drove and oversaw the "
            "development of'. Do NOT write 'designed and built', 'architected and built', or 'engineered' "
            "as if they personally built large systems alone. Reserve 'personally engineered/built' ONLY "
            "for things they truly coded themselves. NEVER 'solo-developed', 'solo-built', or "
            "'single-handedly'. "
        )
    s += (
        "PUNCTUATION (hard rule): NEVER use em dashes or en dashes (the — or – characters) "
        "anywhere in the resume or cover letter, and never use a dash to join or separate clauses or "
        "sentences. Use commas, periods, parentheses, or the word 'to' for ranges. Ordinary hyphens "
        "inside standard compound words (full-stack, cross-functional) are fine."
    )
    return s


def _oshal_allow(f: dict) -> str:
    """Opt-in: surface the candidate's independent open-source / R&D work."""
    who = f["candidate"]
    name = f["oss_name"] or "their independent open-source project"
    site = f" ({f['oss_site']})" if f["oss_site"] else ""
    caps = f" Its real capabilities: {f['oss_capabilities']}." if f["oss_capabilities"] else ""
    emp = f["employer"]
    emp_rule = (
        f"never attribute it to {emp} (it is their personal open-source work). " if emp
        else "never attribute it to any employer (it is their personal open-source work). "
    )
    outside = f"'Outside {emp}'" if emp else "'outside of work'"
    return (
        f"INCLUDE {who}'s independent open-source / R&D work as a DISTINCT resume section titled "
        f"'Open Source / Independent R&D', drawn ONLY from the profile's 'oss_portfolio' block ({name}"
        f"{site}). Emit it as the JSON 'open_source' array, NOT inside 'experience'." + caps +
        " The cover letter SHOULD reference this open-source work where it strengthens fit for AI / "
        "agentic / LLM / applied-research roles. Still NEVER fabricate: use only facts in oss_portfolio; "
        "never invent users, adoption, revenue, or metrics for it; " + emp_rule +
        "When the cover letter mentions this work, make it sound human and clearly independent: use a "
        f"plain phrase like 'In my own open-source work' or {outside} and keep it to one natural "
        "sentence unless the job is explicitly about agentic systems. Do NOT make it sound like a "
        "corporate product, employer project, funded program, or adopted platform. "
    )


def build_system(prof: dict, include_oshal: bool = False) -> str:
    """Assemble the resume/cover system prompt for THIS candidate's profile."""
    f = _framing(prof)
    return _sys_pre(f) + (_oshal_allow(f) if include_oshal else _oshal_ban(f)) + _sys_post(f)


# Appended to the user prompt only in OSHAL-on mode: defines the extra resume schema key.
_OSHAL_PROMPT_SUFFIX = (
    "\n\nOPEN SOURCE MODE IS ON. Add to the \"resume\" object one more key:\n"
    '  "open_source": [{"title": "...", "org": "<project> (open-source)", '
    '"span": "2024 to Present", "bullets": ["3-4 bullets tailored to THIS job, drawn ONLY from '
    'the profile\'s oss_portfolio entry + skills"]}]\n'
    "Tailor those bullets to the job's agentic / AI / LLM / MCP / RAG / applied-research needs. "
    "Do NOT place this work inside \"experience\". Keep it truthful to oss_portfolio."
)

PROMPT = """CANDIDATE PROFILE (the only source of truth — do not invent beyond this):
{profile}

TARGET JOB:
Company: {company}
Title: {title}
Location: {location}
Description:
{description}

Produce a tailored resume and cover letter. Return STRICT JSON only:
{{
  "resume": {{
    "headline": "role-matched headline mirroring the target title, but NEVER below the candidate's true senior altitude — if the JD title sounds junior/IC, still frame him at his real level (Program Manager / SRE Lead / Principal / Director-equivalent leader), never down-leveled",
    "summary": "3-4 sentence executive summary tuned to this job",
    "competencies": ["8-12 short skill phrases prioritized to this job's needs"],
    "experience": [
      {{"title": "...", "org": "...", "span": "...",
        "bullets": ["3-4 achievement bullets, quantified, relevant to THIS job"]}}
    ],
    "skills": ["concise technical skills line items, JD-prioritized"],
    "certifications": ["..."],
    "education": ["..."],
    "clearance": "the candidate's clearance EXACTLY as written in the profile — do NOT add citizenship, investigation tiers (e.g. Tier 3/T5), or eligibility claims that are not stated verbatim in the profile"
  }},
  "cover": {{
    "greeting": "Dear Hiring Manager,",
    "paragraphs": ["EXACTLY 3 tight paragraphs in the candidate's voice: warm, direct, specific, and senior, not a corporate template. (1) Open with why THIS role is interesting in plain language, then name the single strongest match; (2) give 2-3 proof points that connect naturally to the JD without sounding like a resume pasted into prose; (3) close with what they would bring and a simple ask. The ENTIRE letter must stay under ~230 words so it fits on ONE page, concise not padded. STYLE (critical): write like a real senior engineer talking to a hiring manager, not like marketing copy. Avoid stiff phrases such as 'the closest match to that charter', 'evolve its platform', 'drove synergies', 'proven track record', 'uniquely positioned', 'leveraging my background', 'I am writing to apply', and 'I would welcome a conversation about helping evolve'. Do NOT start consecutive sentences with 'I', and no more than TWO sentences in the WHOLE letter may begin with 'I'. Vary sentence openings and keep the focus on the role and the value or outcome: lead with the work, the team, the result, or the company's need, not 'I did X, I did Y'. Frame leadership as 'led the effort and delivered' or 'led the team that delivered', never 'I delivered' as if solo. If open-source mode is on, mention the independent open-source/R&D work plainly, not grandly. ATTRIBUTION (critical): keep every accomplishment with the role and era where it actually happened, exactly as the profile records it — presales wins belong to the presales/solution-architect era, incident and escalation wins to the escalation role, and platform/SRE outcomes to the role that owned them. NEVER blend or cross-attribute metrics or successes from one role into another."],
    "closing": "Sincerely,"
  }}
}}
EXPERIENCE — favor a tight, senior, ~2-page résumé over completeness. Reverse-chronological, no fabricated gaps. Give the RECENT, relevant roles full weight: the current role and the other recent roles most relevant to THIS job each get 3-4 quantified bullets. Condense older mid-career roles to ONE tight line each. Collapse EVERYTHING more than roughly 20 years old into AT MOST one brief "Early career" line — or omit it entirely — and do NOT spend bullets on 20+-year-old work. NEVER show a placeholder or generic employer name (e.g. never an industry label in place of a company); if an employer name isn't a real, specific company in the profile, leave that role's org blank or omit the role. Each kept entry cites a CONCRETE real accomplishment — never generic filler like "led enterprise applications." Do not pad the résumé to look complete; relevance and altitude beat length. Keep every bullet under the role where it ACTUALLY occurred — NEVER move an accomplishment into a different role to make that role look more relevant to the job."""


def _start_year(span: str) -> int:
    m = re.search(r"(19|20)\d{2}", span or "")
    return int(m.group(0)) if m else 0


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", (s or "").strip()).strip("-")[:60] or "x"


def _company_doc(name):
    """Strip internal holding-company tags (e.g. 'SAP (Referral)') so they NEVER leak into the
    resume/cover. The tag is our bookkeeping for manually-added reqs; it is NOT a claim that the
    candidate has a referral or any relationship to the company."""
    cleaned = re.sub(r"\s*\((?:referral|manual|internal|direct apply|apply|holding)[^)]*\)", "",
                     name or "", flags=re.I).strip()
    return cleaned or (name or "")


# Reviewers flag em/en dashes as an "AI tell" — strip them from all generated copy.
# Only em/en dashes and SPACED-hyphen separators are removed; ordinary in-word hyphens
# (full-stack) and phone numbers (e.g. 555-123-4567) are left intact.
_DASH_RANGE = re.compile(r"(\b\d{4})\s*[-‐-―−]\s*(Present|Current|Now|present|current|now|\d{4})")
_DASH_NUMRANGE = re.compile(r"(\$?\d[\d,.]*)\s*[–—―−]\s*(\$?\d[\d,.]*)")
_DASH_SEP = re.compile(r"\s*[–—―−]\s*")
_DASH_HYPHSEP = re.compile(r"(\S) -+ (\S)")


def _dewash(s):
    if not isinstance(s, str) or not s:
        return s
    s = _DASH_RANGE.sub(r"\1 to \2", s)
    s = _DASH_NUMRANGE.sub(r"\1 to \2", s)
    s = _DASH_SEP.sub(", ", s)
    s = _DASH_HYPHSEP.sub(r"\1, \2", s)
    s = re.sub(r"\s*,\s*,\s*", ", ", s)
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r",\s*([.;:])", r"\1", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def _sanitize(obj):
    """Recursively strip em/en dashes from generated resume/cover JSON."""
    if isinstance(obj, str):
        return _dewash(obj)
    if isinstance(obj, list):
        return [_sanitize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    return obj


def _job_row(conn, posting_id):
    """The posting + its employer + the employer's effective reputation score.

    `postings`, `companies` and `company_view` all exist in BOTH backends — the SQLite TEMP
    view / ATTACHed corpus, or the compat VIEWs from migration 097 (which cast the Postgres
    types back to the SQLite shapes this function's callers expect, and whose RLS is what
    scopes the per-user columns in `p.*` to the acting user).

    ONE expression has to differ. `cv.score` is COALESCE(manual_score, ai_score), an INTEGER
    in Postgres. SQLite is dynamically typed, so mixing an integer with '' in a COALESCE is
    fine there; Postgres resolves the two arms to a single type, tries ''::integer, and
    fails the whole query with `invalid input syntax for type integer: ""`. Casting the
    score to text is the only type both arms fit, and it preserves the "empty string when
    the company has no reputation score" contract this query has always had.
    """
    # sqlite mode gets the byte-identical expression it has always run.
    score_expr = "COALESCE(cv.score::text,'')" if config.POSTGRES else "COALESCE(cv.score,'')"
    return conn.execute(
        f"""SELECT p.*, c.name AS company, {score_expr} AS company_score
           FROM postings p JOIN companies c ON c.id = p.company_id
           LEFT JOIN company_view cv ON cv.id = c.id WHERE p.id = ?""",
        (posting_id,),
    ).fetchone()


def _pg_park(conn) -> None:
    """POSTGRES ONLY. Leave the connection open but NOT inside a transaction.

    generate_for() holds one connection across the whole packet: it reads the posting, then
    spends minutes on an LLM generation, an LLM editor pass and four Chromium PDF renders
    with no SQL at all, then writes the status and paths. psycopg2 opens a transaction on
    the first execute and keeps it open until commit, so that read leaves the backend
    `idle in transaction` for the entire generation.

    This cluster runs `idle_in_transaction_session_timeout = 1min` — measured on the live
    server, not assumed; the PostgreSQL default is 0. Observed from a second connection: an
    un-parked backend sits in `idle in transaction` and is GONE by t+79s, and the next
    statement raises "server closed the connection unexpectedly". That failure lands AFTER
    the LLM spend and the PDF renders, on the final db.set_status() — the packet would exist
    on disk with no 'generated' status and no resume_path recorded anywhere, which is
    exactly the bookkeeping the apply rail depends on. `idle_session_timeout` is 0, so a
    connection that is merely idle survives indefinitely; the whole job is to not be in a
    transaction.

    WHY TWO COMMITS, which looks wrong and is not. db.py's _PgConnection.commit() re-asserts
    the oshal.current_sub GUC immediately after committing (that re-assertion is what makes
    a mid-connection commit safe at all). Asserting it runs a statement, which OPENS A NEW
    TRANSACTION — so after conn.commit() the backend is still `idle in transaction`, just
    holding a different query. Measured: with conn.commit() alone the backend is still killed
    at ~60s. The second commit, on the underlying psycopg2 connection, ends that GUC
    transaction WITHOUT re-asserting anything; the GUC survives because db.py sets it at
    SESSION scope (set_config(..., is_local => false)), not with SET LOCAL. Verified after an
    80s park: state 'idle', oshal.current_sub still bound, RLS still returning this user's
    1,282,861 score rows and no one else's.

    If db.py's wrapper ever stops exposing the raw connection this raises here — before the
    LLM call is spent — rather than degrading into that 3-minutes-later disconnect."""
    conn.commit()
    raw = getattr(conn, "_raw", None)
    if raw is None:
        raise RuntimeError(
            "cannot park the Postgres connection: db.py's connection wrapper no longer "
            "exposes the underlying psycopg2 connection. Without ending the GUC-assertion "
            "transaction the backend is killed by idle_in_transaction_session_timeout during "
            "generation. Add an explicit park/release to db.py and call it here."
        )
    raw.commit()


def build_editor_system(prof: dict) -> str:
    """Cover-letter editor prompt. Craft rules are general; every fact about a specific
    person (name, titles, employers, domain compliance rules) comes from the profile."""
    f = _framing(prof)
    who = f["candidate"]
    titles = f" ({f['true_titles']})" if f["true_titles"] else ""
    banned = f", NEVER {f['banned_titles']}" if f["banned_titles"] else ""
    companies = (f" Company names are EXACTLY {f['employer_aliases']}." if f["employer_aliases"] else "")
    compliance = (f" {f['compliance_notes']}" if f["compliance_notes"] else "")
    depth_eg = (f" (e.g. {f['domain_depth_example']})" if f["domain_depth_example"] else "")
    return (
    f"You are {who}'s cover-letter editor, not a generic executive resume service. You are handed "
    "a DRAFT cover letter, the JOB DESCRIPTION, and the candidate PROFILE. Rewrite the cover so it sounds "
    "like a real senior engineer and player-coach wrote it: clear, human, confident, specific, and a "
    "little conversational without becoming casual. "
    f"VOICE: {who}'s best voice is direct and grounded. They say why the role actually interests them, name "
    "the work they have led, give concrete proof, and get out. Prefer plain sentences over polished slogans. "
    "The letter should feel written for this company, not generated from a template. "
    "QUALITY BAR: (1) open with a natural sentence about why THIS role fits, then name the single strongest "
    "match; (2) the body cites CONCRETE, NAMED proof points (the real tools, stacks, and metrics already "
    "in the draft or profile) mapped to the JD's top requirements without turning into a resume paragraph; "
    "(3) surface the candidate's most JD-relevant depth even when it lives in an EARLIER role" + depth_eg + "; "
    "(4) close with the value they would bring and a simple, confident ask. "
    "ANTI-MECHANICAL RULES: delete recruiter-speak and stiff scaffolding. Never use phrases like 'the "
    "closest match to that charter', 'evolve its platform', 'I would welcome a conversation about helping "
    "evolve', 'proven track record', 'uniquely positioned', 'leveraging my experience', 'drive innovation', "
    "'at scale' unless scale is tied to a specific metric, or 'this opportunity excites me' unless it is "
    "made concrete. Do not stack three long sentences full of tools. Do not start by describing what the "
    "company is looking for unless the next clause says plainly why the work fits them. "
    "OPEN SOURCE MODE: if the draft/profile includes independent open-source work, mention it only when it "
    "strengthens the fit. Keep it clearly separate from employer work, with wording like 'In my own "
    "open-source work'. One natural sentence is enough for most roles. "
    "HARD CONSTRAINTS (never violate): use ONLY facts already present in the DRAFT or PROFILE - do NOT "
    "invent or add any metric, technology, title, employer, certification, or claim that is not already "
    "there. Keep every accuracy rule intact." + compliance + f" Use only their REAL titles{titles}{banned}."
    + companies + " Player-coach voice ('the team I lead "
    "built', 'led the effort'), never 'I built X' as if solo. Do NOT start consecutive sentences with "
    "'I' and use at most TWO 'I'-openers in the whole letter; vary the sentence openings. NEVER use em "
    "or en dashes. Three tight paragraphs, under ~230 words total, fits one page. Keep the greeting and "
    "closing. Return STRICT JSON ONLY: "
    '{"greeting": "...", "paragraphs": ["...", "...", "..."], "closing": "..."}'
    )


def _polish_cover(cover, title, company, jd, profile_json, prof=None):
    """Second 'senior editor' pass over the draft cover: rewrite to a higher quality bar
    (specific, JD-mapped, professional) WITHOUT adding any facts. Falls back to the draft
    on any error so generation never breaks."""
    try:
        prompt = (
            f"ROLE: {title} at {company}\n\n"
            f"JOB DESCRIPTION:\n{(jd or '(none)')[:5000]}\n\n"
            f"CANDIDATE PROFILE (the ONLY facts you may draw on; add nothing beyond this):\n"
            f"{profile_json[:90000]}\n\n"
            f"DRAFT COVER (rewrite to the quality bar; keep it strictly truthful):\n"
            f"{json.dumps(cover, indent=1)}\n"
        )
        polished = enrich.parse_json(enrich.complete(build_editor_system(prof or {}), prompt, max_tokens=2000))
        if polished and polished.get("greeting") and polished.get("paragraphs"):
            polished.setdefault("closing", cover.get("closing", "Sincerely,"))
            return polished
    except Exception:
        pass
    return cover


def _prep_profile(prof: dict, include_oshal: bool) -> dict:
    """Return the career-DB dict to hand the LLM, gated on OSHAL opt-in. Never mutates
    the lru_cached `prof` (shallow-copies and only swaps top-level keys).

    OFF (default): strip `oss_portfolio` entirely (belt-and-suspenders, not just the
    prompt ban) so the personal open-source work cannot leak into a generated packet.
    ON: keep `oss_portfolio`, and drop the OSHAL-ban `framing_notes` so they don't
    contradict the allowance the system prompt now grants.
    """
    doc = dict(prof)
    if include_oshal:
        notes = doc.get("framing_notes") or []
        _ban = ("oshal", "open shell", "agentic", "a2a", "agent-orchestration", "agent orchestration")
        doc["framing_notes"] = [n for n in notes
                                if not any(b in str(n).lower() for b in _ban)]
    else:
        doc.pop("oss_portfolio", None)
    return doc


def generate_for(posting_id: int, include_oshal: bool = False) -> dict:
    """Generate a tailored resume + cover for one job, pulling from the (possibly
    enriched) career DB and tailoring to THIS posting. New experience the candidate
    wants reflected is added to the career DB first via profile.augment() — the
    posting, not free-text, drives what gets surfaced here.

    include_oshal=False (default): the personal open-source work (OSHAL) is excluded —
    standard, embargo-safe packet. include_oshal=True: adds an 'Open Source / Independent
    R&D' resume section and lets the cover reference the agentic work (opt-in only)."""
    if not enrich.provider():
        raise RuntimeError("No AI key set. Export ANTHROPIC_API_KEY or OPENAI_API_KEY first.")
    with db.connect() as conn:
        row = _job_row(conn, posting_id)
        if not row:
            raise ValueError(f"no posting id {posting_id}")
        if config.POSTGRES:
            _pg_park(conn)   # see below — without this the connection is killed mid-generation
        company, title = row["company"], row["title"]
        company_doc = _company_doc(company)   # tag-free name for the documents (folder keeps the tag)
        prof = profile.load()
        contact = prof.get("profile", {})
        # Gate the personal open-source (OSHAL) work on the opt-in flag, then pick the
        # matching system prompt (ban vs allow). OFF mode is byte-identical to before.
        prof_doc = _prep_profile(prof, include_oshal)
        prof_json = json.dumps(prof_doc, indent=1)[:120000]
        sys_prompt = build_system(prof, include_oshal)

        # Send the WHOLE (gated) career DB. The old [:14000] cap silently dropped ~70% of the
        # ~48k-char profile: the full role history, the metrics_bank, AND the anti-inflation
        # framing_notes — yet the prompt still ordered the model to render those roles, forcing
        # omission (gaps) or reconstruction from memory (fabrication). The full DB is ~13k
        # tokens; the generation model holds 200k+.
        prompt = PROMPT.format(
            profile=prof_json,
            company=company_doc, title=title, location=row["location"] or "n/a",
            description=(row["description"] or "(no description)")[:6000],
        )
        if include_oshal:
            prompt += _OSHAL_PROMPT_SUFFIX
        data = enrich.parse_json(enrich.complete(sys_prompt, prompt, max_tokens=8000))
        if not data or "resume" not in data:
            raise RuntimeError("AI did not return a usable resume/cover.")
        data = _sanitize(data)   # remove em/en dashes the model slipped in (reviewer "AI tell")
        # Second pass: a senior editor rewrites the COVER to a higher quality bar (specific,
        # JD-mapped, professional) WITHOUT adding facts. Falls back to the draft on any error.
        data["cover"] = _sanitize(_polish_cover(
            data["cover"], title, company_doc, row["description"], prof_json, prof))

        # Put the requisition number in the folder name when it's a clean id (referral/
        # manual rows store the real req #) so the packet ties back to the posting at a
        # glance; scraped rows keep the internal id. application.json records both.
        _req = str(row["ats_job_id"] or "")
        _tag = f"{_req}__" if _req.isdigit() else ""
        outdir = APP_DIR / f"{_slug(company)}__{_tag}{posting_id}"
        outdir.mkdir(parents=True, exist_ok=True)

        # Split experience for the 1-page compact: detailed (2011+) vs a one-line earlier-career.
        resume = data["resume"]
        _exp = resume.get("experience", []) or []
        recent = [e for e in _exp if _start_year(e.get("span")) >= 2011]
        earlier = [e for e in _exp if 0 < _start_year(e.get("span")) < 2011]
        if not recent:                       # year parse failed → fall back to first N as recent
            recent, earlier = _exp[:4], _exp[4:]

        ctx = {"contact": contact, "company": company_doc, "title": title,
               "job_url": row["url"], "today": _today()}
        renders = {
            "Resume_ATS": _env.get_template("resume.html").render(r=resume, **ctx),
            "Resume_Premium": _env.get_template("resume_premium.html").render(r=resume, **ctx),
            "Resume_1page": _env.get_template("resume_1page.html").render(r=resume, recent=recent, earlier=earlier, **ctx),
            "CoverLetter": _env.get_template("cover.html").render(c=data["cover"], **ctx),
        }
        paths = {}
        for name, html in renders.items():
            hp = outdir / f"{name}.html"
            pp = outdir / f"{name}.pdf"
            hp.write_text(html, encoding="utf-8")
            _render_pdf(hp, pp)
            paths[name] = pp

        (outdir / "application.json").write_text(
            json.dumps({"posting_id": posting_id, "req": row["ats_job_id"],
                        "company": company_doc, "title": title, "include_oshal": include_oshal,
                        "url": row["url"], "generated": data}, indent=2), encoding="utf-8")

        # NEVER downgrade an already-applied (or later) job back to 'generated' on regen, and NEVER
        # touch its applied_at — that would silently drop or rewrite the applied record. If it's
        # applied/later, keep status + applied_at exactly as-is and only refresh the PDF paths.
        _cur = conn.execute("SELECT status FROM postings WHERE id=?", (posting_id,)).fetchone()
        if _cur and (_cur["status"] or "") in ("applied", "interviewing", "interview", "offer", "rejected", "closed"):
            db.user_set(conn, posting_id, resume_path=str(paths["Resume_ATS"]),   # paths are per-user
                        cover_path=str(paths["CoverLetter"]))
        else:
            db.set_status(conn, posting_id, "generated",
                          resume_path=str(paths["Resume_ATS"]), cover_path=str(paths["CoverLetter"]))
        return {"dir": str(outdir), "resume_ats": str(paths["Resume_ATS"]),
                "resume_premium": str(paths["Resume_Premium"]),
                "resume_1page": str(paths["Resume_1page"]), "cover": str(paths["CoverLetter"])}


def rerender_packet(posting_id: int) -> str:
    """Re-render an existing packet's PDFs from its application.json — NO LLM call — applying
    the dash sanitizer and current templates. Preserves the already-written content; only
    re-renders. Returns the packet directory."""
    with db.connect() as conn:
        row = _job_row(conn, posting_id)
    if not row or not row["resume_path"]:
        raise ValueError(f"no generated packet for posting {posting_id}")
    outdir = Path(row["resume_path"]).parent
    data = json.loads((outdir / "application.json").read_text(encoding="utf-8"))
    gen = _sanitize(data.get("generated") or {})
    data["generated"] = gen
    resume = gen["resume"]
    contact = _sanitize(profile.load().get("profile", {}))
    _exp = resume.get("experience", []) or []
    recent = [e for e in _exp if _start_year(e.get("span")) >= 2011]
    earlier = [e for e in _exp if 0 < _start_year(e.get("span")) < 2011]
    if not recent:
        recent, earlier = _exp[:4], _exp[4:]
    ctx = {"contact": contact, "company": _company_doc(data.get("company")), "title": data.get("title"),
           "job_url": data.get("url"), "today": _today()}
    renders = {
        "Resume_ATS": _env.get_template("resume.html").render(r=resume, **ctx),
        "Resume_Premium": _env.get_template("resume_premium.html").render(r=resume, **ctx),
        "Resume_1page": _env.get_template("resume_1page.html").render(r=resume, recent=recent, earlier=earlier, **ctx),
        "CoverLetter": _env.get_template("cover.html").render(c=gen["cover"], **ctx),
    }
    for name, html in renders.items():
        (outdir / f"{name}.html").write_text(html, encoding="utf-8")
        _render_pdf(outdir / f"{name}.html", outdir / f"{name}.pdf")
    (outdir / "application.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    return str(outdir)


def _render_pdf(html_path: Path, pdf_path: Path) -> None:
    subprocess.run([sys.executable, "-m", "jobhunter.render", str(html_path), str(pdf_path)],
                   check=True, cwd=str(config.ROOT))


def _today() -> str:
    # career_db has no date dependency; use the OS date here (display only).
    import datetime
    return datetime.date.today().strftime("%B %d, %Y")
