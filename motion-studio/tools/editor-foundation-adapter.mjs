/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Present native layer properties in the common editor and delegate every edit to exact-time native commands.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.3, phones (Roger, trial.oswarm.ai, 2026-11-06, F7, and the trial check: no blank composition, an empty "Create or open a composition to start" box, dead playback buttons, 244 px of bars): with no composition open the empty state's one primary action is New composition (the rail's own Create composition form and its defaults), with Open a saved one as a link to More; the time slider, playback, work area and timeline wait until a composition is open; the app bar is the status and More (the saved-composition list, Undo, Export and the Project menu); the first pane is named Layers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0, the oshal design standard (docs/ux/design-standard.md §3.1, §3.2, §3.3, §4.3, §4.4, §4.10, §5.1; Alight Motion and Node Video, REFP CONVENTIONS §5.4; Roger, trial.oswarm.ai, 2026-11-06, F7). With nothing saved the editor opens on a blank untitled 1920×1080, 10 s, 30 fps composition whose one primary, Add layer, sits on the empty stage; the composition is saved at its first edit. With compositions saved it opens on their list, newest first, with one + New at the bottom right. The app row is the composition's name and its menu (New, Open…, Import document…, Duplicate, Export editable JSON, Delete last, with an in-page confirm), Undo and Redo icons, the Saved caption and Render, the finishing primary once a layer exists, which opens the Export sheet that holds the render queue. The stage stays on top, then the transport (Previous frame, Play, Next frame) and the time slider, then the layer timeline as rows with keyframe diamonds; the selected layer's properties dock in the right pane on a desktop and open as a sheet on a phone, and each keyable property row carries a diamond that adds a key at the current time and opens its curve. One + Add holds Text, Shape, Solid, Photo and Camera or light, with Video and Audio greyed (RP-MOT-01). With no layer selected the panel shows the composition: size, frame rate, duration, the work area and a greyed Motion blur (RP-MOT-02). A phone's bottom bar is Layers · Add · Properties · Concierge · More; every sheet and menu is an opaque top-layer dialog with Done that the phone's Back closes; the editor's Concierge is the one assistant entry; how playback and property values work is in Help.
 */
const number=(key,label,value,group='Transform',unit='')=>({key,label,value,type:'number',step:'any',group,unit});
function readable(value){return typeof value==='number'&&Number.isFinite(value);}
export function motionProperties(adapter){
 const selected=adapter.layer(),info=adapter.state.propertiesInfo;if(!selected)return[];
 const fields=[{key:'name',label:'Layer name',type:'text',value:selected.name,group:'Layer',disabled:selected.switches.locked},{key:'visible',label:'Visible',type:'checkbox',value:!!selected.switches.video,group:'Layer',disabled:selected.switches.locked}];
 if(info&&adapter.propertiesCurrent())for(const prop of info.properties){
  const labels={'transform/position':['X','Y','Z'],'transform/scale':['Scale X','Scale Y','Scale Z'],'transform/rotation':['Rotation'],'transform/opacity':['Opacity'],'transform/orientation':['Orientation X','Orientation Y','Orientation Z'],'transform/rotationX':['Rotation X'],'transform/rotationY':['Rotation Y']};
  if(!labels[prop.path])continue;
  const values=Array.isArray(prop.value)?prop.value:[prop.value];values.forEach((value,index)=>{if(readable(value))fields.push({...number(prop.path+':'+index,labels[prop.path][index]??prop.name,value,'Transform',prop.path.includes('position')?'px':prop.path.includes('scale')||prop.path.includes('opacity')?'%':'°'),disabled:info.locked||adapter.state.playing||!!adapter.state.keyInfo});});
 }
 if(adapter.state.textInfo&&adapter.textCurrent()&&!adapter.state.textInfo.locked)fields.push({key:'text',label:'Text',type:'textarea',value:adapter.text(),group:'Text',disabled:adapter.state.playing});
 return fields;
}
export async function applyMotionProperty(adapter,key,value){
 const selected=adapter.layer(),info=adapter.state.propertiesInfo,field=motionProperties(adapter).find(field=>field.key===key);if(!field||field.disabled)throw new Error('Select an editable native layer at the current time.');
 if(key==='name')return adapter.apply([{command:'layer.rename',params:{layer:selected.id,name:value}}]);
 if(key==='visible')return adapter.apply([{command:'layer.setSwitch',params:{layers:[selected.id],switch:'video',value}}]);
 if(key==='text'){const text=adapter.state.textInfo,command=adapter.textCommand(value);if(command)return adapter.apply([command],{previewTick:text.compTimeTicks});return;}
 if(!adapter.propertiesCurrent())throw new Error('Read the current native properties before editing.');
 const split=key.lastIndexOf(':'),path=key.slice(0,split),index=Number(key.slice(split+1)),prop=info.properties.find(prop=>prop.path===path);if(!prop||!Number.isFinite(value))throw new Error('This native property is unavailable.');
 const updated=Array.isArray(prop.value)?prop.value.map((original,n)=>n===index?value:original):value;
 return adapter.patchProperties([{prop:prop.prop,value:updated}]);
}
function group(label,...elements){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=label;details.append(summary,...elements.filter(Boolean));return details;}
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const KEYABLE=new Set(['transform/opacity','transform/position','transform/scale','transform/rotation']);

/**
 * @description Modal top-layer layers for menus and sheets (docs/ux/design-standard.md §4.3, §4.4): opaque dialogs that close on Done,
 * Escape, a tap outside or the browser's Back (one history entry each, DS-39), borrowing the page's own elements while open and putting
 * them back where they were, so ids and handlers keep working. The same shape as Video 1.13.0's layers.
 * @param {Document} doc the editor's document
 * @returns {{create:Function,open:Function,close:Function,top:Function}} the layer controls
 */
export function createLayers(doc){
 const win=doc.defaultView,stack=[];let ignore=0;
 win.addEventListener('popstate',()=>{if(ignore>0){ignore-=1;return;}const top=stack.at(-1);if(top)void close(top.dialog,{history:false});});
 function create(title,className,{onClose}={}){
  const dialog=make('dialog','ds-layer '+className),head=make('header','ds-layer-head'),heading=make('h2','ds-layer-title',title),done=make('button','ds-layer-done','Done'),body=make('div','ds-layer-body');
  dialog.dataset.dsSheet='';dialog.setAttribute('aria-label',title);done.type='button';head.append(heading,done);dialog.append(head,body);
  done.addEventListener('click',()=>void close(dialog));dialog.addEventListener('cancel',event=>{event.preventDefault();void close(dialog);});
  dialog.addEventListener('click',event=>{if(event.target===dialog)void close(dialog);});doc.body.append(dialog);
  return{dialog,body,heading,done,onClose};
 }
 async function open(layer,{nodes=[],anchor=null}={}){
  const restore=nodes.filter(Boolean).map(node=>{const mark=doc.createComment('layer');node.before(mark);layer.body.append(node);if(node.tagName==='DETAILS'){const open=node.open;node.open=true;return()=>{node.open=open;mark.replaceWith(node);};}return()=>{mark.replaceWith(node);};});
  stack.push({dialog:layer.dialog,restore,onClose:layer.onClose});layer.dialog.showModal();
  if(anchor&&win.matchMedia('(min-width:801px)').matches){const box=anchor.getBoundingClientRect(),width=Math.max(240,layer.dialog.offsetWidth);layer.dialog.classList.add('ds-anchored');layer.dialog.style.left=Math.max(8,Math.min(box.right-width,win.innerWidth-width-8))+'px';layer.dialog.style.top=Math.min(box.bottom+4,Math.max(8,win.innerHeight-layer.dialog.offsetHeight-8))+'px';}
  try{win.history.pushState({...(win.history.state||{}),dsLayer:stack.length},'');}catch{/* embedded without history access: Done and Escape still close it */}
 }
 async function close(dialog,{history=true}={}){
  const index=stack.findIndex(entry=>entry.dialog===dialog);if(index<0)return;const [entry]=stack.splice(index,1);
  for(const undo of entry.restore.reverse())undo();dialog.close();dialog.remove();entry.onClose?.();
  if(history){
   const address=win.location.href;ignore+=1;
   await new Promise(resolve=>{let fired=false;const done=()=>{if(fired)return;fired=true;win.removeEventListener('popstate',done);resolve();};win.addEventListener('popstate',done);try{win.history.back();}catch{done();}setTimeout(()=>{if(!fired&&ignore>0)ignore-=1;done();},600);});
   try{if(win.location.href!==address)win.history.replaceState(win.history.state,'',address);}catch{/* embedded without history access */}
  }
 }
 return{create,open,close,top:()=>stack.at(-1)?.dialog??null};
}

/** The seconds and frame rate a native composition stores, as words for its settings panel. */
function compFacts(comp,ticks){
 const rate=comp.frame_rate?Number(comp.frame_rate.num)/Number(comp.frame_rate.den):NaN,seconds=Number(comp.duration)/ticks;
 const rgb=Array.isArray(comp.background)?comp.background.slice(0,3).map(value=>Math.round(Math.max(0,Math.min(1,Number(value)||0))*255)):null,hex=rgb?'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join(''):null;
 return[['Size',comp.width+' × '+comp.height],['Frame rate',Number.isFinite(rate)?(Math.round(rate*1000)/1000)+' fps':'—'],['Duration',Number.isFinite(seconds)?(Math.round(seconds*100)/100)+' s':'—'],...(hex?[['Background',hex]]:[])];
}

/**
 * @description Lay Motion Studio's native workbench out to the design standard over the shared editor, without changing
 * a single native command: the same forms, ids and handlers are moved into the app row, the stage, the timeline, the
 * docked properties, the + Add menu and the sheets, and the person's controls drive them.
 * @param {object} adapter the workbench's state and native operations (apply, chooseKey, selectLayer, closeProject, problem, …)
 * @returns {Promise<object>} the shared editor's controls with this layout's refresh
 */
export async function bindMotionFoundation(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js'),{plannedControl}=await import('/shared/ui/js/planned-control.js'),$=id=>document.getElementById(id);
 const root=document.body,main=document.querySelector('main'),navigation=main.querySelector('aside'),inspector=main.querySelector('aside:last-child'),center=main.querySelector('.center'),header=document.querySelector('header');
 const hold=make('div','motion-hold');hold.hidden=true;main.append(hold);
 const keyEditor=$('keyEditor'),workArea=$('workArea'),revision=$('revision');
 const timeline=make('section','motion-timeline');timeline.setAttribute('aria-label','Timeline');timeline.append($('timeline'));main.append(timeline);
 const layers=createLayers(document),wide=()=>!matchMedia('(max-width:800px)').matches,act=work=>async()=>{try{await work();}catch(error){adapter.problem(error);}};
 const sheet=(title,nodes,extra=[],options={})=>{const layer=layers.create(title,'ds-sheet'+(options.half?' ds-half':''),options);layer.body.append(...extra);return layers.open(layer,{nodes});};
 const saved=()=>[...$('projects').options].filter(option=>option.value);let listed=false,draft=false;
 new MutationObserver(()=>{listed=true;refresh();}).observe($('projects'),{childList:true});
 // In-page "are you sure" (§4.8): every confirm of the workbench asks here.
 adapter.setAsk(message=>new Promise(resolve=>{const removing=/^Remove/.test(message),layer=layers.create(removing?'Remove?':'Delete?','ds-sheet ds-confirm',{onClose:()=>resolve(chosen)});let chosen=false;
  const text=make('p','',message),row=make('div','ds-confirm-actions'),cancel=make('button','ds-layer-done','Cancel'),yes=make('button','ds-danger-fill',removing?'Remove':'Delete');
  cancel.type=yes.type='button';yes.dataset.dsDestructive='';cancel.onclick=()=>void layers.close(layer.dialog);yes.onclick=()=>{chosen=true;void layers.close(layer.dialog);};row.append(cancel,yes);layer.body.append(text,row);void layers.open(layer);}));

 // The rail: the layer tree (with a Composition row that shows the composition's own settings), Precompose and the photo library.
 const layerTree=make('section','motion-layer-tree'),compRow=make('button','motion-comp-row','Composition');compRow.type='button';
 layerTree.append(make('h2','','Layers'),$('comps').closest('label'),compRow,$('layers'));compRow.onclick=()=>adapter.selectLayer(null);
 const photos=group('Your photos',$('assets').closest('label'),$('reuse'),$('dropAsset'));
 hold.append($('new'),$('renderPanel'),$('bundlePanel'),$('importDocument'),$('add'),$('image').closest('label'),$('newSceneLayer'),$('key'),$('projects'),$('duplicate'),$('export'),$('delete'),$('selected'));
 navigation.replaceChildren(layerTree,group('Precompose layers',$('nest')),photos);
 // The stage on top, then the transport and the time slider (C-MOT-1).
 const stage=$('stage');stage.dataset.dsWork='';
 const start=make('div','motion-start'),startButton=make('button','primary','Add layer');startButton.type='button';startButton.setAttribute('aria-haspopup','dialog');start.append(startButton);stage.append(start);
 const transport=make('div','motion-transport'),playback=center.querySelector('.playback'),timeLabel=$('time').closest('label'),loopLabel=$('loop').closest('label');
 const icon=(node,glyph,label)=>{node.textContent=glyph;node.classList.add('motion-icon');node.setAttribute('aria-label',label);node.title=label;};
 const svg=d=>'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="'+d+'" fill="currentColor"/></svg>';
 icon($('previousFrame'),'','Previous frame');$('previousFrame').innerHTML=svg('M6 5h2v14H6zM19 5v14l-10-7z');icon($('nextFrame'),'','Next frame');$('nextFrame').innerHTML=svg('M16 5h2v14h-2zM5 5v14l10-7z');$('playbackStatus').classList.add('motion-sr');
 playback.prepend($('previousFrame'));transport.append(playback,loopLabel,$('playbackStatus'));
 const timeHeading=[...center.querySelectorAll(':scope > h2')].find(node=>node.textContent==='Timeline');timeHeading?.remove();
 center.replaceChildren(stage,transport,timeLabel);
 // The docked panel: the exact key editor, the composition's own settings when no layer is chosen, then the layer's tools.
 const settings=make('section','motion-comp-settings'),facts=make('dl','motion-facts'),draftNote=make('p','motion-help','Saved when you add the first layer.'),blur=plannedControl(document,{backlog:'RP-MOT-02',label:'Motion blur',variant:'menu',className:'ds-menu-row motion-planned-row'});
 const newForm=$('new');newForm.querySelector('button').hidden=true;newForm.append(draftNote);settings.append(make('h2','','Composition'),facts,newForm,workArea,blur);
 const layerHead=make('div','motion-layer-head'),layerName=make('p','motion-layer-name'),layerMenu=make('button','motion-icon','⋯');layerMenu.type='button';layerMenu.setAttribute('aria-label','Layer actions');layerMenu.title='Layer actions';layerMenu.setAttribute('aria-haspopup','dialog');layerHead.append(layerName,layerMenu);
 const layerButtons=$('layerUp').parentElement;hold.append(layerButtons);[...inspector.querySelectorAll(':scope > h2')].find(node=>node.textContent==='Selected layer')?.remove();
 inspector.prepend(keyEditor,settings,layerHead);
 for(const[id,label]of [['layerSettings','Layer organization'],['layerTiming','Layer timing'],['textPanel','Typography and character selection'],['transform','All transform axes'],['sceneProperties','Camera and light properties'],['effectsPanel','Effects'],['mask','Add mask'],['maskPanel','Mask geometry and feather']]){const element=$(id),wrapper=group(label);element.before(wrapper);wrapper.append(element);}
 const advanced=$('advanced').closest('details');hold.append(advanced);
 // The layer's own tools: its head (name and ⋯), then one closed "More layer tools" disclosure holding every specialised form.
 const layerTools=make('div','motion-layer-tools'),moreLayer=group('More layer tools');moreLayer.classList.add('motion-more-layer');
 for(const node of [...inspector.children])if(node!==keyEditor&&node!==settings&&node!==layerHead)moreLayer.append(node);
 layerTools.append(layerHead,moreLayer);inspector.append(layerTools);
 const selection=()=>({kind:'motion-layer',ids:adapter.state.project&&adapter.layer()?[String(adapter.state.comp)+':'+String(adapter.state.layer)+':'+String(adapter.tick())]:[]});
 let foundation;
 const getState=()=>({documentId:adapter.state.project?.id??null,revision:adapter.state.project?.revision??null,title:adapter.state.project?.title??'Untitled composition',dirty:adapter.hasDraft(),busy:adapter.state.busy,readOnly:!adapter.state.project||!adapter.state.permissions.change||adapter.state.historical,canUndo:!$('undo').disabled,canRedo:adapter.canRedo(),status:adapter.hasDraft()?'Field edits pending':'Saved native revision',error:$('error').hidden?null:$('error').textContent});
 const {createRegisteredEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const assistant=await createRegisteredEditorAssistant({app:'motion-studio',bot:'motion-editor',title:'Motion Studio AI partner',root,getState:()=>{const value=getState();return{...value,dirty:value.dirty||foundation?.hasPending()};},getSelection:selection});
 // The app row (§3.1, §5.1): the composition's name and its menu, Undo, Redo, the Saved caption and the finishing primary, Render.
 for(const node of header.querySelectorAll('[data-ef-phone="more"]'))node.removeAttribute('data-ef-phone');
 const docMenu=make('button','motion-doc'),docName=make('span','motion-doc-name','Untitled composition'),renderButton=make('button','primary motion-render','Render');
 docMenu.type=renderButton.type='button';docMenu.append(docName,make('span','motion-caret','▾'));docMenu.setAttribute('aria-haspopup','dialog');renderButton.setAttribute('aria-haspopup','dialog');
 icon($('undo'),'↶','Undo');icon($('redo'),'↷','Redo');$('status').classList.add('motion-saved');revision.classList.add('motion-sr');
 const row=make('nav','motion-toolrow');row.dataset.dsToolrow='';row.setAttribute('aria-label','Motion tools');
 header.replaceChildren(header.querySelector('h1'),docMenu,$('undo'),$('redo'),row,$('status'),revision,renderButton);
 foundation=createEditorFoundation({root,navigationLabel:'Layers',ai:assistant.element,header,navigation,viewport:center,inspector,timeline,
  getState,getSelection:selection,getProperties:()=>motionProperties(adapter),
  applyProperty:async(key,value,context)=>{if(context.documentId!==adapter.state.project?.id||context.revision!==adapter.state.project.revision||JSON.stringify(context.selection)!==JSON.stringify(selection()))throw new Error('The composition, layer or time changed. Select it again.');await applyMotionProperty(adapter,key,value);},actions:{undo:()=> $('undo').click(),redo:()=> $('redo').click(),export:()=> $('export').click()}});
 main.hidden=true;root.classList.add('motion-foundation');
 // The docked panel reads top down: the exact key being edited, the layer's name and its ⋯, its properties, then its other tools.
 const side=root.querySelector('.ef-inspector');side.querySelector('.ef-properties').before(keyEditor,layerHead);
 // One assistant entry (DS-33): the editor opens with its concierge closed; the tool row or the Today header opens it.
 root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
 const prompts=make('div','motion-prompts');prompts.append(plannedControl(document,{backlog:'RP-ALL-01',label:'Summarize',className:'motion-chip'}));assistant.element.querySelector('.ef-assistant-composer')?.before(prompts);

 // The list of saved compositions (N2): newest first (the store's own order), one + New at the bottom right.
 const home=make('section','motion-home'),homeList=make('div','motion-home-list'),newButton=make('button','primary motion-new','+ New');newButton.type='button';newButton.dataset.efFloating='';
 home.setAttribute('aria-label','Your compositions');home.append(make('h2','','Your compositions'),homeList,newButton);home.hidden=true;root.querySelector('.ef-viewport').prepend(home);
 newButton.onclick=()=>{draft=true;adapter.closeProject();refresh();};
 const openSaved=async id=>{draft=false;$('projects').value=id;$('projects').dispatchEvent(new Event('change'));};
 function compositionRows(onPick){return saved().map(option=>{const entry=make('button','motion-home-row');entry.type='button';entry.append(make('span','motion-home-title',option.textContent));entry.onclick=act(()=>onPick(option.value));return entry;});}
 // Saved at its first edit: a blank composition becomes a real one, with the settings the person chose, just before the first layer.
 async function ensureProject(){if(adapter.state.project)return true;if(!adapter.state.permissions?.create)throw new Error('This seat can watch compositions but not create one.');await newForm.onsubmit();draft=false;return Boolean(adapter.state.project);}
 async function addLayer(kind){
  if(!await ensureProject())return;const form=$('add').elements;form.kind.value=kind;form.text.value=kind==='text'?'Your caption':kind==='shape'?'Shape':'Solid';
  await $('add').onsubmit();
 }
 const image=$('image'),uploadPhoto=image.onchange;image.onchange=async event=>{try{if(!await ensureProject())return;}catch(error){adapter.problem(error);image.value='';return;}return uploadPhoto(event);};
 const menu=(title,items,anchor)=>{const layer=layers.create(title,'ds-menu'),list=make('div','ds-menu-list');list.setAttribute('role','menu');
  for(const item of items){if(!item)continue;if(item==='-'){list.append(make('hr','ds-menu-sep'));continue;}if(item.planned){list.append(plannedControl(document,{backlog:item.planned,label:item.label,variant:'menu',className:'ds-menu-row'}));continue;}
   const entry=make('button','ds-menu-row'+(item.danger?' ds-danger':''),item.label);entry.type='button';entry.disabled=Boolean(item.disabled);entry.setAttribute('role','menuitem');if(item.danger)entry.dataset.dsDestructive='';entry.onclick=act(async()=>{await layers.close(layer.dialog);await item.run();});list.append(entry);}
  layer.body.append(list);return layers.open(layer,{anchor});};
 const canAdd=()=>Boolean(adapter.state.project?adapter.state.permissions.change&&!adapter.state.historical:adapter.state.permissions?.create);
 function addMenu(anchor){const off=!canAdd();return menu('Add',[{label:'Text',run:()=>addLayer('text'),disabled:off},{label:'Shape',run:()=>addLayer('shape'),disabled:off},{label:'Solid',run:()=>addLayer('background'),disabled:off},
  {label:'Photo…',run:()=>image.click(),disabled:off},{label:'Camera or light…',run:async()=>{if(await ensureProject())await sheet('Camera or light',[$('newSceneLayer')]);},disabled:off},
  $('assets').options.length>1?{label:'From your photos…',run:()=>sheet('Your photos',[photos]),disabled:!adapter.state.project}:null,'-',{planned:'RP-MOT-01',label:'Video'},{planned:'RP-MOT-01',label:'Audio'}],anchor);}
 startButton.onclick=act(()=>addMenu(startButton));
 const help=make('div','motion-help-text');help.append(make('p','','Frames render one at a time, so playback may be slower than real time.'),make('p','','Properties show each value as it is stored at the current frame, before any expression runs; an expression may change what renders.'),make('p','','Renders use the saved revision you see. A render may be up to 264 MiB and five minutes long.'));
 function moreMenu(anchor){return menu('More',[{label:'More editing commands…',run:()=>sheet('More editing commands',[advanced]),disabled:!adapter.state.project},{label:'Help',run:()=>sheet('Help',[],[help])}],anchor);}
 const tool=(label,glyph,run,className='')=>{const button=make('button','motion-tool '+className);button.type='button';button.append(make('span','motion-glyph',glyph),make('span','motion-word',label));button.firstChild.setAttribute('aria-hidden','true');button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.onclick=act(()=>run(button));return button;};
 async function openConcierge(){
  if(wide()){if(root.dataset.editorConcierge==='open')root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));else foundation.showPanel('ai');return;}
  await sheet('Concierge',[assistant.element]);assistant.element.querySelector('textarea')?.focus({preventScroll:true});
 }
 const propertiesTitle=()=>adapter.layer()?adapter.layer().name:'Composition';
 const tools={layers:tool('Layers','☰',()=>sheet('Layers',[navigation])),add:tool('Add','+',button=>addMenu(button)),properties:tool('Properties','≡',()=>sheet(propertiesTitle(),[side]),'motion-phone-only'),
  concierge:tool('Concierge','✦',()=>openConcierge(),'motion-concierge'),more:tool('More','⋯',button=>moreMenu(button))};
 for(const[name,button]of Object.entries(tools))button.dataset.tool=name;row.append(tools.layers,tools.add,tools.properties,tools.concierge,tools.more);
 // The document menu (§5.1): New, Open…, Import…, Duplicate, Export editable JSON and, last, Delete.
 docMenu.onclick=act(()=>{const s=adapter.state,p=s.permissions||{};return menu('Composition',[{label:'New',run:()=>{draft=true;adapter.closeProject();refresh();},disabled:!p.create},
  {label:'Open…',run:()=>sheet('Your compositions',[],[...compositionRows(openSaved)]),disabled:!saved().length},{label:'Import document…',run:()=>sheet('Import document',[$('importDocument'),$('bundlePanel')]),disabled:!p.create},
  {label:'Duplicate',run:()=>$('duplicate').click(),disabled:$('duplicate').disabled},{label:'Export editable JSON',run:()=>$('export').click(),disabled:$('export').disabled},'-',
  {label:'Delete composition',danger:true,run:()=>$('delete').click(),disabled:$('delete').disabled}],docMenu);});
 renderButton.onclick=act(()=>sheet('Export',[$('renderPanel')]));
 layerMenu.onclick=act(()=>menu('Layer',[{label:'Move up',run:()=>$('layerUp').click(),disabled:$('layerUp').disabled},{label:'Move down',run:()=>$('layerDown').click(),disabled:$('layerDown').disabled},{label:'Duplicate',run:()=>$('duplicateLayer').click(),disabled:$('duplicateLayer').disabled},'-',{label:'Delete layer',danger:true,run:()=>$('deleteLayer').click(),disabled:$('deleteLayer').disabled}],layerMenu));

 // Keyframes live on each property's row (C-MOT-3): a diamond adds a key at the current time, or opens the key already there.
 function keysOf(path){const layer=adapter.layer();let node=layer?.props;for(const part of path.split('/'))node=node?.children?.find(child=>child.match===part);return node;}
 function keyHere(path){const node=keysOf(path),layer=adapter.layer();if(!node?.keys?.length||!layer)return null;const comp=adapter.comp(),frame=comp?Number(BigInt(adapter.state.ticks)*BigInt(comp.frame_rate.den)/BigInt(comp.frame_rate.num)):0,at=Number(adapter.tick())-Number(layer.start_time||0);
  const key=node.keys.find(item=>Math.abs(Number(item.time)-at)<=Math.max(1,frame/2));return key?{node,key}:null;}
 async function diamond(path){
  const found=keyHere(path),layer=adapter.layer();if(found){await adapter.chooseKey({layer:String(layer.id),prop:String(found.node.uid),timeTicks:String(found.key.time)});return;}
  const info=adapter.state.propertiesInfo,prop=info?.properties.find(item=>item.path===path);if(!prop||!adapter.propertiesCurrent())throw new Error('Read the current properties before adding a key.');
  const form=$('key').elements;form.path.value=path;form.value.value=Array.isArray(prop.value)?prop.value.join(','):String(prop.value);form.ease.value='linear';
  await $('key').onsubmit();const added=keyHere(path),now=adapter.layer();if(added&&now)await adapter.chooseKey({layer:String(now.id),prop:String(added.node.uid),timeTicks:String(added.key.time)});
 }
 function decorateDiamonds(){
  const edit=Boolean(adapter.state.project&&adapter.state.permissions.change&&!adapter.state.historical&&!adapter.state.busy&&!adapter.state.playing);
  for(const control of root.querySelectorAll('.ef-inspector [data-editor-property]')){
   const [path,index]=control.dataset.editorProperty.split(':'),label=control.closest('.ef-property');if(!label||!KEYABLE.has(path)||index!=='0')continue;
   let button=label.querySelector('.motion-diamond');
   if(!button){button=make('button','motion-diamond motion-icon');button.type='button';button.dataset.path=path;button.onclick=act(()=>diamond(path));label.append(button);label.classList.add('motion-keyed-row');}
   const has=Boolean(keyHere(path)),name=({'transform/opacity':'Opacity','transform/position':'Position','transform/scale':'Scale','transform/rotation':'Rotation'})[path];
   button.textContent=has?'◆':'◇';button.setAttribute('aria-pressed',String(has));button.setAttribute('aria-label',(has?'Edit the ':'Add a ')+name+' keyframe at '+adapter.state.time.toFixed(2)+' s');button.title=button.getAttribute('aria-label');button.disabled=!edit;
  }
 }

 let shownProject=null;
 // Inline text uses the very same retained native text draft and Save text operation.
 const inline=document.createElement('form'),label=document.createElement('label'),input=document.createElement('textarea'),save=document.createElement('button'),close=document.createElement('button');inline.className='motion-inline-text';inline.hidden=true;label.textContent='Edit selected composition text';label.append(input);input.setAttribute('aria-label','Edit text in composition');save.type='submit';save.textContent='Apply text';close.type='button';close.textContent='Close';inline.append(label,save,close);stage.append(inline);
 let inlineTarget=null;const target=()=>JSON.stringify([adapter.state.project?.id,adapter.state.project?.revision,String(adapter.state.comp),String(adapter.state.layer),String(adapter.tick())]);
 $('preview').addEventListener('dblclick',()=>{if(!motionProperties(adapter).some(field=>field.key==='text'&&!field.disabled))return;inlineTarget=target();input.value=adapter.text();inline.hidden=false;input.focus();if(wide())foundation.showPanel('properties');});
 input.addEventListener('input',()=>{if(inlineTarget!==target())return;const original=$('textEdit').elements.content;original.value=input.value;original.dispatchEvent(new Event('input',{bubbles:true}));});
 inline.onsubmit=async event=>{event.preventDefault();if(inlineTarget!==target()){adapter.problem(new Error('The selected text changed. Your native text draft remains in Typography.'));return;}try{await adapter.prepare();inline.hidden=true;}catch(error){adapter.problem(error);}};close.onclick=()=>{inline.hidden=true;};
 const handle=document.createElement('button');handle.type='button';handle.className='motion-position-handle';handle.hidden=true;handle.setAttribute('aria-label','Move selected layer in composition');stage.append(handle);handle.addEventListener('dblclick',()=> $('preview').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
 const movable=()=>{const info=adapter.state.propertiesInfo,selected=adapter.layer(),prop=info?.properties.find(prop=>prop.path==='transform/position');return adapter.propertiesCurrent()&&!info?.locked&&!info?.threeD&&!prop?.hasExpression&&!selected?.parent&&Array.isArray(prop?.value)&&prop.value.slice(0,2).every(readable)&&!adapter.state.playing?prop:null;};
 function placeHandle(){const position=movable(),image=$('preview'),comp=adapter.comp();handle.hidden=!position||image.hidden||!comp||adapter.state.busy;if(handle.hidden)return;const area=stage.getBoundingClientRect(),box=image.getBoundingClientRect();handle.style.left=(box.left-area.left+Number(position.value[0])/Number(comp.width)*box.width)+'px';handle.style.top=(box.top-area.top+Number(position.value[1])/Number(comp.height)*box.height)+'px';handle.textContent='↔';handle.title='Drag '+adapter.layer().name;}
 handle.onpointerdown=event=>{if(event.button!==0)return;const prop=movable();if(!prop)return;event.preventDefault();const origin=target(),start=[event.clientX,event.clientY],box=$('preview').getBoundingClientRect(),comp=adapter.comp(),original=prop.value;let updated=original;handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>{if(origin!==target())return;updated=original.map((value,index)=>index===0?value+(move.clientX-start[0])*Number(comp.width)/box.width:index===1?value+(move.clientY-start[1])*Number(comp.height)/box.height:value);const area=stage.getBoundingClientRect();handle.style.left=(box.left-area.left+updated[0]/Number(comp.width)*box.width)+'px';handle.style.top=(box.top-area.top+updated[1]/Number(comp.height)*box.height)+'px';};handle.onpointercancel=()=>{handle.onpointermove=null;placeHandle();};handle.onpointerup=async()=>{handle.onpointermove=null;if(origin!==target()||updated===original)return;try{await adapter.patchProperties([{prop:prop.prop,value:updated}]);}catch(error){adapter.problem(error);}placeHandle();};};
 const resize=new ResizeObserver(placeHandle);resize.observe(stage);$('preview').addEventListener('load',placeHandle);

 function refresh(){
  if(!foundation)return;const s=adapter.state,project=s.project,comp=adapter.comp(),hasLayer=Boolean(comp?.layers?.length),list=!project&&!draft&&listed&&saved().length>0;
  if(project?.id&&shownProject!==project.id){shownProject=project.id;draft=false;}
  home.hidden=!list;root.toggleAttribute('data-motion-home',list);root.toggleAttribute('data-motion-empty',!hasLayer);root.toggleAttribute('data-motion-composition',!adapter.layer());
  if(list)homeList.replaceChildren(...compositionRows(openSaved));newButton.disabled=!s.permissions?.create;
  start.hidden=hasLayer||list;startButton.disabled=!canAdd();renderButton.hidden=!hasLayer;renderButton.disabled=!s.permissions?.export||s.busy;
  docName.textContent=project?.title??'Untitled composition';docMenu.setAttribute('aria-label','Composition: '+docName.textContent);docMenu.title=docName.textContent;
  // The composition's own settings: editable before its first save, its facts and work area after.
  facts.replaceChildren(...(comp?compFacts(comp,s.ticks).flatMap(([term,value])=>{const dd=make('dd','',value);if(term==='Background'){const swatch=make('span','motion-swatch');swatch.style.background=value;swatch.setAttribute('aria-hidden','true');dd.prepend(swatch);}return[make('dt','',term),dd];}):[]));facts.hidden=!comp;newForm.hidden=Boolean(project);$('workArea').hidden=!project;
  settings.hidden=Boolean(adapter.layer());layerTools.hidden=layerHead.hidden=!adapter.layer();layerName.textContent=adapter.layer()?.name??'';layerMenu.disabled=!adapter.layer();
  compRow.setAttribute('aria-pressed',String(!adapter.layer()));compRow.hidden=!project;$('comps').closest('label').hidden=$('comps').options.length<2;
  const shellOwns=root.querySelector('.ef-panes [aria-controls$="-concierge"]')?.hidden;tools.concierge.classList.toggle('motion-phone-only',Boolean(shellOwns));
  tools.add.disabled=!canAdd();
  foundation.refresh();assistant.refresh();decorateDiamonds();if(inlineTarget&&inlineTarget!==target())inline.hidden=true;placeHandle();
 }
 return{...foundation,destroy:()=>{assistant.destroy();foundation.destroy();},refresh,layers};
}
