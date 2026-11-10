/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The master record route (routes/career-master-record-routes.js, 1.51.0) over loopback HTTP with the real reader and made-up stores under JOBHUNTER_STORE_ROOT: refused without a signed-in person; every concierge page's whole answer is at most 12 KB and the pages together are exactly the page's Markdown, each item once (a line longer than a page and multi-byte text included); a bad page number is refused and a missing one is 404; one person never sees another's record; and a person with no store gets an empty record without a folder being made for them.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRouter, loadCompiledModules, startServer } from './helpers/career-route-harness.mjs';
import { madeUpProfile, sqliteAdapter, writeStore } from './helpers/career-master-record-fixture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-master-record-routes-'));
const tenant = path.join(root, 'default');
const priorRoot = process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT = root;
const PAGE_LIMIT = 12 * 1024;
const LONG_WORDS = `ALICE-LONG ${'my own words about the program, with a résumé note and a rocket 🚀; '.repeat(230)}`;

/** A record bigger than several pages: 120 numbered bullets, 120 skills and a history line longer than a page. */
function bigProfile(mark) {
  const profile = madeUpProfile(mark), pad = (n) => String(n).padStart(3, '0');
  profile.roles = [1, 2, 3].map((r) => ({ title: `Role ${r}`, org: `Org ${r}`, start: `201${r}-01`, end: null, skills: [`${mark}-RS-${r}`],
    deliverables: Array.from({ length: 40 }, (_, b) => `[${mark}-R${r}-B${pad(b + 1)}] delivered a measurable outcome — “on time” and under budget for the program`) }));
  profile.skills = Object.fromEntries(Array.from({ length: 6 }, (_, g) => [`Group ${g + 1}`,
    { items: Array.from({ length: 20 }, (_, i) => `[${mark}-G${g + 1}-S${pad(i + 1)}] skill`) }]));
  return profile;
}

let server, baseUrl;
before(async () => {
  writeStore(path.join(tenant, 'alice'), { mark: 'ALICE', profile: bigProfile('ALICE'),
    history: `${JSON.stringify({ at: '20260701-080000', facts: LONG_WORDS, changelog: ['ALICE-ADDED long answer'] })}\n` });
  writeStore(path.join(tenant, 'bob'), { mark: 'BOB' });
  const { modules } = loadCompiledModules({ routes: 'routes/career-master-record-routes.js' }, { 'better-sqlite3': sqliteAdapter() });
  const router = createRouter();
  modules.routes.registerCareerMasterRecordRoutes(router);
  const sessions = { 'session=alice': 'alice', 'session=bob': 'bob', 'session=carol': 'carol' };
  ({ server, baseUrl } = await startServer(router, (headers) => sessions[headers.cookie]));
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  if (priorRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = priorRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

/** GET as a person (or nobody): the status, the raw body and its JSON. */
async function get(who, query = '') {
  const response = await fetch(`${baseUrl}/api/career-hunter/master-record${query}`, { headers: who ? { cookie: `session=${who}` } : {} });
  const raw = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes: raw.length, body: JSON.parse(raw.toString('utf8')) };
}

async function allPages(who) {
  const pages = [await get(who, '?page=1')];
  while (pages.at(-1).body.nextPage) pages.push(await get(who, `?page=${pages.at(-1).body.nextPage}`));
  return pages;
}

test('refused without a signed-in person, whole record and page alike', async () => {
  for (const query of ['', '?page=1']) assert.deepEqual(await get(null, query), { status: 401, bytes: 24, body: { error: 'unauthorized' } });
});

test('every page is at most 12 KB and the pages together are exactly the Markdown, each item once', async () => {
  const whole = await get('alice');
  assert.equal(whole.status, 200);
  assert.equal(whole.body.counts.bullets, 120); assert.equal(whole.body.counts.skills, 120);
  const pages = await allPages('alice');
  assert.ok(pages.length >= 4, `a big record takes several pages (read ${pages.length})`);
  pages.forEach((page, index) => {
    assert.equal(page.status, 200);
    assert.ok(page.bytes <= PAGE_LIMIT, `page ${index + 1} is ${page.bytes} bytes`);
    assert.deepEqual([page.body.page, page.body.pages, page.body.nextPage], [index + 1, pages.length, index + 1 < pages.length ? index + 2 : null]);
    assert.equal(page.body.revision, whole.body.revision);
    assert.deepEqual(page.body.counts, whole.body.counts);
    assert.equal(page.body.link, '/cockpit/?app=career-hunter&screen=career-master-record');
  });
  const text = pages.map((page) => page.body.text).join('');
  assert.equal(text, whole.body.markdown, 'nothing lost, nothing repeated, nothing reordered');
  for (let r = 1; r <= 3; r += 1) for (let b = 1; b <= 40; b += 1) {
    assert.equal(text.split(`[ALICE-R${r}-B${String(b).padStart(3, '0')}]`).length - 1, 1, `bullet R${r}-B${b} once`);
  }
  assert.ok(text.includes(LONG_WORDS.trim()), 'a history line longer than a page is split across pages and comes back whole');
  assert.ok(pages[0].body.text.startsWith('# Master record — ALICE Fixture'), 'page 1 starts with the counts');
});

test('a page number that is not a whole number from 1 is refused; a page past the end is 404', async () => {
  for (const query of ['?page=0', '?page=-1', '?page=abc', '?page=1.5', '?page=']) assert.equal((await get('alice', query)).status, 400, query);
  const pages = (await get('alice', '?page=1')).body.pages, beyond = await get('alice', `?page=${pages + 1}`);
  assert.equal(beyond.status, 404); assert.equal(beyond.body.pages, pages);
});

test('one person never sees another\'s record', async () => {
  const alice = JSON.stringify([await get('alice'), ...(await allPages('alice'))]);
  const bob = JSON.stringify([await get('bob'), ...(await allPages('bob'))]);
  assert.ok(alice.includes('ALICE-R1-B001') && !alice.includes('BOB'), 'Alice reads only Alice');
  assert.ok(bob.includes('[BOB-R1-B1]') && !bob.includes('ALICE'), 'Bob reads only Bob');
});

test('a person with no store gets an empty record, and no folder is made for them', async () => {
  const carol = await get('carol');
  assert.equal(carol.status, 200);
  assert.equal(carol.body.present, false);
  assert.match(carol.body.markdown, /You have not saved a résumé in Career yet/);
  assert.equal(fs.existsSync(path.join(tenant, 'carol')), false);
});
