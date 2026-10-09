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
    app: 'cad-studio', file: 'cad-studio/tools/cad-studio.html', url: '/api/cad-studio/app', fullMarker: 'body',
    assets: [{ url: '/api/cad-studio/assets/cad-studio-gl.js', file: 'cad-studio/tools/cad-studio-gl.js' }, { url: '/api/cad-studio/assets/cad-studio.js', file: 'cad-studio/tools/cad-studio.js' }],
    reads: {
      '/api/cad-studio/capabilities': { app: 'cad-studio', kernel: 'synthetic', exports: { formats: [], views: [] }, defaults: {}, upload: {}, engine: { ready: false } },
      '/api/cad-studio/models': { models: [
        { model_id: 'm1', title: 'Synthetic bracket', base: 'box', revision: 3, state: 'built', updated_at: iso(-1) },
        { model_id: 'm2', title: 'Synthetic housing', base: 'cylinder', revision: 1, state: 'failed', failure_reason: 'Synthetic failure reason', updated_at: iso(-30) },
        { model_id: 'm3', title: 'Synthetic draft', base: 'box', revision: 0, state: 'draft', updated_at: iso(-100) } ] },
    },
    audiences: {
      company: { stats: 4, sections: ['parts', 'attention'], text: ['CAD Studio', 'Synthetic bracket', 'Synthetic housing', 'Synthetic failure reason'], statValues: { parts: '3', built: '1', failed: '1', rebuilds: '4' } },
    },
  });

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
