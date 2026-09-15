/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The `prop` kind seam against embodied's compiled capability manifest (read-only cross-package import, the way circuit-lab reads CAD Studio's contract): our manifest carries exactly embodied's CapabilityManifest fields; our vocabulary row has embodied's row shape (senses, acts, minSafetyClass); embodied's validator still REFUSES kind `prop` today — that refusal is the fold-in target and this test goes red the day it lands, so the duplicate vocabulary here gets removed rather than forgotten; the safety class rises to kinetic on a strong servo; e-stop and disarm are confirm-exempt.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | THE FOLD-IN LANDED (ADR-156 D6, core BACKLOG 2026-09-14). The seam inverted: embodied now OWNS `KIND_VOCABULARY.prop` and this test asserts AGREEMENT instead of refusal. It imports embodied's real row and fails on any drift in either direction; it feeds a real rig's manifest — the skull template, built by this package's own compiler from the servo catalog — to embodied's own `validateManifest` and requires it to be ACCEPTED; it holds the confirm rule to embodied's `actRequiresConfirm`; and it asserts nothing here is invented, so the row cannot be quietly re-forked. The one thing it still pins as REFUSED is a prop on the swarm rail — the ADR-149 gate B20 records — because learning the word must not mint the node.
 *
 * Dependency-free: plain node against routes/engine and embodied/routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const EMBODIED = path.join(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'nodes', 'capability-manifest.js');
assert.ok(fs.existsSync(EMBODIED), `embodied's compiled capability manifest must exist for the seam test (${EMBODIED})`);
const embodied = require(EMBODIED);

const rows = E.servoMap(E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json')).servos);
const templates = E.buildTemplates(rows);
const skull = templates.find((t) => t.id === 'skull');

test('embodied owns the prop row, and ours is that row — any drift, either way, fails here', () => {
  const theirs = embodied.KIND_VOCABULARY.prop;
  assert.ok(theirs, "embodied must carry KIND_VOCABULARY.prop — the ADR-156 D6 fold-in");
  // Value equality both ways: a sense or act added on either side without the other is a fork.
  assert.deepEqual([...E.PROP_VOCABULARY.senses], [...theirs.senses]);
  assert.deepEqual([...E.PROP_VOCABULARY.acts], [...theirs.acts]);
  assert.equal(E.PROP_VOCABULARY.minSafetyClass, theirs.minSafetyClass);
  assert.equal(theirs.minSafetyClass, 1, 'a micro-servo eye mechanism is low-energy, not kinetic');
  // Shape equality against a DIFFERENT kind, so a field added to the vocabulary's row shape is
  // caught even when the prop row itself is untouched.
  assert.deepEqual(Object.keys(E.PROP_VOCABULARY).sort(), Object.keys(embodied.KIND_VOCABULARY.drone).sort());
  // And the package names embodied as the owner, which is what the capabilities route publishes.
  assert.equal(E.PROP_VOCABULARY_OWNER, 'embodied');
});

test("a real rig's manifest is ACCEPTED by embodied's own validateManifest", () => {
  // Not a hand-written fixture: the skull template built from the servo catalog, through this
  // package's own capabilityManifestFor. If the rig compiler ever emits a field embodied does not
  // know, or an act outside the row, this is where it is caught.
  const ours = E.capabilityManifestFor('prop-skull', skull.rig, 11);
  const verdict = embodied.validateManifest(ours);
  assert.equal(verdict.ok, true, `embodied refused a real rig: ${verdict.ok ? '' : verdict.issues.join('; ')}`);
  assert.deepEqual(verdict.manifest, ours, 'embodied validates our manifest field for field, unchanged');
  assert.equal(ours.kind, 'prop');
  assert.equal(ours.safetyClass, 2, 'an 11 kg·cm servo is kinetic');
  assert.deepEqual(ours.envelope, { channels: 7, maxDegPerS: 600, supplyVolts: 6, supplyAmps: 5, stallKgCm: 11 });
  // The low-energy end of the same kind, also through embodied.
  const eyes = E.capabilityManifestFor('prop-eyes', templates[0].rig, 1.8);
  assert.equal(eyes.safetyClass, 1, 'micro servos are low-energy');
  assert.equal(embodied.validateManifest(eyes).ok, true);
});

test('nothing here is invented — every sense and act is one embodied already carries', () => {
  // The fold-in is only finished when there is ONE decision. The deep-equal above fails on drift;
  // this fails on the specific direction that matters — a sense or act minted in this package and
  // never agreed with the vocabulary's owner — and names the one that was invented.
  for (const s of E.PROP_VOCABULARY.senses) assert.ok(embodied.KIND_VOCABULARY.prop.senses.includes(s), `sense ${s} is not in embodied's row`);
  for (const a of E.PROP_VOCABULARY.acts) assert.ok(embodied.KIND_VOCABULARY.prop.acts.includes(a), `act ${a} is not in embodied's row`);
  assert.equal(Object.isFrozen(E.PROP_VOCABULARY), true, 'the pinned row is frozen — it is read, never edited at runtime');
});

test("confirm-exempt agrees with embodied's rule, and our rail is stricter than the floor", () => {
  const armed = embodied.validateManifest(E.capabilityManifestFor('prop-skull', skull.rig, 11)).manifest;
  for (const act of E.PROP_CONFIRM_EXEMPT) {
    assert.ok(embodied.CONFIRM_EXEMPT_ACTS.has(act), `embodied must also exempt ${act}`);
    assert.equal(embodied.actRequiresConfirm(armed, act), false, `${act} must never wait for a confirm`);
  }
  assert.ok(E.PROP_CONFIRM_EXEMPT.has('e-stop') && E.PROP_CONFIRM_EXEMPT.has('disarm'));
  assert.equal(E.PROP_CONFIRM_EXEMPT.has('pose'), false);
  assert.equal(embodied.actRequiresConfirm(armed, 'pose'), true);
  // The floor says a class-1 rig needs no confirm at all. THIS package still answers 428 to an
  // unconfirmed arm at every class (routes.core.test.js proves it), because a person should be in
  // front of a mechanism before it moves. A kind is a minimum, never a ceiling.
  const low = embodied.validateManifest(E.capabilityManifestFor('prop-eyes', templates[0].rig, 1.8)).manifest;
  assert.equal(embodied.actRequiresConfirm(low, 'arm'), false);
});

test('the kind is vocabulary only — a prop still does not enrol as a node on the rail', () => {
  // ADR-156 D5: under the ADR-149 gate a package-owned machine caller is refused on the box, so a
  // prop is driven from the person's browser session. This is the clause the BACKLOG entry left
  // explicitly out of scope, and it stays out until that decision is made.
  const embodiedFleet = path.join(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'node', 'node-fleet.js');
  assert.ok(fs.existsSync(embodiedFleet));
  assert.throws(
    () => require(embodiedFleet).validateHeartbeat({ nodeId: 'prop-skull', kind: 'prop', endpointUrl: 'http://127.0.0.1:9000', protocol: 1, engine: 'animatronics', version: '0.2.0', buildHash: 'x', sessions: 0 }),
    /kind must be "plant" or "drone"/,
  );
});
