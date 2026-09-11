/** Actual creative DDL, SELECT-only owner RLS and cross-owner child evidence. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts')),{buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='media_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  for(const file of ['portrait-studio/migrations/001-portrait-studio.sql','lora/migrations/058-lora-studio.sql','print-ingest/migrations/001-print-ingest.sql'])await admin.query(fs.readFileSync(path.join(root,file),'utf8'));
  await admin.query(fs.readFileSync(path.join(core,'scripts/migrations/062-workflow-run-history.sql'),'utf8'));
  const vids=fs.readFileSync(path.join(root,'vids/migrations/059-vids-platform.sql'),'utf8');await admin.query(vids.slice(0,vids.indexOf('-- Seed the Veo specialist bot.')));
  const source=fs.readFileSync(path.join(core,'src/app/routes/storage-target.ts'),'utf8'),ddl=source.match(/CREATE TABLE IF NOT EXISTS oshal_storage_prefs \([\s\S]*?\)`/);assert.ok(ddl);await admin.query(ddl[0].slice(0,-1));
  for(const table of ['ps_portraits','oshal_storage_prefs'])for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000),ids={};
  for(const user of ['alice','bob']){
   const character=crypto.randomUUID();ids[user]=character;
   await admin.query('INSERT INTO oshal_lora_characters(id,owner_sub,subject,display_name,trigger_word,created_at) VALUES($1,$2,$2,$2,$2,$3)',[character,user,at(-2)]);
   await admin.query("INSERT INTO oshal_lora_models(character_id,version,status,created_at) VALUES($1,1,'scored',$2),($1,2,'training',$2)",[character,at(-2)]);
   await admin.query('INSERT INTO oshal_lora_scores(character_id,version,overall,created_at) VALUES($1,1,0.9999,$2)',[character,at(-2)]);
   await admin.query("INSERT INTO oshal_storage_prefs(user_sub,code_provider,files_provider,updated_at) VALUES($1,'github','oshal-local',$2)",[user,at(-2)]);
   for(const h of [-1,-25,-119,-121,1]){
    await admin.query("INSERT INTO ps_portraits(user_sub,style,status,created_at,updated_at) VALUES($1,$1,'done',$2,$2)",[user,at(h)]);
    await admin.query("INSERT INTO print_intake(owner_sub,content_sha256,title,text_body,created_at) VALUES($1,$2,$1,$1,$3)",[user,user+h,at(h)]);
    for(const kind of ['brand','story','clip'])await admin.query("INSERT INTO vids_jobs(user_sub,idea,status,insert_mode,created_at,updated_at) VALUES($1::text,$1::text,'done',$2,$3,$3)",[user,kind,at(h)]);
    const run=crypto.randomUUID();
    await admin.query("INSERT INTO workflow_runs(run_id,ticket_id,owner_sub,ticket_type,workflow_name,status,started_at,finished_at,updated_at) VALUES($1,$1,$2,'daily-trade-recap',$2,'completed',$3,$3,$3)",[run,user,at(h)]);
    await admin.query("INSERT INTO workflow_run_steps(run_id,owner_sub,node_id,node_type,node_title,status,created_at) VALUES($1,$2,'step','deliver',$2,'completed',$3)",[run,user,at(h)]);
    await admin.query("INSERT INTO workflow_run_steps(run_id,owner_sub,node_id,node_type,node_title,status,created_at) VALUES($1,$2,'foreign','deliver','FOREIGN','completed',$3)",[run,user==='alice'?'bob':'alice',at(h)]);
   }
  }
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
  const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM vids_jobs')),/permission denied/);
  const get=async(app,sub='alice')=>{let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes/home-summary.js'),'utf8'))(()=>({Router:()=>({get:(_,fn)=>handler=fn})}),module,module.exports);module.exports.createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await as(sub,()=>handler({oidc:{user:{sub},isAuthenticated:()=>true}},res));return res;};
  const expected={'brand-graphics':['0','0','3'],'creative-studio':['0','0','3'],'daily-trade-recap':['0','0','0','3'],lora:['1','1','0'],'portrait-studio':['0','0','3'],'print-ingest':['4','0','3'],storage:['github','oshal-local']};
  for(const app of Object.keys(expected))for(let i=0;i<2;i++){const r=await get(app);assert.equal(r.statusCode,200,app);assert.equal(r.body.partial,false,app);assert.ok(!JSON.stringify(r.body).includes('bob'),app);assert.ok(!JSON.stringify(r.body).includes('FOREIGN'),app);assert.ok(!JSON.stringify((await get(app,'bob')).body).includes('alice'),app);assert.deepEqual(r.body.metrics.map(m=>m.value),expected[app],app);}
  const lora=(await get('lora')).body;assert.ok(!JSON.stringify(lora).includes('0.9999'));assert.match(lora.items[0].actions[0].context.notes,/not recorded/);
  await admin.query(`REVOKE SELECT ON workflow_run_steps FROM ${schema}`);const partial=await get('daily-trade-recap');assert.equal(partial.statusCode,200);assert.equal(partial.body.partial,true);assert.equal(partial.body.metrics[3].value,'3');
  console.log('PASS media PostgreSQL: actual DDL, owner RLS, SELECT-only, periods, job-kind attribution, matching model evaluation, private steps and partial sources');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
