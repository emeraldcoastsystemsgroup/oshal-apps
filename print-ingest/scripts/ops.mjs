#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Version-controlled shelf publisher account & session operations for
 *     |                                           | Print Inbox curated shelves (moved from QUANTLIB2's local state directory
 *     |                                           | with receipt, state-dir, env-file, and token-file paths as arguments).
 *     |                                           | Uses the kernel's people, grants, composites, and session routes; never
 *     |                                           | prints credentials, and writes tokens/sessions exclusively to 0600 files.
 */
// usage: node print-ingest/scripts/ops.mjs <command> <slot blue|production> ...
//   make-person <slot> <label> --subject=S --name=N --trades=viewer|editor [--kernel-tier=viewer] [--token-file=F] [--record=R] [--state-dir=D] [--env-file=E] [--base=U]
//   give-role <slot> <label> <app> <role> [--record=R] [--state-dir=D]
//   revoke-role <slot> <label> <assignment-id> [--record=R] [--state-dir=D]
//   signin <slot> <label> <session-file> [--record=R] [--state-dir=D]
//   signout <slot> <session-file> [--base=U]
//   remove-person <slot> <label> [--record=R] [--state-dir=D] [--apply]
//   ask <slot> <session-file> <bot> <out-file> <question...>
//   kernel-tier <slot> <label> [tier] [--record=R] [--state-dir=D]
//   kernel-viewer <slot> <label> [--record=R] [--state-dir=D]
//   target <slot> <principal>                     roles <slot> <principal> [app]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const DEFAULT_STATE = process.env.OSHAL_QUANTLIB_STATE_DIR || path.join(HOME, '.local/state/oshal-quantlib2');
export const SLOTS = {
  blue: { base: 'http://127.0.0.1:38798', env: path.join(HOME, '.local/state/oshal-native-green/oshald.env') },
  production: { base: 'http://127.0.0.1:38788', env: path.join(HOME, '.local/state/oshal-native/oshald.env') },
};
const TRADES = 'intelligent-trades';
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

export function flag(argv, name) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

export function positional(argv) {
  return argv.filter((arg) => !arg.startsWith('--'));
}

export function slotOf(name, argv = []) {
  const preset = SLOTS[name];
  if (!preset) throw new Error('slot must be blue or production');
  return { base: flag(argv, 'base') || preset.base, env: flag(argv, 'env-file') || preset.env };
}

function stateDirOf(argv) {
  return path.resolve(flag(argv, 'state-dir') || DEFAULT_STATE);
}

function adminToken(envFile) {
  const line = fs.readFileSync(envFile, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

async function request(base, credential, method, route, body, headers = {}) {
  const url = new URL(route, base);
  if (url.origin !== new URL(base).origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, {
    method,
    headers: {
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

async function confirmed(base, admin) {
  const issued = await request(base, admin, 'POST', '/confirmations', {});
  if (issued.status !== 200 && issued.status !== 201) throw new Error(`confirmation refused: ${issued.status}`);
  return { 'x-oshal-confirm': issued.body.confirmation };
}

export function recordFile(slotName, label, argv = []) {
  const explicit = flag(argv, 'record');
  if (explicit) {
    fs.mkdirSync(path.dirname(path.resolve(explicit)), { recursive: true, mode: 0o700 });
    return path.resolve(explicit);
  }
  const dir = path.join(stateDirOf(argv), slotName, 'people');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${label}.json`);
}

function readRecord(slotName, label, argv) {
  return JSON.parse(fs.readFileSync(recordFile(slotName, label, argv), 'utf8'));
}

function writeRecord(slotName, label, record, argv) {
  fs.writeFileSync(recordFile(slotName, label, argv), `${JSON.stringify(record, null, 1)}\n`, { mode: 0o600 });
}

function writeSecret(file, value) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(resolved), 0o700);
  if (fs.existsSync(resolved)) throw new Error(`${resolved} already exists; refusing to overwrite a credential`);
  fs.writeFileSync(resolved, `${value}\n`, { mode: 0o600, flag: 'wx' });
}

async function setTrades(base, admin, principal, tier) {
  const put = await request(base, admin, 'PUT', `/grants/${principal}/${TRADES}`, { tier }, await confirmed(base, admin));
  if (put.status !== 200) throw new Error(`the Trades ${tier} grant was refused: ${put.status}`);
}

async function assign(base, admin, principal, app, role, reason) {
  const catalog = (await request(base, admin, 'GET', '/api/authorization/composites')).body;
  const id = randomUUID();
  const change = {
    target: principal, assignment_id: id, action: 'assign', expected_revision: catalog.revision,
    selection: { kind: 'granular', app, role }, reason, idempotency_key: `shelf-ops-${id}`,
  };
  const preview = await request(base, admin, 'POST', '/api/authorization/composites/preview', change);
  if (preview.status !== 200) throw new Error(`${app} ${role} preview refused: ${preview.status}`);
  const applied = await request(base, admin, 'POST', '/api/authorization/composites/apply',
    { ...change, expected_plan_revision: preview.body.plan_revision });
  if (applied.status !== 200) throw new Error(`${app} ${role} apply refused: ${applied.status}`);
  return id;
}

async function revoke(base, admin, principal, id, reason) {
  const catalog = (await request(base, admin, 'GET', '/api/authorization/composites')).body;
  const answer = await request(base, admin, 'POST', '/api/authorization/composites/apply', {
    target: principal, assignment_id: id, action: 'revoke', expected_revision: catalog.revision,
    reason, idempotency_key: `shelf-ops-revoke-${id}`,
  });
  return answer.status;
}

async function followPendingAsk(base, session, answer) {
  if (answer.status !== 202 || answer.body?.status !== 'pending' || !String(answer.body?.jobId || '').startsWith('pending-')) {
    return answer;
  }
  const jobId = String(answer.body.jobId);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = await request(base, session, 'GET', `/api/jarvis/ask/result?jobId=${encodeURIComponent(jobId)}`);
    if (poll.status === 200 && poll.body?.status === 'pending') continue;
    if (poll.status === 200 && poll.body?.status === 'done') {
      return { status: 200, body: { ...poll.body, reply: poll.body.reply ?? poll.body.answer ?? '' } };
    }
    return poll;
  }
  throw new Error(`pending ask ${jobId} timed out`);
}

export const commands = {
  async 'make-person'(slotName, argv) {
    const [label] = positional(argv);
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env);
    const subject = flag(argv, 'subject'), name = flag(argv, 'name');
    const kernelTier = flag(argv, 'kernel-tier') || 'viewer', trades = flag(argv, 'trades');
    const tokenFile = path.resolve(flag(argv, 'token-file') || path.join(stateDirOf(argv), slotName, `${label}.token`));
    if (!label || !subject || !name || !trades) {
      throw new Error('make-person <slot> <label> --subject= --name= --trades= [--kernel-tier=] [--token-file=] [--record=]');
    }
    const recPath = recordFile(slotName, label, argv);
    if (fs.existsSync(recPath)) throw new Error(`a record already exists at ${recPath}`);
    if (fs.existsSync(tokenFile)) throw new Error(`${tokenFile} already exists`);
    const invite = await request(base, admin, 'POST', '/people/invitations', { invitee: subject, tier: kernelTier, lifetime_ms: 600000 });
    if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
    const accepted = await request(base, '', 'POST', `/people/invitations/${encodeURIComponent(invite.body.token)}/accept`,
      { subject, display_name: name });
    if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
    writeSecret(tokenFile, accepted.body.token);
    const record = {
      slot: slotName, label, principal: accepted.body.principal, subject: accepted.body.subject, displayName: name,
      kernelTier: accepted.body.tier, tokenFile, createdAt: new Date().toISOString(), trades: null, assignments: [],
    };
    writeRecord(slotName, label, record, argv);
    await setTrades(base, admin, record.principal, trades);
    record.trades = trades;
    writeRecord(slotName, label, record, argv);
    say('person', { slot: slotName, label, principal: record.principal, subject: record.subject, kernelTier: record.kernelTier, trades, record: recPath, tokenFile });
  },
  async 'give-role'(slotName, argv) {
    const [label, app, role] = positional(argv);
    if (!label || !app || !role) throw new Error('give-role <slot> <label> <app> <role> [--record=]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env), record = readRecord(slotName, label, argv);
    const id = await assign(base, admin, record.principal, app, role, `shelf publisher role: ${label} ${app} ${role}`);
    record.assignments.push({ id, app, role, at: new Date().toISOString() });
    writeRecord(slotName, label, record, argv);
    say('role', { slot: slotName, label, app, role, assignment: id });
  },
  async 'revoke-role'(slotName, argv) {
    const [label, id] = positional(argv);
    if (!label || !id) throw new Error('revoke-role <slot> <label> <assignment-id> [--record=]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env), record = readRecord(slotName, label, argv);
    const held = record.assignments.find((row) => row.id === id && !row.revokedAt);
    if (!held) throw new Error('that assignment is not in this record, or is already revoked');
    const status = await revoke(base, admin, record.principal, id, `shelf publisher role revoked: ${label} ${held.app} ${held.role}`);
    if (status !== 200) throw new Error(`revoke refused: ${status}`);
    held.revokedAt = new Date().toISOString();
    writeRecord(slotName, label, record, argv);
    say('role revoked', { slot: slotName, label, assignment: id, status });
  },
  async signin(slotName, argv) {
    const [label, sessionFile] = positional(argv);
    if (!label || !sessionFile) throw new Error('signin <slot> <label> <session-file> [--record=] [--token-file=]');
    const { base } = slotOf(slotName, argv), record = readRecord(slotName, label, argv);
    const tokenPath = flag(argv, 'token-file') || record.tokenFile;
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    const session = await request(base, '', 'POST', '/sessions', { token });
    if (session.status !== 201 && session.status !== 200) throw new Error(`sign-in refused: ${session.status}`);
    writeSecret(sessionFile, session.body.session);
    say('signed in', { slot: slotName, label, sessionFile: path.resolve(sessionFile) });
  },
  async signout(slotName, argv) {
    const [sessionFile] = positional(argv);
    if (!sessionFile) throw new Error('signout <slot> <session-file>');
    const { base } = slotOf(slotName, argv);
    const session = fs.readFileSync(sessionFile, 'utf8').trim();
    const out = await request(base, session, 'DELETE', '/sessions');
    fs.rmSync(sessionFile, { force: true });
    say('signed out', { slot: slotName, status: out.status, sessionFileRemoved: !fs.existsSync(sessionFile) });
  },
  async 'remove-person'(slotName, argv) {
    const [label] = positional(argv);
    if (!label) throw new Error('remove-person <slot> <label> [--record=] [--apply]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env), record = readRecord(slotName, label, argv);
    const open = record.assignments.filter((row) => !row.revokedAt);
    if (!argv.includes('--apply')) {
      say('would remove', { slot: slotName, label, principal: record.principal, revoke: open.map((r) => `${r.app}:${r.role}:${r.id}`), tradesDeny: true, deactivate: true });
      return;
    }
    for (const row of open) {
      const status = await revoke(base, admin, record.principal, row.id, `shelf publisher removed: ${label}`);
      if (status === 200) row.revokedAt = new Date().toISOString();
      say('role revoked', { label, app: row.app, role: row.role, status });
    }
    const deny = await request(base, admin, 'PUT', `/grants/${record.principal}/${TRADES}`, { tier: 'deny' }, await confirmed(base, admin))
      .catch((e) => ({ status: message(e) }));
    const off = await request(base, admin, 'POST', `/people/${record.principal}/deactivate`, {}, await confirmed(base, admin));
    record.removedAt = new Date().toISOString();
    record.removal = { tradesDeny: deny.status, deactivate: off.status };
    writeRecord(slotName, label, record, argv);
    say('person removed', { slot: slotName, label, tradesDeny: deny.status, deactivated: off.status });
  },
  async ask(slotName, argv) {
    const [sessionFile, bot, outFile, ...words] = positional(argv);
    if (!sessionFile || !bot || !outFile || !words.length) throw new Error('ask <slot> <session-file> <bot> <out-file> <question...>');
    const { base } = slotOf(slotName, argv);
    const session = fs.readFileSync(sessionFile, 'utf8').trim();
    const from = Date.now();
    const raw = await request(base, session, 'POST', `/api/swarm/bots/${bot}/ask`,
      { message: words.join(' '), sessionId: `shelf-ops-${randomUUID().slice(0, 8)}` });
    const answer = await followPendingAsk(base, session, raw);
    const body = answer.body || {};
    const tools = (Array.isArray(body.toolsUsed) ? body.toolsUsed : Array.isArray(body.tool_executions) ? body.tool_executions : []).map((r) => r.tool || r.name);
    const citations = Array.isArray(body.citations)
      ? body.citations.map((c) => ({ collection: c.collection, document: c.document, source: c.source, degraded: c.degradedReason || null }))
      : null;
    const fact = {
      slot: slotName, bot, question: words.join(' '), status: answer.status, from, to: Date.now(),
      keys: Object.keys(body), tools, recall: body.recall || null, citations,
      reply: String(body.reply || body.answer || body.error || body.message || ''),
    };
    fs.writeFileSync(outFile, `${JSON.stringify(fact, null, 1)}\n`, { mode: 0o600 });
    say('answer', { ...fact, reply: fact.reply.slice(0, 1500), out: outFile });
  },
  async 'kernel-tier'(slotName, argv) {
    const [label, tier] = positional(argv);
    if (!label) throw new Error('kernel-tier <slot> <label> [tier] [--record=]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env), record = readRecord(slotName, label, argv);
    const before = await request(base, admin, 'GET', `/grants/${record.principal}/kernel`);
    if (tier) {
      const put = await request(base, admin, 'PUT', `/grants/${record.principal}/kernel`, { tier }, await confirmed(base, admin));
      if (put.status !== 200) throw new Error(`the kernel ${tier} grant was refused: ${put.status}`);
      record.kernelTierChanges = [...(record.kernelTierChanges || []), { to: tier, at: new Date().toISOString() }];
      writeRecord(slotName, label, record, argv);
    }
    const after = await request(base, admin, 'GET', `/grants/${record.principal}/kernel`);
    say('kernel tier', { slot: slotName, label, before: before.body, after: after.body });
  },
  async 'kernel-viewer'(slotName, argv) {
    const [label] = positional(argv);
    if (!label) throw new Error('kernel-viewer <slot> <label> [--record=]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env), record = readRecord(slotName, label, argv);
    const out = await request(base, admin, 'DELETE', `/api/swarm/roles/${record.principal}`, undefined, await confirmed(base, admin));
    if (out.status !== 200) throw new Error(`the kernel viewer standing was refused: ${out.status}`);
    record.kernelTierChanges = [...(record.kernelTierChanges || []), { to: 'viewer (replaced)', at: new Date().toISOString() }];
    writeRecord(slotName, label, record, argv);
    const after = await request(base, admin, 'GET', `/grants/${record.principal}/kernel`);
    say('kernel tier replaced', { slot: slotName, label, status: out.status, after: after.body });
  },
  async target(slotName, argv) {
    const [principal] = positional(argv);
    if (!principal) throw new Error('target <slot> <principal>');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env);
    const catalog = (await request(base, admin, 'GET', '/api/authorization/composites')).body;
    const t = catalog.targets.find((row) => row.id === principal);
    if (!t) throw new Error('no such target');
    process.stdout.write(`${JSON.stringify({ id: t.id, issuer: t.issuer, subject: t.subject, tenant: t.tenant, state: t.state, displayName: t.displayName, category: t.category })}\n`);
  },
  async roles(slotName, argv) {
    const [principal, app] = positional(argv);
    if (!principal) throw new Error('roles <slot> <principal> [app]');
    const { base, env } = slotOf(slotName, argv), admin = adminToken(env);
    const catalog = (await request(base, admin, 'GET', '/api/authorization/composites')).body;
    for (const row of catalog.assignments) {
      const a = row.assignment;
      if (JSON.stringify(a).includes(principal) && (!app || JSON.stringify(a.selection || {}).includes(`"${app}"`))) {
        say('assignment', { status: row.status, id: a.assignment_id || a.id, selection: a.selection, at: a.created_at || a.assigned_at || a.at || null });
      }
    }
  },
};

export async function runCli(argv = process.argv.slice(2)) {
  const [command, slotName, ...rest] = argv;
  if (!commands[command]) {
    console.error(`commands: ${Object.keys(commands).join(', ')}`);
    return 2;
  }
  await commands[command](slotName, rest);
  return 0;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runCli().then((code) => { if (code) process.exitCode = code; }).catch((error) => {
    console.error(`ops ${process.argv[2] || ''}: ${message(error)}`);
    process.exitCode = 1;
  });
}
