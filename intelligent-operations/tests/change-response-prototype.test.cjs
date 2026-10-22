/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise all proposed response paths, local approval preview, health outcomes and lower-verified promotion with no service calls. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {dependency}=require('./fixtures/intake.cjs');
test('response design separates emergency changes, durable fixes and evidence-based recovery',async()=>{
 const root=path.resolve(__dirname,'../prototype/change-response'),requests=[];
 const server=http.createServer((req,res)=>{requests.push([req.method,req.url]);const file=path.basename(req.url.split('?')[0])||'index.html';if(!['index.html','design.css','design.js'].includes(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,file)));});
 let browser;try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright');browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port;await page.goto(base+'/index.html');
  for(const [value,text] of [['paired','Mitigation + permanent fix'],['standard','Lower-environment fix + standard promotion'],['patch','Emergency runtime patch'],['hotfix','Expedited Git-backed production hotfix']]){
   await page.goto(base+'/index.html#response');await page.locator('input[value="'+value+'"]').check();await page.getByRole('button',{name:'Review this response'}).click();await page.locator('#review').waitFor({state:'visible'});assert.equal(await page.locator('#review-title').innerText(),text);
   assert.equal(await page.locator('#simulate-approval').isDisabled(),true);await page.locator('#reviewed').check();await page.locator('#simulate-approval').click();await page.locator('#'+(value==='standard'?'permanent':'watch')).waitFor({state:'visible'});
  }
  await page.goto(base+'/index.html#watch');
  for(const [value,text] of [['healthy','Mitigation verified'],['regression','Recovery failed'],['missing','Verification inconclusive'],['observing','Keep watching']]){await page.locator('#outcome').selectOption(value);assert.match(await page.locator('#watch-decision').innerText(),new RegExp(text));}
  await page.locator('#outcome').selectOption('missing');assert.equal(await page.locator('#replica-indicators').isVisible(),false);assert.match(await page.locator('#probe-status').innerText(),/unknown/);
  await page.goto(base+'/index.html#permanent');await page.locator('#promotion-review').click();await page.locator('#review').waitFor({state:'visible'});assert.match(await page.locator('#review-title').innerText(),/lower-verified/);assert.match(await page.locator('#change-diff').innerText(),/lower verification: passed/);assert.doesNotMatch(await page.locator('#change-diff').innerText(),/waived/);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});for(const id of ['response','review','watch','permanent']){await page.goto(base+'/index.html#'+id);await page.locator('#'+id).waitFor({state:'visible'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),id+' fits '+width);}}
  assert.deepEqual(errors,[]);assert.ok(requests.every(([method,url])=>method==='GET'&&!/api\/|connectors/.test(url)),'preview never contacts live services');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
