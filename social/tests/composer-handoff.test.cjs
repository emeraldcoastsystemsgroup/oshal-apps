/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The old Composer address of Social answers a hand-off page to the Workspace, keeping its query. On the native kernel a package cannot redirect (the response has no `redirect` and no Location header is relayed), so the address answered HTTP 500 until this version. The page is held to one address on this site, no script, and its special characters written out; the route is held to never calling a redirect again.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handOffPage } = require('../routes/hand-off-page.js');

const root = path.join(__dirname, '..');

test('the hand-off page carries one address on this site, at once, with a link and no script', () => {
  const page = handOffPage('/api/social/workspace?view=compose&draft=7', 'Open the workspace');
  assert.match(page, /^<!doctype html>/);
  assert.ok(page.includes('<meta http-equiv="refresh" content="0; url=/api/social/workspace?view=compose&amp;draft=7">'), page);
  assert.ok(page.includes('<a href="/api/social/workspace?view=compose&amp;draft=7">Open the workspace</a>'), page);
  assert.deepEqual([...page.matchAll(/(?:url=|href="|src=")([^">]+)/g)].map((found) => found[1]), ['/api/social/workspace?view=compose&amp;draft=7', '/api/social/workspace?view=compose&amp;draft=7']);
  assert.doesNotMatch(page, /<script|javascript:/i);
});

test('an address with a query or a mark is written out, and another site is refused', () => {
  const page = handOffPage('/api/x?a=1&b="2"<3>', 'A & B');
  assert.ok(page.includes('content="0; url=/api/x?a=1&amp;b=&quot;2&quot;&lt;3&gt;"'), page);
  assert.ok(page.includes('<title>A &amp; B</title>'));
  for (const other of ['https://example.com/x', '//example.com/x', 'x', '', '/\\example.com']) assert.throws(() => handOffPage(other, 'x'), /stays on this site/, other);
});

test('the route answers the page and never calls a redirect', () => {
  for (const file of ['src-routes/social-routes.ts', 'routes/social-routes.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /res\.redirect\(/, `${file} calls a redirect, which a kernel does not relay`);
    assert.match(source, /res\.status\(200\)\.type\('html'\)\.send\(\(0, hand_off_page_1\.handOffPage\)\(`\/api\/social\/workspace\?\$\{q\.toString\(\)\}`, 'Open the workspace'\)\)|res\.status\(200\)\.type\('html'\)\.send\(handOffPage\(`\/api\/social\/workspace\?\$\{q\.toString\(\)\}`, 'Open the workspace'\)\)/, `${file} answers the hand-off page`);
  }
});
