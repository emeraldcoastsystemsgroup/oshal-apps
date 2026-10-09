/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Ocean Lab company audience view (ADR-164 D6) on the Harvest Siting Console, the manifest's first surface: the page, its declared URL, the engine script at the package's assets path (so the full page boots when no audience is asked for), two synthetic read-only answers shaped like the package's routes (GET /api/ocean-lab/vehicles as routes/vehicle-routes.js publishes it: each vehicle with its stage computed on the read, open limit rows and the fabricable sentence, timestamptz columns as ISO instants; GET /api/ocean-lab/harvest/sites as routes/harvest-routes.js answers it: the illustrative marine sites and soils with the route's provenance note), and what the company view must show. The harness answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const FABRICABLE = 'fabricable means the files are complete and self-consistent. It does not mean the machine is safe to build, fly or wet.';

/** The kind's eight limit rows in the shape the stage carries them (three block `built`); sentences are synthetic. */
const LIMITS = [
  ['nothing-built', true], ['no-real-site-data', false], ['drag-correlation-stack', false], ['no-structural-analysis', true],
  ['shallow-stops-unmodelled', false], ['no-self-intersection-check', true], ['no-physics-parity', false], ['hand-built', false],
].map(([id, blocking]) => ({ id, sentence: 'Synthetic limit ' + id + '.', retireWhen: 'Synthetic retirement condition.', blocking }));

/**
 * @description One published vehicle: the record and the stage the route computes on the read.
 * @param {string} name The vehicle name.
 * @param {string} updated ISO instant of updated_at.
 * @param {number|null} sizedBy The run that sized it at the current vector, or null at concept.
 * @param {object[]} openLimits The limit rows still open.
 * @returns {object} `{ vehicle, stage }` as routes/vehicle-routes.js publishes it.
 */
function vehicle(name, updated, sizedBy, openLimits) {
  const sized = sizedBy !== null;
  return {
    vehicle: { vehicleId: 'synthetic-' + name.length, kind: 'wave-explorer', name, designVector: { synthetic: true }, provenance: { source: 'synthetic' }, createdAt: updated, updatedAt: updated },
    stage: { currentVectorFingerprint: 'f'.repeat(64), openLimits, fabricable: FABRICABLE, stage: sized ? 'sized' : 'concept', reached: sized ? ['concept', 'sized'] : ['concept'],
      next: sized ? 'parts-complete' : 'sized', sizedBy, blockedBy: ['Synthetic blocker.'], because: 'Synthetic reason.' },
  };
}

/** The route's site catalogue: the two illustrative marine sites and the three illustrative soils. */
const SITES = {
  illustrative: true,
  note: 'Plausible parameter sets, NOT survey data. Replace the tidal harmonic constants with the published constants for your station, and the soil properties with a site thermal survey, before treating any verdict as site-specific.',
  marine: [
    { name: 'illustrative-strong-channel', constituents: [['M2', 1.9], ['S2', 0.6], ['N2', 0.35], ['K1', 0.15]].map(([name, amplitudeMs]) => ({ name, periodHours: 12, amplitudeMs, phaseDeg: 0 })), residualMs: 0.1 },
    { name: 'illustrative-moderate-inlet', constituents: [['M2', 0.85], ['S2', 0.28], ['K1', 0.12]].map(([name, amplitudeMs]) => ({ name, periodHours: 12, amplitudeMs, phaseDeg: 0 })), residualMs: 0.05 },
  ],
  ground: [
    { name: 'illustrative-temperate-loam', thermalDiffusivityM2S: 0.5e-6, thermalConductivityWmK: 1.0, meanTempC: 12, annualAmplitudeC: 12, diurnalAmplitudeC: 8, geothermalGradientKM: 0.025 },
    { name: 'illustrative-dry-sand', thermalDiffusivityM2S: 0.24e-6, thermalConductivityWmK: 0.5, meanTempC: 20, annualAmplitudeC: 15, diurnalAmplitudeC: 14, geothermalGradientKM: 0.025 },
    { name: 'illustrative-wet-clay', thermalDiffusivityM2S: 0.9e-6, thermalConductivityWmK: 1.8, meanTempC: 10, annualAmplitudeC: 9, diurnalAmplitudeC: 4, geothermalGradientKM: 0.025 },
  ],
};

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'ocean-lab', file: 'ocean-lab/tools/harvest-console.html', url: '/api/ocean-lab/harvest-console', fullMarker: '#c-site option',
  assets: [{ url: '/api/ocean-lab/assets/harvest-console.js', file: 'ocean-lab/tools/harvest-console.js' }],
  reads: {
    '/api/ocean-lab/vehicles': {
      vehicles: [
        vehicle('Synthetic Explorer A', iso(-2), 2, LIMITS.filter((l) => l.id !== 'drag-correlation-stack')),
        vehicle('Synthetic Explorer B', iso(-30), null, LIMITS),
      ],
      stages: ['concept', 'sized', 'parts-complete', 'fabricable', 'built'], fabricable: FABRICABLE,
    },
    '/api/ocean-lab/harvest/sites': SITES,
  },
  audiences: {
    company: {
      stats: 4, sections: ['vehicles', 'sites'],
      text: ['Engineering · Ocean Lab', '2 saved vehicles · 1 sized', 'this view runs no simulation', 'Saved vehicles', 'Synthetic Explorer A', 'sized', 'Run 2', '7 (3 blocking)', '2 h ago',
        'Synthetic Explorer B', 'concept', 'Not evaluated at this vector', '8 (3 blocking)', 'yesterday', FABRICABLE,
        'Site catalogue the console sizes against', 'Plausible parameter sets, NOT survey data.', 'illustrative-strong-channel', 'Tidal current · M2 + S2 + N2 + K1 · residual 0.1 m/s',
        'illustrative-wet-clay', 'Soil thermal · mean 10 °C · annual ±9 °C · diurnal ±4 °C', 'Open Ocean Lab in the cockpit'],
      statValues: { vehicles: '2', sized: '1', concept: '1', sites: '5' },
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
