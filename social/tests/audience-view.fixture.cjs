/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Social company audience view (ADR-164 D6): the Composer (ui.static[0], the surface a shell hosts), its declared URL, synthetic read-only answers shaped like GET /api/social/readiness (Facebook not connected, notifications arriving), /signals (oshal_inbox_messages rows with an RFC 5322 From and ISO receivedAt), /home-summary (pg text counts, one 'Unavailable') and /linkedin-content-queue (owner tickets with stateGroup, metadata.topic and ISO times), and what the company view must show. /profiles is deliberately absent: the view must never ask LinkedIn, Facebook or X live. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'social', file: 'social/tools/social-composer.html', url: '/api/social/composer', fullMarker: '#pubBtn',
  reads: {
    '/api/social/readiness': { facebook: { ready: false, providers: [], detail: 'Not connected — connect Facebook under Accounts.' }, signals: { ready: true, count: 23, detail: '23 social notifications captured in the last 30 days.' } },
    '/api/social/signals': { signals: [
      { id: 's1', from: '"LinkedIn" <messages-noreply@linkedin.example.test>', subject: 'Synthetic Person commented on your post', snippet: 'Synthetic snippet', receivedAt: iso(-3) },
      { id: 's2', from: 'notify@x.example.test', subject: 'Synthetic mention', snippet: '', receivedAt: iso(-30) },
    ], windowDays: 7 },
    '/api/social/home-summary': { metrics: [{ id: 'notifications-24h', label: 'Social notices / 24h', value: '4' }, { id: 'notifications-5d', label: 'Social notices / 5d', value: '19' }], tiles: [], items: [], asOf: iso(0), partial: false },
    '/api/social/linkedin-content-queue': { tickets: [
      { ticketId: 't1', title: 'LinkedIn post: Synthetic launch', ticketType: 'linkedin-content-post', status: 'approval_required', stateGroup: 'approval_required', metadata: { topic: 'Synthetic launch' }, createdAt: iso(-26), updatedAt: iso(-2) },
      { ticketId: 't2', title: 'LinkedIn post: Synthetic recap', ticketType: 'linkedin-content-post', status: 'complete', stateGroup: 'complete', metadata: { topic: 'Synthetic recap' }, createdAt: iso(-120), updatedAt: iso(-100) },
    ] },
  },
  audiences: {
    company: {
      stats: 5, sections: ['signals', 'queue', 'setup'],
      text: ['Social', 'Social desk', '23 social notifications captured in the last 30 days.', 'Open the Composer', 'Connect accounts', 'Social notifications, last 7 days', 'LinkedIn', 'Synthetic Person commented on your post',
        'notify@x.example.test', 'not unread totals or a complete feed', 'LinkedIn content queue', 'Synthetic launch', 'Approval required', 'Synthetic recap', 'Done', 'The queue itself never publishes.',
        'Facebook Pages', 'Not connected — connect Facebook under Accounts.', 'Arriving', 'LinkedIn and X', 'this view does not call the networks'],
      statValues: { 'notifications-24h': '4', 'notifications-5d': '19', captured: '23', queue: '1', facebook: 'Not connected' },
    },
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
