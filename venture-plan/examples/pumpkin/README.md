# Pumpkin venture — the generated document set

> **Posture: ESTIMATE.** No supplier has been contacted, no quote has been received, no unit has been built and nothing has been sold. Every figure in this corpus is either computed by the venture engine or a labelled assumption carrying its own source and confidence. **Nothing here is a manufacturing commitment and none of it should be shown to a lender or an investor as a forecast.**

> **Not financial, investment, legal, tax or customs advice.** This is a planning instrument built from labelled assumptions, and nothing in it is a manufacturing, purchasing or funding commitment.
> A tariff classification is a licensed customs broker's determination and, where it matters, a binding ruling from the customs authority — not a figure a model chooses.
> A certification scope and a pass are a laboratory's determination; this document set has no way to express a compliance claim and does not make one.
> How a cash requirement is funded, and what it does to a balance sheet or a tax position, is an accountant's and a lawyer's question.

## What this is

A worked example of the `venture-plan` application: one idea — an inflatable Halloween pumpkin with a projector inside it that throws a talking, lip-syncing jack-o'-lantern face onto its own skin — taken through the full venture document set.

The architecture that produced it splits at the arithmetic line. A language model may propose an assumption, and every assumption enters carrying where it came from and how much it is worth; **all the arithmetic is done in code**, by a deterministic engine with no clock, no randomness and no network. A model-authored number is capped at `estimated` confidence on the way in, so no guess in this corpus can present itself as a quote.

## Regenerate

```bash
cd venture-plan
node examples/pumpkin/regenerate.js
```

The regeneration audits its own output and exits non-zero if any dollar figure in any document did not come out of the engine, if any competitive absolute appears, or if any document references a figure the engine did not compute.

## The corpus

| Document | Why it exists |
| --- | --- |
| [`00-decision-summary.md`](00-decision-summary.md) | The verdict, the five numbers behind it, and the single most likely reason it fails. |
| [`01-what-would-have-to-be-true.md`](01-what-would-have-to-be-true.md) | Every driver inverted: what each input would have to become, found by rebuilding the whole model rather than rearranging a formula. |
| [`02-assumption-register.md`](02-assumption-register.md) | Every input the engine computed on, with its source, its confidence and whether anybody has quoted it. The document that makes the other twenty-two honest. |
| [`03-what-exists-and-what-does-not.md`](03-what-exists-and-what-does-not.md) | The software that runs today against the hardware that does not exist at all. |
| [`04-technical-feasibility-gates.md`](04-technical-feasibility-gates.md) | Eight gates with their worked arithmetic. Three overturned an intuition; two are open and no arithmetic closes them. |
| [`05-market-and-competition.md`](05-market-and-competition.md) | The prices observed on real retail surfaces, and what already ships. |
| [`06-bill-of-materials.md`](06-bill-of-materials.md) | The costed roll-up at every corner, with per-line provenance. |
| [`07-manufacturing-plan.md`](07-manufacturing-plan.md) | What is actually being manufactured, the tooling, and why lead time is the binding constraint. |
| [`08-supplier-plan-srm.md`](08-supplier-plan-srm.md) | Every supplier category the product needs, none of which has been contacted, and the request-for-quotation package that would change that. |
| [`09-logistics-and-landed-cost.md`](09-logistics-and-landed-cost.md) | The landed stack under both tariff classifications, never blended into one. |
| [`10-compliance-and-certification.md`](10-compliance-and-certification.md) | Four regimes, when the money is spent, and the branch decided by marketing copy rather than engineering. |
| [`11-unit-economics.md`](11-unit-economics.md) | One row per scenario, and how to read the table without being misled by the cost-up rows. |
| [`12-channel-margin-waterfalls.md`](12-channel-margin-waterfalls.md) | Every line the money passes through, per channel, plus the fees this model cannot carry. |
| [`13-financial-model-pl.md`](13-financial-model-pl.md) | The monthly profit statement for the one configuration that returns a positive net income. |
| [`14-cash-flow-and-working-capital.md`](14-cash-flow-and-working-capital.md) | The document that decides whether the company survives: the monthly cash curve and its trough. |
| [`15-sensitivity-and-risk.md`](15-sensitivity-and-risk.md) | What moves the answer, measured by rebuilding the entire model at each end of each researched range. |
| [`16-org-and-hiring-plan.md`](16-org-and-hiring-plan.md) | Why the base plan pays nobody, and what happens when the six functions are staffed. |
| [`17-timeline-and-critical-path.md`](17-timeline-and-critical-path.md) | Scheduled backward from a date that does not move, and the corner where the season is lost. |
| [`18-go-to-market.md`](18-go-to-market.md) | Every route to market, the seasonal marketplace trap, and the sequence the arithmetic implies. |
| [`19-funding-ask.md`](19-funding-ask.md) | The cheque, what it buys, and what it conspicuously does not buy. |
| [`20-fatal-flaw-register.md`](20-fatal-flaw-register.md) | Ranked by what ends the venture rather than by what is easy to mitigate. |
| [`21-stage-1-gate-memo.md`](21-stage-1-gate-memo.md) | Whether the next tranche of spend is justified, judged against criteria stated as numbers. |
| [`22-engine-reconciliation-and-refusal-control.md`](22-engine-reconciliation-and-refusal-control.md) | The engine checked against the dataset's own independent hand-computation, and the refusal mechanism demonstrated on a control model. |


## Generated counts

|  | Value |
| --- | ---: |
| Documents generated | 24 |
| Scenarios modelled | 21 |
| Full model rebuilds for the sensitivity analysis | 232 |
| Registered assumptions in the base ledger | 82 |
| Assumptions carrying a vendor quote | 0 |
| Assumptions flagged as needing a quote | 60 |
| Assumptions this run added because the dataset lacks them | 24 |
| Computed figures in the base model | 37 |
| Computed figures resting on a soft input | 34 |
| Share of landed cost on unquoted lines | 98.4% |
| Model posture | estimate |


## The headline

Read [`00-decision-summary.md`](00-decision-summary.md) first. In one line: **as an item sold in a store the arithmetic says no** — at the top of the observed Halloween animatronics shelf the self-contained unit loses $21 on every unit, and the cheaper kit is worse rather than better. One configuration does clear its cost: the self-contained unit sold direct at a premium price. And the tier that carries no bill of materials at all — the software, which already runs today — carries none of the costs that kill the other two.

## What this corpus is not

- **Not a forecast.** Nothing has been produced or sold, and there is no track record.
- **Not sourced.** 98.4% of the landed cost rests on lines nobody has quoted; 0 of 82 registered assumptions carry a vendor quote.
- **Not a compliance opinion.** No standard has been tested against, no laboratory engaged and no certificate exists. No claim of compliance appears anywhere, and the document set cannot express one.
- **Not a customs classification.** The tariff treatment is unresolved and the spread between the two candidate readings is larger than the margin on the product.

The direction of the findings is robust — the gaps are tens of percent, far wider than any single band's uncertainty. The absolute figures are not. Use this to decide what evidence to buy next.
