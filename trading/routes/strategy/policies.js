/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Persist selected stock universe and explicit Quant price signal within taxable margin account limits. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Separate versioned daily margin rotation from cash-funded retirement allocation; persisted configurations, not deployment defaults, determine behavior. */
'use strict';
const {createHash}=require('node:crypto');
const {PortfolioError}=require('../trading-portfolio-model');
const fail=(message)=>{throw new PortfolioError(422,'daily_strategy_invalid',message);};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const BASE={modelVersion:3,cadence:'daily',fractionalShares:false,preserveFractionalRemainders:true,borrowing:false,shorting:false,lookbackSessions:200,rebalanceSessions:1,transactionCostBps:25,marginAprPct:null,maintenancePct:null,initialTransitionTurnoverPct:200,minTradeEquityPct:1,validationVersion:'daily-replay-v1'};
const PRESETS=Object.freeze({
 'quant-stock-daily':{...BASE,kind:'quant-stock-daily',name:'Daily stock Quant rotation',accountClass:'taxable-margin',assets:[],rankBy:'momentum',lookbackSessions:253,topN:10,maxPositionPct:5,grossExposurePct:50,defensiveGrossPct:25,retainThroughRank:15,maxDailyTurnoverPct:10,hardStopPct:5,trailingStopPct:5,targetVolatilityPct:12},
 'quant-margin-daily':{...BASE,kind:'quant-margin-daily',name:'Daily Quant margin rotation',accountClass:'taxable-margin',assets:['SPY','EFA','IEF','GLD','DBC','VNQ'].map(symbol=>({symbol,weightPct:100/6})),topN:3,maxPositionPct:25,grossExposurePct:75,defensiveGrossPct:25,retainThroughRank:4,maxDailyTurnoverPct:25,hardStopPct:5,trailingStopPct:8,targetVolatilityPct:12},
 'retirement-defensive-daily':{...BASE,kind:'retirement-defensive-daily',name:'Daily defensive retirement allocation',accountClass:'retirement-cash',assets:[{symbol:'SPY',weightPct:30},{symbol:'EFA',weightPct:15},{symbol:'IEF',weightPct:20},{symbol:'GLD',weightPct:15}],topN:4,maxPositionPct:30,grossExposurePct:80,defensiveGrossPct:35,retainThroughRank:4,maxDailyTurnoverPct:10,hardStopPct:5,trailingStopPct:8,targetVolatilityPct:8},
});
const isDaily=c=>c?.modelVersion===3&&Object.hasOwn(PRESETS,c.kind);
function normalizePolicy(input){
 if(!isDaily(input))fail('Choose a supported daily strategy.');
 const base=PRESETS[input.kind];
 const allowed=new Set(Object.keys(base));for(const k of Object.keys(input))if(!allowed.has(k))fail('Unknown daily strategy setting: '+k);
 const out=JSON.parse(JSON.stringify(base));
 if(input.name!==undefined){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)fail('Use a bounded strategy label.');out.name=input.name;}
 // Algorithms and asset membership are versioned. Risk reductions can be saved per account.
 for(const k of ['grossExposurePct','defensiveGrossPct','maxPositionPct','maxDailyTurnoverPct','hardStopPct','trailingStopPct','targetVolatilityPct','transactionCostBps','minTradeEquityPct']){
  const n=input[k]??out[k];if(typeof n!=='number'||!Number.isFinite(n)||n<=0||n>100)fail(k+' must be a measured positive percentage.');out[k]=n;
 }
 for(const k of ['modelVersion','cadence','fractionalShares','preserveFractionalRemainders','borrowing','shorting','lookbackSessions','rebalanceSessions','initialTransitionTurnoverPct','accountClass','validationVersion','marginAprPct','maintenancePct','topN','retainThroughRank'])if(input[k]!==undefined&&input[k]!==base[k])fail(k+' differs from this strategy version.');
 if(input.kind==='quant-stock-daily'){
  if(!Array.isArray(input.assets)||input.assets.length<1||input.assets.length>20)fail('Save one to twenty explicitly selected equity symbols for this strategy.');
  if(input.assets.some(a=>!a||Object.keys(a).some(k=>!['symbol','weightPct'].includes(k))||typeof a.symbol!=='string'||!/^[A-Z][A-Z0-9.-]{0,14}$/.test(a.symbol))||new Set(input.assets.map(a=>a.symbol)).size!==input.assets.length)fail('Use distinct valid equity symbols.');
  out.assets=input.assets.map(a=>({symbol:a.symbol,weightPct:100/input.assets.length})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
  const rankBy=input.rankBy??base.rankBy;if(!require('../quant/factors').PRICE_SIGNALS.some(s=>s.id===rankBy))fail('Choose an explicit supported Quant price signal.');out.rankBy=rankBy;
 }else if(input.assets!==undefined&&hash(input.assets)!==hash(base.assets))fail('Asset membership changes require a new strategy version and backtest.');
 if(out.grossExposurePct>base.grossExposurePct||out.maxPositionPct>base.maxPositionPct||out.defensiveGrossPct>out.grossExposurePct||out.maxDailyTurnoverPct>base.maxDailyTurnoverPct||out.hardStopPct>base.hardStopPct||out.trailingStopPct>base.trailingStopPct||out.targetVolatilityPct>base.targetVolatilityPct)fail('Risk limits exceed this strategy version.');
 if(out.transactionCostBps<10)fail('Use at least 10 basis points per side in validation.');
 return out;
}
function assertAccount(config,account,registration){
 const retirement=['401k','ira','roth-ira'].includes(registration);
 if(config.accountClass==='taxable-margin'&&(registration!=='taxable'||String(account.accountType).toLowerCase()!=='margin'))fail('This Quant strategy is only for confirmed taxable margin accounts.');
 if(config.accountClass==='retirement-cash'&&(!retirement||String(account.accountType).toLowerCase()!=='cash'))fail('This strategy requires an explicitly classified retirement account.');
 return true;
}
module.exports={PRESETS,hash,isDaily,normalizePolicy,assertAccount};
