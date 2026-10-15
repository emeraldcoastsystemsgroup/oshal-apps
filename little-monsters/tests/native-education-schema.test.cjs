/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the compiled education schema bootstrap sends no query on the native kernel pool (no catalog probe, no provisioning) and still validates a PostgreSQL pool.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const log = {info(){},warn(){},error(){},debug(){}};
const readiness = [];
Module._load = function(name, ...args) {
  if (name === '@/shared/logger') return {createChildLogger:() => log};
  if (name === '@/shared/services/database') return {runtimeSchemaBootstrapEnabled:() => false,
    assertSchemaReady:async (_pool, label) => {readiness.push(label);}};
  return original.call(this,name,...args);
};
const {ensureEducationSchema} = require('../routes/education-schema');
Module._load = original;

test('native kernel pool: ensureEducationSchema sends no catalog probe and provisions nothing', async () => {
  const pool = {storageModel:'kernel-scoped-documents',connect(){assert.fail('native schema must not provision');},
    async query(text){assert.fail(`native schema must not query: ${text}`);}};
  await ensureEducationSchema(pool);
  assert.deepEqual(readiness, [], 'no readiness probe on the native pool');
});

test('PostgreSQL pool: ensureEducationSchema still probes the catalog', async () => {
  const texts = [];
  const pool = {connect(){return {query:async (text) => {texts.push(text);return {rows:[]};},release(){}};},
    async query(text){texts.push(text);return {rows:[]};}};
  await ensureEducationSchema(pool).catch(() => {});
  assert.deepEqual(readiness, ['education routes'], 'the PostgreSQL path checks schema readiness');
  assert.ok(texts.some(text => /pg_index|to_regclass|pg_constraint/.test(text)), 'the PostgreSQL path probes the catalog');
});
