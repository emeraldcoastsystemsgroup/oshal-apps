/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove AI Office's use of the Create brand kit with the surface's own code: a session-scoped bounded read, the nearest look by hue, canvas and fonts, a chosen look never replaced, the byline and the brand voice.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.13.0 brand looks: the exact look is asked for on the nearest look's layout with the kit's roles and faces, leads the looks and is picked only when nothing chose one; a refused or unreachable brand look leaves the nearest built-in look; renders and sends carry the kit for the brand look and an id otherwise; a saved brand look reopens as today's brand look.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SURFACE = path.join(__dirname, '..', 'tools', 'presentations.html');
const html = fs.readFileSync(SURFACE, 'utf8');
const start = html.indexOf("// ── Your brand: Create's brand kit");
const end = html.indexOf('\n}\n', html.indexOf('function brandTopic(topic)')) + 3;
const BLOCK = html.slice(start, end);
const KIT_URL = '/api/create/brand-kit';
const LOOK_URL = '/api/presentations/sections/brand-look';

/** A fetch reply: a JSON body with ok, or a refusal status, or a network failure. */
function reply(answer) {
  if (answer === 'network') return Promise.reject(new Error('offline'));
  if (!answer) return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid_brand_look' }) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve(answer) });
}

function load(options = {}) {
  const els = { byline: { value: options.byline || '' }, brandVoiceRow: { hidden: true }, brandVoiceText: { textContent: '' }, useBrandVoice: { checked: options.voiceOn !== false } };
  const calls = [];
  const context = {
    fetch: (url, init) => { calls.push({ url, init }); return reply(url === LOOK_URL ? options.look : options.reply); },
    AbortSignal: { timeout: ms => ({ ms }) }, $: id => els[id], THEMES: options.themes || [], THEME: options.theme ?? null,
    renderThemes() {}, renderWizThemes() {}, renderWizChips() {}, pvKick() {}, String, Math, parseInt,
  };
  vm.createContext(context);
  vm.runInContext(BLOCK + ';globalThis.__brand = { BRAND, applyBrand, brandLook, brandTopic, brandReady, lookOpts, savedLook, choose: () => { themeChosen = true; } };', context);
  return { brand: context.__brand, els, calls, context };
}

const theme = (id, accent, accent2, darkCanvas, heading = 'Calibri', body = 'Calibri') => ({ id, darkCanvas, fonts: { heading, body }, colors: { accent, accent2 } });
const kit = (primary, secondary, light, fonts = { heading: 'Arial', body: 'Arial' }) => ({ name: 'Northwind', voice: '', fonts,
  colors: { primary, secondary, accent: '#ff7a59', dark: '#111827', light } });
const LOOKS = [theme('violet-light', '7D2AE8', '00C4CC', false), theme('violet-dark', '7C6CFF', '00D3A7', true), theme('orange-light', 'FF6B4A', 'F2A93B', false),
  theme('serif-violet', '8338EC', '00B4D8', false, 'Georgia', 'Garamond')];
const BRAND_LOOK = { ...theme('brand:violet-light', '7D2AE8', '00C4CC', false, 'Arial', 'Arial'), name: 'Your brand' };

test('the kit is read once in the viewer session with a bounded wait; a refusal changes nothing', async () => {
  const { brand, calls, els } = load();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, KIT_URL);
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.deepEqual(calls[0].init.signal, { ms: 4000 });
  await brand.brandReady; brand.applyBrand();
  assert.equal(brand.BRAND.kit, null); assert.equal(els.byline.value, ''); assert.equal(els.brandVoiceRow.hidden, true);
  assert.equal(calls.length, 1, 'no kit, no brand look asked for');
});

test('the nearest look follows hue, then canvas darkness, then shared fonts', () => {
  const { brand } = load();
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#ffffff'), LOOKS).id, 'violet-light');
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#0b1020'), LOOKS).id, 'violet-dark');
  assert.equal(brand.brandLook(kit('#f25c3b', '#f0a030', '#fff8f0'), LOOKS).id, 'orange-light');
  assert.equal(brand.brandLook(kit('#8338ec', '#00b4d8', '#ffffff', { heading: 'Georgia', body: 'Garamond' }), LOOKS).id, 'serif-violet');
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#ffffff'), []), null);
});

test('the exact brand look is asked for on the nearest look, leads the looks and is picked when nothing chose one', async () => {
  // An orange kit: its nearest look is the third of the four, so the base sent is the nearest, not the first.
  const myKit = kit('#f25c3b', '#f0a030', '#fff8f0');
  const fresh = load({ themes: LOOKS, reply: { kit: myKit }, look: { look: { ...BRAND_LOOK, id: 'brand:orange-light' } } });
  await fresh.brand.brandReady; fresh.brand.applyBrand();
  assert.equal(fresh.context.THEME, 'orange-light', 'the nearest built-in look is picked while the brand look is on its way');
  await fresh.brand.BRAND.ready;
  const ask = fresh.calls.find((c) => c.url === LOOK_URL);
  assert.equal(ask.init.method, 'POST'); assert.equal(ask.init.credentials, 'same-origin'); assert.deepEqual(ask.init.signal, { ms: 4000 });
  assert.deepEqual(JSON.parse(ask.init.body), { base: 'orange-light', colors: myKit.colors, fonts: myKit.fonts });
  assert.equal(fresh.context.THEME, 'brand:orange-light'); assert.equal(fresh.brand.BRAND.look, 'orange-light');
  assert.deepEqual([...fresh.context.THEMES.map((t) => t.id)], ['brand:orange-light', ...LOOKS.map((t) => t.id)]);
});

test('a chosen look is kept and only badged; the brand look is offered beside it', async () => {
  const chosen = load({ themes: LOOKS, reply: { kit: kit('#7d2ae8', '#00c4cc', '#ffffff') }, look: { look: BRAND_LOOK }, theme: 'orange-light' });
  chosen.brand.choose(); await chosen.brand.brandReady; chosen.brand.applyBrand(); await chosen.brand.BRAND.ready;
  assert.equal(chosen.context.THEME, 'orange-light'); assert.equal(chosen.brand.BRAND.look, 'violet-light');
  assert.equal(chosen.context.THEMES[0].id, 'brand:violet-light');
});

test('a refused or unreachable brand look leaves the nearest built-in look picked', async () => {
  for (const look of [null, 'network', { look: { ...BRAND_LOOK, id: 'violet-light' } }]) {
    const run = load({ themes: LOOKS, reply: { kit: kit('#7d2ae8', '#00c4cc', '#ffffff') }, look });
    await run.brand.brandReady; run.brand.applyBrand(); await run.brand.BRAND.ready;
    assert.equal(run.context.THEME, 'violet-light', JSON.stringify(look)); assert.equal(run.brand.BRAND.theme, null);
    assert.deepEqual([...run.context.THEMES.map((t) => t.id)], LOOKS.map((t) => t.id));
  }
});

test('renders and sends carry the kit for the brand look and an id for any other', async () => {
  const myKit = kit('#7d2ae8', '#00c4cc', '#ffffff');
  const run = load({ themes: LOOKS, reply: { kit: myKit }, look: { look: BRAND_LOOK } });
  await run.brand.brandReady; run.brand.applyBrand(); await run.brand.BRAND.ready;
  assert.deepEqual(JSON.parse(JSON.stringify(run.brand.lookOpts())), { brand: { base: 'violet-light', colors: myKit.colors, fonts: myKit.fonts } });
  run.context.THEME = 'orange-light';
  assert.deepEqual(JSON.parse(JSON.stringify(run.brand.lookOpts())), { theme: 'orange-light' });
  const none = load({ themes: LOOKS });
  none.context.THEME = 'brand:violet-light';
  assert.deepEqual(JSON.parse(JSON.stringify(none.brand.lookOpts())), { theme: 'brand:violet-light' }, 'without a built brand look nothing claims to be one');
});

test('a saved brand look reopens as today\'s brand look, or not at all', async () => {
  const run = load({ themes: LOOKS, reply: { kit: kit('#7d2ae8', '#00c4cc', '#ffffff') }, look: { look: BRAND_LOOK } });
  await run.brand.brandReady; run.brand.applyBrand(); await run.brand.BRAND.ready;
  assert.equal(run.brand.savedLook('brand:forest'), 'brand:violet-light');
  assert.equal(run.brand.savedLook('executive'), 'executive');
  const none = load({ themes: LOOKS });
  assert.equal(none.brand.savedLook('brand:forest'), null);
  assert.equal(none.brand.savedLook('paper'), 'paper');
});

test('the brand name fills only an empty byline, and the voice rides AI drafts only while switched on', async () => {
  const withVoice = { kit: { ...kit('#7d2ae8', '#00c4cc', '#ffffff'), voice: 'Warm and plain-spoken.' } };
  const empty = load({ themes: LOOKS, reply: withVoice });
  await empty.brand.brandReady; empty.brand.applyBrand();
  assert.equal(empty.els.byline.value, 'Northwind'); assert.equal(empty.els.brandVoiceRow.hidden, false);
  assert.equal(empty.els.brandVoiceText.textContent, '“Warm and plain-spoken.”');
  assert.equal(empty.brand.brandTopic('Q3 results'), 'Q3 results (written for Northwind, in this voice: Warm and plain-spoken.)');
  const typed = load({ themes: LOOKS, reply: withVoice, byline: 'Jane Doe', voiceOn: false });
  await typed.brand.brandReady; typed.brand.applyBrand();
  assert.equal(typed.els.byline.value, 'Jane Doe'); assert.equal(typed.brand.brandTopic('Q3 results'), 'Q3 results');
  const quiet = load({ themes: LOOKS, reply: { kit: kit('#7d2ae8', '#00c4cc', '#ffffff') } });
  await quiet.brand.brandReady; quiet.brand.applyBrand();
  assert.equal(quiet.els.brandVoiceRow.hidden, true); assert.equal(quiet.brand.brandTopic('Q3 results'), 'Q3 results');
});

test('the surface wires the brand into its picker, drafts, renders, sends and reopens without moving the pinned boot line', () => {
  assert.match(html, /function pickTheme\(id\)\{ THEME = id; themeChosen = true; renderThemes\(\); pvKick\(\); \}/);
  assert.match(html, /Promise\.all\(\[themesReady, brandReady\]\)\.then\(applyBrand\);/);
  assert.match(html, /renderKinds\(\); renderTemplates\(\); loadThemes\(\); loadDecks\(\); refreshDest\(\);/);
  assert.equal((html.match(/Closest to your brand/g) || []).length, 2, 'both theme galleries badge the nearest look');
  assert.equal((html.match(/topic: brandTopic\(topic\)/g) || []).length, 2, 'both AI draft paths use the brand voice');
  assert.match(html, /function deckOpts\(\)\{\n  const dest = \$\('saveTo'\)\.value;\n  return \{\n    \.\.\.lookOpts\(\),/, 'Generate carries the look');
  assert.match(html, /format: KIND,\n        \.\.\.lookOpts\(\), byline:/, 'Email carries the look');
  assert.equal((html.match(/const saved = savedLook\(d\.theme\); if \(saved\) pickTheme\(saved\);/g) || []).length, 2, 'both reopen paths map a saved brand look');
  assert.equal((html.match(/theme: THEME \|\| undefined/g) || []).length, 1, 'only lookOpts sends a bare theme id');
  for (const id of ['brandVoiceRow', 'useBrandVoice', 'brandVoiceText']) assert.ok(html.includes(`id="${id}"`), id);
});
