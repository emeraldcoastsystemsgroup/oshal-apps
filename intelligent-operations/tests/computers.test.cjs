/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the card opens from its Connections & access row, and the app row's one refresh reloads it (no Refresh my computers). */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Your computers on the Connections page (kernel ADR-206) in a real browser against a fixture kernel: each of the person's computers shows with whether Jarvis can use it, only a usable one offers Work on it, which goes to the kernel's own page for that computer in the top window; a refusal clears the rows and says the way back; nothing but /api/computers is asked for the card. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {dependency}=require('./fixtures/intake.cjs');
const {standing,workHref}=(()=>{const sandbox={window:{}};new Function('window',fs.readFileSync(path.resolve(__dirname,'../experience/computers.js'),'utf8'))(sandbox.window);return sandbox.window.OperationsComputers;})();
async function fixture(){
 const root=path.resolve(__dirname,'../experience');let denied=0,reads=0;
 const computers=[{id:'11111111-1111-4111-8111-111111111111',name:'sat',platform:'linux',arch:'arm64',connected:true,can_control:true,tools:['shell.exec'],busy:false,last_seen:1},
  {id:'22222222-2222-4222-8222-222222222222',name:'office-pc',platform:'windows',arch:'x64',connected:true,can_control:false,tools:[],busy:false,last_seen:1},
  {id:'33333333-3333-4333-8333-333333333333',name:'',platform:'',arch:'',connected:false,can_control:false,tools:[],busy:false,last_seen:1}];
 const asked=[];
 const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://fixture').pathname;res.setHeader('Cache-Control','no-store');asked.push(req.method+' '+route);
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(route==='/api/computers'){reads++;if(denied){json({refused:'no_identity',detail:'sign in'},denied);return;}json({computers});return;}
  if(route==='/connectors'){json({connections:[],httpServices:[]});return;}
  if(route==='/api/notify/prefs'){json({channels:[],prefs:[]});return;}
  if(route.endsWith('/records')){json({sources:[],events:[],inventory:[]});return;}if(route.endsWith('/processing/configs')){json({configs:[]});return;}
  if(route.startsWith('/shared/')){res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript':'text/css'});res.end('');return;}
  const file=route.endsWith('/app')?'index.html':route.split('/').pop(),dir=file==='operations.css'?path.resolve(root,'../ui'):root;
  if(!/^[a-z-]+\.(js|css|html)$/.test(file)||!fs.existsSync(path.join(dir,file))){json({},404);return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(dir,file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright'),browser=await chromium.launch({headless:true,args:['--disable-gpu']}),page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#connections');
 await page.waitForFunction(()=>document.getElementById('computers-standing').textContent.startsWith('Your own computers'));
 // UX audit 2026-11-06: Your computers is a settings row on Connections & access; its card opens in the settings pane.
 await page.locator('#setting-rows .provider-row',{hasText:'Your computers'}).locator('.provider-open').click();await page.locator('#computers-panel').waitFor({state:'visible'});
 return {page,computers,asked,get reads(){return reads;},deny(status){denied=status;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test('what a row says and where Work on it goes are decided the same way for every computer',()=>{
 assert.equal(standing({connected:true,can_control:true}),'Connected. Jarvis can use it.');
 assert.equal(standing({connected:true,can_control:false}),'Connected. Control is off on that computer.');
 assert.equal(standing({connected:false,can_control:false}),'Not connected');
 assert.equal(workHref('11111111-1111-4111-8111-111111111111'),'/cockpit/tools/computer.html?id=11111111-1111-4111-8111-111111111111');
 assert.equal(workHref('a b'),'/cockpit/tools/computer.html?id=a%20b','an id is never pasted into the address as it came');
});
test('the person\'s computers show with their standing, and only a usable one offers Work on it, in the top window',async()=>{
 const f=await fixture();try{
  const rows=await f.page.locator('#computers-list tr').allInnerTexts();
  assert.equal(rows.length,3,rows.join(' | '));
  assert.match(rows[0],/^sat\s+Connected\. Jarvis can use it\.\s+Work on it$/);
  assert.match(rows[1],/^office-pc\s+Connected\. Control is off on that computer\.\s*$/);
  assert.match(rows[2],/^Computer 33333333\s+Not connected\s*$/);
  const work=f.page.locator('#computers-list a');
  assert.equal(await work.count(),1,'only the usable computer can be worked on');
  assert.equal(await work.getAttribute('href'),'/cockpit/tools/computer.html?id=11111111-1111-4111-8111-111111111111');
  assert.equal(await work.getAttribute('target'),'_top','the kernel page replaces the application frame, not the frame alone');
  assert.deepEqual(f.asked.filter(a=>a.includes('/api/computers')),['GET /api/computers'],'the card asks the kernel for the list and nothing else');
  await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();
  for(let i=0;i<250&&f.reads<2;i++)await new Promise(r=>setTimeout(r,20));
  await f.page.waitForFunction(()=>document.getElementById('computers-standing').textContent.startsWith('Your own computers'));
  assert.equal(f.reads,2);
 }finally{await f.close();}
});
test('a refusal clears the rows and names the way back',async()=>{
 const f=await fixture();try{
  f.deny(401);
  await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await f.page.getByText('Sign in through OSHAL to continue',{exact:false}).waitFor();
  assert.equal(await f.page.locator('#computers-list tr').count(),0,'nothing of the earlier read stays on screen');
  f.deny(403);
  await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await f.page.getByText('does not permit this operation',{exact:false}).waitFor();
 }finally{await f.close();}
});
test('no computers yet is said in words that name the next step',async()=>{
 const f=await fixture();try{
  f.computers.length=0;
  await f.page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await f.page.getByText('You have no computers connected yet',{exact:false}).waitFor();
  assert.match(await f.page.locator('#computers-standing').innerText(),/press Allow/);
 }finally{await f.close();}
});
