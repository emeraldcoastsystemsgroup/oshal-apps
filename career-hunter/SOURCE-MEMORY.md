# Source memory and pull health

The Companies administrator screen shows each employer's latest attempt, last confirmed complete pull, outcome,
consecutive unconfirmed attempts, and new/changed/unchanged/closed posting counts. Its summary and Unconfirmed pulls
filter distinguish failed, partial, empty and unfinished attempts. Zero jobs or an unresolved URL is not a recorded
pull failure. An older published corpus explicitly says history is unavailable; reading the screen never creates
tables, launches a pull or creates a personal Career database.

What happens to a source that keeps failing is covered in [the nightly source review](SOURCE-REVIEW.md).

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

Only a recognized complete, nonempty enumeration with valid, unique records may close absent postings. Workday's
search answers at most 2,000 jobs and reports `total` as 2000 however many exist, so a search at that cap is split by
facet until every job is read, and the result must reach the count the facets agree on. A board that cannot reach it
stays partial and closes nothing. Reviewed Greenhouse, Lever and Ashby JSON boards, and the reviewed PageUp and GovernmentJobs
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
hashes travel with that corpus. The source-memory schema itself needs no kernel change.

An ordinary native application request reads the published shared corpus. It must not start a second shared writer.
`GET /run/refresh` therefore reports `manualRefreshAvailable: false` and `refreshMode: installation-managed` on the
native host; `POST /run/refresh` refuses with a clear 409 before acknowledging any work. The installation's scheduled
ingest uses the new behavior after the package is installed. The legacy application-managed refresh path remains
subject to its existing administrator checks.

### A stopped pull continues

A full pull takes about 5 hours and a kernel release stops it, which happened three times on the night of 2026-11-03. A
stopped pull now continues from the last employer it finished. The most a restart costs is the employer being read,
which is up to about 49 minutes for Accenture, the largest.

- **The kernel keeps the private copy and goes on by itself.** A stopped kernel, a signal to the engine or the run's 8 hour
  ceiling leaves the copy in place, and the next run mounts that same copy. After a restart that is about a minute later. If
  the kernel stayed up (the memory watchdog killed the engine, or the ceiling passed), it continues after 5 minutes, and the
  wait doubles each time it stops again, up to about 5 hours, so something that fails at once is not retried every few seconds.
- **The engine records its place in that copy.** `pull_checkpoint.py` keeps `pull_checkpoint` and
  `pull_checkpoint_sources` in the corpus. An employer's jobs and the note that it is finished commit in one transaction,
  so a kill leaves both or neither. A kill mid-write rolls back and that employer is read again.
- **No flag passes between them.** A copy taken from a published corpus holds a finished pull, so the engine starts a new
  one. An old engine on a new kernel reads everything; a new engine on an old kernel never finds a stopped pull.

| It starts over when | Why |
|---|---|
| The engine itself exits with a failure | The copy is not trusted further. A signal, or a child killed by one, is an interruption and keeps it |
| The shared corpus changed since the copy | Publishing the copy would undo a maintenance edit or a restored corpus |
| The copy was cut short | The kernel marks a copy only once it is complete, in a file the engine cannot write |
| The stopped pull began 20 or more hours ago | Tonight's pull should read tonight's jobs. It reads everything again on the same copy, so nothing already read is lost |

An employer the pull was reading each time it stopped is tried 3 times, a count that survives the 20 hour limit. After that
the pull skips it, keeps its existing jobs and shows it as failed with `pull_interrupted`, so one employer cannot hold back
the rest. The skip adds nothing to its count of failures: restarts may simply have landed on it, and the source review treats
repeated failures as a reason to look for a new board. It is read normally the next night.

A failed or empty source counts as finished for that pull and is not tried again. The final `Scrape done:` line counts
every process and ends `Continued after N interruptions.`. The source review reports on the pull from its first start.
A stop during the review runs the review again, reading only what it had not recorded. `--limit`, `--company` and `--list`
keep no checkpoint and leave a stopped pull alone. Neither does PostgreSQL mode, which has no private copy. Run by hand on a
standalone install, `scrape --all` continues in the same way and says so; `scrape --all --fresh` reads every source instead.

### Changing a source

**Resolve** on the Companies page, and **Accept** on a suggestion in the source review, change where an employer's jobs come
from. On the native kernel a request mounts the shared corpus read-only, so the change takes effect at the next nightly pull.
The page says so, shows each change as waiting, and then shows what the pull did.

1. The route checks the input, leaves the change in `.source-request-outbox` in the caller's own store, keeps the caller's
   record in `source-requests-sent`, and answers 202. It starts no engine.
2. When the call succeeds, the kernel moves the change to `source-requests/` beside the corpus, only if the admission it
   verified holds `career.administer`. Otherwise the change is discarded. Who asked and when are stamped by the kernel, not
   taken from the package. The outbox is never published with the person's store. No request sandbox can reach the queue.
3. A pull is handed the 25 oldest changes waiting, in `JOBHUNTER_SOURCE_REQUESTS`, and applies them before it lists its sources,
   so a moved source is read that night and not read twice. `source_requests.py` records each outcome in the corpus table
   `source_requests`, the newest 200.
4. Only a publish removes those changes from the queue. A stopped pull keeps what it was handed, and a failed pull leaves the
   queue for the next one. A change handed over twice is applied once.

| What the page says | Outcome | What happened |
|---|---|---|
| Waiting for the next nightly pull | `waiting` | No pull has reached it. The caller sees this; another administrator sees it once a pull has |
| Applied | `applied` | The source moved and its jobs are in, with how many closed. It is marked `manual`, so the source review leaves a person's choice alone |
| The link was saved, but no jobs could be read | `saved_no_jobs` | The link is kept on the employer and the source did not change |
| That board returned no jobs | `no_jobs` | Nothing changed |
| Another employer already uses that board | `duplicate` | Nothing changed, in any letter case |
| Not a job board link | `bad_target` | Nothing changed |
| Leads to a private address | `unsafe` | Refused before anything reads it |
| Took more than 5 minutes | `timeout` | Nothing changed, and the next change still runs |
| The pull stopped 3 times while applying it | `interrupted` | Each try rolled back, so nothing changed. Press Resolve again |

The pull reads a change with the same public-addresses-only guard and 5 minute hard stop as the source review, because an
ordinary link can redirect anywhere and the pull runs on the host's network. A link, or a token that is one, is refused before
anything reads it unless every address it resolves to is public. A page read directly stays partial and closes nothing, as it
always has, and uses the browser only under its read policy. That policy does not see an HTTP redirect; see
[BACKLOG.md](BACKLOG.md).

A move onto a board whose feed is proven whole closes the employer's jobs that board does not list, and the page says how many.
**Undo** on the newest applied change saves a change back to the previous board. If that board no longer answers, the jobs stay
closed and the page says the board returned no jobs.

An installation that runs no pull (no `OSHAL_CAREER_INGEST_CRON`, as on a demo or SaaS kernel) refuses the change and says so,
because nothing would apply it. An installation with a writable corpus still resolves at once, with no queue and no **Accept**.

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

`tests/career-pull-checkpoint.test.mjs` runs `tests/career-pull-checkpoint.py`: a real process is really killed with
SIGKILL while reading, while writing and during the review, over real temporary SQLite, and the next process reads only
what the first did not finish. The kernel's half is proven in `crates/host-process/src/career_ingest_tests.rs` in the real
sandbox, and in `crates/oshald/tests/career_corpus_ingest.rs`, which kills the real binary mid-pull.

`tests/career-source-requests.test.mjs` runs `tests/career-source-requests.py`: a real full pull applies a change on real
temporary SQLite with recorded employer replies, and a real process is really killed while writing. The route's half is in
`tests/career-source-health.test.mjs` and the page's in `tests/browser/career-source-review-page-proof.mjs`. In the kernel,
`crates/host-process/tests/career_source_request_handover.rs` proves the hand-over in the real sandbox, and
`crates/oshald/tests/career_source_requests.rs` proves it through the real door with this package's real catalog and named
roles: a member is refused and queues nothing, an administrator's change is stamped by the kernel, and the corpus is untouched.

## Native generic careers pages (1.43.0, prepared)

The native Python dependency set intentionally excludes Python Playwright. Generic
`web` sources now dispatch to the dedicated Node 24/Playwright 1.59.1 reader instead
of failing on an unavailable Python import. This requires the matching native
kernel and an operator-staged `OSHAL_CAREER_INGEST_BROWSER_RUNTIME` bundle. The kernel
mounts only that immutable software bundle read-only; the engine and private corpus
copy retain their existing namespace boundaries. No applicant worker profile,
credential file, model provider or signed-in personal browser is involved.

`ops/stage_career_browser_runtime.py` in the kernel stages already installed exact
Playwright packages and a selected Chromium distribution, records the executable's
reported version and every file hash, and removes write and set-id bits. Delivery
must install its manifest guard alongside the existing core, Python, application
and platform guards. A configured invalid bundle refuses the pull. An absent
optional bundle leaves structured adapters usable and records
`browser_runtime_unavailable` for generic sources.

The fresh anonymous context captures job links, delayed JSON search responses and
embedded JSON/JSON-LD. Pagination follows safe Next/Load more controls beyond two
pages and stops at 80 pages or a two-minute source deadline. Only anonymous public
HTTPS GET/HEAD requests and narrowly recognized JSON search POSTs are admitted;
forms and mutations are refused. Password/challenge pages are observed without
entering credentials. DNS is screened for private addresses; the ingest still
uses the installation's existing network namespace policy, not a new network
proxy or a pinned-address transport.

Supplied job descriptions remain complete within the explicit capture limits;
missing descriptions remain unknown. Generic enumeration is always unconfirmed,
even when the final visible page has no Next control, and cannot close missing
postings. Login, challenge, page/response limits and failures use closed source
outcomes. A browser that overruns its hard process deadline terminates its process
group and the ingest namespace; the failed run publishes nothing.

The focused app cohort has 16 passing Node checks, including eight nested Python
adapter/database checks and nine actual browser checks. The real native sandbox
cohort has five passing checks, including explicitly enabled Chromium pagination
and hung-descendant cleanup. The two bundle admission units pass separately. None
of these tests accesses an employer or a personal Career store. The new Test Lab
recipe is a component proof; the native namespace proofs run in the kernel delivery
lane with their explicit runtime/checkout prerequisites.
