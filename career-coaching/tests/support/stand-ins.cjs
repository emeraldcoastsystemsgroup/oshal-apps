/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stand-ins for the Career Coaching suites (0.1.0). memoryRepo is the routes/coaching-store.js interface over in-memory tables that hands back ANY row it is asked for, as a store with no relationship policy would: every refusal these suites see is therefore the package's own check, not storage hiding a row (the installed policy is proved separately on the real kernel interpreter). standInKernel plays the kernel's parts the routes use: the verified principal on the request, the authorization port's current actor, the owner-scoped ticket port (create, start, get, list) and the human gate (a one-use confirmation, then the owner's own approve or cancel, recorded as the kernel's owner-verified decision receipt). The people are made up; no real person, résumé or job is used.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the kernel stand-in keeps the people it has enrolled and answers `ctx.intent('person.status', ...)` as the kernel does (crates/oshald/src/person_status.rs): exactly principal_id, issuer and subject of one person, the one word active only for an enrolled person of the caller's own tenant in good standing with exactly that issuer and subject, inactive for everyone else, and a refusal for a search, an extra field, a caller who is not a person, a package that did not declare person-status.read (`statusRead('undeclared')`) and a kernel without the read (`statusRead('absent')`). mount() hands that intent to the package, so the suites run the package's own participant-status reader.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const crypto = require('node:crypto');

const STORE = path.resolve(__dirname, '..', '..', '..');
const PACKAGE = path.resolve(__dirname, '..', '..');
const ISSUER = 'https://id.example.test';
const TENANT = '7a1f0000-0000-4000-8000-0000000000a1';
const OTHER_TENANT = '7a1f0000-0000-4000-8000-0000000000b2';

/** @description A made-up person. @returns {object} Principal plus display fields. */
function person(subject, name, {tenant = TENANT, kind = 'person', issuer = ISSUER, id} = {}) {
  return {id: id || crypto.randomUUID(), kind, subject, issuer, tenant, state: 'active', name, email: `${subject}@example.test`};
}

/** @description The standard cast: a seeker, their coach, another coach, a coach in another organization, an administrator and a bot. */
function cast() {
  return {sam: person('sam-seeker', 'Sam Rivera'), jordan: person('jordan-coach', 'Jordan Lee'),
    riley: person('riley-coach', 'Riley Chen'), casey: person('casey-coach', 'Casey Moore', {tenant: OTHER_TENANT}),
    avery: person('avery-admin', 'Avery Admin'), bot: person('career-bot', 'Career bot', {kind: 'bot'})};
}

const KEYS = Object.freeze({cc_people: 'person_id', cc_coach_codes: 'code_hash', cc_previews: 'preview_id', cc_links: 'link_id',
  cc_snapshots: 'link_id', cc_link_drops: 'link_id'});
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Row helpers over one set of tables: find, list, insert (a duplicate key throws 23505), remove, update. */
function rowsOf(t) {
  return {
    find: (table, test) => clone(t[table].find(test) || null),
    all: (table, test) => clone(t[table].filter(test)),
    insert(table, row) {
      if (t[table].some((existing) => existing[KEYS[table]] === row[KEYS[table]])
        || (table === 'cc_people' && t[table].some((p) => p.issuer === row.issuer && p.subject === row.subject))
        || (table === 'cc_coach_codes' && t[table].some((c) => c.coach_person_id === row.coach_person_id))) {
        const error = new Error('duplicate key value violates unique constraint'); error.code = '23505'; throw error;
      }
      t[table].push(clone(row)); return 1;
    },
    remove(table, test) { const before = t[table].length; t[table] = t[table].filter((row) => !test(row)); return before - t[table].length; },
    update(table, test, patch) { let n = 0; for (const row of t[table]) if (test(row)) { Object.assign(row, clone(patch)); n += 1; } return n; },
  };
}

/** @description The routes/coaching-store.js methods over one set of tables, each call recorded. */
function memoryApi(t, calls) {
  const {find, all, insert, remove, update} = rowsOf(t);
  const api = {
    person: (issuer, subject) => find('cc_people', (r) => r.issuer === issuer && r.subject === subject),
    insertPerson: (row) => insert('cc_people', row),
    deletePerson: (id) => remove('cc_people', (r) => r.person_id === id),
    setCoachCode: (id, code, name, email, at) => update('cc_people', (r) => r.person_id === id, {coach_code: code, display_name: name, email, updated_at: at}),
    codeByHash: (hash) => find('cc_coach_codes', (r) => r.code_hash === hash),
    insertCode: (row) => insert('cc_coach_codes', row),
    deleteCodesFor: (id) => remove('cc_coach_codes', (r) => r.coach_person_id === id),
    preview: (id) => find('cc_previews', (r) => r.preview_id === id),
    insertPreview: (row) => insert('cc_previews', row),
    setPreview: (id, state, ticketId, at) => update('cc_previews', (r) => r.preview_id === id, {state, ticket_id: ticketId, updated_at: at}),
    link: (id) => find('cc_links', (r) => r.link_id === id),
    linksForSeeker: (id) => all('cc_links', (r) => r.seeker_person_id === id),
    linksForCoach: (id) => all('cc_links', (r) => r.coach_person_id === id),
    insertLink: (row) => insert('cc_links', row),
    updateLink: (row, revision) => update('cc_links', (r) => r.link_id === row.link_id && Number(r.revision) === Number(revision), row),
    revokeLink: (id, revision, at) => update('cc_links', (r) => r.link_id === id && Number(r.revision) === Number(revision),
      {state: 'revoked', revision: revision + 1, revoked_at: at, updated_at: at}),
    snapshot: (id) => find('cc_snapshots', (r) => r.link_id === id),
    insertSnapshot: (row) => insert('cc_snapshots', row),
    deleteSnapshot: (id) => remove('cc_snapshots', (r) => r.link_id === id),
    drop: (id) => find('cc_link_drops', (r) => r.link_id === id),
    insertDrop: (row) => insert('cc_link_drops', row),
  };
  return Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, async (...args) => { calls.push({name, args}); return fn(...args); }]));
}

/** @description In-memory store with the routes/coaching-store.js interface; a transaction commits only when it finishes. @returns {object} Repository. */
function memoryRepo() {
  let tables = {cc_people: [], cc_coach_codes: [], cc_previews: [], cc_links: [], cc_snapshots: [], cc_link_drops: []};
  const calls = [];
  const repo = {...memoryApi(tables, calls), duplicate: (e) => /23505|duplicate/.test(String(e && (e.code + e.message))),
    async transaction(work) {
      const copy = clone(tables); const result = await work(memoryApi(copy, calls));
      tables = copy; Object.assign(repo, memoryApi(tables, calls)); return result;
    }};
  repo.calls = calls;
  repo.tables = () => clone(tables);
  repo.put = (table, row) => { tables[table].push(clone(row)); };
  repo.patch = (table, key, value, patch) => { for (const row of tables[table]) if (row[key] === value) Object.assign(row, patch); };
  return repo;
}

/** @description The kernel parts the routes use, acting for whoever `as()` names. @returns {object} Kernel stand-in. */
function standInKernel() {
  let current = null, statusRead = 'declared';
  const tickets = new Map(), tokens = new Map(), directory = new Map();
  const TYPE = 'career-coaching-share', WORKFLOW = 'career-coaching:career-coaching-share';
  const project = (t) => ({...t, ...(t.decision && t.revision === t.decidedAt ? {applicationDecision: {version: 1, app: 'career-coaching', ticketId: t.id,
    ticketType: TYPE, workflow: WORKFLOW, revision: t.revision, status: t.status, outcome: t.decision, ownerVerified: true, ...(t.receiptOverride || {})}} : {})});
  const own = (id) => { const t = tickets.get(String(id)); return t && current && t.owner === current.id ? t : null; };
  const ticketService = {
    created: 0,
    async createTicket(input) {
      if (!current || input.ownerSub !== current.subject) throw new Error('ticket request does not retain its original owner');
      if (input.ticketType !== TYPE) throw new Error('ticket type is not owned by this application');
      const id = crypto.randomUUID(); ticketService.created += 1;
      tickets.set(id, {id, ticketId: id, owner: current.id, ticketType: TYPE, workflow: WORKFLOW, status: 'queued', revision: 1,
        title: input.title, description: input.description, decision: null});
      return {ticketId: id};
    },
    async startTicket(id) { const t = own(id); if (!t) throw new Error('the owned ticket is unavailable'); if (t.status === 'queued') { t.status = 'awaiting_approval'; t.revision += 1; } return {ok: true}; },
    async getTicket(id) { const t = own(id); return t ? project(t) : null; },
    async listTickets({ticketType} = {}) { return [...tickets.values()].filter((t) => current && t.owner === current.id && (!ticketType || t.ticketType === ticketType)).map(project); },
  };
  const kernel = {
    ticketService, tickets,
    as(who) { current = who; return kernel; },
    current: () => current,
    /** People the kernel has enrolled. Their standing is read from the same record on every question. */
    enrol(...people) { for (const one of people) directory.set(one.id, one); return kernel; },
    forget(who) { directory.delete(who.id); return kernel; },
    /** 'declared' (the read answers), 'undeclared' (the package did not declare it) or 'absent' (a kernel without it). */
    statusRead(mode) { statusRead = mode; return kernel; },
    statusCalls: [],
    /** ctx.intent as the kernel answers it; the only intent this package may send is person.status. */
    async intent(name, input) {
      kernel.statusCalls.push({name, input});
      if (name !== 'person.status' || statusRead === 'absent') throw new Error(`refused: intent ${name} has no executor in this host context`);
      if (statusRead === 'undeclared') throw new Error('refused: a person\'s account status is read only by an application that declares person-status.read');
      if (!current || current.kind !== 'person') throw new Error('refused: a person\'s account status is read only for a signed-in person, as themself');
      const fields = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).sort().join(',') : '';
      if (fields !== 'issuer,principal_id,subject' || [input.principal_id, input.issuer, input.subject].some((value) => typeof value !== 'string' || !value)) {
        throw new Error('invalid: person.status takes exactly principal_id, issuer and subject of one person');
      }
      const held = directory.get(input.principal_id);
      const active = Boolean(held && held.kind === 'person' && held.issuer === input.issuer && held.subject === input.subject
        && held.tenant === current.tenant && held.state === 'active');
      return {status: active ? 'active' : 'inactive'};
    },
    authorization: {
      registered: new Map(),
      registerResource(name, adapter) { kernel.authorization.registered.set(name, adapter); },
      currentActor() { return current ? {principalId: current.id, sub: current.subject, issuer: current.issuer, tenantIds: [current.tenant], isActive: current.state === 'active', name: current.subject} : null; },
    },
    /** POST /tickets/:id/application/confirmation, as the kernel answers the owner. */
    confirmation(id) { const t = own(id); if (!t || current.kind !== 'person') throw new Error('no such owned ticket'); const token = crypto.randomUUID(); tokens.set(token, {id: String(id), who: current.id}); return token; },
    /** POST /tickets/:id/application/decision with x-oshal-confirm, as the kernel answers the owner. */
    decide(id, outcome, token) {
      const spent = tokens.get(token); tokens.delete(token);
      const t = own(id);
      if (!spent || spent.id !== String(id) || spent.who !== current.id) throw new Error('confirmation is not valid for this decision');
      if (!t || t.status !== 'awaiting_approval') throw new Error('this ticket is not waiting at a human gate');
      t.status = outcome === 'approve' ? 'done' : 'cancelled'; t.decision = outcome; t.revision += 1; t.decidedAt = t.revision; return project(t);
    },
  };
  return kernel;
}

/** @description The gate toolchain's Express, or a loud failure (never a skip). @returns {string} Module path. */
function expressHome() {
  for (const base of [process.env.STORE_CI_TOOLCHAIN, path.join(STORE, 'scripts/toolchain')].filter(Boolean)) {
    if (fs.existsSync(path.join(base, 'node_modules/express'))) return path.join(base, 'node_modules/express');
  }
  throw new Error('BLOCKED: express not found (npm ci --prefix scripts/toolchain)');
}

/** @description Build the package router with Express answered from the toolchain for the length of the call. */
function mount(kernel, options = {}, packageDir = PACKAGE) {
  const home = expressHome(), resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveExpress(request, ...rest) { return resolve.call(this, request === 'express' ? home : request, ...rest); };
  try {
    const routes = require(path.join(packageDir, 'routes/coaching-routes.js'));
    return routes.createCareerCoachingRoutes({authorization: kernel.authorization, ticketService: kernel.ticketService,
      intent: (name, input) => kernel.intent(name, input)}, options);
  } finally { Module._resolveFilename = resolve; }
}

/** @description One request through the router as `who` (the actor port answers for `actor`), with a response that has only the bridge's methods. */
function send(router, kernel, who, method, url, body, headers = {}, actor = who) {
  kernel.as(actor);
  return new Promise((done, failed) => {
    const answer = {status: 200, type: null};
    const res = {
      status(code) { answer.status = code; return res; }, set() { return res; }, setHeader() { return res; },
      type(value) { answer.type = value; return res; }, json(value) { done({...answer, body: value}); return res; },
      send(value) { done({...answer, body: value}); return res; }, end(value) { done({...answer, body: value}); return res; },
    };
    const principal = who ? {id: who.id, kind: who.kind, subject: who.subject, issuer: who.issuer, tenant: who.tenant, state: who.state} : null;
    const req = {method, url, headers: {...headers}, body, query: {}, principal,
      user: who ? {sub: who.subject, name: who.name, email: who.email, email_verified: true} : null};
    router(req, res, (error) => (error ? failed(error) : done({status: 'unmatched'})));
  });
}

/** @description A snapshot as a seeker's page builds it from fixture Career reads. @returns {object} */
function snapshot(now, {applications = false, extra} = {}) {
  const asOf = new Date(now - 60_000).toISOString(), since = new Date(Date.parse(asOf) - 7 * 86400000).toISOString();
  const out = {schema: 'career-summary.v1', sourceAsOf: asOf,
    pipeline: {saved: 12, gettingReady: 3, applied: 9, interviewing: 2, offer: null, closed: 4},
    activity: {period: 'past7days', since, asOf, applied: 5}, ...(extra || {})};
  if (applications) out.applications = [{item: 'a1', employer: 'Example Robotics', title: 'Data Analyst', stage: 'Interviewing', date: '2026-11-10'},
    {item: 'a2', employer: 'Sample Health', title: 'Operations Analyst', stage: 'Applied', date: null}];
  return out;
}

module.exports = {STORE, PACKAGE, ISSUER, TENANT, OTHER_TENANT, person, cast, memoryRepo, standInKernel, expressHome, mount, send, snapshot};
