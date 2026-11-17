/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: an unavailable source says the desk loads it on its next pass (its evening job, or Run now on the Quant desk) instead of naming trading_quant_run, which bot-fast took as a cue to start the desk's own pass for a stock question.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2, from the 1.61.1 blue proof (a desk run took 22.8 s although this module stopped waiting at 1.5 s): the kernel serves a package's outside read before it reads the package's answer, so only the kernel can end that read early. Every read now asks the kernel to end it within the pass's budget (timeoutMs), and the desk reads a source only where the read can be ended in time: Node's own fetch (it honors the abort signal) or a kernel fetch that says it honors timeoutMs. On an older kernel nothing is read and every answer says why, so a pass never waits on an outside site. The Treasury's server never answered our old agent, which carried an address in parentheses (checked 2026-11-17: that agent hung; the plain "oshal-trading-research/1.0" answered 200 in 0.5 s), so the agent is now the plain one, with an Accept of any type (the French library answers 406 to application/zip and 404 after 5 seconds to no Accept header). A failed source rests 30 minutes, as before.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1, after the blue proof: a risk question took 20 seconds because FRED never answered this host, and Trading serves one call at a time, so that wait held up the stop watcher and every Trading screen. Interactive tools now read only the cached copy and answer at once ("rate unavailable right now" with the reason when there is none); the network is read only by the Quant desk's own passes (trading_quant_run, the nightly job), one stale source per pass, inside a hard 1.5-second budget, with a 30-minute pause after a failure. The rate now comes from the U.S. Treasury's daily bill rates (home.treasury.gov, public domain), and the French library is asked without the Accept header it answered 406 to.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real reference data for the quant, cached per person and attributed: the official Fama-French three factors (daily, from Kenneth R. French's Data Library at Dartmouth) and the 3-month Treasury bill rate. A source that cannot be read says so, and nothing is ever filled in.
 */
'use strict';
const zlib = require('node:zlib');
const store = require('./store');

const FF3_URL = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip';
const FF3_ATTRIBUTION = 'Fama/French 3 Factors (daily), Kenneth R. French Data Library, Tuck School of Business at Dartmouth.';
const BILL_ATTRIBUTION = 'Daily Treasury Bill Rates, 13-week coupon equivalent, U.S. Department of the Treasury (home.treasury.gov), public domain.';
/** The hard budget for every network read of one pass; nothing interactive waits on the network at all. */
const READ_BUDGET_MS = 1500;
/** After a failed read, a source rests this long before a pass tries it again. */
const RETRY_AFTER_MS = 30 * 60000;
const KEEP_ROWS = 3000;
const MAX_UNZIPPED = 16 * 1024 * 1024;
/** Plain on purpose: the Treasury's server never answers an agent carrying an address in parentheses. */
const USER_AGENT = 'oshal-trading-research/1.0';
const NOT_READ_HERE = "this installation's kernel cannot yet end an outside read early, so the Quant desk does not read it";

/**
 * @description Whether an outside read can be ended at the pass's budget here. Node's own fetch honors the abort signal;
 * the kernel's fetch (OSHAL_EGRESS=kernel) ends a read at timeoutMs only when it says so, because an older kernel keeps a
 * package's read open up to its own 20 seconds whatever the package does, and Trading serves one call at a time.
 * @returns {boolean} True when a read can be ended in time.
 */
function readsBounded() {
  return process.env.OSHAL_EGRESS !== 'kernel' || (typeof globalThis.fetch === 'function' && globalThis.fetch.honorsTimeoutMs === true);
}

/**
 * @description A published percentage as a fraction, rounded to the 8 places the sources' precision supports (4.10 is 0.041).
 * @param {string} text - The number as published.
 * @returns {number} The fraction.
 */
function percentToFraction(text) {
  return Math.round(Number(text) * 1e6) / 1e8;
}

/**
 * @description The single file inside a ZIP archive (stored or deflated), read from its central directory.
 * @param {Buffer} zip - Archive bytes.
 * @returns {Buffer} The first file's bytes.
 */
function firstZipEntry(zip) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('the file is not a ZIP archive');
  const central = zip.readUInt32LE(end + 16);
  if (zip.readUInt32LE(central) !== 0x02014b50) throw new Error('the ZIP directory is damaged');
  const method = zip.readUInt16LE(central + 10), size = zip.readUInt32LE(central + 20), unzipped = zip.readUInt32LE(central + 24), local = zip.readUInt32LE(central + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50 || unzipped > MAX_UNZIPPED) throw new Error('the ZIP entry is damaged or too large');
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), data = zip.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED });
  throw new Error(`unsupported ZIP compression ${method}`);
}

/**
 * @description The French library's daily three-factor CSV as rows [YYYY-MM-DD, Mkt-RF, SMB, HML, RF] in fractions.
 * @param {string} text - CSV text.
 * @returns {Array<[string, number, number, number, number]>} Rows, oldest first.
 */
function parseFamaFrench(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d{4})(\d{2})(\d{2})\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(line);
    if (m) rows.push([`${m[1]}-${m[2]}-${m[3]}`, ...[m[4], m[5], m[6], m[7]].map(percentToFraction)]);
  }
  return rows;
}

/**
 * @description The Treasury's daily bill-rate CSV as rows [YYYY-MM-DD, 13-week coupon-equivalent rate] in fractions.
 * @param {string} text - CSV text (newest first, MM/DD/YYYY dates, a quoted header row).
 * @returns {Array<[string, number]>} Rows, oldest first; days without a 13-week rate are skipped.
 */
function parseTreasuryBills(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean), header = (lines[0] || '').split(',').map((h) => h.replace(/"/g, '').trim().toUpperCase());
  const col = header.indexOf('13 WEEKS COUPON EQUIVALENT');
  if (col < 0) throw new Error('the file has no 13-week coupon-equivalent column');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(','), d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((cells[0] || '').trim()), v = (cells[col] || '').trim();
    if (d && /^-?\d+(\.\d+)?$/.test(v)) rows.push([`${d[3]}-${d[1]}-${d[2]}`, percentToFraction(v)]);
  }
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * @description The Treasury's bill-rate file for one year.
 * @param {number} year - Calendar year.
 * @returns {string} The address.
 */
function treasuryUrl(year) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_bill_rates&field_tdr_date_value=${year}&page&_format=csv`;
}

/**
 * @description One network read that can never outlast the pass's budget: the kernel is asked to end it at the deadline
 * (timeoutMs, 100 to 20 000 ms), the fetch is aborted then, and the read is abandoned then whatever the transport does.
 * @param {object} deps - {fetch}.
 * @param {string} url - Address.
 * @param {boolean} binary - Whether to read bytes.
 * @param {number} deadline - Epoch milliseconds (real clock) to give up at.
 * @returns {Promise<Buffer|string>} The body.
 */
function boundedRead(deps, url, binary, deadline) {
  const left = Math.max(1, deadline - Date.now()), timeoutMs = Math.min(20000, Math.max(100, Math.ceil(left)));
  const read = (async () => {
    // Accept */* exactly: the French library answers 406 to application/zip and 404 to no Accept at all.
    const response = await deps.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, redirect: 'error', signal: AbortSignal.timeout(left), timeoutMs });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.text();
  })();
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${READ_BUDGET_MS / 1000} s`)), left); if (timer.unref) timer.unref(); });
  return Promise.race([read, limit]).finally(() => clearTimeout(timer));
}

/** The reference sources: how old a copy may get, and how a pass reads a fresh one. */
const SOURCES = Object.freeze({
  'rf-tbill': {
    name: '3-month Treasury bill rate', maxAgeMs: 86400000,
    load: async (deps, deadline) => {
      const year = new Date(deps.time()).getUTCFullYear(), rows = parseTreasuryBills(await boundedRead(deps, treasuryUrl(year), false, deadline));
      if (!rows.length) throw new Error(`the ${year} file has no rates yet`);
      const [date, rate] = rows[rows.length - 1];
      return { rows: rows.slice(-KEEP_ROWS), latest: { date, rate }, source: treasuryUrl(year), attribution: BILL_ATTRIBUTION };
    },
  },
  'ff3-daily': {
    name: 'Fama-French daily factors', maxAgeMs: 7 * 86400000,
    load: async (deps, deadline) => {
      const rows = parseFamaFrench(firstZipEntry(await boundedRead(deps, FF3_URL, true, deadline)).toString('latin1'));
      if (rows.length < 250) throw new Error('the file held no daily factor table');
      return { rows: rows.slice(-KEEP_ROWS), asOf: rows[rows.length - 1][0], source: FF3_URL, attribution: FF3_ATTRIBUTION, columns: ['date', 'Mkt-RF', 'SMB', 'HML', 'RF'] };
    },
  },
});

/**
 * @description Out of band (a Quant desk pass only): read the first source whose copy is missing or old and that is not
 * resting after a failure, inside the hard budget, and keep the copy or the failure's reason. Never more than one read,
 * and none where the read could not be ended in time (readsBounded).
 * @param {object} deps - {pool, fetch, time}.
 * @param {string} sub - Owner (the cache is the person's own).
 * @returns {Promise<{refreshed:string|null, ok?:boolean, reason?:string}>} What the pass did.
 */
async function refreshReferences(deps, sub) {
  if (typeof deps.fetch !== 'function') return { refreshed: null };
  if (!readsBounded()) return { refreshed: null, reason: `Not read: ${NOT_READ_HERE}.` };
  for (const [key, source] of Object.entries(SOURCES)) {
    const [cached, status] = await Promise.all([store.getRecord(deps.pool, sub, 'reference', key), store.getRecord(deps.pool, sub, 'reference-status', key)]);
    if (cached && deps.time() - Date.parse(cached.fetchedAt) < source.maxAgeMs) continue;
    if (status && deps.time() - Date.parse(status.failedAt) < RETRY_AFTER_MS) continue;
    try {
      const record = { ...await source.load(deps, Date.now() + READ_BUDGET_MS), fetchedAt: new Date(deps.time()).toISOString() };
      await store.putRecord(deps.pool, sub, 'reference', key, record);
      return { refreshed: key, ok: true };
    } catch (err) {
      const reason = String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 160);
      await store.putRecord(deps.pool, sub, 'reference-status', key, { failedAt: new Date(deps.time()).toISOString(), reason });
      return { refreshed: key, ok: false, reason };
    }
  }
  return { refreshed: null };
}

/**
 * @description A reference source's cached copy, never the network: an interactive tool answers at once, and says the
 * copy's age or why there is none.
 * @param {object} deps - {pool, time}.
 * @param {string} sub - Owner.
 * @param {string} key - Source key.
 * @returns {Promise<object>} {ok:true, ...copy} or {ok:false, unavailable}.
 */
async function readReference(deps, sub, key) {
  const source = SOURCES[key], cached = await store.getRecord(deps.pool, sub, 'reference', key);
  if (cached) return { ok: true, ...cached, ...(deps.time() - Date.parse(cached.fetchedAt) > source.maxAgeMs ? { stale: `This copy was read ${cached.fetchedAt}; the Quant desk's next pass refreshes it.` } : {}) };
  if (!readsBounded()) return { ok: false, unavailable: `The ${source.name} is unavailable right now: ${NOT_READ_HERE}. Nothing is filled in.` };
  const status = await store.getRecord(deps.pool, sub, 'reference-status', key);
  const why = status ? `its last read failed (${status.reason}, ${status.failedAt})` : 'it has not been loaded yet';
  return { ok: false, unavailable: `The ${source.name} is unavailable right now: ${why}. The Quant desk loads it on its next pass (its evening job, or Run now on the Quant desk); nothing is filled in meanwhile.` };
}

/**
 * @description The cached official daily Fama-French three factors.
 * @param {object} deps - {pool, time}.
 * @param {string} sub - Owner.
 * @returns {Promise<object>} {ok, rows, asOf, source, attribution} or {ok:false, unavailable}.
 */
function famaFrenchDaily(deps, sub) {
  return readReference(deps, sub, 'ff3-daily');
}

/**
 * @description The annual risk-free rate a tool should use, at once: the person's own figure when given, otherwise the
 * cached 3-month Treasury bill rate (dated), otherwise zero with the reason the rate is unavailable right now.
 * @param {object} deps - {pool, time}.
 * @param {string} sub - Owner.
 * @param {*} given - The question's riskFree, when supplied.
 * @param {(input:object, key:string, fallback:number) => number} num - The calculator's number reader.
 * @returns {Promise<{value:number, source:string}>} The rate and where it came from.
 */
async function riskFreeFor(deps, sub, given, num) {
  if (given != null && given !== '') return { value: num({ riskFree: given }, 'riskFree', 0), source: 'given in the question' };
  const bill = await readReference(deps, sub, 'rf-tbill');
  if (bill.ok) return { value: bill.latest.rate, source: `3-month Treasury bill rate (13-week coupon equivalent) on ${bill.latest.date}, U.S. Treasury${bill.stale ? ` (${bill.stale})` : ''}` };
  return { value: 0, source: `Rate unavailable right now, so zero is used. ${bill.unavailable}` };
}

module.exports = { FF3_URL, FF3_ATTRIBUTION, BILL_ATTRIBUTION, READ_BUDGET_MS, RETRY_AFTER_MS, USER_AGENT, SOURCES, firstZipEntry, parseFamaFrench, parseTreasuryBills, treasuryUrl, readsBounded, boundedRead, refreshReferences, readReference, famaFrenchDaily, riskFreeFor };
