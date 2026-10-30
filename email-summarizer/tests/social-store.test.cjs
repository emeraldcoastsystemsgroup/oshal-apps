/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Social desk's tables on a disposable PostgreSQL with the declared migration and forced owner row security: a post is stored, listed, read by key, edited and deleted; the due read returns only scheduled posts whose time has come; settings default and then save (a duplicate insert is a skip); an event stores and deleting it removes its unsent announcements and keeps the sent ones; and one person never reads another's posts, settings or events. The migration is idempotent and its SQL holds no ON CONFLICT, ORDER BY or DISTINCT.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const { Pool, Client } = require(path.join(TOOLCHAIN, 'pg'));
const DSN = process.env.OSHAL_TEST_POSTGRES;
if (!DSN) throw new Error('OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server for this suite');
const store = require('../routes/social-store.js');
const MIGRATION = fs.readFileSync(path.join(PKG, 'migrations', '002-email-social-desk.sql'), 'utf8');

test('the migration holds no statement the native kernel copies a table for', () => {
  const code = (text, comment) => text.split('\n').filter((line) => !comment.test(line.trim())).join('\n');
  assert.doesNotMatch(code(MIGRATION, /^--/), /ON CONFLICT|ORDER BY|DISTINCT/i);
  const sql = fs.readFileSync(path.join(PKG, 'routes', 'social-store.js'), 'utf8');
  assert.doesNotMatch(code(sql, /^(\*|\/\*|\/\/)/), /ON CONFLICT|ORDER BY|DISTINCT ON/i);
});

/** A disposable database with the declared migration, and one pool per person under forced row security. */
async function database(t) {
  const name = 'social_desk_' + crypto.randomBytes(6).toString('hex');
  const role = name + '_rt';
  const admin = new Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(DSN); url.pathname = '/' + name;
  const owner = new Pool({ connectionString: url.toString(), max: 2 });
  await owner.query(MIGRATION);
  await owner.query(MIGRATION); // idempotent
  await owner.query(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN; GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON oshal_email_social_posts, oshal_email_social_settings, oshal_email_social_events TO ${role}; GRANT ${role} TO CURRENT_USER`);
  const as = (sub) => new Pool({ connectionString: url.toString(), max: 2, options: `-c role=${role} -c oshal.current_sub=${sub}` });
  const pools = { alice: as('alice'), bob: as('bob') };
  t.after(async () => {
    for (const p of [owner, pools.alice, pools.bob]) await p.end();
    // Wait for the ended pools' sessions to be gone before dropping: a forced drop over a session still closing makes
    // pg raise "terminating connection" on a client with no listener, an uncaught error that lands in the next test.
    for (let i = 0; i < 40; i += 1) {
      const open = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name]);
      if (open.rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });
  return { owner, ...pools };
}

test('posts: store, list, read, edit, due and delete, each person their own', async (t) => {
  const db = await database(t);
  const soon = new Date(Date.now() - 1000).toISOString(), later = new Date(Date.now() + 3600000).toISOString();
  await store.insertPost(db.alice, 'alice', { id: 'p1', status: 'scheduled', text: 'one', variants: { x: 'one!' }, channels: ['x'], scheduledAt: soon });
  await store.insertPost(db.alice, 'alice', { id: 'p2', status: 'scheduled', text: 'two', channels: ['slack'], scheduledAt: later });
  await store.insertPost(db.alice, 'alice', { id: 'p3', status: 'draft', text: 'three', channels: [] });
  await store.insertPost(db.bob, 'bob', { id: 'b1', status: 'scheduled', text: 'bob', channels: ['x'], scheduledAt: soon });
  assert.deepEqual((await store.listPosts(db.alice, 'alice')).map((p) => p.id), ['p1', 'p3', 'p2'], 'sorted by when it goes out; a draft takes its creation time');
  assert.deepEqual((await store.listPosts(db.alice, 'alice', 'scheduled')).map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual((await store.listPosts(db.bob, 'bob')).map((p) => p.id), ['b1'], 'bob sees only his');
  assert.equal(await store.readPost(db.bob, 'bob', 'p1'), null, 'bob cannot read alice');
  assert.deepEqual((await store.duePosts(db.alice, 'alice', new Date().toISOString())).map((p) => p.id), ['p1']);
  const p1 = await store.readPost(db.alice, 'alice', 'p1');
  assert.deepEqual(p1.variants, { x: 'one!' });
  assert.equal(await store.updatePost(db.alice, 'alice', 'p1', { status: 'sent', outcomes: { x: { ok: true, id: '1' } }, sentAt: new Date().toISOString() }), true);
  assert.equal((await store.readPost(db.alice, 'alice', 'p1')).outcomes.x.id, '1');
  assert.equal(await store.updatePost(db.bob, 'bob', 'p1', { status: 'draft' }), false, 'bob cannot edit alice');
  assert.equal(await store.deletePost(db.bob, 'bob', 'p2'), false);
  assert.equal(await store.deletePost(db.alice, 'alice', 'p2'), true);
  assert.deepEqual((await store.listPosts(db.alice, 'alice')).map((p) => p.id).sort(), ['p1', 'p3']);
});

test('settings default, then save and update; a duplicate insert is a skip', async (t) => {
  const db = await database(t);
  const first = await store.readSettings(db.alice, 'alice');
  assert.deepEqual(first, { plan: { days: [1, 2, 3, 4, 5], times: ['09:00', '12:30', '17:00'] }, slackChannel: '', slackLabel: '', timezone: '', saved: false });
  const saved = await store.writeSettings(db.alice, 'alice', { plan: { days: [6], times: ['20:00'] }, timezone: 'America/Chicago' });
  assert.deepEqual(saved.plan, { days: [6], times: ['20:00'] });
  const again = await store.writeSettings(db.alice, 'alice', { slackChannel: 'C1', slackLabel: '#general' });
  assert.deepEqual([again.plan.times, again.slackChannel, again.timezone], [['20:00'], 'C1', 'America/Chicago'], 'other fields are kept');
  // Ended inside the test: the database cleanup drops the database WITH (FORCE), which would cut an open pool first.
  const carol = new Pool({ connectionString: db.alice.options.connectionString, max: 1, options: db.alice.options.options.replace('alice', 'carol') });
  await carol.query("INSERT INTO oshal_email_social_settings (settings_key, user_sub, timezone) VALUES ('carol', 'carol', 'Europe/Paris')");
  let reads = 0;
  const racing = { query: (sql, params) => (sql.startsWith('SELECT plan') && reads++ === 0 ? Promise.resolve({ rows: [] }) : carol.query(sql, params)) };
  const c = await store.writeSettings(racing, 'carol', { timezone: 'UTC' });
  assert.equal(c.timezone, 'UTC', 'a row stored between the read and the insert is updated, not an error');
  assert.equal((await store.readSettings(carol, 'carol')).timezone, 'UTC');
  await carol.end();
  assert.equal((await store.readSettings(db.bob, 'bob')).saved, false, 'bob has his own');
});

test('events: store, list, and deleting one removes its unsent announcements only', async (t) => {
  const db = await database(t);
  const start = new Date(Date.now() + 7200000).toISOString();
  await store.insertEvent(db.alice, 'alice', { id: 'e1', title: 'Build night', startAt: start, destinations: ['youtube', 'twitch'], watchUrl: 'https://yt/x' });
  await store.insertPost(db.alice, 'alice', { id: 'a1', status: 'sent', text: 'announce', channels: ['x'], eventId: 'e1' });
  await store.insertPost(db.alice, 'alice', { id: 'a2', status: 'scheduled', text: 'soon', channels: ['x'], eventId: 'e1', scheduledAt: start });
  const events = await store.listEvents(db.alice, 'alice');
  assert.deepEqual(events.map((e) => [e.id, e.title, e.destinations]), [['e1', 'Build night', ['youtube', 'twitch']]]);
  assert.deepEqual(await store.listEvents(db.bob, 'bob'), []);
  assert.equal(await store.deleteEvent(db.bob, 'bob', 'e1'), false);
  assert.equal(await store.deleteEvent(db.alice, 'alice', 'e1'), true);
  assert.deepEqual((await store.listPosts(db.alice, 'alice')).map((p) => p.id), ['a1'], 'the sent announcement stays; the unsent one went');
});
