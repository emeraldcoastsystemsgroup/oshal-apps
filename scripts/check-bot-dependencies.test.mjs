/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real YAML/dependency reader and cross-package ownership guard with isolated successful and mutated sources.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove canonical platform imports resolve and stale, mismatched or duplicate native identities still refuse.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readDeclarations, botDependencyProblems } from './check-bot-dependencies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMEWORK = process.env.OSHAL_FRAMEWORK;
const ID = 'a0000000-0000-0000-0000-000000000044';

function fixture(t, mutate = () => {}, framework = FRAMEWORK) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-bot-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifests = {
    owner: { name: 'owner', chatBot: 'analyst', bots: [{ agentId: ID, name: 'analyst' }] },
    consumer: {
      name: 'consumer', uses: ['app-dependencies'], chatBot: 'analyst',
      dependencies: { required: { apps: ['owner'], bots: [{ app: 'owner', name: 'analyst' }] } },
      workflow: { workerBot: 'analyst', processDefinition: { nodes: [{ agentBinding: 'analyst' }] } },
    },
    workspace: { name: 'workspace', kind: 'group', chatBot: 'analyst', dependencies: { required: { apps: ['owner'] } } },
  };
  mutate(manifests);
  for (const [name, manifest] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'oshal-app.yaml'), JSON.stringify(manifest));
  }
  const { manifests: parsed, problems } = readDeclarations(root, framework);
  return [...problems, ...botDependencyProblems(parsed)];
}

function platformFixture(t, mutate = () => {}) {
  const framework = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-platform-bot-contract-'));
  t.after(() => fs.rmSync(framework, { recursive: true, force: true }));
  fs.writeFileSync(path.join(framework, 'package.json'), '{}');
  fs.mkdirSync(path.join(framework, 'scripts'));
  fs.mkdirSync(path.join(framework, 'swarm-apps'));
  fs.symlinkSync(path.join(FRAMEWORK, 'node_modules'), path.join(framework, 'node_modules'), 'junction');
  fs.copyFileSync(path.join(FRAMEWORK, 'scripts/oshal-app-dependencies.js'), path.join(framework, 'scripts/oshal-app-dependencies.js'));
  const owner = { name: 'native-owner', bots: [{ agentId: 'a0000000-0000-0000-0000-000000000050', name: 'native-assistant' }] };
  mutate(owner);
  fs.writeFileSync(path.join(framework, 'swarm-apps/native-owner.yaml'), JSON.stringify(owner));
  return fixture(t, (manifests) => {
    manifests.consumer.dependencies.optional = { apps: ['native-owner'], bots: [{ app: 'native-owner', name: 'native-assistant' }] };
  }, framework);
}

test('an optional platform bot resolves from its canonical framework owner', (t) => {
  assert.deepEqual(platformFixture(t), []);
});

test('a removed or mismatched platform declaration cannot satisfy an import', (t) => {
  assert.match(platformFixture(t, (owner) => { owner.bots = []; }).join('\n'), /has no owning declaration/);
  assert.match(platformFixture(t, (owner) => { owner.name = 'wrong-owner'; }).join('\n'), /identity.*do not match/);
});

test('a platform alias cannot duplicate an application-owned bot identity', (t) => {
  assert.match(platformFixture(t, (owner) => { owner.bots[0].agentId = ID; }).join('\n'), /identity.*already owned/);
});

test('an owned bot, imported workflow worker and required member concierge all resolve', (t) => {
  assert.deepEqual(fixture(t), []);
});

test('a shared bot has one owner regardless of declaration order', (t) => {
  assert.match(fixture(t, (m) => { m.consumer.bots = structuredClone(m.owner.bots); }).join('\n'), /already owned/);
});

test('renaming a duplicated UUID cannot create a second owner', (t) => {
  assert.match(fixture(t, (m) => { m.consumer.bots = [{ agentId: ID, name: 'renamed' }]; }).join('\n'), /identity .* already owned/);
});

test('an application dependency alone does not import a workflow bot', (t) => {
  assert.match(fixture(t, (m) => { delete m.consumer.dependencies.required.bots; }).join('\n'), /workflow bot analyst needs/);
});

test('a deleted provider bot is not available through a stale import', (t) => {
  assert.match(fixture(t, (m) => { m.owner.bots = []; }).join('\n'), /has no owning declaration/);
});

test('an optional bot cannot satisfy a required workflow worker', (t) => {
  assert.match(fixture(t, (m) => {
    m.consumer.dependencies.optional = { bots: m.consumer.dependencies.required.bots };
    delete m.consumer.dependencies.required.bots;
  }).join('\n'), /workflow bot analyst needs/);
});

test('nested graph workers and reviewers cannot hide undeclared bots', (t) => {
  assert.match(fixture(t, (m) => {
    m.consumer.workflow.processDefinition.nodes[0].agentBinding = 'unowned';
  }).join('\n'), /workflow bot unowned needs/);
  assert.match(fixture(t, (m) => { m.consumer.workflow.reviewerBot = 'unowned'; }).join('\n'), /workflow bot unowned needs/);
});

test('the framework parser refuses a bot owner missing from application dependencies', (t) => {
  assert.match(fixture(t, (m) => { m.consumer.dependencies.required.apps = []; }).join('\n'), /needs owner in dependencies.required.apps/);
});

test('a group requires its member to declare the same canonical concierge', (t) => {
  assert.match(fixture(t, (m) => { m.owner.chatBot = 'other'; }).join('\n'), /group concierge needs/);
});

test('metadata-only platform concierge borrowing never claims executable ownership', (t) => {
  assert.deepEqual(fixture(t, (m) => {
    m.owner.chatBot = 'general-bot';
    m.workspace.chatBot = 'general-bot';
    m.consumer.chatBot = 'general-bot';
  }), []);
});

test('every actual store package passes the same ownership and reference check', () => {
  const { manifests, problems } = readDeclarations(ROOT, FRAMEWORK);
  assert.ok(manifests.size > 0);
  assert.deepEqual([...problems, ...botDependencyProblems(manifests)], []);
});

test('newly declared workers retain their enrolled UUID and dedicated execution node', () => {
  const { manifests, problems } = readDeclarations(ROOT, FRAMEWORK);
  assert.deepEqual(problems, []);
  for (const [app, name, id, container] of [
    ['finance', 'finance-analyst', ID, 'finance-bot'],
    ['eats', 'eats-concierge', 'b0080000-0000-0000-0000-000000000001', 'eats-bot'],
    ['movies', 'movies-concierge', 'b00b0000-0000-0000-0000-000000000001', 'movies-bot'],
    ['purchasing', 'shopping-concierge', 'b0070000-0000-0000-0000-000000000001', 'shopping-bot'],
    ['rides', 'rides-concierge', 'b0090000-0000-0000-0000-000000000001', 'rides-bot'],
    ['spotify', 'spotify-concierge', 'b00a0000-0000-0000-0000-000000000001', 'spotify-bot'],
    ['social', 'social-writer', 'a0000000-0000-0000-0000-000000000040', 'social-writer-bot'],
    ['email-summarizer', 'communications-bot', 'b0000000-0000-0000-0000-000000000001', 'email-bot'],
    ['home', 'home-bot', 'd0000000-0000-0000-0000-000000000001', 'home-bot'],
  ]) {
    const bot = manifests.get(app).bots.find((item) => item.name === name);
    assert.ok(bot, `${app} must own ${name}`);
    assert.equal(bot.agentId, id, 'existing enrolled workers must retain their identity');
    assert.equal(bot.container, container);
    assert.equal(bot.port, 5000);
    assert.equal(bot.requiresOwnNode, true);
    assert.ok(fs.existsSync(path.join(ROOT, app, bot.persona)));
  }
});
