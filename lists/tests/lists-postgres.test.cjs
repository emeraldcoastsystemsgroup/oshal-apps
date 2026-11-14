/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 on a real PostgreSQL: the package's own migration applied to a database made for this run, then every shared scenario (tests/support/scenarios.cjs) through the real router, the real store and the pg driver. Real: PostgreSQL, migrations/001-lists.sql, the statements, Express. Stand-in: the signed-in person (a cookie). Needs OSHAL_TEST_POSTGRES, the gate's disposable PostgreSQL on 127.0.0.1:35689; without it the suite fails, it never skips. The database is dropped at the end.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, dependency, PACKAGE } = require('./support/fixture.cjs');
const { CASES } = require('./support/scenarios.cjs');

/** @description The gate's disposable PostgreSQL, refused when it is any other address. @returns {URL} Its address. */
function fixtureAddress() {
  const raw = process.env.OSHAL_TEST_POSTGRES;
  if (!raw) throw new Error('OSHAL_TEST_POSTGRES is required: the disposable PostgreSQL on 127.0.0.1:35689 only.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '35689') throw new Error('Only the disposable PostgreSQL on 127.0.0.1:35689 is allowed.');
  return url;
}

/** @description A database for this run with the package's migration applied. @returns {Promise<{pool: object, drop: Function}>} Its pool and its removal. */
async function database() {
  const { Client, Pool } = dependency('pg');
  const url = fixtureAddress(), name = 'lists_' + randomUUID().replaceAll('-', '');
  const admin = new Client({ connectionString: url.href, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.href, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  await pool.query(fs.readFileSync(path.join(PACKAGE, 'migrations', '001-lists.sql'), 'utf8'));
  return {
    pool,
    async drop() {
      await pool.end();
      const deadline = Date.now() + 5000;
      while ((await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name])).rows[0].n) {
        if (Date.now() >= deadline) throw new Error('the Lists fixture database still has connections');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    },
  };
}

test('the Lists scenarios on a real PostgreSQL with the migration applied', { timeout: 180000 }, async (t) => {
  const db = await database();
  try {
    for (const [name, run] of Object.entries(CASES)) {
      await t.test(name, async () => {
        await db.pool.query('DELETE FROM lists_items');
        await db.pool.query('DELETE FROM lists_lists');
        const f = await app({ pool: db.pool });
        try { await run(f); } finally { await f.close(); }
      });
    }
    await t.test('the migration applies a second time without error and keeps the rows', async () => {
      await db.pool.query("INSERT INTO lists_lists (id, user_sub, name, name_key, position, created_at, updated_at) VALUES ('keep', 'alice', 'Keep', 'keep', 1, 'now', 'now')");
      await db.pool.query(fs.readFileSync(path.join(PACKAGE, 'migrations', '001-lists.sql'), 'utf8'));
      assert.equal((await db.pool.query("SELECT name FROM lists_lists WHERE id = 'keep'")).rows[0].name, 'Keep');
    });
  } finally { await db.drop(); }
});
