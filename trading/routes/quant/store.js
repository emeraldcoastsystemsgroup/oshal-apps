/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped Quant desk records. The caller's subject is always the first filter; a route never accepts one from a request.
 */
'use strict';

const SQL = Object.freeze({
  GET: 'SELECT payload FROM trading_quant_records WHERE user_sub=$1 AND kind=$2 AND record_key=$3',
  LIST: 'SELECT record_key, payload FROM trading_quant_records WHERE user_sub=$1 AND kind=$2',
  PUT: 'INSERT INTO trading_quant_records (user_sub,kind,record_key,payload,updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,kind,record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at',
  DELETE: 'DELETE FROM trading_quant_records WHERE user_sub=$1 AND kind=$2 AND record_key=$3',
});

/**
 * @description Read one record.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @param {string} key - Record key.
 * @returns {Promise<object|null>} The record, or null.
 */
async function getRecord(pool, sub, kind, key) {
  const row = (await pool.query(SQL.GET, [sub, kind, key])).rows[0];
  return row ? JSON.parse(String(row.payload)) : null;
}

/**
 * @description Read every record of a kind.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @returns {Promise<Array<object>>} The records.
 */
async function listRecords(pool, sub, kind) {
  return (await pool.query(SQL.LIST, [sub, kind])).rows.map((row) => JSON.parse(String(row.payload)));
}

/**
 * @description Write one record.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @param {string} key - Record key.
 * @param {object} value - The record.
 * @param {Date} [at] - Instant.
 * @returns {Promise<object>} The record.
 */
async function putRecord(pool, sub, kind, key, value, at = new Date()) {
  await pool.query(SQL.PUT, [sub, kind, key, JSON.stringify(value), at.toISOString()]);
  return value;
}

module.exports = { SQL, getRecord, listRecords, putRecord };
