/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'switchboard', file: 'switchboard/tools/switchboard-today.html', url: '/api/switchboard/today', fullMarker: '#refreshBtn',
    reads: {
      '/api/switchboard/workspaces': { workspaces: [] },
      '/api/switchboard/feed': { connected: true, workspace: 'Synthetic Co', counts: { needsReply: 1, timeSensitive: 1, meetings: 1, handled: 2 }, nextMeeting: { subject: 'Synthetic standup', ts: iso(2) }, items: [
        { id: 'i1', source: 'gcal', kind: 'meeting', person: 'Team', subject: 'Synthetic standup', ts: iso(2), group: 'now', hot: true },
        { id: 'i2', source: 'gmail', kind: 'email', person: 'Synthetic client', subject: 'Contract question', snippet: 'Can we move the date?', ts: iso(-3), group: 'today', overdue: true, badge: 'Reply due' },
        { id: 'i3', source: 'slack', kind: 'mention', person: 'Synthetic teammate', snippet: 'pinged you in #ops', ts: iso(-20), group: 'today' },
        { id: 'i4', source: 'gcal', kind: 'meeting', person: 'Board', subject: 'Synthetic review', ts: iso(70), group: 'week' } ] },
      '/api/switchboard/home-summary': { metrics: [{ id: 'posts-in-review', label: 'Posts awaiting review', value: '1', tone: 'warn' }, { id: 'posts-scheduled', label: 'Posts scheduled', value: '3', tone: 'neutral' }], tiles: [], items: [{ text: '1 post awaiting review', tone: 'warn', fix: 'switchboard-streams' }], asOf: iso(0), scope: 'all-own-workspaces' },
    },
    audiences: {
      company: { stats: 6, sections: ['now', 'today', 'week', 'publishing'], text: ['Switchboard', 'Synthetic standup', 'Synthetic client', 'Contract question', '1 post awaiting review', 'Posts scheduled'], statValues: { needsReply: '1', handled: '2', 'posts-scheduled': '3' } },
    },
  });

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
