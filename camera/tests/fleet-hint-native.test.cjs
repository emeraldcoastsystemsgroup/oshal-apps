/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Camera Ops Fleet hint told the person to run `npm run camera:node` with the swarm secret: a script of the retired platform checkout (its package.json), absent from the native kernel, which also refuses the legacy service-secret heartbeat (bridge authz_compat hasValidServiceSecret() is false). The page must name no npm script or swarm secret and say no camera node ships with this installation. Red on the previous page.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'camera-ops.html'), 'utf8');
/** The page without its comments: what a person can see or the script can show. */
const VISIBLE = PAGE.replace(/<!--[\s\S]*?-->/g, '');

test('the Fleet hint names no retired npm script or swarm secret', () => {
  assert.doesNotMatch(VISIBLE, /npm run/);
  assert.doesNotMatch(VISIBLE, /camera:node/);
  assert.doesNotMatch(VISIBLE, /swarm secret/i);
});

test('the Fleet hint says no camera node ships with this installation', () => {
  assert.match(VISIBLE, /No camera node (or flight simulator )?ships with this installation, so none can be added here/);
});

test('an empty fleet shows the fleet route\'s own detail, not "start a camera node"', () => {
  assert.doesNotMatch(VISIBLE, /start a camera node/);
  assert.match(VISIBLE, /fleetDetail = typeof r\.detail === 'string' \? r\.detail : '';/);
  assert.match(VISIBLE, /mk\('div', 'muted', fleetDetail \|\| 'No cameras are connected\.'\)/);
});
