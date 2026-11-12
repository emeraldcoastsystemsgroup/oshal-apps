/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0 (concierge audit batch 2b; Roger, 2026-11-10: "make sure it holds the existing pattern that was designated in Create"): Intelligent Operations follows the Create concierge pattern, Intelligent Trades 1.54.0 and Intelligent Career 1.57.0 the worked examples. Before it, ops-rca-specialist, the RCA pipeline's investigator, sat in as chatBot. The front desk is ops-concierge: inline, its own persona with Create's create-editor rules (plain prose, the ```tool_call fence, runtime harness claude-code), the specialist's concierge-panel rules word for word, every route tool authorized (the reads auto, ops-remove-source ask), the routing words moved to it, its own app.open binding and a place in the store's CONCIERGES. The workers stay as they were: the phases, both worker personas and the three screens that ask the specialist for JSON packets. Run: node --test intelligent-operations/tests/ops-create-concierge.test.cjs
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
const persona = (name) => yaml.load(read(path.join('personas', `${name}.yaml`)));
const flat = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const bot = (name) => manifest.bots.find((entry) => entry.name === name);
const CONCIERGE = '0be32215-3a5a-43cd-9f84-afc659aa1d65';
const SPECIALIST = 'a0000000-0000-0000-0000-000000000016';
const REVIEWER = '5b770acf-69d5-4361-8d2e-19a2cd05e181';

test('the front desk is ops-concierge, inline and outside the RCA pipeline; the specialist no longer sits in as chatBot', () => {
  assert.equal(manifest.chatBot, 'ops-concierge');
  const front = bot('ops-concierge');
  assert.ok(front, 'ops-concierge is declared');
  assert.deepEqual([front.agentId, front.persona, front.posture, front.role],
    [CONCIERGE, 'personas/ops-concierge.yaml', 'inline', 'operations/concierge']);
  assert.equal(front.container, undefined);
  assert.equal(front.requiresOwnNode, undefined);
  const phaseBots = manifest.workflow.phases.map((phase) => phase.bot).filter(Boolean);
  assert.ok(!phaseBots.includes('ops-concierge'), 'the concierge runs no phase of the RCA pipeline');
});

test('the workers stay as they were: the phases, both worker personas and the screens that ask the specialist for packets', () => {
  assert.deepEqual(manifest.workflow.phases.map((phase) => [phase.name, phase.bot || phase.action]),
    [['investigate', 'ops-rca-specialist'], ['review', 'ops-incident-reviewer'], ['revise', 'ops-rca-specialist'], ['queue-deliver', 'complete']]);
  assert.deepEqual([bot('ops-rca-specialist').agentId, bot('ops-rca-specialist').persona], [SPECIALIST, 'personas/ops-rca-specialist.yaml']);
  assert.deepEqual([bot('ops-incident-reviewer').agentId, bot('ops-incident-reviewer').persona], [REVIEWER, 'personas/ops-incident-reviewer.yaml']);
  const specialist = persona('ops-rca-specialist').perspective;
  for (const packet of ['pod-analysis-v1', 'cli-helper-v1', 'console-plan-v1', 'console-assess-v1']) {
    assert.ok(specialist.includes(packet), `the specialist keeps its ${packet} JSON contract`);
  }
  for (const screen of ['experience/console.js', 'experience/pod-console.js', 'experience/command-helper.js']) {
    assert.match(read(screen), /\/api\/swarm\/bots\/ops-rca-specialist\/ask/, `${screen} still asks the specialist for its packet`);
  }
});

test('the routing words moved to the front desk, not copied', () => {
  const words = bot('ops-concierge').routingKeywords;
  assert.ok(Array.isArray(words) && words.length >= 30, 'the concierge carries the routing words');
  for (const word of ['needs my attention in operations', 'monitored installations', 'stopped reporting', 'sec ops', 'platform ops']) {
    assert.ok(words.includes(word), word);
  }
  assert.equal(bot('ops-rca-specialist').routingKeywords, undefined, 'the worker keeps none');
  assert.equal(bot('ops-incident-reviewer').routingKeywords, undefined, 'the reviewer keeps none');
});

test('the concierge persona follows Create\'s create-editor and carries the specialist\'s concierge-panel rules word for word', () => {
  const front = persona('ops-concierge');
  assert.equal(front.name, 'ops-concierge');
  assert.equal(front.agent_id, CONCIERGE);
  assert.equal(front.runtime?.harness, 'claude-code');
  const said = flat(front.perspective);
  assert.ok(said.includes('Answer in plain prose: a few concise sentences or a short list. Never present raw JSON as the answer.'));
  assert.ok(said.includes('To call a listed tool, emit exactly one fenced block opening with ```tool_call on its own line, holding {"tool":"<listed tool name>","arguments":{...}}, and closing with ```. Wait for its result.'));
  assert.ok(said.includes('The tools listed by the runtime are the only ones you can use; there is no shell, CLI or filesystem.'));
  const owned = persona('ops-rca-specialist').perspective;
  const section = owned.slice(owned.indexOf('## Answering a person in the concierge panel'));
  const rules = flat(section.split('\n').slice(2).join('\n'));
  assert.match(rules, /^Answer in plain prose: a few short sentences or a short list\..*"open" already includes the tickets waiting on a person\.$/);
  assert.ok(said.includes(rules), 'the concierge-panel rules are carried word for word');
  assert.match(said, /Always call `ops-attention` before stating what needs the person's attention/);
  assert.match(said, /Always call `ops-systems` before stating whether a server or installation is monitored or still reporting/);
  assert.match(said, /Never invent a host, service, log line, metric, time, ticket number or document\./);
  assert.match(said, /You never write an RCA report, a mode line or a decision table/);
  assert.doesNotMatch(said, /MODE: [ABC]|Return only a JSON object|Return a JSON envelope/, 'no worker report or packet contract at the front desk');
});

test('every route tool is authorized for the concierge: the reads auto, the held removal ask', () => {
  const grants = persona('ops-concierge').authorizations;
  const tools = (manifest.tools || []).filter((tool) => tool?.executor?.executorType === 'api');
  assert.ok(tools.length >= 11, 'Operations declares its route tools');
  for (const tool of tools) {
    assert.equal(grants[tool.name], tool.requiresApproval ? 'ask' : 'auto', tool.name);
  }
  assert.deepEqual(Object.keys(grants).sort(), tools.map((tool) => tool.name).sort(), 'no tool the package does not declare');
});

test('the concierge is bound like the workers and is a registered store concierge', () => {
  const catalog = yaml.load(read('authorization.yaml'));
  const bound = Object.fromEntries(catalog.bindings.bots.map((entry) => [entry.id, entry.allOf]));
  assert.deepEqual(bound['ops-concierge'], ['app.open'], 'a turn of an unbound bot is refused');
  assert.deepEqual(bound['ops-rca-specialist'], ['app.open']);
  assert.deepEqual(bound['ops-incident-reviewer'], ['app.open']);
  const registry = fs.readFileSync(path.join(store, 'scripts', 'check-store-bots.mjs'), 'utf8');
  const at = registry.indexOf('export const CONCIERGES = [');
  assert.ok(registry.slice(at, registry.indexOf('];', at)).includes("'intelligent-operations/personas/ops-concierge.yaml'"), 'listed in CONCIERGES');
});
