/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What the person reads on the Add to Google Calendar card, rendered by the kernel's own card code
 *   (platform/src/api/jarvis-package-tools.js, from OSHAL_KERNEL_PLATFORM, a read-only export of the kernel's platform folder) for
 *   the production request of 2026-11-13: the card names the calendar (cardText), and its rows state the title, the first date and
 *   time in the event's own zone, the end, where, the zone, and the repeat with how many times; after Approve the result line names
 *   the event and its first time and offers the event in Google Calendar. Refuses, never skips, without the platform folder.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM = process.env.OSHAL_KERNEL_PLATFORM;
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const tool = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8')).tools.find((t) => t.name === 'calendar-add-google-event');

/** The kernel's card text helpers (exported by jarvis-package-tools.js for node tests). */
function cardText() {
  assert.ok(PLATFORM, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  return require(path.join(PLATFORM, 'src', 'api', 'jarvis-package-tools.js'));
}
const input = { title: "Gabriel's music lessons", start: '2026-11-13T18:00', end: '2026-11-13T19:00', timeZone: 'America/Chicago',
  location: 'T. C. Music Lessons', repeat: { every: 'week', on: ['Friday'], times: 20 }, confirm: true };
const proposal = { toolName: tool.name, app: 'calendar', label: tool.displayName, cardText: tool.cardText, mode: 'ask', input };

test('the card for a weekly Friday series says which calendar, the first date and time, the zone, the repeat and how many', () => {
  const TEXT = cardText();
  assert.equal(TEXT.cardHeading(proposal), 'Add to Google Calendar');
  assert.equal(TEXT.cardLine(proposal), 'Adds this to your primary Google Calendar, as one event or one repeating series. Nothing is written to Google until you approve.');
  const rows = TEXT.fieldRows(TEXT.namedInput(input, '', ''));
  assert.deepEqual(rows.map((row) => row.label), ['Title', 'Starts', 'Ends', 'Where', 'Time zone', 'Repeat every', 'Repeat on', 'Repeat times']);
  const value = Object.fromEntries(rows.map((row) => [row.label, row.value]));
  assert.equal(value.Title, "Gabriel's music lessons");
  assert.match(value.Starts, /^Fri, Nov 13,? 6:00\sPM CST$/);
  assert.match(value.Ends, /^Fri, Nov 13,? 7:00\sPM CST$/);
  assert.deepEqual([value.Where, value['Time zone'], value['Repeat every'], value['Repeat on'], value['Repeat times']],
    ['T. C. Music Lessons', 'America/Chicago', 'week', 'Friday', '20']);
});

test('after Approve the line names the series and its first time, with the calendar note and a link to the event', () => {
  const TEXT = cardText();
  const answer = { ok: true, url: 'https://www.google.com/calendar/event?eid=abc',
    where: 'Added to your primary Google Calendar as one repeating series: every Friday, 20 times, from Fri, Nov 13, 2026.',
    event: { id: 'oshalabc', title: "Gabriel's music lessons", start: '2026-11-14T00:00:00.000Z', timeZone: 'America/Chicago', repeat: 'every Friday, 20 times', calendar: 'primary' } };
  const done = TEXT.resultSummary(proposal, 201, answer, 'Calendar Preparation');
  assert.equal(done.ok, true);
  assert.match(done.line, /^Added Gabriel's music lessons, Fri, Nov 13,? 6:00\sPM CST in Calendar Preparation\.$/);
  assert.equal(done.where, answer.where);
  assert.deepEqual(done.link, { href: answer.url, label: 'Open google.com' });
  const refused = TEXT.resultSummary(proposal, 409, { error: 'Google Calendar is not connected. Connect Google on the Connections page (/utilities) and allow it to view and edit events on your calendars, then ask again. Nothing was added.' }, 'Calendar Preparation');
  assert.equal(refused.ok, false);
  assert.match(refused.line, /^Calendar Preparation did not do this: Google Calendar is not connected\. Connect Google on the Connections page/);
});
