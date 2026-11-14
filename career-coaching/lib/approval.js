/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First share approval (0.1.0), on the kernel's original-owner human gate (the rail career-hunter's source decisions use). Each preview gets one seeker-owned career-coaching-share ticket whose first description line is a marker hashed from the preview id, link, expected revision, coach, scope, field groups, payload digest and days, so an approval answers exactly one preview. The ticket has no worker or bot phase: starting it stops at an editor approval gate that only the seeker's own confirmed browser decision releases. A share is granted only by the kernel's owner-verified decision receipt at the ticket's current revision; a cancelled, failed or unknown ticket, a body that says approved, or another person's or another preview's ticket grants nothing. A lost create is recovered by the marker instead of opening a second ticket.
 */
'use strict';
const {digest} = require('./projection');

const APP = 'career-coaching';
const TYPE = 'career-coaching-share';
const WORKFLOW = 'career-coaching:career-coaching-share';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description An approval refusal with an HTTP status the route answers with.
 * @param {string} code - Machine-readable refusal.
 * @param {string} message - Words the page shows.
 * @param {number} [status] - HTTP status (409 by default).
 * @returns {never} Always throws.
 */
function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

/**
 * @description The marker that binds one ticket to one immutable preview.
 * @param {object} preview - Stored preview row.
 * @returns {string} career-coaching-share:v1:<sha256>.
 */
function markerFor(preview) {
  return 'career-coaching-share:v1:' + digest([1, preview.preview_id, preview.link_id, Number(preview.expected_revision),
    preview.coach_person_id, preview.coach_issuer, preview.coach_subject, preview.scope, preview.field_groups,
    preview.payload_digest, Number(preview.days)]);
}

/**
 * @description The ticket's title and description as the Tickets page shows them.
 * @param {object} preview - Stored preview row.
 * @returns {{title: string, description: string}} Bounded words; the description starts with the marker.
 */
function words(preview) {
  const coach = String(preview.coach_name || 'your coach').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  const parts = String(preview.field_groups).split(',');
  const what = ['counts by stage', parts.includes('applications') ? 'your application list' : null,
    parts.includes('next-steps') ? 'your next steps' : null].filter(Boolean).join(', ');
  return {title: `Share your job search summary with ${coach}?`,
    description: markerFor(preview) + '\n' + `Shares ${what} with ${coach} for ${Number(preview.days)} days. `
      + 'Nothing else in Career is shared. You can stop sharing at any time.'};
}

/**
 * @description Whether a ticket is this package's share ticket for exactly this preview.
 * @param {object|null} ticket - Ticket from the kernel's owner-scoped ticket port.
 * @param {object} preview - Stored preview row.
 * @returns {boolean} True only for the exact type, workflow and marker.
 */
function exactTicket(ticket, preview) {
  const id = ticket && (ticket.ticketId || ticket.id);
  return Boolean(id && UUID.test(String(id)) && ticket.ticketType === TYPE && ticket.workflow === WORKFLOW
    && typeof ticket.description === 'string' && ticket.description.split('\n')[0] === markerFor(preview));
}

/**
 * @description The kernel's owner-verified decision receipt, current at the ticket's revision, or null.
 * @param {object} ticket - Exact ticket (exactTicket() passed).
 * @returns {'approve'|'cancel'|null} The decision the seeker made in their own confirmed session.
 */
function verifiedDecision(ticket) {
  const proof = ticket.applicationDecision;
  const keys = ['version', 'app', 'ticketId', 'ticketType', 'workflow', 'revision', 'status', 'outcome', 'ownerVerified'];
  if (!proof || typeof proof !== 'object' || Object.keys(proof).sort().join() !== [...keys].sort().join()) return null;
  const id = ticket.ticketId || ticket.id;
  const good = proof.version === 1 && proof.app === APP && proof.ownerVerified === true && proof.ticketId === id
    && proof.ticketType === TYPE && proof.workflow === WORKFLOW && Number.isSafeInteger(ticket.revision)
    && ticket.revision > 0 && proof.revision === ticket.revision && proof.status === ticket.status
    && proof.outcome === (ticket.status === 'done' ? 'approve' : ticket.status === 'cancelled' ? 'cancel' : null);
  return good ? proof.outcome : null;
}

/**
 * @description The seeker's own ticket for this preview: the saved one, a recovered one found by its marker, or a
 * new one started to its approval gate. Two matches, or an uncertain earlier create, open nothing new.
 * @param {object} tickets - ctx.ticketService (createTicket, startTicket, getTicket, listTickets).
 * @param {string} ownerSub - The caller's verified subject (the kernel refuses any other owner).
 * @param {object} preview - Stored preview row.
 * @param {(ticketId: string) => Promise<void>} remember - Saves the ticket id on the preview.
 * @returns {Promise<object>} The exact ticket.
 */
async function prepareTicket(tickets, ownerSub, preview, remember) {
  if (!tickets || ['createTicket', 'startTicket', 'getTicket', 'listTickets'].some((key) => typeof tickets[key] !== 'function')) {
    fail('approval_unavailable', 'Approval is unavailable on this installation, so nothing was shared.', 503);
  }
  let ticket = preview.ticket_id ? await tickets.getTicket(preview.ticket_id) : await recover(tickets, ownerSub, preview);
  if (preview.ticket_id && !exactTicket(ticket, preview)) fail('approval_mismatch', 'This approval belongs to another share.');
  if (!ticket) {
    const created = await tickets.createTicket({ticketType: TYPE, ownerSub, ...words(preview)});
    const id = created && (created.ticketId || created.id);
    if (!UUID.test(String(id || ''))) fail('approval_uncertain', 'The approval could not be opened. Try again.', 503);
    await remember(String(id));
    ticket = await tickets.getTicket(String(id));
  } else if (!preview.ticket_id) await remember(String(ticket.ticketId || ticket.id));
  if (!exactTicket(ticket, preview)) fail('approval_mismatch', 'This approval belongs to another share.');
  if (ticket.status === 'queued') {
    await tickets.startTicket(String(ticket.ticketId || ticket.id), {executor: 'native', prompt: words(preview).description,
      files: [], limits: {wall_ms: 30_000, output_tokens: 1, artifact_bytes: 1024}});
    ticket = await tickets.getTicket(String(ticket.ticketId || ticket.id));
    if (!exactTicket(ticket, preview)) fail('approval_mismatch', 'This approval belongs to another share.');
  }
  return ticket;
}

/**
 * @description Find an earlier ticket for this preview by its marker (a lost create answer).
 * @param {object} tickets - Ticket port.
 * @param {string} ownerSub - Caller's verified subject.
 * @param {object} preview - Stored preview row.
 * @returns {Promise<object|null>} The one match, or null when there is none.
 */
async function recover(tickets, ownerSub, preview) {
  const rows = await tickets.listTickets({ticketType: TYPE, ownerSub, limit: 200});
  if (!Array.isArray(rows) || rows.length >= 200) fail('approval_uncertain', 'Earlier approvals could not all be read; nothing new was opened.', 503);
  const found = rows.filter((row) => exactTicket(row, preview));
  if (found.length > 1) fail('approval_uncertain', 'More than one approval matches this share; nothing was shared.', 409);
  return found[0] || null;
}

/**
 * @description What the seeker decided on this preview's exact ticket, from the kernel alone.
 * @param {object} tickets - Ticket port.
 * @param {object} preview - Stored preview row with ticket_id.
 * @returns {Promise<{state: string, ticket: object|null, outcome: string|null}>} approved, cancelled, waiting or unverified.
 */
async function decisionFor(tickets, preview) {
  if (!preview.ticket_id) return {state: 'waiting', ticket: null, outcome: null};
  const ticket = await tickets.getTicket(preview.ticket_id);
  if (!exactTicket(ticket, preview)) return {state: 'unverified', ticket: null, outcome: null};
  if (ticket.status === 'awaiting_approval' || ticket.status === 'queued') return {state: 'waiting', ticket, outcome: null};
  const outcome = verifiedDecision(ticket);
  if (outcome === 'approve') return {state: 'approved', ticket, outcome};
  if (outcome === 'cancel') return {state: 'cancelled', ticket, outcome};
  return {state: 'unverified', ticket, outcome: null};
}

module.exports = {APP, TYPE, WORKFLOW, fail, markerFor, words, exactTicket, verifiedDecision, prepareTicket, decisionFor};
