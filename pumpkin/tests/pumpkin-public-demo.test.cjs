/**
 * Public Pumpkin demo contract. These checks intentionally run on plain Node so the carved app
 * repository can validate its shipped HTML without depending on the OSHAL kernel test runner.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const pumpkinDir = path.resolve(__dirname, '..');
const control = fs.readFileSync(path.join(pumpkinDir, 'tools', 'pumpkin-app.html'), 'utf8');
const remote = fs.readFileSync(path.join(pumpkinDir, 'tools', 'pumpkin-remote.html'), 'utf8');
const manifest = fs.readFileSync(path.join(pumpkinDir, 'oshal-app.yaml'), 'utf8');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
}

test('shipped inline scripts parse', () => {
  for (const [name, html] of [['control', control], ['remote', remote]]) {
    for (const [index, source] of inlineScripts(html).entries()) {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `${name}#${index}` }));
    }
  }
});

test('guest demo stays server read-only and opts into browser-local controls', () => {
  assert.doesNotMatch(manifest, /^guestTier:\s*full\s*$/m);
  assert.match(control, /data-guest-local-demo="true"/);
  assert.match(control, /BroadcastChannel/);
  assert.match(control, /S\.demoBus\.post\(\{type:'speak'/);
  assert.match(control, /savedDemoPresets/);
  assert.match(control, /if\(!r\.ok\)/);
  assert.match(remote, /demo:qs\.get\('demo'\)==='1'/);
  assert.match(remote, /S\.bus\.post\(\{type:'speak'/);
  assert.match(remote, /if\(!r\.ok\)/);
});

test('mobile contract prevents the canvas overflow and keeps touch targets usable', () => {
  assert.match(control, /#preview\s*\{[^}]*max-width:100%/s);
  assert.match(control, /button\s*\{[^}]*min-height:44px/s);
  assert.match(control, /input\[type=range\]\s*\{\s*min-height:44px/s);
  assert.match(remote, /button\s*\{[^}]*min-height:44px/s);
  assert.match(remote, /pointercancel/);
});

