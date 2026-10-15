/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: the Home tab strip read 'Home | Home | ... | Home' and the three tabs opened three
 *   different applications (Home itself, Smart Home's device dashboard and Little Monsters' classroom dashboard), because the
 *   composed surfaces kept their own apps' "Home" labels. Every surface this experience composes, read from its component's real
 *   manifest (ui.static by toolName), has its own label, distinct from the others and from the experience's own label.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Little Monsters' dashboard tab is now "Class dashboard" (sweep 10: in the Classroom experience it
 *   repeated that experience's own "Classroom" label); classroom-experience/tests/surface-labels.test.cjs holds the same rule there.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE = path.resolve(__dirname, '..', '..');
const yaml = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const load = (app) => yaml.load(fs.readFileSync(path.join(STORE, app, 'oshal-app.yaml'), 'utf8'));

test('every composed surface has its own tab label, none repeating the experience\'s own', () => {
  const experience = load('home-experience').experience;
  const labels = experience.surfaces.map(({ app, surface }) => {
    const ui = ((load(app).ui || {}).static || []).find((entry) => entry.toolName === surface);
    assert.ok(ui, `${app} declares the ${surface} surface`);
    return { key: `${app}/${surface}`, label: String(ui.label) };
  });
  for (const { key, label } of labels) assert.notEqual(label, experience.label, `${key} is not labelled ${experience.label}`);
  const seen = new Map();
  for (const { key, label } of labels) {
    assert.ok(!seen.has(label), `${key} and ${seen.get(label)} are both labelled ${label}`);
    seen.set(label, key);
  }
  assert.equal(seen.get('Smart Home'), 'home/home-dashboard');
  assert.equal(seen.get('Class dashboard'), 'little-monsters/lm-dashboard');
});
