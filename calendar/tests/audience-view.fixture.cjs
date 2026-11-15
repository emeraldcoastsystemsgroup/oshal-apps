/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Calendar Preparation company audience view (ADR-164 D6): the review page, its declared URL, synthetic read-only answers shaped like GET /api/calendar/home-summary (calendarEvidence in routes/home-summary.js: the two saved-event tiles, one item per upcoming event whose detail is '<start> / all day / synced <iso>' or '<start> / synced <iso>' with the four planning offers attached, then the coverage note) and GET /api/calendar/meeting-briefs (storedBrief rows: title, ISO startsAt and builtAt, hasHistory, citations, deliveryText, plus the route's note), and what the company view must show. An all-day event starts on a 'YYYY-MM-DD' day exactly as Google's start.date reaches the snapshot; a timed one carries an ISO instant. POST /sync is deliberately absent: the harness answers every non-GET with 405 and records it, so a view that synced on open would fail. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (the Jarvis shell) over the same synthetic reads: "Your calendar", the five-day count as the title, the next event and the last sync in plain words through the real kit's relative times, the "Coming up" list (a timed event with its local date and clock, the all-day one as its calendar day marked All day), the briefs in plain words and the three stats, with the same escape; the company expectations are unchanged.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.5.0: the summary is read live from Google Calendar (Roger, 2026-11-15: "I put a calendar event on my Google calendar and its not showing on the landing home"), so the synthetic answer is calendarEvidence's new shape: "Events / 5d" and "Events / 30d" tiles, each event item with its start, allDay, source and calendar and the detail '<start in words> / Google Calendar' (or '/ Google Calendar: Family' for a second calendar), the note "Read from Google Calendar just now: ...", and the `google` block read two minutes ago; the views say when Google Calendar was read, name each event's calendar and say nothing about syncing.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The Google events the view summarises, read live: three upcoming events (two inside five days, one of them
 * all day, one twelve days out on the person's Family calendar), read two minutes ago, so the tiles read 2 and 3 and the
 * Google Calendar stat reads 'just now'.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {{ readAt: string, events: object[] }} The events as routes/google-live.js reads them.
 */
function live(iso) {
  const allDay = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  return {
    readAt: iso(-2 / 60),
    events: [
      { id: 'e1', title: 'Synthetic standup', start: iso(26), allDay: false, calendar: null, local: 'tomorrow', url: 'https://calendar.google.com/calendar/event?eid=synthetic1' },
      { id: 'e2', title: 'Synthetic offsite', start: allDay, allDay: true, calendar: null, local: allDay + ' (all day)', url: '' },
      { id: 'e3', title: 'Synthetic board review', start: iso(24 * 12), allDay: false, calendar: 'Family', local: 'in 12 days', url: 'https://calendar.google.com/calendar/event?eid=synthetic3' },
    ],
  };
}

/**
 * @description The home summary as calendarEvidence projects a live read: tiles mirror metrics, each event item carries
 * its start, allDay, source, calendar, the route's detail string and its four planning offers, the note closes the list,
 * and the `google` block says it was read live.
 * @param {{ readAt: string, events: object[] }} read The synthetic live read.
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The GET /api/calendar/home-summary body.
 */
function homeSummary(read, iso) {
  const metrics = [{ id: 'upcoming-5d', label: 'Events / 5d', value: '2' }, { id: 'upcoming-30d', label: 'Events / 30d', value: '3' }];
  const items = read.events.map((e) => {
    const detail = e.local + ' / ' + (e.calendar ? 'Google Calendar: ' + e.calendar : 'Google Calendar');
    const context = { title: e.title, notes: detail + '. Prepare for this event. Confirm the occasion, preferences, budget, timing and participants with me. Do not assume a gift is appropriate.', ...(e.url ? { sourceUrl: e.url } : {}) };
    return { text: e.title, detail, start: e.start, allDay: e.allDay, source: 'google', calendar: e.calendar, fix: 'calendar-review', actions: ['plan-gift', 'plan-meal', 'plan-trip', 'prepare-meeting'].map((integration) => ({ integration, context })) };
  });
  items.push({ text: 'Read from Google Calendar just now: your primary calendar and Family.', fix: 'calendar-review', tone: 'neutral' });
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false,
    google: { state: 'live', readAt: read.readAt, syncedAt: null, calendars: ['primary', 'Family'], unread: [], primaryOnly: false } };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const read = live(iso);
  return {
    app: 'calendar', file: 'calendar/tools/review.html', url: '/api/calendar/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/calendar/home-summary': homeSummary(read, iso),
      '/api/calendar/meeting-briefs': { briefs: [
        { eventId: 'evt-1', title: 'Synthetic weekly sync', startsAt: iso(20), builtAt: iso(-4), hasHistory: true, citations: 2, deliveryText: 'Synthetic brief: two cited rows.' },
        { eventId: 'evt-0', title: 'Synthetic kickoff', startsAt: iso(-160), builtAt: iso(-184), hasHistory: false, citations: 0, deliveryText: 'No prior context recorded for this meeting.' },
      ], note: 'Each brief is the exact text that was delivered for that meeting.' },
    },
    audiences: {
      company: {
        stats: 3, sections: ['events', 'briefs'],
        text: ['Office · Calendar', 'Office calendar', 'Read from Google Calendar just now: your primary calendar and Family.', 'Open the full calendar', 'Next events', 'Synthetic standup', 'Synthetic offsite', 'All day',
          'Synthetic board review', 'Google · Family', 'Attendees and descriptions are not shown here.', 'Meeting briefs', 'Each brief is the exact text that was delivered for that meeting.', 'Synthetic weekly sync', '2 cited sources',
          'Synthetic kickoff', 'No prior context', 'Open Calendar in the cockpit'],
        statValues: { 'upcoming-5d': '2', 'upcoming-30d': '3', google: 'just now' },
      },
      family: {
        stats: 3, sections: ['coming-up', 'briefs'],
        text: ['Your calendar', '2 events in the next 5 days', 'Next: Synthetic standup, tomorrow.', 'Open the full calendar', 'Coming up',
          'Synthetic standup', 'Synthetic offsite', 'All day', 'Synthetic board review', 'Google · Family', 'Only titles and times are shown here: never who is coming or what the event says.', 'Meeting briefs',
          'Read the whole brief on the full page.', 'Synthetic weekly sync', '2 sources cited', 'Synthetic kickoff', 'Nothing earlier recorded', 'Open Calendar in the cockpit'],
        statValues: { 'upcoming-5d': '2', 'upcoming-30d': '3', google: 'just now' },
      },
    },
  };
};
