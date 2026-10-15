/* Publishing Studio: local geometry drafts; the pinned renderer owns all text flow.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve unapplied inspector buffers and pin asynchronous operations to their saved document context.
 */
const $=id=>document.getElementById(id),base='/api/publishing-studio',copy=value=>structuredClone(value),uid=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
const state={document:null,model:null,ops:[],undo:[],redo:[],page:0,item:null,assets:[],previews:new Map(),busy:false,chatBusy:false,renderStarting:false,job:null,session:null,saveKey:null,viewGeneration:0,renderGeneration:0,createAttempt:null,restoreAttempt:null};

// Inspector fields are a separate draft from applied model operations. Applying one
// form must not erase text still being composed in a different form.
const fields={
 geometry:['x','y','width','height'],link:['next-frame'],
 story:['story-text','story-paragraph-style','story-character-style'],
 page:['page-width','page-height','bleed','margin','guides-x','guides-y','master'],
 master:['master-objects'],character:['font','font-size','font-weight','font-style','font-color'],
 paragraph:['leading','space-after','indent','align'],object:['object-kind','object-asset','object-text','object-color']
};
const trackedFields=new Set(Object.values(fields).flat()),pendingFields=new Map(),fieldBaselines=new Map(),selectionValues=new Map();
function rememberField(node){
 if(!trackedFields.has(node.id))return;
 fieldBaselines.set(node.id,node.value);
 if(pendingFields.has(node.id)){
  if(pendingFields.get(node.id)===node.value)pendingFields.delete(node.id);
  else node.value=pendingFields.get(node.id);
 }
}
function hasDraft(){return state.ops.length>0||pendingFields.size>0;}
function requireAppliedFields(){if(pendingFields.size)throw new Error('Apply or discard the field edits before continuing.');}
function clearFieldBuffers(){
 for(const id of pendingFields.keys())if(fieldBaselines.has(id))$(id).value=fieldBaselines.get(id);
 pendingFields.clear();
}
function discardFields(){clearFieldBuffers();paint();}
function guardFields(){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 if(pendingFields.size&&!confirm('Discard unapplied field edits before changing the selection?'))return false;
 clearFieldBuffers();return true;
}
function changeSelection(id,work){
 const previous=selectionValues.get(id),next=$(id).value;
 if(!guardFields()){if(previous!==undefined)$(id).value=previous;return;}
 selectionValues.set(id,next);work();controls();
}
function selectPage(index,item=null){
 if(state.page===index&&state.item===item)return true;
 if(!guardFields())return false;
 state.page=index;state.item=item;paint();return true;
}
function viewSnapshot(){return{id:state.document?.id,revision:state.document?.revision,generation:state.viewGeneration};}
function sameView(view){return state.document?.id===view.id&&state.document?.revision===view.revision&&state.viewGeneration===view.generation;}
function retireRender(){state.renderGeneration++;state.renderStarting=false;state.job=null;}
async function locked(work){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 state.busy=true;controls();
 try{return await work();}finally{state.busy=false;controls();}
}

function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function headers(json=false){const out={};if(json)out['Content-Type']='application/json';const token=sessionStorage.getItem('oshal.token');if(token)out.Authorization='Bearer '+token;return out;}
async function request(path,{method='GET',body,blob=false,native=false}={}){const response=await fetch(native?path:base+path,{method,headers:headers(body!==undefined&&!(body instanceof FormData)),credentials:'same-origin',...(body!==undefined?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});if(!response.ok){let value;try{value=await response.json();}catch{}const error=new Error(value?.error??`Request failed (${response.status})`);error.details=value?.details;throw error;}return blob?response.blob():response.json();}
function action(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){status(error.message,true);if(error.details)$('preflight').textContent=JSON.stringify(error.details,null,2);}};}
function bind(id,event,fn){$(id).addEventListener(event,action(fn));}
function requireDocument(){if(state.busy)throw new Error('Wait for the current save or open to finish.');if(!state.document)throw new Error('Create or open a publication first.');return state.document;}
function editable(){const d=requireDocument();if(state.busy)throw new Error('Wait for the current save or open to finish.');if(d.revision!==d.currentRevision)throw new Error('Restore this historical revision or reopen the current revision before editing.');return d;}
function page(){return state.model?.pages[state.page];}
function selected(){const p=page();return p&&[...p.frames,...p.objects].find(v=>v.id===state.item);}
function option(select,values,current){
 select.replaceChildren(...values.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
 if(values.some(([value])=>String(value)===String(current)))select.value=current;
 rememberField(select);selectionValues.set(select.id,select.value);
}
function value(id,v){$(id).value=v??'';rememberField($(id));}
function number(id){const v=Number($(id).value);if(!Number.isFinite(v))throw new Error('Enter finite numeric geometry.');return v;}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),hex=color=>'#'+color.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
function localApply(model,op){const m=copy(model),p=m.pages.find(p=>p.id===op.page);switch(op.op){case'set-frame':Object.assign(m.pages.flatMap(p=>p.frames).find(f=>f.id===op.frame),op.values);break;case'set-link':m.pages.flatMap(p=>p.frames).find(f=>f.id===op.frame).nextFrame=op.nextFrame;break;case'replace-story':m.stories.find(s=>s.id===op.story).paragraphs=copy(op.paragraphs);break;case'set-character-style':m.characterStyles[op.name]=copy(op.values);break;case'set-paragraph-style':m.paragraphStyles[op.name]=copy(op.values);break;case'set-page':Object.assign(p,copy(op.values));break;case'set-object':Object.assign(p.objects.find(o=>o.id===op.object),copy(op.values));break;case'set-master':m.masters.find(x=>x.id===op.master).objects=copy(op.objects);break;case'set-view':m.pageView=op.pageView;break;case'replace-layout':for(const k of ['pages','masters','stories','assets'])m[k]=copy(op[k]);break;default:throw new Error('Unsupported draft operation');}return m;}
function edit(op,consumed=[]){
 editable();if(state.ops.length>=64)throw new Error('Save this revision before making more edits.');
 const model=localApply(state.model,op);
 for(const id of consumed){pendingFields.delete(id);fieldBaselines.set(id,$(id).value);}
 state.undo.push({model:state.model,ops:state.ops});state.model=model;
 state.ops=[...state.ops,op];state.redo=[];state.saveKey=null;paint();
 status('Unsaved draft. Save validates the complete layout; render checks text flow.');
}
function layout(mutator,consumed=[]){const m=copy(state.model);mutator(m);edit({op:'replace-layout',...Object.fromEntries(['pages','masters','stories','assets'].map(k=>[k,m[k]]))},consumed);}
function clearPreviews(){for(const url of state.previews.values())URL.revokeObjectURL(url);state.previews.clear();}
function dirtyPrompt(){return !hasDraft()||confirm('Discard the unsaved draft and unapplied field edits and open the saved publication?');}
async function loadDocument(id,revision){
 const result=await request('/documents/'+id+(revision?'?revision='+revision:''));
 // Only callers holding the workspace lock adopt an HTTP response.
 clearPreviews();retireRender();state.viewGeneration++;clearFieldBuffers();
 state.document=result.document;state.model=copy(result.document.model);
 state.ops=[];state.undo=[];state.redo=[];state.saveKey=null;state.page=0;state.item=null;
 $('preflight').textContent='';
 option($('history'),result.history.map(v=>[v.revision,`Revision ${v.revision}`]),result.document.revision);
 paint();status('Opened saved revision '+result.document.revision);await previews(viewSnapshot());
}
async function open(id,revision){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 if(!dirtyPrompt())return;
 return locked(()=>loadDocument(id,revision));
}
async function refresh(){const [docs,assets]=await Promise.all([request('/documents'),request('/assets')]);state.assets=assets.assets;$('documents').replaceChildren(...docs.documents.map(d=>{const b=document.createElement('button');b.textContent=d.title;b.onclick=action(()=>open(d.id));return b;}));$('asset-list').replaceChildren(...state.assets.map(a=>{const row=document.createElement('p');row.textContent=`${a.title} · ${a.bytes} bytes `;const remove=document.createElement('button');remove.textContent='Delete';remove.onclick=action(async()=>{if(confirm('Delete this unused asset? Saved revisions keep their asset references.')){await request('/assets/'+a.id,{method:'DELETE',body:{}});await refresh();}});row.append(remove);return row;}));option($('object-asset'),state.assets.map(a=>[a.id,a.title]),$('object-asset').value);}
async function save(){
 const d=editable();requireAppliedFields();if(!state.ops.length)return;
 state.saveKey??=crypto.randomUUID();
 const body={baseRevision:d.revision,requestKey:state.saveKey,operations:copy(state.ops)};
 return locked(async()=>{
  const result=await request(`/documents/${d.id}/revisions`,{method:'POST',body});
  state.document=result.document;state.model=copy(result.document.model);state.ops=[];
  state.undo=[];state.redo=[];state.saveKey=null;state.viewGeneration++;retireRender();clearPreviews();
  $('preflight').textContent='';paint();status('Saved revision '+state.document.revision);
  await refresh();const saved=await request('/documents/'+d.id);
  option($('history'),saved.history.map(v=>[v.revision,`Revision ${v.revision}`]),state.document.revision);
 });
}
function svg(name,attributes={}){const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);return node;}
function boards(){const target=$('spread');target.replaceChildren();if(!state.model){const p=document.createElement('p');p.className='empty';p.textContent='Create a publication, then edit its individual pages.';target.append(p);return;}const indexes=state.model.pageView==='facing'?[state.page-state.page%2,state.page-state.page%2+1].filter(i=>i<state.model.pages.length):[state.page];for(const i of indexes){const p=state.model.pages[i],pad=p.bleed+12,section=document.createElement('div');section.className='page-board'+(indexes.length>1?' facing':'');const canvas=svg('svg',{viewBox:`${-pad} ${-pad} ${p.width+2*pad} ${p.height+2*pad}`,role:'img','aria-label':`Page ${i+1} editable geometry`});if(!state.ops.length&&state.previews.has(i+1))canvas.append(svg('image',{href:state.previews.get(i+1),x:-pad,y:-pad,width:p.width+2*pad,height:p.height+2*pad}));canvas.append(svg('rect',{x:0,y:0,width:p.width,height:p.height,class:'trim-line'}),svg('rect',{x:p.margin,y:p.margin,width:Math.max(0,p.width-2*p.margin),height:Math.max(0,p.height-2*p.margin),class:'margin-line'}));for(const x of p.guides.x)canvas.append(svg('line',{x1:x,y1:0,x2:x,y2:p.height,class:'guide-line'}));for(const y of p.guides.y)canvas.append(svg('line',{x1:0,y1:y,x2:p.width,y2:y,class:'guide-line'}));for(const item of [...p.objects,...p.frames]){const rect=svg('rect',{x:item.x,y:item.y,width:item.width,height:item.height,class:'selection-box','data-selected':i===state.page&&item.id===state.item,'data-item':item.id,tabindex:0,'aria-label':item.id});rect.addEventListener('keydown',action(e=>{if(e.key==='Enter')selectPage(i,item.id);}));rect.addEventListener('click',event=>event.stopPropagation());rect.addEventListener('pointerdown',action(event=>drag(event,canvas,rect,item,i)));canvas.append(rect);if(state.ops.length||!state.previews.has(i+1)){const label=svg('text',{x:item.x+3,y:item.y+11,class:'object-label'});label.textContent=item.storyId?`Frame: ${item.storyId}`:item.kind;canvas.append(label);}}canvas.addEventListener('click',()=>{if(state.page!==i)selectPage(i);});const label=document.createElement('div');label.className='page-label';label.textContent=`Page ${i+1} · ${p.width} × ${p.height} pt · ${state.ops.length||!state.previews.has(i+1)?'geometry draft':'rendered PDF + editing guides'}`;section.append(canvas,label);target.append(section);}}
function drag(event,canvas,rect,item,index){
 if(event.button!==0||state.busy)return;
 editable();event.stopPropagation();
 if((state.page!==index||state.item!==item.id)&&!guardFields())return;
 state.page=index;state.item=item.id;inspect();controls();
 // Keep the real SVG attached for the whole gesture; repainting would detach
 // its screen matrix and pointer capture when selecting a different page.
 for(const outline of $('spread').querySelectorAll('[data-selected]'))outline.dataset.selected=String(outline===rect);
 const view=viewSnapshot(),model=state.model;
 const current=()=>sameView(view)&&state.model===model&&state.page===index&&state.item===item.id&&!state.busy;
 const point=e=>{const p=canvas.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(canvas.getScreenCTM().inverse());};
 const start=point(event);let x=item.x,y=item.y;
 function removeListeners(){rect.removeEventListener('pointermove',move);rect.removeEventListener('pointerup',finish);rect.removeEventListener('pointercancel',cancel);}
 function cancel(){removeListeners();boards();}
 function move(e){
  if(!current()||!canvas.isConnected){cancel();return;}
  const now=point(e);x=Math.round((item.x+now.x-start.x)*10)/10;y=Math.round((item.y+now.y-start.y)*10)/10;
  rect.setAttribute('x',x);rect.setAttribute('y',y);
 }
 const finish=action(()=>{
  removeListeners();if(!current()){boards();return;}
  if(x!==item.x||y!==item.y){
   try{edit(item.storyId?{op:'set-frame',frame:item.id,values:{x,y}}:{op:'set-object',page:page().id,object:item.id,values:{x,y}});}
   catch(error){boards();throw error;}
  }else boards();
 });
 rect.setPointerCapture(event.pointerId);rect.addEventListener('pointermove',move);rect.addEventListener('pointerup',finish);rect.addEventListener('pointercancel',cancel);
}
function inspect(){const p=page(),m=state.model;if(!p)return;$('selection').textContent=`Page ${state.page+1}${state.item?' · '+state.item:''}`;option($('item'),[...p.frames,...p.objects].map(v=>[v.id,(v.storyId?'Frame ':v.kind+' ')+v.id]),state.item);state.item=$('item').value||null;const item=selected();for(const k of ['x','y','width','height'])value(k,item?.[k]);option($('next-frame'),[['','End of story'],...m.pages.flatMap(p=>p.frames).filter(f=>f.id!==item?.id).map(f=>[f.id,f.id])],item?.nextFrame??'');$('link-frame').disabled=!item?.storyId;option($('story'),m.stories.map(s=>[s.id,s.id]),item?.storyId??$('story').value);const story=m.stories.find(s=>s.id===$('story').value);value('story-text',story?.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));for(const id of ['story-paragraph-style','paragraph-style'])option($(id),Object.keys(m.paragraphStyles).map(k=>[k,k]),id==='story-paragraph-style'?story?.paragraphs[0]?.style:$(id).value);for(const id of ['story-character-style','character-style'])option($(id),Object.keys(m.characterStyles).map(k=>[k,k]),id==='story-character-style'?story?.paragraphs[0]?.runs[0]?.style:$(id).value);typography();for(const [id,k]of [['page-width','width'],['page-height','height'],['bleed','bleed'],['margin','margin']])value(id,p[k]);value('guides-x',p.guides.x.join(', '));value('guides-y',p.guides.y.join(', '));option($('master'),[['','No master'],...m.masters.map(v=>[v.id,v.id])],p.masterId??'');value('master-objects',JSON.stringify(m.masters.find(x=>x.id===$('master').value)?.objects??[],null,2));}
function typography(){if(!state.model)return;const c=state.model.characterStyles[$('character-style').value],p=state.model.paragraphStyles[$('paragraph-style').value];if(c){value('font',c.font);value('font-size',c.size);value('font-weight',c.weight);value('font-style',c.style);value('font-color',hex(c.color));}if(p){value('leading',p.leading);value('space-after',p.spaceAfter);value('indent',p.indent);value('align',p.align);}}
function controls(){
 const d=state.document,readOnly=!d||d.revision!==d.currentRevision,blocked=state.busy||readOnly;
 $('properties').disabled=blocked;
 for(const id of trackedFields)$(id).disabled=blocked;
 for(const id of ['item','story','character-style','paragraph-style'])$(id).disabled=blocked;
 for(const id of ['page-view','replace-story','page-properties','character-properties','paragraph-properties','apply-master','add-object','remove-object','add-page','remove-page']){
  const node=$(id);if(node.tagName==='FORM')for(const control of node.elements)control.disabled=blocked;else node.disabled=blocked;
 }
 for(const form of ['new','asset-upload'])for(const control of $(form).elements)control.disabled=state.busy;
 for(const node of document.querySelectorAll('#documents button,#page-rail button'))node.disabled=state.busy;
 for(const id of ['reopen','open-history','restore-history','delete-document','history'])$(id).disabled=state.busy||!d;
 $('save').disabled=blocked||!state.ops.length||!!pendingFields.size;
 $('undo').disabled=state.busy||!state.undo.length;$('redo').disabled=state.busy||!state.redo.length;
 $('render').disabled=blocked||hasDraft()||!!state.job||state.renderStarting;
 $('cancel-render').disabled=state.busy||!state.job;
 $('chat-send').disabled=state.busy||state.chatBusy||hasDraft()||!d;
 $('export-pdf').disabled=state.busy||!d||hasDraft();$('export-layout').disabled=state.busy||!d||hasDraft();
 $('discard-fields').disabled=state.busy||!pendingFields.size;
 $('field-edits').textContent=pendingFields.size?'Unapplied field edits. Apply their form or discard field edits before saving.':'';
 $('chat-context').textContent=d?`Saved revision ${d.revision} · page ${state.page+1}${hasDraft()?' · Apply fields and save your draft before asking for changes.':''}`:'Open a saved publication to share its current selection.';
}
function paint(){const d=state.document;$('document-title').textContent=d?.title??'Create or open a publication';$('revision').textContent=d?`Revision ${d.revision}${d.revision!==d.currentRevision?' · historical':''}${state.ops.length?' · unsaved':''}`:'';if(state.model){state.page=Math.min(state.page,state.model.pages.length-1);value('page-view',state.model.pageView);$('page-rail').replaceChildren(...state.model.pages.map((p,i)=>{const b=document.createElement('button');b.setAttribute('aria-current',String(i===state.page));b.textContent=`Page ${i+1}`;const mini=document.createElement('span');mini.className='page-mini';mini.textContent=`${p.frames.length} frames`;b.append(mini);b.onclick=action(()=>selectPage(i));return b;}));inspect();}boards();controls();}
async function previews(view=viewSnapshot()){
 const d=state.document;if(!d||!sameView(view))return;
 await Promise.all(d.model.pages.map(async(_,i)=>{
  try{
   const blob=await request(`/documents/${view.id}/revisions/${view.revision}/preview/${i+1}`,{blob:true});
   if(!sameView(view))return;
   if(blob.type!=='image/png')throw new Error('Invalid preview content');
   const old=state.previews.get(i+1);if(old)URL.revokeObjectURL(old);
   state.previews.set(i+1,URL.createObjectURL(blob));
  }catch(error){if(sameView(view)&&!/render|not_found|unavailable/.test(error.message))status(error.message,true);}
 }));
 if(sameView(view))boards();
}
async function render(){
 const d=editable();requireAppliedFields();if(state.ops.length)throw new Error('Save the draft before rendering.');
 if(state.renderStarting||state.job)throw new Error('A render is already pending.');
 const view=viewSnapshot(),generation=++state.renderGeneration;
 const current=()=>sameView(view)&&state.renderGeneration===generation;
 state.renderStarting=true;controls();
 try{
  const result=await request(`/documents/${d.id}/render`,{method:'POST',body:{revision:d.revision,requestKey:crypto.randomUUID()}});
  if(!current())return;
  if(result.job.document!==d.id||result.job.revision!==d.revision||result.job.sourceSha256!==d.sha256)throw new Error('Render receipt does not match this saved revision.');
  state.renderStarting=false;state.job=result.job.id;controls();status('Render accepted; waiting for actual PDF and preflight.');
  const id=state.job,deadline=Date.now()+305000;
  while(current()&&state.job===id&&Date.now()<deadline){
   const {job}=await request('/jobs/'+id);
   if(!current()||state.job!==id)return;
   if(job.id!==id||job.document!==view.id||job.revision!==view.revision||job.sourceSha256!==d.sha256)throw new Error('Render status does not match this saved revision.');
   if(['ready','failed','cancelled','expired','abandoned'].includes(job.state)){
    state.job=null;controls();$('preflight').textContent=JSON.stringify(job.result??job,null,2);
    if(job.state==='ready'){status('Render ready. Previews and PDF share the same rendered output.');await previews(view);}
    else status('Render '+job.state,true);
    return;
   }
   await new Promise(resolve=>setTimeout(resolve,600));
   if(!current())return;
  }
  if(current()&&state.job===id){state.job=null;throw new Error('Stopped waiting for render. Reopen the publication to check retained output.');}
 }catch(error){if(current())throw error;}
 finally{if(current()){state.renderStarting=false;controls();}}
}
async function download(kind){
 const d=requireDocument();requireAppliedFields();if(state.ops.length)throw new Error('Save the draft before downloading.');
 const view=viewSnapshot(),blob=await request(`/documents/${d.id}/revisions/${d.revision}/content?format=${kind}`,{blob:true});
 if(!sameView(view)||hasDraft())return;
 const expected=kind==='pdf'?'application/pdf':'application/vnd.oshal.publishing-layout+json';if(!blob.type.startsWith(expected))throw new Error('Unexpected export content');
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${d.title.replace(/[^A-Za-z0-9_-]/g,'_')}.${kind==='pdf'?'pdf':'json'}`;
 a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Downloaded saved revision '+d.revision);
}
function chatLine(text,kind=''){const p=document.createElement('p');p.className=kind;p.textContent=text;$('chat-log').append(p);p.scrollIntoView({block:'nearest'});}
async function heldCard(ref){const id=typeof ref==='string'?ref:ref?.id??ref?.proposalId;if(typeof id!=='string')return;const card=await request('/api/jarvis/package-tools/proposals/'+encodeURIComponent(id),{native:true});const proposal=card.proposal??card;if(proposal.app!=='publishing-studio')return;const section=document.createElement('div');section.className='approval';const title=document.createElement('strong');title.textContent=proposal.toolName??proposal.tool??'Proposed Publishing action';const pre=document.createElement('pre');pre.textContent=JSON.stringify(proposal,null,2);section.append(title,pre);for(const approve of [true,false]){const b=document.createElement('button');b.textContent=approve?'Approve action':'Decline';b.onclick=action(async()=>{requireDocument();requireAppliedFields();if(state.ops.length)throw new Error('Save or discard the local draft before acting on an assistant proposal.');const view=viewSnapshot();const fresh=await request('/api/jarvis/package-tools/proposals/'+encodeURIComponent(id),{native:true});if(!sameView(view)||state.busy||hasDraft())throw new Error('The workspace changed while reviewing the proposal. Review it again.');if(JSON.stringify(fresh.proposal??fresh)!==JSON.stringify(proposal))throw new Error('Proposal changed. Ask again to review a fresh card.');const response=await fetch('/api/jarvis/package-tools/'+(approve?'execute':'decline'),{method:'POST',credentials:'same-origin',headers:{...headers(true),'x-oshal-package-tool':'1'},body:JSON.stringify({proposalId:id})});const result=await response.json();if(!response.ok)throw new Error(result.error??'Proposal action failed');section.replaceChildren(document.createTextNode((approve?'Action result: ':'Declined: ')+JSON.stringify(result)));if(approve&&sameView(view)&&!state.busy&&!hasDraft()){await open(view.id);await refresh();}});section.append(b);}$('chat-log').append(section);}
bind('chat-form','submit',async()=>{const d=requireDocument();if(state.chatBusy)throw new Error('Wait for the assistant to finish this turn.');requireAppliedFields();if(state.ops.length)throw new Error('Save your draft before sharing its context.');const text=$('chat-message').value.trim();if(!text)return;const view=viewSnapshot();const context={app:'publishing-studio',documentId:d.id,revision:d.revision,selectedPage:page().id,selectedFrame:selected()?.storyId?state.item:null};chatLine(text,'chat-you');$('chat-message').value='';state.chatBusy=true;controls();try{const result=await request('/api/swarm/bots/publishing-editor/ask',{native:true,method:'POST',body:{message:text+'\nCurrent saved selection: '+JSON.stringify(context),...(state.session?{sessionId:state.session}:{}),context}});if(!sameView(view)){chatLine('The assistant replied for a previous saved publication. Reopen that publication and ask again to review its actions.');return;}state.session=result.sessionId??state.session;chatLine(result.reply??result.error??'The assistant returned no text.');for(const ref of (Array.isArray(result.packageToolProposals)?result.packageToolProposals:[result.packageToolProposal]).filter(Boolean))await heldCard(ref);}finally{state.chatBusy=false;controls();}});
bind('new','submit',async()=>{
 if(state.busy)throw new Error('Wait for the current save or open to finish.');if(!dirtyPrompt())return;
 const input={title:$('new-title').value,pageCount:number('new-pages')},signature=JSON.stringify(input);
 if(state.createAttempt?.signature!==signature)state.createAttempt={signature,key:crypto.randomUUID()};
 await locked(async()=>{
  const result=await request('/documents',{method:'POST',body:{...input,requestKey:state.createAttempt.key}});
  await loadDocument(result.document.id);state.createAttempt=null;await refresh();
 });
});
bind('refresh','click',refresh);bind('save','click',save);bind('render','click',render);bind('reopen','click',()=>open(requireDocument().id));bind('export-pdf','click',()=>download('pdf'));bind('export-layout','click',()=>download('layout'));
bind('cancel-render','click',async()=>{
 requireDocument();const id=state.job,view=viewSnapshot(),generation=state.renderGeneration;if(!id)return;
 await request('/jobs/'+id+'/cancel',{method:'POST',body:{}});
 if(!sameView(view)||state.renderGeneration!==generation||state.job!==id)return;
 retireRender();controls();status('Render cancelled.');
});
for(const[id,from,to]of [['undo','undo','redo'],['redo','redo','undo']])bind(id,'click',()=>{editable();if(!guardFields())return;const prior=state[from].pop();if(!prior)return;state[to].push({model:state.model,ops:state.ops});state.model=prior.model;state.ops=prior.ops;state.saveKey=null;paint();});
bind('page-view','change',()=>edit({op:'set-view',pageView:$('page-view').value}));bind('item','change',()=>changeSelection('item',()=>{state.item=$('item').value;inspect();boards();}));bind('story','change',()=>changeSelection('story',()=>{const s=state.model.stories.find(s=>s.id===$('story').value);value('story-text',s?.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));value('story-paragraph-style',s?.paragraphs[0]?.style);value('story-character-style',s?.paragraphs[0]?.runs[0]?.style??Object.keys(state.model.characterStyles)[0]);}));bind('character-style','change',()=>changeSelection('character-style',typography));bind('paragraph-style','change',()=>changeSelection('paragraph-style',typography));
bind('geometry','submit',()=>{const item=selected();if(!item)throw new Error('Select an item.');const values=Object.fromEntries(['x','y','width','height'].map(k=>[k,number(k)]));edit(item.storyId?{op:'set-frame',frame:item.id,values}:{op:'set-object',page:page().id,object:item.id,values},fields.geometry);});
bind('link-frame','click',()=>{const item=selected();if(!item?.storyId)throw new Error('Select a text frame.');edit({op:'set-link',frame:item.id,nextFrame:$('next-frame').value||null},fields.link);});
bind('replace-story','click',()=>edit({op:'replace-story',story:$('story').value,paragraphs:$('story-text').value.split('\n').map(text=>({style:$('story-paragraph-style').value,runs:[{text,style:$('story-character-style').value}]}))},fields.story));
bind('page-properties','submit',()=>{const guides=id=>$(id).value.trim()?$(id).value.split(',').map(s=>{const n=Number(s.trim());if(!Number.isFinite(n))throw new Error('Guides must be comma-separated numbers.');return n;}):[];edit({op:'set-page',page:page().id,values:{width:number('page-width'),height:number('page-height'),bleed:number('bleed'),margin:number('margin'),guides:{x:guides('guides-x'),y:guides('guides-y')},masterId:$('master').value||null}},fields.page);});
bind('master','change',()=>{
 const previous=selectionValues.get('master'),next=$('master').value;
 if(pendingFields.has('master-objects')&&!confirm('Discard unapplied master object edits before selecting another master?')){
  $('master').value=previous;
  if(previous===fieldBaselines.get('master'))pendingFields.delete('master');else pendingFields.set('master',previous);
  controls();return;
 }
 pendingFields.delete('master-objects');selectionValues.set('master',next);
 value('master-objects',JSON.stringify(state.model.masters.find(master=>master.id===next)?.objects??[],null,2));
 controls();
});
bind('apply-master','click',()=>{if(!$('master').value)throw new Error('Select a master first.');edit({op:'set-master',master:$('master').value,objects:JSON.parse($('master-objects').value)},fields.master);});
bind('character-properties','submit',()=>edit({op:'set-character-style',name:$('character-style').value,values:{font:$('font').value,size:number('font-size'),weight:number('font-weight'),style:$('font-style').value,color:rgb($('font-color').value)}},fields.character));
bind('paragraph-properties','submit',()=>edit({op:'set-paragraph-style',name:$('paragraph-style').value,values:{leading:number('leading'),spaceAfter:number('space-after'),indent:number('indent'),align:$('align').value}},fields.paragraph));
bind('asset-upload','submit',async()=>{const file=$('asset-file').files[0];if(!file||file.size>4194304)throw new Error('Choose a PNG or JPEG up to 4 MiB.');const body=new FormData();body.append('file',file);body.append('title',$('asset-title').value);body.append('requestKey',crypto.randomUUID());await request('/assets/upload',{method:'POST',body});await refresh();status('Asset uploaded. Choose Image to place it on the page.');});
bind('add-object','click',()=>{editable();const p=page(),kind=$('object-kind').value,id=uid(kind),style=$('story-paragraph-style').value,character=$('story-character-style').value;layout(m=>{const target=m.pages[state.page],geometry={id,x:p.margin,y:p.margin,width:Math.min(120,p.width-2*p.margin),height:Math.min(60,p.height-2*p.margin)};if(kind==='frame'){const storyId=uid('story');target.frames.push({...geometry,width:p.width-2*p.margin,height:Math.min(120,p.height-2*p.margin),storyId,nextFrame:null});m.stories.push({id:storyId,firstFrame:id,paragraphs:[{style,runs:[{text:'New story',style:character}]}]});}else{const object={...geometry,kind};if(kind==='image'){const asset=state.assets.find(a=>a.id===$('object-asset').value);if(!asset)throw new Error('Upload and select an image first.');object.assetId=asset.id;if(!m.assets.some(a=>a.id===asset.id))m.assets.push(Object.fromEntries(['id','sha256','bytes','mime'].map(k=>[k,asset[k]])));}if(kind==='rect')object.color=rgb($('object-color').value);if(kind==='text')object.paragraph={style,runs:[{text:$('object-text').value||'Text',style:character}]};if(kind==='number')object.style=character;target.objects.push(object);}},fields.object);if(!pendingFields.size)state.item=id;paint();});
bind('remove-object','click',()=>{const item=selected();if(!item)throw new Error('Select an item.');if(!guardFields())return;layout(m=>{const p=m.pages[state.page];p.objects=p.objects.filter(o=>o.id!==item.id);p.frames=p.frames.filter(f=>f.id!==item.id);for(const f of m.pages.flatMap(p=>p.frames))if(f.nextFrame===item.id)f.nextFrame=item.nextFrame??null;const story=m.stories.find(s=>s.id===item.storyId);if(story?.firstFrame===item.id){if(item.nextFrame)story.firstFrame=item.nextFrame;else m.stories=m.stories.filter(s=>s.id!==story.id);}});});
bind('add-page','click',()=>{editable();if(!guardFields())return;if(state.model.pages.length>=8)throw new Error('This profile supports up to eight pages.');layout(m=>{const p=copy(page());p.id=uid('page');p.objects=[];p.frames=[];m.pages.push(p);});state.page=state.model.pages.length-1;paint();});
bind('remove-page','click',()=>{editable();if(!guardFields())return;if(state.model.pages.length===1)throw new Error('Keep at least one page.');if(page().frames.length)throw new Error('Remove or relink this page’s text frames first.');layout(m=>m.pages.splice(state.page,1));});
bind('open-history','click',()=>open(requireDocument().id,number('history')));
bind('restore-history','click',async()=>{
 const d=requireDocument();if(!dirtyPrompt())return;
 const body={baseRevision:d.currentRevision,restoreRevision:number('history')},signature=JSON.stringify([d.id,body]);
 if(state.restoreAttempt?.signature!==signature)state.restoreAttempt={signature,key:crypto.randomUUID()};
 await locked(async()=>{
  const result=await request(`/documents/${d.id}/revisions`,{method:'POST',body:{...body,requestKey:state.restoreAttempt.key}});
  await loadDocument(result.document.id);state.restoreAttempt=null;
 });
});
bind('delete-document','click',async()=>{
 const d=requireDocument();if(!confirm('Delete this publication and its saved revisions, including any local draft and field edits?'))return;
 await locked(async()=>{
  await request('/documents/'+d.id,{method:'DELETE',body:{}});
  clearPreviews();retireRender();state.viewGeneration++;clearFieldBuffers();
  state.document=null;state.model=null;state.ops=[];state.undo=[];state.redo=[];state.saveKey=null;
  $('preflight').textContent='';paint();await refresh();
 });
});

for(const id of trackedFields){
 const node=$(id);fieldBaselines.set(id,node.value);
 const changed=()=>{
  if(state.busy||node.disabled)return;
  if(node.value===fieldBaselines.get(id))pendingFields.delete(id);else pendingFields.set(id,node.value);
  controls();
 };
 node.addEventListener('input',changed);node.addEventListener('change',changed);
}
bind('discard-fields','click',discardFields);

window.addEventListener('beforeunload',event=>{if(hasDraft()){event.preventDefault();event.returnValue='';}});
paint();action(async()=>{await refresh();const id=new URL(location.href).searchParams.get('document');if(id)await open(id);else status('Create a publication or choose one of your saved files.');})();
