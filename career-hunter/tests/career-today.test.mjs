/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The day of someone looking for a job, as Career's home lists it: which steps exist for which answers from Career, the inbox check, Portrait Studio and Social, in what order, with which one button; the three numbered steps of a person with no résumé; and this week's counts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 6: To approve is not a stage, so the day's step about Career's picks says "jobs Career picked are waiting for you" and opens Saved, where they lead; it counts only the picks the page was given (counts.approve), never the home summary's count of every waiting record.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: the photo step's button reads Add a photo. It read Open Portrait Studio, the name of another application, while Career's own bar calls that page Photo.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 1: the step about Career's picks opens ?view=approve, the picks address, which the Job Board treats as explicit and so restores no remembered filter over. It opened ?view=saved, where a filter left from an earlier visit could hide the picks the step had just counted. The plan may therefore name that address; it still has no words of the stage that is gone.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Manual application outcomes stop no-reply reminders and saved interview times appear in the day's preparation step.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Keep actionable match counts and links distinct from dated scoring activity while preserving saved and pipeline records.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Use complete original-owner past-seven-day application progress and preserve unknown counts instead of sampling the tracked page.
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
    summary: { metrics: [{ id: 'scored-24h', value: '23' }] }, counts: { matches: 23, approve: 2 }, stats: { interviewing: 1, applied: 4 },
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
  assert.equal(plan.steps[1].title, '23 new matches are ready to review');
  assert.equal(plan.steps[2].title, '2 jobs Career picked are waiting for you');
  assert.equal(plan.steps[2].detail, 'Prepare the ones you want to apply to and remove the rest. Nothing is sent until you say so.');
  assert.deepEqual(plan.steps[2].action, { label: 'See Career\'s picks', view: 'board', query: 'view=approve' }, 'it opens the picks address: an address that names what to show puts back no remembered filter');
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
  const photo = step({ portrait: { portrait: { ready: false } }, plan: { plan: { state: 'draft' } }, drafts: { drafts: [{}] } });
  assert.equal(photo.id, 'portrait');
  assert.deepEqual(photo.action, { label: 'Add a photo', view: 'portrait-studio' }, 'the button says what the person does, in the word Career\'s bar has for that page (Photo)');
  assert.doesNotMatch(JSON.stringify(photo), /Portrait Studio/, 'no line names the other application');
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

test('the past seven days count recorded applications, replies and interview replies separately', () => {
  const input = { progress:{period:'past7days',applied:2},applied: [{ applied_at: ago(1) }, { applied_at: ago(6) }, { applied_at: ago(8) }, {}],
    updates: { events: [{ kind: 'interview', date: ago(2) }, { kind: 'acknowledged', date: ago(3) }, { kind: 'interview', date: ago(10) }] } };
  assert.deepEqual(today.week(input, NOW), { applied: 2, replies: 2, interviews: 1 });
  assert.deepEqual(today.week(null, NOW), { applied: null, replies: 0, interviews: 0 });
});

test('past-seven-day application progress comes from the complete owner count, not a sampled tracked page', () => {
  const input={applied:Array.from({length:50},()=>({applied_at:ago(1)})),progress:{period:'past7days',applied:64},updates:{events:[]}};
  assert.equal(today.week(input,NOW).applied,64);
  assert.equal(today.week({...input,progress:null},NOW).applied,null,'unavailable progress is unknown, not the first page count');
  assert.equal(today.week({...input,progress:{period:'past7days',applied:0}},NOW).applied,0);
});

test('the step about Career\'s picks counts the picks a person can still act on, and nothing else', () => {
  const one = today.plan({ ...withResume, counts: { approve: 1 } }, NOW).steps[0];
  assert.deepEqual([one.id, one.title], ['approve', '1 job Career picked is waiting for you']);
  const summary = { metrics: [{ id: 'approval-review', value: '4' }] };
  assert.deepEqual(ids(today.plan({ ...withResume, counts: { approve: 0 }, summary }, NOW)), [], 'picks the person has already prepared are still records, and are not a step');
  assert.deepEqual(ids(today.plan({ ...withResume, summary }, NOW)), [], 'the summary\'s count of records is never taken for picks');
  assert.doesNotMatch(JSON.stringify(today.plan({ ...withResume, counts: { approve: 3 } }, NOW)), /approve"?:|to approve/i, 'no words of the stage that is gone');
});

test('manual outcomes and applications past Applied are never called silent applications', () => {
  const old = {applied_at:ago(10),emailUpdates:[]};
  const jobs = [{...old,id:1,status:'applied'}, {...old,id:2,status:'interview'},
    {...old,id:3,status:'offer'}, {...old,id:4,status:'rejected'},
    {...old,id:5,status:'applied',board:{manualTracking:{status:'interview'}}}];
  assert.deepEqual(today.silentApplications(jobs,NOW).map(job=>job.id),[1]);
});

test('Home shows a recorded interview time from the same tracked job receipt as Interviewing', () => {
  const at='2026-11-20T15:30:00.000Z';
  const input={...withResume,stats:{interviewing:1},applied:[{id:7,status:'interview',company:'Fixture employer',
    board:{manualTracking:{status:'interview',interviewAt:at}}}]};
  const step=today.plan(input,NOW).steps.find(step=>step.id==='interviews');
  assert.equal(step.lines[0].text,'Fixture employer · '+new Date(at).toLocaleString());
  assert.equal(step.lines[0].posting,7);
});

test('dated scoring activity does not invent actionable matches',()=>{
  const input={...withResume,counts:{matches:0},summary:{metrics:[{id:'scored-24h',value:'99'}]}};
  assert.equal(today.plan(input,NOW).steps.some(step=>step.id==='matches'),false);
});
