# TriageNorth

From signals to evidence to action.

A secure AI analysis and response hub for infrastructure and application support.

Proposed product name · Hackathon submission brief · 20 October 2026

## The problem

Support teams have alerts, logs, dashboards and tickets, but still assemble an investigation by hand. One fault can create many notifications. Containers disappear or move before evidence is captured. Operators need to know what happened, what is connected, what evidence supports a recommendation and exactly what they are authorizing.

## The product

TriageNorth brings those decisions into one experience. Named sources feed a visible processing pipeline. Filters and duplicate reduction preserve their reasons. A temporal asset graph connects symptoms to infrastructure. Bounded evidence packets give AI investigators the facts they need. Findings and proposed scripts stay with the incident, ready for review and controlled execution.

Event-to-Action is the first workflow. The broader product is a reusable analysis hub for incident investigation, recurring problems, change risk and capacity warnings. Predictive analysis is a product direction with explicit evaluation gates; it is not claimed as already delivered.

## What the hackathon contributes

The submission is the TriageNorth application: its domain model, source mapping, explainable pipeline, topology and correlation experience, evidence contracts, investigation workflow and response UX. The demo must identify which steps are live, supplied by dependencies or still planned.

The supporting platform is existing OSHAL, installed separately from a pinned Docker/OCI image. It provides identity, granular permissions, workflows, UX services, standard connections, tickets and workspace facilities. Those are inherited capabilities, disclosed in the architecture and dependency list. The product is delivered as its own versioned package on that baseline.

## Why this approach

The product is intended for teams that need to keep existing monitoring and ticketing systems, control where the analysis runs and limit what AI agents can access. Its advantage must be demonstrated through usable integration, inspectable reasoning and safe response—not through unrestricted agent access.

The market already offers capable AIOps and AI investigation products. The accompanying research compares six vendors, published charging units and reproducible cost examples. The commercial case is a measured reduction in investigation effort and better controlled response. No savings percentage or outage-prevention claim is assumed.

## Demonstration and delivery status

Previous local Kubernetes acceptance demonstrated durable manual intake, stored-query filtering, duplicate reduction, inspectable graph correlation, scheduled evaluation and workflow-generated reports on persistent shared storage. Existing source receipts include a labeled 100-event filtering cohort and a seven-event scheduled pause/resume test. These are laboratory results, not a customer benchmark. The runtime is now stopped at the operator's direction pending resource-budget correction and authorization to resume; no current portal availability is claimed. This status correction awaits the brief's next Word/PDF export.

Automatic evidence collection, a validated predictive engine, generated remediation with bound execution and external ticket synchronization remain delivery gates. The target finale is a controlled failure, an evidence-backed proposal, explicit approval, a bounded action and observed recovery.

## Enterprise opportunity

TriageNorth is the customer-facing product. Enterprise adoption also creates an opportunity to offer deployment, integration and support for the underlying platform under its applicable licensing and commercial agreement. The application offering and foundation services are described separately. Pilot economics include infrastructure, model usage, integration and support costs as well as investigation time saved.

See MARKET-RESEARCH.md for sources and cost assumptions, IMPLEMENTATION-STATUS.md for evidence, and PROJECT-PLAN.md for remaining acceptance gates.
