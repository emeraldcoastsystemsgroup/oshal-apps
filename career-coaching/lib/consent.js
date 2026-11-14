/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First consent rules (0.1.0), without I/O. A preview binds recipient, scope, field groups, payload digest, days and the consent revision it expects, for ten minutes; a retried preview with the same intent id must carry the same binding. A share lasts 1, 3, 7 (default), 14 or 30 days and never longer. Activation needs the seeker's own approved decision on that preview's ticket, a live preview and an unchanged revision; it raises the revision and publishes the one snapshot together, and a retry after a lost answer returns the same activation. A coach read needs the exact coach identity and tenant, an active consent, a deadline still ahead (equality refuses) and no "stop viewing" record. Revocation is one action by the seeker only.
 */
'use strict';
const crypto = require('node:crypto');
const projection = require('./projection');

const APP = 'career-coaching';
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const ALLOWED_DAYS = Object.freeze([1, 3, 7, 14, 30]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @description A refusal the route answers with the given status.
 * @param {string} code - Machine-readable refusal.
 * @param {string} message - Words the page shows.
 * @param {number} status - HTTP status.
 * @returns {never} Always throws.
 */
function deny(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

/**
 * @description A request body that must carry nothing (an approval, identity or extension is never read from it).
 * @param {unknown} body - Untrusted body.
 * @returns {void}
 */
function emptyBody(body) {
  if (body === undefined || body === null || body === '') return;
  projection.closed(body, [], [], 'This request');
}

/**
 * @description The seeker's preview request: an intent id, an exact coach code, the days, their alias, the two
 * opt-in choices, the snapshot their page read and (when chosen) their next steps. Nothing else is accepted.
 * @param {unknown} body - Untrusted body.
 * @returns {object} Normalized request.
 */
function previewRequest(body) {
  projection.closed(body, ['intentId', 'coachCode', 'days', 'alias', 'include', 'snapshot', 'nextSteps'], ['days', 'nextSteps'], 'Share');
  if (typeof body.intentId !== 'string' || !UUID.test(body.intentId)) projection.refuse('invalid_intent', 'This share has no valid intent id.');
  const days = body.days === undefined ? DEFAULT_DAYS : body.days;
  if (!ALLOWED_DAYS.includes(days)) projection.refuse('invalid_days', `Sharing lasts ${ALLOWED_DAYS.join(', ')} days; at most ${MAX_DAYS}.`);
  if (typeof body.coachCode !== 'string') projection.refuse('invalid_code', 'Enter your coach’s code.');
  const groups = projection.fieldGroups(body.include);
  return {intentId: body.intentId.toLowerCase(), coachCode: body.coachCode, days, alias: body.alias, groups,
    snapshot: body.snapshot, steps: body.nextSteps};
}

/**
 * @description The coach's card request: publish a code, or replace it with a new one.
 * @param {unknown} body - Untrusted body.
 * @returns {'publish'|'new-code'} The action.
 */
function cardRequest(body) {
  projection.closed(body, ['action'], [], 'Coach code');
  if (!['publish', 'new-code'].includes(body.action)) projection.refuse('invalid_action', 'Choose publish or new-code.');
  return body.action;
}

/**
 * @description The live consent this seeker already has with this coach, if any (renewal keeps its link).
 * @param {object[]} links - The seeker's own links.
 * @param {string} coachPersonId - The resolved coach.
 * @param {number} now - Server time in milliseconds.
 * @returns {object|null} The active, unexpired link to that coach.
 */
function liveLinkTo(links, coachPersonId, now) {
  return links.find((link) => link.coach_person_id === coachPersonId && link.state === 'active'
    && now < Date.parse(link.expires_at)) || null;
}

/**
 * @description The preview row: what the seeker saw, who receives it and which revision it expects.
 * @param {object} caller - verifiedCaller() of the seeker.
 * @param {object} coach - The coach code row the exact code resolved to.
 * @param {object|null} link - liveLinkTo() result.
 * @param {object} request - previewRequest() result.
 * @param {number} now - Server time in milliseconds.
 * @returns {object} Row for cc_previews.
 */
function buildPreview(caller, coach, link, request, now) {
  if (coach.coach_person_id === caller.personId) projection.refuse('self_share', 'You can’t share with yourself.');
  if (coach.tenant_id !== caller.tenant) deny('coach_not_found', 'No coach in your organization has that code.', 404);
  const snapshot = projection.snapshotFor(request.snapshot, request.groups, now);
  const payload = projection.payloadFor({alias: request.alias, groups: request.groups, snapshot, steps: request.steps});
  const at = new Date(now).toISOString();
  return {preview_id: request.intentId, link_id: link ? link.link_id : crypto.randomUUID(),
    expected_revision: link ? Number(link.revision) : 0, seeker_person_id: caller.personId, seeker_issuer: caller.issuer,
    seeker_subject: caller.subject, coach_person_id: coach.coach_person_id, coach_issuer: coach.coach_issuer,
    coach_subject: coach.coach_subject, coach_name: coach.display_name || null, coach_email: coach.email || null,
    tenant_id: caller.tenant, scope: projection.SCHEMA, field_groups: request.groups.join(','), alias: payload.alias,
    days: request.days, payload: JSON.stringify(payload), payload_digest: projection.digest(payload),
    source_as_of: snapshot.sourceAsOf, state: 'pending', ticket_id: null, created_at: at,
    expires_at: new Date(now + PREVIEW_TTL_MS).toISOString(), updated_at: at};
}

/**
 * @description A retried preview (same intent id) must bind exactly what the first one bound.
 * @param {object} stored - Existing preview row.
 * @param {object} fresh - buildPreview() of the retry.
 * @returns {boolean} True when the binding is the same.
 */
function samePreview(stored, fresh) {
  const keys = ['seeker_person_id', 'coach_person_id', 'coach_issuer', 'coach_subject', 'tenant_id', 'scope', 'field_groups',
    'alias', 'days', 'payload_digest'];
  return keys.every((key) => String(stored[key]) === String(fresh[key]));
}

/**
 * @description Whether a stored row belongs to the caller as seeker (native id, issuer, subject and tenant).
 * @param {object} caller - verifiedCaller().
 * @param {object|null} row - Preview or link row.
 * @returns {boolean} True for the caller's own row.
 */
function seekerOwns(caller, row) {
  return Boolean(row && row.seeker_person_id === caller.personId && row.seeker_issuer === caller.issuer
    && row.seeker_subject === caller.subject && row.tenant_id === caller.tenant);
}

/**
 * @description Decide what activation does with a preview, its link and the seeker's decision.
 * @param {object} preview - The caller's own preview row.
 * @param {object|null} link - The link row the preview names, if it exists.
 * @param {{state: string, ticket: object|null}} decision - approval.decisionFor() result.
 * @param {number} now - Server time in milliseconds.
 * @returns {'already'|'cancelled'|'cancel'|'activate'} What to do.
 */
function activationStep(preview, link, decision, now) {
  if (preview.state === 'used') {
    // A lost answer is retried with the same intent id and gets the same activation back; once the consent moved on
    // (revoked, renewed), the old approval is a replay and grants nothing.
    if (link && link.approval_preview_id === preview.preview_id && link.state === 'active'
      && Number(link.revision) === Number(preview.expected_revision) + 1) return 'already';
    deny('approval_replayed', 'This approval was already used. Share again to make a new one.', 409);
  }
  if (preview.state === 'cancelled') return 'cancelled';
  if (decision.state === 'cancelled') return 'cancel';
  if (now >= Date.parse(preview.expires_at)) deny('preview_expired', 'This preview expired after 10 minutes. Review it again.', 410);
  if (decision.state === 'waiting') deny('approval_waiting', 'Confirm the share first.', 409);
  if (decision.state !== 'approved') deny('approval_unverified', 'Your approval could not be verified, so nothing was shared.', 409);
  const current = link ? Number(link.revision) : 0;
  if (current !== Number(preview.expected_revision)) deny('stale_preview', 'Sharing changed since this preview. Review it again.', 409);
  if (link && (link.coach_person_id !== preview.coach_person_id || link.seeker_person_id !== preview.seeker_person_id)) {
    deny('stale_preview', 'Sharing changed since this preview. Review it again.', 409);
  }
  return 'activate';
}

/**
 * @description Another live consent from this seeker to the same coach. One seeker and one coach share through one
 * consent: a preview made beside it expected no link and is stale once that link exists.
 * @param {object[]} links - The seeker's own links.
 * @param {object} preview - The preview being activated.
 * @param {number} now - Server time in milliseconds.
 * @returns {boolean} True when activation must be refused as stale.
 */
function competingLink(links, preview, now) {
  return links.some((link) => link.link_id !== preview.link_id && link.coach_person_id === preview.coach_person_id
    && link.state === 'active' && now < Date.parse(link.expires_at));
}

/**
 * @description The consent and snapshot rows one activation writes together.
 * @param {object} preview - The approved preview.
 * @param {object|null} link - Existing link (renewal) or null (first share).
 * @param {object} ticket - The exact approved ticket.
 * @param {number} now - Server time in milliseconds.
 * @returns {{link: object, snapshot: object, insert: boolean}} Rows to write.
 */
function activationRows(preview, link, ticket, now) {
  const at = new Date(now).toISOString(), expires = new Date(now + Number(preview.days) * DAY_MS).toISOString();
  const row = {link_id: preview.link_id, seeker_person_id: preview.seeker_person_id, seeker_issuer: preview.seeker_issuer,
    seeker_subject: preview.seeker_subject, coach_person_id: preview.coach_person_id, coach_issuer: preview.coach_issuer,
    coach_subject: preview.coach_subject, coach_name: preview.coach_name, coach_email: preview.coach_email,
    tenant_id: preview.tenant_id, app: APP, scope: preview.scope, field_groups: preview.field_groups, alias: preview.alias,
    state: 'active', revision: (link ? Number(link.revision) : 0) + 1, approval_ticket_id: String(ticket.ticketId || ticket.id),
    approval_preview_id: preview.preview_id, approval_receipt: JSON.stringify(ticket.applicationDecision), approved_at: at,
    expires_at: expires, revoked_at: null, created_at: link ? link.created_at : at, updated_at: at};
  const snapshot = {link_id: preview.link_id, revision: row.revision, seeker_person_id: preview.seeker_person_id,
    coach_person_id: preview.coach_person_id, payload: preview.payload, payload_digest: preview.payload_digest,
    source_as_of: preview.source_as_of, published_at: at, expires_at: expires};
  return {link: row, snapshot, insert: !link};
}

/**
 * @description Whether this coach may read this link now. Every refusal reads as "not shared with you".
 * @param {object} caller - verifiedCaller() of the coach.
 * @param {object|null} link - Link row the store returned.
 * @param {object|null} drop - The coach's own stop-viewing record for it.
 * @param {number} now - Server time in milliseconds.
 * @returns {{ok: boolean, code: string}} ok, or the reason it is refused.
 */
function coachReadCheck(caller, link, drop, now) {
  if (!link) return {ok: false, code: 'not_shared'};
  if (link.coach_person_id !== caller.personId || link.coach_issuer !== caller.issuer
    || link.coach_subject !== caller.subject || link.tenant_id !== caller.tenant) return {ok: false, code: 'not_shared'};
  if (link.app !== APP || link.scope !== projection.SCHEMA) return {ok: false, code: 'not_shared'};
  if (link.state !== 'active') return {ok: false, code: 'ended'};
  const deadline = Date.parse(link.expires_at);
  if (!Number.isFinite(deadline) || now >= deadline) return {ok: false, code: 'expired'};
  if (drop) return {ok: false, code: 'stopped'};
  return {ok: true, code: 'ok'};
}

/**
 * @description How the seeker's own list describes one link.
 * @param {object} link - The seeker's link row.
 * @param {object|null} drop - The coach's stop-viewing record, if any.
 * @param {number} now - Server time in milliseconds.
 * @returns {object} Display row (no ids of the coach's account).
 */
function seekerView(link, drop, now) {
  const state = link.state === 'revoked' ? 'ended' : drop ? 'stopped'
    : link.state === 'active' && now >= Date.parse(link.expires_at) ? 'expired' : link.state === 'active' ? 'shared' : 'ended';
  return {linkId: link.link_id, coachName: link.coach_name || 'Your coach', coachEmail: link.coach_email || null,
    alias: link.alias, fieldGroups: String(link.field_groups).split(','), state, sharedAt: link.approved_at,
    expiresAt: link.expires_at, endedAt: link.revoked_at || (drop ? drop.dropped_at : null), revision: Number(link.revision)};
}

module.exports = {APP, PREVIEW_TTL_MS, DAY_MS, DEFAULT_DAYS, MAX_DAYS, ALLOWED_DAYS, deny, emptyBody, previewRequest,
  cardRequest, liveLinkTo, buildPreview, samePreview, seekerOwns, activationStep, competingLink, activationRows, coachReadCheck, seekerView};
