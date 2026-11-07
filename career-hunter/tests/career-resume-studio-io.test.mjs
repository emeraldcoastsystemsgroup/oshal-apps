/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute the shipped editor with delayed document/model/save responses: selection, draft, persisted target and bridge capability stay bound to one document, including failures and packet deep links. No user files or external services are used.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Save is enabled only with an unsaved change (a freshly loaded packet keeps it disabled until an edit), and a failed read is told in the page's alert line instead of the status caption.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../tools/career-resume-studio.html',import.meta.url),'utf8').match(/<script>\s*\n([\s\S]*?)<\/script>/)[1];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(body,ok=true)=>({ok,json:async()=>JSON.parse(JSON.stringify(body))});
const tick=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
function element(id='') {
  let html='',value='';const el={id,textContent:'',disabled:id!=='pick',hidden:true,style:{},children:[],options:[],listeners:{},
    replaceChildren(...items){this.children=items;},appendChild(n){this.children.push(n);if(id==='pick')this.options.push(n);},
    removeAttribute(name){delete this[name];},addEventListener(name,fn){this.listeners[name]=fn;}};
  if(id==='pick')el.options=[{value:'',textContent:'Pick a resume…'},{value:'master',textContent:'Master'}];
  Object.defineProperty(el,'value',{get:()=>value,set:v=>{const next=String(v);value=id==='pick'&&!el.options.some(o=>o.value===next)?'':next;}});
  Object.defineProperty(el,'innerHTML',{get:()=>html,set:value=>{html=value;el.children=[];if(id==='pick')el.options=[{value:'',textContent:'Pick a resume…'}];}});
  return el;
}
function editor(fetcher,search='') {
  const nodes=new Map(),events={},contexts=[],requests=[],navigations=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
  const context={console,URLSearchParams,location:{search},CareerJobActions:{openApplication:(...args)=>navigations.push(args)},window:{__bridge:{emitContext:c=>contexts.push(c)},addEventListener(){}},
    document:{getElementById:$,querySelector:()=>$('applicationNav'),createElement:()=>element(),addEventListener:(name,fn)=>{events[name]=fn;}},
    fetch:async(url,options={})=>{const req={url,method:options.method||'GET',body:options.body&&JSON.parse(options.body)};requests.push(req);return fetcher(req);}};
  vm.createContext(context);vm.runInContext(source,context);
  const api=vm.runInContext('({loadDoc,send,save,state:()=>state})',context);
  const custom=actions=>events['surface-bridge:custom']({detail:{name:'resume_action',data:{actions}}});
  return {$,api,requests,contexts,custom,navigations};
}
const master={resume:{headline:'Master profile',experience:[{title:'Recorded role',org:'Recorded employer',span:'2020–2024',bullets:['Recorded work']}]},cover:{},meta:{name:'Fixture'}};
const packet={resume:{headline:'Job packet',summary:'Recorded experience',skills:['Python']},cover:{paragraphs:['Recorded cover']},meta:{title:'Fixture role',company:'Fixture company'}};

test('a late master response cannot replace the more recently selected packet or expose its editor while loading',async()=>{
  const a=deferred(),b=deferred();
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('id=master')?a.promise:b.promise);
  assert.equal(e.$('save').disabled,true);assert.equal(e.contexts.at(-1)?.can?.includes('custom') ?? false,false);
  const chosen=e.api.loadDoc('225');assert.equal(e.api.state().postingId,null);
  await e.api.save();assert.ok(!e.requests.some(r=>r.method==='POST'));
  b.resolve(response(packet));await chosen;
  assert.equal(e.api.state().postingId,225);assert.equal(e.$('save').disabled,true,'nothing to save yet');
  e.custom([{op:'set_summary',text:'Edited summary'}]);assert.equal(e.$('save').disabled,false,'an edit enables Save');
  a.resolve(response(master));await tick();
  assert.equal(e.api.state().postingId,225);assert.equal(e.api.state().resume.headline,'Job packet');
  assert.equal(e.$('pick').value,'225');assert.equal(e.contexts.at(-1).recordId,'225');
});

test('failed document reads and empty selection leave no previous draft available for save or bridge edits',async()=>{
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('id=master')?response(master):response({},false));await tick();
  assert.equal(e.api.state().postingId,'master');
  await e.api.loadDoc('404');e.custom([{op:'set_headline',text:'Wrong target'}]);await e.api.save();
  assert.equal(e.api.state().postingId,null);assert.equal(e.$('sheet').hidden,true);assert.equal(e.$('save').disabled,true);
  assert.match(e.$('err').textContent,/Couldn.t load this résumé/);assert.equal(e.$('err').hidden,false);assert.ok(!e.requests.some(r=>r.method==='POST'));
  await e.api.loadDoc('');assert.equal(e.api.state().postingId,null);assert.equal(e.$('pick').disabled,false);
});

test('pending guide/save operations keep the selected packet and full cover, and edited status survives completion',async()=>{
  const guide=deferred(),save=deferred();
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('/guide')?guide.promise:req.url.endsWith('/save')?save.promise:response(packet),'?id=225');await tick();
  e.$('msg').value='Tighten only the headline';const editing=e.api.send();
  assert.equal(e.$('pick').disabled,true);assert.equal(e.$('save').disabled,true);assert.deepEqual([...e.contexts.at(-1).can],['notify']);
  await e.api.loadDoc('master');await e.api.save();e.custom([{op:'set_headline',text:'Late bridge edit'}]);
  assert.equal(e.api.state().postingId,225);assert.equal(e.api.state().resume.headline,'Job packet');
  guide.resolve(response({actions:[{op:'set_headline',text:'Concise packet'}],reply:'Tightened the headline.'}));await editing;
  assert.equal(e.api.state().resume.headline,'Concise packet');assert.match(e.$('status').textContent,/edited/);
  const saving=e.api.save();await e.api.loadDoc('master');e.custom([{op:'set_headline',text:'Change during save'}]);
  const writes=e.requests.filter(r=>r.method==='POST');assert.equal(writes.length,2);
  assert.equal(writes[1].body.postingId,225);assert.equal(writes[1].body.resume.headline,'Concise packet');assert.deepEqual(writes[1].body.cover,packet.cover);
  save.resolve(response({ok:true}));await saving;
  assert.match(e.$('status').textContent,/PDF re-rendered/);assert.equal(e.$('pick').disabled,false);assert.equal(e.api.state().postingId,225);
});

test('a deep-linked packet missing from the generated feed remains selected when the slow list arrives',async()=>{
  const list=deferred();const e=editor(req=>req.url.includes('/jobs?')?list.promise:response(packet),'?id=999');await tick();
  list.resolve(response({jobs:[]}));await tick();
  assert.equal(e.$('pick').value,'999');assert.equal(e.api.state().postingId,999);assert.ok(e.$('pick').options.some(o=>o.value==='999'));
});

test('malformed bridge actions cannot crash preview, claim an edit, or change master role anchors',async()=>{
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):response(master));await tick();
  const before=JSON.stringify(e.api.state().resume),log=e.$('log').children.length;
  assert.doesNotThrow(()=>e.custom([{op:'set_skills',items:'not a list'},{op:'unknown',text:'new'},{op:'update_experience',index:1,title:'Invented title',bullets:['Changed work']}]));
  assert.equal(JSON.stringify(e.api.state().resume),before);assert.equal(e.$('log').children.length,log);
  e.custom([{op:'set_headline',text:'Recorded headline'}]);assert.equal(e.api.state().resume.headline,'Recorded headline');assert.match(e.$('status').textContent,/edited by Jarvis/);
});

test('the packet preview includes its candidate name, qualifications and cover; text stays escaped',async()=>{
  const doc={resume:{headline:'Recorded role',education:['MBA, Fixture University'],certifications:['Recorded certification']},
    cover:{greeting:'Dear team,',paragraphs:['Recorded <experience> & work.'],closing:'Fixture Candidate'},meta:{name:'Fixture Candidate'}};
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('id=master')?response(master):response(doc),'?id=225');await tick();
  const paper=e.$('sheet').innerHTML;
  for(const text of ['Fixture Candidate','Education','MBA, Fixture University','Certifications','Recorded certification','Cover letter','Dear team,','Recorded &lt;experience&gt; &amp; work.'])assert.ok(paper.includes(text),text);
  assert.equal(e.$('coverPdf').href,'/api/career-hunter/resume?id=225&kind=cover');
  await e.api.loadDoc('master');assert.ok(!e.$('sheet').innerHTML.includes('Cover letter'));assert.equal(e.$('coverPdf').style.display,'none');
});

test('master Save sends the complete active master with its sentinel and no packet cover',async()=>{
  const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('/save')?response({ok:true,changed:false}):response(master));await tick();
  assert.equal(e.$('save').textContent,'Save master resume');await e.api.save();
  const writes=e.requests.filter(r=>r.method==='POST');assert.equal(writes.length,1);
  assert.deepEqual(writes[0].body,{postingId:'master',resume:master.resume});
  assert.match(e.$('status').textContent,/no changes to save/);assert.equal(e.$('pdf').style.display,'none');
});

test('application editing returns to the same reviewed job only after a successful save',async()=>{
  for(const ok of [true,false]){
    const pending=deferred();const e=editor(req=>req.url.includes('/jobs?')?response({jobs:[]}):req.url.endsWith('/save')?pending.promise:response(packet),'?id=225&application=1');await tick();
    assert.equal(e.$('pick').hidden,true);assert.equal(e.$('save').textContent,'Save & return to application');
    const saving=e.api.save();assert.deepEqual(e.navigations,[]);
    pending.resolve(response({ok}));await saving;
    assert.deepEqual(e.navigations,ok?[[225,false,'documents']]:[]);
    assert.equal(e.requests.filter(r=>r.method==='POST')[0].body.postingId,225);
  }
});
