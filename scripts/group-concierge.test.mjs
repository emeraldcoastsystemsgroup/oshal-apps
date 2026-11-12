/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A group's concierge (chatBot) must be the concierge of one of its required application members, the rule the native kernel applies when it activates a group (crates/packages/src/composition.rs check_available: "group concierge is not owned by an active required member"). Career 1.57.0 moved Career's concierge from career-hunter to career-concierge while the Intelligent Career group still named career-hunter; every gate passed, because the only check of this rule (check-bot-dependencies) needs the retired platform and is skipped, and the group stayed active until the test slot restarted and refused it. This runs without the platform.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');

/**
 * @description Every store package manifest, by name.
 * @returns {Map<string, object>} name -> parsed oshal-app.yaml.
 */
function manifests() {
  const found = new Map();
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const file = path.join(ROOT, entry.name, 'oshal-app.yaml');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const manifest = yaml.load(fs.readFileSync(file, 'utf8'));
    if (manifest?.name) found.set(manifest.name, manifest);
  }
  return found;
}

/**
 * @description The kernel's group-concierge rule over a set of manifests.
 * @param {Map<string, object>} all Manifests by name.
 * @returns {string[]} One line per group whose concierge no required member owns.
 */
export function groupConciergeProblems(all) {
  const problems = [];
  for (const [name, manifest] of all) {
    if (manifest.kind !== 'group' || !manifest.chatBot) continue;
    const members = manifest.dependencies?.required?.apps ?? [];
    const owners = members.filter((member) => all.get(member)?.chatBot === manifest.chatBot);
    if (!owners.length) {
      const offered = members.map((member) => `${member}: ${all.get(member)?.chatBot ?? 'none'}`).join(', ');
      problems.push(`${name}: chatBot ${manifest.chatBot} is no required member's concierge (${offered || 'no required members'})`);
    }
  }
  return problems;
}

test('every group\'s concierge is the concierge of one of its required members', () => {
  const all = manifests();
  assert.ok([...all.values()].some((manifest) => manifest.kind === 'group'), 'the store has groups to check');
  assert.deepEqual(groupConciergeProblems(all), []);
});

test('the rule refuses a group whose member moved its concierge, and a group with no required members', () => {
  const all = new Map([
    ['career', { name: 'career', chatBot: 'career-concierge' }],
    ['group-a', { name: 'group-a', kind: 'group', chatBot: 'career-hunter', dependencies: { required: { apps: ['career'] } } }],
    ['group-b', { name: 'group-b', kind: 'group', chatBot: 'career-concierge', dependencies: { required: { apps: ['career'] } } }],
    ['group-c', { name: 'group-c', kind: 'group', chatBot: 'career-concierge', dependencies: { optional: { apps: ['career'] } } }],
    ['plain', { name: 'plain', chatBot: 'someone-else' }],
  ]);
  assert.deepEqual(groupConciergeProblems(all), [
    'group-a: chatBot career-hunter is no required member\'s concierge (career: career-concierge)',
    'group-c: chatBot career-concierge is no required member\'s concierge (no required members)',
  ]);
});
