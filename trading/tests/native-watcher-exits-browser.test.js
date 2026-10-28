/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Compact watcher activation retains visible financial limits and expandable exact execution evidence.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual framed watcher review and its cancelled financial confirmation on desktop and phone.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const {protectionFixture}=require('./support/native-protection-host');
const {binding}=require('./support/native-management-host');
test('watcher exit review names client-managed triggers, extended-session limits and its exact confirmation',async t=>{
 const h=await protectionFixture(t,{watcher:true});await h.enroll();await h.study();
 const styles=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 h.app.get('/account-controls.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/native-account-controls.js'),'utf8')));
 h.app.get('/controls.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/native-protection-controls.js'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(`const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v),accountValue=v=>v==null?'Unknown':money(v),accountPercent=v=>v==null?'Unknown':Number(v).toFixed(2)+'%',sameNativeAccount=(a,b)=>a.accountId===b.accountId&&a.connectionKey===b.connectionKey;
 const jbody=(method,b)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),stale=()=>false,loadNativeAccountManagement=async()=>{};
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),b=await r.json();if(!r.ok)throw Error(b.message||b.error);return b;};
 (async()=>{const data=await api('/portfolio/backstops'),account={...${JSON.stringify(binding)},label:'Synthetic watcher account'},policy=data.policies[0],root=document.getElementById('root');root.innerHTML=nativeBrokerProtectionPanel(account,policy,data);const host=root.firstElementChild;
 host.onclick=e=>{const b=e.target.closest('[data-native-management]');if(b)nativeBrokerProtectionAction(b.dataset.nativeManagement,b,host,{account,policy,token:1}).catch(e=>{document.getElementById('error').textContent=e.message;});};})();`));
 h.app.get('/inner',(_req,res)=>res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><div id="root"></div><p id="error"></p><script src="/account-controls.js"></script><script src="/controls.js"></script><script src="/boot.js"></script>'));
 h.app.get('/frame',(_req,res)=>res.send('<!doctype html><meta name="viewport" content="width=device-width"><iframe title="Trading" src="/inner" style="border:0;width:100%;height:1100px"></iframe>'));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.base+'/frame');const frame=page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'Watcher exits',exact:true}).waitFor();
  assert.equal(await frame.getByRole('combobox',{name:'Execution',exact:true}).inputValue(),'watcher');
  await frame.getByRole('button',{name:'Review watcher exits',exact:true}).click();
  await frame.getByRole('heading',{name:'Review watcher exits · Synthetic watcher account',exact:true}).waitFor();
  const review=frame.locator('[data-native-protection-review]');assert.match(await review.innerText(),/every minute/);assert.match(await review.innerText(),/partial fills and repricing/);
  assert.match(await review.innerText(),/Maximum per ticket[\s\S]*\$50,000/);assert.match(await review.innerText(),/30 days/);
  assert.equal(await review.locator('details').evaluate(el=>el.open),false);await review.locator('summary').click();assert.match(await review.innerText(),/30-second quote age/);assert.match(await review.innerText(),/Existing observed peaks and floors are retained/);await review.locator('summary').click();
  const activation=frame.getByRole('button',{name:'Activate watcher exits',exact:true});assert.equal(await activation.isEnabled(),true);
  let message='';page.once('dialog',async d=>{message=d.message();await d.dismiss();});await activation.click();
  assert.match(message,/OSHAL will submit sell-only seamless DAY limit exits/);assert.equal(h.policy().status,'draft');assert.equal(h.effects.length,0);assert.deepEqual(errors,[]);
  await context.close();
 }
});
