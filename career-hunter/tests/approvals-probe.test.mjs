/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify career-hunter declares `approvals:` on `/api/career-hunter/applications` and projects only `approval_required` rows onto the existing `/approve` and `/deny` routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify career-hunter's `approvals:` manifest block declares the exact `approve` and `decline` `/approve` and `/deny` action templates matched by `ApprovalsView.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test('oshal-app.yaml declares approvals probe and pinned approve/deny action templates', () => {
  const yaml = readFileSync(join(pkgDir, 'oshal-app.yaml'), 'utf8');
  assert.match(yaml, /^approvals:\s*\n\s+path:\s*\/api\/career-hunter\/applications\s*\n\s+itemsPointer:\s*\/approvals\b/m);
  assert.match(yaml, /approve:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/career-hunter\/applications\/\{postingId\}\/approve\b/);
  assert.match(yaml, /decline:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/career-hunter\/applications\/\{postingId\}\/deny\b/);
});

test('formatCareerApprovals projects only approval_required postings onto approve and deny endpoints', () => {
  const src = readFileSync(join(pkgDir, 'routes/career-application-routes.js'), 'utf8');
  assert.match(src, /exports\.formatCareerApprovals = formatCareerApprovals/);
  const fnMatch = /function formatCareerApprovals\(rows\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fnMatch, 'compiled formatCareerApprovals helper exists');
  const formatCareerApprovals = new Function(`return (${fnMatch[0]});`)();

  const items = formatCareerApprovals([
    { posting_id: 42, company: 'Acme Systems', title: 'Principal Rust Engineer', status: 'approval_required', updated_at: '2026-11-17T03:10:00Z' },
    { posting_id: 43, company: 'Beta Corp', title: 'Staff Engineer', status: 'applied' },
    { posting_id: 44, company: 'Gamma Inc', title: 'Architect', status: 'denied' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '42');
  assert.equal(items[0].title, 'Principal Rust Engineer · Acme Systems');
  assert.equal(items[0].openHref, '/cockpit/?app=intelligent-career&screen=career-hunter--career-board');
  assert.deepEqual(items[0].approve, {
    method: 'POST',
    path: '/api/career-hunter/applications/42/approve',
    body: {},
    label: 'Approve',
  });
  assert.deepEqual(items[0].decline, {
    method: 'POST',
    path: '/api/career-hunter/applications/42/deny',
    body: {},
    label: 'Decline',
  });
});
