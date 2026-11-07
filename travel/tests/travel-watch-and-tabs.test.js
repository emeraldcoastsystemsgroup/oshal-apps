/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (travel--travel-concierge): Watch never showed that it was watching, the Flights/Hotels/Cars tabs were divs no keyboard could reach, cabins read 'premium_economy', the greeting's example date had passed, and the shell's orb sat on the concierge's Send. The guard EXECUTES the shipped watchThis(), renderWatches() and stopWatching(): after the server stores a watch the button reads Watching with aria-pressed=true and the Watched routes list shows it with Stop watching; a refused watch leaves the button alone and says so. It also checks the tabs are role=tab buttons, the cabin words, a greeting without a fixed date, and hideAssistant in the manifest.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.2: assert the phone half-sheet Travel concierge opened from one 48px neutral button instead of sitting below the form.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PKG, 'tools', 'travel-app.html'), 'utf8');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

function extract(source, name) {
  const decl = new RegExp(`^const ${name} = `, 'm').exec(source);
  if (decl) return source.slice(decl.index, source.indexOf(';\n', decl.index) + 1);
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}

function page(answers) {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', hidden: false }); return els.get(id); };
  const bubbles = [];
  const calls = [];
  const sandbox = {
    String, Object, JSON, Error, Promise, encodeURIComponent,
    document: { getElementById: get },
    addBubble: (who, text) => bubbles.push(text),
    api: async (p, opts) => { calls.push({ p, method: (opts && opts.method) || 'GET' }); const a = answers(p, (opts && opts.method) || 'GET'); if (a instanceof Error) throw a; return a; },
  };
  vm.createContext(sandbox);
  const code = ['esc', 'CABINS', 'cabinWords', 'watchThis', 'watchLine', 'renderWatches', 'loadWatches', 'stopWatching'].map((n) => extract(html, n)).join('\n') +
    '\nlet KIND = "flight"; let LAST = { search: { origin: "VPS", destination: "DCA", departDate: "2026-12-04", cabin: "premium_economy" }, items: [] };' +
    '\nglobalThis.__t = { watchThis, stopWatching };';
  vm.runInContext(code, sandbox);
  return { t: sandbox.__t, get, bubbles, calls };
}

const WATCH = { watch_id: 'w1', kind: 'flight', status: 'active', last_price: 212, query: { origin: 'VPS', destination: 'DCA', departDate: '2026-12-04', cabin: 'premium_economy' } };

test('Watch turns into Watching (aria-pressed) once the server stored it, and the Watched routes list shows it', async () => {
  const p = page((path, method) => method === 'POST' ? { watch: WATCH } : { items: [WATCH] });
  const btn = { textContent: 'Watch', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, disabled: false };
  await p.t.watchThis('off1', 212, btn);
  assert.equal(btn.textContent, 'Watching');
  assert.equal(btn.attrs['aria-pressed'], 'true');
  assert.equal(p.get('watched').hidden, false);
  assert.match(p.get('watched').innerHTML, /<h3>Watched routes<\/h3>/);
  assert.match(p.get('watched').innerHTML, /VPS → DCA · 2026-12-04 · Premium economy · last \$212/);
  assert.match(p.get('watched').innerHTML, /stopWatching\('w1'\)">Stop watching</);
});

test('Stop watching deletes the watch and the list follows the server', async () => {
  const p = page((path, method) => method === 'DELETE' ? { items: [] } : { items: [WATCH] });
  await p.t.stopWatching('w1');
  assert.ok(p.calls.some((c) => c.method === 'DELETE' && c.p === '/watches/w1'));
  assert.equal(p.get('watched').hidden, true);
});

test('a watch the server did not store leaves the button as Watch and says so', async () => {
  const p = page(() => Object.assign(new Error('HTTP 500'), { status: 500 }));
  const btn = { textContent: 'Watch', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, disabled: false };
  await p.t.watchThis('off1', 212, btn);
  assert.equal(btn.textContent, 'Watch');
  assert.equal(btn.attrs['aria-pressed'], undefined);
  assert.match(p.bubbles.join('\n'), /The watch was not saved: HTTP 500\./);
});

test('the trip tabs are keyboard-reachable tab buttons, cabins read in words, and the greeting names no past date', () => {
  const tabs = [...html.matchAll(/<button type="button" class="tab[^"]*" role="tab" aria-selected="(true|false)"[^>]*data-kind="(\w+)"/g)].map((m) => m[2]);
  assert.deepEqual(tabs, ['flight', 'hotel', 'car']);
  assert.match(html, /role="tablist"/);
  assert.match(html, /premium_economy:'Premium economy'/);
  assert.doesNotMatch(html, /<option>premium_economy<\/option>/);
  assert.doesNotMatch(html, /e\.g\. "VPS to DCA on 20\d\d-\d\d-\d\d"/);
  assert.match(html, /id="f_swap" onclick="swapPlaces\(\)"/);
});

test('one assistant entry: the manifest hides the shell orb so the in-page concierge is the entry', () => {
  assert.match(manifest, /^ribbon:[\s\S]*?^ {2}hideAssistant: true$/m);
});

test('phone layout opens Travel concierge as a half sheet from one 48px neutral button', () => {
  assert.match(html, /id="conciergeOpen"[^>]*class="concierge-open-btn"[^>]*onclick="toggleConcierge\(true\)"/);
  assert.match(html, /\.concierge-open-btn\{[^}]*height:48px;min-height:48px;[^}]*background:var\(--panel\);color:var\(--text\)/);
  assert.match(html, /@media \(max-width:820px\)\{[\s\S]*?\.right\{position:fixed;left:0;right:0;bottom:0;max-height:62dvh;[\s\S]*?display:none;/);
  assert.match(html, /body\.concierge-open \.right\{display:flex;\}/);
});
