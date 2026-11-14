# Lists

Make any list and keep track of it: a to-do list, a packing list, gift ideas, home projects, anything you name. A list has a name and items; an item has its words, is open or done, and may have a note, a quantity and a
due date. Each person's lists are their own.

The **grocery list is not kept here**. Shopping keeps a person's one grocery list and makes the grocery order from
it. A list named Groceries, Grocery or Shopping is refused with those words (`kept_by_shopping`), and the Lists
screen shows Shopping's list beside the person's own lists.

## The screen

`/api/lists/app` (tile **Lists**):

- The lists are down the left with how many items are open; **New list** is with them. On a phone the lists are
  their own screen and a list opens with **‹ Lists** to go back.
- In a list: **Add an item** at the top, a round checkbox on every row, done items struck through under a collapsed
  **Done** row.
- A row opens its **details**: the words, a note, a quantity, a due date, Remove.
- A row's **⋯** menu: Details, Move up, Move down, Remove. On a wide screen a row is also dragged by its handle.
  Removing offers **Undo**.
- The list's **⋯** menu: Rename, Clear done items, Delete list. Clearing and deleting ask first.
- **Groceries** is first among the lists with the mark **Shopping** when the person can open Shopping. Adding,
  ticking and removing there use Shopping's own routes in the person's session; **Order** opens Shopping. It has no
  rename, clear or delete here, and its rows have no note or due date: those are not Shopping's.

Colours come from the portal theme's tokens. Text from the server is always written as text.

## The concierge

`lists-concierge` (inline) has thirteen tools, and each is a route the screen itself calls:

| Tool | Route | Held for approval |
|---|---|---|
| `lists-all` | `GET /api/lists/lists` | no |
| `lists-show` | `GET /api/lists/show?list=` | no |
| `lists-create` | `POST /api/lists/lists` | no |
| `lists-rename` | `POST /api/lists/rename` | no |
| `lists-delete` | `POST /api/lists/delete` | yes |
| `lists-add-item`, `lists-add-items` | `POST /api/lists/items/add` | no |
| `lists-check-item` | `POST /api/lists/items/check` | no |
| `lists-uncheck-item` | `POST /api/lists/items/uncheck` | no |
| `lists-edit-item` | `POST /api/lists/items/edit` | no |
| `lists-move-item` | `POST /api/lists/items/move` | no |
| `lists-remove-item` | `POST /api/lists/items/remove` | yes |
| `lists-clear-done` | `POST /api/lists/clear-done` | yes |

A list and an item are named in the request by id or by the words the person used ("my packing list" is the list
Packing; "socks" is the item Socks). Two matches are not guessed: the answer is 409 with the names that match.
Adding to a list that does not exist yet makes it. An item already on the list is not added twice, and a done one
comes back. No name travels in an address: a read takes it in the query, a change in the body.

Adding, ticking, editing, renaming and moving run at once, as they do in every list product: they are small, visible
and undone in one press. What cannot be undone is a card the person approves: deleting a list, removing an item,
clearing the done items.

## Data

`migrations/001-lists.sql`: `lists_lists` and `lists_items`, plain tables with one text primary key each. On the
native kernel each person has a private copy of a package's tables; every statement also names the caller. The
statements (`routes/lists-store.mjs`, thirteen of them) are reads by text equality, plain inserts, and updates and
deletes by key: no ON CONFLICT, no join, no ORDER BY, no transaction. The package sorts. Open items are 65536 places
apart, so moving one changes one row.

Limits: 100 lists a person, 300 items a list, 50 items a call, a name of 80 characters, an item of 300, a note of
1000, a quantity from 1 to 9999.

## Tests

```bash
cd lists
node --test "tests/*.test.cjs"                      # rules, routes, declarations, and PostgreSQL (below)
node --test tests/browser/lists-page.browser.cjs    # the screen in Chromium
```

`tests/lists-postgres.test.cjs` runs every route scenario on a real PostgreSQL with the migration applied. It needs
`OSHAL_TEST_POSTGRES` (the gate's disposable PostgreSQL on 127.0.0.1:35689) and fails without it. The same scenarios
run over a memory pool in `tests/lists-routes.test.cjs`, which also refuses a write during a GET as the native
kernel does. What these do not prove: that the native kernel's own SQL interpreter runs the thirteen statements; that
is proved on a kernel after delivery (`tests/live/lists-live.py`).

## Reference products

The screen copies where the category's leading products agree, from their own help pages (read 2026-11-14). Layout
and behaviour only; no name, colour or mark of theirs.

- Lists in a left sidebar on a wide screen and their own screen on a phone, with "new list" beside them:
  [Microsoft To Do](https://support.microsoft.com/en-us/accessibility/todo/use-a-screen-reader-to-explore-and-navigate-to-do),
  [Apple Reminders on Mac](https://support.apple.com/guide/reminders/create-change-or-delete-reminder-lists-remn8f00ee72/mac),
  [Apple Reminders on iPhone](https://support.apple.com/guide/iphone/make-a-grocery-list-iph80ba26e1f/ios).
- One add field named for the action, at the top:
  [Google Tasks](https://support.google.com/tasks/answer/7675838?hl=en&co=GENIE.Platform%3DDesktop) ("At the top,
  click Add a task").
- One tap on a checkbox left of the item; finished items under a collapsed "Completed" row:
  [Google Tasks](https://support.google.com/tasks/answer/7675629?hl=en&co=GENIE.Platform%3DDesktop),
  [Microsoft To Do](https://support.microsoft.com/en-us/office/use-a-screen-reader-to-work-with-lists-in-to-do-23df9ffd-e7a2-43c3-b57d-ffcc1603f0fa).
  Crossed off with a strikethrough: [AnyList](https://help.anylist.com/articles/getting-started/).
- Rename, delete and clear completed in one "more" menu on the list, and deleting asks first:
  [Google Tasks](https://support.google.com/tasks/answer/7675690?hl=en&co=GENIE.Platform%3DDesktop),
  [Apple Reminders](https://support.apple.com/guide/iphone/edit-and-organize-a-list-iph82596cb20/ios),
  [AnyList](https://help.anylist.com/articles/delete-crossed-off-items/).
- A note and a due date live in the item's details, opened from the row:
  [Microsoft To Do](https://support.microsoft.com/en-us/todo/add-steps-importance-notes-tags-and-categories-to-your-tasks),
  [Apple Reminders](https://support.apple.com/guide/iphone/add-details-iphec7a1de82/ios). A quantity in the details:
  [AnyList](https://help.anylist.com/articles/add-item-quantity/).
- Reorder by holding and dragging:
  [Microsoft To Do](https://support.microsoft.com/en-us/office/move-tasks-between-or-within-lists-8360617e-63c6-4bf7-952a-60af4b920b62),
  [Apple Reminders](https://support.apple.com/guide/iphone/edit-and-organize-a-list-iph82596cb20/ios). Move up and
  Move down in the row menu are added for a phone and a keyboard.
- An undo after deleting an item: [Google Tasks](https://support.google.com/tasks/answer/7675690?hl=en&co=GENIE.Platform%3DDesktop).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| lists-concierge | concierge answer | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
