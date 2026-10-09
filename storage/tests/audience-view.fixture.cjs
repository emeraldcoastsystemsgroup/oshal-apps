/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Storage company audience view (ADR-164 D6): the assistant page (the package's first surface), its declared URL, synthetic read-only answers shaped like GET /api/storage/home-summary (routes/home-summary.js: the two saved-target metrics mirrored as tiles, the preferences item whose detail is 'Saved <iso>', the closing honesty note), GET /api/storage/prefs (the kernel resolver's effective targets plus the caller's connected providers as oshal_connections names them) and GET /api/storage/local/list (top-level files of the caller's oshal-local store: name and size), and what the company view must show. POST /assistant is deliberately absent: the harness answers every non-GET with 405 and records it, so a view that chatted on open would fail. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The home summary as routes/home-summary.js projects one saved preferences row: metrics mirrored as
 * tiles, the preferences item (detail 'Saved <iso>', no offers), then the route's closing note.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The GET /api/storage/home-summary body.
 */
function homeSummary(iso) {
  const metrics = [{ id: 'code-target', label: 'Saved code target', value: 'github' }, { id: 'files-target', label: 'Saved file target', value: 'dropbox' }];
  const items = [
    { text: 'Storage preferences', detail: 'Saved ' + iso(-3), tone: 'neutral', fix: 'storage-settings', actions: [] },
    { text: 'Shows explicitly saved target preferences. Automatic means the Files service chooses its configured fallback at use time. A saved target is not evidence of a live connection, a successful export or provider free space. Browse and export through the existing Files surface.', tone: 'neutral', fix: 'storage-settings' },
  ];
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'storage', file: 'storage/tools/storage-assistant.html', url: '/api/storage/assistant/ui', fullMarker: '#log .msg.bot',
  reads: {
    '/api/storage/home-summary': homeSummary(iso),
    '/api/storage/prefs': { prefs: { code: { provider: 'github', repo: 'synthetic/oshal-demo', folder: '' }, files: { provider: 'dropbox', folder: '/' } }, connected: ['github', 'dropbox', 'slack'] },
    '/api/storage/local/list': { files: [{ name: 'synthetic-report.pdf', size: 345678 }, { name: 'Synthetic-deck.pptx', size: 1234567 }, { name: 'synthetic-notes.md', size: 2048 }] },
  },
  audiences: {
    company: {
      stats: 4, sections: ['local-files', 'stores'],
      text: ['Productivity · Storage', 'Code → GitHub · Files → Dropbox', 'Targets saved 3 h ago.', 'Shows explicitly saved target preferences.', 'Open the assistant', 'Storage settings',
        'oshal local store', 'Synthetic-deck.pptx', '1.2 MB', 'synthetic-notes.md', '2 KB', 'synthetic-report.pdf', '338 KB', 'Stores', 'GitHub', 'Target for code', 'Connected', 'Dropbox', 'Target for files',
        'Google Drive', 'Not connected', 'oshal local', 'Built in', 'Connected means an authorized connection is on file in Identity.', 'Open Storage in the cockpit'],
      statValues: { code: 'GitHub', files: 'Dropbox', connected: '2', local: '3' },
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
