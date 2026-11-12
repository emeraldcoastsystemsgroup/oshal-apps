/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the native Career experience to its existing authenticated search, map and unchanged named-role contract.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin release1.28.1 and require deferred map assets instead of a render-blocking Leaflet tag; real Chromium guards prove map loading and waypoint behavior.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Follow the admitted1.29.1 patch while preserving every experience, map and role assertion.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Keep the actual experience and authority contract across valid patch releases rather than pinning an obsolete application version.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Search Jobs links to the board and the matched search since 08fd1631; configuration moved to the Intelligent Career ribbon.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.53.0: the experience opens on Career's home page (GET /home, bound to app.open like the search page), which carries the job search box; the search route keeps its own binding.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | The two role templates are labelled for people, Job seeker and Job source administrator (judge's report 2026-11-11, change 11); their ids, versions and members are still pinned here exactly as they were.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(root, '../../oshal/src'));
const candidates = [process.env.STORE_CI_TOOLCHAIN, resolve(root, '../scripts/toolchain/node_modules'), resolve(core, 'node_modules')].filter(Boolean);
const toolchain = candidates.find(directory => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');
const manifest = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(readFileSync(resolve(root, 'authorization.yaml'), 'utf8'));

test('Career declares a real page experience on its authenticated home page, beside the search route', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.notEqual(manifest.kind, 'group');
  assert.ok(manifest.uses.includes('application-authorization'));
  assert.ok(manifest.uses.includes('experience'));
  assert.deepEqual(manifest.experience, { version: 1, label: 'Intelligent Career',
    entry: '/api/career-hunter/home', shell: 'page', skin: 'daylight' });
  assert.ok(manifest.routes.some(route => route.mountPath === '/api/career-hunter' && route.auth === 'oidc'));
  assert.equal(manifest.authorization.version, 1);
  assert.equal(manifest.authorization.catalog, 'authorization.yaml');
  assert.deepEqual(catalog.bindings.http.filter(binding => binding.method === 'GET' && binding.path === '/search-ui'),
    [{ id: 'search-ui', method: 'GET', path: '/search-ui', allOf: ['app.open'] }]);
  assert.deepEqual(catalog.bindings.http.filter(binding => binding.method === 'GET' && binding.path === '/home'),
    [{ id: 'home-ui', method: 'GET', path: '/home', allOf: ['app.open'] }]);
  assert.equal(manifest.ui.static[0].toolName, 'career-home');
  assert.equal(manifest.ui.static[0].iframeUrl, manifest.experience.entry);
  assert.equal(manifest.ribbon.defaultView, 'career-home');
  assert.equal(catalog.permissions['app.open'].effect, 'read');
});

test('experience metadata keeps existing role templates and required applications unchanged', () => {
  assert.deepEqual(manifest.dependencies.required.apps, []);
  assert.deepEqual(manifest.authorization.roleTemplates, [
    { id: 'member', version: 1, label: 'Job seeker', members: [{ app: 'career-hunter', role: 'member' }] },
    { id: 'admin', version: 1, label: 'Job source administrator', members: [{ app: 'career-hunter', role: 'admin' }] },
  ]);
  assert.deepEqual(Object.keys(catalog.roles).sort(), ['admin', 'member']);
  assert.equal(manifest.experience.roleTemplates, undefined);
});

test('experience entry retains its actual search map and admitted board navigation', () => {
  const search = readFileSync(resolve(root, 'tools/career-search.html'), 'utf8');
  assert.match(search, /id="jobMap"/);
  assert.match(search, /asset\('script', 'career-leaflet\.js'\)/);
  assert.match(search, /asset\('script', 'career-search-map\.js'\)/);
  assert.doesNotMatch(search, /<script[^>]+src="[^"]*career-(?:leaflet|search-map)\.js"/);
  assert.match(search, /mapData = data; paintMap\(\)/);
  assert.match(search, /data-career-tool="career-board"/);
  assert.match(search, /data-career-tool="career-search"/);
  // Navigation behavior, including grouped surface names and standalone links,
  // is exercised by the real browser application-flow proof.
});
