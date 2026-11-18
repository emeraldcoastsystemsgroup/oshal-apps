/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Prove in Chromium at 412x915 (touch) and 1440x900 that Career's Send step and exact-packet approval screen name the chosen Job Apply connected device ("Applies from: beta-laptop · Change device" and "beta-laptop (ready)"), keep Open the employer's form as the single filled button, and say plainly when the chosen device is offline instead of falling back to another computer.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const at = (size) => ({ ...size, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
const press = (size, target) => (size === PHONE ? target.tap() : target.click());

function readyJob() {
  return {
    id: 7,
    title: 'Systems Engineer',
    company: 'Example Co',
    location: 'Austin, TX',
    status: 'generated',
    favorite: true,
    has_resume: true,
    has_cover: true,
    url: 'https://jobs.example.com/apply/7',
    generated_at: '2026-11-10T12:00:00.000Z',
    board: {},
    application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } },
  };
}

function fixtureApi(workersPayload) {
  return ({ method, url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/jobs/7' && method === 'GET') return { json: { job: readyJob() } };
    if (p === '/api/career-hunter/experience-bank') return { json: { version: 1, revision: 'r1', entries: [] } };
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: true } };
    if (p === '/api/career-hunter/resume') return { text: url.searchParams.get('as') === 'html' ? '<p>document</p>' : '%PDF' };
    if (p === '/api/career-hunter/submission-review/7') {
      return {
        json: {
          maxPresses: 4,
          postingId: 7,
          title: 'Systems Engineer',
          company: 'Example Co',
          url: 'https://jobs.example.com/apply/7',
          packetDigest: 'a'.repeat(64),
          profile: { fullName: 'Ada Lovelace' },
          documents: [{ kind: 'resume', sha256: 'b'.repeat(64) }, { kind: 'cover', sha256: 'c'.repeat(64) }],
        },
      };
    }
    if (p === '/api/apply-operator/workers') return { json: workersPayload };
    if (p === '/api/guest/session') return { json: { guest: false, active: false } };
    if (p === '/api/auth/user') return { json: { authenticated: true, sub: 'ada' } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}

async function openSendStep(size, workersPayload) {
  const session = await openScreen(browser, 'career-application.html', fixtureApi(workersPayload), at(size), '?view=queue&application=7');
  await session.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  await press(size, session.page.getByRole('button', { name: 'Continue to send', exact: true }));
  await session.page.getByRole('heading', { name: 'Send your application' }).waitFor();
  await session.page.locator('#sendComputer:not(:has([role="status"]))').waitFor();
  return session;
}

for (const [label, size] of [['phone-412', PHONE], ['desktop-1440', DESKTOP]]) {
  test(`${label}: Career Send step and approval view name the chosen Orbit device and link to Job Apply`, async () => {
    const payload = {
      workers: [
        { id: 'node-alpha', clientId: 'node-alpha', kind: 'orbit', hostname: 'alpha-desk', available: true },
        { id: 'node-beta', clientId: 'node-beta', kind: 'orbit', hostname: 'beta-laptop', available: true },
      ],
      selectedDeviceId: 'node-beta',
      selectedDeviceName: 'beta-laptop',
      selectionConfigured: true,
      defaultClientId: 'node-beta',
      available: true,
    };
    const { page, context } = await openSendStep(size, payload);
    try {
      const filled = await page.locator('main :is(.btn.primary, .ck-primary):visible').allInnerTexts();
      assert.deepEqual(filled, ['Open the employer’s form']);
      assert.match(await page.locator('#chosenApplyDevice').innerText(), /Applies from:\s*beta-laptop/);
      assert.equal(await page.locator('#chosenApplyDevice a').getAttribute('href'), '/cockpit/?app=job-apply');

      await press(size, page.locator('#sendComputer').getByRole('button', { name: 'Send it for me from my computer', exact: true }));
      await page.getByRole('heading', { name: 'Approve this application' }).waitFor();
      assert.match(await page.locator('dl.facts').innerText(), /beta-laptop \(ready\)/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    } finally {
      await context.close();
    }
  });

  test(`${label}: when the chosen device is offline Career names it and never falls back to another online device`, async () => {
    const payload = {
      workers: [
        { id: 'node-alpha', clientId: 'node-alpha', kind: 'orbit', hostname: 'alpha-desk', available: true },
        { id: 'node-beta', clientId: 'node-beta', kind: 'orbit', hostname: 'beta-laptop', available: false },
      ],
      selectedDeviceId: 'node-beta',
      selectedDeviceName: 'beta-laptop',
      selectionConfigured: true,
      defaultClientId: null,
      available: false,
    };
    const { page, context } = await openSendStep(size, payload);
    try {
      assert.equal(await page.getByRole('button', { name: 'Send it for me from my computer' }).count(), 0);
      assert.match(await page.locator('#computerNeeded').innerText(), /Your chosen device \(beta-laptop\) is not connected right now/);
    } finally {
      await context.close();
    }
  });
}
