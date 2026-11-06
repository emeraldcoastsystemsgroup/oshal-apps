/** Durable generation brief controls, native history and actual saved-source assistant sessions. */
import{createEditorAssistant}from'/shared/ui/js/editor-assistant.js';
import{registerDocumentSession}from'/shared/ui/js/document-handoff.js';
const sig=JSON.stringify,clone=structuredClone;
const orientations=['Landscape','Portrait','Square'],placements=['Insert','Extend','none'];
function checked(model){if(!model||model.version!==1||model.kind!=='vids-brief'||typeof model.title!=='string'||!model.title.trim()||model.title.length>120||typeof model.prompt!=='string'||model.prompt.length>10000||!orientations.includes(model.orientation)||!placements.includes(model.insertMode))throw Error('Correct the brief title, prompt or generation settings before saving.');return model;}
export function createVidsSourceEditor({root,header,navigation,getFoundation,status,getBusy=()=>false,onChange=()=>{}}){
 const fields=Object.fromEntries(['prompt','orientation','insertMode'].map(id=>[id,document.getElementById(id)])),title=document.createElement('input');title.id='briefTitle';title.value='Untitled clip brief';title.setAttribute('aria-label','Brief title');title.maxLength=120;
 const label=document.createElement('label');label.textContent='Brief title';label.append(title);const controls=document.createElement('div');controls.className='vids-source-actions';controls.append(label);header.append(controls);
 let id=null,revision=0,draftId='vids-brief:'+crypto.randomUUID(),busy=false,request=null,undo=[],redo=[],epoch=0;
 const read=()=>({version:1,kind:'vids-brief',title:title.value,prompt:fields.prompt.value,orientation:fields.orientation.value,insertMode:fields.insertMode.value});let baseline=sig(read()),previous=read();
 const write=model=>{title.value=model.title;for(const key of Object.keys(fields))fields[key].value=model[key];};
 const dirty=()=>Boolean(request)||sig(read())!==baseline||Boolean(getFoundation()?.hasPending());
 const selection=()=>({kind:'generation brief',ids:[id??draftId]});
 const state=()=>({documentId:id??draftId,revision,title:title.value||'Clip brief',selection:selection(),dirty:dirty(),busy:busy||getBusy(),readOnly:false,canUndo:undo.length>0,canRedo:redo.length>0,status:id?'Saved brief revision '+revision+(dirty()?' · unsaved changes':''):'Unsaved generation brief'});
 function button(text,action){const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=()=>Promise.resolve().then(action).catch(error=>status(error.message));controls.append(node);return node;}
 const newButton=button('New brief',()=>newBrief()),saveButton=button('Save brief',()=>save()),undoButton=button('Undo',()=>history(-1)),redoButton=button('Redo',()=>history(1)),reloadButton=button('Reload saved',()=>id&&open(id));
 const library=document.createElement('section'),heading=document.createElement('h2'),list=document.createElement('div');heading.textContent='Saved generation briefs';library.className='vids-brief-library';library.append(heading,list);navigation.prepend(library);
 let assistant;
 function notify(){const unavailable=busy||getBusy();for(const node of [newButton,saveButton,reloadButton])node.disabled=unavailable;reloadButton.disabled=unavailable||!id;undoButton.disabled=unavailable||!undo.length;redoButton.disabled=unavailable||!redo.length;getFoundation()?.refresh();assistant?.refresh();onChange();}
 function checkpoint(value=read()){if(!undo.length||sig(undo.at(-1))!==sig(value))undo.push(clone(value));if(undo.length>50)undo.shift();redo=[];}
 function nativeInput(){const current=read();if(sig(current)!==sig(previous)){checkpoint(previous);previous=current;}notify();}
 for(const field of [title,...Object.values(fields)]){field.addEventListener('input',nativeInput);field.addEventListener('change',nativeInput);}
 root.addEventListener('editor-foundation:draft',notify);
 async function api(path='',options={}){const response=await fetch('/api/vids/source-projects'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...options.headers}}),body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'The saved brief request failed ('+response.status+').');return body;}
 async function libraryRefresh(){try{const data=await api();list.replaceChildren();for(const project of data.projects){const node=document.createElement('button');node.type='button';node.dataset.briefId=project.id;node.textContent=project.title+' · revision '+project.revision;node.onclick=()=>open(project.id).catch(error=>status(error.message));list.append(node);}if(!data.projects.length)list.textContent='No saved generation briefs yet.';}catch(error){list.textContent='Saved briefs unavailable: '+error.message;}}
 function mayReplace(){return !dirty()||confirm('Discard unsaved brief changes?');}
 function history(direction){if(busy||getBusy())return;const from=direction<0?undo:redo,to=direction<0?redo:undo;if(!from.length)return;getFoundation()?.discardPending();to.push(read());write(from.pop());previous=read();notify();}
 function newBrief(){if(busy||getBusy()||!mayReplace())return;getFoundation()?.discardPending();epoch++;id=null;revision=0;draftId='vids-brief:'+crypto.randomUUID();write({title:'Untitled clip brief',prompt:'',orientation:'Landscape',insertMode:'Insert'});baseline=sig(read());previous=read();undo=[];redo=[];request=null;status('New generation brief. Saving does not generate a video.');notify();}
 async function open(nextId,{fromAssistant=false}={}){
  if(busy||getBusy())throw Error('Wait for the current brief operation.');if(!fromAssistant&&!mayReplace())return;const before=sig(read()),pending=getFoundation()?.hasPending(),loading=++epoch;busy=true;notify();
  try{const {project}=await api('/'+encodeURIComponent(nextId));checked(project.model);if(loading!==epoch)return;
   if(fromAssistant){if(id!==nextId||dirty())throw Error('The assistant saved an update while you were editing. Your brief is retained. Reload saved to choose the saved source.');if(project.revision<=revision)return;}
   else if((sig(read())!==before||Boolean(getFoundation()?.hasPending())!==Boolean(pending))&&!mayReplace())return;
   const prior=read();getFoundation()?.discardPending();id=project.id;revision=project.revision;write(project.model);baseline=sig(read());previous=read();request=null;undo=fromAssistant?[...undo,prior].slice(-50):[];redo=[];status('Opened saved brief revision '+revision+'.');
  }finally{busy=false;notify();}
 }
 async function save(){if(busy||getBusy())throw Error('Wait for the current brief operation.');document.activeElement?.blur();await getFoundation()?.flushPending();checked(read());busy=true;notify();
  try{if(request||!id||dirty()){
   if(!request){const model=clone(read());request={id,model,body:{requestKey:crypto.randomUUID(),...(id?{baseRevision:revision,operations:[{op:'set-brief',values:{title:model.title,prompt:model.prompt,orientation:model.orientation,insertMode:model.insertMode}}]}:{model})}};}
   const captured=request,result=await api(captured.id?'/'+captured.id+'/edits':'',{method:'POST',body:sig(captured.body)});id=result.project.id;revision=result.project.revision;baseline=sig(captured.model);request=null;status('Saved brief revision '+revision+(dirty()?'. Newer changes remain unsaved.':'. No video was generated.'));await libraryRefresh();
  }}finally{busy=false;notify();}return{id,revision};
 }
 async function settledSource(){if(busy||getBusy())throw Error('Wait for the current brief operation.');await getFoundation()?.flushPending();for(let i=0;i<3&&(!id||dirty());i++)await save();if(!id||dirty())throw Error('The brief is still changing. Finish your edit first.');return checked(clone(read()));}
 async function prepare(){await settledSource();return{app:'vids',recordId:id,fields:{revision,saved:true,draft:false,readOnly:false},selection:selection()};}
 async function refresh(expected){if(expected?.recordId&&expected.recordId!==id)return;if(id)await open(id,{fromAssistant:true});}
 assistant=createEditorAssistant({app:'vids',bot:'vids-operator',title:'Vids brief AI partner',root,prepare,refresh,getState:state});const release=registerDocumentSession({app:'vids',prepare,refresh});
 const properties=()=>[{key:'title',label:'Brief title',type:'text',value:title.value,group:'Generation source'},{key:'prompt',label:'Next clip brief',type:'textarea',value:fields.prompt.value,group:'Generation source'},...['orientation','insertMode'].map(key=>({key,label:key==='orientation'?'Orientation':'Placement',type:'select',value:fields[key].value,options:[...fields[key].options].map(option=>({value:option.value,label:option.textContent})),group:'Generation settings'}))];
 function applyProperty(key,value,expected){if(expected.documentId!==(id??draftId)||expected.revision!==revision||sig(expected.selection)!==sig(selection())||!['title','prompt','orientation','insertMode'].includes(key))throw Error('The selected source brief changed.');const next={...read(),[key]:value};checked(next);checkpoint();write(next);previous=read();notify();}
 void libraryRefresh();notify();
 return{getState:state,getSelection:selection,getProperties:properties,applyProperty,save,prepareGeneration:settledSource,ai:assistant.element,actions:{save,undo:()=>history(-1),redo:()=>history(1)},destroy(){release();assistant.destroy();root.removeEventListener('editor-foundation:draft',notify);for(const field of [title,...Object.values(fields)]){field.removeEventListener('input',nativeInput);field.removeEventListener('change',nativeInput);}}};
}
