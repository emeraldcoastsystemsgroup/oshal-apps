# Intelligent Trades — backlog and roadmap

Current status for Trading 1.37.0 on the native kernel, reviewed 2026-10-25.

Delivered evidence refinements: stored Congress filing IDs and collector timestamps with explicit timing coverage; separate accrued-interest/margin-equity facts; native open-position P&L scope labels. Historical point-in-time Congress performance and native brokerage execution remain unvalidated/unavailable respectively.
Implementation, automated verification and signed-in acceptance are separate milestones.
Earlier incident details remain in Git history; the entries below describe what remains now.

## Calendar rotation and congressional purchase candidates

Implemented fixed monthly trend and quarterly-rank research with BIL fallback, complete
calendar warmup and exact monthly decision dates. A dedicated Research → Congress tab loads
server-verified House/Senate disclosed-stock baskets into immutable strategy drafts, retaining
primary filings and bounded source coverage. Price-only selected-universe backtests do not
validate historical Congress-following performance. Owner acceptance and forward evidence
remain separate from package/browser guards; no broker execution/protection is available.

## Monday portfolio readiness — implemented; owner acceptance still required

Native Strategies keeps both portfolio review and the existing Futures research view
(including prior Tuning bookmarks). Native research does not show the unavailable legacy
equity optimizer. Full-shell desktop/phone tests cover navigation and read-only opening.

Portfolio review shows: every reported holding, watchlist coverage,
owner-declared taxable/401(k)/IRA registration, separate cash/margin mechanics, and outside
statement snapshots. Statement refresh and re-add preserve established account categories
and assigned review strategies; these change only in the account settings. Paper capital is excluded from the landing real-capital headline. Combined reported real
holdings show concentration and separate retirement/cash/margin totals. Failed sources
force partial totals; outside statements older than seven days block complete concentration.

Saved immutable allocation/trend/momentum strategies use a separate, explicit daily research
model. Price-backed historical runs retain exact configuration, source prices, costs,
financing assumptions, SPY price benchmark and drawdown. Missing sessions, warmup or source
reads remain unavailable. Price returns exclude dividends/taxes/contributions; these are
fresh-cash scenarios, not actual account returns or untouched out-of-sample evidence.

The default historical end is the last completed NYSE session, including Monday mornings;
verified 2024 history supports long warmups. Research-envelope approvals require explicit
classification and a current outside statement, bind a current account snapshot and expire; they authorize no
broker order or borrowing. The native kernel remains read-only for live brokerage execution.
Legacy Strategy Lab placeholder writes/backtests now refuse instead of returning false success.

Concrete non-executing previews now show per-instrument quantities, reference prices,
modeled costs and funding, preserved holdings and explicitly acknowledged unmanaged sales.
Planning-cap exceptions are one-preview acknowledgements, not live guardrail changes.
Approvals are exact, owner-scoped, expiring and idempotent; missing cash/retirement/margin
facts, stale evidence and broker capacity failures cannot be acknowledged away. Heavy
current price evidence is retained separately from bounded recent listings. Existing
research-envelope approvals cannot approve these concrete planning previews.

Still required before claiming managed live portfolios: owner-signed-in provider/account
coverage, confirmed registrations and outside statements, verified broker debt/maintenance/
settlement data for the actual accounts (the approved kernel `4c073e8b` passthrough retains
allowlisted provider measurements; missing fields remain unknown), product eligibility,
real execution/protection capability with separately approved controls, and forward evidence.
No strategy was assigned to the operator's accounts and no real risk limits were changed.

## Roadmap

1. Jarvis inference and its signed-in stock-read acceptance are done (T8, T14). History/CSV and
   Reconcile browser checks pass. Inspect the next genuine scheduled evaluation (T3) without
   manufacturing a live order or changing arming or risk policy.
2. T1 native suite execution and complete catalog registration are implemented, and T13's
   installed Vitest execution passes (34 suites, 503 tests); readiness remains separate from measured execution.
3. Land the tested T2 protection-basis correction (core PR1135). The operator approved live
   activation; GitHub still requires an approving review before normal merge and deployment.
4. Extend T5's missing read capabilities with honest source, time and availability metadata.
   Annual SEC fundamentals, Finnhub company news (World archive headlines when Finnhub does not answer)
   and the recorded earnings calendar are delivered. A whole-market screener remains open.
5. Continue native cutover acceptance. Focused Trading checks do not certify full kernel CI.

## T1 — Native Test Lab suite execution and maintained registrations — resolved

The manifest declares `testing:` and `uses: test-catalog`. All 61 maintained suite files
are now explicitly registered across 61 cases, including native account/history,
reconciliation, stock tools, company lookup, desktop/phone and source-framework cases.
A native catalog coverage test refuses missing files or duplicate case identities.

The native kernel implementation now executes supported package `node-test` suites in
an isolated pinned Node/Chromium container with no host mounts, network or live broker
credentials. It retains original-operator results with source provenance and measured
counts. Readiness remains separate. Empty suites fail, skips stay partial, unavailable
runners/fixtures stay pending, and timeout/authority/source-change tests verify cleanup.
Real native HTTP integration has executed the published company, desktop/phone and
Jarvis stock-tool suites; the Lab page is exercised at desktop and phone widths.

The executor is deployed at kernel `92ad084`. The installed Test Lab screen has been
exercised at desktop and phone widths against the actual native API: running a suite
shows measured results, retains an open case, and restores its receipt after reload.
The initial installed matrix exposed a paper-browser dependency lookup defect. Version
1.33.13 resolves Express/Playwright from declared package/runtime dependencies, declares
Express in its prerequisites and fixes the fixture's browser locale. The original failed
receipt remains in history; the corrected installed matrix is recorded in native delivery
evidence. Kernel CI now includes this paper-browser case in its real Docker regression.

The baseline is complete: every maintained suite is registered, package Node/browser
suites execute with retained measured receipts, and unsupported prerequisites remain
visible. Expanded runner coverage is T13; signed-in external-provider acceptance remains
T3/T4/T8. The 34-suite/502-case source results are separate fixture evidence and do not
certify live brokerage operation.

## T2 — Take-profit and trailing protection basis — approved; repository review pending

The earlier stop-loss correction uses engine cost only where the ledger covers the venue
quantity. Take-profit, trailing arming and the stored peak floor still use venue average
cost in the existing engine. After a wash sale, that average can include a disallowed loss.
Changing the remaining basis changes when real sells occur. Existing legacy automation
has not been assumed retired, and no live protection policy was changed by these repairs.

A concrete correction is committed and pushed as
[`d95be502` / PR1135](https://github.com/emeraldcoastsystemsgroup/oshal/pull/1135),
with final nightly-runner coverage at `3df66e17`.
It targets the verified still-running legacy protection engine, not the native read adapter.
All 148 focused cases pass, including actual disposable-PostgreSQL replay/dispatch/peak
checks and existing unmanaged/golden-plan regressions. Both new suites are registered in
the legacy Test Lab Trading card and selected by the fixed nightly command, with actual
spawn/report wiring verified by its runner guard; native Vitest/core execution
remains pending under T13. The normal publish and committed-source typecheck gates pass.

The proposal uses covered engine cost for take-profit, trailing gain and new peak floors.
For synthetic engine cost100, venue basis130 and price110, the unchanged 8% threshold
would take profit at +10%, where the current code merely vetoes the venue stop. Genuine
stop decisions, unmanaged exclusions and thresholds are preserved. Existing recorded
peaks are retained because their old schema cannot distinguish observed highs from old
venue-derived floors. The current-price trailing-arm rule is not changed.
The operator explicitly approved live activation on 2026-10-15. The PR is ready for review;
its exact-head publish gate passes, but GitHub refuses normal merge until the required
review is satisfied. Automatic merge is disabled for the repository. The correction is
not merged or deployed; live behavior remains unchanged. Approval is retained, so the same
activation question does not need to be asked again.

**Done when:** one tested basis function uses engine cost only for covered quantities,
otherwise the venue basis; take-profit, trailing gain and peak floor use it consistently;
`RISK_POLICIES.active` and real disposable-PostgreSQL exit/peak cases pass. Present the
concrete behavior change for approval before activating it for live trading.

## T3 — Historical ledger reconciliation — browser acceptance passed; scheduled check open

The original owner-scoped ledger was recovered correctly with owner RLS context. The
previous zero-row conclusion was wrong. Sixteen proved missing historical closes and
paired decisions were appended and mirrored into the native owner scope; original
rejected orders were preserved. The native ledger has 963 live order rows. Repeat
comparison proposed no further bookings, and engine-basis coverage for ANET and MPC was
verified read-only. Ten other historical allocation/replay exceptions remain explicit;
manual purchases were not enrolled as engine-managed positions.

Native Accounts provides full-year execution CSV and account-bound Reconcile preview and
confirmed apply. The workflow refetches venue history and holdings, plans with exact
fractions, refuses ambiguous evidence and commits paired corrections atomically with a
ledger snapshot guard. It never restores retired book arming/configuration flags.

The original signed-in Chrome session now reaches the installed native interface. Its
full-year history returned 61 equity executions, and the actual downloaded CSV has the
same 61 rows with one opaque account identifier, one binding and one requested window.
Reconcile on the account with engine history displayed zero verified historical closes
to record and the same 10 symbols needing review. The separate manual account correctly
reported no filled engine ledger and did not enroll its holdings. No apply was performed.
These are actual connected-provider/browser checks, separate from fixture results.

**Done when:** retain this history/CSV/Reconcile acceptance and verify expected basis
coverage in a subsequent genuine scheduled evaluation. Do not force a live fire or place
an order merely to produce a test receipt.

## T4 — Surface script/module parser guard — resolved

The parser derives classic-script versus module grammar from the actual shell and checks
both directions. All 12 parser cases pass. This is included in the green full source gate.

## T5 — Remaining native market-data features — resolved

Caller-scoped Schwab reads now supply actual accounts/holdings, exchange-time quotes,
daily/intraday candles and ticker-prefix search. Accounts retains failed-read dispositions,
missing daily changes and view-only live holdings. Research retains quote source, timestamp
and delay information, public SEC filings and explicit unavailable-section reasons.

Version 1.33.14 implements an annual financial summary from public SEC company-concept
responses: reported revenue/net income and coherent year-over-year growth/net margin.
Selection compares annual reporting periods before revenue-tag preference; values used
together must share filing accession, period, currency and taxonomy. Comparative `fy`
labels are not guessed into fiscal-year labels. Exact concept/filing provenance, reporting
currency, period and retrieval time accompany the values; missing/ambiguous metrics
retain null and a reason. Standard US-GAAP and IFRS revenue/profit concepts are supported;
custom tags and unsupported reports remain unavailable. These are annual statements,
not current valuation ratios or quarterly results.

Smaller bounded concept endpoints avoid full-companyfacts responses exceeding the native
4MiB response ceiling. The reader uses the existing SEC host admission and required contact
header, limits financial request starts to four per second per process, caches at most
32 public summaries for one hour and stops on failed/throttled sources. A missing concept
(404) stays absent. Broker connectivity is independent of public statements; quotes retain
their own caller-bound transport. Desktop/phone component tests exercise the actual route
and renderer. PR481 merged at `370d22c1`; Trading 1.33.14 was reloaded on native kernel
`92ad084`. Original signed-in Chrome acceptance displayed NVDA annual revenue, net income,
growth and margin with USD, the 2025-01-27–2026-01-25 period, filing date and SEC source.
The installed Test Lab measured 22 summary cases and one desktop/phone browser case,
all passing with zero skips and verified cleanup on artifact `3a008cd694df`. Both suites
are in the 59-case embedded catalog. These receipts precede this documentation-only update.

Version 1.33.15 source adds company headlines from the caller's optional Finnhub connection.
The kernel injects the saved key only for declared `finnhub.io` egress; package code never
receives it. Each read is re-admitted without a shared result cache. Fixed company-news
requests cover seven days, pace starts at one per second per process and return at most
25 matching, safely linked articles with publisher/publication and retrieval provenance.
Authorization, rate-limit, malformed and transport failures stay unavailable; a successful
empty array is a distinct empty result. Invalid/old/future/mismatched and duplicate entries
are excluded and counted. Finnhub documents this endpoint for North American companies;
source coverage is labelled accordingly. Hostile article schemes are never clickable.
Pure/transport and desktop/phone route-renderer tests are embedded in the 61-case catalog.
PR483 merged at `2a808a34` and Trading 1.33.15 was reloaded on native runtime
`92ad084`. Original signed-in Chrome displayed actual Finnhub NVDA headlines with
publisher, publication time and seven-day retrieval/coverage provenance alongside
Schwab quotes and the chart. Installed Test Lab measured 18 summary checks and one
desktop/phone browser check, all passing with zero skips and verified cleanup on
artifact `756b740c5e78` (before this documentation-only update). All 199 active role
assignments and 95 active packages remained available; assignment definitions and
original environment/kernel unit were unchanged. No trading action was used for acceptance.

Native additions on 2026-10-16, each shown on the original signed-in account: the ticket's
Look up prices the native paper book from the stored price (1.33.24); company news asks the
person's Finnhub connection first and reads the World archive's headlines (`feeds.news`,
kernel 6c834e6) when Finnhub does not answer (1.33.27, 1.33.36); the next earnings date reads
the recorded World calendar (`feeds.events`, kernel 839c171; 1.33.26: TXN 2026-10-20) and
otherwise keeps the labelled estimate; futures roots and dated contracts chart through Schwab
as futures (1.33.28: /ESZ26 last close 7,747.75), no longer the stock ticker.

The whole-market screener is delivered (1.33.39-1.33.40): kernel fb12519's `trading.movers` reads
Schwab GET /marketdata/v1/movers for a fixed equity index set through the caller's connection
(the provider allowlist admits only that set; executor and allowlist tests). Live, Schwab
answered at most ten rows per index and ordered EQUITY_ALL by volume whatever the sort, so the
Movers board merges the S&P 500, NASDAQ and NYSE lists, keeps prices of $5 or more and ranks
winners and losers by percent change and most-active by volume itself, labelled with that
method; no rail, an empty list or the volatility board fall back to the archive board. On the
original signed-in account the three boards showed distinct, correctly ordered rows (winners led
by +10.15%, losers by -10.00%, most-active by 76.5M shares). Kernel commit d944d3a proves the
movers read obeys the same rules as quotes and config: another application, another person
through the owner's connection, and a withdrawn connection are refused. All done-when criteria
are met (2026-10-16).

Earlier this list said: a whole-market screener was unavailable. Archive-backed prices or Movers
remain labelled as stored/archive evidence. Company-directory matches alone are identity
data, not financial statements or proof of broker tradability. Native real-money order
execution remains outside this read adapter.

**Done when:** each added read has a verified provider contract, bounded inputs, original
caller/connection and withdrawal tests, meaningful module/UI acceptance, and explicit
failure/availability reporting. Never invent missing values or arm trading to test a read.

## T6 — Source-suite native helper resolution — resolved

Exact Vitest aliases resolve the shipped JavaScript archive and paper helpers. The
book-facts TypeScript import has checked declarations and matches its compiled peer.
All 34 suites now load and all 502 cases pass, without source-suite skips or implementation
stubs. Earlier T7/T10 failures exposed by this repair were corrected separately.

## T7 — Selected-account readiness explanation — resolved

Status reuses the exact selected-book broker reader for readiness and its explanation.
It no longer consults an unbound reader that can describe another account. The actual-router
regression fails against the previous code; both focused suites pass all 24 cases. The
existing Test Lab rail-guard registration includes this check. No broker data read or
order is called to report readiness.

## T8 — Jarvis stock data through Trading — resolved

Declared read-only API tools provide stock quote/research, OHLCV history, ticker-prefix
search and company-name lookup. The analyst requests actual module data, retains source
and time information, and discloses missing sections. Existing account-summary and
performance tools remain available. No order tools were added.

The native Jarvis integration uses real HTTP and the actual Trading process with explicit
scripted inference/normalized market fixtures. Two callers receive distinct quotes and
connections; ungranted access and original authority withdrawal refuse correctly.

Signed-in live acceptance reached Jarvis but failed because every configured inference
provider failed. The visible result panel correctly reported that no model could answer;
this was not a successful stock-tool conversation. T14 tracks the observed infrastructure
and model/protocol issues. Real account-backed inference now also passes the native
Jarvis-to-Trading integration with explicit synthetic market transport. Both declared
stock tools are present in the specialist's system prompt; quote, timestamp, unavailable
sections and daily-chart receipts are verified. This does not certify the installed
Jarvis path against the original user's live broker connection.

On 2026-10-16 the original signed-in session (signed in as the owner) asked Jarvis
"What is NVDA trading at right now?" and received NVDA at $215.71 from a Schwab quote with
its 17:14 UTC time, through the installed inference path below (T14). Earlier the same
question had answered "the price archive read timed out"; kernel f843a76 bounded the
archive's latest-price read so its planning no longer exceeds the read deadline.

**Done when:** retain the green automated proofs and complete the original signed-in,
connected-provider conversation. Fixture success is not live-provider acceptance. Met 2026-10-16.

## T14 — Jarvis inference availability and real-model tool acceptance — resolved

The installed fleet selects `vllm/bot-fast`. The failed live request's journal records
its connection closing, `litellm/bot-fast` returning HTTP401 and `ollama/qwen3:4b`
exceeding its 30-second fallback bound. The primary container repeatedly restarts because
its configured GPU reservation exceeds available memory. Authenticated local LiteLLM
model discovery works with its existing service credential, but the native installation
has no LiteLLM key configured. Its `bot-fast` route points to the same unavailable primary,
so repairing authentication alone would not provide independent model availability.

The current ordinary Jarvis turn passes system instructions and selected tool descriptions
as prompt text and parses fenced `tool_call` JSON. A small local-model probe exhausted
256 output tokens discussing the requested call format instead of producing a usable
call; it is evidence for this bounded probe, not a broad model-quality verdict.

Kernel commit `cd0c567` implements a bounded managed-account text adapter through the
existing BYO interface. It uses the operator's existing Codex sign-in, verifies the
effective disabled backend-tool/MCP configuration, checks the exact selected model,
requires authenticated loopback HTTP and bounds input/output/process lifetime. All
application tool execution remains in the kernel under the original caller's authority.
Thirteen owned protocol/HTTP tests pass, including real concurrent requests and cleanup;
the ordinary Linux CI inventories execute them without a model account.

The opt-in actual-model integration is registered in the complete kernel module runner
with its required account, source, runtime and disposable-PostgreSQL fixtures. Native
Jarvis handed the request to the actual Trading process; the specialist received both
declared stock-tool names and made the calls, returning verified quote/time/availability
and daily-chart data. Market transport is explicitly synthetic. The existing deterministic
two-caller and authority-withdrawal integration also passes. The initial incorrect Store
toolchain fixture was refused by the sandbox; the successful run uses the genuine pinned
runtime bundle. Neither refusal nor a missing prerequisite is counted as a pass.

Kernel `6ccfcb1` adds provider-independent named inline defaults bound to an exact
package and bot name. Explicit per-turn user choice remains first; Node workers,
other bot owners and the fleet retain their routing. Startup rejects malformed explicit
configuration, unknown named models and duplicate defaults. The sanitized admin report
shows these declarations separately from provider health. All 47 inference-library,
14 admin HTTP and five structured-inference tests pass, alongside the malformed-config,
real-model, two-caller/withdrawal, module, workflow and secret checks and strict Clippy/format.
The real Codex-account integration also passed using named defaults with its original
fleet preserved. A persistent loopback relay readiness probe passed using the same
managed sign-in; it was then stopped and remains disabled.

Hosted activation is withheld. OpenAI's
[app-server authentication guidance](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
allows existing local/open-source applications but excludes commercial or hosted services
from managed app-server authentication. The local proof does not authorize using the
operator's CLI login as a shared hosted OSHAL provider. Use a suitable API provider or a
separately registered [Sign in with ChatGPT integration](https://developers.openai.com/siwc)
for that deployment. The kernel's `docs/native-codex-account.md` records this boundary.
The private two-bot configuration candidate was never applied; the original production
kernel unit and environment remain byte-identical. No installed provider selection,
existing credential, trading setting or separate training workload was changed.

Resolved 2026-10-16 at the owner's direction ("the gpus are training right now so use
antigravity as a fall back"). Kernel `0d25070` adds an Antigravity account relay on the same
bounded BYO interface (the owner's own Antigravity sign-in on this installation, empty 0700
working directory, HOME/PATH only, plan mode with slash commands disabled, loopback with a
token). The installed failover order is vllm, litellm, the relay (gemini-3.8-flash-low), the
Antigravity provider models, then ollama. Provider availability is measured in the kernel
log: on the Futures review turn vllm and litellm refused (`store_unavailable`) and the relay
answered in 16.7 s. Tool use and caller scope were measured separately on the signed-in
conversations: Jarvis returned the live NVDA quote (T8), and the Trading concierge answered
with the paper account's cash, equity and four holdings after Trading 1.33.25 made its read
tools route reads. The hosted-activation boundary above still applies to a Codex sign-in.

**Done when:** restore an available, authenticated installed Jarvis inference path;
retain the real-model instruction/tool-catalog and isolated module proofs, then complete
the original signed-in live-data conversation and return current data with
source/time/unavailable sections. Keep provider availability, model protocol competence
and caller-scoped module execution as separately measured checks. Do not claim a provider
switch alone fixes tool use or change live trading authority to make a read pass.

## T9 — Company-name lookup — resolved

`trading_company_search` calls the authenticated module's SEC directory lookup. It returns
up to 25 actual company/ticker/CIK matches with source, cache fetch time and age. Malformed
queries refuse before egress; unusable/conflicting snapshots and outages remain unavailable.
The analyst asks the person to resolve ambiguous names. Schwab ticker-prefix search stays
separate; directory entries do not establish quotes, financials or broker tradability.

## T10 — Source guards and native/legacy manifest boundary — resolved

Research guards preserve logged failures, availability reasons and null-result handling.
Exposure retains book binding, its 409 disposition and the separate native-paper message.
The Futures source case checks the actual reviewer/persona and compatibility bot mapping;
whole native manifest admission is covered by the Rust kernel integrations, rather than
feeding native schedules through the old TypeScript parser or silently stripping fields.
The complete source gate passes 502/502 cases.

## T11 — Packaged stock-tool test dependencies — resolved

The YAML dependency resolves from the pinned runtime or explicitly supplied test toolchain,
with `dependency:js-yaml` declared in Test Lab. Fourteen package-only-layout cases pass
without a Store parent or framework source. The mandatory native CI glob also includes
Research, company-directory and native paper UI cases. Exact single-glob discovery and
its reviewed command inventory remain enforced.

## T12 — Current backlog and roadmap accuracy — resolved

Removed stale present-tense claims that the catalog or native market reads do not exist.
Current implementation, automation results, missing capabilities and acceptance work are
now explicit. Maintain this distinction as each remaining issue is completed.

## T13 — Native Vitest/core-fixture execution — resolved

The 34 registered Vitest source suites remain pending in native Test Lab execution.
Their successful 502-case source-gate result uses the declared framework fixture; the
native sandbox does not yet provision that runner/fixture. Package readiness is also a
separate action, not a substituted suite pass.

Resolved 2026-10-16. On native kernel b6dbe79 with Trading 1.33.37 the installed Test Lab ran
every executable registered case through the live API: all 34 Vitest suites passed with 503
measured tests (zero failed, skipped, cancelled or todo; cleanup verified; core fixture
3df66e17) and all 33 node-test suites passed. Receipts are retained under
`native-test-lab/20261016-t13-recheck2/`. An earlier run that day had 11 suites with zero
tests: two new plain-JavaScript modules resolved only through this package's vitest aliases,
which the installed runner does not read. Source-tree shims fixed that (1.33.37), and the
package config no longer carries those aliases, so it resolves as the runner does.

**Done when:** source-pinned Vitest/core prerequisites are provisioned in the isolated
runtime, actual registered suites execute with measured retained receipts, and missing
external broker requirements remain explicit. Preserve no-network/no-live-data isolation. Met 2026-10-16.

## T15 — Futures research loop on the native kernel — resolved

Trading 1.33.29-1.33.35 (`routes/futures/`, kernel FUT-01) run the Futures panel natively over
the person's Schwab connection: Save and Run once (the platform's staged optimizer bundled as
`routes/futures/engine.js` by `tools/build-futures-engine.mjs`; the live dated contract read
for the whole window because Schwab serves no expired contracts), the nightly
`futures-research` person schedule (02:15 New York, Tuesday-Saturday), the research review on
the futures-research-analyst (exact evidence citation, bounded grid proposals), forward
research calls (locked-strategy bias frozen from completed Schwab bars, graded by directional
ticks) and the Schwab check; capture, catch-up and archive import are hidden as not needed.
On the signed-in account a run read 3,755 hourly ESZ26 bars and settled insufficient_sample
(0 out-of-sample trades in 4 windows); its review completed; its forward calls abstained; the
schedule fired from the owner's session. Guards: `tests/native-futures-study.test.js`,
`tests/native-futures-chart.test.js`.

## Cross-repository acceptance still open

Kernel PR69 remains draft. Earlier full-pipeline artifact-stream expiry and native RAG
acceptance failures have not been certified resolved by these Trading checks. The active
preview preserves 199 active role assignments and 95 active packages; rejected probe/test
manifests are unchanged. Do not describe the entire kernel or application estate as flawless
on the basis of the focused Trading results.

## Native monthly live management — implementation pending installed acceptance

Version1.38.0 implements account/model/source-bound cash-funded monthly mandates, durable
cycles and broker attempt/fill recovery. Final acceptance requires the complete native kernel
release gate, publication and installed original-owner monitor/schedule proof. Human real-money
activation remains separate. Existing legacy multi-sleeve strategies, intraday position-protection
families, non-flat account allocation review and retirement account enrollment are not ported by
this bounded monthly executor. No claim of active real trading before a mandate and successful
broker receipt are visible together.
