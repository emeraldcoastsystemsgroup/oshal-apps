/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Actual themed iframe controls on desktop and phone: explicit paper reset, independent account creation and native report presentation.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),req=createRequire(path.resolve(__dirname,'../../scripts/toolchain/package.json'));
const express=req('express'),{chromium}=req('playwright');
const {composeReport}=require('../routes/paper/report');
test('local paper accounts and the report work in the actual desktop and phone iframe',async t=>{
 const app=express();app.use(express.json());const writes=[];let presenter='Test presenter',presenterVideoUrl=null;
 app.get('/api/trading/paper',(_q,r)=>r.json({account:{cash:90000,equity:90000,startingCash:100000},config:{armed:false},ticks:[]}));
 app.get('/api/trading/paper/books',(_q,r)=>r.json({accounts:[]}));
 app.post('/api/trading/paper/books',(q,r)=>{writes.push({action:'create',body:q.body});r.json({ok:true});});
 app.post('/api/trading/paper/reset',(q,r)=>{writes.push({action:'reset',body:q.body});r.json({ok:true});});
 app.get('/api/v1/agent/schedules',(_q,r)=>r.json({schedules:[{id:'paper',app:'intelligent-trades',name:'paper-autopilot',activation:{},status:'active'},{id:'report',app:'intelligent-trades',name:'oshal-daily-report',activation:{},status:'active'}]}));
 app.get('/api/trading/paper/reports',(_q,r)=>r.json({reports:[]}));
 app.post('/api/trading/paper/presenter',(q,r)=>{presenter=q.body.presenterName;presenterVideoUrl=q.body.presenterVideoUrl;r.json({ok:true});});
 app.post('/api/trading/paper/reports',(_q,r)=>r.json({report:composeReport({now:new Date('2026-10-27T21:00:00Z'),presenter,presenterVideoUrl,paper:[],live:['Cash account','Margin account','Retirement account'].map((label,i)=>({label,equity:10000,cash:2000,authority:'off',protectionAuthority:'off',activity:require('../routes/paper/report-activity').brokerActivity({source:'schwab',historyWindowDays:60,readAtMs:1793134800000,orders:[{orderId:'synthetic-'+i,status:i===1?'WORKING':'FILLED',filledQuantity:2,remainingQuantity:i===1?1:0,legs:[{symbol:'SPY',instruction:'BUY'}],executions:[{quantity:2,price:100+i,time:'2026-10-27T14:00:00Z'}]}]},new Date('2026-10-27T21:00:00Z'))})),errors:[]})}));
 const styles=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 app.get('/controls.js',(_q,r)=>r.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/native-paper-books.js'),'utf8')));
 app.get('/paper-controls.js',(_q,r)=>r.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/native-paper.js'),'utf8')));
 app.get('/boot.js',(_q,r)=>r.type('js').send(`const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v),spinner=esc,jbody=(method,b)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),b=await r.json();if(!r.ok)throw Error(b.message||b.error);return b;};
 document.getElementById('paper').onclick=()=>renderLocalPaperAccounts();document.getElementById('report').onclick=()=>renderOshalReport();renderLocalPaperAccounts();`));
 app.get('/inner',(_q,r)=>r.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><button id="paper">Paper accounts</button><button id="report">OSHAL report</button><div id="tabbody" data-gen="1"></div><script src="/paper-controls.js"></script><script src="/controls.js"></script><script src="/boot.js"></script>'));
 app.get('/frame',(_q,r)=>r.send('<!doctype html><meta name="viewport" content="width=device-width"><iframe title="Trading" src="/inner" style="border:0;width:100%;height:1500px"></iframe>'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};window.testVoices=[{localService:false,lang:'en-US'}];window.testSpoken=[];Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>window.testVoices,cancel(){},speak:u=>window.testSpoken.push({text:u.text,local:u.voice.localService})}});});
  await page.goto('http://127.0.0.1:'+server.address().port+'/frame');const frame=page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'Local paper accounts',exact:true}).waitFor();
  await frame.getByLabel('Account label').fill('Synthetic local account');await frame.getByRole('button',{name:'Create local paper account',exact:true}).click();
  await frame.getByRole('heading',{name:'Local paper accounts',exact:true}).waitFor();assert.equal(writes.at(-1).body.startingCash,100000);assert.equal(writes.at(-1).body.label,'Synthetic local account');
  const count=writes.length;await frame.getByRole('button',{name:'Archive reference & restart with this cash',exact:true}).click();await frame.getByRole('button',{name:'Cancel paper restart',exact:true}).click();assert.equal(writes.length,count);
  await frame.getByRole('button',{name:'Archive reference & restart with this cash',exact:true}).click();await frame.getByLabel('Starting cash $').fill('200000');await frame.getByRole('button',{name:'Confirm paper restart',exact:true}).click();await frame.getByRole('heading',{name:'Local paper accounts',exact:true}).waitFor();assert.equal(writes.at(-1).action,'reset');assert.equal(writes.at(-1).body.startingCash,100000,'execute the exact reviewed cash value');
  await frame.getByRole('button',{name:'OSHAL report',exact:true}).click();await frame.getByLabel('Presenter name').fill('Synthetic presenter');await frame.getByText('Presenter visual',{exact:true}).click();await frame.getByLabel('Private clip link').fill('/api/video/editor/media/11111111-2222-3333-4444-555555555555');await frame.getByRole('button',{name:'Refresh report now',exact:true}).click();
  await frame.getByRole('heading',{name:'The OSHAL report',exact:true}).waitFor();assert.match(await frame.locator('#orContent').innerText(),/Synthetic presenter/);assert.equal(await frame.locator('#orPresenterVideo').getAttribute('muted'),'');assert.match(await frame.locator('#orPresenterVideo').getAttribute('src'),/^\/api\/video\/editor\/media\//);
  await frame.getByRole('button',{name:'Next →',exact:true}).click();assert.match(await frame.locator('#orSlide').innerText(),/All real-account trades/);assert.equal(await frame.getByRole('heading',{name:'All real-account trades today',exact:true}).count(),3);assert.match(await frame.locator('#orContent').innerText(),/partial fill · WORKING/);assert.deepEqual(errors,[]);
  await frame.getByRole('button',{name:'Play briefing',exact:true}).click();assert.match(await frame.locator('#orMsg').innerText(),/No local narration voice/);
  const inner=page.frames().find(f=>f.url().endsWith('/inner'));assert.equal(await inner.evaluate(()=>window.testSpoken.length),0);
  await inner.evaluate(()=>{window.testVoices=[{localService:true,lang:'en-US'}];});
  // Use a plain synthetic utterance so browser-native voice object validation is not involved.
  await inner.evaluate(()=>{window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});
  await frame.getByRole('button',{name:'Play briefing',exact:true}).click();assert.equal(await inner.evaluate(()=>window.testSpoken.length),1);assert.equal(await inner.evaluate(()=>window.testSpoken[0].local),true);
  await context.close();
 }
});
