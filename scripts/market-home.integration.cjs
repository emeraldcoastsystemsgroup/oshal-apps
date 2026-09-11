/** Actual market source DDL, owner RLS, SELECT-only roles and recorded-state attribution. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts')),{buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='market_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  const ddl=async(file,table)=>{const source=fs.readFileSync(path.join(core,'src/app',file),'utf8'),match=source.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)`'));assert.ok(match,table);await admin.query(match[0].slice(0,-1));};
  await ddl('trading-accounts-store.ts','oshal_trading_accounts');
  const accounts=fs.readFileSync(path.join(core,'src/app/trading-accounts-store.ts'),'utf8');await admin.query(accounts.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_trd_accounts_owner_pair[^']+/)[0]);
  await ddl('trading-books-store.ts','oshal_trading_books');await ddl('trading-schema.ts','oshal_trading_decisions');await ddl('trading-schema.ts','oshal_trading_orders');await ddl('trading-daily-equity-store.ts','oshal_trading_daily_equity');
  const daily=fs.readFileSync(path.join(core,'src/app/trading-daily-equity-store.ts'),'utf8');await admin.query(daily.match(/ALTER TABLE oshal_trading_daily_equity ADD COLUMN IF NOT EXISTS book_id UUID/)[0]);
  for(const file of ['074-kalshi-orders.sql','076-kalshi-scan-automation.sql'])await admin.query(fs.readFileSync(path.join(root,'kalshi/migrations',file),'utf8'));
  for(const table of ['oshal_trading_accounts','oshal_trading_books','oshal_trading_decisions','oshal_trading_orders','oshal_trading_daily_equity','kalshi_orders','kalshi_scan_alerts'])for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000),ids={};
  for(const user of ['alice','bob'])for(const mode of ['paper','live']){
   const book=crypto.randomUUID();ids[user+mode]=book;
   await admin.query('INSERT INTO oshal_trading_books(book_id,user_sub,ref,label,kind) VALUES($1,$2,$3,$4,$3)',[book,user,mode,user+' '+mode]);
   await admin.query("INSERT INTO oshal_trading_daily_equity(user_sub,mode,et_day,equity,updated_at,book_id) VALUES($1,$2,'2026-09-01',123.45,$3,$4)",[user,mode,at(-2),book]);
   const decision=(await admin.query("INSERT INTO oshal_trading_decisions(user_sub,mode,signal_ids,action,rationale) VALUES($1,$2,$3,'hold','fixture') RETURNING decision_id",[user,mode,[crypto.randomUUID()]])).rows[0].decision_id;
   for(const h of [-1,-25,-119,-121,1])await admin.query("INSERT INTO oshal_trading_orders(user_sub,mode,decision_id,broker,client_order_id,symbol,side,qty,order_type,status,created_at,updated_at) VALUES($1,$2,$3,'fixture',$4,'AAPL','buy',1,'market','rejected',$5,$5)",[user,mode,decision,user+mode+h,at(h)]);
  }
  // Latest snapshot with a foreign book id must never attach to Alice's book.
  await admin.query("INSERT INTO oshal_trading_daily_equity(user_sub,mode,et_day,equity,updated_at,book_id) VALUES('bob','paper','2026-09-02',9999,$1,$2)",[at(-1),ids.alicepaper]);
  for(const user of ['alice','bob'])for(const h of [-1,-25,-119,-121,1]){
   await admin.query("INSERT INTO kalshi_scan_alerts(user_sub,ticker,delivered,created_at) VALUES($1,$2,$3,$4)",[user,user+h,h===-1,at(h)]);
   await admin.query("INSERT INTO kalshi_orders(user_sub,env,ticker,side,action,count,limit_price_cents,client_order_id,kalshi_status,created_at) VALUES($1,'demo',$2,'yes','buy',1,50,$2,'resting',$3)",[user,user+h,at(h)]);
  }
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
  const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM kalshi_orders')),/permission denied/);
  const get=async(app,sub='alice')=>{let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes/home-summary.js'),'utf8'))(()=>({Router:()=>({get:(_,fn)=>handler=fn})}),module,module.exports);module.exports.createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await as(sub,()=>handler({oidc:{user:{sub},isAuthenticated:()=>true}},res));return res;};
  for(const app of ['trading','kalshi'])for(let i=0;i<2;i++){const r=await get(app);assert.equal(r.statusCode,200);assert.equal(r.body.partial,false);assert.ok(!JSON.stringify(r.body).includes('bob'));assert.ok(!JSON.stringify(r.body).includes('9999'));assert.ok(!JSON.stringify((await get(app,'bob')).body).includes('alice'));}
  assert.deepEqual((await get('trading')).body.metrics.map(m=>m.value),['1','3','1','3']);assert.deepEqual((await get('kalshi')).body.metrics.map(m=>m.value),['1','3','1']);
  await admin.query(`REVOKE SELECT ON oshal_trading_daily_equity FROM ${schema}`);const partial=await get('trading');assert.equal(partial.statusCode,200);assert.equal(partial.body.partial,true);assert.equal(partial.body.metrics[0].value,'1');
  console.log('PASS market PostgreSQL: actual source DDL, owner RLS, SELECT-only, rolling periods, per-book snapshots, modes, delivery and partial sources');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
