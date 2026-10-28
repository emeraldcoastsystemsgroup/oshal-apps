/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read-only native quote/candle fallback for stale paper archive data. Reuse the paper algorithms; no broker orders or fabricated bars.
 */
'use strict';
const {readMarket,quoteFresh,chunks,etParts,resample,weekKey}=(()=>{const m=require('./market');return {...m,chunks:(xs,n)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,(i+1)*n))};})();
const cache=new WeakMap();
const {MIN_BARS}=require('./decide');
async function nativePaperMarket(intent,symbols,now){
 let archived,archiveError;
 try{archived=await readMarket(intent,symbols);}catch(error){archiveError=error;archived={quotes:new Map(),closes:new Map(),missing:[...symbols],readAt:null};}
 if(symbols.every(s=>quoteFresh(archived.quotes.get(s),now,10)&&(archived.closes.get(s)?.['1Week']?.length||0)>=MIN_BARS))return {...archived,source:'world-archive'};
 let configured=false;try{configured=(await intent('trading.config',{})).configured===true;}catch{}
 if(!configured){if(archiveError)throw archiveError;return archived;}
 const quotes=new Map(),closes=new Map(),errors=[];
 for(const group of chunks(symbols,50)){
  try{
   const answer=await intent('trading.quotes',{symbols:group});
   if(answer.source!=='schwab'||!Array.isArray(answer.quotes))throw Error('Unverified quote source');
   for(const q of answer.quotes)if(group.includes(q.symbol)&&Number(q.tradePrice)>0&&q.tradeAt)quotes.set(q.symbol,{price:Number(q.tradePrice),at:q.tradeAt});
  }catch{errors.push('Current native quotes unavailable.');}
 }
 // Bounded provider reads. Held symbols are first; the remaining names are explicitly unscanned.
 const scanned=symbols.slice(0,24),deadline=Date.now()+40000;
 for(const symbol of scanned){
  const slot={};closes.set(symbol,slot);
  for(const timeframe of ['5Min','1Hour','1Day']){
   if(Date.now()>deadline){errors.push('Candle read budget reached.');break;}
   const key=JSON.stringify([symbol,timeframe]),ttl=timeframe==='1Day'?3600000:240000;
   let saved=cache.get(intent)?.get(key);
   try{
    if(!saved||Date.now()-saved.at>ttl){
     const data=await intent('trading.bars',{symbol,timeframe});
     if(data.source!=='schwab'||data.symbol!==symbol||!Array.isArray(data.bars))throw Error('Unverified candle source');
     saved={at:Date.now(),data};if(!cache.has(intent))cache.set(intent,new Map());cache.get(intent).set(key,saved);
    }
    const span=timeframe==='5Min'?300:timeframe==='1Hour'?3600:86400;
    const bars=saved.data.bars.filter(b=>Number(b.c)>0&&Number.isFinite(b.t)&&(timeframe==='1Day'?etParts(new Date(b.t*1000)).date<etParts(now).date:b.t+span<=now.getTime()/1000));
    slot[timeframe]=bars.map(b=>Number(b.c));
    if(timeframe==='1Day')slot['1Week']=resample(bars.map(b=>({bucket:new Date(b.t*1000).toISOString(),price:Number(b.c)})),weekKey);
   }catch{errors.push(`${symbol} ${timeframe} candles unavailable.`);}
  }
 }
 return {quotes,closes,missing:symbols.filter(s=>!quotes.has(s)||!closes.get(s)?.['1Day']?.length),readAt:now.toISOString(),source:'schwab-read-only',errors:[...new Set(errors)],unscanned:symbols.slice(24)};
}
module.exports={nativePaperMarket};
