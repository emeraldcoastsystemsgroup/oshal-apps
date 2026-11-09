/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 honesty guard: goes red if a fake comes back. The package server reaches no network, process or radio; no mirroring key, receiver, drawn screen or OCR claim remains in what a person or the concierge reads; there is no public default secret; every button on the page is wired to a handler that runs a bridge verb or a package route, every verb the page uses exists in the bridge, every route has exactly one catalog binding, and the bridge stays small enough for its one install command. migrations/ is left out of the word scan: those two files are checksum-pinned 1.0.0 declarations the kernel keeps, not anything a person reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: keep 1.0.0 fake-key, fake-receiver and OCR bans while allowing real UxPlay AirPlay mirroring, lowercase oshal Node download link, mirror-* bridge verbs, and oshal_phone_mirror.py size budget.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: scan session-computer.js, session-media.js, session-collab.js, and phone-control-session-routes.js across button wiring, verb parity, catalog bindings, and package-only concierge tool endpoints.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the bridge budget counts oshal_phone_lan.py and allows 200 KiB of sources; the binding limit stays the install command under 100 KiB (~75 KB now that its payload is encoded once). The server still reaches no network: the TV verbs run on the person's computer.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(PKG, relative), 'utf8');
// What runs or is shown: comments and change logs removed, and db.js's one-time 1.0.0 cleanup, which names
// the fake rows in order to delete them.
const spoken = (relative) => read(relative).replace(/\/\/ 1\.0\.0 cleanup begins[\s\S]*?\/\/ 1\.0\.0 cleanup ends\./g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n')
  .filter((line) => !/^\s*(\/\/|#)/.test(line)).join('\n');
const files = (folder, pattern) => fs.readdirSync(path.join(PKG, folder)).filter((name) => pattern.test(name)).map((name) => path.join(folder, name));
const yaml = (() => {
  for (const candidate of [path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'), 'js-yaml']) {
    try { return require(candidate); } catch { /* next */ }
  }
  return null;
})();

test('the package server reaches no network, process or radio', () => {
  for (const file of [...files('lib', /\.js$/), ...files('routes', /\.js$/)]) {
    const source = read(file);
    for (const banned of [/require\(['"](node:)?(http|https|net|dgram|child_process|tls|dns)['"]\)/, /\bfetch\(/, /bluetoothctl/, /\bexecFile|\bspawn\(/, /\bwebsocket\b/i]) {
      assert.doesNotMatch(source, banned, `${file} must not reach outside the package (${banned})`);
    }
  }
});

test('nothing a person or the concierge reads claims a fake key, fake receiver or OCR', () => {
  const read_by_people = [...files('tools', /\.(html|js|mjs|css)$/), ...files('lib', /\.js$/), ...files('routes', /\.js$/),
    'oshal-app.yaml', 'authorization.yaml', 'personas/device-concierge.yaml', 'README.md'];
  for (const file of read_by_people) {
    const text = spoken(file);
    for (const banned of [/\bTBS\b/, /MIRROR LIVE/i, /\bOCR\b/, /mirror(ing)? key/i, /pairingKey|pairingPin/, /OSHAL-Mirror/, /receiver credential/i, /RAOP/]) {
      assert.doesNotMatch(text, banned, `${file}: ${banned}`);
    }
  }
});

test('there is no public default secret and no bearer fallback', () => {
  for (const file of [...files('lib', /\.js$/), ...files('routes', /\.js$/)]) {
    const source = spoken(file);
    assert.doesNotMatch(source, /process\.env\.[A-Z_]*(SECRET|KEY|TOKEN)[A-Z_]*\s*\|\|\s*['"]/, file);
    assert.doesNotMatch(source, /OSHAL_AUTH_SECRET|OSHAL_MIRROR_KEY_SECRET|createHmac|verifyToken/, file);
    assert.doesNotMatch(source, /authorization['"]?\]?\s*\|\|\s*['"]|Bearer\s/i, file);
  }
  for (const gone of ['lib/mirror_engine.js', 'lib/blob_store.js', 'lib/ble_hid_daemon.py']) assert.equal(fs.existsSync(path.join(PKG, gone)), false, gone);
});

test('every button on the page is wired to a handler that sends something real', () => {
  const html = read('tools/phone-control.html');
  const scripts = [
    'tools/phone-control.js', 'tools/phone-stage.js', 'tools/phone-setup.js', 'tools/phone-rdp.js',
    'tools/phone-concierge.js', 'tools/session-computer.js', 'tools/session-media.js', 'tools/session-collab.js'
  ].map(read).join('\n');
  // A submit button is wired through its form's submit handler, checked below.
  const ids = [...html.matchAll(/<button(?![^>]*type="submit")[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 9, `buttons found: ${ids.join(', ')}`);
  for (const id of ids) assert.match(scripts, new RegExp(`\\$\\('${id}'\\)\\.addEventListener|byId\\('${id}'\\)\\.addEventListener`), `button #${id} has no handler`);
  for (const form of [...html.matchAll(/<form[^>]*\bid="([^"]+)"/g)].map((match) => match[1])) {
    assert.match(scripts, new RegExp(`\\$\\('${form}'\\)\\.addEventListener\\('submit'`), `form #${form} has no submit handler`);
  }
  const bridge = read('bridge/oshal_phone_bridge.py');
  const androidKeys = new Set([...bridge.matchAll(/'([A-Z_]+)': \d+/g)].map((match) => match[1]));
  const iosKeys = new Set([...read('bridge/oshal_phone_ble.py').matchAll(/'([A-Za-z]+)': \[\(/g)].map((match) => match[1]));
  for (const match of html.matchAll(/class="ks-btn pc-key"([^>]*)>/g)) {
    const key = /data-key="([^"]+)"/.exec(match[1])?.[1];
    const ios = /data-ios="([^"]+)"/.exec(match[1])?.[1];
    assert.ok(key || ios, 'a key button names its key');
    if (key) assert.ok(androidKeys.has(key), `the bridge has no Android key ${key}`);
    if (ios) assert.ok(iosKeys.has(ios), `the iPhone keyboard has no key ${ios}`);
  }
  assert.doesNotMatch(html, /id="askJarvis"/, 'generic computer Jarvis link is removed for phones');
  for (const link of ['workOnIt', 'computerConciergeWorkBtn', 'rdpWorkLink']) {
    assert.match(scripts, new RegExp(`\\$\\('${link}'\\)\\.href = `), `${link} opens the kernel's computer page`);
  }
  assert.match(scripts, /\$\('rdpWorkLink'\)\.href = `\$\{workHref\(/);
  assert.match(html, /href="\/cockpit\/tools\/devices\.html"[^>]*>Download oshal Node/);
});

test('every verb the page sends is one the bridge has, and the lists agree', async () => {
  const link = await import(path.join(PKG, 'tools', 'computer-link.js'));
  const python = read('bridge/oshal_phone_bridge.py');
  const table = python.slice(python.indexOf('VERBS = {'), python.indexOf('HELP = {'));
  const bridgeVerbs = new Set([...table.matchAll(/'([a-z-]+)': (?:verb_|ble_passthrough|\(lambda)/g)].map((match) => match[1]));
  bridgeVerbs.delete('help');
  assert.deepEqual([...bridgeVerbs].sort(), [...link.VERBS].sort());
  const scripts = [
    'tools/phone-stage.js', 'tools/phone-setup.js', 'tools/phone-rdp.js', 'tools/phone-concierge.js',
    'tools/session-computer.js', 'tools/session-media.js', 'tools/session-collab.js'
  ].map(read).join('\n');
  const used = new Set([...scripts.matchAll(/(?:bridge\(|'(?:adb|ble|mirror|setup)-[a-z-]+')/g)].map((m) => m[0]).filter((m) => m.startsWith("'")).map((m) => m.slice(1, -1)));
  for (const verb of [...scripts.matchAll(/bridge\('([a-z-]+)'/g)].map((m) => m[1])) used.add(verb);
  assert.ok(used.size >= 15, [...used].join(', '));
  for (const verb of used) assert.ok(link.VERBS.includes(verb), `the page sends ${verb}, which the bridge does not have`);
});

test('every route has exactly one catalog binding and every tool is bound', () => {
  assert.ok(yaml, 'js-yaml is required: run npm ci --prefix scripts/toolchain');
  const catalog = yaml.load(read('authorization.yaml'));
  const manifest = yaml.load(read('oshal-app.yaml'));
  const routes = [];
  for (const file of [
    'routes/phone-control-routes.js', 'routes/phone-control-session-routes.js',
    'routes/phone-control-concierge-routes.js', 'routes/home-summary.js', 'routes/phone-control-config-routes.js'
  ]) {
    const prefix = file.includes('home-summary') ? '/home-summary'
      : file.includes('config-routes') ? '/config'
        : file.includes('session-routes') ? '/sessions'
          : file.includes('concierge-routes') ? '/concierge' : '';
    for (const match of read(file).matchAll(/router\.(get|post|delete)\('([^']+)'/g)) {
      routes.push([match[1].toUpperCase(), (prefix + (match[2] === '/' ? '' : match[2])) || '/']);
    }
  }
  routes.push(['GET', '/_smoke']);
  const segments = (value) => value.split('/');
  for (const [method, route] of routes) {
    const hits = catalog.bindings.http.filter((binding) => binding.method === method && segments(binding.path).length === segments(route).length
      && segments(binding.path).every((part, i) => part === segments(route)[i] || (part.startsWith(':') && segments(route)[i])));
    assert.equal(hits.length, 1, `${method} ${route} has ${hits.length} bindings`);
  }
  assert.equal(catalog.bindings.http.length, routes.length, 'no binding for a route that does not exist');
  assert.deepEqual(manifest.tools.map((tool) => tool.name).sort(), catalog.bindings.tools.map((tool) => tool.id).sort());
  for (const tool of manifest.tools) {
    assert.match(tool.executor.apiEndpoint, /^(GET|POST|DELETE) \/api\/phone-control\//, `${tool.name} stays inside package routes`);
    assert.doesNotMatch(tool.executor.apiEndpoint, /\/api\/computers/, `${tool.name} never drives /api/computers`);
  }
  assert.deepEqual(manifest.surface.ops, ['context', 'notify']);
});

test('every file the package needs has an extension the kernel stages into the package sandbox', () => {
  // The kernel copies only these extensions into /package (crates/packages/src/source_artifact.rs source_export_file);
  // an extension-less bridge wrapper once stayed behind and the bridge manifest route failed on the installed package.
  const staged = /\.(js|cjs|mjs|ts|json|yaml|yml|html|css|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|txt|md|sql|wasm|mp4|webm|vtt|map|py|tsv)$/;
  const walk = (folder) => fs.readdirSync(path.join(PKG, folder), { withFileTypes: true })
    .filter((entry) => entry.name !== '__pycache__')
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
  for (const file of [...walk('bridge'), ...walk('lib'), ...walk('routes'), ...walk('tools')]) assert.match(file, staged, `${file} would not reach the installed package`);
});

test('the bridge fits its one install command and its version is the package version', async () => {
  const sizes = ['oshal_phone_bridge.py', 'oshal_phone_ble.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py', 'oshal_phone_lan.py']
    .map((name) => fs.statSync(path.join(PKG, 'bridge', name)).size);
  assert.ok(sizes.reduce((a, b) => a + b, 0) < 200 * 1024, `bridge sources are ${sizes.join(' + ')} bytes`);
  const { bridgeManifest } = require(path.join(PKG, 'lib', 'bridge-files.js'));
  const link = await import(path.join(PKG, 'tools', 'computer-link.js'));
  assert.ok(link.installCommand(bridgeManifest(PKG)).length < 100 * 1024, 'gzipped install command fits well under 100 KiB');
  const version = /^version: (\S+)$/m.exec(read('oshal-app.yaml'))[1];
  assert.equal(/^VERSION = '([^']+)'/m.exec(read('bridge/oshal_phone_bridge.py'))[1], version);
});
