/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0, T9: Intelligent Career follows the Create concierge pattern (Intelligent Trades 1.54.0 the worked example). The front desk is career-concierge, an inline bot that answers in the app with career-hunter's own speaking, advisor and hard rules, the same tool authorizations, the same Career facts and its own authorization binding; career-hunter stays the worker for career-application tickets, the engine rail and the studio calls.
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
  assert.deepEqual([front.agentId, front.posture, front.role, front.persona], [CONCIERGE, 'inline', 'career/concierge', 'personas/career-concierge.yaml']);
  assert.deepEqual(front.routingKeywords, ['my resume', 'master resume', 'edit my resume', 'tighten my resume', 'update my resume'], 'the resume routing words reach the front desk');
  const worker = manifest.bots.find((bot) => bot.name === 'career-hunter');
  assert.equal(worker.agentId, WORKER);
  assert.equal(worker.routingKeywords, undefined, 'the words moved, not copied');
  assert.match(persona('career-hunter').selector_descriptor, /back-office worker: career-application tickets/);
});

test('the concierge keeps career-hunter\'s rules word for word and adds the front-desk ones', () => {
  const front = persona('career-concierge'), worker = persona('career-hunter');
  assert.equal(front.name, 'career-concierge');
  assert.equal(front.agent_id, CONCIERGE);
  assert.equal(front.runtime?.harness, 'claude-code');
  const said = front.perspective, owned = worker.perspective;
  for (const section of ['## Speaking to the person', '## Answering (the advisor half)', '## Hard rules']) {
    const start = owned.indexOf(section), end = owned.indexOf('\n## ', start + 1);
    const body = owned.slice(start, end === -1 ? undefined : end).trim();
    assert.ok(said.includes(body), `${section} is carried word for word`);
  }
  assert.ok(!said.includes('## Ticket work (the worker half)'), 'ticket work stays with the worker');
  assert.match(said, /Answer in plain prose\./);
  assert.ok(said.includes('```tool_call'), 'teaches the tool_call fence');
  assert.match(said, /Always call `career_database` before stating anything about the person's jobs/);
  assert.match(said, /hand off to career-hunter for ticket work/);
});

test('every route-backed tool is authorized for the concierge exactly as for the worker', () => {
  const front = persona('career-concierge').authorizations, worker = persona('career-hunter').authorizations;
  assert.deepEqual(front, worker);
  const apiTools = (manifest.tools || []).filter((tool) => tool?.executor?.executorType === 'api').map((tool) => tool.name);
  assert.ok(apiTools.length >= 20, 'Career declares its route-backed tools');
  for (const name of apiTools) assert.ok(name in front, `career-concierge authorizes ${name}`);
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
