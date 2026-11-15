/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.3.8: what a person reads or hears in Payroll names the product
 *   Open Swarm (Roger, 2026-11-13: the UI says "Open Swarm"; technical identifiers keep their forms). Dependency-free
 *   plain-Node ESM guard for the store-ci payroll job over the compiled ACH return and RT-6 worksheets, the HTML
 *   surface, manifest, routes and TypeScript route sources outside comments.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Technical identifier forms that legitimately retain oshal in URLs, SQL tables, paths and env vars. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/[^\s"'<>]+/gi,
  /\bOSHAL_[A-Z0-9_]+\b/g,
  /\bx-oshal-[a-z0-9-]+\b/gi,
  /--oshal-[a-z0-9-]+/gi,
  /\boshal-app\.yaml\b/g,
  /\boshal_[a-z0-9_]+\b/g,
];

function stripAllowed(value) {
  let out = String(value || '');
  for (const pattern of ALLOWED_IDENTIFIERS) out = out.replace(pattern, '<ID>');
  return out;
}

function findProductName(value, where) {
  const cleaned = stripAllowed(value);
  return [...cleaned.matchAll(/\boshal\b/gi)].map(
    (m) => `${where}: "${m[0]}" in ${JSON.stringify(String(value).trim().slice(0, 160))}`,
  );
}

function stripComments(source, ext) {
  if (ext === '.yaml') return source.replace(/^\s*#.*$/gm, '');
  if (ext === '.html') return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

function listDirFiles(subDir, exts) {
  return readdirSync(join(ROOT, subDir), { withFileTypes: true })
    .filter((e) => e.isFile() && exts.includes(extname(e.name)))
    .map((e) => posix.join(subDir, e.name))
    .sort();
}

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers and URLs', () => {
  assert.equal(findProductName('oshal computes and produces; your bank executes.', 'desc').length, 1);
  assert.equal(findProductName('Computed by the oshal payroll engine', 'stub').length, 1);
  assert.equal(findProductName('Open Swarm computes and produces; your bank executes.', 'desc').length, 0);
  assert.equal(findProductName('OSHAL_APP_PACKAGE_DIR oshal-app.yaml oshal_payroll_runs', 'id').length, 0);
});

test('compiled RT-6 worksheet caveat, ACH NOC notes and Payroll surface name Open Swarm', async () => {
  const { formRt6 } = require('../routes/payroll-rt6.js');
  const pool = { query: async () => ({ rows: [] }) };
  const rt6 = await formRt6(pool, 'sub-1', { state_code: 'FL', suta_rate_pct: 2.7, suta_wage_base_cents: 700_000 }, 2026, 1);
  assert.match(rt6.caveat, /Open Swarm does not transmit to the Florida Department of Revenue/);
  assert.deepEqual(findProductName(rt6.caveat, 'rt6.caveat'), []);

  const html = readFileSync(join(ROOT, 'tools/payroll.html'), 'utf8');
  assert.match(html, /id="payrollLede">Open Swarm records payroll from the <span id="taxYear">2026<\/span> tax engine/);
  assert.match(html, /Open Swarm generates the NACHA file;/);
  assert.match(html, /Computed by the Open Swarm payroll engine/);
  assert.match(html, /Open Swarm does not send it — you upload it\./);
});

test('manifest, routes, TypeScript route sources and Payroll HTML surface name Open Swarm outside comments', () => {
  const manifest = readFileSync(join(ROOT, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /Open Swarm computes and produces; your bank and the agencies/);
  const files = [
    'oshal-app.yaml',
    ...listDirFiles('routes', ['.js']),
    ...listDirFiles('src-routes', ['.ts']),
    ...listDirFiles('tools', ['.html', '.js', '.mjs', '.css']),
  ];
  const problems = [];
  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const stripped = stripComments(raw, extname(rel));
    stripped.split('\n').forEach((line, idx) => {
      problems.push(...findProductName(line, `${rel}:${idx + 1}`));
    });
  }
  assert.deepEqual(problems, []);
});
