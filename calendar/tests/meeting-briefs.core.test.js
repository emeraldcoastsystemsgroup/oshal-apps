/**
 * Calendar Preparation — the meeting-brief agent, across the boundaries the fix claims.
 *
 * The properties this suite exists to hold, each proved against real core code rather than a
 * double of it:
 *   1. CONSENT IS DEFAULT-OFF, AND IT IS SETTLED BEFORE ANYTHING IS READ. The manifest registers
 *      the source with `enabled: false`; the real `JarvisBriefingService` is what reads that
 *      default. An owner who never opted in gets no notification, no stored row, and NO READ of
 *      their recorded material — not even with ambient capture on and a history present. The
 *      collection pass touches the package's own snapshot table and stops.
 *   2. A STORED BRIEF IS A DELIVERED BRIEF, byte for byte. The text in `jarvis_tasks.result` and
 *      the text the surface returns are the same string, so the two cannot drift.
 *   3. RECORDED MATERIAL IS READ ONLY WHERE AUTHORISED, AND ONLY FOR CONSENTING VOICES. With
 *      ambient capture off, the transcript and review tables are never queried. With it on, a
 *      segment is admitted only if core's own ADR-100 gate admits its speaker profile: the owner's
 *      own voice, or a profile whose LATEST transcript consent is granted and is not a minor.
 *   4. RECORDED WORDS ARE CITED, NEVER COPIED. The collector does not select `transcript_text` or
 *      the review `summary` at all, and neither the delivered notification nor the stored brief
 *      contains them — which is what keeps the owner's ambient deletion, retention and consent
 *      controls the only place those words live.
 *   5. EVERY CLAIM IS CITED. A brief with history names the row ids it stands on; a brief without
 *      says "no prior context".
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the consent default, delivery/storage parity, the ambient authorization gate and the bounded schedule-handler contract against real core services.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove the three privacy properties the earlier suite only described: that a non-consenting owner's records are never READ (the old case asserted delivery and storage, which stayed green while every transcript was read and assembled), that a voice which declined, was never asked, is a minor, or cannot be attributed is never cited, and that the recorded words are neither selected by the query nor present in the delivered or stored bytes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, viewFixture, meeting, actor, manifest, sourceId } = require('./meeting-briefs.fixture');
const model = require('../routes/meeting-brief-model.js');

const ENABLED = { enabled: true, frequency: 'as-available', channel: 'bubble' };

/** @description Restore the composed delivery runtime after each isolated serial test. */
async function setup(t, options = {}) {
  const proof = await fixture(options);
  t.after(proof.stop);
  return proof;
}

/** @description Seed one synced snapshot holding one upcoming meeting. */
function withMeeting(event) {
  return { snapshots: [{ user_sub: actor.sub, events: [event], synced_at: new Date().toISOString() }] };
}

const PRIOR_START = new Date(Date.now() - 7 * 86_400_000);
const RECORDED_LINE = 'Synthetic recorded line: the migration gate stays open until Friday.';

const RECORDED_REVIEW = 'Synthetic review: gate still open.';

/** @description One synthetic segment inside the prior occurrence's window, attributed to a voice. */
function segment(id, profileId, text, offsetMinutes) {
  return { segment_id: id, user_sub: actor.sub, speaker_profile_id: profileId, transcript_text: text,
    captured_at: new Date(PRIOR_START.getTime() + offsetMinutes * 60_000).toISOString() };
}

/** @description One append to core's consent ledger; the LATEST row per profile is the current one. */
function consent(profileId, status, recordedDaysAgo, isMinor = false) {
  return { owner_sub: actor.sub, profile_id: profileId, scope: 'transcript', status, is_minor: isMinor,
    recorded_at: new Date(Date.now() - recordedDaysAgo * 86_400_000).toISOString() };
}

/**
 * @description Seed a meeting that HAS recorded history: one prior occurrence of the same series,
 * one transcript segment captured inside that occurrence's window, and the daily review for that
 * day. The segment is the owner's OWN voice, which core's consent gate admits implicitly, so
 * `ambientEnabled` remains the single difference the authorization gate is supposed to make.
 */
function withRecordedHistory(event, ambientEnabled) {
  return {
    ...withMeeting(event),
    ambient: new Map([[actor.sub, ambientEnabled]]),
    speakerSelf: ['synthetic-profile-self'],
    briefRows: new Map([[`${actor.sub}|synthetic-prior`, {
      user_sub: actor.sub, event_id: 'synthetic-prior', series_key: model.seriesKeyFor(event.title),
      title: event.title, starts_at: PRIOR_START.toISOString(),
      ends_at: new Date(PRIOR_START.getTime() + 30 * 60_000).toISOString(),
      brief: { deliveryText: 'Synthetic earlier brief.' }, built_at: PRIOR_START.toISOString(),
    }]]),
    segments: [segment('synthetic-seg-1', 'synthetic-profile-self', RECORDED_LINE, 5)],
    reviews: [{ review_id: 'synthetic-rev-1', user_sub: actor.sub,
      local_date: PRIOR_START.toISOString().slice(0, 10), summary: RECORDED_REVIEW }],
  };
}

test('the manifest registers this source consent default-OFF', () => {
  const [declared] = manifest.briefings;
  assert.equal(declared.sessionId, 'calendar-meeting-briefs');
  assert.deepEqual(declared.defaults, { enabled: false, frequency: 'as-available', channel: 'bubble' });
  assert.ok(manifest.uses.includes('jarvis-briefings'));
});

test('an owner who never opted in gets no notification and no stored brief', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  const outcome = await proof.collect();
  assert.equal(outcome.counts.delivered, 0);
  assert.equal(outcome.counts.suppressed, 1);
  assert.equal(proof.state.tasks.size, 0);
  assert.equal(proof.state.briefRows.size, 0);
  assert.equal(JSON.stringify(outcome).includes(actor.sub), false);
});

/**
 * The property the shipped text claims, and the one the case above does NOT establish: an owner who
 * has not opted in has nothing of theirs READ. Ambient capture is ON here and a full history is
 * present, so every gated query WOULD return rows; consent is the only thing standing in front of
 * them. The assertion is therefore on `reads`, not on delivery: with the consent check placed after
 * assembly, delivery and storage stay at zero exactly as they do now while the owner's verbatim
 * transcript is read and rendered every fifteen minutes.
 */
test('an owner who never opted in has nothing of theirs read, even with ambient on and a history present', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, withRecordedHistory(event, true));
  const outcome = await proof.collect();
  assert.deepEqual(proof.state.reads, ['snapshots']);
  assert.equal(proof.state.packageSql.some(sql => sql.includes('ambient_')), false);
  assert.equal(outcome.counts.candidates, 0);
  assert.equal(outcome.counts.delivered, 0);
  assert.equal(outcome.counts.suppressed, 1);
  assert.equal(proof.state.tasks.size, 0);
  assert.deepEqual(proof.state.writes, []);
});

test('after opting in, the stored brief carries the exact bytes that were delivered', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  const outcome = await proof.collect();
  assert.equal(outcome.counts.delivered, 1);
  const [task] = [...proof.state.tasks.values()];
  const [row] = [...proof.state.briefRows.values()];
  assert.equal(task.user_sub, actor.sub);
  assert.equal(task.principal_issuer, actor.issuer);
  assert.equal(task.session_id, manifest.briefings[0].sessionId);
  assert.equal(row.user_sub, actor.sub);
  assert.equal(row.brief.deliveryText, task.result);
});

test('the surface shows the delivered bytes and reads as the caller, not as the system', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  await proof.collect();
  const surface = await viewFixture(proof);
  t.after(surface.stop);
  const response = await fetch(`${surface.base}/api/calendar/meeting-briefs`);
  const body = await response.json();
  const [task] = [...proof.state.tasks.values()];
  assert.equal(response.status, 200);
  assert.equal(body.briefs.length, 1);
  assert.equal(body.briefs[0].deliveryText, task.result);
  assert.deepEqual(proof.state.systemScoped.filter(([label]) => label === 'view').map(([, system]) => system), [false]);
  assert.equal(proof.state.systemScoped.filter(([label]) => label === 'collector').every(([, system]) => system), true);
});

test('the surface refuses an unauthenticated read before touching the store', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  const surface = await viewFixture(proof, '');
  t.after(surface.stop);
  const response = await fetch(`${surface.base}/api/calendar/meeting-briefs`);
  assert.equal(response.status, 401);
  assert.equal(proof.state.reads.includes('view'), false);
});

test('ambient capture off: recorded conversation is never read and the brief says so', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  await proof.collect();
  assert.ok(proof.state.reads.includes('ambient-settings'));
  assert.equal(proof.state.reads.includes('transcripts'), false);
  assert.equal(proof.state.reads.includes('reviews'), false);
  const [task] = [...proof.state.tasks.values()];
  assert.ok(task.result.includes(model.AMBIENT_OFF_LIMIT));
  assert.ok(task.result.includes(model.NO_PRIOR_CONTEXT));
  assert.ok(task.result.includes(model.NO_ATTENDEES_LIMIT));
});

/**
 * The recorded words must not reach the delivered notification or the stored row, because neither is
 * reachable by an ambient control: `jarvis_tasks` has no retention sweep and is erased only by whole-
 * account deletion, and `calendar_meeting_briefs` is a table the ambient erasure list, the
 * `transcript_retention_days` prune and the consent-decline purge all do not know. The fixture hands
 * back the full stored row INCLUDING `transcript_text`, so this stays red for a brief that renders
 * words it was given, not merely for one that was starved of them.
 */
test('ambient capture on: the brief cites the recorded segment by row id and never copies its words', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, withRecordedHistory(event, true));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  const outcome = await proof.collect();
  assert.equal(outcome.counts.withHistory, 1);
  assert.ok(proof.state.reads.includes('transcripts'));
  assert.ok(proof.state.reads.includes('reviews'));
  const [task] = [...proof.state.tasks.values()].filter(row => row.title.includes('Synthetic Platform Review'));
  const [row] = [...proof.state.briefRows.values()].filter(brief => brief.event_id === event.id);
  assert.ok(task.result.includes('[transcript synthetic-seg-1]'));
  assert.ok(task.result.includes('[prior-meeting synthetic-prior]'));
  assert.ok(task.result.includes('[daily-review synthetic-rev-1]'));
  assert.equal(task.result.includes(RECORDED_LINE), false);
  assert.equal(task.result.includes(RECORDED_REVIEW), false);
  assert.equal(JSON.stringify(row.brief).includes(RECORDED_LINE), false);
  assert.equal(JSON.stringify(row.brief).includes(RECORDED_REVIEW), false);
  assert.ok(task.result.includes(model.AMBIENT_CITED_NOT_COPIED_LIMIT));
  assert.equal(task.result.includes(model.NO_PRIOR_CONTEXT), false);
  assert.equal(task.result.includes(model.AMBIENT_OFF_LIMIT), false);
});

/**
 * The same property at the SQL boundary rather than the rendering one: the recorded words are never
 * selected, so they do not enter this process at all. A rendering guard alone would go green again
 * the moment someone stored the row it fetched.
 */
test('the collector never selects the recorded words', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, withRecordedHistory(event, true));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  await proof.collect();
  const ambientSql = proof.state.packageSql.filter(sql => sql.includes('ambient_'));
  assert.ok(ambientSql.length >= 3);
  for (const sql of ambientSql) assert.equal(/transcript_text/.test(sql), false, sql);
  const reviewSql = ambientSql.filter(sql => sql.includes('ambient_daily_reviews'));
  assert.equal(reviewSql.length, 1);
  assert.equal(/\bsummary\b/.test(reviewSql[0]), false, reviewSql[0]);
});

/**
 * ADR-100's rule is per-heard-person, and it is core's, not this package's: `eligibleProfileIds`
 * admits the owner's own voice plus profiles whose LATEST transcript consent is 'granted' and who
 * are not minors. Everyone else — declined, revoked, never asked, minor — is excluded, and so is a
 * segment nobody can attribute, because a decline purges derived material BY profile and could
 * never reach material derived from an unattributed one.
 */
test('a voice that declined, was never asked, is a minor, or is unattributed is never cited', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, {
    ...withRecordedHistory(event, true),
    speakerConsents: [
      consent('synthetic-profile-granted', 'declined', 30),
      consent('synthetic-profile-granted', 'granted', 1),
      consent('synthetic-profile-declined', 'granted', 30),
      consent('synthetic-profile-declined', 'declined', 1),
      consent('synthetic-profile-minor', 'granted', 1, true),
    ],
    segments: [
      segment('synthetic-seg-self', 'synthetic-profile-self', 'SELF SPEECH', 1),
      segment('synthetic-seg-granted', 'synthetic-profile-granted', 'GRANTED SPEECH', 2),
      segment('synthetic-seg-declined', 'synthetic-profile-declined', 'DECLINED SPEECH', 3),
      segment('synthetic-seg-undecided', 'synthetic-profile-undecided', 'NEVER ASKED SPEECH', 4),
      segment('synthetic-seg-minor', 'synthetic-profile-minor', 'MINOR SPEECH', 5),
      segment('synthetic-seg-unattributed', null, 'UNATTRIBUTED SPEECH', 6),
    ],
    reviews: [],
  });
  await proof.service.savePreference(actor, sourceId, ENABLED);
  await proof.collect();
  assert.ok(proof.state.reads.includes('speaker-consent'));
  const [task] = [...proof.state.tasks.values()];
  assert.ok(task.result.includes('[transcript synthetic-seg-self]'));
  assert.ok(task.result.includes('[transcript synthetic-seg-granted]'));
  for (const withheld of ['synthetic-seg-declined', 'synthetic-seg-undecided',
    'synthetic-seg-minor', 'synthetic-seg-unattributed']) {
    assert.equal(task.result.includes(withheld), false, withheld);
  }
  for (const words of ['DECLINED SPEECH', 'NEVER ASKED SPEECH', 'MINOR SPEECH', 'UNATTRIBUTED SPEECH']) {
    assert.equal(task.result.includes(words), false, words);
  }
  assert.ok(task.result.includes(model.AMBIENT_CONSENT_LIMIT));
});

/** @description No eligible voice at all means the transcript table is not queried. */
test('with no consenting voice the transcript table is never queried', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, {
    ...withRecordedHistory(event, true),
    speakerSelf: [],
    segments: [segment('synthetic-seg-declined', 'synthetic-profile-declined', 'DECLINED SPEECH', 3)],
  });
  await proof.service.savePreference(actor, sourceId, ENABLED);
  await proof.collect();
  assert.ok(proof.state.reads.includes('speaker-consent'));
  assert.equal(proof.state.reads.includes('transcripts'), false);
  const [task] = [...proof.state.tasks.values()];
  assert.equal(task.result.includes('DECLINED SPEECH'), false);
});

test('ambient capture off with a history present: the recorded tables are still never read', async t => {
  const event = meeting(30, { title: 'Synthetic Platform Review' });
  const proof = await setup(t, withRecordedHistory(event, false));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  const outcome = await proof.collect();
  assert.ok(proof.state.reads.includes('priors'));
  assert.equal(proof.state.reads.includes('transcripts'), false);
  assert.equal(proof.state.reads.includes('reviews'), false);
  assert.equal(outcome.counts.delivered, 1);
  const [task] = [...proof.state.tasks.values()];
  assert.ok(task.result.includes('[prior-meeting synthetic-prior]'));
  assert.equal(proof.state.reads.includes('speaker-consent'), false);
  assert.equal(task.result.includes(RECORDED_LINE), false);
  assert.equal(task.result.includes('synthetic-seg-1'), false);
  assert.equal(task.result.includes('synthetic-rev-1'), false);
  assert.ok(task.result.includes(model.AMBIENT_OFF_LIMIT));
  assert.equal(task.result.includes(model.AMBIENT_CITED_NOT_COPIED_LIMIT), false);
});

test('a repeated scheduled run neither announces nor stores the same meeting twice', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  assert.equal((await proof.collect()).counts.delivered, 1);
  assert.equal((await proof.collect()).counts.delivered, 0);
  assert.equal(proof.state.tasks.size, 1);
  assert.equal(proof.state.briefRows.size, 1);
});

test('a meeting outside the configured lead window is not briefed yet', async t => {
  const proof = await setup(t, withMeeting(meeting(60 * 48)));
  await proof.service.savePreference(actor, sourceId, ENABLED);
  const outcome = await proof.collect();
  assert.equal(outcome.counts.candidates, 0);
  assert.equal((await proof.collect({ leadHours: 72 })).counts.delivered, 1);
});

test('an unregistered or unavailable source never reads a calendar', async t => {
  const proof = await setup(t, { ...withMeeting(meeting(30)), register: false });
  assert.equal((await proof.collect()).state, 'unavailable');
  assert.deepEqual(proof.state.reads, []);
  proof.delivery.configureJarvisBriefingDelivery(undefined);
  assert.equal((await proof.collect()).state, 'unavailable');
  assert.equal(proof.state.briefRows.size, 0);
});

test('the schedule handler returns only the bounded summary the scheduler accepts', async t => {
  const proof = await setup(t, withMeeting(meeting(30)));
  const [schedule] = manifest.schedules;
  assert.equal(schedule.target, 'service-route');
  assert.equal(schedule.route, '/api/calendar/brief-collection/collect');
  assert.equal(typeof proof.collector[schedule.handler], 'function');
  const outcome = await proof.collector[schedule.handler]({ pool: proof.pool }, { body: schedule.body });
  assert.deepEqual(Object.keys(outcome), ['summary']);
  assert.equal(typeof outcome.summary, 'string');
  assert.equal(outcome.summary.includes(actor.sub), false);
});

test('no model is called on the brief path', () => {
  const compiled = ['meeting-briefs.js', 'meeting-brief-model.js', 'meeting-brief-view.js']
    .map(file => fs.readFileSync(path.resolve(__dirname, '..', 'routes', file), 'utf8')).join('\n');
  for (const forbidden of [/executeBotOrInline/, /BotNodeClient/, /swarm-execute/, /\bopenai\b/i, /anthropic/i]) {
    assert.equal(forbidden.test(compiled), false, `brief path must not reach ${forbidden}`);
  }
});
