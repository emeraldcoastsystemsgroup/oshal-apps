/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "What printers are available in Scan to Print?" from Jarvis: the printer's saved access code had been sealed by the earlier platform, the status tool threw tool_failed, and the kernel reported it as insufficient_tier, so the person was told they lacked permission. Through the compiled tool handlers, a personal_data_reentry_required failure answers 409 credential_reentry_required saying to re-enter the code; any other failure still throws.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const PRINTER = '3fd4330d-d458-432e-915e-a81e661194fc';
let printerState = async () => ({ ok: true });
const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === './print-service') return { loadPrinter: async (_pool, sub, id) => (sub === 'owner' && id === PRINTER ? { row: { printer_id: id, label: 'P2S', kind: 'bambu', auto_start: false } } : null), printerState: (...a) => printerState(...a) };
  if (request === './print-routes') return { serviceDepsOf: (deps) => deps };
  if (request === './service-routes') return { choosePrinter: async () => ({}) };
  if (request === './job-outputs') return { claimJobOperation: () => ({}), currentOutputRefusal: () => null };
  if (request === './job-store') return { getJob: async () => null };
  return original.call(this, request, ...rest);
};
const tools = require('../routes/print-tools.js');
test.after(() => { Module._load = original; });

const actor = () => ({ isActive: true, sub: 'owner', issuer: 'https://issuer.test' });
const status = () => tools.createPrintToolHandlers({ pool: {} }, actor).get('print-service-printer-status');

test('a saved code sealed by the earlier platform answers re-enter it, not a refusal', async () => {
  printerState = async () => { throw Object.assign(new Error('sealed by the earlier platform'), { code: 'personal_data_reentry_required', status: 409 }); };
  const reply = await status()({ printerId: PRINTER });
  assert.equal(reply.ok, false);
  assert.equal(reply.status, 409);
  assert.equal(reply.error, 'credential_reentry_required');
  assert.match(reply.message, /Re-enter it for this printer on the Scan to Print screen/);
  assert.match(reply.message, /nothing is wrong with the person's permissions/);
});

test('any other failure still throws as before', async () => {
  printerState = async () => { throw new Error('socket closed'); };
  await assert.rejects(status()({ printerId: PRINTER }), (e) => e.code === 'tool_failed');
});
