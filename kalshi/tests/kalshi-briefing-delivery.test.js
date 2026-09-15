/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled scan producer against accepted, declined and failed briefing writes without live services.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const compiled = path.resolve(__dirname, '../routes/kalshi-scan-cron.js');
const config = require('../routes/kalshi-scan-config.js');
const recipient = 'fixture-kalshi-existing-user';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const hand = { ticker: 'KX-FIXTURE', title: 'Synthetic candidate', side: 'yes', category: 'Fixture',
  price: 0.5, trueProb: 0.7, edgeNet: 0.1, strength: 'strong', stakeFraction: 0,
  riskFlags: [], closeTime: null };

/** @description Provide synthetic engine storage while retaining the real config and alert decision code. */
function enginePorts(state, preferences) {
  return {
    resolveConfig: async () => ({ ...config.KALSHI_SCAN_DEFAULTS, ...preferences }),
    withScanLease: async (_pool, operation) => operation(),
    runScan: async () => ({ hands: [hand], generatedAt: '2026-09-11T12:00:00Z', evaluable: 1, mayStake: false }),
    writeSnapshot: async (_pool, payload) => { state.snapshots.push(payload); },
    alertAudience: async () => [recipient], alertedTickers: async () => new Set(), alertsSentToday: async () => 0,
    recordAlert: async (...args) => { state.alerts.push(args); }, pruneAlertLedger: async () => {},
  };
}

/** @description Load the actual compiled public scan entry point with isolated framework I/O ports. */
function fixture(enqueue, preferences = {}) {
  const state = { pending: [], finished: [], alerts: [], snapshots: [], outward: [] };
  const ports = {
    '@/shared/logger': { createChildLogger: () => logger },
    '@/app/routes/jarvis-task-store': {
      saveTaskPending: async (...args) => { state.pending.push(args); return enqueue(); },
      finishTask: async (...args) => { state.finished.push(args); },
    },
    '@/app/routes/notify-routes': { buildNotificationRouter: () => ({
      notify: async (...args) => { state.outward.push(args); return { delivered: true, channel: 'fixture-email' }; },
    }) },
    './kalshi-scan-engine': enginePorts(state, preferences), './kalshi-scan-config': config,
  };
  const subject = new Module(compiled, module);
  subject.filename = compiled;
  subject.require = request => Object.hasOwn(ports, request) ? ports[request] : require(request);
  subject._compile(fs.readFileSync(compiled, 'utf8'), compiled);
  return { state, run: () => subject.exports.scanNow({ pool: {} }, 'poller') };
}

test('declined briefing enqueue does not finish a task or claim Jarvis delivery', async () => {
  const proof = fixture(() => false);
  await proof.run();
  assert.equal(proof.state.pending.length, 1);
  assert.equal(proof.state.finished.length, 0);
  assert.equal(proof.state.alerts.length, 1);
  assert.equal(proof.state.alerts[0][3], 'none');
  assert.equal(proof.state.alerts[0][4], false);
  assert.equal(proof.state.snapshots.length, 1);
  assert.equal(proof.state.outward.length, 0);
});

test('accepted enqueue retains the exact existing recipient and registered session before finishing', async () => {
  const proof = fixture(() => true);
  await proof.run();
  const pending = proof.state.pending[0];
  assert.equal(pending[2], recipient);
  assert.equal(pending[3], 'kalshi-alerts');
  assert.equal(pending[5], 'simple');
  assert.equal(proof.state.finished.length, 1);
  assert.equal(proof.state.finished[0][1], pending[1]);
  assert.equal(proof.state.finished[0][2], true);
  assert.match(proof.state.finished[0][3], /Synthetic candidate/);
  assert.equal(proof.state.alerts[0][3], 'jarvis');
  assert.equal(proof.state.alerts[0][4], true);
  assert.equal(proof.state.outward.length, 0);
});

test('a failed briefing writer preserves the scan snapshot and leaves the alert undelivered', async () => {
  const proof = fixture(() => { throw new Error('fixture briefing policy unavailable'); });
  await proof.run();
  assert.equal(proof.state.finished.length, 0);
  assert.equal(proof.state.snapshots.length, 1);
  assert.equal(proof.state.alerts[0][3], 'none');
  assert.equal(proof.state.alerts[0][4], false);
});

test('the existing package opt-out still prevents calling the briefing writer', async () => {
  const proof = fixture(() => true, { notifyJarvis: false });
  await proof.run();
  assert.equal(proof.state.pending.length, 0);
  assert.equal(proof.state.finished.length, 0);
  assert.equal(proof.state.outward.length, 0);
  assert.equal(proof.state.alerts.length, 0);
});

test('a declined Jarvis briefing preserves separately opted-in outward delivery', async () => {
  const proof = fixture(() => false, { notifyOutward: true });
  await proof.run();
  assert.equal(proof.state.finished.length, 0);
  assert.equal(proof.state.outward.length, 1);
  assert.equal(proof.state.outward[0][0], recipient);
  assert.equal(proof.state.alerts[0][3], 'fixture-email');
  assert.equal(proof.state.alerts[0][4], true);
});
