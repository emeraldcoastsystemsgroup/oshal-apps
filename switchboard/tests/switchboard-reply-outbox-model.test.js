/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard the compiled reply-outbox model's fail-closed validation, source-owned recipient parsing, semantic idempotency hash, content-free status view, and no-blind-retry terminal states.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Use the declared synthetic placeholder for the idempotency fixture. The previous opaque value scored 4.37 entropy and the public-store gitleaks gate refused the cut; .gitleaks.toml states that synthetic values must be one of its exact self-identifying placeholders, so the fix is the fixture rather than a new allowlist entry. The key is opaque to every assertion here.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const model = require(path.join(PKG, 'routes', 'switchboard-reply-outbox-model.js'));
const {
  MAX_REPLY_BODY, REPLY_PROVIDER, emailAddressOf, mapReplyStatus, replyRequestHash,
  replySubject, terminalFailure, validateReplyRequest,
} = model;

const KEY = 'replace-with-idempotency-key';
const BODY = { sourceMessageId: 'gmail_A1-b2', body: '  Exact body.\nKeep spacing.  ' };

test('valid input preserves the exact reviewed body and normalizes only identifiers', () => {
  const result = validateReplyRequest({ ...BODY, workspaceId: '' }, `  ${KEY}  `);
  assert.equal(result.error, undefined);
  assert.equal(result.value.idempotencyKey, KEY);
  assert.equal(result.value.sourceMessageId, 'gmail_A1-b2');
  assert.equal(result.value.body, BODY.body);
  assert.equal(result.value.workspaceId, null);
  const scoped = validateReplyRequest({ ...BODY, workspaceId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' }, KEY);
  assert.equal(scoped.value.workspaceId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
});

test('idempotency key is mandatory, bounded, and rejects whitespace/header mutation shapes', () => {
  for (const key of [undefined, '', 'short', 'a'.repeat(129), 'valid-but has-space', 'header\r\nvalue']) {
    assert.match(validateReplyRequest(BODY, key).error, /Idempotency-Key/);
  }
});

test('message id, exact body, length, and workspace UUID all fail closed', () => {
  assert.match(validateReplyRequest({ body: 'x' }, KEY).error, /sourceMessageId/);
  assert.match(validateReplyRequest({ sourceMessageId: 'bad/id', body: 'x' }, KEY).error, /sourceMessageId/);
  assert.match(validateReplyRequest({ sourceMessageId: 'm1', body: '  ' }, KEY).error, /body/);
  assert.match(validateReplyRequest({ sourceMessageId: 'm1', body: 'x'.repeat(MAX_REPLY_BODY + 1) }, KEY).error, /exceeds/);
  assert.match(validateReplyRequest({ sourceMessageId: 'm1', body: 'x', workspaceId: 'not-a-uuid' }, KEY).error, /workspaceId/);
});

test('recipient comes only from one safe source From header', () => {
  assert.equal(emailAddressOf('"Sam Rivera" <SAM@Example.com>'), 'sam@example.com');
  assert.equal(emailAddressOf('sam@example.com'), 'sam@example.com');
  assert.equal(emailAddressOf('Sam Rivera'), null);
  assert.equal(emailAddressOf('a@example.com, b@example.com'), null);
  assert.equal(emailAddressOf('Sam <sam@example.com>\r\nBcc: victim@example.com'), null);
});

test('reply subject adds one Re prefix and flattens provider header controls', () => {
  assert.equal(replySubject('Status'), 'Re: Status');
  assert.equal(replySubject('RE: Status'), 'RE: Status');
  assert.equal(replySubject('Status\r\nBcc: other@example.com'), 'Re: Status Bcc: other@example.com');
});

test('semantic request hash is deterministic and every send-affecting field mutates it', () => {
  const base = {
    idempotencyKey: KEY, sourceMessageId: 'm1', body: 'Approved', workspaceId: null,
    provider: REPLY_PROVIDER, recipient: 'sam@example.com', subject: 'Re: Status',
  };
  const digest = replyRequestHash(base);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(replyRequestHash({ ...base }), digest);
  for (const mutation of [
    { sourceMessageId: 'm2' }, { body: 'Changed' }, { workspaceId: '11111111-2222-4333-8444-555555555555' },
    { provider: 'outlook' }, { recipient: 'other@example.com' }, { subject: 'Re: Changed' },
  ]) assert.notEqual(replyRequestHash({ ...base, ...mutation }), digest);
});

test('status wire shape never exposes encrypted message content', () => {
  const view = mapReplyStatus({
    reply_id: '11111111-2222-4333-8444-555555555555', status: 'pending', provider: 'google',
    attempt_count: 0, provider_message_id: null, delivery_error: null,
    recipient_ciphertext: 'secret-recipient', subject_ciphertext: 'secret-subject',
    body_ciphertext: 'secret-body', source_message_id_ciphertext: 'secret-source',
    created_at: 'c', updated_at: 'u', sent_at: null,
  });
  assert.equal(view.status, 'pending');
  assert.deepEqual(Object.keys(view).sort(), [
    'attemptCount', 'createdAt', 'deliveryError', 'provider', 'providerMessageId',
    'replyId', 'sentAt', 'status', 'updatedAt',
  ]);
  assert.throws(() => mapReplyStatus({ status: 'retrying' }), /Invalid reply outbox status/);
});

test('provider-attempt failure is uncertain, never automatically retryable', () => {
  assert.deepEqual(terminalFailure(false), { status: 'failed', error: 'delivery_not_attempted' });
  assert.deepEqual(terminalFailure(true), { status: 'uncertain', error: 'provider_result_unknown_manual_review_required' });
});

test('migration binds uniqueness, encrypted fields, owner FORCE RLS, and claim-state checks', () => {
  const sql = fs.readFileSync(path.join(PKG, 'migrations', '001-switchboard-reply-outbox.sql'), 'utf8');
  assert.match(sql, /UNIQUE\s*\(user_sub, idempotency_key\)/i);
  assert.match(sql, /recipient_ciphertext[\s\S]*subject_ciphertext[\s\S]*body_ciphertext/i);
  assert.doesNotMatch(sql, /\brecipient\s+TEXT|\bbody\s+TEXT/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /current_setting\('oshal\.current_sub'/i);
  assert.match(sql, /ck_sb_reply_claim_shape/i);
});
