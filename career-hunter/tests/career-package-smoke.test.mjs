/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.67.1: Guard career-hunter/oshal-app.yaml within a 112 KiB budget (>= 16 KiB margin under package-smoke's 128 KiB ceiling) and verify createPackageSmokeRoutes answers 200 ready for the real package and 503 package_integrity_failed when oversized.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRouter, loadCompiledModules, startServer } from './helpers/career-route-harness.mjs';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MANIFEST_BUDGET_BYTES = 112 * 1024;
const SMOKE_HARD_CEILING_BYTES = 128 * 1024;

function loadSmokeFactory() {
  const { modules } = loadCompiledModules(
    { smoke: 'routes/package-smoke.js' },
    { express: { Router: () => createRouter() } },
  );
  return modules.smoke.createPackageSmokeRoutes;
}

function invokeMockGetRoot(router) {
  const route = router.find('GET', '/');
  assert.ok(route, 'expected GET / handler on package-smoke router');
  let statusCode = 200;
  let jsonBody;
  const res = {
    status(code) { statusCode = code; return res; },
    json(payload) { jsonBody = payload; return res; },
  };
  route.handler({ method: 'GET', path: '/' }, res);
  return { statusCode, jsonBody };
}

test('oshal-app.yaml stays within the 112 KiB budget and CHANGELOG.md retains archived notes', () => {
  const manifestPath = path.join(pkgDir, 'oshal-app.yaml');
  const stat = fs.statSync(manifestPath);
  assert.ok(stat.isFile() && stat.size > 0, 'oshal-app.yaml must be a non-empty regular file');
  assert.ok(
    stat.size <= MAX_MANIFEST_BUDGET_BYTES,
    `oshal-app.yaml is ${stat.size} bytes; keep <= ${MAX_MANIFEST_BUDGET_BYTES} bytes (>= 16 KiB below ${SMOKE_HARD_CEILING_BYTES}) by moving release essays to CHANGELOG.md`,
  );
  const changelogStat = fs.statSync(path.join(pkgDir, 'CHANGELOG.md'));
  assert.ok(changelogStat.isFile() && changelogStat.size > 64 * 1024, 'CHANGELOG.md must retain archived manifest release notes');
});

test('createPackageSmokeRoutes returns 200 ready on mock Express req/res and loopback HTTP', async () => {
  const manifestSource = fs.readFileSync(path.join(pkgDir, 'oshal-app.yaml'), 'utf8');
  const versionMatch = manifestSource.match(/^version:\s*(\d+)\.(\d+)\.(\d+)\s*$/m);
  assert.ok(versionMatch, 'oshal-app.yaml must declare a plain semver version');
  const expectedVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
  const [maj, min, pat] = versionMatch.slice(1).map(Number);
  assert.ok(maj > 1 || (maj === 1 && (min > 67 || (min === 67 && pat >= 1))), `expected >= 1.67.1, got ${expectedVersion}`);

  const createPackageSmokeRoutes = loadSmokeFactory();
  const router = createPackageSmokeRoutes({ appPackageDir: pkgDir });
  const expectedPayload = {
    status: 'ready',
    package: 'career-hunter',
    version: expectedVersion,
    manifest: 'verified',
  };

  const mockResult = invokeMockGetRoot(router);
  assert.equal(mockResult.statusCode, 200);
  assert.deepStrictEqual(mockResult.jsonBody, expectedPayload);

  const { server, baseUrl } = await startServer(router, () => undefined);
  try {
    const httpRes = await fetch(`${baseUrl}/api/career-hunter/`);
    assert.equal(httpRes.status, 200);
    assert.deepStrictEqual(await httpRes.json(), expectedPayload);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createPackageSmokeRoutes fails closed with 503 when a manifest exceeds 128 KiB', (t) => {
  const tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'career-smoke-oversize-'));
  t.after(() => fs.rmSync(tmpPkg, { recursive: true, force: true }));
  const header = 'name: career-hunter\nversion: 1.67.1\n';
  const padding = `# ${'x'.repeat(SMOKE_HARD_CEILING_BYTES - header.length)}\n`;
  fs.writeFileSync(path.join(tmpPkg, 'oshal-app.yaml'), header + padding, 'utf8');
  assert.ok(fs.statSync(path.join(tmpPkg, 'oshal-app.yaml')).size > SMOKE_HARD_CEILING_BYTES);

  const createPackageSmokeRoutes = loadSmokeFactory();
  const router = createPackageSmokeRoutes({ appPackageDir: tmpPkg });
  const result = invokeMockGetRoot(router);
  assert.equal(result.statusCode, 503);
  assert.deepStrictEqual(result.jsonBody, { status: 'unavailable', code: 'package_integrity_failed' });
});
