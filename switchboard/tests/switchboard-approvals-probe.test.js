/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify Switchboard declares `approvals:` on `/api/switchboard/streams/posts` and `formatStreamApprovals` projects only `in_review` stream posts onto the existing `/transition` approve/reject descriptors.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify Switchboard's `approvals:` manifest block declares the exact `approve` and `decline` `/transition` action templates matched by `ApprovalsView.js`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatStreamApprovals, applyTransition } = require('../routes/switchboard-streams-model');

const pkgDir = path.resolve(__dirname, '..');

test('oshal-app.yaml declares approvals probe and pinned transition action templates', () => {
  const yaml = fs.readFileSync(path.join(pkgDir, 'oshal-app.yaml'), 'utf8');
  assert.match(yaml, /^approvals:\s*\n\s+path:\s*\/api\/switchboard\/streams\/posts\s*\n\s+itemsPointer:\s*\/approvals\b/m);
  assert.match(yaml, /approve:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/switchboard\/streams\/posts\/\{id\}\/transition\b/);
  assert.match(yaml, /decline:\s*\n\s+method:\s*POST\s*\n\s+path:\s*\/api\/switchboard\/streams\/posts\/\{id\}\/transition\b/);
});

test('formatStreamApprovals projects only in_review posts onto transition approve and reject', () => {
  const items = formatStreamApprovals([
    { postId: 'post-review-1', state: 'in_review', title: 'Q4 Launch Thread', body: 'Shipping native parity today.', updatedAt: '2026-11-17T03:00:00Z', variants: [{ platform: 'x' }, { platform: 'linkedin' }] },
    { postId: 'post-draft-1', state: 'draft', title: 'Draft idea', body: 'Still writing.' },
    { postId: 'post-approved-1', state: 'approved', title: 'Already approved', body: 'Ready.' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'post-review-1');
  assert.equal(items[0].title, 'Q4 Launch Thread');
  assert.match(items[0].summary, /^x, linkedin · Shipping native parity today\./);
  assert.equal(items[0].openHref, '/cockpit/?app=switchboard&screen=switchboard-streams');
  assert.deepEqual(items[0].approve, {
    method: 'POST',
    path: '/api/switchboard/streams/posts/post-review-1/transition',
    body: { action: 'approve' },
    label: 'Approve',
  });
  assert.deepEqual(items[0].decline, {
    method: 'POST',
    path: '/api/switchboard/streams/posts/post-review-1/transition',
    body: { action: 'reject' },
    label: 'Decline',
  });
  assert.deepEqual(applyTransition('in_review', items[0].approve.body.action), { next: 'approved' });
  assert.deepEqual(applyTransition('in_review', items[0].decline.body.action), { next: 'rejected' });
});
