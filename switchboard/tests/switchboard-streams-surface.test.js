/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-09 12:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the Streams surface (tools/switchboard-streams.html, contract v1 2026-08-09): the pane exists and is non-trivial, names every editorial state in its rail, wires the posts collection (list + create) plus the transition/schedule/publish endpoints, mirrors compose's 428 → explicit confirm:true retry (nothing posts without the confirm), drafts variants through the EXISTING compose /variants endpoint, exposes both import actions, ships NO external http(s) script/style include, and every inline script parses under classic-script grammar.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 * Written to the contract — the surface lands in a parallel build; until it does, the
 * existence test names exactly what is missing.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SURFACE = path.resolve(__dirname, '..', 'tools', 'switchboard-streams.html');
const html = fs.existsSync(SURFACE) ? fs.readFileSync(SURFACE, 'utf8') : '';

test('the Streams surface exists and is non-trivial', () => {
  assert.ok(fs.existsSync(SURFACE), `missing surface: ${SURFACE}`);
  assert.ok(html.length > 5000, `surface is trivially small (${html.length} chars) — not a real pane`);
});

test('the state rail names every editorial state', () => {
  for (const state of ['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'failed', 'archived']) {
    assert.ok(html.includes(state), `state rail is missing '${state}'`);
  }
});

test('the surface wires the posts collection — list and create', () => {
  // Either URL construction the siblings use must reach the streams router:
  // API="/api/switchboard" + "/streams/posts…" or API="/api/switchboard/streams" + "/posts…".
  assert.match(html, /\/api\/switchboard\/streams|\/streams\/posts/, 'no fetch path reaches /api/switchboard/streams');
  assert.ok(html.includes('/posts'), 'the posts collection is never fetched');
  assert.match(html, /["']POST["']/, 'no POST call — the pane cannot create a post');
});

test('the transition, schedule, and publish endpoints are wired', () => {
  assert.ok(html.includes('/transition'), 'no transition call — the editorial state machine is unreachable');
  assert.ok(html.includes('/schedule'), 'no schedule call');
  assert.ok(html.includes('/publish'), 'no publish call');
});

test('publish mirrors the compose confirm flow: 428 handled, retry carries the explicit confirm', () => {
  assert.match(html, /\b428\b/, 'the 428 confirmation-required response is never handled');
  assert.match(html, /confirm["']?\s*:\s*true/, 'no explicit confirm:true — nothing may post without it');
});

test('variant drafting goes through the EXISTING compose /variants endpoint (no parallel LLM rail)', () => {
  assert.match(html, /compose\/variants/, 'the pane must call /api/switchboard/compose/variants, not a rail of its own');
});

test('both import actions are exposed', () => {
  assert.ok(html.includes('/import'), 'no import call');
  assert.ok(html.includes('linkedin-assistant'), 'linkedin-assistant import source missing');
  assert.ok(html.includes('content-studio'), 'content-studio import source missing');
});

test('no external http(s) script or style include — the surface is self-contained', () => {
  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=\s*["']https?:/i, 'external <script src> found');
  assert.doesNotMatch(html, /<link[^>]*\bhref\s*=\s*["']https?:/i, 'external <link href> found');
  assert.doesNotMatch(html, /@import\s+(?:url\(\s*)?["']?https?:/i, 'external CSS @import found');
});

test('inline scripts in the Streams surface parse as classic scripts', () => {
  const scripts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue; // external scripts have no inline body
    if (m[2].trim()) scripts.push(m[2]);
  }
  assert.ok(scripts.length > 0, 'no inline script — every surface is self-driving');
  for (const [i, code] of scripts.entries()) {
    // classic-script grammar: a stray top-level await / ESM syntax must fail HERE, not in a browser
    assert.doesNotThrow(() => new vm.Script(code, { filename: `switchboard-streams.html#${i}` }), `script #${i} does not parse`);
  }
});
