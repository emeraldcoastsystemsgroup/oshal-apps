/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Intelligent Communication company audience view (ADR-164 D6): My Day, its declared URL, synthetic read-only answers shaped like GET /api/email/digest?surface=1 (a capped sample of 25, MailSummary rows with ISO receivedAt, a timed event and an all-day event, top senders) and /summary/cached (the saved digest row), and what the company view must show. POST /summary is deliberately absent: the view must not ask the bot on open. The full page (no audience) asks the bot as soon as a connected digest lands, which is its own unchanged behaviour, so its digest read is answered as "no mailbox connected" (told apart by the Referer, which carries ?audience= only for the view) and the harness's no-writes rule still holds. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The digest answer: connected for the audience view, not connected for the full page (see the Change Log).
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {(req: object) => object} The route body for a request.
 */
function digest(iso) {
  const connected = {
    provider: 'google', date: iso(0).slice(0, 10), total: 25, unreadCount: 7, importantCount: 3, starredCount: 1, unread: [], important: [], starred: [],
    topSenders: [{ name: 'Synthetic Client', count: 4 }, { name: 'Synthetic Bank', count: 2 }],
    events: [{ summary: 'Synthetic standup', start: iso(2), location: 'Synthetic room' }, { summary: 'Synthetic offsite', start: iso(0).slice(0, 10), location: '' }],
    priority: [
      { id: 'm1', from: '"Synthetic Client" <client@example.test>', subject: 'Synthetic contract question', date: '', internalDate: '', receivedAt: iso(-3), snippet: '', unread: true, important: true, starred: false },
      { id: 'm2', from: 'bank@example.test', subject: 'Synthetic statement', date: '', internalDate: '', receivedAt: iso(-30), snippet: '', unread: false, important: false, starred: true },
    ],
  };
  const notConnected = { connected: false, provider: null, error: 'no_mail_connection', message: 'Connect Google, Outlook / Microsoft 365 or Yahoo Mail at /utilities first.' };
  return (req) => (/[?&]audience=/.test(String(req.get('referer') || '')) ? connected : notConnected);
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'email-summarizer', file: 'email-summarizer/tools/email-my-day.html', url: '/api/email/my-day', fullMarker: '#provider',
  reads: {
    '/api/email/digest': digest(iso),
    '/api/email/summary/cached': { cached: { summary: 'Synthetic digest: reply to the client about the contract.', updatedAt: iso(-5) } },
  },
  audiences: {
    company: {
      stats: 5, sections: ['needs', 'calendar', 'senders', 'digest'],
      text: ['Intelligent Communication', 'Inbox and today', 'Google · 7 unread · 2 events today', 'in the newest 25 of the last 24 h', 'Capped at the newest 25', 'Needs attention', 'Synthetic Client',
        'Synthetic contract question', 'Unread · Important', 'Synthetic statement', 'Starred', 'All day', 'Synthetic standup', 'Synthetic room', '4 messages', 'Saved digest',
        'Synthetic digest: reply to the client about the contract.', 'Written 5 h ago', 'Summarize my day'],
      statValues: { unread: '7', important: '3', starred: '1', events: '2', recent: '25' },
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
