# Source maintenance

Each full pull ends with the [nightly source review](SOURCE-REVIEW.md), which rechecks the sources the pull could not read.
Source maintenance runs straight after it and deals with what the review leaves behind. A source the review could not
connect becomes a decision for a person. A reader whose reads keep ending part way becomes a repair brief for a
developer. An employer with no job site is looked up along a fixed runbook, a few employers a night. One report says what
happened, and the **Companies** administrator page shows it under **Source health**.

## Where it runs

The kernel's nightly ingest runs `python -m jobhunter scrape --all` on a private copy of the shared corpus and publishes
that copy when the process exits cleanly. Maintenance runs at the end of that command, after the source review, on the same
copy. What it records publishes with the pull, and it needs no schedule, host service or kernel change of its own.

It runs under the same conditions as the review. A partial pull (`--limit`, `--company`, `--list`) does not start it. A
process that cannot write the corpus skips it, as does PostgreSQL mode. If maintenance fails, one line and the error are
written to the run's output and the pull still publishes. Each of its three passes is separate: one that fails or runs out
of time is named in the report and the next still runs. The same holds when a part asks to end the process, as the page
reader does at its own deadline: that pass ends and the report marks it `stopped`, and the pull still finishes and
publishes. Only a person's interrupt ends the pull.

The code is `engine/jobhunter/source_maintenance.py`. Every limit below is a constant at the top of that file.

## Pass A: a source that could not be connected goes to a person

No network is used in this pass.

A source gets one open decision when all of these hold:

1. The pull cannot read it now, by the review's own rule: it has no board, or it has read nothing or failed on 3 or more
   pulls in a row.
2. The review's 3 newest looks at it all failed to connect it. A look counts as failed when it found nothing, was refused,
   ran out of time or ended in an error. The review keeps only its newest outcome for each employer, so maintenance copies
   each night's outcomes into `source_review_history` and counts from there. It keeps the newest 12 for each employer.
3. Its last successful pull was 14 or more days ago, or it has never had one.
4. A person has not chosen its board (`ats_type` of `manual` or `multi`, or `discover_status` of `manual`), and it is not
   removed.

The decision carries what a person needs to decide: the board and the links that were tried, the date and outcome of each
remembered look, the pull's last error code and how many pulls in a row have failed, the last date any of its jobs was
read, and how many of its jobs are still stored open. While the decision stays open this is brought up to date each night.

There is one open decision for an employer at a time. A source that reads again, or that stops meeting the conditions for
any other reason, has its open decision withdrawn without anyone deciding. When the runbook below connects a source, its
open decision is withdrawn in the same transaction.

A person answers on the Companies page:

- **Archive** is the existing **Remove**. The next pull closes the employer's open jobs, stops reading it, and marks the
  decision `archived`. **Put back** under the **Removed** chip undoes the removal.
- **Keep trying** leaves the employer listed. The next pull marks the decision `kept`, and the same source is not raised
  again for 60 days. After that it is raised again if it still meets the conditions.

Both travel as saved changes, the same way as every other change on that page; see
[changing a source](SOURCE-MEMORY.md#changing-a-source). Keep trying is the target `keep:employer` through
`POST /companies-admin/keep`, which needs `career.administer`. The route refuses an employer that is not listed, one that is
removed, and one with no decision waiting.

| What the page says | Outcome | What happened |
|---|---|---|
| Kept: Career keeps trying this source and does not ask about it again before a date | `kept` | The decision is closed and the source is not raised again before that date |
| Not applied: no decision was waiting for this source | `no_decision` | Nothing changed. The source had read again, or was answered already |
| Not applied: this employer is removed. Put it back first | `removed_employer` | Nothing changed |

An employer that is put back after being archived is judged by the same four conditions on the next pull.

## Pass B: reads that keep ending part way go to a developer

No network is used in this pass.

A partial read refreshes the jobs it received and closes none, so a job that left the board stays open. Sources whose 3
newest pulls all ended partial are grouped by reader (`ats_type`) and by the reason code of the last pull. A group gets one
repair brief when it has 3 or more employers, or one employer with 500 or more open jobs stored. Removed employers are left
out.

The brief is Markdown written for a developer tool that is handed a `brief.md` and named files. It gives the reader's
class and file (`engine/jobhunter/ats.py`, or `browser_fetch.cjs` and `native_browser.py` for the page reader), the reason
code and what it means, how many employers and open jobs are affected, up to 10 employers with their board token, the jobs
read on the last pull and the unconfirmed pulls in a row, what done means, and the files to hand over. Done means the
reader proves the end of the list or reads the count the board states, with a contract test in the shape of
`tests/career-jibe-feed-contract.py`.

The same reader and reason is the same brief every night: its id is a hash of the two, and its text is brought up to date
while it stays open. A group that no longer qualifies has its brief closed. If it qualifies again the same brief opens
again.

Nothing here starts a developer tool. The Companies page offers **Copy brief** and **Download** for each open brief.

## Pass C: the runbook that looks for an employer's job site

This pass reads the web, under the same public-addresses-only guard as the source review (`http.public_only`).

It takes employers with no board whose `discover_status` is `pending`, `not_found` or `careers_only`, never a removed one,
least recently tried first. A link that was saved without its scheme is read as `https://`. For each employer it walks
these steps in order and records each step it ran:

| Step | Name in the record | What it does |
|---|---|---|
| 1 | `saved-link` | Works out the board behind the employer's saved careers link (`resolve.classify_url_deep`) and reads that board |
| 2 | `homepage-link` | Reads the employer's saved homepage, finds its careers links the way `resolve.resolve_platform` finds them, and puts up to 4 of them through step 1. A link to another site is used only when its address is itself a job board |
| 3 | `page-read` | Reads the saved careers link as a page. Only where the page reader runs under its own read policy (`JOBHUNTER_BROWSER_NATIVE=1`), and only with the reader's whole deadline left for this employer |

The first step that finds a board ends the walk. The board is connected only when all of these hold:

1. It was reached from the employer's saved link or saved homepage, by the steps above. No name is guessed.
2. It returns 3 or more jobs with titles now.
3. No other employer already holds it, in any letter case.
4. It is the employer's own: on the same site as the employer's saved homepage, or under the employer's name by the
   review's rule (`source_review._resembles`). Being reached from the saved careers link is not proof, because that link
   can be on someone else's site: an aggregator's company page or a staffing firm's portal would otherwise vouch for
   itself. This holds for a page read and for a list read off a page exactly as for any other board, so such a page is
   suggested and never connected. An employer with no saved homepage is connected only by its name.

Two addresses are the same site when the part of the host an employer owns is the same. On a board vendor's domain every
employer has a host of its own, so there the whole host must match: `foo.avature.net` and `bar.avature.net` are two sites.
The vendor domains are not a new list. They are read from the two patterns the engine already keeps of vendors' hosts
(`resolve._EMBED_HOSTS` and `discover._ATS_IN_HTML`), and a host also counts when `resolve.classify_url` reads a board off
its bare address. A saved homepage on a vendor's domain lends no name, since that name is the vendor's.

Then the board is set, the employer is marked `found`, and its jobs are taken in one transaction, so a failure leaves the
employer as it was. A saved careers link is kept, and only an empty one is filled with the link that led to the board. If
the employer has meanwhile been given a board, been chosen by a person or been removed, nothing is changed and no job is
taken. It is not marked `manual`, so the pull and the review treat it as any other source from the next night. A board
that fails condition 2, 3 or 4 is recorded as a suggestion and nothing is changed.

A suggestion is kept, one for an employer, in `source_suggestions`: the board, the step that found it, the reason, the
count of jobs and the date. A new suggestion for the same employer replaces it. It ends when the employer has a board,
however it got one, or is removed, or when the runbook looks again and no longer finds the board. The runbook returns to
an employer only after it has been round the others, so the suggestion stays on the page for all of that time.

| Outcome | Meaning |
|---|---|
| `connected` | The board was set and its jobs are in |
| `suggested` | A board was found but not connected. The reason is kept, and a person can accept it |
| `nothing` | No board was found |
| `blocked` | The site refused a read (HTTP 401, 403, 407, 429 or 451, a short bot challenge page, or the page reader was refused). Work on that employer stops at once, and it is not tried again for 30 days |
| `unsafe` | The saved link or homepage leads to an address that is not public. Nothing reads it, and it is not tried again for 30 days |
| `timeout` | The employer's time ran out, or a reader asked to end the process and the pass ended there. Nothing changed |
| `error` | The try failed. Nothing changed, and the next employer still runs |

The outcome, the step that produced it, the steps that ran, and the count of tries are kept for each employer in
`source_discovery`. For a try that ran out of time or failed, the step is the one that was running. The try is written
before anything is read, so a try that ends the process is known to the next one.

## Limits

| Limit | Value | Why |
|---|---|---|
| Pass A time | 60 seconds, a hard stop | It reads only the corpus. A statement still running at the limit is given up, and the pass is one transaction, so a stop leaves nothing half written |
| Pass B time | 60 seconds, a hard stop | The same |
| Employers looked up a night | 20 | The pull does not publish until maintenance ends |
| Time for one employer | 3 minutes, a hard stop | A slow or hostile site costs that employer and no more |
| Pass C time | 20 minutes, a hard stop | An employer's time is cut to what is left of this |
| Careers links tried from one homepage | 4 | A homepage cannot make the runbook read many pages |
| Jobs a board must return to be connected | 3 | A board with one or two jobs is suggested instead |
| Wait after a refusal or an unsafe link | 30 days | The same as the review |
| Reports kept | 30 | The corpus is copied every night |

A pull that was stopped and continues does not look up again the employers it already tried in that pull, and the 20 a
night counts across the restart. If the page reader passes its own process deadline, the pass ends there and the pull
still publishes.

## The report and what a person sees

Each pull writes one report to `source_maintenance_runs`. A pull that restarts writes over its own. The report holds when
it ran and how long it took, and for each pass its seconds, its limit and its counts: decisions opened, withdrawn and open;
briefs opened, updated, closed and open, with the open ones listed; and for the runbook the employers tried, those still
waiting, the count of each outcome, the employers connected and suggested that night, and how many suggestions are open.

`GET /companies-admin/list` returns `sourceMaintenance` with the newest report, the open decisions with their evidence,
the open briefs and the open suggestions, read from the published corpus without writing it
(`lib/career-source-health.js`). Decisions, briefs and suggestions are each cut to 50, with the full count beside them. A
corpus maintenance has not reached has none of these, and the page shows no cards. A report that cannot be read says so,
and the table still loads.

The **Source health** view shows three cards above the nightly review:

- **Needs you**: each open decision with what was tried, and **Archive** and **Keep trying**. After a press the line says
  the choice is saved for the next nightly pull.
- **For a developer**: each open brief with its reader, the reason in words, the employers and open jobs affected, and
  **Copy brief** and **Download**. The file is named `brief-<reader>-<reason>.md`.
- **New sources found**: the employers connected last night, and every open suggestion with the date it was found, the
  newest first. A suggestion has the same **Accept** as a suggestion from the review, except where another employer
  already uses the board. Accepting it gives the employer that board at the next pull, which ends the suggestion.

The manifest also offers a daily job, `career-source-maintenance`, at 07:15 in America/Chicago. It is an offer, so it runs
once a Career administrator has turned it on. It calls `POST /companies-admin/maintenance-report`, which reads the newest
report and answers at most 3 short lines for the person's briefing, each with a link to Source health:

- how many more sources need a decision since last night, with how many decisions are waiting in all;
- how many repair briefs opened last night, with how many are open in all;
- how many employers were connected to a job site last night.

A decision or a brief is told on the morning after it opened and not again; it stays on the page until it is answered or
closed. The route answers nothing when nothing is new, or when the newest report is more than 24 hours old, so each
report is told once.

## Tables

All are in the shared corpus and are created by the pull. A published corpus without them has no cards.

| Table | Holds |
|---|---|
| `source_review_history` | The date and outcome of each review look, the newest 12 for each employer |
| `source_actions` | Decisions: the employer, `kind` (`archive`), `state` (`open`, `archived`, `kept`), when it opened and was decided, until when it is not raised again, and the evidence |
| `source_repair_briefs` | Briefs: the reader, the reason, `state` (`open`, `closed`), when it opened and was last brought up to date, the Markdown, and the employers |
| `source_discovery` | For each employer the runbook tried: when, how many tries, the outcome, the step and the detail |
| `source_suggestions` | For each employer with a board found and not connected: the board, the step, the reason, the jobs it returned, the employer that holds it if one does, and the date |
| `source_maintenance_runs` | The nightly reports, the newest 30 |

## What it does not do

- Open a kernel ticket or use an approval gate. The decision a person makes is the press on the Companies page.
- Start a developer tool or change a reader. It writes the brief.
- Search the web for employers that are not in the corpus, or guess a homepage or a board from a name.
- Solve a human check, sign in, or work around a refusal.
- Change a board a person chose, or connect a board on a link alone.
- Remove an employer. Only a person's Archive does.

## Evidence

`tests/career-source-maintenance.py`, run by `tests/career-source-maintenance.test.mjs`, runs real full pulls on real
temporary SQLite with the real readers, resolver, page parser, source review and saved-change path over recorded employer
replies. Time passing is made by moving the stored dates back. Run with `--corpus <file>` it leaves the corpus six such
pulls produce. `tests/career-source-maintenance-routes.test.mjs` loads the shipped routes with their real library over
that corpus, and `tests/browser/career-source-maintenance-page-proof.mjs` drives the shipped page in Chromium through
those routes at 1280 and 412 pixels wide. The page reader is the one part doubled besides the network.

The public-addresses-only guard is also crossed for real: `TheRealGuard` in the engine contract runs a pull through the
real session and its connection guard against a real server on a local socket. The server answers the careers link with
a redirect to a private address; the guard refuses the redirect at that hop and the employer is recorded `unsafe`. Two
things are doubled there and nothing else: one fixture name resolves to the local server, and the guard is told that
server's own address is public so the first hop can be made. A second case doubles nothing: a careers link that is itself
a local address never reaches the server.

Each rule above was broken in a scratch copy, one at a time, and a test went red for every one.
