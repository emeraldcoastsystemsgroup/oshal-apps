/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the Classroom tab bar showed two tabs both labelled "Classroom": the first opened the
 *   experience's own home (/api/classroom-experience/app), the second Little Monsters' dashboard (/api/education/dashboard?audience=classroom).
 *   Every surface this experience composes, read from its component's real manifest (ui.static by toolName), has its own label,
 *   distinct from the others and from the experience's own label.
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
  const experience = load('classroom-experience').experience;
  assert.equal(experience.label, 'Classroom');
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
  assert.equal(seen.get('Class dashboard'), 'little-monsters/lm-dashboard');
});
