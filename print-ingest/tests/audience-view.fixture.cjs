/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Print Ingest company audience view (ADR-164 D6): the inbox page, its declared URL, two synthetic read-only answers shaped like GET /api/print-ingest/documents (presentIntake: camelCase fields, JSONB sidecar / recommendation / fanout, ISO instants; the state filter the full page sends is honoured) and GET /api/print-ingest/home-summary (routes/home-summary.js: three counts as digit strings mirrored as tiles, one item per newest document carrying the prepare-document offer, then the route's note), and what the company view must show. The view never approves, rejects, imports or files; the harness still answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const HONESTY = 'Counts saved, deduplicated owner intake records. Fully ingested and partially ingested stay distinct; receipt is not filing. Explicit document preparation transfers a bounded text excerpt into Office without approving any knowledge-base destinations.';

/**
 * @description One intake as GET /documents presents it (the fields the view reads, plus their neighbours).
 * @param {string} id The intake id.
 * @param {string} title The document title.
 * @param {string} state The intake state.
 * @param {string} created The ISO receipt instant.
 * @param {object} [opt] fanout, proposals, failure, chars.
 * @returns {object} The presented intake.
 */
function intake(id, title, state, created, opt = {}) {
  return { intakeId: id, title, state, textChars: opt.chars || 1204, contentSha256: 'sha-' + id,
    sidecar: { originatingComputer: 'SYNTH-PC', printerName: 'oshal Print', requestingUser: 'synthetic-user', clientIp: '10.0.0.9' },
    recommendation: { title, proposals: opt.proposals || [], appliedRule: null, suggestedUserSub: null },
    approvedDestinations: [], fanout: opt.fanout || [], failureReason: opt.failure || null, createdAt: created, decidedAt: state === 'awaiting_approval' ? null : created };
}

/** @returns {object} One machine proposal as print-classify builds it. */
function proposal(id, label, recommended) {
  return { id, label, kind: 'bot', recommended, confidence: recommended ? 'high' : 'low', reason: 'Synthetic reason', readableBy: 'everyone signed in' };
}

/** @returns {object} One fan-out result as print-fanout records it. */
function copy(id, label, ok, error) {
  return Object.assign({ destinationId: id, label, kind: 'bot', collection: 'agent-knowledge-' + id, privateToOwner: false, ok, ragDocId: 'print:synthetic', writtenAt: '2026-09-27T09:00:00.000Z' }, ok ? {} : { error });
}

/**
 * @description Four intakes, newest first: one awaiting approval, one fully filed to two destinations, one partly filed
 * with its failure, one rejected.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} The intakes.
 */
function documents(iso) {
  return [
    intake('i1', 'Synthetic Invoice', 'awaiting_approval', iso(-1), { proposals: [proposal('finance', 'Finance bot', true), proposal('maintenance', 'Maintenance bot', false)] }),
    intake('i2', 'Synthetic Pump Manual', 'ingested', iso(-30), { chars: 48210, fanout: [copy('maintenance', 'Maintenance bot', true), copy('my-knowledge', 'Private to me', true)] }),
    intake('i3', 'Synthetic Memo', 'partially_ingested', iso(-50), { fanout: [copy('maintenance', 'Maintenance bot', true), copy('finance', 'Finance bot', false, 'Synthetic chroma timeout')], failure: 'Finance bot: Synthetic chroma timeout' }),
    intake('i4', 'Synthetic Flyer', 'rejected', iso(-200), { failure: 'rejected by approver' }),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const docs = documents(iso);
  const metrics = [
    { id: 'intake-review', label: 'Awaiting filing approval', value: '1' },
    { id: 'intake-needs-attention', label: 'Failed / partial filing', value: '1' },
    { id: 'intake-5d', label: 'Received / 5 days', value: '3' },
  ];
  const offer = (d) => ({ text: d.title, detail: d.state, tone: 'warn', fix: 'print-ingest', actions: [{ integration: 'prepare-document', context: { title: d.title, notes: 'Synthetic excerpt' } }] });
  return {
    app: 'print-ingest', file: 'print-ingest/ui/index.html', url: '/api/print-ingest/app', fullMarker: 'article.doc[data-id="i1"]',
    reads: {
      '/api/print-ingest/documents': (req) => ({ documents: typeof req.query.state === 'string' ? docs.filter((d) => d.state === req.query.state) : docs }),
      '/api/print-ingest/home-summary': { metrics, tiles: metrics, items: [offer(docs[0]), offer(docs[2]), { text: HONESTY, tone: 'neutral', fix: 'print-ingest' }], asOf: iso(0), partial: false },
    },
    audiences: {
      company: {
        stats: 4, sections: ['documents', 'attention', 'notes'],
        text: ['Knowledge · Print Ingest', '1 document awaiting filing approval', 'Open the Print Inbox', 'Newest printed documents',
          'Synthetic Invoice', 'awaiting approval', 'SYNTH-PC · oshal Print', '1,204', 'Proposed: Finance bot', '1 h ago',
          'Synthetic Pump Manual', 'ingested', '48.2k', 'Maintenance bot, Private to me', 'yesterday',
          'Synthetic Memo', 'partially ingested', 'Maintenance bot, Finance bot (failed)', 'Synthetic Flyer', 'rejected', 'Nothing written', '8 days ago',
          'Failed or partly filed', 'Finance bot: Synthetic chroma timeout', 'What these counts mean', 'receipt is not filing', 'Open Print Ingest in the cockpit'],
        statValues: { 'intake-review': '1', 'intake-needs-attention': '1', 'intake-5d': '3', filed: '1' },
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
