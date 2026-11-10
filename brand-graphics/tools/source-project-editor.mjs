/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Canonicalize model signatures and capture baseline from read() after modelToInputs() so native sorted JSON keys do not mark opened projects dirty.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | The design standard (docs/ux/design-standard.md; UX audit decisions brand-graphics--brand-graphics and creative-studio--creative-studio; REFP CONVENTIONS §5.6, §5.7). One app row: Undo and Redo icons, Comment, Save source as a secondary, the page's one primary and ⋯ More last (New source, Reload saved, the connected editors, Resize, Schedule); on a phone Save source and Comment move into More. A scene is one list row with a ⋯ row menu (Move up, Move down, Duplicate, a planned "Edit on canvas" or "Trim", Delete last) instead of four buttons. Menus are opaque top-layer popovers the browser's Back closes. "Discard unsaved changes?" asks in the page instead of window.confirm (DS-30). Functions both reference products have and this editor lacks are planned controls (§4.10, DS-45) in their reference places, through the shared helper /shared/ui/js/planned-control.js.
 * 3   | maintainer@emeraldcoastsystemsgroup.com | A layer's history entry waits for every pending Back of the page, so the Back a closing ask or menu sends cannot take the next layer's entry and leave the application.
 * 4   | maintainer@emeraldcoastsystemsgroup.com | On a phone the ⋯ menus are sheets along the bottom (more than six rows, §4.3); the scene rows are redrawn only when they change, so typing in the brief adds nothing below it.
 * 5   | maintainer@emeraldcoastsystemsgroup.com | brand-graphics 1.4.0: the greyed "Not available yet" controls are gone, each replaced by a working one. Comment (RP-BRG-06) opens the comments sheet for the brief or the chosen scene: threads with replies, Resolve and Reopen, saved with the source (one owner-scoped revision per change; a comment needs the source's title, as any save does). The app row's Download (RP-BRG-04) is the page's own link to a finished build's file, shown only while one exists. The page adds its own ⋯ More rows and scene rows (Resize, Schedule or post, Edit on canvas) as real actions, and opens a template as a new unsaved source (fromTemplate, RP-BRG-01). The shared planned-control helper is no longer imported.
 */
/** Package-owned typed brief/storyboard editor. All persistence uses this package's original-owner API. */
import {registerDocumentSession} from '/shared/ui/js/document-handoff.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const clone=v=>structuredClone(v),signature=v=>JSON.stringify(canonical(v));
function checkedModel(kind,model){if(!model||model.kind!==kind||model.version!==1||typeof model.title!=='string'||typeof model.notes!=='string'||typeof model.sourceUrl!=='string'||!Array.isArray(model.scenes)||model.scenes.some(scene=>typeof scene.id!=='string'||typeof scene.text!=='string'||!Number.isSafeInteger(scene.duration)))throw Error('The saved source is invalid.');return model;}
const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};

/** One queue for the whole page: a layer's history entry is pushed only once every Back a closing layer asked for has landed. */
let settling=Promise.resolve();
/**
 * @description A layer the browser's Back closes (DS-39): opening it adds one history entry; Back closes it; closing it
 *   another way takes the entry back off. Entries are pushed only after every pending Back of this page has landed, so a
 *   Back still in flight from the layer that just closed can never take the next layer's entry (and leave the page).
 * @param {{isOpen:Function,close:Function}} layer - Whether the layer is open, and how to close it without touching history.
 * @returns {{opened:Function,closed:Function}} opened() after it opens; closed() after it closes, resolving once the entry is gone.
 */
export function backCloses(layer){
 let state='none',ticket=0;
 window.addEventListener('popstate',()=>{if(state!=='pushed')return;state='none';if(layer.isOpen())layer.close();});
 return{opened(){if(state!=='none')return;state='pushing';const mine=++ticket;settling.then(()=>{if(state!=='pushing'||mine!==ticket)return;if(!layer.isOpen()){state='none';return;}try{history.pushState({sourceLayer:true},'');state='pushed';}catch{state='none';}});},
  closed(){if(state==='pushing'){state='none';return settling;}if(state!=='pushed')return settling;state='none';
   const gone=new Promise(resolve=>{let timer=0;const done=()=>{clearTimeout(timer);window.removeEventListener('popstate',done);resolve();};window.addEventListener('popstate',done);timer=setTimeout(done,600);try{history.back();}catch{done();}});
   settling=settling.then(()=>gone);return gone;}};
}

/**
 * @description An opaque top-layer menu (popover) anchored to its trigger and kept on screen; a choice, an outside tap,
 *   Escape and the browser's Back close it. Rows are rebuilt each time it opens, so a row can follow the editor's state.
 * @param {HTMLButtonElement} trigger - The ⋯ button that opens it.
 * @param {Function} rows - Returns the rows: {label, run, disabled?, hidden?, className?} or a ready element (a planned control).
 * @returns {{menu:HTMLElement,close:Function}} The menu element and a way to close it.
 */
export function popoverMenu(trigger,rows){
 const menu=make('div','source-menu');menu.setAttribute('role','menu');menu.setAttribute('popover','auto');menu.id='source-menu-'+crypto.randomUUID().slice(0,8);
 trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);
 const history=backCloses({isOpen:()=>menu.matches(':popover-open'),close:()=>menu.hidePopover()});let settled=Promise.resolve();
 function fill(){menu.replaceChildren();for(const row of rows()){if(!row)continue;if(row instanceof Element){row.setAttribute('role','menuitem');menu.append(row);continue;}if(row.hidden)continue;const item=make('button','source-menu-item'+(row.className?' '+row.className:''),row.label);item.type='button';item.setAttribute('role','menuitem');item.disabled=Boolean(row.disabled);item.onclick=()=>{menu.hidePopover();settled.then(row.run).catch(()=>{});};menu.append(item);}}
 // On a phone the menu is a sheet along the bottom (the standard's §4.3: a menu of more than six rows opens as a sheet); the CSS places it.
 function place(){if(matchMedia('(max-width:800px)').matches){menu.style.left=menu.style.top='';return;}const r=trigger.getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;let left=Math.max(8,Math.min(r.right-w,innerWidth-w-8)),top=r.bottom+4;if(top+h>innerHeight-8)top=Math.max(8,r.top-h-4);menu.style.left=left+'px';menu.style.top=top+'px';}
 // The history entry is added in the press itself, so a Back right after the menu appears closes it instead of leaving.
 trigger.addEventListener('click',()=>{if(!menu.matches(':popover-open'))fill();menu.togglePopover();if(menu.matches(':popover-open'))history.opened();});
 menu.addEventListener('beforetoggle',e=>{if(e.newState==='closed')settled=history.closed();});
 menu.addEventListener('toggle',e=>{const open=e.newState==='open';trigger.setAttribute('aria-expanded',String(open));if(open){place();history.opened();menu.querySelector('button:not(:disabled):not([data-ds-not-yet])')?.focus({preventScroll:true});}});
 document.body.append(menu);
 return{menu,close:()=>{if(menu.matches(':popover-open'))menu.hidePopover();}};
}

/**
 * @description An in-page confirmation (DS-30, never window.confirm): a modal dialog naming what happens, with Cancel
 *   and the action. Escape, Cancel, a backdrop tap and the browser's Back answer no.
 * @param {{title:string,text?:string,action:string}} ask - The question, one sentence and the action's word.
 * @returns {Promise<boolean>} true only when the action was pressed.
 */
export function confirmInPage({title,text,action}){
 const dialog=make('dialog','source-confirm'),heading=make('h2','',title),row=make('div','source-confirm-actions'),cancel=make('button','source-tertiary','Cancel'),go=make('button','source-confirm-go',action);
 heading.id='source-confirm-'+crypto.randomUUID().slice(0,8);dialog.setAttribute('aria-labelledby',heading.id);cancel.type=go.type='button';row.append(cancel,go);dialog.append(heading,...(text?[make('p','',text)]:[]),row);document.body.append(dialog);
 return new Promise(resolve=>{let answered=false;const history=backCloses({isOpen:()=>dialog.open,close:()=>finish(false,true)});
  function finish(yes,fromBack=false){if(answered)return;answered=true;if(dialog.open)dialog.close();const gone=fromBack?Promise.resolve():history.closed();dialog.remove();gone.then(()=>resolve(yes));}
  cancel.onclick=()=>finish(false);go.onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('click',e=>{if(e.target===dialog)finish(false);});
  dialog.showModal();history.opened();cancel.focus({preventScroll:true});});
}

/**
 * @description Install the brief and storyboard editor into the page's shared editor shell.
 * @param {object} options - app and kind (brand|story); viewport, navigation and header elements; foundation() returns the
 *   shared editor; readBrief/writeBrief move the brief to and from the page's fields; message(text) shows a status line;
 *   onChange() runs after each change; primary is the page's one main button for the app row; menu() returns the page's own
 *   ⋯ More rows (its connected editors and other page actions); sceneRows(scene,index) returns extra rows for a scene's ⋯
 *   menu; comments (true) adds the Comment control and the comments sheet; download is the page's own download link,
 *   placed in the app row and shown by the page only while a finished file exists.
 * @returns {object} prepare, refreshFromAssistant, handoffNotes, getState, getSelection, properties, applyProperty, save, notify, checkpoint, undo, redo, fromTemplate, openComments.
 */
export function installSourceEditor({app,kind,viewport,navigation,header,foundation,readBrief,writeBrief,message,onChange=()=>{},primary=null,menu:pageRows=()=>[],sceneRows=()=>[],comments:withComments=false,download=null}){
 const base='/api/'+app+'/source-projects';let id=null,revision=0,baseline=null,scenes=[],selected=null,busy=false,epoch=0,pending=null,draftId='brief:'+crypto.randomUUID(),undo=[],redo=[],threads=[],sheet=null;
 const read=()=>({version:1,kind,...readBrief(),scenes:clone(scenes),comments:clone(threads)});
 const dirty=()=>Boolean(!id&&(readBrief().title||readBrief().notes||scenes.length))||signature(read())!==baseline||Boolean(foundation()?.hasPending());
 const status=text=>message(text);
 async function api(path='',options={}){const response=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...options.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'Source request failed ('+response.status+').');return body;}
 // The app row: universal icons, Comment, Save source, the page's primary and ⋯ More, in one row (§3.1, X5, C-DES-3).
 const controls=make('div','source-project-actions');controls.setAttribute('role','toolbar');controls.setAttribute('aria-label','Source');
 function button(label,action,{cls='',aria=''}={}){const node=make('button',cls,label);node.type='button';if(aria)node.setAttribute('aria-label',aria);node.onclick=()=>Promise.resolve().then(action).catch(error=>status(error.message));return node;}
 const undoButton=button('↶',()=>history(-1),{cls:'source-icon',aria:'Undo'}),redoButton=button('↷',()=>history(1),{cls:'source-icon',aria:'Redo'});undoButton.title='Undo';redoButton.title='Redo';
 const comment=withComments?button('💬',()=>openComments(),{cls:'source-icon source-wide source-comment',aria:'Comments'}):null;if(comment)comment.title='Comments';
 const saveButton=button('Save source',()=>save(),{cls:'source-wide'});const spacer=make('span','source-spacer');
 if(download){download.classList.add('source-icon','source-download');download.hidden=true;}
 const more=button('⋯',()=>{},{cls:'source-icon source-more',aria:'More'});more.title='More';
 controls.append(undoButton,redoButton,...(comment?[comment]:[]),spacer,saveButton,...(download?[download]:[]),...(primary?[primary]:[]),more);header.append(controls);
 popoverMenu(more,()=>[
  {label:'Save source',run:()=>save(),className:'source-phone',disabled:busy},
  {label:'New source',run:()=>newSource(),disabled:busy},
  {label:'Reload saved',run:()=>id&&open(id),disabled:busy||!id},
  ...pageRows(),
  ...(comment?[{label:'Comments',run:()=>openComments(),className:'source-phone'}]:[]),
 ]);
 const library=document.createElement('section'),list=document.createElement('div'),libraryTitle=document.createElement('h2');libraryTitle.textContent='Saved source projects';library.append(libraryTitle,list);navigation.prepend(library);
 const story=document.createElement('section'),storyTitle=document.createElement('h2'),sceneList=document.createElement('div'),add=document.createElement('button');story.className='source-story';storyTitle.textContent='Storyboard';add.type='button';add.textContent='Add scene';sceneList.className='source-scenes';story.append(storyTitle,sceneList,add);viewport.append(story);
 add.onclick=()=>{if(busy)return;if(scenes.length>=32){status('A source project can contain at most 32 scenes.');return;}checkpoint();const scene={id:crypto.randomUUID(),title:'Scene '+(scenes.length+1),text:'',duration:5};scenes.push(scene);selected=scene.id;notify();};
 function checkpoint(){const value=read();if(!undo.length||signature(undo.at(-1))!==signature(value)){undo.push(value);if(undo.length>50)undo.shift();}redo=[];}
 // A history step restores the brief and scenes only: a posted comment is saved, so Undo never takes it back.
 function modelToInputs(model,{keepComments=false}={}){writeBrief(model);if(!keepComments)threads=clone(model.comments??[]);scenes=model.scenes.map(s=>({id:s.id,title:s.title,text:s.text,duration:s.duration}));if(!scenes.some(v=>v.id===selected))selected=null;}
 function history(direction){if(busy)return;foundation()?.discardPending();const from=direction<0?undo:redo,to=direction<0?redo:undo;if(!from.length)return;to.push(read());modelToInputs(from.pop(),{keepComments:true});notify();}
 // One scene, one list row: its name picks it; ⋯ holds its actions with Delete last (§4.6).
 let rowMenuFor=null;const rowTrigger=make('button');const rowMenu=popoverMenu(rowTrigger,()=>{const index=scenes.findIndex(v=>v.id===rowMenuFor);if(index<0)return[];const scene=scenes[index];return[
  {label:'Move up',run:()=>{checkpoint();[scenes[index-1],scenes[index]]=[scenes[index],scenes[index-1]];notify();},disabled:index===0||busy},
  {label:'Move down',run:()=>{checkpoint();[scenes[index],scenes[index+1]]=[scenes[index+1],scenes[index]];notify();},disabled:index===scenes.length-1||busy},
  {label:'Duplicate',run:()=>{checkpoint();const duplicate={...scene,id:crypto.randomUUID(),title:(scene.title+' copy').slice(0,120)};scenes.splice(index+1,0,duplicate);selected=duplicate.id;notify();},disabled:scenes.length>=32||busy},
  ...sceneRows(scene,index).map(row=>({...row,disabled:Boolean(row.disabled)||busy})),
  {label:'Delete',run:()=>{checkpoint();scenes.splice(index,1);if(selected===scene.id)selected=null;notify();status('Scene deleted. Undo brings it back.');},className:'source-destructive',disabled:busy}];});
 function renderScenes(){sceneList.replaceChildren();for(const [index,scene] of scenes.entries()){
  const row=make('div','source-scene'),pick=make('button','source-scene-pick',(index+1)+'. '+scene.title+' · '+scene.duration+'s');pick.type='button';pick.setAttribute('aria-pressed',String(scene.id===selected));pick.onclick=()=>{if(foundation()?.hasPending()){status('Finish or discard the current property edit first.');return;}selected=scene.id;notify();};
  const actions=make('button','source-icon source-scene-more','⋯');actions.type='button';actions.setAttribute('aria-haspopup','menu');actions.setAttribute('aria-label','Scene '+(index+1)+' actions');actions.title='Scene actions';actions.disabled=busy;
  actions.onclick=()=>{rowMenuFor=scene.id;const r=actions.getBoundingClientRect();rowTrigger.getBoundingClientRect=()=>r;rowTrigger.click();};
  row.append(pick,actions);sceneList.append(row);
 }if(!scenes.length){const note=make('p','source-empty','Add a scene to time the story.');sceneList.append(note);}}
 // The scene rows are redrawn only when they change, so typing in the brief adds nothing to the page below it (DS-28).
 let drawnScenes='';
 function notify(){syncCommentButton();sheet?.draw();saveButton.disabled=busy;undoButton.disabled=busy||!undo.length;redoButton.disabled=busy||!redo.length;add.disabled=busy||scenes.length>=32;const key=JSON.stringify([scenes,selected,busy]);if(key!==drawnScenes){drawnScenes=key;renderScenes();}previous=read();foundation()?.refresh();onChange();}
 let previous=read();
 for(const field of viewport.querySelectorAll('#title,#notes'))field.addEventListener('input',()=>{if(signature(previous)!==signature(read())){undo.push(previous);if(undo.length>50)undo.shift();redo=[];previous=read();}notify();});
 async function refreshLibrary(){try{const data=await api();list.replaceChildren();for(const item of data.projects){const row=document.createElement('button');row.type='button';row.className='source-library-row';row.textContent=item.title+' · revision '+item.revision;row.onclick=()=>open(item.id).catch(error=>status(error.message));list.append(row);}if(!data.projects.length)list.textContent='No saved source projects yet.';}catch(error){list.textContent='Saved sources unavailable: '+error.message;}}
 async function mayReplace(){return !dirty()||confirmInPage({title:'Discard unsaved changes?',text:'Your unsaved source changes are lost if you open another project.',action:'Discard'});}
 async function open(nextId,{fromAssistant=false}={}){
  if(busy)throw Error('Wait for the current source operation.');const original=signature(read()),originalPending=foundation()?.hasPending();if(!fromAssistant&&!await mayReplace())return;const loading=++epoch;busy=true;notify();
  try{const data=await api('/'+encodeURIComponent(nextId));const project=data.project;checkedModel(kind,project.model);if(loading!==epoch)return;
   if(fromAssistant){if(id!==nextId||dirty())throw Error('The assistant saved a source revision while you were editing. Your draft is still here. Reload saved to choose which version to open.');if(project.currentRevision<=revision)return;}
   else if((signature(read())!==original||Boolean(foundation()?.hasPending())!==Boolean(originalPending))&&!await mayReplace())return;
   const beforeModel=read();foundation()?.discardPending();id=project.id;revision=project.revision;draftId='brief:'+crypto.randomUUID();modelToInputs(project.model);baseline=signature(read());undo=fromAssistant?[...undo,beforeModel].slice(-50):[];redo=[];previous=read();pending=null;status('Opened source revision '+revision+'.');
  }finally{busy=false;notify();}
 }
 async function newSource(){if(busy||!await mayReplace())return;foundation()?.discardPending();++epoch;id=null;revision=0;draftId='brief:'+crypto.randomUUID();modelToInputs({version:1,kind,title:'Untitled brief',notes:'',sourceUrl:'',mode:kind==='brand'?'intro':'episode',scenes:[],comments:[]});baseline=null;undo=[];redo=[];previous=read();pending=null;status('New source project.');notify();}
 async function save(){if(busy)throw Error('Wait for the current source operation.');document.activeElement?.blur();await foundation()?.flushPending();if(!read().title.trim())throw Error('Give the source project a title before saving.');
  busy=true;notify();try{if(pending||!id||dirty()){
   if(!pending){const snapshot=read();pending={id,snapshot,body:{requestKey:crypto.randomUUID(),...(id?{baseRevision:revision,operations:[{op:'set-brief',values:{title:snapshot.title,notes:snapshot.notes,sourceUrl:snapshot.sourceUrl,mode:snapshot.mode}},{op:'replace-scenes',scenes:snapshot.scenes},{op:'replace-comments',comments:snapshot.comments}]}:{model:snapshot})}};}
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
 /** A template opens as a new, unsaved source: fresh scene ids, no comments, the person's own to edit and save (RP-BRG-01). */
 async function fromTemplate(model){if(busy)throw Error('Wait for the current source operation.');if(!await mayReplace())return false;foundation()?.discardPending();++epoch;id=null;revision=0;draftId='brief:'+crypto.randomUUID();
  modelToInputs({version:1,kind,title:String(model.title).slice(0,120),notes:String(model.notes).slice(0,2000),sourceUrl:'',mode:model.mode,scenes:model.scenes.map(scene=>({id:crypto.randomUUID(),title:String(scene.title).slice(0,120),text:String(scene.text).slice(0,2000),duration:scene.duration})),comments:[]});
  baseline=null;undo=[];redo=[];selected=null;previous=read();pending=null;status('Template "'+model.title+'" opened as a new brief. Edit it, then Save source.');notify();return true;}
 // Comments (RP-BRG-06): threads on the brief or on the chosen scene, with replies and Resolve, saved with the source.
 function openThreads(){return threads.filter(thread=>!thread.resolved).length;}
 function syncCommentButton(){if(!comment)return;const n=openThreads();comment.textContent=n?'💬 '+n:'💬';comment.setAttribute('aria-label',n?'Comments, '+n+' open':'Comments');comment.title=comment.getAttribute('aria-label');}
 function when(at){const d=new Date(at);return Number.isFinite(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'';}
 function targetName(target){if(target==='brief')return'the brief';const index=scenes.findIndex(scene=>scene.id===target);return index<0?'a removed scene':'scene '+(index+1)+', '+scenes[index].title;}
 async function postComment(change){change();notify();try{await save();return true;}catch(error){status(error.message+' The comment is kept and saved with your next Save source.');return false;}}
 function openComments(){
  if(sheet?.dialog.open){sheet.draw();return;}
  const target=selected&&scenes.some(scene=>scene.id===selected)?selected:'brief';
  const dialog=make('dialog','source-confirm source-comments'),heading=make('h2','','Comments'),scope=make('p','source-comment-scope'),list=make('div','source-comment-list'),resolvedBox=make('details','source-comment-resolved'),resolvedSummary=make('summary'),resolvedList=make('div','source-comment-list');
  heading.id='source-comments-'+crypto.randomUUID().slice(0,8);dialog.setAttribute('aria-labelledby',heading.id);resolvedBox.append(resolvedSummary,resolvedList);
  const form=make('form','source-comment-form'),field=make('textarea'),fieldLabel=make('label','source-comment-label','Add a comment'),row=make('div','source-confirm-actions'),close=make('button','source-tertiary','Close'),post=make('button','primary','Comment');
  field.maxLength=1000;field.rows=3;field.id='source-comment-text';fieldLabel.htmlFor=field.id;close.type='button';post.type='submit';row.append(close,post);form.append(fieldLabel,field,row);
  dialog.append(heading,scope,list,resolvedBox,form);document.body.append(dialog);
  function threadNode(thread){
   const node=make('article','source-comment'),body=make('p','source-comment-text',thread.text),meta=make('p','source-comment-meta',when(thread.at)+(thread.target===target?'':' · on '+targetName(thread.target))),replies=make('div','source-comment-replies'),actions=make('div','source-comment-actions');
   node.dataset.commentId=thread.id;for(const answer of thread.replies){const r=make('div','source-comment-reply');r.append(make('p','source-comment-text',answer.text),make('p','source-comment-meta',when(answer.at)));replies.append(r);}
   const replyButton=make('button','source-tertiary',thread.resolved?'':'Reply'),resolve=make('button','',thread.resolved?'Reopen':'Resolve');replyButton.type=resolve.type='button';replyButton.hidden=thread.resolved;
   resolve.onclick=()=>postComment(()=>{const live=threads.find(v=>v.id===thread.id);if(live)live.resolved=!live.resolved;}).then(draw);
   replyButton.onclick=()=>{const box=make('form','source-comment-form'),text=make('textarea'),go=make('button','','Reply');text.maxLength=1000;text.rows=2;text.setAttribute('aria-label','Reply to this comment');go.type='submit';box.append(text,go);
    box.onsubmit=event=>{event.preventDefault();const words=text.value.trim();if(!words)return;postComment(()=>{const live=threads.find(v=>v.id===thread.id);if(live&&live.replies.length<20)live.replies.push({id:crypto.randomUUID(),text:words,at:new Date().toISOString()});}).then(draw);};
    actions.replaceWith(box);text.focus();};
   actions.append(replyButton,resolve);node.append(body,meta,replies,actions);return node;
  }
  function draw(){
   const mine=threads.filter(thread=>thread.target===target||target==='brief');scope.textContent='On '+targetName(target)+(target==='brief'?' (and every scene)':'');
   const open=mine.filter(thread=>!thread.resolved),done=mine.filter(thread=>thread.resolved);
   list.replaceChildren(...open.map(threadNode));if(!open.length)list.append(make('p','source-empty','No open comments here.'));
   resolvedList.replaceChildren(...done.map(threadNode));resolvedSummary.textContent='Resolved ('+done.length+')';resolvedBox.hidden=!done.length;post.disabled=busy||threads.length>=64;
  }
  const history=backCloses({isOpen:()=>dialog.open,close:()=>finish(true)});
  function finish(fromBack=false){if(!dialog.open)return;dialog.close();if(!fromBack)history.closed();dialog.remove();sheet=null;}
  form.onsubmit=event=>{event.preventDefault();const words=field.value.trim();if(!words){field.focus();return;}if(threads.length>=64){status('A source keeps at most 64 comment threads. Remove or resolve some first.');return;}
   postComment(()=>{threads.push({id:crypto.randomUUID(),target,text:words,at:new Date().toISOString(),resolved:false,replies:[]});}).then(saved=>{if(saved)field.value='';draw();});};
  close.onclick=()=>finish();dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});dialog.addEventListener('click',event=>{if(event.target===dialog)finish();});
  sheet={dialog,draw};draw();dialog.showModal();history.opened();field.focus({preventScroll:true});
 }
 function handoffNotes(){const value=[readBrief().notes,...scenes.map((scene,index)=>(index+1)+'. '+scene.title+' ('+scene.duration+'s)\n'+scene.text)].filter(Boolean).join('\n\n');if(value.length>2000)throw Error('This source exceeds the receiving workflow’s 2,000-character brief limit. Shorten the scene text or continue editing the complete source here.');return value;}
 return{prepare:session.prepare,refreshFromAssistant:session.refresh,handoffNotes,getState,getSelection,properties,applyProperty,save,notify,checkpoint,undo:()=>history(-1),redo:()=>history(1),fromTemplate,openComments,selectedScene:()=>scenes.find(scene=>scene.id===selected)??null,showDownload:show=>{if(download)download.hidden=!show;},closeMenus:()=>rowMenu.close()};
}
