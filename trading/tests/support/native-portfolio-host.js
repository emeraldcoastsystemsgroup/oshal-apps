/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Model the separate exact-owner account observation table and latest-timestamp upsert.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Provide explicit timestamped synthetic quotes and broker facts for planning tests; model insert-once approval behavior.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-aware synthetic SQL and Schwab transport for actual shipped portfolio routes. Never production account data or orders.
 */
'use strict';
const path=require('node:path'),{standIns,loadShipped}=require('./native-landing-host');
const PKG=path.resolve(__dirname,'../..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN || (process.env.OSHAL_FRAMEWORK ? path.join(process.env.OSHAL_FRAMEWORK,'node_modules') : path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express=require(path.join(TOOLCHAIN,'express'));
function application(){
 const records=new Map(),values=new Map(),calls=[],quoteOverrides=new Map();
 const accounts=[{accountId:'a',connectionKey:'owned-login',kind:'live',broker:'schwab',accountMasked:'…1234',accountType:'margin',equity:10000,cash:1000,buyingPower:20000,dayChange:-100,positions:[{symbol:'ABC',qty:90,marketValue:9000,unmanaged:true}]}];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('trading_account_values')){
   if(sql.startsWith('INSERT')){const [user_sub,connection_key,account_id,observed_day,observed_at,equity,cash]=args,key=[user_sub,connection_key,account_id,observed_day].join('|'),old=values.get(key);if(!old||Date.parse(observed_at)>Date.parse(old.observed_at))values.set(key,{user_sub,connection_key,account_id,observed_day,observed_at,equity,cash});return{rows:[]};}
   return{rows:[...values.values()].filter(r=>r.user_sub===args[0]&&r.connection_key===args[1]&&r.account_id===args[2]).sort((a,b)=>b.observed_day.localeCompare(a.observed_day)).slice(0,4000)};
  }
  if(sql.includes('oshal_trading_watchlist'))return{rows:[{symbol:'SPY'}]};
  if(sql.startsWith('SELECT'))return{rows:[...records.values()].filter(r=>r.user_sub===args[0]&&r.kind===args[1]&&(!args[2]||r.record_id===args[2])).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,501)};
  if(sql.startsWith('INSERT')){const [record_id,user_sub,kind,payload,created_at]=args;if(sql.includes('DO NOTHING')&&records.has(user_sub+'|'+record_id))return{rows:[]};records.set(user_sub+'|'+record_id,{record_id,user_sub,kind,payload,created_at});return{rows:[]};}
  if(sql.startsWith('DELETE')){records.delete(args[0]+'|'+args[2]);return{rows:[]};}throw Error('Unimplemented fixture SQL');
 }};
 const modules=standIns({express});modules['@/features/trading'].nativeSchwabReads=true;
 const {sessionDates}=require('../../routes/trading-portfolio-calendar');
 const dates=sessionDates('2025-01-02','2026-10-23');let badHistory=false,sourceFailure=false,now='2026-10-25T06:00:00Z';
 const ctx={pool,intent:async(name,input)=>{
  calls.push({intent:name,input});
  if(name==='trading.config')return{native:true,orderTickets:false};
  if(name==='trading.accounts')return{accounts,errors:sourceFailure?[{message:'Synthetic second login unavailable'}]:[],readAt:new Date().toISOString()};
  if(name==='trading.quotes')return{source:'schwab',quotes:input.symbols.map(symbol=>({symbol,tradePrice:100,tradeAt:'2026-10-23T19:59:00Z',source:'schwab',delayed:false,...quoteOverrides.get(symbol)}))};
  if(name==='trading.bars')return {symbol:input.symbol,source:'schwab',bars:dates.filter((_,i)=>!badHistory||i!==370).map((date,i)=>({t:Date.parse(date+'T05:00:00Z')/1000,c:input.symbol==='SPY'?100:100+i/10}))};
  throw Error('Unexpected intent '+name);
 }};
 const app=express();app.use(express.json({limit:'2mb'}));app.use((req,_res,next)=>{req.oshalCallerSub=req.headers['x-fixture-owner']||'owner-a';next();});
 const router=express.Router();loadShipped(modules,load=>load('trading-portfolio-routes').registerTradingPortfolioRoutes(router,ctx,{now:()=>new Date(now)}));app.use('/api/trading',router);
 return{app,ctx,accounts,calls,records,values,setQuote:(symbol,extra)=>{quoteOverrides.set(symbol,extra);},setNow:value=>{now=value;},setSourceFailure:value=>{sourceFailure=value;},setBadHistory:value=>{badHistory=value;}};
}
module.exports={application};
