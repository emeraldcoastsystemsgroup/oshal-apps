# Eats Home and connected planning

`pending-meal-items` counts pending rows in the caller's active meal carts. Both cart and item ownership must match. `meal-handoffs-24h` and `meal-handoffs-5d` count `eats_orders` handoff records in the preceding 24/120 hours, excluding future rows. These rows record checkout links, not confirmed orders or delivery.

Three pending cart items lead the card and can prepare Shopping, Movies or Spotify discussions. The native screen also retains Rides. All partners are optional. An item suggestion is explicitly a cart choice, and Shopping must determine whether it is relevant to ingredients. Home GET never creates the default cart, orders food or queries a provider. Partial source failures preserve the successful counts and show unavailable values for failed sources.
