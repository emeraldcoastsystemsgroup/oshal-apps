/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The prediction ledger the Algorithms scan and /algo-stats use is declared by a manifest migration with every column those statements name (the native kernel provisions only declared tables: "SQL table oshal_trading_predictions is not provisioned" emptied the scan).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The store toolchain's js-yaml, resolved explicitly as native-test-catalog does (the gate sets no NODE_PATH).
const roots = [__dirname, path.resolve(__dirname, '../../scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [path.resolve(process.env.OSHAL_FRAMEWORK)] : [])];
const yaml = require(require.resolve('js-yaml', {paths: roots}));

const PKG = path.resolve(__dirname, '..');

test('every prediction-ledger column the routes write or read is created by a declared migration', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const ddl = manifest.migrations.map((m) => fs.readFileSync(path.join(PKG, m), 'utf8')).join('\n');
  const table = /CREATE TABLE IF NOT EXISTS oshal_trading_predictions \(([^;]*)\);/.exec(ddl);
  assert.ok(table, 'a declared migration creates oshal_trading_predictions');
  const columns = new Set(table[1].split(',').map((c) => c.trim().split(/\s+/)[0]));
  const route = fs.readFileSync(path.join(PKG, 'src-routes/trading-routes-algo-builders.ts'), 'utf8');
  const inserted = [...route.matchAll(/INSERT INTO oshal_trading_predictions \(([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((c) => c.trim()));
  assert.ok(inserted.length >= 8, 'recordPredictions inserts are found');
  for (const column of [...inserted, 'resolved', 'hit', 'mode', 'algo', 'created_at']) assert.ok(columns.has(column), column);
  assert.ok(/user_sub TEXT NOT NULL/.test(table[1]), 'every row carries its owner');
});
