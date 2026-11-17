/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: like the native kernel, the host refuses a save of a daily account value made while answering a page read (a GET is admitted as a reader; kernel test crates/oshald/tests/trading_today_read.rs, second case), and logs every statement the portfolio routes send.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: the fixture host for the portfolio overview's browser test, in the shape of the first screen's host (tests/native-today-home-browser.test.js): the shipped trading.html and ui scripts, the shipped accounts, status, portfolio, research, charts and paper route handlers on a statement-exact database double with invented accounts, a made-up broker roster and made-up SPY and BIL closes. Every request and every SQL statement is logged. With TRADING_PROOF_PLATFORM naming a kernel platform folder it also serves the real theme stylesheets, for proof screenshots. No broker, no kernel, no real account.
 */
'use strict';
const path=require('node:path'),fs=require('node:fs');
const {application}=require('./native-portfolio-host');
const {standIns,loadShipped}=require('./native-landing-host');
const {createTodayDb}=require('./today-fixtures');
const books=require('../../routes/paper/books');
const {fingerprint}=require('../../routes/trading-portfolio-store');
const F=require('./overview-fixtures');
const PKG=path.resolve(__dirname,'../..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express=require(path.join(TOOLCHAIN,'express'));
const JOBS=()=>[{id:'job-watcher',app:'intelligent-trades',name:'portfolio-watcher',status:'active',activation:{},nextRunAt:'2026-11-12T18:51:00.000Z'},
 {id:'job-paper',app:'intelligent-trades',name:'paper-autopilot',status:'active',activation:{},nextRunAt:'2026-11-12T18:55:00.000Z'}];

/** @description Seeders with today-fixtures' interface that write saved records where the shipped portfolio routes read them. */
function seeders(h,today){
 return {book:today.book,ledger:today.ledger,
  record(owner,kind,payload,key,createdAt='2026-11-01T12:00:00.000Z'){const id=key?kind+':'+fingerprint([owner,key]):kind+'-'+(h.records.size+1);h.records.set(owner+'|'+id,{record_id:id,user_sub:owner,kind,payload:JSON.stringify(payload),created_at:createdAt});return id;},
  value(owner,account,day,at,equity,cash){h.values.set([owner,account.connectionKey,account.accountId,day].join('|'),{user_sub:owner,connection_key:account.connectionKey,account_id:account.accountId,observed_day:day,observed_at:at,equity,cash});}};
}

/** @description The paper router's pool: paper ledgers from the statement-exact double, everything else from the portfolio host. */
function paperPool(h,today,log){
 const query=async(text,values=[])=>{
  log.push(String(text));
  if(!/trading_paper_/.test(text))return h.ctx.pool.query(text,values);
  if(text===books.META.get){const rows=(await today.pool.query(books.META.list,[values[0]])).rows.filter(b=>b.book_ref===values[1]);return {rows,rowCount:rows.length};}
  try{return await today.pool.query(text,values);}
  catch(err){if(/^SELECT /.test(text)&&/undeclared statement/.test(err.message))return {rows:[],rowCount:0};throw err;}
 };
 return {query,connect:async()=>{throw new Error('this fixture host opens no paper transaction');}};
}

/** @description The kernel reads the pages ask for, answered from fixtures; every name is recorded and a test can make the price read fail. */
function intents(h,state){
 const original=h.ctx.intent;
 return async(name,input)=>{
  state.intents.push(name);
  if(name==='trading.config')return {native:true,orderTickets:true,configured:true};
  if(name==='trading.orders.list')return {orders:[],readAtMs:F.NOW.getTime()};
  if(name==='trading.orders.balance')return {cashBudgetUsd:310.5,readAtMs:F.NOW.getTime()};
  if(name==='trading.orders.tickets')return {tickets:[]};
  if(name==='trading.orders.mandate.status')return {mandateId:input.mandateId,status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-12-02T15:00:00.000Z')};
  if(name==='trading.bars'&&['SPY','BIL'].includes(input.symbol)){if(state.barsFail)throw new Error('fixture: the price read is down');return F.benchmarkBars(input.symbol);}
  return original(name,input);
 };
}

/** @description The paper routes' shipped handlers on the fixture clock, as an express router; a test can make a read fail. */
function paperRouter(h,today,state){
 const {paperHandlers}=require('../../routes/trading-paper-routes'),router=express.Router();
 const handlers=paperHandlers({pool:paperPool(h,today,state.sql),intent:h.ctx.intent},()=>F.NOW);
 const serve=name=>async(req,res)=>{
  try{if(state.fail===name)throw new Error('fixture: the saved-record read is down');const out=await handlers[name](req);res.status(out.status).json(out.body);}
  catch(err){res.status(Number(err.status)||500).json({error:err.code||'paper_route_failed',message:err.message});}
 };
 router.get('/',serve('status'));router.get('/today',serve('today'));router.get('/values',serve('values'));router.get('/books',serve('books'));router.get('/books/:ref',serve('book'));
 return router;
}

/**
 * @description Answer the portfolio routes' statements as the native kernel does for a page read: every statement is logged,
 *   and a save of a daily account value is refused, because a GET is admitted as a reader.
 * @param {object} h The portfolio host. @param {object} state The host's logs.
 * @returns {void}
 */
function readerPool(h,state){
 const query=h.ctx.pool.query;
 h.ctx.pool.query=async(sql,args)=>{
  state.sql.push(String(sql));
  if(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+trading_account_values\b/i.test(String(sql)))throw new Error('fixture: refused, a page read is admitted as a reader and cannot save');
  return query(sql,args);
 };
}

/** @description The real theme stylesheets from a kernel platform folder when TRADING_PROOF_PLATFORM names one, else empty files. */
function sharedAssets(app){
 const platform=process.env.TRADING_PROOF_PLATFORM;
 const css=(dir)=>(req,res)=>{const file=platform&&path.join(platform,dir,path.basename(req.path));res.type('css').send(file&&fs.existsSync(file)?fs.readFileSync(file,'utf8'):'');};
 app.get(/^\/shared\/ui\/css\/[a-z-]+\.css$/,css('shared/ui/css'));app.get(/^\/cockpit\/css\/themes\/[a-z-]+\.css$/,css('pages/cockpit/css/themes'));
 app.get(/^\/shared\/.*\.js$/,(_req,res)=>res.type('js').send(''));app.get(/^\/shared\/.*\.css$/,(_req,res)=>res.type('css').send(''));
}

/** @description The shipped trading routes under /api/trading, with the paper router and the page. */
function tradingApi(h,today,state){
 const modules=standIns({express});modules['@/features/trading']={...modules['@/features/trading'],nativeSchwabReads:true};
 const ledgers=paperPool(h,today,[]),quiet={query:async(text,values)=>{state.sql.push(String(text));return /trading_paper_/.test(text)?ledgers.query(text,values):{rows:[],rowCount:0};}};
 const ctx={pool:quiet,intent:h.ctx.intent},api=express.Router();let charts;
 api.get('/',(_req,res)=>res.sendFile(path.join(PKG,'tools/trading.html')));api.use('/ui',express.static(path.join(PKG,'tools/ui')));
 api.get('/accounts',(_req,res,next)=>{if(state.rosterFails){res.status(503).json({error:'broker_unavailable',message:'fixture: the broker roster is down'});return;}next();});
 api.get('/quant/status',(_req,res)=>res.json({ok:true,enabled:false}));
 api.use('/paper',paperRouter(h,today,state));
 loadShipped(modules,load=>{
  load('trading-accounts-routes').registerTradingAccountRoutes(api,ctx);load('trading-routes-book-read-builders').registerTradingBookReadRoutes(api,ctx,PKG);
  load('trading-research-routes').registerTradingResearchRoutes(api,ctx);charts=load('trading-charts-routes').createTradingChartsRoutes(ctx);
 });
 return {api,charts};
}

/**
 * @description The fixture host: the shipped page and scripts, the shipped route files, invented records, a roster and a job list.
 * @param {object} t The test, for teardown.
 * @param {(db:object,h:object)=>void} seed Seeds saved records and values (seeders with today-fixtures' interface).
 * @param {{roster?:Array<object>}} [options] The broker roster (the invented accounts by default).
 * @returns {Promise<object>} The page's address, the request, statement and intent logs, and the switches a case sets.
 */
async function overviewHost(t,seed,options={}){
 const h=application(),today=createTodayDb(),state={requests:[],sql:[],intents:[],jobs:JOBS(),fail:null,barsFail:false,rosterFails:false};
 h.accounts.splice(0,h.accounts.length,...(options.roster||F.brokerAccounts()));h.setNow(F.NOW.toISOString());h.ctx.intent=intents(h,state);readerPool(h,state);
 seed(seeders(h,today),h);
 const {api,charts}=tradingApi(h,today,state),app=express();
 // The caller as the kernel's bridge hands it over: a header for the fixture's own routes, and an authenticated oidc user,
 // which is what the charts route reads.
 app.use((req,_res,next)=>{state.requests.push(req.method+' '+req.path+(req.path.endsWith('/bars')?'?'+String(req.query.symbol||''):''));req.headers['x-fixture-owner']=F.OWNER;
  req.oidc={isAuthenticated:()=>true,user:{sub:F.OWNER}};next();});
 app.get('/api/v1/agent/schedules',(_req,res)=>res.json({schedules:state.jobs}));
 sharedAssets(app);app.use(h.app);app.use('/api/trading-charts',charts);app.use('/api/trading',api);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {state,accounts:h.accounts,base:'http://127.0.0.1:'+server.address().port+'/api/trading/',
  calls:()=>state.requests.filter(r=>/^\w+ \/api\/(trading\/(?!ui\/)|trading-charts\/bars|v1\/)/.test(r)&&r!=='GET /api/trading/')};
}

module.exports={overviewHost};
