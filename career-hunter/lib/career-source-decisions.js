/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
  * 1 | maintainer@emeraldcoastsystemsgroup.com | Correlate each owner's source decision with one native human-gated ticket and recover uncertain creates without duplication or direct corpus writes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require the native original-owner decision receipt at the exact terminal revision before any source handoff.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const requests = require('./career-source-requests');
const FILE = 'career-source-decisions.json';
const TYPE = 'career-source-decision';
const WORKFLOW = 'career-hunter:career-source-decision';
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 1000;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const STATES = new Set(['intent','creating','create_uncertain','created','start_uncertain','awaiting_approval',
  'answered','queue_uncertain','queued_next_pull','applied','stale','attention']);
const KEYS = ['actionId','companyId','openedAt','marker','ticketId','lastNativeStatus','state','requestId','queuedOutcome','lastError','updatedAt'];
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const validAction = action => Number.isSafeInteger(action?.id) && action.id > 0
  && Number.isSafeInteger(action.companyId) && action.companyId > 0 && typeof action.openedAt === 'string'
  && action.openedAt.length <= 80 && Number.isFinite(Date.parse(action.openedAt));
const keyFor = (owner, action) => digest([1, owner, action.companyId, action.id, action.openedAt]);
const markerFor = (owner, action) => 'career-source-decision:v1:' + keyFor(owner, action);

function validItem(key, item) {
  return HASH.test(key) && closed(item, KEYS) && validAction({id:item.actionId, ...item})
    && item.marker === 'career-source-decision:v1:' + key && STATES.has(item.state)
    && (item.ticketId === null || UUID.test(item.ticketId)) && (item.requestId === null || UUID.test(item.requestId))
    && (item.queuedOutcome === null || ['archive','keep'].includes(item.queuedOutcome))
    && typeof item.lastNativeStatus === 'string' && item.lastNativeStatus.length <= 40
    && typeof item.lastError === 'string' && item.lastError.length <= 500
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt));
}

/** @description Read only a bounded regular owner file without following links or blocking on a FIFO.
 * @param {string} dir Owner's exclusively locked request directory. @returns {object} Valid journal. */
function read(dir) {
  let fd;
  try { fd = fs.openSync(path.join(dir, FILE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return {version:1, items:{}}; throw error; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) fail('decision_journal_unavailable', 'Source decision records are unavailable.');
    const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!closed(data, ['version','items']) || data.version !== 1 || !closed(data.items, Object.keys(data.items || {}))
      || Object.keys(data.items).length > MAX_ITEMS || Object.entries(data.items).some(([key,item]) => !validItem(key,item)))
      fail('decision_journal_invalid', 'Source decision records need repair.');
    return data;
  } finally { fs.closeSync(fd); }
}

function write(dir, data) {
  const bytes = JSON.stringify(data) + '\n';
  if (Buffer.byteLength(bytes) > MAX_BYTES || Object.keys(data.items).length > MAX_ITEMS)
    fail('decision_journal_full', 'Source decision history is full.');
  const file = path.join(dir, FILE), temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, {mode:0o600, flag:'wx'});
    const fd = fs.openSync(temp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

function save(options, data, key, patch) {
  Object.assign(data.items[key], patch, {updatedAt:new Date().toISOString()});
  write(options.userDir, data);
  return data.items[key];
}

function initial(owner, action) {
  return {actionId:action.id, companyId:action.companyId, openedAt:action.openedAt, marker:markerFor(owner,action),
    ticketId:null, lastNativeStatus:'', state:'intent', requestId:null, queuedOutcome:null, lastError:'', updatedAt:new Date().toISOString()};
}

function words(action, marker) {
  const company = String(action.company || 'this employer').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  const evidence = JSON.stringify(action.evidence || {});
  let detail = evidence;
  while (Buffer.byteLength(detail) > 12_000) detail = detail.slice(0, -100);
  return {title:'Archive the job board of ' + company + '?', description:marker + '\n'
    + 'Archive closes this employer’s open jobs and stops reads. Keep trying leaves it listed.\n'
    + 'Action ' + action.id + ', employer ' + action.companyId + ', opened ' + action.openedAt + '.\nEvidence: ' + detail};
}

function exactTicket(ticket, item) {
  return ticket && UUID.test(ticket.ticketId || ticket.id || '') && ticket.ticketType === TYPE
    && ticket.workflow === WORKFLOW && typeof ticket.title === 'string' && !!ticket.title.trim()
    && typeof ticket.description === 'string' && ticket.description.split('\n')[0] === item.marker;
}

/** Only the native host's exact current owner-verified history receipt authorizes a source outcome. */
function verifiedDecision(ticket, item) {
  const proof = ticket.applicationDecision;
  return closed(proof,['version','app','ticketId','ticketType','workflow','revision','status','outcome','ownerVerified'])
    && proof.version === 1 && proof.app === 'career-hunter' && proof.ownerVerified === true && proof.ticketId === item.ticketId
    && proof.ticketType === TYPE && proof.workflow === WORKFLOW && Number.isSafeInteger(ticket.revision)
    && ticket.revision > 0 && proof.revision === ticket.revision && proof.status === ticket.status
    && proof.outcome === (ticket.status === 'done' ? 'approve' : 'cancel');
}

function port(tickets) {
  return tickets && ['getTicket','listTickets','createTicket','startTicket'].every(key => typeof tickets[key] === 'function');
}

async function correlate(options, data, key, action) {
  const item = data.items[key], tickets = options.tickets;
  if (item.ticketId) {
    const ticket = await tickets.getTicket(item.ticketId);
    if (!exactTicket(ticket, item) || (ticket.ticketId || ticket.id) !== item.ticketId)
      fail('decision_ticket_unavailable', 'The original decision ticket could not be verified.');
    return ticket;
  }
  const rows = await tickets.listTickets({ticketType:TYPE, ownerSub:options.ownerSub, limit:200});
  if (!Array.isArray(rows) || rows.length >= 200 || rows.some(row => !row || row.ticketType !== TYPE
    || typeof row.title !== 'string' || !row.title.trim() || typeof row.description !== 'string'))
    fail('decision_create_uncertain', 'Ticket recovery is incomplete; no additional decision was opened.');
  const found = rows.filter(row => exactTicket(row, item));
  if (found.length > 1) fail('decision_create_uncertain', 'More than one matching ticket needs review.');
  if (found.length === 1) {
    save(options, data, key, {ticketId:found[0].ticketId || found[0].id, state:'created', lastError:''});
    return found[0];
  }
  if (item.state !== 'intent') fail('decision_create_uncertain', 'An earlier create may have succeeded; no duplicate was opened.');
  save(options, data, key, {state:'creating'});
  const created = await tickets.createTicket({ticketType:TYPE, ownerSub:options.ownerSub, ...words(action,item.marker)});
  const id = created?.ticketId || created?.id;
  if (!UUID.test(id || '')) fail('decision_create_uncertain', 'Ticket creation has no verified acknowledgement.');
  save(options, data, key, {ticketId:id, state:'created'});
  const ticket = await tickets.getTicket(id);
  if (!exactTicket(ticket,item) || (ticket.ticketId || ticket.id) !== id)
    fail('decision_ticket_unavailable', 'The saved decision ticket could not be verified.');
  return ticket;
}

async function advance(options, data, key, ticket, action) {
  const item = data.items[key];
  if (ticket.status === 'queued') {
    save(options, data, key, {state:'start_uncertain',lastNativeStatus:'queued'});
    await options.tickets.startTicket(item.ticketId, {executor:'native', prompt:words(action,item.marker).description, files:[], limits:{wall_ms:30_000,output_tokens:1,artifact_bytes:1024}});
    ticket = await options.tickets.getTicket(item.ticketId);
    if (!exactTicket(ticket,item) || (ticket.ticketId || ticket.id) !== item.ticketId)
      fail('decision_ticket_unavailable', 'The started decision ticket could not be verified.');
  }
  if (ticket.status === 'awaiting_approval') return save(options,data,key,{state:'awaiting_approval',lastNativeStatus:ticket.status,lastError:''});
  if (!['done','cancelled'].includes(ticket.status)) {
    return save(options,data,key,{state:'attention',lastNativeStatus:String(ticket.status || '').slice(0,40),
      lastError:'The native ticket has no completed human decision. No source change was queued.'});
  }
  if (!verifiedDecision(ticket,item)) return save(options,data,key,{state:'attention',lastNativeStatus:ticket.status,
    lastError:'The native ticket has no verified decision from its original owner through the application. No source change was queued.'});
  return queueOutcome(options, data, key, action, ticket.status);
}

function recordedOutcome(options, data, key) {
  const item = data.items[key];
  if (!item.requestId || !item.queuedOutcome) return null;
  const result = options.changeState?.(item.requestId);
  if (!result) return null;
  const accepted = item.queuedOutcome === 'archive' ? result.state === 'removed' : result.state === 'kept';
  return save(options,data,key,{state:accepted ? 'applied' : 'attention',
    lastError:accepted ? '' : 'The next pull did not apply this decision (' + String(result.state).slice(0,40) + ').'});
}

async function queueOutcome(options, data, key, action, status) {
  const item = data.items[key], outcome = status === 'done' ? 'archive' : 'keep';
  if (item.queuedOutcome && item.queuedOutcome !== outcome) fail('decision_outcome_changed','The recorded native decision outcome changed. No additional change was queued.');
  const applied = recordedOutcome(options,data,key);
  if (applied) return applied;
  const fresh = await options.currentAction(action);
  if (!validAction(fresh) || fresh.id !== item.actionId || fresh.companyId !== item.companyId || fresh.openedAt !== item.openedAt)
    return save(options,data,key,{state:'stale',lastNativeStatus:status,lastError:'This source decision changed. No change was queued.'});
  save(options,data,key,{state:'queue_uncertain',lastNativeStatus:status,queuedOutcome:outcome});
  const request = requests.saveDecisionChange(options.userDir, options.ownerSub, action, item.ticketId, outcome);
  return save(options,data,key,{state:'queued_next_pull',requestId:request.id,queuedOutcome:outcome,lastError:''});
}

/** @description Reconcile an explicitly admitted administrator's exact action with its same native ticket.
 * @param {object} options Original owner, locked directory, native port and fresh action reader.
 * @param {object} action Server-read current source action. @param {string|null} expectedTicket Exact browser reference if present.
 * @returns {Promise<object>} Truthful public decision state; uncertainty never opens a second ticket. */
async function sync(options, action, expectedTicket = null) {
  if (typeof options.ownerSub !== 'string' || !options.ownerSub || !validAction(action))
    fail('decision_invalid', 'Select a current source decision.');
  const data = read(options.userDir), key = keyFor(options.ownerSub,action);
  if (!data.items[key]) {
    if (expectedTicket) fail('decision_ticket_mismatch', 'That ticket is not this owner’s recorded source decision.');
    data.items[key] = initial(options.ownerSub,action); write(options.userDir,data);
  }
  if (expectedTicket && (!UUID.test(expectedTicket) || data.items[key].ticketId !== expectedTicket))
    fail('decision_ticket_mismatch', 'That ticket does not match the current source decision.');
  try {
    const applied = recordedOutcome(options,data,key);
    if (applied) return publicItem(applied);
    if (!port(options.tickets)) return publicItem(save(options,data,key,{state:data.items[key].state,lastError:'Native decision tickets are unavailable.'}));
    const fresh = await options.currentAction(action);
    if (!validAction(fresh) || keyFor(options.ownerSub,fresh) !== key)
      return publicItem(save(options,data,key,{state:'stale',lastError:'This source decision changed. No change was queued.'}));
    const ticket = await correlate(options,data,key,action);
    return publicItem(await advance(options,data,key,ticket,action));
  } catch (error) {
    const item = data.items[key], state = item.state === 'intent' ? 'intent' : item.state === 'creating' ? 'create_uncertain'
      : item.state === 'start_uncertain' ? 'start_uncertain' : item.state === 'queue_uncertain' ? 'queue_uncertain' : 'attention';
    return publicItem(save(options,data,key,{state,lastError:String(error.message || 'Decision unavailable.').slice(0,500)}));
  }
}

function publicItem(item) {
  return {actionId:item.actionId,companyId:item.companyId,openedAt:item.openedAt,ticketId:item.ticketId,
    state:item.state,nativeStatus:item.lastNativeStatus,requestId:item.requestId,outcome:item.queuedOutcome,error:item.lastError,updatedAt:item.updatedAt};
}

/** @description Read current owner bindings for display without ticket calls or file mutations.
 * @param {string} dir Owner directory. @param {string} owner Original subject. @param {object[]} actions Current actions.
 * @returns {object[]} Public state of this owner's exact current decisions. */
function snapshot(dir, owner, actions) {
  const data = read(dir);
  return actions.filter(validAction).map(action => data.items[keyFor(owner,action)]).filter(Boolean).map(publicItem);
}

module.exports = {sync, snapshot, read, TYPE, WORKFLOW, markerFor};
