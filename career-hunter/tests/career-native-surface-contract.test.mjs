/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard compiled native board aliases and
 *   truthful status counters against real SQLite; identity/logger/unused services are scoped doubles.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Admit only the named public community-source JSON alongside existing static assets, never generic JSON storage files.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Await the compiled stats response and retain known pipeline counts when the separate actionable-match scope is unavailable.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Every module script a shipped Career page imports from /static is served by the real route (1.60.8 shipped career-concierge.mjs, which the route refused, so the concierge never loaded); other extensions stay refused.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,writeFileSync,mkdtempSync,rmSync , readdirSync } from 'node:fs';
import {join}from 'node:path';import {tmpdir}from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

const ownerDir=mkdtempSync(join(tmpdir(),'career-native-surface-'));test.after(()=>rmSync(ownerDir,{recursive:true,force:true}));
let nextDb;
const { modules } = loadCompiledModules({
  board: 'routes/career-board-routes.js', surface: 'routes/career-surface-routes.js',
}, {
  './career-user-store': { callerSub: (req) => req.userSub, openUserDb: () => nextDb,careerTenant:()=> 'default',userPaths:()=>({userDir:ownerDir}) },
  './career-engine-runner':{nativeRunInProgress:async()=>false},
  './career-engine-dispatch': {},
});

/** Capture the actual compiled route callbacks without launching unrelated handlers. */
function routes(register) {
  const handlers = new Map();
  const router = { get: (route, handler) => handlers.set(route, handler), post() {}, delete() {} };
  register(router, { pool: {} });
  return handlers;
}

/** Record one route response. */
function response() {
  let finish;const done=new Promise(resolve=>{finish=resolve;});
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    done,json(body) { this.body = body;finish(this);return this; } };
}

test('compiled stats count the actual applied and interview vocabulary in SQLite', async () => {
  nextDb = new DatabaseSync(':memory:');
  nextDb.exec("CREATE TABLE user_signals(posting_id INTEGER PRIMARY KEY,status TEXT); INSERT INTO user_signals(status) VALUES ('applied'), ('applied'), ('interview'), ('offer'), (NULL)");
  writeFileSync(join(ownerDir,'job-board-state.json'),JSON.stringify({version:1,jobs:{2:{favorite:true}}}));
  const handler = routes(modules.board.registerCareerBoardRoutes).get('/jobs/stats');
  const reply = response();
  handler({ userSub: 'owned-career-fixture' }, reply);
  await reply.done;
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body.total, 5);
  assert.equal(reply.body.applied, 2);
  assert.equal(reply.body.interviewing, 1);
  assert.equal(reply.body.tracked, 4);
  assert.equal(reply.body.saved, 1, 'an original-owner saved star is separate from its current Applied stage');
  assert.equal(reply.body.matches, null, 'unavailable separate matching preferences cannot erase known application counts');
  assert.deepEqual(reply.body.byStatus.find((row) => row.status === 'interview'), { status: 'interview', n: 1 });
  nextDb = null;
  const absent = response();
  handler({ userSub: 'no-store' }, absent);
  await absent.done;
  assert.deepEqual(absent.body, { byStatus: [], total: 0, applied: 0, interviewing: 0,saved:0,queued:0,tracked:0,matches:0, empty: true });
  const anonymous = response();
  handler({}, anonymous);
  await anonymous.done;
  assert.equal(anonymous.statusCode, 401);
});

test('compiled root aliases serve the existing native board asset', () => {
  const handlers = routes(modules.surface.registerCareerSurfaceRoutes);
  const served = [];
  for (const route of ['', '/', '/board-native']) {
    const handler = handlers.get(route);
    assert.equal(typeof handler, 'function', `missing ${JSON.stringify(route)}`);
    handler({}, { setHeader() {}, sendFile(file) { served.push(file); } });
  }
  assert.equal(new Set(served).size, 1);
  assert.match(readFileSync(served[0], 'utf8'), /<title>[^<]*(?:Career|Job)/i);
});

test('compiled static route allowlists the public source directory without exposing other JSON files', () => {
  const handler = routes(modules.surface.registerCareerSurfaceRoutes).get('/static/:file');
  assert.equal(typeof handler, 'function');
  function serve(file) {
    const reply = { statusCode: 200, file: null, ended: false,
      status(code) { this.statusCode = code; return this; }, end() { this.ended = true; return this; },
      sendFile(file) { this.file = file; return this; } };
    handler({ params: { file } }, reply); return reply;
  }
  const sources = serve('career-local-sources.json');
  assert.equal(sources.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(readFileSync(sources.file, 'utf8')).sources));
  for (const file of ['career_db.json', 'linkedin-saved-jobs.json', 'config.json', 'career-local-sources.json.bak', 'secrets.JSON']) {
    const rejected = serve(file); assert.equal(rejected.statusCode, 404, file); assert.equal(rejected.file, null); assert.equal(rejected.ended, true);
  }
  assert.equal(serve('../career-local-sources.json').file, sources.file, 'basename normalization can only return the same public file');
  assert.match(serve('career-search-map.js').file, /career-search-map\.js$/);
  assert.match(serve('career-concierge.mjs').file, /career-concierge\.mjs$/, 'the concierge module the pages import is served');
  for (const file of ['career-concierge.mjs.bak', 'notes.mjsx', 'x.cjs']) assert.equal(serve(file).statusCode, 404, file);
  const tools = new URL('../tools/', import.meta.url);
  const imported = new Set();
  for (const page of readdirSync(tools).filter((name) => /\.(html|js|mjs)$/.test(name))) {
    for (const match of readFileSync(new URL(page, tools), 'utf8').matchAll(/\/api\/career-hunter\/static\/([A-Za-z0-9._-]+\.mjs)/g)) imported.add(match[1]);
  }
  assert.ok(imported.has('career-concierge.mjs'), 'the pages import the concierge module from /static');
  for (const file of imported) assert.ok(serve(file).file, `${file} is imported by a page and must be served`);
});
