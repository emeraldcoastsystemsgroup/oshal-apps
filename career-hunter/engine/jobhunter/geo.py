"""Map job locations for the geo map: parse a US state *and* a city out of
free-text locations. States get a centroid from STATES; cities are geocoded
against a bundled US Census places dataset (data/us_cities.tsv) so the dashboard
can plot real city points with no network/API at runtime."""
from __future__ import annotations
import csv
import re
from pathlib import Path

# state -> (name, lat, lon centroid)
STATES = {
    "AL": ("Alabama", 32.8, -86.8), "AK": ("Alaska", 64.0, -152.0), "AZ": ("Arizona", 34.2, -111.7),
    "AR": ("Arkansas", 34.9, -92.4), "CA": ("California", 37.2, -119.5), "CO": ("Colorado", 39.0, -105.5),
    "CT": ("Connecticut", 41.6, -72.7), "DE": ("Delaware", 39.0, -75.5), "DC": ("Washington DC", 38.9, -77.0),
    "FL": ("Florida", 28.6, -82.4), "GA": ("Georgia", 32.6, -83.4), "HI": ("Hawaii", 20.3, -156.4),
    "ID": ("Idaho", 44.4, -114.6), "IL": ("Illinois", 40.0, -89.2), "IN": ("Indiana", 39.9, -86.3),
    "IA": ("Iowa", 42.0, -93.5), "KS": ("Kansas", 38.5, -98.4), "KY": ("Kentucky", 37.5, -85.3),
    "LA": ("Louisiana", 31.0, -92.0), "ME": ("Maine", 45.4, -69.2), "MD": ("Maryland", 39.0, -76.8),
    "MA": ("Massachusetts", 42.3, -71.8), "MI": ("Michigan", 44.3, -85.4), "MN": ("Minnesota", 46.3, -94.3),
    "MS": ("Mississippi", 32.7, -89.7), "MO": ("Missouri", 38.4, -92.5), "MT": ("Montana", 47.0, -109.6),
    "NE": ("Nebraska", 41.5, -99.8), "NV": ("Nevada", 39.3, -116.6), "NH": ("New Hampshire", 43.7, -71.6),
    "NJ": ("New Jersey", 40.2, -74.7), "NM": ("New Mexico", 34.4, -106.1), "NY": ("New York", 42.9, -75.5),
    "NC": ("North Carolina", 35.6, -79.4), "ND": ("North Dakota", 47.5, -100.5), "OH": ("Ohio", 40.3, -82.8),
    "OK": ("Oklahoma", 35.6, -97.5), "OR": ("Oregon", 44.0, -120.5), "PA": ("Pennsylvania", 40.9, -77.8),
    "RI": ("Rhode Island", 41.7, -71.6), "SC": ("South Carolina", 33.9, -80.9), "SD": ("South Dakota", 44.4, -100.2),
    "TN": ("Tennessee", 35.9, -86.4), "TX": ("Texas", 31.5, -99.3), "UT": ("Utah", 39.3, -111.7),
    "VT": ("Vermont", 44.1, -72.7), "VA": ("Virginia", 37.5, -78.9), "WA": ("Washington", 47.4, -120.5),
    "WV": ("West Virginia", 38.6, -80.6), "WI": ("Wisconsin", 44.6, -89.9), "WY": ("Wyoming", 43.0, -107.5),
}
_FULLNAME = {name.lower(): abbr for abbr, (name, _, _) in STATES.items()}
_FULLNAME["washington, d.c."] = "DC"; _FULLNAME["washington d.c."] = "DC"; _FULLNAME["d.c."] = "DC"

_ABBR_RE = re.compile(r"(?:^|[,\s/(-])([A-Z]{2})(?:[,\s/)\-]|$)")
_REMOTE_RE = re.compile(r"\bremote\b|work from home|anywhere|telework", re.I)


def state_of(location: str):
    """Return a 2-letter US state for a free-text location, or None. Remote-only -> None."""
    if not location:
        return None
    # explicit 2-letter code (US-CO-Remote, 'Herndon, VA', 'USA WV Martinsburg')
    for m in _ABBR_RE.finditer(" " + location + " "):
        code = m.group(1).upper()
        if code in STATES:
            return code
    # full state name
    low = location.lower()
    for name, abbr in _FULLNAME.items():
        if re.search(r"\b" + re.escape(name) + r"\b", low):
            return abbr
    return None


def is_remote(location: str, remote_flag: int = 0) -> bool:
    return bool(remote_flag) or bool(location and _REMOTE_RE.search(location))


# ── city geocoding (offline, bundled US Census places) ───────────────────────
_STATE_ABBRS = {a.lower() for a in STATES}
_COUNTRY_TOKENS = {"us", "usa", "united states", "united states of america", "remote", "usa remote"}
_LEAD_COUNTRY_RE = re.compile(r"^(us|usa|united states( of america)?)\s+")
_CITY_LUT: dict[tuple[str, str], tuple[float, float]] | None = None


def _load_cities() -> dict[tuple[str, str], tuple[float, float]]:
    """Lazy-load the bundled (state, normalized-city) -> (lat, lon) table."""
    global _CITY_LUT
    if _CITY_LUT is None:
        lut: dict[tuple[str, str], tuple[float, float]] = {}
        path = Path(__file__).parent / "data" / "us_cities.tsv"
        with path.open(encoding="utf-8") as f:
            for st, city, lat, lon in csv.reader(f, delimiter="\t"):
                lut[(st, city)] = (float(lat), float(lon))
        _CITY_LUT = lut
    return _CITY_LUT


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s.lower())).strip()


def _city_candidates(location: str):
    """Yield normalized city-name candidates from a free-text location, most
    specific first. Splits on commas/slashes/dashes and drops country and
    leading state-code tokens (handles 'US-CA-San Francisco', 'USA Austin, TX')."""
    for part in re.split(r"[,/\\-]", location):
        c = _LEAD_COUNTRY_RE.sub("", _norm(part))
        toks = c.split()
        while toks and toks[0] in _STATE_ABBRS:   # strip leading 'CA', 'US' state codes
            toks.pop(0)
        c = " ".join(toks)
        if c and c not in _COUNTRY_TOKENS and c not in _STATE_ABBRS and not re.fullmatch(r"[a-z]{2}", c):
            yield c


def place_of(location: str, state: str | None):
    """Geocode a free-text location to a city within `state`.

    Returns (city_key, lat, lon) where city_key is the normalized matched name
    (stable, lowercase — good for grouping/filtering), or None if no city in the
    dataset matches. Callers fall back to the state centroid when this is None."""
    if not location or not state:
        return None
    lut = _load_cities()
    for city in _city_candidates(location):
        coord = lut.get((state, city))
        if coord:
            return (city, coord[0], coord[1])
    return None
