/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A futures chart (/ESZ26, /CL) reaches the Schwab bars read with its slash intact; it had been stripped to the stock ticker (ES = Eversource). A stock symbol is unchanged, and without a Schwab rail a futures chart is refused in words.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {standIns,loadShipped} = require('./support/native-landing-host');
const PKG = path.resolve(__dirname,'..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || (process.env.OSHAL_FRAMEWORK ? path.join(process.env.OSHAL_FRAMEWORK,'node_modules') : path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express = require(path.join(TOOLCHAIN,'express'));

async function host(t, schwab) {
  const asked = [];
  const modules = standIns({express});
  modules['@/features/trading'] = {...modules['@/features/trading'],nativeSchwabReads:schwab};
  const ctx = {pool:{query:async () => ({rows:[]})},intent:async (name,input) => {
    if (name === 'trading.config') return {configured:true};
    if (name === 'trading.bars') { asked.push(input.symbol); return {symbol:input.symbol,timeframe:input.timeframe,source:'schwab',bars:[{t:1,o:6700,h:6710,l:6690,c:6705,v:1000}]}; }
    throw new Error('unexpected native intent '+name);
  }};
  let charts; loadShipped(modules,load => { charts = load('trading-charts-routes').createTradingChartsRoutes(ctx); });
  const app = express(); app.use((req,_res,next) => {req.oshalCallerSub='futures-owner';req.userSub='futures-owner';next();}); app.use('/c',charts);
  const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',() => resolve(s));});
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = async (q) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/c/bars?${q}`); return {status:r.status, body:await r.json()}; };
  return {asked, get};
}

test('a futures contract reaches the Schwab bars read as written; a stock symbol is unchanged', async t => {
  const {asked, get} = await host(t, true);
  for (const q of ['symbol=%2FESZ26&timeframe=1Hour', 'symbol=%2Fcl&timeframe=1Day', 'symbol=NVDA&timeframe=1Day', 'symbol=BRK.B&timeframe=1Day']) {
    const r = await get(q); assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.deepEqual(asked, ['/ESZ26', '/CL', 'NVDA', 'BRK.B'], 'the slash survives; ES is never asked for /ES');
});

test('without a Schwab rail a futures chart is refused in words, never drawn from a stock', async t => {
  const {asked, get} = await host(t, false);
  const r = await get('symbol=%2FES&timeframe=1Day');
  assert.deepEqual([r.status, r.body.error], [400, 'futures_chart_unavailable']);
  assert.match(r.body.message, /Schwab/);
  assert.deepEqual(asked, []);
});
