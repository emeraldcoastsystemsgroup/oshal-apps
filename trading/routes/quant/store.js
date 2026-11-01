/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Records and price digests move to one-column keys, read and written by id, because the old upsert read the whole table on every save and the wider pool would pass the kernel's scan limit. Digests are read back in shards so no single answer nears the kernel's 16 MB limit. The old table's settings stay readable, and its other rows are removed once.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped Quant desk records. The caller's subject is always the first filter; a route never accepts one from a request.
 */
'use strict';

/** Price digests per query stay near a few megabytes at the size of the pool. */
const PRICE_SHARDS = 8;

const SQL = Object.freeze({
  GET: 'SELECT payload FROM trading_quant_store WHERE id=$1 AND user_sub=$2',
  LIST: 'SELECT payload FROM trading_quant_store WHERE kind=$1 AND user_sub=$2',
  UPDATE: 'UPDATE trading_quant_store SET payload=$1, updated_at=$2 WHERE id=$3 AND user_sub=$4',
  INSERT: 'INSERT INTO trading_quant_store (id,user_sub,kind,payload,updated_at) VALUES ($1,$2,$3,$4,$5)',
  PRICE_LIST: 'SELECT payload FROM trading_quant_prices WHERE shard=$1 AND user_sub=$2',
  PRICE_UPDATE: 'UPDATE trading_quant_prices SET payload=$1, updated_at=$2 WHERE id=$3 AND user_sub=$4',
  PRICE_INSERT: 'INSERT INTO trading_quant_prices (id,user_sub,shard,payload,updated_at) VALUES ($1,$2,$3,$4,$5)',
  OLD_GET: 'SELECT payload FROM trading_quant_records WHERE user_sub=$1 AND kind=$2 AND record_key=$3',
  OLD_DELETE: 'DELETE FROM trading_quant_records WHERE user_sub=$1 AND kind=$2',
});

/** What the old table held besides the person's setting. */
const OLD_KINDS = Object.freeze(['bars', 'fund', 'today', 'history', 'forward', 'cohort', 'state']);

const recordId = (sub, kind, key) => `${kind}/${key}/${sub}`;
const parse = (row) => JSON.parse(String(row.payload));

/**
 * @description Update a row by id, or add it. A plain insert, because ON CONFLICT reads the whole table in the kernel.
 * @param {object} pool - Package SQL pool.
 * @param {string} update - The update statement ($1 payload, $2 time, $3 id, $4 owner).
 * @param {string} insert - The insert statement.
 * @param {Array} args - [id, owner, grouping column, payload, time].
 * @returns {Promise<void>}
 */
async function upsert(pool, update, insert, [id, sub, group, payload, stamp]) {
  if ((await pool.query(update, [payload, stamp, id, sub])).rowCount > 0) return;
  try { await pool.query(insert, [id, sub, group, payload, stamp]); }
  catch (err) {
    if (!/23505|unique|duplicate key/i.test(`${err && err.code} ${err && err.message}`)) throw err;
    await pool.query(update, [payload, stamp, id, sub]);
  }
}

/**
 * @description Read one record.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @param {string} key - Record key.
 * @returns {Promise<object|null>} The record, or null.
 */
async function getRecord(pool, sub, kind, key) {
  const row = (await pool.query(SQL.GET, [recordId(sub, kind, key), sub])).rows[0];
  return row ? parse(row) : null;
}

/**
 * @description Read every record of a kind.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @returns {Promise<Array<object>>} The records.
 */
async function listRecords(pool, sub, kind) {
  return (await pool.query(SQL.LIST, [kind, sub])).rows.map(parse);
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
  await upsert(pool, SQL.UPDATE, SQL.INSERT, [recordId(sub, kind, key), sub, kind, JSON.stringify(value), at.toISOString()]);
  return value;
}

/**
 * @description The shard a symbol's digest is stored in. Stable, so a symbol stays where it was.
 * @param {string} symbol - Ticker.
 * @returns {string} The shard.
 */
function shardOf(symbol) {
  let hash = 2166136261;
  for (const ch of symbol) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return String((hash >>> 0) % PRICE_SHARDS);
}

/**
 * @description Write one symbol's price digest.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} symbol - Ticker.
 * @param {object} digest - The digest.
 * @param {Date} [at] - Instant.
 * @returns {Promise<void>}
 */
async function putPrices(pool, sub, symbol, digest, at = new Date()) {
  await upsert(pool, SQL.PRICE_UPDATE, SQL.PRICE_INSERT, [`${symbol}/${sub}`, sub, shardOf(symbol), JSON.stringify(digest), at.toISOString()]);
}

/**
 * @description Read every stored price digest, one shard at a time.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @returns {Promise<Array<object>>} The digests.
 */
async function listPrices(pool, sub) {
  const out = [];
  for (let shard = 0; shard < PRICE_SHARDS; shard += 1) {
    for (const row of (await pool.query(SQL.PRICE_LIST, [String(shard), sub])).rows) out.push(parse(row));
  }
  return out;
}

/**
 * @description The person's setting from the table the desk first shipped with, for anyone who set it there.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @returns {Promise<object|null>} The setting, or null.
 */
async function oldSettings(pool, sub) {
  const row = (await pool.query(SQL.OLD_GET, [sub, 'settings', 'current'])).rows[0];
  return row ? parse(row) : null;
}

/**
 * @description Remove what the first table held besides the setting. The next run rebuilds all of it.
 * @param {object} pool - Package SQL pool.
 * @param {string} sub - Owner.
 * @returns {Promise<void>}
 */
async function retireOldRecords(pool, sub) {
  for (const kind of OLD_KINDS) await pool.query(SQL.OLD_DELETE, [sub, kind]);
}

module.exports = { SQL, PRICE_SHARDS, getRecord, listRecords, putRecord, putPrices, listPrices, shardOf, oldSettings, retireOldRecords };
