/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the LoRA Studio family audience view (ADR-164 D6): the studio page, its declared URL, a synthetic read-only answer shaped like GET /api/lora/home-summary (routes/home-summary.js: the three counts as digit strings mirrored as tiles; the three newest characters, each with its 'Latest version <n> · <status> · registered <iso>' or 'No saved model version' detail and the prepare-document offer whose notes carry the evaluation sentence; then the bounds note) and what the family view must show. /characters answers only so the full page's own start has a character to paint without an audience; the view never reads it (its read saves the starter character for a new account). Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The route's three counts for an account with three characters, one version training and one failed.
 * @returns {object[]} Metrics with digit-string values, which the route mirrors as tiles.
 */
function counts() {
  return [
    { id: 'characters', label: 'Saved characters', value: '3' },
    { id: 'training-active', label: 'Queued / training', value: '1' },
    { id: 'training-failed', label: 'Failed versions', value: '1' },
  ];
}

/**
 * @description One character item as the route writes it: the display name, the latest-version detail and the offer.
 * @param {string} name The display name.
 * @param {{ version: number, status: string, at: string, overall?: string }|null} latest The latest saved version, or null.
 * @returns {object} The item.
 */
function character(name, latest) {
  const detail = latest ? 'Latest version ' + latest.version + ' · ' + latest.status + ' · registered ' + latest.at : 'No saved model version';
  const evaluation = latest && latest.overall ? latest.overall + ' on a 0–1 scale at ' + latest.at : 'not recorded';
  const notes = detail + ' Active version: none. Latest-version evaluation: ' + evaluation + '. Registration is not a training completion timestamp.';
  return { text: name, detail, tone: 'neutral', fix: 'lora-studio', actions: [{ integration: 'prepare-document', context: { title: name, notes } }] };
}

/**
 * @description The three newest characters in the route's order (created_at descending) followed by its bounds note.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Items.
 */
function items(iso) {
  return [
    character('Synthetic Cyclops', { version: 3, status: 'scored', at: iso(-2), overall: '0.8312' }),
    character('Synthetic Tin Drummer', { version: 1, status: 'training', at: iso(-26) }),
    character('Synthetic Fox', null),
    { text: 'Character ownership also scopes model and score rows. The latest registered model and its matching evaluation remain separate from the active version. No GPU dispatch or model promotion runs on Home; prepare a model card from recorded evidence.', tone: 'neutral', fix: 'lora-studio' },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = counts();
  return {
    app: 'lora', file: 'lora/tools/lora.html', url: '/api/lora/ui', fullMarker: '#chars .card[data-char-index]',
    reads: {
      '/api/lora/home-summary': { metrics: m, tiles: m, items: items(iso), asOf: iso(0), partial: false },
      '/api/lora/characters': { characters: [
        { subject: 'synthetic-cyclops', display_name: 'Synthetic Cyclops', trigger_word: 'syncyclops', storage_key: 'lora-00000000000040008000000000000001', autonomous: false, active_version: 2, latest_version: 3, version_count: 3, latest_score: 0.8312, created_at: iso(-300) },
      ] },
    },
    audiences: {
      family: {
        stats: 4, sections: ['characters'],
        text: ['Character studio', '1 version waiting or training', 'Newest: Synthetic Cyclops, version 3 trained and scored, score 0.83 of 1.', 'Open LoRA Studio',
          'Your newest characters', 'Synthetic Cyclops', 'Version 3 · Trained and scored', 'version recorded 2 h ago', 'Score 0.83',
          'Synthetic Tin Drummer', 'Version 1 · Training now', 'version recorded yesterday', 'Synthetic Fox', 'No trained version yet',
          'A score runs from 0 to 1: closer to 1 means the pictures look more like the character.', 'Training starts only in LoRA Studio.',
          'Open LoRA Studio in the cockpit'],
        statValues: { characters: '3', training: '1', failed: '1', score: '0.83' },
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
