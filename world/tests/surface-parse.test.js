/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Guard for the 1.0.1 defect: the surface is one inline <script> inside a served string, so a SyntaxError there has no build step to catch it and no console a user reads — the page just never loads. Parse both copies (the .ts source and the compiled .js the runtime actually serves) with classic-script semantics, and pin the load() entrypoint the broken edit deleted.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The page now carries two inline scripts: the audience-view head script (ADR-164 D6) and the dashboard's own. Both copies must hold exactly those two, each must parse as a classic script, and load() must still be declared and invoked with its failure path, now only behind the kit's gate so an audience view never starts the dashboard.
 */

/**
 * The world surface ships as WORLD_APP_HTML — a template-literal HTML page whose behavior is one
 * inline classic <script>. Nothing compiles or lints that script: tsc sees a string, the runtime
 * serves it verbatim, and a parse error surfaces only as a page that never finishes loading.
 * v1.0.1 shipped exactly that (the `async function load() {` line was dropped, leaving a top-level
 * `await`). vm.Script parses with the same classic-script grammar a browser uses, so what throws
 * here is what dies there.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const COPIES = ['src-routes/world-app-html.ts', 'routes/world-app-html.js'];

/**
 * Extract the inline <script> blocks (the src= theme and kit tags deliberately do not match): the audience-view head
 * script first, then the dashboard's own script.
 */
function inlineScripts(fileText, rel) {
  const blocks = [...fileText.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, rel + ': expected the audience-view head script and the dashboard script in WORLD_APP_HTML');
  return { head: blocks[0], dashboard: blocks[1] };
}

for (const rel of COPIES) {
  const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const scripts = inlineScripts(text, rel);

  test('surface scripts parse as classic scripts (' + rel + ')', () => {
    // Throws SyntaxError on exactly what a browser would refuse to run — including a top-level
    // await, which is what the deleted load() declaration produced.
    assert.doesNotThrow(() => new vm.Script(scripts.head, { filename: rel + '#audience-view' }));
    assert.doesNotThrow(() => new vm.Script(scripts.dashboard, { filename: rel }));
  });

  test('surface script keeps its load() entrypoint behind the audience-view gate (' + rel + ')', () => {
    assert.match(scripts.dashboard, /async function load\(/, rel + ': load() must be declared');
    assert.match(scripts.dashboard, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) \{\n  document\.getElementById\('win'\)\.onchange = [^\n]+\n  load\(\)\.catch\([^\n]+\n\}\n/,
      rel + ': load() must be invoked with a failure path, and only when no audience view renders');
    assert.doesNotMatch(scripts.dashboard, /^load\(\)/m, rel + ': no ungated load() is left');
  });
}
