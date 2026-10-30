/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The concierge's strategy tools are research-only route reads and writes (save, backtest, read with each account's assigned strategy), the analyst is authorized for them and hands the switch to the owner's Strategies screen, and the declared order authority covers every module that submits or manages a broker order while pages, research routes and the persona stay outside it, following the same literal-require rules the kernel applies.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {application}=require('./support/native-portfolio-host');
const root=path.resolve(__dirname,'..');
const yamlRoots=[__dirname,path.resolve(__dirname,'../../scripts/toolchain'),...(process.env.OSHAL_FRAMEWORK?[path.resolve(process.env.OSHAL_FRAMEWORK)]:[])];
const yaml=require(require.resolve('js-yaml',{paths:yamlRoots}));
const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8'));
const tools=new Map(manifest.tools.map(t=>[t.name,t]));
const STRATEGY_TOOLS={trading_strategies:'GET /api/trading/portfolio/research',trading_strategy_save:'POST /api/trading/portfolio/strategies',trading_strategy_backtest:'POST /api/trading/portfolio/backtest'};

test('the concierge strategy tools are declared route tools over the research endpoints only',()=>{
 for(const[name,endpoint]of Object.entries(STRATEGY_TOOLS)){
  const t=tools.get(name);assert.ok(t,name+' must be declared');assert.equal(t.type,'api');assert.equal(t.executor.executorType,'api');assert.equal(t.executor.apiEndpoint,endpoint);
  assert.equal(t.requiresApproval,false);assert.equal(t.defaultAuthMode,'auto');
  for(const key of ['subject','owner','tenant','user','confirm','fingerprint','mandateId'])assert.equal(t.inputSchema.properties[key],undefined,name+' input must not carry '+key);
 }
 assert.deepEqual(tools.get('trading_strategy_save').inputSchema.required,['name','config']);
 assert.deepEqual(tools.get('trading_strategy_backtest').inputSchema.required,['strategyId','accountId','connectionKey','startDate','endDate']);
 for(const t of manifest.tools){
  const endpoint=t.executor?.apiEndpoint||'';
  assert.doesNotMatch(endpoint,/portfolio\/(profiles|watch|live|mandate|protection|backstops)|orders|reconcil/,t.name+' must never assign a strategy, activate authority or touch orders');
 }
});

test('the analyst may use the strategy tools and never claims to put a strategy into use',()=>{
 const persona=yaml.load(fs.readFileSync(path.join(root,'personas/trading-analyst.yaml'),'utf8'));
 for(const name of Object.keys(STRATEGY_TOOLS))assert.equal(persona.authorizations[name],'auto',name);
 const p=persona.perspective;
 assert.match(p,/save with trading_strategy_save only after the owner agrees/);
 assert.match(p,/backtest the account's assigned strategy over the\s+same window/);
 assert.match(p,/against\s+SPY/);
 assert.match(p,/You never put a strategy into use on a real \(Schwab\) account/);
 for(const step of ['Deactivate strategy','Change strategy','Run account backtest','Save strategy','Review & activate','Activate live\\s+trading'])assert.match(p,new RegExp(step),step);
 assert.match(p,/Never say a strategy is active, assigned or trading on a real account because you saved or tested it/);
});

test('the research read names the strategy each of the owner\'s accounts runs',async t=>{
 const fixture=application();const server=await new Promise(resolve=>{const s=fixture.app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=async(p,body,owner='owner-a')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio'+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fixture-owner':owner},body:body?JSON.stringify(body):undefined});return r.json();};
 const config={modelVersion:2,kind:'monthly-trend',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:63,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false};
 const saved=await req('/strategies',{name:'Concierge draft',config});assert.ok(saved.strategy?.id,JSON.stringify(saved));assert.equal(saved.strategy.researchOnly,true);
 await req('/profiles',{accountId:'a',connectionKey:'owned-login',label:'Taxable',registration:'taxable',strategyId:saved.strategy.id});
 const research=await req('/research');
 assert.deepEqual(research.accounts,[{accountId:'a',connectionKey:'owned-login',label:'Taxable',strategyId:saved.strategy.id}]);
 assert.equal(research.liveExecutionAvailable,false);
 assert.deepEqual((await req('/research',undefined,'owner-b')).accounts,[],'another owner sees none of these accounts');
});

/** The kernel's order-authority closure: literal relative requires through the package's own files. */
const UNFOLLOWABLE=/\bimport[ \t\r\n]*\(|^[ \t]*import[ \t{*]|\b(eval|Function)[ \t\r\n]*\(|require\.resolve|module\.require|createRequire|process\.(binding|dlopen)/m;
const LOADERS=new Set(['fs','fs/promises','vm','module','child_process','worker_threads','wasi','inspector','repl']);
function closure(sources){
 const seen=new Set(),pending=[...sources];
 while(pending.length){
  const rel=pending.pop();if(seen.has(rel))continue;
  assert.ok(fs.existsSync(path.join(root,rel)),rel+' must exist');seen.add(rel);
  if(rel.endsWith('.json'))continue;
  const text=fs.readFileSync(path.join(root,rel),'utf8');
  assert.doesNotMatch(text,UNFOLLOWABLE,rel+' has a load the kernel cannot follow');
  const literal=[...text.matchAll(/\brequire[ \t\r\n]*\([ \t\r\n]*(['"])([^'"\n]+)['"][ \t\r\n]*\)/g)].map(m=>m[2]);
  assert.equal((text.match(/\brequire[ \t\r\n]*\(/g)||[]).length,literal.length,rel+' has a computed require');
  for(const spec of literal){
   if(spec.startsWith('node:')){assert.ok(!LOADERS.has(spec.slice(5)),rel+' loads '+spec);continue;}
   if(spec.startsWith('@/'))continue;
   assert.ok(spec.startsWith('./')||spec.startsWith('../'),rel+' requires bare '+spec);
   const base=path.posix.normalize(path.posix.join(path.posix.dirname(rel),spec));
   assert.ok(!base.startsWith('..'),rel+' leaves the package');
   const hit=[base,base+'.js',base+'.cjs',base+'.json',base+'/index.js'].find(c=>fs.existsSync(path.join(root,c))&&fs.statSync(path.join(root,c)).isFile());
   assert.ok(hit,rel+' requires missing '+spec);pending.push(hit);
  }
 }
 return seen;
}
function files(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.posix.join(dir,e.name)):[path.posix.join(dir,e.name)]);}
const READS=new Set(['list','mandate.status','protection.status','tickets']);

test('approvals cover every module that submits or manages broker orders and nothing presentational',()=>{
 const sources=manifest.orderAuthority?.sources;
 assert.deepEqual(sources,['routes/trading-native-management.js','routes/live/management.js']);
 const covered=closure(sources);
 for(const file of files('routes').filter(f=>/\.(c?js)$/.test(f))){
  const intents=[...fs.readFileSync(path.join(root,file),'utf8').matchAll(/trading\.orders\.([a-z_.]*[a-z_])?/g)].map(m=>m[1]||'');
  if(intents.some(name=>!READS.has(name)))assert.ok(covered.has(file),file+' submits or manages broker orders outside the approved code');
 }
 for(const file of ['routes/live/automation.js','routes/live/allocation.js','routes/live/watcher-exits.js','routes/live/protective-execution.js','routes/trading-portfolio-plan.js','routes/trading-portfolio-sim.js'])
  assert.ok(covered.has(file),file+' decides orders and must be covered');
 for(const file of covered)assert.ok(file.startsWith('routes/'),file+' is not order code');
 for(const file of ['routes/trading-portfolio-routes.js','routes/trading-routes.js','routes/trading-research-routes.js','routes/trading-strategy-lab-routes.js'])
  assert.ok(!covered.has(file),file+' is not order code; changing it must keep approvals');
});
