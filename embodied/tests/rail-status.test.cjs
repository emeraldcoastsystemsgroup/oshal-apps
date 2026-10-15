/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: the physics status line read 'rail: no node has heartbeat in' (cut off). Runs the surface's own railStatus() from tools/embodied.js: no online node is a whole sentence, online nodes are named as before.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: the surface's own physicsLine(): an engine that is not there reads 'physics engine: not available on this installation', never the failure text or the operator's docker exec install command; a connected engine is named as before.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'embodied.js'), 'utf8');
const railStatus = new Function(`${SOURCE.match(/ {2}function railStatus\(nodes\) \{[\s\S]*?\n {2}\}\n/)[0]}\nreturn railStatus;`)();

test('with no online node the rail line is a whole sentence', () => {
  assert.equal(railStatus([]), 'node rail: no physics node is online (none has sent a heartbeat)');
  assert.doesNotMatch(railStatus([]), /heartbeat in$/);
});

test('online nodes are named, a stale build marked', () => {
  assert.equal(railStatus([{ nodeId: 'n1' }, { nodeId: 'n2', stale: true }]), 'node rail: n1 online, n2 online (STALE build)');
});

test('the poll uses railStatus for the status line', () => {
  assert.match(SOURCE, /const rail = railStatus\(nodes\);/);
  assert.doesNotMatch(SOURCE, /: 'rail: no node has heartbeat in'/);
});

test('an engine that is not there is told in words, never the install command', () => {
  const match = SOURCE.match(/ {2}function physicsLine\(e\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(match, 'the surface has physicsLine');
  const physicsLine = new Function(`${match[0]}\nreturn physicsLine;`)();
  const down = physicsLine({ connected: false, code: 'capability_unavailable', reason: 'unavailable: no engine is configured for this application',
    installHint: 'docker exec <api-container> sh /app/workspace-shared/deployed-apps/embodied/engine/install-engine.sh' });
  assert.equal(down, 'physics engine: not available on this installation');
  assert.doesNotMatch(down, /docker|install-engine|unavailable:/);
  assert.equal(physicsLine({ connected: true, engine: 'mujoco', version: '3.3.5' }), 'physics engine: mujoco 3.3.5 connected');
  assert.match(SOURCE, /\$\('physics-status'\)\.textContent = `\$\{physicsLine\(e\)\} · \$\{rail\}`;/);
});
