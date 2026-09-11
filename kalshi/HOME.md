# Kalshi Home

Summary uses only the caller's saved `kalshi_scan_alerts` and `kalshi_orders`. It does not run a market scan, fetch a forecast, refresh a position or place an order.

`recorded-alerts-24h` / `recorded-alerts-5d` count first-seen alert ledger rows in rolling 24/120 hours. `delivered-alerts-5d` counts only rows marked delivered from that same creation cohort. An undelivered row remains recorded, not a confirmed notification. The latest two alerts show ticker, strength, first-seen time and delivery state; no claimed win rate or realized profit is derived from an alert.

The latest two placement records retain the original demo/live environment, side, count, action and status at placement. `kalshi_orders` has no update timestamp; the tile therefore never presents placement status as current fill or settlement evidence. Future records are excluded. Missing sources remain explicitly unavailable and other successful sources still render.

An actual selected alert (or a Home item) supplies bounded context to Trading research, Finance review or Office preparation. Trading receives an editable source draft and asks for a stock ticker before researching. These optional integrations do not install or enable trading providers and never place an order.
