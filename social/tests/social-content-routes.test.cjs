/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Workspace and Composer call only routes this package serves: every /api/social/content/* call the
 *   screens make has a handler in the compiled content router (the old platform's /api/content/* is gone natively); topics come
 *   from the declared credential-free feed hosts, filtered by focus and minus dismissed articles, and a GET writes nothing;
 *   drafting runs on the package's own social-writer; the manifest mounts the router, declares its migration and hosts, and the
 *   daily digest names a bot the package imports.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The digest's target must be the phase bot of exactly one workflow social owns (the kernel's for_bot
 *   rule a fire runs), not merely a declared or imported name: the imported communications-bot registered but every fire was refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const botCalls = [];
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, agentId, req) => { botCalls.push({ agentId, text: req.text }); return { response: ' drafted ' }; } },
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, parent, isMain);
};
const content = require(path.join(ROOT, 'routes', 'social-content-routes.js'));
Module._load = originalLoad;

/** A pool that records every statement and answers from a per-test row script. */
function recordingPool(answer = () => []) {
  const calls = [];
  return { calls, query: async (text, values) => { calls.push({ text: String(text), values }); return { rows: answer(String(text), values) }; } };
}

async function call(routes, key, body, query) {
  const sent = { status: 200, body: undefined };
  const res = { headersSent: false, status(c) { sent.status = c; return res; }, json(b) { sent.body = b; res.headersSent = true; return res; } };
  await routes[key]({ oidc: { user: { sub: 'person-1' } }, body: body || {}, query: query || {} }, res);
  return sent;
}

const RSS = `<rss><channel><item><title>AI agents reach the help desk &#8217;s queue</title><link>https://example.test/a</link><pubDate>${new Date().toUTCString()}</pubDate></item>
  <item><title>Gardening tips</title><link>https://example.test/b</link></item>
  <item><title>Agents again &amp; robotics</title><link>https://example.test/dismissed</link></item></channel></rss>`;

test('every content call the Workspace and Composer make has a handler in the compiled router', () => {
  const routes = content.createSocialContentRoutes({ pool: recordingPool() }).routes;
  const screens = ['social-workspace.html', 'social-composer.html'].map((f) => fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8')).join('\n');
  assert.doesNotMatch(screens, /['(]\/api\/content\//, 'no screen calls the old platform content routes');
  const called = new Set([...screens.matchAll(/\/api\/social\/content\/([a-z]+)/g)].map((m) => m[1]));
  assert.ok(called.size >= 8, `the screens call the content routes (${[...called]})`);
  for (const name of called) {
    assert.ok(routes[`GET /${name}`] || routes[`POST /${name}`], `/api/social/content/${name} has a handler`);
  }
});

test('topics come from the feeds, match the focus, skip dismissed articles and write nothing', async () => {
  const fetched = [];
  global.fetch = async (url) => { fetched.push(String(url)); return { ok: true, status: 200, text: async () => (String(url).includes('algolia') ? JSON.stringify({ hits: [] }) : RSS) }; };
  const pool = recordingPool((sql) => (sql.includes('FROM social_content_focus') ? [{ focus: 'ai agents, robotics' }] : sql.includes('dismissed = true') ? [{ url: 'https://example.test/dismissed' }] : []));
  const sent = await call(content.createSocialContentRoutes({ pool }).routes, 'GET /topics');
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.cards.map((c) => c.url), ['https://example.test/a']);
  assert.equal(sent.body.cards[0].title, 'AI agents reach the help desk ’s queue', 'numeric entities decode');
  assert.ok(pool.calls.every((c) => /^\s*SELECT/i.test(c.text)), 'a GET only reads');
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  for (const host of new Set(fetched.map((u) => new URL(u).hostname))) {
    assert.match(manifest, new RegExp(`- host: ${host.replace(/\./g, '\\.')}\\n`), `${host} is a declared egress host`);
  }
});

test('topics answer 502 only when every source fails, and short focus terms need a word boundary', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  const sent = await call(content.createSocialContentRoutes({ pool: recordingPool() }).routes, 'GET /topics');
  assert.equal(sent.status, 502);
  assert.deepEqual(content.matchedTerms('Pichai said again', ['ai']), []);
  assert.deepEqual(content.matchedTerms('An AI lab', ['ai']), ['ai']);
  assert.deepEqual(content.focusTerms(''), content.DEFAULT_FOCUS);
});

test('preferences, dismissals and saved drafts are the caller\'s own rows', async () => {
  const pool = recordingPool((sql) => (sql.includes('FROM social_content_drafts') ? [{ draft_id: 'd1', draft: 'x' }] : []));
  const routes = content.createSocialContentRoutes({ pool }).routes;
  assert.deepEqual((await call(routes, 'POST /focus', { focus: ' ai ' })).body, { ok: true, focus: 'ai' });
  assert.deepEqual((await call(routes, 'POST /settings', { emailSocialScan: true })).body, { ok: true, emailSocialScan: true });
  assert.equal((await call(routes, 'POST /dismiss', {})).status, 400);
  assert.deepEqual((await call(routes, 'POST /dismiss', { url: 'https://example.test/a' })).body, { ok: true });
  assert.equal((await call(routes, 'POST /drafts', { draft: ' ' })).status, 400);
  assert.deepEqual((await call(routes, 'POST /drafts', { topic: 't', draft: 'body' })).body, { ok: true });
  assert.deepEqual((await call(routes, 'GET /drafts')).body, { drafts: [{ draft_id: 'd1', draft: 'x' }] });
  for (const c of pool.calls) assert.equal(c.values[0], 'person-1', `${c.text.slice(0, 40)} is keyed to the caller`);
});

test('drafting, refining and notes run on the package\'s own social-writer', async () => {
  botCalls.length = 0;
  const routes = content.createSocialContentRoutes({ pool: recordingPool() }).routes;
  assert.deepEqual((await call(routes, 'POST /draft', { topic: 'Article', url: 'https://example.test/a' })).body, { draft: 'drafted' });
  assert.deepEqual((await call(routes, 'POST /refine', { draft: 'd', instruction: 'shorter' })).body, { draft: 'drafted' });
  assert.deepEqual((await call(routes, 'POST /note', { subject: 'Ada started a new job' })).body, { note: 'drafted' });
  assert.equal((await call(routes, 'POST /draft', {})).status, 400);
  assert.deepEqual([...new Set(botCalls.map((c) => c.agentId))], ['a0000000-0000-0000-0000-000000000040']);
  assert.match(botCalls[0].text, /https:\/\/example\.test\/a/);
  const social = fs.readFileSync(path.join(ROOT, 'routes', 'social-routes.js'), 'utf8');
  assert.match(social, /const COMMS_BOT_AGENT_ID = 'a0000000-0000-0000-0000-000000000040';/, 'POST /draft drafts on the own bot too');
});

test('the manifest mounts the router and its store, and the digest names the bot of exactly one owned workflow', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /module: routes\/social-content-routes\.js\n\s+factory: createSocialContentRoutes\n\s+mountPath: \/api\/social\/content/);
  assert.match(manifest, /^migrations:\n {2}- migrations\/001-social-content\.sql$/m);
  const digest = manifest.slice(manifest.indexOf('- id: social-daily-digest'), manifest.indexOf('\nbots:'));
  const target = (digest.match(/targetAgent: (\S+)/) || [])[1];
  assert.ok(target, 'the digest names a target');
  // A fire runs the package's own workflow whose phase bot is the target (schedule_resolution::for_bot): an agent id resolves
  // to its declared bot's name, and exactly one workflow this package owns must run that bot, or every fire is refused
  // WorkflowNotLoaded. A bot that is only imported (communications-bot) runs another package's workflow, never this one's.
  const declared = new Map([...manifest.matchAll(/^\s+- agentId: (\S+)\n\s+name: (\S+)/gm)].map((m) => [m[1], m[2]]));
  const bot = declared.get(target) || target;
  assert.ok(declared.has(target) || [...declared.values()].includes(target), `${target} is a bot social declares`);
  const workflows = [...manifest.matchAll(/^workflows?:\n((?:[ \t]+.*\n|\n)+)/gm)].flatMap((m) => m[1].split(/^ {2}- /m));
  const owning = workflows.filter((block) => [...block.matchAll(/(?:workerBot|reviewerBot|bot): (\S+)/g)].some((m) => m[1] === bot));
  assert.equal(owning.length, 1, `exactly one social workflow runs ${bot}`);
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', '001-social-content.sql'), 'utf8');
  for (const table of ['social_content_focus', 'social_content_settings', 'social_content_articles', 'social_content_drafts']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});
