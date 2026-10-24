# ADR 0051: Ticket-centered incident trace

Status: accepted for the Operations experience, 23 October 2026.

An operator previously had to compare the Data pipeline, canonical ticket, response plan and Connections pages by hand to tell whether an alert led to a verified recovery. This is easy to misread: a completed report is not a recovery, and an operator-reported connector readback is not server-verified provider state.

Incident work now offers **Trace** for each returned Operations ticket. The view reads the signed-in person's existing records and joins them by exact ticket, delivery, evidence reservation, plan, execution and external-link IDs. It shows the saved filtering and noise decision, correlation cohort, packet digest, canonical workflow state, generated file downloads, approval, execution receipt, recovered signal and external handoff. Source records remain behind their established own-scope APIs. The trace performs no action and opens the existing ticket and file rails.

Each source is bounded independently (the latest 20 investigations/plans, 200 pipeline decisions, 32 external links and the latest event page). A missing link is labeled as absent **from the returned page**, and truncation is visible. A failed read is named; an access refusal clears the private view. The UI never joins by approximate time or resource name, treats command/provider results as operator-reported unless the record says otherwise, and never infers recovery from ticket completion.

This is a read-only composition layer. A later server-side indexed incident projection should remove page limits and provide a durable single query; external provider synchronization and Workflow Studio phase/artifact lineage remain separate requirements.
