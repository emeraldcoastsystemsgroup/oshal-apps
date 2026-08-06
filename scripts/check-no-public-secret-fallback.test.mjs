/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-prove the store-wide key guard against both the retired key and a renamed direct literal fallback while allowing fail-closed resolution.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove empty, bracket-access, indirect-variable, and computed SESSION_SECRET coalescing cannot bypass the store gate.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { findPublicSecretFallbacks } from './check-no-public-secret-fallback.mjs';

const fixtures = [];

/** Create the smallest valid store tree used by one guard case. */
function fixtureWith(runtimeSource) {
  const root = mkdtempSync(join(tmpdir(), 'oshal-store-secret-guard-'));
  fixtures.push(root);
  const app = join(root, 'sample-app');
  mkdirSync(join(app, 'routes'), { recursive: true });
  writeFileSync(join(app, 'oshal-app.yaml'), 'name: sample-app\nversion: 1.0.0\n', 'utf8');
  writeFileSync(join(app, 'routes', 'runtime.js'), runtimeSource, 'utf8');
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('finds the retired public key without embedding it in this guard test', () => {
  const retired = ['oshal', 'dev', 'secret'].join('-');
  const source = 'const key = process.env.' + 'SESSION_SECRET || ' + JSON.stringify(retired) + ';\n';
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.ok(findings.some((finding) => finding.kind === 'retired-public-key'));
});

test('finds a renamed direct string fallback, so renaming the known literal is not a bypass', () => {
  const source = 'const key = process.env.' + "SESSION_SECRET || 'another-public-key';\n";
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.deepEqual(findings.map((finding) => finding.kind), ['session-secret-coalescing']);
});

test('finds an empty-string fallback that would derive a known key', () => {
  const source = 'const key = process.env.' + "SESSION_SECRET || '';\n";
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.deepEqual(findings.map((finding) => finding.kind), ['session-secret-coalescing']);
});

test('finds bracket-access nullish coalescing', () => {
  const source = 'const key = process.env[' + "'SESSION_SECRET'] ?? getPublicDefault();\n";
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.deepEqual(findings.map((finding) => finding.kind), ['session-secret-coalescing']);
});

test('finds an indirect variable fallback', () => {
  const source = "const fallback = loadDefault();\nconst key = process.env." + 'SESSION_SECRET || fallback;\n';
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.deepEqual(findings.map((finding) => finding.kind), ['session-secret-coalescing']);
});

test('finds a computed fallback expression', () => {
  const source = 'const key = process.env.' + "SESSION_SECRET || String('public');\n";
  const findings = findPublicSecretFallbacks(fixtureWith(source));
  assert.deepEqual(findings.map((finding) => finding.kind), ['session-secret-coalescing']);
});

test('allows a fail-closed SESSION_SECRET resolver', () => {
  const source = "const secret = process.env.SESSION_SECRET; if (!secret) throw new Error('SESSION_SECRET required');\n";
  assert.deepEqual(findPublicSecretFallbacks(fixtureWith(source)), []);
});
