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

## A title opened directly on a Samsung TV, and application buttons on the TV cards

**As built (1.9.1):** on a Samsung TV `launch_app` opens the application only. A request that names a title
(`contentId`) is refused in words by the plan (`title_not_on_samsung`) and by the bridge (`samsung_title_not_built`),
so nothing is sent. On a Roku a title opens by the application's own content id. The three actions (`launch_app`,
`list_apps`, `active_app`) are Jarvis tools only: a TV's card on the Smart Home screen has no button for them. They
are tested against stand-in TVs on `127.0.0.1` and have not been run against a real Roku or Samsung TV.

**Why a Samsung title is not built:** the TV's remote channel carries a title to an application as free text
(`ed.apps.launch`, `action_type` `DEEP_LINK`, `metaTag`), and what each application expects in it could not be
checked against a stand-in. Sending it unverified would let an answer say a title opened when the application
ignored it, and neither the bridge nor Smart Home can see the screen to tell.

**Done when:**
- the three actions have each been run once against a real Roku and a real Samsung TV from the person's own
  computer, and what each TV answered is recorded beside the stand-in suites;
- for each Samsung application a title is offered for, the `metaTag` it accepts was read from a real TV and is a
  closed template in the bridge (an id put into fixed text, never a web address from a request), with a stand-in
  test for the exact message sent;
- a Samsung launch with a title answers what the TV reported (running and in front) and says that the TV does not
  report which title is showing;
- a Roku or Samsung TV's card shows the application in front from its last answer and offers **What's in front**
  and its listed applications, with a browser test at 412 x 915.
