# Eats Home and connected planning

`meal-handoffs-24h` and `meal-handoffs-5d` count `eats_orders` hand-off records in the preceding 24/120 hours, and
`meal-restaurants-30d` the distinct restaurants opened in 30 days, excluding future rows. A row is written only when the
diner confirms a hand-off (`POST /order`): it records the restaurant's Google place id, its name and the Uber Eats link at
the diner's address. These rows record links opened, never confirmed orders or delivery; a concierge proposal writes nothing.

The three newest hand-offs lead the card ("Opened in Uber Eats · <stamp>") and can prepare Shopping, Movies or Spotify
discussions; the native screen also retains Rides. All partners are optional. Home GET never searches restaurants, opens
Uber Eats or queries a provider. Partial source failures preserve the successful counts and show unavailable values for
failed sources.
