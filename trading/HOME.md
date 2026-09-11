# Trading Home

Summary reads the caller's `oshal_trading_orders`, `oshal_trading_books` and `oshal_trading_daily_equity` directly. It never invokes self-healing store helpers, discovers accounts, refreshes a broker or dispatches an order.

`live-orders-24h`, `live-orders-5d`, `paper-orders-24h` and `paper-orders-5d` count order records created in rolling 24/120 hours, excluding future creation/update dates. They are not fill counts or profits. Paper and live never combine. Up to four books retain their individual recorded equity, ET date, update time and saved enablement. Equity is USD, matching the supported trading rails; no sum across books or claimed current broker balance is produced. Same-owner book joins and matching paper/live kind protect snapshot attribution.

Each saved book can continue to Finance review or Office preparation. The native research screen sends only its current loaded research result or the user's edited incoming draft. Kalshi can supply recorded alert context. Receiving Trading displays that context without choosing an account, stock or order; the caller enters a ticker and explicitly chooses Research. No order controls are populated. Sources fail independently; failed data reads remain unavailable.
