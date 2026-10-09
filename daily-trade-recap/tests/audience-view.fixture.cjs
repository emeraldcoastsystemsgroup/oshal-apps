/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Daily Trade Recap company audience view (ADR-164 D6): the review page, its declared URL, a synthetic read-only answer shaped like GET /api/daily-trade-recap/home-summary (routes/home-summary.js: the four metrics mirrored as tiles; one item per closed Eastern trading day, newest first, 'Recap recorded for YYYY-MM-DD' with detail 'recorded <iso>' or 'No recap recorded for YYYY-MM-DD' with the route's fixed detail, each carrying the two preparation offers; then the parked tickets with '<status> since <iso>'; then the bounds note, which carries no actions), and what the company view must show. A session day is the 'YYYY-MM-DD' text of to_char(et_day) exactly as the route emits it, in the current year so the kit's short day form carries no year. The page is the only route on this package a browser can read; it has no write, and the harness answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The expected lede names the window as routes/home-summary.js defines it: the closed Eastern trading days in the last 7 days, today excluded (at most five sessions in a normal week), not seven sessions.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const BOUNDS = 'Counts exact-owner Eastern trading days: sessions recorded by the trading schedule, published reports recorded by the recap pipeline, and recap tickets parked at their approval gate. Today is excluded because the after-close recap has not run yet. A recorded report is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.';

/**
 * @description The two preparation offers the route attaches to every session and ticket item.
 * @param {string} title The item text, which the route copies into the offer context.
 * @param {string} notes The item detail plus body, clipped as the route clips it.
 * @returns {object[]} The actions array as home-summary.js builds it.
 */
function offers(title, notes) {
  return ['prepare-document', 'prepare-episode'].map((integration) => ({ integration, context: { title, notes } }));
}

/**
 * @description The home summary the view summarises: three closed sessions (the newest and the oldest recapped, the
 * middle one with no published report), one recap ticket parked at its approval gate, and the bounds note last.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The GET /api/daily-trade-recap/home-summary body.
 */
function homeSummary(iso) {
  const Y = new Date().getFullYear();
  const day = (monthDay) => Y + '-' + monthDay;
  const metrics = [
    { id: 'recaps-missed', label: 'Sessions with no recap / 7 days', value: '1' },
    { id: 'recaps-recorded', label: 'Recaps recorded / 7 days', value: '2' },
    { id: 'trading-sessions', label: 'Trading sessions / 7 days', value: '3' },
    { id: 'recaps-awaiting-review', label: 'Recaps awaiting review', value: '1' },
  ];
  const recorded = (d, at) => ({ text: 'Recap recorded for ' + d, detail: 'recorded ' + at, tone: 'neutral', fix: 'recap-review', actions: offers('Recap recorded for ' + d, 'recorded ' + at + ' Synthetic day summary. A recorded report is not proof that an email arrived or a video was published.') });
  const missing = (d) => ({ text: 'No recap recorded for ' + d, detail: 'closed session with no published report', tone: 'warn', fix: 'recap-review', actions: offers('No recap recorded for ' + d, 'closed session with no published report The trading schedule recorded this session, and the recap pipeline recorded no published report for it.') });
  const items = [
    recorded(day('09-25'), iso(-20)),
    missing(day('09-24')),
    recorded(day('09-23'), iso(-68)),
    { text: 'Synthetic recap ticket', detail: 'approval_required since ' + iso(-120), tone: 'warn', fix: 'recap-review', actions: offers('Synthetic recap ticket', 'approval_required since ' + iso(-120) + ' This recap ticket is parked at its approval gate and nothing downstream of the gate has run.') },
    { text: BOUNDS, tone: 'neutral', fix: 'recap-review' },
  ];
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'daily-trade-recap', file: 'daily-trade-recap/tools/review.html', url: '/api/daily-trade-recap/review', fullMarker: '#metrics .metric',
  reads: {
    '/api/daily-trade-recap/home-summary': homeSummary(iso),
  },
  audiences: {
    company: {
      stats: 4, sections: ['sessions', 'review'],
      text: ['Finance · Daily Trade Recap', '1 closed session with no recap', 'Closed Eastern trading days in the last 7 days for the signed-in owner, today excluded. 1 recap ticket parked at its approval gate.',
        'Open Recap Review', 'Closed sessions', 'Sep 25', 'Sep 24', 'Sep 23', 'Missing', '20 h ago', '3 days ago', 'Counts exact-owner Eastern trading days',
        'Awaiting review', 'Synthetic recap ticket', 'Approval required since 5 days ago', 'Parked', 'this view changes nothing.', 'Open Daily Trade Recap in the cockpit'],
      statValues: { 'recaps-missed': '1', 'recaps-recorded': '2', 'trading-sessions': '3', 'recaps-awaiting-review': '1' },
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
