/** Real package DDL, SELECT-only execution, campaign membership and school isolation. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='learning_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
 await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
 for(const app of ['dnd','game-show','pumpkin','bake-off','sports-edge'])for(const file of fs.readdirSync(path.join(root,app,'migrations')).filter(f=>/^\d.*\.sql$/.test(f)).sort())await admin.query(fs.readFileSync(path.join(root,app,'migrations',file),'utf8').replaceAll('public.',schema+'.').replaceAll("'public'","'"+schema+"'"));
 for(const prefix of ['019','026','030','032','035']){const file=fs.readdirSync(path.join(root,'little-monsters/migrations')).find(f=>f.startsWith(prefix));await admin.query(fs.readFileSync(path.join(root,'little-monsters/migrations',file),'utf8'));}
 await admin.query(fs.readFileSync(path.join(root,'calendar/migrations/001-calendar-preparation.sql'),'utf8'));await admin.query(fs.readFileSync(path.join(core,'scripts/migrations/062-workflow-run-history.sql'),'utf8'));
 const yt=fs.readFileSync(path.join(root,'youtube-kids/src-routes/youtube-kids-routes.ts'),'utf8').match(/CREATE TABLE IF NOT EXISTS oshal_youtube_activity \([\s\S]*?\)`/);assert.ok(yt);await admin.query(yt[0].slice(0,-1));
 await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
 const ids={};for(const user of ['alice','bob']){
  await admin.query('INSERT INTO calendar_preparation_snapshots(user_sub,events,synced_at) VALUES($1,$2,now())',[user,JSON.stringify([{title:user,start:new Date(Date.now()+86400000).toISOString()}])]);
  await admin.query("INSERT INTO workflow_runs(ticket_id,owner_sub,ticket_type,workflow_name) VALUES($1,$2,'capability-ideation',$2)",[crypto.randomUUID(),user]);
  ids[user]=(await admin.query("INSERT INTO dnd_campaigns(user_sub,name,adventure_id) VALUES($1,$1,'fixture') RETURNING campaign_id",[user])).rows[0].campaign_id;
  await admin.query("INSERT INTO dnd_archive(user_sub,campaign_id,seq,kind,content) VALUES($1,$2,1,'narration',$1)",[user,ids[user]]);
  await admin.query("INSERT INTO pumpkin_responses(user_sub,say,pinned) VALUES($1::text,$1::text,true)",[user]);
  await admin.query("INSERT INTO oshal_youtube_activity(user_sub,total_watched,brief,brief_at) VALUES($1::text,7,$1::text,now())",[user]);
  await admin.query("INSERT INTO sports_followed_teams(user_sub,league,team,team_id) VALUES($1,'NFL',$1,$1)",[user]);
  await admin.query("INSERT INTO sports_previews(event_id,league,home_team,away_team,game_date,payload) VALUES($1,'NFL',$1,'opponent',now()+interval '1 day','{}')",[user]);
 }
 const tenant='00000000-0000-4000-8000-00000000d001';
 for(const user of ['alice','bob']){
  const student=(await admin.query("INSERT INTO lm_students(name,external_id,external_issuer,role) VALUES($1,$1,'https://school.example','student') RETURNING student_id",[user])).rows[0].student_id;
  const cls=(await admin.query("INSERT INTO lm_classes(name,subject,chroma_collection_prefix) VALUES($1,'Math',$1) RETURNING class_id",[user])).rows[0].class_id;
  await admin.query('INSERT INTO lm_enrollments(student_id,class_id,tenant_id) VALUES($1,$2,$3)',[student,cls,tenant]);
  await admin.query("INSERT INTO lm_assignments(class_id,title,due_date) VALUES($1,$2,current_date+1)",[cls,user]);
 }
 const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
 const get=async(app,sub='alice',iss='https://school.example')=>{let handler;const mod={exports:{}};const evaluate=(file)=>{const m={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes',file+'.js'),'utf8'))(name=>name==='express'?{Router:()=>({get:(_,fn)=>handler=fn})}:name==='./education-access'?evaluate('education-access'):name==='@/shared/middleware/authz'?{isOperator:()=>true}:name==='@/shared/logger'?{createChildLogger:()=>({error(){},info(){}})}:load(name),m,m.exports);return m.exports;};evaluate('home-summary').createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await runWithRequestIdentity({sub,isOperator:false},()=>handler({oidc:{user:{sub,iss},isAuthenticated:()=>true}},res));return res;};
 for(const app of ['youtube-kids','dnd','game-show','pumpkin','bake-off','sports-edge','little-monsters','calendar','capability-ideator']){const r=await get(app);assert.equal(r.statusCode,200,app);assert.equal(r.body.partial,false,app);assert.ok(!JSON.stringify(r.body).includes('bob'),app);}
 assert.equal((await get('little-monsters','alice','https://other-school.example')).statusCode,403);
 assert.equal((await get('little-monsters','unmapped')).statusCode,403);
 assert.equal((await get('little-monsters')).body.metrics[1].value,'1');
 await admin.query("INSERT INTO dnd_players(campaign_id,user_sub,display_name) VALUES($1,'alice','member')",[ids.bob]);
 assert.equal((await get('dnd')).body.metrics[0].value,'2');
 await admin.query("DELETE FROM dnd_players WHERE campaign_id=$1 AND user_sub='alice'",[ids.bob]);assert.equal((await get('dnd')).body.metrics[0].value,'1');
 await assert.rejects(runWithRequestIdentity({sub:'alice',isOperator:false},()=>pool.query('DELETE FROM lm_students')),/permission denied/);
 console.log('PASS learning actual DDL, read-only role, owner filters, revoked D&D membership, issuer-bound school identity and class isolation');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
