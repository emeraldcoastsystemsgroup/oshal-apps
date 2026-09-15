/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the shared brand kit contract: strict validation, readable colors, plain-language names and every template dressed completely and legibly in a brand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_ROLES, BRAND_FONTS, defaultBrandKit, validateBrandKit, logoAssetId, contrast, readableOn,
  colorName, palettePhrase, describeBrandKit } from '../../tools/editor/brand-kit.mjs';
import { TEMPLATES, createTemplate, createBrandedTemplate } from '../../tools/editor/templates.mjs';

const LOGO = '/api/create/project-assets/0f8fad5b-d9cb-469f-a165-70867728950e';
const kit = (overrides = {}) => ({ ...defaultBrandKit(), name: 'Acme Studio', ...overrides });
const KITS = {
  house: kit(),
  navy: kit({ colors: { primary: '#123abc', secondary: '#2a9d8f', accent: '#e76f51', dark: '#111827', light: '#fafaf7' }, fonts: { heading: 'Georgia', body: 'Garamond' } }),
  // A deliberately hard brand: a pale primary and a mid-tone text color.
  pastel: kit({ colors: { primary: '#f3e8ff', secondary: '#fde68a', accent: '#a7f3d0', dark: '#6b7280', light: '#ffffff' } }),
  inverted: kit({ colors: { primary: '#ff5c8a', secondary: '#7c3aed', accent: '#facc15', dark: '#fef3c7', light: '#0b1020' } }),
};

function surfaceBehind(layer, below, background) {
  const x = layer.x + layer.w / 2, y = layer.y + Math.min(layer.h, layer.fontSize) / 2;
  const hit = [...below].reverse().find(item => item.visible && ['rect', 'ellipse'].includes(item.type) && (item.type === 'rect'
    ? x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h
    : ((x - item.x - item.w / 2) / (item.w / 2)) ** 2 + ((y - item.y - item.h / 2) / (item.h / 2)) ** 2 <= 1));
  return hit ? hit.fill : background;
}

test('the default kit is valid and validation normalizes hex case and whitespace', () => {
  assert.deepEqual(validateBrandKit(defaultBrandKit()), defaultBrandKit());
  const result = validateBrandKit(kit({ name: '  Acme  ', colors: { ...defaultBrandKit().colors, primary: '#ABCDEF' } }));
  assert.equal(result.name, 'Acme'); assert.equal(result.colors.primary, '#abcdef');
  assert.deepEqual(Object.keys(result.colors), BRAND_ROLES);
});

test('validation refuses unknown fields, missing roles, foreign fonts, short hex and control characters', () => {
  const refuse = (value, pattern) => assert.throws(() => validateBrandKit(value), pattern);
  refuse({ ...kit(), owner: 'bob' }, /unsupported field/);
  refuse(kit({ colors: { primary: '#123456' } }), /six-digit hex/);
  refuse(kit({ colors: { ...defaultBrandKit().colors, extra: '#123456' } }), /unsupported field/);
  refuse(kit({ colors: { ...defaultBrandKit().colors, accent: '#abc' } }), /six-digit hex/);
  refuse(kit({ fonts: { heading: 'Comic Sans MS', body: 'Arial' } }), /supported fonts/);
  refuse(kit({ name: 'two' + String.fromCharCode(10) + 'lines' }), /one line/);
  refuse(kit({ voice: 'x'.repeat(281) }), /one line of at most 280/);
  refuse(kit({ extras: Array.from({ length: 7 }, (_, i) => ({ name: `c${i}`, hex: '#000000' })) }), /at most 6/);
  refuse({ ...kit(), version: 2 }, /Unsupported brand kit version/);
  refuse(Object.assign(Object.create({ polluted: true }), kit()), /must be an object/);
});

test('a logo must be an owned Create image reference with bounded dimensions', () => {
  assert.equal(logoAssetId(validateBrandKit(kit({ logo: { src: LOGO, width: 400, height: 200 } }))), '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.equal(logoAssetId(validateBrandKit(kit())), null);
  for (const src of ['https://remote.example/logo.png', 'data:image/png;base64,AAAA', '/api/create/project-assets/not-a-uuid', LOGO + '?x=1', LOGO.toUpperCase()]) {
    assert.throws(() => validateBrandKit(kit({ logo: { src, width: 10, height: 10 } })), /Upload the logo/);
  }
  assert.throws(() => validateBrandKit(kit({ logo: { src: LOGO, width: 0, height: 10 } })), /dimensions/);
  assert.throws(() => validateBrandKit(kit({ logo: { src: LOGO, width: 10, height: 10, owner: 'x' } })), /unsupported field/);
});

test('contrast follows WCAG and readable text prefers the brand before black or white', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(readableOn('#ffffff', KITS.navy), '#111827');
  assert.equal(readableOn('#111827', KITS.navy), '#fafaf7');
  // Neither pastel brand color reaches 4.5:1 on a mid gray, so the result falls back to pure black or white.
  assert.ok(['#000000', '#ffffff'].includes(readableOn('#8a8a8a', KITS.pastel)));
});

test('colors get plain-language names for studios that describe images in words', () => {
  const names = Object.fromEntries(['#7d2ae8', '#00c4cc', '#ff7a59', '#1d1733', '#ffffff', '#000000', '#808080', '#8b4513', '#fff3c9', '#f6d94b']
    .map(hex => [hex, colorName(hex)]));
  assert.deepEqual(names, { '#7d2ae8': 'bright violet', '#00c4cc': 'bright cyan', '#ff7a59': 'coral', '#1d1733': 'deep indigo', '#ffffff': 'white',
    '#000000': 'black', '#808080': 'gray', '#8b4513': 'brown', '#fff3c9': 'cream', '#f6d94b': 'bright yellow' });
  assert.equal(palettePhrase(KITS.house), 'bright violet, bright cyan and coral');
  assert.equal(palettePhrase(kit({ colors: { ...defaultBrandKit().colors, primary: '#ffffff', secondary: '#ffffff', accent: '#ffffff' } })), 'white');
  assert.deepEqual(Object.keys(describeBrandKit(KITS.navy).colors), BRAND_ROLES);
});

test('every template is dressed completely in each brand: only brand colors, brand faces, name and logo', () => {
  for (const [label, value] of Object.entries(KITS)) {
    const brand = validateBrandKit({ ...value, logo: { src: LOGO, width: 400, height: 200 } });
    const allowed = new Set([...Object.values(brand.colors), '#000000', '#ffffff', 'transparent']);
    for (const template of TEMPLATES) {
      const plain = createTemplate(template.id), project = createBrandedTemplate(template.id, brand);
      const colors = [project.background, ...project.layers.flatMap(layer => [layer.fill, layer.stroke].filter(Boolean))];
      assert.deepEqual(colors.filter(color => !allowed.has(color)), [], `${label}/${template.id} keeps no template color`);
      for (const layer of project.layers.filter(item => item.type === 'text')) {
        assert.equal(layer.fontFamily, layer.fontWeight >= 700 ? brand.fonts.heading : brand.fonts.body, `${label}/${template.id}/${layer.name} face`);
      }
      const logo = project.layers.filter(layer => layer.name === 'Brand logo');
      assert.equal(logo.length, 1, `${label}/${template.id} has one logo layer`);
      assert.equal(project.layers.length, plain.layers.length + 1);
      const [mark] = logo;
      assert.ok(mark.x >= 0 && mark.y >= 0 && mark.x + mark.w <= project.width + 0.001 && mark.y + mark.h <= project.height + 0.001, `${template.id} logo stays on the canvas`);
      assert.ok(Math.abs(mark.w / mark.h - 2) < 0.001, `${template.id} logo keeps its aspect ratio`);
      assert.deepEqual(project.images[logoAssetId(brand)], brand.logo);
    }
  }
});

test('branded text stays readable against whatever it sits on', () => {
  for (const [label, value] of Object.entries(KITS)) {
    for (const template of TEMPLATES) {
      const project = createBrandedTemplate(template.id, value);
      project.layers.forEach((layer, index) => {
        if (layer.type !== 'text') return;
        const behind = surfaceBehind(layer, project.layers.slice(0, index), project.background);
        assert.ok(contrast(layer.fill, behind) >= 3, `${label}/${template.id}/${layer.name}: ${layer.fill} on ${behind}`);
      });
    }
  }
});

test('the signature line carries the brand name, and an unnamed brand keeps the template words', () => {
  const named = createBrandedTemplate('presentation-title', kit({ name: 'Northwind' }));
  assert.equal(named.layers.find(layer => layer.name === 'Presenter name').text, 'PRESENTED BY NORTHWIND');
  const square = createBrandedTemplate('square-announcement', kit({ name: 'Northwind' }));
  assert.equal(square.layers.find(layer => layer.name === 'Brand signature').text, 'NORTHWIND');
  const unnamed = createBrandedTemplate('square-announcement', kit({ name: '' }));
  assert.equal(unnamed.layers.find(layer => layer.name === 'Brand signature').text, createTemplate('square-announcement').layers.find(layer => layer.name === 'Brand signature').text);
});

test('branding never alters the catalog, shares layers between copies or accepts an invalid kit', () => {
  const before = JSON.stringify(createTemplate('quote-card').layers.map(({ id, ...rest }) => rest));
  const first = createBrandedTemplate('quote-card', KITS.navy), second = createBrandedTemplate('quote-card', KITS.navy);
  assert.notEqual(first.layers[0].id, second.layers[0].id);
  first.layers[0].fill = '#000000'; assert.notEqual(second.layers[0].fill, '#000000');
  assert.equal(JSON.stringify(createTemplate('quote-card').layers.map(({ id, ...rest }) => rest)), before);
  assert.throws(() => createBrandedTemplate('quote-card', { ...KITS.navy, fonts: { heading: 'Papyrus', body: 'Arial' } }), /supported fonts/);
  assert.throws(() => createBrandedTemplate('missing-template', KITS.navy), /available image template/);
  assert.ok(BRAND_FONTS.includes(createBrandedTemplate('event-flyer', KITS.navy).layers.find(layer => layer.type === 'text').fontFamily));
});
