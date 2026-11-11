/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The day of someone looking for a job, as Career's home lists it: which steps exist for which answers from Career, the inbox check, Portrait Studio and Social, in what order, with which one button; the three numbered steps of a person with no résumé; and this week's counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const today = createRequire(import.meta.url)('../tools/career-today.js');
const NOW = Date.parse('2026-11-11T15:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const ids = (plan) => plan.steps.map((step) => step.id);
const withResume = { resume: { hasResume: true } };

test('with no résumé the day is three numbered steps, and the first carries the one button that matters', () => {
  const plan = today.plan({ resume: { hasResume: false }, stats: { saved: 7 }, summary: { metrics: [{ id: 'scored-24h', value: '40' }] } }, NOW);
  assert.equal(plan.firstRun, true);
  assert.deepEqual(plan.steps.map((step) => [step.number, step.id, step.action.label, step.action.view, Boolean(step.first)]), [
    [1, 'resume', 'Add your résumé', 'resume-studio', true], [2, 'want', 'Set it', 'settings', false], [3, 'matches', 'Search jobs now', 'search', false]]);
  assert.equal(today.plan({ resume: { hasResume: false, indexing: true } }, NOW).firstRun, false, 'a résumé being read is not a first run');
  assert.equal(today.plan({ resume: null }, NOW).firstRun, false, 'an answer that could not be read is not taken for no résumé');
});

test('a quiet day has no steps at all', () => {
  assert.deepEqual(today.plan({ ...withResume, stats: { saved: 3 }, updates: { status: 'connected', events: [] }, readiness: { stories: { ready: true }, materials: { ready: true } } }, NOW), { firstRun: false, steps: [] });
});

test('the day goes in order: replies, new matches, ready to send, follow up, prepare, be seen, get stronger', () => {
  const input = { ...withResume,
    updates: { status: 'connected', events: [{ kind: 'acknowledged', subject: 'Thanks for applying', date: ago(1), postingId: 5 }, { kind: 'interview', subject: 'Interview with Acme', date: ago(2), postingId: 9 }] },
    summary: { metrics: [{ id: 'scored-24h', value: '23' }] }, counts: { approve: 2 }, stats: { interviewing: 1, applied: 4 },
    recruiters: [{ firm: 'North Search', followup_date: ago(1).slice(0, 10) }, { firm: 'Later Co', followup_date: ago(-3).slice(0, 10) }],
    applied: [{ company: 'Quiet Corp', applied_at: ago(9), emailUpdates: [] }, { company: 'Fresh Corp', applied_at: ago(2), emailUpdates: [] }, { company: 'Answered Corp', applied_at: ago(12), emailUpdates: [{ kind: 'acknowledged' }] }],
    portrait: { portrait: { ready: false } }, readiness: { stories: { ready: false, detail: '2 of 6 roles have a story.' } } };
  const plan = today.plan(input, NOW);
  assert.deepEqual(ids(plan), ['replies', 'matches', 'approve', 'recruiters', 'silent', 'interviews'], 'six at most, in the order of a day');
  assert.equal(plan.steps[0].first, true);
  assert.equal(plan.steps.filter((step) => step.first).length, 1);
  const replies = plan.steps[0];
  assert.equal(replies.title, '2 replies from employers this week');
  assert.deepEqual(replies.lines.map((line) => line.text), ['Interview reply: Interview with Acme', 'Application received: Thanks for applying'], 'an interview comes before a receipt');
  assert.deepEqual(replies.action, { label: 'Open the newest', view: 'board', query: 'application=9' });
  assert.equal(plan.steps[1].title, '23 jobs were scored for you since yesterday');
  assert.deepEqual(plan.steps[2].action, { label: 'Review and approve', view: 'board', query: 'view=approve' });
  assert.equal(plan.steps[3].detail, 'North Search');
  assert.equal(plan.steps[4].title, '1 application has had no reply for a week');
  assert.equal(plan.steps[4].detail, 'Quiet Corp');
});

test('replies older than a week, or of no known kind, are not today\'s', () => {
  const updates = { status: 'connected', events: [{ kind: 'interview', subject: 'Old', date: ago(8), postingId: 1 }, { kind: 'newsletter', subject: 'Noise', date: ago(1) }, { kind: 'offer', subject: 'No date' }] };
  assert.deepEqual(today.recentReplies(updates, NOW), []);
  assert.deepEqual(ids(today.plan({ ...withResume, updates }, NOW)), []);
});

test('a reply Career could not match to one job opens the list of applications, not a job', () => {
  const plan = today.plan({ ...withResume, updates: { events: [{ kind: 'offer', subject: 'Offer letter', date: ago(0.5), postingId: null, needsReview: true }] } }, NOW);
  assert.deepEqual(plan.steps[0].action, { label: 'See applications', view: 'board', query: 'view=status' });
  assert.equal(plan.steps[0].lines[0].review, true);
});

test('with applications sent and no inbox check, the day offers to turn it on, or says in the route\'s own words why it cannot read', () => {
  const sent = { ...withResume, stats: { applied: 2 } };
  assert.deepEqual(ids(today.plan({ ...sent, updates: { status: 'not-checked', events: [] } }, NOW)), ['replies-off']);
  const broken = today.plan({ ...sent, updates: { status: 'unavailable', error: 'Connect the submission Gmail account with mail read access in Connections.', events: [] } }, NOW).steps[0];
  assert.equal(broken.id, 'replies-broken');
  assert.equal(broken.detail, 'Connect the submission Gmail account with mail read access in Connections.');
  assert.deepEqual(ids(today.plan({ ...withResume, stats: { applied: 0 }, updates: { status: 'not-checked', events: [] } }, NOW)), [], 'nothing sent yet, so nothing to watch for');
});

test('being seen is one step: the portrait first, then the written profile, then drafts', () => {
  const step = (extra) => today.plan({ ...withResume, ...extra }, NOW).steps[0];
  assert.equal(step({ portrait: { portrait: { ready: false } }, plan: { plan: { state: 'draft' } }, drafts: { drafts: [{}] } }).id, 'portrait');
  assert.equal(step({ portrait: { portrait: { ready: true } }, plan: { plan: { state: 'draft' } }, drafts: { drafts: [{}] } }).id, 'profile');
  const posts = step({ portrait: { portrait: { ready: true } }, plan: { plan: { state: 'applied' } }, drafts: { drafts: [{}, {}] } });
  assert.deepEqual([posts.id, posts.title, posts.action.view], ['posts', '2 post drafts are waiting', 'social-workspace']);
  assert.deepEqual(ids(today.plan({ ...withResume, portrait: null, plan: null, drafts: null }, NOW)), [], 'an application the person cannot open says nothing');
});

test('a step that opens a page the person cannot open is left out', () => {
  const input = { ...withResume, portrait: { portrait: { ready: false } }, readiness: { stories: { ready: false, detail: 'x' } } };
  assert.deepEqual(ids(today.plan(input, NOW, ['home', 'board', 'strengthen'])), ['stories']);
  assert.deepEqual(ids(today.plan({ resume: { hasResume: false } }, NOW, ['home', 'search'])), ['matches'], 'the first run keeps only the steps the person can take');
});

test('this week counts what was sent, what was answered and the interview replies', () => {
  const input = { applied: [{ applied_at: ago(1) }, { applied_at: ago(6) }, { applied_at: ago(8) }, {}],
    updates: { events: [{ kind: 'interview', date: ago(2) }, { kind: 'acknowledged', date: ago(3) }, { kind: 'interview', date: ago(10) }] } };
  assert.deepEqual(today.week(input, NOW), { applied: 2, replies: 2, interviews: 1 });
  assert.deepEqual(today.week(null, NOW), { applied: 0, replies: 0, interviews: 0 });
});
