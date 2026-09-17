/**
 * Calendar Preparation — the brief must never invent background.
 *
 * Dependency-free `node --test` against the COMPILED module the framework actually mounts. The
 * assertions here are the product: a brief a person trusts is one where every sentence names the
 * record it came from, and where an empty history reads as empty rather than plausible.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove citation-or-drop, the honest no-prior-context sentence, verbatim quotation, the stated limits and the single rendering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Replace the verbatim-quotation property with its opposite, which is what the assembler now owes: ambient material is CITED and never copied, because a copy lands in two stores no ambient deletion, retention or consent control reaches. The cases feed the assembler recorded words it is not supposed to have and assert they reach neither a claim nor the delivery text.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../routes/meeting-brief-model.js');

const BUILT_AT = '2026-09-16T12:00:00.000Z';
const EVENT = { id: 'evt-1', title: 'Weekly Sync — Platform', start: '2026-09-17T15:00:00.000Z', end: '2026-09-17T15:30:00.000Z' };

/** @description Assemble one brief with explicit synthetic material and no hidden defaults. */
function brief(overrides = {}) {
  return model.buildMeetingBrief({ event: EVENT, builtAt: BUILT_AT, ambientAuthorized: true, ...overrides });
}

const PRIOR = Object.freeze({
  eventId: 'evt-0', title: 'Weekly Sync — Platform',
  startsAt: '2026-09-10T15:00:00.000Z', endsAt: '2026-09-10T15:30:00.000Z',
});
const SEGMENT = Object.freeze({
  segmentId: 'seg-7', capturedAt: '2026-09-10T15:06:00.000Z', occurrenceStartsAt: PRIOR.startsAt,
});
const REVIEW = Object.freeze({ reviewId: 'rev-3', localDate: '2026-09-10' });
/** Recorded words the assembler must never render, handed to it anyway. */
const RECORDED_WORDS = 'Synthetic recorded line: we agreed to revisit the migration gate.';
const RECORDED_REVIEW = 'Synthetic review: migration gate still open.';

test('a meeting with no recorded material says so instead of producing background', () => {
  const result = brief();
  assert.equal(result.hasHistory, false);
  assert.deepEqual(result.claims, []);
  assert.ok(result.deliveryText.includes(model.NO_PRIOR_CONTEXT));
  assert.equal(result.deliveryText.includes('Source:'), false);
  assert.equal(/last met|discussed|recorded while|your recorded review/i.test(result.deliveryText), false);
});

test('every claim carries the record that produced it', () => {
  const result = brief({ priorOccurrences: [PRIOR], transcripts: [SEGMENT], reviews: [REVIEW] });
  assert.equal(result.hasHistory, true);
  assert.equal(result.claims.length, 3);
  for (const claim of result.claims) {
    assert.ok(claim.text.trim().length > 0);
    assert.ok(['prior-meeting', 'transcript', 'daily-review'].includes(claim.source.kind));
    assert.ok(claim.source.id.trim().length > 0);
    assert.ok(claim.source.at.trim().length > 0);
    assert.ok(result.deliveryText.includes(`[${claim.source.kind} ${claim.source.id}]`));
  }
  assert.deepEqual(result.claims.map(claim => claim.source.id), ['evt-0', 'seg-7', 'rev-3']);
});

test('material that cannot be cited is dropped, never softened into an uncited sentence', () => {
  const result = brief({
    priorOccurrences: [{ ...PRIOR, eventId: '   ' }],
    transcripts: [{ ...SEGMENT, segmentId: '' }, { ...SEGMENT, segmentId: 'seg-blank', capturedAt: '' },
      { ...SEGMENT, segmentId: 'seg-window', occurrenceStartsAt: '' }],
    reviews: [{ ...REVIEW, reviewId: 'rev-ok', localDate: '' }],
  });
  assert.deepEqual(result.claims, []);
  assert.equal(result.hasHistory, false);
  assert.ok(result.deliveryText.includes(model.NO_PRIOR_CONTEXT));
  assert.equal(result.deliveryText.includes('seg-blank'), false);
  assert.equal(result.deliveryText.includes('seg-window'), false);
});

/**
 * The assembler is handed the recorded words on purpose here. A brief that copies them puts a second
 * copy into `jarvis_tasks.result` and `calendar_meeting_briefs.brief`, and no ambient control reaches
 * either one — not a deleted day, not the retention prune, not a consent a heard person withdraws
 * later. So the brief points at the row instead, and this case fails if any recorded word survives
 * into a claim or into the delivered text.
 */
test('recorded conversation is cited by row id and never copied into the brief', () => {
  const result = brief({
    transcripts: [{ ...SEGMENT, text: RECORDED_WORDS, transcriptText: RECORDED_WORDS }],
    reviews: [{ ...REVIEW, summary: RECORDED_REVIEW }],
  });
  const [spoken, reviewed] = result.claims;
  assert.equal(spoken.source.kind, 'transcript');
  assert.equal(spoken.source.id, SEGMENT.segmentId);
  assert.ok(spoken.text.includes(PRIOR.startsAt));
  assert.equal(reviewed.source.kind, 'daily-review');
  assert.equal(reviewed.source.id, REVIEW.reviewId);
  for (const words of [RECORDED_WORDS, RECORDED_REVIEW]) {
    assert.equal(spoken.text.includes(words), false);
    assert.equal(reviewed.text.includes(words), false);
    assert.equal(result.deliveryText.includes(words), false);
    assert.equal(JSON.stringify(result).includes(words), false);
  }
  assert.ok(result.deliveryText.includes(`[transcript ${SEGMENT.segmentId}]`));
  assert.ok(result.deliveryText.includes(`[daily-review ${REVIEW.reviewId}]`));
});

test('an over-long prior title is cut and marked, and stays a prefix of the recorded title', () => {
  const long = `Synthetic long title ${'x'.repeat(400)}`;
  const result = brief({ priorOccurrences: [{ ...PRIOR, title: long }], excerptChars: 50 });
  const quoted = result.claims[0].text.match(/"([^"]*)"/)[1];
  assert.equal(quoted.endsWith('…'), true);
  assert.ok(quoted.length <= 51);
  assert.ok(long.startsWith(quoted.slice(0, -1)));
});

test('the series key links occurrences of one recurring meeting and separates different ones', () => {
  assert.equal(model.seriesKeyFor('Weekly Sync — Platform'), model.seriesKeyFor('  weekly   sync -- platform '));
  assert.notEqual(model.seriesKeyFor('Weekly Sync — Platform'), model.seriesKeyFor('Weekly Sync — Finance'));
  assert.equal(model.seriesKeyFor('   '), 'untitled');
  assert.equal(model.seriesKeyFor(undefined), 'untitled');
});

test('what the brief does not hold is printed beside what it does', () => {
  const authorized = brief({ priorOccurrences: [PRIOR] });
  assert.deepEqual(authorized.limits,
    [model.NO_ATTENDEES_LIMIT, model.AMBIENT_CITED_NOT_COPIED_LIMIT, model.AMBIENT_CONSENT_LIMIT]);
  for (const limit of authorized.limits) assert.ok(authorized.deliveryText.includes(limit), limit);
  const unauthorized = brief({ ambientAuthorized: false });
  assert.deepEqual(unauthorized.limits, [model.NO_ATTENDEES_LIMIT, model.AMBIENT_OFF_LIMIT]);
  assert.ok(unauthorized.deliveryText.includes(model.AMBIENT_OFF_LIMIT));
  assert.equal(unauthorized.deliveryText.includes(model.AMBIENT_CITED_NOT_COPIED_LIMIT), false);
});

test('the delivered text is the one rendering of the stored document', () => {
  const result = brief({ priorOccurrences: [PRIOR], transcripts: [SEGMENT] });
  const { deliveryText, ...document } = result;
  assert.equal(model.renderDeliveryText(document), deliveryText);
  assert.equal(model.renderDeliveryText(document), model.renderDeliveryText(document));
});

test('the claim cap bounds a long history without dropping the citation of what survives', () => {
  const priors = [PRIOR, { ...PRIOR, eventId: 'evt-b' }, { ...PRIOR, eventId: 'evt-c' }];
  const result = brief({ priorOccurrences: priors, transcripts: [SEGMENT], reviews: [REVIEW], maxClaims: 2 });
  assert.equal(result.claims.length, 2);
  assert.ok(result.claims.every(claim => claim.source.id));
});
