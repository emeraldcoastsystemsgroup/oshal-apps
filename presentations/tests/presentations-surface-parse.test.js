/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 21:30:00 | maintainer@emeraldcoastsystemsgroup.com   | Parse + front-door contract guard for the AI Office surface. Every inline <script> must parse (classic grammar; type="module" bodies are parsed under an async-IIFE wrap because they legitimately use top-level await — the world 1.0.1 lesson: a served SyntaxError is caught by no compiler and renders as a page that never loads). And the guided walkthrough must keep its three steps plus every operator-mandated entry path (click / talk / upload / one-line draft) and both escape hatches — losing one regresses the front door back to the bare config screen, and that should go red HERE, not in a demo.
 * 2026-08-01 00:30:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin the phone-first round (2.3.0): the Jump-back-in resume row, the two dictation mics, and the Guide chips rail join the walkthrough contract — the operator's "working from my phone" paths must not silently fall off the surface.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SURFACE = path.resolve(__dirname, '..', 'tools', 'presentations.html');

function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue; // external scripts have no inline body
    if (m[2].trim()) out.push({ code: m[2], module: /type\s*=\s*["']?module/i.test(attrs) });
  }
  return out;
}

test('the AI Office surface exists', () => {
  assert.ok(fs.existsSync(SURFACE), 'missing tools/presentations.html');
});

test('every inline script in presentations.html parses', () => {
  const scripts = inlineScripts(fs.readFileSync(SURFACE, 'utf8'));
  assert.ok(scripts.length >= 2, 'expected the classic driver script plus the surface-bridge module script');
  for (const [i, s] of scripts.entries()) {
    // Module bodies use top-level await (the dynamic import of the bridge client), which the
    // classic grammar vm.Script parses would reject — wrap them in an async IIFE so real syntax
    // errors still throw. A static `import` would fail under the wrap; this surface deliberately
    // has none (its standalone-mode contract is dynamic import in a try/catch).
    const code = s.module ? '(async () => {\n' + s.code + '\n})()' : s.code;
    assert.doesNotThrow(
      () => new vm.Script(code, { filename: `presentations.html#${i}` }),
      `inline script #${i} in presentations.html does not parse`
    );
  }
});

test('the front door keeps its walkthrough contract', () => {
  const html = fs.readFileSync(SURFACE, 'utf8');
  const required = [
    // The wizard and its three steps, in order: make → look → start.
    'id="wiz"', 'id="wzS1"', 'id="wzS2"', 'id="wzS3"',
    // Every entry path the operator asked for: CLICK (three artifacts, the look gallery, the
    // starter shapes), TALK (the Guide, from step 1 and step 3), UPLOAD, and the one-line draft.
    'data-kind="pptx"', 'data-kind="docx"', 'data-kind="xlsx"',
    'id="wzThemes"', 'id="wzTpls"', 'id="wzTalk"', 'id="wzGuide3"', 'id="wzUpload"',
    'id="wzTopic"', 'id="wzDraft"',
    // Escape hatches BOTH ways: skip into the studio, reopen from the studio header.
    'id="wzSkip"', 'id="wzReopen"',
    // Phone-first round (2.3.0): one-tap resume of recent files, dictation on the topic
    // line and the Guide chat, and the tap-to-edit chips rail.
    'id="wzRecent"', 'id="wzMicTopic"', 'id="micChat"', 'id="chatChips"',
  ];
  for (const mark of required) assert.ok(html.includes(mark), `front door lost ${mark}`);
});

test('My files is a file explorer and the Draft tab is honest', () => {
  const html = fs.readFileSync(SURFACE, 'utf8');
  // The operator-mandated shape: rows of real file names, click = file view with a big
  // Download (kernel /api/files/download proxy rides the row's downloadUrl), Open-in-provider,
  // Edit & regenerate, Delete, and a quick look labelled as the DRAFT it is. The tab that
  // previews the EDIT says Draft, not Preview — the file preview lives in My files.
  const marks = [
    'function renderFileList', 'function openFileView', 'function slideCards',
    '⬇ Download', 'Edit &amp; regenerate', '✏ Draft',
  ];
  for (const mark of marks) assert.ok(html.includes(mark), `explorer lost ${mark}`);
  assert.ok(!/id="tabPreview"[^>]*>👁 Preview/.test(html), 'the Draft tab regressed to calling itself Preview');
});

test('the studio + surface-bridge marks survive under the front door', () => {
  const html = fs.readFileSync(SURFACE, 'utf8');
  // The cockpit relay lands set_field/set_content on these marks (manifest surface.ops is
  // fail-closed) and the Guide/Preview/My-files tabs are the studio's working set — the
  // walkthrough is an overlay, never a replacement.
  const marks = [
    'data-bridge-field="title"', 'data-bridge-region="outline"',
    'id="tabGuide"', 'id="tabPreview"', 'id="tabDecks"',
    'surface-bridge-client.js',
  ];
  for (const mark of marks) assert.ok(html.includes(mark), `studio lost ${mark}`);
});
