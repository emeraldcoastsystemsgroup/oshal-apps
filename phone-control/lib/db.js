/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Scoped relational storage, forced two-arm RLS session binding, and immutable revision CAS for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0, every control real or removed: the person's phones (each tied to the computer that bridges it), the history of what the page sent and what the computer answered, and the last bridge report per computer. The 1.0.0 device rows (the three starter devices seeded per person and any its pairing buttons wrote, every one carrying the invented key and PIN) are deleted once with their drawn frames. Nothing here reaches a phone or a network: the person's own computer does that.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.OSHAL_PACKAGE_DATA_DIR || path.join(os.tmpdir(), 'oshal-phone-control');
const DEFAULT_DB_PATH = process.env.OSHAL_PHONE_CONTROL_DB || path.join(DATA_DIR, 'phone_control.sqlite');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const PLATFORMS = Object.freeze(['android', 'ios']);
const NODE_ID = /^[0-9a-fA-F-]{8,64}$/;
const ADDRESS = /^[A-Za-z0-9._:\[\]-]{1,160}$/;
const LIMITS = Object.freeze({ name: 120, summary: 400, action: 40, error: 400, report: 18000 });

// The package's own SQLite steps. They live here, not in migrations/, because the kernel never runs them:
// this file is the package's private store under OSHAL_PACKAGE_DATA_DIR.
const STEPS = Object.freeze([
  {
    id: 'phone-control-1.1.0-phones',
    sql: `CREATE TABLE IF NOT EXISTS phone_control_phones (
      phone_id TEXT PRIMARY KEY,
      owner_issuer TEXT NOT NULL,
      owner_sub TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
      computer_node_id TEXT NOT NULL,
      address TEXT NOT NULL,
      control_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (owner_issuer, owner_sub, computer_node_id, platform, address)
    );
    CREATE TABLE IF NOT EXISTS phone_control_history (
      event_id TEXT PRIMARY KEY,
      owner_issuer TEXT NOT NULL,
      owner_sub TEXT NOT NULL,
      phone_id TEXT,
      computer_node_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      ok INTEGER NOT NULL,
      exit_code INTEGER,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_phone_control_history_owner ON phone_control_history (owner_issuer, owner_sub, created_at);
    CREATE TABLE IF NOT EXISTS phone_control_computer_reports (
      owner_issuer TEXT NOT NULL,
      owner_sub TEXT NOT NULL,
      computer_node_id TEXT NOT NULL,
      report_json TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      PRIMARY KEY (owner_issuer, owner_sub, computer_node_id)
    );`
  },
  { id: 'phone-control-1.1.0-remove-1.0.0-starter-rows', run: removeStarterRows }
]);

// 1.0.0 cleanup begins: every device row 1.0.0 wrote carried its invented mirroring handshake (a TBS key, a PIN
// and the receiver name OSHAL-Mirror). None was a real device: the starter rows were seeded for every person, and
// its pairing buttons wrote rows without reaching a phone. Those rows, their drawn frames and blobs are deleted.
const FAKE_HANDSHAKE = Object.freeze(['%"receiverName":"OSHAL-Mirror"%', '%"pairingKey":"TBS-%']);
// 1.0.0 cleanup ends.

let defaultDb = null;

/** @description Convert the declared PostgreSQL schema to SQLite, as 1.0.0 did, so its receipts still match. @param {string} sql PostgreSQL. @returns {string} SQLite. */
function toSqlite(sql) {
  return sql
    .replace(/DO\s+\$\$[\s\S]*?END\s+\$\$;/gi, '')
    .replace(/ALTER\s+TABLE\s+[^\n;]+ROW\s+LEVEL\s+SECURITY\s*;/gi, '')
    .replace(/CHECK\s*\(\s*sha256\s*~\s*'[^']+'\s*\)/gi, 'CHECK (length(sha256) >= 1)')
    .replace(/TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/gi, "TEXT NOT NULL DEFAULT (datetime('now'))")
    .replace(/JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'::jsonb/gi, "TEXT NOT NULL DEFAULT '{}'")
    .replace(/DOUBLE\s+PRECISION/gi, 'REAL');
}

/** @description Apply one recorded step at most once; a changed step is refused. @param {DatabaseSync} db The store. @param {string} id Step id. @param {string} body What the checksum covers. @param {Function} apply The work. */
function applyOnce(db, id, body, apply) {
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  const done = db.prepare('SELECT checksum FROM schema_migrations WHERE migration_id = ?').get(id);
  if (done) {
    if (done.checksum !== checksum) throw new Error(`phone-control store step ${id} changed after it ran`);
    return;
  }
  db.exec('BEGIN IMMEDIATE;');
  try {
    apply();
    db.prepare('INSERT INTO schema_migrations (migration_id, checksum, applied_at) VALUES (?, ?, ?)')
      .run(id, checksum, new Date().toISOString());
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw new Error(`phone-control store step ${id} failed: ${error.message}`);
  }
}

/** @description Bring the store up to date: the 1.0.0 schema files, then this package's own steps. @param {DatabaseSync} db The store. */
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (migration_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);');
  const files = fs.existsSync(MIGRATIONS_DIR) ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    applyOnce(db, file, raw, () => db.exec(toSqlite(raw)));
  }
  for (const step of STEPS) {
    applyOnce(db, step.id, step.sql || step.id, () => (step.sql ? db.exec(step.sql) : step.run(db)));
  }
}

// 1.0.0 cleanup begins.
/** @description Delete every 1.0.0 device row (each carries the invented handshake) with its drawn frames and blobs. @param {DatabaseSync} db The store. @returns {number} Rows removed. */
function removeStarterRows(db) {
  const removed = Number(db.prepare('DELETE FROM phone_control_devices WHERE config_json LIKE ? AND config_json LIKE ?')
    .run(...FAKE_HANDSHAKE).changes || 0);
  const orphans = db.prepare('SELECT sha256 FROM phone_control_blobs WHERE sha256 NOT IN (SELECT blob_sha256 FROM phone_control_frames)').all();
  for (const { sha256 } of orphans) {
    if (!/^[0-9a-f]{64}$/.test(sha256)) continue;
    fs.rmSync(path.join(DATA_DIR, 'blobs', sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.blob`), { force: true });
  }
  db.prepare('DELETE FROM phone_control_blobs WHERE sha256 NOT IN (SELECT blob_sha256 FROM phone_control_frames)').run();
  return removed;
}
// 1.0.0 cleanup ends.

/** @description The package's store, opened and migrated once per process. @param {string} [customPath] A test's own file or ':memory:'. @returns {DatabaseSync} The store. */
function getDatabase(customPath) {
  if (!customPath && defaultDb) return defaultDb;
  const file = customPath || DEFAULT_DB_PATH;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  if (!customPath) defaultDb = db;
  return db;
}

/** @description A bounded single-line string, or a refusal. @param {unknown} value Input. @param {number} max Longest. @param {string} field Name for the refusal. @returns {string} The text. */
function text(value, max, field) {
  if (typeof value !== 'string' || !value.trim()) throw refusal(400, `${field}_required`, `${field} is required.`);
  return value.trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
}

/** @description A refusal the routes answer with. @param {number} status HTTP status. @param {string} code Code. @param {string} message Words. @returns {Error} The error. */
function refusal(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** @description One phone as the page sees it. @param {object} row A row. @returns {object} The phone. */
function phone(row) {
  return {
    id: row.phone_id, name: row.name, platform: row.platform, computerNodeId: row.computer_node_id,
    address: row.address, controlEnabled: Boolean(row.control_enabled), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

/** @description The person's phones, newest first. @param {DatabaseSync} db Store. @param {{issuer:string,sub:string}} owner Who. @returns {object[]} Phones. */
function listPhones(db, owner) {
  return db.prepare('SELECT * FROM phone_control_phones WHERE owner_issuer = ? AND owner_sub = ? ORDER BY updated_at DESC')
    .all(owner.issuer, owner.sub).map(phone);
}

/** @description One of the person's phones; somebody else's reads as missing. @param {DatabaseSync} db Store. @param {object} owner Who. @param {string} id Phone id. @returns {object|null} The phone. */
function getPhone(db, owner, id) {
  const row = db.prepare('SELECT * FROM phone_control_phones WHERE phone_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .get(String(id), owner.issuer, owner.sub);
  return row ? phone(row) : null;
}

/** @description Record a phone the person connected through one of their computers. The same phone on the same computer is the same record. @param {DatabaseSync} db Store. @param {object} owner Who. @param {object} input name, platform, computerNodeId, address. @returns {{phone:object,created:boolean}} The record. */
function savePhone(db, owner, input = {}) {
  const platform = String(input.platform || '');
  if (!PLATFORMS.includes(platform)) throw refusal(400, 'platform_invalid', 'A phone is android or ios.');
  const node = String(input.computerNodeId || '');
  if (!NODE_ID.test(node)) throw refusal(400, 'computer_required', 'Name the computer that connects this phone.');
  const address = String(input.address || '');
  if (!ADDRESS.test(address)) throw refusal(400, 'address_invalid', 'The phone address is not one adb or Bluetooth gave.');
  const name = text(input.name, LIMITS.name, 'name');
  const existing = db.prepare(`SELECT * FROM phone_control_phones WHERE owner_issuer = ? AND owner_sub = ?
    AND computer_node_id = ? AND platform = ? AND address = ?`).get(owner.issuer, owner.sub, node, platform, address);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE phone_control_phones SET name = ?, updated_at = ? WHERE phone_id = ?').run(name, now, existing.phone_id);
    return { phone: getPhone(db, owner, existing.phone_id), created: false };
  }
  const id = `ph_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO phone_control_phones (phone_id, owner_issuer, owner_sub, name, platform, computer_node_id, address,
    control_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, owner.issuer, owner.sub, name, platform, node, address, now, now);
  return { phone: getPhone(db, owner, id), created: true };
}

/** @description Rename a phone or turn its control on or off. @param {DatabaseSync} db Store. @param {object} owner Who. @param {string} id Phone. @param {object} changes name, controlEnabled. @returns {object|null} The phone. */
function updatePhone(db, owner, id, changes = {}) {
  const current = getPhone(db, owner, id);
  if (!current) return null;
  const name = changes.name === undefined ? current.name : text(changes.name, LIMITS.name, 'name');
  if (changes.controlEnabled !== undefined && typeof changes.controlEnabled !== 'boolean') {
    throw refusal(400, 'control_invalid', 'controlEnabled is true or false.');
  }
  const control = changes.controlEnabled === undefined ? current.controlEnabled : changes.controlEnabled;
  db.prepare('UPDATE phone_control_phones SET name = ?, control_enabled = ?, updated_at = ? WHERE phone_id = ?')
    .run(name, control ? 1 : 0, new Date().toISOString(), current.id);
  return getPhone(db, owner, current.id);
}

/** @description Forget a phone here (its pairing on the computer stays). @param {DatabaseSync} db Store. @param {object} owner Who. @param {string} id Phone. @returns {boolean} Whether one was removed. */
function deletePhone(db, owner, id) {
  return Number(db.prepare('DELETE FROM phone_control_phones WHERE phone_id = ? AND owner_issuer = ? AND owner_sub = ?')
    .run(String(id), owner.issuer, owner.sub).changes) > 0;
}

/** @description Record what the page sent and what the computer answered. @param {DatabaseSync} db Store. @param {object} owner Who. @param {object} input computerNodeId, phoneId?, action, summary, ok, exitCode?, error?. @returns {object} The event. */
function recordHistory(db, owner, input = {}) {
  const node = String(input.computerNodeId || '');
  if (!NODE_ID.test(node)) throw refusal(400, 'computer_required', 'Name the computer the command went to.');
  if (input.phoneId !== undefined && input.phoneId !== null && !getPhone(db, owner, input.phoneId)) {
    throw refusal(404, 'phone_not_found', 'You have no phone with that id.');
  }
  if (typeof input.ok !== 'boolean') throw refusal(400, 'ok_required', 'Say whether the computer answered ok.');
  const exit = input.exitCode === undefined || input.exitCode === null ? null : Number(input.exitCode);
  if (exit !== null && !Number.isInteger(exit)) throw refusal(400, 'exit_invalid', 'exitCode is a whole number.');
  const event = {
    id: `ev_${crypto.randomUUID()}`, phoneId: input.phoneId || null, computerNodeId: node,
    action: text(input.action, LIMITS.action, 'action'), summary: text(input.summary, LIMITS.summary, 'summary'),
    ok: input.ok, exitCode: exit, error: input.error ? String(input.error).slice(0, LIMITS.error) : null,
    createdAt: new Date().toISOString()
  };
  db.prepare(`INSERT INTO phone_control_history (event_id, owner_issuer, owner_sub, phone_id, computer_node_id, action, summary,
    ok, exit_code, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, owner.issuer, owner.sub, event.phoneId, node, event.action, event.summary, event.ok ? 1 : 0, exit,
      event.error, event.createdAt);
  return event;
}

/** @description The person's recent history, newest first, optionally for one phone. @param {DatabaseSync} db Store. @param {object} owner Who. @param {{phoneId?:string,limit?:number}} options Filter. @returns {object[]} Events. */
function listHistory(db, owner, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const rows = options.phoneId
    ? db.prepare('SELECT * FROM phone_control_history WHERE owner_issuer = ? AND owner_sub = ? AND phone_id = ?').all(owner.issuer, owner.sub, String(options.phoneId))
    : db.prepare('SELECT * FROM phone_control_history WHERE owner_issuer = ? AND owner_sub = ?').all(owner.issuer, owner.sub);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map((row) => ({
    id: row.event_id, phoneId: row.phone_id, computerNodeId: row.computer_node_id, action: row.action, summary: row.summary,
    ok: Boolean(row.ok), exitCode: row.exit_code, error: row.error, createdAt: row.created_at
  }));
}

/** @description Keep the bridge report the page read from one computer, with the time. @param {DatabaseSync} db Store. @param {object} owner Who. @param {string} node Computer. @param {object} report What the bridge said. @returns {{computerNodeId:string,report:object,reportedAt:string}} Stored. */
function saveComputerReport(db, owner, node, report) {
  if (!NODE_ID.test(String(node || ''))) throw refusal(400, 'computer_required', 'Name the computer this report is from.');
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw refusal(400, 'report_required', 'Send the bridge report as an object.');
  const json = JSON.stringify(report);
  if (json.length > LIMITS.report) throw refusal(413, 'report_too_large', 'That report is larger than a bridge report can be.');
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO phone_control_computer_reports (owner_issuer, owner_sub, computer_node_id, report_json, reported_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner_issuer, owner_sub, computer_node_id) DO UPDATE SET report_json = excluded.report_json,
    reported_at = excluded.reported_at`).run(owner.issuer, owner.sub, String(node), json, at);
  return { computerNodeId: String(node), report, reportedAt: at };
}

/** @description The last bridge report of each of the person's computers. @param {DatabaseSync} db Store. @param {object} owner Who. @returns {object[]} Reports. */
function listComputerReports(db, owner) {
  return db.prepare('SELECT * FROM phone_control_computer_reports WHERE owner_issuer = ? AND owner_sub = ?')
    .all(owner.issuer, owner.sub)
    .map((row) => ({ computerNodeId: row.computer_node_id, report: JSON.parse(row.report_json), reportedAt: row.reported_at }));
}

module.exports = {
  getDatabase, listPhones, getPhone, savePhone, updatePhone, deletePhone, recordHistory, listHistory,
  saveComputerReport, listComputerReports, removeStarterRows, refusal
};
