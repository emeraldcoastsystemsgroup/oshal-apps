/** Actual source DDL, owner RLS and SELECT-only grants for financial Home. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),express=load('express');
const {wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts'));
const {runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts'));
const {buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='business_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool,server;
 const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  const tables={finance:['oshal_finance_items','oshal_finance_data','oshal_finance_payments'],payments:['oshal_merchant_payments'],payroll:['payroll_runs','payroll_payments']};
  for(const [app,names]of Object.entries(tables)){
   const source=fs.readFileSync(path.join(root,app,'src-routes',app==='payroll'?'payroll-schema.ts':app+'-routes.ts'),'utf8');
   for(const table of names){const ddl=source.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)`'));assert.ok(ddl,table);await admin.query(ddl[0].slice(0,-1));for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);}
  }
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000);
  for(const user of ['alice','bob']){
   await admin.query('INSERT INTO oshal_finance_items(item_id,user_sub,access_token,linked_at) VALUES($1,$2,$3,$4)',[user,user,'PRIVATE-TOKEN',at(-1)]);
   await admin.query('INSERT INTO oshal_finance_data(user_sub,aggregate,brief,synced_at,brief_at) VALUES($1,$2,$3,$4,$4)',[user,{currency:'USD',sourceEnvironment:'sandbox',netWorth:{net:123.45},accounts:[{currency:'USD'}]},user+' saved brief',at(-2)]);
   for(const h of [-1,-25,-119,-121,1])await admin.query("INSERT INTO oshal_merchant_payments(charge_id,user_sub,provider,amount_cents,currency,status,test_mode,created_at,updated_at) VALUES($1,$2,'fixture',1200,'USD','completed',false,$3,$3)",[user+h,user,at(h)]);
   await admin.query("INSERT INTO oshal_merchant_payments(charge_id,user_sub,provider,amount_cents,currency,status,test_mode) VALUES($1,$2,'fixture',1200,'USD','failed',true)",[user+'-test',user]);
   await admin.query("INSERT INTO oshal_finance_payments(transfer_id,user_sub,provider,amount_cents,currency,status,test_mode) VALUES($1,$2,'fixture',1200,'USD','pending',true)",[user,user]);
   await admin.query("INSERT INTO payroll_runs(run_id,user_sub,period_start,period_end,pay_date,pay_frequency) VALUES($1,$2,'2026-09-01','2026-09-14','2026-09-15','biweekly')",[user,user]);
   await admin.query("INSERT INTO payroll_payments(payment_id,user_sub,run_id,employee_id,status) VALUES($1,$2,$2,'PRIVATE-EMPLOYEE','pending')",[user,user]);
  }
  await admin.query("INSERT INTO payroll_payments(payment_id,user_sub,run_id,employee_id,status) VALUES('cross','alice','bob','PRIVATE-EMPLOYEE','returned')");
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM payroll_runs')),/permission denied/);
  assert.equal((await as('alice',()=>pool.query('SELECT * FROM oshal_finance_items'))).rows.length,1);
  const app=express();app.use((req,_res,next)=>{const sub=req.headers['x-test-user']||'alice';req.oidc={user:{sub},isAuthenticated:()=>sub!=='anonymous'};as(sub,next);});
  for(const name of Object.keys(tables))app.use('/'+name,require(path.join(root,name,'routes/home-summary.js')).createHomeSummaryRoutes({pool}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
  const get=async(name,user='alice')=>{const r=await fetch(base+'/'+name+'?user_sub=bob',{headers:{'x-test-user':user}});return {status:r.status,body:await r.json()};},values=r=>Object.fromEntries(r.body.metrics.map(m=>[m.id,m.value]));
  for(const name of Object.keys(tables)){assert.equal((await get(name,'anonymous')).status,401);for(let i=0;i<2;i++){const r=await get(name);assert.equal(r.status,200);assert.equal(r.body.partial,false);assert.ok(!JSON.stringify(r.body).includes('bob'));assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));assert.ok(r.body.items.some(x=>x.actions?.length));}assert.ok(!JSON.stringify((await get(name,'bob')).body).includes('alice'));}
  const p=values(await get('payments'));assert.equal(p['live-charges-24h'],'1');assert.equal(p['live-charges-5d'],'3');assert.equal(p['test-charges-5d'],'1');assert.equal(p['live-charges-failed-5d'],'0');
  assert.equal(values(await get('payroll'))['pending-payments'],'1');assert.equal(values(await get('payroll'))['returned-payments'],'0');
  assert.equal(values(await get('finance'))['cached-net-worth'],'USD 123.45');assert.equal(values(await get('finance'))['snapshot-mode'],'sandbox');
  await admin.query("UPDATE oshal_finance_data SET aggregate=$1 WHERE user_sub='alice'",[{currency:'USD',netWorth:{net:200},accounts:[{currency:'USD'},{currency:'EUR'}]}]);assert.equal(values(await get('finance'))['cached-net-worth'],'Mixed currencies');assert.equal(values(await get('finance'))['snapshot-mode'],'mode not recorded');
  await admin.query(`REVOKE SELECT ON oshal_finance_payments FROM ${schema}`);const partial=await get('finance');assert.equal(partial.status,200);assert.equal(partial.body.partial,true);assert.equal(values(partial)['linked-institutions'],'1');
  console.log('PASS business PostgreSQL: actual schemas, owner RLS, SELECT-only, periods, test/live, mixed currencies, parent ownership and partial failures');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
