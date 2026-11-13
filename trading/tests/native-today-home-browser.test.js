/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The first screen (1.57.0) in Chromium at desktop and phone width, over the shipped trading.html, the shipped ui scripts and the shipped accounts, status, portfolio and paper route handlers on a fixture host with invented accounts. It proves what opening the screen requests (saved records and the job list, no /portfolio read, no write), that each card answers its three questions with a source and a time and carries one button and no control that can change money, that each button lands on the existing screen and section it names, that the former landing is one tap away and whole, what the screen says when the saved-record read fails, and that an armed paper account still gets its job switched on by the page's existing keeper and nothing else. No broker, no kernel, no real account.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {application}=require('./support/native-portfolio-host');
const {standIns,loadShipped}=require('./support/native-landing-host');
const {OWNER,ACCOUNT,createTodayDb,seedConnected,seedPaper}=require('./support/today-fixtures');
const {fingerprint}=require('../routes/trading-portfolio-store');
const books=require('../routes/paper/books');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express=require(path.join(TOOLCHAIN,'express'));
const {chromium}=require(path.join(TOOLCHAIN,'playwright'));
const NOW=new Date('2026-11-12T18:50:00.000Z'),PROOF=process.env.TRADING_PROOF_DIR||os.tmpdir();
const MONEY='[data-native-management],[data-lp],[data-np],[data-portfolio-action],[data-native-allocation],[data-native-protection],[data-act="create"]';
const BROKER_ACCOUNT={...ACCOUNT,kind:'live',notTrading:true,broker:'schwab',accountMasked:'···0001',accountType:'margin',equity:31204.18,cash:310.5,buyingPower:620,dayChange:null,
 positions:[{symbol:'BIL',qty:204,marketValue:18670.08},{symbol:'SPY',qty:9,marketValue:6180.3},{symbol:'GLD',qty:16,marketValue:6043.3}]};
const JOBS=()=>[{id:'job-watcher',app:'intelligent-trades',name:'portfolio-watcher',status:'active',activation:{},nextRunAt:'2026-11-12T18:51:00.000Z'},
 {id:'job-paper',app:'intelligent-trades',name:'paper-autopilot',status:'active',activation:{},nextRunAt:'2026-11-12T18:55:00.000Z'}];

/** @description Seeders with today-fixtures' interface that write saved records where the shipped portfolio routes read them. */
function seeders(h,today){
 return {book:today.book,ledger:today.ledger,
  record(owner,kind,payload,key,createdAt='2026-11-01T12:00:00.000Z'){const id=key?kind+':'+fingerprint([owner,key]):kind+'-'+(h.records.size+1);h.records.set(owner+'|'+id,{record_id:id,user_sub:owner,kind,payload:JSON.stringify(payload),created_at:createdAt});return id;},
  value(owner,account,day,at,equity,cash){h.values.set([owner,account.connectionKey,account.accountId,day].join('|'),{user_sub:owner,connection_key:account.connectionKey,account_id:account.accountId,observed_day:day,observed_at:at,equity,cash});}};
}

/** @description The paper router's pool: paper ledgers from the statement-exact double, saved records from the portfolio host. Every statement is logged. */
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

/** @description The kernel reads the pages ask for, answered from fixtures; every name is recorded. */
function intents(h,state){
 const original=h.ctx.intent;
 return async(name,input)=>{
  state.intents.push(name);
  if(name==='trading.config')return {native:true,orderTickets:true,configured:true};
  if(name==='trading.orders.list')return {orders:[],readAtMs:NOW.getTime()};
  if(name==='trading.orders.balance')return {cashBudgetUsd:310.5,readAtMs:NOW.getTime()};
  if(name==='trading.orders.tickets')return {tickets:[]};
  if(name==='trading.orders.mandate.status')return {mandateId:input.mandateId,status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-12-02T15:00:00.000Z')};
  if(name==='personal_jobs.list')return {schedules:state.jobs};
  return original(name,input);
 };
}

/** @description The paper routes' shipped handlers on a fixed clock, as an express router. */
function paperRouter(h,today,state){
 const {paperHandlers}=require('../routes/trading-paper-routes'),router=express.Router();
 const handlers=paperHandlers({pool:paperPool(h,today,state.sql),intent:h.ctx.intent},()=>NOW);
 const serve=name=>async(req,res)=>{
  try{if(name==='today'&&state.todayFails)throw new Error('fixture: the saved-record read is down');const out=await handlers[name](req);res.status(out.status).json(out.body);}
  catch(err){res.status(Number(err.status)||500).json({error:err.code||'paper_route_failed',message:err.message});}
 };
 router.get('/',serve('status'));router.get('/today',serve('today'));router.get('/books',serve('books'));router.get('/books/:ref',serve('book'));
 return router;
}

/**
 * @description The fixture host: the shipped page and scripts, the shipped route files, invented records and a job list.
 * @param {object} t The test, for teardown.
 * @param {(db:object,h:object)=>void} seed Seeds saved records and paper ledgers.
 * @returns {Promise<object>} The origin, the request log, the statement log, the job list and the switches a case sets.
 */
async function host(t,seed){
 const h=application(),today=createTodayDb(),state={requests:[],sql:[],intents:[],jobs:JOBS(),todayFails:false,refuseActivation:false,holdAccounts:null,rosterFails:false};
 h.accounts.splice(0,h.accounts.length,{...BROKER_ACCOUNT});h.setNow(NOW.toISOString());h.ctx.intent=intents(h,state);
 seed(seeders(h,today),h);
 const modules=standIns({express});modules['@/features/trading']={...modules['@/features/trading'],nativeSchwabReads:true};
 // The shipped status, roster and account reads see the same paper ledgers as the first screen; their legacy tables answer no rows.
 const ledgers=paperPool(h,today,[]),quiet={query:async(text,values)=>{state.sql.push(String(text));return /trading_paper_/.test(text)?ledgers.query(text,values):{rows:[],rowCount:0};}};
 const ctx={pool:quiet,intent:h.ctx.intent},api=express.Router();
 api.get('/',(_req,res)=>res.sendFile(path.join(PKG,'tools/trading.html')));api.use('/ui',express.static(path.join(PKG,'tools/ui')));
 api.get('/accounts',async(_req,res,next)=>{
  if(state.holdAccounts)await state.holdAccounts;
  if(state.rosterFails){res.status(503).json({error:'broker_unavailable',message:'fixture: the broker roster is down'});return;}
  next();
 });
 api.get('/quant/status',(_req,res)=>res.json({ok:true,enabled:false}));
 api.use('/paper',paperRouter(h,today,state));
 let charts;
 loadShipped(modules,load=>{
  load('trading-accounts-routes').registerTradingAccountRoutes(api,ctx);load('trading-routes-book-read-builders').registerTradingBookReadRoutes(api,ctx,PKG);
  load('trading-research-routes').registerTradingResearchRoutes(api,ctx);charts=load('trading-charts-routes').createTradingChartsRoutes(ctx);
 });
 const app=express();
 app.use((req,_res,next)=>{state.requests.push(req.method+' '+req.path);req.headers['x-fixture-owner']=OWNER;next();});
 app.get('/api/v1/agent/schedules',(_req,res)=>res.json({schedules:state.jobs}));
 app.post('/api/v1/agent/schedules/:id/activate',(req,res)=>{
  if(state.refuseActivation){res.status(409).json({message:'fixture: this job cannot be switched on'});return;}
  const job=state.jobs.find(j=>j.id===req.params.id);if(job){job.status='active';job.activation={};}res.json({ok:true});
 });
 app.get(/^\/shared\/.*\.js$/,(_req,res)=>res.type('js').send(''));app.get(/^\/shared\/.*\.css$/,(_req,res)=>res.type('css').send(''));
 app.use(h.app);app.use('/api/trading-charts',charts);app.use('/api/trading',api);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {...state,state,accounts:h.accounts,base:'http://127.0.0.1:'+server.address().port+'/api/trading/',calls:()=>state.requests.filter(r=>/^\w+ \/api\/(trading\/(?!ui\/)|v1\/)/.test(r)&&r!=='GET /api/trading/')};
}

/** @description Open the page at a width on the fixture clock and wait for the first screen. */
async function open(browser,h,width,{wait=true,query=''}={}){
 const context=await browser.newContext({viewport:{width,height:915},locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.clock.setFixedTime(NOW);await page.goto(h.base+query);
 // A screen that never arrives fails with what the page showed instead, so the failure names its cause.
 if(wait)await page.locator('#homeCards [data-story]').first().waitFor().catch(async err=>{throw new Error(err.message+'\npage showed: '+(await page.locator('#main').innerText()).slice(0,500)+'\npage errors: '+errors.join(' | ')+'\nrequests: '+h.calls().join(', '));});
 return {page,errors,close:()=>context.close()};
}
const settled=page=>page.waitForLoadState('networkidle');
const standard=db=>{seedConnected(db);seedPaper(db,'example-paper');};

test('opening the screen reads saved records and the job list, and each card answers its three questions',async t=>{
 const h=await host(t,standard),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,412]){
  h.state.requests.length=0;h.state.sql.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  assert.deepEqual([...new Set(h.calls())].sort(),['GET /api/trading/accounts','GET /api/trading/paper/books','GET /api/trading/paper/today','GET /api/trading/quant/status','GET /api/trading/status','GET /api/v1/agent/schedules'],
   'the screen asks for its saved records and the job list; the roster and the keeper ask for what they asked before; nothing asks for /portfolio or /summary');
  assert.deepEqual(h.state.sql.filter(text=>!/^\s*SELECT\b/.test(text)),[],'opening the screen sends no statement that is not a SELECT');
  assert.match(await page.locator('#homeTop').innerText(),/Is it trading\? Yes\. 2 of 2 accounts set to trade are running\.\s+Today so far: 0 orders sent, 0 filled on connected accounts\. 0 simulated trades\.\s+Recorded value of connected accounts: \$31,204\.18 from each account's last check; newest Nov 12, 1:45 PM, oldest Nov 12, 1:45 PM\./);
  const cards=page.locator('#homeCards [data-story]');assert.equal(await cards.count(),3);
  const real=cards.nth(0),text=await real.innerText();
  assert.match(text,/Example margin ···0001\s+CONNECTED ACCOUNT\s+RUNNING\s*MOSTLY PARKED/i);
  assert.match(text,/Runs "Example monthly trend"\.\s+The watcher checked it at Nov 12, 1:49 PM, 1 minute ago\. Holdings match the plan\.\s+Approval active until Dec 2/);
  assert.deepEqual(await real.locator('[data-story-part]').evaluateAll(parts=>parts.map(p=>p.getAttribute('data-story-part'))),['plan','today','value']);
  assert.match(text,/Treasury bills \(BIL\) 60% · SPY 20% · GLD 20%\s+2 of this strategy's 5 funds are in the plan\. The rest of the plan is in BIL, the strategy's fallback fund\./);
  assert.match(text,/This strategy keeps a fund while its latest month-end close is above its ten-month average\. The share of a fund that is not is held in BIL\./);
  assert.match(text,/No orders sent\. The last check found holdings already match the plan\.\s+Last fill: Bought 41 BIL at \$91\.52 \(Nov 3, 10:05 AM\)\./);
  assert.match(text,/\$31,204\.18 at Nov 12, 1:45 PM · down \$12\.40 since the last record of Nov 11\.\s+Prices of what it holds\s+-\$14\.90\s+Cash in or out, other than trades\s+\+\$2\.50/);
  for(const part of await real.locator('[data-story-part]').all())assert.ok(await part.locator('.story-src time[datetime]').count()>=1,'every part names a source and a time');
  const paper=cards.nth(2),simulated=await paper.innerText();
  assert.match(simulated,/Example paper account\s+SIMULATED MONEY\s+RUNNING\s*PARKED/i);assert.match(simulated,/No simulated trades\. This account trades when the monthly decision changes\./);
  assert.match(simulated,/This simulation counts prices only\. It does not add the interest or dividends a fund pays/);
  assert.match(await cards.nth(1).innerText(),/Paper \(reference book\)\s+SIMULATED MONEY\s+NOT STARTED/i);
  for(const card of await cards.all()){assert.equal(await card.locator('button').count(),1,'one button per card');assert.ok(await card.locator('a').count()<=1,'at most one link per card');}
  assert.equal(await page.locator('#main').locator(MONEY).count(),0,'no control on the first screen can change an order, a strategy, an approval or a job');
  assert.deepEqual(await page.locator('#main button:visible, #main a:visible, #main summary:visible').evaluateAll(list=>[...new Set(list.map(el=>el.tagName==='SUMMARY'?'section':el.hasAttribute('data-story-next')?'button':'link'))].sort()),
   ['button','link','section'],'the first screen has three kinds of control: a card\'s button, a card\'s link, and the closed section');
  assert.equal(await page.locator('#homeBroker').evaluate(el=>el.open),false);assert.equal(await page.locator('#tiles').count(),0,'the former landing is not drawn until it is opened');
  assert.equal(await page.locator('#rosterPanel').evaluate(el=>el.hidden),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
  for(const control of await page.locator('#main button:visible, #main a:visible, #main summary:visible').all())assert.ok((await control.boundingBox()).height>=44,'every control is at least 44 pixels high');
  await page.screenshot({path:path.join(PROOF,'trades-first-screen-'+width+'.png'),fullPage:true});
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'opening the screen sends no POST, PATCH or DELETE');assert.deepEqual(errors,[]);await close();
 }
});

test('the former landing is one tap away and whole, and only then is the broker read',async t=>{
 const h=await host(t,standard),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  assert.equal(h.calls().some(line=>/\/summary|\/portfolio/.test(line)),false);
  await page.locator('#homeBroker > summary').click();
  const tile=page.locator('#homeBroker #tiles .tile',{hasText:'···0001'});await tile.getByRole('link',{name:'Manage strategy →'}).waitFor();
  assert.match(await tile.innerText(),/CONNECTED[\s\S]*\$31,204\.18/);assert.equal(await page.locator('#heroTotal').innerText(),'$31,204.18');
  assert.match(await page.locator('#rollup').innerText(),/BIL[\s\S]*204/);assert.equal(await page.locator('#homeBroker #wlHost').count(),0,'the watchlist stays on Research');
  await settled(page);assert.ok(h.calls().includes('GET /api/trading/summary'));assert.ok(h.calls().includes('GET /api/trading/portfolio'),'the tile status read runs once the section is open');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll with the section open at '+width);
  await page.locator('#settingsBtn').click();await page.locator('#settingsBody #rosterPanel #discoverBtn').waitFor();
  assert.match(await page.locator('#settingsBody #discovered').innerText(),/···0001/,'Settings still lists the connected login\'s accounts');
  await page.locator('#settingsClose').click();
  await page.locator('#nav').getByRole('button',{name:'Research',exact:true}).click();await page.locator('#rsWatch').getByText('Watchlist',{exact:false}).first().waitFor();
  assert.deepEqual(errors,[]);await close();
 }
});

const LANDINGS=[
 ['RUNNING','See the last check',()=>({}),{},'#nativeStatusEvidence'],
 ['NEEDS YOU','See what is waiting',()=>({watch:{lastError:'Synthetic quote failure',lastRunAt:'2026-11-12T18:49:30.000Z'}}),{},'#nativeStatusEvidence'],
 ['NOT RUNNING','Go to the watcher switch',()=>({}),{watcher:{status:'suspended',reason:'owner_paused'}},'.native-schedule-bar'],
 ['UNKNOWN','Check this account',()=>({receipt:{observedAt:'2026-11-12T17:00:00.000Z'}}),{},'[data-native-management="refresh"]'],
 ['STOPPED','Set up this account',()=>({watch:{enabled:false,stoppedAt:'2026-11-12T15:00:00.000Z'}}),{},'#nativeStrategySettings'],
];
for(const [chip,label,over,jobs,destination] of LANDINGS)test('a '+chip+' account\'s one button, "'+label+'", opens Manage strategy at the place it names and changes nothing',async t=>{
 const h=await host(t,db=>seedConnected(db,over())),browser=await chromium.launch();t.after(()=>browser.close());
 if(jobs.watcher)Object.assign(h.state.jobs[0],jobs.watcher);
 for(const width of [1280,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width),card=page.locator('#homeCards [data-story-kind="connected"]');
  assert.match(await card.locator('.story-chip').first().innerText(),new RegExp('^'+chip+'$'));
  const button=card.locator('button');assert.equal(await button.innerText(),label);await button.click();
  await page.locator('#nativeAccountManagement '+destination+', '+destination).first().waitFor({state:'attached'});
  assert.equal(await page.locator('#nav button.on').innerText(),'Strategies');
  const url=new URL(page.url());assert.deepEqual([url.searchParams.get('view'),url.searchParams.get('account'),url.searchParams.get('connection')],['strategies',ACCOUNT.accountId,ACCOUNT.connectionKey]);
  const target=page.locator(destination).first();
  if(destination.startsWith('#native'))await page.waitForFunction(selector=>document.querySelector(selector)?.open===true,destination);
  await page.waitForFunction(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return box.top>=-1&&box.top<innerHeight;},destination);
  assert.equal(await target.isVisible(),true);await settled(page);
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'the button only navigates');assert.deepEqual(errors,[]);await close();
 }
});

test('the links and the paper buttons open the existing account screens',async t=>{
 const h=await host(t,db=>{standard(db);seedPaper(db,'paper');}),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,412]){
  h.state.requests.length=0;
  let {page,errors,close}=await open(browser,h,width);
  await page.locator('#homeCards [data-story-kind="connected"]').getByRole('link',{name:'Account details',exact:true}).click();
  await page.getByText('Account details · Schwab',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('sub'),'details');
  assert.match(await page.locator('.details-header h1').innerText(),/···0001/);await close();
  ({page,errors,close}=await open(browser,h,width));
  const named=page.locator('#homeCards [data-story="paper|example-paper"]');assert.equal(await named.locator('a').count(),0);
  await named.getByRole('button',{name:'See passes and fills',exact:true}).click();
  await page.locator('#lpDetail').getByText('Example paper account · simulated',{exact:true}).waitFor();
  assert.equal(await page.locator('#nav button.on').innerText(),'Reports');assert.match(await page.locator('#lpDetail').innerText(),/BIL[\s\S]*1092[\s\S]*buy 1092 BIL at \$91\.52/);await close();
  ({page,errors,close}=await open(browser,h,width));
  const reference=page.locator('#homeCards [data-story="paper|paper"]');
  await reference.getByRole('link',{name:'Open account',exact:true}).click();
  await page.locator('#viewTabs .tabbar button.on',{hasText:'Trade journal'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'account');
  await page.locator('#nav').getByRole('button',{name:'Accounts',exact:true}).click();
  await page.locator('#homeCards [data-story="paper|paper"]').getByRole('button',{name:'See passes and fills',exact:true}).click();
  await page.locator('#viewTabs .tabbar button.on',{hasText:'Trade journal'}).waitFor();await settled(page);
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'links and buttons only navigate');assert.deepEqual(errors,[]);await close();
 }
});

test('an account the broker lists with no saved record gets a card that says so, with the value this page read',async t=>{
 const h=await host(t,db=>seedPaper(db,'example-paper')),browser=await chromium.launch();t.after(()=>browser.close());
 const {page,errors,close}=await open(browser,h,412),card=page.locator('#homeCards [data-story-kind="connected"]');await card.waitFor();
 const text=await card.innerText();
 assert.match(text,/Account ···0001\s+CONNECTED ACCOUNT\s+NOT SET UP/i);assert.match(text,/No strategy is set to run on this account\./);
 assert.match(text,/No value is recorded for this account\.\s+\$31,204\.18 at Nov 12, 1:50 PM, read from your broker by this page\.\s+Source: your broker, read by this page/);
 assert.match(await page.locator('#homeTop').innerText(),/Is it trading\? Yes\. 1 of 1 account set to trade is running\./);
 assert.doesNotMatch(await page.locator('#homeTop').innerText(),/Recorded value/,'a value this page read is never called a recorded value');
 await card.getByRole('button',{name:'Set up this account',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#nativeStrategySettings')?.open===true);assert.deepEqual(errors,[]);await close();
});

test('when the saved-record read fails the screen says so in one line and draws the former landing',async t=>{
 const h=await host(t,standard),browser=await chromium.launch();t.after(()=>browser.close());h.state.todayFails=true;
 for(const width of [1280,412]){
  const {page,errors,close}=await open(browser,h,width,{wait:false});
  await page.locator('#tiles .tile',{hasText:'···0001'}).getByRole('link',{name:'Manage strategy →'}).waitFor();
  assert.equal(await page.locator('#homeFallback').innerText(),'Saved activity could not be read, so balances read from your broker are shown instead. Reason: the server could not answer just now. Try again in a moment.');
  assert.equal(await page.locator('#homeCards').count(),0);assert.equal(await page.locator('#wlHost').count(),1,'the former landing is whole, watchlist included');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await close();
 }
 h.state.todayFails=false;
 const {page,close}=await open(browser,h,1280,{wait:false,query:'?view=accounts&sub=details&account='+ACCOUNT.accountId+'&connection='+ACCOUNT.connectionKey});
 await page.getByText('Account details · Schwab',{exact:true}).waitFor();assert.equal(await page.locator('#homeFallback').count(),0,'a bookmark that names an account still opens that account');await close();
});

test('an armed paper account whose job is off: the page\'s existing keeper switches the job on and nothing else changes; a refused job is said as not running',async t=>{
 const h=await host(t,db=>seedPaper(db,'example-paper')),browser=await chromium.launch();t.after(()=>browser.close());
 const off=()=>Object.assign(h.state.jobs[1],{status:'not-activated',activation:null});
 off();h.accounts.length=0;
 let {page,errors,close}=await open(browser,h,1280);await settled(page);
 assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),['POST /api/v1/agent/schedules/job-paper/activate'],'the one mutation is the keeper\'s existing activation of the person\'s own paper job');
 assert.deepEqual(h.state.sql.filter(text=>!/^\s*SELECT\b/.test(text)),[],'no statement but SELECT');
 await page.locator('#refreshBtn').click();await page.locator('#homeCards [data-story="paper|example-paper"] .story-chip',{hasText:/^RUNNING$/}).waitFor();
 assert.match(await page.locator('#homeTop').innerText(),/Is it trading\? Yes\. 1 of 1 account set to trade is running\./);assert.deepEqual(errors,[]);await close();
 off();h.state.refuseActivation=true;h.state.requests.length=0;
 ({page,errors,close}=await open(browser,h,412));await settled(page);
 const card=page.locator('#homeCards [data-story="paper|example-paper"]');
 assert.match(await card.innerText(),/NOT RUNNING[\s\S]*Armed, but the paper job is not switched on\. Nothing trades\./);
 assert.match(await page.locator('#homeTop').innerText(),/Is it trading\? No\. 0 of 1 account set to trade are running\./);
 assert.equal(await card.locator('button').innerText(),'See passes and fills');
 assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),['POST /api/v1/agent/schedules/job-paper/activate']);assert.deepEqual(errors,[]);await close();
});

test('the first screen paints while the roster read is still waiting on the broker; every other screen waits for it, and the keeper starts after it',async t=>{
 const h=await host(t,standard),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,412]){
  let release;h.state.holdAccounts=new Promise(resolve=>{release=resolve;});h.state.requests.length=0;
  t.after(()=>release());
  const {page,errors,close}=await open(browser,h,width);
  assert.equal(await page.locator('#homeCards [data-story]').count(),3,'the cards are drawn from saved records');
  assert.ok(h.calls().includes('GET /api/trading/accounts'),'the roster read has started');
  assert.equal(h.calls().includes('GET /api/trading/paper/books'),false,'the keeper has not started: it starts when the roster read settles, as before');
  await page.locator('#nav').getByRole('button',{name:'Strategies',exact:true}).click();
  await page.locator('#main .spin').waitFor();await page.waitForTimeout(300);
  assert.equal(await page.locator('#nativeAccountOverview').count(),0,'Strategies waits for the roster, which says whether this installation reads connected accounts');
  release();
  await page.locator('#nativeAccountOverview').waitFor();await settled(page);
  assert.ok(h.calls().includes('GET /api/trading/paper/books'),'the keeper ran once the roster settled');
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[]);assert.deepEqual(errors,[]);await close();h.state.holdAccounts=null;
 }
});

test('a later render reads the roster again, so a newly connected account appears; a roster that cannot be read is said in one line',async t=>{
 const h=await host(t,standard),browser=await chromium.launch();t.after(()=>browser.close());
 const {page,errors,close}=await open(browser,h,1280);await settled(page);
 assert.equal(await page.locator('#homeCards [data-story-kind="connected"]').count(),1);assert.equal(await page.locator('#homeFoot').innerText(),'');
 h.accounts.push({...BROKER_ACCOUNT,accountId:'fixture-account-2',accountMasked:'···0002',equity:1500,cash:1500,positions:[]});
 await page.locator('#refreshBtn').click();
 const added=page.locator('#homeCards [data-story="'+ACCOUNT.connectionKey+'|fixture-account-2"]');await added.waitFor();
 assert.match(await added.innerText(),/Account ···0002[\s\S]*NOT SET UP[\s\S]*\$1,500\.00 at Nov 12, 1:50 PM, read from your broker by this page\./);
 await page.locator('#settingsBtn').click();assert.match(await page.locator('#settingsBody #discovered').innerText(),/···0002/);await page.locator('#settingsClose').click();
 h.state.rosterFails=true;await page.locator('#refreshBtn').click();
 await page.locator('#homeFoot',{hasText:'The list of accounts at your broker could not be read just now, so an account with no saved record may be missing here.'}).waitFor();
 assert.equal(await page.locator('#homeCards [data-story-kind="connected"]').count(),2,'the cards of the last roster stay, with the time that roster was read');
 assert.deepEqual(errors,[]);await close();
});
