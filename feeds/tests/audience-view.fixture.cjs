/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Feeds company audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/feeds/home-summary (the four metrics as digit strings, the saved entries with "<channel>: <message>" text, detail and the integration context whose notes lead with "<channel> · <iso>", the sync and saved-index notes, lastSyncedAt, partial) and GET /api/feeds/settings, and what the company view must show. /messages answers only so the full page's own start has something to paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description A saved entry as the home summary shapes it.
 * @param {string} channel The channel name.
 * @param {string} text The message text.
 * @param {string} at The posted time as an ISO string.
 * @returns {object} The summary item.
 */
function entry(channel, text, at) {
  const notes = channel + ' · ' + at + '\n' + text;
  return { text: (channel + ': ' + text).slice(0, 120), detail: text.slice(0, 400), tone: 'neutral', fix: 'feeds-dashboard',
    actions: ['prepare-document', 'prepare-post'].map((integration) => ({ integration, context: { title: 'Review a saved feed entry', notes } })) };
}

/**
 * @description The synthetic indexed messages as GET /messages returns them, newest first: what the full page paints.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} feed_messages rows in the surface shape.
 */
function messages(iso) {
  return [
    { channelId: 'C1', channel: 'synthetic-ops', type: 'channel', userId: 'U1', user: 'Synthetic Teammate', text: 'Deploy of the synthetic API finished: smoke green.', ts: '1000000001.000100', time: iso(-2), sentiment: null, sentimentLabel: null },
    { channelId: 'C2', channel: 'synthetic-sales', type: 'channel', userId: 'U2', user: 'Synthetic Seller', text: 'Synthetic Corp signed the renewal.', ts: '1000000000.000100', time: iso(-30), sentiment: null, sentimentLabel: null },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const synced = iso(-0.7);
  const metrics = [
    { id: 'indexed-24h', label: 'Indexed Slack / 24h', value: '12', tone: 'neutral' },
    { id: 'indexed-5d', label: 'Indexed Slack / 5 days', value: '47', tone: 'neutral' },
    { id: 'indexed-channels', label: 'Channels in index', value: '5', tone: 'neutral' },
    { id: 'sync-age', label: 'Last recorded sync', value: '42m ago', tone: 'neutral' },
  ];
  return {
    app: 'feeds', file: 'feeds/tools/feeds.html', url: '/api/feeds/dashboard', fullMarker: '#stream .msg',
    reads: {
      '/api/feeds/home-summary': {
        tiles: metrics, metrics,
        items: [
          entry('synthetic-ops', 'Deploy of the synthetic API finished: smoke green.', iso(-2)),
          entry('synthetic-sales', 'Synthetic Corp signed the renewal.', iso(-30)),
          entry('Synthetic Teammate', 'Lunch moved to noon.', iso(-90)),
          { metricId: 'sync-age', text: 'Last recorded sync: ' + synced + '.', tone: 'neutral', fix: 'feeds-dashboard' },
          { text: 'Saved Slack index only. Counts use rolling 24/120 hours; they are not unread counts or all Slack history.', tone: 'neutral', fix: 'feeds-dashboard' },
        ],
        asOf: iso(0), lastSyncedAt: synced, partial: false,
      },
      '/api/feeds/settings': { pollEnabled: true, pollIntervalMinutes: 30, maxChannels: 20, perChannel: 20, sentimentEnabled: false, lastSyncedAt: synced },
      '/api/feeds/messages': { count: 2, messages: messages(iso), lastSyncedAt: synced, sentimentEnabled: false },
    },
    audiences: {
      company: {
        stats: 4, sections: ['recent', 'notes'],
        text: ['Productivity · Feeds', '12 indexed in the last 24 hours', '47 in 5 days across 5 channels', 'Open the live stream', 'Newest saved entries',
          'synthetic-ops', 'Deploy of the synthetic API finished: smoke green.', '2 h ago', 'synthetic-sales', 'Synthetic Corp signed the renewal.', 'yesterday',
          'Synthetic Teammate', 'Lunch moved to noon.', '4 days ago', 'About these numbers', 'Saved Slack index only', 'Auto-index every 30 min', 'Open Feeds in the cockpit'],
        statValues: { day: '12', fiveDays: '47', channels: '5', sync: '42 min ago' },
      },
    },
  };
};

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
