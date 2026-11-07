/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: asked how to connect GCP, the Cloud concierge told the person to open the
 *   Utilities page "via the link in the breadcrumb", but the Cloud app's one screen already is that Connections page. The
 *   persona must say so and give the steps on that same screen.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0 (UX audit 2026-11-05, cloud-accounts): Cloud opens on its own Cloud Accounts screen, not the global chat list, and that screen is the package's page with one Connect Google Cloud (not connected) or Ask the cloud bot (connected). The model runs as shipped in a VM context; the persona names the button on that screen.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.2.1: a refused connect (the kernel's connect_error, announced by the Connections page on oshal-connections) is shown on the Cloud screen as an alert.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const persona = fs.readFileSync(path.join(root, 'personas', 'cloud-ops-bot.yaml'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');

test('Cloud opens on its own Cloud Accounts screen, never the global chat list', () => {
  assert.match(manifest, /toolName: cloud-accounts[\s\S]*?iframeUrl: \/apps\/cloud\/ui\/index\.html[\s\S]*?section: top/);
  assert.match(manifest, /\n  defaultView: cloud-accounts\b/);
  assert.doesNotMatch(manifest, /defaultView: chat/);
});

test('the screen shows one primary: Connect Google Cloud when not connected, Ask the cloud bot when connected', () => {
  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ui', 'cloud-model.js'), 'utf8'), context);
  const C = context.CloudHome;
  const summary = (accounts, reconnect) => ({ metrics: [{ id: 'gcp-accounts', value: String(accounts) }, { id: 'gcp-reconnect', value: String(reconnect) }] });
  assert.equal(C.view(null).state, 'error');
  assert.equal(C.view({ error: 'x' }).primary, 'retry');
  const none = C.view(summary(0, 0));
  assert.equal(none.state, 'not-connected'); assert.equal(none.primary, 'connect'); assert.equal(none.tiles.length, 0);
  const one = C.view(summary(1, 0));
  assert.equal(one.state, 'connected'); assert.equal(one.primary, 'ask'); assert.equal(one.tiles.length, 1);
  assert.equal(C.view(summary(2, 1)).tiles.length, 2, 'a reconnect tile only when one needs it');
  assert.equal(C.connectUrl('/apps/cloud/ui/index.html?connected=gcp'), '/api/connect/gcp/start?return=%2Fapps%2Fcloud%2Fui%2Findex.html%3Fconnected%3Dgcp');
  const page = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  assert.match(page, /'Connect Google Cloud'/); assert.match(page, /'Ask the cloud bot'/);
  assert.match(page, /type: 'app-ask', app: 'cloud'/);
  const calls = [...page.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(calls, ['/api/cloud/home-summary'], 'the screen reads only its own summary');
  assert.doesNotMatch(page, /<h1/, 'the shell already shows the application name');
  assert.match(page, /new BroadcastChannel\('oshal-connections'\)/, 'a refused connect is said on screen');
  assert.match(page, /m\.type !== 'connect-outcome' \|\| m\.connector !== 'gcp'/);
  assert.match(page, /class: 'alert', role: 'alert'/);
});

test('the persona connects GCP on the same screen and never sends the person elsewhere', () => {
  assert.match(persona, /presses Connect Google Cloud\s+on that screen/);
  assert.match(persona, /Never\s+send them to another page, a breadcrumb link or a URL/);
  assert.doesNotMatch(persona, /Connections \(\/utilities\)/, 'no address for the person to go to');
});
