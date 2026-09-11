/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Bot-registry declarations guard (ADR-083 DECLARED + ADR-131): every bot is an inline concierge whose manifest entry carries a one-line "Select when …" descriptor and natural-language routing keywords, with persona/manifest identity parity and no keyword collisions.
 *
 * Dependency-free `node --test` over the manifest text (store-CI contract: plain node, no
 * install). Why: the framework reads a store package's routing fields ONLY from the manifest
 * (persona paths resolve from the server cwd, where a package never lives). When they were absent,
 * routing fell back to hyphenated capability tags and Jarvis described the app as "The Marketing
 * Engine app." — the exact ADR-083 mis-route shape. This keeps that from coming back silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = readFileSync(join(packageDir, 'oshal-app.yaml'), 'utf8');

/** Bare terms ADR-083 and its checklist name as cross-domain collisions, or that other bots own. */
const COLLISION_TERMS = ['post', 'linkedin', 'tweet', 'budget', 'target', 'order', 'cost', 'switch', 'scene', 'marketing', 'go-to-market', 'press release'];

/** Jarvis's app catalog keeps the first 300 characters of a selector. */
const MAX_SELECTOR_CHARS = 300;

/** Strip one pair of surrounding double quotes. */
function unquote(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

/** Parse the manifest's bots block (the fixed two-level shape this package uses) — fail loudly. */
function parseBots(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^bots:\s*$/.test(line));
  assert.ok(start >= 0, 'manifest declares bots:');
  const end = lines.findIndex((line, index) => index > start && /^[A-Za-z_][\w-]*:/.test(line));
  const bots = [];
  let current = null;
  let listKey = null;
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    let match = /^ {2}- (\w+):\s*(.*)$/.exec(line);
    if (match) { current = { [match[1]]: unquote(match[2]) }; bots.push(current); listKey = null; continue; }
    match = /^ {4}(\w+):\s*(.*)$/.exec(line);
    if (match && current) {
      listKey = match[2] === '' ? match[1] : null;
      current[match[1]] = match[2] === '' ? [] : unquote(match[2]);
      continue;
    }
    match = /^ {6}- (.+)$/.exec(line);
    if (match && current && listKey) { current[listKey].push(unquote(match[1])); continue; }
    assert.fail(`unparsed bots line: ${line}`);
  }
  return bots;
}

/** Read one top-level scalar field from a persona file. */
function personaField(file, field) {
  const found = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(readFileSync(join(packageDir, file), 'utf8'));
  return found ? unquote(found[1]) : null;
}

const bots = parseBots(manifest);

test('the manifest declares exactly the four inline concierge bots', () => {
  assert.deepEqual(bots.map((bot) => bot.name), ['campaign-director', 'market-analyst', 'growth-analyst', 'launch-coordinator']);
  for (const bot of bots) assert.equal(bot.container, undefined, `${bot.name} must stay inline (ADR-131)`);
  assert.equal(new Set(bots.map((bot) => bot.agentId)).size, bots.length, 'agentIds are unique');
});

test('each persona file carries the same agent id and name as its manifest entry', () => {
  for (const bot of bots) {
    assert.equal(personaField(bot.persona, 'agent_id'), bot.agentId, `${bot.name} agent_id parity`);
    assert.equal(personaField(bot.persona, 'name'), bot.name, `${bot.name} name parity`);
  }
});

test('chatBot and workflow.workerBot name a declared bot', () => {
  const names = new Set(bots.map((bot) => bot.name));
  assert.ok(names.has(/^chatBot:\s*(\S+)/m.exec(manifest)?.[1]), 'chatBot');
  assert.ok(names.has(/^ {2}workerBot:\s*(\S+)/m.exec(manifest)?.[1]), 'workflow.workerBot');
});

test('every bot declares a one-line "Select when" descriptor that states its boundary', () => {
  for (const bot of bots) {
    const selector = bot.selectorDescriptor;
    assert.equal(typeof selector, 'string', `${bot.name} declares selectorDescriptor`);
    assert.match(selector, /^Select when /, `${bot.name} selector reads as a routing rule`);
    assert.ok(!selector.includes('\n'), `${bot.name} selector is one line (the router reads line 1)`);
    assert.ok(selector.length <= MAX_SELECTOR_CHARS, `${bot.name} selector fits the ${MAX_SELECTOR_CHARS}-char catalog blurb`);
    assert.match(selector, /\bnever\b/, `${bot.name} selector states what it never does`);
  }
});

test('routing keywords are natural language, never capability-tag copies or bare collision terms', () => {
  for (const bot of bots) {
    const keywords = bot.routingKeywords;
    assert.ok(Array.isArray(keywords) && keywords.length >= 5, `${bot.name} declares routingKeywords`);
    for (const keyword of keywords) {
      assert.equal(keyword, keyword.toLowerCase(), `${bot.name}: "${keyword}" is lowercase`);
      assert.ok(!bot.capabilities.includes(keyword), `${bot.name}: "${keyword}" copies a capability tag`);
      assert.ok(!COLLISION_TERMS.includes(keyword), `${bot.name}: "${keyword}" is a bare collision term`);
    }
  }
});

test('no routing keyword is claimed by two marketing bots', () => {
  const owners = new Map();
  for (const bot of bots) {
    for (const keyword of bot.routingKeywords) {
      assert.ok(!owners.has(keyword), `"${keyword}" is claimed by ${owners.get(keyword)} and ${bot.name}`);
      owners.set(keyword, bot.name);
    }
  }
});
