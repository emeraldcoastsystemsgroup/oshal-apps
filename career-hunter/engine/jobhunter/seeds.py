"""Company universe: the lists we pull postings from.

- DOW30: hardcoded (name, ticker, homepage).
- load_sp500() / load_nasdaq100(): scraped live from Wikipedia (names + tickers).
- BEST_TO_WORK: curated 'best companies to work for' style list (names only;
  `discover` resolves their ATS at runtime).
- seeds/companies_seed.json: optional hand-curated name -> {ats_type, ats_token}
  overrides so known companies scrape immediately without discovery.
"""
from __future__ import annotations
import json

from bs4 import BeautifulSoup

from . import http, db, config

# ── Dow Jones Industrial Average (30) ────────────────────────────────────────
DOW30 = [
    ("Apple", "AAPL", "https://www.apple.com"),
    ("Amgen", "AMGN", "https://www.amgen.com"),
    ("American Express", "AXP", "https://www.americanexpress.com"),
    ("Boeing", "BA", "https://www.boeing.com"),
    ("Caterpillar", "CAT", "https://www.caterpillar.com"),
    ("Salesforce", "CRM", "https://www.salesforce.com"),
    ("Cisco Systems", "CSCO", "https://www.cisco.com"),
    ("Chevron", "CVX", "https://www.chevron.com"),
    ("Goldman Sachs", "GS", "https://www.goldmansachs.com"),
    ("Home Depot", "HD", "https://www.homedepot.com"),
    ("Honeywell", "HON", "https://www.honeywell.com"),
    ("IBM", "IBM", "https://www.ibm.com"),
    ("Johnson & Johnson", "JNJ", "https://www.jnj.com"),
    ("JPMorgan Chase", "JPM", "https://www.jpmorganchase.com"),
    ("Coca-Cola", "KO", "https://www.coca-colacompany.com"),
    ("McDonald's", "MCD", "https://www.mcdonalds.com"),
    ("3M", "MMM", "https://www.3m.com"),
    ("Merck", "MRK", "https://www.merck.com"),
    ("Microsoft", "MSFT", "https://www.microsoft.com"),
    ("Nike", "NKE", "https://www.nike.com"),
    ("NVIDIA", "NVDA", "https://www.nvidia.com"),
    ("Procter & Gamble", "PG", "https://www.pg.com"),
    ("Sherwin-Williams", "SHW", "https://www.sherwin-williams.com"),
    ("Travelers", "TRV", "https://www.travelers.com"),
    ("UnitedHealth Group", "UNH", "https://www.unitedhealthgroup.com"),
    ("Visa", "V", "https://www.visa.com"),
    ("Verizon", "VZ", "https://www.verizon.com"),
    ("Walmart", "WMT", "https://www.walmart.com"),
    ("Disney", "DIS", "https://www.thewaltdisneycompany.com"),
    ("Amazon", "AMZN", "https://www.amazon.com"),
]

# Named lists (fortune_best / govcon / midsize) live in seeds/lists.json so they're
# easy to extend without touching code.
def _load_lists() -> dict:
    path = config.SEED_DIR / "lists.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


# Friendly aliases -> the key in lists.json
LIST_ALIASES = {"best": "fortune_best", "fortune": "fortune_best"}


def _wiki_table(url: str, name_col_hints, ticker_col_hints):
    """Parse the first sortable wikitable; return list of (name, ticker)."""
    r = http.get(url)
    if not r.ok:
        return []
    soup = BeautifulSoup(r.text, "lxml")
    table = soup.find("table", {"class": "wikitable"})
    if not table:
        return []
    headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]

    def col_index(hints):
        for i, h in enumerate(headers):
            if any(hint in h for hint in hints):
                return i
        return None

    ni = col_index(name_col_hints)
    ti = col_index(ticker_col_hints)
    rows = []
    for tr in table.find_all("tr")[1:]:
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        try:
            name = cells[ni].get_text(strip=True) if ni is not None else None
            ticker = cells[ti].get_text(strip=True) if ti is not None else None
        except IndexError:
            continue
        if name:
            rows.append((name, ticker))
    return rows


def load_sp500():
    return _wiki_table(
        "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        name_col_hints=["security", "company"],
        ticker_col_hints=["symbol", "ticker"],
    )


def load_nasdaq100():
    return _wiki_table(
        "https://en.wikipedia.org/wiki/Nasdaq-100",
        name_col_hints=["company"],
        ticker_col_hints=["ticker", "symbol"],
    )


def _load_curated_overrides():
    path = config.SEED_DIR / "companies_seed.json"
    if not path.exists():
        return {}
    return {c["name"]: c for c in json.loads(path.read_text(encoding="utf-8"))}


# Lists that come from code/live sources (not lists.json):
BUILTIN_LISTS = ["dow30", "sp500", "nasdaq100", "curated"]


def available_lists() -> list[str]:
    """All seedable list names = builtins + every key in lists.json + 'all'."""
    return BUILTIN_LISTS + list(_load_lists().keys()) + ["all"]


def seed_list(which: str) -> int:
    """Load a named list (or 'all') into the companies table. Returns companies touched."""
    which = LIST_ALIASES.get(which, which)
    overrides = _load_curated_overrides()
    json_lists = _load_lists()
    n = 0
    with db.connect() as conn:
        def add(name, ticker=None, homepage=None, industry=None, source=None):
            nonlocal n
            fields = {"source_list": source}
            if ticker:
                fields["ticker"] = ticker
            if homepage:
                fields["homepage"] = homepage
            if industry:
                fields["industry"] = industry
            ov = overrides.get(name)
            if ov:
                fields.update({k: ov[k] for k in ("ats_type", "ats_token", "homepage", "careers_url", "industry")
                               if k in ov})
                if ov.get("ats_type"):
                    fields["discover_status"] = "found"
            db.upsert_company(conn, name, **fields)
            n += 1

        targets = (BUILTIN_LISTS + list(json_lists.keys())) if which == "all" else [which]
        for t in targets:
            if t == "dow30":
                for name, ticker, hp in DOW30:
                    add(name, ticker, hp, source="dow30")
            elif t == "sp500":
                for name, ticker in load_sp500():
                    add(name, ticker, source="sp500")
            elif t == "nasdaq100":
                for name, ticker in load_nasdaq100():
                    add(name, ticker, source="nasdaq100")
            elif t == "curated":
                for name, ov in overrides.items():
                    add(name, ov.get("ticker"), ov.get("homepage"), ov.get("industry"), "curated")
            elif t in json_lists:                       # fortune_best / govcon / midsize
                for entry in json_lists[t]:
                    add(entry["name"], entry.get("ticker"), entry.get("homepage"),
                        entry.get("industry"), t)
    return n
