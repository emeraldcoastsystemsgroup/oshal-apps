# Offline location search data

Local job search resolves a town and state, a five-digit ZIP area, or explicitly supplied
coordinates. No runtime geocoder or employer headquarters lookup is used.

## Towns

`engine/jobhunter/data/us_cities.tsv` is the existing engine's US Census places table:
64,532 state/name aliases, with the same normalized city keys used during ingestion.
The resolver reuses it directly. Town input requires a state; it never chooses an
arbitrary Springfield or substitutes a state center. Full state names work after a
comma; two-letter states also work without a comma. `Eglin Air Force Base, FL` resolves
the dataset's `a regional federal hub` alias. Town coordinates and posting coordinates represent city
centroids, not precise workplaces or street addresses.

## ZIP areas

`engine/jobhunter/data/us_zcta_2025.tsv` contains 33,791 records derived from the
[US Census Bureau's 2025 national ZCTA Gazetteer archive](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip),
listed on the [official 2025 Gazetteer page](https://www.census.gov/geographies/reference-files/2025/geo/gazetter-file.html).
Only `GEOID`, `INTPTLAT` and `INTPTLONG` are retained, separated by tabs, without a header.
Five-digit identifiers retain leading zeros. Original archive SHA-256, source member,
derived-file SHA-256 and record count are recorded in `us_zcta_2025.source.json`.

A [ZCTA](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html)
approximates a ZIP delivery area; this is not a complete USPS ZIP directory. The point is
the Census area's internal point, not a person's address. An absent ZIP yields a clear
refusal and suggests a town/state or explicit coordinates. It does not fall back to
national results.

To reproduce the TSV from the recorded archive, read `2025_Gaz_zcta_national.txt`
with Python `csv.DictReader(..., delimiter='|')`, strip field whitespace, and write
`GEOID + '\t' + INTPTLAT + '\t' + INTPTLONG + '\n'` for each record in source order.
Verify both hashes against the source record before changing a bundled snapshot.

## Browse contract

`GET /browse` accepts either `near=Town, ST` / `near=12345`, or both `lat` and `lon`.
Supplying both forms is refused. `radius_miles` defaults to 25 and must be 1–250;
a radius without a center is refused. Optional `city` is an exact normalized posting-city
filter. Invalid location parameters return HTTP400 with `invalid_location`.

The response `location` is null for an ordinary nationwide query, or contains `center`
(`lat`, `lon`), `label`, `radius_miles` and `accuracy` (`city-centroid`,
`zcta-internal-point`, or `coordinates`). Job cards include the original `city`, `lat`,
`lon`, `salary_source` and `distance_miles` (null without a center).

Distance is a spherical great-circle estimate in miles. A conservative latitude/longitude
bounding box, including pole/date-line handling, precedes exact Haversine filtering.
Both filters run inside SQL before every bounded candidate arm and before pagination.
Rows without valid coordinates and a real city key cannot qualify for radius results;
company HQ and state centers do not fill missing coordinates.

`idx_corpus_geo (active, lat, lon, city)` prevents a radius query from reading the corpus's
large inline descriptions outside the candidate area. The engine creates this index on
writable ingest copies through `GEO_INDEX_SQL`; older read-only snapshots remain usable
for ordinary browse. Radius requests lacking that exact index return HTTP503 with
`geo_index_unavailable`. Provision it through the corpus writer before acceptance; never
turn the shared corpus writable inside a native read sandbox.

`min_pay` retains existing semantics. `include_unknown_pay=1` also permits rows where
both salary endpoints are null. A published or estimated salary below the requested
minimum does not become unknown pay. `salary_source` lets the surface distinguish listed
pay from estimates; this change does not annualize or otherwise reinterpret pay periods.

## Proof and limits

`tests/career-geo.test.mjs` uses real SQLite and the engine schema to cover exact radius,
all candidate paths, pagination, unknown coordinates, invalid inputs, ZIP integrity,
index plans and HTTP refusals. `career-geo-index-contract.py` checks the production
engine's writable/read-only behavior. The 50,001-row performance fixture proves an indexed
latitude-range plan; its timing is synthetic evidence, not a live-corpus latency claim.
