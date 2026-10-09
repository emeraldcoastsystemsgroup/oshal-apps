/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Kalshi company audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/kalshi/scan (the saved snapshot: ranked BetHand rows, the evidence gate, the scan freshness block), GET /alerts (kalshi_scan_alerts rows joined to their settlement grade, plus the summarized record) and GET /home-summary (the route's three alert metrics), and what the company view must show. No answer is given for /status, /portfolio or /alerts/pops: those ask Kalshi live and the view never reads them (the full page's own start meets the harness's 404 for them). Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description Two ranked hands as the snapshot stores them (BetHand): the evidence gate is closed in this fixture, so
 * every stakeFraction is 0 exactly as kalshi-scan-engine rewrites them before the snapshot is saved.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} The snapshot's hands, best first.
 */
function hands(iso) {
  return [
    { ticker: 'SYN-FED-NOV', eventTicker: 'SYN-FED', title: 'Synthetic Fed holds in November', category: 'Economics', closeTime: iso(72), side: 'yes', price: 0.42, marketProb: 0.42, trueProb: 0.51, calibrationN: 812, feePerContract: 0.017, edgeNet: 0.073, evPerContract: 0.073, kellyFraction: 0.12, stakeFraction: 0, confidence: 0.83, riskFlags: [], strength: 'strong' },
    { ticker: 'SYN-RAIN-MIA', eventTicker: 'SYN-RAIN', title: 'Synthetic rain in Miami on Friday', category: 'Weather', closeTime: iso(30), side: 'no', price: 0.61, marketProb: 0.61, trueProb: 0.66, calibrationN: 140, feePerContract: 0.017, edgeNet: 0.031, evPerContract: 0.031, kellyFraction: 0.05, stakeFraction: 0, confidence: 0.55, riskFlags: ['thin-book'], strength: 'playable' },
  ];
}

/**
 * @description Four announced alerts as GET /alerts returns them (newest first): one open, two graded wins and one loss.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} kalshi_scan_alerts rows joined to kalshi_predictions.
 */
function alerts(iso) {
  return [
    { ticker: 'SYN-RAIN-MIA', strength: 'playable', edge_net: 0.031, channel: 'jarvis', delivered: true, detail: { title: 'Synthetic rain in Miami on Friday', side: 'no' }, created_at: iso(-3), settled: null, settled_yes: null, graded_side: null, pnl_per_contract: null, graded_at: null, won: null },
    { ticker: 'SYN-CPI-SEP', strength: 'strong', edge_net: 0.058, channel: 'jarvis', delivered: true, detail: { title: 'Synthetic CPI above 3% in September', side: 'yes' }, created_at: iso(-30), settled: true, settled_yes: true, graded_side: 'yes', pnl_per_contract: 0.55, graded_at: iso(-4), won: true },
    { ticker: 'SYN-QB-PASS', strength: 'playable', edge_net: 0.034, channel: null, delivered: false, detail: { title: 'Synthetic quarterback throws for 300 yards', side: 'yes' }, created_at: iso(-80), settled: true, settled_yes: false, graded_side: 'yes', pnl_per_contract: -0.47, graded_at: iso(-50), won: false },
    { ticker: 'SYN-SNOW-DEN', strength: 'monster', edge_net: 0.091, channel: 'jarvis', delivered: true, detail: { title: 'Synthetic snow in Denver by Sunday', side: 'yes' }, created_at: iso(-200), settled: true, settled_yes: true, graded_side: 'yes', pnl_per_contract: 0.28, graded_at: iso(-150), won: true },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const metrics = [
    { id: 'recorded-alerts-24h', label: 'Recorded alerts / 24h', value: '1' },
    { id: 'recorded-alerts-5d', label: 'Recorded alerts / 5 days', value: '4' },
    { id: 'delivered-alerts-5d', label: 'Delivered alerts / 5 days', value: '3' },
  ];
  return {
    app: 'kalshi', file: 'kalshi/tools/kalshi.html', url: '/api/kalshi/', fullMarker: '#rows',
    reads: {
      '/api/kalshi/scan': {
        generatedAt: iso(-2), exchangeActive: true, calibrationGeneratedAt: iso(-40), calibrationFileMtime: iso(-40), openPaged: 60000, evaluable: 1387, hands: hands(iso),
        strategy: 'calibration', mayStake: false, gateReason: 'strategy calibration is unproven (12 graded, 30 needed)', scorecard: [{ strategy: 'calibration', status: 'unproven', graded: 12, pending: 9, brier: 0.21, marketBrier: 0.22, hitRate: 0.58, pnlPerContract: 0.04 }], scanMs: 21000,
        awaitingFirstScan: false, scan: { ageSeconds: 7200, stale: false, nextRunAt: iso(-1), running: false, intervalMinutes: 60, enabled: true, lastError: null, lastMs: 21000, lastSource: 'cron' },
      },
      '/api/kalshi/alerts': { alerts: alerts(iso), record: { alerted: 4, settled: 3, wins: 2, losses: 1, open: 1, hitRate: 2 / 3, pnlPerContract: 0.12, pnlTotal: 0.36 } },
      '/api/kalshi/home-summary': { metrics, tiles: metrics, items: [{ text: 'SYN-RAIN-MIA', detail: 'Recorded market alert SYN-RAIN-MIA, strength playable.', tone: 'neutral', fix: 'kalshi-home', actions: [] }], asOf: iso(0), partial: false },
    },
    audiences: {
      company: {
        stats: 4, sections: ['hands', 'alerts'],
        text: ['Finance · Kalshi', '2 playable hands', 'scans every 60 min', 'paper only: strategy calibration is unproven (12 graded, 30 needed)', 'Top hands',
          'Synthetic Fed holds in November', 'Synthetic rain in Miami on Friday', 'in 3 days', 'thin-book', 'Recent alerts', 'Synthetic CPI above 3% in September',
          '+$0.55 per contract', 'delivery not confirmed', 'Record: 2 wins, 1 loss (67% hit rate over 3 settled alerts)', 'Open Kalshi Prediction Markets in the cockpit'],
        statValues: { hands: '2', snapshot: '2 h ago', record: '2–1', alerts5d: '4' },
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
