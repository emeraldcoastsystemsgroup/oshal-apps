/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant's contract: the manifest's chatBot names a declared bot whose persona file has a perspective, authorizes every declared tool and carries routing words; every api tool's endpoint is a route the package mounts under /api/kalshi; the rating declares the hosted feature with a template fallback; the Markets tab, its Why button and Ask the quant exist on the page.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
const page = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');

/** A top-level YAML block by key, as text (this suite installs no YAML parser). */
function block(key) {
  const part = manifest.split(/\n(?=\S)/).find((p) => p.startsWith(`${key}:`));
  assert.ok(part, `the manifest declares ${key}:`);
  return part;
}

test('chatBot names a declared bot whose persona has a perspective, routing words and every tool authorized', () => {
  const chatBot = /^chatBot:\s*(\S+)/m.exec(manifest)[1];
  assert.equal(chatBot, 'kalshi-quant');
  const bots = block('bots');
  assert.match(bots, /name: kalshi-quant\n\s+persona: (personas\/kalshi-quant\.yaml)/);
  const persona = fs.readFileSync(path.join(PKG, 'personas', 'kalshi-quant.yaml'), 'utf8');
  assert.match(persona, /^perspective: \|/m);
  assert.match(persona, /^routing_keywords: \[.*kalshi.*\]/m);
  assert.match(persona, /^name: kalshi-quant$/m);
  const agentId = /agentId: ([0-9a-f-]{36})/.exec(bots)[1];
  assert.match(persona, new RegExp(`^agent_id: ${agentId}$`, 'm'), 'the persona carries the manifest agentId');
  const tools = [...block('tools').matchAll(/^  - name: (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(tools, ['kalshi_market', 'kalshi_markets', 'kalshi_scan']);
  for (const tool of tools) assert.match(persona, new RegExp(`^  ${tool}: "auto"$`, 'm'), `${tool} is authorized for the quant`);
  assert.match(persona, /never place/i, 'the quant never trades');
});

test('every api tool reads a route this package mounts under /api/kalshi, read-only and without approval', () => {
  const tools = block('tools');
  const endpoints = [...tools.matchAll(/apiEndpoint: "(GET) \/api\/kalshi(\/[^"?{]*)/g)].map((m) => m[2]);
  assert.deepEqual(endpoints, ['/markets/', '/markets', '/scan']);
  const mounted = [...routes.matchAll(/router\.get\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(mounted.includes('/markets') && mounted.includes('/markets/:ticker') && mounted.includes('/scan'), mounted.join(' '));
  assert.equal((tools.match(/requiresApproval: false/g) || []).length, 3);
  assert.equal((tools.match(/executorType: api/g) || []).length, 3);
  assert.ok(!/executorType: cli/.test(tools), 'no cli tool: the native kernel runs none');
});

test('the rating declares the hosted quant with a template fallback', () => {
  const rating = block('rating');
  assert.match(rating, /- id: quant-walkthrough\n\s+unit: question\n\s+tier: T2\n\s+generation: hosted\n\s+degrade: template/);
});

test('the page has a Markets tab first, a Why walkthrough and Ask the quant', () => {
  const tabs = [...page.matchAll(/data-tab="([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(tabs[0], 'markets', 'the person lands on the whole market list');
  assert.match(page, /data-panel="markets"/);
  assert.match(page, /id="mk-rows"/);
  assert.match(page, /mkJson\('\/markets\?' \+ mkParams\(\)\)/, 'the list is read from GET /api/kalshi/markets');
  assert.match(page, /mkJson\('\/markets\/' \+ encodeURIComponent\(ticker\)\)/, 'the walkthrough is read from GET /api/kalshi/markets/:ticker');
  assert.match(page, /Ask the quant/);
  assert.match(page, /type: 'app-ask'/, 'the question is handed to the host rail as an app-ask message');
  assert.match(page, /id="mk-lookup"/, 'any ticker can be looked up');
});
