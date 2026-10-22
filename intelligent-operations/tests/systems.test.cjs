/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise Systems native-identity joins, historical boundaries, bounded views and actual rendering without services or a browser.
 */
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {systemInventory,systems}=require('../experience/explorer.js');
const at='2026-10-20T12:00:00.000Z';
const asset=(id,extra={})=>({id,provider:'kubernetes',scope:'cluster-a',kind:'pod',nativeId:id,name:id,health:'healthy',observedAt:at,properties:{namespace:'demo'},...extra});
const graph=(assets,extra={})=>({asOf:at,assets,relationships:[],collections:[],...extra});
const event=(id,nativeId,extra={})=>({id,decision:'validated',normalized:{time:at,data:{alertType:'Readiness',status:'firing',resource:{kind:'kubernetes-pod',scope:'cluster-a',id:nativeId}}},...extra});

test('system grouping keeps identical names and native IDs in different providers/scopes separate',()=>{
 const data=graph([asset('a',{nativeId:'same',name:'api'}),asset('b',{nativeId:'same',name:'api',scope:'cluster-b'}),asset('c',{nativeId:'same',provider:'aws',kind:'virtual-machine'})]);
 const result=systemInventory(data,[event('e','same')]);
 assert.equal(result.systems.length,3);
 assert.deepEqual(result.rows.filter(r=>r.events.length).map(r=>r.id),['a']);
 const scoped=systemInventory(data,[],{system:JSON.stringify(['kubernetes','cluster-b'])});
 assert.deepEqual(scoped.rows.map(r=>r.id),['b']);assert.equal(scoped.total,3);assert.equal(scoped.scopeTotal,1);
});
test('namespace/type/health/search filters retain native identity and do not create healthy defaults',()=>{
 const data=graph([asset('a'),asset('b',{health:'unknown'}),asset('c',{kind:'container',health:'degraded',properties:{namespace:'other',restarts:3}})]);
 assert.deepEqual(systemInventory(data,[],{namespace:'demo',health:'unknown',search:'B'}).rows.map(r=>r.id),['b']);
 const selected=systemInventory(data,[],{namespace:'other',kind:'container'});
 assert.equal(selected.counts.containers,1);assert.equal(selected.counts.degraded,1);assert.equal(selected.counts.healthy,0);
 assert.deepEqual(systemInventory(data,[],{namespace:'not-observed'}).rows,[]);
 assert.equal(systemInventory(graph([asset('missing',{health:undefined})]),[],{health:'unknown'}).counts.unknown,1);
});
test('event association excludes quarantine, future observations, duplicate deliveries and wrong resource types',()=>{
 const future=event('future','a');future.normalized.time='2026-10-21T12:00:00Z';
 const wrong=event('wrong','a');wrong.normalized.data.resource.kind='container';
 const data=graph([asset('a')]);
 const rows=systemInventory(data,[event('one','a'),event('one','a'),event('quarantined','a',{decision:'quarantined'}),future,wrong,event('bad','a',{normalized:{time:'invalid'}})]).rows;
 assert.deepEqual(rows[0].events.map(e=>e.id),['one']);
});
test('related events sort by observed instant across timezone offsets',()=>{
 const older=event('older','a'),newer=event('newer','a');
 older.normalized.time='2026-10-20T13:00:00+02:00';newer.normalized.time='2026-10-20T11:30:00Z';
 assert.deepEqual(systemInventory(graph([asset('a')]),[older,newer]).rows[0].events.map(e=>e.id),['newer','older']);
});
test('ambiguous cloud identities stay unlinked even when a display filter hides one candidate',()=>{
 const data=graph([asset('a',{provider:'aws',nativeId:'shared',kind:'host'}),asset('b',{provider:'aws',nativeId:'shared',kind:'virtual-machine'})]);
 const e=event('one','shared');e.normalized.data.resource.kind='aws-resource';
 assert.equal(systemInventory(data,[e],{kind:'host'}).rows[0].events.length,0);
});
test('placement and ownership come from exact observed directed edges, including unresolved neighbors',()=>{
 const data=graph([asset('pod'),asset('node',{kind:'node',name:'worker-a'})],{relationships:[{from:'pod',to:'node',type:'RUNS_ON',evidence:'observed node UID'},{from:'pod',to:'missing-owner',type:'OWNED_BY',evidence:'owner reference'}]});
 const pod=systemInventory(data).rows.find(r=>r.id==='pod');
 assert.equal(pod.neighbors[0].neighbor.name,'worker-a');assert.equal(pod.neighbors[0].outbound,true);assert.equal(pod.neighbors[1].neighbor,null);
 assert.equal(systemInventory(data).rows.find(r=>r.id==='node').neighbors[0].outbound,false);
});
test('partial scans and unknown health remain visible; projection does not mutate input evidence',()=>{
 const data=graph([asset('a',{health:'unknown'})],{collections:[{complete:false}]});
 const before=JSON.stringify(data),result=systemInventory(data);
 assert.equal(result.partialCollections,1);assert.equal(result.counts.unknown,1);assert.equal(result.counts.healthy,0);assert.equal(JSON.stringify(data),before);
});
test('large views are bounded without presenting the visible row count as the total',()=>{
 const result=systemInventory(graph(Array.from({length:120},(_,i)=>asset('pod-'+i))));
 assert.equal(result.counts.total,120);assert.equal(result.rows.length,100);assert.equal(result.truncated,true);
 assert.throws(()=>systemInventory(graph(Array.from({length:2001},(_,i)=>asset('pod-'+i)))),/budget/);
 assert.throws(()=>systemInventory(graph([]),Array.from({length:201},()=>({}))),/budget/);
});
test('missing/malformed graph responses never become successful empty inventory',()=>{
 assert.throws(()=>systemInventory(null),/unavailable/);
 assert.throws(()=>systemInventory(graph([],{asOf:'invalid'})),/unavailable/);
 assert.throws(()=>systemInventory(graph([asset('a'),asset('a')])),/repeated/);
 assert.throws(()=>systemInventory(graph([asset('a',{observedAt:'invalid'})])),/observation time/);
 assert.throws(()=>systemInventory(graph([asset('a',{observedAt:'2026-10-21T00:00:00Z'})])),/graph time/);
 assert.deepEqual(systemInventory(graph([])).counts,{total:0,healthy:0,degraded:0,unknown:0,pods:0,containers:0,nodes:0});
});

class Element{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.listeners={};this.value='';this.style={};this.attributes={};}
 get firstChild(){return this.children[0];}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=[...items];}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(name,value){this.attributes[name]=value;}
 removeAttribute(name){delete this.attributes[name];}
 scrollIntoView(){}
 focus(){}
}
function all(root){return [root,...root.children.flatMap(all)];}
test('actual Systems renderer uses text nodes, exposes captured facts and selects the original event',()=>{
 const prior=global.document;global.document={createElement:tag=>new Element(tag)};
 try{
  const payload='<img src=x onerror=alert(1)>',item=event('one','c');item.normalized.data.resource.kind='container';
  const model=systemInventory(graph([asset('c',{kind:'container',name:payload,health:'unknown',properties:{namespace:'demo',image:'image@sha256:abc',restarts:4}})]),[item]);
  const root=new Element('div');root.append(new Element('old'));let focused,selected;
  systems(root,model,id=>focused=id,e=>selected=e);
  const nodes=all(root),text=nodes.map(n=>n.textContent).join('\n');
  assert.ok(text.includes(payload));assert.equal(nodes.some(n=>n.tag==='img'),false);
  assert.match(text,/unknown when observed/);assert.match(text,/Observed restarts/);assert.match(text,/image@sha256:abc/);
  nodes.find(n=>n.tag==='button'&&n.textContent.startsWith('Inspect ')).listeners.click();assert.equal(focused,'c');
  nodes.find(n=>n.tag==='button'&&n.textContent.startsWith('Readiness')).listeners.click();assert.equal(selected,item);
  assert.equal(nodes.some(n=>n.tag==='old'),false);
 }finally{global.document=prior;}
});

function controllerFixture(initialHash='#systems'){
 const root=path.resolve(__dirname,'../experience'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element('div')]));
 const document={getElementById:id=>{assert.ok(ids.has(id),'Shipped element '+id);return ids.get(id);},querySelectorAll:()=>[],createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag)};
 const calls=[];let response=graph([asset('private-pod')]),recordsStatus=200,held=null;
 const reply=(body,status=200)=>({ok:status===200,status,json:async()=>body});
 const context=vm.createContext({document,location:{hash:initialHash},URLSearchParams,Date,console,fetch:async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');
  if(url.endsWith('/records'))return reply({sources:[],events:[],inventory:[]},recordsStatus);
  assert.ok(url.startsWith('/api/intelligent-operations/topology?'),url);
  if(held)return held;
  return reply(response);
 }});
 context.window=context;context.addEventListener=()=>{};
 vm.runInContext(fs.readFileSync(path.join(root,'explorer.js'),'utf8'),context);
 context.OperationsProcessing={mount:()=>({load(){},clear(){}})};
 vm.runInContext(fs.readFileSync(path.join(root,'experience.js'),'utf8'),context);
 return {ids,calls,context,setRecordsStatus:value=>recordsStatus=value,setGraph:value=>response=value,holdGraph:()=>{let release;held=new Promise(resolve=>release=resolve);return body=>{held=null;release(reply(body));};}};
}
async function settle(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
test('shipped controller loads Systems through existing caller-scoped GETs and clears it on access withdrawal',async()=>{
 const f=controllerFixture();await settle();
 assert.equal(f.ids.get('systems').hidden,false);
 assert.match(all(f.ids.get('systems-results')).map(n=>n.textContent).join('\n'),/private-pod/);
 assert.equal(f.ids.get('systems-scope').disabled,false);
 assert.ok(f.calls.every(c=>!c.url.includes('userId')&&!c.options.body));
 f.setRecordsStatus(403);await f.ids.get('systems-refresh').listeners.click();await settle();
 assert.equal(f.ids.get('systems-results').children.length,0);assert.equal(f.ids.get('systems-scope').disabled,true);
 assert.equal(f.ids.get('systems-scope').children.length,1);assert.equal(f.ids.get('systems-scope').value,'');
 assert.match(f.ids.get('status').textContent,/role does not permit/);
});
test('a late graph cannot restore private Systems rows after refusal, and malformed graphs show unavailable',async()=>{
 const f=controllerFixture();await settle();
 const release=f.holdGraph();f.ids.get('graph-form').listeners.submit({preventDefault(){}});await settle();
 assert.equal(f.ids.get('systems-results').children.length,0);
 f.setRecordsStatus(403);await f.ids.get('systems-refresh').listeners.click();await settle();
 release(graph([asset('late-private-pod')]));await settle();
 assert.equal(f.ids.get('systems-results').children.length,0);
 f.setRecordsStatus(200);f.setGraph({});await f.ids.get('systems-refresh').listeners.click();await settle();
 assert.equal(f.ids.get('systems-results').children.length,0);
 assert.match(f.ids.get('systems-status').textContent,/unavailable/);
});

test('the default Systems page reloads graph after records invalidate the initial observation read',async()=>{
 for(const hash of ['', '#unknown']){const f=controllerFixture(hash);await settle();assert.equal(f.ids.get('systems').hidden,false);assert.ok(f.calls.filter(c=>c.url.includes('/topology?')).length>=2);assert.match(f.ids.get('systems-status').textContent,/Graph as of/);}
});
