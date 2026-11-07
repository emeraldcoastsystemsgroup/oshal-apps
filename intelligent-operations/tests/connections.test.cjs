// CHANGE LOG: connections and access | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Credentials & access merged into Connections & access (provider rows with live state, settings in a pane or a phone sheet, no per-section Refresh, disabled services on one line); the old #credentials address leads there.
// CHANGE LOG: ssh card in app | maintainer@emeraldcoastsystemsgroup.com | The SSH hosts card opens Your SSH connection inside the application (#connections, no top-window target), never the standard masked dialog; the other shortcuts still open native connections in the top window.
// CHANGE LOG: credentials current | maintainer@emeraldcoastsystemsgroup.com | Credentials cards match what is built: Kubernetes and SSH added, Azure reads, GitHub token guidance, swarm hand-off built.
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify actual service-standing UX distinguishes configured transport, original-person scope and provider delivery, clearing private rows on denied or stale reads. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {dependency}=require('./fixtures/intake.cjs');
async function fixture(){
 const root=path.resolve(__dirname,'../experience');let denied=false,delayed=null,reads=0,sends=0;
 const metadata={connections:[{connector:'jira',account:'owned-work',status:'expiring',shared:false}],httpServices:[{connector:'jira',baseUrl:'https://fixture.atlassian.net/rest/api/3',configured:true,capabilityLinked:true,providerHealth:'not-probed'}]};
 const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://fixture').pathname;res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){sends++;res.writeHead(405);res.end();return;}
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(route==='/connectors'){reads++;if(denied){json({},403);return;}if(delayed){const release=delayed;delayed=null;release(()=>json({...metadata,connections:[{connector:'jira',account:'stale-private-account',status:'connected'}]}));return;}json(metadata);return;}
  if(route==='/api/notify/prefs'){json({source:'native_notifier',channels:['telegram'],prefs:[{channel:'telegram',topic:'operations',enabled:true,telegramChatId:'private-destination'},{channel:'sms',topic:'muted',enabled:false,phone:'+15551234567'}]});return;}
  if(route.endsWith('/records')){json({sources:[],events:[],inventory:[]});return;}if(route.endsWith('/processing/configs')){json({configs:[]});return;}
  if(route.startsWith('/shared/')){res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript':'text/css'});res.end('');return;}
  const file=route.endsWith('/app')?'index.html':route.split('/').pop(),dir=file==='operations.css'?path.resolve(root,'../ui'):root;
  if(!/^[a-z-]+\.(js|css|html)$/.test(file)||!fs.existsSync(path.join(dir,file))){json({},404);return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(dir,file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright'),browser=await chromium.launch({headless:true,args:['--disable-gpu']}),page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#connections');await page.locator('#status',{hasText:/^Updated /}).waitFor();await page.waitForFunction(()=>/^Updated /.test(document.getElementById('connection-status').textContent));
 return {page,metadata,get sends(){return sends;},get reads(){return reads;},deny(){denied=true;},delay(callback){delayed=callback;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
// UX audit 2026-11-06: every section loads with the screen; the app row's one refresh icon reloads them all.
const read=async page=>{await page.getByRole('button',{name:'Refresh records',exact:true}).click();await page.waitForFunction(()=>/^Updated /.test(document.getElementById('connection-status').textContent));};
test('service view shows genuine source standing without claiming delivery or exposing private destinations',async()=>{
 const f=await fixture();try{await read(f.page);const service=await f.page.locator('#connection-services').textContent(),notification=await f.page.locator('#notification-services').textContent();assert.match(service,/Service selected/);assert.match(service,/invocation scope is linked/);assert.match(service,/Usable personal account recorded/);assert.match(service,/not-probed/);assert.match(service,/Not enabled by your administrator: GitLab, ServiceNow\./,'services the administrator has not enabled are one line');assert.doesNotMatch(service,/Service not selected/);assert.match(notification,/Portal transport registered/);assert.match(notification,/Portal transport not registered/);assert.match(notification,/Delivery has not been tested/);assert.ok(!notification.includes('private-destination'));assert.ok(!notification.includes('+15551234567'));assert.equal(f.sends,0);
  delete f.metadata.httpServices;await read(f.page);assert.match(await f.page.locator('#connection-services').textContent(),/rollout is required/);
  f.deny();await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();await f.page.getByText('Access changed.',{exact:false}).first().waitFor();for(const id of ['connection-list','connection-services','notification-services','provider-rows'])assert.equal(await f.page.locator('#'+id).textContent(),'');assert.equal(f.sends,0);
 }finally{await f.close();}
});
test('an older connection response cannot restore private rows after a newer refresh',async()=>{
 const f=await fixture();let release;try{f.delay(fn=>{release=fn;});await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();while(!release)await new Promise(r=>setTimeout(r,10));await read(f.page);const send=release;release=null;send();await f.page.waitForTimeout(50);assert.ok(!(await f.page.locator('#connection-list').textContent()).includes('stale-private-account'));assert.match(await f.page.locator('#connection-list').textContent(),/owned-work/);assert.equal(f.sends,0);
 }finally{release?.();await f.close();}
});

test('Connections & access shows every provider with its live state, opens its settings in place, and the old Credentials address leads there',async()=>{
 const f=await fixture();try{
  f.metadata.connections.push({connector:'github',account:'mine',status:'connected',shared:false},{connector:'ssh',account:'primary',status:'revoked',shared:false});
  await f.page.goto(f.page.url().replace(/#.*$/,'#credentials'));await f.page.locator('#connections').waitFor({state:'visible'});
  assert.match(f.page.url(),/#connections$/,'the merged-away address is replaced by its new home');
  await f.page.waitForFunction(()=>/^Updated /.test(document.getElementById('connection-status').textContent));
  const rows=f.page.locator('#provider-rows .provider-row');assert.equal(await rows.count(),9);
  const state=async name=>(await rows.filter({hasText:name}).locator('.provider-meta').textContent()).trim();
  assert.equal(await state('GitHub'),'Connected');assert.equal(await state('SSH hosts'),'Revoked');assert.equal(await state('Kubernetes'),'Not set up');assert.equal(await state('Amazon Web Services'),'Not set up');
  const github=rows.filter({hasText:'GitHub'}).getByRole('link',{name:'Manage GitHub'});assert.equal(await github.getAttribute('href'),'/utilities');assert.equal(await github.getAttribute('target'),'_top');
  assert.equal(await rows.filter({hasText:'Email'}).getByRole('link',{name:'Connect Email'}).getAttribute('href'),'/utilities?category=email');
  assert.equal(await f.page.locator('#provider-rows input,#provider-rows textarea').count(),0);
  assert.equal(await f.page.locator('#connections button:visible',{hasText:/^Refresh/}).count(),0,'no per-section Refresh buttons');
  await rows.filter({hasText:'Kubernetes'}).locator('.provider-open').click();
  assert.equal(await f.page.locator('#provider-detail').isVisible(),true);assert.equal((await f.page.locator('#conn-pane-title').textContent()),'Kubernetes');
  assert.equal(await f.page.locator('#provider-detail-action').textContent(),'Connect Kubernetes');assert.match(await f.page.locator('#provider-detail-cli-text').textContent(),/kubectl/);
  await rows.filter({hasText:'SSH hosts'}).getByRole('button',{name:'Set up'}).click();await f.page.locator('#ssh-conn-panel').waitFor({state:'visible'});assert.equal(await f.page.locator('#provider-detail').isVisible(),false);
  assert.equal(await f.page.locator('#ssh-conn-username').inputValue(),'','no username is guessed for the person');
  await f.page.locator('#setting-rows .provider-row',{hasText:'Peer tokens'}).locator('.provider-open').click();await f.page.locator('#swarms-issue').waitFor({state:'visible'});
  await f.page.setViewportSize({width:390,height:844});await f.page.locator('#conn-pane-done').click();assert.equal(await f.page.locator('#conn-pane').isVisible(),false);
  await rows.filter({hasText:'Google Cloud'}).locator('.provider-open').click();const pane=await f.page.locator('#conn-pane').boundingBox();assert.ok(pane&&pane.width>=389&&pane.y<=60,'on a phone the settings open as a sheet');
  assert.match(await f.page.locator('#provider-detail-cli-text').textContent(),/gcloud auth login/);
  await f.page.keyboard.press('Escape');assert.equal(await f.page.locator('#conn-pane').isVisible(),false);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no sideways scrolling on a phone');assert.equal(f.sends,0);
 }finally{await f.close();}
});

test('embedded Operations uses the native navigation while standalone access retains its own shell',async()=>{
 const f=await fixture();try{
  assert.equal(await f.page.locator('.shell > nav').isVisible(),true);
  const url=f.page.url();await f.page.setContent('<iframe title="Operations fixture" style="width:100%;height:900px" src="'+url+'"></iframe>');
  const frame=f.page.frameLocator('iframe');await frame.locator('html.operations-embedded').waitFor();
  assert.equal(await frame.locator('.shell > nav').isVisible(),false);assert.equal(await frame.locator('.topbar').isVisible(),false);assert.equal(await frame.locator('#connections').isVisible(),true);
 }finally{await f.close();}
});
