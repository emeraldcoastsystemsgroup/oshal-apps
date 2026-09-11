/** Actual creative DDL, SELECT-only owner RLS and cross-owner child evidence. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts')),{buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='creative_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  const sourceDdl=async(file,table)=>{const source=fs.readFileSync(path.join(root,file),'utf8'),match=source.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)`'));assert.ok(match,table);await admin.query(match[0].slice(0,-1));};
  await sourceDdl('presentations/src-routes/bot-presentation-routes.ts','oshal_presentations');
  await admin.query("ALTER TABLE oshal_presentations ADD COLUMN outline JSONB; ALTER TABLE oshal_presentations ADD COLUMN format TEXT NOT NULL DEFAULT 'pptx'");
  await sourceDdl('video/src-routes/video-routes.ts','oshal_videos');
  for(const file of ['marketing-engine/migrations/001-marketing-core.sql','marketing-engine/migrations/002-marketing-metrics.sql','venture-plan/migrations/001-venture-core.sql','venture-plan/migrations/003-venture-outputs.sql','video/migrations/066-video-series.sql'])await admin.query(fs.readFileSync(path.join(root,file),'utf8'));
  const vids=fs.readFileSync(path.join(root,'vids/migrations/059-vids-platform.sql'),'utf8');await admin.query(vids.slice(0,vids.indexOf('-- Seed the Veo specialist bot.')));
  for(const table of ['oshal_presentations','oshal_videos'])for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000),ids={};
  for(const user of ['alice','bob']){
   const venture=crypto.randomUUID(),series=crypto.randomUUID(),campaign=crypto.randomUUID();Object.assign(ids,{[user+'Venture']:venture,[user+'Series']:series,[user+'Campaign']:campaign});
   await admin.query("INSERT INTO venture_ventures(id,owner_sub,name,idea_text,created_at,updated_at) VALUES($1,$2::text,$2::text,$2::text,$3,$3)",[venture,user,at(-2)]);
   await admin.query("INSERT INTO venture_assumptions(venture_id,owner_sub,key,domain,label,unit,source_kind,confidence,authored_by,created_at) VALUES($1,$2,'cost','cost','unit cost','USD','model-estimate','low','model',$3)",[venture,user,at(-2)]);
   await admin.query("INSERT INTO venture_models(venture_id,owner_sub,engine_version,inputs_hash,figures,tables,coverage,computed_at) VALUES($1,$2,'v1',$3,'{}','{}','{}',$4)",[venture,user,'a'.repeat(64),at(-2)]);
   await admin.query("INSERT INTO video_series(series_id,user_sub,title,premise,status,created_at,updated_at) VALUES($1,$2,$2,$2,'awaiting_approval',$3,$3)",[series,user,at(-2)]);
   await admin.query("INSERT INTO video_episodes(series_id,user_sub,ordinal,title,status,created_at,updated_at) VALUES($1,$2,1,$2,'assembled',$3,$3)",[series,user,at(-2)]);
   await admin.query("INSERT INTO oshal_marketing_campaigns(campaign_id,user_sub,product,name,slug,created_at,updated_at) VALUES($1,$2,$2,$2,$2,$3,$3)",[campaign,user,at(-2)]);
   await admin.query("INSERT INTO oshal_marketing_content(user_sub,campaign_id,title,body,channel,created_at,updated_at) VALUES($1,$2,$1,$1,'email',$3,$3)",[user,campaign,at(-2)]);
   for(const h of [-1,-25,-119,-121,1]){
    await admin.query('INSERT INTO oshal_presentations(user_sub,title,file_name,outline,created_at) VALUES($1,$1,$1,$2,$3)',[user,JSON.stringify([{title:user,content:'saved content'}]),at(h)]);
    await admin.query('INSERT INTO oshal_videos(user_sub,title,file_name,created_at) VALUES($1,$1,$1,$2)',[user,at(h)]);
    await admin.query("INSERT INTO vids_jobs(user_sub,idea,status,created_at,updated_at) VALUES($1::text,$1::text,'done',$2,$2)",[user,at(h)]);
    await admin.query("INSERT INTO oshal_marketing_run_ledger(user_sub,channel,action,outcome,ts) VALUES($1,'email','publish','published',$2)",[user,at(h)]);
   }
  }
  // Deliberately corrupt child ownership under superuser: explicit parent checks must still reject.
  await admin.query("INSERT INTO oshal_marketing_content(user_sub,campaign_id,title,body,channel) VALUES('alice',$1,'FOREIGN','FOREIGN','email')",[ids.bobCampaign]);
  await admin.query("INSERT INTO venture_assumptions(venture_id,owner_sub,key,domain,label,unit,source_kind,confidence,authored_by) VALUES($1,'alice','foreign','cost','foreign','USD','model-estimate','low','model')",[ids.bobVenture]);
  await admin.query("INSERT INTO video_episodes(series_id,user_sub,ordinal,title,status) VALUES($1,'bob',2,'FOREIGN','assembled')",[ids.aliceSeries]);
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
  const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM vids_jobs')),/permission denied/);
  const get=async(app,sub='alice')=>{let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes/home-summary.js'),'utf8'))(()=>({Router:()=>({get:(_,fn)=>handler=fn})}),module,module.exports);module.exports.createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await as(sub,()=>handler({oidc:{user:{sub},isAuthenticated:()=>true}},res));return res;};
  const expected={presentations:['1','3'],'marketing-engine':['1','0','1','3'],'venture-plan':['1','1'],vids:['0','0','1','3'],video:['1','0','0','3']};
  for(const app of Object.keys(expected))for(let i=0;i<2;i++){const r=await get(app);assert.equal(r.statusCode,200,app);assert.equal(r.body.partial,false,app);assert.ok(!JSON.stringify(r.body).includes('bob'),app);assert.ok(!JSON.stringify(r.body).includes('FOREIGN'),app);assert.ok(!JSON.stringify((await get(app,'bob')).body).includes('alice'),app);assert.deepEqual(r.body.metrics.map(m=>m.value),expected[app],app);}
  assert.match((await get('video')).body.items[0].detail,/1 episodes/);
  await admin.query(`REVOKE SELECT ON oshal_marketing_run_ledger FROM ${schema}`);const partial=await get('marketing-engine');assert.equal(partial.statusCode,200);assert.equal(partial.body.partial,true);assert.equal(partial.body.metrics[0].value,'1');assert.equal(partial.body.metrics[2].value,'Unavailable');
  console.log('PASS creative PostgreSQL: actual DDL, owner RLS, SELECT-only, periods, parent ownership, saved states and partial sources');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
