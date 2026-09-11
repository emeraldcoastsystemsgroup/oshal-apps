/** Real source DDL and SELECT-only owner RLS: commands, mission starts and scan modes. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),{wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts')),{runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts')),{buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='ops_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  for(const [table,file] of Object.entries({camera_command_log:'camera/src-routes/camera-routes.ts',drone_command_log:'drone/src-routes/drone-routes.ts',drone_missions:'drone/src-routes/drone-routes.ts',spatial_scans:'../oshal/src/features/spatial-mapping/services/spatial-scan-store.ts'})){
   const source=fs.readFileSync(path.join(root,file),'utf8'),re=new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)(?:;|`)'),match=source.match(re);assert.ok(match,table);await admin.query(match[0].replace(/`$/,''));for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  }
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const at=h=>new Date(Date.now()+h*3600000);
  for(const user of ['alice','bob'])for(const h of [-1,-25,-119,-121,1]){
   await admin.query("INSERT INTO camera_command_log(user_sub,camera_id,op,outcome,created_at) VALUES($1::text,$1::text,'capture','rejected',$2)",[user,at(h)]);
   await admin.query("INSERT INTO drone_command_log(user_sub,command,outcome,created_at) VALUES($1,'startMission','rejected',$2)",[user,at(h)]);
   await admin.query("INSERT INTO drone_missions(user_sub,name,plan,status,last_flown_at,created_at,updated_at) VALUES($1::text,$1::text,'{}','flown',$2,$2,$2)",[user,at(h)]);
   for(const provider of ['sim','edge','import'])await admin.query("INSERT INTO spatial_scans(id,user_sub,title,status,provider,source_kind,created_at,updated_at) VALUES($1,$2,$2,'ready',$3,'video',$4,$4)",[crypto.randomUUID(),user,provider,at(h)]);
  }
  const ru=new URL(url);ru.username=schema;ru.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:ru.href,options:`-c search_path=${schema}`}));
  const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM drone_missions')),/permission denied/);
  const get=async(app,sub='alice')=>{let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes/home-summary.js'),'utf8'))(()=>({Router:()=>({get:(_,fn)=>handler=fn})}),module,module.exports);module.exports.createHomeSummaryRoutes({pool});const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await as(sub,()=>handler({oidc:{user:{sub},isAuthenticated:()=>true}},res));return res;};
  const expected={camera:['1','3','3'],drone:['0','3','3'],spaces:['0','0','8','4']};
  for(const app of Object.keys(expected))for(let i=0;i<2;i++){const r=await get(app);assert.equal(r.statusCode,200,app);assert.equal(r.body.partial,false,app);assert.ok(!JSON.stringify(r.body).includes('bob'),app);assert.ok(!JSON.stringify((await get(app,'bob')).body).includes('alice'),app);assert.deepEqual(r.body.metrics.map(m=>m.value),expected[app],app);}
  await admin.query(`REVOKE SELECT ON drone_command_log FROM ${schema}`);const partial=await get('drone');assert.equal(partial.statusCode,200);assert.equal(partial.body.partial,true);assert.equal(partial.body.metrics[1].value,'3');assert.equal(partial.body.metrics[2].value,'Unavailable');
  console.log('PASS operations PostgreSQL: actual DDL, owner RLS, SELECT-only, rolling periods, simulation separation and partial sources');
 }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
