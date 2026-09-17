/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the LinkedIn publish rail at the boundary it claims: the compiled package module driving the REAL kernel connector-action executor against the REAL linkedin.yaml. Proves the caller-scoped audit row commits BEFORE the provider call, that an unavailable audit trail refuses the publication outright, and that the no-connection and approval-denial paths refuse without ever reaching the provider.
 *
 * Framework-coupled (fixture:core-checkout). Only the Postgres pool and the provider socket are
 * doubled; the executor, its audit discipline, the credential resolver and the connector definition
 * are the shipped ones.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { attempt, CALLER } = require('./publish-core.fixture');

const APPROVED = 'Synthetic approved post text.';
const CONFIRMED = { text: APPROVED, target: 'linkedin', confirm: true };

/** @description The journal index of the first pre-write audit row, or -1 when none was written. */
function attemptRowIndex(run) {
  const row = run.audits().find((entry) => entry.status === 'attempt');
  return row ? row.index : -1;
}

test('the publish rail runs the DECLARED create-post action against the real connector definition', async () => {
  const run = attempt();
  const result = await run.publish(APPROVED, CONFIRMED);
  assert.equal(result.ok, true, 'an approved post publishes');
  assert.equal(result.target, 'linkedin');
  assert.equal(result.postId, 'urn:li:share:7000000000000000001');

  const calls = run.httpCalls();
  assert.equal(calls.length, 1, 'exactly one provider call');
  assert.equal(calls[0].url, 'https://api.linkedin.com/v2/ugcPosts', 'the URL comes from the declared action, not a local literal');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, `Bearer ${CALLER.token}`, "the caller's own brokered token authorises the write");
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.author, `urn:li:person:${CALLER.accountId}`);
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text, APPROVED, 'the approved text is sent verbatim');
  assert.deepEqual(run.brokerCalls, [{ sub: CALLER.sub, provider: 'linkedin' }], 'exactly one brokered credential read, for this caller');
});

test('the audit row COMMITS BEFORE the provider call, and a terminal row follows it', async () => {
  const run = attempt();
  await run.publish(APPROVED, CONFIRMED);

  const attemptIndex = attemptRowIndex(run);
  const httpIndex = run.httpCalls()[0].index;
  assert.notEqual(attemptIndex, -1, "a pre-write 'attempt' row is recorded");
  assert.ok(attemptIndex < httpIndex, `the attempt row (${attemptIndex}) precedes the provider call (${httpIndex})`);

  const statuses = run.audits().map((entry) => entry.status);
  assert.deepEqual(statuses, ['attempt', 'success'], 'one pre-write row and one terminal row');
  for (const row of run.audits()) {
    assert.equal(row.userSub, CALLER.sub, 'every audit row is scoped to the caller');
    assert.equal(row.connectorId, 'linkedin');
    assert.equal(row.action, 'create-post');
    assert.equal(row.riskLevel, 'high', 'the declared risk level is recorded');
    assert.match(String(row.paramsHash), /^[0-9a-f]{64}$/, 'params are recorded as a hash, never raw');
  }
  assert.equal(JSON.stringify(run.audits()).includes(APPROVED), false, 'the post text never lands in the audit trail');
});

test('an unavailable audit trail REFUSES the publication instead of posting unrecorded', async () => {
  const run = attempt({ failAudit: true });
  const result = await run.publish(APPROVED, CONFIRMED);

  assert.equal(result.ok, false);
  assert.equal(result.code, 503);
  assert.equal(result.error, 'audit_unavailable');
  assert.equal(run.httpCalls().length, 0, 'nothing was published');
});

test('a caller with no LinkedIn connection is refused cleanly, before any provider traffic', async () => {
  const run = attempt({ connection: null });
  const result = await run.publish(APPROVED, CONFIRMED);

  assert.equal(result.ok, false);
  assert.equal(result.code, 409);
  assert.equal(result.error, 'no_linkedin_connection');
  assert.equal(run.httpCalls().length, 0, 'nothing was published');
  assert.deepEqual(run.brokerCalls, [], 'no credential read for a caller who has no connection');
});

test('a connection whose brokered credential is gone is refused as not_connected and audited', async () => {
  const run = attempt({ token: null });
  const result = await run.publish(APPROVED, CONFIRMED);

  assert.equal(result.ok, false);
  assert.equal(result.code, 409);
  assert.equal(result.error, 'no_linkedin_connection');
  assert.equal(run.httpCalls().length, 0, 'nothing was published');
  assert.deepEqual(run.audits().map((entry) => entry.status), ['not_connected'], 'the refusal is audited');
  assert.equal(attemptRowIndex(run), -1, 'no pre-write row is written for a refusal');
});

test('an unconfirmed publish is denied at the write boundary, with no credential read and no post', async () => {
  const run = attempt();
  const result = await run.publish(APPROVED, { text: APPROVED, target: 'linkedin' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 428);
  assert.equal(result.error, 'confirmation_required');
  assert.equal(run.httpCalls().length, 0, 'nothing was published');
  assert.deepEqual(run.brokerCalls, [], 'an unconfirmed write never reaches the token broker');
  assert.deepEqual(run.audits().map((entry) => entry.status), ['confirmation_required'], 'the denial is audited');
});

test('a denied approval signal that is not strictly true is still a denial', async () => {
  for (const confirm of ['true', 1, 'yes', {}, null]) {
    const run = attempt();
    const result = await run.publish(APPROVED, { text: APPROVED, confirm });
    assert.equal(result.code, 428, `confirm=${JSON.stringify(confirm)} is not an approval`);
    assert.equal(run.httpCalls().length, 0, `confirm=${JSON.stringify(confirm)} published nothing`);
  }
});

test('a provider rejection is reported as a failure and audited as an error', async () => {
  const run = attempt({ providerStatus: 422, providerBody: { message: 'synthetic provider rejection' } });
  const result = await run.publish(APPROVED, CONFIRMED);

  assert.equal(result.ok, false);
  assert.equal(result.code, 422);
  assert.equal(run.httpCalls().length, 1, 'the provider was called once');
  assert.deepEqual(run.audits().map((entry) => entry.status), ['attempt', 'error'], 'the attempt row stands and the outcome is recorded');
});
