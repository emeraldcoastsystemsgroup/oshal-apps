# Venture Plan

**Turn an idea into the document set a real decision needs — and be able to say, of every number in it, exactly where it came from.**

> **Posture: planning instrument.** This application produces estimates, not forecasts. Its default output rests on numbers a language model proposed and labelled as its own guesses. It is designed so that you can see which ones those are and go replace them with quotes. See [What this is not](#what-this-is-not).

An OSHAL app package (ADR-085). Suite `ai-finance` — it serves the person deciding whether to commit capital and place a manufacturing order.

---

## The problem it exists to solve

Ask a language model for a business plan and you get a fluent one, with a bill of materials, a margin, a break-even and a cash curve. Every number in it is invented, and none of them look invented. That is worse than having no plan: it reads as researched, so somebody commits tooling money against it.

Telling the model "don't make things up" is not a control. It is a hope.

## So the system splits at the arithmetic line

**Bots supply assumptions. Code does the calculations.** The split is enforced by mechanism, not by instruction:

| | Bots | Engine |
|---|---|---|
| Produce | a value, a unit, a **band**, a **source**, a **confidence** | every computed figure |
| Never produce | a total, a margin, a break-even, a cash position | an opinion |
| Enforced by | **every source kind a bot can author is capped on the way in** — `model-estimate` at `estimated`, `published-rate` at `benchmarked`. `quoted` and `observed` are reachable only through a recorded vendor quote or an operator's own entry, so relabelling a guess does not launder it | pure modules with no clock, no randomness and no network, covered by hand-derived tests |

Four consequences that make it real rather than decorative:

- **Every figure carries its provenance.** A computed figure names the assumptions it rests on — an aggregate inherits the chains of everything it was built from — and its confidence is the *weakest* confidence anywhere in that chain. A chain is worth its worst link.
- **A figure resting on an unregistered input turns `canPublish` false, and so does one resting on nothing.** An empty provenance chain is unprovenanced, not clean. The document is refused, not footnoted.
- **The two statements have to tie.** Cash at the horizon end must reconcile to net income through the closing working-capital position, term by term. An unnamed difference between profit and cash blocks — because that is the shape of a real cost charged in one statement and not the other.
- **Narration cannot smuggle a number in.** Prose is written as figure tokens (`{{fig:landed.unit-cost}}`), and a token naming a figure the engine did not compute **throws** at render time. A blank in a funding document is indistinguishable from a zero, so it fails loudly instead.

The list of numbers worth buying a quote for is **generated** from the source kind on each record, not asserted by anybody. That is why flagging honestly is in the bots' interest as well as yours.

---

## The method

Work runs in stages, and **each stage may buy only the evidence the next gate needs.** A venture that is going to fail should cost almost nothing to find out.

| Stage | What happens | Gate | The question |
|---|---|---|---|
| **0 Frame** | The idea becomes a scoped venture. No spend. | **G0** | Is this stated as a decision somebody could take? |
| **1 Screen** | Banded estimates only. No supplier is contacted. | **G1** | At the **optimistic** end of every band, does it clear its required landed cost? |
| **2 Source** | Quotes on the top cost lines, a customs classification, a named test lab. | **G2** | Does the critical path carry real quotes rather than estimates? |
| **3 Commit** | Tooling and the purchase order. Real money leaves. | **G3** | Is the model's posture `quoted`, and is the cash trough funded? |
| **4 Launch** | Packaging, channel onboarding, the season. | **G4** | Is the schedule feasible against a date that does not move? |

**G1 kills on the optimistic end deliberately.** If the best corner of every band still cannot clear the required landed cost, no amount of sourcing work rescues it. Stopping at stage 1 for the price of a few model calls is the most valuable thing this application does.

This is a sibling of the platform's engagement method (core `docs/delivery/ENGAGEMENT-METHOD.md`), with one step that method has no need for: **inversion**. An engagement measures what exists; a venture forecasts what does not, so the useful question is not "what is the answer" but "what would each input have to become for the answer to change". The engine answers that by rebuilding the whole model at each end of each researched range — never by rearranging a formula, which would drift the moment somebody adds a fee line.

---

## The bots

Four, and the reason is pipeline shape rather than taxonomy. The dependency graph has a **code phase in the middle of it**:

```
strategist (scope) → bom-analyst → ( market-analyst ∥ ops-analyst )
                   → [ deterministic engine ] → strategist (narrate)
```

| Bot | Contract | Explicitly cannot |
|---|---|---|
| `venture-strategist` | idea → venture spec; frozen model → prose | type a numeral with money, a percentage or a quantity — only `{{fig:…}}` tokens |
| `venture-bom-analyst` | components, price **bands**, supplier terms | emit a total, a per-unit cost, or any price |
| `venture-market-analyst` | demand scenarios, observed shelf prices, channel rate cards, seasonality, returns | name a part or a component cost |
| `venture-ops-analyst` | process, tooling, freight, duty candidates, certification path, schedule, headcount | say a product passes, complies with, or is exempt from any standard |

All four are concierge nodes resolved inline on the api ([Form B](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/building-a-bot.md)) — reason-only brains with no shell-out and no store of their own. Cost lands in `chat_tasks` under each `agentId` like any other node, which is what [ADR-036](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/036-bot-owned-application-architecture.md) requires and what doing the reasoning in a route would bypass.

Two of them run in parallel; one runs strictly *after* the arithmetic on inputs the others never see; and the operator's real workflow is a per-domain re-run ("a quote came back — redo only the BOM"), which a single monolithic call cannot do without paying for all four. There is **no critic bot**: "which assumption most changes the answer" is a tornado chart, which is arithmetic, and a bot asked to opine there would be guessing at something measurable.

---

## The document set

A worked example ships with the package: the Halloween projection prop — an inflatable pumpkin with a projector inside it throwing a talking, lip-syncing face onto its own skin — taken end to end. Read [`examples/pumpkin/`](examples/pumpkin/README.md).

Regenerate it, and the regeneration audits itself:

```bash
cd venture-plan
node examples/pumpkin/regenerate.js
```

It exits non-zero if any dollar figure in any document did not come out of the engine, if any document references a figure the engine did not compute, or if any competitive absolute appears in the prose.

The corpus covers the decision (`00`), the two documents that make the rest honest (`01` what would have to be true, `02` the assumption register), what exists versus what does not, technical feasibility gates with their worked arithmetic, market and competition, bill of materials, manufacturing, suppliers, logistics and landed cost, compliance, unit economics, channel waterfalls, the profit statement, cash and working capital, sensitivity and risk, org and hiring, timeline and critical path, go-to-market, the funding ask, the fatal-flaw register, the gate memo, and an engine reconciliation against an independent hand-computation.

**The two that get read first are `01` and `02`, and that ordering is on purpose.** What-would-have-to-be-true and the assumption register are produced *before* the narrative, because they are what make the stage's spend decision honest.

---

## Running it

> This section describes the package as the manifest declares it. Whether the HTTP and surface layer is present in *your* checkout is answered by `oshal-app.js validate` — see [Build state](#build-state). The engine, the guards and the worked example below run with plain `node` and no install regardless.

**In the cockpit.** Activate the package; the ribbon gains a *Venture Plan* icon which opens the console at `/api/venture/`. Describe an idea in a sentence, and the strategist scopes it. From there the three analysts author assumptions, the engine computes, and the documents render.

**Editing an assumption costs nothing.** Replace a guess with a real quote and the whole model recomputes in code, synchronously, with **no model call**. That is the load-bearing interaction of the whole product: watching the answer move as you buy evidence must never spend money.

**Foreign supplier quotes bind to immutable FX evidence.** Record the source-to-reporting rate first with `POST /ventures/:id/fx-assumptions`, using integer nano-rate units (`1 EUR = 1.085 USD` is `1085000000`). A quote whose currency differs from the venture currency is refused unless it names that exact `fxAssumptionId`. The quote keeps both the supplier-currency micros and the converted reporting-currency micros; the assumption ledger and BOM receive only the latter, with the FX id in their provenance. Rate rows are append-only and idempotent retries must match every business field. There is no live FX feed: the operator supplies the observed rate and its source.

**Scheduled rebaseline has a first-class kernel activation path.** The manifest registers an hourly deterministic service-route tick, not a bot prompt. Its static exact `execute: true` body only asks the package to evaluate policy: every venture policy still defaults disabled and dry-run, and an enabled paid policy also requires a positive integer micro-USD per-run cap. Preview and either dry-run gate reserve no run and call no bot. A due run refreshes BOM, market, and ops assumptions, then recomputes in code, omitting narration for a maximum of three paid calls. The UTC venture/slot is database-unique, and measured provider cost is persisted after each call. The atomic call that first reports an overshoot cannot be unspent, but no later call begins; missing cost also fails closed. Local tests prove registration, service authentication, route ownership, payload immutability, deactivation, and package policy behavior; live provider, real forced-RLS, and deployed scheduler acceptance remain unclaimed. See [the technical specification](REBASELINE-SCHEDULE.md).

**As a swarm ticket.** The package registers ticket type `venture-plan` with the strategist as worker, so a re-baseline can arrive as a real ticket on the kernel queue ("the injection-mould quote came back at $14.20 — redo the plan") rather than borrowing another app's type.

**Exports.** `.docx` narrative plan, `.xlsx` financial model, `.pptx` decision deck, and a `.zip` of everything plus the assumption register as CSV — through the `deck-generation` kernel skill. **There is no PDF renderer in either repo**, so PDF is browser print from the print view, and this README says so rather than implying an export that does not exist. An export is refused when no computed model snapshot exists; a plan must never be rendered from unresolved inputs.

---

## Build state

Counts below were produced by running the command in the last column, not typed from memory.

| | Value | Derived by |
|---|---:|---|
| Modules (source) | 34 | `ls src-routes/*.ts \| wc -l` |
| Compiled modules (what the framework loads) | 34 | `ls routes/*.js \| wc -l` |
| Test suites | 18 | `ls tests/*.test.js \| wc -l` |
| Tests, passing | 258 / 258 | `node --test "tests/*.test.js"` |
| Personas | 4 | `ls personas/*.yaml \| wc -l` |
| Migrations | 5 | `ls migrations/*.sql \| wc -l` |
| Documents in the worked example | 23 | `ls examples/pumpkin/[0-9]*.md \| wc -l` |
| Scenarios in the worked example | 21 | `node examples/pumpkin/regenerate.js` (first line) |
| Channel shapes modelled | 4 | direct, marketplace, big-box, distributor |

```bash
cd venture-plan && node --test "tests/*.test.js"          # the engine and its honesty guards
node scripts/oshal-app.js validate ../oshal-apps/venture-plan   # from the CORE repo
```

`validate` must pass before the package is admitted to the catalogue. The runtime loads the committed files under `routes/`; every source module under `src-routes/` therefore has a compiled twin, and the parity guard fails when those sets drift. The engine, its suites and the worked example run from plain `node` with no install.

Money is **integer micro-currency** (1e-6 of the venture or quote currency) and contractual rates are **integer basis points**. Not cents: a $0.0034 fastener rounds to $0.00 in cents and the unit cost is silently understated, which compounds up a three-level bill of materials. FX rates are integer nano-units and convert through an identified immutable snapshot using an exact integer intermediate. Rounding is half-up *away from zero* and happens only at declared rate/conversion and presentation boundaries.

## What the guards actually assert

Every guard is written against the **compiled** modules — the same bytes the framework loads — and asserts calls and behaviour, never source text.

- **Hand-derived known values**, written out in comments beside each assertion, with the code made to match them rather than the reverse. BOM roll-up with scrap and price-break selection; the landed stack with the merchandise-processing-fee cap binding; every channel waterfall round-tripping forward↔inverse; break-even agreeing with the monthly profit statement *by construction*; the cash trough summed month by month.
- **Foreign quotes cannot masquerade as reporting-currency money.** Known-value and half-micro vectors exercise exact FX conversion; missing, foreign-owner and wrong-pair FX ids fail before any write; vendor and BOM references are owner-bound even when a UUID is known; concurrent retry keys replay or conflict rather than rebinding; and database triggers enforce the same ownership, conversion and immutability rules.
- **Scheduled spend is default-deny at three boundaries.** No-row policies are disabled and dry-run, owner dry-run cannot dispatch, and the service tick itself requires exact `execute: true`. Tests prove unique UTC run slots, owner-bound progress writes, integer-only settlement, no callback after cap exhaustion/overshoot/capture failure, and no owner subject in service results.
- **No bot-authorable source kind can reach `quoted` or `observed`.** The cap is a table, not a single branch: a `model-estimate` stops at `estimated` and a `published-rate` — a page a model says it read, and never fetched — stops at `benchmarked`. Those two strongest grades are reachable only through a recorded vendor quote or an operator's own entry. The guard proves it by relabelling every money assumption as a published rate with a plausible URL and asserting the document posture stays an estimate.
- **An input with no ledger entry turns `canPublish` false**, and so does a computed figure that names no input at all. An empty provenance chain is unprovenanced, not clean — both classification branches test the reference list, so an empty list used to fall through both and score like a fully-quoted number.
- **A document naming a figure the engine never computed throws** rather than printing a blank.
- **Cash ties to profit through the closing working-capital position**, term by term, and an unexplained residual is a BLOCKING issue. Every buyer-paid leg of the landed stack must also leave the bank — the import cash events are derived from `paidBy`, so a leg cannot enter cost of goods without a matching outflow.
- **The cost of stock that does not sell is charged to the profit statement**, so building more than can be sold cannot raise reported profit. The write-down rate is computed once, in the schedule, and the break-even sell-through inversion reads that same figure rather than deriving its own.
- **The generator has its own suite.** Statutory rate ranges (a fee typed at ten times its published value passes every arithmetic test), the basis-point-versus-fraction formatter split, the not-advice boundary on every rendered document, and the sell-through claim reading the inversion rather than break-even units.
- **The sensitivity sweep genuinely rebuilds** — proven by call count, so a future refactor that substitutes an analytic approximation goes red.
- **Purity asserted as behaviour**: byte-identical output across repeat runs, the input object unmutated afterwards, and every compiled module required in a child process with an empty module path so a stray framework import fails loudly.
- **The worked example's own vectors are re-derived** by the dataset suite, so a provenance flag cannot be quietly dropped to make a chart look confident.

Each of these was mutation-proven: the mechanism was broken on purpose, the suite went red, the break was reverted.

---

## What this is not

- **Not a forecast.** It computes what follows from a set of stated inputs. Nothing has been produced or sold and there is no track record, and the application will not imply one.
- **Not sourced, by default.** A first pass rests almost entirely on numbers a model proposed. The assumption register tells you exactly which, and the posture on every document header says so in numbers that change on every regeneration.
- **Not financial, investment, legal, tax or customs advice.** The funding section states a cash requirement computed from the model; how you fund it is an accountant's and a lawyer's question. This boundary is printed in the header of **every generated document**, not only here — a README stays in the repository while the documents travel, and the funding ask and the compliance plan are the two most likely to be forwarded on their own. The regeneration fails a document that loses it.
- **Not a legal or regulatory opinion, and not a compliance claim.** The application **cannot represent a passed test** — a compliance item's status can only be `identified`. Certification scope is a test laboratory's determination and a compliance lawyer's.
- **Not a customs classification.** Where a tariff reading is arguable, both candidate codes are carried with their own duty rates and the model reports both branches. It will not blend them into one landed cost, because a blended rate is the shape of that error that survives review.
- **Not a substitute for a quote.** The point of the assumption register is to be emptied. A plan whose critical path is still `estimated` is a plan for what evidence to buy next, and it should not be shown to a lender or a contract manufacturer as anything else.

A plausible number is the failure mode this application is built around. If it ever prints one you cannot trace, that is a defect — open it with the figure id.

---

## Next increments (not built)

- **Live acceptance for rebaseline scheduling.** The package policy, dry-run service tick, idempotent run, measured-cost gate, and first-class kernel service-route schedule are built and locally exercised. Real forced-RLS, provider, and deployed scheduler evidence still require an authorized environment; no local test is represented as that live proof.
- **FX console workflow and automated rate ingestion.** The backend accepts immutable, sourced FX evidence and binds foreign quotes today; the cockpit still needs an evidence-entry/selection view. Any future rate feed must save the observed response as a new snapshot rather than mutate prior quotes.
- **Side-by-side scenario compare.** Scenarios exist and compute; comparing N of them in one view does not.
- **A saved-quote inbox.** Today a quote is entered by hand. Attaching the quote document and reading the figure off it is the obvious next step and the point where the register stops being tedious.
- **Live supplier directory lookups.** Deliberately absent: a directory search that returns plausible-looking suppliers nobody has contacted would re-introduce exactly the confidence this package exists to remove.
