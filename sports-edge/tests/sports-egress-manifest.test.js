/**
 * Guard: every host this package reads is a declared outbound host.
 *
 * The native kernel's sandbox has no network of its own; a read leaves only through the kernel's fenced
 * egress, which refuses a host the manifest does not declare. sports-edge shipped with no `egress:` block,
 * so every ESPN read was refused ("site.api.espn.com is not a declared outbound host of sports-edge") and
 * Load teams came back empty. This reads every absolute URL host out of the compiled routes the kernel
 * mounts and requires each one in the manifest's `egress:` list, so a new endpoint host cannot ship
 * without its declaration.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the hosts in routes/*.js (site.api.espn.com, sports.core.api.espn.com) are all declared under egress:, and no declaration carries a credential (every ESPN read here is public).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');

/** The manifest's top-level `egress:` block as {host, credential} rows (read as text: this job installs no YAML parser). */
function declaredEgress() {
  const text = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const block = text.split(/\n(?=\S)/).find((part) => part.startsWith('egress:'));
  if (!block) return [];
  return block.split(/\n  - /).slice(1).map((entry) => ({
    host: (/host: *([^\s#]+)/.exec(entry) || [])[1] || null,
    credential: /credential:/.test(entry),
  }));
}

/** Every https/http host named in a string literal of the compiled route modules. */
function hostsTheRoutesRead() {
  const hosts = new Set();
  const dir = path.join(PKG, 'routes');
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
      .split('\n').filter((line) => !/^\s*(\*|\/\/)/.test(line)).join('\n');
    for (const match of source.matchAll(/['"`]https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(match[1].toLowerCase());
  }
  return [...hosts].sort();
}

test('the routes read exactly the ESPN hosts this guard was written for', () => {
  // A new host appearing here is fine; this pins the inventory so the next assertion is not vacuous.
  assert.deepEqual(hostsTheRoutesRead(), ['site.api.espn.com', 'sports.core.api.espn.com']);
});

test('every host the routes read is a declared outbound host', () => {
  const declared = new Set(declaredEgress().map((row) => row.host));
  const missing = hostsTheRoutesRead().filter((host) => !declared.has(host));
  assert.deepEqual(missing, [], `declare these under egress: in oshal-app.yaml: ${missing.join(', ')}`);
});

test('no ESPN declaration asks the kernel for a credential: every read here is public', () => {
  assert.deepEqual(declaredEgress().filter((row) => row.credential), []);
});
