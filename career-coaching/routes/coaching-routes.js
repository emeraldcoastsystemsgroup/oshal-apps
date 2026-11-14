/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Career Coaching routes (0.1.0). A coach publishes a code from their own view; a job seeker previews a summary snapshot for the exact coach that code names, confirms it through the kernel's own human gate, and stops sharing in one action; the coach reads shared snapshots as themself. Every caller comes from the kernel's verified principal; the seeker of a snapshot comes only from its consent row. GET routes write nothing. Coach reads are refused before any row is read while this installation cannot confirm the other person's account is still active (lib/participant-status.js).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: coach reads open. GET /shared-with-me first proves this installation can confirm people (lib/participant-status.js ready(), the kernel's `person.status` read asked about the caller) and still answers 503 before any coaching row is read when it cannot; then each consent's seeker is confirmed with the kernel, and a snapshot whose seeker is suspended, deactivated or gone is left out while the coach's other clients show. GET /shares tells the seeker whether coaches can open shares here from the same proof.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Router} = require('express');
const identity = require('../lib/identity');
const projection = require('../lib/projection');
const consent = require('../lib/consent');
const approval = require('../lib/approval');
const participants = require('../lib/participant-status');
const {createSqlRepository} = require('./coaching-store');
const {createLogger} = require('../lib/log');

const logger = createLogger('career-coaching-routes');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATIC = Object.freeze({'coaching.js': 'application/javascript', 'coaching-page.js': 'application/javascript',
  'coaching.css': 'text/css'});
const TOOLS = path.join(__dirname, '..', 'tools');

/**
 * @description An error the route answers with its own status and words.
 * @param {number} status - HTTP status.
 * @param {string} code - Machine-readable refusal.
 * @param {string} message - Words the page shows.
 * @returns {Error} The error to throw.
 */
function problem(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * @description Answer an error: a refusal with its status and words, anything else as 500 after logging it.
 * @param {object} res - Bridge response (status/json only).
 * @param {Error} error - What went wrong.
 * @param {string} route - Route name for the log.
 * @returns {void}
 */
function answerError(res, error, route) {
  const status = Number(error && error.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    if (status >= 500) logger.error({err: error, route, code: error.code}, 'career coaching request refused');
    res.status(status).json({error: error.code || 'refused', message: error.message});
    return;
  }
  logger.error({err: error, route}, 'career coaching request failed');
  res.status(500).json({error: 'coaching_failed', message: 'Something went wrong. Nothing was shared or changed.'});
}

/**
 * @description Register the three catalog resources. Ownership is proved by the consent rows and the installed policy;
 * the adapters admit an active verified actor, and the summary adapter only with exactly the summary-v1 field set.
 * @param {object} ctx - Package context.
 * @returns {void}
 */
function registerResources(ctx) {
  if (!ctx || !ctx.authorization || typeof ctx.authorization.registerResource !== 'function') return;
  const active = async ({actor}) => Boolean(actor && actor.isActive === true);
  ctx.authorization.registerResource('coaching-share', {authorize: active});
  ctx.authorization.registerResource('coaching-card', {authorize: active});
  ctx.authorization.registerResource('coaching-summary', {authorize: async ({actor, grant, fields}) => Boolean(
    actor && actor.isActive === true && grant && grant.fields === 'summary-v1' && Array.isArray(fields)
    && fields.length === projection.SUMMARY_FIELDS.length && projection.SUMMARY_FIELDS.every((field) => fields.includes(field)))});
}

/**
 * @description The route's dependencies: the SQL store, the ticket port, the participant-status reader and a clock.
 * @param {object} ctx - Package context.
 * @param {object} options - Test or kernel overrides.
 * @returns {object} Dependencies.
 */
function dependencies(ctx, options) {
  return {ctx, repo: options.repo || createSqlRepository(ctx && ctx.pool), tickets: options.tickets || (ctx && ctx.ticketService),
    status: options.participantStatus || participants.kernelParticipantStatus(ctx), now: options.now || Date.now};
}

/**
 * @description The verified caller, or a refusal; only an active person takes part.
 * @param {object} deps - Route dependencies.
 * @param {object} req - Admitted request.
 * @returns {object} verifiedCaller().
 */
function callerOf(deps, req) {
  const caller = identity.verifiedCaller(deps.ctx, req);
  if (!caller) throw problem(401, 'person_required', 'Sign in as yourself to use coaching.');
  if (!deps.repo) throw problem(503, 'store_unavailable', 'Coaching storage is unavailable.');
  return caller;
}

/**
 * @description The caller's own person row; a row left by an earlier account with the same issuer and subject is
 * reported as stale and never treated as theirs.
 * @param {object} repo - Store.
 * @param {object} caller - verifiedCaller().
 * @returns {Promise<{row: object|null, stale: object|null}>} Current and stale rows.
 */
async function personOf(repo, caller) {
  const row = await repo.person(caller.issuer, caller.subject);
  if (!row) return {row: null, stale: null};
  if (row.person_id !== caller.personId || row.tenant_id !== caller.tenant) return {row: null, stale: row};
  return {row, stale: null};
}

/**
 * @description The caller's person row, created on a write. An earlier account's row is removed first (with its code),
 * so a newly enrolled account starts with nothing and inherits no link.
 * @param {object} tx - Store bound to a transaction.
 * @param {object} caller - verifiedCaller().
 * @param {string} at - ISO time.
 * @returns {Promise<object>} The current person row.
 */
async function ensurePerson(tx, caller, at) {
  const {row, stale} = await personOf(tx, caller);
  if (row) return row;
  if (stale) {
    await tx.deleteCodesFor(stale.person_id);
    await tx.deletePerson(stale.person_id);
  }
  const fresh = {person_id: caller.personId, issuer: caller.issuer, subject: caller.subject, tenant_id: caller.tenant,
    display_name: caller.name, email: caller.email, coach_code: null, created_at: at, updated_at: at};
  await tx.insertPerson(fresh);
  return fresh;
}

/**
 * @description Wrap an async handler so every failure is answered and logged.
 * @param {string} name - Route name.
 * @param {Function} work - (req, res) => Promise.
 * @returns {Function} Express handler.
 */
function handle(name, work) {
  return (req, res) => {
    Promise.resolve().then(() => work(req, res)).catch((error) => answerError(res, error, name));
  };
}

/**
 * @description GET /card: the coach's own code, if published. Writes nothing.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function getCard(deps) {
  return handle('card-read', async (req, res) => {
    const caller = callerOf(deps, req);
    const {row} = await personOf(deps.repo, caller);
    const code = row && row.coach_code ? row.coach_code : null;
    const published = Boolean(code && await deps.repo.codeByHash(identity.codeHash(identity.normalizeCode(code))));
    res.status(200).json({code: published ? code : null, published, name: caller.name, email: caller.email});
  });
}

/**
 * @description POST /card {action}: publish a code (kept if one is already published) or replace it with a new one.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postCard(deps) {
  return handle('card-change', async (req, res) => {
    const caller = callerOf(deps, req), action = consent.cardRequest(req.body), at = new Date(deps.now()).toISOString();
    const code = await deps.repo.transaction(async (tx) => {
      const person = await ensurePerson(tx, caller, at);
      const kept = person.coach_code && await tx.codeByHash(identity.codeHash(identity.normalizeCode(person.coach_code)));
      if (action === 'publish' && kept) return person.coach_code;
      await tx.deleteCodesFor(person.person_id);
      const fresh = identity.newCode();
      await tx.insertCode({code_hash: identity.codeHash(identity.normalizeCode(fresh)), coach_person_id: person.person_id,
        coach_issuer: caller.issuer, coach_subject: caller.subject, tenant_id: caller.tenant, display_name: caller.name,
        email: caller.email, created_at: at});
      await tx.setCoachCode(person.person_id, fresh, caller.name, caller.email, at);
      return fresh;
    });
    logger.info({route: 'card-change', action}, 'coach code published');
    res.status(200).json({code, published: true, name: caller.name, email: caller.email});
  });
}

/**
 * @description DELETE /card: turn the code off. Shares already made continue until they end; nobody new can use it.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function deleteCard(deps) {
  return handle('card-off', async (req, res) => {
    const caller = callerOf(deps, req), at = new Date(deps.now()).toISOString();
    consent.emptyBody(req.body);
    await deps.repo.transaction(async (tx) => {
      const {row} = await personOf(tx, caller);
      if (!row) return;
      await tx.deleteCodesFor(row.person_id);
      await tx.setCoachCode(row.person_id, null, row.display_name, row.email, at);
    });
    res.status(200).json({code: null, published: false, name: caller.name, email: caller.email});
  });
}

/**
 * @description The seeker's own links with their display state, newest first.
 * @param {object} repo - Store (or transaction).
 * @param {object} caller - verifiedCaller().
 * @param {number} now - Server time.
 * @returns {Promise<object[]>} seekerView rows.
 */
async function sharesOf(repo, caller, now) {
  const links = (await repo.linksForSeeker(caller.personId)).filter((link) => consent.seekerOwns(caller, link));
  const views = [];
  for (const link of links) views.push(consent.seekerView(link, await repo.drop(link.link_id), now));
  return views.sort((a, b) => String(b.sharedAt || '').localeCompare(String(a.sharedAt || '')));
}

/**
 * @description Delete the snapshot of every own link a coach can no longer read (expired, stopped or ended).
 * Read denial never depends on this: the coach read refuses at the deadline whether or not cleanup ran.
 * @param {object} tx - Store bound to a transaction.
 * @param {object} caller - verifiedCaller().
 * @param {number} now - Server time.
 * @returns {Promise<number>} Snapshots removed.
 */
async function tidy(tx, caller, now) {
  let removed = 0;
  for (const view of await sharesOf(tx, caller, now)) {
    if (view.state !== 'shared') removed += await tx.deleteSnapshot(view.linkId);
  }
  return removed;
}

/**
 * @description GET /shares: the seeker's shares and whether coaches can open them on this installation. Writes nothing.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function getShares(deps) {
  return handle('shares-read', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now();
    const {row} = await personOf(deps.repo, caller);
    const shares = row ? await sharesOf(deps.repo, caller, now) : [];
    const coachViewing = await participants.ready(deps.status, caller) ? 'available' : 'unavailable';
    res.status(200).json({shares, coachViewing, days: consent.ALLOWED_DAYS, defaultDays: consent.DEFAULT_DAYS, name: caller.name});
  });
}

/**
 * @description What the seeker's confirmation shows: the resolved coach, the exact payload and the deadlines.
 * @param {object} row - Preview row.
 * @returns {object} Preview for the page.
 */
function previewView(row) {
  return {previewId: row.preview_id, coach: {name: row.coach_name || 'Your coach', email: row.coach_email || null},
    sameOrganization: true, renewal: Number(row.expected_revision) > 0, fieldGroups: String(row.field_groups).split(','),
    alias: row.alias, days: Number(row.days), state: row.state, ticketId: row.ticket_id || null,
    previewExpiresAt: row.expires_at, payload: JSON.parse(row.payload), payloadDigest: row.payload_digest};
}

/**
 * @description POST /previews: resolve the exact coach code, validate the snapshot and store a ten-minute preview.
 * Retrying with the same intent id returns the same preview; a different binding under that id is refused.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postPreview(deps) {
  return handle('preview', async (req, res) => {
    const caller = callerOf(deps, req), request = consent.previewRequest(req.body), now = deps.now();
    const at = new Date(now).toISOString(), code = identity.normalizeCode(request.coachCode);
    if (!code) throw problem(400, 'invalid_code', 'That isn’t a coach code. Codes look like K7QM-4XPD-9TRA.');
    const row = await deps.repo.transaction(async (tx) => {
      await ensurePerson(tx, caller, at);
      await tidy(tx, caller, now);
      const coach = await tx.codeByHash(identity.codeHash(code));
      if (!coach) throw problem(404, 'coach_not_found', 'No coach in your organization has that code.');
      const links = (await tx.linksForSeeker(caller.personId)).filter((link) => consent.seekerOwns(caller, link));
      const fresh = consent.buildPreview(caller, coach, consent.liveLinkTo(links, coach.coach_person_id, now), request, now);
      const stored = await tx.preview(request.intentId);
      if (stored) {
        if (!consent.seekerOwns(caller, stored) || !consent.samePreview(stored, fresh)) {
          throw problem(409, 'intent_conflict', 'This share changed. Review it again.');
        }
        return stored;
      }
      await tx.insertPreview(fresh);
      return fresh;
    });
    res.status(200).json({preview: previewView(row)});
  });
}

/**
 * @description The caller's own live preview by id, or a refusal that says nothing about anyone else's.
 * @param {object} repo - Store.
 * @param {object} caller - verifiedCaller().
 * @param {string} id - Path parameter.
 * @returns {Promise<object>} Preview row.
 */
async function ownPreview(repo, caller, id) {
  if (!ID.test(String(id || ''))) throw problem(404, 'not_found', 'That share was not found.');
  const row = await repo.preview(String(id).toLowerCase());
  if (!consent.seekerOwns(caller, row)) throw problem(404, 'not_found', 'That share was not found.');
  return row;
}

/**
 * @description POST /previews/:previewId/prepare: open (or recover) the seeker's own approval ticket and stop it at
 * its human gate. Nothing is shared here.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postPrepare(deps) {
  return handle('prepare', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now(), at = new Date(now).toISOString();
    consent.emptyBody(req.body);
    const preview = await ownPreview(deps.repo, caller, req.params.previewId);
    if (preview.state !== 'pending') throw problem(409, 'preview_closed', 'This preview was already used or cancelled.');
    if (now >= Date.parse(preview.expires_at)) throw problem(410, 'preview_expired', 'This preview expired after 10 minutes. Review it again.');
    const ticket = await approval.prepareTicket(deps.tickets, caller.subject, preview,
      (ticketId) => deps.repo.setPreview(preview.preview_id, 'pending', ticketId, at));
    res.status(200).json({ticketId: String(ticket.ticketId || ticket.id), status: ticket.status});
  });
}

/**
 * @description Activate inside one transaction: re-read the preview and link, re-decide, then write the consent, the
 * snapshot and the used preview together, or nothing.
 * @param {object} deps - Route dependencies.
 * @param {object} caller - verifiedCaller().
 * @param {object} preview - Preview row read before the transaction.
 * @param {object} decision - approval.decisionFor() result.
 * @param {number} now - Server time.
 * @returns {Promise<object>} The activated link row.
 */
async function activate(deps, caller, preview, decision, now) {
  const at = new Date(now).toISOString();
  return deps.repo.transaction(async (tx) => {
    const current = await tx.preview(preview.preview_id), link = await tx.link(preview.link_id);
    if (!consent.seekerOwns(caller, current) || (link && !consent.seekerOwns(caller, link))) throw problem(404, 'not_found', 'That share was not found.');
    const step = consent.activationStep(current, link, decision, now);
    if (step !== 'activate') return link;
    const own = (await tx.linksForSeeker(caller.personId)).filter((row) => consent.seekerOwns(caller, row));
    if (consent.competingLink(own, current, now)) throw problem(409, 'stale_preview', 'Sharing changed since this preview. Review it again.');
    const rows = consent.activationRows(current, link, decision.ticket, now);
    if (rows.insert) await tx.insertLink(rows.link);
    else if (await tx.updateLink(rows.link, Number(link.revision)) !== 1) throw problem(409, 'stale_preview', 'Sharing changed since this preview. Review it again.');
    await tx.deleteSnapshot(rows.link.link_id);
    await tx.insertSnapshot(rows.snapshot);
    await tx.setPreview(current.preview_id, 'used', current.ticket_id, at);
    return rows.link;
  });
}

/**
 * @description POST /previews/:previewId/activate: share only on the seeker's own approved decision for this exact
 * preview. A cancelled decision shares nothing; a retry after a lost answer returns the same share.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postActivate(deps) {
  return handle('activate', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now(), at = new Date(now).toISOString();
    consent.emptyBody(req.body);
    const preview = await ownPreview(deps.repo, caller, req.params.previewId);
    if (!deps.tickets || typeof deps.tickets.getTicket !== 'function') throw problem(503, 'approval_unavailable', 'Approval is unavailable, so nothing was shared.');
    const decision = await approval.decisionFor(deps.tickets, preview);
    const link = await deps.repo.link(preview.link_id);
    const step = consent.activationStep(preview, link, decision, now);
    if (step === 'cancelled' || step === 'cancel') {
      if (step === 'cancel') await deps.repo.setPreview(preview.preview_id, 'cancelled', preview.ticket_id, at);
      res.status(200).json({cancelled: true, message: 'Nothing was shared.'});
      return;
    }
    const row = step === 'already' ? link : await activate(deps, caller, preview, decision, now);
    logger.info({route: 'activate', linkId: row.link_id, revision: row.revision}, 'coaching share active');
    res.status(200).json({share: consent.seekerView(row, null, now)});
  });
}

/**
 * @description POST /shares/:linkId/revoke: stop sharing now, in one action. The consent is marked ended, its revision
 * rises and the snapshot is deleted in the same transaction.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postRevoke(deps) {
  return handle('revoke', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now(), at = new Date(now).toISOString();
    consent.emptyBody(req.body);
    if (!ID.test(String(req.params.linkId || ''))) throw problem(404, 'not_found', 'That share was not found.');
    const row = await deps.repo.transaction(async (tx) => {
      const link = await tx.link(String(req.params.linkId).toLowerCase());
      if (!consent.seekerOwns(caller, link)) throw problem(404, 'not_found', 'That share was not found.');
      if (link.state !== 'revoked') {
        if (await tx.revokeLink(link.link_id, Number(link.revision), at) !== 1) throw problem(409, 'changed', 'This share changed. Try again.');
      }
      await tx.deleteSnapshot(link.link_id);
      await tidy(tx, caller, now);
      return tx.link(link.link_id);
    });
    logger.info({route: 'revoke', linkId: row.link_id, revision: row.revision}, 'coaching share stopped');
    res.status(200).json({share: consent.seekerView(row, null, now)});
  });
}

/**
 * @description The coach's readable snapshots: exact relationship, deadline, no stop record, a current seeker and a
 * snapshot at the link's revision. The seeker comes from each consent row alone.
 * @param {object} deps - Route dependencies.
 * @param {object} caller - verifiedCaller() of the coach.
 * @param {number} now - Server time.
 * @returns {Promise<object[]>} Coach views.
 */
async function clientsOf(deps, caller, now) {
  const views = [];
  for (const link of await deps.repo.linksForCoach(caller.personId)) {
    if (!consent.coachReadCheck(caller, link, await deps.repo.drop(link.link_id), now).ok) continue;
    const seeker = {personId: link.seeker_person_id, issuer: link.seeker_issuer, subject: link.seeker_subject, tenant: link.tenant_id};
    const current = await participants.confirmActive(deps.status, [seeker]);
    if (!current.ok && current.code === 'participant_status_unavailable') throw problem(503, current.code, current.message);
    if (!current.ok) continue;
    const snapshot = await deps.repo.snapshot(link.link_id);
    if (!snapshot || snapshot.link_id !== link.link_id || Number(snapshot.revision) !== Number(link.revision)
      || snapshot.coach_person_id !== caller.personId || now >= Date.parse(snapshot.expires_at)) continue;
    views.push({linkId: link.link_id, ...projection.coachView(link, snapshot)});
  }
  return views.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/**
 * @description GET /shared-with-me: the snapshots shared with this coach by people whose accounts the kernel confirms
 * are still active. Refused, before any coaching row is read, on an installation that cannot confirm people. Writes nothing.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function getSharedWithMe(deps) {
  return handle('shared-read', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now();
    if (!await participants.ready(deps.status, caller)) {
      const closedReader = participants.UNAVAILABLE;
      res.status(503).json({error: closedReader.code, message: closedReader.message, clients: []});
      return;
    }
    const {row} = await personOf(deps.repo, caller);
    res.status(200).json({clients: row ? await clientsOf(deps, caller, now) : []});
  });
}

/**
 * @description POST /shared-with-me/:linkId/stop: the coach stops viewing one share. It writes only the coach's own
 * record; the seeker's consent and snapshot are untouched by the coach.
 * @param {object} deps - Route dependencies.
 * @returns {Function} Handler.
 */
function postStop(deps) {
  return handle('stop', async (req, res) => {
    const caller = callerOf(deps, req), now = deps.now(), at = new Date(now).toISOString();
    consent.emptyBody(req.body);
    if (!ID.test(String(req.params.linkId || ''))) throw problem(404, 'not_shared', 'That snapshot isn’t shared with you.');
    const linkId = String(req.params.linkId).toLowerCase();
    await deps.repo.transaction(async (tx) => {
      const link = await tx.link(linkId), drop = await tx.drop(linkId);
      const check = consent.coachReadCheck(caller, link, drop, now);
      if (check.code === 'stopped') return;
      if (!check.ok && check.code !== 'expired') throw problem(404, 'not_shared', 'That snapshot isn’t shared with you.');
      await tx.insertDrop({link_id: linkId, coach_person_id: caller.personId, coach_issuer: caller.issuer,
        coach_subject: caller.subject, dropped_at: at});
    });
    res.status(200).json({stopped: true});
  });
}

/**
 * @description GET / and GET /static/:file: the page and its two files, from this package only.
 * @param {Router} router - Router to add to.
 * @returns {void}
 */
function pageRoutes(router) {
  router.get('/', handle('page', async (_req, res) => {
    res.status(200).type('html').send(await fs.promises.readFile(path.join(TOOLS, 'coaching.html'), 'utf8'));
  }));
  router.get('/static/:file', handle('static', async (req, res) => {
    const type = Object.hasOwn(STATIC, req.params.file) ? STATIC[req.params.file] : null;
    if (!type) throw problem(404, 'not_found', 'Not found.');
    res.status(200).type(type).send(await fs.promises.readFile(path.join(TOOLS, req.params.file), 'utf8'));
  }));
}

/**
 * @description Mount Career Coaching at /api/career-coaching.
 * @param {object} ctx - Package context from the kernel bridge (pool, ticketService, authorization).
 * @param {object} [options] - Test overrides: repo, tickets, participantStatus, now.
 * @returns {Router} The router.
 */
function createCareerCoachingRoutes(ctx, options = {}) {
  registerResources(ctx);
  const deps = dependencies(ctx, options), router = Router();
  pageRoutes(router);
  router.get('/card', getCard(deps));
  router.post('/card', postCard(deps));
  router.delete('/card', deleteCard(deps));
  router.get('/shares', getShares(deps));
  router.post('/previews', postPreview(deps));
  router.post('/previews/:previewId/prepare', postPrepare(deps));
  router.post('/previews/:previewId/activate', postActivate(deps));
  router.post('/shares/:linkId/revoke', postRevoke(deps));
  router.get('/shared-with-me', getSharedWithMe(deps));
  router.post('/shared-with-me/:linkId/stop', postStop(deps));
  return router;
}

module.exports = {createCareerCoachingRoutes};
