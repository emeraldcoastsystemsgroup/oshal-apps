# Nightly source review

Each full pull ends with a review of the sources it could not read. The review repairs what it can prove, suggests
what it cannot, and reports the rest on the **Companies** administrator page.

## Where it runs

The kernel's nightly ingest runs `python -m jobhunter scrape --all` on a private copy of the shared corpus and publishes
that copy when the process exits cleanly. The review runs at the end of that command, on the same copy. So what it finds
publishes with the pull, and it needs no schedule, host service or kernel change.

If the review fails, the error is written to the run's output and the pull still publishes. A partial pull (`--limit`,
`--company`, `--list`) does not start one. A process that cannot write the corpus skips it, as does PostgreSQL mode. A
restart during the review runs it again, reading only what it had not recorded; see
[a stopped pull continues](SOURCE-MEMORY.md#a-stopped-pull-continues).

To run it by hand against a corpus you can write: `python -m jobhunter source-review [--max-sources N]`. It prints the
report as one JSON line.

## What gets rechecked

- A source that read nothing, or failed, on 3 or more pulls in a row. One or two bad nights is usually the employer's
  site, not a moved board.
- An employer with no feed at all.

Never rechecked: a source that returned jobs, even partly, and anything a person chose by hand (`ats_type` of `manual`
or `multi`, or `discover_status` of `manual`).

Sources that have never been checked go first, then the longest since checked.

## When it changes a source

It moves a source only when all of these hold:

1. The employer's own stored `careers_url` or `homepage`, or a jobs link on the same site, points at a job board. A
   guessed homepage or a matching name is not evidence.
2. That is the only board on the page.
3. It is Greenhouse, Lever, Ashby or Workday. The vendor hosts these at a fixed address, and they can prove a whole feed.
   Moving to a feed that cannot be proven whole would leave the dead source's jobs open for good, and some other
   connectors take any host as their token, which would let a page name its own site as a job board.
4. The board returns jobs with titles right now, and the feed is proven whole.
5. The board's name looks like the employer's name or its own website. A link alone is not enough: footers and partner
   pages link to other companies' boards.
6. No other employer already holds that board, in any letter case.

The move and the new jobs land in one transaction, so a failure leaves the old source exactly as it was. Any job that
comes back in a feed is reopened by the normal pull. The report keeps the previous board. To undo a repair, paste the right
link into the employer's row on the Companies page and press **Resolve**, and the next pull moves it back.

## What it only suggests

These are reported and not applied:

- A board that only matches the employer's name. It could be anyone's: one existing source, Crown Castle, was found
  pointing at another company's board this way.
- A page with several boards.
- A board of any other type. These are named without being read, so no job count is shown.
- A live board whose feed cannot be proven whole, or whose name does not look like the employer's.

To accept a suggestion, press **Accept** beside the board you want on the report's list. The next pull moves the employer to
it and reads its jobs. See [changing a source](SOURCE-MEMORY.md#changing-a-source).

## Limits

| Limit | Value | Why |
|---|---|---|
| Sources a night | 150 | Measured at about 6 seconds a source, so the whole queue is covered in a few nights |
| Time a night | 20 minutes, a hard stop | The pull does not publish until the review ends |
| Time for one source | 5 minutes, a hard stop | A slow or hostile page costs that source and no more |
| Page read | First 2 MB | A page is only searched for links, and its size is the employer's choice |
| Recheck after nothing found | 7 days | Most of these are slow to change |
| Recheck after a refusal or unsafe link | 30 days | See below |
| Boards read per source | 3 | A page cannot make the review read many feeds; more than this is left for a person |
| Reports kept | 30 | The corpus is copied every night |

Sources are read one at a time, through the same per-host limit as the pull. One source failing or timing out is
recorded against that source and the next one still runs. The stops are a real alarm, which interrupts even a blocking
read, and an interrupted write rolls back so no journal is left to stop the kernel publishing. A board too large to read
inside 5 minutes is recorded as `timeout` and is not moved.

## How it behaves on the web

- **Refusals are respected.** HTTP 401, 403, 407, 429 or 451, or a short bot challenge page, ends the work on that source
  for 30 days. There is no retry, no other page, no name probe and no attempt to get past it.
- **Public addresses only.** A review follows links from pages it does not control, on a network that can reach local
  services. Every read and every redirect hop must go to a public address (`http.public_only`). A name with any loopback,
  private, link-local, shared or multicast answer, or one that does not resolve, is refused before connecting. The address
  actually connected to is checked again before any bytes are sent, so a name that changes its answer gains nothing.
- **No browser and no search.** It does not render pages or use the Google search that `discover` can use. It carries no
  person's data or credentials; the corpus it writes holds public job and employer data only.

## The report

The Companies page shows the newest report above the table, through the existing administrator list route, so it needs no
new route or permission. Before the first report the card is absent. An unreadable report says so, and the table still loads.

| Field | Meaning |
|---|---|
| `sources` | Verified whole, partly verified, reading nothing, failing, and no feed; `previousSources` is the last report's |
| `delta` | What the pull did: jobs read, new, changed, unchanged, closed, and sources that answered not modified |
| `review` | Sources checked and still waiting, and the outcomes: `repaired`, `suggested`, `duplicate`, `blocked`, `unsafe`, `timeout`, `nothing`, `error` |
| `massClosed` | A source that closed 50 or more jobs and at least half of those it had. It can be real, or a feed that stopped returning everything |
| `stuck` | A partly verified source that returned the same round count of 500 or more jobs three attempts running, which usually means a limit on how many it returns |
| `stillBroken` | The sources reading nothing or failing, longest first, up to 50 |

Reports are in the `source_review_runs` table of the corpus and the latest outcome per employer is in
`source_review_items`. Both are created by the review; a published corpus without them just has no card.

## What it does not do

- Find employers that are not in the corpus yet.
- Read a career page that only exists after JavaScript runs. The review reports these as `nothing`.
- Fix a connector. A source stuck at a limit is reported, not changed.
- Check that a source already returning jobs belongs to that employer.

Next steps are in [BACKLOG.md](BACKLOG.md).

## Measured

Run on a copy of the production corpus against the live web on 2026-11-03 and 2026-11-04, 331 of the 427 waiting sources
in three passes, at 6 to 10 seconds a source:

| Outcome | Sources |
|---|---|
| Nothing found | 262 |
| Refused us | 42 |
| Suggested | 19 |
| Repaired | 8 |

Those 8 repairs came from an earlier version with looser rules, so the current rules were applied to them afterwards. Five
still repair and all look right: OneDigital, Mistral AI, Hebbia, Sword Health and Harmonic AI each moved to their own new
board. Three become suggestions, and two of them would have been real mistakes: Royal Canin would have taken all 953 jobs
of its parent Mars, and The Cheesecake Factory would have swapped its feed for an internal portal with one job. The last
60 sources ran on the current code, with no errors or timeouts.

Most of what is found at this rate is suggestions for a person. Large employers whose career pages only exist after
JavaScript runs are mostly `nothing`.

## Evidence

`tests/career-source-review.py`, run by `tests/career-source-review.test.mjs`, uses real temporary SQLite and the real
connectors and page parser over recorded employer replies. The public-only guard and the page limits are proven against a
real local HTTP server, including a redirect into a private address, a name that changes its answer and a page that drips
forever. `tests/browser/career-source-review-page-proof.mjs` drives the shipped
page in Chromium with hostile employer text. `tests/career-source-health.test.mjs` covers reading the report. Each safety
rule above was deliberately broken in a scratch copy, one at a time, to confirm a test goes red.

The store gate reports Career's suites as skipped because it has no pinned Python, so run them directly:
`node --test tests/*.test.mjs` from `career-hunter/`, with the engine's Python pins and a disposable PostgreSQL.

## What happens after the review

Since 1.54.0 a maintenance layer runs right after the review, in the same pull: it turns a source the review could not
connect three runs in a row into one decision for a person, writes repair briefs for readers whose reads stay partial, and
looks for a job site for employers that have none. See [SOURCE-MAINTENANCE.md](SOURCE-MAINTENANCE.md).
