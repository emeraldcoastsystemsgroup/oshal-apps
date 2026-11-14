# Smart Home backlog

## The refrigerator's inside is not read yet

**As built (1.6.2):** nothing inside the refrigerator is read. The page and the three tools say so
("Nothing has been read from this refrigerator yet…", `reading.read` false), and no shelf item, comparison, grocery
suggestion or meal idea is shown. The fixed list every person used to be given (1.6.1 and before) is gone from
`routes/fridge-weekly-assessment.js`; a state saved from it is carried over keeping only what the person set or added
(the weekly check's day and time, a temperature the hub reported, items they added, orders they logged, meals they
wrote). Since 1.9.0 Smart Home keeps no grocery list: Shopping keeps the person's one grocery list and the refrigerator page shows it. `tests/home-device-inspect-and-guide.test.js` fails if an item, comparison,
order, meal or device id is written into the route again.

**Wanted (Roger, 2026-11-11: "can we get a config for image reasoning ... I'll use one of my subscriptions"):** each
week, and on **Check what is inside now**, the three inside photos are read by the installation's image-reasoning
model for that person, what was seen is kept with its date, and the comparison and the meal ideas are built from the
last two real readings; what is running low is offered for the person's grocery list in Shopping, never kept here.

**Depends on:** the kernel's image reasoning (its `POST /api/vision/describe` answers "image understanding isn't
configured" today, and no setting assigns a model to it).

**Done when:**
- (done in 1.6.2) a new person's refrigerator page says nothing has been read yet, and lists nothing;
- a run with three photos stores a reading that names what the model saw, with the time and the model's name;
- two readings a week apart produce a comparison that changes when the contents change (a test with two different
  sets of stand-in photos and a stand-in model proves it), the meal ideas come from that reading, and what is running
  low is offered for the grocery list in Shopping;
- (done in 1.6.2) the fixed list is gone from the source, and a test fails if an item is written into the route again;
- the cost of each reading is recorded against the person like any other model call.
