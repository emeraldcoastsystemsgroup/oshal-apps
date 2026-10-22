/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Serve shipped Operations assets with explicit ticket fixtures and verify real browser UX without production calls. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {createRequire}=require('node:module');
const runtime=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(__dirname,'../../scripts/toolchain'),'package.json'));
const {chromium}=runtime('playwright');const root=path.resolve(__dirname,'../ui');
test('desktop and phone workspace uses real shipped files, accurate ticket states and local-only format previews',async()=>{
  const requests=[],assets=new Set(['index.html','operations.css','operations.js','operations-model.js','source-contract.js','adapter-mapping.js']);
  let held, onHeld;
  let reply={status:200,body:{tickets:[{id:'a',kind:'intelligent-operations',title:'API <script>bad()</script>',status:'done',updated_at:1000},{id:'b',kind:'intelligent-operations',title:'API <script>bad()</script>',status:'awaiting_approval',updated_at:2000},{id:'x',kind:'other',title:'Do not show',status:'running'}]}};
  const server=http.createServer((req,res)=>{
    requests.push([req.method,req.url]);
    if(req.url==='/api/tickets'){
      if(reply.hold){held={res,body:reply.body};onHeld();return;}
      res.writeHead(reply.status,{'Content-Type':'application/json'});res.end(JSON.stringify(reply.body));return;
    }
    const file=path.basename(req.url.split('?')[0]);
    if(assets.has(file)){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));return;}
    if(req.url.startsWith('/shared/ui/')){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':'text/css'});res.end('');return;}
    res.writeHead(404);res.end();
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(()=>document.getElementById('total').textContent==='2');
    await page.getByRole('link',{name:'Incident tickets',exact:true}).click();
    assert.equal(await page.locator('tbody tr').count(),2);assert.equal(await page.getByText('Workflow finished',{exact:true}).count(),1);
    assert.equal(await page.getByText('Do not show',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>typeof window.bad),'undefined');
    await page.getByLabel('Show',{exact:true}).selectOption('attention');assert.equal(await page.locator('tbody tr').count(),1);
    await page.getByRole('link',{name:'Source preview',exact:true}).click();await page.getByRole('button',{name:'Load a labeled example'}).click();
    const reads=requests.filter(r=>r[1]==='/api/tickets').length;
    await page.getByRole('button',{name:'Check format'}).click();await page.getByText('Format matches Operations alert v1.',{exact:true}).waitFor();
    assert.equal(requests.filter(r=>r[1]==='/api/tickets').length,reads);
    await page.getByLabel('Expected source URI',{exact:false}).fill('urn:operations:source:another');await page.getByRole('button',{name:'Check format'}).click();
    await page.getByText('source: The payload source must exactly match the expected source.',{exact:true}).waitFor();
    await page.getByLabel('Expected source URI',{exact:false}).fill('urn:operations:source:local-lab');
    const adapterSample=require('../ui/source-contract.js').example();adapterSample.data.labels={'native/id':'adapted-pod-uid'};delete adapterSample.data.resource.id;
    await page.getByLabel('JSON alert',{exact:false}).fill(JSON.stringify(adapterSample));
    await page.getByText('Adapter field mappings · local draft',{exact:true}).click();
    await page.getByLabel('Native resource ID path',{exact:true}).fill('/data/labels/native~1id');
    await page.getByRole('button',{name:'Check format'}).click();await page.getByText('Normalized alert preview',{exact:true}).waitFor();
    assert.match(await page.locator('#preview-result').textContent(),/adapted-pod-uid/);
    await page.getByLabel('Native resource ID path',{exact:true}).fill('/data/missing');assert.match(await page.locator('#preview-result').textContent(),/Mapping draft changed/);
    await page.getByRole('button',{name:'Check format'}).click();assert.match(await page.locator('#preview-result').textContent(),/mapped field is missing/);
    assert.equal(await page.getByText('Normalized alert preview',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Reset to standard field paths'}).click();
    assert.equal(await page.getByLabel('Native resource ID path',{exact:true}).inputValue(),'/data/resource/id');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('link',{name:'Incident tickets',exact:true}).click();reply={status:403,body:{detail:'sensitive internal message'}};
    await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await page.waitForFunction(()=>document.getElementById('total').textContent==='Unavailable');
    assert.equal(await page.locator('tbody tr').count(),0);assert.equal(await page.getByText('API <script>bad()</script>',{exact:true}).count(),0);
    assert.equal(await page.getByText('sensitive internal message',{exact:false}).count(),0);
    reply={status:200,body:{}};await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await page.waitForFunction(()=>document.getElementById('read-status').textContent.includes('response was unavailable'));
    assert.equal(await page.locator('#total').textContent(),'Unavailable');
    reply={status:200,body:{tickets:[]}};await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await page.waitForFunction(()=>document.getElementById('total').textContent==='0');
    const ready=new Promise(resolve=>{onHeld=resolve;});
    reply={hold:true,body:{tickets:[{id:'late',kind:'intelligent-operations',title:'Late private fixture',status:'running'}]}};
    await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await ready;
    reply={status:403,body:{}};await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await page.waitForFunction(()=>document.getElementById('total').textContent==='Unavailable');
    held.res.writeHead(200,{'Content-Type':'application/json'});held.res.end(JSON.stringify(held.body));
    await page.waitForTimeout(100);assert.equal(await page.getByText('Late private fixture',{exact:true}).count(),0);assert.equal(await page.locator('#total').textContent(),'Unavailable');
    reply={status:200,body:{tickets:[]}};await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();await page.waitForFunction(()=>document.getElementById('total').textContent==='0');
    assert.equal(requests.some(([method])=>method!=='GET'),false);assert.deepEqual(errors,[]);
    const shot=process.env.OPERATIONS_BROWSER_SCREENSHOT;if(shot){await page.getByRole('link',{name:'Overview',exact:true}).click();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:shot,fullPage:true});}
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('synthetic UX journey keeps identity failures explicit, invalidates changed approvals and downloads the actual displayed bundle',async()=>{
  const packageRoot=path.resolve(__dirname,'..'),requests=[];
  const files=new Set(['/prototype/index.html','/prototype/prototype.css','/prototype/prototype.js','/prototype/connections.js','/prototype/data-model.js','/ui/source-contract.js','/ui/operations.css']);
  const server=http.createServer((req,res)=>{
    requests.push([req.method,req.url]);
    if(!files.has(req.url)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(path.join(packageRoot,req.url)));
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/prototype/index.html`);
    await page.getByText('UX PROTOTYPE · SYNTHETIC DATA',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Simulate enrichment retry'}).click();await page.getByText('Complete for requested collectors · demo',{exact:true}).waitFor();
    await page.getByRole('link',{name:'Estate',exact:true}).click();await page.getByLabel('Snapshot view',{exact:true}).selectOption('current');
    await page.getByText('Ready · later fixture snapshot',{exact:true}).waitFor();await page.locator('[data-resource=worker]').click();
    await page.getByText('Inventory presence alone does not establish health.',{exact:false}).waitFor();
    await page.getByLabel('Estate scope',{exact:true}).selectOption('aws');
    await page.getByLabel('Layer',{exact:true}).selectOption('network');assert.equal(await page.locator('#estate-graph button').count(),2);assert.match(await page.locator('#estate-edges').textContent(),/Contained in/);
    await page.getByLabel('Observed health',{exact:true}).selectOption('problem');assert.equal(await page.locator('#estate-graph button').count(),0);assert.match(await page.locator('#estate-edges').textContent(),/No relationships/);
    await page.getByLabel('Scan interval · minutes',{exact:true}).fill('0');await page.getByRole('button',{name:'Preview discovery schedule'}).click();assert.match(await page.locator('#scan-result').textContent(),/Choose a whole interval/);
    await page.getByLabel('Scan interval · minutes',{exact:true}).fill('2');await page.getByRole('button',{name:'Preview discovery schedule'}).click();assert.match(await page.locator('#scan-result').textContent(),/no schedule saved/);
    await page.getByLabel('Layer',{exact:true}).selectOption('all');await page.getByLabel('Observed health',{exact:true}).selectOption('all');
    await page.getByRole('link',{name:'Connections & CLI',exact:true}).click();
    await page.getByLabel('Named connection',{exact:true}).selectOption('gcp');assert.match(await page.locator('#login-caveat').textContent(),/Application Default Credentials are distinct/);
    await page.getByLabel('Identity use',{exact:true}).selectOption('workload');assert.match(await page.locator('#login-method').textContent(),/workload identity federation/);
    await page.getByLabel('Simulated connection role',{exact:true}).selectOption('viewer');assert.equal(await page.locator('#demo-login').isDisabled(),true);
    await page.getByLabel('Simulated connection role',{exact:true}).selectOption('admin');
    await page.getByLabel('Tool availability · fixture',{exact:true}).selectOption('missing');assert.equal(await page.locator('#demo-login').isDisabled(),true);
    await page.getByLabel('Tool availability · fixture',{exact:true}).selectOption('available');
    for(const outcome of ['wrong','expired','valid']){
      await page.getByLabel('Identity probe outcome · fixture',{exact:true}).selectOption(outcome);await page.getByRole('button',{name:'Simulate secure sign-in',exact:true}).click();
      assert.equal(await page.locator('#probe-inventory').isDisabled(),true);await page.getByRole('button',{name:'Simulate identity probe',exact:true}).click();
      assert.equal(await page.locator('#probe-inventory').isDisabled(),outcome!=='valid');
    }
    await page.getByRole('button',{name:'Simulate inventory read',exact:true}).click();await page.getByRole('button',{name:'Simulate evidence read',exact:true}).click();
    assert.match(await page.locator('#inventory-probe').textContent(),/Allowed/);assert.match(await page.locator('#evidence-probe').textContent(),/Denied/);assert.match(await page.locator('#auth-probe').textContent(),/Expected identity/);
    await page.getByRole('button',{name:'Revoke demo session',exact:true}).click();assert.equal(await page.locator('#probe-inventory').isDisabled(),true);
    await page.getByLabel('Named connection',{exact:true}).selectOption('aws');assert.match(await page.locator('#auth-probe').textContent(),/Not tested/);
    await page.getByRole('link',{name:'Sources & access',exact:true}).click();await page.getByLabel('Sample identity outcome').selectOption('many');
    await page.getByRole('button',{name:'Preview mapping',exact:true}).click();assert.match(await page.locator('#mapping-result').textContent(),/ambiguous identity/);
    await page.getByLabel('Inbound standard').selectOption({label:'OTLP · telemetry (planned)'});await page.getByRole('button',{name:'Preview mapping',exact:true}).click();assert.match(await page.locator('#mapping-result').textContent(),/OTLP is planned/);
    await page.getByRole('link',{name:'Data & decisions',exact:true}).focus();await page.keyboard.press('Enter');assert.match(await page.locator('#data-summary').textContent(),/3 eligible incidents · 1 symptom updates · 1 delivery retries/);
    await page.getByRole('button',{name:'Inspect demo-receipt-2',exact:true}).click();assert.match(await page.locator('#decision-reason').textContent(),/already received/);
    await page.getByLabel('Minimum severity',{exact:true}).selectOption('critical');assert.match(await page.locator('#data-summary').textContent(),/1 eligible incidents/);
    await page.getByLabel('Record store',{exact:true}).selectOption('telemetry');assert.equal(await page.locator('#data-severity').isDisabled(),true);
    await page.getByLabel('Record store',{exact:true}).selectOption('alerts');await page.getByRole('button',{name:'Inspect demo-receipt-7',exact:true}).click();assert.match(await page.locator('#decision-input').textContent(),/Payload withheld/);assert.equal((await page.locator('#decision-input').textContent()).includes('production'),false);
    await page.getByRole('link',{name:'Ticket synchronization',exact:true}).click();assert.match(await page.locator('#sync-capabilities').textContent(),/Read-only/);
    await page.getByLabel('Outbound ticket system',{exact:true}).selectOption('github');await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();
    await page.getByLabel('Confirm the exact previewed ticket change · demo.',{exact:true}).check();await page.getByLabel('Sync capability · fixture',{exact:true}).selectOption('viewer');assert.equal(await page.locator('#send-sync').isDisabled(),true);
    await page.getByLabel('Sync capability · fixture',{exact:true}).selectOption('editor');await page.getByRole('button',{name:'Simulate confirmed synchronization',exact:true}).click();assert.match(await page.locator('#sync-result').textContent(),/No external record was created/);
    const createdKey=JSON.parse(await page.locator('#sync-preview').textContent()).operationKey;
    await page.getByLabel('Synchronization policy',{exact:true}).selectOption('bidirectional');await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();
    assert.equal(JSON.parse(await page.locator('#sync-preview').textContent()).operationKey,createdKey,'changing direction must not permit a second create');assert.equal(await page.locator('#send-sync').isDisabled(),true);
    await page.getByLabel('Outbound ticket system',{exact:true}).selectOption('gitlab');
    for(const outcome of ['expired','denied']){
      await page.getByLabel('Connector result · fixture',{exact:true}).selectOption(outcome);await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();await page.getByLabel('Confirm the exact previewed ticket change · demo.',{exact:true}).check();await page.getByRole('button',{name:'Simulate confirmed synchronization',exact:true}).click();
      assert.match(await page.locator('#sync-result').textContent(),outcome==='expired'?/connection expired/:/write grant is missing/);
    }
    await page.getByLabel('Outbound ticket system',{exact:true}).selectOption('servicenow');await page.getByLabel('Connector result · fixture',{exact:true}).selectOption('conflict');await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();await page.getByLabel('Confirm the exact previewed ticket change · demo.',{exact:true}).check();await page.getByRole('button',{name:'Simulate confirmed synchronization',exact:true}).click();assert.match(await page.locator('#sync-result').textContent(),/no remote status was overwritten/);
    await page.getByLabel('Outbound ticket system',{exact:true}).selectOption('jira');assert.equal(await page.locator('#send-sync').isDisabled(),true);
    await page.getByLabel('Connector result · fixture',{exact:true}).selectOption('uncertain');await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();
    const operation=await page.locator('#sync-preview').textContent();await page.getByLabel('Confirm the exact previewed ticket change · demo.',{exact:true}).check();await page.getByRole('button',{name:'Simulate confirmed synchronization',exact:true}).click();
    await page.getByRole('button',{name:'Preview synchronization',exact:true}).click();assert.equal(await page.locator('#sync-preview').textContent(),operation);assert.equal(await page.locator('#send-sync').isDisabled(),true);
    await page.getByRole('button',{name:'Simulate uncertain-create reconciliation',exact:true}).click();assert.match(await page.locator('#sync-result').textContent(),/second create is blocked/);
    await page.getByRole('link',{name:'Approval review',exact:true}).click();await page.getByLabel('I reviewed this exact revision and target.').check();
    await page.getByLabel('Simulated session').selectOption('viewer');assert.equal(await page.locator('#approve').isDisabled(),true);
    await page.getByLabel('Simulated session').selectOption('reviewer');await page.getByRole('button',{name:'Record demo approval',exact:true}).click();
    assert.match(await page.locator('#approval-state').textContent(),/Approved locally/);
    await page.getByRole('button',{name:'Change timeout to 90 seconds',exact:true}).click();assert.match(await page.locator('#approval-state').textContent(),/Awaiting/);assert.equal(await page.locator('#approve').isDisabled(),true);
    assert.equal(await page.locator('#revision').textContent(),'2');
    const shotDir=process.env.OPERATIONS_UX_SCREENSHOTS;if(shotDir){fs.mkdirSync(shotDir,{recursive:true});await page.screenshot({path:path.join(shotDir,'approval-desktop.png'),fullPage:true});}
    await page.getByRole('link',{name:'Work delivery',exact:true}).click();await page.waitForFunction(()=>/^[a-f0-9]{64}$/.test(document.getElementById('digest').textContent));
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download demo manifest',exact:true}).click();
    const downloaded=await download;const bytes=fs.readFileSync(await downloaded.path()),manifest=JSON.parse(bytes);
    assert.equal(manifest.revision,2);assert.equal(manifest.prototype,true);assert.equal(manifest.executionRequested,false);assert.match(manifest.command,/--timeout=90s$/);
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),await page.locator('#digest').textContent());
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:1080});
      for(const name of ['Incidents','Estate','Data & decisions','Sources & access','Connections & CLI','Ticket synchronization','Approval review','Work delivery']){
        await page.getByRole('link',{name,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);
        if(shotDir&&width===1440&&name==='Incidents')await page.screenshot({path:path.join(shotDir,'incident-desktop.png'),fullPage:true});
        if(shotDir&&width===1440&&name==='Sources & access')await page.screenshot({path:path.join(shotDir,'sources-desktop.png'),fullPage:true});
        if(shotDir&&width===1440&&name==='Data & decisions')await page.screenshot({path:path.join(shotDir,'data-desktop.png'),fullPage:true});
        if(shotDir&&width===1440&&name==='Ticket synchronization')await page.screenshot({path:path.join(shotDir,'sync-desktop.png'),fullPage:true});
        if(shotDir&&width===1440&&name==='Connections & CLI')await page.screenshot({path:path.join(shotDir,'connections-desktop.png'),fullPage:true});
        if(shotDir&&width===1440&&name==='Estate')await page.screenshot({path:path.join(shotDir,'topology-desktop.png'),fullPage:true});
        if(shotDir&&width===390&&name==='Estate')await page.screenshot({path:path.join(shotDir,'estate-phone.png'),fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);assert.equal(requests.some(([method,url])=>method!=='GET'||url.startsWith('/api/')),false);
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('installed experience lists canonical incidents, escapes titles and clears tickets after denial',async()=>{
 const experience=path.resolve(__dirname,'../experience');let status=200;
 const server=http.createServer((req,res)=>{
  if(req.url==='/api/tickets'){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({tickets:[{id:'ticket/1',kind:'intelligent-operations',title:'CPU <script>bad()</script>',status:'awaiting_approval'},{id:'other',kind:'other',title:'Excluded'}]}));return;}
  if(req.url==='/api/intelligent-operations/records'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sources:[],events:[],inventory:[]}));return;}
  const file=path.basename(req.url.split('?')[0]);
  if(['index.html','experience.js','explorer.js','processing-controls.js','experience.css','operations.css'].includes(file)){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(file==='operations.css'?root:experience,file)));return;}
  res.writeHead(200,{'Content-Type':'text/javascript'});res.end('');
 });let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html#incidents`);
  await page.getByRole('status').filter({hasText:'Records refreshed'}).waitFor();
  await page.getByRole('button',{name:'Read incident tickets'}).click();
  await page.getByText('CPU <script>bad()</script>',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open ticket',exact:true}).getAttribute('href'),'/cockpit/?app=intelligent-operations&ticket=ticket%2F1');
  assert.equal(await page.getByText('Excluded',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>typeof window.bad),'undefined');
  status=403;await page.getByRole('button',{name:'Read incident tickets'}).click();await page.getByText('Incident tickets are unavailable (HTTP 403).',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open ticket',exact:true}).count(),0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
