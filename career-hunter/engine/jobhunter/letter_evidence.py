# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c#"): which of the person's recorded roles and engagements a cover letter draws on. Every role, every selected Other experience entry and every recorded engagement is ranked by how much of the posting it speaks to and how recent it is, so a first development job is chosen only when it fits the job far better than recent work. The prompt lists the chosen set and claims_check holds the letter to it.
"""The roles and engagements a cover letter draws on: ranked by relevance to the posting and by recency.

The model writes the letter; this module decides which recorded work it may cite. relevance() scores each entry by the
posting's words it shares (the title counts three times, words every entry shares count little); recency() weighs it by
how long ago it ended. A role held now weighs 1.0, one that ended six years ago 0.5, a first job of twenty-five years
ago under 0.2. The prompt lists the top LETTER_ROLES entries by relevance times recency as the letter's evidence;
claims_check also lets a letter cite other work that ended within RECENT_YEARS and fits the posting, never an older
role outside that list.
"""
from __future__ import annotations

import datetime
import math
import re

from . import role_plan

LETTER_ROLES = 5                 # entries the prompt lists as the letter's evidence, best first
RECENT_YEARS = 10                # other work that ended within this many years and fits the posting may also be cited
UNDATED_RECENCY = 0.5            # an engagement with no dates and no job: neither recent nor old
RECENCY_HALF_YEARS = 6.0         # an entry that ended this many years ago weighs half a current one
RECENCY_FLOOR = 0.35             # how much an old but relevant entry keeps: score = relevance x (floor + rest x recency)
MIN_RELEVANCE = 0.12             # below this share of the best entry's relevance an entry is not chosen
TITLE_WEIGHT = 2.0
_SENIORITY = frozenset({"senior", "junior", "lead", "principal", "staff", "chief", "head", "contract", "contractor",
                        "intern", "associate", "level", "iii"})

# Spellings folded to one token before matching, so C#, .NET and Node.js survive tokenizing.
_CANON = (
    (r"(?<![a-z0-9])c\s*#|\bc-sharp\b|\bc sharp\b", " csharp "), (r"(?<![a-z0-9])c\+\+", " cplusplus "),
    (r"(?<![a-z0-9])f#", " fsharp "),
    (r"asp\.net", " aspnet dotnet "), (r"vb\.net", " vbnet dotnet "), (r"(?<![a-z0-9])\.net\b", " dotnet "),
    (r"\bnode\.?js\b", " nodejs "), (r"\bvue\.?js\b", " vuejs "), (r"\breact\.?js\b", " react "),
    (r"\bnext\.?js\b", " nextjs "), (r"\bci\s*/\s*cd\b", " cicd "), (r"\bpower\s+bi\b", " powerbi "),
    (r"\bsql\s+server\b", " sqlserver "), (r"\bgoogle\s+cloud(?:\s+platform)?\b", " gcp "),
    (r"\bamazon\s+web\s+services\b", " aws "), (r"\bmachine\s+learning\b", " ml "),
    (r"\bdeep\s+learning\b", " deeplearning "), (r"\bt-sql\b", " tsql "), (r"\bpl/sql\b", " plsql "),
    (r"\bk8s\b", " kubernetes "), (r"\bpostgres\b", " postgresql "), (r"\bgithub\s+actions\b", " githubactions "),
    (r"\bazure\s+devops\b", " azuredevops "), (r"\bsix\s+sigma\b", " sixsigma "), (r"\bobjective-c\b", " objectivec "),
    (r"\bsecurity\+", " securityplus "), (r"\bnetwork\+", " networkplus "), (r"(?<![a-z0-9])a\+", " aplus "),
    (r"\bcontinuous\s+(?:integration|delivery|deployment)(?:\s*(?:/|and)\s*continuous\s+(?:integration|delivery|deployment))?\b", " cicd "),
    (r"\bartificial\s+intelligence\b", " ai "), (r"\bsite\s+reliability\s+engineering\b", " sre "),
    (r"\bnatural\s+language\s+processing\b", " nlp "), (r"\blarge\s+language\s+models?\b", " llm "),
    (r"\bretrieval[-\s]+augmented\s+generation\b", " rag "), (r"\binternet\s+of\s+things\b", " iot "),
    (r"\bbusiness\s+intelligence\b", " bi "),
)
_CANON_RE = [(re.compile(pattern, re.I), repl) for pattern, repl in _CANON]

# How a folded tool is written for a reader (the prompt's matched words, the person's notices).
DISPLAY = {"csharp": "C#", "cplusplus": "C++", "fsharp": "F#", "dotnet": ".NET", "aspnet": "ASP.NET", "vbnet": "VB.NET",
            "nodejs": "Node.js", "vuejs": "Vue.js", "nextjs": "Next.js", "cicd": "CI/CD", "powerbi": "Power BI",
            "sqlserver": "SQL Server", "tsql": "T-SQL", "plsql": "PL/SQL", "postgresql": "PostgreSQL", "gcp": "Google Cloud",
            "ml": "machine learning", "deeplearning": "deep learning", "githubactions": "GitHub Actions",
            "azuredevops": "Azure DevOps", "sixsigma": "Six Sigma", "objectivec": "Objective-C", "securityplus": "Security+",
            "networkplus": "Network+", "aplus": "A+"}
STOP = frozenset("""a about above across after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each either else ever every few for from further
had has have having he her here hers him his how i if in into is it its itself just me more most my myself no nor not now
of off on once only or other our ours out over own per same she should so some such than that the their theirs them then
there these they this those through to too under until up us very via was we were what when where which while who whom
why will with within without would you your yours ability able across additional apply applicants candidate candidates
company could day days duties environment equal etc excellent experience experienced experiences including include
includes job jobs knowledge looking must new opportunity opportunities plus position preferred qualification
qualifications required requirement requirements responsibilities responsible role roles salary skill skills strong
successful support team teams time understanding using well work working year years benefits employer employment status
please related relevant degree bachelor bachelors master masters minimum least demonstrated proven ensure provide
provides providing across based level levels""".split())
_SHORT = frozenset({"ai", "ml", "qa", "ui", "ux", "bi", "go", "vr", "ar", "rf", "os", "vm", "5g", "c", "r"})


def canon(text) -> str:
    """
    @description Lower-case text with the spellings tools are written in folded to one token each (C# -> csharp,
    .NET -> dotnet, Node.js -> nodejs, SQL Server -> sqlserver), so a posting and a record that name the same tool match.
    @param text - Any text. @returns The folded text.
    """
    value = str(text or "").lower()
    for pattern, repl in _CANON_RE:
        value = pattern.sub(repl, value)
    return value


def tokens(text) -> list:
    """@description The comparable words of a text: folded, split, stop words and one-letter words dropped.
    @param text - Any text. @returns The words in order."""
    found = re.findall(r"[a-z0-9]+", canon(text))
    return [word for word in found if word not in STOP and (len(word) > 2 or word in _SHORT) and not word.isdigit()]


def _flat(value) -> str:
    """Every text in a value, one per line (a bullet, a skill or a story stays its own line)."""
    if isinstance(value, dict):
        return "\n".join(_flat(item) for item in value.values())
    if isinstance(value, list):
        return "\n".join(_flat(item) for item in value)
    return str(value or "")


def _role_text(role: dict) -> str:
    stories = [f"{s.get('title') or ''}\n{s.get('bullet') or ''}\n{s.get('story') or ''}"
               for s in role.get("stories") or [] if isinstance(s, dict)]
    return "\n".join([str(role.get("title") or ""), _flat(role.get("deliverables")), _flat(role.get("skills")), *stories])


def _engagement_rows(prof: dict) -> list:
    """The person's recorded client engagements, the main résumé's project_ledger, as (place, entry): an entry is
    {project, role, industry, duration_months, tech[], public} and, once written on Work history (1.68.4), start and
    end (YYYY or YYYY-MM), bullets[] and job (the id of the job it was done under); one saved as plain text is its
    client's name. The place is its position in the ledger, as Work history numbers it."""
    rows = (prof or {}).get("project_ledger")
    if not isinstance(rows, list):
        return []
    return [(index, row if isinstance(row, dict) else {"project": row.strip()}) for index, row in enumerate(rows)
            if isinstance(row, dict) or (isinstance(row, str) and row.strip())]


def _after_months(start, months) -> str:
    """The month (YYYY-MM) an engagement that began at `start` and lasted `months` ended in; its start month when no
    length is recorded."""
    begun = role_plan.month(start)
    if not begun:
        return str(start or "")
    count = int(round(months)) if isinstance(months, (int, float)) and not isinstance(months, bool) and months > 0 else 0
    total = begun[0] * 12 + begun[1] - 1 + count
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _engagement_dates(row: dict, roles: list) -> tuple:
    """(start, end, current, dated) of one engagement: its own months (a start with no end ends after its recorded
    length, else in its start month), else those of the job it was done under (`job`, a role's id), else those of the
    newest job whose record names its client, else undated. Current only under a current job or an end that says
    Present; an unknown end is not one."""
    start, end = str(row.get("start") or "").strip(), str(row.get("end") or "").strip()
    if start or end:
        end = end or _after_months(start, row.get("duration_months"))
        return start or end, end, bool(role_plan._SAYS_CURRENT.search(end)), True
    name = str(row.get("project") or "").strip()
    placed = [role for role in roles if row.get("job") and str(role.get("id")) == str(row.get("job"))]
    named = [] if placed or len(name) < 3 else [
        role for role in roles if re.search(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", _role_text(role), re.I)]
    for role in placed or sorted(named, key=lambda r: role_plan.month(r.get("end"), last=True) or (9999, 12), reverse=True)[:1]:
        return role.get("start"), role.get("end"), role_plan.is_current(role), True
    return None, None, False, False


def entries(prof: dict, selected=()) -> list:
    """
    @description Every piece of recorded work a letter may draw on, keyed the way the prompt and the check name it:
    R<n> for the n-th role of the main résumé (the key role_plan uses), E<n> for the n-th entry of its project_ledger
    (the n-th client engagement on Work history), A<n> for the n-th Other experience entry selected for this
    application. An entry the person marked not public (public: false) is kept with public False.
    @param prof - The loaded career profile. @param selected - The selected Other experience entries.
    @returns [{key, title, org, start, end, current, public, text}] (an engagement also carries undated).
    """
    found = []
    for index, role in enumerate((prof or {}).get("roles") or []):
        if isinstance(role, dict) and (str(role.get("title") or "").strip() or str(role.get("org") or "").strip()):
            found.append({"key": f"R{index + 1}", "title": str(role.get("title") or "").strip(),
                          "org": str(role.get("org") or "").strip(), "start": role.get("start"), "end": role.get("end"),
                          "current": role_plan.is_current(role), "public": role.get("public") is not False, "text": _role_text(role)})
    roles = [role for role in (prof or {}).get("roles") or [] if isinstance(role, dict)]
    for index, row in _engagement_rows(prof):
        start, end, current, dated = _engagement_dates(row, roles)
        found.append({"key": f"E{index + 1}", "title": str(row.get("role") or "").strip(), "org": str(row.get("project") or "").strip(),
                      "start": start, "end": end, "current": current, "undated": not dated, "public": row.get("public") is not False,
                      "text": "\n".join([str(row.get("role") or ""), str(row.get("project") or ""), str(row.get("industry") or ""),
                                         _flat(row.get("bullets")), _flat(row.get("tech"))])})
    for index, item in enumerate(selected or []):
        if isinstance(item, dict):
            found.append({"key": f"A{index + 1}", "title": str(item.get("title") or "").strip(),
                          "org": str(item.get("organization") or "").strip(), "start": item.get("period"),
                          "end": item.get("period"), "current": bool(re.search(r"present|current|now", str(item.get("period") or ""), re.I)),
                          "public": True,
                          "text": "\n".join([str(item.get("title") or ""), str(item.get("facts") or ""), _flat(item.get("skills"))])})
    return found


def _posting_weights(title: str, description: str) -> dict:
    weights = {}
    for word in tokens(description):
        weights[word] = weights.get(word, 0.0) + 1.0
    weights = {word: 1.0 + math.log(count) for word, count in weights.items()}
    for word in tokens(title):
        if word not in _SENIORITY:
            weights[word] = weights.get(word, 1.0) + TITLE_WEIGHT
    return weights


def recency(entry: dict, today: datetime.date | None = None) -> float:
    """
    @description How recent an entry is, 1.0 for work held now and 1/(1 + years/RECENCY_HALF_YEARS) for work that
    ended years ago; an engagement with no dates and no job counts as UNDATED_RECENCY, any other undatable entry as
    twenty years old.
    @param entry - One entries() row. @param today - The date measured from. @returns 0..1.
    """
    if entry.get("current"):
        return 1.0
    if entry.get("undated"):
        return UNDATED_RECENCY
    now = today or datetime.date.today()
    ended = role_plan.month(entry.get("end"), last=True) or role_plan.month(entry.get("start"), last=True)
    years = 20.0 if not ended else max(0.0, (now.year - ended[0]) + (now.month - ended[1]) / 12.0)
    return 1.0 / (1.0 + years / RECENCY_HALF_YEARS)


def rank(prof: dict, title: str, description: str, selected=(), today: datetime.date | None = None) -> list:
    """
    @description Every entry ranked for this posting: relevance (the posting's weighted words the entry shares, words
    every entry shares counting least, scaled so the best entry is 1.0) times recency (with RECENCY_FLOOR kept by old
    work). `chosen` marks the top LETTER_ROLES entries whose relevance reaches MIN_RELEVANCE, never one the person
    marked not public; when no entry shares a word with the posting, the most recent entry is chosen.
    @param prof - The loaded career profile. @param title - The posting title. @param description - Its description.
    @param selected - Selected Other experience entries. @param today - The date recency is measured from.
    @returns [{key, title, org, span, current, relevance, recency, score, matched, chosen}], best first.
    """
    rows = entries(prof, selected)
    if not rows:
        return []
    posting = _posting_weights(title, description)
    bags = [set(tokens(row["text"])) for row in rows]
    count = len(rows)
    rarity = {word: math.log((count + 1) / (1 + sum(1 for bag in bags if word in bag))) + 1.0 for word in posting}
    raw = [sum(posting[word] * rarity[word] for word in bag if word in posting) for bag in bags]
    best = max(raw) or 1.0
    ranked = []
    for row, bag, value in zip(rows, bags, raw):
        fresh = recency(row, today)
        relevance = value / best
        ranked.append({"key": row["key"], "title": row["title"], "org": row["org"],
                       "span": role_plan._span(row, row["current"]), "current": row["current"], "public": row["public"],
                       "relevance": round(relevance, 3), "recency": round(fresh, 3),
                       "score": round(relevance * (RECENCY_FLOOR + (1 - RECENCY_FLOOR) * fresh), 4),
                       "matched": sorted((word for word in bag if word in posting), key=lambda w: -posting[w] * rarity[w])[:6],
                       "chosen": False})
    ranked.sort(key=lambda row: (row["score"], row["recency"]), reverse=True)
    offered = [row for row in ranked if row["public"]]
    picks = [row for row in offered if row["relevance"] >= MIN_RELEVANCE and max(raw) > 0][:LETTER_ROLES]
    for row in picks or sorted(offered, key=lambda row: row["recency"], reverse=True)[:1]:
        row["chosen"] = True
    return ranked


def prompt_block(ranked: list) -> str:
    """
    @description The generation prompt's COVER LETTER EVIDENCE block: the chosen entries, best first, with the posting
    words each one matched. '' when there is nothing to choose from.
    @param ranked - rank() output. @returns The prompt text.
    """
    chosen = [row for row in ranked if row["chosen"]]
    if not chosen:
        return ""
    lines = [f'* {row["key"]}: {row["title"]} | {row["org"]} | {row["span"] or "dates not recorded"}'
             + (f' | matches the posting on: {", ".join(DISPLAY.get(w, w) for w in row["matched"])}' if row["matched"] else "")
             for row in chosen]
    return (
        "\n\nCOVER LETTER EVIDENCE (hard rule; the candidate's recorded work ranked by relevance to THIS posting and by "
        "recency, best first):\n" + "\n".join(lines)
        + "\nThe cover letter's proof points come ONLY from the work listed above, most relevant first. Do not draw on "
        "any other role or engagement, the candidate's earliest jobs included, and never move a fact from one listed "
        "entry to another. Name a skill or tool only when these records name it, at the level they state: a skill the "
        "records list without a level is experience with it, never expert, advanced, deep, extensive, strong or "
        "senior. State years only as the recorded dates add up, and only the titles the records hold.\n"
    )
