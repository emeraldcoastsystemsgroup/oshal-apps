#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1   | maintainer@emeraldcoastsystemsgroup.com   | Lane QUANTLIB1 (Roger, 2026-11-17: "does the quant have finance books and finance research papers loaded in its rag"): build the quant library shelf that Print Inbox files into the engine's knowledge rail. Full text only where the licence read on the official page at build time allows commercial reuse (CC BY, CC BY-SA, CC0); every other work is a record plus a summary in our own words. Every passage starts with its citation line (title, authors, year, licence, link, section or page) because recall shows the model the passage text only.
"""Build the quant library shelf.

Usage: python3 -I build_shelf.py <shelf-dir> <cache-dir> [--offline]

Reads <shelf-dir>/sources.json and <shelf-dir>/classics.json, fetches each openly licensed source once into
<cache-dir> (re-runs read the cache; --offline refuses anything not cached), and writes works.json,
documents.jsonl and shelf.json into <shelf-dir>. Each document is at most 450 words, so the kernel's chunker
(500-word windows) keeps it whole and every chunk carries its own citation line.
"""
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UA = "Mozilla/5.0 (compatible; quant-library-builder/1.0)"
BODY_WORDS = 360
MAX_WORDS = 450
WIKI_API = "https://en.wikipedia.org/w/api.php"
AUDIENCE = {"app": "intelligent-trades", "name": "trading-concierge", "agentId": "4f8a1e72-3c59-4b8d-9e41-7206c8a31f4e"}
SKIP_SECTIONS = re.compile(
    r"^(see also|references|notes|further reading|external links|bibliography|citations|sources|literature|"
    r"acknowledg|funding|author contributions|competing interests|conflicts? of interest|data availability|"
    r"supporting information|supplementary|appendix|footnotes|abbreviations|declarations|code availability)",
    re.I,
)
IDEAS = [
    "expected value", "random walk", "square-root-of-time rule", "bell curve (normal distribution)",
    "returns (simple, log, compounding)", "present value", "volatility", "Sharpe ratio", "volatility drag",
    "correlation", "diversification", "efficient frontier", "beta", "CAPM", "Kelly criterion",
    "Monte Carlo simulation", "fat tails", "value at risk", "backtesting", "linear regression",
    "hypothesis testing", "mean reversion", "momentum", "value factor", "size factor", "Fama-French three-factor",
    "low-volatility anomaly", "factor model", "Black-Scholes", "implied volatility", "put-call parity",
    "delta hedging", "the Greeks", "order book spread", "binomial option pricing", "volatility smile", "GARCH",
    "GJR-GARCH", "volatility targeting", "risk parity", "Black-Litterman", "arbitrage pricing theory",
    "statistical arbitrage", "backtest overfitting", "market maker", "market-maker inventory risk",
    "informed traders vs market makers", "market makers set the spread", "market impact", "Kalman filter",
]
_last_fetch: dict = {}
OFFLINE = "--offline" in sys.argv


def licence_of(url: str) -> dict:
    """Name a licence URL and say whether it allows storing the full text in a commercial product."""
    match = re.search(r"creativecommons\.org/(licenses/([a-z-]+)/([0-9.]+)|publicdomain/(zero|mark)/([0-9.]+))", url or "")
    if not match:
        return {"name": "unknown", "url": url, "allowsFullText": False}
    if match.group(4):
        name = "CC0 " + match.group(5) if match.group(4) == "zero" else "Public Domain Mark " + match.group(5)
        return {"name": name, "url": "https://creativecommons.org/" + match.group(1) + "/", "allowsFullText": True}
    kind, version = match.group(2), match.group(3)
    allowed = kind in ("by", "by-sa")
    return {"name": "CC " + kind.upper() + " " + version, "url": f"https://creativecommons.org/licenses/{kind}/{version}/",
            "allowsFullText": allowed}


def fetch(url: str, cache: Path) -> bytes:
    """One polite GET, kept in the cache so a rebuild reads the same bytes."""
    key = hashlib.sha256(url.encode()).hexdigest()[:32]
    path = cache / key
    if path.exists():
        return path.read_bytes()
    if OFFLINE:
        raise SystemExit(f"not cached (offline): {url}")
    data = polite_get(url)
    path.write_bytes(data)
    (cache / (key + ".url")).write_text(url + "\n")
    return data


def polite_get(url: str) -> bytes:
    """GET with a pause per host and a backoff when a site asks us to slow down (HTTP 429 or 503)."""
    host = urllib.parse.urlsplit(url).netloc
    for attempt in range(6):
        wait = 3.0 - (time.time() - _last_fetch.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last_fetch[host] = time.time()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 503) or attempt == 5:
                raise
            time.sleep(int(error.headers.get("Retry-After") or 0) or 15 * (attempt + 1))
    raise SystemExit(f"gave up on {url}")


def words(text: str) -> int:
    return len(text.split())


def sentences(text: str) -> list:
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])", text) if s.strip()]


def pieces(text: str) -> list:
    """A paragraph longer than one passage body, cut at sentence ends."""
    if words(text) <= BODY_WORDS:
        return [text]
    out, current = [], []
    for sentence in sentences(text):
        if current and words(" ".join(current + [sentence])) > BODY_WORDS:
            out.append(" ".join(current))
            current = []
        current.append(sentence)
        while words(" ".join(current)) > BODY_WORDS:
            head = current[0].split()
            out.append(" ".join(head[:BODY_WORDS]))
            current = [" ".join(head[BODY_WORDS:])] + current[1:]
            current = [c for c in current if c.strip()]
    if current:
        out.append(" ".join(current))
    return out


def passages(paragraphs: list, budget: int) -> list:
    """Group (section, page, text) paragraphs into passage bodies of at most BODY_WORDS, within a work's budget.

    A passage may run across a section boundary; it keeps every section it covers and its first and last page.
    """
    out, current, used = [], None, 0

    def close():
        if current and current["text"]:
            out.append((current["sections"], current["pages"], "\n\n".join(current["text"])))

    for sec, pg, text in paragraphs:
        for piece in pieces(text):
            if used + words(piece) > budget:
                close()
                return out
            if current and words("\n\n".join(current["text"] + [piece])) > BODY_WORDS:
                close()
                current = None
            if current is None:
                current = {"sections": [], "pages": [], "text": []}
            if sec and sec not in current["sections"]:
                current["sections"].append(sec)
            if pg and pg not in current["pages"]:
                current["pages"].append(pg)
            current["text"].append(piece)
            used += words(piece)
    close()
    return out


def short_authors(authors: list) -> str:
    if len(authors) <= 2:
        return " and ".join(authors)
    return authors[0] + " et al."


def topics(ideas: list) -> str:
    return "; ".join(IDEAS[i - 1] for i in sorted(set(ideas)) if 1 <= i <= len(IDEAS))


def header(work: dict, section, page) -> str:
    """The citation line every passage starts with; recall shows the model this text and nothing else."""
    names = [name[:80] for name in (section or [])][:3]
    where = ("Sections: " if len(names) > 1 else "Section: ") + "; ".join(names) if names else "Section: whole record"
    if page:
        where += f", p. {page[0]}" if len(page) == 1 else f", pp. {page[0]}-{page[-1]}"
    cite = f"\"{work['title']}\" by {short_authors(work['authors'])} ({work['year']}), {work['venue']}"
    if work["kind"] == "summary":
        return (f"QUANT LIBRARY | SUMMARY in our own words (not the work's text) | {cite} | Licence of the work: "
                f"{work['licence']['name']}; this library keeps only a summary | Link: {work['link']} | "
                f"Topics: {topics(work['ideas'])}")
    return (f"QUANT LIBRARY | FULL TEXT excerpt | {cite} | Licence: {work['licence']['name']} "
            f"({work['licence']['url']}) | Link: {work['link']} | {where} | Topics: {topics(work['ideas'])}")


# ---------------------------------------------------------------------------------------------------------------
# Wikipedia (CC BY-SA 4.0, read from the site's own rights statement at build time)
# ---------------------------------------------------------------------------------------------------------------
def unwrap_math(text: str) -> str:
    """Wikipedia's plain extract carries each formula as {\\displaystyle ...}: keep the LaTeX, drop the wrapper."""
    out, i = [], 0
    marker = "{\\displaystyle"
    while True:
        j = text.find(marker, i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        depth, k = 0, j
        while k < len(text):
            depth += {"{": 1, "}": -1}.get(text[k], 0)
            k += 1
            if depth == 0:
                break
        out.append(" $" + text[j + len(marker):k - 1].strip() + "$ ")
        i = k
    return re.sub(r"[ \t]+", " ", "".join(out))


def wiki_paragraphs(extract: str) -> list:
    section, out = "Introduction", []
    for block in re.split(r"\n\s*\n|\n(?==+ )", extract):
        block = block.strip()
        heading = re.match(r"^(=+)\s*(.*?)\s*\1$", block.split("\n", 1)[0])
        if heading:
            section = heading.group(2)
            block = block.split("\n", 1)[1].strip() if "\n" in block else ""
        if not block or SKIP_SECTIONS.match(section):
            continue
        for para in block.split("\n"):
            para = unwrap_math(para).strip()
            if words(para) >= 8:
                out.append((section, None, para))
    return out


def wiki_rights(cache: Path) -> dict:
    query = urllib.parse.urlencode({"action": "query", "meta": "siteinfo", "siprop": "rightsinfo", "format": "json"})
    rights = json.loads(fetch(WIKI_API + "?" + query, cache))["query"]["rightsinfo"]
    licence = licence_of(rights["url"])
    licence["evidence"] = f"{WIKI_API}?{query} (rightsinfo: {rights.get('text')})"
    return licence


def wikipedia(entry: dict, cache: Path, rights: dict) -> tuple:
    query = urllib.parse.urlencode({"action": "query", "format": "json", "redirects": "1", "prop": "extracts|revisions",
                                    "explaintext": "1", "exsectionformat": "wiki", "rvprop": "ids|timestamp",
                                    "titles": entry["title"]})
    page = next(iter(json.loads(fetch(WIKI_API + "?" + query, cache))["query"]["pages"].values()))
    if "missing" in page:
        raise SystemExit(f"Wikipedia has no article {entry['title']}")
    revision = page["revisions"][0]
    link = "https://en.wikipedia.org/w/index.php?" + urllib.parse.urlencode({"title": page["title"],
                                                                           "oldid": revision["revid"]})
    work = {"id": "wikipedia-" + re.sub(r"[^a-z0-9]+", "-", page["title"].lower()).strip("-"),
            "title": page["title"], "authors": ["Wikipedia contributors"], "year": int(revision["timestamp"][:4]),
            "venue": f"Wikipedia, The Free Encyclopedia, revision {revision['revid']} of {revision['timestamp'][:10]}",
            "link": link, "doi": None, "kind": "full-text", "licence": rights, "ideas": entry["ideas"],
            "changes": "plain-text extract; formulas kept as LaTeX; references and later sections omitted; split into passages"}
    return work, passages(wiki_paragraphs(page["extract"]), entry["maxWords"])


# ---------------------------------------------------------------------------------------------------------------
# QuantEcon lectures (CC BY-SA 4.0, read from each lecture page's footer at build time)
# ---------------------------------------------------------------------------------------------------------------
DROP_FENCES = re.compile(r"^(```|~~~|:::)\{?(code-cell|code-block|code|raw|figure|image|include|solution|exercise-start|"
                         r"only|glue|list-table|toctree|literalinclude|div)")


def myst_inline(line: str) -> str:
    line = re.sub(r"\{(cite|cite:p|cite:t|footcite)\}`[^`]*`", "", line)
    line = re.sub(r"\{(ref|doc|numref)\}`([^`<]*?)\s*<[^`]*>`", r"\2", line)
    line = re.sub(r"\{doc\}`[^`]*`", "a related lecture", line)
    line = re.sub(r"\{(ref|numref|eq)\}`[^`]*`", "", line)
    line = re.sub(r"\{(math)\}`([^`]*)`", r"$\2$", line)
    line = re.sub(r"\{(index|term|abbr)\}`([^`]*)`", r"\2", line)
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)
    line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)
    return re.sub(r"`([^`]*)`", r"\1", line).strip()


def myst_paragraphs(text: str) -> list:
    text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
    section, out, buffer, fence = "Introduction", [], [], None

    def flush():
        para = " ".join(myst_inline(line) for line in buffer).strip()
        boilerplate = re.search(r"will need the following librar|start with some imports|following imports", para, re.I)
        if words(para) >= 8 and not boilerplate and not SKIP_SECTIONS.match(section):
            out.append((section, None, para))
        buffer.clear()

    for line in text.split("\n"):
        if fence:
            if line.startswith(fence):
                fence = None
            continue
        if DROP_FENCES.match(line):
            flush()
            fence = line[:3]
            continue
        if re.match(r"^(```|:::)", line) or re.match(r"^\(.*\)=\s*$|^\+\+\+|^%|^:[a-z-]+:", line):
            continue
        heading = re.match(r"^(#+)\s+(.*)$", line)
        if heading:
            flush()
            section = myst_inline(heading.group(2)).strip("* ")
            continue
        if not line.strip():
            flush()
            continue
        buffer.append(line.strip())
    flush()
    return out


def quantecon(entry: dict, cache: Path) -> tuple:
    page = fetch(entry["site"], cache).decode("utf-8", "replace")
    found = re.search(r"creativecommons\.org/licenses/[a-z-]+/[0-9.]+", page)
    licence = licence_of(found.group(0) if found else "")
    licence["evidence"] = f"{entry['site']} (page footer)"
    title = re.search(r"<title>(.*?)</title>", page, re.S)
    full = html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).strip() if title else entry["lecture"]
    lecture, _, book = full.partition(" \u2014 ")
    path = f"lectures/{entry['lecture']}.md"
    commits = json.loads(fetch(f"https://api.github.com/repos/QuantEcon/{entry['repo']}/commits?"
                               + urllib.parse.urlencode({"path": path, "per_page": 1}), cache))
    sha, date = commits[0]["sha"], commits[0]["commit"]["committer"]["date"]
    source = fetch(f"https://raw.githubusercontent.com/QuantEcon/{entry['repo']}/{sha}/{path}", cache)
    work = {"id": "quantecon-" + entry["lecture"].replace("_", "-"), "title": re.sub(r"^\d+\.\s*", "", lecture),
            "authors": ["Thomas J. Sargent", "John Stachurski"], "year": int(date[:4]),
            "venue": f"{book or 'QuantEcon lectures'} (QuantEcon), {path} at {sha[:12]} of {date[:10]}",
            "link": entry["site"], "doi": None, "kind": "full-text", "licence": licence, "ideas": entry["ideas"],
            "changes": "prose and formulas kept; code cells, figures and exercises omitted; split into passages"}
    return work, passages(myst_paragraphs(source.decode("utf-8", "replace")), entry["maxWords"])


# ---------------------------------------------------------------------------------------------------------------
# Journal articles in JATS XML (PLOS, Frontiers, Europe PMC): the licence is read from the article's own XML
# ---------------------------------------------------------------------------------------------------------------
def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def text_of(node) -> str:
    return re.sub(r"\s+", " ", "".join(node.itertext())).strip()


def find_all(node, name: str) -> list:
    return [child for child in node.iter() if local(child.tag) == name]


def jats_meta(root) -> dict:
    title = find_all(root, "article-title")
    metas = find_all(root, "article-meta") or [root]
    authors = []
    for contrib in find_all(metas[0], "contrib"):
        if contrib.get("contrib-type") in ("author", None):
            given, surname = find_all(contrib, "given-names"), find_all(contrib, "surname")
            if surname:
                authors.append(" ".join(filter(None, [text_of(given[0]) if given else "", text_of(surname[0])])))
    years = [text_of(y) for date in find_all(metas[0], "pub-date") for y in find_all(date, "year") if text_of(y).isdigit()]
    journal = find_all(root, "journal-title")
    doi = [text_of(a) for a in find_all(root, "article-id") if a.get("pub-id-type") == "doi"]
    hrefs = [v for n in find_all(root, "license") for k, v in n.attrib.items() if local(k) == "href"]
    hrefs += [text_of(n) for n in find_all(root, "license_ref")]
    hrefs += [text_of(n) for n in find_all(root, "license-p") if "creativecommons" in text_of(n)]
    return {"title": text_of(title[0]) if title else "", "authors": authors, "year": int(years[0]) if years else None,
            "journal": text_of(journal[0]) if journal else "", "doi": doi[0] if doi else None,
            "licence": next((h for h in hrefs if "creativecommons" in h), "")}


def jats_paragraphs(root) -> list:
    out = []
    for abstract in find_all(root, "abstract")[:1]:
        for para in find_all(abstract, "p"):
            out.append(("Abstract", None, text_of(para)))
    bodies = find_all(root, "body")
    if not bodies:
        return out

    def walk(node, section):
        for child in node:
            name = local(child.tag)
            if name == "sec":
                titles = [c for c in child if local(c.tag) == "title"]
                walk(child, text_of(titles[0]) if titles else section)
            elif name == "p" and not SKIP_SECTIONS.match(section or ""):
                para = text_of(child)
                if words(para) >= 8:
                    out.append((section, None, para))

    walk(bodies[0], "Introduction")
    return out


def jats(entry: dict, cache: Path) -> tuple:
    raw = fetch(entry["url"], cache).decode("utf-8", "replace")
    raw = re.sub(r"<!DOCTYPE[^>]*>", "", raw)
    root = ET.fromstring(raw.encode("utf-8"))
    meta = jats_meta(root)
    licence = licence_of(meta["licence"])
    licence["evidence"] = f"{entry['url']} (the article's own license element)"
    work = {"id": entry["id"], "title": meta["title"], "authors": meta["authors"], "year": meta["year"],
            "venue": meta["journal"], "link": entry["landing"], "doi": meta["doi"], "kind": "full-text",
            "licence": licence, "ideas": entry["ideas"],
            "changes": "abstract and body text kept; tables, figures and references omitted; split into passages"}
    return work, passages(jats_paragraphs(root), entry["maxWords"])


# ---------------------------------------------------------------------------------------------------------------
# PDFs (arXiv with a Creative Commons licence on the abstract page; a journal PDF whose Crossref record carries one)
# ---------------------------------------------------------------------------------------------------------------
HEADING = re.compile(r"^(abstract|introduction|conclusions?|discussion|(\d+(\.\d+)*|[IVX]+\.?)\s+[A-Z][^.]{2,80})$", re.I)
STOP = re.compile(r"^(references|bibliography|acknowledge?ments?)\s*$", re.I)
INLINE_HEADING = re.compile(r"^((?:[IVX]+|\d+(?:\.\d+)*)\.?\s+[A-Z][A-Z \-:,]{3,70}?)\s+(?=[A-Z][a-z])")


def pdf_paragraphs(pdf: bytes, cache: Path) -> list:
    if not pdf.startswith(b"%PDF"):
        raise SystemExit("a PDF source answered with something that is not a PDF")
    path = cache / (hashlib.sha256(pdf).hexdigest()[:32] + ".pdf")
    path.write_bytes(pdf)
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", str(path), "-"], check=True, capture_output=True).stdout
    out, section = [], "Abstract"
    for number, page in enumerate(text.decode("utf-8", "replace").split("\f"), start=1):
        for block in re.split(r"\n\s*\n", page):
            lines = [line.strip() for line in block.split("\n") if line.strip()]
            if not lines:
                continue
            if len(lines) == 1 and STOP.match(lines[0]):
                return out
            if len(lines) == 1 and HEADING.match(lines[0]):
                section = lines[0]
                continue
            para = re.sub(r"-\s+(?=[a-z])", "", " ".join(lines))
            inline = INLINE_HEADING.match(para)
            if inline:
                section, para = inline.group(1).strip(), para[inline.end():]
            if words(para) >= 25:
                out.append((section, number, para))
    return out


def arxiv(entry: dict, cache: Path) -> tuple:
    abstract = fetch(f"https://arxiv.org/abs/{entry['arxiv']}", cache).decode("utf-8", "replace")
    found = re.search(r"creativecommons\.org/(licenses/[a-z-]+/[0-9.]+|publicdomain/zero/[0-9.]+)", abstract)
    licence = licence_of(found.group(0) if found else "")
    licence["evidence"] = f"https://arxiv.org/abs/{entry['arxiv']} (licence link on the abstract page)"
    version = re.search(re.escape(entry["arxiv"]) + r"(v\d+)", abstract)
    work = {"id": entry["id"], "title": entry["title"], "authors": entry["authors"], "year": entry["year"],
            "venue": entry["venue"] + f", arXiv:{entry['arxiv']}{version.group(1) if version else ''}",
            "link": f"https://arxiv.org/abs/{entry['arxiv']}", "doi": None, "kind": "full-text", "licence": licence,
            "ideas": entry["ideas"], "changes": "text extracted from the PDF; references omitted; split into passages"}
    pdf = fetch(f"https://arxiv.org/pdf/{entry['arxiv']}", cache)
    return work, passages(pdf_paragraphs(pdf, cache), entry["maxWords"])


def crossref_pdf(entry: dict, cache: Path) -> tuple:
    record = json.loads(fetch(f"https://api.crossref.org/works/{entry['doi']}", cache))["message"]
    urls = [item.get("URL", "") for item in record.get("license", [])]
    licence = licence_of(next((u for u in urls if "creativecommons" in u), ""))
    licence["evidence"] = f"https://api.crossref.org/works/{entry['doi']} (publisher's licence record)"
    work = {"id": entry["id"], "title": entry["title"], "authors": entry["authors"], "year": entry["year"],
            "venue": entry["venue"], "link": f"https://doi.org/{entry['doi']}", "doi": entry["doi"],
            "kind": "full-text", "licence": licence, "ideas": entry["ideas"],
            "changes": "text extracted from the publisher's PDF (archived copy); references omitted; split into passages"}
    return work, passages(pdf_paragraphs(fetch(entry["pdf"], cache), cache), entry["maxWords"])


# ---------------------------------------------------------------------------------------------------------------
# Records with a summary in our own words (copyrighted classics, NonCommercial texts)
# ---------------------------------------------------------------------------------------------------------------
def record(entry: dict, licence_name: str, licence_url) -> tuple:
    work = {"id": entry["id"], "title": entry["title"], "authors": entry["authors"], "year": entry["year"],
            "venue": entry["venue"], "link": entry.get("link") or (f"https://doi.org/{entry['doi']}" if entry.get("doi")
                                                               else None),
            "doi": entry.get("doi"), "kind": "summary",
            "licence": {"name": licence_name, "url": licence_url, "allowsFullText": False,
                        "evidence": "the work is not openly licensed for commercial reuse; only our summary is kept"},
            "ideas": entry["ideas"], "changes": "summary written for this library; no text of the work is stored"}
    return work, [([], [], entry["summary"])]


# ---------------------------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------------------------
def clean(text: str) -> str:
    """Plain spaces and newlines only, so every counter (Python, JavaScript, the kernel's chunker) agrees on words."""
    text = re.sub(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]", " ", text)
    return re.sub(r"[^\S\n]+", " ", text).strip()


def documents_of(work: dict, bodies: list) -> list:
    if not bodies:
        raise SystemExit(f"{work['id']}: no text was extracted")
    out = []
    for ordinal, (section, page, body) in enumerate(bodies, start=1):
        text = clean(header(work, section, page) + "\n\n" + body)
        if words(text) > MAX_WORDS:
            raise SystemExit(f"{work['id']}#{ordinal}: {words(text)} words exceed one kernel chunk")
        out.append({"id": f"{work['id']}#{ordinal}", "work": work["id"], "section": "; ".join(section or []) or None,
                    "page": (page[0] if len(page) == 1 else f"{page[0]}-{page[-1]}") if page else None,
                    "kind": work["kind"], "licence": work["licence"]["name"], "words": words(text), "text": text})
    return out


def check_licence(work: dict) -> None:
    """Full text needs an allowing licence read at build time; the rail serves commercial installations too."""
    if work["kind"] == "full-text" and not work["licence"]["allowsFullText"]:
        raise SystemExit(f"{work['id']}: licence {work['licence']['name']} does not allow storing its full text")
    if not work.get("link"):
        work["link"] = "(no stable public link)"


def collect(sources: dict, classics: list, cache: Path) -> list:
    rights = wiki_rights(cache)
    built = [wikipedia(entry, cache, rights) for entry in sources["wikipedia"]]
    built += [quantecon(entry, cache) for entry in sources["quantecon"]]
    built += [jats(entry, cache) for entry in sources["jats"]]
    built += [arxiv(entry, cache) for entry in sources["arxiv"]]
    built += [crossref_pdf(entry, cache) for entry in sources.get("crossrefPdf", [])]
    built += [record(entry, entry["licenceName"], entry["licenceUrl"]) for entry in sources["records"]]
    built += [record(entry, "copyright of its publisher or authors (not openly licensed)", None) for entry in classics]
    return built


def main() -> None:
    shelf, cache = Path(sys.argv[1]), Path(sys.argv[2])
    cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads((shelf / "sources.json").read_text())
    classics = json.loads((shelf / "classics.json").read_text())
    works, documents = [], []
    for work, bodies in collect(sources, classics, cache):
        check_licence(work)
        made = documents_of(work, bodies)
        work["documents"] = len(made)
        works.append(work)
        documents.extend(made)
    ids = [work["id"] for work in works]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate work ids")
    covered = {idea for work in works for idea in work["ideas"]}
    missing = sorted(set(range(1, len(IDEAS) + 1)) - covered)
    if missing:
        raise SystemExit(f"ideas without a source: {missing}")
    estimate = sum(len(doc["text"].encode()) + 6800 for doc in documents)
    if len(documents) > 2048 or estimate > 7 * 1024 * 1024:
        raise SystemExit(f"{len(documents)} passages, about {estimate} bytes: over one collection's quota")
    write(shelf, sources, works, documents, estimate)


def write(shelf: Path, sources: dict, works: list, documents: list, estimate: int) -> None:
    (shelf / "works.json").write_text(json.dumps(works, ensure_ascii=False, indent=1) + "\n")
    with (shelf / "documents.jsonl").open("w") as handle:
        for doc in documents:
            handle.write(json.dumps(doc, ensure_ascii=False) + "\n")
    full = [w for w in works if w["kind"] == "full-text"]
    summary = {"shelf": sources["shelf"], "owner": "print-ingest", "collection": sources["shelf"],
               "audience": AUDIENCE, "destination": "bot:" + AUDIENCE["agentId"], "policy": sources["policy"],
               "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "counts": {"works": len(works), "fullText": len(full), "summaries": len(works) - len(full),
                          "documents": len(documents), "estimatedCollectionBytes": estimate},
               "licences": sorted({w["licence"]["name"] for w in works})}
    (shelf / "shelf.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps(summary["counts"]), summary["licences"])


if __name__ == "__main__":
    main()
