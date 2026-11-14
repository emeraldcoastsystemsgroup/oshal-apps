/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career Coaching 0.1.0 projection suite: the server's career-summary.v1 rules (closed objects, bounded lists and text, unknown kept apart from zero, future and day-old source times refused, no links in next steps, stable digest, the coach view limited to the consented groups), and the seeker page's snapshot builder in tools/coaching.js reading Career's GET /jobs/stats, /jobs/progress and applied list in the shapes career-hunter answers, checked by the same server rules. Fixture counts and made-up employers only.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const projection = require('../lib/projection');
const {snapshot} = require('./support/stand-ins.cjs');
require(path.join(__dirname, '..', 'tools', 'coaching.js'));
const page = globalThis.CareerCoaching;

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const counts = ['counts'];
const refuses = (fn, code) => assert.throws(fn, (error) => error.code === code && error.status === 400, code);

test('a valid counts snapshot normalizes; unknown stays null and zero stays zero', () => {
  const input = snapshot(NOW);
  input.pipeline.saved = 0;
  const out = projection.snapshotFor(input, counts, NOW);
  assert.equal(out.pipeline.saved, 0);
  assert.equal(out.pipeline.offer, null);
  assert.equal(out.applications, undefined);
});

test('every object is closed: an extra or missing field is refused at each level', () => {
  refuses(() => projection.snapshotFor({...snapshot(NOW), resume: 'x'}, counts, NOW), 'extra_fields');
  refuses(() => projection.snapshotFor({...snapshot(NOW), pipeline: {...snapshot(NOW).pipeline, salary: 1}}, counts, NOW), 'extra_fields');
  const missing = snapshot(NOW); delete missing.pipeline.closed;
  refuses(() => projection.snapshotFor(missing, counts, NOW), 'missing_fields');
  const withList = snapshot(NOW, {applications: true});
  withList.applications[0].url = 'https://jobs.example.test/1';
  refuses(() => projection.snapshotFor(withList, ['applications', 'counts'], NOW), 'extra_fields');
  refuses(() => projection.fieldGroups({applications: true, nextSteps: false, resume: true}), 'extra_fields');
});

test('counts are whole numbers within bounds or unknown', () => {
  for (const bad of [-1, 1.5, 100001, '3', true]) {
    const input = snapshot(NOW); input.pipeline.applied = bad;
    refuses(() => projection.snapshotFor(input, counts, NOW), 'invalid_count');
  }
});

test('source times: a future time and a day-old snapshot are refused; activity is exactly the past 7 days', () => {
  refuses(() => projection.snapshotFor({...snapshot(NOW), sourceAsOf: new Date(NOW + 5 * 60000).toISOString()}, counts, NOW), 'future_time');
  refuses(() => projection.snapshotFor({...snapshot(NOW), sourceAsOf: new Date(NOW - 25 * 3600000).toISOString()}, counts, NOW), 'stale_snapshot');
  const month = snapshot(NOW); month.activity.since = new Date(NOW - 30 * 86400000).toISOString();
  refuses(() => projection.snapshotFor(month, counts, NOW), 'invalid_period');
  const period = snapshot(NOW); period.activity.period = 'past30days';
  refuses(() => projection.snapshotFor(period, counts, NOW), 'invalid_period');
});

test('applications: at most 25, Career stage words only, unique items, bounded text', () => {
  const groups = ['applications', 'counts'];
  const many = snapshot(NOW, {applications: true});
  many.applications = Array.from({length: 26}, (_, i) => ({item: 'a' + (i + 1), employer: 'E', title: 'T', stage: 'Applied', date: null}));
  refuses(() => projection.snapshotFor(many, groups, NOW), 'invalid_list');
  const stage = snapshot(NOW, {applications: true}); stage.applications[0].stage = 'Sent';
  refuses(() => projection.snapshotFor(stage, groups, NOW), 'invalid_stage');
  const twice = snapshot(NOW, {applications: true}); twice.applications[1].item = 'a1';
  refuses(() => projection.snapshotFor(twice, groups, NOW), 'invalid_item');
  const long = snapshot(NOW, {applications: true}); long.applications[0].employer = 'x'.repeat(121);
  refuses(() => projection.snapshotFor(long, groups, NOW), 'invalid_text');
  const control = snapshot(NOW, {applications: true}); control.applications[0].title = 'Analyst\u0000';
  refuses(() => projection.snapshotFor(control, groups, NOW), 'invalid_text');
});

test('next steps: 1 to 3, 160 characters, no links or meeting addresses, a real date and time zone', () => {
  const groups = ['counts', 'next-steps'];
  const base = (steps) => projection.payloadFor({alias: 'Sam', groups, snapshot: projection.snapshotFor(snapshot(NOW), groups, NOW), steps});
  assert.equal(base([{text: 'Call back Example Robotics', due: '2026-11-15', timeZone: 'America/New_York'}]).nextSteps.length, 1);
  for (const text of ['Join https://meet.example.test/abc', 'see www.example.test', 'mailto:me@example.test', 'tel:5551234']) {
    refuses(() => base([{text, due: null, timeZone: null}]), 'link_in_step');
  }
  refuses(() => base([1, 2, 3, 4].map((n) => ({text: 'Step ' + n, due: null, timeZone: null}))), 'invalid_list');
  refuses(() => base([{text: 'x'.repeat(161), due: null, timeZone: null}]), 'invalid_text');
  refuses(() => base([{text: 'Prep', due: '2026-02-30', timeZone: null}]), 'invalid_day');
  refuses(() => base([{text: 'Prep', due: null, timeZone: 'Mars/Olympus'}]), 'invalid_zone');
  refuses(() => projection.payloadFor({alias: 'Sam', groups: counts, snapshot: projection.snapshotFor(snapshot(NOW), counts, NOW),
    steps: [{text: 'x', due: null, timeZone: null}]}), 'extra_fields');
  refuses(() => projection.payloadFor({alias: 'x'.repeat(61), groups: counts, snapshot: projection.snapshotFor(snapshot(NOW), counts, NOW)}), 'invalid_text');
});

test('the digest is stable across key order and changes with any value', () => {
  const a = {b: 1, a: [{y: 2, x: 1}]}, b = {a: [{x: 1, y: 2}], b: 1};
  assert.equal(projection.digest(a), projection.digest(b));
  assert.notEqual(projection.digest(a), projection.digest({...b, b: 2}));
});

test('the coach view carries only summary-v1 fields and only the consented groups', () => {
  const groups = ['applications', 'counts', 'next-steps'];
  const payload = projection.payloadFor({alias: 'Sam', groups, snapshot: projection.snapshotFor(snapshot(NOW, {applications: true}), groups, NOW),
    steps: [{text: 'Prep', due: null, timeZone: null}]});
  const row = {payload: JSON.stringify(payload), published_at: '2026-11-13T12:00:00.000Z'};
  const full = projection.coachView({field_groups: groups.join(','), expires_at: '2026-11-20T12:00:00.000Z'}, row);
  assert.deepEqual(Object.keys(full).sort(), [...projection.SUMMARY_FIELDS].sort());
  const narrow = projection.coachView({field_groups: 'counts', expires_at: '2026-11-20T12:00:00.000Z'}, row);
  assert.equal(narrow.applications, undefined, 'a payload wider than the consent is cut to the consent');
  assert.equal(narrow.nextSteps, undefined);
  assert.equal(narrow.label, 'Seeker-shared snapshot');
});

test('page: Career\'s stats map to the six stage words; a failed read is unknown, an empty store is zero', () => {
  const stats = {byStatus: [{status: 'interview', n: 2}, {status: 'rejected', n: 4}, {status: 'applied', n: 3}], total: 9, applied: 3,
    interviewing: 2, queued: 3, matches: 40, tracked: 9, saved: 12, earlierPreparation: 0};
  assert.deepEqual(page.pipelineFrom(stats), {saved: 12, gettingReady: 3, applied: 9, interviewing: 2, offer: 0, closed: 4});
  assert.deepEqual(page.pipelineFrom(null), {saved: null, gettingReady: null, applied: null, interviewing: null, offer: null, closed: null});
  assert.deepEqual(page.pipelineFrom({byStatus: [], total: 0, saved: 0, queued: 0, tracked: 0, matches: 0, empty: true}),
    {saved: 0, gettingReady: 0, applied: 0, interviewing: 0, offer: 0, closed: 0});
});

test('page: the application list keeps employer, title, stage and day only, at most 25', () => {
  const jobs = Array.from({length: 30}, (_, i) => ({id: 9000 + i, title: 'Analyst ' + i, company: 'Example Co', status: i % 2 ? 'interview' : 'applied',
    applied_at: '2026-11-0' + ((i % 9) + 1) + 'T10:00:00Z', url: 'https://jobs.example.test/' + i, notes: 'private note', ai_fit_rationale: 'x'}));
  jobs.unshift({id: 1, title: 'Saved only', company: 'Example Co', status: 'saved'});
  const list = page.applicationsFrom(jobs);
  assert.equal(list.length, 25);
  assert.deepEqual(Object.keys(list[0]).sort(), ['date', 'employer', 'item', 'stage', 'title']);
  assert.equal(list[0].stage, 'Applied');
  assert.equal(list[1].stage, 'Interviewing');
  assert.ok(!JSON.stringify(list).includes('private note') && !JSON.stringify(list).includes('https://'));
});

test('page: the snapshot the page builds passes the server\'s own rules', () => {
  const progress = {period: 'past7days', since: new Date(NOW - 7 * 86400000).toISOString(), asOf: new Date(NOW).toISOString(), applied: 5, goal: null};
  const built = page.buildSnapshot({stats: {byStatus: [], saved: 1, queued: 0, tracked: 2}, progress,
    jobs: [{title: 'Analyst', company: 'Example Co', status: 'offer', applied_at: '2026-11-10T09:00:00Z'}], now: NOW, applications: true});
  const out = projection.snapshotFor(built, ['applications', 'counts'], NOW);
  assert.equal(out.activity.applied, 5);
  assert.equal(out.applications[0].stage, 'Offer');
  const failed = page.buildSnapshot({stats: null, progress: null, jobs: null, now: NOW, applications: false});
  assert.equal(projection.snapshotFor(failed, counts, NOW).activity.applied, null, 'a failed progress read is unknown');
});
