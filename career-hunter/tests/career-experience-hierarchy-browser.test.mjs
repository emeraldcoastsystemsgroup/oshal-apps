/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive employer selection through the shipped Work history page and actual compiled route/engine on disposable profiles; measure real preview/PDF hierarchy without live accounts or model calls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise direct hierarchy controls, real revision/Undo, exact-parent split saves, draft retention and current refusal/stale guards on phone and desktop.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import Module,{createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
const source=process.env.CAREER_HIERARCHY_PACKAGE||path.resolve(import.meta.dirname,'..'),repo=path.dirname(source);
const require=createRequire(import.meta.url),toolchain=process.env.STORE_CI_TOOLCHAIN||path.join(repo,'scripts/toolchain');
const deps=fs.existsSync(path.join(toolchain,'playwright'))?toolchain:path.join(toolchain,'node_modules');
const express=require(path.join(deps,'express')), {chromium}=require(path.join(deps,'playwright'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-hierarchy-page-'));let dir,server,origin,browser;
const fixture={profile:{name:'Olive Testperson',headline:'Synthetic architect',experience_summary:'Synthetic summary'},roles:[
 {id:'parent',title:'Principal',org:'Example Consulting',start:'2006',end:null,deliverables:['Managed consulting delivery.']},
 {id:'other',title:'Engineer',org:'Other Employer',start:'2020',end:'2024',deliverables:['Independent employer bullet.']},
 {id:'client',title:'Client Architect',org:'Example Client',start:'2018',end:null,deliverables:['Built a synthetic service.']}],skills:{}};
const file=()=>path.join(dir,'career_db.json');const saved=()=>JSON.parse(fs.readFileSync(file()));
function reset(){dir=fs.mkdtempSync(path.join(root,'owner-'));fs.writeFileSync(file(),JSON.stringify(fixture,null,2));}
const bin=path.join(source,'bin/oshal-jobhunter.js'),cli=new Module(bin);cli.filename=bin;cli.paths=Module._nodeModulePaths(path.dirname(bin));
cli._compile(fs.readFileSync(bin,'utf8')+'\nmodule.exports.mapping=engineRuns;',bin);
function engine(args,env={}){
 const out=spawnSync(process.env.CAREER_TEST_PYTHON||'python3',cli.exports.mapping(args[0],args.slice(1))[0],{cwd:source,encoding:'utf8',timeout:20000,env:{...process.env,JOBHUNTER_DATA:dir,JOBHUNTER_CAREER_DB:file(),PYTHONPATH:path.join(source,'engine'),...env}});
 assert.equal(out.error,undefined);return{ok:out.status===0,out:out.stdout,err:out.stderr};
}
// Only installation identity, filesystem scope and engine transport are explicit fixture seams; route/engine are shipped.
const load=Module._load;
Module._load=function(name,...rest){
 if(name==='@/shared/logger')return{createChildLogger:()=>({error(){},warn(){},info(){}})};
 if(name==='@/features/agent-management')return{BotNodeClient:class{},createRegistryEndpointResolver:()=>null};
 if(name==='@/app/routes/inline-bot-execution'||name==='./career-engine-runner')return{};
 if(name==='./career-user-store')return{callerSub:()=> 'synthetic-owner',findUserPaths:()=>({userDir:dir}),userPaths:()=>({userDir:dir})};
 if(name==='./career-engine-dispatch')return{runCareerCliAwait:async(_pool,sub,args,env)=>{assert.equal(sub,'synthetic-owner');return engine(args,env);}};
 return load.call(this,name,...rest);
};
const studio=require(path.join(source,'routes/career-resume-studio-routes.js'));Module._load=load;
function app(){
 const web=express(),router=express.Router();web.use(express.json());studio.registerCareerResumeStudio(router,{pool:{}});
 web.get('/api/career-hunter/work-history',(_q,r)=>r.sendFile('career-work-history.html',{root:path.join(source,'tools')}));
 web.use('/api/career-hunter/static',express.static(path.join(source,'tools')));web.use('/api/career-hunter',router);
 web.get('/api/auth/user',(_q,r)=>r.json({displayName:'Olive'}));web.get('/api/ui/profile',(_q,r)=>r.json({profile:{ribbon:{items:[]}}}));
 web.get('/api/presentations/editor/documents',(_q,r)=>r.json({documents:[]}));web.get('/api/career-hunter/jobs/stats',(_q,r)=>r.json({saved:0,queued:0,tracked:0}));
 web.get('/shared/{*path}',(q,r)=>r.type(q.path.endsWith('.css')?'css':'js').send(''));return web;
}
before(async()=>{reset();server=app().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch();});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());fs.rmSync(root,{recursive:true,force:true});});
async function open(width){
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<600}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+'/api/career-hunter/work-history');await page.locator('.wh-job').first().waitFor();return{context,page,errors};
}
for(const width of [412,1280])test('explicit client relationship saves and reloads at '+width,async()=>{
 reset();const f=await open(width);try{
  await f.page.getByRole('button',{name:'Edit Client Architect',exact:true}).click();
  await f.page.locator('form.wh-form').waitFor();
  assert.equal(await f.page.getByLabel('Client engagement under',{exact:true}).count(),1,'the real editor offers an explicit relationship choice');
  await f.page.getByLabel('Client engagement under',{exact:true}).selectOption('parent');await f.page.getByRole('button',{name:'Save',exact:true}).click();
  await f.page.locator('.wh-client-job').waitFor();assert.equal(saved().roles[2].parent_role_id,'parent');
  const expected=structuredClone(fixture);expected.roles[2].parent_role_id='parent';assert.deepEqual(saved(),expected);
  assert.deepEqual(await f.page.locator('.wh-job h2').allTextContents(),['Principal','Client Architect','Engineer']);
  const parent=await f.page.locator('[data-job="0"]').boundingBox(),child=await f.page.locator('[data-job="2"]').boundingBox();
  assert.ok(Math.abs(child.x-parent.x-24)<1);assert.ok(Math.abs(child.x+child.width-parent.x-parent.width)<1,'right edge remains aligned');
  await f.page.reload();await f.page.locator('.wh-client-job').waitFor();assert.equal(saved().roles[2].parent_role_id,'parent');
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await f.page.getByRole('button',{name:'Edit Client Architect',exact:true}).click();
  await f.page.locator('form.wh-form').waitFor();
  const select=f.page.getByLabel('Client engagement under',{exact:true});assert.equal(await select.inputValue(),'parent');
  await select.selectOption('');await f.page.getByRole('button',{name:'Save',exact:true}).click();
  await f.page.waitForFunction(()=>window.CareerWorkHistoryPage.state.busy===false&&window.CareerWorkHistoryPage.state.editing===null);
  await f.page.locator('.wh-client-job').waitFor({state:'detached'});
  assert.deepEqual(saved(),fixture);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

/** Real engine template HTML goes into Chromium; saved PDF is produced by actual browser printing, never a PDF stub. */
function templates(){
 const program=['import json,sys','from jobhunter import generate,role_plan','try:',' from jobhunter import role_hierarchy','except ImportError:',' role_hierarchy=None','p=json.load(sys.stdin)','r={"headline":"Synthetic architect","summary":"Synthetic summary","experience":[],"skills":[],"education":[],"certifications":[]}',
 'role_plan.carry(r,role_plan.plan(p),p)','recent,earlier=role_hierarchy.compact(r["experience"],generate._start_year) if role_hierarchy else ([e for e in r["experience"] if generate._start_year(e.get("span"))>=2011],[e for e in r["experience"] if 0<generate._start_year(e.get("span"))<2011])',
 'ctx={"r":r,"recent":recent,"earlier":earlier,"contact":p["profile"]}',
 'print(json.dumps({name:generate._env.get_template(name).render(**ctx) for name in ("resume.html","resume_premium.html","resume_1page.html")}))'].join('\n');
 const value=structuredClone(fixture);value.roles[2].parent_role_id='parent';value.roles[0].engagements_heading='Selected Client Engagements';
 const r=spawnSync(process.env.CAREER_TEST_PYTHON||'python3',['-c',program],{cwd:source,encoding:'utf8',timeout:20000,input:JSON.stringify(value),env:{...process.env,PYTHONPATH:path.join(source,'engine')}});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('actual ATS, Premium and compact HTML/PDF retain hierarchy, right-aligned dates and readable text',async()=>{
 const context=await browser.newContext(),page=await context.newPage();try{
  for(const [name,html] of Object.entries(templates())){
   await page.setContent(html);const child=page.locator('.role-child');assert.equal(await child.count(),1,name);
   const parent=page.locator('.role').filter({hasText:'Principal'});const p=await parent.boundingBox(),c=await child.boundingBox();
   assert.ok(Math.abs(c.x-p.x-24)<1,name+' child heading indent');assert.ok(Math.abs(c.x+c.width-p.x-p.width)<1,name+' same right edge');
   assert.equal(await child.locator('li').first().textContent(),'Built a synthetic service.');
   const bullet=await child.locator('li').first().boundingBox();assert.ok(Math.abs(bullet.x-c.x-16.8)<1,name+' additional bullet text indent');
   assert.equal(await page.getByText('Selected Client Engagements',{exact:true}).count(),1);
   const dates=await page.locator('.role-s,.rs').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().right));
   assert.ok(dates.every(right=>Math.abs(right-dates[0])<1),name+' dates share one right edge');
   const pdf=await page.pdf({preferCSSPageSize:true});assert.ok(pdf.subarray(0,5).equals(Buffer.from('%PDF-')));assert.ok(pdf.length>1000);
   if(process.env.CAREER_HIERARCHY_PROOF_DIR){fs.writeFileSync(path.join(process.env.CAREER_HIERARCHY_PROOF_DIR,name),html);fs.writeFileSync(path.join(process.env.CAREER_HIERARCHY_PROOF_DIR,name+'.pdf'),pdf);}
  }
 }finally{await context.close();}
});

const generationProgram=String.raw`
import json,sys,tempfile,os,copy,subprocess
from pathlib import Path
from unittest.mock import patch
os.environ['JOBHUNTER_MULTIUSER']='1'
os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import generate,config,profile,db
# Only PDF process transport is adapted: actual generated HTML is printed by real Chromium through Playwright.
# The production Chromium CLI is not qualified by this fixture; packet generation, SQLite and rerender are unchanged.
def browser_pdf(html,pdf):
 script="""const{chromium}=require(process.env.HIERARCHY_PLAYWRIGHT_MODULE);const fs=require('node:fs');
 (async()=>{const b=await chromium.launch();try{const p=await b.newPage();await p.setContent(fs.readFileSync(process.argv[1],'utf8'));
 await p.pdf({path:process.argv[2],preferCSSPageSize:true});}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});"""
 subprocess.run([os.environ['HIERARCHY_NODE'],'-e',script,str(html),str(pdf)],check=True,capture_output=True,timeout=20)
generate._render_pdf=browser_pdf
p=json.load(sys.stdin)
answer={'resume':{'headline':'Synthetic architect','summary':'Synthetic summary','experience':[{'role':'R3','id':'model-fake','parent_role_id':'other','title':'Client Architect','org':'Example Client','span':'2018 to Present','bullets':['Built a synthetic service.']}],'skills':[],'education':[],'certifications':[]},'cover':{'greeting':'Dear Hiring Manager,','paragraphs':['Synthetic cover.'],'closing':'Sincerely,'}}
with tempfile.TemporaryDirectory(prefix='career-hierarchy-packet-') as folder:
 root=Path(folder)
 config.DATA_DIR=root
 config.CORPUS_DB=root/'corpus.db'
 config.USER_DB=root/'owner.db'
 config.CAREER_DB=root/'career_db.json'
 config.CAREER_DB.write_text(json.dumps(p))
 generate.APP_DIR=root/'applications'
 profile.load.cache_clear()
 with db.connect() as c:
  c.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Target Co')")
  c.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role) VALUES(7,1,'7','Platform Architect',?,1,1)",('Synthetic architecture role. '*50,))
 with patch.object(generate.enrich,'provider',return_value='synthetic'),patch.object(generate.enrich,'complete',return_value=json.dumps(answer)),patch.object(generate,'_polish_cover',side_effect=lambda cover,*a,**k:cover):
  result=generate.generate_for(7)
 out=Path(result['dir'])
 names=['Resume_ATS','Resume_Premium','Resume_1page']
 fresh={name:(out/(name+'.html')).read_text() for name in names}
 record=json.loads((out/'application.json').read_text())
 original=copy.deepcopy(record['generated']['resume']['experience'])
 p['roles'][2]['parent_role_id']='other'
 config.CAREER_DB.write_text(json.dumps(p))
 profile.load.cache_clear()
 generate.rerender_packet(7)
 rerender={name:(out/(name+'.html')).read_text() for name in names}
 after=json.loads((out/'application.json').read_text())
 assert after['generated']['resume']['experience']==original
 sizes={name:(out/(name+'.pdf')).stat().st_size for name in names}
 assert all((out/(name+'.pdf')).read_bytes().startswith(b'%PDF-') for name in names)
 print(json.dumps({'fresh':fresh,'rerender':rerender,'experience':original,'pdf_sizes':sizes}))
 db._leave_portable()
 db._portable_paths.clear()
`;

test('real fresh generation and saved-packet rerender keep cross-cutoff parent/client groups with actual PDFs',{timeout:90000},async()=>{
 const value=structuredClone(fixture);value.roles[2].parent_role_id='parent';value.roles[0].engagements_heading='Selected Client Engagements';
 const result=spawnSync(process.env.CAREER_TEST_PYTHON||'python3',['-c',generationProgram],{cwd:source,encoding:'utf8',timeout:80000,input:JSON.stringify(value),env:{...process.env,PYTHONPATH:path.join(source,'engine'),HIERARCHY_NODE:process.execPath,HIERARCHY_PLAYWRIGHT_MODULE:path.join(deps,'playwright')}});
 assert.equal(result.status,0,result.stderr+result.stdout);const data=JSON.parse(result.stdout.trim());
 assert.ok(data.experience.some(role=>role.id==='parent'));assert.equal(data.experience.find(role=>role.id==='client').parent_role_id,'parent');
 assert.ok(!data.experience.some(role=>role.id==='model-fake'),'model-supplied relationship identity is never accepted');
 const page=await browser.newPage();try{
  for(const phase of['fresh','rerender'])for(const[name,html]of Object.entries(data[phase])){
   await page.setContent(html);assert.equal(await page.locator('.role-child').count(),1,phase+' '+name);
   const roles=await page.locator('.role').allTextContents();assert.ok(roles.findIndex(text=>text.includes('Principal'))<roles.findIndex(text=>text.includes('Client Architect')),phase+' '+name+' parent before child');
   assert.ok(data.pdf_sizes[name]>1000);assert.equal(await page.getByText('Selected Client Engagements',{exact:true}).count(),1);
  }
 }finally{await page.close();}
});


test('a new client with many bullets links its original ID-less employer in the first actual save request',async()=>{
 reset();const legacy=saved();delete legacy.roles[0].id;fs.writeFileSync(file(),JSON.stringify(legacy,null,2));
 const f=await open(412),writes=[];try{
  f.page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/resume/master-edit'))writes.push(r.postDataJSON());});
  await f.page.getByRole('button',{name:'Add a job',exact:true}).click();
  await f.page.getByLabel('Job title',{exact:true}).fill('New client role');await f.page.getByLabel('Employer',{exact:true}).fill('Another Client');
  await f.page.getByLabel('Start year',{exact:true}).fill('2025');
  await f.page.getByLabel('Client engagement under',{exact:true}).selectOption('@index:0');
  for(let at=0;at<24;at++){if(at)await f.page.getByRole('button',{name:'Add a bullet',exact:true}).click();await f.page.getByRole('textbox',{name:'Bullet',exact:true}).nth(at).fill('Recorded client bullet '+at+'.');}
  await f.page.getByRole('button',{name:'Add this job',exact:true}).click();
  await f.page.waitForFunction(()=>window.CareerWorkHistoryPage.state.busy===false);
  assert.ok(writes.length>=2,'real form used bounded multi-request save');
  assert.equal(writes[0].edits.filter(edit=>edit.key==='parent_role_id').length,1,'link belongs to the original card before any later chunk');
  const roles=saved().roles,parent=roles.find(role=>role.title==='Principal'),child=roles.find(role=>role.title==='New client role');
  assert.equal(child.parent_role_id,parent.id);assert.notEqual(child.id,parent.id);assert.equal(child.deliverables.length,24);
  assert.deepEqual(roles.filter(role=>role!==child).map(({id,...role})=>role),legacy.roles.map(({id,...role})=>role));assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

async function settled(page){await page.waitForFunction(()=>window.CareerWorkHistoryPage.state.busy===false);}
async function directControl(page,name){const button=page.getByRole('button',{name,exact:true});assert.equal(await button.count(),1,'the shipped page exposes '+name);return button;}
async function proofShot(page,name){if(process.env.CAREER_DIRECT_PROOF_DIR)await page.screenshot({path:path.join(process.env.CAREER_DIRECT_PROOF_DIR,name+'.png'),fullPage:true});}

for(const width of [412,1280])test('direct hierarchy root-child-root and Undo preserve independent records at '+width,async()=>{
 reset();const f=await open(width);try{
  await proofShot(f.page,'before-'+width);
  const inside=await directControl(f.page,'Tab in Client Architect');
  const boxes=await f.page.locator('[data-hierarchy]').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.ok(boxes.every(box=>box.width>=44&&box.height>=44),'every direct control is a phone-sized target');
  await inside.click();await settled(f.page);
  const linked=structuredClone(fixture);linked.roles[2].parent_role_id='other';assert.deepEqual(saved(),linked,'immediately preceding displayed employer is selected');
  await f.page.reload();await f.page.locator('.wh-client-job').waitFor();
  await (await directControl(f.page,'Tab out Client Architect')).click();await settled(f.page);assert.deepEqual(saved(),fixture);
  await f.page.getByRole('button',{name:'Undo',exact:true}).click();await f.page.locator('.wh-client-job').waitFor();assert.deepEqual(saved(),linked,'same real revision/backup Undo path');
  await proofShot(f.page,'after-'+width);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy editor controls keep an unsaved draft until the existing Save',async()=>{
 reset();const f=await open(412),writes=[];try{
  f.page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/resume/master-edit'))writes.push(r.postDataJSON());});
  await f.page.getByRole('button',{name:'Edit Client Architect',exact:true}).click();
  const form=f.page.locator('form.wh-form');await form.waitFor();await form.getByRole('textbox',{name:'Bullet',exact:true}).fill('The existing independent draft remains intact.');
  await (await directControl(f.page,'Tab in Client Architect')).click();assert.equal(await form.getByLabel('Client engagement under',{exact:true}).inputValue(),'other');
  assert.equal(await form.getByRole('textbox',{name:'Bullet',exact:true}).inputValue(),'The existing independent draft remains intact.');assert.equal(writes.length,0);
  await (await directControl(f.page,'Tab out Client Architect')).click();assert.equal(await form.getByLabel('Client engagement under',{exact:true}).inputValue(),'');assert.equal(writes.length,0);
  await (await directControl(f.page,'Tab in Client Architect')).click();await form.getByRole('button',{name:'Save',exact:true}).click();await settled(f.page);
  const expected=structuredClone(fixture);expected.roles[2].parent_role_id='other';expected.roles[2].deliverables=['The existing independent draft remains intact.'];assert.deepEqual(saved(),expected);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy Add sub-engagement binds the exact ID-less parent before a many-bullet split',async()=>{
 reset();const legacy=saved();delete legacy.roles[0].id;fs.writeFileSync(file(),JSON.stringify(legacy,null,2));const f=await open(412),writes=[];try{
  f.page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/resume/master-edit'))writes.push(r.postDataJSON());});
  await (await directControl(f.page,'Add sub-engagement under Principal')).click();const form=f.page.locator('form.wh-form');await form.waitFor();
  assert.equal(await form.getByRole('heading',{name:'Sub-engagement',exact:true}).count(),1);assert.equal(await form.getByLabel('Client engagement under',{exact:true}).inputValue(),'@index:0');assert.equal(writes.length,0,'opening an editor writes nothing');
  await form.getByLabel('Job title',{exact:true}).fill('Explicit sub-project');await form.getByLabel('Employer',{exact:true}).fill('Synthetic Client');await form.getByLabel('Start year',{exact:true}).fill('2025');
  for(let at=0;at<24;at++){if(at)await form.getByRole('button',{name:'Add a bullet',exact:true}).click();await form.getByRole('textbox',{name:'Bullet',exact:true}).nth(at).fill('Independent recorded bullet '+at+'.');}
  await form.getByRole('button',{name:'Add sub-engagement',exact:true}).click();await settled(f.page);
  assert.ok(writes.length>=2);assert.equal(writes[0].edits.find(e=>e.key==='parent_role_id').value,'@index:0');
  const roles=saved().roles,parent=roles.find(r=>r.title==='Principal'),child=roles.find(r=>r.title==='Explicit sub-project');assert.equal(child.parent_role_id,parent.id);assert.equal(child.deliverables.length,24);
  assert.deepEqual(roles.filter(r=>r!==child).map(({id,...r})=>r),legacy.roles.map(({id,...r})=>r));assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy controls explain unavailable nesting and preserve refusal/stale guards',async()=>{
 reset();const f=await open(412);try{
  const first=await directControl(f.page,'Tab in Principal');assert.equal(await first.isDisabled(),true);assert.match(await first.getAttribute('title'),/preceding/);
  await f.page.route('**/resume/master-edit',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Synthetic current access refused'})}));
  await (await directControl(f.page,'Tab in Client Architect')).click();await settled(f.page);assert.deepEqual(saved(),fixture);assert.match(await f.page.locator('#whNotice').textContent(),/access refused/);await f.page.unroute('**/resume/master-edit');
  const revision=await f.page.evaluate(()=>window.CareerWorkHistoryPage.state.revision);
  const changed=engine(['resume','base-patch'],{CH_RESUME_DOC:JSON.stringify({revision,edits:[{op:'set',field:'role',roleIndex:0,roleTitle:'Principal',key:'org',before:'Example Consulting',value:'Recorded Updated Employer'}]})});assert.equal(changed.ok,true,changed.err);
  await (await directControl(f.page,'Tab in Client Architect')).click();await settled(f.page);assert.equal(saved().roles[2].parent_role_id,undefined);assert.equal(await f.page.locator('#whNotice').textContent(),'Your work history changed while this page was open. It has been read again as saved; make the change again. Nothing was changed.');
  await (await directControl(f.page,'Tab in Client Architect')).click();await settled(f.page);
  const owns=await directControl(f.page,'Tab in Engineer');assert.equal(await owns.isDisabled(),true);assert.match(await owns.getAttribute('title'),/Unlink/);
  assert.equal(await (await directControl(f.page,'Add sub-engagement under Client Architect')).isDisabled(),true,'a child cannot gain another level');assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy deleted parent cannot retarget a pending Add sub-engagement',async()=>{
 reset();const legacy=saved();delete legacy.roles[0].id;fs.writeFileSync(file(),JSON.stringify(legacy,null,2));const f=await open(412);try{
  await (await directControl(f.page,'Add sub-engagement under Principal')).click();const form=f.page.locator('form.wh-form');
  await form.getByLabel('Job title',{exact:true}).fill('Must not be retargeted');await form.getByLabel('Employer',{exact:true}).fill('Synthetic Client');await form.getByLabel('Start year',{exact:true}).fill('2025');
  const revision=await f.page.evaluate(()=>window.CareerWorkHistoryPage.state.revision);
  const deleted=engine(['resume','base-patch'],{CH_RESUME_DOC:JSON.stringify({revision,edits:[{op:'remove',field:'role',roleIndex:0,roleTitle:'Principal',before:'Principal'}]})});assert.equal(deleted.ok,true,deleted.err);
  await form.getByRole('button',{name:'Add sub-engagement',exact:true}).click();await settled(f.page);
  assert.ok(!saved().roles.some(r=>r.title==='Must not be retargeted'));assert.equal(await f.page.locator('#whNotice').textContent(),'Your work history changed while this page was open. It has been read again as saved; make the change again. Nothing was changed.');
  assert.equal(await f.page.getByLabel('Client engagement under',{exact:true}).inputValue(),'','fresh retry requires choosing a current parent');assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy heading-bearing standalone entry tabs in through the actual writer',async()=>{
 reset();const value=saved();value.roles[2].engagements_heading='Selected Client Engagements';fs.writeFileSync(file(),JSON.stringify(value,null,2));const f=await open(412);try{
  await (await directControl(f.page,'Tab in Client Architect')).click();await settled(f.page);
  const expected=structuredClone(fixture);expected.roles[2].parent_role_id='other';assert.deepEqual(saved(),expected,'same heading-clear semantics as the existing relationship dropdown');assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('direct hierarchy duplicate saved employer identity is explained without opening or retargeting a form',async()=>{
 reset();const value=saved();value.roles[1].id=value.roles[0].id;fs.writeFileSync(file(),JSON.stringify(value,null,2));const f=await open(412);try{
  const add=await directControl(f.page,'Add sub-engagement under Principal');await add.click({force:true});
  assert.ok(await f.page.locator('form.wh-form').count()<=1,'selecting one entry never creates duplicate editors');
  assert.equal(await add.isDisabled(),true,'ambiguous target cannot open a new relationship');assert.match(await add.getAttribute('title'),/uniquely/);
  assert.equal(await (await directControl(f.page,'Tab in Client Architect')).isDisabled(),true,'prior group with duplicate identity is not a valid target');assert.deepEqual(saved(),value);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});
