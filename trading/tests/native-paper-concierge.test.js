/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A saved strategy runs on a paper account (Schwab read-only history, two bounded reads; the archive's 365 days refuses at assignment): the route assigns and arms it, a scheduled pass rebalances the book to the strategy's targets once per decision, the read names it, and clearing returns the account to its posture engine.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Asked to set up and start a paper strategy, the concierge had no paper tools. Its paper tools are route tools over the local paper account routes only, the analyst creates after agreement and names the schedule button, and the accounts read reports each owner's armed accounts, last ticks and the last scheduled pass against a real disposable PostgreSQL.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const {Pool,Client}=createRequire(path.resolve(__dirname,'../../scripts/toolchain/package.json'))('pg');
const {paperHandlers}=require('../routes/trading-paper-routes');
const {createIntentDouble}=require('./support/paper-doubles');
const books=require('../routes/paper/books'),store=require('../routes/paper/store');
const root=path.resolve(__dirname,'..');
const yamlRoots=[__dirname,path.resolve(__dirname,'../../scripts/toolchain'),...(process.env.OSHAL_FRAMEWORK?[path.resolve(process.env.OSHAL_FRAMEWORK)]:[])];
const yaml=require(require.resolve('js-yaml',{paths:yamlRoots}));
const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8'));
const tools=new Map(manifest.tools.map(t=>[t.name,t]));
const PAPER_TOOLS={trading_paper_accounts:'GET /api/trading/paper/books',trading_paper_create:'POST /api/trading/paper/books',trading_paper_start:'POST /api/trading/paper/books/{input.ref}/arm',trading_paper_stop:'POST /api/trading/paper/books/{input.ref}/disarm',trading_paper_strategy:'POST /api/trading/paper/books/{input.ref}/strategy'};

test('the concierge paper tools are route tools over the local paper account routes only',()=>{
 for(const[name,endpoint]of Object.entries(PAPER_TOOLS)){
  const t=tools.get(name);assert.ok(t,name+' must be declared');assert.equal(t.type,'api');assert.equal(t.executor.apiEndpoint,endpoint);
  assert.equal(t.requiresApproval,false);assert.equal(t.defaultAuthMode,'auto');
  for(const key of ['subject','owner','tenant','user','requestId','archived'])assert.equal(t.inputSchema.properties[key],undefined,name+' input must not carry '+key);
 }
 assert.deepEqual(tools.get('trading_paper_create').inputSchema.required,['label','startingCash','posture']);
 assert.deepEqual(tools.get('trading_paper_create').inputSchema.properties.posture.enum,['conservative','balanced','active','aggressive']);
 for(const name of ['trading_paper_start','trading_paper_stop','trading_paper_strategy'])assert.deepEqual(tools.get(name).inputSchema.required,['ref']);
 // Reset and archive destroy or hide a ledger: they stay on the page.
 for(const t of manifest.tools)assert.doesNotMatch(t.executor?.apiEndpoint||'',/paper\/(reset|books\/[^ ]*\/(archive|restore))|paper\/tick/,t.name);
});

test('the analyst creates paper accounts after agreement and relies on the page to keep the schedule on',()=>{
 const persona=yaml.load(fs.readFileSync(path.join(root,'personas/trading-analyst.yaml'),'utf8'));
 for(const name of Object.keys(PAPER_TOOLS))assert.equal(persona.authorizations[name],'auto',name);
 const p=persona.perspective;
 assert.match(p,/put the strategy into use there with trading_paper_strategy/);
 assert.match(p,/You never put a strategy into use on a real \(Schwab\) account/);
 assert.match(p,/when they already said exactly what they want, that is the agreement/);
 assert.match(p,/switches that schedule on for the person\s+whenever they have an armed paper account/);
 assert.match(p,/Intelligent Trades, Reports, Local\s+paper accounts, and press Activate \/ refresh paper schedule/);
 assert.match(p,/Never say a paper account has traded\s+before a scheduled pass has run for it/);
 const html=fs.readFileSync(path.join(root,'tools/trading.html'),'utf8'),books=fs.readFileSync(path.join(root,'tools/ui/native-paper-books.js'),'utf8'),reports=fs.readFileSync(path.join(root,'tools/ui/view-reports.js'),'utf8');
 assert.match(html,/data-view="reports">Reports</);assert.match(reports,/\['paper','Local paper accounts'\]/);assert.match(books,/>Activate \/ refresh paper schedule</);
});

async function fixture(t){
 const dsn=process.env.OSHAL_TEST_POSTGRES;
 assert.ok(dsn,'OSHAL_TEST_POSTGRES must name an explicitly disposable PostgreSQL fixture.');
 const base=new URL(dsn);assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&['35689','32768'].includes(base.port),'Require the declared disposable PostgreSQL fixture');
 const admin=new Client({connectionString:dsn});await admin.connect();
 const name='paper_concierge_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);base.pathname='/'+name;
 const pool=new Pool({connectionString:base.toString()});
 t.after(async()=>{await pool.end();await admin.query('DROP DATABASE '+name);await admin.end();});
 for(const file of ['002-native-paper.sql','007-native-portfolio.sql','008-local-paper-books.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
 return pool;
}

test('the accounts read reports armed accounts, their last tick and the last scheduled pass, per owner',async t=>{
 const pool=await fixture(t),now=new Date('2026-10-27T15:00:00Z'),market=createIntentDouble({SPY:{price:100,step:.008},QQQ:{price:400,step:.006}},{now});
 const h=paperHandlers({pool,intent:market.intent},()=>now),as=(sub,extra={})=>({oshalCallerSub:sub,body:{},headers:{},params:{},...extra});
 const created=await h.createBook(as('alice',{body:{label:'Concierge paper',startingCash:50000,posture:'balanced',universe:['SPY','QQQ'],ref:'ignored-by-the-route'}}));
 const ref=created.body.book.book_ref;
 let read=(await h.books(as('alice'))).body;
 assert.equal(read.accounts.length,1);
 const [account]=read.accounts;
 assert.equal(account.label,'Concierge paper');assert.equal(account.config.armed,true,'created armed');assert.equal(account.config.posture,'balanced');
 assert.deepEqual(account.config.universe,['SPY','QQQ']);assert.equal(account.account.startingCash,50000);assert.equal(account.lastTick,null);
 assert.equal(read.paperSchedule.name,'paper-autopilot');assert.equal(read.paperSchedule.lastScheduledTickAt,null,'no scheduled pass yet');
 assert.equal(read.reference.account,null);
 await h.tick(as('alice',{headers:{'x-oshal-trigger':'schedule','x-oshal-run-id':'synthetic'}}));
 read=(await h.books(as('alice'))).body;
 assert.equal(read.accounts[0].lastTick.trigger,'schedule');assert.ok(read.accounts[0].lastTick.orders>0,'the armed account traded on the scheduled pass');
 assert.equal(read.paperSchedule.lastScheduledTickAt,new Date(read.accounts[0].lastTick.at).toISOString());
 await h.bookDisarm(as('alice',{params:{ref}}));
 assert.equal((await h.books(as('alice'))).body.accounts[0].config.armed,false);
 await h.bookArm(as('alice',{params:{ref},body:{posture:'conservative',ref}}));
 const restarted=(await h.books(as('alice'))).body.accounts[0];
 assert.equal(restarted.config.armed,true);assert.equal(restarted.config.posture,'conservative');assert.equal(restarted.account.startingCash,50000);
 const bob=(await h.books(as('bob'))).body;
 assert.deepEqual(bob.accounts,[]);assert.equal(bob.paperSchedule.lastScheduledTickAt,null,'another owner sees none of these accounts or passes');
 await assert.rejects(h.bookArm(as('bob',{params:{ref}})),e=>e.status===404);
});

test('the page switches the paper schedule on for an armed account, and only then',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(root,'tools/ui/native-paper.js'),'utf8');
 const run=async(read,row)=>{
  const posts=[];
  const ctx={document:{hidden:false,addEventListener(){}},setInterval(){},api:async()=>read,console,
   fetch:async(url,opts)=>{if(opts&&opts.method==='POST'){posts.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({status:'activated'})};}return {ok:true,json:async()=>({schedules:row?[row]:[]})};}};
  vm.createContext(ctx);vm.runInContext(source+'\n;globalThis.__keep=paperScheduleKeep;',ctx);
  return {result:await ctx.__keep(),posts};
 };
 const row={id:'job-1',app:'intelligent-trades',name:'paper-autopilot',status:'suspended',activation:null};
 const armed={accounts:[{book_ref:'b',archived:false,config:{armed:true}}],reference:{config:{armed:false}},paperSchedule:{app:'intelligent-trades',name:'paper-autopilot'}};
 let out=await run(armed,row);
 assert.equal(out.result,'activated');assert.equal(out.posts.length,1);assert.equal(out.posts[0].url,'/api/v1/agent/schedules/job-1/activate');assert.equal(out.posts[0].body.class,'person');
 out=await run({...armed,accounts:[{...armed.accounts[0],config:{armed:false}}]},row);assert.equal(out.result,'idle');assert.equal(out.posts.length,0,'nothing armed: the schedule is left alone');
 out=await run({...armed,accounts:[{...armed.accounts[0],archived:true}]},row);assert.equal(out.posts.length,0,'an archived account does not count');
 out=await run(armed,{...row,status:'active',activation:{class:'Person'}});assert.equal(out.result,'active');assert.equal(out.posts.length,0);
 assert.match(fs.readFileSync(path.join(root,'tools/ui/app.js'),'utf8'),/startPaperScheduleKeeper\(\)/,'boot starts the keeper');
});

test('a saved strategy runs on a paper account: assigned, armed, rebalanced once per decision, cleared',async t=>{
 const pool=await fixture(t),now=new Date('2026-10-27T15:00:00Z');
 const {sessionDates,lastCompletedSession}=require('../routes/trading-portfolio-calendar');
 const {saveRecord}=require('../routes/trading-portfolio-store');
 const days=sessionDates('2025-01-02',lastCompletedSession(now)),base={SPY:600,QQQ:500,EFA:80,BIL:91};
 const calls=[];
 let schwab=true;
 const last=base=>base*(1+days.length*0.002);
 const intent=async(name,input)=>{calls.push(name);
  if(name==='trading.config')return {configured:schwab};
  // Schwab answers a bounded window per read (about 350 days before end), as trading.bars does.
  if(name==='trading.bars'){assert.equal(input.timeframe,'1Day');const end=new Date(input.end).toISOString().slice(0,10),from=new Date(input.end-350*86400000).toISOString().slice(0,10);
   return {source:'schwab',symbol:input.symbol,bars:days.map((d,i)=>[d,i]).filter(([d])=>d>=from&&d<=end).map(([d,i])=>({t:Date.parse(d+'T16:00:00-04:00')/1000,c:base[input.symbol]*(1+i*0.002)}))};}
  if(name==='trading.quotes')return {source:'schwab',quotes:input.symbols.map(s=>({symbol:s,tradePrice:last(base[s]),tradeAt:now.toISOString()}))};
  // The archive serves at most 365 days, short of the monthly warmup.
  if(name==='prices.series'){assert.ok(input.days<=365);const cut=new Date(now.getTime()-input.days*86400000).toISOString().slice(0,10);
   return {series:Object.fromEntries(input.symbols.map(s=>[s,days.map((d,i)=>[d,i]).filter(([d])=>d>=cut).map(([d,i])=>({bucket:d+'T00:00:00Z',price:base[s]*(1+i*0.002)}))]))};}
  throw Error('unexpected intent '+name);};
 const h=paperHandlers({pool,intent},()=>now),as=(sub,extra={})=>({oshalCallerSub:sub,body:{},headers:{},params:{},...extra});
 const config={modelVersion:2,kind:'monthly-trend',assets:[{symbol:'QQQ',weightPct:50},{symbol:'EFA',weightPct:50}],lookbackSessions:63,rebalanceSessions:20,topN:2,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false};
 const saved=await saveRecord({pool},'alice','strategy',{name:'Trend pair',config,researchOnly:true});
 const ref=(await h.createBook(as('alice',{body:{label:'Strategy paper',startingCash:50000,posture:'balanced'}}))).body.book.book_ref;
 await h.bookDisarm(as('alice',{params:{ref}}));
 schwab=false;
 await assert.rejects(h.bookStrategy(as('alice',{params:{ref},body:{ref,strategyId:saved.id}})),e=>e.status===422&&e.code==='strategy_history_unavailable'&&/connected Schwab login/.test(e.message),'without a year of history it refuses at assignment, not at the open');
 assert.equal((await h.books(as('alice'))).body.accounts[0].strategy,null);
 schwab=true;
 const put=(await h.bookStrategy(as('alice',{params:{ref},body:{ref,strategyId:saved.id}}))).body;
 assert.ok(put.strategy.targets.length&&put.strategy.decisionAsOf,'the assignment shows the targets it will hold');
 assert.equal(put.strategy.strategyName,'Trend pair');assert.equal(put.config.armed,true,'running a strategy starts the account');
 assert.deepEqual([...put.config.universe].sort(),['BIL','EFA','QQQ'],'the strategy assets and its cash fund');
 await assert.rejects(h.bookStrategy(as('bob',{params:{ref},body:{strategyId:saved.id}})),e=>e.status===404,'another owner cannot touch it');
 await assert.rejects(h.bookStrategy(as('alice',{params:{ref},body:{strategyId:'missing'}})),e=>e.status===404);
 await h.tick(as('alice',{headers:{'x-oshal-trigger':'schedule','x-oshal-run-id':'s1'}}));
 let read=(await h.books(as('alice'))).body.accounts[0];
 assert.equal(read.strategy.strategyName,'Trend pair');assert.equal(read.strategy.lastResult,'rebalanced');assert.ok(read.strategy.lastDecisionAsOf);
 const book=books.bookPool(pool,ref),positions=await store.loadPositions(book,'alice'),cash=(await store.loadAccount(book,'alice')).cash;
 assert.deepEqual(positions.map(p=>p.symbol).sort(),['EFA','QQQ'],'holds exactly the strategy assets');
 const value=s=>positions.find(p=>p.symbol===s).qty*last(base[s]);
 assert.ok(Math.abs(value('QQQ')-value('EFA'))<base.QQQ*1.1*2,'about equal weights in whole shares');assert.ok(cash>=0&&cash<2000,'cash left is under the price of a few shares');
 const orders=await store.listOrders(book,'alice');assert.ok(orders.every(o=>o.reason==='Strategy rebalance: Trend pair'&&o.side==='buy'));
 assert.ok(!calls.includes('trading.orders'),'no broker intent');
 const later=new Date(now.getTime()+600000),h2=paperHandlers({pool,intent},()=>later);
 await h2.tick(as('alice',{headers:{'x-oshal-trigger':'schedule','x-oshal-run-id':'s2'}}));
 assert.equal((await store.listOrders(book,'alice')).length,orders.length,'one rebalance per decision, not per pass');
 assert.equal((await h.bookStrategy(as('alice',{params:{ref},body:{}}))).body.cleared,true);
 assert.equal((await h.books(as('alice'))).body.accounts[0].strategy,null,'cleared: back to the posture engine');
});
