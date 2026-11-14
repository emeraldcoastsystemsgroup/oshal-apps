/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A role template must map its own application and every required application, the rule the native kernel applies when it loads a package (crates/packages/src/experience.rs validate_templates and validate_members: "role template must cover its application and every required component"). Career Coaching 0.1.1 required career-hunter and mapped it in neither template; every store check passed and the kernel refused the package at its first load on the test slot (409 package_rejected, 2026-11-14). This file holds the kernel's template rules for every store manifest, in the kernel's own words, and proves each one goes red on a changed manifest.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');

/** The kernel's sentences (crates/packages/src/experience.rs), so a store failure reads like the kernel's refusal. */
const COUNT = 'experience requires 1..32 role templates';
const MALFORMED = 'experience has a malformed or repeated role template';
const MEMBERS = 'role template requires 1..128 exact members';
const DECLARED = 'role template requires distinct exact roles for declared applications';
const COVER = 'role template must cover its application and every required component';

/**
 * @description Every store package manifest, by folder.
 * @returns {Map<string, object>} folder -> parsed oshal-app.yaml.
 */
function manifests() {
  const found = new Map();
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const file = path.join(ROOT, entry.name, 'oshal-app.yaml');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    found.set(entry.name, yaml.load(fs.readFileSync(file, 'utf8')));
  }
  return found;
}

/**
 * @description The required and optional applications a manifest declares, read as the kernel reads them
 *   (crates/packages/src/application_dependencies.rs read): a list is required applications, a mapping without
 *   required/optional is the required tier, otherwise the two tiers.
 * @param {object} manifest A parsed oshal-app.yaml.
 * @returns {{required: string[], optional: string[]}} Application names by tier.
 */
export function declaredApplications(manifest) {
  const block = manifest?.dependencies;
  if (Array.isArray(block)) return { required: block, optional: [] };
  if (!block || typeof block !== 'object') return { required: [], optional: [] };
  if (block.required !== undefined || block.optional !== undefined) {
    return { required: block.required?.apps ?? [], optional: block.optional?.apps ?? [] };
  }
  return { required: block.apps ?? [], optional: [] };
}

/** The kernel's slug: 1 to 64 of a-z, 0-9 and "-", starting with a letter or digit. */
const slug = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
/** The kernel's label: not blank, at most 128 characters, no control character. */
const label = (value) => typeof value === 'string' && value.trim() !== '' && [...value].length <= 128
  && !/\p{Cc}/u.test(value);
/** The kernel's role name: @app-admin, or a letter followed by letters, digits, "_", "." and "-", at most 128. */
const role = (value) => value === '@app-admin'
  || (typeof value === 'string' && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value));

/**
 * @description The kernel's member rules for one template (validate_members).
 * @param {object} template One role template.
 * @param {string} name The declaring application.
 * @param {{required: string[], optional: string[]}} apps Its declared applications.
 * @returns {string|null} The kernel's refusal, with what is missing, or null.
 */
function memberProblem(template, name, apps) {
  const members = template.members;
  if (!Array.isArray(members) || members.length < 1 || members.length > 128) return MEMBERS;
  const declared = new Set([name, ...apps.required, ...apps.optional]);
  const edges = new Set();
  const referenced = new Set();
  for (const member of members) {
    const edge = `${member?.app}\u0000${member?.role}`;
    if (!declared.has(member?.app) || !role(member?.role) || edges.has(edge)) {
      return `${DECLARED} (member ${member?.app}: ${member?.role})`;
    }
    edges.add(edge);
    referenced.add(member.app);
  }
  const missing = [name, ...apps.required].filter((app) => !referenced.has(app));
  return missing.length ? `${COVER} (no member maps ${missing.join(', ')})` : null;
}

/**
 * @description The kernel's rules for one list of role templates (validate_templates).
 * @param {unknown} templates The declared list.
 * @param {string} name The declaring application.
 * @param {{required: string[], optional: string[]}} apps Its declared applications.
 * @returns {string[]} One line per refusal, each starting with the application's name.
 */
function templateProblems(templates, name, apps) {
  if (!Array.isArray(templates) || templates.length < 1 || templates.length > 32) return [`${name}: ${COUNT}`];
  const problems = [];
  const ids = new Set();
  for (const template of templates) {
    const version = template?.version;
    if (!slug(template?.id) || !Number.isInteger(version) || version < 1 || !label(template?.label) || ids.has(template.id)) {
      problems.push(`${name}: ${MALFORMED} (${template?.id})`);
      continue;
    }
    ids.add(template.id);
    const problem = memberProblem(template, name, apps);
    if (problem) problems.push(`${name}: template ${template.id}: ${problem}`);
  }
  return problems;
}

/**
 * @description The kernel's role template rules over one manifest, wherever it declares them: under authorization
 *   or under experience. A manifest that declares no role template has nothing to check.
 * @param {object} manifest A parsed oshal-app.yaml.
 * @returns {string[]} One line per refusal, each starting with the application's name.
 */
export function roleTemplateProblems(manifest) {
  const apps = declaredApplications(manifest);
  return [manifest?.authorization?.roleTemplates, manifest?.experience?.roleTemplates]
    .filter((templates) => templates !== undefined)
    .flatMap((templates) => templateProblems(templates, manifest.name, apps));
}

test('every store package\'s role templates map the package itself and every required application', () => {
  const all = manifests();
  const declaring = [...all.values()].filter((manifest) => manifest?.authorization?.roleTemplates !== undefined
    || manifest?.experience?.roleTemplates !== undefined);
  assert.ok(declaring.length >= 20, `the store has role templates to check, found ${declaring.length}`);
  assert.ok(declaring.some((manifest) => declaredApplications(manifest).required.length > 0),
    'at least one checked package requires another application');
  assert.deepEqual([...all.values()].flatMap(roleTemplateProblems), []);
});

/** @description A valid package: it requires `office`, offers `music`, and its one template maps itself and `office`. */
function school() {
  return {
    name: 'school',
    dependencies: { required: { apps: ['office'] }, optional: { apps: ['music'] } },
    authorization: {
      version: 1,
      catalog: 'authorization.yaml',
      roleTemplates: [{
        id: 'learner', version: 1, label: 'Learner',
        members: [{ app: 'school', role: 'student' }, { app: 'office', role: '@app-admin' }],
      }],
    },
  };
}

/** @description A deep copy of the valid package after one change. */
function changed(change) {
  const manifest = structuredClone(school());
  change(manifest, manifest.authorization.roleTemplates[0]);
  return manifest;
}

test('the rule refuses the shape Career Coaching 0.1.1 shipped: a required application no template maps', () => {
  const coaching = {
    name: 'career-coaching',
    dependencies: { required: { apps: ['career-hunter'] }, optional: { apps: [] } },
    authorization: {
      version: 1,
      catalog: 'authorization.yaml',
      roleTemplates: [
        { id: 'seeker', version: 1, label: 'Coaching client', members: [{ app: 'career-coaching', role: 'seeker' }] },
        { id: 'coach', version: 1, label: 'Career coach', members: [{ app: 'career-coaching', role: 'coach' }] },
      ],
    },
  };
  assert.deepEqual(roleTemplateProblems(coaching), [
    `career-coaching: template seeker: ${COVER} (no member maps career-hunter)`,
    `career-coaching: template coach: ${COVER} (no member maps career-hunter)`,
  ]);
  // The same package is accepted once the application is optional: a template may map it or leave it out.
  coaching.dependencies = { required: { apps: [] }, optional: { apps: ['career-hunter'] } };
  coaching.authorization.roleTemplates[0].members.push({ app: 'career-hunter', role: 'member' });
  assert.deepEqual(roleTemplateProblems(coaching), []);
});

test('a template must map its own application and every required application, in each dependency shape', () => {
  assert.deepEqual(roleTemplateProblems(school()), []);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members.pop(); })),
    [`school: template learner: ${COVER} (no member maps office)`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members.shift(); })),
    [`school: template learner: ${COVER} (no member maps school)`]);
  assert.deepEqual(roleTemplateProblems(changed((m) => { m.dependencies.required.apps.push('library'); })),
    [`school: template learner: ${COVER} (no member maps library)`]);
  // The flat mapping and the list are the required tier, as the kernel reads them.
  for (const dependencies of [{ apps: ['office', 'library'] }, ['office', 'library']]) {
    assert.deepEqual(roleTemplateProblems(changed((m) => { m.dependencies = dependencies; })),
      [`school: template learner: ${COVER} (no member maps library)`]);
  }
  // Every template is held to the rule, not only the first.
  const second = changed((m) => {
    m.authorization.roleTemplates.push({ id: 'teacher', version: 1, label: 'Teacher', members: [{ app: 'school', role: 'teacher' }] });
  });
  assert.deepEqual(roleTemplateProblems(second), [`school: template teacher: ${COVER} (no member maps office)`]);
  // Templates declared by an experience block are held to the same rule.
  const shown = changed((m) => {
    m.experience = { version: 1, roleTemplates: m.authorization.roleTemplates };
    delete m.authorization.roleTemplates;
    m.experience.roleTemplates[0].members.pop();
  });
  assert.deepEqual(roleTemplateProblems(shown), [`school: template learner: ${COVER} (no member maps office)`]);
});

test('an optional application may be mapped or left out, and an undeclared one may not be mapped', () => {
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members.push({ app: 'music', role: 'listener' }); })), []);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members.push({ app: 'gallery', role: 'viewer' }); })),
    [`school: template learner: ${DECLARED} (member gallery: viewer)`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members.push({ app: 'office', role: '@app-admin' }); })),
    [`school: template learner: ${DECLARED} (member office: @app-admin)`]);
  for (const bad of ['*', '', '@admin', '9lives', 'a b']) {
    assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members[1].role = bad; })),
      [`school: template learner: ${DECLARED} (member office: ${bad})`], `role ${JSON.stringify(bad)}`);
  }
});

test('malformed, repeated and empty templates are refused, and a package without templates is not checked', () => {
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.members = []; })), [`school: template learner: ${MEMBERS}`]);
  assert.deepEqual(roleTemplateProblems(changed((m) => { m.authorization.roleTemplates = []; })), [`school: ${COUNT}`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.version = 0; })), [`school: ${MALFORMED} (learner)`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.id = 'Learner One'; })), [`school: ${MALFORMED} (Learner One)`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { t.label = ' '; })), [`school: ${MALFORMED} (learner)`]);
  assert.deepEqual(roleTemplateProblems(changed((m, t) => { m.authorization.roleTemplates.push(structuredClone(t)); })),
    [`school: ${MALFORMED} (learner)`]);
  assert.deepEqual(roleTemplateProblems({ name: 'plain', dependencies: { required: { apps: ['office'] } } }), []);
});
