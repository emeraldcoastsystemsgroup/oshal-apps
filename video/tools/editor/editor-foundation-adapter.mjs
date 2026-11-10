/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Adapt real timeline clips and editable titles to the common document editor without replacing the owned model or history.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Phones (Roger, trial.oswarm.ai, 2026-11-06, F4: "doesn't have an upload vid to edit"): an empty project's one primary action is Add a clip (the real #addClip picker), with Add music as a text link; the first pane is named Media; Open a saved project, New, Undo, Redo and the Project menu move into More, so the app bar is the title, Save, Export and More.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0, the oshal design standard (docs/ux/design-standard.md §3, §4.3, §4.4, §4.10, §5.1; CapCut and InShot, REFP CONVENTIONS §5.3). The page declares its contract (an editor whose first action is adding a video; the preview is the work). Preview on top, then the transport (Undo, Redo, Play in the middle, Full screen), the timeline, and one row of labelled tools along the bottom that scrolls sideways with More last (Add, Text, Audio, Concierge, then the planned Stickers and Filters). Tapping a clip turns the row into that clip's tools (Split, Adjust, Earlier, Later, Delete, then the planned Speed, Effects, Chroma key, Remove background and Stabilize). An empty timeline holds the one primary, Add a clip, which opens the picker at once; with a clip on the timeline Export is the one primary at the right of the app row, and Save is a secondary button that shows only while there is something to save. The project name keeps its field and its menu (New, Open, Duplicate, Delete with an in-page confirm). Every tool opens an opaque modal sheet with Done that the phone's Back closes; the Export sheet keeps the working 720p row and greys 1080p, 4K and 60 fps. A clip the browser cannot decode is replaced by its placeholder sentence. The functions both references have and Video does not yet are greyed "Not available yet" controls (RP-VID-01..10, RP-ALL-01), from the shared planned-control helper.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.13.1: MERGE Vids clip generation into Add media — probe GET /api/vids/jobs?limit=1 and show "Generate a clip…" (prompt, orientation, placement, saved briefs) strictly when a Vids worker is online.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (RP-VID-01..10): wire live Stickers, Filters, Speed, Effects, Chroma key, Remove background, Stabilize, Auto captions, Voice, Sound effects and 720p/1080p/4K 30/60fps Export controls in place of planned placeholders while preserving RP-ALL-01 Summarize.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.14.1 (RP-ALL-01): remove duplicate greyed Summarize planned control from Video's Concierge panel because the kernel editor-assistant already renders live Summarize and Suggest improvements prompt chips.
 */
import * as timeline from './timeline-model.mjs';
import {applyMultitrack} from './multitrack-model.mjs';
import {createRpSheets} from './editor-rp-sheets.mjs';
const number=(key,label,value,min,max,group='Timing')=>({key,label,value,type:'number',min,max,step:1,group,unit:group==='Timing'?'frames':'%'});
const choice=(key,label,value,values)=>({key,label,value,type:'select',options:values.map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),group:'Text'});
export function videoProperties(document,selection){
 if(!selection)return[];
 if(['titles','captions'].includes(selection.kind)){
  const text=document[selection.kind]?.find(item=>item.id===selection.id);if(!text)return[];
  return [{key:'text',label:'Text',type:'textarea',value:text.text,group:'Text'},number('start','Start',text.start,0,1799),number('end','End',text.end,1,1800),choice('position','Position',text.position,['top','center','bottom']),choice('size','Size',text.size,['small','medium','large'])];
 }
 if(document.version===1){const clip=document.segments.find(item=>item.id===selection.id);if(!clip)return[];return[number('in','Source in',clip.in,0,document.sources[clip.source].frames-1),number('out','Source out',clip.out,1,document.sources[clip.source].frames),number('volume','Volume',clip.volume,0,200,'Audio'),number('speed','Speed',clip.speed??100,25,400,'Audio')];}
 const track=document.tracks.find(track=>track.clips.some(clip=>clip.id===selection.id)),clip=track?.clips.find(item=>item.id===selection.id);if(!clip)return[];
 const fields=[number('start','Timeline start',clip.start,0,1799),number('in','Source in',clip.in,0,document.sources[clip.source].frames-1),number('out','Source out',clip.out,1,document.sources[clip.source].frames),number('volume','Volume',clip.volume,0,200,'Audio'),number('speed','Speed',clip.speed??100,25,400,'Audio'),number('fadeIn','Fade in',clip.fadeIn,0,1800),number('fadeOut','Fade out',clip.fadeOut,0,1800)];
 if(track.kind==='video')fields.push(number('x','X',clip.x,-100,100,'Geometry'),number('y','Y',clip.y,-100,100,'Geometry'),number('scale','Scale',clip.scale,10,200,'Geometry'),number('opacity','Opacity',clip.opacity,0,100,'Appearance'),number('brightness','Brightness',clip.brightness,-100,100,'Appearance'),number('contrast','Contrast',clip.contrast,0,300,'Appearance'),number('saturation','Saturation',clip.saturation,0,300,'Appearance'));
 return fields.map(field=>({...field,disabled:track.locked}));
}
export function editVideoProperty(document,selection,key,value){
 const field=videoProperties(document,selection).find(field=>field.key===key);if(!field||field.disabled)throw new Error('Select an editable clip or title.');
 if(['titles','captions'].includes(selection.kind))return document.version===1?timeline.updateTitle(document,selection.id,{[key]:value}):applyMultitrack(document,{type:'updateText',track:selection.kind,id:selection.id,patch:{[key]:value}});
 if(document.version===2)return applyMultitrack(document,{type:'clip',id:selection.id,patch:{[key]:value}});
 const own=document.segments.find(item=>item.id===selection.id);return key==='volume'?timeline.setSegmentVolume(document,own.id,value):key==='speed'?timeline.patchSegment(document,own.id,{speed:value}):timeline.trimSegment(document,own.id,{in:own.in,out:own.out,[key]:value});
}
function disclosure(label,...contents){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=label;details.append(summary,...contents);return details;}
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

/**
 * @description Modal top-layer layers for menus and sheets (docs/ux/design-standard.md §4.3, §4.4): opaque dialogs that close on Done,
 * Escape, a tap outside or the browser's Back (one history entry each, DS-39), borrowing the page's own elements while open and putting
 * them back where they were, so ids and handlers keep working.
 * @param {Document} doc the editor's document
 * @returns {{create:Function,open:Function,close:Function,top:Function}} the layer controls
 */
export function createLayers(doc){
 const win=doc.defaultView,stack=[];let ignore=0;
 win.addEventListener('popstate',()=>{if(ignore>0){ignore-=1;return;}const top=stack.at(-1);if(top)void close(top.dialog,{history:false});});
 function create(title,className){
  const dialog=make('dialog','ds-layer '+className),head=make('header','ds-layer-head'),heading=make('h2','ds-layer-title',title),done=make('button','ds-layer-done','Done'),body=make('div','ds-layer-body');
  dialog.dataset.dsSheet='';dialog.setAttribute('aria-label',title);done.type='button';head.append(heading,done);dialog.append(head,body);
  done.addEventListener('click',()=>void close(dialog));dialog.addEventListener('cancel',event=>{event.preventDefault();void close(dialog);});
  dialog.addEventListener('click',event=>{if(event.target===dialog)void close(dialog);});doc.body.append(dialog);
  return{dialog,body,heading};
 }
 async function open(layer,{nodes=[],anchor=null}={}){
  // A borrowed control keeps its own hidden state (the exporter shows Cancel only while a job runs); a disclosure opens.
  const restore=nodes.filter(Boolean).map(node=>{const mark=doc.createComment('layer');node.before(mark);layer.body.append(node);if(node.tagName==='DETAILS'){const open=node.open;node.open=true;return()=>{node.open=open;mark.replaceWith(node);};}return()=>{mark.replaceWith(node);};});
  stack.push({dialog:layer.dialog,restore});layer.dialog.showModal();
  if(anchor&&win.matchMedia('(min-width:801px)').matches){const box=anchor.getBoundingClientRect(),width=Math.max(240,layer.dialog.offsetWidth);layer.dialog.classList.add('ds-anchored');layer.dialog.style.left=Math.max(8,Math.min(box.right-width,win.innerWidth-width-8))+'px';layer.dialog.style.top=Math.min(box.bottom+4,Math.max(8,win.innerHeight-layer.dialog.offsetHeight-8))+'px';}
  try{win.history.pushState({...(win.history.state||{}),dsLayer:stack.length},'');}catch{/* embedded without history access: Done and Escape still close it */}
 }
 async function close(dialog,{history=true}={}){
  const index=stack.findIndex(entry=>entry.dialog===dialog);if(index<0)return;const [entry]=stack.splice(index,1);
  for(const undo of entry.restore.reverse())undo();dialog.close();dialog.remove();
  if(history){
   // The layer's own entry goes; the address the page set while it was open (a document it opened) stays.
   const address=win.location.href;ignore+=1;
   await new Promise(resolve=>{let fired=false;const done=()=>{if(fired)return;fired=true;win.removeEventListener('popstate',done);resolve();};win.addEventListener('popstate',done);try{win.history.back();}catch{done();}setTimeout(()=>{if(!fired&&ignore>0)ignore-=1;done();},600);});
   try{if(win.location.href!==address)win.history.replaceState(win.history.state,'',address);}catch{/* embedded without history access */}
  }
 }
 return{create,open,close,top:()=>stack.at(-1)?.dialog??null};
}

export function createVidsClipGenerator(doc,layers){
 let online=null;const win=doc.defaultView;
 async function probeOnline(){
  if(online!==null)return online;
  if(typeof win?.fetch!=='function'){online=false;return false;}
  const ctrl=typeof AbortController==='function'?new AbortController():null,timer=ctrl?setTimeout(()=>ctrl.abort(),1500):null;
  try{const r=await win.fetch('/api/vids/jobs?limit=1',{credentials:'same-origin',...(ctrl?{signal:ctrl.signal}:{})});const j=r.ok?await r.json().catch(()=>null):null;online=Array.isArray(j?.workers)&&j.workers.some(w=>Boolean(w&&(w.status==='online'||w.healthy)));}
  catch{online=false;}finally{if(timer)clearTimeout(timer);}
  return online;
 }
 async function openGenerator(){
  const layer=layers.create('Generate a clip','ds-sheet'),form=make('div','vids-clip-sheet'),briefLabel=make('label','','Saved brief'),briefSelect=make('select',''),promptLabel=make('label','','Prompt'),prompt=make('textarea',''),orientLabel=make('label','','Orientation'),orient=make('select',''),placeLabel=make('label','','Placement'),place=make('select',''),status=make('p','video-help',''),submit=make('button','primary','Generate clip');
  briefSelect.innerHTML='<option value="">Write a new prompt…</option>';prompt.rows=3;submit.type='button';
  for(const [val,txt] of [['Landscape','Landscape (16:9)'],['Portrait','Portrait (9:16)'],['Square','Square (1:1)']])orient.append(new Option(txt,val));
  for(const [val,txt] of [['Insert','Add to timeline'],['Extend','Extend timeline']])place.append(new Option(txt,val));
  if(typeof win?.fetch==='function'){
   win.fetch('/api/vids/source-projects',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(j=>{
    for(const item of (j?.projects||[])){const opt=new Option(item.title||'Untitled brief',item.id);briefSelect.append(opt);}
   }).catch(()=>{});
  }
  briefSelect.onchange=async()=>{
   const id=briefSelect.value;if(!id||typeof win?.fetch!=='function')return;
   const r=await win.fetch('/api/vids/source-projects/'+encodeURIComponent(id),{credentials:'same-origin'}).catch(()=>null);
   const m=(r?.ok?await r.json().catch(()=>null):null)?.project?.model;
   if(m){prompt.value=m.prompt||'';if(m.orientation)orient.value=m.orientation;if(m.insertMode&&m.insertMode!=='none')place.value=m.insertMode;}
  };
  submit.onclick=async()=>{
   if(!prompt.value.trim()){status.textContent='Describe the clip first.';return;}
   submit.disabled=true;status.textContent='Queueing clip generation…';
   try{
    const res=await win.fetch('/api/vids/jobs',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:prompt.value.trim(),orientation:orient.value,insertMode:place.value})});
    const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||'Clip generation could not start.');
    status.textContent='Queued clip generation job.';
   }catch(err){status.textContent=err.message;}finally{submit.disabled=false;}
  };
  form.append(briefLabel,briefSelect,promptLabel,prompt,orientLabel,orient,placeLabel,place,submit,status);layer.body.append(form);return layers.open(layer);
 }
 async function extraNodes(){
  if(!await probeOnline())return[];
  const btn=make('button','ds-menu-row','Generate a clip…');btn.type='button';btn.dataset.vidsGenerate='';
  btn.onclick=async()=>{const top=layers.top();if(top)await layers.close(top);await openGenerator();};
  return[btn];
 }
 return{extraNodes,probeOnline};
}

export async function bindVideoFoundation(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js'),{plannedControl}=await import('/shared/ui/js/planned-control.js'),$=id=>document.getElementById(id);
 const root=document.body,main=document.querySelector('main.workspace'),media=main.querySelector('.media'),preview=main.querySelector('.preview'),legacy=main.querySelector('.inspector'),advanced=main.querySelector('.multitrack'),output=main.querySelector('.export');
 const inspector=document.createElement('div'),track=document.createElement('div'),hold=make('div','');hold.hidden=true;inspector.className='video-extra-tools';track.className='video-timeline';
 inspector.append(disclosure('Add titles and music',legacy),disclosure('Track, keyframe and caption tools',advanced));
 main.append(inspector,hold);track.append(main.querySelector('.timeline'),$('multiTracks'),$('multiTextList'));main.append(track);
 for(const id of ['exportMp4','renderPreview','cancelExport','downloadExport','projectList','newProject','saveAsNew','deleteProject'])hold.append($(id));
 const feedback=document.createElement('div');feedback.className='video-export-status';feedback.append($('exportHint'),$('exportProgress'),$('exportStatus'),$('watchExport'));document.querySelector('.status-strip').append(feedback);output.remove();
 const currentSelection=()=>{const selection=adapter.selection();return{kind:selection?.kind??'video',ids:selection?[selection.id]:[]};};
 const contextMatches=context=>context.documentId===(adapter.state.projectId??'draft:'+adapter.state.draftEpoch)&&context.revision===adapter.state.revision&&JSON.stringify(context.selection)===JSON.stringify(currentSelection());
 let foundation;
 const getState=()=>({documentId:adapter.state.projectId??'draft:'+adapter.state.draftEpoch,revision:adapter.state.revision,title:adapter.doc().name,dirty:adapter.dirty(),busy:adapter.state.busy,readOnly:!adapter.editable(),canUndo:adapter.state.history.canUndo(),canRedo:adapter.state.history.canRedo(),error:$('error').hidden?null:$('error').textContent});
 const {createRegisteredEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const assistant=await createRegisteredEditorAssistant({app:'video',bot:'video-editor',title:'Video AI partner',root,getState:()=>{const value=getState();return{...value,dirty:value.dirty||foundation?.hasPending()};},getSelection:currentSelection});
 foundation=createEditorFoundation({root,navigationLabel:'Media',ai:assistant.element,header:document.querySelector('header.bar'),navigation:media,viewport:preview,inspector,timeline:track,status:document.querySelector('.status-strip'),
  getState,getSelection:currentSelection,getProperties:()=>videoProperties(adapter.doc(),adapter.selection()),
  applyProperty:(key,value,context)=>{if(!contextMatches(context))throw new Error('The selected timeline object changed. Select it again.');if(!adapter.apply(current=>editVideoProperty(current,adapter.selection(),key,value)))throw new Error($('error').textContent||'This timeline edit was refused.');},actions:{save:adapter.save,undo:adapter.undo,redo:adapter.redo}});
 main.hidden=true;root.classList.add('video-foundation');
 // One assistant entry (DS-33): the editor opens with its concierge closed; the tool row or the Today header opens it.
 root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
 const layers=createLayers(document),vidsClip=createVidsClipGenerator(document,layers),wide=()=>!matchMedia('(max-width:800px)').matches,act=work=>async()=>{try{await work();}catch(error){$('error').textContent=error.message;$('error').hidden=false;}};
 const rp=createRpSheets({doc:document,adapter,exporter:adapter.exporter,layers,make,act,setStatus:adapter.setStatus});
 const sheet=(title,nodes,extra=[])=>{const layer=layers.create(title,'ds-sheet');layer.body.append(...extra);return layers.open(layer,{nodes});};
 // App row (§3.1, X5): the project's name and its menu, then Save while there is something to save and the one primary, Export.
 const bar=document.querySelector('header.bar'),actions=bar.querySelector('.actions'),projectMenu=make('button','video-icon','▾'),exportButton=make('button','primary video-export','Export');
 projectMenu.type=exportButton.type='button';projectMenu.setAttribute('aria-label','Project');projectMenu.title='Project';projectMenu.setAttribute('aria-haspopup','dialog');exportButton.setAttribute('aria-haspopup','dialog');
 bar.querySelector('.identity').dataset.efPhone='brand';bar.querySelector('.title-field').after(projectMenu);
 const undoButton=$('undo'),redoButton=$('redo');$('saveProject').classList.remove('primary');actions.replaceChildren($('saveProject'),exportButton);
 // Transport (C-VID-1): Undo, Redo, Play in the middle, Full screen.
 const transport=preview.querySelector('.transport'),full=make('button','video-icon');full.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';full.type='button';full.setAttribute('aria-label','Full screen');full.title='Full screen';
 for(const[node,glyph,label]of [[undoButton,'↶','Undo'],[redoButton,'↷','Redo']]){node.textContent=glyph;node.classList.add('video-icon');node.setAttribute('aria-label',label);}
 transport.prepend(undoButton,redoButton);transport.append(full);full.onclick=()=>{const on=!root.hasAttribute('data-video-full');root.toggleAttribute('data-video-full',on);full.setAttribute('aria-pressed',String(on));};
 const viewer=$('viewer');viewer.addEventListener('error',()=>viewer.classList.add('video-unplayable'));for(const type of ['emptied','loadeddata'])viewer.addEventListener(type,()=>viewer.classList.remove('video-unplayable'));
 preview.dataset.dsWork='';
 // The empty timeline holds the first action (§5.1: Video opens on an empty project with Add a clip inside the timeline).
 const start=make('div','video-start'),startButton=make('button','primary','Add a clip');startButton.type='button';start.append(startButton);startButton.onclick=()=>$('addClip').click();$('track').before(start);
 // The bottom tool row (N3): labelled tools that scroll sideways, More last; a clip's own tools while one is selected (X8).
 const row=make('nav','video-toolrow');row.dataset.dsToolrow='';row.setAttribute('aria-label','Video tools');bar.querySelector('.title-field').parentElement.insertBefore(row,actions);
 const tool=(label,glyph,run)=>{const button=make('button','video-tool');button.type='button';button.append(make('span','video-glyph',glyph),make('span','video-word',label));button.firstChild.setAttribute('aria-hidden','true');button.onclick=act(run);return button;};
 const menu=(title,items,anchor)=>{const layer=layers.create(title,'ds-menu'),list=make('div','ds-menu-list');list.setAttribute('role','menu');
  for(const item of items){if(item==='-'){list.append(make('hr','ds-menu-sep'));continue;}if(item.planned){list.append(plannedControl(document,{backlog:item.planned,label:item.label,variant:'menu',className:'ds-menu-row'}));continue;}
   const entry=make('button','ds-menu-row'+(item.danger?' ds-danger':''),item.label);entry.type='button';entry.disabled=Boolean(item.disabled);entry.setAttribute('role','menuitem');entry.onclick=act(async()=>{await layers.close(layer.dialog);await item.run();});list.append(entry);}
  layer.body.append(list);return layers.open(layer,{anchor});};
 const help=make('p','video-help','Space plays · ←/→ one frame (Shift: one second) · S splits at the playhead · [ and ] move · Delete removes · Ctrl+Z undoes · Ctrl+S saves.');
 const moreTools=button=>menu('More tools',[{label:'Track, keyframe and caption tools…',run:()=>sheet('Tracks and captions',[advanced])},{label:'Link a Motion composition…',run:()=>sheet('Motion',[$('motionImportPanel')])},{label:'Render preview…',run:()=>openExport()},'-',{label:'Keyboard shortcuts',run:()=>sheet('Keyboard shortcuts',[],[help])}],button);
 const audioRow=legacy.querySelector('#bedSource')?.closest('.row'),musicHeading=[...legacy.querySelectorAll('h2')].find(node=>node.textContent==='Music');
 function mainTools(){const more=tool('More','⋯',()=>moreTools(more));return[
  tool('Add','+',async()=>sheet('Add media',[media],await vidsClip.extraNodes())),
  tool('Text','T',()=>sheet('Text',[$('titlesHeading'),$('titleForm'),$('titles')],[rp.buildAutoCaptionsNode()])),
  tool('Audio','♪',()=>sheet('Audio',[musicHeading,audioRow],[rp.buildAudioActionsNode()])),
  conciergeTool(),tool('Stickers','☺',()=>rp.openStickersSheet()),tool('Filters','◐',()=>rp.openLooksSheet('global')),more];}
 function clipTools(isVideoClip=true){const more=tool('More','⋯',()=>moreTools(more)),version2=adapter.doc().version===2;return[
  tool('Done','✓',()=>{adapter.clearSelection();refresh();}),
  tool('Split','✂',()=>{if(version2){$('multiSplitFrame').value=String(adapter.frame());$('multiSplit').click();}else $('split').click();}),
  tool('Adjust','≡',()=>adjust()),
  ...(version2?[]:[tool('Earlier','←',()=>$('moveLeft').click()),tool('Later','→',()=>$('moveRight').click())]),
  destructive(tool('Delete','⌫',()=>version2?$('multiRemove').click():$('removeSegment').click())),
  tool('Speed','⏩',()=>rp.openSpeedSheet()),
  ...(isVideoClip?[tool('Effects','✧',()=>rp.openLooksSheet('clip')),tool('Chroma key','▣',()=>rp.openChromaKeySheet()),tool('Remove background','◌',()=>rp.openRemoveBgSheet()),tool('Stabilize','≋',()=>rp.openStabilizeSheet())]:[]),
  more];}
 function destructive(button){button.dataset.dsDestructive='';button.setAttribute('aria-label','Delete the selected clip');return button;}
 function conciergeTool(){const button=tool('Concierge','✦',()=>openConcierge());button.classList.add('video-concierge');return button;}
 function adjust(){if(wide()){root.querySelector('.ef-inspector')?.scrollIntoView({block:'nearest'});root.querySelector('.ef-inspector [data-editor-property]')?.focus({preventScroll:true});return;}return sheet('Adjust',[root.querySelector('.ef-inspector')]);}
 async function openConcierge(){
  if(wide()){if(root.dataset.editorConcierge==='open')root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));else foundation.showPanel('ai');return;}
  await sheet('Concierge',[assistant.element]);assistant.element.querySelector('textarea')?.focus({preventScroll:true});
 }
 async function openExport(){
  if(adapter.dirty()&&adapter.editable())await adapter.save();
  // The export controls are borrowed with their places kept, so they return to the page however the sheet closes.
  const layer=layers.create('Export','ds-sheet'),controls=['exportMp4','renderPreview','cancelExport','downloadExport'].map(id=>$(id));
  await layers.open(layer,{nodes:controls});
  const rows=rp.buildExportProfileNode(controls[0]),tools=make('div','video-export-tools');
  tools.append(...controls.slice(1));layer.body.append(rows,tools);
 }
 exportButton.onclick=act(()=>openExport());
 projectMenu.onclick=act(()=>{const s=adapter.state;return menu('Project',[{label:'New project',run:()=>$('newProject').click(),disabled:$('newProject').disabled},{label:'Open…',run:()=>openProjects(),disabled:$('projectList').disabled},{label:'Duplicate',run:()=>$('saveAsNew').click(),disabled:$('saveAsNew').disabled},'-',{label:'Delete project',danger:true,run:()=>confirmDelete(),disabled:$('deleteProject').disabled||!s.projectId}],projectMenu);});
 function openProjects(){const list=make('div','ds-menu-list');for(const option of [...$('projectList').options].filter(option=>option.value)){const entry=make('button','ds-menu-row',option.textContent);entry.type='button';entry.onclick=act(async()=>{await layers.close(layers.top());$('projectList').value=option.value;$('projectList').dispatchEvent(new Event('change'));});list.append(entry);}return sheet('Your projects',[],[list]);}
 function confirmDelete(){const layer=layers.create('Delete this project?','ds-sheet ds-confirm'),text=make('p','',`Delete "${adapter.doc().name}" and its exports? This cannot be undone.`),actionsRow=make('div','ds-confirm-actions'),cancel=make('button','ds-layer-done','Cancel'),remove=make('button','ds-danger-fill','Delete project');
  cancel.type=remove.type='button';remove.dataset.dsDestructive='';cancel.onclick=()=>void layers.close(layer.dialog);remove.onclick=act(async()=>{await layers.close(layer.dialog);adapter.confirmNext();$('deleteProject').click();});actionsRow.append(cancel,remove);layer.body.append(text,actionsRow);return layers.open(layer);}
 const selectText=(kind,id)=>{adapter.selectText(kind,id);foundation.refresh();assistant.refresh();if(wide())foundation.showPanel('properties');else void sheet('Adjust',[root.querySelector('.ef-inspector')]);};
 for(const host of [$('titleTrack'),$('titles'),$('multiTextList')])host.addEventListener('click',event=>{const node=event.target.closest('[data-select-text]');if(node)selectText(node.dataset.textKind??'titles',node.dataset.selectText);});
 $('titleOverlay').tabIndex=0;$('titleOverlay').setAttribute('role','button');$('titleOverlay').setAttribute('aria-label','Select title on preview');
 $('titleOverlay').addEventListener('click',()=>{const title=adapter.doc().titles.find(item=>adapter.frame()>=item.start&&adapter.frame()<item.end);if(title)selectText('titles',title.id);});
 $('titleOverlay').addEventListener('dblclick',()=>{if(!adapter.editable()||adapter.doc().version!==1)return;const title=adapter.doc().titles.find(item=>adapter.frame()>=item.start&&adapter.frame()<item.end);if(!title)return;selectText('titles',title.id);const original=title.text,epoch=adapter.state.draftEpoch;$('titleOverlay').contentEditable='plaintext-only';$('titleOverlay').focus();const finish=()=>{$('titleOverlay').contentEditable='false';const text=$('titleOverlay').textContent;if(text!==original&&adapter.state.draftEpoch===epoch&&adapter.editable())adapter.apply(current=>timeline.updateTitle(current,title.id,{text}));};$('titleOverlay').addEventListener('blur',finish,{once:true});});
 let rowKind='';
 const refresh=()=>{
  $('multiTracks').hidden=adapter.doc().version!==2;$('multiTextList').hidden=adapter.doc().version!==2;
  const doc=adapter.doc(),hasMedia=Object.keys(doc.sources||{}).length>0,hasClip=doc.version===2?doc.tracks.some(item=>item.clips.length):doc.segments.length>0,sel=adapter.selection(),clip=sel&&['segment','clip'].includes(sel.kind);
  const isVideoClip=Boolean(clip&&(doc.version!==2||doc.tracks.some(tr=>tr.kind==='video'&&tr.clips.some(c=>c.id===sel.id))));
  start.hidden=hasMedia;root.toggleAttribute('data-video-empty',!hasMedia);root.toggleAttribute('data-video-no-titles',!doc.titles?.length);startButton.disabled=$('addClip').disabled;$('saveProject').hidden=!(adapter.dirty()&&adapter.editable());exportButton.hidden=!hasClip;exportButton.disabled=!adapter.permissions().export;
  const kind=clip?(isVideoClip?'clip-video':'clip-audio'):'main';if(kind!==rowKind||!row.children.length){rowKind=kind;row.replaceChildren(...(clip?clipTools(isVideoClip):mainTools()));}
  const shellOwns=root.querySelector('.ef-panes [aria-controls$="-concierge"]')?.hidden;row.querySelector('.video-concierge')?.classList.toggle('video-phone-only',Boolean(shellOwns));
  foundation.refresh();assistant.refresh();};
 return{...foundation,destroy:()=>{assistant.destroy();foundation.destroy();},refresh,layers,confirmDelete};
}
