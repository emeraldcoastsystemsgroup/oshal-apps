# Historical RCA references

Installed through the native registry, 21 October 2026. Live browser acceptance
verified the current-user catalogue, original work receipts, input digests and
accepted report artifact links.

Open RCA library from the native Operations navigation. Search the returned
incident title, description-derived title, identifier or state. Select a record
to read its original analysis phases, result receipts, input digests and accepted
workflow artifact links. The library uses the same split-panel layout as Systems.

The library reads `/api/tickets`, `/tickets/{id}/work` and
`/api/v1/workspace/{id}/files` with the current portal session. It retains no copied
report and creates no second incident table. Native source permissions remain
authoritative. Downloads must select an accepted work/artifact under the exact
original ticket; arbitrary URLs and another ticket's selectors are refused.

A completed analysis needs a completed work state and an available result receipt
before it is presented as a recorded decision. Missing input lineage and unavailable
artifact runs remain visible. A `done` ticket means report acceptance; the library
does not convert that into verified infrastructure recovery or a proven root cause.
Source content is untrusted evidence, rendered as text rather than executable HTML.

Search currently covers loaded ticket metadata, not the full text of every report.
At most 100 matching records are shown; this is explicitly labeled. The native
catalogue has a 10,000-record read ceiling. Each selection retrieves at most 100
work entries and 300 artifact entries; oversized answers are not previewed.
Refusal clears private catalogue/detail content. Older selection responses cannot
replace a newer result or restore data after access is withdrawn.

## Existing storage and correlation

The current Operations package stores temporal topology scans and correlation
analyses in `operations_topology_scans` and `operations_topology_decisions`.
`operations_investigations` links admitted evidence reservations to canonical
workflow tickets. Canonical work records and accepted workspace artifacts retain
the reports and their source lineage. These are separate records with distinct
purposes. The manifest does not currently declare a historical RCA knowledge
collection or a reviewed case-reference graph.

A native knowledge service exists, but its availability does not establish that
this application's RCAs have been indexed. The library does not claim semantic
retrieval, automatic cause matching or learning from unreviewed bot conclusions.

Next increment: select a bounded historical case as an explicit cited input to
another investigation, revalidate original-source access and exact digests, and
retain its original result/acceptance/recovery state. Add a scoped search index
only when every indexed passage can be traced to that source and withdrawal is
honored. Similar symptoms are candidate references; they are not proof of the same
root cause or permission to replay the old remediation.
