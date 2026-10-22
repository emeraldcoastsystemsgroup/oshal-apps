# TriageNorth: market, competition and economics

Research date: 20 October 2026 (America/Chicago). TriageNorth is the working product name. Prices are public USD list prices observed on the linked vendor pages, not negotiated quotes. Feature descriptions are vendor claims, not independent acceptance tests. This analysis concerns operational support across infrastructure and applications; it is not a general customer-service chatbot comparison.

## The product and the buyer

TriageNorth is a secure AI analysis and response hub for teams operating mixed data-center, cloud and container estates. It connects existing signals, asset relationships, change records and tickets into a traceable investigation, then produces a reviewable work proposal and a controlled response. Event-to-Action is the first product workflow. The reusable analysis contract can later support change-risk review, recurring-problem analysis and capacity planning.

The initial buyer hypothesis is an infrastructure or support leader responsible for several monitoring systems and an existing service desk. The initial users are responders, investigators and approvers. A good pilot has recurring alert storms, known service ownership, permission to use sanitized incident evidence and an owner willing to measure investigator time. These are qualification criteria, not evidence of an established customer base.

OSHAL is the existing platform dependency, supplied as a separately versioned Docker/OCI baseline. Its security, workflow, UX, connections and ticket services underpin the product. Platform engineering and inherited capabilities are disclosed as dependencies; the hackathon contribution is the TriageNorth experience and its operational analysis pipeline.

## Why the need is credible

Google's SRE guidance identifies repetitive operational work as toil and explains that excess low-value alerts can distract engineers and conceal more serious problems. Its monitoring guidance distinguishes signals that reveal customer impact from the additional evidence needed to diagnose cause. This supports the problem definition: an alert is the beginning of an investigation, not a complete explanation. [S7, S8]

The competitive market already includes automated investigation, correlation, workflow and AI assistance. Those capabilities establish a relevant purchasing category but also raise the bar for a new entrant. Public packaging includes seats, host-hours, memory-hours, credits and custom quotes. Buyers need both an operational fit assessment and a workload-specific cost model. Pricing complexity alone does not prove poor value or an unmet market.

Our inference is that a useful opening exists for organizations wanting to retain their current monitoring and ticket investments while controlling deployment location, the evidence given to an AI agent, and the transition from advice to execution. Validate that inference with customer interviews and a measured pilot; do not present it as a market-share estimate.

## Competitive landscape and published prices

| Product | Relevant overlap | Public price observed | Buying implication |
|---|---|---|---|
| PagerDuty | Incident coordination, signal intelligence and AI-assisted reliability workflows. | Reliability Platform Starter $2,800/year; Essential $12,000/year; Plus $48,000/year. Essential includes 20 seats, 40,000 events and 4,000 AI actions as displayed; confirm allowance periods and credit-pack terms. Professional incident management is $21/user/month annually or $25 monthly, with separate add-ons. [S1] | Compare the reliability bundle, not just the on-call seat price, against an analysis-and-response product. |
| Datadog | Telemetry context, AI investigation, custom agents and code assistance. | AI credits start at $500 per 500 credits/month billed annually; on-demand $1.30/credit. The page estimates about 6.5 credits per autonomous investigation, with actual consumption varying. [S2] | AI usage is only one bill component. Include monitoring, logs, retention and incident-response products actually needed. |
| Dynatrace | Infrastructure and application observability, topology and root-cause analysis. | Infrastructure $0.04/host-hour; Full-Stack $0.01/memory-GiB-hour; Kubernetes monitoring $0.002/pod-hour, included on Full-Stack hosts. Platform uses annual commitment-based consumption. [S3] | Price the actual host memory, running hours and telemetry workload. Avoid double-counting included Kubernetes monitoring. |
| incident.io | Incident response, on-call, workflows and investigations. | Pro response $25/user/month; Pro on-call adds $20/user/month. Enterprise is custom-priced. Investigations requires Response; no standalone investigation price was established from the reviewed page. [S4] | A seat subtotal is not a quote for equivalent automated investigation coverage. |
| ServiceNow ITOM | Operational management integrated with enterprise workflows and service operations. | Official ITOM page requests a custom quote; no numerical list price established. [S5] | Request entitlement, implementation and AI-consumption details for the customer's existing agreement. It may be a system to integrate with as well as a competitor. |
| BigPanda | Cross-tool event correlation, knowledge graph, detection, triage and resolution. | No public numerical quote established. The pricing URL redirects to a demo request; a separate pricing-request page remains available. [S6] | Closely overlapping positioning. Do not claim vendor-neutral correlation or AI incident analysis is unique to TriageNorth. |

## Transparent examples, not equivalent-product totals

These examples illustrate different charging units. They are not a ranking and should not be summed into one competing stack without a buyer's architecture.

| Assumed workload | Calculation | Limited subtotal |
|---|---|---|
| PagerDuty Essential at its included seat allowance | Published annual platform fee | $12,000/year; extra capacity and contractual terms require confirmation. [S1] |
| 20 incident.io Pro response and on-call users | 20 × ($25 + $20) × 12 | $10,800 annualized at displayed monthly rates; investigation charges and billing commitment not established. [S4] |
| 100 Dynatrace infrastructure hosts running 730 hours/month | 100 × 730 × $0.04 | $2,920/month, $35,040 annualized; infrastructure component only. [S3] |
| 500 Datadog AI investigations/month at the published illustrative average | 500 × 6.5 = 3,250 credits; seven 500-credit bundles | $3,500/month, $42,000/year at annual bundle pricing; AI component only. Actual credit demand can differ. [S2] |

The smallest published platform price already starts in the low thousands per year. The pitch cannot assume every incumbent purchase costs hundreds of thousands, or that self-hosting is automatically cheaper.

## The differentiation to prove

| Product hypothesis | What would substantiate it | What would falsify or limit it |
|---|---|---|
| Preserve existing tools while unifying investigations | The same incident links evidence from at least two monitoring sources, current topology and the customer's ticket system, with source identity retained. | Integration effort exceeds the benefit or a required source cannot be admitted reliably. |
| Give AI bounded evidence instead of broad infrastructure authority | The agent uses a versioned, redacted packet; tests deny unrelated data and cluster credentials. Evidence requests use separately authorized collectors. | Hidden credential exposure, ambient cluster access or cross-owner retrieval. |
| Explain every reduction and recommendation | Operators can inspect raw-to-normalized mapping, filter rule, duplicate key, correlation path, freshness and cited evidence. | Suppression hides important incidents or explanations cannot be reproduced. |
| Fit customer deployment and model choices | Pinned platform image plus product package installs reproducibly; supported models produce comparable evaluated results under the same policy. | A vendor-specific runtime or undeclared external service becomes mandatory. |
| Control response through the ticket workflow | Generated artifacts, exact approved versions, restricted targets and verification receipts remain connected to one incident. | A script download or successful command exit is treated as proof of recovery. |

Competitors may support some or all of these properties. Our value is the tested combination, focused user experience, deployment fit and measured economics—not a claim that competitors lack security or automation.

## Secure, predictive and responsive: separate proof obligations

**Secure:** carry the current user's authority through source access, evidence retrieval, workflow and execution. Treat log messages and external text as untrusted input. Agents receive preprocessed evidence; collectors retain scoped tool access. Show evidence versions, redactions, approval scope and revocation. Test denied access, malicious evidence instructions and stale approval before using a security claim in the submission. NIST's AI RMF Playbook supplies a governance reference; it does not certify this implementation. [S9]

**Predictive:** begin with declared use cases such as disk exhaustion, saturation trends, repeated incident precursors and change-associated risk. A static threshold is detection; an anomaly score is not automatically a forecast. A prediction needs a target, time horizon, uncertainty, baseline and held-out evaluation. Split training/evaluation by time, keep future information out, measure precision/recall, false alerts per asset-day and warning lead time, and abstain when evidence is stale. Compare against a simple threshold or trend baseline. These are planned product gates; a production predictive engine has not been delivered.

**Responsive:** measure alert acceptance-to-decision, decision-to-evidence, evidence-to-proposal and approval-to-verified-result separately, with p50/p95, queue depth and failure rate. The current personal scheduler runs on minute boundaries; do not market it as subsecond processing. Bounded retries, visible backlog and pause/revocation are part of a useful response experience. An approved action still requires postcondition verification.

## Pilot and business case

Run a four-week pilot after the required integration gates are delivered. Week one establishes source coverage, permissions and historical baselines; week two runs read-only shadow analysis; week three compares operator-reviewed proposals; week four demonstrates one bounded approved response in a disposable environment. Use labeled historical incidents plus injected failures, and keep the two populations separate in the report.

Measure investigation minutes per incident, actionable-alert precision, missed incident count, accepted recommendation rate, evidence coverage, cost per completed investigation and recovery verification. Have reviewers score recommendations without being told which model produced them. Record counterexamples and unsafe suggestions, not only successful demos.

An illustrative labor model is 200 investigations/month × 20 minutes saved ÷ 60 × $100/hour = approximately $6,667/month of capacity, or $80,000/year. Those are assumptions to replace with customer measurements. Released engineering time is not automatically cash savings. Do not add speculative outage avoidance to the base case.

Product total cost must include platform commercial terms where applicable, product support/subscription, cluster compute, PostgreSQL/search/storage, backups, model inference, data transfer, retained telemetry tools, integration maintenance, security review and operator labor. The current lab is not a production cost benchmark. Report both incremental cost for a customer keeping its existing tools and fully loaded operating cost. There is no approved TriageNorth price or demonstrated savings percentage yet.

## Commercialization and foundation exposure

Sell the TriageNorth outcome and user experience. Disclose the OSHAL foundation in the architecture, dependency inventory and procurement materials. The commercial hypothesis is a product subscription/support offer plus optional enterprise deployment, integration and support for the underlying platform under the applicable agreement. Show those lines separately so a buyer can understand what it purchases.

Commercial terms for the foundation are managed separately from this application design. This submission identifies the platform dependency and the application contribution; it does not define platform licensing, pricing or ownership. Registry release, upgrade/rollback, integration maintenance and support obligations remain explicit product launch dependencies.


## Foundation licensing reference

The existing OSHAL foundation is documented as **AGPL-3.0-or-later with a paid
commercial-license alternative**. The reference checkout agrees across `LICENSE`,
`package.json`, `NOTICE` and `docs/legal/licensing.md`. The commercial alternative
serves uses that cannot meet the AGPL terms; the documentation also permits commercial
use under the AGPL. TriageNorth is the application submission, and the foundation is
a separately installed dependency. Its license and notices remain attributed.

The native-kernel Cargo metadata currently conflicts with that documented project
model. Reconcile metadata and the actual release license/notice payload before
publishing the baseline image. This application documentation records the discrepancy;
it does not replace or amend a software license.

## Source register

All sources accessed 20 October 2026 local time. Numerical examples above are our calculations from the cited public rates. No sales contact was made and no quote was obtained.

- S1 — PagerDuty plans and pricing: https://www.pagerduty.com/pricing/
- S2 — Datadog pricing, AI Credits section: https://www.datadoghq.com/pricing/
- S3 — Dynatrace pricing: https://www.dynatrace.com/pricing/
- S4 — incident.io pricing: https://incident.io/pricing
- S5 — ServiceNow ITOM pricing: https://www.servicenow.com/products/it-operations-management/pricing.html
- S6 — BigPanda product and quote pages: https://www.bigpanda.io/our-product/ and https://www.bigpanda.io/request-pricing/ . The /pricing/ URL redirected to https://www.bigpanda.io/demorequest/ during review.
- S7 — Google SRE, Eliminating Toil: https://sre.google/workbook/eliminating-toil/
- S8 — Google SRE, Monitoring: https://sre.google/workbook/monitoring/
- S9 — NIST AI RMF Playbook: https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook

- S10 — Existing OSHAL project licensing sources: `LICENSE`, `NOTICE`, `package.json`, `docs/legal/licensing.md`; reference checkout revision `6c42c27bd14a43268dd7804698a2ae2129109573`. Public source text: https://www.gnu.org/licenses/agpl-3.0.html .
