/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Side-effect-free Nexus home summary tiles and metrics for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: real counts only - the person's phones, the computers whose bridge last reported, and the last thing sent with whether the computer said it worked. No "mirrored frames" (there were never any). The owner comes from the parent router's kernel check.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: point the empty-state fix link to phone-control-execution after merging phone-control-config into the Connect sheet.
 */

'use strict';

const path = require('node:path');

let createRouter;
try {
  createRouter = require('express').Router;
} catch {
  createRouter = require('../lib/router.js').createRouter;
}

/**
 * @description The home summary route: tiles, metrics and one item when nothing is connected yet.
 * @param {object} ctx The package context with db and appPackageDir.
 * @returns {object} The router.
 */
function createHomeSummaryRoutes(ctx) {
  const router = createRouter();
  const store = require(path.join(ctx?.appPackageDir || path.resolve(__dirname, '..'), 'lib', 'db.js'));
  const db = ctx?.db || store.getDatabase();

  router.get('/', (req, res) => {
    const phones = store.listPhones(db, req.owner);
    const reports = store.listComputerReports(db, req.owner);
    const last = store.listHistory(db, req.owner, { limit: 1 })[0] || null;
    const bridged = reports.filter((item) => item.report && item.report.version).length;
    res.json({
      tiles: [
        { label: 'Phones', value: String(phones.length), tone: phones.length ? 'good' : 'neutral' },
        { label: 'Computers set up', value: String(bridged), tone: bridged ? 'good' : 'neutral' },
        { label: 'Last action', value: last ? `${last.action} ${last.ok ? 'worked' : 'failed'}` : 'None yet', tone: last && !last.ok ? 'warn' : 'neutral' }
      ],
      metrics: { phones: phones.length, computersSetUp: bridged, lastActionAt: last ? last.createdAt : null },
      items: phones.length ? [] : [{ text: 'Set up one of your computers to connect a phone', tone: 'neutral', fix: 'phone-control-execution' }]
    });
  });

  return router;
}

module.exports = { createHomeSummaryRoutes };
