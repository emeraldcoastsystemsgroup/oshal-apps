/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A filed delegation shows its ticket, not a second File button. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard swarm hand-off (kernel ADR-194): the envelope check mirrors the kernel inbox; one outbound reservation per plan and peer account with the plan's exact files and digests; receipts are recorded as operator-reported; a received delegation is filed once as a canonical investigation with the envelope as untrusted evidence, an uncertain create is held; records stay in the caller scope; the shipped page sends once through the confirmed peer connection, files a received delegation, issues and revokes peer tokens and clears on refusal. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),D=require('../routes/delegations.js');
const sha=b=>createHash('sha256').update(b).digest('hex');
const files={'remediate.sh':'#!/bin/sh\nkubectl rollout restart deployment/api\n','verify.sh':'#!/bin/sh\ncurl -fsS http://api/healthz\n'};
async function seedPlan(f,owner){const planId=sha('plan-'+randomUUID());const plan={id:planId,ticketId:randomUUID(),ticketRevision:3,alert:{deliveryId:'d1',alertType:'HighErrorRate',resource:{kind:'kubernetes-pod',id:'pod-uid-1'},time:'2026-10-22T21:44:00Z'},target:{namespace:'operations-demo',pod:'api-1',uid:'pod-uid-1',container:'api'},answerSha256:sha('answer'),artifacts:Object.entries(files).map(([name,c])=>({name,sha256:sha(c),bytes:Buffer.byteLength(c)})),createdAt:new Date().toISOString(),executionAuthorized:false};
 await f.inspect.query('INSERT INTO operations_action_plans(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[owner,planId,plan.createdAt,JSON.stringify(plan)]);
 for(const [name,c] of Object.entries(files))await f.inspect.query('INSERT INTO operations_action_artifacts(user_sub,plan_id,name,sha256,content) VALUES($1,$2,$3,$4,$5)',[owner,planId,name,sha(c),Buffer.from(c)]);return plan;}
function port(){const tickets=new Map(),starts=[];return {tickets,starts,async createTicket(input){const id=randomUUID();tickets.set(id,{ticketId:id,ticketType:input.ticketType,status:'queued'});return {ticketId:id};},async getTicket(id){return tickets.get(id)||null;},async startTicket(id,input){starts.push({id,input});tickets.get(id).status='running';return {status:'queued'};}};}
const inbound=(envelope,id='a'.repeat(64))=>({id,delegationId:envelope.delegationId,digest:sha(JSON.stringify(envelope)),peer:{tokenId:'b'.repeat(64),label:'Upper swarm'},receivedAt:1792707813434,envelope});
test('envelopes are closed and bounded exactly as the kernel inbox checks them',()=>{
 const ok={v:1,delegationId:'delegation-0000000001',senderTicketId:'t-1',sender:{name:'Upper'},summary:'Look at api',evidence:{a:1},manifest:[{path:'remediate.sh',sha256:'a'.repeat(64),bytes:3}],sentAt:'2026-10-22T22:00:00Z'};
 assert.equal(D.envelopeShape(structuredClone(ok)).v,1);
 for(const bad of [{v:2},{delegationId:'short'},{execute:true},{summary:''},{evidence:'x'},{evidence:{blob:'x'.repeat(49*1024)}},{manifest:[{path:'../x',sha256:'a'.repeat(64),bytes:1}]},{manifest:[{path:'x',sha256:'A'.repeat(64),bytes:1}]},{sender:{name:'x',extra:1}}])assert.throws(()=>D.envelopeShape({...structuredClone(ok),...bad}),{status:400},JSON.stringify(bad).slice(0,60));
});
test('one outbound reservation per plan and peer carries the plan files; receipts are operator-reported; filing is once and held when uncertain',async()=>{
 const f=await fixture();try{const pool=f.caller('alice'),plan=await seedPlan(f,'alice');
  const r=await D.outboundDelegation(pool,'alice',{planId:plan.id,account:'lower-swarm',senderName:'Upper ops',summary:'Please confirm from your monitoring.'});
  assert.equal(r.state,'reserved');assert.equal(r.envelope.senderTicketId,plan.ticketId);assert.deepEqual(r.envelope.manifest.map(m=>m.path),['remediate.sh','verify.sh']);assert.equal(r.envelope.manifest[0].sha256,sha(files['remediate.sh']));
  assert.equal(r.envelope.evidence.files.find(x=>x.name==='verify.sh').content,files['verify.sh']);assert.equal(r.envelope.evidence.executionAuthorized,false);D.envelopeShape(structuredClone(r.envelope));
  assert.equal((await D.outboundDelegation(pool,'alice',{planId:plan.id,account:'lower-swarm',summary:'again'})).retry,true,'one reservation per plan and peer');
  assert.notEqual((await D.outboundDelegation(pool,'alice',{planId:plan.id,account:'other-peer',summary:'x'})).delegationId,r.delegationId);
  await assert.rejects(D.reportOutbound(pool,'alice',{id:r.id,receipt:{delegationId:'someone-else-000001',receivedAt:1,digest:'c'.repeat(64),replayed:false}}),{status:409});
  const delivered=await D.reportOutbound(pool,'alice',{id:r.id,receipt:{delegationId:r.delegationId,receivedAt:1,digest:'c'.repeat(64),replayed:false}});assert.equal(delivered.state,'delivered');assert.equal(delivered.verifiedByServer,false);
  await assert.rejects(D.outboundDelegation(f.caller('bob'),'bob',{planId:plan.id,account:'lower-swarm',summary:'x'}),{status:404},'another person cannot send alice\'s plan');
  const p=port(),ctx={pool,ticketService:p},env=structuredClone(r.envelope);
  const filed=await D.acceptDelegation(ctx,'alice',{delegation:inbound(env)});assert.equal(filed.state,'started');assert.equal(p.starts.length,1);
  const packet=JSON.parse(Buffer.from(p.starts[0].input.files[0].bytes));assert.equal(packet.schema,'triagenorth-delegated-investigation/1');assert.equal(packet.executionAuthorized,false);assert.equal(packet.delegation.sender.name,'Upper ops');assert.match(p.starts[0].input.prompt,/untrusted evidence/);
  assert.equal((await D.acceptDelegation(ctx,'alice',{delegation:inbound(env)})).ticketId,filed.ticketId,'filed once');assert.equal(p.tickets.size,1);
  const lost=port();lost.createTicket=async()=>{throw Error('lost reply');};const held=inbound({...env,delegationId:'delegation-held-0001'},'c'.repeat(64));
  await assert.rejects(D.acceptDelegation({pool,ticketService:lost},'alice',{delegation:held}),{status:503});await assert.rejects(D.acceptDelegation({pool,ticketService:port()},'alice',{delegation:held}),{status:409},'an uncertain create is never retried blindly');
  await assert.rejects(D.acceptDelegation(ctx,'alice',{delegation:{...inbound(env),extra:1}}),{status:400});
  const page=await D.delegationRecords(pool,'alice');assert.equal(page.items.length,4);assert.ok(page.items.every(i=>!('envelope' in i)));assert.equal((await D.delegationRecords(f.caller('bob'),'bob')).items.length,0);
 }finally{await f.close();}
});
test('the shipped page sends once through the confirmed peer connection, files a received delegation, manages peer tokens and clears on refusal',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),plan=await seedPlan(f,'alice'),app=express(),proofs=new Set(),effects=[],tokens=[];let denied=false;app.use(express.json({limit:'1mb'}));
  const received={v:1,delegationId:'lower-received-000001',senderTicketId:'their-ticket-9',sender:{name:'Edge swarm'},summary:'Edge saw 503s from your api pods',evidence:{alert:'HighErrorRate',pods:['api-1']},manifest:[],sentAt:'2026-10-22T22:00:00Z'};
  app.use((req,res,next)=>{if(denied)return res.status(403).json({detail:'denied'});req.oidc={user:{sub:'alice'}};next();});
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'oshal-peer',account:'lower-swarm',status:'connected',shared:false}],httpServices:[{connector:'oshal-peer',configured:true,baseUrl:'https://lower.example'}]}));
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  app.post('/connectors/oshal-peer/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']));D.envelopeShape(structuredClone(req.body));effects.push({op:req.params.op,account:req.query.account,body:req.body});res.json({status:202,data:{delegationId:req.body.delegationId,receivedAt:1792707813434,digest:'d'.repeat(64),replayed:false}});});
  app.get('/api/v1/peer-inbox',(_req,res)=>res.json({delegations:[{id:'e'.repeat(64),delegationId:received.delegationId,peer:{label:'Edge peer'},sender:received.sender,senderTicketId:received.senderTicketId,summary:received.summary,manifestEntries:0,receivedAt:1792707813434}],executionAuthorized:false}));
  app.get('/api/v1/peer-inbox/:id',(req,res)=>res.json({id:req.params.id,delegationId:received.delegationId,digest:'f'.repeat(64),peer:{tokenId:'1'.repeat(64),label:'Edge peer'},receivedAt:1792707813434,envelope:received}));
  app.get('/api/v1/peer-tokens',(_req,res)=>res.json({peerTokens:tokens}));
  app.post('/api/v1/peer-tokens',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'issuing a token needs a fresh confirmation');const t={tokenId:'2'.repeat(64),label:req.body.label,createdAt:1792707813434,expiresAt:null};tokens.push(t);res.status(201).json({token:'oshal_peer_'+'9'.repeat(64),peerToken:t});});
  app.delete('/api/v1/peer-tokens/:id',(req,res)=>{tokens.splice(0);res.json({revoked:req.params.id});});
  const p=port(),routes=loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,ticketService:p,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}});app.use('/api/intelligent-operations',routes);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#swarms');await page.getByText('delegation(s) in your inbox',{exact:false}).waitFor();
  await page.locator('#swarms-summary').fill('Please confirm from your lower-level monitoring before anything runs.');await page.getByRole('button',{name:'Send to peer swarm',exact:true}).click();await page.getByText('Delivered. The peer swarm now has it',{exact:false}).waitFor();
  assert.equal(effects.length,1);assert.equal(effects[0].op,'oshal-peer-deliver-delegation');assert.equal(effects[0].account,'lower-swarm');assert.equal(effects[0].body.senderTicketId,plan.ticketId);
  await page.getByRole('button',{name:'Send to peer swarm',exact:true}).click();await page.getByText('already delivered to that peer',{exact:false}).waitFor();assert.equal(effects.length,1,'a delivered plan is not sent twice');
  await page.getByRole('button',{name:'Inspect',exact:true}).click();await page.locator('#swarms-detail').getByText('Everything below is data another swarm sent',{exact:false}).waitFor();
  await page.getByRole('button',{name:'File as investigation',exact:true}).click();await page.getByText('and started.',{exact:false}).waitFor();await page.locator('#swarms-inbox').getByText('Filed · open ticket',{exact:false}).waitFor();assert.equal(await page.locator('#swarms-inbox').getByRole('button',{name:'File as investigation',exact:true}).count(),0,'a filed delegation offers no second filing');assert.equal(p.starts.length,1);assert.equal(JSON.parse(Buffer.from(p.starts[0].input.files[0].bytes)).delegation.sender.name,'Edge swarm');
  await page.locator('#swarms-token-label').fill('Edge swarm');await page.getByRole('button',{name:'Issue peer token',exact:true}).click();await page.getByText('It is not shown again',{exact:false}).waitFor();await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.getByText('No peer tokens.',{exact:false}).waitFor();
  denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.getElementById('swarms-inbox').childElementCount===0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
