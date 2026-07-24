/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | The load-bearing apply-prompt
 *   guards, moved here with the prompt when it left core. Uses node:test (zero deps) so it actually
 *   runs — `node --test career-hunter/lib`. Locks the anti-fabrication + résumé-verify lines and the
 *   assist/submit gate, so a future edit that weakens them (letting the worker claim success from a DB
 *   row, or run a form with no résumé) fails here instead of shipping a fake job application.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApplyPrompt } from './apply-prompt.js';

const INPUT = {
  ticketId: 'ticket-1',
  userSub: 'auth0|someone',
  postingId: 4242,
  job: { title: 'Principal Platform Engineer', company: 'Hasbro', url: 'https://example.test/job', location: 'Remote' },
  profile: { email: 'someone@example.test' },
};
const OPTS = { controllerUrl: 'http://localhost:35457', hasCover: true };

test('carries the anti-fabrication guard — a DB row is NOT a submission', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.match(p, /reconciling DB rows is NOT a submission/i);
  assert.match(p, /Only report applied after the SITE ITSELF visibly confirms receipt/i);
});

test('refuses to run a form without the résumé (STEP 0 verify)', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.match(p, /STEP 0 — VERIFY \.\/Resume_ATS\.pdf exists/i);
  assert.match(p, /do NOT attempt the form without the resume/i);
});

test('the packet is the synced working dir — never docker-cp / hunt elsewhere', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.doesNotMatch(p, /docker cp/i);
  assert.match(p, /already synced into your CURRENT WORKING DIRECTORY/i);
});

test('tells the worker to narrate to /api/apply/shot, marked telemetry (never abort over it)', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.match(p, /\/api\/apply\/shot/);
  assert.match(p, /never abort the application over it/i);
  assert.ok(p.includes(INPUT.ticketId), 'the ticket id is bound into the narration callback');
});

test('embeds the caller-supplied controller URL in every callback', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.match(p, /http:\/\/192\.168\.1\.248:35457\/api\/apply\/ingest/);
  assert.match(p, /http:\/\/192\.168\.1\.248:35457\/api\/apply\/email-code/);
});

test('carries the 2026-07-21 yield rules (remote-first, spam-retry, ground-not-defer)', () => {
  const p = buildApplyPrompt(INPUT, OPTS);
  assert.match(p, /remote-first/i);
  assert.match(p, /open-to-travel|open to travel/i);
  assert.match(p, /spam/i);
  assert.match(p, /human-paced|resubmit ONCE/i);
  assert.match(p, /Decline to self-identify/i);
  assert.match(p, /start date|earliest availability/i);
});

test('honours the final-submit authorization gate', () => {
  const prev = process.env.APPLY_FINAL_SUBMIT_AUTHORIZED;
  try {
    process.env.APPLY_FINAL_SUBMIT_AUTHORIZED = 'true';
    assert.match(buildApplyPrompt(INPUT, OPTS), /OVERRIDE - SUBMIT MODE/);
    process.env.APPLY_FINAL_SUBMIT_AUTHORIZED = '';
    assert.match(buildApplyPrompt(INPUT, OPTS), /ASSIST MODE/);
  } finally {
    if (prev === undefined) delete process.env.APPLY_FINAL_SUBMIT_AUTHORIZED;
    else process.env.APPLY_FINAL_SUBMIT_AUTHORIZED = prev;
  }
});
