/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the native Career experience to its existing authenticated search, map and unchanged named-role contract.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin release1.28.1 and require deferred map assets instead of a render-blocking Leaflet tag; real Chromium guards prove map loading and waypoint behavior.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Follow the admitted1.29.1 patch while preserving every experience, map and role assertion.
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

test('Career declares a real page experience on the existing authenticated search route', () => {
  assert.equal(manifest.version, '1.29.1');
  assert.notEqual(manifest.kind, 'group');
  assert.ok(manifest.uses.includes('application-authorization'));
  assert.ok(manifest.uses.includes('experience'));
  assert.deepEqual(manifest.experience, { version: 1, label: 'Intelligent Career',
    entry: '/api/career-hunter/search-ui', shell: 'page', skin: 'daylight' });
  assert.ok(manifest.routes.some(route => route.mountPath === '/api/career-hunter' && route.auth === 'oidc'));
  assert.equal(manifest.authorization.version, 1);
  assert.equal(manifest.authorization.catalog, 'authorization.yaml');
  assert.deepEqual(catalog.bindings.http.filter(binding => binding.method === 'GET' && binding.path === '/search-ui'),
    [{ id: 'search-ui', method: 'GET', path: '/search-ui', allOf: ['app.open'] }]);
  assert.equal(catalog.permissions['app.open'].effect, 'read');
});

test('experience metadata keeps existing role templates and required applications unchanged', () => {
  assert.deepEqual(manifest.dependencies.required.apps, []);
  assert.deepEqual(manifest.authorization.roleTemplates, [
    { id: 'member', version: 1, label: 'Career Hunter Member', members: [{ app: 'career-hunter', role: 'member' }] },
    { id: 'admin', version: 1, label: 'Career Hunter Administrator', members: [{ app: 'career-hunter', role: 'admin' }] },
  ]);
  assert.deepEqual(Object.keys(catalog.roles).sort(), ['admin', 'member']);
  assert.equal(manifest.experience.roleTemplates, undefined);
});

test('experience entry retains its actual search map and admitted configuration navigation', () => {
  const search = readFileSync(resolve(root, 'tools/career-search.html'), 'utf8');
  assert.match(search, /id="jobMap"/);
  assert.match(search, /asset\('script', 'career-leaflet\.js'\)/);
  assert.match(search, /asset\('script', 'career-search-map\.js'\)/);
  assert.doesNotMatch(search, /<script[^>]+src="[^"]*career-(?:leaflet|search-map)\.js"/);
  assert.match(search, /mapData = data; paintMap\(\)/);
  assert.match(search, /data-career-tool="career-settings"/);
  assert.match(search, /data-career-tool="career-companies"/);
  assert.match(search, /type: 'app-navigate', tool: link\.dataset\.careerTool/);
  assert.match(search, /window\.parent === window/);
});
