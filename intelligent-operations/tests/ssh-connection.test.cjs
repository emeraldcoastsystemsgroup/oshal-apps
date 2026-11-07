/* CHANGE LOG: ux audit | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the SSH card opens from the SSH hosts row of Connections & access; the app row's one refresh reads it (no card Refresh); the username is never guessed. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 2026-11-03: the Credentials & access SSH card points at the card, never the masked dialog; a key leaves the page once the kernel has it even when the page moves mid-request, and after a refusal a retry cannot change; the kernel's capability refusal keeps its meaning (missing, revoked, turned off) on the card and on Cloud & SSH commands; a record the kernel cannot read is named on Check login; Disconnect says revoked; a lapsed session names the way back; the kernel's username rule; indented pastes canonicalized; no save where no hosts are selected; the binding guard reads the real router and any quoting. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Your SSH connection: the key check reads only the OpenSSH envelope (an unencrypted ed25519 key passes; a passphrase, an RSA key, a PEM key or junk is named before anything is sent), the credential is exactly {"username","privateKey"}; the shipped Connections page saves a chosen key file as that credential through the kernel's connect route, lists the selected hosts under one confirmation, runs one confirmed uptime as a login check recorded as an ssh-connection command run in real SQL, disconnects and clears on refusal; Cloud & SSH commands names the missing connection instead of treating the kernel's "nobody has connected ssh" as a lost session. Every asset the experience route serves and every script the page loads has GET and HEAD bindings in authorization.yaml: a new script without them is refused by the kernel (deny_tier), which is how the first 1.1.4 delivery failed on the Spark, so the card ships inside the bound command-helper asset. Keys are made at test time by ssh-keygen: the public-snapshot gate refuses key-shaped literals in the tree. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{commandRecords}=require('../routes/commands.js'),{inspectOpenSshKey,credentialFor,canonicalKey,sshUnavailable}=require('../experience/command-helper.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ops-ssh-guard-'));
/** A key made by the real ssh-keygen; the guard fails loudly without it rather than skipping. */
function keygen(name,...args){const file=path.join(dir,name);const r=spawnSync('ssh-keygen',['-q','-f',file,'-C','ops-ssh-guard',...args],{encoding:'utf8'});assert.equal(r.status,0,'ssh-keygen is required for this guard: '+(r.stderr||r.error?.message||''));return file;}
const ed=keygen('ed','-t','ed25519','-N',''),locked=keygen('locked','-t','ed25519','-N','open-sesame'),rsa=keygen('rsa','-t','rsa','-b','2048','-N',''),pem=keygen('pem','-t','rsa','-b','2048','-m','PEM','-N','');
const stubRoutes=()=>loadExperience().createOperationsExperienceRoutes({pool:{query:async()=>({rows:[]})},appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('the key check reads the OpenSSH envelope only: ed25519 without a passphrase passes, everything else is named before it is sent',()=>{
 const text=fs.readFileSync(ed,'utf8'),good=inspectOpenSshKey(text);assert.deepEqual(good,{ok:true,type:'ssh-ed25519',encrypted:false,reason:''});
 const withPass=inspectOpenSshKey(fs.readFileSync(locked,'utf8'));assert.equal(withPass.ok,false);assert.equal(withPass.encrypted,true);assert.match(withPass.reason,/passphrase/);
 const wrongType=inspectOpenSshKey(fs.readFileSync(rsa,'utf8'));assert.equal(wrongType.ok,false);assert.equal(wrongType.type,'ssh-rsa');assert.match(wrongType.reason,/ed25519 keys only/);
 const pemKey=inspectOpenSshKey(fs.readFileSync(pem,'utf8'));assert.equal(pemKey.ok,false);assert.match(pemKey.reason,/RSA format/);
 assert.match(inspectOpenSshKey('hello').reason,/not a private key file/);assert.match(inspectOpenSshKey('').reason,/not a private key file/);
 const lines=text.trimEnd().split('\n'),cut=lines.slice(0,Math.floor(lines.length/2)).concat(lines[lines.length-1]).join('\n')+'\n';assert.equal(inspectOpenSshKey(cut).ok,false);
 assert.equal(inspectOpenSshKey(text.replace(/\n/g,'\r\n')).ok,true,'CRLF');assert.equal(inspectOpenSshKey(lines.map(l=>'    '+l).join('\n')).ok,true,'an indented paste reads as the key the kernel will parse');
 for(const reason of [inspectOpenSshKey('hello').reason,wrongType.reason,pemKey.reason,withPass.reason])assert.doesNotMatch(reason,/-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/,'no message spells out a key header the public-snapshot gate refuses');
});
test('the credential is exactly the kernel\'s {"username","privateKey"}, canonical, and a bad username or key never becomes one',()=>{
 const text=fs.readFileSync(ed,'utf8'),made=credentialFor(' root ',text);assert.equal(made.error,undefined);assert.equal(made.type,'ssh-ed25519');assert.equal(made.username,'root');
 const parsed=JSON.parse(made.token);assert.deepEqual(Object.keys(parsed).sort(),['privateKey','username']);assert.equal(parsed.username,'root');assert.equal(parsed.privateKey,text);
 assert.equal(JSON.parse(credentialFor('root',text.trimEnd()).token).privateKey,text,'a trailing newline is restored');
 assert.equal(JSON.parse(credentialFor('root',text.split('\n').map(l=>'  '+l+'  ').join('\n')).token).privateKey,text,'indentation and trailing blanks are removed line by line');
 assert.equal(canonicalKey('\n\n  a \n b\n\n'),'a\nb\n');assert.equal(canonicalKey(''),'');
 assert.equal(JSON.parse(credentialFor('_svc',text).token).username,'_svc','the kernel has no first-character rule');assert.equal(JSON.parse(credentialFor('deploy.bot-1',text).token).username,'deploy.bot-1');
 assert.match(credentialFor('root; rm -rf /',text).error,/username/);assert.match(credentialFor('',text).error,/username/);assert.match(credentialFor('x'.repeat(65),text).error,/username/);
 assert.match(credentialFor('root',fs.readFileSync(locked,'utf8')).error,/passphrase/);assert.match(credentialFor('root','').error,/not a private key file/);
 assert.match(sshUnavailable('nobody has connected ssh for you'),/^No SSH connection saved yet/);assert.match(sshUnavailable('the connection to ssh is revoked; reconnect it'),/^Your SSH connection is revoked and cannot be used/);
 assert.match(sshUnavailable('the connection to ssh is expired; reconnect it'),/is expired/);assert.match(sshUnavailable('An administrator turned SSH hosts off on this installation'),/^An administrator turned SSH hosts off/);
});
test('every served asset and every page script is bound in authorization.yaml for GET and HEAD',()=>{
 const yaml=dependency('js-yaml'),catalog=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8')),http=(catalog.bindings||{}).http||[];
 const bound=method=>new Set(http.filter(b=>b.method===method).map(b=>b.path));assert.ok(bound('GET').has('/assets/command-helper.js'),'the catalog shape is the one this guard reads');
 const served=new Set(stubRoutes().stack.filter(l=>l.route&&l.route.methods.get).map(l=>l.route.path).filter(p=>typeof p==='string'&&p.startsWith('/assets/')));assert.ok(served.size>20,'the real router serves its assets');
 const page=fs.readFileSync(path.join(root,'experience/index.html'),'utf8'),scripts=[...page.matchAll(/(?:src|href)=["']\/api\/intelligent-operations(\/assets\/[^"']+)["']/g)].map(m=>m[1]);
 assert.ok(scripts.includes('/assets/command-helper.js')&&!scripts.includes('/assets/ssh-connection.js'));
 for(const p of [...served,...scripts]){assert.ok(bound('GET').has(p),p+' is served but has no GET binding');assert.ok(bound('HEAD').has(p),p+' is served but has no HEAD binding');}
 for(const s of scripts)assert.ok(served.has(s),s+' is loaded by the page but not served by the route');
});
test('the SSH hosts row on Connections & access opens Your SSH connection in place, never the standard masked dialog',()=>{
 // UX audit 2026-11-06: Credentials & access merged into Connections & access; the SSH row's action opens the in-app card.
 const page=fs.readFileSync(path.join(root,'experience/index.html'),'utf8'),controller=fs.readFileSync(path.join(root,'experience/experience.js'),'utf8');
 assert.equal(page.includes('<section id="credentials"'),false,'the merged-away page is gone; #credentials leads to Connections & access');
 const row=controller.match(/\{key:'ssh',[^}]*\}/);assert.ok(row,'an SSH hosts provider row');assert.match(row[0],/panel:'ssh'/);assert.doesNotMatch(row[0],/href:/,'no top-window connection flow for SSH');
 const card=page.slice(page.indexOf('<article id="ssh-conn-panel"'),page.indexOf('</article>',page.indexOf('<article id="ssh-conn-panel"')));assert.match(card,/data-panel="ssh"/);assert.ok(!card.includes('/utilities'));assert.match(card,/key file/);
 assert.match(page,/<input id="commands-ssh-account"[^>]*readonly/,'the account on Cloud & SSH commands is always primary');
});
test('the shipped Connections page saves a key file through the connect route, lists hosts and checks the login under confirmations, records the check, keeps the kernel\'s refusal meaning, forgets the key, disconnects (revoked) and clears on refusal; Cloud & SSH commands names a missing or revoked connection',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),proofs=new Set(),effects=[];let denied=false,saved=null,revoked=false,services=true,holdConnect=false,pending=null,connectRefused=false,execBroken=false;app.use(express.json({limit:'1mb'}));
  app.get('/connectors',(_req,res)=>{if(denied)return res.status(401).json({refused:'unauthenticated'});res.json({connectors:[{id:'ssh',display_name:'SSH hosts'}],httpServices:services?[{connector:'ssh',configured:true,capabilityLinked:true}]:[],connections:saved?[{connector:'ssh',account:'primary',status:'connected',liveness:'connected'}]:revoked?[{connector:'ssh',account:'primary',status:'revoked',liveness:'revoked'}]:[]});});
  app.post('/connectors/ssh/connect',(req,res)=>{effects.push({op:'connect',body:req.body});if(connectRefused)return res.status(403).json({refused:'capability_not_granted',detail:'An administrator turned SSH hosts off on this installation, so it cannot be connected or used here.'});const done=()=>{saved=req.body.token;res.json({status:'connected',connector:'ssh'});};if(holdConnect){pending=done;return;}done();});
  app.delete('/connectors/ssh',(_req,res)=>{effects.push({op:'disconnect'});saved=null;revoked=true;res.json({status:'disconnected',connector:'ssh'});});
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  app.post('/connectors/ssh/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'each action carries a fresh confirmation');effects.push({op:req.params.op,body:req.body,account:req.query.account});
   if(!saved)return res.status(403).json({detail:revoked?'the connection to ssh is revoked; reconnect it':'nobody has connected ssh for you',refused:'capability_not_granted'});
   if(req.params.op==='ssh-list-hosts')return res.json({transport:'native_ssh',operation:'ssh-list-hosts',hosts:[{name:'gsquared-dev',address:'203.0.113.10',port:22,hostKey:'SHA256:'+'a'.repeat(43)}],executionAuthorized:false});
   if(execBroken)return res.status(400).json({detail:'invalid input: SSH connection needs your username and an OpenSSH ed25519 private key',refused:'invalid_request'});
   res.json({transport:'native_ssh',operation:'ssh-exec',observedAt:'t',target:{host:'gsquared-dev',address:'203.0.113.10',port:22,username:'root'},hostKeyVerified:true,outcome:'completed',exitCode:0,stdout:' 20:00:01 up 3 days, load average: 0.10\n',stderr:'',outputLimited:false,clientTimedOut:false});});
  app.use((req,res,next)=>{if(denied)return res.status(403).json({error:'denied'});req.oidc={user:{sub:'alice'}};next();});
  const routes=loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}});app.use('/api/intelligent-operations',(req,res,next)=>{if(req.path==='/topology')return res.json({assets:[{id:'pod-1',provider:'kubernetes',scope:'cluster-uid',kind:'pod',nativeId:'pod-uid-1',name:'api-1',health:'healthy',observedAt:'2026-10-22T00:00:00.000Z',properties:{namespace:'operations-demo'}}],relationships:[],asOf:'2026-10-22T00:00:00.000Z',collections:[{id:'cluster-uid/operations-demo',complete:true,observedAt:'2026-10-22T00:00:00.000Z'}],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}});next();},routes);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app',text=fs.readFileSync(ed,'utf8'),result=page.locator('#ssh-conn-result'),standing=page.locator('#ssh-conn-standing');
  // Cloud & SSH commands with nothing saved: the missing connection is named and the page is not cleared.
  await page.goto(base+'#commands');await page.locator('#commands-history').getByText('No commands recorded yet.',{exact:true}).waitFor();
  assert.equal(await page.locator('#commands-ssh-account').getAttribute('readonly'),'');await page.locator('#commands-tool').selectOption('ssh');await page.getByRole('button',{name:'Load selected hosts',exact:true}).click();
  await page.locator('#commands-status').getByText('No SSH connection saved yet: open Connections, Your SSH connection',{exact:false}).waitFor();assert.equal(await page.locator('#commands-history').evaluate(e=>e.childElementCount),1);
  // The card: no connection, no hosts selected on the installation, a key with a passphrase, a connect the kernel refuses.
  await page.goto(base+'#connections');await page.locator('#provider-rows .provider-row',{hasText:'SSH hosts'}).locator('.provider-action').click();await page.locator('#ssh-conn-panel').waitFor({state:'visible'});await page.locator('#ssh-conn-username').fill('root');await standing.getByText('No SSH connection saved yet. Save your username and key file below; your administrator has selected the hosts.',{exact:true}).waitFor();
  services=false;await page.locator('#ssh-conn-file').setInputFiles(ed);await page.locator('#ssh-conn-keycheck').getByText('ed: OpenSSH ssh-ed25519 key, no passphrase. Ready to save.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save SSH connection',exact:true}).click();await result.getByText('has not selected any SSH hosts on this installation',{exact:false}).waitFor();assert.equal(effects.filter(e=>e.op==='connect').length,0,'nothing is sent where no hosts are selected');services=true;
  await page.locator('#ssh-conn-file').setInputFiles(locked);await page.locator('#ssh-conn-keycheck').getByText('This key has a passphrase',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Save SSH connection',exact:true}).click();await result.getByText('This key has a passphrase',{exact:false}).waitFor();assert.equal(effects.filter(e=>e.op==='connect').length,0,'a refused key never reaches the kernel');
  connectRefused=true;await page.locator('#ssh-conn-file').setInputFiles(ed);await page.locator('#ssh-conn-keycheck').getByText('Ready to save',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Save SSH connection',exact:true}).click();await result.getByText('An administrator turned SSH hosts off on this installation',{exact:false}).waitFor();
  assert.equal(await page.locator('#ssh-conn-keycheck').textContent(),'','a refusal a retry cannot change forgets the key');assert.equal(await page.locator('#ssh-conn-key').inputValue(),'');assert.equal(effects.filter(e=>e.op==='connect').length,1);connectRefused=false;
  // The page moves while the connect is in flight: the kernel has the key, so the page forgets it.
  holdConnect=true;await page.locator('#ssh-conn-panel details').evaluate(d=>{d.open=true;});await page.locator('#ssh-conn-key').fill(text);await page.locator('#ssh-conn-keycheck').getByText('Pasted key: OpenSSH ssh-ed25519 key, no passphrase. Ready to save.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save SSH connection',exact:true}).click();while(!pending)await new Promise(r=>setTimeout(r,20));
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();await standing.getByText('No SSH connection saved yet',{exact:false}).waitFor();pending();pending=null;holdConnect=false;
  await page.waitForFunction(()=>document.getElementById('ssh-conn-key').value===''&&document.getElementById('ssh-conn-keycheck').textContent==='');assert.equal(await page.locator('#ssh-conn-file').inputValue(),'');
  assert.deepEqual(JSON.parse(effects.filter(e=>e.op==='connect')[1].body.token),{username:'root',privateKey:text});
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();await standing.getByText('Saved: your SSH connection "primary". Check login on this host proves the kernel can read it; Cloud & SSH commands uses it as "primary".',{exact:true}).waitFor();
  // A record the kernel cannot read (saved elsewhere) is named on Check login; then the real save, the hosts and a login that works.
  await page.getByRole('button',{name:'Show my hosts',exact:true}).click();await result.getByText('1 host(s) selected by your administrator: gsquared-dev.',{exact:false}).waitFor();
  execBroken=true;await page.getByRole('button',{name:'Check login on this host',exact:true}).click();await result.getByText('The saved SSH connection is not a login the kernel can read',{exact:false}).waitFor();
  await standing.getByText('is saved but cannot log in; save your username and key file below to replace it.',{exact:false}).waitFor();execBroken=false;
  await page.locator('#ssh-conn-file').setInputFiles(ed);await page.locator('#ssh-conn-keycheck').getByText('Ready to save',{exact:false}).waitFor();await page.getByRole('button',{name:'Save SSH connection',exact:true}).click();
  await result.getByText('Saved as "root". Hosts your administrator selected: gsquared-dev.',{exact:false}).waitFor();await standing.getByText('Saved: your SSH connection "primary" as "root". Check login on this host proves the kernel can read it',{exact:false}).waitFor();
  const connects=effects.filter(e=>e.op==='connect');assert.equal(connects.length,3);assert.deepEqual(Object.keys(connects[2].body),['token']);assert.deepEqual(JSON.parse(connects[2].body.token),{username:'root',privateKey:text});
  assert.equal(await page.locator('#ssh-conn-keycheck').textContent(),'');assert.equal(await page.locator('#ssh-conn-key').inputValue(),'');assert.deepEqual(effects.filter(e=>e.op==='ssh-list-hosts').map(e=>[e.body,e.account]).slice(-1),[[{},'primary']]);
  await page.getByRole('button',{name:'Check login on this host',exact:true}).click();
  await result.getByText('Login works on gsquared-dev as root: 20:00:01 up 3 days, load average: 0.10. Recorded under Cloud & SSH commands.',{exact:true}).waitFor();
  const execs=effects.filter(e=>e.op==='ssh-exec');assert.equal(execs.length,2);assert.deepEqual(execs[1].body,{host:'gsquared-dev',argv:['uptime']});assert.equal(execs[1].account,'primary');
  const record=(await commandRecords(pool,'alice')).items[0];assert.equal(record.tool,'ssh');assert.equal(record.where,'ssh-connection');assert.deepEqual(record.argv,['uptime']);assert.deepEqual(record.target,{host:'gsquared-dev',account:'primary'});assert.equal(record.outcome,'completed');assert.equal(record.exitCode,0);assert.match(record.output,/up 3 days/);assert.equal(record.proposal.readOnly,true);
  assert.equal((await commandRecords(pool,'alice')).items.length,1,'a check the kernel refused was not recorded');
  // Disconnect revokes; the kernel keeps the record; nothing that needs a login is offered; Cloud & SSH commands says revoked.
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();await standing.getByText('Your earlier SSH connection is revoked and cannot be used. Save your username and key file below',{exact:false}).waitFor();
  await result.getByText('Your SSH connection is revoked: the kernel keeps the record (shown as revoked) and the sealed key until you save a new one.',{exact:true}).waitFor();
  assert.equal(effects.filter(e=>e.op==='disconnect').length,1);assert.equal(await page.locator('#ssh-conn-hosts').isDisabled(),true,'a revoked record enables nothing');assert.equal(await page.locator('#ssh-conn-check').isDisabled(),true);
  await page.goto(base+'#commands');await page.locator('#commands-history pre',{hasText:'uptime'}).first().waitFor();
  await page.locator('#commands-tool').selectOption('ssh');await page.getByRole('button',{name:'Load selected hosts',exact:true}).click();
  await page.locator('#commands-status').getByText('Your SSH connection is revoked and cannot be used: open Connections, Your SSH connection',{exact:false}).waitFor();assert.equal(await page.locator('#commands-history').locator('article').count(),1,'a revoked connection does not clear the page');
  // A lapsed session empties the page and the card names the way back.
  denied=true;await page.goto(base+'#connections');
  await page.getByText('Access changed.',{exact:false}).first().waitFor();assert.match(await page.locator('#ssh-conn-standing').textContent(),/^(Sign in through OSHAL to continue, then press Refresh records\.|Refresh to read your SSH connection\.)$/,'the card keeps nothing of the earlier connection and names the way back');assert.equal(await page.locator('#provider-rows .provider-row').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
