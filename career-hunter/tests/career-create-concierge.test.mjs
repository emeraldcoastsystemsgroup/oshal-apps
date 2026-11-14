/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0, T9: Intelligent Career follows the Create concierge pattern (Intelligent Trades 1.54.0 the worked example). The front desk is career-concierge, an inline bot that answers in the app with career-hunter's own speaking, advisor and hard rules, the same tool authorizations, the same Career facts and its own authorization binding; career-hunter stays the worker for career-application tickets, the engine rail and the studio calls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0, one concierge (Roger, 2026-11-14): career-concierge is the one assistant a person talks to and no longer hands anything to career-hunter, which is declared as the engine's worker. The Speaking and Answering rules are still carried word for word; the hard rules are the concierge's own; it authorizes every route tool, and the worker's list is as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), repo = join(root, '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [here, join(repo, 'scripts', 'toolchain')] }));
const manifest = yaml.load(readFileSync(join(root, 'oshal-app.yaml'), 'utf8'));
const persona = (name) => yaml.load(readFileSync(join(root, 'personas', `${name}.yaml`), 'utf8'));
const CONCIERGE = 'cb000000-0000-0000-0000-000000000005', WORKER = 'cb000000-0000-0000-0000-000000000001';

test('the front desk is career-concierge (inline); career-hunter stays the worker', () => {
  assert.equal(manifest.chatBot, 'career-concierge');
  const front = manifest.bots.find((bot) => bot.name === 'career-concierge');
  assert.ok(front, 'career-concierge is declared');
  // 1.62.0: the role is what Jarvis's catalog shows beside the bot's name, so it says what the bot is to a person.
  assert.deepEqual([front.agentId, front.posture, front.persona], [CONCIERGE, 'inline', 'personas/career-concierge.yaml']);
  assert.match(front.role, /^concierge: the one assistant a person talks to/);
  assert.deepEqual(front.routingKeywords, ['my resume', 'master resume', 'edit my resume', 'tighten my resume', 'update my resume'], 'the resume routing words reach the front desk');
  const worker = manifest.bots.find((bot) => bot.name === 'career-hunter');
  assert.equal(worker.agentId, WORKER);
  assert.equal(worker.routingKeywords, undefined, 'the words moved, not copied');
  assert.match(worker.role, /^engine worker/);
  assert.match(persona('career-hunter').selector_descriptor, /engine worker: it ranks and classifies jobs/);
});

test('the concierge keeps career-hunter\'s speaking and answering rules word for word and is the one assistant', () => {
  const front = persona('career-concierge'), worker = persona('career-hunter');
  assert.equal(front.name, 'career-concierge');
  assert.equal(front.agent_id, CONCIERGE);
  assert.equal(front.runtime?.harness, 'claude-code');
  const said = front.perspective, owned = worker.perspective;
  for (const section of ['## Speaking to the person', '## Answering (the advisor half)']) {
    const start = owned.indexOf(section), end = owned.indexOf('\n## ', start + 1);
    const body = owned.slice(start, end === -1 ? undefined : end).trim();
    assert.ok(said.includes(body), `${section} is carried word for word`);
  }
  // 1.62.0: its hard rules are its own (a person's own statement that they applied goes on their board by a card).
  assert.match(said, /## Hard rules\n- NEVER fabricate a job, a score, a company, or resume content\./);
  assert.match(said, /Never claim that Career sent, submitted or recorded an application by itself/);
  assert.ok(!said.includes('## Ticket work (the worker half)'), 'ticket work stays with the worker');
  assert.match(said, /Answer in plain prose\./);
  assert.ok(said.includes('```tool_call'), 'teaches the tool_call fence');
  assert.match(said, /Always call `career_database` before stating anything about the person's jobs/);
  assert.match(said, /You are the only assistant in Career\./);
  assert.doesNotMatch(said, /hand off to career-hunter/i);
});

test('every route-backed tool is authorized for the concierge; the worker keeps the list its engine work had', () => {
  const front = persona('career-concierge').authorizations, worker = persona('career-hunter').authorizations;
  const apiTools = (manifest.tools || []).filter((tool) => tool?.executor?.executorType === 'api').map((tool) => tool.name);
  assert.ok(apiTools.length >= 50, 'Career declares its route-backed tools');
  for (const name of apiTools) assert.ok(name in front, `career-concierge authorizes ${name}`);
  for (const [name, mode] of Object.entries(worker)) assert.equal(front[name], mode, `${name}: the same approval for both`);
});

test('the concierge reads Career\'s facts, is bound like the worker and is a registered store concierge', () => {
  const read = readFileSync(join(root, 'lib', 'native-career-read.js'), 'utf8');
  assert.match(read, new RegExp(`const CONCIERGE = '${CONCIERGE}';`));
  assert.match(read, /for \(const agentId of \[AGENT, CONCIERGE\]\) ctx\.specialistContext\.register\(\{agentId, toolName:'career_database'/);
  const catalog = yaml.load(readFileSync(join(root, 'authorization.yaml'), 'utf8'));
  const bots = Object.fromEntries(catalog.bindings.bots.map((bot) => [bot.id, bot.allOf]));
  assert.deepEqual(bots[CONCIERGE], ['app.open', 'career.execute'], 'its turns spend the caller\'s provider money, as the worker\'s do');
  assert.deepEqual(bots[WORKER], ['app.open', 'career.execute']);
  const registry = readFileSync(join(repo, 'scripts', 'check-store-bots.mjs'), 'utf8');
  assert.ok(registry.includes("'career-hunter/personas/career-concierge.yaml'"), 'listed in CONCIERGES');
});
