/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Side-effect-free home-summary tile, metric, and item indicators for Audio Studio.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Use fail-closed authorizeRequest and two-arm owner-scoped repository counts.
 */
'use strict';

let createRouter;
try {
  createRouter = require('express').Router;
} catch {
  createRouter = require('../lib/router.js').createRouter;
}

const { createAudioRepository } = require('../lib/db.js');
const { authorizeRequest } = require('../lib/security.js');

function createHomeSummaryRoutes(ctx) {
  const router = createRouter();
  const repo = ctx?.repo || createAudioRepository(ctx);

  router.get('/', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'studio.read');
    if (!actor) return;

    const counts = await repo.getSummaryCounts(actor);
    res.json({
      tiles: [
        { label: 'Active Projects', value: String(counts.projects), tone: counts.projects > 0 ? 'good' : 'neutral' },
        { label: 'Audio Stems', value: String(counts.stems), tone: 'neutral' },
        { label: 'Rendered Mixes', value: String(counts.mixdowns), tone: counts.mixdowns > 0 ? 'good' : 'neutral' },
      ],
      metrics: counts,
      items: counts.projects === 0
        ? [{ text: 'Open Audio Studio to mix stems or import a recording', tone: 'neutral', fix: 'audio-studio' }]
        : [],
    });
  });

  return router;
}

module.exports = { createHomeSummaryRoutes };
