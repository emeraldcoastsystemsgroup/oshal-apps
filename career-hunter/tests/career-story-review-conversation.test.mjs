/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the ADR-141 D7 review conversation end to end. A signed-in user answers the shipped Strengthen story card role by role until it reads "Every role has a story"; every role then holds a verbatim story citing one of its own bullets and readiness reports 3 of 3. Every turn runs through the COMPILED story and readiness routes and the REAL engine dispatch and runner. career-engine-dispatch provides lease admission and then the caller's Firecrawl brokerage query. career-engine-runner provides the inherited-env allowlist, run-lock adoption, engine-run registration, the runner-minted rail entries and the vendor-login sandbox. Then bin/oshal-jobhunter.js runs the Python `stories` verb against the profile file on disk. A concurrent turn is refused with 503 before brokerage, and the lease is released afterwards. Anonymous callers get 401 with no brokerage and no engine run, and a second user reaches only their own store. Scoped doubles: the page DOM (a markup-driven element map), the Express router and JSON body parser (node:http), the OIDC session (a cookie-to-subject map), the logger, the kernel trusted-service decoder (never trusted here), the unused SQLite driver, the Postgres pool and the kernel token decryptor. The pool answers the Firecrawl brokerage query with no row. The decryptor is a tripwire that the empty brokerage never reaches. No career-hunter suite runs that brokerage query against a real Postgres; career-no-sync-api.test.mjs covers its row handling over a doubled pool. No rail service secret is set, so the engine has no provider, and the rail URL the runner mints points at this fixture listener, which records any request to it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): the compiled dispatch now reads the caller's verified issuer from the kernel request-identity module, so that module is doubled here (the AsyncLocalStorage mirror in tests/helpers/request-identity-stub.mjs); with no verified issuer the runner registers the run and mints no rail entries, which is what a fixture with no rail service secret already asserted.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { requestIdentity } from './helpers/request-identity-stub.mjs';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const surfacePath = path.join(packageRoot, 'tools', 'career-strengthen.html');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'career-story-review-'));
const storeRoot = path.join(fixtureRoot, 'store');
const OWNER = 'story-owner';
const OTHER = 'story-other';
const SESSIONS = new Map([['session-owner', OWNER], ['session-other', OTHER]]);
const ENGINE_TIMEOUT_MS = 60_000;
/** Process settings the runner reads or hands to the engine child; each is restored after the suite. */
const RUNNER_ENV_KEYS = [
  'JOBHUNTER_STORE_ROOT', 'JOBHUNTER_PYTHON', 'JOBHUNTER_CLI', 'JOBHUNTER_STORE', 'DATABASE_URL',
  'SWARM_SERVICE_SECRET', 'PORT', 'CAREER_HUNTER_CLI_TIMEOUT_MS',
];
const savedEnv = Object.fromEntries(RUNNER_ENV_KEYS.map((key) => [key, process.env[key]]));

/** The shape build_from_resume leaves behind: roles with their own bullets and no stories yet. */
const ROLES = [
  { title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null, deliverables: [
    'Cut deploy time from 40 minutes to 6 by rebuilding the release pipeline',
    'Grew the platform team from 4 to 11 engineers',
  ] },
  { title: 'Site Reliability Engineer', org: 'Beta Corp', start: '2015-05', end: '2018-12', deliverables: [
    'Ran the on-call rotation for 30 production services',
    'Moved metrics and alerting onto Prometheus with paging budgets',
  ] },
  { title: 'Systems Administrator', org: 'Gamma Labs', start: '2011-03', end: '2015-04', deliverables: [
    'Automated server provisioning with configuration scripts',
  ] },
];
/** One answer per role, each in the candidate's own words; role 1 speaks to its SECOND bullet. */
const ANSWERS = [
  'Our release pipeline rebuilt every image; I added layer caching and deploy time fell from 40 minutes to 6.',
  'Alerting paged on noise, so I moved metrics onto Prometheus and gave each service a paging budget.',
  'Provisioning took a day by hand; I wrote configuration scripts that built a server in twenty minutes.',
];

/** Every query the dispatch's credential brokerage sends, and every decrypt it attempts. */
const brokerQueries = [];
let decryptCalls = 0;
/** Requests the engine sends to the rail URL the runner minted (this fixture listener). */
const railRequests = [];
let server;
let baseUrl;
let routes;

/** The Postgres pool double: it records the brokerage query and has no Firecrawl row for anyone. */
const brokerPool = {
  async query(config, params) {
    const text = typeof config === 'string' ? config : config.text;
    const values = typeof config === 'string' ? params : config.values;
    brokerQueries.push({ text: String(text), values: [...(values || [])] });
    return { rows: [] };
  },
};

/** Point the runner and its engine child at the fixture store, the packaged launcher and no provider. */
function isolateRunnerEnv() {
  process.env.JOBHUNTER_STORE_ROOT = storeRoot;
  process.env.JOBHUNTER_PYTHON = python;
  process.env.CAREER_HUNTER_CLI_TIMEOUT_MS = String(ENGINE_TIMEOUT_MS);
  // The runner copies these into the child from its allowlist: no launcher override, no live
  // datastore, and no rail secret, so the engine's only model path is closed and answers stay verbatim.
  for (const key of ['JOBHUNTER_CLI', 'JOBHUNTER_STORE', 'DATABASE_URL', 'SWARM_SERVICE_SECRET', 'PORT']) delete process.env[key];
}

/** Load the compiled modules with only the kernel leaves outside this boundary doubled. */
function loadCompiledRoutes() {
  const originalLoad = Module._load;
  Module._load = function loadWithKernelLeaves(request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
    if (request === '@/shared/services/database/request-identity') return requestIdentity;
    // Mirrors src/app/routes/caller-sub.ts: the OIDC session's subject, or nobody.
    if (request === '@/app/routes/caller-sub') return { callerSub: (req) => (req.oidc?.user?.sub ? String(req.oidc.user.sub) : null) };
    if (request === '@/app/routes/connector-token-crypto') {
      return { decryptToken: async () => { decryptCalls += 1; throw new Error('tripwire: there is no Firecrawl row to decrypt'); } };
    }
    if (request === 'better-sqlite3') return function unusedSqlite() { throw new Error('the review never opens SQLite'); };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return {
      stories: require('../routes/career-stories-routes.js'),
      readiness: require('../routes/career-readiness.js'),
      userStore: require('../routes/career-user-store.js'),
      runner: require('../routes/career-engine-runner.js'),
      engineRuns: require('../lib/career-engine-runs.js'),
    };
  } finally {
    Module._load = originalLoad;
  }
}

/** A router that records handlers the way express.Router() registers them. */
function createRouter() {
  const handlers = new Map();
  const add = (method) => (routePath, ...callbacks) => { handlers.set(`${method} ${routePath}`, callbacks.at(-1)); };
  return { handlers, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}

/** Parse the JSON body the package mount's body parser would hand the route. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8').on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

/** The OIDC session a signed-in browser carries; no cookie, no subject. */
function sessionFor(req) {
  const match = /(?:^|;\s*)appSession=([^;]+)/.exec(req.headers.cookie || '');
  const sub = match ? SESSIONS.get(match[1]) : undefined;
  return sub ? { user: { sub } } : undefined;
}

/** Serve the package routes at /api/career-hunter over loopback HTTP; the rail path is recorded, not served. */
async function startServer(router) {
  const listener = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === routes.engineRuns.RAIL_PATH) railRequests.push({ method: req.method, headers: req.headers });
    const handler = router.handlers.get(`${req.method} ${url.pathname.replace(/^\/api\/career-hunter/, '')}`);
    const reply = {
      statusCode: 200,
      status(code) { reply.statusCode = code; return reply; },
      json(body) { res.writeHead(reply.statusCode, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return reply; },
    };
    if (!handler) { reply.status(404).json({ error: 'not mounted in this fixture' }); return; }
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    handler({ method: req.method, path: url.pathname, headers: req.headers, body, oidc: sessionFor(req) }, reply);
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  return listener;
}

/** A DOM double driven by the markup the page writes: every id in written HTML becomes an element. */
function createDocument(staticIds) {
  const nodes = new Map();
  const within = (node, parent) => { for (let n = node.owner; n; n = n.owner) if (n === parent) return true; return false; };
  const make = (id, tagName, attrs, owner) => {
    const node = { id, tagName, attrs, owner, value: '', textContent: '', className: '', disabled: 'disabled' in attrs, markup: '' };
    Object.defineProperty(node, 'innerHTML', {
      get: () => node.markup,
      set: (html) => {
        node.markup = String(html);
        for (const [key, child] of nodes) if (within(child, node)) nodes.delete(key);
        for (const tag of node.markup.matchAll(/<([a-z]+)\b([^>]*)>/gi)) {
          const tagAttrs = Object.fromEntries([...tag[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
          if (tagAttrs.id) make(tagAttrs.id, tag[1].toLowerCase(), tagAttrs, node);
        }
      },
    });
    nodes.set(id, node);
    return node;
  };
  for (const id of staticIds) make(id, 'div', {}, null);
  return { getElementById: (id) => nodes.get(id) || null };
}

/** Run the shipped Strengthen script as a browser would, signed in with the given session. */
function openStrengthen(session) {
  const source = readFileSync(surfacePath, 'utf8').match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(source, 'the Strengthen surface carries its inline script');
  const document = createDocument(['stories', 'added', 'list', 'toast', 'prog']);
  const requests = [];
  const context = vm.createContext({
    document,
    fetch: (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET', body: init.body });
      const headers = { ...(init.headers || {}), cookie: `appSession=${session}` };
      return fetch(new URL(url, baseUrl), { ...init, headers });
    },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
  });
  vm.runInContext(source[1], context, { filename: 'career-strengthen.html' });
  return { context, document, requests };
}

/** Wait for a page condition the surface reaches asynchronously. */
async function until(predicate, label, timeoutMs = ENGINE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Click an element the page rendered by running its inline handler, as the browser does. */
function click(page, id) {
  const element = page.document.getElementById(id);
  assert.ok(element, `#${id} is on the page`);
  assert.equal(element.disabled, false, `#${id} is enabled`);
  assert.ok(element.attrs.onclick, `#${id} carries a click handler`);
  return vm.runInContext(element.attrs.onclick, page.context);
}

/** A refusal answers at once; an anonymous call still waiting after this has reached the engine path. */
const ANONYMOUS_REPLY_MS = 5_000;

/** Call a package route over HTTP as a browser session (or as nobody, bounded). */
async function call(method, route, session, body) {
  const headers = session ? { cookie: `appSession=${session}` } : {};
  if (body) headers['content-type'] = 'application/json';
  const signal = session ? undefined : AbortSignal.timeout(ANONYMOUS_REPLY_MS);
  const response = await fetch(`${baseUrl}/api/career-hunter${route}`, { method, headers, body: body && JSON.stringify(body), signal });
  return { status: response.status, body: await response.json() };
}

const profilePath = (sub) => path.join(routes.userStore.userPaths(sub).userDir, 'career_db.json');
const storiesHtml = (page) => page.document.getElementById('stories').innerHTML;
const runsOf = (sub) => routes.engineRuns.listEngineRuns(sub);

/** The engine runs and brokerage queries a block of work caused, newest runs first. */
async function observe(work) {
  const runs = { [OWNER]: runsOf(OWNER).length, [OTHER]: runsOf(OTHER).length };
  const queries = brokerQueries.length;
  const result = await work();
  return {
    result,
    runs: (sub) => runsOf(sub).slice(0, runsOf(sub).length - runs[sub]),
    queries: brokerQueries.slice(queries),
  };
}

/** Each run went through the real runner to a settled `stories` child, brokered for its own caller. */
function assertEngineTurns(observed, sub, count) {
  const runs = observed.runs(sub);
  assert.equal(runs.length, count, `${count} engine runs for ${sub}`);
  for (const run of runs) assert.deepEqual([run.verb, run.state], ['stories', 'succeeded'], `run ${run.runId} settled`);
  const own = observed.queries.filter((query) => query.values[0] === sub);
  assert.equal(own.length, count, 'every engine run was preceded by one brokerage query for its caller');
  for (const query of own) assert.match(query.text, /provider = 'firecrawl'/, 'the brokerage selects only the Firecrawl row');
}

before(async () => {
  isolateRunnerEnv();
  routes = loadCompiledRoutes();
  const ownerDir = routes.userStore.userPaths(OWNER).userDir;
  mkdirSync(ownerDir, { recursive: true });
  writeFileSync(path.join(ownerDir, 'career_db.json'), JSON.stringify({ profile: { name: 'Sample Candidate' }, roles: ROLES }, null, 2));
  const router = createRouter();
  routes.stories.registerCareerStoryRoutes(router, { pool: brokerPool });
  routes.readiness.registerCareerReadinessRoutes(router);
  server = await startServer(router);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // The runner mints each child's rail URL from PORT: it names this listener, never a live one.
  process.env.PORT = String(server.address().port);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test('the review runs through the packaged launcher', () => {
  assert.equal(routes.runner.resolveEngineCli(), binPath, 'the runner spawns bin/oshal-jobhunter.js');
});

test('an empty answer never leaves the page', { timeout: 120_000 }, async () => {
  const page = openStrengthen('session-owner');
  await until(() => storiesHtml(page).includes('Your stories'), 'the story card');
  const posts = page.requests.filter((r) => r.method === 'POST').length;
  await click(page, 'story-save');
  assert.equal(page.document.getElementById('toast').textContent, 'Tell it in your own words first');
  assert.equal(page.requests.filter((r) => r.method === 'POST').length, posts, 'a blank answer is never posted');
});

/** Answer the open card role by role, checking the header and question before each turn. */
async function answerEveryRole(page) {
  for (let turn = 0; turn < ROLES.length; turn += 1) {
    const html = storiesHtml(page);
    assert.match(html, new RegExp(`Your stories — ${turn} of ${ROLES.length} roles`), `turn ${turn} counts ${turn} done`);
    assert.ok(html.includes(ROLES[turn].deliverables[0]), `turn ${turn} asks about ${ROLES[turn].title}'s own lead bullet`);
    page.document.getElementById('story-ta').value = ANSWERS[turn];
    await click(page, 'story-save');
    assert.match(page.document.getElementById('toast').textContent, new RegExp(`Story saved to ${ROLES[turn].title} at ${ROLES[turn].org}`));
  }
}

test('a signed-in user answers Strengthen role by role until every role has a story', { timeout: 300_000 }, async () => {
  const before = await call('GET', '/readiness', 'session-owner');
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.stories, { ready: false, roles: 3, withStory: 0, detail: '0 of 3 roles have a story.' });

  const page = openStrengthen('session-owner');
  const observed = await observe(async () => {
    await until(() => storiesHtml(page).includes('Your stories'), 'the story card');
    await answerEveryRole(page);
  });
  const done = storiesHtml(page);
  assert.match(done, /Your stories — 3 of 3 roles/);
  assert.match(done, /Every role has a story\./, 'the card closes the review');
  assert.equal(page.document.getElementById('story-ta'), null, 'no question is left to answer');
  const posted = page.requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body).role);
  assert.deepEqual(posted, [0, 1, 2], 'each answer went to the role the card asked about');
  assertEngineTurns(observed, OWNER, page.requests.filter((r) => r.url.includes('/stories')).length);

  const saved = JSON.parse(readFileSync(profilePath(OWNER), 'utf8'));
  assert.equal(saved.roles.length, ROLES.length);
  saved.roles.forEach((role, index) => {
    assert.equal(role.stories?.length, 1, `${role.title} holds exactly one story`);
    const [story] = role.stories;
    assert.ok(ROLES[index].deliverables.includes(story.bullet), `${role.title}'s story cites one of its own bullets`);
    assert.equal(story.story, ANSWERS[index], 'with no provider the story is the answer, verbatim');
    assert.equal(story.source, 'verbatim');
  });
  assert.equal(saved.roles[1].stories[0].bullet, ROLES[1].deliverables[1], 'the story cites the bullet the answer speaks to');

  const ready = await call('GET', '/readiness', 'session-owner');
  assert.deepEqual(ready.body.stories, { ready: true, roles: 3, withStory: 3, detail: '3 of 3 roles have a story.' });
  const state = await call('GET', '/stories', 'session-owner');
  assert.deepEqual([state.body.complete, state.body.withStory, state.body.next], [true, 3, null]);
  assert.equal(railRequests.length, 0, 'with no rail secret the engine never called the rail');
  assert.equal(decryptCalls, 0, 'no Firecrawl row, nothing decrypted');
});

test('one review turn at a time: a concurrent turn is refused before brokerage and the lease is released', { timeout: 120_000 }, async () => {
  const observed = await observe(() => Promise.all([
    call('GET', '/stories', 'session-owner'),
    call('GET', '/stories', 'session-owner'),
  ]));
  const statuses = observed.result.map((reply) => reply.status).sort();
  assert.deepEqual(statuses, [200, 503], 'the store lease admits one turn');
  const refused = observed.result.find((reply) => reply.status === 503);
  assert.equal(refused.body.error, 'a review turn is already running');
  assertEngineTurns(observed, OWNER, 1);
  assert.equal(observed.queries.length, 1, 'the refused turn never reached credential brokerage');
  const next = await call('GET', '/stories', 'session-owner');
  assert.equal(next.status, 200, 'the lease was released when the admitted turn settled');
});

test('an anonymous caller is refused before anything runs', { timeout: 60_000 }, async () => {
  const snapshot = readFileSync(profilePath(OWNER), 'utf8');
  const observed = await observe(async () => {
    assert.equal((await call('GET', '/stories')).status, 401);
    assert.equal((await call('POST', '/stories/answer', undefined, { role: 0, response: 'Not signed in.' })).status, 401);
    assert.equal((await call('GET', '/readiness')).status, 401);
  });
  assert.deepEqual(observed.queries, [], 'no credential brokerage for an anonymous caller');
  assert.deepEqual([observed.runs(OWNER), observed.runs(OTHER)], [[], []], 'no engine run started');
  assert.equal(readFileSync(profilePath(OWNER), 'utf8'), snapshot, 'the profile is untouched');
});

test('a second signed-in user reaches only their own store', { timeout: 120_000 }, async () => {
  const snapshot = readFileSync(profilePath(OWNER), 'utf8');
  const observed = await observe(async () => {
    const state = await call('GET', '/stories', 'session-other');
    assert.equal(state.status, 200);
    assert.deepEqual([state.body.total, state.body.complete, state.body.next], [0, false, null], 'the other user sees no roles');
    const answer = await call('POST', '/stories/answer', 'session-other', { role: 0, response: 'Writing into someone else\'s role.' });
    assert.deepEqual([answer.status, answer.body.error], [400, 'no role at index 0']);
  });
  assertEngineTurns(observed, OTHER, 2);
  assert.deepEqual(observed.runs(OWNER), [], 'nothing ran as the owner');
  const ready = await call('GET', '/readiness', 'session-other');
  assert.equal(ready.body.stories.roles, 0);
  assert.match(ready.body.stories.detail, /Index a resume first/);
  assert.equal(readFileSync(profilePath(OWNER), 'utf8'), snapshot, 'the owner\'s profile is untouched');
});
