/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Present native layer properties in the common editor and delegate every edit to exact-time native commands.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.3, phones (Roger, trial.oswarm.ai, 2026-11-06, F7, and the trial check: no blank composition, an empty "Create or open a composition to start" box, dead playback buttons, 244 px of bars): with no composition open the empty state's one primary action is New composition (the rail's own Create composition form and its defaults), with Open a saved one as a link to More; the time slider, playback, work area and timeline wait until a composition is open; the app bar is the status and More (the saved-composition list, Undo, Export and the Project menu); the first pane is named Layers.
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
export async function bindMotionFoundation(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js'),$=id=>document.getElementById(id),root=document.body,main=document.querySelector('main'),navigation=main.querySelector('aside'),inspector=main.querySelector('aside:last-child'),center=main.querySelector('.center');
 const timeline=document.createElement('section');timeline.className='motion-timeline';timeline.append($('timeline'));main.append(timeline);
 // Group expensive or specialized workflows, keeping layer creation/selection in view.
 const newForm=$('new');if(newForm.previousElementSibling?.tagName==='H2')newForm.previousElementSibling.remove();const newGroup=group('New composition',newForm);newGroup.open=true;navigation.prepend(newGroup);
 for(const id of ['renderPanel','bundlePanel','importDocument','nest']){const element=$(id),wrapper=group(({renderPanel:'Render and export',bundlePanel:'Portable project',importDocument:'Import document',nest:'Precompose layers'})[id]);element.before(wrapper);wrapper.append(element);}
 for(const[id,label]of [['layerSettings','Layer organization'],['layerTiming','Layer timing'],['textPanel','Typography and character selection'],['transform','All transform axes'],['sceneProperties','Camera and light properties'],['newSceneLayer','Add camera or light'],['key','Add keyframe'],['effectsPanel','Effects'],['mask','Add mask'],['maskPanel','Mask geometry and feather']]){const element=$(id),wrapper=group(label);element.before(wrapper);wrapper.append(element);}
 const menu=group('Project',$('refresh'),$('duplicate'),$('delete'));menu.dataset.efPhone='more';document.querySelector('header').append(menu);
 const saved=()=>Math.max(0,$('projects').options.length-1),timeLabel=$('time').closest('label'),loopLabel=$('loop').closest('label');
 const start={when:()=>!adapter.state.project,lede:'Animate text, shapes and photos, then render a movie.',label:'New composition',run:()=>$('new').requestSubmit(),
  disabled:()=>Boolean(adapter.state.ready&&!adapter.state.permissions?.create),denied:'This seat can watch compositions but not create one.',
  replaces:[$('empty'),timeLabel,center.querySelector('.playback'),loopLabel,$('playbackStatus'),center.querySelector('.playbackNote'),$('workArea'),[...center.querySelectorAll(':scope > h2')].find(heading=>heading.textContent==='Timeline'),timeline].filter(Boolean),
  secondary:[{label:()=>saved()?`Open a saved one (${saved()})`:'',run:()=>document.querySelector('.ef-more-button')?.click()}]};
 const selection=()=>({kind:'motion-layer',ids:adapter.state.project&&adapter.layer()?[String(adapter.state.comp)+':'+String(adapter.state.layer)+':'+String(adapter.tick())]:[]});
 let foundation;
 const getState=()=>({documentId:adapter.state.project?.id??null,revision:adapter.state.project?.revision??null,title:adapter.state.project?.title??'Motion Studio',dirty:adapter.hasDraft(),busy:adapter.state.busy,readOnly:!adapter.state.project||!adapter.state.permissions.change||adapter.state.historical,canUndo:adapter.state.project?.revision>1,status:adapter.hasDraft()?'Field edits pending':'Saved native revision',error:$('error').hidden?null:$('error').textContent});
 const {createRegisteredEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const assistant=await createRegisteredEditorAssistant({app:'motion-studio',bot:'motion-editor',title:'Motion Studio AI partner',root,getState:()=>{const value=getState();return{...value,dirty:value.dirty||foundation?.hasPending()};},getSelection:selection});
 foundation=createEditorFoundation({root,navigationLabel:'Layers',start,ai:assistant.element,header:document.querySelector('header'),navigation,viewport:center,inspector,timeline,
  getState,getSelection:selection,getProperties:()=>motionProperties(adapter),
  applyProperty:async(key,value,context)=>{if(context.documentId!==adapter.state.project?.id||context.revision!==adapter.state.project.revision||JSON.stringify(context.selection)!==JSON.stringify(selection()))throw new Error('The composition, layer or time changed. Select it again.');await applyMotionProperty(adapter,key,value);},actions:{undo:()=> $('undo').click(),export:()=> $('export').click()}});
 main.hidden=true;root.classList.add('motion-foundation');
 const layerTree=document.createElement('section'),heading=document.createElement('h2');heading.textContent='Layers';layerTree.append(heading,$('comps').parentElement,$('layers'));navigation.prepend(layerTree);for(const heading of navigation.querySelectorAll(':scope > h2'))if(heading.textContent==='Layers')heading.remove();
 let shownProject=null;
 // Inline text uses the very same retained native text draft and Save text operation.
 const inline=document.createElement('form'),label=document.createElement('label'),input=document.createElement('textarea'),save=document.createElement('button'),close=document.createElement('button');inline.className='motion-inline-text';inline.hidden=true;label.textContent='Edit selected composition text';label.append(input);input.setAttribute('aria-label','Edit text in composition');save.type='submit';save.textContent='Apply text';close.type='button';close.textContent='Close';inline.append(label,save,close);$('stage').append(inline);
 let inlineTarget=null;const target=()=>JSON.stringify([adapter.state.project?.id,adapter.state.project?.revision,String(adapter.state.comp),String(adapter.state.layer),String(adapter.tick())]);
 $('preview').addEventListener('dblclick',()=>{if(!motionProperties(adapter).some(field=>field.key==='text'&&!field.disabled))return;inlineTarget=target();input.value=adapter.text();inline.hidden=false;input.focus();foundation.showPanel('properties');});
 input.addEventListener('input',()=>{if(inlineTarget!==target())return;const original=$('textEdit').elements.content;original.value=input.value;original.dispatchEvent(new Event('input',{bubbles:true}));});
 inline.onsubmit=async event=>{event.preventDefault();if(inlineTarget!==target()){adapter.problem(new Error('The selected text changed. Your native text draft remains in Typography.'));return;}try{await adapter.prepare();inline.hidden=true;}catch(error){adapter.problem(error);}};close.onclick=()=>{inline.hidden=true;};
 const handle=document.createElement('button');handle.type='button';handle.className='motion-position-handle';handle.hidden=true;handle.setAttribute('aria-label','Move selected layer in composition');$('stage').append(handle);handle.addEventListener('dblclick',()=> $('preview').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
 const movable=()=>{const info=adapter.state.propertiesInfo,selected=adapter.layer(),prop=info?.properties.find(prop=>prop.path==='transform/position');return adapter.propertiesCurrent()&&!info?.locked&&!info?.threeD&&!prop?.hasExpression&&!selected?.parent&&Array.isArray(prop?.value)&&prop.value.slice(0,2).every(readable)&&!adapter.state.playing?prop:null;};
 function placeHandle(){const position=movable(),image=$('preview'),comp=adapter.comp();handle.hidden=!position||image.hidden||!comp||adapter.state.busy;if(handle.hidden)return;const area=$('stage').getBoundingClientRect(),box=image.getBoundingClientRect();handle.style.left=(box.left-area.left+Number(position.value[0])/Number(comp.width)*box.width)+'px';handle.style.top=(box.top-area.top+Number(position.value[1])/Number(comp.height)*box.height)+'px';handle.textContent='↔';handle.title='Drag '+adapter.layer().name;}
 handle.onpointerdown=event=>{if(event.button!==0)return;const prop=movable();if(!prop)return;event.preventDefault();const origin=target(),start=[event.clientX,event.clientY],box=$('preview').getBoundingClientRect(),comp=adapter.comp(),original=prop.value;let updated=original;handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>{if(origin!==target())return;updated=original.map((value,index)=>index===0?value+(move.clientX-start[0])*Number(comp.width)/box.width:index===1?value+(move.clientY-start[1])*Number(comp.height)/box.height:value);const area=$('stage').getBoundingClientRect();handle.style.left=(box.left-area.left+updated[0]/Number(comp.width)*box.width)+'px';handle.style.top=(box.top-area.top+updated[1]/Number(comp.height)*box.height)+'px';};handle.onpointercancel=()=>{handle.onpointermove=null;placeHandle();};handle.onpointerup=async()=>{handle.onpointermove=null;if(origin!==target()||updated===original)return;try{await adapter.patchProperties([{prop:prop.prop,value:updated}]);}catch(error){adapter.problem(error);}placeHandle();};};
 const resize=new ResizeObserver(placeHandle);resize.observe($('stage'));$('preview').addEventListener('load',placeHandle);
 const refresh=()=>{if(adapter.state.project?.id&&shownProject!==adapter.state.project.id){shownProject=adapter.state.project.id;newGroup.open=false;}foundation.refresh();assistant.refresh();if(inlineTarget&&inlineTarget!==target())inline.hidden=true;placeHandle();};
 return{...foundation,destroy:()=>{assistant.destroy();foundation.destroy();},refresh};
}
