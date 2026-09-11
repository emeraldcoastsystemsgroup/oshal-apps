# Finance Home

The signed-in owner's saved bank links, cached aggregate and recorded transfers supply this tile. GET only performs bounded SELECTs; it never links, syncs, analyzes or moves funds. Each source fails independently and unavailable data is not zero.

| Metric | Definition |
|---|---|
| linked-institutions | Saved `oshal_finance_items` rows, excluding future link dates. A saved link does not prove connectivity. |
| cached-net-worth | Saved aggregate net and recorded currency. Mixed account currencies are labeled instead of summed. Missing/invalid snapshots are explicit. |
| snapshot-mode | Aggregate's recorded Plaid environment. Older snapshots say mode not recorded. |
| snapshot-age | `synced_at`, not the Home refresh time. |

The saved brief carries its own generation and snapshot dates. Recent transfers are the latest two created in 120 hours, labeled TEST/LIVE and last recorded status. Their Office action prepares a document from that evidence.

Payments and Payroll can send selected-record evidence to an editable Finance review. Arrival makes no provider or AI call. The explicit Review button uses POST `/review` with confirmation and the caller's cached accounts. Missing accounts require a separate link/sync. The result is advisory and can continue into Office. Payment amount, funding source and transfer controls are never populated by a handoff. Initial dashboard loads request cached briefs only.
