/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (pumpkin--pumpkin-control, SPLIT): Speak and Saved
 *   responses sat below one-time projector setup and a large QR code, three controls were orange fills, the look editor
 *   asked for raw rgba() strings and the Launch glyph rendered as a box. Guards the two views (Show by default; Look &
 *   setup), one primary per view, the greyed Stop placeholder (design standard 4.10, RP-PUMP-01), the colour well and
 *   opacity slider that write the same rgba string, Reset to preset restoring the preset's own values, the SVG icon,
 *   and status lines in the page ink.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | RP-PUMP-01: Stop is now a live secondary control (#btnStop) beside
 *   Ask the pumpkin with no remaining data-ds-not-yet or data-ds-backlog attributes, bound to stopAll().
 *
 * Dependency-free `node --test` suite over the shipped page (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'pumpkin-app.html'), 'utf8');
const body = html.slice(html.indexOf('<body'));
const view = (id) => body.slice(body.indexOf(`id="view-${id}"`), body.indexOf('</section>', body.indexOf(`id="view-${id}"`)));
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test('two views: Show by default holds the live-show controls, Look & setup the one-time setup', () => {
  assert.match(body, /id="tab-show" data-view="show"[^>]*aria-selected="true"/);
  assert.match(body, /id="view-setup" role="tabpanel"[^>]*hidden>/);
  const show = view('show'), setup = view('setup');
  for (const id of ['presetSel', 'mMimic', 'mAuto', 'sayText', 'btnSay', 'btnAsk', 'savedList', 'launch', 'apply']) assert.ok(show.includes(`id="${id}"`), `${id} in Show`);
  for (const id of ['saveLook', 'resetLook', 'roomLabel', 'projectorUrl', 'projectorQr', 'projectorShort', 'remoteUrl', 'remoteQr']) assert.ok(setup.includes(`id="${id}"`), `${id} in Look & setup`);
  assert.match(extract('bindViews'), /setView\(\/\(\^\|\[#&\]\)view=setup\\b\/\.test\(location\.hash\)\?'setup':'show'\)/);
});

test('one primary per view: Say it on Show, Save as new look on Look & setup; Launch Projector is secondary', () => {
  assert.deepEqual([...view('show').matchAll(/<button id="(\w+)" class="primary"/g)].map((m) => m[1]), ['btnSay']);
  assert.deepEqual([...view('setup').matchAll(/<button id="(\w+)" class="primary"/g)].map((m) => m[1]), ['saveLook']);
  assert.match(body, /<button id="launch">Launch Projector <svg class="ext"/);
  assert.doesNotMatch(html, /⧉/, 'the box glyph is gone');
  assert.match(html, /button\.seg\.on \{ background:var\(--ink\); color:var\(--bg\);/, 'the selected mode is inverted, not an orange fill');
});

test('Stop is a live secondary control beside Ask the pumpkin with no backlog placeholder', () => {
  const show = view('show');
  assert.match(show, /<button type="button" id="btnStop">/);
  assert.ok(show.indexOf('id="btnAsk"') < show.indexOf('id="btnStop"'), 'Stop sits right after Ask the pumpkin');
  assert.doesNotMatch(html, /data-ds-backlog|data-ds-not-yet/, 'RP-PUMP-01 placeholder attributes are removed');
  assert.match(html, /\$\('#btnStop'\)\.onclick=stopAll;/, 'Stop binds stopAll()');
  assert.match(extract('stopAll'), /\/api\/pumpkin\/rooms\/stop/, 'stopAll calls POST /api/pumpkin/rooms/stop');
});

test('a colour well and an opacity slider write the rgba string the Advanced field holds', () => {
  const ctx = {};
  vm.runInNewContext(`${extract('parseRgba')}\n${extract('toRgba')}\nthis.parseRgba = parseRgba; this.toRgba = toRgba;`, ctx);
  assert.deepEqual({ ...ctx.parseRgba('rgba(255,96,0,0.12)') }, { hex: '#ff6000', alpha: 0.12 });
  assert.deepEqual({ ...ctx.parseRgba('rgb(0, 0, 0)') }, { hex: '#000000', alpha: 1 });
  assert.equal(ctx.parseRgba('orange'), null);
  assert.equal(ctx.toRgba('#ff6000', 0.12), 'rgba(255,96,0,0.12)');
  assert.match(body, /<div class="well" data-rgba="colors\.bodyGlow">/);
  assert.match(body, /<summary>Advanced<\/summary>[\s\S]*data-k="colors\.bodyGlow" type="text"/);
  assert.match(extract('bindWells'), /text\.dispatchEvent\(new Event\('input'\)\)/, 'the well drives the same editor binding');
});

test('Reset to preset restores the preset: edits are made on a copy of it', () => {
  assert.match(html, /function applyPreset\(p\)\{ S\.preset=clone\(p\);/);
  assert.match(extract('resetLook'), /applyPreset\(o\.__p\)/);
  assert.match(view('setup'), /<button id="resetLook" type="button" class="tertiary">Reset to preset<\/button>/);
});

test('status lines use the page ink, not the amber that read 1.6:1 in light-blue', () => {
  assert.match(html, /\.status \{ color:var\(--text-primary, var\(--ink\)\); \}/);
});
