/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Edit and Cancel meeting on the Calendar screen (calendar 1.4.0; Roger, 2026-11-14: "can't
 *   cancel or modify existing meeting", and the screen has every control the assistant has). In a real headless Chromium over
 *   the real routes, SQL and row security of the personal-calendar fixture (PostgreSQL 127.0.0.1:35689), with the stand-in
 *   kernel egress and the stand-in Google Calendar API on loopback for the Google meeting: an event opens its view; Edit opens
 *   the New event form filled in and Save changes changes only what changed, with Undo; Cancel meeting asks in the page
 *   (Keep it / Cancel meeting) and offers Undo for an OSHAL event; a Google meeting is read fresh with its guests, its change
 *   asks whether to tell them (Tell them sends Google's update), its cancellation asks the same; the screen follows; no native
 *   dialog, no page error, and nothing runs off the side at phone or desktop width. Red before: the screen had no Edit and no
 *   view, and Google meetings could not be changed or cancelled at all. Made-up people and events only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fixture, dependency, root } = require('./fixtures/personal-calendar.cjs');
const { standInGoogle, kernelEgress } = require('./fixtures/google-calendar-standin.cjs');
const { chromium } = dependency('playwright');
const yaml = dependency('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const ZONE = 'America/Chicago';

/** A day two days ahead in Chicago, and whether the month grid must move to reach it. */
function target() {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = fmt(new Date()), day = fmt(new Date(Date.now() + 2 * 86_400_000));
  return { day, nextMonth: day.slice(0, 7) !== today.slice(0, 7) };
}

/** One signed-in browser session as alice at a width, recording native dialogs, page errors and writes. */
async function session(f, browser, { width, height, phone }) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, timezoneId: ZONE });
  await context.addCookies([{ name: 'person', value: 'alice', url: f.base }]);
  const page = await context.newPage(), errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  return { context, page, errors, dialogs };
}

/** Open the Calendar on the target day. */
async function openDay(page, f, t) {
  await page.goto(`${f.base}/api/calendar/review`);
  await page.locator('.calendar-workspace[data-state="ready"]').waitFor();
  if (t.nextMonth) { await page.getByRole('button', { name: 'Next month', exact: true }).click(); await page.locator('.calendar-workspace[data-state="ready"]').waitFor(); }
  await page.locator(`[data-day="${t.day}"]`).click();
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const status = (page, text) => page.getByRole('status').filter({ hasText: text }).waitFor();

test('Edit and Cancel meeting on an OSHAL event and a Google meeting, at desktop and phone width', { timeout: 120000 }, async () => {
  const f = await fixture(), api = await standInGoogle(), egress = kernelEgress(manifest, 'person-write', api);
  let browser;
  try {
    const t = target();
    const you = { email: 'you@example.com', displayName: 'You', self: true, responseStatus: 'accepted' }, dana = { email: 'dana@example.com', displayName: 'Dana Reyes', responseStatus: 'accepted' };
    assert.equal((await f.seed('alice', { title: 'Team lunch', start: `${t.day}T12:00`, end: `${t.day}T13:00`, timeZone: ZONE, location: 'Cafe Rio' })).status, 201);
    const coffee = api.seed({ summary: 'Coffee with Dana', start: { dateTime: `${t.day}T15:00:00`, timeZone: ZONE }, end: { dateTime: `${t.day}T15:30:00`, timeZone: ZONE }, attendees: [you, dana] });
    const g = api.get(coffee);
    await f.snapshot('alice', [{ id: coffee, title: 'Coffee with Dana', start: g.start.dateTime, end: g.end.dateTime, allDay: false, url: null }], new Date().toISOString());
    browser = await chromium.launch({ headless: true });

    const desk = await session(f, browser, { width: 1280, height: 900, phone: false }), page = desk.page;
    await openDay(page, f, t);
    // An OSHAL event: open it, Edit, Save changes, Undo.
    await page.getByRole('button', { name: 'Open Team lunch', exact: true }).click();
    const view = page.locator('dialog.calendar-view');
    await view.waitFor();
    assert.match(await view.innerText(), /Cafe Rio/);
    await view.getByRole('button', { name: 'Edit', exact: true }).click();
    const sheet = page.locator('dialog.calendar-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.locator('h2').innerText(), 'Edit event');
    assert.equal(await page.locator('[name=title]').inputValue(), 'Team lunch', 'the same form as New event, filled in');
    await page.locator('[name=title]').fill('Team lunch and planning');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await status(page, 'Meeting changed.');
    await page.locator('.calendar-agenda').getByText('Team lunch and planning', { exact: true }).waitFor();
    const row = (await f.scoped('alice', 'SELECT title,location,starts_at,ends_at FROM calendar_own_events WHERE user_sub=$1', ['alice'])).rows[0];
    assert.deepEqual([row.title, row.location], ['Team lunch and planning', 'Cafe Rio'], 'only the title changed');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await status(page, 'Change undone.');
    await page.locator('.calendar-agenda').getByText('Team lunch', { exact: true }).waitFor();
    assert.equal(await page.locator('[name=title]').inputValue(), '', 'New event opens empty again after an edit');

    // Cancel meeting asks in the page: Keep it keeps it, Cancel meeting cancels it, Undo puts it back.
    await page.getByRole('button', { name: 'Open Team lunch', exact: true }).click();
    await view.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    const ask = page.locator('dialog.calendar-confirm').filter({ hasText: 'Cancel “Team lunch”?' });
    await ask.waitFor();
    await ask.getByRole('button', { name: 'Keep it', exact: true }).click();
    await ask.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.calendar-agenda').getByText('Team lunch', { exact: true }).count(), 1, 'Keep it removes nothing');
    await page.getByRole('button', { name: 'Open Team lunch', exact: true }).click();
    await view.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await page.locator('dialog.calendar-confirm').getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await status(page, 'Meeting cancelled.');
    await page.locator('.calendar-agenda').getByText('Team lunch', { exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await status(page, 'Meeting put back.');
    await page.locator('.calendar-agenda').getByText('Team lunch', { exact: true }).waitFor();

    // A Google meeting: read fresh with its guests; Edit asks whether to tell them; the screen follows.
    await page.getByRole('button', { name: 'Open Coffee with Dana', exact: true }).click();
    await view.getByText(/Guests: Dana Reyes/).waitFor();
    await view.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('[name=start]').fill(`${t.day}T16:00`);
    await page.locator('[name=end]').fill(`${t.day}T16:30`);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const tell = page.locator('dialog.calendar-confirm').filter({ hasText: 'Tell the guests?' });
    await tell.waitFor();
    assert.equal(api.writes().length, 0, 'nothing is sent before the person answers');
    await tell.getByRole('button', { name: 'Tell them', exact: true }).click();
    await status(page, 'Meeting changed.');
    const patch = api.writes().find((r) => r.method === 'PATCH');
    assert.deepEqual([Object.keys(patch.body).sort(), patch.query.sendUpdates], [['end', 'start'], 'all']);
    assert.match(api.get(coffee).start.dateTime, new RegExp(`^${t.day}T16:00:00-0[56]:00$`));
    assert.equal(api.get(coffee).summary, 'Coffee with Dana', 'the title stays');
    await page.locator('.calendar-agenda').getByText(/4:00\sPM/).first().waitFor();

    // Cancel meeting on it asks the same question in a cancellation's words.
    await page.getByRole('button', { name: 'Open Coffee with Dana', exact: true }).click();
    await view.getByRole('button', { name: 'Cancel meeting', exact: true }).waitFor();
    await view.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    const cancel = page.locator('dialog.calendar-confirm').filter({ hasText: 'Cancel “Coffee with Dana”?' });
    await cancel.waitFor();
    assert.match(await cancel.innerText(), /Dana Reyes has this meeting on their calendar\. Tell them it is cancelled\?/);
    await cancel.getByRole('button', { name: "Cancel, don't tell them", exact: true }).click();
    await status(page, 'Cancelled on your Google Calendar.');
    assert.equal(api.get(coffee).status, 'cancelled');
    assert.equal(api.writes().find((r) => r.method === 'DELETE').query.sendUpdates, 'none');
    await page.locator('.calendar-agenda').getByText('Coffee with Dana', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await noSideways(page), true);
    assert.deepEqual(desk.dialogs, [], 'no native alert, confirm or prompt');
    assert.deepEqual(desk.errors, []);
    await desk.context.close();

    // At phone width: the view, the edit form and the ask fit, and nothing runs off the side.
    const phone = await session(f, browser, { width: 390, height: 844, phone: true }), p = phone.page;
    await openDay(p, f, t);
    await p.getByRole('button', { name: 'Open Team lunch', exact: true }).click();
    await p.locator('dialog.calendar-view').waitFor();
    assert.equal(await noSideways(p), true, 'the view fits');
    const box = await p.locator('dialog.calendar-view').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `the view is inside the screen (${JSON.stringify(box)})`);
    await p.locator('dialog.calendar-view').getByRole('button', { name: 'Edit', exact: true }).click();
    await p.locator('dialog.calendar-sheet').waitFor();
    assert.equal(await noSideways(p), true, 'the edit form fits');
    await p.locator('[name=location]').fill('Union Kitchen');
    await p.getByRole('button', { name: 'Save changes', exact: true }).click();
    await status(p, 'Meeting changed.');
    await p.getByRole('button', { name: 'Open Team lunch', exact: true }).click();
    await p.locator('dialog.calendar-view').getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await p.locator('dialog.calendar-confirm').waitFor();
    assert.equal(await noSideways(p), true, 'the ask fits');
    await p.locator('dialog.calendar-confirm').getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await status(p, 'Meeting cancelled.');
    assert.equal(await noSideways(p), true);
    assert.deepEqual(phone.dialogs, []);
    assert.deepEqual(phone.errors, []);
    await phone.context.close();
  } finally { await browser?.close(); egress.restore(); await api.close(); await f.close(); }
});
