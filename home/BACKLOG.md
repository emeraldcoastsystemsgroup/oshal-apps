# Smart Home backlog

## The refrigerator's weekly reading is a fixed list

**As built (1.6.1):** `routes/fridge-weekly-assessment.js` starts every person's state from one fixed list: the
items on the shelves, last week's states, the order history, the grocery list and five meals (lines 30 to 117).
`runWeeklyFridgeAssessment` changes the two temperatures when the hub reports them, the picture's address and the
meal focus. Nothing reads the inside photos, so the page shows the same contents every week and for every person.
Since 1.6.1 a temperature is shown only when the hub reported it (`telemetry.measuredAt`); the lists are unchanged.

**Wanted (Roger, 2026-11-11: "can we get a config for image reasoning ... I'll use one of my subscriptions"):** each
week, and on **Check what is inside now**, the three inside photos are read by the installation's image-reasoning
model for that person, what was seen is kept with its date, and the comparison, the grocery list and the meal ideas
are built from the last two real readings.

**Depends on:** the kernel's image reasoning (its `POST /api/vision/describe` answers "image understanding isn't
configured" today, and no setting assigns a model to it).

**Done when:**
- a new person's refrigerator page says nothing has been read yet, and lists nothing;
- a run with three photos stores a reading that names what the model saw, with the time and the model's name;
- two readings a week apart produce a comparison that changes when the contents change (a test with two different
  sets of stand-in photos and a stand-in model proves it), and the grocery list and meal ideas come from that reading;
- the fixed list is gone from the source, and a test fails if an item name is written into the route again;
- the cost of each reading is recorded against the person like any other model call.
