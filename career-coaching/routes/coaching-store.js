/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Career Coaching store (0.1.0; beside the routes so the store's route inventory classifies the route by the SQL it reaches) over the kernel's package SQL pool. Every read is by one key or one equality slice (no ON CONFLICT, DISTINCT ON or ORDER BY: the native interpreter materializes those), lists are bounded and sorted here, a duplicate key is a refusal, and a link update names the revision it expects so a concurrent change updates nothing. Activation and revocation run in one transaction on one client. This module never opens Career's files or database and never names another package's table.
 */
'use strict';
const {createLogger} = require('../lib/log');

const logger = createLogger('career-coaching-store');
const TABLES = Object.freeze({
  cc_people: ['person_id', 'issuer', 'subject', 'tenant_id', 'display_name', 'email', 'coach_code', 'created_at', 'updated_at'],
  cc_coach_codes: ['code_hash', 'coach_person_id', 'coach_issuer', 'coach_subject', 'tenant_id', 'display_name', 'email', 'created_at'],
  cc_previews: ['preview_id', 'link_id', 'expected_revision', 'seeker_person_id', 'seeker_issuer', 'seeker_subject',
    'coach_person_id', 'coach_issuer', 'coach_subject', 'coach_name', 'coach_email', 'tenant_id', 'scope', 'field_groups',
    'alias', 'days', 'payload', 'payload_digest', 'source_as_of', 'state', 'ticket_id', 'created_at', 'expires_at', 'updated_at'],
  cc_links: ['link_id', 'seeker_person_id', 'seeker_issuer', 'seeker_subject', 'coach_person_id', 'coach_issuer',
    'coach_subject', 'coach_name', 'coach_email', 'tenant_id', 'app', 'scope', 'field_groups', 'alias', 'state', 'revision',
    'approval_ticket_id', 'approval_preview_id', 'approval_receipt', 'approved_at', 'expires_at', 'revoked_at', 'created_at',
    'updated_at'],
  cc_snapshots: ['link_id', 'revision', 'seeker_person_id', 'coach_person_id', 'payload', 'payload_digest', 'source_as_of',
    'published_at', 'expires_at'],
  cc_link_drops: ['link_id', 'coach_person_id', 'coach_issuer', 'coach_subject', 'dropped_at'],
});
const LIST_LIMIT = 200;

/**
 * @description INSERT one row of a known table with every column named.
 * @param {string} table - One of TABLES.
 * @param {object} row - Values by column.
 * @returns {{text: string, values: unknown[]}} Statement.
 */
function insertSql(table, row) {
  const columns = TABLES[table];
  return {text: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(', ')})`,
    values: columns.map((column) => (row[column] === undefined ? null : row[column]))};
}

/**
 * @description Whether a refusal is a duplicate key (the caller then reads the row instead).
 * @param {unknown} error - Error from the pool.
 * @returns {boolean} True for a unique-key conflict.
 */
function duplicate(error) {
  const words = String(error && (error.code || '') + ' ' + (error.message || ''));
  return /23505|unique|duplicate key|uniqueness conflict/i.test(words);
}

/**
 * @description Repository methods bound to one query runner (the pool, or a transaction's client).
 * @param {{query: Function}} q - pg-shaped runner.
 * @returns {object} Methods.
 */
function bind(q) {
  const rows = async (text, values) => ((await q.query(text, values)) || {}).rows || [];
  const one = async (text, values) => (await rows(text, values))[0] || null;
  const run = async (text, values) => Number(((await q.query(text, values)) || {}).rowCount || 0);
  const insert = async (table, row) => { const s = insertSql(table, row); return run(s.text, s.values); };
  const bounded = (list) => {
    if (list.length > LIST_LIMIT) { const e = new Error('Too many coaching records to show.'); e.status = 503; e.code = 'too_many'; throw e; }
    return list;
  };
  return {
    person: (issuer, subject) => one('SELECT * FROM cc_people WHERE issuer = $1 AND subject = $2', [issuer, subject]),
    insertPerson: (row) => insert('cc_people', row),
    deletePerson: (personId) => run('DELETE FROM cc_people WHERE person_id = $1', [personId]),
    setCoachCode: (personId, code, name, email, at) => run(
      'UPDATE cc_people SET coach_code = $2, display_name = $3, email = $4, updated_at = $5 WHERE person_id = $1',
      [personId, code, name, email, at]),
    codeByHash: (hash) => one('SELECT * FROM cc_coach_codes WHERE code_hash = $1', [hash]),
    insertCode: (row) => insert('cc_coach_codes', row),
    deleteCodesFor: (personId) => run('DELETE FROM cc_coach_codes WHERE coach_person_id = $1', [personId]),
    preview: (id) => one('SELECT * FROM cc_previews WHERE preview_id = $1', [id]),
    insertPreview: (row) => insert('cc_previews', row),
    setPreview: (id, state, ticketId, at) => run(
      'UPDATE cc_previews SET state = $2, ticket_id = $3, updated_at = $4 WHERE preview_id = $1', [id, state, ticketId, at]),
    link: (id) => one('SELECT * FROM cc_links WHERE link_id = $1', [id]),
    linksForSeeker: async (personId) => bounded(await rows('SELECT * FROM cc_links WHERE seeker_person_id = $1', [personId])),
    linksForCoach: async (personId) => bounded(await rows('SELECT * FROM cc_links WHERE coach_person_id = $1', [personId])),
    insertLink: (row) => insert('cc_links', row),
    updateLink: (row, expectedRevision) => run(
      'UPDATE cc_links SET field_groups = $3, alias = $4, state = $5, revision = $6, approval_ticket_id = $7, '
      + 'approval_preview_id = $8, approval_receipt = $9, approved_at = $10, expires_at = $11, revoked_at = $12, '
      + 'coach_name = $13, coach_email = $14, updated_at = $15 WHERE link_id = $1 AND revision = $2',
      [row.link_id, expectedRevision, row.field_groups, row.alias, row.state, row.revision, row.approval_ticket_id,
        row.approval_preview_id, row.approval_receipt, row.approved_at, row.expires_at, row.revoked_at, row.coach_name,
        row.coach_email, row.updated_at]),
    revokeLink: (id, expectedRevision, at) => run(
      "UPDATE cc_links SET state = 'revoked', revision = $3, revoked_at = $4, updated_at = $4 WHERE link_id = $1 AND revision = $2",
      [id, expectedRevision, expectedRevision + 1, at]),
    snapshot: (linkId) => one('SELECT * FROM cc_snapshots WHERE link_id = $1', [linkId]),
    insertSnapshot: (row) => insert('cc_snapshots', row),
    deleteSnapshot: (linkId) => run('DELETE FROM cc_snapshots WHERE link_id = $1', [linkId]),
    drop: (linkId) => one('SELECT * FROM cc_link_drops WHERE link_id = $1', [linkId]),
    insertDrop: (row) => insert('cc_link_drops', row),
  };
}

/**
 * @description The SQL repository: the bound pool methods plus transaction(fn) on one client.
 * @param {{query: Function, connect?: Function}} pool - ctx.pool from the kernel bridge.
 * @returns {object} Repository.
 */
function createSqlRepository(pool) {
  if (!pool || typeof pool.query !== 'function') return null;
  return {...bind(pool), duplicate, async transaction(work) {
    if (typeof pool.connect !== 'function') { const e = new Error('Coaching storage is unavailable.'); e.status = 503; e.code = 'store_unavailable'; throw e; }
    const client = await pool.connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const result = await work(bind(client));
      await client.query('COMMIT');
      open = false;
      return result;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (rollback) {
          // The kernel also rolls an unfinished transaction back when the client is released.
          logger.error({err: rollback}, 'career coaching rollback failed');
        }
      }
      throw error;
    } finally { client.release(); }
  }};
}

module.exports = {TABLES, LIST_LIMIT, insertSql, duplicate, createSqlRepository};
