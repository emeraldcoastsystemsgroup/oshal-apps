# Shopping Home and connected planning

`active-shopping-lists` counts the caller's active lists. `pending-shopping-items` counts pending items whose parent list is active and belongs to the same caller. Three such items lead the card. `shopping-handoffs-24h` and `shopping-handoffs-5d` count saved checkout handoff rows in the preceding 24/120 hours. Future rows are excluded throughout; checkout links are not confirmed purchases.

Selected items can prepare an Eats discussion, which asks whether the item is relevant to a meal. The handoff carries bounded title and quantity, not a command to buy or cook. Home GET never creates a list, searches a retailer, updates learned preferences or marks an item purchased. Missing sources are unavailable; partial failures preserve valid list evidence. `asOf` is the summary read time and item details retain creation time.
