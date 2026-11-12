/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0 (concierge audit T15, the batch after 2b; Roger, 2026-11-10: "make sure it holds the existing pattern that was designated in Create"): Intelligent Processing follows the Create concierge pattern, Intelligent Operations' ops-concierge 1.9.0 the nearest worked example. Before it, ops-rca-specialist, the RCA investigator this package imports from Intelligent Operations, sat in as chatBot, and the kernel runs a bot with its owner's tools, so the panel had Operations' tools and no read of this queue. The front desk is processing-concierge: declared by this package, inline, its own persona with Create's create-editor rules (plain prose, the ```tool_call fence, runtime harness claude-code), the specialist's concierge-panel rules word for word, its one route tool (processing-queue, a GET of this package's own queue route) authorized auto, no routing words, capabilities or routing tags in the manifest (the specialist's words are all Operations' records), no named-permission catalog (access carries over on the caller's tier) and a place in the store's CONCIERGES. The workers stay as they were: the three phases and both imports from Intelligent Operations. Run: node --test intelligent-processing/tests/processing-create-concierge.test.cjs
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = yaml.load(read('oshal-app.yaml'));
const persona = () => yaml.load(read(path.join('personas', 'processing-concierge.yaml')));
const specialist = () => yaml.load(fs.readFileSync(path.join(store, 'intelligent-operations', 'personas', 'ops-rca-specialist.yaml'), 'utf8'));
const flat = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const bot = (name) => (manifest.bots || []).find((entry) => entry.name === name);
const imports = () => ['required', 'optional'].flatMap((tier) => manifest.dependencies?.[tier]?.bots || []);
const routeTools = () => (manifest.tools || []).filter((tool) => tool?.executor?.executorType === 'api');
const CONCIERGE = '56031d28-b494-4649-9780-4421017e3a92';

test('the front desk is processing-concierge, this package\'s own inline bot; the imported specialist no longer sits in as chatBot', () => {
  assert.equal(manifest.chatBot, 'processing-concierge');
  const front = bot('processing-concierge');
  assert.ok(front, 'processing-concierge is declared by this package, so the kernel runs it with this package\'s tools');
  assert.deepEqual([front.agentId, front.persona, front.posture, front.role],
    [CONCIERGE, 'personas/processing-concierge.yaml', 'inline', 'processing/concierge']);
  assert.equal(front.container, undefined);
  assert.equal(front.requiresOwnNode, undefined);
  assert.deepEqual((manifest.bots || []).map((entry) => entry.name), ['processing-concierge'], 'the front desk is the only bot this package declares');
  assert.ok(!imports().some((entry) => entry.name === manifest.chatBot), 'the chatBot is not an imported bot');
  assert.ok(!imports().some((entry) => entry.name === 'ops-concierge'), 'Operations\' front desk is not imported: it would answer from Operations\' records');
  const phaseBots = manifest.workflow.phases.map((phase) => phase.bot).filter(Boolean);
  assert.ok(!phaseBots.includes('processing-concierge'), 'the concierge runs no phase of the RCA pipeline');
});

test('the workers stay as they were: the three phases run the imported specialist and reviewer, and both imports stay', () => {
  assert.equal(manifest.ticketType, 'intelligent-processing');
  assert.deepEqual(manifest.workflow.phases.map((phase) => [phase.name, phase.bot]),
    [['investigate', 'ops-rca-specialist'], ['review', 'ops-incident-reviewer'], ['revise', 'ops-rca-specialist']]);
  assert.deepEqual(manifest.dependencies.required.apps, ['intelligent-operations']);
  assert.deepEqual(manifest.dependencies.required.bots, [
    { app: 'intelligent-operations', name: 'ops-rca-specialist' },
    { app: 'intelligent-operations', name: 'ops-incident-reviewer' },
  ]);
});

test('no routing word, capability or routing tag is added: the specialist\'s words are all Operations\' records', () => {
  const front = bot('processing-concierge');
  for (const key of ['routingKeywords', 'capabilities']) assert.equal(front[key], undefined, `the manifest entry declares no ${key}`);
  for (const tool of manifest.tools || []) assert.equal(tool.routingTags, undefined, `${tool.name} declares no routingTags`);
  assert.equal(persona().routing_keywords, undefined, 'the persona declares no routing_keywords');
  const operations = yaml.load(fs.readFileSync(path.join(store, 'intelligent-operations', 'oshal-app.yaml'), 'utf8'));
  const words = operations.bots.find((entry) => entry.name === 'ops-concierge').routingKeywords;
  assert.ok(Array.isArray(words) && words.length === 35, 'Operations\' front desk keeps the 35 words batch 2b moved from the specialist');
  assert.ok(!words.some((word) => /processing|queue|root cause|file an alert/i.test(word)), 'none of them is about this queue');
});

test('the concierge persona follows Create\'s create-editor and carries the specialist\'s concierge-panel rules word for word', () => {
  const front = persona();
  assert.equal(front.name, 'processing-concierge');
  assert.equal(front.agent_id, CONCIERGE);
  assert.equal(front.runtime?.harness, 'claude-code');
  const said = flat(front.perspective);
  assert.ok(said.includes('Answer in plain prose: a few concise sentences or a short list. Never present raw JSON as the answer.'));
  assert.ok(said.includes('To call a listed tool, emit exactly one fenced block opening with ```tool_call on its own line, holding {"tool":"<listed tool name>","arguments":{...}}, and closing with ```. Wait for its result.'));
  assert.ok(said.includes('The tools listed by the runtime are the only ones you can use; there is no shell, CLI or filesystem.'));
  const owned = specialist().perspective;
  const section = owned.slice(owned.indexOf('## Answering a person in the concierge panel'));
  const rules = flat(section.split('\n').slice(2).join('\n'));
  assert.match(rules, /^Answer in plain prose: a few short sentences or a short list\..*"open" already includes the tickets waiting on a person\.$/);
  assert.ok(said.includes(rules), 'the concierge-panel rules are carried word for word');
  assert.match(said, /Always call `processing-queue` before stating how many tickets are on this queue/);
  assert.match(said, /never guess which alert a ticket is about/);
  assert.match(said, /Never invent a host, service, log line, metric, time, ticket number or document\./);
  assert.match(said, /You never investigate an alert and never write an RCA report, a mode line or a decision table/);
  assert.match(said, /never say you filed, started, approved or changed anything/);
  assert.doesNotMatch(said, /MODE: [ABC]|Return only a JSON object|Return a JSON envelope|pod-analysis-v1|cli-helper-v1|console-plan-v1/, 'no worker report or packet contract at the front desk');
  assert.doesNotMatch(said, /ops-attention|ops-systems|ops-remove-source/, 'no Operations tool is named');
});

test('the one route tool is a read of this package\'s own queue route, authorized auto for the concierge', () => {
  const tools = routeTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['processing-queue']);
  assert.deepEqual((manifest.tools || []).map((tool) => tool.name), ['processing-queue'], 'no CLI or other executor tool');
  const [queue] = tools;
  assert.equal(queue.executor.apiEndpoint, 'GET /api/intelligent-processing/queue');
  assert.equal(queue.requiresApproval, false);
  assert.equal(queue.defaultAuthMode, 'auto');
  assert.deepEqual(queue.inputSchema, { type: 'object', properties: {} });
  const route = (manifest.routes || []).find((entry) => entry.mountPath === '/api/intelligent-processing/queue');
  assert.deepEqual(route, { module: 'routes/processing-queue.js', factory: 'createProcessingQueueRoutes',
    mountPath: '/api/intelligent-processing/queue', auth: 'oidc', requiresAuth: true, requiresContext: true, requiresAi: false });
  const grants = persona().authorizations;
  for (const tool of tools) assert.equal(grants[tool.name], tool.requiresApproval ? 'ask' : 'auto', tool.name);
  assert.deepEqual(Object.keys(grants).sort(), tools.map((tool) => tool.name).sort(), 'no tool the package does not declare');
});

test('access carries over: no named-permission catalog, and the concierge is a registered store concierge', () => {
  assert.equal(manifest.authorization, undefined, 'no catalog: the kernel admits the bot turn and its read on the caller\'s tier');
  assert.ok(!fs.existsSync(path.join(root, 'authorization.yaml')), 'no authorization.yaml, so no role, grant or assignment changes');
  const registry = fs.readFileSync(path.join(store, 'scripts', 'check-store-bots.mjs'), 'utf8');
  const at = registry.indexOf('export const CONCIERGES = [');
  assert.ok(registry.slice(at, registry.indexOf('];', at)).includes("'intelligent-processing/personas/processing-concierge.yaml'"), 'listed in CONCIERGES');
});
