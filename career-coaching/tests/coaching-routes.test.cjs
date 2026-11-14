/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career Coaching 0.1.0 route suite: the compiled router on the gate toolchain's real Express, a response with only the bridge's methods, the in-memory store that hands back any row (so each refusal is the package's own check) and a stand-in for the kernel's identity, owner-scoped tickets and human gate. Covers the share (code, preview, the seeker's confirmed approval, activation, the coach's read of exactly summary-v1), every refusal the study lists (wrong coach, another organization, expired at the exact deadline with the snapshot still stored, revoked, stale or changed previews, replayed approval, administrator, extra fields, forged identity, a new account with an old subject), ownership (the coach's requests touch only coaching rows and get only the projection), cancellation, the one-use confirmation, a lost answer retried with the same intent id, and the production participant-status reader refusing every coach read before any row is read. Locally tested only: the relationship policy and a kernel's admission are proved elsewhere.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the suites run the package's own participant-status reader over the kernel stand-in's `person.status` read (the cast is enrolled there), no longer a reader that says yes to everything. New cases: the coach opens an active seeker's snapshot and the kernel is asked exactly principal_id, issuer and subject; a suspended, a deactivated, an unknown and a moved seeker share nothing while the coach's other clients still show; a kernel without the read, a package that did not declare it, a failing read and an answer that is not exactly active or inactive refuse every coach read with 503 before any coaching row is read, and the seeker is told coach viewing is unavailable.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {cast, memoryRepo, standInKernel, mount, send, snapshot} = require('./support/stand-ins.cjs');
const projection = require('../lib/projection');

process.env.CAREER_COACHING_QUIET_LOG = '1';
const START = Date.parse('2026-11-13T12:00:00.000Z');
/** A reader that confirms everybody, for the cases whose refusal must be the package's own check and not the kernel's answer. */
const VERIFIED = Object.freeze({available: true, check: async () => ({ok: true})});

/** @description A fresh world: kernel stand-in with the cast enrolled, store, clock and router. The package's own
 * participant-status reader asks that kernel unless `status` names another reader. */
function world(options = {}) {
  const kernel = standInKernel(), repo = memoryRepo(), people = cast();
  kernel.enrol(...Object.values(people));
  const clock = {now: START};
  const router = mount(kernel, {repo, now: () => clock.now, ...(options.status ? {participantStatus: options.status} : {})});
  const call = (who, method, url, body, headers) => send(router, kernel, who, method, url, body, headers);
  return {kernel, repo, people, clock, router, call};
}

/** @description The coach publishes their code. @returns {Promise<string>} The code. */
async function publish(w, coach) {
  const answer = await w.call(coach, 'POST', '/card', {action: 'publish'});
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body.code;
}

/** @description The seeker's preview request body. */
function previewBody(w, code, {intentId = crypto.randomUUID(), days, applications = false, steps = null, extra} = {}) {
  const body = {intentId, coachCode: code, alias: 'Sam R.', include: {applications, nextSteps: Boolean(steps)},
    snapshot: snapshot(w.clock.now, {applications})};
  if (days !== undefined) body.days = days;
  if (steps) body.nextSteps = steps;
  return {...body, ...(extra || {})};
}

/** @description The seeker's own approval through the kernel's human gate, then activation. */
async function approve(w, seeker, previewId, outcome = 'approve') {
  const prepared = await w.call(seeker, 'POST', `/previews/${previewId}/prepare`, {});
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  w.kernel.as(seeker);
  const token = w.kernel.confirmation(prepared.body.ticketId);
  w.kernel.decide(prepared.body.ticketId, outcome, token);
  return w.call(seeker, 'POST', `/previews/${previewId}/activate`, {});
}

/** @description Code, preview and approved activation in one go. @returns {Promise<object>} Activation answer + preview. */
async function share(w, {seeker = w.people.sam, coach = w.people.jordan, ...options} = {}) {
  const code = await publish(w, coach);
  const preview = await w.call(seeker, 'POST', '/previews', previewBody(w, code, options));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const activated = await approve(w, seeker, preview.body.preview.previewId);
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  return {code, preview: preview.body.preview, share: activated.body.share};
}

test('success: a seeker shares counts with one coach, who reads exactly the summary-v1 projection as themself', async () => {
  const w = world();
  const {preview, share: made} = await share(w, {applications: true, steps: [{text: 'Follow up with Example Robotics', due: '2026-11-15', timeZone: 'America/Chicago'}]});
  assert.equal(preview.coach.name, 'Jordan Lee');
  assert.equal(preview.coach.email, 'jordan-coach@example.test');
  assert.deepEqual(preview.fieldGroups, ['applications', 'counts', 'next-steps']);
  assert.equal(made.state, 'shared');
  assert.equal(made.expiresAt, new Date(START + 7 * 86400000).toISOString(), 'default access is 7 days');
  const read = await w.call(w.people.jordan, 'GET', '/shared-with-me');
  assert.equal(read.status, 200);
  assert.equal(read.body.clients.length, 1);
  const client = read.body.clients[0];
  assert.deepEqual(Object.keys(client).sort(), ['linkId', ...projection.SUMMARY_FIELDS].sort());
  assert.equal(client.label, 'Seeker-shared snapshot');
  assert.equal(client.alias, 'Sam R.');
  assert.equal(client.pipeline.offer, null, 'unknown stays unknown, not zero');
  assert.equal(client.pipeline.saved, 12);
  const text = JSON.stringify(read.body);
  for (const secret of [w.people.sam.id, w.people.sam.subject, w.people.sam.issuer, w.people.sam.email]) {
    assert.ok(!text.includes(secret), 'the coach never gets the seeker account identity');
  }
});

test('counts only by default: applications and next steps reach the coach only when the seeker opted in', async () => {
  const w = world();
  await share(w);
  const client = (await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients[0];
  assert.equal(client.applications, undefined);
  assert.equal(client.nextSteps, undefined);
  const refused = await w.call(w.people.sam, 'POST', '/previews', {...previewBody(w, await publish(w, w.people.riley)),
    snapshot: snapshot(w.clock.now, {applications: true})});
  assert.equal(refused.status, 400, 'an application list without the opt-in is refused');
});

test('refusal: another coach, an administrator, a bot and a caller the kernel did not verify read nothing', async () => {
  const w = world();
  await share(w);
  await publish(w, w.people.riley);
  const riley = await w.call(w.people.riley, 'GET', '/shared-with-me');
  assert.deepEqual(riley.body.clients, [], 'wrong coach');
  const avery = await w.call(w.people.avery, 'GET', '/shared-with-me');
  assert.deepEqual(avery.body.clients, [], 'an administrator without a consent sees nothing');
  assert.equal((await w.call(w.people.bot, 'GET', '/shared-with-me')).status, 401, 'a bot never takes part');
  assert.equal((await w.call(null, 'GET', '/shared-with-me')).status, 401, 'no verified principal');
  const link = w.repo.tables().cc_links[0].link_id;
  assert.equal((await w.call(w.people.riley, 'POST', `/shared-with-me/${link}/stop`, {})).status, 404);
  assert.equal((await w.call(w.people.riley, 'POST', `/shares/${link}/revoke`, {})).status, 404, 'a coach cannot revoke or touch the consent');
});

test('refusal: a coach in another organization can neither receive a share nor read one', async () => {
  // The kernel would also answer inactive for a seeker of another organization; this case holds the package's own check.
  const w = world({status: VERIFIED});
  const casey = w.people.casey;
  const code = await publish(w, casey);
  const preview = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code));
  assert.equal(preview.status, 404);
  assert.equal(preview.body.error, 'coach_not_found');
  // Even a consent row that names this coach (a broken or missing policy) is refused on the tenant.
  await share(w);
  w.repo.patch('cc_links', 'coach_person_id', w.people.jordan.id, {coach_person_id: casey.id, coach_subject: casey.subject});
  w.repo.patch('cc_snapshots', 'coach_person_id', w.people.jordan.id, {coach_person_id: casey.id});
  assert.deepEqual((await w.call(casey, 'GET', '/shared-with-me')).body.clients, []);
});

test('refusal: access ends at the deadline itself, whether or not cleanup removed the snapshot', async () => {
  const w = world();
  const {share: made} = await share(w, {days: 1});
  w.clock.now = Date.parse(made.expiresAt) - 1;
  assert.equal((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients.length, 1);
  w.clock.now = Date.parse(made.expiresAt);
  assert.equal(w.repo.tables().cc_snapshots.length, 1, 'cleanup has not run');
  assert.deepEqual((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients, [], 'equality refuses');
  const list = await w.call(w.people.sam, 'GET', '/shares');
  assert.equal(list.body.shares[0].state, 'expired');
  await w.call(w.people.sam, 'POST', '/previews', previewBody(w, await publish(w, w.people.riley)));
  assert.equal(w.repo.tables().cc_snapshots.length, 0, 'the seeker\'s next write removes the expired payload');
});

test('expiry: 7 days by default, at most 30, never indefinite', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  for (const days of [0, 2, 31, 45, null, 'forever', 365]) {
    const answer = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code, {days}));
    assert.equal(answer.status, 400, `days=${days}`);
  }
  const longest = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code, {days: 30}));
  assert.equal(longest.status, 200);
  assert.equal(longest.body.preview.days, 30);
});

test('revoke: one action by the seeker ends access and deletes the payload in the same change', async () => {
  const w = world();
  const {share: made} = await share(w);
  const before = w.kernel.ticketService.created;
  const answer = await w.call(w.people.sam, 'POST', `/shares/${made.linkId}/revoke`, {});
  assert.equal(answer.status, 200);
  assert.equal(answer.body.share.state, 'ended');
  assert.equal(w.kernel.ticketService.created, before, 'no approval workflow for stopping');
  assert.equal(w.repo.tables().cc_snapshots.length, 0);
  assert.equal(w.repo.tables().cc_links[0].revision, made.revision + 1);
  assert.deepEqual((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients, []);
});

test('refusal: a preview older than 10 minutes, or one whose consent revision moved on, cannot be shared', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  const stale = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code));
  w.clock.now += 10 * 60 * 1000;
  const prepared = await w.call(w.people.sam, 'POST', `/previews/${stale.body.preview.previewId}/prepare`, {});
  assert.equal(prepared.status, 410);
  // Two previews for the same coach both expect revision 0; the first activation moves it to 1.
  const a = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code));
  const b = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code, {applications: true}));
  assert.equal((await approve(w, w.people.sam, a.body.preview.previewId)).status, 200);
  const late = await approve(w, w.people.sam, b.body.preview.previewId);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'stale_preview');
  const client = (await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients[0];
  assert.equal(client.applications, undefined, 'the wider scope was never granted');
});

test('refusal: an approval binds one preview; a changed recipient or scope needs its own decision', async () => {
  const w = world();
  const jordan = await publish(w, w.people.jordan), riley = await publish(w, w.people.riley);
  const toJordan = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, jordan))).body.preview;
  const toRiley = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, riley))).body.preview;
  const prepared = await w.call(w.people.sam, 'POST', `/previews/${toJordan.previewId}/prepare`, {});
  w.kernel.as(w.people.sam);
  w.kernel.decide(prepared.body.ticketId, 'approve', w.kernel.confirmation(prepared.body.ticketId));
  // Point Riley's preview at Jordan's approved ticket: the marker binds recipient, scope and digest, so it is refused.
  w.repo.patch('cc_previews', 'preview_id', toRiley.previewId, {ticket_id: prepared.body.ticketId});
  const forged = await w.call(w.people.sam, 'POST', `/previews/${toRiley.previewId}/activate`, {});
  assert.equal(forged.status, 409);
  assert.equal(forged.body.error, 'approval_unverified');
  assert.equal(w.repo.tables().cc_links.length, 0);
  // A retried preview under the same intent id with a different scope is refused, not silently replaced.
  const again = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, jordan, {intentId: toJordan.previewId, applications: true}));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'intent_conflict');
});

test('refusal: a used approval cannot be replayed after revocation', async () => {
  const w = world();
  const {preview, share: made} = await share(w);
  await w.call(w.people.sam, 'POST', `/shares/${made.linkId}/revoke`, {});
  const replay = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {});
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, 'approval_replayed');
  assert.deepEqual((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients, []);
});

test('confirmation: only the kernel\'s owner-verified decision shares; a body, a waiting or an unverified ticket never does', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  const preview = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code))).body.preview;
  const claimed = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {approved: true});
  assert.equal(claimed.status, 400, 'approved:true in a body is an extra field');
  assert.equal((await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {})).body.error, 'approval_waiting');
  const prepared = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/prepare`, {});
  assert.equal(prepared.body.status, 'awaiting_approval');
  assert.equal((await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {})).body.error, 'approval_waiting');
  w.kernel.as(w.people.sam);
  assert.throws(() => w.kernel.decide(prepared.body.ticketId, 'approve', 'not-a-token'), /confirmation/);
  const token = w.kernel.confirmation(prepared.body.ticketId);
  w.kernel.decide(prepared.body.ticketId, 'approve', token);
  assert.throws(() => w.kernel.decide(prepared.body.ticketId, 'approve', token), /confirmation/, 'one use');
  w.kernel.tickets.get(prepared.body.ticketId).revision += 1; // the receipt no longer matches the ticket's revision
  assert.equal((await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {})).body.error, 'approval_unverified');
  w.kernel.tickets.get(prepared.body.ticketId).revision -= 1;
  assert.equal((await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {})).status, 200);
});

test('confirmation: a receipt not verified for the seeker through this application grants nothing', async () => {
  for (const override of [{ownerVerified: false}, {app: 'career-hunter'}, {outcome: 'cancel'}, {workflow: 'career-hunter:career-source-decision'}]) {
    const w = world();
    const code = await publish(w, w.people.jordan);
    const preview = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code))).body.preview;
    const prepared = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/prepare`, {});
    w.kernel.as(w.people.sam);
    w.kernel.decide(prepared.body.ticketId, 'approve', w.kernel.confirmation(prepared.body.ticketId));
    w.kernel.tickets.get(prepared.body.ticketId).receiptOverride = override;
    const answer = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/activate`, {});
    assert.equal(answer.status, 409, JSON.stringify(override));
    assert.equal(answer.body.error, 'approval_unverified');
    assert.equal(w.repo.tables().cc_links.length, 0);
  }
});

test('confirmation: the coach or anyone else cannot open, see or decide the seeker\'s approval', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  const preview = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code))).body.preview;
  assert.equal((await w.call(w.people.jordan, 'POST', `/previews/${preview.previewId}/prepare`, {})).status, 404);
  assert.equal((await w.call(w.people.jordan, 'POST', `/previews/${preview.previewId}/activate`, {})).status, 404);
  const prepared = await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/prepare`, {});
  w.kernel.as(w.people.jordan);
  assert.throws(() => w.kernel.confirmation(prepared.body.ticketId), /no such owned ticket/);
});

test('cancellation: Cancel at the human gate shares nothing, and that preview can never share later', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  const preview = (await w.call(w.people.sam, 'POST', '/previews', previewBody(w, code))).body.preview;
  const cancelled = await approve(w, w.people.sam, preview.previewId, 'cancel');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancelled, true);
  assert.equal(w.repo.tables().cc_links.length, 0);
  assert.equal(w.repo.tables().cc_snapshots.length, 0);
  assert.equal((await w.call(w.people.sam, 'POST', `/previews/${preview.previewId}/prepare`, {})).status, 409);
});

test('response loss: the same intent id returns the same preview, ticket and share; nothing is granted twice', async () => {
  const w = world();
  const code = await publish(w, w.people.jordan);
  const body = previewBody(w, code);
  const first = await w.call(w.people.sam, 'POST', '/previews', body);
  const second = await w.call(w.people.sam, 'POST', '/previews', body);
  assert.equal(second.body.preview.previewId, first.body.preview.previewId);
  assert.equal(w.repo.tables().cc_previews.length, 1);
  const id = first.body.preview.previewId;
  // A create whose answer was lost: the ticket exists but the preview never learned its id.
  const p1 = await w.call(w.people.sam, 'POST', `/previews/${id}/prepare`, {});
  w.repo.patch('cc_previews', 'preview_id', id, {ticket_id: null});
  const p2 = await w.call(w.people.sam, 'POST', `/previews/${id}/prepare`, {});
  assert.equal(p2.body.ticketId, p1.body.ticketId);
  assert.equal(w.kernel.ticketService.created, 1, 'no second ticket');
  w.kernel.as(w.people.sam);
  w.kernel.decide(p1.body.ticketId, 'approve', w.kernel.confirmation(p1.body.ticketId));
  const a1 = await w.call(w.people.sam, 'POST', `/previews/${id}/activate`, {});
  const a2 = await w.call(w.people.sam, 'POST', `/previews/${id}/activate`, {});
  assert.deepEqual(a2.body.share, a1.body.share);
  assert.equal(w.repo.tables().cc_links[0].revision, 1);
});

test('identity: headers, query, body fields, names and emails never choose a person', async () => {
  const w = world();
  const {share: made} = await share(w);
  const forged = await w.call(w.people.riley, 'GET', '/shared-with-me', undefined,
    {'x-oshal-user-sub': w.people.jordan.subject, 'x-oshal-tenant-id': w.people.jordan.tenant});
  assert.deepEqual(forged.body.clients, []);
  const extra = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, await publish(w, w.people.riley),
    {extra: {seekerSub: w.people.avery.subject}}));
  assert.equal(extra.status, 400);
  assert.equal(extra.body.error, 'extra_fields');
  // A principal and actor that disagree are refused.
  const imposter = {...w.people.riley, id: w.people.jordan.id};
  const answer = await send(w.router, w.kernel, imposter, 'GET', '/shared-with-me', undefined, {}, w.people.riley);
  assert.equal(answer.status, 401);
  assert.ok(made.linkId);
});

test('identity: a newly enrolled account with an old issuer and subject inherits no link', async () => {
  const w = world();
  await share(w);
  const reborn = {...w.people.jordan, id: crypto.randomUUID()};
  const seeker = {...w.people.sam, id: crypto.randomUUID()};
  w.kernel.enrol(reborn, seeker);
  const read = await w.call(reborn, 'GET', '/shared-with-me');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.clients, [], 'new coach account');
  assert.equal((await w.call(reborn, 'GET', '/card')).body.published, false);
  assert.deepEqual((await w.call(seeker, 'GET', '/shares')).body.shares, [], 'new seeker account');
  const fresh = await w.call(reborn, 'POST', '/card', {action: 'publish'});
  assert.equal(fresh.status, 200);
  assert.equal(w.repo.tables().cc_people.filter((p) => p.subject === 'jordan-coach').length, 1, 'the old row was replaced');
  assert.deepEqual((await w.call(reborn, 'GET', '/shared-with-me')).body.clients, [], 'still no inherited link');
});

test('ownership: a coach\'s requests touch only coaching rows and return only the projection', async () => {
  const w = world();
  await share(w, {applications: true});
  w.repo.calls.length = 0;
  const read = await w.call(w.people.jordan, 'GET', '/shared-with-me');
  const names = new Set(w.repo.calls.map((c) => c.name));
  assert.deepEqual([...names].sort(), ['drop', 'linksForCoach', 'person', 'snapshot']);
  assert.ok(w.repo.calls.every((c) => !['insertPerson', 'insertLink', 'updateLink', 'setPreview'].includes(c.name)), 'a GET writes nothing');
  for (const forbidden of ['payload_digest', 'seeker_person_id', 'approval_receipt', 'url', 'notes', 'resume']) {
    assert.ok(!JSON.stringify(read.body).includes(forbidden), forbidden);
  }
});

test('stop viewing: the coach writes only their own record; the seeker sees it and the consent row is untouched', async () => {
  const w = world();
  const {share: made} = await share(w);
  const before = w.repo.tables().cc_links[0];
  assert.equal((await w.call(w.people.jordan, 'POST', `/shared-with-me/${made.linkId}/stop`, {})).status, 200);
  assert.deepEqual(w.repo.tables().cc_links[0], before);
  assert.deepEqual((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients, []);
  assert.equal((await w.call(w.people.sam, 'GET', '/shares')).body.shares[0].state, 'stopped');
});

/** @description The coach's read and what the seeker is told, after the repository's call log is emptied. */
async function coachRead(w) {
  w.repo.calls.length = 0;
  const read = await w.call(w.people.jordan, 'GET', '/shared-with-me');
  const rowsRead = w.repo.calls.length;
  return {read, rowsRead, told: (await w.call(w.people.sam, 'GET', '/shares')).body.coachViewing};
}

test('participants: the coach opens an active seeker\'s snapshot, and the kernel is asked for exactly that one person', async () => {
  const w = world();
  await share(w);
  w.kernel.statusCalls.length = 0;
  const {read, told} = await coachRead(w);
  assert.equal(read.status, 200);
  assert.equal(read.body.clients.length, 1, 'an active pair');
  assert.equal(told, 'available', 'the seeker is told coaches can open shares here');
  const {sam, jordan} = w.people;
  assert.ok(w.kernel.statusCalls.every((call) => call.name === 'person.status'), 'the package sends the kernel no other intent');
  const asked = w.kernel.statusCalls.map((call) => call.input);
  assert.ok(asked.some((input) => input.principal_id === sam.id), 'the seeker of the consent row is asked about');
  for (const input of asked) {
    assert.deepEqual(Object.keys(input).sort(), ['issuer', 'principal_id', 'subject'], 'three fields, no tenant, name or email');
    const person = [sam, jordan].find((one) => one.id === input.principal_id);
    assert.deepEqual(input, {principal_id: person.id, issuer: person.issuer, subject: person.subject});
  }
});

test('participants: a suspended, deactivated, unknown or moved seeker shares nothing, and the coach\'s other clients still show', async () => {
  const w = world();
  const {sam, jordan, avery} = w.people;
  await share(w);
  await share(w, {seeker: avery});
  const aliases = async () => (await w.call(jordan, 'GET', '/shared-with-me'));
  assert.equal((await aliases()).body.clients.length, 2, 'two active clients');
  for (const state of ['suspended', 'deactivated']) {
    sam.state = state;
    const read = await aliases();
    assert.equal(read.status, 200, state);
    assert.equal(read.body.clients.length, 1, `a ${state} seeker's snapshot is closed and the other client's is not`);
    assert.ok(!JSON.stringify(read.body).includes(w.repo.tables().cc_links.find((l) => l.seeker_person_id === sam.id).link_id));
  }
  sam.state = 'active';
  assert.equal((await aliases()).body.clients.length, 2, 'reinstated');
  w.kernel.forget(sam);
  assert.equal((await aliases()).body.clients.length, 1, 'an account the kernel no longer holds');
  w.kernel.enrol(sam);
  sam.tenant = w.people.casey.tenant;
  assert.equal((await aliases()).body.clients.length, 1, 'an account now in another organization');
  assert.deepEqual(w.repo.tables().cc_snapshots.length, 2, 'a read removes nothing');
});

test('fail closed: a kernel without the status read, or a package that did not declare it, refuses every coach read before any row is read', async () => {
  for (const mode of ['absent', 'undeclared']) {
    const w = world();
    await share(w);
    w.kernel.statusRead(mode);
    const {read, rowsRead, told} = await coachRead(w);
    assert.equal(read.status, 503, mode);
    assert.equal(read.body.error, 'participant_status_unavailable');
    assert.deepEqual(read.body.clients, []);
    assert.equal(rowsRead, 0, 'no coaching row was read');
    assert.equal(told, 'unavailable', 'the seeker is told');
  }
  const unwired = world();
  await share(unwired);
  const closed = mount(unwired.kernel, {repo: unwired.repo, now: () => unwired.clock.now, participantStatus: {available: false, check: async () => ({ok: true})}});
  assert.equal((await send(closed, unwired.kernel, unwired.people.jordan, 'GET', '/shared-with-me')).status, 503, 'a reader that is not available');
  const failing = world({status: {available: true, check: async () => { throw new Error('status read failed'); }}});
  await share(failing);
  assert.equal((await failing.call(failing.people.jordan, 'GET', '/shared-with-me')).status, 503, 'a failing reader refuses');
});

test('fail closed: an answer that is not exactly active or inactive is no answer', async () => {
  const odd = [{status: 'active', email: 'sam-seeker@example.test'}, {status: 'ACTIVE'}, {status: true}, {state: 'active'}, 'active', null, [], {}];
  for (const answer of odd) {
    // The kernel answers oddly about the seeker only: the coach is known, the seeker is not.
    const w = world();
    await share(w);
    const real = w.kernel.intent;
    w.kernel.intent = async (name, input) => (input && input.principal_id === w.people.sam.id ? answer : real(name, input));
    const read = await w.call(w.people.jordan, 'GET', '/shared-with-me');
    assert.equal(read.status, 503, JSON.stringify(answer));
    assert.equal(read.body.error, 'participant_status_unavailable');
    assert.equal(read.body.clients, undefined, 'no partial list leaves the server');
    // The same answer about the caller: nothing is read at all.
    w.kernel.intent = async () => answer;
    const {read: closed, rowsRead, told} = await coachRead(w);
    assert.equal(closed.status, 503, JSON.stringify(answer));
    assert.equal(rowsRead, 0);
    assert.equal(told, 'unavailable');
  }
});

test('GET routes create no person, code, preview, consent or snapshot', async () => {
  const w = world();
  for (const [who, url] of [[w.people.sam, '/shares'], [w.people.jordan, '/card'], [w.people.jordan, '/shared-with-me'], [w.people.sam, '/']]) {
    await w.call(who, 'GET', url);
  }
  const tables = w.repo.tables();
  assert.ok(Object.values(tables).every((rows) => rows.length === 0), JSON.stringify(tables));
});

test('coach code: publish keeps one code, New code replaces it, Turn off stops new shares and keeps existing ones', async () => {
  const w = world();
  const first = await publish(w, w.people.jordan);
  assert.match(first, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(await publish(w, w.people.jordan), first);
  const renewed = (await w.call(w.people.jordan, 'POST', '/card', {action: 'new-code'})).body.code;
  assert.notEqual(renewed, first);
  assert.equal((await w.call(w.people.sam, 'POST', '/previews', previewBody(w, first))).status, 404, 'the old code no longer works');
  const preview = await w.call(w.people.sam, 'POST', '/previews', previewBody(w, renewed.toLowerCase().replace(/-/g, ' ')));
  assert.equal(preview.status, 200, 'spaces and lower case are accepted');
  assert.equal((await approve(w, w.people.sam, preview.body.preview.previewId)).status, 200);
  assert.equal(w.repo.tables().cc_coach_codes.length, 1);
  assert.ok(w.repo.tables().cc_coach_codes.every((row) => !Object.values(row).includes(renewed)), 'other people\'s rows hold only a hash');
  await w.call(w.people.jordan, 'DELETE', '/card');
  assert.equal((await w.call(w.people.sam, 'POST', '/previews', previewBody(w, renewed))).status, 404);
  assert.equal((await w.call(w.people.jordan, 'GET', '/shared-with-me')).body.clients.length, 1);
  assert.equal((await w.call(w.people.sam, 'POST', '/previews', previewBody(w, 'NOT-A-CODE'))).status, 400);
});
