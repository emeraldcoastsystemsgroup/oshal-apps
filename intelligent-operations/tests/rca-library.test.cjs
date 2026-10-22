/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify historical RCA citations, exact original-ticket downloads, partial lineage, refusal and stale selection clearing in shipped UI. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {catalogue,artifactUrl}=require('../experience/rca-library.js'),{dependency}=require('./fixtures/intake.cjs');
const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',work='33333333-3333-4333-8333-333333333333';
test('catalogue uses source ticket metadata, preserves state and rejects invalid or repeated IDs',()=>{
 const rows=catalogue({tickets:[{id:one,kind:'intelligent-operations',title:'Untitled',description:'  API\nfailed ',status:'done'},{id:two,kind:'other',title:'Private elsewhere'}]});assert.equal(rows.length,1);assert.equal(rows[0].title,'API failed');assert.equal(rows[0].status,'done');
 assert.throws(()=>catalogue({}),/unavailable/);assert.throws(()=>catalogue({tickets:[{id:'bad',kind:'intelligent-operations'}]}),/identity/);assert.throws(()=>catalogue({tickets:[{id:one,kind:'intelligent-operations'},{id:one,kind:'intelligent-operations'}]}),/repeated/);
});
test('artifact links require this original ticket and an exact accepted-work selector',()=>{
 const valid='/api/v1/workspace/'+one+'/files?work='+work+'&artifact=0';assert.equal(artifactUrl(valid,one),true);
 for(const bad of [valid.replace(one,two),'//evil.example/x','javascript:alert(1)',valid+'&redirect=https://evil.example',valid.replace('&artifact=0','&artifact=-1'),'/code?folder=/workspace/'+one])assert.equal(artifactUrl(bad,one),false);
});
async function fixture(){
 const root=path.resolve(__dirname,'../experience');let denied=false,held=null,readCount=0;
 const tickets=[{id:one,kind:'intelligent-operations',title:'Database timeout',status:'done',updated_at:2},{id:two,kind:'intelligent-operations',title:'Other incident',status:'failed',updated_at:1}];
 const workBody={work:[{id:work,state:'completed',receipt:'receipt-original',phase:{name:'investigate'},bot:'specialist',answer:'Recorded finding <img src=x onerror=bad()>',input:{complete:false,inputDigest:'input-sha',files:[{path:'evidence/packet.json',sha256:'original-sha',byteLength:12}]}}]};
 const files={success:true,unavailableRuns:[],files:[{name:'answer.md',size:42,digest:Array(32).fill(7),downloadUrl:'/api/v1/workspace/'+one+'/files?work='+work+'&artifact=0',phase:{name:'investigate'}}]};
 const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://fixture').pathname;res.setHeader('Cache-Control','no-store');
  if(route==='/api/tickets'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tickets}));return;}
  if(route.startsWith('/tickets/')||route.startsWith('/api/v1/workspace/')){
   readCount++;res.setHeader('Content-Type','application/json');if(denied){res.writeHead(403);res.end('{}');return;}
   if(held&&route==='/tickets/'+one+'/work'){const fn=held;held=null;fn(()=>res.end(JSON.stringify(workBody)));return;}
   res.end(JSON.stringify(route.endsWith('/work')?workBody:files));return;
  }
  if(route==='/api/intelligent-operations/records'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sources:[],events:[],inventory:[]}));return;}
  const file=route==='/api/intelligent-operations/app'?'index.html':path.basename(route);
  const dir=file==='operations.css'?path.resolve(root,'../ui'):root;
  if(!fs.existsSync(path.join(dir,file))){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(dir,file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright'),browser=await chromium.launch({headless:true,args:['--disable-gpu']}),page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#library');await page.locator('.rca-catalogue-row').first().waitFor();
 return {page,deny(){denied=true;},hold(fn){held=fn;},get reads(){return readCount;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test('real library shows original receipts, safe report text, lineage gaps and artifact citations on phone and desktop',async()=>{
 const f=await fixture();try{await f.page.getByRole('button',{name:/Database timeout/}).click();const detail=f.page.locator('#rca-detail');await detail.getByText('Accepted report artifacts',{exact:true}).waitFor();
  await detail.getByText('investigate · specialist',{exact:true}).click();const value=await detail.innerText();for(const expected of ['receipt-original','input-sha','original-sha','Complete input lineage is unavailable','recovery','answer.md'])assert.ok(value.includes(expected),expected);assert.equal(await detail.locator('img').count(),0);
  assert.equal(await detail.getByRole('link',{name:'Open original ticket'}).getAttribute('href'),'/cockpit/?app=intelligent-operations&ticket='+one);
  for(const width of [390,768,1440]){await f.page.setViewportSize({width,height:1000});assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fits '+width);}
  f.deny();await f.page.getByRole('button',{name:/Other incident/}).click();await f.page.getByText('Access changed.',{exact:false}).waitFor();assert.equal(await f.page.locator('#rca-list').innerText(),'');assert.equal(await detail.innerText(),'');
 }finally{await f.close();}
});
test('a late historical result cannot overwrite a newer selection or restore data after refusal',async()=>{
 const f=await fixture();let release;try{f.hold(fn=>{release=fn;});await f.page.getByRole('button',{name:/Database timeout/}).click();await f.page.getByRole('button',{name:/Other incident/}).click();await f.page.locator('#rca-detail h2').getByText('Other incident',{exact:true}).waitFor();assert.ok(release);release();release=null;await f.page.waitForTimeout(30);assert.equal(await f.page.locator('#rca-detail h2').innerText(),'Other incident');
  f.deny();await f.page.getByRole('button',{name:/Database timeout/}).click();await f.page.getByText('Access changed.',{exact:false}).waitFor();assert.equal(await f.page.locator('#rca-detail').innerText(),'');
 }finally{release?.();await f.close();}
});
