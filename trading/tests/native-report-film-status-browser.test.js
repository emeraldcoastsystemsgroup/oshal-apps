/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.51.1: the film panel's status line in a real browser. Found by pressing Film in Chrome on the live installation: the panel redrew after every pass and replaced the line, so the person saw nothing, not the countdown and not the refusal.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),req=createRequire(path.resolve(__dirname,'../../scripts/toolchain/package.json'));
const express=req('express'),{chromium}=req('playwright');
const video=(account,status,detail)=>({session:'2026-11-03',file:account+'.mp4',account,status,detail,url:null});

/** The real panel code in a browser against a tick whose answers and timing the test controls. */
async function panel(t,answers){
 const app=express();app.use(express.json());const ticks=[];let listed=[],release=null;
 app.get('/api/trading/paper/reports',(_q,r)=>r.json({reports:[]}));
 app.get('/api/trading/paper/reports/videos',(_q,r)=>r.json({ok:true,presenter:{present:false},videos:listed}));
 app.post('/api/trading/paper/reports/videos/tick',async(q,r)=>{
  ticks.push(q.body);const out=answers[ticks.length-1];
  await new Promise(done=>{release=done;});
  listed=out.videos||listed;r.json({ok:true,session:'2026-11-03',...out});
 });
 app.get('/controls.js',(_q,r)=>r.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/native-paper-books.js'),'utf8')));
 app.get('/boot.js',(_q,r)=>r.type('js').send(`const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const spinner=esc,jbody=(method,b)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),b=await r.json();if(!r.ok)throw Error(b.message||b.error);return b;};renderOshalReport();`));
 app.get('/',(_q,r)=>r.send('<!doctype html><div id="tabbody" data-gen="1"></div><script src="/controls.js"></script><script src="/boot.js"></script>'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const browser=await chromium.launch();t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.getByRole('button',{name:"Film today's report",exact:true}).waitFor();
 const status=page.locator('#orVideoMsg');
 /** Answer the pass the page is waiting on. */
 const finishPass=async count=>{await waitFor(()=>ticks.length===count);release();};
 return {page,status,ticks,errors,finishPass};
}
async function waitFor(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw new Error('The page did not start the next pass');await new Promise(r=>setTimeout(r,20));}}

test('Film counts the accounts down, says when they are ready and runs one loop at a time',async t=>{
 const {page,status,ticks,errors,finishPass}=await panel(t,[
  {done:false,videos:[video('a','ready'),video('b','pending'),video('c','pending')]},
  {done:false,videos:[video('a','ready'),video('b','ready'),video('c','pending')]},
  {done:true,videos:[video('a','ready'),video('b','ready'),video('c','ready')]},
 ]);
 const film=page.getByRole('button',{name:"Film today's report",exact:true}),again=page.getByRole('button',{name:'Film again',exact:true});
 await film.click();
 await page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='Filming the first account…');
 await waitFor(()=>ticks.length===1);
 assert.equal(await film.isDisabled(),true,'Film reads disabled while a loop runs');
 assert.equal(await again.isDisabled(),true,'Film again reads disabled while a loop runs');
 await finishPass(1);
 await page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='Filming… 2 accounts to go.');
 await finishPass(2);
 await page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='Filming… 1 account to go.');
 await finishPass(3);
 await page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='Films for 2026-11-03 are ready below.');
 assert.equal(await film.isDisabled(),false,'Film is pressable again when the loop ends');
 assert.equal(ticks.length,3);assert.deepEqual(errors,[]);
 assert.equal(await status.getAttribute('role'),'status');
});

test('A press with nothing to film says why, and a failed account is not called ready',async t=>{
 const refused=await panel(t,[{waiting:'report',videos:[],message:'No saved OSHAL report yet.'}]);
 await refused.page.getByRole('button',{name:"Film today's report",exact:true}).click();
 await refused.finishPass(1);
 await refused.page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='No saved OSHAL report yet.');
 const failing=await panel(t,[{done:true,videos:[video('a','ready'),video('b','failed','narration failed')]}]);
 await failing.page.getByRole('button',{name:"Film today's report",exact:true}).click();
 await failing.finishPass(1);
 await failing.page.waitForFunction(()=>document.getElementById('orVideoMsg')?.textContent==='1 of 2 could not be filmed; the reason is on each one below.');
 assert.match(await failing.page.locator('#orVideoList').innerText(),/Could not film: narration failed/);
});

test('Film again asks for a fresh start only on its first pass',async t=>{
 const {page,ticks,finishPass}=await panel(t,[{done:false,videos:[video('a','ready'),video('b','pending')]},{done:true,videos:[video('a','ready'),video('b','ready')]}]);
 await page.getByRole('button',{name:'Film again',exact:true}).click();
 await finishPass(1);await finishPass(2);
 await page.waitForFunction(()=>/ready below/.test(document.getElementById('orVideoMsg')?.textContent||''));
 assert.deepEqual(ticks,[{force:true},{}]);
});
