/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real disposable-PostgreSQL accounting, rollback, reset and owner/book isolation regressions for the reused paper engine.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {Pool,Client}=createRequire(path.resolve(__dirname,'../../scripts/toolchain/package.json'))('pg');
const store=require('../routes/paper/store'),books=require('../routes/paper/books'),tick=require('../routes/paper/tick');
const {createIntentDouble}=require('./support/paper-doubles');
const report=require('../routes/paper/report');
async function fixture(t){
 const dsn=process.env.OSHAL_TEST_POSTGRES;
 assert.ok(dsn,'OSHAL_TEST_POSTGRES must name an explicitly disposable PostgreSQL fixture.');
 const base=new URL(dsn);assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&['35689','32768'].includes(base.port)&&base.pathname==='/kernel','Require the declared disposable kernel fixture');
 const admin=new Client({connectionString:dsn});await admin.connect();
 const name='paper_contract_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);base.pathname='/'+name;
 const pool=new Pool({connectionString:base.toString()});
 t.after(async()=>{await pool.end();await admin.query('DROP DATABASE '+name);await admin.end();});
 for(const file of ['002-native-paper.sql','007-native-portfolio.sql','008-local-paper-books.sql','009-native-oshal-reports.sql','010-report-presenter-media.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
 return {pool};
}
const now=new Date('2026-10-27T15:00:00Z');
test('two owners and named accounts have independent cash, fills and tick idempotency',async t=>{
 const h=await fixture(t),market=createIntentDouble({SPY:{price:100,step:.008}},{now}),deps={...h,intent:market.intent};
 for(const [owner,ref,cash]of [['alice','alpha',100000],['alice','beta',50000],['bob','alpha',20000]])await books.createBook(deps,owner,{requestId:ref,label:ref,startingCash:cash,universe:['SPY'],posture:'active'},now);
 assert.equal((await store.loadAccount(books.bookPool(h.pool,'alpha'),'alice')).cash,100000);
 assert.equal((await store.loadAccount(books.bookPool(h.pool,'alpha'),'bob')).cash,20000);
 const first=await books.tickBooks(deps,'alice',{now,trigger:'schedule',runId:'synthetic'});
 assert.equal(first.length,2);assert.ok(first.every(r=>!r.error));
 const alpha=await store.loadAccount(books.bookPool(h.pool,'alpha'),'alice'),beta=await store.loadAccount(books.bookPool(h.pool,'beta'),'alice');
 assert.ok(alpha.cash<100000);assert.ok(beta.cash<50000);assert.equal((await store.loadAccount(books.bookPool(h.pool,'alpha'),'bob')).cash,20000);
 const counts=(await h.pool.query('SELECT book_ref,count(*) AS n FROM trading_paper_book_orders GROUP BY book_ref')).rows;
 await books.tickBooks(deps,'alice',{now,trigger:'schedule',runId:'retry'});
 assert.deepEqual((await h.pool.query('SELECT book_ref,count(*) AS n FROM trading_paper_book_orders GROUP BY book_ref')).rows,counts);
 await assert.rejects(books.getBook(h.pool,'bob','beta'),e=>e.status===404);
 await books.setArchived(deps,'alice','alpha',true,now);
 assert.equal((await books.tickBooks(deps,'alice',{now:new Date(now.getTime()+300000),trigger:'schedule'})).length,1);
 assert.equal((await store.loadConfig(books.bookPool(h.pool,'alpha'),'alice')).armed,false);
 await books.setArchived(deps,'alice','alpha',false,now);
 assert.equal((await store.loadConfig(books.bookPool(h.pool,'alpha'),'alice')).armed,false,'restore requires a separate Start');
});
test('reset archives all rows, starts at 100k, fences old versions and is retry-safe',async t=>{
 const h=await fixture(t),market=createIntentDouble({SPY:{price:100,step:.008}},{now}),deps={...h,intent:market.intent};
 await tick.armPaper(deps,'alice',{startingCash:50000,universe:['SPY'],posture:'active'},now);
 await tick.runTick(deps,'alice',{now,trigger:'schedule'});
 const before=await store.loadAccount(h.pool,'alice'),orders=await store.listOrders(h.pool,'alice'),positions=await store.loadPositions(h.pool,'alice');
 assert.ok(orders.length>0);
 const resetAt=new Date(now.getTime()+600000),out=await books.resetPaper(deps,'alice',{requestId:'archive-one',startingCash:100000,universe:['SPY']},resetAt);
 assert.equal(out.account.cash,100000);assert.equal(out.account.equity,100000);assert.equal(out.account.realizedPl,0);assert.ok(out.account.version>before.version);
 assert.deepEqual(await store.loadPositions(h.pool,'alice'),[]);assert.deepEqual(await store.listOrders(h.pool,'alice'),[]);
 const archived=books.bookPool(h.pool,'archive-one');assert.deepEqual(await store.listOrders(archived,'alice'),orders);assert.deepEqual(await store.loadPositions(archived,'alice'),positions);
 assert.equal((await store.loadAccount(archived,'alice')).cash,before.cash);assert.equal((await store.loadConfig(archived,'alice')).armed,false);
 assert.deepEqual((await store.equitySeries(h.pool,'alice')).map(r=>r.equity),[100000]);
 await books.resetPaper(deps,'alice',{requestId:'archive-one',startingCash:100000},new Date(resetAt.getTime()+300000));
 assert.equal((await store.loadConfig(h.pool,'alice')).armed,true,'duplicate reset must not disarm the fresh book');
 assert.equal((await books.listBooks(h.pool,'alice')).length,1);
});
test('an archive write failure rolls the entire reset back',async t=>{
 const h=await fixture(t),deps={...h};await tick.armPaper(deps,'alice',{startingCash:50000},now);const before=await store.loadAccount(h.pool,'alice');
 const broken={...h.pool,connect:async()=>{const client=await h.pool.connect();return {query:(sql,args)=>{if(sql.startsWith('INSERT INTO trading_paper_book_account'))throw Error('synthetic archive storage failure');return client.query(sql,args);},release:()=>client.release()};},query:h.pool.query.bind(h.pool)};
 await assert.rejects(books.resetPaper({pool:broken},'alice',{requestId:'failed-archive'},now),/synthetic/);
 assert.deepEqual(await store.loadAccount(h.pool,'alice'),before);assert.equal((await store.loadConfig(h.pool,'alice')).armed,true);assert.equal((await books.listBooks(h.pool,'alice')).length,0);
});
test('a native report retains paper/live distinctions, effective authority and exact test windows',async t=>{
 const h=await fixture(t);await tick.armPaper(h,'alice',{startingCash:100000},now);
 const clip='/api/video/editor/media/11111111-2222-3333-4444-555555555555';
 await report.savePreferences(h.pool,'alice',{presenterName:'Test presenter',presenterVideoUrl:clip},now);
 await report.savePreferences(h.pool,'alice',{presenterName:'Test presenter'},now);
 await assert.rejects(report.savePreferences(h.pool,'alice',{presenterName:'Test presenter',presenterVideoUrl:'https://example.com/remote.mp4'},now),e=>e.code==='presenter_media_invalid');
 const out=await report.generateReport(h,'alice',now,{scheduled:true,readLive:async()=>({rows:[{label:'Synthetic real account',equity:10000,cash:2000,strategyName:'Rotation',authority:'source-changed',protectionAuthority:'off',research:{window:{start:'2025-10-01',end:'2026-10-01'},metrics:{totalReturnPct:2}}}],errors:[]})});
 assert.equal(out.presenterVideoUrl,clip);assert.equal(out.paper[0].simulated,true);assert.equal(out.paper[0].returnPct,0);assert.equal(out.live[0].authority,'source-changed');assert.match(out.narration,/not live results/);assert.equal(out.published,false);assert.equal(out.ordersPlaced,false);
 assert.equal((await report.listReports(h.pool,'bob')).length,0);assert.equal((await report.listReports(h.pool,'alice')).length,1);
 await report.generateReport(h,'alice',now,{scheduled:true,readLive:async()=>{throw Error('must not regenerate same daily report');}});assert.equal((await report.listReports(h.pool,'alice')).length,1);
});
test('daily report reads beyond the recent 200-fill view and preserves owner/book isolation',async t=>{
 const h=await fixture(t);await tick.armPaper(h,'alice',{startingCash:100000},now);
 await books.createBook(h,'alice',{requestId:'named-report',label:'Second paper book',startingCash:10000},now);
 const sql='INSERT INTO trading_paper_orders (order_id,user_sub,tick_window,decision_id,symbol,side,qty,fill_price,notional,reason,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
 for(let i=0;i<201;i++)await h.pool.query(sql,['alice-'+i,'alice','window-'+i,'decision-'+i,'SPY','buy',1,100,100,'synthetic','2026-10-27T14:00:00Z']);
 await h.pool.query(sql,['bob-fill','bob','bob-window','bob-decision','SPY','buy',1,100,100,'synthetic','2026-10-27T14:00:00Z']);
 await h.pool.query('INSERT INTO trading_paper_book_orders (book_ref,order_id,user_sub,tick_window,decision_id,symbol,side,qty,fill_price,notional,reason,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',['named-report','named-fill','alice','named-window','named-decision','QQQ','buy',2,200,400,'synthetic','2026-10-27T14:00:00Z']);
 assert.equal((await store.listOrders(h.pool,'alice')).length,200);
 const rows=await report.paperRows(h,'alice',now),reference=rows.find(r=>r.bookRef==='paper'),named=rows.find(r=>r.bookRef==='named-report');
 assert.equal(reference.activity.today.fills,201);assert.equal(reference.activity.today.buyGross,20100);assert.equal(named.activity.today.fills,1);assert.equal(named.activity.today.buyGross,400);assert.equal(reference.activity.todayFills.some(f=>f.orderId==='bob-fill'),false);
});
