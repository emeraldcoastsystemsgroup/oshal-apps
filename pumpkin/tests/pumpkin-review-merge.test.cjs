/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (pumpkin--pumpkin-review, MERGE): verify pumpkin-review is removed from ui.static so pumpkin-control is the first tile while routes/review.js remains mounted; verify the 67-word disclaimer and "Refresh evidence" are gone from every person-facing view; verify tools/pumpkin-app.html renders Saved lines with saved/pinned counts, pinned-first order, and "Play on the projector" actions.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const controlHtml = fs.readFileSync(path.join(ROOT, 'tools', 'pumpkin-app.html'), 'utf8');
const reviewHtml = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const homeSummaryJs = fs.readFileSync(path.join(ROOT, 'routes', 'home-summary.js'), 'utf8');

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test('pumpkin-review is removed from ui.static, pumpkin-control is first, and routes/review.js stays mounted', () => {
  const uiBlock = manifest.slice(manifest.indexOf('\nui:\n'), manifest.indexOf('\nroutes:\n'));
  const uncommented = uiBlock.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(uncommented, /toolName:\s*pumpkin-review/);
  assert.match(uncommented, /toolName:\s*pumpkin-control/);
  assert.match(manifest, /module:\s*routes\/review\.js[\s\S]*?mountPath:\s*\/api\/pumpkin\/review/);
});

test('the 67-word projector-liveness disclaimer and Refresh evidence are absent from person-facing views', () => {
  assert.doesNotMatch(homeSummaryJs, /No current projector liveness is claimed/);
  assert.doesNotMatch(homeSummaryJs, /Shows caller-saved custom looks/);
  assert.doesNotMatch(reviewHtml, /Refresh evidence/);
  assert.doesNotMatch(reviewHtml, /id="refresh"/);
  assert.match(reviewHtml, /href="\/api\/pumpkin\/app"/, 'review address links directly to Pumpkin Control');
});

test('Saved lines on tools/pumpkin-app.html shows saved and pinned counts and Play on the projector', () => {
  assert.match(controlHtml, /<h2>Saved lines<\/h2>/);
  assert.match(controlHtml, /id="savedCounts"/);
  const makeEl = (tag) => ({
    tag,
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    type: '',
    onclick: null,
    attrs: {},
    children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
  });
  const host = makeEl('div');
  const counts = makeEl('span');
  const replayed = [];
  const ctx = {
    $: (sel) => (sel === '#savedList' ? host : sel === '#savedCounts' ? counts : null),
    document: { createElement: (tag) => makeEl(tag) },
    replaySaved: (r) => replayed.push(r.id),
    togglePinSaved: () => {},
    deleteSaved: () => {},
  };
  vm.runInNewContext(`${extractFn(controlHtml, 'truncSaved')}\n${extractFn(controlHtml, 'renderSaved')}\nthis.renderSaved = renderSaved;`, ctx);
  ctx.renderSaved([
    { id: 'r-unpinned', say: 'Trick or treat!', source: 'mimic', pinned: false, playCount: 0 },
    { id: 'r-pinned', say: 'Welcome to my porch.', source: 'autonomous', pinned: true, playCount: 2 },
  ]);
  assert.equal(counts.textContent, '2 saved · 1 pinned');
  assert.equal(host.children.length, 2);
  assert.match(host.children[0].children[0].textContent, /Welcome to my porch\./, 'pinned line renders first');
  assert.match(host.children[0].children[0].children[0].textContent, /Pinned · autonomous · played 2×/);
  const playBtn = host.children[0].children[1].children[0];
  assert.equal(playBtn.textContent, 'Play on the projector');
  playBtn.onclick();
  assert.deepEqual(replayed, ['r-pinned']);
});
