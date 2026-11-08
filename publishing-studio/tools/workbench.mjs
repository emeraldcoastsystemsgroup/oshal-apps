/* Publishing Studio: local geometry drafts; the pinned renderer owns all text flow.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve unapplied inspector buffers and pin asynchronous operations to their saved document context.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Apply and save inspector drafts before concierge reads; refresh the same native publication while retaining concurrent drafts and selection.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep full-model undo across saves and same-document assistant refresh, retaining dirty and switched-document guards.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Use the shared pinned concierge and native approval presenter with the same saved selection and history.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the oshal design standard (docs/ux/design-standard.md §4.4, §4.8, §5.1; CONVENTIONS §5.5; Roger F6). What you type in a text frame is drawn in that frame on the page at once (the story's own font, size, weight, colour and alignment; master headers and page numbers too), while the renderer still owns exact flow and the PDF: a rendered revision shows its pages, a draft shows the drawn text. Typing in the Text sheet edits the story as you type (one undo step per burst). Render & preflight and Download PDF run on the current draft and save it first by themselves, so neither waits for Save revision; Download PDF renders when the revision has no render yet. With no publication the editor shows one blank Letter page (nothing saved yet); its first Add text frame makes an untitled Letter publication and puts the frame on it, ready to type. Nothing is selected until a frame is tapped, so the tool row shows the page's tools. Choices that would lose a draft confirm in the page, never in a browser dialog; a selection change with unapplied form fields is refused with how to fix it. Previews are still asked for only when the opened revision was rendered (B8 round 3, no 409s).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.3.7, touch (the round-2 trial check, 2026-11-06: a swipe over the page dragged the story frame and never scrolled): a finger scrolls the page and a tap selects a frame; only the chosen frame's Move handle drags it by touch, as in the reference editors (Canva's selected element, Acrobat's deliberate grab); a mouse still drags outlines directly. Previews are asked for only when the opened revision was rendered (no 409 per page).
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: support multi-select and group selection/drag, nullable metadata cleanup in localApply, Liberation Sans and Liberation Mono font stacks, MP4 export download, and shell hooks for comments and timeline (RP-PUB-01..08).
 */
import {bindPublishingFoundation,publishingSelection} from './editor-foundation-adapter.mjs';
let editorFoundation;
const $=id=>document.getElementById(id),base='/api/publishing-studio',copy=value=>structuredClone(value),uid=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
const state={document:null,model:null,ops:[],undo:[],redo:[],page:0,item:null,selectedIds:new Set(),multiSelect:false,comments:[],assets:[],previews:new Map(),busy:false,renderStarting:false,job:null,videoJob:null,saveKey:null,viewGeneration:0,renderGeneration:0,createAttempt:null,restoreAttempt:null,rendered:false,videoRendered:false,liveKey:null,newSize:null,documents:[],view:'editor',loaded:false};
// The page's own layers (publishing-shell.mjs): an in-page confirm and hooks after each paint/open. Until the shell is ready nothing is discarded.
const ui={confirm:async()=>false,painted:()=>{},decorateBoard:null,onDocumentLoaded:null};
/** The blank page shown before anything is saved: US Letter with its margins (design standard §5.1). */
const BLANK_PAGE={id:'blank',width:612,height:792,bleed:9,margin:54,guides:{x:[54,558],y:[54,738]},masterId:null,objects:[],frames:[]};

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
const boundActions=new Map();
let workspaceIdle=null;
function rememberField(node){
 if(!trackedFields.has(node.id))return;
 fieldBaselines.set(node.id,node.value);
 if(pendingFields.has(node.id)){
  if(pendingFields.get(node.id)===node.value)pendingFields.delete(node.id);
  else node.value=pendingFields.get(node.id);
 }
}
function hasDraft(){return state.ops.length>0||pendingFields.size>0||Boolean(editorFoundation?.hasPending());}
function requireAppliedFields(){if(pendingFields.size)throw new Error('Apply or discard the field edits before continuing.');}
function clearFieldBuffers(){
 for(const id of pendingFields.keys())if(fieldBaselines.has(id))$(id).value=fieldBaselines.get(id);
 pendingFields.clear();
}
function discardFields(){clearFieldBuffers();paint();}
function guardFields(){
 if(editorFoundation?.hasPending())throw new Error('Apply or discard the selected property draft before changing the selection.');
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 // A browser dialog is never used (design standard DS-30): the person applies the form or presses Discard field edits.
 if(pendingFields.size)throw new Error('Apply the changed fields, or press Discard field edits, before choosing something else.');
 return true;
}
function changeSelection(id,work){
 const previous=selectionValues.get(id),next=$(id).value;
 if(!guardFields()){if(previous!==undefined)$(id).value=previous;return;}
 selectionValues.set(id,next);work();controls();
}
function groupMembers(p,itemId){
 if(!p||!itemId)return[];
 const found=[...p.frames,...p.objects].find(v=>v.id===itemId);if(!found)return[];
 return found.groupId?[...p.frames,...p.objects].filter(v=>v.groupId===found.groupId).map(v=>v.id):[itemId];
}
function selectPage(index,item=null,additive=false){
 const p=state.model?.pages[index],members=groupMembers(p,item),useMulti=Boolean(item&&(additive||state.multiSelect));
 if(!useMulti&&state.page===index&&state.item===item&&state.selectedIds.size===members.length&&members.every(id=>state.selectedIds.has(id)))return true;
 if(!guardFields())return false;
 if(state.page!==index)state.selectedIds.clear();
 state.page=index;state.liveKey=null;
 if(!item){state.item=null;state.selectedIds.clear();state.multiSelect=false;}
 else if(useMulti){
  const hasAll=members.every(id=>state.selectedIds.has(id));
  if(hasAll&&state.selectedIds.size>members.length){for(const id of members)state.selectedIds.delete(id);state.item=[...state.selectedIds].at(-1)??null;}
  else{for(const id of members)state.selectedIds.add(id);state.item=item;}
 }else{state.selectedIds=new Set(members);state.item=item;}
 paint();return true;
}
function viewSnapshot(){return{id:state.document?.id,revision:state.document?.revision,generation:state.viewGeneration};}
function sameView(view){return state.document?.id===view.id&&state.document?.revision===view.revision&&state.viewGeneration===view.generation;}
function retireRender(){state.renderGeneration++;state.renderStarting=false;state.job=null;}
async function locked(work){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 state.busy=true;controls();
 let release;workspaceIdle=new Promise(resolve=>{release=resolve;});
 try{return await work();}finally{state.busy=false;controls();workspaceIdle=null;release();}
}

function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);editorFoundation?.refresh();}
function headers(json=false){const out={};if(json)out['Content-Type']='application/json';const token=sessionStorage.getItem('oshal.token');if(token)out.Authorization='Bearer '+token;return out;}
async function request(path,{method='GET',body,blob=false,native=false}={}){const response=await fetch(native?path:base+path,{method,headers:headers(body!==undefined&&!(body instanceof FormData)),credentials:'same-origin',...(body!==undefined?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});if(!response.ok){let value;try{value=await response.json();}catch{}const error=new Error(value?.error??`Request failed (${response.status})`);error.details=value?.details;throw error;}return blob?response.blob():response.json();}
function action(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){status(error.message,true);if(error.details)$('preflight').textContent=JSON.stringify(error.details,null,2);}};}
function bind(id,event,fn){boundActions.set(id+':'+event,fn);$(id).addEventListener(event,action(fn));}
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
function assignLocal(target,values,nullable=[]){for(const[k,v]of Object.entries(values))if(v===null&&nullable.includes(k))delete target[k];else target[k]=copy(v);}
function localApply(model,op){if(op.op==='replace-model')return copy(op.model);const m=copy(model),p=m.pages.find(p=>p.id===op.page);switch(op.op){case'set-frame':assignLocal(m.pages.flatMap(p=>p.frames).find(f=>f.id===op.frame),op.values,['groupId','animation']);break;case'set-link':m.pages.flatMap(p=>p.frames).find(f=>f.id===op.frame).nextFrame=op.nextFrame;break;case'replace-story':m.stories.find(s=>s.id===op.story).paragraphs=copy(op.paragraphs);break;case'set-character-style':m.characterStyles[op.name]=copy(op.values);break;case'set-paragraph-style':m.paragraphStyles[op.name]=copy(op.values);break;case'set-page':assignLocal(p,op.values,['duration']);break;case'set-object':assignLocal(p.objects.find(o=>o.id===op.object),op.values,['groupId','animation']);break;case'set-master':m.masters.find(x=>x.id===op.master).objects=copy(op.objects);break;case'set-view':m.pageView=op.pageView;break;case'replace-layout':for(const k of ['pages','masters','stories','assets'])m[k]=copy(op[k]);break;default:throw new Error('Unsupported draft operation');}return m;}
function rememberHistory(stack,model){stack.push({model});if(stack.length>100)stack.shift();}
const modelJSON=model=>JSON.stringify(model,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
function operationsFor(model){return modelJSON(model)===modelJSON(state.document.model)?[]:[{op:'replace-model',model:copy(model)}];}
function edit(op,consumed=[],live=null){
 editable();
 // One burst of typing in the same story is one draft operation and one undo step.
 const same=live&&state.liveKey===live&&state.ops.at(-1)?.op===op.op&&state.ops.at(-1)?.story===op.story;
 if(!same&&state.ops.length>=64)throw new Error('Save this revision before making more edits.');
 const model=localApply(state.model,op);
 for(const id of consumed){pendingFields.delete(id);fieldBaselines.set(id,$(id).value);}
 if(!same)rememberHistory(state.undo,state.model);state.model=model;
 state.ops=same?[...state.ops.slice(0,-1),op]:[...state.ops,op];state.redo=[];state.saveKey=null;state.liveKey=live;
 if(live){revisionText();boards();}else paint();controls();
}
function revisionText(){const d=state.document;$('revision').textContent=d?`Revision ${d.revision}${d.revision!==d.currentRevision?' · historical':''}${state.ops.length?' · unsaved':''}`:'';}
/** The Text sheet's story text, applied as the person types (WYSIWYG: the frame draws it at once). */
function liveStory(){
 if(!state.document||!$('story').value)return;editable();
 const paragraphs=$('story-text').value.split('\n').map(text=>({style:$('story-paragraph-style').value,runs:[{text,style:$('story-character-style').value}]}));
 edit({op:'replace-story',story:$('story').value,paragraphs},fields.story,'story:'+$('story').value);
}
function hasContent(){const m=state.model;return Boolean(m&&(m.pages.some(p=>p.frames.length||p.objects.length)||m.masters.some(x=>x.objects.length)));}
function layout(mutator,consumed=[]){const m=copy(state.model);mutator(m);edit({op:'replace-layout',...Object.fromEntries(['pages','masters','stories','assets'].map(k=>[k,m[k]]))},consumed);}
function clearPreviews(){for(const url of state.previews.values())URL.revokeObjectURL(url);state.previews.clear();}
async function dirtyPrompt(){return !hasDraft()||ui.confirm({title:'Discard your changes?',text:'Your unsaved changes and field edits will be lost.',action:'Discard changes'});}
async function loadDocument(id,revision,retained={}){
 const result=retained.result??await request('/documents/'+id+(revision?'?revision='+revision:''));
 // Only callers holding the workspace lock adopt an HTTP response.
 // Callers have confirmed replacement; failed reads retain the current field draft.
 editorFoundation?.discardPending();
 clearPreviews();retireRender();state.viewGeneration++;clearFieldBuffers();
 if(retained.keepHistory){if(modelJSON(state.model)!==modelJSON(result.document.model)){rememberHistory(state.undo,state.model);state.redo=[];}}else{state.undo=[];state.redo=[];}
 state.document=result.document;state.model=copy(result.document.model);state.ops=[];state.saveKey=null;state.liveKey=null;state.rendered=Boolean(result.rendered);state.videoRendered=Boolean(result.videoRendered);state.multiSelect=false;state.comments=[];state.view='editor';
 state.page=Math.max(0,state.model.pages.findIndex(page=>page.id===retained.pageId));
 state.item=[...state.model.pages[state.page].frames,...state.model.pages[state.page].objects].some(item=>item.id===retained.item)?retained.item:null;
 state.selectedIds=new Set(groupMembers(state.model.pages[state.page],state.item));
 $('item').value=state.item??'';
 $('preflight').textContent='';
 option($('history'),result.history.map(v=>[v.revision,`Revision ${v.revision}`]),result.document.revision);
 paint();status('Opened saved revision '+result.document.revision);
 void ui.onDocumentLoaded?.(viewSnapshot());
 if(result.rendered)await previews(viewSnapshot());
}
async function open(id,revision){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 if(!await dirtyPrompt())return;
 return locked(()=>loadDocument(id,revision));
}
async function refresh(){const [docs,assets]=await Promise.all([request('/documents'),request('/assets')]);state.assets=assets.assets;state.documents=docs.documents;$('documents').replaceChildren(...docs.documents.map(card));$('asset-list').replaceChildren(...state.assets.map(a=>{const row=document.createElement('p');row.textContent=`${a.title} · ${a.bytes} bytes `;const remove=document.createElement('button');remove.type='button';remove.className='pub-secondary pub-danger';remove.textContent='Delete';remove.dataset.dsDestructive='';remove.onclick=action(async()=>{if(await ui.confirm({title:'Delete this image?',text:'Saved revisions keep the images they already use.',action:'Delete image'})){await request('/assets/'+a.id,{method:'DELETE',body:{}});await refresh();}});row.append(remove);return row;}));option($('object-asset'),state.assets.map(a=>[a.id,a.title]),$('object-asset').value);editorFoundation?.refresh();}
/** One publication in Your publications: a paper thumbnail, its title (two lines at most) and when it changed (design standard §4.5). */
function card(d){const b=document.createElement('button');b.type='button';b.className='pub-card';const paper=document.createElement('span'),title=document.createElement('span'),when=document.createElement('span');paper.className='pub-paper';paper.setAttribute('aria-hidden','true');title.className='pub-card-title';title.textContent=d.title;when.className='pub-card-meta';when.textContent=d.updatedAt?new Date(d.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';b.append(paper,title,when);b.onclick=action(()=>open(d.id));return b;}
async function save({preserveFields=false}={}){
 await editorFoundation?.flushPending();
 const d=editable();if(!preserveFields)requireAppliedFields();if(!state.ops.length)return;
 state.saveKey??=crypto.randomUUID();
 const body={baseRevision:d.revision,requestKey:state.saveKey,operations:copy(state.ops)};
 return locked(async()=>{
  const result=await request(`/documents/${d.id}/revisions`,{method:'POST',body});
  state.document=result.document;state.model=copy(result.document.model);state.ops=[];
  state.saveKey=null;state.liveKey=null;state.rendered=false;state.videoRendered=false;state.viewGeneration++;retireRender();clearPreviews();
  $('preflight').textContent='';paint();status('Saved revision '+state.document.revision);
  await refresh();const saved=await request('/documents/'+d.id);
  option($('history'),saved.history.map(v=>[v.revision,`Revision ${v.revision}`]),state.document.revision);
 });
}
function svg(name,attributes={}){const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);return node;}
// Rebuilding the boards removes the outline that holds focus (a tap or a click focuses it). Removing a focused node makes the
// browser lay the page out while #spread is empty, which clamped the editor's scroll to the top on every tap (the round-2
// trial check, 2026-11-06). Blur first, rebuild, then give the same outline its focus back without scrolling.
function boards(){
 const target=$('spread'),held=document.activeElement?.closest?.('#spread [data-item]')?.dataset.item;
 if(held)document.activeElement.blur();target.replaceChildren();
 if(held)queueMicrotask(()=>target.querySelector(`[data-item="${CSS.escape(held)}"]`)?.focus({preventScroll:true}));
 // Nothing saved yet: one blank Letter page with its margins, ready for Add text frame (design standard §5.1).
 if(!state.model){if(state.view==='editor')target.append(board(null,BLANK_PAGE,0,false));ui.painted();return;}
 const indexes=state.model.pageView==='facing'?[state.page-state.page%2,state.page-state.page%2+1].filter(i=>i<state.model.pages.length):[state.page];
 for(const i of indexes)target.append(board(state.model,state.model.pages[i],i,indexes.length>1));
 ui.painted();
}
const fontStack=font=>font==='Liberation Mono'?"'Liberation Mono',ui-monospace,monospace":font==='Liberation Sans'?"'Liberation Sans',system-ui,sans-serif":"'Libertinus Serif',Georgia,'Times New Roman',serif";
const rgbCss=color=>`rgb(${color.map(v=>Math.round(v)).join(' ')})`;
/** One paragraph as the renderer would set it: its paragraph style (alignment, indent, space after) and each run's character style. */
function paragraphNode(m,paragraph,fallback){
 const p=document.createElement('p'),ps=m.paragraphStyles[paragraph.style]??{leading:3,spaceAfter:6,indent:0,align:'left'};let line=0;
 p.style.cssText=`margin:0 0 ${ps.spaceAfter}px;text-indent:${ps.indent}px;text-align:${ps.align};white-space:pre-wrap;overflow-wrap:anywhere`;
 for(const run of paragraph.runs){
  const cs=m.characterStyles[run.style??fallback??'default']??m.characterStyles.default,span=document.createElement('span');
  span.textContent=run.text;span.style.cssText=`font-family:${fontStack(cs.font)};font-size:${cs.size}px;font-weight:${cs.weight};font-style:${cs.style};color:${rgbCss(cs.color)}`;
  line=Math.max(line,cs.size+ps.leading);p.append(span);
 }
 p.style.lineHeight=line+'px';if(!paragraph.runs.some(run=>run.text))p.append(document.createElement('br'));
 return p;
}
/** WYSIWYG: an item's text drawn inside its own box on the page (clipped to it, never catching a tap). */
function textBox(m,item,paragraphs,fallback){
 const box=svg('foreignObject',{x:item.x,y:item.y,width:Math.max(1,item.width),height:Math.max(1,item.height),class:'pub-text','data-text-for':item.id,'data-visual-item':item.id});
 const body=document.createElement('div');body.className='pub-text-body';for(const paragraph of paragraphs)body.append(paragraphNode(m,paragraph,fallback));box.append(body);return box;
}
function drawText(m,p,i,item){
 if(item.storyId){const story=m.stories.find(s=>s.id===item.storyId);return story&&story.firstFrame===item.id?textBox(m,item,story.paragraphs):null;}
 if(item.kind==='text')return textBox(m,item,[item.paragraph]);
 if(item.kind==='number')return textBox(m,item,[{style:Object.keys(m.paragraphStyles)[0],runs:[{text:String(i+1),style:item.style}]}],item.style);
 if(item.kind==='rect')return svg('rect',{x:item.x,y:item.y,width:item.width,height:item.height,fill:rgbCss(item.color),class:'pub-fill','data-visual-item':item.id});
 if(item.kind==='image')return svg('image',{x:item.x,y:item.y,width:item.width,height:item.height,href:`${base}/assets/${item.assetId}/content`,preserveAspectRatio:'xMidYMid slice','data-visual-item':item.id});
 return null;
}
function board(m,p,i,facing){
 const pad=p.bleed+12,section=document.createElement('div'),rendered=Boolean(m)&&!state.ops.length&&state.previews.has(i+1);let chosen=null;
 section.className='page-board'+(facing?' facing':'');section.dataset.pageIndex=String(i);
 const canvas=svg('svg',{viewBox:`${-pad} ${-pad} ${p.width+2*pad} ${p.height+2*pad}`,role:'img','aria-label':m?`Page ${i+1}`:'A blank Letter page'});
 canvas.append(svg('rect',{x:0,y:0,width:p.width,height:p.height,class:'paper'}));
 if(rendered)canvas.append(svg('image',{href:state.previews.get(i+1),x:-pad,y:-pad,width:p.width+2*pad,height:p.height+2*pad}));
 canvas.append(svg('rect',{x:0,y:0,width:p.width,height:p.height,class:'trim-line'}),svg('rect',{x:p.margin,y:p.margin,width:Math.max(0,p.width-2*p.margin),height:Math.max(0,p.height-2*p.margin),class:'margin-line'}));
 for(const x of p.guides.x)canvas.append(svg('line',{x1:x,y1:0,x2:x,y2:p.height,class:'guide-line'}));
 for(const y of p.guides.y)canvas.append(svg('line',{x1:0,y1:y,x2:p.width,y2:y,class:'guide-line'}));
 if(m&&!rendered){
  // The draft draws what the renderer will set: master items, the page's own objects, then each story in its first frame.
  const master=p.masterId?m.masters.find(x=>x.id===p.masterId)?.objects??[]:[];
  for(const item of [...master,...p.objects,...p.frames]){const drawn=drawText(m,p,i,item);if(drawn)canvas.append(drawn);}
 }
 for(const item of m?[...p.objects,...p.frames]:[]){
  const isSel=i===state.page&&(item.id===state.item||state.selectedIds.has(item.id));
  const rect=svg('rect',{x:item.x,y:item.y,width:item.width,height:item.height,class:'selection-box','data-selected':isSel,'data-multi-selected':i===state.page&&state.selectedIds.size>1&&state.selectedIds.has(item.id),'data-item':item.id,...(item.groupId?{'data-group-id':item.groupId}:{}),...(item.animation?{'data-anim-preset':item.animation.preset}:{}),tabindex:0,'aria-label':item.storyId?'Text frame':item.kind==='rect'?'Shape':item.kind==='image'?'Image':item.kind==='number'?'Page number':'Text'});
  rect.addEventListener('keydown',action(e=>{if(e.key==='Enter')selectPage(i,item.id,e.shiftKey);}));
  rect.addEventListener('click',action(event=>{event.stopPropagation();const add=Boolean(event.shiftKey||state.multiSelect);if(add||state.page!==i||state.item!==item.id)selectPage(i,item.id,add);}));
  const grab=action(event=>drag(event,canvas,rect,item,i));rect.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'&&!event.shiftKey&&!state.multiSelect)grab(event);});
  if(i===state.page&&item.id===state.item)chosen={item,rect};canvas.append(rect);
 }
 // A tap on the page itself (not on an item) chooses that page and clears the selection.
 if(m)canvas.addEventListener('click',action(()=>{if(state.page!==i||state.item)selectPage(i);}));
 section.append(canvas);if(m){const label=document.createElement('div');label.className='page-label';label.textContent=`Page ${i+1}`;section.append(label);}
 if(chosen){section.append(moveHandle(canvas,chosen,p,i));const tools=ui.float?.(chosen.item);if(tools)section.append(floatOverlay(tools,p,chosen.item));}
 ui.decorateBoard?.(section,p,i);
 return section;
}
/** The selection bar (design standard N4): a small opaque float at the chosen item's top right, or under it near the page top. */
function floatOverlay(tools,p,item){
 const pad=p.bleed+12,overlay=document.createElement('div'),W=p.width+2*pad,H=p.height+2*pad,below=item.y+pad<64;
 overlay.className='page-overlay pub-float-layer';overlay.style.aspectRatio=`${W} / ${H}`;
 tools.style.left=Math.min(100,(item.x+item.width+pad)/W*100)+'%';tools.style.top=((below?item.y+item.height:item.y)+pad)/H*100+'%';tools.dataset.place=below?'below':'above';
 // A small item near the page's left edge: the float starts at the item instead of running off the screen.
 requestAnimationFrame(()=>{if(tools.isConnected&&tools.getBoundingClientRect().left<8){tools.style.left=(item.x+pad)/W*100+'%';tools.dataset.align='start';}});
 overlay.append(tools);return overlay;
}
// Touch scrolls the page (the page's touch-action is manipulation; a finger on a frame only selects it on tap).
// The chosen frame or object carries one finger-sized Move handle: grabbing it on purpose is what drags.
// A mouse still drags any outline directly (desktop behaviour unchanged).
function placeHandle(handle,p,x,y){const pad=p.bleed+12;handle.style.left=(x+pad)/(p.width+2*pad)*100+'%';handle.style.top=(y+pad)/(p.height+2*pad)*100+'%';}
function moveHandle(canvas,{item,rect},p,index){
 const pad=p.bleed+12,overlay=document.createElement('div'),handle=document.createElement('button'),name=item.storyId?'frame '+item.id:item.kind+' '+item.id;
 overlay.className='page-overlay';overlay.style.aspectRatio=`${p.width+2*pad} / ${p.height+2*pad}`;
 handle.type='button';handle.className='frame-handle';handle.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3m-3 15-3-3m3 3 3-3M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';handle.setAttribute('aria-label','Move '+name);handle.title='Drag to move '+name;
 placeHandle(handle,p,item.x,item.y);handle.disabled=state.busy||!state.document||state.document.revision!==state.document.currentRevision;
 handle.addEventListener('pointerdown',action(event=>drag(event,canvas,rect,item,index,(x,y)=>placeHandle(handle,p,x,y))));
 overlay.append(handle);return overlay;
}
function moveGroupTargets(p,ids,dx,dy){
 const clamp=(v,lo,hi)=>Math.round(Math.max(lo,Math.min(hi,v))*10)/10;
 for(const f of p.frames)if(ids.has(f.id)){f.x=clamp(f.x+dx,0,p.width-f.width);f.y=clamp(f.y+dy,0,p.height-f.height);}
 for(const o of p.objects)if(ids.has(o.id)){o.x=clamp(o.x+dx,-p.bleed,p.width+p.bleed-o.width);o.y=clamp(o.y+dy,-p.bleed,p.height+p.bleed-o.height);}
}
function drag(event,canvas,rect,item,index,follow){
 if(event.button!==0||state.busy)return;
 editable();event.stopPropagation();
 if((state.page!==index||state.item!==item.id)&&!guardFields())return;
 const p=state.model.pages[index],keepMulti=state.page===index&&state.selectedIds.has(item.id)&&state.selectedIds.size>1;
 const moving=new Set(keepMulti?state.selectedIds:groupMembers(p,item.id));
 state.page=index;state.item=item.id;state.selectedIds=new Set(moving);inspect();controls();
 for(const outline of $('spread').querySelectorAll('[data-selected]'))outline.dataset.selected=String(outline.closest('.page-board')===canvas.parentElement&&moving.has(outline.dataset.item));
 const peers=[...moving].map(id=>{const it=[...p.frames,...p.objects].find(v=>v.id===id);return{it,node:canvas.querySelector(`[data-item="${CSS.escape(id)}"]`)};}).filter(v=>v.it&&v.node);
 const view=viewSnapshot(),model=state.model;
 const current=()=>sameView(view)&&state.model===model&&state.page===index&&state.item===item.id&&!state.busy;
 const point=e=>{const pt=canvas.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(canvas.getScreenCTM().inverse());};
 const start=point(event);let x=item.x,y=item.y,dx=0,dy=0;
 function removeListeners(){rect.removeEventListener('pointermove',move);rect.removeEventListener('pointerup',finish);rect.removeEventListener('pointercancel',cancel);}
 function cancel(){removeListeners();boards();}
 function move(e){
  if(!current()||!canvas.isConnected){cancel();return;}
  const now=point(e);dx=Math.round((now.x-start.x)*10)/10;dy=Math.round((now.y-start.y)*10)/10;x=Math.round((item.x+dx)*10)/10;y=Math.round((item.y+dy)*10)/10;
  for(const peer of peers){peer.node.setAttribute('x',Math.round((peer.it.x+dx)*10)/10);peer.node.setAttribute('y',Math.round((peer.it.y+dy)*10)/10);}
  follow?.(x,y);
 }
 const finish=action(()=>{
  removeListeners();if(!current()){boards();return;}
  if(x!==item.x||y!==item.y){
   try{if(moving.size>1)layout(m=>moveGroupTargets(m.pages[index],moving,dx,dy));else edit(item.storyId?{op:'set-frame',frame:item.id,values:{x,y}}:{op:'set-object',page:page().id,object:item.id,values:{x,y}});}
   catch(error){boards();throw error;}
  }else boards();
 });
 rect.setPointerCapture(event.pointerId);rect.addEventListener('pointermove',move);rect.addEventListener('pointerup',finish);rect.addEventListener('pointercancel',cancel);
}
function inspect(){const p=page(),m=state.model;if(!p)return;$('selection').textContent=`Page ${state.page+1}${state.item?' · '+state.item:''}`;option($('item'),[['','Nothing selected'],...p.frames,...p.objects].map(v=>Array.isArray(v)?v:[v.id,(v.storyId?'Frame ':v.kind+' ')+v.id]),state.item??'');state.item=$('item').value||null;const item=selected();for(const k of ['x','y','width','height'])value(k,item?.[k]);option($('next-frame'),[['','End of story'],...m.pages.flatMap(p=>p.frames).filter(f=>f.id!==item?.id).map(f=>[f.id,f.id])],item?.nextFrame??'');$('link-frame').disabled=!item?.storyId;option($('story'),m.stories.map(s=>[s.id,s.id]),item?.storyId??$('story').value);const story=m.stories.find(s=>s.id===$('story').value);value('story-text',story?.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));for(const id of ['story-paragraph-style','paragraph-style'])option($(id),Object.keys(m.paragraphStyles).map(k=>[k,k]),id==='story-paragraph-style'?story?.paragraphs[0]?.style:$(id).value);for(const id of ['story-character-style','character-style'])option($(id),Object.keys(m.characterStyles).map(k=>[k,k]),id==='story-character-style'?story?.paragraphs[0]?.runs[0]?.style:$(id).value);typography();for(const [id,k]of [['page-width','width'],['page-height','height'],['bleed','bleed'],['margin','margin']])value(id,p[k]);value('guides-x',p.guides.x.join(', '));value('guides-y',p.guides.y.join(', '));option($('master'),[['','No master'],...m.masters.map(v=>[v.id,v.id])],p.masterId??'');value('master-objects',JSON.stringify(m.masters.find(x=>x.id===$('master').value)?.objects??[],null,2));}
function typography(){if(!state.model)return;const c=state.model.characterStyles[$('character-style').value],p=state.model.paragraphStyles[$('paragraph-style').value];if(c){value('font',c.font);value('font-size',c.size);value('font-weight',c.weight);value('font-style',c.style);value('font-color',hex(c.color));}if(p){value('leading',p.leading);value('space-after',p.spaceAfter);value('indent',p.indent);value('align',p.align);}}
function controls(){
 const d=state.document,readOnly=!d||d.revision!==d.currentRevision,blocked=state.busy||readOnly,draft=hasDraft(),content=hasContent();
 $('properties').disabled=blocked;
 for(const id of trackedFields)$(id).disabled=blocked;
 for(const id of ['item','story','character-style','paragraph-style'])$(id).disabled=blocked;
 for(const id of ['page-view','replace-story','page-properties','character-properties','paragraph-properties','apply-master','add-object','remove-object','add-page','remove-page','place-image','fmt-font','fmt-size','fmt-color','fmt-bold','fmt-italic']){
  const node=$(id);if(node.tagName==='FORM')for(const control of node.elements)control.disabled=blocked;else node.disabled=blocked;
 }
 for(const node of document.querySelectorAll('#fmt-align button'))node.disabled=blocked;
 for(const form of ['new','asset-upload'])for(const control of $(form).elements)control.disabled=state.busy;
 for(const node of document.querySelectorAll('#documents button,#page-rail button'))node.disabled=state.busy;
 for(const id of ['reopen','open-history','restore-history','delete-document','history'])$(id).disabled=state.busy||!d;
 $('save').disabled=blocked||(!state.ops.length&&!editorFoundation?.hasPending())||!!pendingFields.size;
 // Save revision is a deliberate, secondary event (§5.1): drawn only while there is something to save.
 $('save').hidden=readOnly||(!state.ops.length&&!editorFoundation?.hasPending()&&!pendingFields.size);
 $('undo').disabled=state.busy||!state.undo.length;$('redo').disabled=state.busy||!state.redo.length;
 // Render & preflight and Download PDF run on the current draft and save it first (they are never disabled by unsaved edits).
 $('render').disabled=blocked||!!state.job||state.renderStarting;
 $('cancel-render').disabled=state.busy||!state.job;
 $('export-pdf').disabled=state.busy||!d||!!state.job||state.renderStarting;$('export-layout').disabled=state.busy||!d;
 // The one primary follows the document: Add text frame on an empty page, Download PDF once there is content.
 $('export-pdf').hidden=!content||state.view!=='editor';$('add-first').hidden=content||state.view!=='editor'||(Boolean(d)&&readOnly);$('add-first').disabled=state.busy;
 // The caption says Saved; while there is something to save, Save revision itself says so (one row, §3.1).
 $('save-state').textContent=!d?'':state.busy?'Working…':readOnly?'Read-only':draft?($('save').hidden?'Unsaved changes':''):'Saved';
 $('discard-fields').disabled=state.busy||!pendingFields.size;$('discard-fields').hidden=!pendingFields.size;
 $('field-edits').textContent=pendingFields.size?'Some fields are changed but not applied. Apply their form, or discard them.':'';
 editorFoundation?.refresh();
 const context=$('chat-context');if(context)context.textContent=d?`Saved revision ${d.revision} · page ${state.page+1}${draft?' · Your changes are saved before the concierge reads them.':''}`:'Ask for a layout idea, or add a text frame to start.';
}
function paint(){const d=state.document;$('document-title').textContent=d?.title??'Untitled publication';$('document-heading').textContent=d?.title??'';revisionText();if(state.model){state.page=Math.min(state.page,state.model.pages.length-1);value('page-view',state.model.pageView);$('page-rail').replaceChildren(...state.model.pages.map((p,i)=>{const b=document.createElement('button');b.type='button';b.className='pub-page-thumb';b.setAttribute('aria-current',String(i===state.page));b.setAttribute('aria-label',`Page ${i+1}`);const mini=document.createElement('span');mini.className='page-mini';mini.style.aspectRatio=`${p.width} / ${p.height}`;mini.setAttribute('aria-hidden','true');const words=document.createElement('span');words.className='pub-page-number';words.textContent=`Page ${i+1}`;b.append(mini,words);b.onclick=action(()=>selectPage(i));return b;}));inspect();}else $('page-rail').replaceChildren();boards();controls();}
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
 editable();requireAppliedFields();if(state.renderStarting||state.job)throw new Error('A render is already pending.');
 // The current draft is what gets rendered: save it first, by itself (design standard §5.1, the audit's "four steps to see words").
 if(state.ops.length||editorFoundation?.hasPending())await save();
 const d=editable();if(state.ops.length)throw new Error('Save the draft before rendering.');
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
    if(job.state==='ready'){state.rendered=true;status('Render ready. Previews and PDF share the same rendered output.');await previews(view);}
    else status('Render '+job.state,true);
    return job.state==='ready';
   }
   await new Promise(resolve=>setTimeout(resolve,600));
   if(!current())return;
  }
  if(current()&&state.job===id){state.job=null;throw new Error('Stopped waiting for render. Reopen the publication to check retained output.');}
 }catch(error){if(current())throw error;}
 finally{if(current()){state.renderStarting=false;controls();}}
}
async function download(kind){
 requireDocument();requireAppliedFields();if(state.ops.length||editorFoundation?.hasPending())await save();
 const d=requireDocument();if(state.ops.length)throw new Error('Save the draft before downloading.');
 const view=viewSnapshot(),blob=await request(`/documents/${d.id}/revisions/${d.revision}/content?format=${kind}`,{blob:true});
 if(!sameView(view)||hasDraft())return;
 const expected=kind==='pdf'?'application/pdf':kind==='mp4'?'video/mp4':'application/vnd.oshal.publishing-layout+json';if(!blob.type.startsWith(expected))throw new Error('Unexpected export content');
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${d.title.replace(/[^A-Za-z0-9_-]/g,'_')}.${kind==='pdf'?'pdf':kind==='mp4'?'mp4':'json'}`;
 a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Downloaded saved revision '+d.revision);
}
/** The finishing primary: save the draft, render it when this revision has no render yet, then download the PDF. */
async function downloadPdf(){
 requireDocument();requireAppliedFields();if(state.ops.length||editorFoundation?.hasPending())await save();
 if(!state.rendered){status('Rendering your PDF…');if(!await render())return;}
 await download('pdf');
}
bind('new','submit',async()=>{
 if(state.busy)throw new Error('Wait for the current save or open to finish.');if(!await dirtyPrompt())return;
 // A size (Letter, A4) makes a blank publication of that size; the form alone still makes the brochure starter.
 const input={title:$('new-title').value,pageCount:number('new-pages'),...(state.newSize?{size:state.newSize}:{})},signature=JSON.stringify(input);
 if(state.createAttempt?.signature!==signature)state.createAttempt={signature,key:crypto.randomUUID()};
 await locked(async()=>{
  const result=await request('/documents',{method:'POST',body:{...input,requestKey:state.createAttempt.key}});
  await loadDocument(result.document.id);state.createAttempt=null;await refresh();
 });
});
/** New → Blank (a size): keep the open publication's changes (saved first), then make and open a blank one. */
async function newPublication(size){
 if(state.busy)throw new Error('Wait for the current save or open to finish.');
 if(state.document&&hasDraft()){editable();requireAppliedFields();await save();}
 state.newSize=size;$('new-title').value=untitled();$('new-pages').value='1';
 try{await boundActions.get('new:submit')();}finally{state.newSize=null;}
}
/** The next free "Untitled publication" name, so two blank publications are told apart in the list. */
function untitled(){const names=new Set(state.documents.map(d=>d.title));if(!names.has('Untitled publication'))return 'Untitled publication';for(let n=2;;n++)if(!names.has(`Untitled publication ${n}`))return `Untitled publication ${n}`;}
/** Add a text frame, a shape or an image to the open page; with nothing saved yet the first one makes an untitled Letter publication. */
async function addItem(kind){
 if(!state.document)await newPublication('letter');
 editable();$('object-kind').value=kind;
 await boundActions.get('add-object:click')();
 return selected();
}
/** Duplicate the chosen item beside itself: a text frame gets its own copy of the story. */
function duplicateItem(){
 const item=selected();if(!item)throw new Error('Choose an item first.');if(!guardFields())return;
 const copyId=uid(item.storyId?'frame':item.kind),offset=12;
 layout(m=>{const p=m.pages[state.page],moved={...copy(item),id:copyId,x:Math.min(item.x+offset,p.width-item.width),y:Math.min(item.y+offset,p.height-item.height)};
  if(item.storyId){const story=copy(m.stories.find(s=>s.id===item.storyId)),storyId=uid('story');story.id=storyId;story.firstFrame=copyId;m.stories.push(story);moved.storyId=storyId;moved.nextFrame=null;p.frames.push(moved);}
  else p.objects.push(moved);});
 state.item=copyId;paint();
}
/** Duplicate the open publication: a new publication titled "Copy of …" holding the same saved layout. */
async function duplicateDocument(){
 const d=requireDocument();if(hasDraft()){editable();requireAppliedFields();await save();}
 const name=('Copy of '+d.title).slice(0,160),source=copy(state.document.model);
 await locked(async()=>{
  const created=await request('/documents',{method:'POST',body:{title:name,pageCount:1,requestKey:crypto.randomUUID()}});
  await request(`/documents/${created.document.id}/revisions`,{method:'POST',body:{baseRevision:created.document.revision,requestKey:crypto.randomUUID(),operations:[{op:'replace-model',model:{...source,title:name}}]}});
  await loadDocument(created.document.id);await refresh();
 });
 status('Duplicated as '+name);
}
/** Back to Your publications: the open draft is saved first, so leaving never loses work. */
async function showList(){
 if(state.document&&hasDraft()){editable();requireAppliedFields();await save();}
 await refresh();state.view='list';editorFoundation?.discardPending();paint();
}
bind('refresh','click',refresh);bind('save','click',save);bind('render','click',render);bind('reopen','click',()=>open(requireDocument().id));bind('export-pdf','click',downloadPdf);bind('export-layout','click',()=>download('layout'));
bind('cancel-render','click',async()=>{
 requireDocument();const id=state.job,view=viewSnapshot(),generation=state.renderGeneration;if(!id)return;
 await request('/jobs/'+id+'/cancel',{method:'POST',body:{}});
 if(!sameView(view)||state.renderGeneration!==generation||state.job!==id)return;
 retireRender();controls();status('Render cancelled.');
});
for(const[id,from,to]of [['undo','undo','redo'],['redo','redo','undo']])bind(id,'click',()=>{editable();if(!guardFields())return;const prior=state[from].pop();if(!prior)return;rememberHistory(state[to],state.model);state.model=prior.model;state.ops=operationsFor(prior.model);state.saveKey=null;state.liveKey=null;paint();});
bind('page-view','change',()=>edit({op:'set-view',pageView:$('page-view').value}));bind('item','change',()=>changeSelection('item',()=>{state.item=$('item').value;inspect();boards();}));bind('story','change',()=>changeSelection('story',()=>{const s=state.model.stories.find(s=>s.id===$('story').value);value('story-text',s?.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));value('story-paragraph-style',s?.paragraphs[0]?.style);value('story-character-style',s?.paragraphs[0]?.runs[0]?.style??Object.keys(state.model.characterStyles)[0]);}));bind('character-style','change',()=>changeSelection('character-style',typography));bind('paragraph-style','change',()=>changeSelection('paragraph-style',typography));
bind('geometry','submit',()=>{const item=selected();if(!item)throw new Error('Select an item.');const values=Object.fromEntries(['x','y','width','height'].map(k=>[k,number(k)]));edit(item.storyId?{op:'set-frame',frame:item.id,values}:{op:'set-object',page:page().id,object:item.id,values},fields.geometry);});
bind('link-frame','click',()=>{const item=selected();if(!item?.storyId)throw new Error('Select a text frame.');edit({op:'set-link',frame:item.id,nextFrame:$('next-frame').value||null},fields.link);});
for(const[id,type]of [['story-text','input'],['story-paragraph-style','change'],['story-character-style','change']])bind(id,type,liveStory);
bind('replace-story','click',()=>edit({op:'replace-story',story:$('story').value,paragraphs:$('story-text').value.split('\n').map(text=>({style:$('story-paragraph-style').value,runs:[{text,style:$('story-character-style').value}]}))},fields.story));
bind('page-properties','submit',()=>{const guides=id=>$(id).value.trim()?$(id).value.split(',').map(s=>{const n=Number(s.trim());if(!Number.isFinite(n))throw new Error('Guides must be comma-separated numbers.');return n;}):[];edit({op:'set-page',page:page().id,values:{width:number('page-width'),height:number('page-height'),bleed:number('bleed'),margin:number('margin'),guides:{x:guides('guides-x'),y:guides('guides-y')},masterId:$('master').value||null}},fields.page);});
bind('master','change',()=>{
 const previous=selectionValues.get('master'),next=$('master').value;
 if(pendingFields.has('master-objects')){
  $('master').value=previous;
  if(previous===fieldBaselines.get('master'))pendingFields.delete('master');else pendingFields.set('master',previous);
  controls();throw new Error('Apply the master objects, or press Discard field edits, before choosing another master.');
 }
 pendingFields.delete('master-objects');selectionValues.set('master',next);
 value('master-objects',JSON.stringify(state.model.masters.find(master=>master.id===next)?.objects??[],null,2));
 controls();
});
bind('apply-master','click',()=>{if(!$('master').value)throw new Error('Select a master first.');edit({op:'set-master',master:$('master').value,objects:JSON.parse($('master-objects').value)},fields.master);});
bind('character-properties','submit',()=>edit({op:'set-character-style',name:$('character-style').value,values:{font:$('font').value,size:number('font-size'),weight:number('font-weight'),style:$('font-style').value,color:rgb($('font-color').value)}},fields.character));
bind('paragraph-properties','submit',()=>edit({op:'set-paragraph-style',name:$('paragraph-style').value,values:{leading:number('leading'),spaceAfter:number('space-after'),indent:number('indent'),align:$('align').value}},fields.paragraph));
bind('asset-upload','submit',async()=>{const file=$('asset-file').files[0];if(!file||file.size>4194304)throw new Error('Choose a PNG or JPEG up to 4 MiB.');const body=new FormData();body.append('file',file);body.append('title',$('asset-title').value);body.append('requestKey',crypto.randomUUID());const uploaded=await request('/assets/upload',{method:'POST',body});await refresh();
 // The Image tool's one step (C-DES-2): the uploaded picture is placed on the open page at once, and chosen.
 const id=uploaded.asset?.id;if(id&&state.assets.some(a=>a.id===id)){$('object-asset').value=id;$('asset-file').value='';$('asset-title').value='';await addItem('image');ui.placed?.();status('Image placed on the page.');}else status('Image uploaded.');});
$('asset-file').addEventListener('change',()=>{const file=$('asset-file').files[0];if(file&&!$('asset-title').value)$('asset-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,160);});
bind('add-object','click',()=>{editable();const p=page(),kind=$('object-kind').value,id=uid(kind),style=$('story-paragraph-style').value,character=$('story-character-style').value;layout(m=>{const target=m.pages[state.page],geometry={id,x:p.margin,y:p.margin,width:Math.min(120,p.width-2*p.margin),height:Math.min(60,p.height-2*p.margin)};if(kind==='frame'){const storyId=uid('story');target.frames.push({...geometry,width:p.width-2*p.margin,height:Math.min(120,p.height-2*p.margin),storyId,nextFrame:null});m.stories.push({id:storyId,firstFrame:id,paragraphs:[{style,runs:[{text:'Your text here',style:character}]}]});}else{const object={...geometry,kind};if(kind==='image'){const asset=state.assets.find(a=>a.id===$('object-asset').value);if(!asset)throw new Error('Upload and select an image first.');object.assetId=asset.id;if(!m.assets.some(a=>a.id===asset.id))m.assets.push(Object.fromEntries(['id','sha256','bytes','mime'].map(k=>[k,asset[k]])));}if(kind==='rect')object.color=rgb($('object-color').value);if(kind==='text')object.paragraph={style,runs:[{text:$('object-text').value||'Text',style:character}]};if(kind==='number')object.style=character;target.objects.push(object);}},fields.object);if(!pendingFields.size)state.item=id;paint();});
bind('remove-object','click',()=>{const item=selected();if(!item)throw new Error('Select an item.');if(!guardFields())return;layout(m=>{const p=m.pages[state.page];p.objects=p.objects.filter(o=>o.id!==item.id);p.frames=p.frames.filter(f=>f.id!==item.id);for(const f of m.pages.flatMap(p=>p.frames))if(f.nextFrame===item.id)f.nextFrame=item.nextFrame??null;const story=m.stories.find(s=>s.id===item.storyId);if(story?.firstFrame===item.id){if(item.nextFrame)story.firstFrame=item.nextFrame;else m.stories=m.stories.filter(s=>s.id!==story.id);}});});
bind('add-page','click',()=>{editable();if(!guardFields())return;if(state.model.pages.length>=8)throw new Error('This profile supports up to eight pages.');layout(m=>{const p=copy(page());p.id=uid('page');p.objects=[];p.frames=[];m.pages.push(p);});state.page=state.model.pages.length-1;paint();});
bind('remove-page','click',()=>{editable();if(!guardFields())return;if(state.model.pages.length===1)throw new Error('Keep at least one page.');if(page().frames.length)throw new Error('Remove or relink this page’s text frames first.');layout(m=>m.pages.splice(state.page,1));});
bind('open-history','click',()=>open(requireDocument().id,number('history')));
bind('restore-history','click',async()=>{
 const d=requireDocument();if(!await dirtyPrompt())return;
 const body={baseRevision:d.currentRevision,restoreRevision:number('history')},signature=JSON.stringify([d.id,body]);
 if(state.restoreAttempt?.signature!==signature)state.restoreAttempt={signature,key:crypto.randomUUID()};
 await locked(async()=>{
  const result=await request(`/documents/${d.id}/revisions`,{method:'POST',body:{...body,requestKey:state.restoreAttempt.key}});
  await loadDocument(result.document.id);state.restoreAttempt=null;
 });
});
bind('delete-document','click',async()=>{
 const d=requireDocument();if(!await ui.confirm({title:'Delete this publication?',text:`"${d.title}", its saved revisions and any unsaved changes are deleted. This cannot be undone.`,action:'Delete publication'}))return;
 await locked(async()=>{
  await request('/documents/'+d.id,{method:'DELETE',body:{}});
  clearPreviews();retireRender();state.viewGeneration++;clearFieldBuffers();
  state.document=null;state.model=null;state.ops=[];state.undo=[];state.redo=[];state.saveKey=null;state.rendered=false;state.item=null;
  $('preflight').textContent='';await refresh();state.view=state.documents.length?'list':'editor';paint();
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

document.body.addEventListener('editor-foundation:draft',controls);
window.addEventListener('beforeunload',event=>{if(hasDraft()){event.preventDefault();event.returnValue='';}});
paint();action(async()=>{
 await refresh();const id=new URL(location.href).searchParams.get('document');
 // N2: with publications the first screen is the list (newest first, one New); with none, a blank page ready for Add text frame.
 if(id)await open(id);else{state.view=state.documents.length?'list':'editor';paint();status(state.view==='list'?'Your publications':'A blank Letter page');}
 state.loaded=true;controls();
})();

async function prepareDocumentHandoff(){
 await editorFoundation?.flushPending();
 if(workspaceIdle)await workspaceIdle;
 if(!state.document)return{app:'publishing-studio',screen:'surface',surface:'publishing-workbench'};
 document.activeElement?.blur?.();if(hasDraft())editable();
 const groups=[['geometry','geometry:submit'],['link','link-frame:click'],['story','replace-story:click'],
  ['master','apply-master:click'],['character','character-properties:submit'],['paragraph','paragraph-properties:submit'],
  ['page','page-properties:submit'],['object','add-object:click']];
 for(const[group,handler]of groups)if(fields[group].some(id=>pendingFields.has(id))){
  if(state.ops.length>=64)await save({preserveFields:true});
  await boundActions.get(handler)();
 }
 if(state.ops.length)await save();
 if(hasDraft())throw new Error('The current publication draft could not be saved.');
 const d=requireDocument();
 return{app:'publishing-studio',screen:'surface',surface:'publishing-workbench',recordId:d.id,title:d.title,
  documentId:d.id,revision:d.revision,selection:publishingSelection(d,page(),selected()),selectedPage:page().id,selectedFrame:selected()?.storyId?state.item:null,
  fields:{revision:d.revision,workspaceGeneration:state.viewGeneration,draft:false,readOnly:d.revision!==d.currentRevision,pageId:page().id,...(state.item?{itemId:state.item}:{})}};
}
async function refreshDocumentHandoff(expected){
 if(workspaceIdle)await workspaceIdle;
 const d=state.document;if(!d||(expected?.recordId&&expected.recordId!==d.id))return;
 if(expected?.fields?.revision!==undefined&&expected.fields.revision!==d.revision)return;
 if(expected?.fields?.workspaceGeneration!==undefined&&expected.fields.workspaceGeneration!==state.viewGeneration)return;
 if(expected?.fields?.readOnly&&d.revision!==d.currentRevision)return;
 const view=viewSnapshot(),result=await request('/documents/'+d.id);
 if(!sameView(view)||result.document.revision<=d.revision)return;
 document.activeElement?.blur?.();
 if(hasDraft())throw new Error('The concierge saved an update while you were editing. Your publication draft is still here. Save a copy or choose the saved revision to decide which to keep.');
 const retained={result,pageId:page().id,item:state.item,keepHistory:true};
 await locked(()=>loadDocument(d.id,undefined,retained));
}
void import('/shared/ui/js/document-handoff.js').then(({registerDocumentSession})=>registerDocumentSession({
 app:'publishing-studio',prepare:async()=>{try{return await prepareDocumentHandoff();}catch(error){status(error.message,true);throw error;}},
 refresh:async expected=>{try{await refreshDocumentHandoff(expected);}catch(error){status(error.message,true);throw error;}}
})).catch(error=>status('The concierge cannot synchronize this document: '+error.message,true));

void bindPublishingFoundation({state,selected,page,hasDraft,requireAppliedFields,guardFields,edit,layout,request,locked,loadDocument,open,refresh,save,render,download,viewSnapshot,sameView,uid,copy,editable,requireDocument,untitled,prepare:prepareDocumentHandoff,refreshDocument:refreshDocumentHandoff,
 ui,hasContent,addItem,duplicateItem,duplicateDocument,newPublication,showList,downloadPdf,selectPage,paint,boards,controls,status,action,
 run:key=>boundActions.get(key)(),fields,
 actions:{
 undo:()=>boundActions.get('undo:click')(),redo:()=>boundActions.get('redo:click')(),
 save:()=>save(),export:()=>download('layout'),
}}).then(value=>{editorFoundation=value;value.refresh();}).catch(error=>status('Shared editor unavailable: '+error.message,true));
