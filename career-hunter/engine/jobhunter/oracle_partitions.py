# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read capped Oracle searches through the board's own facets and US state suggestions, retaining a shared request budget and proving coverage against the whole board's stated count.
"""Additional anonymous searches for an Oracle board with a capped result window."""
import re

from .geo import STATES

SEARCH_CAP = 10000
FACETS = {
    "locationsFacet": "selectedLocationsFacet",
    "categoriesFacet": "selectedCategoriesFacet",
    "titlesFacet": "selectedTitlesFacet",
    "workLocationsFacet": "selectedWorkLocationsFacet",
    "organizationsFacet": "selectedOrganizationsFacet",
    "workplaceTypesFacet": "selectedWorkplaceTypesFacet",
}


def _candidate(parameter, value):
    if not isinstance(value, dict):
        return None
    key, count = str(value.get("Id") or ""), value.get("TotalCount")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", key) or type(count) is not int or not 0 < count < SEARCH_CAP:
        return None
    return parameter, key, count


def _states(walk, metadata):
    if not any(str(value.get("Name", "")).endswith("United States") for value in metadata.get("locationsFacet", []) if isinstance(value, dict)):
        return []
    found = []
    for code, (name, *_coordinates) in STATES.items():
        if walk.budget[0] <= 0:
            break
        walk.page(0, extra={"userTargetFacetName": "LOCATIONS", "userTargetFacetInputTerm": code}, limit=1)
        for value in walk.last.get("locationsFacet", []):
            if str(value.get("Name", "")).casefold() in (f"{code}, United States".casefold(), f"{name}, United States".casefold()):
                hit = _candidate("selectedLocationsFacet", value)
                if hit:
                    found.append(hit)
    return found


def read_large(walk, metadata):
    """Union actual requisitions; facet counts select searches but never prove whole-board coverage."""
    candidates = _states(walk, metadata)
    for field, parameter in FACETS.items():
        candidates.extend(hit for value in metadata.get(field, []) if (hit := _candidate(parameter, value)))
    ordered = sorted(set(candidates), key=lambda value: (value[0] != "selectedLocationsFacet", -value[2]))
    for parameter, key, _count in ordered:
        if walk.total and len(walk.jobs) == walk.total:
            break
        if walk.budget[0] <= 0:
            walk.reason = "page_limit_reached"
            break
        child = walk.fork({parameter: key})
        feed = child.read()
        walk.jobs.update((row["ats_job_id"], row) for row in feed)
        if feed.reason in ("http_refused", "invalid_feed_rows"):
            walk.reason = feed.reason
    return walk.feed()
