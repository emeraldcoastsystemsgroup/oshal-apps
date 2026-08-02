/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Guard for the 1.0.1 defect: the surface is one inline <script> inside a served string, so a SyntaxError there has no build step to catch it and no console a user reads — the page just never loads. Parse both copies (the .ts source and the compiled .js the runtime actually serves) with classic-script semantics, and pin the load() entrypoint the broken edit deleted.
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

/** Extract the single inline <script> block (the src= theme tag deliberately does not match). */
function inlineScript(fileText, rel) {
  const m = fileText.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, rel + ': expected exactly one inline <script> block in WORLD_APP_HTML');
  return m[1];
}

for (const rel of COPIES) {
  const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const script = inlineScript(text, rel);

  test('surface script parses as a classic script (' + rel + ')', () => {
    // Throws SyntaxError on exactly what a browser would refuse to run — including a top-level
    // await, which is what the deleted load() declaration produced.
    assert.doesNotThrow(() => new vm.Script(script, { filename: rel }));
  });

  test('surface script keeps its load() entrypoint (' + rel + ')', () => {
    assert.match(script, /async function load\(/, rel + ': load() must be declared');
    assert.match(script, /load\(\)\.catch/, rel + ': load() must be invoked with a failure path');
  });
}
