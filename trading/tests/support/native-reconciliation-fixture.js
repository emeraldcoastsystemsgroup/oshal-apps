/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owned recording ledger/provider fixture for the shipped reconciliation route and browser contracts.
 */
'use strict';
const {standIns,loadShipped}=require('./native-landing-host');
function setup({failure,concurrent=false,noLedger=false,holdingsChange=false}={}){
 const ledger={accountId:'opaque',accountBinding:'bound',status:noLedger?'no-ledger':'available',bookId:noLedger?null:'book',orders:[{order_id:'buy',book_id:'book',mode:'live',symbol:'ANET',side:'buy',status:'filled',filled_qty:20,filled_avg_price:100,broker_order_id:'venue-buy',created_at:'2026-08-01T14:00:00Z'}]};if(noLedger)ledger.orders=[];
 const tx=[{transactionId:'buy-fill',orderId:'venue-buy',symbol:'ANET',side:'buy',qty:20,price:100,fees:0,tradeDate:'2026-08-01T14:00:00Z'},{transactionId:'sell-fill',orderId:'venue-sell',symbol:'ANET',side:'sell',qty:14,price:110,fees:0.01,tradeDate:'2026-08-03T14:00:00Z'}];
 const calls=[],sql=[],routes=new Map();let accountReads=0;let stored=structuredClone(ledger.orders),draft,selects=0,released=0,commits=0;
 const client={async query(text,values){sql.push({text,values});
  if(text==='BEGIN'){draft=structuredClone(stored);return{rows:[]};}
  if(text==='ROLLBACK'){draft=undefined;return{rows:[]};}
  if(text==='COMMIT'){stored=draft;commits++;return{rows:[]};}
  if(text.startsWith('SELECT')){selects++;const rows=structuredClone(draft);if(concurrent&&selects===1)rows[0].filled_qty=21;return{rows};}
  if(text.startsWith('INSERT INTO oshal_trading_decisions'))return{rows:[]};
  if(text.startsWith('INSERT INTO oshal_trading_orders')){if(failure==='insert')throw Error('insert failed');const columns=text.slice(text.indexOf('(')+1,text.indexOf(')')).split(',');const row=Object.fromEntries(columns.map((k,i)=>[k,values[i]]));if(failure!=='ack')draft.push(row);return{rows:[]};}
  throw Error('Unexpected SQL '+text);
 },release(){released++;}};
 const ctx={pool:{storageModel:'kernel-scoped-documents',connect:async()=>client},intent:async(name,input)=>{
  calls.push({name,input});
  if(name==='trading.reconciliation.ledger')return structuredClone(ledger);
  if(name==='trading.accounts'){accountReads++;return{accounts:[{accountId:'opaque',connectionKey:'login',positions:[{symbol:'ANET',qty:holdingsChange&&accountReads>1?7:6}]}],errors:[],readAt:'2026-10-15T01:00:00Z'};}
  if(name==='trading.transactions'){if(failure==='history')throw Error('history unavailable');return{accountId:'opaque',accountBinding:'bound',transactions:tx,unsupported:[]};}
  throw Error('Unexpected intent '+name);
 }};
 const modules=standIns({universe:[]});modules['@/features/trading'].nativeSchwabReads=true;
 loadShipped(modules,load=>load('trading-accounts-routes').registerTradingAccountRoutes({get(){},post:(p,f)=>routes.set(p,f),patch(){},delete(){}},ctx));
 async function request(action,body={},caller='owner'){
  const out={status:200,body:null},res={setHeader(){},status(n){out.status=n;return this;},json(b){out.body=b;return this;}};
  await routes.get('/reconciliation/'+action)({oshalCallerSub:caller,body:{accountId:'opaque',connection:'login',...body}},res);return out;
 }
 return{request,calls,sql,ledger,routes,get stored(){return stored;},get commits(){return commits;},get released(){return released;}};
}
module.exports={setup};
