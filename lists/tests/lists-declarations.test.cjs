/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 declarations held to what the package does: every concierge tool is one of the routes the real router registers and every action route has a tool (the screen and the concierge can do the same things); exactly the three changes that cannot be undone are cards; no name travels in an address; the tool schemas use only what the kernel's validator accepts; the description says what the application does and that the grocery list is Shopping's; the persona knows every tool; the screen takes its colours from the portal theme and writes server text as text; the migration and the statements keep to the shapes the native kernel runs; the Test Lab catalog names every suite.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE, dependency, load } = require('./support/fixture.cjs');

const yaml = dependency('js-yaml');
const read = (...parts) => fs.readFileSync(path.join(PACKAGE, ...parts), 'utf8');
const manifest = yaml.load(read('oshal-app.yaml'));
const persona = yaml.load(read('personas', 'lists-concierge.yaml'));
const HELD = ['lists-clear-done', 'lists-delete', 'lists-remove-item'];

/** @description The action routes the real router registers, as 'METHOD /path'. @returns {Promise<string[]>} Sorted. */
async function registered() {
  const { createListsRoutes } = await load('lists-routes.mjs');
  const router = createListsRoutes({ pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: PACKAGE });
  return router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`)).sort();
}

test('the application is declared as a person-scoped process package with its own inline concierge', () => {
  assert.deepEqual([manifest.name, manifest.suite, manifest.runtime, manifest.scope, manifest.status], ['lists', 'ai-productivity', 'process', 'person', 'active']);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const bot = manifest.bots.find((entry) => entry.name === manifest.chatBot);
  assert.deepEqual([manifest.chatBot, bot.posture, bot.persona], ['lists-concierge', 'inline', 'personas/lists-concierge.yaml']);
  assert.deepEqual([persona.name, persona.agent_id, persona.runtime.harness], ['lists-concierge', bot.agentId, 'claude-code']);
  assert.match(persona.perspective, /```tool_call/);
  assert.ok(bot.routingKeywords.length > 0, 'the store asks every application with tools for its own words');
  assert.deepEqual(manifest.dependencies.required, { apps: [], tools: [], connectors: [] });
  assert.deepEqual(manifest.dependencies.optional.apps, ['purchasing'], 'Shopping is only ever optional');
  assert.equal(manifest.authorization, undefined, 'no catalog: the kernel tiers decide (viewer reads, editor writes)');
});

test('every tool is a route the real router registers, and every action route has a tool', async () => {
  const routes = await registered();
  const called = manifest.tools.map((tool) => {
    assert.equal(tool.executor.executorType, 'api', tool.name);
    const [method, target] = tool.executor.apiEndpoint.split(' ');
    assert.ok(target.startsWith('/api/lists/'), `${tool.name} stays inside the package mount`);
    return `${method} ${target.slice('/api/lists'.length).split('?')[0]}`;
  });
  for (const route of called) assert.ok(routes.includes(route), `${route} is registered`);
  const actions = routes.filter((route) => !/ \/(app|static\/:file)$/.test(route));
  assert.deepEqual([...new Set(called)].sort(), actions, 'the screen and the concierge have the same actions');
  assert.equal(manifest.tools.length, 13);
});

test('reads are GETs, changes are POSTs, and no name travels in an address', () => {
  for (const tool of manifest.tools) {
    const [method, target] = tool.executor.apiEndpoint.split(' ');
    const [route, query = ''] = target.split('?');
    assert.doesNotMatch(route, /[{}]/, `${tool.name}: a list or item name is never a path segment`);
    assert.ok(['GET', 'POST'].includes(method), tool.name);
    if (method === 'POST') assert.equal(query, '', `${tool.name}: a change carries its names in the body`);
    if (method === 'GET') assert.equal(tool.requiresApproval, false, `${tool.name}: a read is never held`);
    assert.equal(tool.defaultAuthMode, 'auto', tool.name);
  }
  assert.equal(manifest.tools.find((tool) => tool.name === 'lists-show').executor.apiEndpoint, 'GET /api/lists/show?list={input.list}');
});

test('exactly the three changes that cannot be undone are cards, each with a sentence for the person', () => {
  const held = manifest.tools.filter((tool) => tool.requiresApproval === true).map((tool) => tool.name).sort();
  assert.deepEqual(held, HELD);
  for (const name of HELD) {
    const tool = manifest.tools.find((entry) => entry.name === name);
    assert.match(tool.cardText, /cannot be undone\.$/, name);
    assert.match(tool.description, /Held for the person's approval/, name);
  }
  for (const tool of manifest.tools.filter((entry) => !HELD.includes(entry.name))) assert.equal(tool.requiresApproval, false, `${tool.name} runs at once`);
});

test('tool schemas use only what the kernel validator accepts, and name what the routes read', () => {
  const allowed = new Set(['type', 'properties', 'required', 'items', 'description', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'enum', 'pattern']);
  const walk = (schema, where) => {
    assert.equal(typeof schema.type, 'string', `${where}: one type, never a list of types`);
    for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `${where}: ${key}`);
    if (schema.pattern) assert.doesNotMatch(schema.pattern.replace(/\[[^\]]*\]/g, ''), /\./, `${where}: no wildcard dot`);
    for (const [name, child] of Object.entries(schema.properties || {})) walk(child, `${where}.${name}`);
    if (schema.items) walk(schema.items, `${where}[]`);
  };
  for (const tool of manifest.tools) {
    walk(tool.inputSchema, tool.name);
    assert.ok(Buffer.byteLength(JSON.stringify(tool.inputSchema)) < 16 * 1024, tool.name);
    assert.match(tool.name, /^lists-[a-z-]+$/);
    if (tool.name !== 'lists-all' && tool.name !== 'lists-create') assert.ok(tool.inputSchema.required.includes('list'), `${tool.name} names its list`);
  }
});

test('the description says what the application does, and that the grocery list is Shopping\'s', () => {
  const text = String(manifest.description).split(/\s+/).join(' ');
  assert.ok(text.length <= 1500, 'the catalog shows at most 1,500 characters');
  for (const words of [/Make any list and keep track of it/, /to-do list/, /packing list/, /gift ideas/, /tick items off/, /what is on a list/, /which lists you have/]) assert.match(text, words);
  assert.match(text, /Your grocery and shopping list is not kept here: Shopping keeps it and makes the grocery order from it/);
  assert.doesNotMatch(text.replace(/Your grocery and shopping list is not kept here.*$/, ''), /grocer|shopping|buy/i, 'nothing else in it reads like a shopping list');
});

test('the persona knows every tool, the three cards and where the grocery list lives', () => {
  for (const tool of manifest.tools) assert.ok(persona.perspective.includes(tool.name), `${tool.name} is in the persona`);
  assert.match(persona.perspective, /lists-delete, lists-remove-item and lists-clear-done make a card/);
  assert.match(persona.perspective, /kept_by_shopping/);
  assert.match(persona.perspective, /Never make a second grocery list here/);
  assert.match(persona.perspective, /never ask "shall I\s+add it\?" first/);
});

test('the screen takes its colours from the portal theme and writes server text as text', () => {
  const html = read('tools', 'lists.html'), css = read('tools', 'lists.css'), js = read('tools', 'lists.js');
  assert.match(html, /<html lang="en" data-theme="midnight">/);
  assert.ok(html.indexOf('/shared/ui/css/surface-themes.css') < html.indexOf('/shared/ui/js/surface-theme.js'), 'the theme sheet, then its script');
  assert.ok(html.indexOf('/shared/ui/js/surface-theme.js') < html.indexOf('/api/lists/static/lists.css'));
  for (const token of ['--bg: var(--bg-primary,', '--text: var(--text-primary,', '--card: var(--bg-card,', '--line: var(--border-color,', '--accent: var(--accent-primary,', '--on-accent: var(--text-on-accent,', '--danger: var(--status-error,']) assert.ok(css.includes(token), token);
  const rules = css.slice(css.indexOf('}', css.indexOf(':root')));
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no colour is written outside the theme tokens');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'server text is never markup');
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.match(html, /placeholder="Add an item"/);
  assert.match(html, /placeholder="New list"/);
});

test('the declared static files are the two the route serves, and they exist', () => {
  assert.deepEqual(manifest.staticFiles, [{ route: '/api/lists/static/:file', folder: 'tools', files: ['lists.css', 'lists.js'] }]);
  for (const file of manifest.staticFiles[0].files) assert.ok(fs.statSync(path.join(PACKAGE, 'tools', file)).isFile(), file);
  assert.deepEqual(manifest.ui.static.map((surface) => [surface.toolName, surface.iframeUrl]), [['lists-home', '/api/lists/app']]);
  assert.equal(manifest.ribbon.defaultView, 'lists-home');
});

test('the migration and the statements keep to the shapes the native kernel runs', () => {
  const strip = (sql) => sql.replace(/--.*$/gm, '');
  const migration = strip(read('migrations', '001-lists.sql')), store = read('routes', 'lists-store.mjs');
  assert.deepEqual(manifest.migrations, ['migrations/001-lists.sql']);
  const statements = migration.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS lists_/, statement.slice(0, 60));
  assert.equal((migration.match(/PRIMARY KEY/g) || []).length, 2, 'one primary key a table');
  assert.equal((migration.match(/\bid\s+TEXT PRIMARY KEY/g) || []).length, 2, 'each a single text column');
  for (const never of [/ON CONFLICT/i, /\bJOIN\b/i, /ORDER BY/i, /\bDO \$\$/i, /REFERENCES/i, /UNIQUE/i, /\bBEGIN\b/i, /DISTINCT/i]) {
    assert.doesNotMatch(migration, never, `the migration has no ${never.source}`);
    assert.doesNotMatch(store.replace(/^\s*\*.*$/gm, ''), never, `the statements have no ${never.source}`);
  }
  const issued = [...store.matchAll(/(?:run\()\s*[`']([^`']+)[`']/g)].map((m) => m[1]);
  assert.equal(issued.length, 13);
  for (const statement of issued) assert.match(statement, /user_sub(?: = \$1|, )/, 'every statement names the caller');
});

test('the Test Lab catalog registers every suite of the package', () => {
  const catalog = yaml.load(read('tests', 'test-lab.yaml'));
  const files = new Set(catalog.cases.flatMap((entry) => (entry.runner && entry.runner.files) || []));
  const suites = [...fs.readdirSync(path.join(PACKAGE, 'tests')).filter((name) => /\.test\.cjs$/.test(name)).map((name) => `tests/${name}`),
    ...fs.readdirSync(path.join(PACKAGE, 'tests', 'browser')).map((name) => `tests/browser/${name}`)];
  for (const suite of suites) assert.ok(files.has(suite), `${suite} is registered in tests/test-lab.yaml`);
  assert.ok(catalog.cases.some((entry) => entry.runner.kind === 'smoke'), 'the readiness case');
  assert.deepEqual(manifest.testing, { version: 1, catalog: 'tests/test-lab.yaml' });
});
