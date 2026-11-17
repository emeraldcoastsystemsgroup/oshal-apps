/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2, from the 1.61.1 blue proof (a desk run took 22.8 s although the module stopped waiting at 1.5 s, because the kernel serves a package's outside read before it reads the package's answer): every read asks the kernel to end it within the pass's budget (timeoutMs), sends the plain agent the Treasury answers and an Accept of any type. The guard models the kernel's shape: the abort signal ends nothing, only timeoutMs does (20 s without it), and the desk run with that read must be over inside 2 seconds. On a kernel whose fetch does not say it honors timeoutMs, nothing is read and every answer says why. A failed source rests 30 minutes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1, after the blue proof (risk and factors answers took 20 seconds while FRED never answered): the bill rate is the Treasury's published file; interactive tools read only the cache and answer at once with "unavailable right now" and its reason; only a desk pass reads the network, one due source per pass, within 1.5 seconds, resting 30 minutes after a failure. The guard: a reference host that accepts a connection and never replies (the shape that bit) leaves every lab route and the desk's run answering in under 2 seconds.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's real reference data and option chains on made-up files and chains.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), net = require('node:net');
const ref = require('../routes/quant/lab-reference');
const { labHandlers } = require('../routes/quant/lab-routes');
const { quantHandlers } = require('../routes/quant/routes');
const { NOW, sessions, labContext, zipOf, famaFrenchCsv, madeUpChain, treasuryCsv } = require('./support/native-quant-lab-doubles');
const { randomSource } = require('../routes/quant/math/random');
const { num } = require('../routes/quant/lab-calculate');

const BILLS = treasuryCsv([['2026-11-12', 0.0421], ['2026-11-13', 0.0423], ['2026-11-16', 0.0426], ['2026-11-11', null]]);
const day = 86400000;

/**
 * @description Made-up daily factors on the doubles' session dates, and a stock whose excess return loads on them as planted.
 * @param {number} n - Sessions.
 * @returns {{rows:Array<Array>, bars:Array<object>}} Factor rows (fractions) and the stock's candles.
 */
function plantedFactors(n) {
  const rng = randomSource(77), dates = sessions(n).map((t) => new Date(t).toISOString().slice(0, 10)), rows = [], bars = [];
  let close = 100;
  dates.forEach((d, i) => {
    const m = 0.01 * rng.normal(), s = 0.005 * rng.normal(), h = 0.005 * rng.normal(), rf = 0.0001;
    rows.push([d, m, s, h, rf]);
    if (i) close *= 1 + rf + 1.2 * m + 0.5 * s - 0.3 * h + 0.002 * rng.normal();
    bars.push({ t: Date.parse(`${d}T05:00:00Z`) / 1000, o: close, h: close * 1.001, l: close * 0.999, c: close, v: 1e6 });
  });
  return { rows, bars };
}

/**
 * @description Pass deps over a made-up context, with a clock the test can move.
 * @param {object} shape - labContext options.
 * @returns {{deps:object, fetched:string[], clock:{now:number}, c:object}} Deps and the read log.
 */
function passDeps(shape) {
  const c = labContext(shape), clock = { now: NOW };
  return { c, clock, fetched: c.fetched, deps: { pool: c.ctx.pool, fetch: c.fetch, time: () => clock.now } };
}

test("the French library's ZIP and the Treasury's bill-rate file read exactly, in fractions; missing days are skipped", () => {
  const csv = famaFrenchCsv([['2026-09-29', 0.0123, -0.004, 0.002, 0.00017], ['2026-09-30', -0.0051, 0.001, -0.0007, 0.00017]]);
  const rows = ref.parseFamaFrench(ref.firstZipEntry(zipOf('F-F_Research_Data_Factors_daily.CSV', csv)).toString('latin1'));
  assert.deepEqual(rows.map((r) => r[0]), ['2026-09-29', '2026-09-30']);
  assert.ok(Math.abs(rows[0][1] - 0.0123) < 1e-12 && Math.abs(rows[1][4] - 0.00017) < 1e-12);
  assert.throws(() => ref.firstZipEntry(Buffer.from('not a zip at all, just text padding the end of the buffer')), /not a ZIP/);
  assert.deepEqual(ref.parseTreasuryBills(BILLS), [['2026-11-12', 0.0421], ['2026-11-13', 0.0423], ['2026-11-16', 0.0426]], 'oldest first, the blank day skipped, never filled');
  assert.throws(() => ref.parseTreasuryBills('Date,"4 WEEKS BANK DISCOUNT"\n11/16/2026,3.95'), /13-week/);
  assert.match(ref.treasuryUrl(2026), /^https:\/\/home\.treasury\.gov\/resource-center\/data-chart-center\/interest-rates\/daily-treasury-rates\.csv\/2026\/all\?type=daily_treasury_bill_rates&field_tdr_date_value=2026&page&_format=csv$/);
});

test('interactive reads never touch the network: no copy yet answers at once, unavailable right now, with the reason', async () => {
  const { deps, fetched } = passDeps({ schwab: true, references: { bills: BILLS } });
  const rf = await ref.riskFreeFor(deps, 'alice', null, num);
  assert.equal(rf.value, 0); assert.match(rf.source, /^Rate unavailable right now, so zero is used\. The 3-month Treasury bill rate is unavailable right now: it has not been loaded yet/);
  assert.match((await ref.famaFrenchDaily(deps, 'alice')).unavailable, /Fama-French daily factors is unavailable right now/);
  assert.deepEqual(await ref.riskFreeFor(deps, 'alice', '5%', num), { value: 0.05, source: 'given in the question' });
  assert.equal(fetched.length, 0, 'no interactive read reached the network');
});

test('a desk pass refreshes one due source within the budget; the copy then serves at once, dated and attributed', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => [new Date(Date.parse('2025-09-01') + i * day).toISOString().slice(0, 10), 0.001, 0, 0, 0.0001]);
  const { deps, fetched, clock, c } = passDeps({ schwab: true, references: { bills: BILLS, ff: zipOf('F-F.CSV', famaFrenchCsv(rows)) } });
  assert.deepEqual(await ref.refreshReferences(deps, 'alice'), { refreshed: 'rf-tbill', ok: true });
  assert.deepEqual(await ref.refreshReferences(deps, 'alice'), { refreshed: 'ff3-daily', ok: true });
  assert.deepEqual(await ref.refreshReferences(deps, 'alice'), { refreshed: null }, 'both fresh: no read');
  assert.equal(fetched.length, 2); assert.match(fetched[0], /^https:\/\/home\.treasury\.gov\//);
  const rf = await ref.riskFreeFor(deps, 'alice', null, num);
  assert.equal(rf.value, 0.0426); assert.match(rf.source, /13-week coupon equivalent\) on 2026-11-16, U\.S\. Treasury/);
  const ff = await ref.famaFrenchDaily(deps, 'alice');
  assert.ok(ff.ok && ff.rows.length === 300 && /Kenneth R\. French Data Library/.test(ff.attribution));
  clock.now += 2 * day;
  assert.match((await ref.riskFreeFor(deps, 'alice', null, num)).source, /the Quant desk's next pass refreshes it/, 'an old copy still serves, and says so');
  await assert.rejects(c.fetch('https://example.com/'), /refused in tests/, 'every other host stays offline');
});

test('every reference read sends the plain agent the Treasury answers and asks the kernel to end it within the budget', async () => {
  const seen = [], c = labContext({ schwab: true });
  const deps = { pool: c.ctx.pool, time: () => NOW, fetch: async (url, init) => { seen.push(init); return { ok: false, status: 503 }; } };
  await ref.refreshReferences(deps, 'alice'); await ref.refreshReferences(deps, 'alice');
  assert.equal(seen.length, 2);
  for (const { headers, timeoutMs } of seen) {
    assert.equal(headers['User-Agent'], ref.USER_AGENT);
    assert.doesNotMatch(headers['User-Agent'], /[()@]/, 'the agent that hung on the Treasury carried "(maintainer@...)"');
    assert.equal(headers.Accept, '*/*', 'the French library answers 406 to application/zip and 404 to no Accept at all');
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= ref.READ_BUDGET_MS, `timeoutMs ${timeoutMs}`);
  }
});

test('a failed read is recorded with its reason and rests 30 minutes before the next try', async () => {
  const { deps, fetched, clock } = passDeps({ schwab: true, references: { bills: null, ff: null } });
  const first = await ref.refreshReferences(deps, 'alice');
  assert.equal(first.ok, false); assert.match(first.reason, /HTTP 503/);
  assert.match((await ref.riskFreeFor(deps, 'alice', null, num)).source, /its last read failed \(HTTP 503/);
  assert.equal((await ref.refreshReferences(deps, 'alice')).refreshed, 'ff3-daily', 'the resting source is skipped; the next due one is tried');
  assert.deepEqual(await ref.refreshReferences(deps, 'alice'), { refreshed: null }, 'both resting');
  clock.now += 20 * 60000;
  assert.deepEqual(await ref.refreshReferences(deps, 'alice'), { refreshed: null }, 'still resting after 20 minutes');
  clock.now += 11 * 60000;
  assert.equal((await ref.refreshReferences(deps, 'alice')).refreshed, 'rf-tbill', 'tried again after 30 minutes');
  assert.equal(fetched.length, 3);
});

/**
 * @description Run a test body as the package runs inside the kernel (OSHAL_EGRESS=kernel, the kernel's global fetch), then
 * put the process back.
 * @param {object} t - The test context.
 * @param {boolean} honorsTimeoutMs - Whether the kernel's fetch says it ends a read at timeoutMs.
 */
function insideKernel(t, honorsTimeoutMs) {
  const prior = { egress: process.env.OSHAL_EGRESS, fetch: globalThis.fetch };
  t.after(() => {
    if (prior.egress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = prior.egress;
    globalThis.fetch = prior.fetch;
  });
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = Object.assign(async () => { throw new Error('the kernel fetch is not called directly here'); }, honorsTimeoutMs ? { honorsTimeoutMs: true } : {});
}

/**
 * @description A reference host that accepts and never answers, served the way the kernel serves a package's read: the
 * package's abort signal ends nothing; the kernel ends the read at timeoutMs, or after its own 20 seconds without one.
 * @returns {{fetch:Function, reads:Array<{timeoutMs:number, over:Promise<number>}>}} The fetch and each read's end time.
 */
function kernelShapedSilentHost() {
  const reads = [];
  const fetch = (url, init) => {
    const ms = init.timeoutMs ?? 20000;
    const read = new Promise((_, reject) => { setTimeout(() => reject(new Error(`${new URL(url).host}: request did not complete in ${ms} ms`)), ms).unref(); });
    reads.push({ timeoutMs: init.timeoutMs, over: read.catch(() => Date.now()) });
    return read;
  };
  return { fetch, reads };
}

test("the kernel's shape: a host that accepts and never answers holds the desk's run under 2 seconds, read included", async (t) => {
  insideKernel(t, true);
  const silent = kernelShapedSilentHost(), c = labContext({ schwab: false });
  const desk = quantHandlers(c.ctx, { time: () => NOW, fetch: silent.fetch });
  const started = Date.now(), out = await desk.run('alice');
  assert.equal(silent.reads.length, 1, 'one read per pass');
  const over = await Promise.race([silent.reads[0].over, new Promise((resolve) => { setTimeout(() => resolve(Infinity), 3000).unref(); })]);
  assert.ok(over - started < 2000, `the kernel held the read ${over - started} ms (asked timeoutMs ${silent.reads[0].timeoutMs})`);
  assert.ok(Date.now() - started < 2500 && out.status === 200, JSON.stringify(out.body));
  assert.match(out.body.reference.reason, /did not complete in \d+ ms|no answer within 1\.5 s/, JSON.stringify(out.body.reference));
});

test('on a kernel whose fetch cannot end a read early, the desk reads nothing and every answer says why', async (t) => {
  insideKernel(t, false);
  const silent = kernelShapedSilentHost(), c = labContext({ schwab: false });
  const desk = quantHandlers(c.ctx, { time: () => NOW, fetch: silent.fetch }), lab = labHandlers(c.ctx, { time: () => NOW });
  const started = Date.now(), out = await desk.run('alice');
  assert.ok(Date.now() - started < 500, 'no read was waited on');
  assert.equal(silent.reads.length, 0, 'nothing was read');
  assert.match(out.body.reference.reason, /^Not read: this installation's kernel cannot yet end an outside read early/);
  const risk = (await lab.stock('alice', { body: { symbol: 'SPY', view: 'risk' } })).body;
  assert.match(risk.riskFree.source, /^Rate unavailable right now, so zero is used\. The 3-month Treasury bill rate is unavailable right now: this installation's kernel cannot yet end an outside read early/);
});

test('a reference host that accepts and never answers: every lab route and the desk run answer in under 2 seconds', async (t) => {
  const sockets = new Set(), server = net.createServer((socket) => { sockets.add(socket); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const s of sockets) s.destroy(); return new Promise((resolve) => server.close(resolve)); });
  const silent = (url, init) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, init);
  const c = labContext({ schwab: false, chain: madeUpChain({ symbol: 'AAPL', spot: 200, rate: 0.04, days: [7] }) });
  const lab = labHandlers(c.ctx, { time: () => NOW, fetch: silent }), desk = quantHandlers(c.ctx, { time: () => NOW, fetch: silent });
  const calls = {
    explain: () => lab.explain('alice', { params: { concept: 'sharpe ratio' } }), calculate: () => lab.calculate('alice', { body: { kind: 'kelly', p: 0.6, b: 1 } }),
    ...Object.fromEntries(['risk', 'behavior', 'volatility', 'liquidity', 'factors'].map((view) => [view, () => lab.stock('alice', { body: { symbol: 'SPY', view } })])),
    portfolio: () => lab.portfolio('alice', { body: { symbols: 'SPY,AAPL', method: 'kelly' } }), pair: () => lab.pair('alice', { body: { a: 'SPY', b: 'AAPL' } }),
    simulate: () => lab.simulate('alice', { body: { symbol: 'SPY', horizonDays: 5 } }), options: () => lab.options('alice', { body: { symbol: 'AAPL' } }),
    overfitting: () => lab.overfitting('alice'), run: () => desk.run('alice'),
  };
  for (const [name, call] of Object.entries(calls)) {
    const started = Date.now(), out = await call();
    assert.ok(Date.now() - started < 2000, `${name} answered in ${Date.now() - started} ms`);
    assert.ok(out.status < 500, name);
    if (name === 'run') assert.match(out.body.reference.reason, /no answer within 1\.5 s|aborted|timeout/i, JSON.stringify(out.body.reference));
  }
  assert.ok(sockets.size >= 1, 'only the desk run tried the silent host');
  const risk = (await lab.stock('alice', { body: { symbol: 'SPY', view: 'risk' } })).body;
  assert.match(risk.riskFree.source, /its last read failed/);
});

test('the official three factors from the cache recover planted loadings, and say when they end before the prices', async () => {
  const { rows, bars } = plantedFactors(600);
  const c = labContext({ schwab: true, custom: { AAPL: bars }, references: { ff: zipOf('F-F.CSV', famaFrenchCsv(rows)), bills: BILLS } });
  const deps = { pool: c.ctx.pool, fetch: c.fetch, time: () => NOW };
  await ref.refreshReferences(deps, 'alice'); await ref.refreshReferences(deps, 'alice');
  const h = labHandlers(c.ctx, { time: () => NOW });
  const official = (await h.stock('alice', { body: { symbol: 'AAPL', view: 'factors', days: 504 } })).body.result.official;
  const loading = (name) => official.loadings.find((l) => l.name === name).estimate;
  assert.ok(Math.abs(loading('market') - 1.2) < 0.05 && Math.abs(loading('size') - 0.5) < 0.08 && Math.abs(loading('value') + 0.3) < 0.08, JSON.stringify(official.loadings));
  assert.match(official.attribution, /French/); assert.ok(official.days >= 400);
  const early = labContext({ schwab: true, custom: { AAPL: bars }, references: { ff: zipOf('F-F.CSV', famaFrenchCsv(rows.slice(0, 300))), bills: BILLS } });
  const earlyDeps = { pool: early.ctx.pool, fetch: early.fetch, time: () => NOW };
  await ref.refreshReferences(earlyDeps, 'alice'); await ref.refreshReferences(earlyDeps, 'alice');
  const gap = (await labHandlers(early.ctx, { time: () => NOW }).stock('alice', { body: { symbol: 'AAPL', view: 'factors', days: 100 } })).body.result.official;
  assert.match(gap.unavailable, /share \d+ days with these prices; 60 are needed/);
});

test('the option view fits a real-shaped chain: the smile, parity, the expected move and implied against historical volatility', async () => {
  const chain = madeUpChain({ symbol: 'AAPL', spot: 200, rate: 0.04, days: [7, 35, 63] });
  const c = labContext({ schwab: true, chain }), h = labHandlers(c.ctx, { time: () => NOW });
  const view = (await h.options('alice', { body: { symbol: 'aapl', riskFree: 0.04 } })).body;
  assert.equal(view.ok, true); assert.equal(view.source, 'schwab'); assert.equal(view.expirations.length, 3);
  const month = view.expirations[1];
  assert.ok(Math.abs(month.smile.atm - 0.25) < 0.01 && Math.abs(month.smile.skew + 0.2) < 0.05, JSON.stringify(month.smile));
  assert.ok(Math.abs(month.parity.medianGap) < 1e-3, 'Black-Scholes prices keep put-call parity');
  assert.ok(Math.abs(month.expectedMove - 200 * month.atmImpliedVolatility * Math.sqrt(35 / 365)) < 1e-3);
  assert.ok(month.atTheMoney.call.delta > 0.4 && month.atTheMoney.put.delta < 0, 'market Greeks of the at-the-money pair');
  assert.ok(view.historicalVolatility > 0 && view.plain.length >= 2);
  assert.deepEqual(c.reads.find((r) => r.name === 'trading.chains').input, { symbol: 'AAPL', strikeCount: 10 });
});

test('no chain is shown without Schwab, on a kernel without the read, or for a symbol with no listed options', async () => {
  const ask = async (shape) => (await labHandlers(labContext(shape).ctx, { time: () => NOW }).options('alice', { body: { symbol: 'AAPL' } })).body;
  assert.match((await ask({ schwab: false })).message, /none is connected, so no chain is shown/);
  assert.match((await ask({ schwab: true, optionChains: false })).message, /cannot read option chains yet/);
  assert.match((await ask({ schwab: true })).message, /Schwab lists no options for AAPL/);
});
