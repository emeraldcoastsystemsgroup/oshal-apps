/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Initial guard for "pops" (price since announced) over the COMPILED module: side-aware move math, the candle price precedence and the backward walk past empty candles, the bounded/spaced/cached fetch driven by a fake candle transport and a fake clock, a rate-limited ticker counted rather than thrown, the open-only caller-scoped read, and the structural checks that the compiled router really wires the framework's getCandles behind callerSub and the surface really has the column.
 *
 * 2026-09-16 12:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Pin the cross-user shape of the ONE per-process pop cache: two callers alerted on the same ticker at different prices, and a side flip, must each be served their OWN announced price and side off a single shared market read. The suite had a hole exactly where the design was wrong — it only ever drove one caller per cache.
 *
 * Dependency-free `node --test` suite (store-CI contract) over routes/kalshi-pops.js — the bytes
 * the running framework requires. The boundary this guard crosses is the RATE-LIMITED READ, not
 * Kalshi's wire format: the real fetchPops runs against a fake CandleReader and a fake clock, so
 * the cap, the spacing, the cache and the per-market failure path are exercised for real. The
 * structural assertions keep that honest — they fail if the route stops handing fetchPops the
 * framework's actual getCandles, which is the one thing a fake transport cannot prove.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const pops = require(path.join(PKG, 'routes', 'kalshi-pops.js'));
const {
  POP_MAX_MARKETS, POP_MIN_INTERVAL_MS, POP_CACHE_TTL_MS, POP_MAX_SPAN_DAYS,
  createPopCache, sidePrice, candleYesPrice, latestYesPrice, popFrom, candleWindow,
  fetchPops, readOpenAlerts, seriesFromTicker,
} = pops;

/** One open alert as readOpenAlerts hands it to the fetcher. */
function alert(over) {
  return Object.assign({
    ticker: 'KXTEST-26SEP16-T1', seriesTicker: 'KXTEST', side: 'yes',
    announcedPrice: 0.38, announcedAt: '2026-09-15T12:00:00.000Z', title: 'A test market',
  }, over || {});
}

/** One candle, only the fields the price math reads. */
function candle(over) {
  return Object.assign({ endPeriodTs: 1789000000, close: null, mean: null, yesBidClose: null, yesAskClose: null }, over || {});
}

test('a pick is priced on ITS OWN side: the NO side is 1 - yes, both when announced and now', () => {
  assert.equal(sidePrice(0.6, 'yes'), 0.6);
  assert.ok(Math.abs(sidePrice(0.6, 'no') - 0.4) < 1e-12);
  // Announced NO at 40c; YES is now 55c, so NO is 45c — the market moved 5c TOWARD the pick.
  const p = popFrom(alert({ side: 'no', announcedPrice: 0.4 }), { price: 0.55, basis: 'mid', endPeriodTs: 1789000000 });
  assert.ok(Math.abs(p.currentPrice - 0.45) < 1e-12);
  assert.ok(Math.abs(p.moveCents - 5) < 1e-9);
  assert.equal(p.toward, true);
  assert.ok(Math.abs(p.moveFraction - 0.05 / 0.4) < 1e-12);
  // Read the YES side of the same move and it is a 5c move AWAY (0.60 announced -> 0.55).
  const q = popFrom(alert({ side: 'yes', announcedPrice: 0.6 }), { price: 0.55, basis: 'mid', endPeriodTs: 1789000000 });
  assert.ok(Math.abs(q.moveCents + 5) < 1e-9);
  assert.equal(q.toward, false);
});

test('an announced price that is not a usable probability has nothing to move FROM', () => {
  const latest = { price: 0.5, basis: 'mid', endPeriodTs: 1789000000 };
  assert.equal(popFrom(alert({ announcedPrice: null }), latest), null);
  assert.equal(popFrom(alert({ announcedPrice: Number.NaN }), latest), null);
  assert.equal(popFrom(alert({ announcedPrice: 1.4 }), latest), null);
  // Zero is a usable price but there is no percentage of it — the cents move still stands.
  const zero = popFrom(alert({ announcedPrice: 0 }), latest);
  assert.equal(zero.moveFraction, null);
  assert.ok(Math.abs(zero.moveCents - 50) < 1e-9);
});

test('candle price precedence: the book mid, then the last trade, then the period mean', () => {
  assert.deepEqual(candleYesPrice(candle({ yesBidClose: 0.4, yesAskClose: 0.5, close: 0.9, mean: 0.1 })), { price: 0.45, basis: 'mid' });
  assert.deepEqual(candleYesPrice(candle({ yesBidClose: 0.4, close: 0.9, mean: 0.1 })), { price: 0.9, basis: 'close' });
  assert.deepEqual(candleYesPrice(candle({ mean: 0.1 })), { price: 0.1, basis: 'mean' });
  assert.equal(candleYesPrice(candle({})), null);
  // Out of a contract's 0..1 range, or not a number at all, is not a price.
  assert.equal(candleYesPrice(candle({ close: 1.7 })), null);
  assert.equal(candleYesPrice(candle({ close: -0.2 })), null);
  assert.equal(candleYesPrice(candle({ close: Number.NaN })), null);
});

test('the latest price walks BACKWARD past empty candles instead of taking the last element', () => {
  const latest = latestYesPrice([
    candle({ endPeriodTs: 1, close: 0.2 }),
    candle({ endPeriodTs: 2, close: 0.3 }),
    candle({ endPeriodTs: 3 }),
    candle({ endPeriodTs: 4 }),
  ]);
  assert.deepEqual(latest, { price: 0.3, basis: 'close', endPeriodTs: 2 });
  assert.equal(latestYesPrice([]), null);
  assert.equal(latestYesPrice([candle({ endPeriodTs: 9 })]), null);
});

test('the candle window is hourly, starts at the announcement, and is clamped and never inverted', () => {
  const now = Date.parse('2026-09-16T00:00:00.000Z');
  const w = candleWindow('2026-09-15T12:00:00.000Z', now);
  assert.equal(w.periodInterval, 60);
  assert.equal(w.endTs, Math.floor(now / 1000));
  assert.equal(w.startTs, Math.floor(Date.parse('2026-09-15T12:00:00.000Z') / 1000));
  // A year-old alert asks for POP_MAX_SPAN_DAYS of candles, not a year of them.
  const old = candleWindow('2025-09-16T00:00:00.000Z', now);
  assert.equal(old.startTs, Math.floor((now - POP_MAX_SPAN_DAYS * 86400000) / 1000));
  // An unparseable or future announcement still yields a forward range.
  assert.ok(candleWindow('not-a-date', now).startTs <= candleWindow('not-a-date', now).endTs);
  assert.ok(candleWindow('2099-01-01T00:00:00.000Z', now).startTs <= w.endTs);
});

/** A fake candle transport + fake clock: records when each read happened, by the injected clock. */
function transport(behaviour) {
  const calls = [];
  const clock = { t: Date.parse('2026-09-16T00:00:00.000Z') };
  const reader = async (series, ticker, startTs, endTs, interval) => {
    calls.push({ series, ticker, startTs, endTs, interval, at: clock.t });
    return behaviour(ticker);
  };
  return {
    calls, clock, reader,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
  };
}

const PRICED = [candle({ endPeriodTs: 1789000000, yesBidClose: 0.44, yesAskClose: 0.46 })];

test('the fetch is CAPPED: past the cap the remaining open alerts are deferred, not read', async () => {
  const t = transport(() => PRICED);
  const alerts = [];
  for (let i = 0; i < 20; i++) alerts.push(alert({ ticker: 'KXTEST-T' + i }));
  const out = await fetchPops(alerts, t.reader, { cache: createPopCache(), now: t.now, sleep: t.sleep, cap: 3 });
  assert.equal(t.calls.length, 3);
  assert.equal(out.pops.length, 3);
  assert.equal(out.deferred, 17);
  assert.equal(out.open, 20);
  assert.equal(out.cap, 3);
  // The default cap is the shipped one, so a caller that passes nothing is still bounded.
  const dflt = await fetchPops(alerts, transport(() => PRICED).reader, { cache: createPopCache(), now: t.now, sleep: t.sleep });
  assert.equal(dflt.cap, POP_MAX_MARKETS);
  assert.equal(dflt.pops.length, POP_MAX_MARKETS);
});

test('the fetch is SPACED: consecutive candle reads are at least POP_MIN_INTERVAL_MS apart', async () => {
  const t = transport(() => PRICED);
  const alerts = [alert({ ticker: 'A' }), alert({ ticker: 'B' }), alert({ ticker: 'C' })];
  await fetchPops(alerts, t.reader, { cache: createPopCache(), now: t.now, sleep: t.sleep });
  assert.equal(t.calls.length, 3);
  for (let i = 1; i < t.calls.length; i++) {
    assert.ok(t.calls[i].at - t.calls[i - 1].at >= POP_MIN_INTERVAL_MS,
      `read ${i} came ${t.calls[i].at - t.calls[i - 1].at}ms after the last — under the ${POP_MIN_INTERVAL_MS}ms floor`);
  }
  // The clock lives in the CACHE, so a second request queues behind the first rather than bursting.
  const shared = createPopCache();
  const t2 = transport(() => PRICED);
  await fetchPops([alert({ ticker: 'D' })], t2.reader, { cache: shared, now: t2.now, sleep: t2.sleep });
  const firstAt = t2.calls[0].at;
  await fetchPops([alert({ ticker: 'E' })], t2.reader, { cache: shared, now: t2.now, sleep: t2.sleep });
  assert.equal(t2.calls.length, 2);
  assert.ok(t2.calls[1].at - firstAt >= POP_MIN_INTERVAL_MS);
});

test('the fetch is CACHED inside the TTL and re-reads once it lapses', async () => {
  const shared = createPopCache();
  const t = transport(() => PRICED);
  const one = [alert({ ticker: 'KXCACHE-1' })];
  await fetchPops(one, t.reader, { cache: shared, now: t.now, sleep: t.sleep });
  assert.equal(t.calls.length, 1);
  const again = await fetchPops(one, t.reader, { cache: shared, now: t.now, sleep: t.sleep });
  assert.equal(t.calls.length, 1, 'a cached market must not spend another request');
  assert.equal(again.pops.length, 1);
  assert.equal(again.checked, 1);
  t.clock.t += POP_CACHE_TTL_MS + 1;
  await fetchPops(one, t.reader, { cache: shared, now: t.now, sleep: t.sleep });
  assert.equal(t.calls.length, 2, 'a lapsed entry must be re-read');
});

test('the cache is per MARKET, not per caller: each caller keeps its OWN announced price and side', async () => {
  // THE LEAK THIS PINS: the cache is ONE per process (the route holds it so the rate-limit clock
  // survives across requests), so an entry keyed by ticker alone that held a derived Pop handed
  // the second caller the FIRST caller's announced price and side. It is reachable in normal
  // operation, not a race: first-seen dedup is per user (kalshi_scan_alerts UNIQUE(user_sub,ticker)),
  // so two users alerted on one ticker in different scan cycles carry different detail.price.
  const shared = createPopCache();
  const t = transport(() => [candle({ endPeriodTs: 1789000000, yesBidClose: 0.49, yesAskClose: 0.51 })]);
  const TICKER = 'KXSHARED-26SEP16-T1';
  const read = (over) => fetchPops([alert(Object.assign({ ticker: TICKER }, over))], t.reader,
    { cache: shared, now: t.now, sleep: t.sleep });

  const a = await read({ announcedPrice: 0.38, side: 'yes' });   // caller A was alerted at 38c
  const b = await read({ announcedPrice: 0.44, side: 'yes' });   // caller B, same ticker, at 44c
  assert.equal(t.calls.length, 1, 'the MARKET is still fetched once — that is what the cache is for');
  assert.equal(a.pops[0].announcedPrice, 0.38);
  assert.equal(b.pops[0].announcedPrice, 0.44, 'caller B was served another caller\u2019s announced price');
  assert.ok(Math.abs(a.pops[0].moveCents - 12) < 1e-9);
  assert.ok(Math.abs(b.pops[0].moveCents - 6) < 1e-9, 'caller B was served another caller\u2019s move');
  // The shared half IS shared: both read the same market at the same price, from one candle read.
  assert.ok(Math.abs(a.pops[0].currentPrice - 0.5) < 1e-12);
  assert.ok(Math.abs(b.pops[0].currentPrice - 0.5) < 1e-12);
  assert.equal(a.pops[0].basis, 'mid');
  assert.equal(b.pops[0].basis, 'mid');

  // A SIDE flip between scan cycles is the same defect: a NO pick must be priced on the NO side.
  const c = await read({ announcedPrice: 0.56, side: 'no' });
  assert.equal(t.calls.length, 1);
  assert.equal(c.pops[0].side, 'no', 'the NO caller was served the cached YES side');
  assert.ok(Math.abs(c.pops[0].currentPrice - 0.5) < 1e-12);
  assert.ok(Math.abs(c.pops[0].moveCents + 6) < 1e-9);
  assert.equal(c.pops[0].toward, false);

  // A caller whose own announced price is unusable gets nothing — and does NOT poison the entry
  // for the next caller, who still pays no extra request.
  const d = await read({ announcedPrice: null });
  assert.equal(d.pops.length, 0);
  assert.equal(d.unavailable, 1);
  assert.equal(d.checked, 1);
  const e = await read({ announcedPrice: 0.38, side: 'yes' });
  assert.equal(t.calls.length, 1);
  assert.equal(e.pops[0].announcedPrice, 0.38);
});

test('one market failing (a 429, a dead series) is COUNTED, and never blanks the others', async () => {
  const seen = [];
  const t = transport((ticker) => {
    if (ticker === 'KXRATE-2') { const e = new Error('too many requests'); e.status = 429; throw e; }
    if (ticker === 'KXRATE-3') return [];
    return PRICED;
  });
  const out = await fetchPops(
    [alert({ ticker: 'KXRATE-1' }), alert({ ticker: 'KXRATE-2' }), alert({ ticker: 'KXRATE-3' }),
      alert({ ticker: 'KXRATE-4' }), alert({ ticker: 'KXRATE-5', seriesTicker: null })],
    t.reader,
    { cache: createPopCache(), now: t.now, sleep: t.sleep, onError: (err, ticker) => seen.push([ticker, err.status]) },
  );
  assert.deepEqual(out.pops.map((p) => p.ticker), ['KXRATE-1', 'KXRATE-4']);
  assert.equal(out.unavailable, 3, 'the throw, the empty tape and the seriesless ticker all count');
  assert.deepEqual(seen, [['KXRATE-2', 429]], 'a swallowed failure is reported to the caller’s logger');
  // A market with no series is never even requested — there is nothing to ask for.
  assert.ok(!t.calls.some((c) => c.ticker === 'KXRATE-5'));
});

/** A fake pool that records the SQL it was asked and answers with fixed rows. */
function pool(rows) {
  const asked = [];
  return { asked, query: async (text, params) => { asked.push({ text, params }); return { rows }; } };
}

test('the open-alert read is caller-scoped, excludes settled markets, and prefers what was ANNOUNCED', async () => {
  const p = pool([
    { ticker: 'KXA-1', detail: { side: 'no', price: 0.41, title: 'Announced title' }, created_at: '2026-09-15T12:00:00.000Z',
      series_ticker: 'KXA', ledger_side: 'yes', ledger_price: 0.77 },
    { ticker: 'KXB-2', detail: null, created_at: '2026-09-15T13:00:00.000Z',
      series_ticker: null, ledger_side: 'yes', ledger_price: 0.33 },
  ]);
  const out = await readOpenAlerts(p, 'user-1', 'calibration', 50);
  const sql = p.asked[0].text;
  assert.match(sql, /FROM kalshi_scan_alerts/);
  assert.match(sql, /a\.user_sub = \$1/, 'the read must be scoped to the caller');
  assert.match(sql, /p\.settled IS NOT TRUE/, 'a settled market has an outcome, not a move');
  assert.deepEqual(p.asked[0].params, ['user-1', 'calibration', 50]);
  // detail wins over the ledger row: it is what the alert actually quoted.
  assert.equal(out[0].side, 'no');
  assert.equal(out[0].announcedPrice, 0.41);
  assert.equal(out[0].title, 'Announced title');
  assert.equal(out[0].seriesTicker, 'KXA');
  // No detail: fall back to the ledger, and derive the series from the ticker.
  assert.equal(out[1].side, 'yes');
  assert.equal(out[1].announcedPrice, 0.33);
  assert.equal(out[1].seriesTicker, 'KXB');
  assert.equal(seriesFromTicker('KXNOSEGMENTS'), null);
  // The row cap is clamped, never passed through raw.
  await readOpenAlerts(p, 'user-1', 'calibration', 9999);
  assert.equal(p.asked[p.asked.length - 1].params[2], 200);
});

test('the compiled pops module stands alone (no framework requires) and only reads', () => {
  const src = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-pops.js'), 'utf8');
  assert.doesNotMatch(src, /require\("@\//, 'kalshi-pops must not depend on the framework — it loads under plain node');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
  assert.match(src, /FROM kalshi_scan_alerts/);
});

test('the compiled router serves GET /alerts/pops caller-scoped, through the FRAMEWORK getCandles', () => {
  const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
  // The framework's real client is what the route hands the fetcher — the fake transport above
  // proves the bounding, this proves it bounds the actual exchange read.
  assert.match(routes, /require\("@\/features\/prediction-markets"\)/);
  const i = routes.indexOf("router.get('/alerts/pops'");
  assert.ok(i >= 0, 'GET /alerts/pops must be mounted');
  const handler = routes.slice(i, i + 1200);
  assert.match(handler, /callerSub\)\(req\)/);
  assert.match(handler, /401/);
  assert.match(handler, /readOpenAlerts\)\(pool/);
  assert.match(handler, /fetchPops\)\(open, prediction_markets_1\.getCandles,/);
  assert.match(handler, /cache: popCache/, 'the cache carries the rate-limit clock across requests');
});

test('the surface shows the move on OPEN alerts only, and says when it ran out of requests', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  assert.match(html, /<th>Since announced<\/th>/);
  assert.match(html, /data-pop-ticker=/);
  assert.match(html, /id="alert-pops-note"/);
  assert.match(html, /\/api\/kalshi\/alerts\/pops/);
  // A settled row gets the em dash, not a pending cell: settled has an outcome, not a move.
  assert.match(html, /a\.settled === true/);
  assert.match(html, /data-pop-ticker="' \+ esc\(a\.ticker\)/);
  // The pops read is fired AFTER the table renders, never in front of it.
  const alertsRender = html.indexOf("setBadge('badge-alerts'");
  const popsCall = html.indexOf('loadPops();', alertsRender);
  assert.ok(alertsRender >= 0 && popsCall > alertsRender);
});
