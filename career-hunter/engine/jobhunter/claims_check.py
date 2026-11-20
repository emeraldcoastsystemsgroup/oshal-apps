# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c# ... we ironed all of these problems previously and they just keep coming back"): what a generated cover letter or résumé claims, read the same way whichever model wrote it, and whether the person's records support it. A skill or tool the records never name, a level the records do not state (expert, advanced, deep, strong ...), a years count the recorded dates do not add up to, a title the records do not hold, a tool put under a role whose records do not name it, and a letter sentence drawn from work outside the chosen evidence (letter_evidence) are each a problem. claims_fix.py removes or tones them down and holds the letter.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: fix parenthetical year attribution ("Java / J2EE (9 years), Python" binds backward to Java, never forward past ')' to Python), check all skills bound to a single years phrase rather than only the first, and map J2EE under Java.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Overlay candidate-confirmed skill and career year figures (years_truth.stated_overlay) into records() so over-claim checks accept the person's own figures.
"""The claims a generated cover letter or résumé makes, and whether the person's records support each one.

Records are the profile the documents were generated from: roles (titles, employers, dates, bullets, skills, stories),
recorded engagements, the skills section, summary, metrics, education, certifications, projects and the Other
experience selected for this application. framing_notes and gaps_to_collect are instructions and gaps, not evidence.
"""
from __future__ import annotations

import datetime
import re

from . import letter_evidence, role_plan

CLAIM_SECTIONS = ("headline", "summary", "competencies", "skills", "experience", "additional_experience", "open_source")
_RECORD_SKIP = frozenset({"framing_notes", "gaps_to_collect", "_meta", "prompt_framing", "roles", "engagements",
                          "additional_experience"})

# Words that state a level. MASTERY needs the records to state it; PROFICIENT also follows from repeated recent use.
MASTERY = ("expert", "experts", "expertise", "mastery", "masterful", "guru", "authority", "specialist",
           "ninja", "wizard", "virtuoso", "advanced", "extensive", "extensively", "seasoned", "veteran", "deep", "deeply",
           "world-class", "in-depth", "expert-level", "senior-level", "senior", "highly-skilled", "unmatched")
PROFICIENT = ("proficient", "proficiency", "strong", "solid", "skilled", "fluent", "fluency", "adept", "accomplished",
              "significant", "substantial", "thorough", "well-versed", "command", "sophisticated")
_TIER = {**{word: 1 for word in PROFICIENT}, **{word: 2 for word in MASTERY}}
_LEVEL_NOUNS = ("expertise", "mastery", "proficiency", "fluency", "command")
_PERSON_NOUNS = ("expert", "experts", "guru", "specialist", "ninja", "wizard", "authority", "virtuoso")
# Tools whose names are also everyday words ("react quickly", "the rest of the team", "maintenance windows"): in prose
# they count as a tool only where the document capitalises them mid-sentence (React, REST, Windows).
AMBIGUOUS = frozenset("""react express spring rails unity lambda swift rust chef puppet helm jest cucumber postman sketch dart
julia elixir pandas hive airflow snowflake looker dynamics workday oracle palo juniper embedded agile rest soap soar rag
windows spark confluence selenium cypress playwright illustrator cassandra prometheus tableau salesforce java ruby groovy
bash solidity flask maui unreal""".split())

# Tools and skills Career recognises in any document, folded the way letter_evidence.canon folds them.
VOCAB = frozenset("""csharp cplusplus fsharp java javascript typescript python ruby golang rust kotlin swift scala php
perl cobol fortran matlab sql plsql tsql bash powershell abap vba vbnet dotnet aspnet objectivec haskell elixir erlang
groovy lua julia dart solidity react angular angularjs vue vuejs svelte django flask fastapi spring springboot rails
laravel nodejs nextjs express blazor wpf winforms xamarin maui unity unreal tensorflow pytorch keras scikit pandas numpy
spark pyspark hadoop hive kafka airflow dbt aws azure gcp kubernetes docker terraform ansible puppet chef openshift helm
lambda ec2 cloudformation bicep postgresql mysql mariadb oracle mongodb redis cassandra dynamodb elasticsearch opensearch
snowflake databricks bigquery redshift hana sqlserver sqlite neo4j jenkins gitlab github bitbucket githubactions
azuredevops circleci argocd jira confluence servicenow splunk datadog prometheus grafana kibana dynatrace newrelic
tableau powerbi looker qlik salesforce sap workday sharepoint dynamics scada plc hmi dcs labview autocad solidworks revit
catia arcgis gis matlab simulink linux unix windows rhel ubuntu vmware hyperv citrix cisco juniper palo fortinet siem
soar edr iam okta ldap kerberos saml oauth graphql rest soap grpc microservices serverless etl elt devops devsecops sre
cicd agile scrum kanban itil sixsigma pmp cissp cisa cism ccna ccnp cka ckad mlops llm llms rag nlp ml deeplearning
ai genai iot fpga verilog vhdl rtos embedded firmware selenium cypress playwright junit pytest jest cucumber postman
figma sketch photoshop illustrator tcp bgp ospf mpls sdwan lte 5g rf""".split())

# A broader tool the records support through a narrower one they name (SQL through PostgreSQL, AWS through EC2).
IMPLIED_BY = {
    "sql": ("postgresql", "mysql", "mariadb", "tsql", "plsql", "sqlserver", "sqlite", "oracle", "snowflake", "bigquery",
            "redshift", "hana"),
    "dotnet": ("csharp", "aspnet", "vbnet", "fsharp", "blazor", "wpf", "winforms", "xamarin", "maui"),
    "aws": ("ec2", "lambda", "cloudformation", "dynamodb", "redshift"), "azure": ("azuredevops", "bicep"),
    "kubernetes": ("openshift",), "linux": ("rhel", "ubuntu"), "git": ("github", "gitlab", "bitbucket"),
    "cicd": ("jenkins", "githubactions", "azuredevops", "circleci", "argocd"), "devops": ("devsecops",),
    "agile": ("scrum", "kanban"), "javascript": ("typescript", "nodejs", "react", "angular", "vue", "vuejs", "nextjs"),
    "ml": ("deeplearning", "tensorflow", "pytorch", "mlops", "scikit"), "ai": ("ml", "llm", "llms", "genai", "nlp", "rag", "aiops"),
    "rest": ("restful",), "scrum": ("scrummaster",), "llm": ("llms",), "java": ("j2ee",),
}

# Upper-case words of a posting that are not tools: places, papers, people and offices.
_NOT_TOOLS = frozenset("""us usa eeo eoe ada hr ceo cto cio cfo coo cso ciso vp svp evp avp pto llc inc ltd ok id ii iii
iv bs ba ms ma mba phd gpa est pst cst mst edt pdt cdt utc faq tbd asap usd eu uk dc al ak az ar ca co ct de fl ga hi
ia il in ks ky la me md mi mn mo mt ne nv nh nj nm ny nc nd oh or pa ri sc sd tn tx ut vt va wa wv wi wy fte w2 c2c
k401 kpi kpis roi okr okrs sow rfp rfi rfq nda job new our the and for you""".split())

_TITLE_NOUNS = frozenset("""manager director architect engineer developer lead head chief officer president vp principal
consultant analyst specialist administrator scientist designer founder cofounder co-founder partner executive coordinator
supervisor technician contractor programmer owner strategist advisor adviser fellow superintendent foreman""".split())
_TITLE_SMALL = frozenset({"of", "and", "for", "the", "&", "/", "a", "an", "in", "at", "to", "on"})
_TITLE_SAME = {"sr": "senior", "jr": "junior", "mgr": "manager", "eng": "engineer", "dir": "director", "assoc": "associate"}

_FIRST_PERSON = re.compile(r"\b(i|i['’]m|i['’]ve|i['’]d|i['’]ll|my|me|myself|mine)\b", re.I)
_PAST_VERB = re.compile(r"^(?:[A-Z][a-z]+ed|Built|Led|Ran|Drove|Grew|Won|Wrote|Made|Took|Brought|Set|Cut|Spent|Began|"
                        r"Became|Held|Kept|Taught|Sold|Oversaw|Rebuilt|Shipped|Stood|Brought|Saw|Found|Sent|Put)\b")
_EARLIEST = re.compile(r"\b(?:(?:my\s+)?(?:very\s+)?(?:first|earliest)\s+(?:\w+\s+){0,2}(?:job|role|position|programming|"
                       r"development|engineering|developer|employer)|(?:started|began|start|beginning|early\s+(?:on\s+)?in)"
                       r"\s+(?:of\s+)?my\s+career|early\s+career)\b", re.I)
_ABBREVIATIONS = ("e.g.", "i.e.", "u.s.", "inc.", "sr.", "jr.", "dr.", "mr.", "ms.", "st.", "no.", "vs.", "etc.", "co.")
_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                 "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
                 "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty-five": 25, "thirty": 30}
_YEARS = re.compile(r"\b(?:(?P<mod>over|more than|nearly|almost|about|around|roughly|close to)\s+)?"
                    r"(?P<n>\d{1,2}|" + "|".join(sorted(_NUMBER_WORDS, key=len, reverse=True)) + r")\s*(?P<plus>\+)?"
                    r"(?:[\s-]*(?P<unit>years?|yrs?|decades?))(?:['’]s?)?(?P<rest>[^.;:!?]{0,90})", re.I)
_DECADE = re.compile(r"\b(?:(?P<mod>over|more than|nearly|almost|about|around|roughly|close to)\s+)?(?P<n>a)"
                     r"\s+decade(?P<rest>[^.;:!?]{0,90})", re.I)
_YEARS_NOT_CLAIM = re.compile(r"(?:\b(?:past|last|next|within|first|recent)\s+$)", re.I)


def words(text) -> list:
    """@description Folded word list (letter_evidence.canon), hyphenated words kept whole. @param text - Text.
    @returns The words."""
    return re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", letter_evidence.canon(text))


def split_sentences(text: str) -> list:
    """
    @description A paragraph's sentences in order. A full stop after a known abbreviation (e.g., U.S., Inc.) or a
    single capital letter does not end a sentence.
    @param text - One paragraph. @returns The sentences, each stripped.
    """
    value, out, start = str(text or ""), [], 0
    for found in re.finditer(r"[.!?]+[\"”’)]*\s+(?=[A-Z0-9\"“(])", value):
        head = value[start:found.start() + 1]
        last = head.split()[-1].lower() if head.split() else ""
        if last in _ABBREVIATIONS or re.fullmatch(r"[a-z]\.", last):
            continue
        out.append(value[start:found.end()].strip())
        start = found.end()
    if value[start:].strip():
        out.append(value[start:].strip())
    return out


def self_claim(sentence: str) -> bool:
    """@description Whether a letter sentence speaks about the candidate: a first-person word, or an implied subject
    that opens on a past-tense verb ("Led the team that ..."). @param sentence - One sentence. @returns bool"""
    return bool(_FIRST_PERSON.search(sentence)) or bool(_PAST_VERB.match(sentence.strip()))


def posting_terms(title: str, description: str) -> frozenset:
    """
    @description Words of the posting written the way tools are: C#, .NET or Node.js, an upper-case name of three or
    more letters (SCADA, ETL), a mixed-case name (PostgreSQL, ServiceNow) or a name with a digit (S3, IL5), folded, minus
    places, papers and offices. With VOCAB these are the tools a document may name only when the records do.
    @param title - The posting title. @param description - Its description. @returns Folded terms.
    """
    text, found = f"{title or ''}\n{description or ''}", set()
    for pattern, repl in letter_evidence._CANON_RE:
        if pattern.search(text):
            found.update(repl.split())
            text = pattern.sub(" ", text)
    for line in text.splitlines():
        letters = re.sub(r"[^A-Za-z]", "", line)
        heading = bool(letters) and sum(c.isupper() for c in letters) * 2 > len(letters)
        for raw in re.findall(r"[A-Za-z0-9][A-Za-z0-9+#/-]*(?:\.(?:js|JS|io|ai|py|ts)\b)?[A-Za-z0-9+#]*", line):
            shaped = (re.search(r"[#+]|\.(?:js|JS|io|ai|py|ts)\b", raw) or (raw.isupper() and 3 <= len(raw) <= 8 and raw.isalpha() and not heading)
                      or re.search(r"[a-z][A-Z]", raw) or (re.search(r"\d", raw) and re.search(r"[A-Za-z]", raw)))
            found.update(word for word in letter_evidence.tokens(raw) if shaped and word not in _NOT_TOOLS and len(word) >= 2)
    return frozenset(found)


def _record_strings(value, out: list) -> list:
    if isinstance(value, dict):
        for key, item in value.items():
            if key not in _RECORD_SKIP:
                _record_strings(item, out)
    elif isinstance(value, list):
        for item in value:
            _record_strings(item, out)
    elif isinstance(value, str) and value.strip():
        out.append(value)
    return out


def _interval(entry: dict, today: datetime.date):
    start = role_plan.month(entry.get("start"))
    end = (today.year, today.month) if entry.get("current") else role_plan.month(entry.get("end"), last=True)
    if not start or not end or end < start:
        return None
    return start[0] * 12 + start[1] - 1, end[0] * 12 + end[1]


def _years(intervals) -> float:
    months, last = 0, None
    for start, end in sorted(i for i in intervals if i):
        if last is None or start > last:
            months, last = months + end - start, end
        elif end > last:
            months, last = months + end - last, end
    return months / 12.0


def _stated_years(segment_words: list) -> list:
    """(years, words after the number) for every 'N years' / 'N+ years' a record states."""
    out = []
    for index, word in enumerate(segment_words):
        if word in ("years", "year", "yrs") and index:
            number = segment_words[index - 1]
            value = int(number) if number.isdigit() else _NUMBER_WORDS.get(number)
            if value and value < 60:
                out.append((value, segment_words[index + 1:index + 9]))
    return out


def records(prof: dict, selected=(), terms=frozenset(), today: datetime.date | None = None) -> dict:
    """
    @description Everything a claim is held to: each recorded role, engagement and selected Other experience entry with
    its words and dates; every word the records hold; the level each tool is stated at; the years stated or spanned.
    @param prof - The profile the documents were generated from. @param selected - Selected Other experience entries.
    @param terms - The tools to look for (VOCAB and the posting's). @param today - The date "now" means.
    @returns The records model check() reads.
    """
    now = today or datetime.date.today()
    rows = letter_evidence.entries(prof, selected)
    for row in rows:
        row["bag"] = set(words(row["text"])) | set(words(row["title"])) | set(words(row["org"]))
        row["interval"] = _interval(row, now)
    loose = _record_strings(prof or {}, [])
    segments = loose + [part for row in rows for part in re.split(r"\n|(?<=[.;])\s+", row["text"]) if part.strip()]
    rec = {"rows": rows, "words": set(), "levels": {}, "stated": {}, "stated_career": 0, "generic_mastery": [],
           "loose_words": set(), "plan": role_plan.plan(prof or {}, now), "today": now, "terms": frozenset(terms) | VOCAB}
    for text in loose:
        rec["loose_words"].update(words(text))
    for segment in segments:
        _absorb(rec, words(segment))
    for row in rows:
        rec["words"].update(row["bag"])
    rec["career_years"] = _years(row["interval"] for row in rows if row["key"][0] in "RE")
    from . import years_truth
    years_truth.stated_overlay(rec, prof)
    return rec


def _absorb(rec: dict, segment_words: list) -> None:
    """One record sentence: its words, the levels it states for tools, and the years it states."""
    rec["words"].update(segment_words)
    rec["words"].update(piece for word in segment_words for piece in word.split("-"))
    present = {word for word in segment_words if word in rec["terms"]}
    for claim in level_claims(segment_words, present):
        if claim["term"]:
            rec["levels"][claim["term"]] = max(rec["levels"].get(claim["term"], 0), claim["tier"])
        else:
            rec["generic_mastery"].append(set(segment_words))
    for value, after in _stated_years(segment_words):
        named = [word for word in after if word in present]
        for term in named:
            rec["stated"][term] = max(rec["stated"].get(term, 0), value)
        if not named:
            rec["stated_career"] = max(rec["stated_career"], value)


_CONNECT = frozenset("""in with of on at and or across both the a an modern enterprise production large-scale hands-on
all multiple several various including building designing developing delivering leading writing running managing creating
implementing engineering architecting automating deploying maintaining modernizing migrating using applying commissioning
integrating supporting operating configuring programming troubleshooting administering monitoring testing securing scaling
optimizing tuning""".split())
_NEUTRAL = frozenset("""experience background knowledge understanding skills skill foundation development engineering
programming coding expertise proficiency command mastery track record abilities ability capabilities""".split())
_GENERIC_MASTERY = frozenset({"expert", "experts", "expertise", "mastery", "guru", "authority", "world-class",
                              "virtuoso", "expert-level", "unmatched"})


def _forward(toks: list, index: int, terms) -> list:
    found = []
    for word in toks[index + 1:index + 7]:
        if word in terms:
            found.append(word)
        elif word in _CONNECT or (word in _NEUTRAL and not found) or word in ("/", "&"):
            continue
        else:
            break
    return found


def _backward(toks: list, index: int, terms) -> list:
    found = []
    for word in reversed(toks[max(0, index - 4):index]):
        if word in terms:
            found.append(word)
        elif word in ("and", "or", "&") or (word in _NEUTRAL and not found):
            continue
        else:
            break
    return found


def level_claims(toks: list, terms) -> list:
    """
    @description The levels a sentence states: a level word followed by tools ("expert in C#", "strong C# skills",
    "deep expertise with C# and .NET"), tools followed by a level noun ("C# expertise", "Azure specialist"), and a
    mastery word about anything else ("expertise in field operations"), each with its tier (2 mastery, 1 proficient).
    @param toks - words() of the sentence. @param terms - The tools present in it.
    @returns [{term (or None), tier, word, object}].
    """
    claims = []
    for index, word in enumerate(toks):
        tier = _TIER.get(word)
        if not tier:
            continue
        named = _forward(toks, index, terms)
        if word in _LEVEL_NOUNS or word in _PERSON_NOUNS or word in ("skills", "skill"):
            named += [term for term in _backward(toks, index, terms) if term not in named]
        for term in named:
            claims.append({"term": term, "tier": tier, "word": word, "object": [term]})
        if not named and word in _GENERIC_MASTERY:
            claims.append({"term": None, "tier": 2, "word": word,
                           "object": [w for w in toks[index + 1:index + 6] if w not in _CONNECT and w not in _NEUTRAL][:3]})
    return claims


_JOINED_AFTER = ("ful", "ops", "master", "based", "native", "driven", "enabled", "certified", "api", "apis", "es")
_JOINED_BEFORE = ("ms", "t", "pl", "py", "azure", "aws", "gcp", "google", "amazon", "microsoft", "open", "apache", "ibm")


def _joined(term: str, have) -> bool:
    """A record word that is the tool joined to a common ending or maker (RESTful, AIOps, ScrumMaster, MSSQL, PySpark)."""
    return any(word != term and ((word.startswith(term) and word[len(term):] in _JOINED_AFTER)
                                 or (word.endswith(term) and word[:-len(term)] in _JOINED_BEFORE)) for word in have)


def term_supported(rec: dict, term: str) -> bool:
    """@description Whether the records name a tool: directly, in plural or singular, joined to a common ending or
    maker (RESTful, AIOps, MSSQL), or through a narrower tool that implies it (SQL through PostgreSQL).
    @param rec - records(). @param term - A folded tool. @returns bool"""
    have = rec["words"]
    return (term in have or f"{term}s" in have or (term.endswith("s") and term[:-1] in have)
            or any(other in have for other in IMPLIED_BY.get(term, ())) or _joined(term, have))


def _rows_with(rec: dict, term: str) -> list:
    narrower = IMPLIED_BY.get(term, ())
    return [row for row in rec["rows"] if term in row["bag"] or any(other in row["bag"] for other in narrower)]


def level_supported(rec: dict, claim: dict) -> bool:
    """
    @description Whether the records support a stated level. Mastery (expert, advanced, deep, senior ...) only when the
    records state that level for that tool; proficiency (strong, proficient, solid ...) also when the tool appears in
    two or more recorded roles, one of them current or ended within five years. A mastery word about anything else
    only when a record states mastery about the same subject.
    @param rec - records(). @param claim - One level_claims() item. @returns bool
    """
    term = claim["term"]
    if term is None:
        subject = set(claim["object"])
        return any(subject & stated for stated in rec["generic_mastery"]) if subject else bool(rec["generic_mastery"])
    if rec["levels"].get(term, 0) >= claim["tier"]:
        return True
    if claim["tier"] >= 2:
        return False
    used = _rows_with(rec, term)
    recent = [row for row in used if row["current"] or letter_evidence.recency(row, rec["today"]) >= 1 / (1 + 5 / letter_evidence.RECENCY_HALF_YEARS)]
    return len(used) >= 2 and bool(recent)


def term_years(rec: dict, term: str) -> float:
    """@description Years the records support for a tool: the recorded roles naming it, added up without overlap, or a
    larger figure a record states for it. @param rec - records(). @param term - A folded tool. @returns Years."""
    spanned = _years(row["interval"] for row in _rows_with(rec, term))
    return max(spanned, float(rec["stated"].get(term, 0)))


def career_years(rec: dict) -> float:
    """@description Years of work the records support: every dated role and engagement added up without overlap, or a
    larger figure the records state. @param rec - records(). @returns Years."""
    return max(rec["career_years"], float(rec["stated_career"]))


_SURFACE = {"csharp": r"C\s*#|C-sharp|C sharp|csharp", "cplusplus": r"C\+\+", "fsharp": r"F#",
            "dotnet": r"(?:ASP|VB)?\.NET(?:\s+Core)?|dotnet", "aspnet": r"ASP\.NET", "vbnet": r"VB\.NET",
            "nodejs": r"Node(?:\.?js)?", "vuejs": r"Vue(?:\.?js)?", "nextjs": r"Next\.?js", "cicd": r"CI\s*/\s*CD",
            "powerbi": r"Power\s+BI", "sqlserver": r"SQL\s+Server", "tsql": r"T-SQL", "plsql": r"PL/SQL",
            "postgresql": r"Postgre(?:SQL|s)", "gcp": r"GCP|Google\s+Cloud(?:\s+Platform)?", "ml": r"ML|machine\s+learning",
            "deeplearning": r"deep\s+learning", "githubactions": r"GitHub\s+Actions", "azuredevops": r"Azure\s+DevOps",
            "sixsigma": r"Six\s+Sigma", "objectivec": r"Objective-C", "aws": r"AWS|Amazon\s+Web\s+Services",
            "kubernetes": r"Kubernetes|K8s", "securityplus": r"Security\+", "networkplus": r"Network\+", "aplus": r"A\+"}


def surface(term: str) -> str:
    """@description The pattern that finds a folded tool as it is written (C# for csharp, .NET for dotnet).
    @param term - A folded tool. @returns A regular expression (use re.I)."""
    body = _SURFACE.get(term) or re.escape(term) + r"s?"
    return r"(?<![A-Za-z0-9])(?:" + body + r")(?![A-Za-z0-9#+])"


def display(term: str, text: str = "") -> str:
    """@description How a tool is written for the person: as the document wrote it, else its usual spelling.
    @param term - A folded tool. @param text - The sentence it was found in. @returns The name."""
    found = re.search(surface(term), text or "", re.I)
    return found.group(0) if found else letter_evidence.DISPLAY.get(term, term)


def _strip_target(text: str, job: dict) -> str:
    """The sentence without the posting naming itself: its company, and 'the/your/this <posting title>'."""
    value = str(text or "")
    company, title = str(job.get("company") or "").strip(), str(job.get("title") or "").strip()
    if title:
        value = re.sub(r"\b(?:the|your|this|that)\s+" + re.escape(title) + r"\b", " ", value, flags=re.I)
    if company:
        value = re.sub(re.escape(company) + r"(?:['’]s)?", " ", value, flags=re.I)
    return value


def _named_as_tool(term: str, text: str) -> bool:
    """An everyday-word tool counts in prose only where it is capitalised after a sentence's first word."""
    for found in re.finditer(r"(?<![A-Za-z0-9])" + re.escape(term) + r"s?(?![A-Za-z0-9])", text, re.I):
        before = text[:found.start()].rstrip()
        if found.group(0)[:1].isupper() and before and before[-1] not in ".!?:":
            return True
    return False


def terms_in(rec: dict, text: str, job: dict, prose: bool = True) -> list:
    """@description The tools a document claim names (VOCAB and the posting's tool words), the posting's own name
    left out; in prose an everyday-word tool (React, REST, Windows) counts only where it is capitalised mid-sentence.
    @param rec - records(). @param text - The claim. @param job - {title, company, terms}.
    @param prose - False for a skills or competencies item, where every word is a tool's name.
    @returns Folded tools in order, each once."""
    vocab, plain = rec["terms"] | job.get("terms", frozenset()), _strip_target(text, job)
    found = []
    for word in words(plain):
        term = word if word in vocab else word[:-1] if word.endswith("s") and word[:-1] in vocab else None
        if term in AMBIGUOUS and term not in job.get("terms", ()) and prose and not _named_as_tool(term, plain):
            continue
        if term and term not in found:
            found.append(term)
    return found


def org_rows(rec: dict, text: str) -> list:
    """@description The recorded roles and engagements whose employer a sentence names. @param rec - records().
    @param text - The sentence. @returns Rows."""
    said = f" {role_plan._words(text)} "
    return [row for row in rec["rows"] if row["org"] and role_plan._org_words(row["org"])
            and f" {role_plan._org_words(row['org'])} " in said]


def _distinct(rec: dict) -> dict:
    """How many jobs and Other experience entries hold each word (client engagements sit inside a job, so their words
    would hide the job's own; they are found by the client's name)."""
    counts = {}
    for row in rec["rows"]:
        for word in row["bag"] if row["key"][0] != "E" else ():
            counts[word] = counts.get(word, 0) + 1
    return counts


def drew_on(rec: dict, text: str) -> list:
    """
    @description The recorded work a letter sentence draws on: the employer or client it names, else the earliest role
    when it speaks of the first job or the start of a career, else the one job or Other experience entry two or more of
    whose own words (words no other job or entry holds) it repeats.
    @param rec - records(). @param text - The sentence. @returns Row keys.
    """
    named = org_rows(rec, text)
    if named:
        return [row["key"] for row in named]
    if _EARLIEST.search(text or ""):
        dated = [row for row in rec["rows"] if row["key"][0] in "RE" and role_plan.month(row.get("start"))]
        if dated:
            return [min(dated, key=lambda row: role_plan.month(row.get("start")))["key"]]
    counts, said = rec.setdefault("_distinct", None) or _distinct(rec), set(words(text))
    rec["_distinct"] = counts
    own = [(row["key"], len([w for w in said & row["bag"] if counts.get(w) == 1 and w not in letter_evidence.STOP]))
           for row in rec["rows"] if row["key"][0] != "E"]
    strong = [key for key, shared in own if shared >= 2]
    return strong if len(strong) == 1 else []


_TITLE_CLAIM = re.compile(r"\b(?i:as|served as|serving as|worked as|working as|role as|position as|tenure as|time as|"
                          r"career as|I was|I am|I['’]m|I['’]ve been|I have been)\s+(?i:an?\s+|the\s+|their\s+|its\s+)?"
                          r"(?i:(?:former|current|founding|acting|interim)\s+)?"
                          r"(?P<title>[A-Z][\w&/+#.-]*(?:\s+(?:of|and|for|&|/|[A-Z][\w&/+#.-]*)){0,6})")
_PAST = re.compile(r"\b(served|serving|worked|working|was|were|been|held|hold)\b", re.I)


def _title_words(text: str) -> set:
    return {_TITLE_SAME.get(word, word) for word in words(text) for word in [word] if word not in _TITLE_SMALL}


def _row_tools(rows: list) -> set:
    return {word for row in rows for word in row["bag"]}


def title_supported(rec: dict, claimed: str, owners: list) -> bool:
    """
    @description Whether a claimed title is one the records hold: its words, a tool the role names aside, are all
    words of one recorded title (of the employer the sentence names, when it names one). A title that is a subset of
    the recorded one ("Program Manager" for "Program Manager / SRE Lead") is held; a title with any word the records
    do not give it (Senior, Principal, Director, Architect ...) is not.
    @param rec - records(). @param claimed - The title as written. @param owners - Rows of the employer named, or [].
    @returns bool
    """
    rows = owners or rec["rows"]
    wanted = _title_words(claimed) - (_row_tools(rows) & rec["terms"])
    return any(wanted <= _title_words(row["title"]) for row in rows if row["title"])


def _problem(document, path, kind, text, **detail) -> dict:
    return {"document": document, "path": list(path), "kind": kind, "text": text, **detail}


def _skill_problems(rec, document, path, text, terms) -> list:
    return [_problem(document, path, "skill", text, term=term, claim=display(term, text))
            for term in terms if not term_supported(rec, term)]


def _attribution_problems(rec, document, path, text, terms, owners) -> list:
    """A tool put under an employer (or résumé role) whose records do not name it, when other roles' records do and
    nothing outside the roles (the skills section, summary, projects) names it."""
    if not owners:
        return []
    out = []
    for term in terms:
        tied = _rows_with(rec, term)
        if tied and not any(row in tied for row in owners) and not term_supported({"words": rec["loose_words"]}, term):
            out.append(_problem(document, path, "attribution", text, term=term, claim=display(term, text),
                                where=[row["key"] for row in tied], under=[row["key"] for row in owners]))
    return out


def _without_names(rec: dict, text: str, job: dict) -> str:
    """A sentence without the posting naming itself and without recorded employer names (Water Authority, Expert
    Systems Inc.), so a word in a name is never read as a level."""
    value = _strip_target(text, job)
    for org in sorted({row["org"] for row in rec["rows"] if row["org"]}, key=len, reverse=True):
        value = re.sub(re.escape(org), " ", value, flags=re.I)
    return value


def _phrase(text: str, word: str, term) -> str:
    """The level claim as the document wrote it, from the level word to the tool (either order), else word + tool."""
    shown = display(term, text) if term else ""
    for pattern in ((r"\b" + re.escape(word) + r"\b[^.;:!?]{0,40}?" + surface(term)) if term else None,
                    (surface(term) + r"[^.;:!?]{0,20}?\b" + re.escape(word) + r"\b") if term else None,
                    r"\b" + re.escape(word) + r"\b(?:\s+\S+){0,3}"):
        found = pattern and re.search(pattern, text, re.I)
        if found:
            return found.group(0).strip()
    return f"{word} {shown}".strip()


def _level_problems(rec, document, path, text, terms, job) -> list:
    out, seen = [], set()
    for claim in level_claims(words(_without_names(rec, text, job)), set(terms)):
        if claim["term"] in seen or level_supported(rec, claim):
            continue
        seen.add(claim["term"])
        out.append(_problem(document, path, "level", text, term=claim["term"], word=claim["word"], tier=claim["tier"],
                            claim=_phrase(text, claim["word"], claim["term"])))
    return out


def _claimed_years(found) -> float:
    raw, mod = found.group("n").lower(), (found.group("mod") or "").lower()
    unit = (found.groupdict().get("unit") or "decade").lower()
    value = float(raw) if raw.isdigit() else float(_NUMBER_WORDS.get(raw, 1 if raw in ("a", "one") else 0))
    value *= 10 if unit.startswith("decade") else 1
    if mod in ("nearly", "almost", "close to"):
        value -= 2 if unit.startswith("decade") else 1
    elif mod in ("over", "more than") or found.groupdict().get("plus"):
        value += 0.5
    return value


def _paren_before_terms(text: str, start: int, terms) -> list:
    """Skills immediately preceding a parenthetical years tag like 'Java / J2EE (9 years)'."""
    prefix = text[:start].rstrip()
    if not prefix.endswith("("):
        return []
    head = re.split(r"[,;:\n]", prefix[:-1])[-1]
    return [word for word in words(head) if word in terms]


def _years_problems(rec, document, path, text, terms) -> list:
    out = []
    for found in [*_YEARS.finditer(text), *_DECADE.finditer(text)]:
        rest, phrase = found.group("rest") or "", text[found.start():found.start("rest")].strip()
        if _YEARS_NOT_CLAIM.search(text[max(0, found.start() - 12):found.start()]) or re.match(r"\s*(?:ago|old)\b", rest):
            continue
        claimed = _claimed_years(found)
        if rest.lstrip().startswith(")"):
            named = _paren_before_terms(text, found.start(), terms)
            orgs = []
        else:
            clause = re.split(r"[,;)]|\b(?:who|that|which|where|while|when|whose|because|since|but|and\s+(?:I|have|has|am|was))\b",
                              rest, maxsplit=1, flags=re.I)[0]
            rest_words = words(clause)[:10]
            named = [word for word in rest_words if word in terms]
            orgs = [] if named else org_rows(rec, clause)
        supported = (min(term_years(rec, term) for term in named) if named
                     else _years(row["interval"] for row in orgs) if orgs else career_years(rec))
        if claimed > supported + 0.5:
            out.append(_problem(document, path, "years", text, claim=phrase, supported=int(supported),
                                term=named[0] if named else None))
    return out


def _title_problems(rec, job, document, path, text, owners) -> list:
    out = []
    target = _title_words(job.get("title") or "")
    for found in _TITLE_CLAIM.finditer(text):
        claimed = re.sub(r"(?:\s+(?:of|and|for|&|/))+$", "", found.group("title")).strip()
        wanted = _title_words(claimed)
        if not wanted & _TITLE_NOUNS:
            continue
        if wanted <= target and not owners and not _PAST.search(text):
            continue
        if not title_supported(rec, claimed, owners):
            out.append(_problem(document, path, "title", text, claim=claimed))
    return out


def _where(row: dict) -> str:
    """A recorded role as the person reads it: its title at its employer."""
    return f'{row["title"]} at {row["org"]}' if row["title"] and row["org"] else row["title"] or row["org"]


def _evidence_problems(rec, path, text, allowed) -> list:
    keys = drew_on(rec, text)
    if not keys or any(key in allowed for key in keys):
        return []
    row = next(row for row in rec["rows"] if row["key"] == keys[0])
    return [_problem("cover", path, "evidence", text, keys=keys, claim=_where(row), span=role_plan._span(row, row["current"]))]


def _stale_tool_problems(rec, path, text, terms, allowed) -> list:
    """A letter tool whose only record is older work outside the letter's evidence (C# from a first job, say) puts that
    old work forward as current; the skills section or summary naming it would count as a record of its own."""
    out = []
    for term in terms:
        rows = _rows_with(rec, term)
        if rows and not any(row["key"] in allowed for row in rows) and not term_supported({"words": rec["loose_words"]}, term):
            row = max(rows, key=lambda r: role_plan.month(r.get("end"), last=True) or (0, 0))
            out.append(_problem("cover", path, "evidence", text, keys=[r["key"] for r in rows], term=term,
                                claim=display(term, text), where=_where(row),
                                span=role_plan._span(row, row["current"])))
    return out


def segment_problems(rec, job, document, path, text, owners=(), allowed=frozenset()) -> list:
    """
    @description Every problem in one claim of a document: tools the records never name (the claim then goes, so
    nothing else is checked), tools put under the wrong employer, levels, years and titles the records do not support,
    and, for a letter sentence, recorded work outside the letter's evidence.
    @param rec - records(). @param job - {title, company, terms}. @param document - "cover" or "resume".
    @param path - Where the claim sits. @param text - The claim. @param owners - Rows it belongs to.
    @param allowed - Row keys a letter may draw on. @returns Problems.
    """
    terms = terms_in(rec, text, job, prose=path[0] not in ("skills", "competencies"))
    missing = _skill_problems(rec, document, path, text, terms)
    if missing:
        return missing
    owners = list(owners) or org_rows(rec, text)
    found = _attribution_problems(rec, document, path, text, terms, owners)
    found += _level_problems(rec, document, path, text, terms, job)
    found += _years_problems(rec, document, path, text, terms)
    if path[0] != "headline":
        found += _title_problems(rec, job, document, path, text, owners)
    if document == "cover" and allowed:
        found += _evidence_problems(rec, path, text, allowed) or _stale_tool_problems(rec, path, text, terms, allowed)
    return found


def _cover_claims(cover: dict) -> list:
    out = []
    for p_index, paragraph in enumerate(cover.get("paragraphs") or []):
        for s_index, sentence in enumerate(split_sentences(paragraph if isinstance(paragraph, str) else "")):
            out.append(("cover", ("paragraphs", p_index, s_index), sentence, self_claim(sentence)))
    return out


def _resume_claims(resume: dict) -> list:
    out = [("resume", ("headline",), str(resume.get("headline") or ""), True)]
    out += [("resume", ("summary", index), sentence, True)
            for index, sentence in enumerate(split_sentences(str(resume.get("summary") or "")))]
    for field in ("competencies", "skills"):
        items = resume.get(field) if isinstance(resume.get(field), list) else []
        out += [("resume", (field, index), item, True) for index, item in enumerate(items) if isinstance(item, str)]
    for section in ("experience", "additional_experience", "open_source"):
        for e_index, entry in enumerate(resume.get(section) or []):
            bullets = entry.get("bullets") if isinstance(entry, dict) and isinstance(entry.get("bullets"), list) else []
            out += [("resume", (section, e_index, "bullets", b_index), bullet, True)
                    for b_index, bullet in enumerate(bullets) if isinstance(bullet, str)]
    return out


def _entry_owners(rec: dict, resume: dict, section: str, index: int) -> list:
    entries = resume.get("experience") if isinstance(resume.get("experience"), list) else []
    if section != "experience" or not 0 <= index < len(entries):
        return []
    entry = entries[index]
    keys = {found["key"] for found in role_plan.roles_of(entry, rec["plan"])} if isinstance(entry, dict) else set()
    return [row for row in rec["rows"] if row["key"] in keys]


def _known_org(rec: dict, org: str) -> bool:
    mine = set(role_plan._org_words(org).split())
    for row in rec["rows"]:
        theirs = set(role_plan._org_words(row["org"]).split())
        if theirs and mine and (theirs <= mine or mine <= theirs or len(theirs & mine) * 2 >= max(len(theirs), len(mine))):
            return True
    return not mine


_SUMMARY_LINE = re.compile(r"\b(?:early|earlier|prior|previous|additional|other)\s+(?:career|experience|roles?)\b", re.I)


def entry_problems(rec: dict, resume: dict) -> list:
    """
    @description Each résumé experience entry is a recorded job: its employer is one the records hold and its title is
    one the records give that employer (a shorter form of it is fine). An employer the records never name is a job
    that did not happen; a title they do not give it is put back to the recorded one.
    @param rec - records(). @param resume - The generated résumé. @returns Problems (kind "title").
    """
    out = []
    for index, entry in enumerate(resume.get("experience") or []):
        if not isinstance(entry, dict) or not str(entry.get("org") or "").strip() or _SUMMARY_LINE.search(str(entry.get("title") or "")):
            continue
        path, title = ("experience", index, "title"), str(entry.get("title") or "")
        if not _known_org(rec, entry["org"]):
            out.append(_problem("resume", path, "title", title, claim=f'{title} at {entry["org"]}', employer=False))
            continue
        owners = _entry_owners(rec, resume, "experience", index) or [row for row in rec["rows"] if role_plan.same_org(row["org"], entry["org"])]
        if title and owners and not title_supported(rec, title, owners):
            recorded = max(owners, key=lambda row: len(_title_words(title) & _title_words(row["title"])))
            out.append(_problem("resume", path, "title", title, claim=title, recorded=recorded["title"], employer=True))
    return out


def owners(rec: dict, resume: dict, path) -> list:
    """@description The recorded roles a résumé claim belongs to: those of the experience entry a bullet sits under.
    @param rec - records(). @param resume - The résumé. @param path - The claim's path. @returns Rows."""
    path = list(path)
    return _entry_owners(rec, resume, "experience", path[1]) if len(path) >= 2 and path[0] == "experience" else []


def allowed(rec: dict, ranked) -> frozenset:
    """@description The recorded work a letter may draw on: the evidence letter_evidence chose, other work that ended
    within RECENT_YEARS and speaks to the posting, work held now, and Other experience the person selected for this
    application. An older role outside the chosen evidence (a first job) is not, nor work the person marked not public.
    Empty (no rule) when nothing was ranked.
    @param rec - records(). @param ranked - letter_evidence.rank() output. @returns Row keys."""
    if not ranked:
        return frozenset()
    floor = letter_evidence.recency({"end": f"{rec['today'].year - letter_evidence.RECENT_YEARS}-{rec['today'].month:02d}"}, rec["today"])
    return frozenset({row["key"] for row in ranked if row.get("chosen") or (
                          row["public"] and row["recency"] >= floor and row["relevance"] >= letter_evidence.MIN_RELEVANCE)}
                     | {row["key"] for row in rec["rows"] if row["public"] and (row["key"][0] == "A" or row["current"])})


def check(data: dict, rec: dict, job: dict, ranked=()) -> list:
    """
    @description Every problem in a generated packet: each letter sentence that speaks about the candidate and each
    résumé claim (headline, summary sentences, competencies, skills, bullets), then each résumé job's employer and title.
    A letter sentence about the job itself is held to one rule: it names no tool the candidate's records lack, since
    "you need C# and .NET ... this role fits me" claims them as surely as "I know C#".
    @param data - The generation {resume, cover}. @param rec - records(). @param job - {title, company, terms}.
    @param ranked - letter_evidence.rank() output (the chosen rows a letter may draw on). @returns Problems.
    """
    resume, letter_may = (data or {}).get("resume") or {}, allowed(rec, ranked)
    problems = []
    for document, path, text, claims in _cover_claims((data or {}).get("cover") or {}) + _resume_claims(resume):
        if claims and text.strip():
            mine = owners(rec, resume, path) if document == "resume" else []
            problems += segment_problems(rec, job, document, path, text, mine, letter_may)
        elif text.strip():   # a letter sentence about the job still names no tool the candidate's records lack
            problems += _skill_problems(rec, document, path, text, terms_in(rec, text, job))
    return problems + entry_problems(rec, resume)


def letter_draws_on(rec: dict, cover: dict) -> list:
    """@description The recorded work a letter's sentences draw on, in order, each key once. @param rec - records().
    @param cover - The letter. @returns Row keys."""
    keys = []
    for _document, _path, text, claims in _cover_claims(cover or {}):
        for key in drew_on(rec, text) if claims else []:
            if key not in keys:
                keys.append(key)
    return keys


_KIND_WORDS = {"cover": "The cover letter", "resume": "The résumé"}


def describe(problem: dict, rec: dict | None = None) -> str:
    """
    @description One plain sentence for the person: what the document claimed and what the records say.
    @param problem - One problem. @param rec - records() (names the roles a tool or a letter's evidence belongs to).
    @returns The sentence.
    """
    who, kind, claim = _KIND_WORDS[problem["document"]], problem["kind"], problem.get("claim") or ""
    rows = {row["key"]: row for row in (rec or {}).get("rows") or []}
    if kind == "skill":
        return f"{who} named {claim}; your records do not mention it."
    if kind == "level":
        return f"{who} claimed “{claim}”; your records do not state that level."
    if kind == "years":
        return f"{who} claimed {claim}; your records support about {problem.get('supported', 0)}."
    if kind == "attribution":
        where = ", ".join(_where(rows[k]) for k in problem.get("where", []) if k in rows)
        return f"{who} put {claim} under the wrong job; your records name it only at {where or 'other jobs'}."
    if kind == "evidence" and problem.get("term"):
        return (f"{who} named {claim}, which your records show only at {problem.get('where')} "
                f"({problem.get('span') or 'dates not recorded'}), not in your work most relevant to this job.")
    if kind == "evidence":
        return f"{who} drew on {claim} ({problem.get('span') or 'dates not recorded'}), not one of your roles most relevant to this job."
    if problem.get("employer") is False:
        return f"{who} listed {claim}, an employer your records do not hold."
    return f"{who} gave you the title “{claim}”, which your records do not hold."
