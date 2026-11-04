/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Check pasted saved-job CSV uses the existing private file import with bounded, unambiguous input.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Give native owner-store publication enough time to return its import receipt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const support = readFileSync(new URL('../tools/career-settings-support.js', import.meta.url), 'utf8');
const a = support.indexOf('/* saved-jobs-file:start */'), b = support.indexOf('/* saved-jobs-file:end */');
assert.ok(a >= 0 && b > a);
const savedJobsFile = new Function(support.slice(a, b) + '\nreturn savedJobsFile;')();

test('pasted CSV becomes a CSV file with exactly the supplied job metadata', async () => {
  const csv = 'Job Title,Company Name,Job URL\nDeveloper,Example,https://www.linkedin.com/jobs/view/123/';
  const file = savedJobsFile(undefined, csv);
  assert.equal(file.name, 'linkedin-saved-jobs.csv');
  assert.equal(file.type, 'text/csv');
  assert.equal(await file.text(), csv);
  assert.match(support, /body\.append\('kind', 'linkedin-jobs'\)/);
  assert.match(support, /body\.append\('files', file\)/);
  assert.match(support, /json\(API \+ '\/artifacts\/upload', \{ method: 'POST', body \}, 60000\)/);
});

test('a chosen file is preserved and ambiguous or empty imports are refused', () => {
  const file = new File(['Job Title,Company Name,Job URL'], 'saved.csv');
  assert.equal(savedJobsFile(file, ''), file);
  assert.throws(() => savedJobsFile(file, 'other CSV'), /one source at a time/);
  assert.throws(() => savedJobsFile(undefined, '   '), /Choose a Saved Jobs CSV/);
});

test('files and pasted text share the same upload size bound', () => {
  assert.throws(() => savedJobsFile(undefined, 'x'.repeat(2 * 1024 * 1024 + 1)), /exceeds 2 MiB/);
  assert.throws(() => savedJobsFile(new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'large.csv'), ''), /exceeds 2 MiB/);
  const html = readFileSync(new URL('../tools/career-settings.html', import.meta.url), 'utf8');
  assert.match(html, /<label for="linkedinJobsCsv"/);
  assert.match(html, /<textarea id="linkedinJobsCsv"/);
});
