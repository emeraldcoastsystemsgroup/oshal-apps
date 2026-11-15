# Calendar

The review screen loads independently of optional calendar-sync and briefing services. Explicit sync and brief collection retain their existing authentication, confirmation and consent checks, and report an unavailable operation when the host does not provide those services.

Events the person adds in OSHAL live in `calendar_own_events` (migration 003) behind `/api/calendar/events`: list, add (confirm required; a date is all day, a timed start carries its UTC offset) and remove, always the caller's own rows. The concierge reaches them through `calendar-my-events` and the approval-held `calendar-add-event` and `calendar-remove-event`, so an event drafted with Jarvis can be put on the calendar once the person approves the card. They are not written to Google Calendar; the Home summary lists them beside the person's Google Calendar events, read live, marked "added in Open Swarm". `node --test calendar/tests/own-events.test.cjs` covers them.

## Home reads Google Calendar live

`GET /api/calendar/home-summary` (the Home card on Today, the Calendar card of the audience views, and the concierge's `calendar-upcoming`) and `GET /api/calendar/events/agenda` (the Calendar screen, and the "Your calendar" frame on Today) read the person's Google calendars at that moment (`routes/google-live.js`) and list them with the events added in Open Swarm as one list by start. Each event says where it lives: "Google Calendar", "Google Calendar: <the calendar's name>" for another calendar, or "added in Open Swarm"; on the screen "Google", "Google · <name>" or "Open Swarm".

- **Which calendars.** The primary calendar, then up to nine more that the person shows in Google Calendar (the calendar list's `selected` calendars that are not hidden and that they may read: family, shared, subscribed). Only the list's first page (up to 50 calendars) is read; past ten shown calendars, the note says how many more are not read here. An event on two calendars is listed once.
- **Bounds.** Home reads the next 30 days and the screen its month; at most 250 events from each calendar and in one answer, and a calendar with more says so. All reads share one 5-second budget: the kernel answers a package's requests one at a time, so the calendars are read one after another, and none is started once the budget is spent (a request already sent is still bounded by the kernel's own 20-second egress limit). There is no paging and no retry.
- **Reads never write.** Neither GET saves a snapshot or any row, and Google is sent only GETs.
- **When Google does not answer** in time, the saved copy from the last **Sync** is shown with "Showing your last synced copy from <time, UTC>: Google did not answer." (a warning on the screen). Without a saved copy the note says Google did not answer and the events added in Open Swarm are still listed.
- **No connection**: "Connect Google on the Connections page (/utilities) to see your Google Calendar here. Events added in Open Swarm are shown without it." An expired connection says to reconnect. Nothing says to sync.
- **Permission.** No new permission, host or method. The calendar list is read on the declared `www.googleapis.com` egress and needs the connection's `calendar.readonly` grant (in the kernel's default Google scopes); a connection without it reads the primary calendar only and says "Your Google connection does not let Open Swarm list your other calendars, so only your primary calendar is shown."

**Sync Google events** (More on the screen, or `calendar-sync`) still saves a copy of the primary calendar for the next 30 days: the meeting-brief schedule reads it, and the fallback above shows it.

`node --test calendar/tests/home-summary-live-events.test.cjs` runs both routes over a stand-in kernel egress and a stand-in Google Calendar API (the calendar list, other calendars, a stalled calendar) and a pool under a read-only SQL admission that refuses any write; the existing `tests/*-events.test.cjs` step runs it.

## Adding events to Google Calendar

`POST /api/calendar/google-events` adds one event, or one repeating series, to the caller's own primary Google Calendar. The concierge reaches it through `calendar-add-google-event`, held for the person's approval: nothing is sent to Google before they approve the card, and the card lists the title, the first date and time in the event's zone, the end, where, the zone and the repeat (every day, week on named weekdays, month or year; a number of times or a last date). A series is one Google event with an RRULE whose start is its first date; a weekly series' first date must fall on one of its weekdays, and the refusal names the first one that does. Under the native kernel the request goes through the declared `www.googleapis.com` egress with no Authorization header, and the kernel places the caller's own `google-calendar` grant. No connection, a credential Google no longer accepts, or a grant that may only read the calendar answers 409 saying in words what to connect. The same series approved twice is added once (a client-chosen event id that Google refuses a second time); one the person removed in Google is restored when they ask again. The OSHAL-only add (`calendar-add-event`) still keeps single events in OSHAL and refuses a repeat.

`node --test "calendar/tests/*-events.test.cjs"` runs the route over a stand-in kernel egress and a stand-in Google Calendar API, and (`product-name-events.test.cjs`) reads every answer, the manifest, the persona and the screen for the product's name: what a person reads or hears says Open Swarm, and only the listed identifiers keep oshal; `OSHAL_KERNEL_PLATFORM=<kernel platform export> node --test calendar/tests/google-events-card.test.cjs` renders the card with the kernel's own card code.

## Changing and cancelling meetings

`GET /api/calendar/meetings?from=&to=&words=&timeZone=` (`calendar-find-events`) lists the caller's meetings in a window of days (at most 92): their primary Google Calendar, read live, and the events added in OSHAL, matching every word in a title, place, notes or a guest's name. Each meeting carries its day and time in words, its guests and their answers, whether the person organizes it or was invited, how it repeats, and the `revision` a card names it by (a Google meeting's event id and etag, and its series' etag; an OSHAL event's id and revision column, migration 006). When more than one matches, the answer says to ask which one, naming each by its day and time.

The writes are held for the person's approval and change only what the card names:

- `PATCH /api/calendar/meetings/google` (`calendar-change-google-event`): a new title, start, end or length (a new start without an end keeps the length), place, notes, or guests added or removed, for this occurrence or the whole series (which moves its weekdays and last date with it). Guests are told unless the card says "Will not be told" (Google's `sendUpdates`).
- `POST /api/calendar/meetings/google/cancel` (`calendar-cancel-google-event`): cancels a meeting the person organizes, for everyone; `POST /api/calendar/meetings/google/decline` (`calendar-decline-google-event`): declines one they were invited to, which stays on the organizer's calendar.
- `PATCH /api/calendar/meetings/oshal/{id}` (`calendar-change-event`) and `DELETE /api/calendar/meetings/oshal/{id}` (`calendar-remove-event`): the same for an event added in OSHAL, which is a single event only.

Every write reads the meeting fresh first. A card that names a different meeting than the calendar holds (its title, start or a field it showed), a meeting changed elsewhere since it was read (its etag or revision), a new start in the past, or a "None" guests choice for a meeting with guests is refused in words and nothing is written; a second Approve of the same change does nothing twice. An invited guest may not cancel or move someone else's meeting (unless its organizer lets guests change it): the answer offers to decline, or to propose a new time in Google Calendar. The kernel's egress refuses an `If-Match` header from a package today, so the Google etag is compared on the fresh read just before the write. Each answer names the fields before and after and carries the input that undoes it (a cancelled Google meeting with guests cannot be put back). The synced snapshot follows a Google change, so the Calendar screen shows it. The Calendar screen opens an event's view with **Edit** (the New event form, filled in) and **Cancel meeting** (or **Decline**), asking in the page which meetings of a series and whether to tell the guests, with **Undo** in the status line.

`node --test "calendar/tests/*meeting*.test.cjs" calendar/tests/own-event-changes.test.cjs` (with `OSHAL_KERNEL_PLATFORM` for the card and conversation suites) runs the routes over a stand-in kernel egress and a stand-in Google Calendar API, the cards with the kernel's own card code, and a two-step conversation with a scripted model; `calendar/tests/personal-calendar-meetings-browser.test.mjs` drives Edit and Cancel meeting in Chromium over the PostgreSQL fixture.

Run `node --test calendar/tests/native-load.test.cjs` from the store root to check independent screen loading and visible failures without provider or database access. The fixture uses the installed framework Express module; set `OSHAL_CORE_ROOT` when the framework checkout is elsewhere.

## Personal calendar

`/api/calendar/review` opens a month grid and selected-day agenda. `/api/calendar/review?compact=1` provides the same calendar for Today without the meeting-preparation panels. Event entry uses the confirmed own-event API, and an event opens its view with Edit and Cancel meeting (the meetings routes above); OSHAL events are never written to Google (only an approved Google add or change is).

`GET /api/calendar/events/agenda?from=2026-10-01&to=2026-10-31&tz=America%2FChicago` requires the original authenticated caller. The closed query accepts real civil dates spanning at most 62 inclusive days and an IANA viewer zone. Timed events appear on every overlapping local day, including events already underway; exclusive ends do not spill into the next day. All-day dates remain literal calendar days, with an exclusive all-day end. A nonexistent browser-local DST time is refused before submission. Existing concierge event tools and approval contracts are unchanged.

The read checks all owned rows, including history, under the existing owner predicate and storage authority. More than 500 owned rows, or more than 250 entries in a saved copy that is shown, refuses the read explicitly; it never silently truncates. Invalid individual saved events produce a visible partial-data warning. An unavailable or refused read is distinct from an empty calendar.

Google data is read live for the month shown (see "Home reads Google Calendar live" above): titles, times, links and the calendar each event is on. The saved copy from the last explicit sync is shown only when Google does not answer, with its warning. Open Swarm events work without a Google connection. Opening either calendar view never syncs or writes.

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
