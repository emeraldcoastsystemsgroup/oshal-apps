/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Pumpkin family audience view (ADR-164 D6): the review page, its declared URL, two synthetic read-only answers shaped like GET /api/pumpkin/home-summary (the route's three counts with their ids, the tiles mirror, the newest line items with their '<expression> / saved <ISO>' detail and clip offer, the trailing note) and GET /api/pumpkin/responses (the playlist rows as the route serializes them: say, expression, source, pinned, playCount, lastPlayedAt, createdAt, updatedAt), and what the family view must show. The same summary lets the full page paint its own saved-evidence cards without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One saved line as GET /responses serializes it (routes/pumpkin-engine-response-store.js toSavedResponse).
 * @param {string} id Row id.
 * @param {string} say The saved line.
 * @param {string} expression The face it is spoken with.
 * @param {string} source mimic | autonomous | manual.
 * @param {boolean} pinned Whether it is a pinned favourite.
 * @param {string} updated ISO time of the last save, re-save or pin.
 * @param {number} plays How often it was sent from the playlist.
 * @returns {object} The playlist row.
 */
function line(id, say, expression, source, pinned, updated, plays) {
  return { id, say, expression, intensity: 0.6, source, pinned, playCount: plays, lastPlayedAt: plays ? updated : null, createdAt: updated, updatedAt: updated };
}

/**
 * @description The synthetic playlist: one pinned favourite replayed three times, then two other lines, pinned first and
 * then newest, the order the route's SELECT returns.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} The rows.
 */
function playlist(iso) {
  return [
    line('r1', 'Synthetic: Happy Halloween, little ghosts!', 'spooky', 'manual', true, iso(-30), 3),
    line('r2', 'Synthetic: Trick or treat, smell my feet!', 'laugh', 'mimic', false, iso(-2), 0),
    line('r3', 'Synthetic: I am the king of the pumpkin patch.', 'mischief', 'autonomous', false, iso(-80), 0),
  ];
}

/**
 * @description The synthetic home summary for the same account, as routes/home-summary.js builds it.
 * @param {object[]} rows The playlist rows (the summary's newest three come from the same table).
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The route's JSON body.
 */
function summary(rows, iso) {
  const metrics = [
    { id: 'saved-looks', label: 'Saved custom looks', value: '2' },
    { id: 'saved-lines', label: 'Saved response lines', value: '3' },
    { id: 'pinned-lines', label: 'Pinned response lines', value: '1' },
  ];
  const items = rows.map((r) => {
    const detail = r.expression + ' / saved ' + r.updatedAt;
    return { text: r.say, detail, tone: 'neutral', fix: 'pumpkin-control', actions: [{ integration: 'prepare-clip', context: { title: r.say, notes: detail + '\nSaved prop line: ' + r.say } }] };
  });
  items.push({ text: 'Shows caller-saved custom looks and dialogue, with pinned lines first. No current projector liveness is claimed from saved settings. Selected dialogue can prepare a Vids clip draft; Home does not speak, animate, record audio or trigger the physical prop.', tone: 'neutral', fix: 'pumpkin-control' });
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const rows = playlist(iso);
  return {
    app: 'pumpkin', file: 'pumpkin/tools/review.html', url: '/api/pumpkin/review', fullMarker: '#metrics .metric',
    reads: { '/api/pumpkin/home-summary': summary(rows, iso), '/api/pumpkin/responses': { responses: rows } },
    audiences: {
      family: {
        stats: 4, sections: ['favourites', 'lines'],
        text: ['Halloween pumpkin', '3 saved lines for the pumpkin', 'Most recent: “Synthetic: Trick or treat, smell my feet!”, updated 2 h ago.',
          'Pinned favourites', '“Synthetic: Happy Halloween, little ghosts!”', 'Spooky face · Saved by hand', 'updated yesterday · sent from the playlist 3 times',
          'More saved lines', 'Laughing face · Said word for word', 'Cheeky face · The pumpkin’s own reply', 'updated 3 days ago',
          'A saved line is one the pumpkin can say again.', 'Open Pumpkin'],
        statValues: { lines: '3', pinned: '1', looks: '2', latest: '2 h ago' },
      },
    },
  };
};

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
