/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What the person reads on a change, cancel or decline card, rendered by the kernel's own card
 *   code (platform/src/api/jarvis-package-tools.js from OSHAL_KERNEL_PLATFORM) for inputs built from what the meeting finder
 *   really answered (calendar 1.4.0; Roger, 2026-11-14: "can't cancel or modify existing meeting"). The card names the meeting
 *   (title, day and time in its own zone), shows each changed field before and after ("Starts" and "New start"), says whether
 *   the guests are told, and never shows the revision or a bare reference; nothing reaches Google before Approve; after Approve
 *   the line names the meeting as it is now; a second Approve runs nothing (the kernel's proposals are single use). Red before:
 *   the change, cancel and decline tools did not exist, so no card could name a meeting to change.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, kernelCards, ZONE, THU } = require('./fixtures/meeting-world.cjs');

const rowsOf = (TEXT, proposal) => TEXT.fieldRows(TEXT.namedInput(proposal.input, proposal.subject || '', proposal.subjectKey || ''));
const byLabel = (rows) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

/** The meeting the finder lists by its title. */
async function listed(w, words, title) {
  const out = await w.tools.use('calendar-find-events', { words, timeZone: ZONE });
  return out.observation.body.meetings.find((m) => m.title === title);
}

test('the change card names the meeting and each field before and after; nothing reaches Google before Approve', async () => {
  const TEXT = kernelCards(), w = await world();
  try {
    const budget = await listed(w, 'Dana', 'Budget review with Dana');
    const held = await w.tools.use('calendar-change-google-event', { revision: budget.revision, title: budget.title, start: budget.start, timeZone: ZONE,
      location: '', newStart: `${THU}T14:00`, newLocation: 'Room 4B', guests: 'Will be told', confirm: true });
    assert.ok(held.proposal, JSON.stringify(held));
    assert.equal(w.api.writes().length, 0, 'a held card writes nothing');
    const p = held.proposal;
    assert.equal(TEXT.cardHeading(p), 'Change Google Calendar Meeting');
    assert.equal(TEXT.cardLine(p), 'Changes this meeting on your Google Calendar; only the rows marked New change, and the rest stays as it is. Nothing is written to Google until you approve.');
    const rows = rowsOf(TEXT, p), value = byLabel(rows);
    assert.deepEqual(rows.map((r) => r.label), ['Title', 'Starts', 'Time zone', 'New start', 'New location', 'Guests']);
    assert.equal(value.Title, 'Budget review with Dana');
    assert.match(value.Starts, /^Wed, .+ 3:00\sPM CST$/, 'the day and time it has now');
    assert.match(value['New start'], /^Thu, .+ 2:00\sPM CST$/, 'and the one it moves to');
    assert.equal(value['New location'], 'Room 4B');
    assert.equal(value.Guests, 'Will be told', 'whether the guests are told, in words');
    assert.ok(!rows.some((r) => /revision|^g\./i.test(`${r.label} ${r.value}`)), 'the revision never shows');
    const done = await w.tools.approve(p.id);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(w.api.writes().length, 1);
    const line = TEXT.resultSummary(p, done.status, done.body, 'Calendar Preparation');
    assert.match(line.line, /^Changed Budget review with Dana, Thu, .+ 2:00\sPM CST in Calendar Preparation\.$/);
    assert.match(line.where, /^Changed the start, end and place on your Google Calendar\. Dana Reyes was told\. To put it back, ask to undo it\.$/);
    const twice = await w.tools.approve(p.id);
    assert.match(twice.refused, /already used/);
    assert.equal(w.api.writes().length, 1, 'a second Approve runs nothing');
  } finally { await w.close(); }
});

test('the cancel card says it cancels for everyone and whether the guests are told; the decline card names the organizer', async () => {
  const TEXT = kernelCards(), w = await world();
  try {
    const coffee = await listed(w, 'Coffee', 'Coffee with Dana');
    const held = await w.tools.use('calendar-cancel-google-event', { revision: coffee.revision, title: coffee.title, start: coffee.start, timeZone: ZONE, guests: 'Will not be told', confirm: true });
    const p = held.proposal;
    assert.equal(TEXT.cardHeading(p), 'Cancel Google Calendar Meeting');
    assert.equal(TEXT.cardLine(p), 'Cancels this meeting on your Google Calendar for everyone on it. Nothing is cancelled until you approve.');
    const value = byLabel(rowsOf(TEXT, p));
    assert.deepEqual([value.Title, value.Guests], ['Coffee with Dana', 'Will not be told']);
    assert.match(value.Starts, /^Tue, .+ 3:00\sPM CST$/);
    assert.equal(w.api.writes().length, 0);
    const done = await w.tools.approve(p.id);
    const line = TEXT.resultSummary(p, done.status, done.body, 'Calendar Preparation');
    assert.match(line.line, /^Cancelled Coffee with Dana, Tue, .+ 3:00\sPM CST from Calendar Preparation\.$/);
    assert.match(line.where, /^Cancelled on your Google Calendar\. The guest was not told\./);
    const decline = { toolName: 'calendar-decline-google-event', app: 'calendar', label: 'Decline Google Calendar Invitation', mode: 'ask',
      cardText: w.manifest.tools.find((t) => t.name === 'calendar-decline-google-event').cardText, input: { revision: 'g.x.1', title: 'Board prep', start: `${THU}T11:00:00-06:00`, timeZone: ZONE, organizer: 'Will be told', confirm: true } };
    assert.equal(TEXT.cardLine(decline), 'Declines this invitation on your Google Calendar; the meeting stays on its organizer\'s calendar. Nothing is sent until you approve.');
    assert.equal(byLabel(rowsOf(TEXT, decline)).Organizer, 'Will be told');
  } finally { await w.close(); }
});

test('the OSHAL change and removal cards name the event by its title and time, never by a reference', async () => {
  const TEXT = kernelCards(), w = await world();
  try {
    const lunch = await listed(w, 'lunch', 'Team lunch');
    const held = await w.tools.use('calendar-change-event', { id: lunch.id, revision: lunch.revision, title: lunch.title, start: lunch.start, timeZone: ZONE, newTitle: 'Team lunch and planning', confirm: true });
    const rows = rowsOf(TEXT, held.proposal);
    assert.deepEqual(rows.map((r) => r.label), ['Title', 'Starts', 'Time zone', 'New title']);
    assert.ok(!rows.some((r) => /reference|o\.first/.test(r.value)), 'neither the id nor the revision shows');
    assert.equal(TEXT.cardHeading(held.proposal), 'Change Event');
    const done = await w.tools.approve(held.proposal.id);
    assert.match(TEXT.resultSummary(held.proposal, done.status, done.body, 'Calendar Preparation').line, /^Changed Team lunch and planning, Thu, .+ in Calendar Preparation\.$/);
    const fresh = await listed(w, 'lunch', 'Team lunch and planning');
    const remove = await w.tools.use('calendar-remove-event', { id: fresh.id, title: fresh.title, start: fresh.start, timeZone: ZONE });
    const value = byLabel(rowsOf(TEXT, remove.proposal));
    assert.equal(value.Title, 'Team lunch and planning');
    assert.match(value.Starts, /^Thu, /);
    assert.ok(!('Item' in value), 'no bare reference row');
    assert.equal(w.pool.rows.length, 1, 'nothing is removed before Approve');
    const gone = await w.tools.approve(remove.proposal.id);
    assert.match(TEXT.resultSummary(remove.proposal, gone.status, gone.body, 'Calendar Preparation').line, /^Removed Team lunch and planning, Thu, .+ from Calendar Preparation\.$/);
  } finally { await w.close(); }
});

test('a call the kernel would refuse makes no card: a title for a revision, an unknown guests choice, a past-free shape', async () => {
  const w = await world();
  try {
    const coffee = await listed(w, 'Coffee', 'Coffee with Dana');
    for (const input of [
      { revision: 'Coffee with Dana', title: coffee.title, start: coffee.start, newTitle: 'x', guests: 'Will be told', confirm: true },
      { revision: coffee.revision, title: coffee.title, start: coffee.start, newTitle: 'x', guests: 'Tell them', confirm: true },
      { revision: coffee.revision, title: coffee.title, start: coffee.start, newTitle: 'x', guests: 'Will be told' },
      { revision: coffee.revision, title: coffee.title, start: coffee.start, newLocation: '', guests: 'Will be told', confirm: true },
    ]) assert.match((await w.tools.use('calendar-change-google-event', input)).refused, /refuses the call before any card/, JSON.stringify(input));
    assert.equal(w.tools.held.size, 0);
  } finally { await w.close(); }
});
