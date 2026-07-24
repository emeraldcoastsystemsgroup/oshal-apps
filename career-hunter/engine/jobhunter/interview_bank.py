"""Centralized, tagged interview-question bank + per-posting matcher.

DESIGN (built for scale, not a flat file scanned per request):

  Storage — SQLite (jobs.db), three tables:
    interview_bank(id, category, question, good, red_flag, source_dim, qhash UNIQUE)
    interview_bank_tags(entry_id, dim, tag, UNIQUE(entry_id,dim,tag))
    posting_tags(posting_id, dim, tag, UNIQUE(posting_id,dim,tag))   -- write-through cache

  Indexing — the join key is (dim, tag) on BOTH tag tables, so matching a job is a
    single indexed set-intersection: O(matching rows), independent of bank size.
    Stays fast from 200 entries to 20,000+.

  Canonical vocabulary (the thing that makes matching actually work) — LLM-generated
    bank tags and posting-derived tags are BOTH resolved through TAGS + ALIASES to one
    vocabulary on the way in (k8s->kubernetes, oil & gas->oil_gas, il4->fedramp). Unknown
    tags are dropped, never silently mis-stored. Without this, the two sides never join.

  Dedup — qhash (normalized question text) collapses the same question emitted by
    multiple dimension agents into one row and MERGES their tags.

  Matching — weighted by dimension (industry 3 > technology 2 > position 1); universal
    ('*') entries included at low priority; domain_mustknow floated to the top.

Load:   python -m jobhunter.interview_bank --load data/interview_bank.json
Match:  python -m jobhunter.interview_bank <posting_id>
Backfill posting tags (batch): python -m jobhunter.interview_bank --backfill 5000
"""
from __future__ import annotations
import hashlib
import json
import re
import sys

from . import db, config

SCHEMA = """
CREATE TABLE IF NOT EXISTS interview_bank (
    id         INTEGER PRIMARY KEY,
    category   TEXT,
    question   TEXT NOT NULL,
    good       TEXT,
    red_flag   TEXT,
    source_dim TEXT,
    qhash      TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS interview_bank_tags (
    entry_id INTEGER NOT NULL REFERENCES interview_bank(id) ON DELETE CASCADE,
    dim      TEXT NOT NULL,
    tag      TEXT NOT NULL,
    UNIQUE(entry_id, dim, tag)
);
CREATE INDEX IF NOT EXISTS idx_ibtag       ON interview_bank_tags(dim, tag);
CREATE INDEX IF NOT EXISTS idx_ibtag_entry ON interview_bank_tags(entry_id);

CREATE TABLE IF NOT EXISTS posting_tags (
    posting_id INTEGER NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
    dim        TEXT NOT NULL,
    tag        TEXT NOT NULL,
    UNIQUE(posting_id, dim, tag)
);
CREATE INDEX IF NOT EXISTS idx_ptag      ON posting_tags(dim, tag);
CREATE INDEX IF NOT EXISTS idx_ptag_post ON posting_tags(posting_id);
"""

# ── canonical vocabulary (governance) ────────────────────────────────────────
TAGS = {
    "industry": {"oil_gas", "energy", "utilities", "federal", "defense", "govcon", "aerospace",
                 "fintech", "banking", "payments", "insurance", "healthcare", "pharma", "bigtech",
                 "saas", "retail", "manufacturing", "sap_erp"},
    "technology": {"sap", "s4hana", "basis", "btp", "devops", "cicd", "sre", "reliability",
                   "kubernetes", "containers", "cloud", "aws", "gcp", "azure", "ai", "agentic",
                   "mlops", "security", "compliance", "nist", "fedramp", "platform",
                   "test_automation", "observability"},
    "position": {"leadership", "director", "vp", "principal", "staff", "architect", "sre",
                 "program_manager", "engineering_manager", "solutions", "ic"},
}
# alias -> canonical (applied to BOTH bank tags and posting-derived tags)
ALIASES = {
    "oil & gas": "oil_gas", "oil and gas": "oil_gas", "o&g": "oil_gas", "petroleum": "oil_gas",
    "upstream": "oil_gas", "downstream": "oil_gas", "power": "energy", "utility": "utilities",
    "gov": "federal", "government": "federal", "public sector": "federal",
    "national security": "federal", "dod": "defense", "big tech": "bigtech", "big_tech": "bigtech",
    "faang": "bigtech", "financial": "fintech", "financial services": "fintech", "fin": "fintech",
    "bank": "banking", "payment": "payments", "health": "healthcare", "medical": "healthcare",
    "biotech": "pharma", "life sciences": "pharma", "erp": "sap_erp", "sap erp": "sap_erp",
    "k8s": "kubernetes", "container": "containers", "ci/cd": "cicd", "ci-cd": "cicd",
    "continuous integration": "cicd", "continuous delivery": "cicd", "site reliability": "sre",
    "site_reliability": "sre", "slo": "sre", "sli": "sre", "error budget": "sre",
    "machine learning": "ai", "ml": "ai", "llm": "ai", "genai": "ai", "aiops": "ai",
    "infosec": "security", "cyber": "security", "devsecops": "security", "fips": "compliance",
    "il4": "fedramp", "il5": "fedramp", "ato": "compliance", "iac": "cloud", "terraform": "cloud",
    "ansible": "cloud", "s/4hana": "s4hana", "hana": "sap", "netweaver": "sap", "abap": "sap",
    "test automation": "test_automation", "playwright": "test_automation",
    "prometheus": "observability", "grafana": "observability", "otel": "observability",
    "tpm": "program_manager", "technical program manager": "program_manager",
    "program management": "program_manager", "delivery manager": "program_manager",
    "vice president": "vp", "head of": "director", "chief": "vp",
    "eng manager": "engineering_manager", "engineering manager": "engineering_manager",
    "solution architect": "architect", "solutions architect": "architect",
    "solutions engineer": "solutions", "presales": "solutions", "sales engineer": "solutions",
}


def _norm(dim, raw):
    """Resolve a raw tag to the canonical vocabulary for its dimension, or None to drop."""
    t = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if t == "*":
        return "*"
    t = ALIASES.get(t, t)
    return t if t in TAGS.get(dim, ()) else None


# ── keyword maps emit CANONICAL tags directly (posting -> tags) ───────────────
# Matched with WORD BOUNDARIES (see _hits), so "ml" never hits "html" and "lead"
# never hits "leadership". Industry is scanned over company+sector+title ONLY (never
# the JD body, which carries benefits/boilerplate noise like "health benefits").
INDUSTRY_KW = {
    "oil_gas": ["oil", "gas", "petroleum", "refinery", "refining", "upstream", "downstream", "exxon", "chevron", "valero", "tesoro", "conocophillips", "halliburton", "schlumberger"],
    "energy": ["energy", "utility", "utilities", "power grid", "electric utility", "centerpoint", "duke energy", "xcel", "ge vernova"],
    "federal": ["federal", "government", "public sector", "wwps", "govcon", "sovereign cloud", "govcloud", "fedramp", "clearance", "ts/sci", "polygraph", "dod", "civilian agency", "national security"],
    "defense": ["defense", "defence", "warfare", "missile", "munitions", "combat", "military", "c4isr"],
    "aerospace": ["aerospace", "aviation", "satellite", "autonomy", "anduril", "lockheed", "boeing", "bae systems", "general atomics", "l3harris", "raytheon", "northrop"],
    "fintech": ["fintech", "bank", "banking", "payments", "trading", "financial services", "insurance", "lending", "brokerage", "pnc", "affirm", "sofi", "cboe", "truist", "capital one", "jpmorgan", "bancorp"],
    "healthcare": ["healthcare", "hospital", "clinical", "pharma", "pharmaceutical", "biotech", "medical device", "medtronic", "humana", "amgen", "merck", "life sciences", "therapeutics"],
    "bigtech": ["amazon", "google", "microsoft", "meta", "netflix", "gitlab", "mongodb", "okta", "databricks", "snowflake", "cisco", "ebay", "nvidia"],
    "saas": ["saas", "b2b software"],
    "sap_erp": ["sap", "s/4hana", "s4hana", "erp", "maxattention", "ariba", "fieldglass", "successfactors"],
    "manufacturing": ["manufacturing", "shop floor", "industrial", "mohawk", "baldor", "jabil"],
    "retail": ["retail", "ecommerce", "consumer goods", "marketplace", "home depot", "instacart", "monster beverage", "coca-cola"],
}
TECH_KW = {
    "sap": ["sap", "s/4hana", "s4hana", "hana", "basis", "netweaver", "abap", "btp", "ariba", "solution manager"],
    "devops": ["devops", "ci/cd", "cicd", "gitlab", "jenkins", "argocd", "argo cd", "jfrog", "harbor", "release management", "gitops"],
    "cicd": ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
    "sre": ["sre", "site reliability", "slo", "sli", "error budget", "mttr", "incident command", "on-call", "postmortem"],
    "kubernetes": ["kubernetes", "k8s", "docker", "containerization", "helm", "gardener", "openshift", "eks", "gke", "aks"],
    "cloud": ["cloud", "aws", "gcp", "google cloud", "azure", "govcloud", "terraform", "ansible", "infrastructure as code"],
    "ai": ["machine learning", "mlops", "aiops", "llm", "genai", "agentic", "artificial intelligence", "deep learning"],
    "security": ["devsecops", "vulnerability", "tenable", "nessus", "trivy", "fedramp", "fips", "il4", "zero trust", "hashicorp vault", "cybersecurity"],
    "compliance": ["compliance", "fedramp", "nist", "fips", "soc 2", "iso 27001", "ato", "authorization to operate"],
    "platform": ["platform engineering", "internal developer platform", "self-service", "test automation", "playwright"],
    "observability": ["observability", "prometheus", "grafana", "dynatrace", "datadog", "opentelemetry", "splunk"],
}
POSITION_KW = {  # scanned over the TITLE only
    "leadership": ["director", "vp", "vice president", "head of", "chief", "principal", "staff", "senior manager", "sr manager", "lead"],
    "director": ["director", "head of"],
    "vp": ["vp", "vice president", "chief"],
    "principal": ["principal"],
    "staff": ["staff"],
    "architect": ["architect"],
    "sre": ["site reliability", "sre", "reliability engineer"],
    "program_manager": ["program manager", "program management", "tpm", "technical program", "delivery manager"],
    "engineering_manager": ["engineering manager"],
    "solutions": ["solutions engineer", "solutions architect", "solution architect", "presales", "sales engineer"],
}


def ensure_schema(conn):
    conn.executescript(SCHEMA)


def _qhash(q):
    return hashlib.sha1(re.sub(r"\s+", " ", (q or "").strip().lower()).encode("utf-8")).hexdigest()


def load_entries(conn, entries, replace=True):
    """Load bank entries (normalize+dedup+merge tags). Returns (entries, tag_rows)."""
    ensure_schema(conn)
    if replace:
        conn.execute("DELETE FROM interview_bank_tags")
        conn.execute("DELETE FROM interview_bank")
    n_tags = 0
    for e in entries:
        q = e.get("question")
        if not q:
            continue
        qh = _qhash(q)
        conn.execute(
            "INSERT OR IGNORE INTO interview_bank (category, question, good, red_flag, source_dim, qhash) "
            "VALUES (?,?,?,?,?,?)",
            (e.get("category"), q, e.get("what_good_looks_like") or e.get("good"),
             e.get("red_flag_if") or e.get("red_flag"), e.get("source_dim") or e.get("dim"), qh),
        )
        eid = conn.execute("SELECT id FROM interview_bank WHERE qhash=?", (qh,)).fetchone()["id"]
        for dim, key in (("industry", "industries"), ("technology", "technologies"), ("position", "positions")):
            for raw in (e.get(key) or []):
                tag = _norm(dim, raw)
                if tag:
                    conn.execute("INSERT OR IGNORE INTO interview_bank_tags (entry_id, dim, tag) VALUES (?,?,?)",
                                 (eid, dim, tag))
                    n_tags += 1
    total = conn.execute("SELECT COUNT(*) c FROM interview_bank").fetchone()["c"]
    return total, n_tags


def load_file(path=None):
    path = path or str(config.ROOT / "data" / "interview_bank.json")
    data = json.load(open(path, encoding="utf-8"))
    entries = data.get("bank", data) if isinstance(data, dict) else data
    with db.connect() as conn:
        return load_entries(conn, entries)


def _hits(text, kw_map):
    """Word-boundary keyword match: 'ml' won't hit 'html', 'lead' won't hit 'leadership'."""
    text = (text or "").lower()
    out = []
    for tag, kws in kw_map.items():
        for k in kws:
            if re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", text):
                out.append(tag)
                break
    return out


def derive_tags(conn, posting_id, persist=True):
    """Derive a posting's canonical tags from existing data; write-through cache them.

    Scoped per dimension to keep mapping precise:
      industry   <- company.industry + company name + TITLE (never the noisy JD body)
      technology <- title + JD body (bounded)
      position   <- TITLE only
    """
    row = conn.execute(
        """SELECT p.title, p.description, c.name AS company, c.industry
           FROM postings p JOIN companies c ON c.id = p.company_id WHERE p.id = ?""",
        (posting_id,),
    ).fetchone()
    if not row:
        return None
    title = row["title"] or ""
    industry_text = " ".join(filter(None, [row["industry"], row["company"], title]))
    tech_text = title + " " + (row["description"] or "")[:2500]
    tags = {"industry": sorted(set(_hits(industry_text, INDUSTRY_KW))),
            "technology": sorted(set(_hits(tech_text, TECH_KW))),
            "position": sorted(set(_hits(title, POSITION_KW)))}
    if persist:
        conn.execute("DELETE FROM posting_tags WHERE posting_id=?", (posting_id,))
        for dim, vals in tags.items():
            for t in vals:
                conn.execute("INSERT OR IGNORE INTO posting_tags (posting_id, dim, tag) VALUES (?,?,?)",
                             (posting_id, dim, t))
    tags["title"] = row["title"]; tags["company"] = row["company"]
    return tags


def match(conn, posting_id, per_category=12, persist=True):
    """Indexed, dimension-weighted set-intersection. Returns tags + questions grouped by category.
    persist=False for read-only callers (e.g. dashboard page views) so a GET writes nothing."""
    t = derive_tags(conn, posting_id, persist=persist)
    if t is None:
        return None
    pairs = ([("industry", x) for x in t["industry"]]
             + [("technology", x) for x in t["technology"]]
             + [("position", x) for x in t["position"]])
    if not pairs:
        pairs = [("industry", "__none__")]  # only universal entries will match
    vals = ",".join(["(?,?)"] * len(pairs))
    args = [x for p in pairs for x in p]
    sql = f"""
        SELECT e.id, e.category, e.question, e.good, e.red_flag, e.source_dim,
               SUM(CASE WHEN t.tag='*' THEN 0
                        WHEN t.dim='industry' THEN 3
                        WHEN t.dim='technology' THEN 2
                        WHEN t.dim='position' THEN 1 ELSE 0 END) AS score
        FROM interview_bank e
        JOIN interview_bank_tags t ON t.entry_id = e.id
        WHERE (t.dim, t.tag) IN (VALUES {vals}) OR t.tag = '*'
        GROUP BY e.id
        ORDER BY (e.category = 'domain_mustknow') DESC, score DESC, e.id
    """
    grouped = {}
    for r in conn.execute(sql, args).fetchall():
        g = grouped.setdefault(r["category"], [])
        if len(g) < per_category:
            g.append(dict(r))
    return {"tags": t, "questions": grouped}


def backfill_posting_tags(conn, limit=2000, where="p.active=1 AND p.target_role=1"):
    """Pre-derive tags for many postings so batch matching is a pure indexed JOIN."""
    ensure_schema(conn)
    ids = [r["id"] for r in conn.execute(
        f"SELECT p.id FROM postings p WHERE {where} "
        f"AND NOT EXISTS (SELECT 1 FROM posting_tags pt WHERE pt.posting_id=p.id) LIMIT {int(limit)}"
    ).fetchall()]
    for pid in ids:
        derive_tags(conn, pid, persist=True)
    return len(ids)


def stats(conn):
    ensure_schema(conn)
    n = conn.execute("SELECT COUNT(*) c FROM interview_bank").fetchone()["c"]
    by = conn.execute("SELECT category, COUNT(*) c FROM interview_bank GROUP BY category ORDER BY c DESC").fetchall()
    return n, [(r["category"], r["c"]) for r in by]


def _print_match(posting_id):
    with db.connect() as conn:
        m = match(conn, posting_id)
    if not m:
        print(f"no posting {posting_id}"); return
    t = m["tags"]
    print(f"{t['company']} — {t['title']}")
    print(f"tags: industry={t['industry']} tech={t['technology']} position={t['position']}\n")
    for cat in ["domain_mustknow", "domain_knowledge", "technical", "system_design", "leadership", "behavioral"]:
        items = m["questions"].get(cat, [])
        if not items:
            continue
        print(f"== {cat.upper()} ({len(items)}) ==")
        for q in items:
            print(f"  - {q['question']}")
            if cat.startswith("domain") and q.get("red_flag"):
                print(f"      RED FLAG: {q['red_flag']}")
        print()


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "--load":
        e, tg = load_file(a[1] if len(a) > 1 else None)
        print(f"loaded {e} entries, {tg} tag links")
    elif a and a[0] == "--backfill":
        with db.connect() as conn:
            print(f"backfilled {backfill_posting_tags(conn, int(a[1]) if len(a) > 1 else 2000)} postings")
    elif a and a[0].isdigit():
        _print_match(int(a[0]))
    else:
        with db.connect() as conn:
            n, by = stats(conn)
        print(f"bank: {n} entries — {by}")
        print("usage: --load <json> | --backfill <n> | <posting_id>")
