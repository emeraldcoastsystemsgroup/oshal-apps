# Payroll Home

The owner's saved payroll ledger supplies this tile. Every query is a bounded SELECT. Payment rows join a same-owner run; no employee names, account numbers or tax identifiers leave the payroll surface.

| Metric | Definition |
|---|---|
| draft-pay-runs | Saved runs with draft status. |
| posted-pay-runs | Runs marked paid in the ledger; this means approved/recorded, not bank settlement. |
| pending-payments / returned-payments | Payment records with those exact states and an authorized parent run. |

Future record timestamps are excluded; future pay dates remain useful planning information. Up to three runs prioritize drafts, then last update. Each item includes period, pay date and recorded status. Opening a run makes its own evidence available to Finance review or Office document preparation. No employee roster, generated bank file, approval or payment instruction is sent. Receiving apps retain their own explicit execution controls. Partial failures remain visible.
