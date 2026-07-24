"""Career-gap intelligence — the engine behind the 'Strengthen Your Background' tab.

The AI fit scorer writes a JSON array of gap/risk strings on every posting
(postings.ai_fit_gaps). Across ~20k in-lane jobs that's ~128k raw strings — far
too many to read one by one. We bucket them into a curated set of THEMES with a
keyword taxonomy (instant, free, deterministic), so the dashboard can say
"this gap costs you N target jobs" and the user can answer it ONCE.

His answer is merged into career_db.json via profile.augment() — which the resume
writer (generate.generate_for) already pulls from. So closing a gap here flows
straight into every future tailored resume; the resume writer decides per-job
which of the now-richer material to surface.

Taxonomy lives in code (THEMES). Per-theme stats + the user's answers live in the
gap_themes table; scan() refreshes the stats without ever clobbering an answer.
"""
from __future__ import annotations
import json
import re

from . import db


# Each theme groups many raw gap strings. addressable=True means a real story can
# close it (push it into the answer queue). addressable=False = a hard/structural
# requirement (clearance tier, citizenship, formal degree) a story can't fix — we
# still surface it so the user and the resume writer can see it, but never queue it.
# `pats` are matched against a space-normalized gap string (see _norm), so a bare
# token like " aws " only matches the whole word.
THEMES = [
    # ── Cloud & platform ─────────────────────────────────────────────────────
    {"key": "k8s", "title": "Kubernetes / container orchestration", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" kubernetes ", " k8s ", " openshift ", " eks ", " gke ", " aks ", " gardener "],
     "desc": "Jobs want hands-on Kubernetes / orchestration and don't see it on the resume yet.",
     "prompt": "Where have you designed or run Kubernetes (or a flavor of it) in production? "
               "Reminder: OSHAL ran fully containerized on Gardener — Kubernetes on AWS GovCloud. "
               "Name the cluster flavor, scale, and what you owned."},
    {"key": "microservices", "title": "Microservices design & implementation", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" microservice ", " microservices ", " service mesh ", " distributed systems "],
     "desc": "Roles ask for designing/building microservice architectures.",
     "prompt": "Describe a system you architected as microservices — what you split, why, and the "
               "outcome. (e.g. the OSHAL platform: a custom, fully microservice-based platform you "
               "designed and implemented, rolling up your sleeves as a program director to close a "
               "technical gap on the team.)"},
    {"key": "iac", "title": "Infrastructure-as-Code (Terraform / Ansible)", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" terraform ", " ansible ", " pulumi ", " cloudformation ", " infrastructure as code ", " iac "],
     "desc": "Postings expect IaC tooling (Terraform/Ansible/etc.) delivered at scale.",
     "prompt": "What infrastructure have you defined as code, with which tool, and how did it change "
               "provisioning speed or consistency?"},
    {"key": "aws", "title": "AWS production operations", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" aws ", " amazon web services ", " ec2 ", " s3 ", " lambda "],
     "desc": "Jobs want native AWS operations; your background may read as another cloud or platform.",
     "prompt": "Where have you run real workloads on AWS (incl. GovCloud)? Name the services and "
               "what you were accountable for."},
    {"key": "multicloud", "title": "Azure / GCP", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" azure ", " gcp ", " google cloud "],
     "desc": "Postings name Azure or GCP specifically.",
     "prompt": "Any hands-on Azure or GCP exposure — even hybrid or migration work? Describe scope."},
    {"key": "containers", "title": "Docker / containerization", "cat": "Cloud & Platform",
     "addressable": True,
     "pats": [" docker ", " containerization ", " containerized ", " containers ", " podman "],
     "desc": "Roles assume containerization fluency.",
     "prompt": "What have you containerized, and how did it ship to production?"},

    # ── Reliability & operations ─────────────────────────────────────────────
    {"key": "sre", "title": "SRE practice (SLOs / SLIs / error budgets)", "cat": "Reliability & Ops",
     "addressable": True,
     "pats": [" sre ", " site reliability ", " slo ", " slos ", " sli ", " slis ",
              " error budget ", " error budgets "],
     "desc": "Formal SRE discipline (SLOs/SLIs/error budgets) isn't explicit on the resume.",
     "prompt": "Where have you stood up or run SRE practice — SLOs, error budgets, reliability "
               "targets? Reminder: you were Program Manager for the CTO organization establishing "
               "SRE and DevOps. What did you put in place and what improved?"},
    {"key": "observability", "title": "Observability & monitoring", "cat": "Reliability & Ops",
     "addressable": True,
     "pats": [" observability ", " prometheus ", " grafana ", " datadog ", " opentelemetry ",
              " monitoring ", " splunk "],
     "desc": "Jobs expect observability tooling (Prometheus/Grafana/Datadog/etc.).",
     "prompt": "What monitoring/observability stack have you implemented or owned, and what did it "
               "let the team catch or prevent?"},
    {"key": "cicd", "title": "CI/CD & DevOps automation", "cat": "Reliability & Ops",
     "addressable": True,
     "pats": [" ci cd ", " cicd ", " jenkins ", " github actions ", " gitlab ", " devops ",
              " continuous delivery ", " continuous integration "],
     "desc": "Roles want demonstrated CI/CD pipeline ownership.",
     "prompt": "Describe a CI/CD pipeline you built or modernized — tools, what it automated, and "
               "the speed/quality gain."},
    {"key": "oncall", "title": "On-call / production support", "cat": "Reliability & Ops",
     "addressable": True,
     "pats": [" on call ", " oncall ", " incident response ", " pagerduty "],
     "desc": "Recent leadership roles don't show on-call / incident ownership.",
     "prompt": "When have you owned on-call or led incident response? Describe the rotation, "
               "severity, and your role in the bridge."},

    # ── Engineering & data ───────────────────────────────────────────────────
    {"key": "python", "title": "Python engineering", "cat": "Engineering & Data",
     "addressable": True, "pats": [" python "],
     "desc": "Postings list Python as a core skill.",
     "prompt": "What have you actually built in Python — automation, services, tooling? Be concrete."},
    {"key": "java", "title": "Java / JVM", "cat": "Engineering & Data",
     "addressable": True, "pats": [" java ", " spring boot ", " jvm "],
     "desc": "Roles call for Java/JVM experience.",
     "prompt": "Any Java / Spring work you can point to? Describe the project and your part."},
    {"key": "golang", "title": "Go / Golang", "cat": "Engineering & Data",
     "addressable": True,
     "pats": [" golang ", " go lang ", " go programming ", " go language ", " go developer "],
     "desc": "Postings name Go specifically.",
     "prompt": "Any Go experience — services, CLIs, tooling? Describe it."},
    {"key": "ml", "title": "Machine learning / data science", "cat": "Engineering & Data",
     "addressable": True,
     "pats": [" machine learning ", " ml ", " mlops ", " data science ", " model training ",
              " deep learning "],
     "desc": "Roles want ML / data-science depth.",
     "prompt": "Where have you applied ML or MLOps — even model deployment/ops vs. research? "
               "Describe the use case and the result."},
    {"key": "ai_llm", "title": "AI / LLM / agentic systems", "cat": "Engineering & Data",
     "addressable": True,
     "pats": [" ai ", " llm ", " llms ", " genai ", " generative ", " agentic ", " agents ",
              " rag ", " prompt engineering "],
     "desc": "AI/LLM/agentic experience the role wants and the resume may under-surface.",
     "prompt": "Describe your AI/agentic work. Reminder: your pioneering AI/agentic automation "
               "initiative (OSHAL) — what it does, the harnesses/agents, and any speed/cost gains. "
               "(Frame as a proprietary accelerator / open-source beta, not a finished product.)"},
    {"key": "data_eng", "title": "Data engineering (SQL / Kafka / pipelines)", "cat": "Engineering & Data",
     "addressable": True,
     "pats": [" data engineering ", " kafka ", " spark ", " etl ", " sql ", " data pipeline ",
              " data pipelines ", " snowflake ", " databricks "],
     "desc": "Postings expect data-pipeline / SQL engineering.",
     "prompt": "What data pipelines or SQL-heavy systems have you built or run? Name the tools and scale."},
    {"key": "ea", "title": "Enterprise architecture frameworks", "cat": "Engineering & Data",
     "addressable": True,
     "pats": [" togaf ", " enterprise architecture ", " zachman ", " dodaf ", " uaf ", " sysml ",
              " mbse ", " archimate "],
     "desc": "Roles want formal EA frameworks (TOGAF/DoDAF/MBSE/etc.).",
     "prompt": "Where have you done enterprise / solution architecture against a framework, or "
               "owned current-state→future-state transition design? Describe the engagement."},

    # ── Leadership & business ────────────────────────────────────────────────
    {"key": "people_lead", "title": "Large-team / people leadership", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" team of ", " people management ", " direct reports ", " people leadership ",
              " managing teams ", " large teams ", " org of ", " managed a team "],
     "desc": "Senior roles want proof of leading sizable teams.",
     "prompt": "Give your strongest examples of leading large teams. Reminders: you led 20+ on the "
               "Tesoro first S/4 implementation, and were Program Manager over the CTO organization "
               "establishing SRE/DevOps. Name team size, scope, and outcome for each."},
    {"key": "pnl", "title": "P&L / budget ownership", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" p l ", " p and l ", " profit and loss ", " budget ", " revenue ", " cost center ", " p&l "],
     "desc": "Executive roles expect P&L / budget accountability.",
     "prompt": "Where have you owned a budget, P&L, or revenue number? (e.g. ~$75M presales.) "
               "State the figure and what you were accountable for."},
    {"key": "product", "title": "Product management", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" product management ", " product manager ", " roadmap ", " product owner ",
              " product strategy "],
     "desc": "Roles want product-management / roadmap ownership.",
     "prompt": "Where have you owned a product roadmap, prioritization, or product strategy? Describe it."},
    {"key": "vendor", "title": "Vendor & stakeholder management", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" vendor ", " stakeholder management ", " procurement ", " supplier "],
     "desc": "Roles want vendor / executive-stakeholder management.",
     "prompt": "Describe managing major vendors or executive stakeholders — contracts, escalations, "
               "or governance you ran."},
    {"key": "platforms", "title": "ServiceNow / Salesforce / Oracle", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" servicenow ", " salesforce ", " oracle ", " workday "],
     "desc": "Postings name a specific enterprise platform.",
     "prompt": "Any hands-on or program ownership of ServiceNow / Salesforce / Oracle? Describe scope."},
    {"key": "startup", "title": "Startup / high-growth environment", "cat": "Leadership & Business",
     "addressable": True,
     "pats": [" startup ", " scale up ", " high growth ", " 0 to 1 ", " early stage ", " founding "],
     "desc": "Roles want startup / 0-to-1 / high-growth experience.",
     "prompt": "Where have you built something 0-to-1 or operated in a high-growth / scrappy setting? "
               "(Building ECSG and OSHAL counts.) Describe it."},

    # ── Domains ──────────────────────────────────────────────────────────────
    {"key": "healthcare", "title": "Healthcare / clinical domain", "cat": "Domain",
     "addressable": True,
     "pats": [" healthcare ", " clinical ", " health system ", " ehr ", " hl7 ", " fhir "],
     "desc": "Healthcare roles want clinical/health-system domain context.",
     "prompt": "Any healthcare or regulated-clinical exposure? If none, note it so the resume writer "
               "leans on transferable regulated-environment work (e.g. gov/defense) instead."},
    {"key": "fintech", "title": "Fintech / financial-services domain", "cat": "Domain",
     "addressable": True,
     "pats": [" fintech ", " financial services ", " banking ", " payments ", " trading "],
     "desc": "Fintech roles want financial-services domain context.",
     "prompt": "Any financial-services / fintech domain work? Describe it, or note the gap so the "
               "writer substitutes transferable regulated-industry experience."},
    {"key": "security_eng", "title": "Security engineering / cyber", "cat": "Domain",
     "addressable": True,
     "pats": [" cybersecurity ", " cyber ", " appsec ", " application security ", " vulnerability ",
              " penetration ", " security engineer ", " zero trust "],
     "desc": "Roles want hands-on security engineering / cyber depth.",
     "prompt": "Where have you owned security engineering — secure DevOps, hardening, zero-trust, "
               "vuln management? Reminder: secure DevOps cloud leadership is one of your "
               "differentiators. Describe specifics."},
    {"key": "compliance", "title": "Compliance (FedRAMP / HIPAA / SOC 2 / NIST)", "cat": "Domain",
     "addressable": True,
     "pats": [" fedramp ", " hipaa ", " soc 2 ", " soc2 ", " nist ", " compliance ", " fisma ",
              " ato ", " rmf "],
     "desc": "Roles want demonstrated compliance / authorization work.",
     "prompt": "What compliance regimes have you delivered against — FedRAMP, NIST/RMF, ATO, SOC 2, "
               "HIPAA? Describe your role in achieving or maintaining authorization."},

    # ── Structural (shown, never queued — a story can't close these) ─────────
    {"key": "clearance_high", "title": "Higher clearance (TS/SCI, polygraph)", "cat": "Structural",
     "addressable": False,
     "pats": [" ts sci ", " ts/sci ", " top secret ", " polygraph ", " sci ", " ci poly ", " full scope "],
     "desc": "Jobs require a higher clearance than Secret. Structural — track it; not a story to write.",
     "prompt": ""},
    {"key": "citizenship", "title": "Citizenship requirement", "cat": "Structural",
     "addressable": False,
     "pats": [" citizen ", " citizenship ", " green card ", " work authorization "],
     "desc": "Postings with a citizenship/authorization requirement (often a foreign citizenship). "
             "Structural — usually just a filter.",
     "prompt": ""},
    {"key": "degree", "title": "Formal degree (Master's / PhD)", "cat": "Structural",
     "addressable": False,
     "pats": [" phd ", " master ", " masters ", " master's ", " bachelor ", " bachelors ", " degree "],
     "desc": "Roles asking for a specific degree level. Structural — track it; can't be storied away.",
     "prompt": ""},
]

_BY_KEY = {t["key"]: t for t in THEMES}


def _norm(s: str) -> str:
    """Lowercase, collapse every run of non-alphanumerics to a single space, and
    pad with spaces — so a pattern like ' aws ' matches the whole word only."""
    return " " + re.sub(r"[^a-z0-9]+", " ", s.lower()).strip() + " "


def _themes_of(norm_gap: str) -> set[str]:
    hits = set()
    for t in THEMES:
        for p in t["pats"]:
            if p in norm_gap:
                hits.add(t["key"])
                break
    return hits


def ensure_table(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS gap_themes (
               key         TEXT PRIMARY KEY,
               n_jobs      INTEGER DEFAULT 0,   -- distinct target jobs raising this theme
               avg_fit     INTEGER DEFAULT 0,   -- avg ai_fit_score of those jobs
               sample_gaps TEXT,                -- json: a few raw gap strings (evidence)
               status      TEXT DEFAULT 'open', -- open | answered | skipped
               response    TEXT,                -- the user's example, in their words
               answered_at TEXT,
               updated_at  TEXT
           )""")


def _gap_postings_count(conn) -> int:
    return conn.execute(
        "SELECT COUNT(*) n FROM postings WHERE active=1 AND target_role=1 "
        "AND ai_fit_gaps IS NOT NULL AND ai_fit_gaps != '[]'").fetchone()["n"]


def scan() -> int:
    """Recompute per-theme stats from every in-lane posting's gaps and upsert them,
    PRESERVING any answer/status already stored. Returns the number of jobs scanned."""
    with db.connect() as conn:
        ensure_table(conn)
        rows = conn.execute(
            "SELECT ai_fit_score, ai_fit_gaps FROM postings WHERE active=1 AND target_role=1 "
            "AND ai_fit_gaps IS NOT NULL AND ai_fit_gaps != '[]'").fetchall()
    n_jobs: dict[str, int] = {}
    fit_sum: dict[str, int] = {}
    samples: dict[str, list[str]] = {}
    scanned = 0
    for r in rows:
        try:
            gaps = json.loads(r["ai_fit_gaps"])
        except Exception:
            continue
        if not gaps:
            continue
        scanned += 1
        fit = r["ai_fit_score"] or 0
        job_themes: set[str] = set()
        for g in gaps:
            if not isinstance(g, str) or not g.strip():
                continue
            for key in _themes_of(_norm(g)):
                job_themes.add(key)
                bucket = samples.setdefault(key, [])
                clean = g.strip()
                if len(bucket) < 6 and clean not in bucket:
                    bucket.append(clean)
        for key in job_themes:
            n_jobs[key] = n_jobs.get(key, 0) + 1
            fit_sum[key] = fit_sum.get(key, 0) + fit
    with db.connect() as conn:
        ensure_table(conn)
        for t in THEMES:
            k = t["key"]
            nj = n_jobs.get(k, 0)
            avg = int(fit_sum.get(k, 0) / nj) if nj else 0
            conn.execute(
                """INSERT INTO gap_themes (key, n_jobs, avg_fit, sample_gaps, updated_at)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(key) DO UPDATE SET
                     n_jobs=excluded.n_jobs, avg_fit=excluded.avg_fit,
                     sample_gaps=excluded.sample_gaps, updated_at=excluded.updated_at""",
                (k, nj, avg, json.dumps(samples.get(k, [])), db.now()))
    return scanned


def is_scanned() -> bool:
    with db.connect() as conn:
        ensure_table(conn)
        return bool(conn.execute("SELECT COUNT(*) n FROM gap_themes").fetchone()["n"])


def themes_with_stats() -> tuple[list[dict], int]:
    """Merge the code taxonomy with stored stats/answers, sorted by impact (n_jobs)."""
    with db.connect() as conn:
        ensure_table(conn)
        stored = {r["key"]: r for r in conn.execute("SELECT * FROM gap_themes").fetchall()}
        total = _gap_postings_count(conn)
    out = []
    for t in THEMES:
        r = stored.get(t["key"])
        nj = r["n_jobs"] if r else 0
        out.append({
            **t,
            "n_jobs": nj,
            "avg_fit": (r["avg_fit"] if r else 0),
            "pct": round(100.0 * nj / total, 1) if total else 0.0,
            "samples": (json.loads(r["sample_gaps"]) if (r and r["sample_gaps"]) else []),
            "status": (r["status"] if r else "open"),
            "response": (r["response"] if r else ""),
            "answered_at": (r["answered_at"] if r else None),
        })
    out.sort(key=lambda x: -x["n_jobs"])
    return out, total


def next_open_key(themes: list[dict] | None = None) -> str | None:
    """Highest-impact addressable theme still 'open' (themes come pre-sorted by n_jobs)."""
    if themes is None:
        themes, _ = themes_with_stats()
    for t in themes:
        if t["addressable"] and t["status"] == "open" and t["n_jobs"] > 0:
            return t["key"]
    return None


def save_answer(key: str, response: str) -> None:
    if key not in _BY_KEY:
        return
    with db.connect() as conn:
        ensure_table(conn)
        conn.execute(
            """INSERT INTO gap_themes (key, response, status, answered_at, updated_at)
               VALUES (?,?, 'answered', ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 response=excluded.response, status='answered',
                 answered_at=excluded.answered_at, updated_at=excluded.updated_at""",
            (key, response, db.now(), db.now()))


def set_status(key: str, status: str) -> None:
    if key not in _BY_KEY or status not in ("open", "answered", "skipped"):
        return
    with db.connect() as conn:
        ensure_table(conn)
        conn.execute(
            """INSERT INTO gap_themes (key, status, updated_at) VALUES (?,?,?)
               ON CONFLICT(key) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at""",
            (key, status, db.now()))


def title_of(key: str) -> str:
    t = _BY_KEY.get(key)
    return t["title"] if t else key
