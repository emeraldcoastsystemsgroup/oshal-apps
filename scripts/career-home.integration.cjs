/** Source schema, owner RLS, confirmation provenance and rolling time boundaries. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts')),{buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='career_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  for(const file of ['career-hunter/migrations/031-career-hunter.sql','career-hunter/migrations/095-career-corpus.sql','../oshal/scripts/migrations/118-apply-runs-ledger.sql'])await admin.query(fs.readFileSync(path.join(root,file),'utf8'));
  const ddl=fs.readFileSync(path.join(core,'src/app/routes/inbox-ingest.ts'),'utf8').match(/CREATE TABLE IF NOT EXISTS oshal_inbox_messages \([\s\S]*?\)`/);assert.ok(ddl);await admin.query(ddl[0].slice(0,-1));
  for(const table of ['career_hunter_applications','career_user_job_scores','career_user_applications','oshal_inbox_messages'])for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000);
  for(const user of ['alice','bob']){
   const co=(await admin.query('INSERT INTO career_companies(name) VALUES($1) RETURNING id',[user])).rows[0].id;
   for(const h of [-1,-25,-119,-121,1]){
    const pid=(await admin.query('INSERT INTO career_postings(company_id,ats_job_id,title) VALUES($1,$2,$3) RETURNING id',[co,user+h,user])).rows[0].id;
    await admin.query("INSERT INTO career_user_job_scores(user_sub,posting_id,target_role,fit_score,scored_at) VALUES($1,$2,true,75,$3)",[user,pid,at(h)]);
    await admin.query("INSERT INTO career_hunter_applications(user_sub,posting_id,created_at,updated_at) VALUES($1,$2,$3,$3)",[user,pid,at(h)]);
    await admin.query("INSERT INTO career_user_applications(user_sub,posting_id,interview_at,created_at,updated_at) VALUES($1,$2,$3,$3,$3)",[user,pid,at(h)]);
    for(const state of ['submitted_verified','manual_mark','unknown_outcome']){
     const run=crypto.randomUUID();await admin.query("INSERT INTO apply_runs(run_id,ticket_id,owner_sub,posting_id,claim_token,task_id,worker_client_id,state,claimed_at,dispatched_at,finished_at,timeout_at,confirmation_path,confirmation_sha256,metadata,created_at,updated_at) VALUES($1::uuid,$1::text,$2,$3,$1::uuid,$1::text,'fixture-worker',$4,$5,$5,$5,$5,$6,$7,$8,$5,$5)",[run,user,pid,state,at(h),state==='submitted_verified'?'PRIVATE-PATH':null,state==='submitted_verified'?'a'.repeat(64):null,{trigger:'manual',initiatedBySub:user,automationSettingsVersion:null}]);
    }
    await admin.query("INSERT INTO oshal_inbox_messages(user_sub,msg_id,subject,snippet,category,received_at,ingested_at) VALUES($1,$2,$1,$1,'social',$3,$3)",[user,user+h,at(h)]);
   }
  }
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM apply_runs')),/permission denied/);
  const get=async(app,sub='alice')=>{let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes/home-summary.js'),'utf8'))(()=>({Router:()=>({get:(_,fn)=>handler=fn})}),module,module.exports);module.exports.createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await as(sub,()=>handler({oidc:{user:{sub},isAuthenticated:()=>true}},res));return res;};
  const expected={'career-hunter':['4','1','3','4','3'],'job-apply':['0','4','4','1','3'],social:['1','3']};
  for(const app of Object.keys(expected))for(let i=0;i<2;i++){const r=await get(app);assert.equal(r.statusCode,200,app);assert.equal(r.body.partial,false,app);assert.ok(!JSON.stringify(r.body).includes('bob'),app);assert.ok(!JSON.stringify(r.body).includes('PRIVATE-PATH'),app);assert.ok(!JSON.stringify((await get(app,'bob')).body).includes('alice'),app);assert.deepEqual(r.body.metrics.map(m=>m.value),expected[app],app);}
  await admin.query(`REVOKE SELECT ON career_postings FROM ${schema}`);const partial=await get('job-apply');assert.equal(partial.statusCode,200);assert.equal(partial.body.partial,true);assert.equal(partial.body.metrics[4].value,'3');
  console.log('PASS career PostgreSQL: actual source DDL, owner RLS, SELECT-only, confirmation provenance, manual/unknown separation, rolling periods and partial sources');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
