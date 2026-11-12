/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.1 (concierge audit batch 2b; Roger, 2026-11-10: "make sure it holds the existing pattern that was designated in Create"): Kalshi's side-chat concierge follows Create's create-editor. kalshi-quant is the chatBot and the package's only bot, runs inline (explicit), answers in plain prose, teaches the ```tool_call fence the kernel parses for its three route reads, names runtime harness claude-code, is listed in the store's CONCIERGES, and still reads only: every tool is a GET of a Kalshi market or scan route and none reaches an order, the portfolio or a write. Run: node --test kalshi/tests/kalshi-create-concierge.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'kalshi-quant.yaml'), 'utf8');

/** A top-level YAML block by key, as text (this suite installs no YAML parser, as the quant contract beside it). */
function block(text, key) {
  const part = text.split(/\n(?=\S)/).find((p) => p.startsWith(`${key}:`));
  assert.ok(part, `${key}: is declared`);
  return part;
}

/** The persona's perspective, its block scalar joined into one line of words. */
function perspective() {
  const body = block(persona, 'perspective');
  assert.match(body, /^perspective: \|\n/, 'the perspective is a literal block');
  return body.replace(/^perspective: \|\n/, '').replace(/\s+/g, ' ');
}

test('the side chat is kalshi-quant: the chatBot, the only bot, inline and explicit', () => {
  assert.equal(/^chatBot:\s*(\S+)/m.exec(manifest)[1], 'kalshi-quant');
  const bots = block(manifest, 'bots');
  const entries = bots.split(/\n  - /).slice(1);
  assert.equal(entries.length, 1, 'the quant is the package\'s only bot: no worker sits behind it');
  const quant = entries[0];
  assert.match(quant, /\n    name: kalshi-quant\n/);
  assert.match(quant, /\n    persona: personas\/kalshi-quant\.yaml\n/);
  assert.match(quant, /\n    posture: inline\n/, 'the side-chat bot runs inline, as Create\'s create-editor does');
  assert.doesNotMatch(quant, /\n    (container|requiresOwnNode):/, 'no node or container posture contradicts it');
});

test('the persona follows Create\'s create-editor: plain prose, the tool_call fence and the claude-code harness', () => {
  const said = perspective();
  assert.match(said, /Answer in plain prose: a few concise sentences or a short list\. Never present raw JSON as the answer\./);
  assert.ok(said.includes('emit exactly one fenced block opening with ```tool_call on its own line'), 'teaches the ```tool_call fence');
  assert.ok(said.includes('holding {"tool":"<listed tool name>","arguments":{...}}, and closing with ```. Wait for its result.'),
    'the fence holds the object the kernel parses');
  assert.match(said, /The tools listed by the runtime are the only ones you can use; there is no shell, CLI or filesystem\./);
  assert.match(persona, /\nruntime:\n  harness: claude-code\n?$/, 'runtime harness claude-code, as create-editor names it');
  assert.match(said, /You never place, size or cancel an order/, 'the quant still never trades');
});

test('every route tool is an authorized read of a Kalshi market or scan route; none reaches an order, the portfolio or a write', () => {
  const tools = block(manifest, 'tools');
  const names = [...tools.matchAll(/^  - name: (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(names, ['kalshi_market', 'kalshi_markets', 'kalshi_scan']);
  const endpoints = [...tools.matchAll(/apiEndpoint: "([A-Z]+) ([^"]+)"/g)].map((m) => [m[1], m[2].split('?')[0]]);
  assert.equal(endpoints.length, names.length, 'each tool is route-backed');
  // The three reads, exactly: one market, the market list, the last scan. An order, portfolio, grading,
  // settings or scan-tick route is none of these, so a tool that reaches one turns this red.
  assert.deepEqual(endpoints, [
    ['GET', '/api/kalshi/markets/{input.ticker}'],
    ['GET', '/api/kalshi/markets'],
    ['GET', '/api/kalshi/scan'],
  ]);
  assert.equal((tools.match(/requiresApproval: false/g) || []).length, names.length, 'reads need no approval card');
  for (const name of names) assert.match(persona, new RegExp(`^  ${name}: "auto"$`, 'm'), `${name} is authorized for the quant`);
});

test('the quant is a registered store concierge, so the store bot check holds its prose and fence rules', () => {
  const registry = fs.readFileSync(path.join(STORE, 'scripts', 'check-store-bots.mjs'), 'utf8');
  const concierges = registry.slice(registry.indexOf('export const CONCIERGES = ['), registry.indexOf('];', registry.indexOf('export const CONCIERGES = [')));
  assert.ok(concierges.includes("'kalshi/personas/kalshi-quant.yaml'"), 'listed in CONCIERGES');
});
