# Calendar

The review screen loads independently of optional calendar-sync and briefing services. Explicit sync and brief collection retain their existing authentication, confirmation and consent checks, and report an unavailable operation when the host does not provide those services.

Events the person adds in OSHAL live in `calendar_own_events` (migration 003) behind `/api/calendar/events`: list, add (confirm required; a date is all day, a timed start carries its UTC offset) and remove, always the caller's own rows. The concierge reaches them through `calendar-my-events` and the approval-held `calendar-add-event` and `calendar-remove-event`, so an event drafted with Jarvis can be put on the calendar once the person approves the card. They are not written to Google Calendar; the Home summary lists them beside synced events, marked "added in OSHAL". `node --test calendar/tests/own-events.test.cjs` covers them.

## Adding events to Google Calendar

`POST /api/calendar/google-events` adds one event, or one repeating series, to the caller's own primary Google Calendar. The concierge reaches it through `calendar-add-google-event`, held for the person's approval: nothing is sent to Google before they approve the card, and the card lists the title, the first date and time in the event's zone, the end, where, the zone and the repeat (every day, week on named weekdays, month or year; a number of times or a last date). A series is one Google event with an RRULE whose start is its first date; a weekly series' first date must fall on one of its weekdays, and the refusal names the first one that does. Under the native kernel the request goes through the declared `www.googleapis.com` egress with no Authorization header, and the kernel places the caller's own `google-calendar` grant. No connection, a credential Google no longer accepts, or a grant that may only read the calendar answers 409 saying in words what to connect. The same series approved twice is added once (a client-chosen event id that Google refuses a second time); one the person removed in Google is restored when they ask again. The OSHAL-only add (`calendar-add-event`) still keeps single events in OSHAL and refuses a repeat.

`node --test "calendar/tests/*-events.test.cjs"` runs the route over a stand-in kernel egress and a stand-in Google Calendar API; `OSHAL_KERNEL_PLATFORM=<kernel platform export> node --test calendar/tests/google-events-card.test.cjs` renders the card with the kernel's own card code.

Run `node --test calendar/tests/native-load.test.cjs` from the store root to check independent screen loading and visible failures without provider or database access. The fixture uses the installed framework Express module; set `OSHAL_CORE_ROOT` when the framework checkout is elsewhere.

## Personal calendar

`/api/calendar/review` opens a month grid and selected-day agenda. `/api/calendar/review?compact=1` provides the same calendar for Today without the meeting-preparation panels. Event entry and removal use the existing confirmed own-event API; OSHAL events are never written to Google (only an approved Google add is).

`GET /api/calendar/events/agenda?from=2026-10-01&to=2026-10-31&tz=America%2FChicago` requires the original authenticated caller. The closed query accepts real civil dates spanning at most 62 inclusive days and an IANA viewer zone. Timed events appear on every overlapping local day, including events already underway; exclusive ends do not spill into the next day. All-day dates remain literal calendar days, with an exclusive all-day end. A nonexistent browser-local DST time is refused before submission. Existing concierge event tools and approval contracts are unchanged.

The read checks all owned rows, including history, under the existing owner predicate and storage authority. More than 500 owned rows or 250 snapshot entries refuses the read explicitly; it never silently truncates. Invalid individual saved events produce a visible partial-data warning. An unavailable or refused read is distinct from an empty calendar.

Google data is the saved primary-calendar snapshot from the last explicit sync: the next 30 days, at most 250 events, titles/times/links only. Other dates and other calendars may be incomplete. OSHAL events work without a Google connection. Opening either calendar view never syncs or writes automatically.

Run from the Store root with the actual pinned `scripts/toolchain/node_modules` (or `STORE_CI_TOOLCHAIN` pointing at its toolchain directory):

```sh
# Supply OSHAL_TEST_POSTGRES privately; only 127.0.0.1:35689 is accepted.
node --test calendar/tests/personal-calendar.test.cjs calendar/tests/personal-calendar-postgres.test.cjs calendar/tests/personal-calendar-browser.test.mjs
```

The mandatory Source cases run real Express, original migrations and forced nonbypass PostgreSQL RLS, plus actual Chromium event save/reopen/remove and phone layout. The verified OIDC principal and legacy scoped-SQL session are named Source fixture seams; this is not native-kernel or installed acceptance. Only the fixture's own unique database/role/browser are cleaned up; the shared Postgres container is preserved.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| calendar-concierge | concierge answer | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
