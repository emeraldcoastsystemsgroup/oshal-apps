/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "there is no point having the career hunter bot .. every time i ask him to do something with my resume he cant ... i want one concierge for the entire app that can do everything that needs to be done in the app"). The manifest, the catalog and the personas as the kernel reads them: one bot answers a person and the worker is declared as the engine's worker, its persona text unchanged to the byte (the kernel hashes it into the scoring model identity); the concierge carries a tool for everything a person does in Career, each one calling a route the package serves and bound to exactly that route's permission (the kernel's own rule: it withholds a tool bound differently); the tool list fits the kernel's limits (64 route tools, eight names in Jarvis's catalog, one answer under 64 KiB); the concierge's persona names every tool, never sends the person to another assistant or another page, and is told that My résumé shows the main résumé. The administrator's employer search is checked through the shipped route. Made-up data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'), repo = path.resolve(root, '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [path.join(repo, 'scripts/toolchain')] }));
const bindings = require('./helpers/career-route-bindings.cjs');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const manifest = yaml.load(read('oshal-app.yaml')), catalog = yaml.load(read('authorization.yaml'));
const persona = name => yaml.load(read('personas', `${name}.yaml`));
const tools = manifest.tools, routeTools = tools.filter(tool => tool.executor?.executorType === 'api');
const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
const MOUNT = '/api/career-hunter';
// The digest of the worker's persona text on store main ba1067c7 (Career 1.61.2). The kernel hashes this text into
// the scoring model identity, so a change here makes every saved fit score read as another configuration's.
const WORKER_PERSONA_SHA256 = '4ab9cbacea5684c16f5b3bd6ac432a315916e0c0fe1bc3dc8c4138ba6ee39b06';

/** What a person does in Career, and the tool that does it. */
const PERSON_FACING = {
  'find jobs and read matches': ['career_database', 'career_job', 'career_score', 'career_market'],
  'saved jobs and what happened with them': ['career_jobs', 'career_save', 'career_job_update', 'career_job_track'],
  'prepare and send': ['career_promote', 'career_draft', 'career_documents', 'career_resume_save', 'career_preparation', 'career_preparation_set',
    'career_submission_review', 'career_submission_approve', 'career_submission_bind', 'career_submission_start'],
  'submission status': ['career_submissions', 'career_submission_sync', 'career_submission_answers', 'career_submission_cancel'],
  'the résumé document and work history': ['career_resume_read', 'career_resume_section', 'career_resume_patch', 'career_resume_undo', 'career_master_record'],
  'other experience and improving the résumé': ['career_experience_bank', 'career_experience_save', 'career_strengthen', 'career_strengthen_answer'],
  'interviews': ['career_interview', 'career_interview_prepare', 'career_interview_practice'],
  'companies and sources': ['career_targets', 'career_target_add', 'career_target_remove', 'career_companies', 'career_company_add',
    'career_company_remove', 'career_company_restore', 'career_company_board'],
  'settings': ['career_settings', 'career_titles_set', 'career_area_set', 'career_remote_only_set', 'career_digest', 'career_digest_set'],
  'recruiters': ['career_recruiters', 'career_recruiter_add', 'career_recruiter_update', 'career_recruiter_remove'],
};

/** A route tool's method and path as the kernel samples them: a placeholder segment takes a sample value. */
function call(tool) {
  const [method, target] = tool.executor.apiEndpoint.trim().split(' '), [pathname, query = ''] = target.split('?');
  const placeholders = [...target.matchAll(/\{input\.([A-Za-z_]+)\}/g)].map(match => match[1]);
  return { method, relative: pathname.replace(/\{input\.[A-Za-z_]+\}/g, 'tool-input').slice(MOUNT.length) || '/', pathname, query, placeholders };
}
/** The kernel's path rule (authorization_bindings.rs matches_path): equal segments, or a parameter with any value. */
function matches(pattern, value) {
  const want = pattern.split('/'), have = value.split('/');
  return want.length === have.length && want.every((part, n) => part === have[n] || (part.startsWith(':') && have[n] !== ''));
}

test('one bot answers a person, and the worker is declared as the engine\'s worker', () => {
  assert.equal(manifest.chatBot, 'career-concierge');
  assert.match(fs.readFileSync(path.join(repo, 'intelligent-career/oshal-app.yaml'), 'utf8'), /^chatBot: career-concierge$/m);
  const [front, worker] = ['career-concierge', 'career-hunter'].map(name => manifest.bots.find(bot => bot.name === name));
  assert.equal(front.posture, 'inline');
  assert.match(front.role, /the one assistant a person talks to/);
  assert.match(worker.role, /^engine worker: ranks and classifies jobs/);
  assert.match(worker.role, /not for conversation/);
  const browser = manifest.bots.find(bot => bot.name === 'career-submission-browser');
  assert.match(browser.role, /not for conversation/);
  for (const bot of [front, worker, browser]) assert.ok(bot.role.length <= 80, 'Jarvis\'s catalog shows 80 characters of a role');
  assert.equal(worker.routingKeywords, undefined);
  assert.ok(!worker.capabilities.some(name => /advice|coaching|search|status|strategy/.test(name)), 'the worker declares no conversation');
  const said = persona('career-hunter');
  assert.equal(said.routing_keywords, undefined, 'no routing words name the worker');
  assert.match(said.selector_descriptor, /Never selected for a person's request/);
  // The pane on every Career page names the concierge and nothing else.
  const pane = read('tools', 'career-concierge.mjs');
  assert.match(pane, /bot:'career-concierge'/);
  assert.doesNotMatch(pane, /bot:'career-hunter'/);
});

test('the worker\'s persona text is unchanged to the byte: it is part of the scoring model identity', () => {
  assert.equal(createHash('sha256').update(persona('career-hunter').perspective).digest('hex'), WORKER_PERSONA_SHA256,
    'changing this text makes every saved fit score read as made by another configuration and scored again; change it only on purpose');
});

test('the concierge has a tool for everything a person does in Career', () => {
  for (const [what, names] of Object.entries(PERSON_FACING)) {
    for (const name of names) assert.ok(byName[name], `${what}: ${name} is declared`);
  }
  const front = persona('career-concierge');
  for (const tool of routeTools) {
    assert.ok(tool.name in front.authorizations, `career-concierge lists ${tool.name}`);
    assert.equal(front.authorizations[tool.name], tool.requiresApproval ? 'ask' : 'auto', `${tool.name}: the persona and the manifest agree on approval`);
  }
});

test('every route tool calls a route the package serves, bound to exactly that route\'s permission', () => {
  const served = bindings.resolvedRoutes(), bound = Object.fromEntries(catalog.bindings.tools.map(item => [item.id, item.allOf]));
  const problems = [];
  for (const tool of routeTools) {
    const { method, relative, pathname } = call(tool);
    if (!pathname.startsWith(MOUNT + '/')) { problems.push(`${tool.name}: ${pathname} is outside Career's routes`); continue; }
    const routes = served.filter(row => row.method === method && row.mount === MOUNT && matches(row.pattern, relative));
    if (!routes.length) { problems.push(`${tool.name}: no route serves ${method} ${relative}`); continue; }
    const http = catalog.bindings.http.filter(item => item.method === method && matches(item.path, relative));
    if (http.length !== 1) { problems.push(`${tool.name}: ${method} ${relative} matches ${http.length} route bindings`); continue; }
    const sorted = list => [...(list || [])].sort().join(',');
    if (sorted(bound[tool.name]) !== sorted(http[0].allOf)) problems.push(`${tool.name}: bound to [${sorted(bound[tool.name])}], its route to [${sorted(http[0].allOf)}]`);
  }
  assert.deepEqual(problems, [], 'the kernel withholds a tool whose binding differs from its route');
  assert.deepEqual(catalog.bindings.tools.map(item => item.id).filter(id => !byName[id]), [], 'no binding names a tool that is gone');
});

test('the tools fit the kernel: 64 route tools, eight names for Jarvis, a required value for every path part', () => {
  assert.ok(routeTools.length <= 64, `the kernel offers at most 64 route tools (${routeTools.length})`);
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  // Jarvis's catalog shows the first eight display names, in 200 characters: the things a person asks for most.
  const eight = tools.slice(0, 8).map(tool => tool.displayName);
  assert.deepEqual(tools.slice(0, 8).map(tool => tool.name),
    ['career_database', 'career_resume_patch', 'career_jobs', 'career_job_update', 'career_draft', 'career_submission_review', 'career_settings', 'career_recruiters']);
  assert.ok(eight.join(', ').length <= 200, `all eight are shown (${eight.join(', ').length} characters)`);
  for (const tool of routeTools) {
    const { pathname, query, placeholders } = call(tool), required = tool.inputSchema?.required || [], properties = tool.inputSchema?.properties || {};
    assert.ok(typeof tool.description === 'string' && tool.description.length >= 40, `${tool.name} says what it is for (the kernel shows description and schema only)`);
    assert.ok(['auto', 'ask'].includes(tool.defaultAuthMode), `${tool.name} declares its approval mode`);
    assert.equal(tool.defaultAuthMode === 'ask', tool.requiresApproval === true, `${tool.name}: ask means a card`);
    for (const name of placeholders) assert.ok(name in properties, `${tool.name}: {input.${name}} is a declared input`);
    for (const name of [...pathname.matchAll(/\{input\.([A-Za-z_]+)\}/g)].map(match => match[1])) assert.ok(required.includes(name), `${tool.name}: the path part ${name} is required`);
    assert.doesNotMatch(query, /[{}][^=&]*=/, `${tool.name}: a query key is never a placeholder`);
    // An entry in a turn's prompt: the kernel counts its characters over three as tokens and shows 4096 tokens of tools.
    const entry = `- \`${tool.name}\`: ${tool.description} (schema: ${JSON.stringify(tool.inputSchema)})`;
    assert.ok(entry.length / 3 <= 700, `${tool.name}: its prompt entry is ${Math.ceil(entry.length / 3)} tokens`);
  }
});

test('what changes the résumé, spends or sends waits on a card; a list is bounded so its answer fits', () => {
  for (const name of ['career_resume_patch', 'career_resume_save', 'career_job_track', 'career_experience_save', 'career_strengthen_answer',
    'career_preparation_set', 'career_target_add', 'career_company_add', 'career_company_remove', 'career_company_restore', 'career_company_board',
    'career_recruiter_remove', 'career_submission_approve', 'career_submission_answers']) {
    assert.equal(byName[name].requiresApproval, true, `${name} is a card`);
    if (name !== 'career_resume_save' && name !== 'career_resume_patch') assert.ok(byName[name].cardText?.length > 20, `${name}'s card says what approving does`);
  }
  // The kernel hands the model nothing of an answer over 64 KiB, so a list is a small page the tool itself fixes.
  assert.match(byName.career_jobs.executor.apiEndpoint, /[?&]per=15$/);
  assert.match(byName.career_companies.executor.apiEndpoint, /\?search=1&limit=15&q=\{input\.q\}$/);
});

/** The kernel's own schema rules (crates/packages/src/tool_schema.rs): a tool whose schema breaks one is left out of every catalog. */
function schemaProblems(schema, where, out = []) {
  const UNSUPPORTED = ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'dependentRequired', 'dependentSchemas', 'contains',
    'propertyNames', 'minContains', 'maxContains', 'additionalItems', 'dependencies', 'contentSchema', 'unevaluatedProperties', 'unevaluatedItems',
    'prefixItems', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum'];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { out.push(`${where}: not a schema`); return out; }
  for (const key of UNSUPPORTED) if (key in schema) out.push(`${where}: ${key} is not supported`);
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(schema.type)) out.push(`${where}: needs a type`);
  for (const key of ['minimum', 'maximum']) if (key in schema && typeof schema[key] !== 'number') out.push(`${where}: ${key} is not a number`);
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (key in schema && !(Number.isInteger(schema[key]) && schema[key] >= 0)) out.push(`${where}: ${key} is not a count`);
  if ('format' in schema && schema.format !== 'uuid') out.push(`${where}: format ${schema.format} is not supported`);
  if ('enum' in schema && !(Array.isArray(schema.enum) && schema.enum.length)) out.push(`${where}: enum is empty`);
  if ('required' in schema && !(Array.isArray(schema.required) && schema.required.every(name => typeof name === 'string'))) out.push(`${where}: required is not a list of names`);
  for (const [name, child] of Object.entries(schema.properties || {})) schemaProblems(child, `${where}.${name}`, out);
  if (schema.items) schemaProblems(schema.items, `${where}[]`, out);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') schemaProblems(schema.additionalProperties, `${where}.*`, out);
  return out;
}
/** The kernel's rendering of a route tool's address (package_api_tools.rs render): a path part is always needed, a query part only when required. */
function renderProblem(tool, input) {
  const { pathname, query } = call(tool), required = tool.inputSchema?.required || [];
  for (const [, name] of pathname.matchAll(/\{input\.([A-Za-z_]+)\}/g)) if (input[name] === undefined) return `the path needs ${name}`;
  for (const pair of query.split('&').filter(Boolean)) {
    const name = (/^[^=]+=\{input\.([A-Za-z_]+)\}$/.exec(pair) || [])[1];
    if (name && required.includes(name) && input[name] === undefined) return `the query needs ${name}`;
  }
  return '';
}

test('every tool passes the kernel\'s own admission: a schema it accepts, and an address it can render', () => {
  const problems = routeTools.flatMap(tool => schemaProblems(tool.inputSchema, tool.name));
  assert.deepEqual(problems, [], 'the kernel leaves a tool out of every catalog for one unsupported schema word');
  for (const tool of routeTools) assert.ok(JSON.stringify(tool.inputSchema).length <= 16 * 1024, `${tool.name}: its schema is within 16 KiB`);
  // The kernel's store-coupled test (crates/oshald/src/package_api_tools.rs,
  // career_interview_and_submission_declarations_pass_native_route_admission) renders every Career route tool with
  // this one input, so no tool may need a query value this input does not carry.
  const KERNEL_TEST_INPUT = { postingId: 2360753, id: 'intent-one', field: 'overview', index: 0, offset: 0, page: 1, runId: '12345678-1234-4234-8234-123456789012' };
  const unrendered = routeTools.map(tool => [tool.name, renderProblem(tool, KERNEL_TEST_INPUT)]).filter(([, problem]) => problem).map(([name, problem]) => `${name}: ${problem}`);
  assert.deepEqual(unrendered, [], 'each tool renders with the kernel test\'s input');
});

test('the concierge names every tool, does the work itself and knows My résumé shows the main résumé', () => {
  const said = persona('career-concierge').perspective;
  const unnamed = tools.map(tool => tool.name).filter(name => name !== 'career_draft_oshal' && !said.includes(name));
  assert.deepEqual(unnamed, [], 'a tool the turn does not describe is still called by its name');
  assert.match(said, /the one assistant the signed-in person talks to/);
  assert.match(said, /Never tell the\s+person to go to another page to get something done/);
  assert.match(said, /never say you cannot see their résumé, their work history,\s+their jobs or their settings from the page they are on/);
  assert.doesNotMatch(said, /hand off to career-hunter/i);
  assert.doesNotMatch(said, /Hand off to career-hunter/);
  assert.match(said, /what you read with career_resume_section is what My résumé shows/);
  assert.match(said, /two cards from one reading/);
  assert.match(said, /read again and propose a corrected card rather than giving up/);
  assert.doesNotMatch(said, /separate (AI Office )?document/);
  // What the résumé status tool tells it about the document.
  const { resumeStatus } = require('../lib/career-resume-source.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-concierge-tools-'));
  try {
    fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify({ profile: { headline: 'Engineer' }, roles: [{ title: 'Engineer', org: 'Sample Co' }] }));
    const first = resumeStatus(dir);
    assert.equal(first.previousRevision, null, 'nothing to undo yet');
    assert.equal(first.jobs, 1);
    assert.doesNotMatch(first.documentNote, /separate|not included/);
    assert.match(first.documentNote, /What you read with the résumé tools is what My résumé shows/);
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.writeFileSync(path.join(dir, 'backups', 'career_db.20260101-000000-000001.json'), '{"profile":{}}');
    assert.equal(resumeStatus(dir).previousRevision, createHash('sha256').update('{"profile":{}}').digest('hex'), 'the version Undo puts back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.doesNotMatch(read('oshal-app.yaml').slice(read('oshal-app.yaml').indexOf('\ntools:\n')), /separate AI Office/);
});

/** The shipped companies route with its kernel-side dependencies as plain doubles and its own libraries real. */
function companyRoutes(db, owner) {
  const registered = new Map(), module = { exports: {} };
  const leaves = {
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) },
    '@/shared/middleware/authz': { isOperator: () => false },
    './career-user-store': { callerSub: req => req.sub, userPaths: () => ({ userDir: owner }),
      openCorpusDb: () => ({ prepare: sql => db.prepare(sql), close() {} }), openUserDb: () => { throw new Error('not used'); } },
    './career-engine-dispatch': { runCareerCliAwait: async () => ({ ok: true, out: '{}' }) },
    './career-engine-response': {},
    './career-surface-routes': { createCareerToolFileHandler: () => () => {} },
    '../lib/career-source-health': require('../lib/career-source-health'),
    '../lib/career-source-requests': require('../lib/career-source-requests'),
    '../lib/career-source-decisions': require('../lib/career-source-decisions'),
  };
  const before = process.env.CAREER_HUNTER_ADMIN_SUBS;
  process.env.CAREER_HUNTER_ADMIN_SUBS = 'fixture-admin';
  try {
    new Function('require', 'module', 'exports', read('routes', 'career-company-routes.js'))(
      id => { assert.ok(id in leaves, `dependency ${id}`); return leaves[id]; }, module, module.exports);
  } finally { if (before === undefined) delete process.env.CAREER_HUNTER_ADMIN_SUBS; else process.env.CAREER_HUNTER_ADMIN_SUBS = before; }
  const keep = (url, ...handlers) => registered.set(url, handlers);
  module.exports.registerCareerCompanyRoutes({ get: keep, post: keep }, {});
  return async (url, query, sub = 'fixture-admin', body = undefined) => {
    const out = { status: 200 }, res = { setHeader() {}, status(code) { out.status = code; return res; }, json(value) { out.body = value; } };
    const req = { sub, query, body, path: url, accepts: () => 'json' }, handlers = registered.get(url);
    await new Promise(done => { handlers[0](req, res, () => handlers[1](req, res)); setImmediate(done); });
    return out;
  };
}

test('career_companies: the administrator\'s list answers a name search with a few employers, and the page\'s own read is as before', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);`);
  const add = db.prepare('INSERT INTO corpus.companies VALUES(?,?,?,?,?,?,?)');
  for (let n = 1; n <= 40; n++) add.run(n, `Sample Freight ${n}`, 'greenhouse', 'sample' + n, 'https://careers.example/' + n, 'found', '[]');
  add.run(41, 'Harbor 100%_Test Works', 'lever', 'harbor', 'https://harbor.example/jobs', 'found', '[]');
  db.exec('INSERT INTO corpus.postings_corpus VALUES(7,1),(7,1),(3,1)');
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'career-companies-search-'));
  try {
    const get = companyRoutes(db, owner), tool = byName.career_companies;
    assert.equal(call(tool).pathname, '/api/career-hunter/companies-admin/list');
    const found = await get('/companies-admin/list', { q: 'freight', limit: '5' });
    assert.equal(found.status, 200);
    assert.deepEqual(found.body.companies.map(company => [company.id, company.active_jobs]), [[7, 2], [3, 1], [1, 0], [10, 0], [11, 0]], 'the busiest first, then by name');
    assert.equal(found.body.more, true, 'and it says there are more');
    assert.ok(found.body.companies[0].pull_health, 'each with how its last pull went');
    assert.ok(JSON.stringify(found.body).length < 8 * 1024, 'a page the concierge can read');
    const literal = await get('/companies-admin/list', { q: '100%_test', limit: '25' });
    assert.deepEqual(literal.body.companies.map(company => company.name), ['Harbor 100%_Test Works'], 'a percent sign or an underscore in a name is itself');
    assert.equal(literal.body.more, false);
    assert.equal((await get('/companies-admin/list', { q: 'freight', limit: '999' })).body.companies.length, 25, 'never more than 25');
    const whole = await get('/companies-admin/list', {});
    assert.equal(whole.body.companies.length, 41, 'the Companies page still reads every employer');
    assert.ok('sourceMaintenance' in whole.body && 'sourceChanges' in whole.body);
    assert.equal((await get('/companies-admin/list', { q: 'freight', limit: '5' }, 'someone-else')).status, 403, 'only an administrator');
    // The tool's own address: a search mark and a page of fifteen; with no name yet it answers none, never the whole list.
    const unnamed = await get('/companies-admin/list', { search: '1', limit: '15' });
    assert.deepEqual([unnamed.body.companies.length, unnamed.body.more], [0, false]);
    assert.match(unnamed.body.message, /Name the employer to look for/);
    assert.equal((await get('/companies-admin/list', { search: '1', limit: '15', q: 'freight' })).body.companies.length, 15);
  } finally { fs.rmSync(owner, { recursive: true, force: true }); }
});

test('career_company_add, _remove, _restore and _board: a tool\'s input arrives as the request body and is saved for the next pull', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);
    INSERT INTO corpus.companies VALUES(1,'Local College','pageup','reviewed','https://careers.example/','found','[]');
    INSERT INTO corpus.companies VALUES(2,'Gone Industries',NULL,NULL,'https://gone.example/jobs','removed','[]');`);
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'career-companies-body-')), egress = process.env.OSHAL_EGRESS;
  process.env.OSHAL_EGRESS = 'kernel';
  try {
    const post = companyRoutes(db, owner);
    for (const name of ['career_company_add', 'career_company_remove', 'career_company_restore', 'career_company_board']) {
      assert.doesNotMatch(byName[name].executor.apiEndpoint, /\?/, `${name} sends its input as the body`);
    }
    const added = await post('/companies-admin/add', {}, 'fixture-admin', { name: 'Harbor Sample Systems', url: 'https://harbor.example/careers' });
    assert.equal(added.status, 202, JSON.stringify(added.body));
    assert.match(added.body.message, /The next nightly pull adds Harbor Sample Systems/);
    assert.equal((await post('/companies-admin/remove', {}, 'fixture-admin', { companyId: 1 })).status, 202);
    assert.equal((await post('/companies-admin/restore', {}, 'fixture-admin', { companyId: 2 })).status, 202);
    assert.equal((await post('/companies-admin/seturl', {}, 'fixture-admin', { companyId: 1, board: 'https://boards.example/local-college' })).status, 202);
    assert.equal((await post('/companies-admin/add', {}, 'fixture-admin', { name: 'X', url: 'nope' })).status, 400, 'the same refusals as from the page');
    // The Companies page still sends its inputs in the address.
    assert.equal((await post('/companies-admin/remove', { companyId: '9' }, 'fixture-admin')).status, 404);
  } finally {
    if (egress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = egress;
    fs.rmSync(owner, { recursive: true, force: true });
  }
});
