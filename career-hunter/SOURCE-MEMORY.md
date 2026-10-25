# Source memory and pull health

The Companies administrator screen shows each employer's latest attempt, last confirmed complete pull, outcome,
consecutive unconfirmed attempts, and new/changed/unchanged/closed posting counts. Its summary and Unconfirmed pulls
filter distinguish failed, partial, empty and unfinished attempts. Zero jobs or an unresolved URL is not a recorded
pull failure. An older published corpus explicitly says history is unavailable; reading the screen never creates
tables, launches a pull or creates a personal Career database.

## What is retained

The engine keeps shared `source_identity`, `source_pull_state`, `source_pull_runs`, `source_posting_hashes` and
`source_http_validators` tables in the same corpus as the postings. A company has one current outcome and at most
20 recent completed receipts. A new attempt is recorded before provider I/O. Provider refusal bodies, credentials,
request URLs and connector tokens are not copied into receipts. An interrupted process leaves an unfinished attempt,
not a successful receipt.

The source identity hashes the adapter, token and selected listing endpoint. Changing it clears old hashes,
validators and unlabelled source history. Existing postings remain visible until a newly verified complete feed
can establish which ones have closed.

Unchanged posting bodies are not rewritten. Stable employer job identifiers and normalized content hashes separate
new, changed and unchanged records. Freshness still advances. An adapter that supplies only listing metadata does
not erase a description previously fetched from a detail page. Missing salary remains unknown.

## Network deltas and complete listings

Greenhouse and Lever's reviewed whole-board GET endpoints retain ETag or Last-Modified validators when the server
supplies them. The next request to that same source sends the corresponding conditional header. HTTP 304 records
an unchanged successful check, preserves active jobs and advances freshness without parsing or downloading a new
listing body. Validators are not shared between companies, hosts, tokens or changed URLs.

When the server supplies no validator, the listing is fetched again and content hashes prevent redundant body writes.
This is delta processing, not a claim that every provider offers a network delta API. Paginated adapters do not use
the single-GET cache.

Only a recognized complete, nonempty enumeration with valid, unique records may close absent postings. Workday
checks its reported total. Reviewed Greenhouse, Lever and Ashby JSON boards, and the reviewed PageUp and GovernmentJobs
adapters, carry explicit completion evidence. Other legacy adapters remain unverified until their pagination is
reviewed. They can refresh received jobs, but cannot close missing jobs or establish a complete-pull receipt. Failed,
partial, malformed, repeated and ambiguous empty feeds retain existing jobs. Even an empty response marked complete
does not close every job in this release.

All existing engine write paths (nightly scrape, targeted URL/target intake, resolver, discovery runner and standalone
dashboard) use this shared ingestion guard. The CLI's source summary reports confirmed and unconfirmed employers
separately; completion of a process is not evidence that every source succeeded.

## Native installation boundary

The native kernel already invokes this package's engine as `python -m jobhunter scrape --all`. Its installation-owned
writer holds `.corpus-ingest.lock`, updates a writable corpus copy and publishes that copy. The new source tables and
hashes travel with that corpus. No kernel source change is required.

An ordinary native application request reads the published shared corpus. It must not start a second shared writer.
`GET /run/refresh` therefore reports `manualRefreshAvailable: false` and `refreshMode: installation-managed` on the
native host; `POST /run/refresh` refuses with a clear 409 before acknowledging any work. The installation's scheduled
ingest uses the new behavior after the package is installed. The legacy application-managed refresh path remains
subject to its existing administrator checks.

The existing Companies routes still require their authorization-catalog permission. Their inner gate accepts the
kernel-verified operator helper or the deployment's explicit Career administrator list; request fields and header
claims do not confer operator status. The shared administrator list does not require an uploaded resume or personal
signals database.

## Focused evidence

`tests/career-source-health.test.mjs` covers read-only history, absent history, the compiled administrator gate,
shared-list access without a personal store, and native refresh capability. It runs `tests/career-source-memory.py`
against temporary real SQLite, with recorded HTTP replies only: body-write tripwires, changed nullable fields,
source changes, conditional 304, no-validator fallback, paginated refusal, bounded receipts and retained 304 counts.
The engine's Python dependency pins must be available. These tests never pull or mutate the live corpus.
