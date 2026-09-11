# Travel Home and connected planning

`saved-fare-watches` counts the caller's active `travel_watches`. `flight-searches-24h` and `flight-searches-5d` count recorded `travel_searches` in the preceding 24/120 hours; the existing flight search writes that ledger, while hotel/car searches do not. Three active watches lead the card. Future rows are excluded. Watches and searches are unconfirmed planning, not itineraries or bookings.

The card offers Rides, Eats, Shopping and Spotify. The native search screen also offers Movies. Outgoing watch context permits only destination/date/party/cabin search fields; arbitrary JSON keys and credentials never travel. Its saved time is included. Current provider price and availability are checked only through the app's normal search flow. Home GET does not search, record observations, create watches or book travel. Partial failures preserve the successful watch or search evidence.
