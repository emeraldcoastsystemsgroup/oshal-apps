/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roles named for people and shown in the product (judge's report 2026-11-11, change 11). Career's two role templates were labelled with the package's internal name and no screen named a role. This holds: the templates are labelled Job seeker and Job source administrator with their ids, versions and members exactly as they were and the catalog's two roles untouched; the frame says the same two words, and decides which from the person's own profile, where the Companies page (the page the catalog binds to career.administer) is listed only for a person the server admits to it; a profile that gave no page says nothing; and the bar calls the two borrowed pages under Profile & contacts Photo and Posts without touching their packages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(root, '../../oshal/src'));
const toolchain = [process.env.STORE_CI_TOOLCHAIN, resolve(root, '../scripts/toolchain/node_modules'), resolve(core, 'node_modules')]
  .filter(Boolean).find((directory) => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');
const manifest = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(readFileSync(resolve(root, 'authorization.yaml'), 'utf8'));
const frame = createRequire(import.meta.url)('../tools/career-frame.js');

const item = (id, label, href, toolName) => ({ id, label, section: 'top', toolUi: { iframeUrl: href, visibilityToolName: toolName } });
/** A person's profile in the shape the kernel answers: `prefix` is the front door's member prefix, or empty for Career's own. */
const profile = (prefix, administrator) => ({ ribbon: { items: [
  item(`tool-${prefix}career-home`, 'Home', '/api/career-hunter/home', 'career-home'),
  item(`tool-${prefix}career-search`, 'Find jobs', '/api/career-hunter/search-ui', 'career-search'),
  item(`tool-${prefix}career-profile-studio`, 'LinkedIn profile', '/api/career-hunter/profile-studio', 'career-profile-studio'),
  prefix ? item('tool-portrait-studio--portrait-studio', 'Portrait Studio', '/api/portrait-studio/app', 'portrait-studio')
    : item('tool-career-portrait-studio', 'Portrait Studio', '/api/portrait-studio/app', 'career-portrait-studio'),
  ...(prefix ? [item('tool-social--social-workspace', 'Workspace', '/api/social/workspace', 'social-workspace'),
    item('tool-social--social-accounts', 'Accounts', '/utilities', 'social-accounts')] : []),
  item(`tool-${prefix}career-settings`, 'Settings', '/api/career-hunter/settings', 'career-settings'),
  ...(administrator ? [item(`tool-${prefix}career-companies`, 'Companies', '/api/career-hunter/companies-admin', 'career-companies')] : []),
] } });

test('the two role templates are named for people, and nothing but their labels changed', () => {
  assert.deepEqual(manifest.authorization.roleTemplates, [
    { id: 'member', version: 1, label: 'Job seeker', members: [{ app: 'career-hunter', role: 'member' }] },
    { id: 'admin', version: 1, label: 'Job source administrator', members: [{ app: 'career-hunter', role: 'admin' }] },
  ]);
  assert.deepEqual(Object.keys(catalog.roles).sort(), ['admin', 'member']);
  assert.deepEqual(catalog.roles.member.grants.map((grant) => grant.permission), ['app.open', 'career.read', 'career.change', 'career.execute']);
  assert.deepEqual(catalog.roles.admin.grants.map((grant) => grant.permission), ['app.open', 'career.read', 'career.change', 'career.execute', 'career.administer']);
  assert.equal(manifest.authorization.roleTemplates.some((template) => /Career Hunter/.test(template.label)), false, 'no label carries the package\'s internal name');
});

test('the page whose presence the frame reads is the one the catalog binds to career.administer', () => {
  const tile = manifest.ui.static.find((entry) => entry.toolName === 'career-companies');
  assert.equal(tile.iframeUrl, '/api/career-hunter/companies-admin');
  assert.deepEqual(catalog.bindings.http.filter((binding) => binding.method === 'GET' && binding.path === '/companies-admin'),
    [{ id: 'companies-admin-ui', method: 'GET', path: '/companies-admin', allOf: ['career.administer'] }]);
  assert.equal(catalog.roles.member.grants.some((grant) => grant.permission === 'career.administer'), false, 'a job seeker does not hold it');
});

test('the frame says the role in the words the templates carry, from the person\'s own profile', () => {
  const [seeker, administrator] = manifest.authorization.roleTemplates.map((template) => template.label);
  for (const prefix of ['', 'career-hunter--']) {
    assert.equal(frame.roleOf(frame.navEntries(profile(prefix, false))), seeker, `a profile without Companies (${prefix || 'career-hunter'})`);
    assert.equal(frame.roleOf(frame.navEntries(profile(prefix, true))), administrator, `a profile with Companies (${prefix || 'career-hunter'})`);
  }
});

test('a profile that gave no page says nothing, and only Career\'s own Companies page counts', () => {
  assert.equal(frame.roleOf([]), '');
  assert.equal(frame.roleOf(null), '');
  assert.equal(frame.roleOf(frame.navEntries(null)), '');
  const elsewhere = { ribbon: { items: [item('tool-career-home', 'Home', '/api/career-hunter/home', 'career-home'),
    item('tool-other--career-companies', 'Companies', '/api/other-app/companies-admin', 'career-companies'),
    item('tool-career-companies-list', 'Companies list', '/api/career-hunter/companies-admin/list', 'career-companies-list')] } };
  assert.equal(frame.roleOf(frame.navEntries(elsewhere)), 'Job seeker', 'another application\'s page, or another address, is not the administrator\'s page');
});

test('the bar calls the two borrowed pages under Profile & contacts Photo and Posts, in either profile', () => {
  const label = (entries, view) => entries.find((entry) => entry.view === view)?.label;
  const group = frame.navEntries(profile('career-hunter--', false)), own = frame.navEntries(profile('', false));
  assert.equal(label(group, 'portrait-studio'), 'Photo');
  assert.equal(label(own, 'portrait-studio'), 'Photo');
  assert.equal(label(group, 'social-workspace'), 'Posts');
  assert.equal(label(group, 'social-accounts'), 'Accounts', 'a page the bar has no word for keeps its own');
  assert.equal(label(group, 'profile-studio'), 'LinkedIn profile', 'Career\'s own pages keep the manifest\'s label');
  const section = frame.sections(group).primary.find((part) => part.label === 'Profile & contacts');
  assert.deepEqual(section.pages.map((page) => page.label), ['LinkedIn profile', 'Photo', 'Posts']);
  // Career's manifest still names the tile for the operator's shell; the other packages are not edited.
  assert.equal(manifest.ui.static.find((entry) => entry.toolName === 'career-portrait-studio').label, 'Portrait Studio');
});
