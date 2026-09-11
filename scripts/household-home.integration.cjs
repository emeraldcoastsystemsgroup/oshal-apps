/** Actual household schemas, owner RLS, SELECT-only source grants and rendered Home cards. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),core=path.resolve(root,'../oshal'),load=createRequire(path.join(core,'package.json'));
process.env.TSX_TSCONFIG_PATH=path.join(core,'tsconfig.json');process.env.NODE_PATH=path.join(core,'node_modules');require('module').Module._initPaths();load('tsx/cjs');
const {Pool}=load('pg'),express=load('express'),{chromium}=load('playwright');
const {wrapPoolWithGuc}=load(path.join(core,'src/shared/services/database/guc-pool.ts'));
const {runWithRequestIdentity}=load(path.join(core,'src/shared/services/database/request-identity.ts'));
const {buildOwnerRlsPolicyStatements}=load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
const {readManifest,buildHomePlan,validateSummaryDeclaration}=load(path.join(core,'src/features/swarm-apps/index.ts'));
const apps=['movies','spotify','travel','rides','eats','purchasing'];
(async()=>{
 const url=new URL(process.env.HOME_TEST_DATABASE_URL||'postgresql://localhost/invalid');assert.equal(url.pathname,'/home_summary_test');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='household_'+crypto.randomBytes(6).toString('hex'),admin=new Pool({connectionString:url.href});let pool,server,browser;
 const as=(sub,fn)=>runWithRequestIdentity({sub,isOperator:false},fn);
 try{
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${schema} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${schema}; SET search_path TO ${schema}`);
  for(const file of ['movies/migrations/048-movies-platform.sql','spotify/migrations/046-spotify-platform.sql','rides/migrations/042-rides-platform.sql','eats/migrations/040-eats-platform.sql','purchasing/migrations/035-purchasing-platform.sql'])await admin.query(fs.readFileSync(path.join(root,file),'utf8'));
  const travelSource=fs.readFileSync(path.join(core,'src/app/routes/travel-farewatch.ts'),'utf8');
  for(const table of ['travel_searches','travel_watches']){const ddl=travelSource.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\);'));assert.ok(ddl);await admin.query(ddl[0]);}
  const tables=['movies_watchlist','spotify_profile','rides_requests','eats_carts','eats_cart_items','eats_orders','shop_lists','shop_list_items','shop_purchase_history','travel_searches','travel_watches'];
  for(const table of tables)for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub'))await admin.query(sql);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${schema}`);
  const now=Date.now(),at=hours=>new Date(now+hours*3600000);
  for(const user of ['alice','bob']){
   await admin.query("INSERT INTO movies_watchlist(user_sub,item_key,title,created_at) VALUES ($1,'saved',$2,$3)",[user,user+' private movie',at(-1)]);
   await admin.query("INSERT INTO spotify_profile(user_sub,favorite_genres,favorite_artists,updated_at) VALUES ($1,$2,$3,$4)",[user,[user+' genre'],[user+' artist'],at(-1)]);
   await admin.query("INSERT INTO travel_watches(user_sub,route_key,query,created_at) VALUES ($1,$2,$3,$4)",[user,user+' route',{destination:user+' destination',token:'DO-NOT-SEND'},at(-1)]);
   const meal=(await admin.query("INSERT INTO eats_carts(user_sub,store_name) VALUES ($1,$2) RETURNING cart_id",[user,user+' restaurant'])).rows[0].cart_id;
   await admin.query("INSERT INTO eats_cart_items(cart_id,user_sub,title,created_at) VALUES ($1,$2,$3,$4)",[meal,user,user+' meal',at(-1)]);
   const list=(await admin.query("INSERT INTO shop_lists(user_sub,name) VALUES ($1,$2) RETURNING list_id",[user,user+' list'])).rows[0].list_id;
   await admin.query("INSERT INTO shop_list_items(list_id,user_sub,title,created_at) VALUES ($1,$2,$3,$4)",[list,user,user+' grocery',at(-1)]);
   for(const hours of [-1,-25,-119,-121,1]){
    await admin.query('INSERT INTO rides_requests(user_sub,dropoff,created_at) VALUES ($1,$2,$3)',[user,user+' destination '+hours,at(hours)]);
    await admin.query('INSERT INTO eats_orders(user_sub,created_at) VALUES ($1,$2)',[user,at(hours)]);
    await admin.query('INSERT INTO shop_purchase_history(user_sub,created_at) VALUES ($1,$2)',[user,at(hours)]);
    await admin.query("INSERT INTO travel_searches(user_sub,route_key,created_at) VALUES ($1,'route',$2)",[user,at(hours)]);
   }
   if(user==='bob'){
    await admin.query("INSERT INTO shop_list_items(list_id,user_sub,title) VALUES ($1,'alice','Cross-owner list item')",[list]);
    await admin.query("INSERT INTO eats_cart_items(cart_id,user_sub,title) VALUES ($1,'alice','Cross-owner cart item')",[meal]);
   }
  }
  await admin.query("INSERT INTO movies_watchlist(user_sub,item_key,title,status) VALUES ('alice','watched','Excluded watched title','watched')");
  await admin.query("INSERT INTO movies_watchlist(user_sub,item_key,title,created_at) VALUES ('alice','future','Excluded future title',$1)",[at(1)]);
  await admin.query("INSERT INTO travel_watches(user_sub,route_key,status) VALUES ('alice','Excluded paused route','paused')");
  const archived=(await admin.query("INSERT INTO shop_lists(user_sub,status) VALUES ('alice','archived') RETURNING list_id")).rows[0].list_id;
  await admin.query("INSERT INTO shop_list_items(list_id,user_sub,title) VALUES ($1,'alice','Excluded archived item')",[archived]);
  const roleUrl=new URL(url);roleUrl.username=schema;roleUrl.password='fixture-only';pool=wrapPoolWithGuc(new Pool({connectionString:roleUrl.href,options:`-c search_path=${schema}`}));
  assert.equal((await as('bob',()=>pool.query('SELECT * FROM movies_watchlist'))).rows.length,1);
  await assert.rejects(as('alice',()=>pool.query('DELETE FROM movies_watchlist')),/permission denied/);
  const app=express();app.use((req,_res,next)=>{const sub=req.headers['x-test-user']||'alice';req.oidc={user:{sub},isAuthenticated:()=>sub!=='anonymous'};as(sub,next);});
  const manifests=apps.map(name=>readManifest(path.join(root,name,'oshal-app.yaml')));
  for(const [i,name]of apps.entries()){validateSummaryDeclaration(manifests[i],path.join(root,name,'oshal-app.yaml'));const mount=manifests[i].routes.find(r=>r.module==='routes/home-summary.js');assert.equal(mount.auth,'oidc');assert.equal(mount.requiresAi,false);app.use(mount.mountPath,require(path.join(root,name,mount.module))[mount.factory]({pool}));}
  app.get('/api/swarm/apps/home-plan',(_req,res)=>res.json({apps:buildHomePlan(manifests)}));app.get('/api/home/preferences',(_req,res)=>res.json({preferences:{version:1},revision:0}));
  app.use('/cockpit',express.static(path.join(core,'src/pages/cockpit')));
  app.get('/',(_req,res)=>res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/cockpit/css/apps-home.css"></head><body><main id="home"></main><script type="module">import {AppsHomeView} from '/cockpit/js/views/AppsHomeView.js';new AppsHomeView({navigateToView:()=>{}}).render(document.querySelector('#home'));</script></body></html>`));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
  const get=async(name,user='alice')=>{const r=await fetch(base+'/api/'+name+'/home-summary?user_sub=bob',{headers:{'x-test-user':user}});return {status:r.status,body:await r.json()};};
  const values=r=>Object.fromEntries(r.body.metrics.map(m=>[m.id,m.value]));
  for(const name of apps){assert.equal((await get(name,'anonymous')).status,401);for(let i=0;i<2;i++){const r=await get(name);assert.equal(r.status,200);assert.equal(r.body.partial,false);assert.ok(!JSON.stringify(r.body).includes('bob'));assert.ok(!JSON.stringify(r.body).includes('Cross-owner'));assert.ok(!JSON.stringify(r.body).includes('Excluded'));assert.ok(!JSON.stringify(r.body).includes('DO-NOT-SEND'));assert.ok(r.body.items.some(x=>x.actions?.length));}assert.ok(!JSON.stringify((await get(name,'bob')).body).includes('alice'));assert.equal((await get(name,'empty')).status,200);}
  assert.equal(values(await get('movies'))['watchlist-titles'],'1');
  assert.equal(values(await get('travel'))['saved-fare-watches'],'1');
  assert.equal(values(await get('eats'))['pending-meal-items'],'1');
  assert.equal(values(await get('purchasing'))['pending-shopping-items'],'1');
  for(const [name,prefix]of [['rides','ride-handoffs'],['travel','flight-searches'],['eats','meal-handoffs'],['purchasing','shopping-handoffs']]){const v=values(await get(name));assert.equal(v[prefix+'-24h'],'1');assert.equal(v[prefix+'-5d'],'3');}
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('[data-card="movies"]').getByText('alice private movie',{exact:false}).first().waitFor();await page.locator('[data-card="spotify"]').getByText('Your music preferences',{exact:false}).first().waitFor();assert.equal(await page.locator('.apps-home-card').count(),6);assert.deepEqual(errors,[]);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await admin.query(`REVOKE SELECT ON travel_searches FROM ${schema}`);const partial=await get('travel');assert.equal(partial.status,200);assert.equal(partial.body.partial,true);assert.equal(values(partial)['saved-fare-watches'],'1');assert.equal(values(partial)['flight-searches-24h'],'Unavailable');
  console.log('PASS household PostgreSQL/Chromium: six cards, two owners, readonly, time windows, parent ownership, saved states, partial failures and mobile');
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema}`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
