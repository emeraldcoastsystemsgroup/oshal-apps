/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Calendar Preparation company audience view (ADR-164 D6): the review page, its declared URL, synthetic read-only answers shaped like GET /api/calendar/home-summary (calendarEvidence in routes/home-summary.js: the two saved-event tiles, one item per upcoming event whose detail is '<start> / all day / synced <iso>' or '<start> / synced <iso>' with the four planning offers attached, then the coverage note) and GET /api/calendar/meeting-briefs (storedBrief rows: title, ISO startsAt and builtAt, hasHistory, citations, deliveryText, plus the route's note), and what the company view must show. An all-day event starts on a 'YYYY-MM-DD' day exactly as Google's start.date reaches the snapshot; a timed one carries an ISO instant. POST /sync is deliberately absent: the harness answers every non-GET with 405 and records it, so a view that synced on open would fail. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (the Jarvis shell) over the same synthetic reads: "Your calendar", the five-day count as the title, the next event and the last sync in plain words through the real kit's relative times, the "Coming up" list (a timed event with its local date and clock, the all-day one as its calendar day marked All day), the briefs in plain words and the three stats, with the same escape; the company expectations are unchanged.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The saved snapshot the view summarises: three upcoming events (two inside five days, one of them all
 * day, one twelve days out) synced two hours ago, so the tiles read 2 and 3 and the sync stat reads '2 h ago'.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {{ syncedAt: string, events: object[] }} The snapshot as sync.js stores it.
 */
function snapshot(iso) {
  const allDay = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  return {
    syncedAt: iso(-2),
    events: [
      { id: 'e1', title: 'Synthetic standup', start: iso(26), end: iso(27), allDay: false, url: 'https://calendar.google.com/calendar/event?eid=synthetic1' },
      { id: 'e2', title: 'Synthetic offsite', start: allDay, end: allDay, allDay: true, url: '' },
      { id: 'e3', title: 'Synthetic board review', start: iso(24 * 12), end: iso(24 * 12 + 1), allDay: false, url: 'https://calendar.google.com/calendar/event?eid=synthetic3' },
    ],
  };
}

/**
 * @description The home summary as calendarEvidence projects the snapshot: tiles mirror metrics, each event item
 * carries the route's detail string and its four planning offers, and the coverage note closes the list.
 * @param {{ syncedAt: string, events: object[] }} snap The synthetic snapshot.
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The GET /api/calendar/home-summary body.
 */
function homeSummary(snap, iso) {
  const metrics = [{ id: 'upcoming-5d', label: 'Saved events / 5d', value: '2' }, { id: 'upcoming-30d', label: 'Saved events / 30d', value: '3' }];
  const items = snap.events.map((e) => {
    const detail = e.start + (e.allDay ? ' / all day' : '') + ' / synced ' + snap.syncedAt;
    const context = { title: e.title, notes: detail + '. Prepare for this event. Confirm the occasion, preferences, budget, timing and participants with me. Do not assume a gift is appropriate.', ...(e.url ? { sourceUrl: e.url } : {}) };
    return { text: e.title, detail, fix: 'calendar-review', actions: ['plan-gift', 'plan-meal', 'plan-trip', 'prepare-meeting'].map((integration) => ({ integration, context })) };
  });
  items.push({ text: 'Saved primary-calendar snapshot, up to 250 events. Sync explicitly for changes; this is not a complete multi-calendar agenda.', fix: 'calendar-review', tone: 'neutral' });
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const snap = snapshot(iso);
  return {
    app: 'calendar', file: 'calendar/tools/review.html', url: '/api/calendar/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/calendar/home-summary': homeSummary(snap, iso),
      '/api/calendar/meeting-briefs': { briefs: [
        { eventId: 'evt-1', title: 'Synthetic weekly sync', startsAt: iso(20), builtAt: iso(-4), hasHistory: true, citations: 2, deliveryText: 'Synthetic brief: two cited rows.' },
        { eventId: 'evt-0', title: 'Synthetic kickoff', startsAt: iso(-160), builtAt: iso(-184), hasHistory: false, citations: 0, deliveryText: 'No prior context recorded for this meeting.' },
      ], note: 'Each brief is the exact text that was delivered for that meeting.' },
    },
    audiences: {
      company: {
        stats: 3, sections: ['events', 'briefs'],
        text: ['Office · Calendar', 'Office calendar', 'Saved primary-calendar snapshot, up to 250 events.', 'Open the full calendar', 'Next saved events', 'Synthetic standup', 'Synthetic offsite', 'All day',
          'Synthetic board review', 'Attendees and descriptions are never saved.', 'Meeting briefs', 'Each brief is the exact text that was delivered for that meeting.', 'Synthetic weekly sync', '2 cited sources',
          'Synthetic kickoff', 'No prior context', 'Open Calendar in the cockpit'],
        statValues: { 'upcoming-5d': '2', 'upcoming-30d': '3', sync: '2 h ago' },
      },
      family: {
        stats: 3, sections: ['coming-up', 'briefs'],
        text: ['Your calendar', '2 events in the next 5 days', 'Next: Synthetic standup, tomorrow. Saved from your last sync, 2 h ago.', 'Open the full calendar', 'Coming up',
          'Synthetic standup', 'Synthetic offsite', 'All day', 'Synthetic board review', 'Only titles and times are saved: never who is coming or what the event says.', 'Meeting briefs',
          'Read the whole brief on the full page.', 'Synthetic weekly sync', '2 sources cited', 'Synthetic kickoff', 'Nothing earlier recorded', 'Open Calendar in the cockpit'],
        statValues: { 'upcoming-5d': '2', 'upcoming-30d': '3', sync: '2 h ago' },
      },
    },
  };
};
