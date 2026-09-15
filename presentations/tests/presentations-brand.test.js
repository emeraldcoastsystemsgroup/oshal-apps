/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove AI Office's use of the Create brand kit with the surface's own code: a session-scoped bounded read, the nearest look by hue, canvas and fonts, a chosen look never replaced, the byline and the brand voice.
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

function load(options = {}) {
  const els = { byline: { value: options.byline || '' }, brandVoiceRow: { hidden: true }, brandVoiceText: { textContent: '' }, useBrandVoice: { checked: options.voiceOn !== false } };
  const calls = [];
  const context = {
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(options.reply ? { ok: true, json: () => Promise.resolve(options.reply) } : { ok: false }); },
    AbortSignal: { timeout: ms => ({ ms }) }, $: id => els[id], THEMES: options.themes || [], THEME: options.theme ?? null,
    renderThemes() {}, renderWizThemes() {}, renderWizChips() {}, pvKick() {}, String, Math, parseInt,
  };
  vm.createContext(context);
  vm.runInContext(BLOCK + ';globalThis.__brand = { BRAND, applyBrand, brandLook, brandTopic, brandReady, choose: () => { themeChosen = true; } };', context);
  return { brand: context.__brand, els, calls, context };
}

const theme = (id, accent, accent2, darkCanvas, heading = 'Calibri', body = 'Calibri') => ({ id, darkCanvas, fonts: { heading, body }, colors: { accent, accent2 } });
const kit = (primary, secondary, light, fonts = { heading: 'Arial', body: 'Arial' }) => ({ name: 'Northwind', voice: '', fonts,
  colors: { primary, secondary, accent: '#ff7a59', dark: '#111827', light } });
const LOOKS = [theme('violet-light', '7D2AE8', '00C4CC', false), theme('violet-dark', '7C6CFF', '00D3A7', true), theme('orange-light', 'FF6B4A', 'F2A93B', false),
  theme('serif-violet', '8338EC', '00B4D8', false, 'Georgia', 'Garamond')];

test('the kit is read once in the viewer session with a bounded wait; a refusal changes nothing', async () => {
  const { brand, calls, els } = load();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/create/brand-kit');
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.deepEqual(calls[0].init.signal, { ms: 4000 });
  await brand.brandReady; brand.applyBrand();
  assert.equal(brand.BRAND.kit, null); assert.equal(els.byline.value, ''); assert.equal(els.brandVoiceRow.hidden, true);
});

test('the nearest look follows hue, then canvas darkness, then shared fonts', () => {
  const { brand } = load();
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#ffffff'), LOOKS).id, 'violet-light');
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#0b1020'), LOOKS).id, 'violet-dark');
  assert.equal(brand.brandLook(kit('#f25c3b', '#f0a030', '#fff8f0'), LOOKS).id, 'orange-light');
  assert.equal(brand.brandLook(kit('#8338ec', '#00b4d8', '#ffffff', { heading: 'Georgia', body: 'Garamond' }), LOOKS).id, 'serif-violet');
  assert.equal(brand.brandLook(kit('#7d2ae8', '#00c4cc', '#ffffff'), []), null);
});

test('with nothing chosen the nearest look is picked; a chosen look is kept and only badged', async () => {
  const reply = { kit: kit('#7d2ae8', '#00c4cc', '#ffffff') };
  const fresh = load({ themes: LOOKS, reply });
  await fresh.brand.brandReady; fresh.brand.applyBrand();
  assert.equal(fresh.context.THEME, 'violet-light'); assert.equal(fresh.brand.BRAND.look, 'violet-light');
  const chosen = load({ themes: LOOKS, reply, theme: 'orange-light' });
  chosen.brand.choose(); await chosen.brand.brandReady; chosen.brand.applyBrand();
  assert.equal(chosen.context.THEME, 'orange-light'); assert.equal(chosen.brand.BRAND.look, 'violet-light');
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

test('the surface wires the brand into its picker, drafts and boot without moving the pinned boot line', () => {
  assert.match(html, /function pickTheme\(id\)\{ THEME = id; themeChosen = true; renderThemes\(\); pvKick\(\); \}/);
  assert.match(html, /Promise\.all\(\[themesReady, brandReady\]\)\.then\(applyBrand\);/);
  assert.match(html, /renderKinds\(\); renderTemplates\(\); loadThemes\(\); loadDecks\(\); refreshDest\(\);/);
  assert.equal((html.match(/Closest to your brand/g) || []).length, 2, 'both theme galleries badge the nearest look');
  assert.equal((html.match(/topic: brandTopic\(topic\)/g) || []).length, 2, 'both AI draft paths use the brand voice');
  for (const id of ['brandVoiceRow', 'useBrandVoice', 'brandVoiceText']) assert.ok(html.includes(`id="${id}"`), id);
});
