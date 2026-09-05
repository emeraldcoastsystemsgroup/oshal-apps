/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real-engine guard for the user-target gate: `python -m jobhunter classify` recognizes the supported job-board URL shapes, refuses everything else, never touches a database, and reports a supported list that matches the classifier's own return literals — one pattern set, no TypeScript copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function classify(url) {
  const result = spawnSync(python, ['-m', 'jobhunter', 'classify', '--url', url], {
    cwd: packageRoot,
    env: { ...process.env, PYTHONPATH: join(packageRoot, 'engine'), JOBHUNTER_STORE_ROOT: join(packageRoot, '.no-such-store') },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]);
}

test('classify recognizes the supported job-board URL shapes', () => {
  assert.deepEqual(classify('https://boards.greenhouse.io/acme').match, { ats_type: 'greenhouse', token: 'acme' });
  assert.deepEqual(classify('jobs.lever.co/acme').match, { ats_type: 'lever', token: 'acme' });
  assert.deepEqual(classify('https://jobs.ashbyhq.com/acme').match, { ats_type: 'ashby', token: 'acme' });
  assert.deepEqual(classify('https://acme.wd5.myworkdayjobs.com/External').match, { ats_type: 'workday', token: 'acme:wd5:External' });
  assert.equal(classify('https://careers.acme.icims.com/jobs').match.ats_type, 'icims');
});

test('classify rejects URLs that fit no supported pattern, and a bare Workday host', () => {
  for (const url of ['https://example.com/about', 'https://www.acme.com/careers', 'not a url at all', '']) {
    const verdict = classify(url);
    assert.equal(verdict.ok, true, url);
    assert.equal(verdict.match, null, url);
    assert.ok(Array.isArray(verdict.supported) && verdict.supported.includes('greenhouse'), 'the reply names the supported boards');
  }
  const host = classify('https://acme.wd5.myworkdayjobs.com/');
  assert.equal(host.match, null);
  assert.match(host.reason, /job-site URL/);
});

test('the supported list is the classifier\'s own return literals — one pattern set, no second copy', () => {
  const source = readFileSync(join(packageRoot, 'engine', 'jobhunter', 'resolve.py'), 'utf8');
  const body = source.slice(source.indexOf('def classify_url('), source.indexOf('def classify_url_deep('));
  const literals = new Set([...body.matchAll(/return \("([a-z_]+)"/g)].map((m) => m[1]));
  literals.delete('workday_host');
  const declared = classify('https://boards.greenhouse.io/acme').supported;
  assert.deepEqual([...declared].sort(), [...literals].sort());
});
