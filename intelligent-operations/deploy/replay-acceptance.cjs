/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the installed Scenario lab through actual password login and record a credential-free native replay receipt. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),config=JSON.parse(fs.readFileSync(path.join(state,'installation.json')));
assert.equal(config.context,'kind-operations-lab');assert.equal(config.namespace,'oshal-install-lab');assert.equal(config.port,38081);
const credentialFile=path.join(state,'admin-password.json'),stat=fs.lstatSync(credentialFile);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0);
const credentials=JSON.parse(fs.readFileSync(credentialFile)),base='http://127.0.0.1:'+config.port;
const receipt={startedAt:new Date().toISOString(),kind:'native-installed-replay',synthetic:true,passed:false,checks:[]};
let browser,timer;
(async()=>{
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/login?next=/admin');await page.locator('#loginUsername').fill(credentials.username);await page.locator('#loginSecret').fill(credentials.password);await page.locator('#loginPassword button').click();await page.waitForURL(url=>url.pathname==='/admin');receipt.checks.push('actual HTML password login');
 const preview=await page.evaluate(async()=>{const response=await fetch('/api/swarm/registries/oshal-public/native-preview/intelligent-operations');if(!response.ok)throw Error('Source preview unavailable');return response.json();});receipt.application={revision:preview.reference,artifact:preview.artifact};
 await page.goto(base+'/api/intelligent-operations/app#replay');await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).click();
 let previous='';timer=setInterval(async()=>{try{const status=await page.locator('#replay-progress').innerText();if(status!==previous){previous=status;console.log(status);}}catch{}},5000);
 await page.waitForFunction(()=>/Replay verified\.|Partial records remain/.test(document.getElementById('replay-progress').textContent),{},{timeout:240000});
 clearInterval(timer);timer=null;const status=await page.locator('#replay-progress').innerText();assert.match(status,/Replay verified\./,status);
 const details=page.locator('#replay-results details');assert.equal(await details.count(),5);assert.equal(await page.locator('.replay-groups article').count(),2);assert.equal(await page.locator('.dependency-node').count(),4);
 const run=JSON.parse(await details.last().locator('pre').textContent());assert.deepEqual(run.actual,run.expected);assert.equal(run.correlation.status,'complete');assert.deepEqual(run.correlation.groups.map(g=>g.length).sort(),[1,3]);
 receipt.result=run;receipt.packetChecks=[];
 for(let i=0;i<4;i++){const packet=JSON.parse(await details.nth(i).locator('pre').textContent());assert.equal(packet.observations.length,1);assert.equal(packet.executionAuthorized,false);assert.equal(packet.rawStreamAccess,false);receipt.packetChecks.push({id:packet.id,sha256:packet.sha256,observations:packet.observations.length});}
 receipt.checks.push('actual native OTLP/CloudWatch admission, percolation, reduction, dependency correlation and persistent context');
 await page.screenshot({path:path.join(state,'triagenorth-replay-desktop.png'),fullPage:true});await page.locator('#replay-results').screenshot({path:path.join(state,'triagenorth-replay-results.png')});
 const saved=await page.evaluate(async()=>{const response=await fetch('/api/intelligent-operations/replays');if(!response.ok)throw Error('Replay read unavailable');return response.json();});assert.equal(saved.runs[0].passed,true);receipt.savedReplay={id:saved.runs[0].id,sha256:saved.runs[0].sha256};
 await page.reload();await page.getByText('Saved replay ·',{exact:false}).waitFor();assert.equal(await page.locator('.dependency-node').count(),4);receipt.checks.push('saved native replay survives a fresh page without rerunning events');
 await page.getByRole('link',{name:'Live context',exact:true}).click();await page.locator('#telemetry-banks meter').first().waitFor();assert.ok(await page.locator('#telemetry-banks meter').count()>=6);await page.screenshot({path:path.join(state,'triagenorth-context-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(state,'triagenorth-context-phone.png'),fullPage:true});assert.deepEqual(errors,[]);receipt.checks.push('native desktop/phone context views without page errors or horizontal overflow');receipt.passed=true;
})().catch(error=>{receipt.error=error.message;console.error(error.message);process.exitCode=1;}).finally(async()=>{if(timer)clearInterval(timer);if(browser)await browser.close();receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(state,'telemetry-native-acceptance.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks,actual:receipt.result?.actual}));});
