#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Lane QUANTLIB1: file a curated shelf (print-ingest/shelves/<name>) into the engine's knowledge rail through Print Inbox's own intake and approval, as a publisher would by hand: each passage is filed (POST /api/print-ingest/documents), then approved to the shelf's bot destination (POST /api/print-ingest/documents/:id/approve), which runs the engine's own rag.ingest. Re-runnable: Print keeps one intake per text (content hash), so a passage already ingested is skipped and one waiting is approved; nothing is ever filed twice. Refuses a shelf that fails the shelf check, and a session that is not offered the shelf's destination (no Print publisher role, or a kernel without K1).
 */
// usage: node print-ingest/scripts/load-shelf.mjs <shelf-dir> <base http://127.0.0.1:38798> <session-token-file>
//          [--dry-run] [--from=N] [--limit=N] [--receipt=<file>]
// The token file holds a session token of a person with Print Inbox's publisher role (and access to the shelf's
// audience application). The token is read from the file and sent only to <base>; it is never printed or stored.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readShelf, checkShelf } = require('../shelves/shelf-check.cjs');
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));

/** @description One JSON request to the kernel's own origin, with the person's bearer. */
async function call(origin, token, method, route, body) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

/** @description The destination Print offers this session for the shelf, or why it is not offered. */
async function destination(origin, token, shelf) {
  const answer = await call(origin, token, 'GET', '/api/print-ingest/destinations');
  if (answer.status !== 200) throw new Error(`Print Inbox answered ${answer.status} to its destinations: is this person signed in with a Print role?`);
  const found = (answer.body.destinations || []).find((row) => row.collection === shelf.collection);
  if (!found || found.id !== shelf.destination || found.kind !== 'bot') {
    throw new Error(`Print does not offer ${shelf.collection} to this session. It needs Print Inbox 0.5.0+, a kernel with K1, `
      + `Print's publisher role and access to ${shelf.audience.app}.`);
  }
  return found;
}

/** @description The title a passage is filed under: its work, licence and place in the shelf. */
function titleOf(doc, works) {
  const work = works.get(doc.work);
  return `${work.title} | ${work.licence.name} | ${doc.id}`.slice(0, 200);
}

/** @description File and approve one passage; answers its outcome. */
async function fileOne(origin, token, doc, works, dest, collection) {
  const title = titleOf(doc, works);
  const filed = await call(origin, token, 'POST', '/api/print-ingest/documents',
    { text: doc.text, sidecar: { documentName: title, source: `shelf:${collection}` } });
  if (filed.status !== 201 && filed.status !== 200) return { id: doc.id, outcome: 'refused', status: filed.status, error: filed.body && filed.body.error };
  const intake = filed.body.intake;
  if (intake.state === 'ingested') return { id: doc.id, outcome: 'already', intake: intake.intakeId };
  if (intake.state !== 'awaiting_approval') return { id: doc.id, outcome: 'stuck', state: intake.state, intake: intake.intakeId };
  const approved = await call(origin, token, 'POST', `/api/print-ingest/documents/${intake.intakeId}/approve`, { destinations: [dest.id], title });
  const state = approved.body && approved.body.intake && approved.body.intake.state;
  return state === 'ingested' ? { id: doc.id, outcome: 'filed', intake: intake.intakeId }
    : { id: doc.id, outcome: 'failed', status: approved.status, state, error: approved.body && (approved.body.error || approved.body.detail) };
}

function option(argv, name) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

/** @description Load the shelf; answers the exit code. */
async function main(argv) {
  const [dir, base, tokenFile] = argv.filter((arg) => !arg.startsWith('--'));
  if (!dir || !base || !tokenFile) throw new Error('usage: load-shelf.mjs <shelf-dir> <base> <session-token-file> [--dry-run] [--from=N] [--limit=N] [--receipt=<file>]');
  const origin = new URL(base).origin;
  const shelf = readShelf(dir);
  const problems = checkShelf(shelf);
  if (problems.length) throw new Error(`the shelf fails its check (${problems.length}): ${problems.slice(0, 5).join('; ')}`);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const dest = await destination(origin, token, shelf.shelf);
  const works = new Map(shelf.works.map((work) => [work.id, work]));
  const from = Number(option(argv, 'from') || 0), limit = Number(option(argv, 'limit') || shelf.documents.length);
  const docs = shelf.documents.slice(from, from + limit);
  say('shelf', { collection: shelf.shelf.collection, destination: dest.id, label: dest.label, passages: docs.length, of: shelf.documents.length, dryRun: argv.includes('--dry-run') });
  if (argv.includes('--dry-run')) return 0;
  const results = [];
  for (const [n, doc] of docs.entries()) {
    results.push(await fileOne(origin, token, doc, works, dest, shelf.shelf.collection));
    if ((n + 1) % 25 === 0 || n + 1 === docs.length) say('progress', count(results, n + 1));
  }
  const receiptPath = option(argv, 'receipt') || path.resolve(`shelf-load-${shelf.shelf.collection}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify({ origin, collection: shelf.shelf.collection, from, at: new Date().toISOString(), ...count(results, docs.length), results }, null, 1)}\n`, { mode: 0o600 });
  const summary = count(results, docs.length);
  say('done', { ...summary, receipt: receiptPath });
  return summary.filed + summary.already === docs.length ? 0 : 1;
}

function count(results, done) {
  const tally = (outcome) => results.filter((row) => row.outcome === outcome).length;
  return { done, filed: tally('filed'), already: tally('already'), stuck: tally('stuck'), failed: tally('failed'), refused: tally('refused') };
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  console.error(`load-shelf: ${String(error && error.message || error).split('\n')[0]}`);
  process.exitCode = 1;
});
