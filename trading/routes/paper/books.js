/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | tickBooks runs an account's assigned saved strategy (routes/paper/strategy.js) instead of the posture engine.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Named owner-scoped paper ledgers and an atomic archive-before-reset. Reuse the existing store, accounting and strategy engine; no broker writer.
 */
'use strict';
const { randomUUID } = require('node:crypto');
const store = require('./store');
const tick = require('./tick');
const { etParts } = require('./market');
const strategy = require('./strategy');
const REF = /^[a-z0-9][a-z0-9-]{0,79}$/;
const META = {
 list: 'SELECT book_ref, label, archived, created_at, updated_at FROM trading_paper_books WHERE user_sub=$1 ORDER BY created_at DESC',
 get: 'SELECT book_ref, label, archived, created_at, updated_at FROM trading_paper_books WHERE user_sub=$1 AND book_ref=$2',
 insert: 'INSERT INTO trading_paper_books (user_sub,book_ref,label,archived,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (user_sub,book_ref) DO NOTHING RETURNING book_ref',
 update: 'UPDATE trading_paper_books SET archived=$3,updated_at=$4 WHERE user_sub=$1 AND book_ref=$2',
};
function refuse(code,message,status=409){throw Object.assign(new Error(message),{code,status});}
function validRef(value){if(typeof value!=='string'||!REF.test(value)||value==='paper')refuse('paper_book_invalid','Choose a named local paper account.',400);return value;}
/** Compile ONLY the existing fixed paper statements. Book references remain bound values. */
function bindStatement(text){
 let sql=text.replace(/trading_paper_/g,'trading_paper_book_');
 const n=Math.max(0,...[...text.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))+1;
 if (/^INSERT INTO /.test(sql)) sql=sql.replace(/(INSERT INTO \w+ \()([^)]*)(\)\s+VALUES \()/,(_m,a,b,c)=>`${a}book_ref, ${b}${c}$${n}, `);
 else sql=sql.replace(/WHERE user_sub = \$1/g,`WHERE user_sub = $1 AND book_ref = $${n}`);
 sql=sql.replace(/ON CONFLICT \(user_sub([,)])/g,'ON CONFLICT (book_ref, user_sub$1');
 return sql;
}
const BOUND = new Map(Object.values(store.SQL).map(text=>[text,bindStatement(text)]));
/** Bind a named book to the unchanged paper engine. A caller subject is never rewritten. */
function bookPool(pool,ref){
 validRef(ref);
 const wrap=client=>({
  query(text,values=[]){if(['BEGIN','COMMIT','ROLLBACK'].includes(text))return client.query(text);const sql=BOUND.get(text);if(!sql)refuse('paper_sql_invalid','Unknown paper ledger statement.',500);return client.query(sql,[...values,ref]);},
  release(){if(client.release)client.release();},
 });
 const out=wrap(pool);out.connect=async()=>wrap(await pool.connect());return out;
}
async function listBooks(pool,sub){return (await pool.query(META.list,[sub])).rows;}
async function getBook(pool,sub,ref){validRef(ref);const row=(await pool.query(META.get,[sub,ref])).rows[0];if(!row)refuse('paper_book_not_found','This local paper account was not found.',404);return row;}
async function createBook(deps,sub,body,now){
 const ref=validRef(body?.requestId||randomUUID()),name=String(body?.label||'Local paper account').trim();
 if(!name||name.length>100)refuse('paper_label_invalid','Use an account label of at most 100 characters.',400);
 const config=tick.normalizeConfig(body),at=now.toISOString();
 await store.inTransaction(deps.pool,async client=>{
  const inserted=await client.query(META.insert,[sub,ref,name,false,at]);
  if(!inserted.rows.length)return;
  // Reuse the same transaction, without acquiring a second connection.
  const p=bookPool(client,ref);
  await p.query(store.SQL.CONFIG_ARM,[sub,config.posture,config.startingCash,config.maxShares,config.maxNotional,config.maxOrdersPerTick,config.maxQuoteAgeMinutes,config.universe?JSON.stringify(config.universe):null,at]);
  await p.query(store.SQL.ACCOUNT_OPEN,[sub,config.startingCash,at]);
  await p.query(store.SQL.EQUITY_UPSERT,[sub,etParts(now).date,config.startingCash,config.startingCash,at]);
 });
 return {ok:true,book:await getBook(deps.pool,sub,ref),account:await store.loadAccount(bookPool(deps.pool,ref),sub),simulated:true};
}
/** Column lists come only from the original immutable migration, in a fixed registry. */
const COLUMNS={
 config:'user_sub,armed,posture,starting_cash,max_shares,max_notional,max_orders_per_tick,max_quote_age_minutes,universe,armed_at,disarmed_at,updated_at',
 account:'user_sub,cash,equity,high_water,realized_pl,starting_cash,version,last_tick_window,created_at,updated_at',
 positions:'user_sub,symbol,qty,avg_cost,last_price,last_price_at,peak_price,opened_at,updated_at',
 orders:'order_id,user_sub,tick_window,decision_id,symbol,side,qty,fill_price,notional,reason,realized_pl,status,quote_at,created_at',
 decisions:'decision_id,user_sub,tick_window,symbol,action,reason,score,confidence,regime,rationale,per_timeframe,created_at',
 ticks:'user_sub,tick_window,trigger_kind,run_id,outcome,order_count,equity,summary,created_at',
 equity_daily:'user_sub,session_date,equity,cash,recorded_at',
};
/** Atomic reset, including complete ledger history. A retry with the same requestId cannot reset twice. */
async function resetPaper(deps,sub,body,now){
 const ref=validRef(body?.requestId),at=now.toISOString();
 const config=tick.normalizeConfig({...body,startingCash:body.startingCash??100000});
 await store.inTransaction(deps.pool,async client=>{
  // Serialize against arm/disarm; then move the account version to fence any in-flight tick/manual fill.
  await client.query('UPDATE trading_paper_config SET updated_at=updated_at WHERE user_sub=$1',[sub]);
  if((await client.query(META.get,[sub,ref])).rows.length)return;
  await client.query(store.SQL.CONFIG_DISARM,[sub,at]);
  const previous=await store.loadAccount(client,sub);
  if(!previous)refuse('paper_not_opened','Start the reference paper account before resetting it.');
  if(previous){
   const changed=await client.query(store.SQL.ACCOUNT_WRITE,[sub,previous.cash,previous.equity,previous.highWater,previous.realizedPl,previous.version+1,previous.lastTickWindow,at,previous.version]);
   if(!changed.rowCount)refuse('paper_book_changed','The paper account changed; retry the same reset request.');
  }
  await client.query(META.insert,[sub,ref,'Archived paper · '+etParts(now).date,true,at]);
  for(const [table,columns]of Object.entries(COLUMNS)){
   const cols=columns.split(','),order=cols.filter(c=>c!=='user_sub').slice(0,1).join(',');
   for(let offset=0;;offset+=250){
    const rows=(await client.query(`SELECT ${columns} FROM trading_paper_${table} WHERE user_sub=$1 ORDER BY ${order} LIMIT 250 OFFSET $2`,[sub,offset])).rows;
    for(const row of rows)await client.query(`INSERT INTO trading_paper_book_${table} (book_ref,${columns}) VALUES (${Array.from({length:cols.length+1},(_,i)=>'$'+(i+1)).join(',')})`,[ref,...cols.map(c=>table==='config'&&c==='armed'?false:row[c])]);
    if(rows.length<250)break;
   }
  }
  for(const table of Object.keys(COLUMNS))await client.query(`DELETE FROM trading_paper_${table} WHERE user_sub=$1`,[sub]);
  await client.query(store.SQL.CONFIG_ARM,[sub,config.posture,config.startingCash,config.maxShares,config.maxNotional,config.maxOrdersPerTick,config.maxQuoteAgeMinutes,config.universe?JSON.stringify(config.universe):null,at]);
  await client.query(store.SQL.ACCOUNT_OPEN,[sub,config.startingCash,at]);
  // Retain a monotone version across resets so an old pending plan cannot match version zero.
  if(previous)await client.query(store.SQL.ACCOUNT_WRITE,[sub,config.startingCash,config.startingCash,config.startingCash,0,previous.version+2,null,at,0]);
  await client.query(store.SQL.EQUITY_UPSERT,[sub,etParts(now).date,config.startingCash,config.startingCash,at]);
 });
 return {ok:true,archivedBook:ref,account:await store.loadAccount(deps.pool,sub),simulated:true};
}
async function setArchived(deps,sub,ref,archived,now){
 await getBook(deps.pool,sub,ref);
 // Disarming fences an in-flight tick before the registry is changed.
 await tick.disarmPaper({...deps,pool:bookPool(deps.pool,ref)},sub,now);
 await deps.pool.query(META.update,[sub,ref,archived,now.toISOString()]);
 return {ok:true,book:await getBook(deps.pool,sub,ref)};
}
async function tickBooks(deps,sub,opts){
 const results=[],began=Date.now();
 // Read-only market calls are shared across books in this pass, never order intents.
 const cache=new Map(),intent=async(name,input)=>{const key=JSON.stringify([name,input]);if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>deps.intent(name,input)));return cache.get(key);};
 for(const book of await listBooks(deps.pool,sub)){
  if(book.archived===true||book.archived==='t')continue;
  if(Date.now()-began>45000){results.push({bookRef:book.book_ref,skipped:'tick_budget'});continue;}
  const scoped={...deps,intent,pool:bookPool(deps.pool,book.book_ref)},assigned=await strategy.assignmentOf(deps,sub,book.book_ref);
  // An account that runs a saved strategy rebalances to it; the posture engine trades only the others.
  if(assigned){results.push({bookRef:book.book_ref,...await strategy.runStrategyTick(scoped,{pool:deps.pool},sub,assigned,opts)});continue;}
  const out=await tick.runTick(scoped,sub,opts);
  results.push({bookRef:book.book_ref,...out.body});
 }
 return results;
}
module.exports={bookPool,bindStatement,listBooks,getBook,createBook,resetPaper,setArchived,tickBooks,META,COLUMNS};
