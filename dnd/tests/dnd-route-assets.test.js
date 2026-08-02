/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:12:34 | roger.murphy@emeraldcoastsystemsgroup.com   | Guard JavaScript MIME/no-store delivery and CSP-safe inlining for every classic tabletop script in exact dependency order.
 * 2026-07-21 20:13:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Verify each inline body remains byte-for-byte present so replacement-string metacharacters cannot corrupt executable JavaScript.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the focused shared presentation-gate controller in public and inline asset order.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the structured-dice presenter directly after shared runtime state.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Include fixed natural narration before dice and story consumers in public and inline asset order.
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin the focused host seat-recovery client immediately before Party/Lobby screens.
 * 2026-07-22 00:41:15 | roger.murphy@emeraldcoastsystemsgroup.com  | Verify the routed tactical client contains no per-action model call while preserving awaited visible dice and detached natural narration.
 * 2026-07-22 01:14:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the focused read-only playback client in public and inline dependency order.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Require served automated turns to use bounded readable narration pacing around the exact visible dice.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve cinematic combat narration separately and require tactical automation to speak authored prose instead of exact rules text.
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the focused full-character and current-resource client in public and inline assets.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the immersive gameplay-rail controller immediately before final screen wiring.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Accept paced visible dice presentation while guarding the served tactical turn flow.
 * 2026-07-28 00:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Cover leads.js in served and inlined asset order — it was in UI_SCRIPTS but absent from table.html, so the served document silently lacked DnDLeads and every client-side nomination/walk feature was dead in production.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes');

const root = path.join(__dirname, '..');
const scripts = [
  'engine.js', 'leads.js', 'table-runtime.js', 'table-voice.js', 'table-dice.js', 'table-presentation.js', 'table-turns.js', 'table-combat-narration.js', 'table-automation.js',
  'table-outcomes.js', 'table-story.js', 'table-character-sheet.js', 'table-seats.js', 'table-playback.js', 'table-immersive.js', 'table-screens.js',
];

/** @description Invoke a public asset route and wait for its callback response. */
function request(router, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 0,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(value) { resolve({ status: this.statusCode, headers, body: String(value || '') }); },
    };
    Promise.resolve(router({ method: 'GET', url }, res,
      () => reject(new Error('route unexpectedly fell through')))).catch(reject);
  });
}

test('every tabletop script is served as uncached JavaScript', async () => {
  const router = createDndRoutes({ appPackageDir: root });
  for (const file of scripts) {
    const response = await request(router, `/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers['content-type'], /^application\/javascript/, file);
    assert.equal(response.headers['cache-control'], 'no-store', file);
    assert.ok(response.body.length > 100, `${file} must not be empty`);
  }
});

test('table inlines the same classic scripts in exact dependency order', async () => {
  const router = createDndRoutes({ appPackageDir: root });
  const response = await request(router, '/table');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  let previous = -1;
  for (const file of scripts) {
    const marker = `data-dnd-source="${file}"`;
    const index = response.body.indexOf(marker);
    assert.ok(index > previous, `${file} must follow its dependency`);
    assert.ok(response.body.includes(fs.readFileSync(path.join(root, 'ui', file), 'utf8')), `${file} source must remain intact`);
    assert.doesNotMatch(response.body, new RegExp(`<script src="/api/dnd/${file.replace('.', '\\.')}"`));
    previous = index;
  }
});

test('served tactical automation keeps rules local and delegates only prose', async () => {
  const router = createDndRoutes({ appPackageDir: root });
  const response = await request(router, '/table-automation.js');
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.body, /dmResolve\s*\(|api\s*\(\s*['"]\/dm['"]/);
  assert.match(response.body, /presentCombatDie\(outcome\.text, null, outcome\.rollEvent\)/);
  assert.match(response.body, /await presentPhase\(spoken\.text, tacticalReadMs\(spoken\.text\), false, null, tacticalDeadlineMs\(spoken\.text\)\)/);
  assert.match(response.body, /requestDungeonMasterCombatNarration\(current, outcome\)/);
  assert.doesNotMatch(response.body, /api\(['"]\/chat['"]/);
});
