/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Real PostgreSQL and Chromium acceptance for the packaged Feeds, Email and Switchboard Home extractors.
 * Run from core with HOME_TEST_DATABASE_URL set to a disposable localhost home_summary_test database.
 */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const core = path.resolve(process.env.HOME_TEST_CORE || path.join(root, '../oshal'));
const load = createRequire(path.join(core, 'package.json'));
process.env.TSX_TSCONFIG_PATH = path.join(core,'tsconfig.json');
process.env.NODE_PATH = path.join(core,'node_modules');
require('node:module').Module._initPaths();
load('tsx/cjs');
const {Pool} = load('pg');
const express = load('express');
const {chromium} = load('playwright');
const {wrapPoolWithGuc} = load(path.join(core,'src/shared/services/database/guc-pool.ts'));
const {runWithRequestIdentity} = load(path.join(core,'src/shared/services/database/request-identity.ts'));
const {buildOwnerRlsPolicyStatements} = load(path.join(core,'src/shared/services/database/owner-rls-policy.ts'));
const {createAppHomePreferenceRoutes} = load(path.join(core,'src/app/routes/app-home-preferences.ts'));
const {buildHomePlan,readManifest,validateSummaryDeclaration} = load(path.join(core,'src/features/swarm-apps/index.ts'));
const {encryptSessionValue} = require('../email-summarizer/routes/session-crypto.js');
const apps = ['feeds','email-summarizer','switchboard'];

async function main() {
  const url = new URL(process.env.HOME_TEST_DATABASE_URL || 'postgresql://localhost/invalid');
  assert.equal(url.pathname,'/home_summary_test');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  const schema = 'comms_' + crypto.randomBytes(6).toString('hex');
  const role = schema;
  const admin = new Pool({connectionString:url.href});
  let pool, server, browser;
  const priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  const as = (sub, fn) => runWithRequestIdentity({sub,isOperator:false},fn);
  try {
    await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${role} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${role}; SET search_path TO ${schema}`);
    const feedSchema = fs.readFileSync(path.join(core,'scripts/migrations/045-feeds-platform.sql'),'utf8');
    // The actual feed DDL, stopping before unrelated agent seeding.
    await admin.query(feedSchema.slice(0,feedSchema.indexOf('INSERT INTO agents')));
    await admin.query(fs.readFileSync(path.join(root,'switchboard/migrations/001-switchboard-reply-outbox.sql'),'utf8'));
    await admin.query(fs.readFileSync(path.join(root,'switchboard/migrations/002-switchboard-stream-posts.sql'),'utf8'));
    const emailSource = fs.readFileSync(path.join(root,'email-summarizer/src-routes/email-app-routes.ts'),'utf8');
    const emailDDL = emailSource.match(/`(CREATE TABLE IF NOT EXISTS oshal_email_digests[\s\S]*?)`/);
    assert.ok(emailDDL,'Use the actual package schema');
    await admin.query(emailDDL[1]);
    const tables = ['feed_messages','feed_settings','oshal_email_digests','oshal_switchboard_stream_posts','oshal_switchboard_reply_outbox'];
    for(const table of tables) for(const sql of buildOwnerRlsPolicyStatements(table,'user_sub')) await admin.query(sql);
    await admin.query('CREATE TABLE user_preferences (user_id text PRIMARY KEY, updated_at timestamptz DEFAULT now())');
    await admin.query(fs.readFileSync(path.join(core,'scripts/migrations/126-app-home-preferences.sql'),'utf8'));
    for(const sql of buildOwnerRlsPolicyStatements('user_preferences','user_id')) await admin.query(sql);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}; GRANT INSERT, UPDATE ON user_preferences TO ${role}`);
    const now = Date.now();
    for(const [ts, hours, source] of [['recent',-1,'slack'],['yesterday',-25,'slack'],['near-five',-119,'slack'],['old',-121,'slack'],['future',1,'slack'],['different',-1,'other']]) {
      await admin.query('INSERT INTO feed_messages(user_sub,source,channel_id,ts,posted_at,text) VALUES ($1,$2,$3,$4,$5,$6)', ['alice',source,'channel-a',ts,new Date(now+hours*3600000),'Saved entry '+ts]);
    }
    await admin.query("INSERT INTO feed_messages(user_sub,channel_id,ts,posted_at,text) VALUES ('bob','private','private',now(),'Bob private feed entry')");
    await admin.query("INSERT INTO feed_settings(user_sub,last_synced_at) VALUES ('alice',now() - interval '12 minutes')");
    await admin.query('INSERT INTO oshal_email_digests VALUES ($1,$2,$3),($4,$5,$3)', ['alice',encryptSessionValue('Review the meeting agenda. ' + 'Details. '.repeat(30)),new Date(now-3600000),'bob',encryptSessionValue('Bob private digest')]);
    for(const state of ['in_review','scheduled','failed','published']) await admin.query('INSERT INTO oshal_switchboard_stream_posts(user_sub,body,state,scheduled_at) VALUES ($1,$2,$3,$4)', ['alice','private publishing content',state,new Date(now-3600000)]);
    await admin.query("INSERT INTO oshal_switchboard_stream_posts(user_sub,body,state) VALUES ('bob','Bob private post','in_review')");
    for(const status of ['pending','sending','sent','failed','uncertain']) {
      await admin.query(`INSERT INTO oshal_switchboard_reply_outbox(user_sub,idempotency_key,request_hash,provider,source_message_id_ciphertext,recipient_ciphertext,subject_ciphertext,body_ciphertext,status,claim_token,claimed_at,sent_at)
        VALUES ($1,$2,$3,'google','cipher','cipher','cipher','cipher',$4,$5,$6,$7)`, ['alice',crypto.randomUUID(),'0'.repeat(64),status,status==='sending'?crypto.randomUUID():null,status==='sending'?new Date():null,status==='sent'?new Date():null]);
    }
    const roleUrl = new URL(url); roleUrl.username=role; roleUrl.password='fixture-only';
    pool=wrapPoolWithGuc(new Pool({connectionString:roleUrl.href,options:`-c search_path=${schema}`}));
    assert.equal((await as('bob',()=>pool.query('SELECT * FROM feed_messages'))).rows.length,1,'Actual RLS hides Alice even without SQL owner predicate');
    await assert.rejects(as('alice',()=>pool.query("UPDATE feed_settings SET last_synced_at=now()")),/permission denied/);
    const app=express(); app.use(express.json());
    app.use((req,_res,next)=> {
      const sub=req.headers['x-test-user'] || 'alice';
      req.oidc={isAuthenticated:()=>sub!=='anonymous',user:{sub}};
      as(sub,()=>next());
    });
    const manifests=apps.map(name=>readManifest(path.join(root,name,'oshal-app.yaml')));
    for(const [i,name] of apps.entries()) {
      validateSummaryDeclaration(manifests[i],path.join(root,name,'oshal-app.yaml'));
      assert.ok(manifests[i].summary.path.endsWith('/home-summary'));
      const mount=manifests[i].routes.find(r=>r.module==='routes/home-summary.js');
      assert.equal(mount.auth,'oidc'); assert.equal(mount.requiresAi,false);
      app.use(mount.mountPath,require(path.join(root,name,mount.module))[mount.factory]({pool}));
    }
    app.use('/api/home/preferences',createAppHomePreferenceRoutes({pool}));
    app.get('/api/swarm/apps/home-plan',(_req,res)=>res.json({apps:buildHomePlan(manifests)}));
    app.get('/api/jarvis/tasks',(_req,res)=>res.json({tasks:[]}));
    app.use('/cockpit',express.static(path.join(core,'src/pages/cockpit')));
    app.get('/',(_req,res)=>res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/cockpit/css/apps-home.css"><style>:root{--bg-primary:#111827;--bg-card:#1b2638;--text-primary:#e5e7eb;--text-secondary:#adbbcd;--border-color:#435067;--accent-primary:#77baff;--status-warning:#ffcb77}body{margin:0;background:var(--bg-primary);color:var(--text-primary);font-family:system-ui}</style></head><body><p>Acceptance fixture: mock sign-in, real PostgreSQL, compiled package routes.</p><main id="home"></main><script type="module">import {AppsHomeView} from '/cockpit/js/views/AppsHomeView.js';window.home=new AppsHomeView({navigateToView:()=>{}});window.home.render(document.querySelector('#home'));</script></body></html>`));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}`;
    const get=async(name,user='alice')=> {const r=await fetch(`${base}/api/${name}/home-summary?user_sub=bob`,{headers:{'x-test-user':user}});return {status:r.status,body:await r.json()};};
    const values=r=>Object.fromEntries(r.body.metrics.map(m=>[m.id,m.value]));
    for(const name of apps) assert.equal((await get(name,'anonymous')).status,401);
    for(let i=0;i<2;i++) {
      const feed=await get('feeds'); assert.equal(feed.status,200);
      assert.equal(values(feed)['indexed-24h'],'1'); assert.equal(values(feed)['indexed-5d'],'3'); assert.equal(values(feed)['indexed-channels'],'1');
      const entries=feed.body.items.filter(i=>i.actions?.length);
      assert.equal(entries.length,3);
      assert.ok(entries[0].actions[0].context.notes.includes('Saved entry recent'));
      assert.ok(!JSON.stringify(entries).includes('Saved entry future'));
      assert.ok(!JSON.stringify(entries).includes('Saved entry old'));
      const email=await get('email-summarizer'); assert.equal(values(email)['cached-digest'],'Available');
      assert.ok(email.body.items[0].text.startsWith('Review the meeting')); assert.ok(email.body.items[0].text.length<=120);
      const board=await get('switchboard'); assert.deepEqual(values(board),{'posts-in-review':'1','posts-scheduled':'1','posts-overdue':'1','posts-failed':'1','replies-pending':'2','replies-failed':'1','replies-uncertain':'1'});
      assert.ok(!JSON.stringify([feed,email,board]).includes('Bob private'));
      assert.ok(!JSON.stringify([feed,email,board]).includes('private publishing content'));
    }
    assert.equal(values(await get('feeds','bob'))['indexed-5d'],'1');
    assert.equal(values(await get('feeds','empty'))['sync-age'],'Not recorded');
    assert.equal(values(await get('email-summarizer','empty'))['cached-digest'],'Not saved');
    assert.equal(values(await get('switchboard','empty'))['replies-pending'],'0');
    const secret=process.env.SESSION_SECRET; delete process.env.SESSION_SECRET;
    assert.equal((await get('email-summarizer')).status,503); process.env.SESSION_SECRET=secret;
    const corrupt=encryptSessionValue('unrecoverable').split(':');corrupt[1]=Buffer.alloc(16).toString('base64');
    await admin.query("INSERT INTO oshal_email_digests VALUES ('corrupt',$1,now())",[corrupt.join(':')]);
    assert.equal((await get('email-summarizer','corrupt')).status,503);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await page.getByText('Indexed Slack / 24h',{exact:true}).waitFor();
    await page.getByText('Saved email digest',{exact:true}).waitFor();
    await page.getByText('Replies pending/sending',{exact:true}).waitFor();
    assert.equal(await page.locator('.apps-home-card').count(),3);
    await page.locator('[data-action="edit"][data-id="switchboard"]').click();
    await page.getByLabel('Replies unconfirmed',{exact:true}).uncheck();
    await page.getByText('Display settings saved.',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.reload(); await page.getByText('Posts scheduled',{exact:true}).waitFor();
    assert.equal(await page.getByText('Replies unconfirmed',{exact:true}).count(),0);
    assert.equal(await page.getByText('Some replies have an uncertain delivery result. Check Threads before retrying.',{exact:true}).count(),0);
    const output=path.join(core,'output/home-summary-acceptance');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'communications-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(output,'communications-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    await admin.query('ALTER TABLE feed_settings RENAME TO feed_settings_unavailable');
    const partial=await get('feeds'); assert.equal(partial.status,200);assert.equal(partial.body.partial,true);assert.equal(values(partial)['sync-age'],'Unavailable');assert.equal(values(partial)['indexed-24h'],'1');
    await admin.query('ALTER TABLE oshal_switchboard_reply_outbox RENAME TO outbox_unavailable');
    const board=await get('switchboard');assert.equal(board.status,200);assert.equal(board.body.partial,true);assert.equal(values(board)['replies-pending'],'Unavailable');assert.equal(values(board)['posts-in-review'],'1');
    console.log('PASS: compiled routes, real schema/owner RLS, read-only grants, time windows, cached decryption, honest partial failure, browser metric hiding/reload and desktop/mobile layout.');
  } finally {
    if(browser) await browser.close();
    if(server) await new Promise(resolve=>server.close(resolve));
    if(pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${role}`);await admin.end();
    if(priorSecret===undefined) delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=priorSecret;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
