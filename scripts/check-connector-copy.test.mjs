/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation spec for scripts/check-connector-copy.mjs, and the check against this tree. Each
 *   shape the 2026-10-11 sweep found goes red on a disposable fixture package ("will work once an Uber connection is added",
 *   "connect a Duffel token on the Connections page", "add Walmart key", "Connect Google, Outlook or Yahoo"); a sentence that
 *   forbids the instruction, a persona comment, and a provider this installation does connect (Google, Dropbox, Square) pass;
 *   a PENDING entry that stops violating is itself an error. The last case runs the check over the repository.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkConnectorCopy, findConnectorPromises, PENDING } from './check-connector-copy.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A disposable repository with one package whose tools page and persona hold the given lines. */
function fixture({ page = [], persona = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-copy-'));
  fs.mkdirSync(path.join(root, 'pkg', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pkg', 'personas'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg', 'oshal-app.yaml'), 'name: pkg\n');
  fs.writeFileSync(path.join(root, 'pkg', 'tools', 'page.html'), page.join('\n'));
  fs.writeFileSync(path.join(root, 'pkg', 'personas', 'bot.yaml'), persona.join('\n'));
  return root;
}
const found = (root) => { try { return findConnectorPromises(root).map((f) => f.where); } finally { fs.rmSync(root, { recursive: true, force: true }); } };

test('each instruction shape from the sweep is refused', () => {
  const shapes = [
    "const NOT_CONNECTED = 'Not connected: Rides will work once an Uber connection is added.';",
    '<div id="demoflag">Showing demo data — connect a Duffel token on the Connections page for live prices.</div>',
    "setStatus('Demo catalog (add Walmart key for live results)');",
    "no_mail_connection: ['No mailbox connected.', 'Connect Google, Outlook or Yahoo →'],",
    "'Restaurants need Uber Eats: connect it at /utilities.'",
    "'Link your PayPal account to take a payment.'",
    "'Connect Alpaca to trade.'",
  ];
  assert.deepEqual(found(fixture({ page: shapes })), shapes.map((_, i) => `pkg/tools/page.html:${i + 1}`));
  assert.deepEqual(found(fixture({ persona: ['perspective: |', '  Tell them to connect Duffel on the Connections page (/utilities).'] })), ['pkg/personas/bot.yaml:2']);
});

test('a forbidding sentence, a persona comment and a real connector pass', () => {
  const ok = found(fixture({
    page: ["'Connect Google or Outlook →'", "'Connect Dropbox at /utilities and I can list your files.'", "'Connect Square in Payments to take a payment.'",
      "'Unavailable: this installation has no Uber rail (no Uber connector exists here).'"],
    persona: ['# 2 | maintainer | The concierge told riders to connect Uber.', 'perspective: |',
      '  Never tell the rider to connect Uber, add an Uber connection or visit Connections for Uber.',
      '  Do not ask the shopper to connect Walmart.'],
  }));
  assert.deepEqual(ok, []);
});

test('PENDING entries must still violate, so the list cannot go stale', () => {
  const root = fixture({ page: ['nothing here'] });
  try {
    const { errors } = checkConnectorCopy(root);
    assert.equal(errors.length, PENDING.size);
    for (const e of errors) assert.match(e, /listed in PENDING but no longer violates/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('this repository tells no one to connect a provider it has no connector or rail for', () => {
  assert.deepEqual(checkConnectorCopy(REPO).errors, []);
});
