/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: run the parse résumé's Python contract (tests/career-parse-resume-contract.py: format, structure, edges, the real parse over Word paragraphs and pdftotext, the export CLI) and refuse any failed check; the comparison the plain reader made is printed for the record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.CAREER_PYTHON || process.env.JOBHUNTER_PYTHON || 'python3';

test('the parse résumé is laid out for a parser and a plain reader recovers every role from it, not from the executive résumé (Python contract)', () => {
  const run = spawnSync(PYTHON, [fileURLToPath(new URL('./career-parse-resume-contract.py', import.meta.url))], { encoding: 'utf8', timeout: 180000 });
  const last = String(run.stdout || '').trim().split('\n').pop() || '{}';
  const summary = JSON.parse(last.startsWith('{') ? last : '{}');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.deepEqual(summary.failed, [], JSON.stringify(summary));
  assert.ok(summary.checks >= 50, `expected >= 50 checks, got ${summary.checks}`);
  assert.deepEqual(summary.comparison.word.parse, { exact: 6, of: 6, read: 6, missed: [] });
  assert.ok(summary.comparison.word.executive.exact < 6 && summary.comparison.pdf.executive.exact < 6, JSON.stringify(summary.comparison));
  console.log('parse comparison', JSON.stringify(summary.comparison));
});
