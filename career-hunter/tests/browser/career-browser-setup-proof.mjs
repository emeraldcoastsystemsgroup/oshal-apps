/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the actual worker setup dialog creates no authority until its person clicks, uses the native original-owner join/binding ports and downloads only a private dedicated-worker configuration.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import http from 'node:http';
const require=createRequire(import.meta.url),deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json')),{chromium}=deps('playwright');
const script=readFileSync(new URL('../../tools/career-submit.js',import.meta.url),'utf8');
test('connecting a worker requires the explicit setup action and binds only the Career browser bot',async t=>{
  const calls=[],owner='a1000000-0000-0000-0000-000000000001',tenant='b1000000-0000-0000-0000-000000000001',node='c1000000-0000-0000-0000-000000000001';
  const server=http.createServer(async(req,res)=>{
    if(req.method==='POST'){
      let bytes='';for await(const chunk of req)bytes+=chunk;calls.push({path:req.url,body:JSON.parse(bytes)});res.setHeader('content-type','application/json');
      res.end(JSON.stringify(req.url==='/nodes/join-codes'?{code:'synthetic-one-use-code'}:req.url==='/nodes/join'?{node:{id:node,owner,tenant},token:'synthetic-device-token-private-0001'}:{bound:true}));return;
    }
    if(req.url==='/submit.js'){res.setHeader('content-type','text/javascript');res.end(script);return;}
    res.setHeader('content-type','text/html');res.end('<script src="/submit.js"></script><button onclick="CareerSubmit.connectWorker()">Connect browser worker</button>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true});
  const dir=mkdtempSync(join(tmpdir(),'career-worker-setup-'));t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Connect browser worker',exact:true}).click();assert.equal(calls.length,0);
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.length,0);
  await page.getByRole('button',{name:'Connect browser worker',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Create and connect worker',exact:true}).click();
  const file=await download;await file.saveAs(join(dir,'worker.json'));const config=JSON.parse(readFileSync(join(dir,'worker.json'),'utf8'));
  assert.equal(config.owner,owner);assert.equal(config.tenant,tenant);assert.equal(config.nodeId,node);assert.equal(config.botId,'cb000000-0000-0000-0000-000000000004');
  assert.equal(config.deviceToken,'synthetic-device-token-private-0001');assert.equal(calls.length,3);
  assert.deepEqual(calls[0],{path:'/nodes/join-codes',body:{capabilities:[],lifetime_ms:300000}});
  assert.deepEqual(calls[1].body.harness,{custom:'browser-form-v1'});assert.deepEqual(calls[1].body.capabilities,{browse:true});
  assert.equal(calls[2].path,'/nodes/'+node+'/bots/'+config.botId);
  assert.match(await page.getByRole('dialog').innerText(),/Install the downloaded private configuration/);
});
