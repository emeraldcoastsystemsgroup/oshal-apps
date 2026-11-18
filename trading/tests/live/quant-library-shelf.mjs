/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane QUANTLIB1: the live proof loads the quant library on the test slot itself, once. A throwaway publisher person (Print Inbox's publisher role, Trades viewer) runs print-ingest/scripts/load-shelf.mjs with --dry-run first and then for real, and is removed when the load completes; the shelf stays. Print keeps one intake per person, so a second publisher would file a second copy: the slot's load is recorded (~/.local/state/oshal-quantlib1-proof/shelf-<port>.json, 0600) and a later run keeps a loaded shelf, resumes an unfinished load with the same publisher, and never loads over a shelf it did not record (a recall probe answers whether one is there).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRINT, say, makePerson, giveRole, removePerson, signIn, stateFile } from './quant-library-live-kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHELF = path.resolve(HERE, '../../../print-ingest/shelves/quant-library');
const LOADER = path.resolve(HERE, '../../../print-ingest/scripts/load-shelf.mjs');

/** @description The shelf version: the digest of its passages file. */
export function shelfDigest() {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(SHELF, 'documents.jsonl'))).digest('hex');
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeState(file, state) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 1)}\n`, { mode: 0o600 });
}

/** @description Run Print's shelf loader as the publisher; a dry run first proves the destination is offered. */
function runLoader(origin, tokenFile, out, dryRun) {
  const args = [LOADER, SHELF, origin, tokenFile, `--receipt=${path.join(out, 'shelf-load-quant-library.json')}`];
  if (dryRun) args.push('--dry-run');
  say(dryRun ? 'shelf dry run' : 'shelf load', { loader: path.relative(process.cwd(), LOADER) });
  execFileSync(process.execPath, args, { stdio: 'inherit', timeout: 3_600_000 });
}

/** @description A throwaway publisher: Trades viewer (the shelf's audience) and Print Inbox's publisher role. */
async function freshPublisher(origin, admin, file, digest) {
  const person = await makePerson(origin, admin, 'publisher', 'viewer');
  await giveRole(origin, admin, person, PRINT, 'publisher');
  writeState(file, { origin, digest, complete: false, startedAt: new Date().toISOString(),
    publisher: { subject: person.subject, principal: person.principal, token: person.token, assignments: person.assignments } });
  return person;
}

/** @description The recorded publisher of an unfinished load, signed in again with its own access token. */
async function recordedPublisher(origin, state) {
  const held = state.publisher;
  const person = { label: 'publisher', subject: held.subject, principal: held.principal, token: held.token, sessions: [], assignments: held.assignments || [] };
  await signIn(origin, person);
  say('resuming the recorded shelf load', { subject: held.subject });
  return person;
}

/**
 * @description Make sure this slot holds the shelf, loading it at most once.
 * @param {string} origin Test slot. @param {string} admin Credential. @param {string} out Run folder.
 * @param {() => Promise<{count:number}>} probe A reader's recall count for a library question.
 * @returns {Promise<object>} What was done.
 */
export async function ensureShelf(origin, admin, out, probe) {
  const file = stateFile(origin), digest = shelfDigest(), state = readState(file);
  if (state && state.complete) {
    return state.digest === digest ? { action: 'kept', note: 'this shelf version is already loaded here', loadedAt: state.loadedAt }
      : { action: 'kept', stale: true, note: `another shelf version (${state.digest.slice(0, 12)}) is loaded here; a second copy is not added` };
  }
  if (state && state.digest !== digest) throw new Error(`an unfinished load of another shelf version is recorded in ${file}; finish it with that version`);
  if (!state) {
    const recall = await probe();
    if (recall.count > 0) return { action: 'kept', note: 'a shelf already answers here and no load of it is recorded; a second copy is not added', recall };
  }
  const publisher = state ? await recordedPublisher(origin, state) : await freshPublisher(origin, admin, file, digest);
  const tokenFile = path.join(out, 'publisher-session.token');
  try {
    fs.writeFileSync(tokenFile, publisher.sessions[publisher.sessions.length - 1], { mode: 0o600 });
    runLoader(origin, tokenFile, out, true);
    runLoader(origin, tokenFile, out, false);
  } finally {
    fs.rmSync(tokenFile, { force: true });
  }
  await removePerson(origin, admin, publisher);
  writeState(file, { origin, digest, complete: true, loadedAt: new Date().toISOString(), publisher: { subject: publisher.subject, principal: publisher.principal } });
  return { action: 'loaded', publisher: publisher.subject };
}
