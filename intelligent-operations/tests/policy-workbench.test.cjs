// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real candidate percolation, unchanged processing state, revision conflicts and the shipped rule-editing browser flow.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {admit,hash}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const {publishPolicy,previewPolicy,pipelineRecords}=require('../routes/pipeline.js');
const initial={name:'Availability',window:{mode:'sliding',seconds:900},rules:[{name:'Firing alerts',enabled:true,capture:true,query:{term:{status:'firing'}}}]};
async function setup(){const f=await fixture(),backend=await engineFixture(),owner='policy-'+randomUUID(),pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Policy test source',environment:'local-lab',source:example().source}),indexes=new Set();
 const engine=async(cmd,who,args)=>{if(cmd==='publish')indexes.add('ops-rules-'+hash(['detection-owner-v1',who])+'-'+args.revision);return backend.engine(cmd,who,args);};
 const published=await publishPolicy(pool,engine,owner,source,initial,0),ids=[];
 for(const severity of ['critical','warning','info']){const event=example();event.id=randomUUID();event.data.severity=severity;ids.push((await admit(pool,owner,source,event)).record.id);}
 return {f,backend,owner,pool,source,engine,published,ids,async close(){await backend.close();await f.close();for(const index of indexes){const response=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(response.ok||response.status===404);}}};
}
test('candidate trials use actual percolation without activation, reduction or reservations; source/owner mismatches and stale activation are refused',async()=>{
 const x=await setup();try{const draft={...initial,name:'Critical review',rules:[{...initial.rules[0],name:'Critical only',query:{term:{severity:'critical'}}}]};
  const trial=await previewPolicy(x.pool,x.engine,x.owner,x.source,draft,x.ids);assert.deepEqual(trial.summary,{observations:3,matched:1,filtered:2});assert.equal(trial.activationChanged,false);assert.equal(trial.decisionsCommitted,false);assert.equal(trial.evidenceReserved,false);
  let state=await pipelineRecords(x.pool,x.owner);assert.equal(state.bindings[0].policyId,x.published.policy.id);assert.equal(state.bindings[0].revision,1);assert.equal(state.policies.length,2);for(const key of ['decisions','symptoms','evidenceWork'])assert.equal(state[key].length,0);
  assert.equal((await previewPolicy(x.pool,x.engine,x.owner,x.source,draft,x.ids)).policyId,trial.policyId);assert.equal((await pipelineRecords(x.pool,x.owner)).policies.length,2);
  let called=false;const never=async()=>{called=true;throw Error('must not call engine');};
  await assert.rejects(previewPolicy(x.pool,never,x.owner,{...x.source,id:'f'.repeat(64)},draft,x.ids),e=>e.status===404);
  await assert.rejects(previewPolicy(x.f.caller('foreign'),never,'foreign',x.source,draft,x.ids),e=>e.status===404);assert.equal(called,false);
  await assert.rejects(previewPolicy(x.pool,x.engine,x.owner,x.source,draft,[x.ids[0],x.ids[0]]),e=>e.status===400);
  const activated=await publishPolicy(x.pool,x.engine,x.owner,x.source,draft,1);assert.equal(activated.binding.policyId,trial.policyId);assert.equal(activated.binding.revision,2);
  await assert.rejects(publishPolicy(x.pool,x.engine,x.owner,x.source,initial,1),e=>e.status===409);
  state=await pipelineRecords(x.pool,x.owner);assert.equal(state.decisions.length,0);assert.equal(state.evidenceWork.length,0);assert.equal(state.bindings[0].policyId,trial.policyId);
 }finally{await x.close();}
});
test('the shipped rule workbench edits, trials, explicitly activates, restores drafts and clears private data on access withdrawal',async()=>{
 const x=await setup(),express=dependency('express'),{chromium}=dependency('playwright');let server,browser,allowed=true;const collections=new Map([['sources',new Map([[x.source.id,x.source]])]]);
 try{const app=express();app.use((req,res,next)=>{if(!allowed)return res.status(403).json({error:'withdrawn'});req.oidc={user:{sub:x.owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool:x.pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async name=>[...(collections.get(name)||new Map()).values()],put:async(name,id,row)=>{if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,row);}},intent:async(name,input)=>{if(input.request.cmd==='publish')await x.engine('publish',x.owner,input.request.args);return x.backend.intent(name,input);}}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#data');await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.waitForFunction(()=>document.getElementById('policy-name').value==='Availability'&&document.querySelectorAll('.policy-rule').length===1,{}, {timeout:15000});
  await page.locator('#policy-name').fill('Critical review');await page.locator('[data-rule="name"]').fill('Critical only');await page.locator('[data-rule="query"]').fill(JSON.stringify({term:{severity:'critical'}}));
  await page.getByRole('tab',{name:'Events',exact:true}).click();const choices=page.locator('#event-list input[type="checkbox"]');assert.equal(await choices.count(),3);for(let i=0;i<3;i++)await choices.nth(i).check();
  await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.locator('#preview-policy').click();await page.waitForFunction(()=>document.getElementById('policy-preview-status').textContent.includes('1 matched / 3 tested'),{}, {timeout:15000});assert.equal((await pipelineRecords(x.pool,x.owner)).bindings[0].revision,1);
  await page.locator('#publish-policy').click();await page.waitForFunction(()=>document.getElementById('policy-active').textContent.includes('binding revision 2'),{}, {timeout:15000});const active=(await pipelineRecords(x.pool,x.owner)).bindings[0].policyId;assert.notEqual(active,x.published.policy.id);
  await page.getByText('Saved generations and advanced JSON',{exact:true}).click();await page.locator('#policy-history').selectOption(x.published.policy.id);await page.locator('#policy-restore').click();assert.equal(await page.locator('#policy-name').inputValue(),'Availability');assert.equal((await pipelineRecords(x.pool,x.owner)).bindings[0].policyId,active);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  allowed=false;await page.locator('#preview-policy').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('does not permit'),{}, {timeout:15000});assert.equal(await page.locator('.policy-rule').count(),0);assert.equal(await page.locator('#policy-json').inputValue(),'');assert.equal(await page.locator('#policy-preview-results').textContent(),'');assert.ok(await page.locator('#publish-policy').isDisabled());assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await x.close();}
});
