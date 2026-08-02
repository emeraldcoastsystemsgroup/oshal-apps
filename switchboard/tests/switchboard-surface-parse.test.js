/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Parse guard for every Switchboard surface: each tools/*.html inline <script> must parse under classic-script grammar (the world 1.0.1 lesson — a served SyntaxError is caught by no compiler and renders as a page that never loads). Also pins that the Stage + Threads surfaces exist alongside the original five.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.resolve(__dirname, '..', 'tools');

const EXPECTED = [
  'switchboard-today.html',
  'switchboard-inbox.html',
  'switchboard-calendar.html',
  'switchboard-compose.html',
  'switchboard-workspaces.html',
  'switchboard-threads.html',
  'switchboard-stage.html',
];

test('every expected surface exists in tools/', () => {
  for (const f of EXPECTED) assert.ok(fs.existsSync(path.join(TOOLS, f)), `missing surface: ${f}`);
});

for (const file of fs.readdirSync(TOOLS).filter((f) => f.endsWith('.html'))) {
  test(`inline scripts in ${file} parse as classic scripts`, () => {
    const html = fs.readFileSync(path.join(TOOLS, file), 'utf8');
    const scripts = [];
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/i.test(attrs)) continue; // external scripts have no inline body
      if (m[2].trim()) scripts.push(m[2]);
    }
    assert.ok(scripts.length > 0, `${file} has no inline script — every surface is self-driving`);
    for (const [i, code] of scripts.entries()) {
      // classic-script grammar: a stray top-level await / ESM syntax must fail HERE, not in a browser
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${file}#${i}` }), `script #${i} in ${file} does not parse`);
    }
  });
}
