# Payments Home

Caller-owned `oshal_merchant_payments` records supply the tile. Summary GET is SELECT-only, bounded to 1.8 seconds per query, with independent unavailable states. Future created/updated records are excluded.

| Metric | Definition |
|---|---|
| live-charges-24h / live-charges-5d | Live records created in the preceding 24/120 hours whose current recorded status is completed. These are creation cohorts, not completion-time counts. |
| live-charges-pending | All caller-owned live records with pending recorded status. |
| live-charges-failed-5d | Live records created in 120 hours with failed recorded status. |
| test-charges-5d | Test records created in 120 hours, separately counted. |

The latest three records from 120 hours show exact cents/currency, provider, recorded status and update time. No provider refresh occurs. Select Review on an actual history row, or a Home item action, to prepare evidence in Finance or Office. The draft contains no payment token or payer URL. Finance review requires its own explicit action and cached account evidence; no charge/refund/transfer occurs on handoff.
