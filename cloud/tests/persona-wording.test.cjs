/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: asked how to connect GCP, the Cloud concierge told the person to open the
 *   Utilities page "via the link in the breadcrumb", but the Cloud app's one screen already is that Connections page. The
 *   persona must say so and give the steps on that same screen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const persona = fs.readFileSync(path.join(root, 'personas', 'cloud-ops-bot.yaml'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');

test('the Cloud app\'s screen is the Connections page', () => {
  assert.match(manifest, /toolName: cloud-accounts[\s\S]*?iframeUrl: \/utilities/);
});

test('the persona connects GCP on the same screen and never sends the person elsewhere', () => {
  assert.match(persona, /Cloud Accounts \(beside this chat\), IS the\s+Connections page/);
  assert.match(persona, /type "gcp" in "Find a connector"/);
  assert.match(persona, /Never send them to another page, a breadcrumb link or a URL/);
  assert.doesNotMatch(persona, /Connections \(\/utilities\)/, 'no address for the person to go to');
});
