/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Harvest Siting Console's server cross-check asked GET /harvest/simulate?site=...,
 *   which the package never served (the route is POST /simulate with a full design): every load answered 404, on the
 *   native kernel as "application asset not found". The console now POSTs serverSimulationRequest(state). The shipped
 *   console script and the compiled harvest router are run together: the console never GETs the simulate route, its
 *   request is accepted for every wiring and site, and the server's verdict agrees with the console's own model
 *   (perpetual exactly, margin within 1 %), which is what the cross-check row claims.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const CONSOLE = path.join(PKG, 'tools', 'harvest-console.js');
const logger = { info() {}, warn() {}, error() {}, debug() {} };

/** Build the compiled harvest router with an express stand-in, keeping its POST handlers by path. */
function harvestPostHandlers() {
  const handlers = {};
  const router = { get() {}, post(routePath, ...chain) { handlers[routePath] = chain[chain.length - 1]; } };
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'express') return { Router: () => router };
    if (request === '@/shared/logger') return { createChildLogger: () => logger };
    return original.call(this, request, ...rest);
  };
  try {
    const target = path.join(PKG, 'routes', 'harvest-routes.js');
    delete require.cache[require.resolve(target)];
    require(target).createHarvestRoutes({ appPackageDir: PKG });
  } finally {
    Module._load = original;
  }
  return handlers;
}

/** Answer one POST through the compiled handler. */
function post(handler, body) {
  const reply = { status: 200, body: null };
  const res = { status(code) { reply.status = code; return res; }, json(payload) { reply.body = payload; return res; } };
  handler({ body }, res);
  return reply;
}

test('the console never asks GET /harvest/simulate; it POSTs its design', () => {
  const source = fs.readFileSync(CONSOLE, 'utf8');
  assert.doesNotMatch(source, /getJson\(\s*'\/api\/ocean-lab\/harvest\/simulate/);
  assert.match(source, /postJson\('\/api\/ocean-lab\/harvest\/simulate', serverSimulationRequest\(STATE\)\)/);
});

test('every wiring and site the console offers is accepted and agrees with the console model', () => {
  const harvest = require(CONSOLE);
  const simulate = harvestPostHandlers()['/simulate'];
  assert.equal(typeof simulate, 'function');
  for (const wiring of harvest.WIRINGS.map((w) => w.id)) {
    for (const siteId of harvest.SITES.map((s) => s.id)) {
      const state = { ...harvest.DEFAULTS, wiring, siteId };
      const reply = post(simulate, harvest.serverSimulationRequest(state));
      const label = `${wiring} / ${siteId}`;
      assert.equal(reply.status, 200, `${label}: ${JSON.stringify(reply.body)}`);
      const local = harvest.computeModel(state).verdict;
      assert.equal(reply.body.verdict.perpetual, local.perpetual, `${label}: perpetual`);
      assert.ok(Math.abs(reply.body.verdict.marginRatio - local.marginRatio) <= 0.01 * Math.abs(local.marginRatio),
        `${label}: server margin ${reply.body.verdict.marginRatio} vs console ${local.marginRatio}`);
    }
  }
});

test('every soil the console offers is accepted', () => {
  const harvest = require(CONSOLE);
  const simulate = harvestPostHandlers()['/simulate'];
  for (const soilId of harvest.SOILS.map((s) => s.id)) {
    const reply = post(simulate, harvest.serverSimulationRequest({ ...harvest.DEFAULTS, soilId }));
    assert.equal(reply.status, 200, `${soilId}: ${JSON.stringify(reply.body)}`);
    assert.equal(typeof reply.body.verdict.perpetual, 'boolean');
  }
});
