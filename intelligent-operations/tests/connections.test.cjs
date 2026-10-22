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
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#connections');await page.getByText('Records refreshed',{exact:false}).waitFor();
 return {page,metadata,get sends(){return sends;},get reads(){return reads;},deny(){denied=true;},delay(callback){delayed=callback;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const read=async page=>{await page.getByRole('button',{name:'Refresh my connections',exact:true}).click();await page.waitForFunction(()=>document.getElementById('connection-status').textContent.includes('Current signed-in'));};
test('service view shows genuine source standing without claiming delivery or exposing private destinations',async()=>{
 const f=await fixture();try{await read(f.page);const service=await f.page.locator('#connection-services').innerText(),notification=await f.page.locator('#notification-services').innerText();assert.match(service,/Service selected/);assert.match(service,/invocation scope is linked/);assert.match(service,/Usable personal account recorded/);assert.match(service,/not-probed/);assert.match(service,/Service not selected/);assert.match(notification,/Portal transport registered/);assert.match(notification,/Portal transport not registered/);assert.match(notification,/Delivery has not been tested/);assert.ok(!notification.includes('private-destination'));assert.ok(!notification.includes('+15551234567'));assert.equal(f.sends,0);
  delete f.metadata.httpServices;await read(f.page);assert.match(await f.page.locator('#connection-services').innerText(),/rollout is required/);
  f.deny();await f.page.getByRole('button',{name:'Refresh my connections',exact:true}).click();await f.page.getByText('Access changed.',{exact:false}).waitFor();for(const id of ['connection-list','connection-services','notification-services'])assert.equal(await f.page.locator('#'+id).innerText(),'');assert.equal(f.sends,0);
 }finally{await f.close();}
});
test('an older connection response cannot restore private rows after a newer refresh',async()=>{
 const f=await fixture();let release;try{f.delay(fn=>{release=fn;});await f.page.getByRole('button',{name:'Refresh my connections',exact:true}).click();while(!release)await new Promise(r=>setTimeout(r,10));await read(f.page);const send=release;release=null;send();await f.page.waitForTimeout(50);assert.ok(!(await f.page.locator('#connection-list').innerText()).includes('stale-private-account'));assert.match(await f.page.locator('#connection-list').innerText(),/owned-work/);assert.equal(f.sends,0);
 }finally{release?.();await f.close();}
});

test('credentials shortcuts route to native connections without collecting or transferring secrets',async()=>{
 const f=await fixture();try{
  await f.page.getByRole('link',{name:'Credentials & access',exact:true}).click();
  await f.page.locator('#credentials').waitFor({state:'visible'});
  assert.equal(await f.page.locator('#connections').isVisible(),false);
  for(const name of ['GitHub','GitLab','Amazon Web Services','Google Cloud','Microsoft Azure','Email']){
   const card=f.page.locator('#credentials article').filter({has:f.page.getByRole('heading',{name,exact:true})});
   assert.equal(await card.count(),1);assert.equal(await card.locator('a').getAttribute('target'),'_top');
   assert.match(await card.locator('a').getAttribute('href'),/^\/utilities(?:\?category=email)?$/);
  }
  const content=await f.page.locator('#credentials').innerText();
  assert.match(content,/aws sso login/);assert.match(content,/gcloud auth login/);assert.match(content,/no Azure login control/);assert.match(content,/roadmap item/);
  assert.equal(await f.page.locator('#credentials input,#credentials textarea').count(),0);assert.equal(f.sends,0);
  await f.page.setViewportSize({width:390,height:844});assert.equal(await f.page.locator('#credentials').isVisible(),true);
  await f.page.getByRole('link',{name:'Review current integration services'}).click();await f.page.locator('#connections').waitFor({state:'visible'});assert.equal(await f.page.locator('#connections').isVisible(),true);
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
