/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Intelligent Trades conforms to the Create concierge pattern (create/oshal-app.yaml, video/oshal-app.yaml): dedicated inline front-desk chatBot trading-concierge with claude-code harness, plain-prose + ```tool_call fence rules, screen-mirroring watchlist tools (trading_watchlist, trading_watchlist_add, trading_watchlist_remove), mandatory tool-first checks for Schwab accounts and watchlist, back-office hand-off to trading-analyst, and registerDocumentSession screen handoff. Run: node --test trading/tests/trading-create-concierge.test.js
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.54.1: the stand-in for the kernel's document hand-off helper carries the helper's own refusal (no application, save or refresh), and the registration's application is checked. The stand-in accepted anything, so a registration the real helper threw on passed here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const yamlRoots = [__dirname, path.resolve(repoRoot, 'scripts/toolchain')];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));

function loadManifest() {
  return yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
}

function loadConciergePersona() {
  const file = path.join(root, 'personas', 'trading-concierge.yaml');
  assert.ok(fs.existsSync(file), 'personas/trading-concierge.yaml must exist');
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

test('manifest separates front-desk chatBot (trading-concierge, inline) from back-office workflow.workerBot (trading-analyst)', () => {
  const manifest = loadManifest();
  assert.equal(manifest.chatBot, 'trading-concierge', 'front-desk chatBot is trading-concierge, not the back-office specialist');
  assert.equal(manifest.workflow?.workerBot, 'trading-analyst', 'back-office decision workflow stays on trading-analyst');
  const bot = (manifest.bots || []).find((b) => b.name === 'trading-concierge');
  assert.ok(bot, 'trading-concierge is declared in bots:');
  assert.equal(bot.posture, 'inline', 'front-desk concierge runs inline like Create');
  assert.equal(bot.persona, 'personas/trading-concierge.yaml');
  assert.equal(bot.role, 'trading/concierge');
});

test('watchlist screen actions have matching route-backed concierge tools', () => {
  const manifest = loadManifest();
  const tools = new Map((manifest.tools || []).map((t) => [t.name, t]));
  const expected = [
    ['trading_watchlist', 'GET /api/trading/watchlist', []],
    ['trading_watchlist_add', 'POST /api/trading/watchlist', ['symbol']],
    ['trading_watchlist_remove', 'DELETE /api/trading/watchlist/{input.symbol}', ['symbol']],
  ];
  for (const [name, endpoint, required] of expected) {
    const tool = tools.get(name);
    assert.ok(tool, `${name} must be declared in oshal-app.yaml tools:`);
    assert.equal(tool.type, 'api');
    assert.equal(tool.executor?.executorType, 'api');
    assert.equal(tool.executor?.apiEndpoint, endpoint);
    assert.equal(tool.requiresApproval, false);
    assert.equal(tool.defaultAuthMode, 'auto');
    assert.deepEqual(tool.inputSchema?.required || [], required);
    for (const forbidden of ['subject', 'owner', 'tenant', 'user']) {
      assert.equal(tool.inputSchema?.properties?.[forbidden], undefined, `${name} must not expose ${forbidden}`);
    }
  }
});

test('trading-concierge persona follows the Create pattern: plain prose, tool_call fence, claude-code, all api tools authorized, tool-first rules, and back-office hand-off', () => {
  const manifest = loadManifest();
  const persona = loadConciergePersona();
  assert.equal(persona.name, 'trading-concierge');
  assert.equal(persona.runtime?.harness, 'claude-code');
  const perspective = String(persona.perspective || '');
  assert.match(perspective, /Answer in plain prose/i);
  assert.ok(perspective.includes('```tool_call'), 'teaches the ```tool_call JSON fence');
  assert.match(perspective, /always call `trading_accounts` before stating whether any brokerage or Charles Schwab account is connected/i);
  assert.match(perspective, /always call `trading_watchlist` before stating what is on the watchlist/i);
  assert.match(perspective, /hand off.*trading-analyst/is);

  const apiTools = (manifest.tools || []).filter((t) => t?.executor?.executorType === 'api');
  assert.ok(apiTools.length >= 27, 'all route-backed tools are present');
  for (const tool of apiTools) {
    assert.equal(persona.authorizations?.[tool.name], 'auto', `trading-concierge must authorize ${tool.name}`);
  }

  const checkBots = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-store-bots.mjs'), 'utf8');
  assert.ok(checkBots.includes("'trading/personas/trading-concierge.yaml'"), 'registered in scripts/check-store-bots.mjs CONCIERGES');
});

test('screen mounts registerDocumentSession (document-handoff.js) so every concierge turn carries live Trading screen state', async () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'ui', 'connected-actions.js'), 'utf8');
  assert.match(source, /\/shared\/ui\/js\/document-handoff\.js/);
  assert.match(source, /registerDocumentSession/);

  let registered = null;
  let rendered = 0;
  const body = source
    .replace(/^import\s+[^\n]+\n/gm, '')
    .replace(/await import\('\/shared\/ui\/js\/document-handoff\.js'\)\.catch\(\(\)\s*=>\s*null\)/, '({ registerDocumentSession })');
  const sandbox = {
    VIEW: 'research',
    SUB: 'stock',
    BOOK: 'b-schwab1',
    MODE: 'live',
    ACCOUNTS: [{ id: '1' }, { id: '2' }],
    CURRENT: 'NVDA',
    RS_SYM: 'NVDA',
    RS_REPORT: null,
    bookLabel: (ref) => `Schwab Individual (${ref})`,
    render: async () => { rendered += 1; },
    receiveHandoff: () => {},
    mountConnectedActions: async () => {},
    // The kernel helper refuses a registration without an application, a save or a refresh; a stand-in that accepts
    // anything let 1.54.0 ship a registration the real helper threw on (tests/native-handoff-registration.test.js).
    registerDocumentSession: (session) => {
      if (!session.app || typeof session.prepare !== 'function' || typeof session.refresh !== 'function') throw new Error('A document handoff needs an application, save and refresh.');
      registered = session; return () => {};
    },
    document: {
      getElementById: () => ({ hidden: true, value: '', focus() {}, onclick: null, textContent: '' }),
      querySelector: () => ({ querySelectorAll: () => [] }),
    },
  };
  vm.createContext(sandbox);
  await vm.runInContext(body, sandbox);
  assert.ok(registered, 'registerDocumentSession was called');
  assert.equal(registered.app, 'intelligent-trades');
  const handoff = await registered.prepare({ app: 'trading' });
  assert.equal(handoff.app, 'intelligent-trades');
  assert.equal(handoff.screen, 'surface');
  assert.equal(handoff.surface, 'intelligent-trades-home');
  assert.equal(handoff.fields.view, 'research');
  assert.equal(handoff.fields.selectedBook, 'b-schwab1');
  assert.equal(handoff.fields.focusedSymbol, 'NVDA');
  assert.equal(handoff.fields.connectedAccountCount, '2');
  await registered.refresh();
  assert.equal(rendered, 1, 'refresh() redraws the screen');
});
