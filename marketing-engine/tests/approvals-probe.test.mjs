/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify marketing-engine declares `approvals:` on `/api/marketing/budget/proposals` and projects only pending (`status = 'proposed'`) budget rows with confirmed approve/reject descriptors.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify marketing-engine's `approvals:` manifest block declares the exact `approve` and `decline` `/decide` action templates matched by `ApprovalsView.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('manifest declares approvals probe and pinned decide action templates', () => {
  const yaml = readFileSync(join(pkgDir, 'oshal-app.yaml'), 'utf8');
  assert.match(yaml, /^approvals:\s*\n\s+path:\s*\/api\/marketing\/budget\/proposals\s*\n\s+itemsPointer:\s*\/approvals\b/m);
  assert.match(yaml, /approve:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/marketing\/budget\/proposals\/\{id\}\/decide\b/);
  assert.match(yaml, /decline:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/marketing\/budget\/proposals\/\{id\}\/decide\b/);
});

test('formatBudgetApprovals projects only proposed rows with existing decide endpoints', () => {
  const src = readFileSync(join(pkgDir, 'routes/marketing-routes.js'), 'utf8');
  assert.match(src, /exports\.formatBudgetApprovals = formatBudgetApprovals/);
  const fnMatch = /function formatBudgetApprovals\(proposals\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fnMatch, 'compiled formatBudgetApprovals helper exists');
  const formatBudgetApprovals = new Function(`return (${fnMatch[0]});`)();

  const items = formatBudgetApprovals([
    { entry_id: '11111111-1111-4111-8111-111111111111', status: 'proposed', field: 'budget_monthly_usd', old_value: '500', new_value: '1200', channel: 'linkedin', proposed_by: 'growth-analyst', created_at: '2026-11-17T03:00:00Z' },
    { entry_id: '22222222-2222-4222-8222-222222222222', status: 'applied', field: 'budget_monthly_usd', old_value: '500', new_value: '800' },
    { entry_id: '33333333-3333-4333-8333-333333333333', status: 'rejected', field: 'channels', new_value: '["x"]' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '11111111-1111-4111-8111-111111111111');
  assert.equal(items[0].title, 'Monthly budget: 1200 (from 500)');
  assert.deepEqual(items[0].approve, {
    method: 'POST',
    path: '/api/marketing/budget/proposals/11111111-1111-4111-8111-111111111111/decide',
    body: { decision: 'approve', confirm: true },
    label: 'Approve',
  });
  assert.deepEqual(items[0].decline, {
    method: 'POST',
    path: '/api/marketing/budget/proposals/11111111-1111-4111-8111-111111111111/decide',
    body: { decision: 'reject' },
    label: 'Decline',
  });
  void require;
});
