/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (marketing-engine--marketing-engine): the UTM builder sat 1,100px down the Board with an unlabelled field, submitted empty and failed with 400; the Refresh repeated the shell's Reload; 'imports never arm spend' was a pill. The shipped utmProblems() runs in a sandbox: an empty form names each required field and sends nothing; a relative URL is named; a full form passes. The builder is on the Channels tab with a label on every field, and the page has no Refresh of its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'marketing-engine.html'), 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = html.indexOf('{', html.indexOf(')', start)); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('never closed');
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extract('utmProblems') + '\nglobalThis.utmProblems = utmProblems;', sandbox);
const ids = (v) => JSON.parse(JSON.stringify(sandbox.utmProblems(v))).map((m) => m.id);

test('an empty UTM form names every required field, so nothing is sent', () => {
  assert.deepEqual(ids({}), ['utmUrl', 'utmCampaign', 'utmSource', 'utmMedium']);
  assert.deepEqual(ids({ url: 'oshal.ai/x', campaign: 'c', source: 's', medium: 'm' }), ['utmUrl'], 'a URL without http(s) is named');
  assert.deepEqual(ids({ url: 'https://oshal.ai/product', campaign: 'fall', source: 'linkedin', medium: 'social' }), []);
  const click = html.slice(html.indexOf('$("utmBtn").addEventListener'), html.indexOf('api("/utm?"'));
  assert.match(click, /if\(missing\.length\)\{.*\$\(missing\[0\]\.id\)\.focus\(\); return; \}/, 'the click returns before api("/utm")');
});

test('the UTM builder is on the Channels tab with a label on every field, and there is one refresh only', () => {
  const channels = html.slice(html.indexOf('id="pane-channels"'), html.indexOf('</section>', html.indexOf('id="pane-channels"')));
  assert.match(channels, /id="utmCard"/);
  const board = html.slice(html.indexOf('id="pane-board"'), html.indexOf('</section>', html.indexOf('id="pane-board"')));
  assert.doesNotMatch(board, /id="utmCard"/);
  for (const id of ['utmUrl', 'utmCampaign', 'utmSource', 'utmMedium', 'utmContent']) assert.match(channels, new RegExp(`<label class="f" for="${id}">`));
  assert.doesNotMatch(html, /id="refreshBtn"/);
  assert.doesNotMatch(html, /<span class="badge"[^>]*>imports never arm spend</);
});
