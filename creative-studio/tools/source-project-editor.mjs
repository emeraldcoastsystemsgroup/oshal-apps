/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Canonicalize model signatures and capture baseline from read() after modelToInputs() so native sorted JSON keys do not mark opened projects dirty.
 */
/** Package-owned typed brief/storyboard editor. All persistence uses this package's original-owner API. */
import {registerDocumentSession} from '/shared/ui/js/document-handoff.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const clone=v=>structuredClone(v),signature=v=>JSON.stringify(canonical(v));
function checkedModel(kind,model){if(!model||model.kind!==kind||model.version!==1||typeof model.title!=='string'||typeof model.notes!=='string'||typeof model.sourceUrl!=='string'||!Array.isArray(model.scenes)||model.scenes.some(scene=>typeof scene.id!=='string'||typeof scene.text!=='string'||!Number.isSafeInteger(scene.duration)))throw Error('The saved source is invalid.');return model;}
export function installSourceEditor({app,kind,viewport,navigation,header,foundation,readBrief,writeBrief,message,onChange=()=>{}}){
 const base='/api/'+app+'/source-projects';let id=null,revision=0,baseline=null,scenes=[],selected=null,busy=false,epoch=0,pending=null,draftId='brief:'+crypto.randomUUID(),undo=[],redo=[];
 const read=()=>({version:1,kind,...readBrief(),scenes:clone(scenes)});
 const dirty=()=>Boolean(!id&&(readBrief().title||readBrief().notes||scenes.length))||signature(read())!==baseline||Boolean(foundation()?.hasPending());
 const status=text=>message(text);
 async function api(path='',options={}){const response=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...options.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'Source request failed ('+response.status+').');return body;}
 const controls=document.createElement('div');controls.className='source-project-actions';
 function button(label,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=()=>Promise.resolve().then(action).catch(error=>status(error.message));controls.append(node);return node;}
 const newButton=button('New source',()=>newSource()),saveButton=button('Save source',()=>save()),undoButton=button('Undo',()=>history(-1)),redoButton=button('Redo',()=>history(1)),reloadButton=button('Reload saved',()=>id&&open(id));header.append(controls);
 const library=document.createElement('section'),list=document.createElement('div'),libraryTitle=document.createElement('h2');libraryTitle.textContent='Saved source projects';library.append(libraryTitle,list);navigation.prepend(library);
 const story=document.createElement('section'),storyTitle=document.createElement('h2'),sceneList=document.createElement('div'),add=document.createElement('button');storyTitle.textContent='Storyboard';add.type='button';add.textContent='Add scene';story.append(storyTitle,sceneList,add);viewport.append(story);
 add.onclick=()=>{if(busy)return;if(scenes.length>=32){status('A source project can contain at most 32 scenes.');return;}checkpoint();const scene={id:crypto.randomUUID(),title:'Scene '+(scenes.length+1),text:'',duration:5};scenes.push(scene);selected=scene.id;notify();};
 function checkpoint(){const value=read();if(!undo.length||signature(undo.at(-1))!==signature(value)){undo.push(value);if(undo.length>50)undo.shift();}redo=[];}
 function modelToInputs(model){writeBrief(model);scenes=model.scenes.map(s=>({id:s.id,title:s.title,text:s.text,duration:s.duration}));if(!scenes.some(v=>v.id===selected))selected=null;}
 function history(direction){if(busy)return;foundation()?.discardPending();const from=direction<0?undo:redo,to=direction<0?redo:undo;if(!from.length)return;to.push(read());modelToInputs(from.pop());notify();}
 function renderScenes(){sceneList.replaceChildren();for(const [index,scene] of scenes.entries()){
  const row=document.createElement('div');row.className='source-scene';const pick=document.createElement('button');pick.type='button';pick.textContent=(index+1)+'. '+scene.title+' · '+scene.duration+'s';pick.setAttribute('aria-pressed',String(scene.id===selected));pick.onclick=()=>{if(foundation()?.hasPending()){status('Finish or discard the current property edit first.');return;}selected=scene.id;notify();};row.append(pick);
  for(const [label,action,disabled] of [['Move scene up',()=>{checkpoint();[scenes[index-1],scenes[index]]=[scenes[index],scenes[index-1]];notify();},index===0],['Move scene down',()=>{checkpoint();[scenes[index],scenes[index+1]]=[scenes[index+1],scenes[index]];notify();},index===scenes.length-1],['Duplicate scene',()=>{checkpoint();const duplicate={...scene,id:crypto.randomUUID(),title:(scene.title+' copy').slice(0,120)};scenes.splice(index+1,0,duplicate);selected=duplicate.id;notify();},scenes.length>=32],['Delete scene',()=>{checkpoint();scenes.splice(index,1);if(selected===scene.id)selected=null;notify();},false]]){
   const actionButton=document.createElement('button');actionButton.type='button';actionButton.textContent=label;actionButton.disabled=disabled||busy;actionButton.onclick=action;row.append(actionButton);
  }sceneList.append(row);
 }if(!scenes.length){const note=document.createElement('p');note.textContent='Add editable scene text and timing. Rendering remains a separate, explicit action.';sceneList.append(note);}}
 function notify(){saveButton.disabled=busy;newButton.disabled=busy;reloadButton.disabled=busy||!id;undoButton.disabled=busy||!undo.length;redoButton.disabled=busy||!redo.length;add.disabled=busy||scenes.length>=32;renderScenes();previous=read();foundation()?.refresh();onChange();}
 let previous=read();
 for(const field of viewport.querySelectorAll('#title,#notes'))field.addEventListener('input',()=>{if(signature(previous)!==signature(read())){undo.push(previous);if(undo.length>50)undo.shift();redo=[];previous=read();}notify();});
 async function refreshLibrary(){try{const data=await api();list.replaceChildren();for(const item of data.projects){const row=document.createElement('button');row.type='button';row.textContent=item.title+' · revision '+item.revision;row.onclick=()=>open(item.id).catch(error=>status(error.message));list.append(row);}if(!data.projects.length)list.textContent='No saved source projects yet.';}catch(error){list.textContent='Saved sources unavailable: '+error.message;}}
 function mayReplace(){return !dirty()||confirm('Discard unsaved source changes and open another project?');}
 async function open(nextId,{fromAssistant=false}={}){
  if(busy)throw Error('Wait for the current source operation.');const original=signature(read()),originalPending=foundation()?.hasPending();if(!fromAssistant&&!mayReplace())return;const loading=++epoch;busy=true;notify();
  try{const data=await api('/'+encodeURIComponent(nextId));const project=data.project;checkedModel(kind,project.model);if(loading!==epoch)return;
   if(fromAssistant){if(id!==nextId||dirty())throw Error('The assistant saved a source revision while you were editing. Your draft is still here. Reload saved to choose which version to open.');if(project.currentRevision<=revision)return;}
   else if((signature(read())!==original||Boolean(foundation()?.hasPending())!==Boolean(originalPending))&&!mayReplace())return;
   const beforeModel=read();foundation()?.discardPending();id=project.id;revision=project.revision;draftId='brief:'+crypto.randomUUID();modelToInputs(project.model);baseline=signature(read());undo=fromAssistant?[...undo,beforeModel].slice(-50):[];redo=[];previous=read();pending=null;status('Opened source revision '+revision+'.');
  }finally{busy=false;notify();}
 }
 function newSource(){if(busy||!mayReplace())return;foundation()?.discardPending();++epoch;id=null;revision=0;draftId='brief:'+crypto.randomUUID();modelToInputs({version:1,kind,title:'Untitled brief',notes:'',sourceUrl:'',mode:kind==='brand'?'intro':'episode',scenes:[]});baseline=null;undo=[];redo=[];previous=read();pending=null;status('New source project.');notify();}
 async function save(){if(busy)throw Error('Wait for the current source operation.');document.activeElement?.blur();await foundation()?.flushPending();if(!read().title.trim())throw Error('Give the source project a title before saving.');
  busy=true;notify();try{if(pending||!id||dirty()){
   if(!pending){const snapshot=read();pending={id,snapshot,body:{requestKey:crypto.randomUUID(),...(id?{baseRevision:revision,operations:[{op:'set-brief',values:{title:snapshot.title,notes:snapshot.notes,sourceUrl:snapshot.sourceUrl,mode:snapshot.mode}},{op:'replace-scenes',scenes:snapshot.scenes}]}:{model:snapshot})}};}
   const captured=pending,result=await api(captured.id?'/'+encodeURIComponent(captured.id)+'/edits':'',{method:'POST',body:JSON.stringify(captured.body)});id=result.project.id;revision=result.project.revision;baseline=signature(captured.snapshot);pending=null;status('Saved source revision '+revision+(dirty()?'. Newer changes are still unsaved.':'.'));await refreshLibrary();
  }}finally{busy=false;notify();}return{id,revision};
 }
 const properties=()=>{const scene=scenes.find(v=>v.id===selected);return scene?[{key:'sceneTitle',label:'Scene title',type:'text',value:scene.title,group:'Scene'},{key:'sceneText',label:'Scene text',type:'textarea',value:scene.text,group:'Scene'},{key:'sceneDuration',label:'Duration',type:'number',value:scene.duration,min:1,max:120,step:1,unit:'s',group:'Scene'}]:null;};
 function applyProperty(key,value,expected){if(expected.documentId!==(id??draftId)||expected.revision!==revision||expected.selection.ids[0]!==selected)throw Error('The source selection changed.');const scene=scenes.find(v=>v.id===selected);if(!scene)throw Error('Select a scene first.');const field={sceneTitle:'title',sceneText:'text',sceneDuration:'duration'}[key];if(!field)throw Error('Unsupported scene property.');if(field==='duration'){if(!Number.isSafeInteger(value)||value<1||value>120)throw Error('Scene duration must be between 1 and 120 seconds.');}else if(typeof value!=='string'||value.length>(field==='title'?120:2000)||(field==='title'&&!value.trim()))throw Error('Correct the scene text.');checkpoint();scene[field]=value;notify();}
 const getState=()=>({documentId:id??draftId,revision,selection:getSelection(),title:readBrief().title||'New source',dirty:dirty(),busy,readOnly:false,canUndo:undo.length>0,canRedo:redo.length>0,status:id?'Source revision '+revision+(dirty()?' · unsaved changes':' · saved'):'Unsaved source project'});
 const getSelection=()=>selected?{kind:'scene',ids:[selected]}:{kind:'brief',ids:['current']};
 const session={app,prepare:async()=>{for(let attempt=0;attempt<3;attempt++){await save();if(!dirty())break;}if(dirty())throw Error('Finish your source edit before asking the assistant.');return{app,selection:getSelection(),screen:'source-editor',surface:app+'-source',title:readBrief().title,recordId:id,digest:'Editable source project. Read its typed editing contract and current revision before changing it. Generated outputs stay immutable.',can:[],customOps:[],fields:{available:true,readOnly:false,revision,saved:true,draft:false,kind,sceneCount:scenes.length,...(selected?{sceneId:selected}:{})}};},refresh:async expected=>{if(expected?.recordId&&expected.recordId!==id)return;if(id)await open(id,{fromAssistant:true});}};registerDocumentSession(session);
 viewport.closest('main').addEventListener('editor-foundation:draft',()=>notify());window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
 baseline=signature(read());previous=read();notify();void refreshLibrary();
 function handoffNotes(){const value=[readBrief().notes,...scenes.map((scene,index)=>(index+1)+'. '+scene.title+' ('+scene.duration+'s)\n'+scene.text)].filter(Boolean).join('\n\n');if(value.length>2000)throw Error('This source exceeds the receiving workflow’s 2,000-character brief limit. Shorten the scene text or continue editing the complete source here.');return value;}
 return{prepare:session.prepare,refreshFromAssistant:session.refresh,handoffNotes,getState,getSelection,properties,applyProperty,save,notify,checkpoint,undo:()=>history(-1),redo:()=>history(1)};
}
