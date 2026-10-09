# Rides Home and connected planning

`ride-handoffs-24h` and `ride-handoffs-5d` count the caller's `rides_requests` created within the preceding 24 and 120 hours, excluding future rows. They count prepared ride links, not bookings, payments or completed rides. Since 1.5.0 a row is written only when the rider confirms a ride; a concierge's ride proposal writes nothing. Up to three saved requests within five days expose destination, pickup and creation time for meal or travel preparation.

Home GET reads existing owner-scoped rows only. The receiving ride draft and native destination controls remain editable; a context handoff never orders a ride. Eats and Travel are optional loaded partners. The saved timestamp travels with the context; `asOf` describes the summary read. Missing data sources show unavailable counts.
