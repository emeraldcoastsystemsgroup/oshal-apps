/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Disposable PostgreSQL and Chromium proof of the Study Lab loop.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The lesson step plays the monster-taught video in installed Chrome (H.264), seeks to one minute, and opens the written lesson. */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Module = require('node:module');
const deps = process.env.STORE_CI_TOOLCHAIN || path.resolve(__dirname,'../../../scripts/toolchain');
const dependency = name => require(path.join(deps,'node_modules',name));
const { Pool } = dependency('pg'), express = dependency('express'), { chromium } = dependency('playwright');
const uri = process.env.LM_PREP_TEST_DATABASE_URL;
assert.ok(uri, 'LM_PREP_TEST_DATABASE_URL must explicitly name a disposable PostgreSQL');
const parsed = new URL(uri);
assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname) && !['5432','55433','55434'].includes(parsed.port), 'Use a dedicated loopback test port, never the live databases.');
const schema = 'lm_prep_contract_' + process.pid;
const pool = new Pool({connectionString:uri, options:`-c search_path=${schema}`});
const load = Module._load;
Module._load = function(name, ...rest) {
  if (name === '@/shared/logger') return {createChildLogger:()=>({info(){},warn(){},error(){}})};
  if (name === 'express') return express;
  return load.call(this,name,...rest);
};
const {createEducationPrepRoutes} = require('../../routes/education-prep-routes');
Module._load=load;
const ids={alice:'10000000-0000-4000-8000-000000000001',bob:'10000000-0000-4000-8000-000000000002',charlie:'20000000-0000-4000-8000-000000000003'};
const tenantA='10000000-0000-4000-8000-000000000000', tenantB='20000000-0000-4000-8000-000000000000';
let server,base;
async function request(actor, route, body) {
 const res=await fetch(base+'/api/education/prep'+route,{method:body?'POST':'GET',headers:{'x-test-actor':actor,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 return {status:res.status,body:await res.json()};
}
test.before(async()=>{
 await pool.query(`CREATE SCHEMA ${schema}`);
 await pool.query('CREATE TABLE lm_tenants (tenant_id UUID PRIMARY KEY)');
 await pool.query('CREATE TABLE lm_students (student_id UUID PRIMARY KEY, tenant_id UUID, name TEXT, email TEXT, role TEXT, external_issuer TEXT, external_id TEXT)');
 await pool.query('INSERT INTO lm_tenants VALUES ($1),($2)',[tenantA,tenantB]);
 for(const [name,id] of Object.entries(ids)) await pool.query("INSERT INTO lm_students VALUES ($1,$2,$3,NULL,'student','https://prep.example.test',$3)",[id,name==='charlie'?tenantB:tenantA,name]);
 for(const file of ['039-test-prep.sql','040-test-prep-records.sql','041-test-prep-bank.sql'])
  await pool.query(fs.readFileSync(path.resolve(__dirname,'../../migrations',file),'utf8'));
 const app=express();app.use(express.json({limit:'128kb'}));
 app.use((req,res,next)=>{const name=req.get('x-test-actor')||'alice';req.oidc={isAuthenticated:()=>name!=='anonymous',user:{sub:name,iss:'https://prep.example.test'}};next();});
 app.use('/api/education',createEducationPrepRoutes({pool}));
 const root=path.resolve(__dirname,'../../tools');
 for(const [route,file] of [['test-prep','test-prep.html'],['prep.js','test-prep.js'],['prep.css','test-prep.css'],['education.css','education.css'],['mascot.js','lm-mascot.js'],['logo-256.png','lm-logo-256.png'],['logo-96.png','lm-logo-96.png']]) app.get('/api/education/'+route,(_,res)=>res.sendFile(path.join(root,file)));
 app.use('/api/education/prep-media',express.static(path.join(root,'prep-media')));
 app.use('/api/education/prep-media',express.static(path.join(__dirname,'../../.videos')));
 app.get('/api/education/me',(_,res)=>res.json({name:'Alice',role:'student'}));
 app.get('/api/education/rewards',(_,res)=>res.json({xp:0,level:1}));
 app.get('/api/ui/profile',(_,res)=>res.json({profile:{ribbon:{items:[]}}}));
 app.use((req,res)=>res.status(404).send(''));
 await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);}); base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();});
test('compiled routes isolate students and schools, refuse anonymous access and ignore submitted identities',async()=>{
 assert.equal((await request('anonymous','/catalog')).status,401);
 const created=await request('alice','/sessions',{exam:'SAT',mode:'diagnostic',studentId:ids.bob,tenantId:tenantB});
 assert.equal(created.status,200);assert.equal(created.body.blocks[0].questions[0].answer,undefined);
 for(const actor of ['bob','charlie']) {
  assert.equal((await request(actor,'/sessions/'+created.body.id)).status,404);
  assert.equal((await request(actor,'/sessions/'+created.body.id,{revision:0,action:'finish'})).status,404);
  assert.equal((await request(actor,'/progress')).body.active.length,0);
 }
 const row=(await pool.query('SELECT student_id,tenant_id FROM lm_prep_sessions WHERE session_id=$1',[created.body.id])).rows[0];
 assert.deepEqual(row,{student_id:ids.alice,tenant_id:tenantA});
});
test('database revision checks reject concurrent writers and completed grades cannot be changed',async()=>{
 const {body:s}=await request('alice','/sessions',{exam:'ACT',mode:'practice',skill:'linear'});
 const id=s.blocks[0].questions[0].id;
 const payload={revision:0,action:'save',answers:{[id]:{choice:1,ms:0,confidence:'guess',flagged:true}}};
 const responses=await Promise.all([request('alice','/sessions/'+s.id,payload),request('alice','/sessions/'+s.id,payload)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const fresh=(await request('alice','/sessions/'+s.id)).body;assert.equal(fresh.revision,1);assert.equal(fresh.blocks[0].answers[id].choice,1);
 const finished=(await request('alice','/sessions/'+s.id,{revision:1,action:'finish'})).body;
 assert.equal(finished.status,'complete');assert.ok(Number.isInteger(finished.blocks[0].questions[0].answer));
 const retry=(await request('alice','/sessions/'+s.id,{revision:finished.revision,action:'finish',answers:{[id]:{choice:2,ms:0,confidence:'sure',flagged:false}}})).body;
 assert.equal(retry.blocks[0].answers[id].choice,1);
});
test('profile and lesson review survive reload and remain private',async()=>{
 assert.equal((await request('alice','/profile',{exam:'SAT',dailyMinutes:20,testDate:'2027-03-13'})).status,200);
 assert.equal((await request('alice','/profile',{action:'lesson',lessonId:'linear'})).status,200);
 const own=(await request('alice','/progress')).body.profile, peer=(await request('bob','/progress')).body.profile;
 assert.equal(own.dailyMinutes,20);assert.ok(own.lessons.linear);assert.equal(peer.lessons.linear,undefined);
 assert.equal((await request('alice','/profile',{exam:'SAT',dailyMinutes:20,testDate:'2027-02-30'})).status,400);
});
test('one common question bank serves different students while their answers remain private',async()=>{
 const bank=(await pool.query('SELECT question FROM lm_prep_questions')).rows;
 assert.equal(bank.length,222);assert.ok(bank.every(r=>r.question.answer===undefined && r.question.explanation===undefined));
 const a=(await request('alice','/sessions',{exam:'SAT',mode:'practice',skill:'linear'})).body;
 const b=(await request('bob','/sessions',{exam:'SAT',mode:'practice',skill:'linear'})).body;
 const rows=(await pool.query('SELECT session_id,student_id,tenant_id,question_id,correct FROM lm_prep_answers WHERE session_id=$1 OR session_id=$2',[a.id,b.id])).rows;
 assert.equal(rows.length,16);assert.ok(rows.every(r=>r.correct===null));
 for(const r of rows)assert.equal(r.student_id,r.session_id===a.id?ids.alice:ids.bob);
 assert.equal((await pool.query('SELECT question_id FROM lm_prep_questions')).rows.length,222);
 const id=a.blocks[0].questions[0].id;
 await request('alice','/sessions/'+a.id,{revision:0,action:'save',answers:{[id]:{choice:0,ms:0,confidence:'sure',flagged:true}}});
 assert.ok(!(await request('alice','/answers?exam=SAT')).body.answers.some(r=>r.session_id===a.id));
 const complete=(await request('alice','/sessions/'+a.id,{revision:1,action:'finish'})).body;
 await request('alice','/sessions/'+a.id,{revision:complete.revision,action:'reflect',questionId:id,reason:'reading',note:'Check the requested expression.'});
 const saved=(await request('alice','/answers?exam=SAT&skill=linear')).body.answers.filter(r=>r.session_id===a.id);
 assert.equal(saved.length,8);assert.equal(saved.find(r=>r.question_id===id).reflection,'Check the requested expression.');
 assert.equal(saved.find(r=>r.question_id===id).flagged,true);assert.ok(saved.every(r=>typeof r.correct==='boolean'));
 for(const user of ['bob','charlie'])assert.ok(!(await request(user,'/answers?exam=SAT')).body.answers.some(r=>r.session_id===a.id));
});
test('answer-ledger write failure rolls the session revision and answers back together',async()=>{
 const {body:s}=await request('alice','/sessions',{exam:'SAT',mode:'practice',skill:'linear'}), id=s.blocks[0].questions[0].id;
 await pool.query('ALTER TABLE lm_prep_answers ADD CONSTRAINT reject_three CHECK (choice IS NULL OR choice <> 3)');
 try {
  const refused=await request('alice','/sessions/'+s.id,{revision:0,action:'save',answers:{[id]:{choice:3,ms:0,confidence:'sure',flagged:false}}});
  assert.equal(refused.status,500);
  const fresh=(await request('alice','/sessions/'+s.id)).body;
  assert.equal(fresh.revision,0);assert.equal(fresh.blocks[0].answers[id],undefined);
  assert.equal((await pool.query('SELECT choice FROM lm_prep_answers WHERE session_id=$1 AND question_id=$2',[s.id,id])).rows[0].choice,null);
 } finally {await pool.query('ALTER TABLE lm_prep_answers DROP CONSTRAINT reject_three');}
});
test('Jarvis launch creates ready practice without a running timer or exposed questions',async()=>{
 const ready=await request('alice','/launch',{exam:'ACT',mode:'diagnostic'});
 assert.equal(ready.status,200);assert.equal(ready.body.status,'ready');assert.match(ready.body.practiceUrl,/\?session=/);
 const {body:s}=await request('alice','/sessions/'+ready.body.sessionId);
 assert.equal(s.blocks[0].startedAt,null);assert.equal(s.blocks[0].questions.length,0);
 assert.equal((await request('alice','/sessions/'+s.id,{revision:0,action:'save'})).status,400);
 const before=Date.now(), begun=await request('alice','/sessions/'+s.id,{revision:0,action:'begin'});
 assert.equal(begun.status,200);assert.ok(begun.body.blocks[0].startedAt>=before);
 assert.equal(begun.body.blocks[0].questions.length,21-3);assert.equal(begun.body.blocks[0].questions[0].answer,undefined);
 assert.equal((await request('bob','/sessions/'+s.id)).status,404);
});
test('saved training is owner-bound, conflict-safe and does not inflate assessed progress',async()=>{
 const before=(await request('alice','/progress?exam=SAT')).body.freshQuestions;
 const built=await request('alice','/training',{exam:'SAT',strategyIds:['systems'],goal:'Break it down.',studentId:ids.bob,tenantId:tenantB});
 assert.equal(built.status,200);const p=built.body;assert.equal(p.content.cards.length,3);assert.equal(p.content.mode,'guided');
 for(const user of ['bob','charlie']) {
  assert.equal((await request(user,'/training/'+p.id)).status,404);
  assert.equal((await request(user,'/training/'+p.id,{revision:0,action:'complete'})).status,404);
  assert.ok(!(await request(user,'/training?exam=SAT')).body.training.some(t=>t.id===p.id));
 }
 const edits=await Promise.all([request('alice','/training/'+p.id,{revision:0,action:'note',note:'First note'}),request('alice','/training/'+p.id,{revision:0,action:'note',note:'Second note'})]);
 assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
 const fresh=(await request('alice','/training/'+p.id)).body;assert.equal(fresh.revision,1);assert.ok(fresh.progress.note);
 assert.equal((await request('alice','/training',{exam:'SAT',strategyIds:['science-design']})).status,400);
 assert.equal((await request('alice','/progress?exam=SAT')).body.freshQuestions,before);
 assert.equal((await pool.query('SELECT question_id FROM lm_prep_questions')).rows.length,222);
 assert.equal((await request('anonymous','/training?exam=SAT')).status,401);
});
test('Chromium completes the saved question → reload → review → lesson/video → focused practice loop on a phone',async()=>{
 // Lesson videos are H.264 MP4, which the bundled Chromium cannot decode; a real Chrome plays them as students' browsers do.
 const browser=await chromium.launch({channel:process.env.LM_PREP_BROWSER_CHANNEL||'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}), faults=[];
  page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(15000);
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>faults.push(e.message));
  await page.goto(base+'/api/education/test-prep');
  await page.locator('#prep-focus article').first().waitFor();
  assert.equal(await page.locator('#prep-official article').count(),8);
  await page.locator('#prep-strategy-section').selectOption('math');
  await page.locator('#prep-strategy-search').fill('intersections');
  assert.equal(await page.locator('#prep-strategies details').count(),1);
  await page.locator('#prep-strategies summary').click();
  assert.match(await page.locator('#prep-strategies').textContent(),/viewing window/);
  await page.locator('#prep-strategy-search').fill('no such strategy xyz');
  assert.equal(await page.locator('#prep-strategies details').count(),0);
  await page.locator('#prep-strategy-search').fill('');
  await page.locator('#prep-exam').selectOption('ACT');
  await page.waitForFunction(()=>document.querySelectorAll('#prep-official article').length===4);
  assert.equal(await page.locator('#prep-official a').filter({hasText:'Online scoring key (online form only)'}).count(),4);
  await page.locator('#prep-strategy-section').selectOption('science');
  assert.equal(await page.locator('#prep-strategies details').count(),5);
  await page.locator('#prep-strategies details').first().locator('summary').click();
  assert.match(await page.locator('#prep-strategies').textContent(),/test booklet/);
  await page.locator('#prep-strategy-section').selectOption('writing');
  assert.equal(await page.locator('#prep-strategies details').count(),2);
  await page.locator('#prep-exam').selectOption('SAT');
  await page.waitForFunction(()=>document.querySelectorAll('#prep-official article').length===8);
  assert.equal(await page.locator('#prep-strategy-section').inputValue(),'all');
  for (const width of [360, 1366, 390]) {
    await page.setViewportSize({width,height:844});
    const fit = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,off:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1 && !el.closest('.prep-table-wrap') && !el.closest('.prep-trend')).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,40),right:el.getBoundingClientRect().right}))}));
    if(fit.scroll>fit.width)await page.screenshot({path:'/tmp/lm-prep-real-overflow.png',fullPage:true});
    assert.ok(fit.scroll<=fit.width, 'Home fits '+width+': '+JSON.stringify(fit));
  }
  await page.locator('#prep-dashboard-heading').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/lm-prep-real-dashboard-phone.png'});
  await page.locator('#prep-training-topic').selectOption('percent-multipliers');
  await page.locator('#prep-training-goal').fill('Use small steps and check the base.');
  await page.getByRole('button',{name:'Create and save training',exact:true}).click();
  await page.locator('#prep-training h2').waitFor();
  const trainingLocation=page.url();assert.match(trainingLocation,/\?training=/);
  await page.locator('#prep-training details summary').first().click();
  await page.getByRole('button',{name:'Mark card reviewed',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('#prep-training details summary').textContent.includes('Reviewed'));
  await page.locator('#prep-training-note').fill('Write the original base before calculating.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent==='Training progress saved.');
  await page.reload();
  await page.locator('#prep-training-note').waitFor();
  assert.equal(await page.locator('#prep-training-note').inputValue(),'Write the original base before calculating.');
  assert.match(await page.locator('#prep-training details summary').first().textContent(),/Reviewed/);
  await page.screenshot({path:'/tmp/lm-prep-real-training-phone.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Mark pack reviewed',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-training .lm-help').textContent.startsWith('Pack reviewed.'));
  await page.getByRole('button',{name:'← Dashboard',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-training-list').textContent.includes('Pack reviewed'));
  const prepared=(await request('alice','/launch',{exam:'SAT',mode:'practice',skill:'linear'})).body;
  await page.goto(base+prepared.practiceUrl);
  await page.getByRole('button',{name:'Begin practice',exact:true}).waitFor();
  assert.equal(await page.locator('.prep-choice').count(),0);
  await page.getByRole('button',{name:'Begin practice',exact:true}).click();
  await page.locator('.prep-choice').first().waitFor();
  await page.goto(base+'/api/education/test-prep');
  await page.locator('#prep-focus article').first().waitFor();
  await page.locator('[data-start="diagnostic"]').click();
  await page.locator('.prep-choice').first().click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent==='Saved');
  await page.reload();
  await page.locator('.prep-choice[aria-pressed="true"]').waitFor();
  await page.getByText('Finish this section',{exact:true}).click();
  await page.getByRole('button',{name:'Submit section',exact:true}).click();
  await page.getByRole('button',{name:'See my updated focus',exact:true}).waitFor();
  const reflection=page.locator('form[data-reflect]').first();
  await reflection.locator('textarea').fill('Check what quantity is requested.');
  await reflection.getByRole('button',{name:'Save reflection'}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent==='Saved');
  await page.locator('#prep-session [data-lesson]').first().click();
  await page.locator('video').waitFor();
  await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
  const duration=await page.locator('video').evaluate(v=>v.duration);assert.ok(duration>60);
  await page.locator('video').evaluate(v=>new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;v.currentTime=60;}));
  assert.ok(await page.locator('video').evaluate(v=>v.poster.endsWith('.jpg')));
  await page.getByText('Read the lesson instead').click();
  await page.locator('.prep-lesson-text p').first().waitFor();
  await page.getByRole('button',{name:'Mark lesson reviewed'}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent.startsWith('Lesson reviewed'));
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/lm-prep-lesson-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Try this skill'}).click();
  await page.getByRole('heading',{name:'Question 1 of 8'}).waitFor();
  // Simulate a dropped save: retain answer locally, then retry successfully.
  await page.route('**/prep/sessions/*',r=>r.request().method()==='POST'?r.abort():r.continue());
  await page.locator('.prep-choice').nth(2).click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent.startsWith('Not saved'));
  await page.unroute('**/prep/sessions/*');await page.getByRole('button',{name:'Save now',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#prep-status').textContent==='Saved');
  assert.equal(await page.locator('.prep-choice').nth(2).getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/lm-prep-session-phone.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(faults,[]);
 } finally {await browser.close();}
});
