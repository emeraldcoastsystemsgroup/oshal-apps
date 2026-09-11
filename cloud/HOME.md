# cloud on Home

Uses the canonical accessibleConnections helper, including tenant sharing rules, filtered to the declared gcp connector. Shows saved account count and nonrenewable expired authorization count. Never serializes tokens or connection rows. No inventory, cost or health metrics are claimed without a saved source. Opening Cloud Accounts is the configuration action; Home never refreshes or invokes a cloud tool.

Every declared metric defaults on and can be hidden or reordered. Summary GET requires an authenticated session. Source failure returns unavailable, not healthy or empty.
