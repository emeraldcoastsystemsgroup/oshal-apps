/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Home card case loads the route as the store's market summary contract does (scripts/market-home.test.cjs: nothing but express may be required) and holds its own copy of the words equal to edgeWord for every rating. The first 1.10.2 imported the words into the Home route and failed that contract in the store gate.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.2, @lane-qa1 on the test slot (2026-11-16 22:47Z): 1.10.0's plain words stopped short. Settings still said "Minimum hand strength to alert on" and "Tell Jarvis when new playable hands appear", and the Jarvis alert said "Kalshi: N new playable hands". This guard fails when any person-facing string in the package says hand, playable, monster or fold: the page's markup, its attributes and every string literal with words in it (code identifiers, regular expressions and comments are not read); every such literal in the route sources and their compiled twins (SQL is not read); the manifest's fields a person reads (name, description, briefing, settings labels, schedule words, menu and hand-off labels, tool names); the catalog entry; the quant's role; the user guide and the Home note. It also RUNS the strings built from values for every rating: the Jarvis alert (subject, body, short text), the Why walkthrough (headline, reasons, the question put to the quant) and the Home card's note. Not read: the README and SCHEMA (for developers), tests, migrations, data, and the quant's instructions and routing words (what the model reads, not what a person reads).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const OLD_WORDS = /\b(hands?|playable|monsters?|folds?|folded|folding)\b/i;
const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/i;
const RATINGS = ['monster', 'strong', 'playable', 'fold', 'not-evaluable'];

/** @description js-yaml from the browser dependencies the gate names, else the store toolchain; missing is a failure. */
function yaml() {
  const roots = [process.env.KALSHI_BROWSER_DEPS && path.join(process.env.KALSHI_BROWSER_DEPS, 'node_modules'), path.resolve(PKG, '../scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'js-yaml'))) return require(path.join(root, 'js-yaml'));
  throw new Error('js-yaml not found (npm ci --prefix scripts/toolchain); tried ' + roots.join(', '));
}

/** @description The end of a quoted string that starts at i. */
function quoted(src, i, quote) { let j = i + 1; while (j < src.length && src[j] !== quote && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; return j; }
/** @description The end of a regular expression literal that starts at i (with its flags). */
function regex(src, i) {
  let j = i + 1, inClass = false;
  while (j < src.length && src[j] !== '\n') { const c = src[j]; if (c === '\\') { j += 2; continue; } if (c === '[') inClass = true; else if (c === ']') inClass = false; else if (c === '/' && !inClass) break; j += 1; }
  j += 1; while (/[a-z]/i.test(src[j] || '')) j += 1;
  return j;
}

/**
 * @description Every string literal of a JavaScript or TypeScript source, with a template's text (its ${...} parts read on
 * their own). Comments and regular expressions are skipped, so only text the code can show is returned.
 * @param {string} src The source. @returns {Array<{text: string, line: number}>} The literals.
 */
function literals(src) {
  const out = [], lineAt = (k) => src.slice(0, k).split('\n').length;
  let i = 0, prev = '', word = '';
  const template = (start) => { let j = start + 1, text = ''; while (j < src.length && src[j] !== '`') { if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; } else if (src[j] === '$' && src[j + 1] === '{') { text += ' '; j = expression(j + 2); } else { text += src[j]; j += 1; } } out.push({ text, line: lineAt(start) }); return j + 1; };
  const expression = (j) => { let depth = 1; while (j < src.length && depth) { const c = src[j]; if (c === '{') depth += 1; else if (c === '}') depth -= 1; else if (c === '"' || c === "'") { const e = quoted(src, j, c); out.push({ text: src.slice(j + 1, e), line: lineAt(j) }); j = e; } else if (c === '`') j = template(j) - 1; j += 1; } return j; };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'") { const e = quoted(src, i, c); out.push({ text: src.slice(i + 1, e), line: lineAt(i) }); i = e + 1; prev = 'a'; word = ''; continue; }
    if (c === '`') { i = template(i); prev = 'a'; word = ''; continue; }
    if (c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || ['return', 'typeof', 'case'].includes(word))) { i = regex(src, i); prev = 'a'; word = ''; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) { word = /[A-Za-z0-9_$]/.test(prev) ? word + c : c; prev = c; i += 1; continue; }
    if (!/\s/.test(c)) { prev = c; word = ''; }
    i += 1;
  }
  return out;
}

/** @description The literals of a source that a person can read: words with spaces, not SQL, saying an old word. */
function oldWordsInCode(file, src) {
  return literals(src).filter((l) => /\s/.test(l.text.trim()) && !SQL.test(l.text) && OLD_WORDS.test(l.text)).map((l) => `${file}:${l.line} "${l.text.replace(/\s+/g, ' ').trim().slice(0, 100)}"`);
}

/** @description The page: its markup text, the attributes a person reads, and its scripts' literals. */
function oldWordsInPage(file) {
  const html = fs.readFileSync(path.join(PKG, file), 'utf8'), found = [];
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) found.push(...oldWordsInCode(file, m[1]));
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of markup.matchAll(/>([^<]+)</g)) if (OLD_WORDS.test(m[1])) found.push(`${file} text "${m[1].replace(/\s+/g, ' ').trim().slice(0, 100)}"`);
  for (const m of markup.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)) if (OLD_WORDS.test(m[2])) found.push(`${file} ${m[1]} "${m[2]}"`);
  return found;
}

/** @description Prose of a Markdown file a person reads: everything but code blocks and inline code. */
function oldWordsInProse(file) {
  const prose = fs.readFileSync(path.join(PKG, file), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return prose.split('\n').map((line, i) => ({ line, i })).filter(({ line }) => OLD_WORDS.test(line)).map(({ line, i }) => `${file}:${i + 1} "${line.trim().slice(0, 100)}"`);
}

/** @description The manifest's fields a person reads, with where each is. */
function personFields(manifest) {
  const s = manifest.settings && manifest.settings.schema || {};
  return [['displayName', manifest.displayName], ['description', manifest.description]]
    .concat((manifest.briefings || []).flatMap((b) => [[`briefings.${b.id}.title`, b.title], [`briefings.${b.id}.description`, b.description]]))
    .concat(Object.keys(s).flatMap((k) => [[`settings.${k}.label`, s[k].label], [`settings.${k}.description`, s[k].description]]))
    .concat((manifest.schedules || []).flatMap((x) => [[`schedules.${x.id}.description`, x.description], [`schedules.${x.id}.offer`, x.offer]]))
    .concat(((manifest.ui || {}).static || []).map((x) => [`ui.${x.toolName}.label`, x.label]))
    .concat(((manifest.integrations || {}).offers || []).map((x) => [`integrations.${x.id}.label`, x.label]))
    .concat((manifest.tools || []).map((x) => [`tools.${x.name}.displayName`, x.displayName]))
    .filter(([, value]) => typeof value === 'string');
}

test('no person-facing string in the package says hand, playable, monster or fold', () => {
  const y = yaml(), found = [];
  found.push(...oldWordsInPage('tools/kalshi.html'));
  for (const dir of ['src-routes', 'routes', 'lib']) {
    for (const name of fs.readdirSync(path.join(PKG, dir)).filter((f) => /\.(ts|js)$/.test(f))) found.push(...oldWordsInCode(`${dir}/${name}`, fs.readFileSync(path.join(PKG, dir, name), 'utf8')));
  }
  for (const [where, value] of personFields(y.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8')))) if (OLD_WORDS.test(value)) found.push(`oshal-app.yaml ${where} "${value.replace(/\s+/g, ' ').slice(0, 100)}"`);
  const persona = y.load(fs.readFileSync(path.join(PKG, 'personas', 'kalshi-quant.yaml'), 'utf8'));
  if (OLD_WORDS.test(persona.role)) found.push(`personas/kalshi-quant.yaml role "${persona.role}"`);
  const entry = JSON.parse(fs.readFileSync(path.join(PKG, '..', 'marketplace.json'), 'utf8'));
  const app = (entry.apps || entry.packages || entry).find ? (entry.apps || entry.packages || entry).find((a) => a.name === 'kalshi') : null;
  assert.ok(app, 'the catalog lists kalshi');
  for (const key of ['displayName', 'description']) if (OLD_WORDS.test(app[key])) found.push(`marketplace.json kalshi ${key} "${app[key].match(/[^.]*\b(hands?|playable|monsters?|folds?)\b[^.]*/i)[0].trim()}"`);
  for (const doc of ['docs/USER-GUIDE.md', 'HOME.md']) found.push(...oldWordsInProse(doc));
  assert.deepEqual(found, [], `old words a person reads:\n${found.join('\n')}`);
});

/** @description A compiled route module with its framework imports stubbed (the pure modules import none). */
function compiled(name, stubs = {}) {
  const file = path.join(PKG, 'routes', name), load = Module._load;
  Module._load = function stubbed(request, ...rest) { if (Object.hasOwn(stubs, request)) return stubs[request]; return request.startsWith('@/') ? {} : load.call(this, request, ...rest); };
  try { delete require.cache[require.resolve(file)]; return require(file); } finally { Module._load = load; }
}

const hand = (strength, i = 0) => ({ ticker: `KXFIX-26NOV17-T${i}`, title: `Synthetic market ${i}`, side: i % 2 ? 'no' : 'yes', strength, price: 0.51, trueProb: 0.64, edgeNet: 0.125, stakeFraction: 0, riskFlags: [] });

test('the Jarvis alert says markets with an edge and each rating in words, for every rating and count', () => {
  const { formatAlert } = compiled('kalshi-scan-config.js');
  const words = { monster: 'Big edge', strong: 'Good edge', playable: 'Small edge' };
  for (const strength of ['monster', 'strong', 'playable']) {
    for (const hands of [[hand(strength)], [hand(strength, 0), hand('playable', 1)]]) {
      for (const mayStake of [false, true]) {
        const msg = formatAlert(hands, { evaluable: 1500, mayStake });
        const all = [msg.subject, msg.body, msg.shortText].join('\n');
        assert.doesNotMatch(all, OLD_WORDS, `alert for ${strength} x${hands.length}: ${all}`);
        assert.match(msg.subject, hands.length === 1 ? /^Kalshi: 1 new market with an edge \(/ : /^Kalshi: 2 new markets with an edge$/);
        assert.match(msg.body, new RegExp(`\\[${words[strength]}\\] `), 'each market says its rating in words');
        assert.ok(msg.shortText.length <= 160, 'the text message still fits');
      }
    }
  }
});

test('the Why walkthrough, its headline and the question put to the quant say every rating in words', () => {
  const { explainMarket } = compiled('kalshi-market-explainer.js');
  const lead = { monster: 'Big edge', strong: 'Good edge', playable: 'Small edge', fold: 'No edge', 'not-evaluable': 'No estimate' };
  for (const rating of RATINGS) {
    const h = rating === 'not-evaluable' ? null : { ...hand(rating), feePerContract: 0.017, calibrationN: 140, confidence: 0.8, kellyFraction: 0.08, edgeNet: rating === 'fold' ? 0.004 : 0.125 };
    const m = { ticker: 'KXFIX-26NOV17-T0', title: 'Synthetic market', category: 'Climate and Weather', closeTime: new Date(Date.now() + 36e5).toISOString(), yesAsk: 0.51, noAsk: 0.5,
      yesBid: 0.5, noBid: 0.49, volume: 900, liquidity: 900, openInterest: 300, hand: h, notEvaluable: h ? null : 'it is a parlay leg (a multivariate market), which the evaluator never prices' };
    const why = explainMarket(m, { mayStake: false, gateReason: 'No strategy has 30 settled predictions yet.', calibrationGeneratedAt: '2026-07-13T05:39:26.578Z' });
    assert.equal(why.verdict, rating, 'the rating itself is unchanged');
    assert.ok(why.headline.startsWith(lead[rating] + ':'), `headline leads with "${lead[rating]}": ${why.headline}`);
    for (const text of [why.headline, why.question, ...why.reasons]) assert.doesNotMatch(text, OLD_WORDS, `${rating}: ${text}`);
  }
});

test('the Home card names a recorded alert\'s rating in the same words as the alert, and its route loads nothing but express', async () => {
  let handler = null;
  const loaded = [];
  const express = { Router: () => ({ get: (route, fn) => { handler = fn; } }) };
  const file = path.join(PKG, 'routes', 'home-summary.js'), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))((name) => { loaded.push(name); return name === 'express' ? express : {}; }, module, module.exports);
  assert.deepEqual(loaded, ['express'], 'the Home summary keeps its words itself (scripts/market-home.test.cjs loads it with express only)');
  const { edgeWord } = compiled('kalshi-scan-config.js');
  const rows = { counts: [{ day: '5', five: '5', delivered: '2' }], alerts: RATINGS.map((strength, i) => ({ ticker: 'KXFIX-' + i, strength, delivered: i > 0, created_at: new Date() })), orders: [] };
  const pool = { query: async ({ text }) => ({ rows: /count\(\*\)/.test(text) ? rows.counts : /kalshi_scan_alerts/.test(text) ? rows.alerts : rows.orders }) };
  module.exports.createHomeSummaryRoutes({ pool });
  let body = null;
  const res = { setHeader() {}, status() { return this; }, json(b) { body = b; } };
  await handler({ oidc: { user: { sub: 'synthetic-person' }, isAuthenticated: () => true } }, res);
  assert.equal(body.items.length, RATINGS.length, 'the card lists each recorded alert');
  RATINGS.forEach((rating, i) => {
    assert.doesNotMatch(`${body.items[i].text}\n${body.items[i].detail}`, OLD_WORDS, body.items[i].detail);
    assert.match(body.items[i].detail, new RegExp(`, rated ${edgeWord(rating)}, `), `${rating} reads as the alert reads it`);
  });
});
