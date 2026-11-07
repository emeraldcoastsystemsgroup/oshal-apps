/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard five-minute account observation upserts against EXCLUDED predicates outside DO UPDATE SET on both native package SQL and disposable PostgreSQL.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { recordAccountValue, recordAccountValues, registerAccountValueRoutes } = require('../routes/trading-account-values');

const PKG_DIR = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN
  ? (fs.existsSync(path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'))
    ? path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN), 'node_modules')
    : path.resolve(process.env.STORE_CI_TOOLCHAIN))
  : path.resolve(PKG_DIR, '../scripts/toolchain/node_modules');

function collectRouteFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectRouteFiles(full));
    else if (entry.isFile() && /\.(?:js|mjs|cjs|ts)$/.test(entry.name)) found.push(full);
  }
  return found;
}

function createNativeSqlValidatorPool() {
  const rowsByKey = new Map();
  return {
    rowsByKey,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      const wherePart = normalized.split(/\bDO\s+UPDATE\s+SET\b/i)[1] || '';
      const selectionPart = wherePart.split(/\bWHERE\b/i)[1] || '';
      if (/\bEXCLUDED\s*\./i.test(selectionPart)) {
        throw new Error('EXCLUDED outside an upsert');
      }
      if (/^INSERT INTO trading_account_values\b/i.test(normalized)) {
        assert.match(selectionPart, /trading_account_values\.observed_at::timestamptz\s*<\s*\$5::timestamptz/i);
        const [user_sub, connection_key, account_id, observed_day, observed_at, equity, cash] = params;
        const key = `${user_sub}|${connection_key}|${account_id}|${observed_day}`;
        const prev = rowsByKey.get(key);
        if (!prev || Date.parse(prev.observed_at) < Date.parse(observed_at)) {
          rowsByKey.set(key, { user_sub, connection_key, account_id, observed_day, observed_at, equity, cash });
        }
        return { rows: [] };
      }
      if (/^SELECT observed_day,observed_at,equity,cash FROM trading_account_values\b/i.test(normalized)) {
        const [user_sub, connection_key, account_id] = params;
        const rows = [...rowsByKey.values()]
          .filter((r) => r.user_sub === user_sub && r.connection_key === connection_key && r.account_id === account_id)
          .sort((a, b) => b.observed_day.localeCompare(a.observed_day));
        return { rows };
      }
      if (/FROM oshal_trading_portfolio_records\b/i.test(normalized)) return { rows: [] };
      throw new Error(`Unexpected SQL in validator pool: ${normalized}`);
    },
  };
}

async function verifyUpsertSequence(pool) {
  const ctx = { pool, intent: async () => ({ symbol: 'SPY', source: 'schwab', bars: [] }) };
  const account = { kind: 'live', broker: 'schwab', connectionKey: 'conn-1', accountId: 'acct-1', equity: 125000.5, cash: 15000.25 };

  await recordAccountValue(ctx, 'owner-upsert-1', account, '2026-11-06T15:00:00Z');
  const okAdvance = await recordAccountValues(ctx, 'owner-upsert-1', {
    readAt: '2026-11-06T15:05:00Z',
    accounts: [{ ...account, equity: 126400.75, cash: 14800.0 }],
  });
  assert.equal(okAdvance, true);

  // Older timestamp formatted with +00:00 offset (lexicographically > 'Z' at index 19 if uncast) must NOT overwrite.
  await recordAccountValue(
    ctx,
    'owner-upsert-1',
    { ...account, equity: 99999.0, cash: 100.0 },
    '2026-11-06T15:02:00+02:00'
  );

  let detailHandler = null;
  registerAccountValueRoutes(
    (_method, routePath, handler) => { if (routePath === '/portfolio/account-details') detailHandler = handler; },
    ctx,
    {
      selected: async () => ({
        account,
        report: { accounts: [{ ...account, equity: 126400.75, cash: 14800.0 }] },
        native: { readAt: '2026-11-06T15:05:00Z' },
      }),
    }
  );
  const res = await detailHandler({ query: { period: '1M', compare: 'SPY' } }, 'owner-upsert-1', '2026-11-06T15:05:00Z');
  assert.equal(res.history.available, true);
  assert.equal(res.history.points.length, 1);
  assert.equal(res.history.points[0].value, 126400.75);
  assert.equal(res.history.points[0].cash, 14800.0);
  assert.equal(res.history.points[0].at, '2026-11-06T15:05:00.000Z');
}

test('no route SQL in trading references EXCLUDED outside DO UPDATE SET assignments', () => {
  const files = collectRouteFiles(path.join(PKG_DIR, 'routes'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const matches = src.matchAll(/ON\s+CONFLICT[\s\S]{0,600}?DO\s+UPDATE\s+SET([\s\S]{0,600}?)(?:`|;|"\s*,|'\s*,)/gi);
    for (const match of matches) {
      const clause = match[1] || '';
      const wherePart = clause.split(/\bWHERE\b/i)[1] || '';
      assert.equal(
        /\bEXCLUDED\s*\./i.test(wherePart),
        false,
        `${path.relative(PKG_DIR, file)} references EXCLUDED inside DO UPDATE WHERE`
      );
    }
  }
});

test('five-minute account value upsert succeeds under native package-sql rules and preserves orderAuthority', async () => {
  const validatorPool = createNativeSqlValidatorPool();
  await verifyUpsertSequence(validatorPool);

  const manifest = fs.readFileSync(path.join(PKG_DIR, 'oshal-app.yaml'), 'utf8');
  assert.match(
    manifest,
    /orderAuthority:\s*\n\s*sources:\s*\n\s*-\s*routes\/trading-native-management\.js\s*\n\s*-\s*routes\/live\/management\.js/
  );
});

test('five-minute account value upsert succeeds against disposable PostgreSQL', async () => {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  assert.ok(dsn, 'OSHAL_TEST_POSTGRES must name an explicitly disposable PostgreSQL fixture.');
  const parsed = new URL(dsn);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(parsed.hostname) && ['35689', '32768'].includes(parsed.port),
    'Require the declared disposable PostgreSQL fixture'
  );

  const { Client } = require(path.join(TOOLCHAIN, 'pg'));
  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query('BEGIN');
    const ddl = fs.readFileSync(path.join(PKG_DIR, 'migrations/011-native-account-values.sql'), 'utf8');
    await client.query('CREATE TEMP TABLE oshal_trading_portfolio_records (user_sub TEXT, kind TEXT, record_id TEXT, payload JSONB, created_at TIMESTAMPTZ)');
    await client.query(ddl.replace('CREATE TABLE IF NOT EXISTS trading_account_values', 'CREATE TEMP TABLE trading_account_values'));
    await verifyUpsertSequence(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
});
