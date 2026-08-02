/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 02:20:00 | codex                                      | Guard the reusable cutaway catalog, semantic selection, optional-asset discovery, and path allowlist.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../lib/cutaway-catalog');

let checks = 0;
function check(value, message) { assert.ok(value, message); checks += 1; }

const ids = catalog.CUTAWAYS.map((entry) => entry.id);
check(ids.length === 6, 'six reusable cutaways ship in the catalog');
check(new Set(ids).size === ids.length, 'cutaway ids are unique');
check(catalog.selectCutaway({ phase: 'intro', shot: { type: 'audience-pan' } }) === 'show-open', 'intro selects the show open');
check(catalog.selectCutaway({ phase: 'faceoff', shot: { type: 'buzzer-race' } }) === 'buzzer-race', 'buzzer shot selects the race');
check(catalog.selectCutaway({ phase: 'steal', shot: { type: 'team-huddle' } }) === 'team-huddle', 'huddle shot selects the huddle');
check(catalog.selectCutaway({ phase: 'interview', shot: { type: 'interview' } }) === 'interview', 'interview shot selects the interview');
check(catalog.selectCutaway({ phase: 'strike', shot: { type: 'podium-closeup' } }) === 'strike', 'strike phase selects strike');
check(catalog.selectCutaway({ phase: 'round-win', shot: { type: 'celebration' } }) === 'celebration', 'celebration shot selects celebration');
check(catalog.selectCutaway({ phase: 'play', shot: { type: 'board' } }) === null, 'normal board play has no cutaway');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cutaways-'));
try {
  fs.mkdirSync(path.join(root, 'ui', 'cutaways'), { recursive: true });
  check(catalog.listCutaways(root).every((entry) => entry.available === false), 'missing clips are reported unavailable');
  fs.writeFileSync(path.join(root, 'ui', 'cutaways', 'celebration.mp4'), Buffer.from('test-mp4'));
  const listed = catalog.listCutaways(root).find((entry) => entry.id === 'celebration');
  check(listed.available && listed.src.endsWith('/celebration.mp4'), 'present clip is discoverable');
  check(!!catalog.resolveCutawayFile(root, 'celebration'), 'allowlisted asset resolves');
  check(catalog.resolveCutawayFile(root, '../package') === null, 'traversal-shaped id is rejected');
  check(catalog.resolveCutawayFile(root, 'not-in-catalog') === null, 'unknown asset is rejected');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`cutaways.test.js: ${checks} checks passed`);
