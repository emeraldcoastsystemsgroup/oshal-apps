/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native Futures study's data source - the person's own Schwab connection through the kernel's trading.bars read. Each dated contract (/ESZ26) is read as written, paged back window by window for intraday timeframes, and every bar's true UTC instant becomes the exchange wall-clock stamp the engine's session rules read (New York, the engine's convention). A contract Schwab no longer serves reads empty, never invented.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Every contract window reads the LIVE dated contract (the one trading now, /ESZ26). Schwab no longer serves expired contracts, so the first run on the owner's account had ES hourly bars only from 2026-09-10, the day ESZ26 became the front month; the live contract's own earlier trading (as the deferred month) covers the window. The series is that one contract - no roll, no adjustment - and the run says so.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Bars keep their true UTC open (ms) beside the wall-clock stamp, and closedBars reads a contract's latest closed bars for forward research calls.
 *
 * @module futures/source
 */
'use strict';

const { contractsForRange } = require('./engine');

/** Each timeframe's span per read (the kernel's trading.bars window) and how far back a study may page. */
const SPAN_DAYS = { '1Hour': 45, '1Day': 400, '1Week': 2200 };
const MAX_PAGES = 9;
const DAY_MS = 86400000;

const WALL = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * @description A true UTC instant as the engine's New York wall-clock ISO stamp.
 * @param {number} ms - Epoch milliseconds.
 * @returns {string} 'YYYY-MM-DDTHH:MM:00.000Z' carrying New York wall time.
 */
function wallStamp(ms) {
  const part = {};
  for (const p of WALL.formatToParts(new Date(ms))) part[p.type] = p.value;
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:00.000Z`;
}

/**
 * @description The person's Schwab connection as a FuturesDataSource for one study run.
 * @param {{intent: Function}} ctx - Route context on the native kernel.
 * @param {() => number} [now] - Clock.
 * @returns {{name: string, configured: () => boolean, fetchBars: Function, reads: () => number}} The source.
 */
/**
 * @description The dated contract trading now for a root (its active window contains now).
 * @param {string} root - Futures root.
 * @param {number} at - Epoch ms.
 * @returns {{symbol: string}|null} The live contract.
 */
function liveContract(root, at) {
  const near = contractsForRange(root, new Date(at - 120 * DAY_MS), new Date(at + 120 * DAY_MS));
  return near.find((c) => c.activeStart.getTime() <= at && at < c.activeEnd.getTime()) || null;
}

function schwabFuturesSource(ctx, now = Date.now) {
  const cache = new Map();
  let reads = 0;
  async function series(symbol, timeframe, startMs) {
    const key = `${symbol}|${timeframe}|${startMs}`;
    if (cache.has(key)) return cache.get(key);
    const span = (SPAN_DAYS[timeframe] || 45) * DAY_MS, bars = new Map();
    let end = now();
    for (let page = 0; page < MAX_PAGES && end > startMs; page += 1) {
      reads += 1;
      const answer = await ctx.intent('trading.bars', { symbol, timeframe, end });
      for (const b of (answer && answer.bars) || []) bars.set(b.t, b);
      end -= span;
      if (timeframe !== '1Hour') break;
    }
    // `ms` keeps each bar's true UTC open beside the engine's wall-clock stamp: forward calls are timed and graded in real time.
    const rows = [...bars.values()].sort((a, b) => a.t - b.t).map((b) => ({ t: wallStamp(b.t * 1000), ms: b.t * 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    cache.set(key, rows);
    return rows;
  }
  return {
    /**
     * @description The latest closed bars of one dated contract (open + duration <= at), newest last.
     * @param {string} contract - Dated contract (ESZ26).
     * @param {string} timeframe - '1Hour' or '1Day'.
     * @param {number} at - True UTC cutoff (epoch ms).
     * @param {number} count - Most bars to keep.
     * @returns {Promise<object[]>} Closed bars with ms and closedMs.
     */
    async closedBars(contract, timeframe, at, count) {
      const width = timeframe === '1Day' ? DAY_MS : 3600000;
      const rows = await series('/' + contract, timeframe, at - (timeframe === '1Day' ? 400 : 90) * DAY_MS);
      return rows.map((b) => ({ ...b, closedMs: b.ms + width })).filter((b) => b.closedMs <= at).slice(-count);
    },
    name: 'schwab',
    configured: () => typeof ctx.intent === 'function',
    reads: () => reads,
    /**
     * @description Bars for one dated contract inside the window, ascending.
     * @param {{symbol: string}} contract - The dated contract (ESZ26).
     * @param {string} timeframe - '1Hour', '1Day' or '1Week'.
     * @param {{start?: Date, end?: Date}} [window] - Clamp.
     * @returns {Promise<object[]>} Bars.
     */
    async fetchBars(contract, timeframe, window = {}) {
      const startMs = window.start ? window.start.getTime() : now() - 365 * DAY_MS;
      const live = liveContract(contract.root, now()) || contract;
      const rows = await series('/' + live.symbol, timeframe, startMs);
      const lo = window.start ? window.start.getTime() : -Infinity, hi = window.end ? window.end.getTime() : Infinity;
      return rows.filter((b) => { const t = Date.parse(b.t); return t >= lo && t < hi; });
    },
  };
}

module.exports = { schwabFuturesSource, liveContract, wallStamp, SPAN_DAYS };
