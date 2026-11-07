/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native Scene tree selection, transforms, materials, text and Blender keyframes in the common editor; source files/MCP remain genuine advanced workflows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use safe typed inspection/property endpoints instead of caller-authored Blender Python.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (scene-studio--scene-studio): two views in one screen, Scene (the preview filling the centre, the scene tree, properties and keyframes) and Script & build (the source editor, assets, Run, the godot-mcp and Blender Python tools, model import and export, no nested accordions); keyframes (Frame, property, Set keyframe) sit in Properties and Revision history and Help are app-row panels that go into More on a phone, so nothing is fixed over the work; the tree shows a node-type icon and the name on one line with the type in the tooltip; the first pane is named Objects; Undo, Save and Set keyframe are disabled while no project is open, gated as soon as the editor is bound.
 */
import{parseGodotScene,godotNodeProperties,patchGodotNode,parseBlenderInspection,blenderProperties}from'./scene-object-model.mjs';
const group=(label,...nodes)=>{const d=document.createElement('details'),s=document.createElement('summary');s.textContent=label;d.append(s,...nodes.filter(Boolean));return d;};
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
/** Stroke icons (24-unit grid) for node types and the New types. */
const ICONS={mesh:'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',light:'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',camera:'M3 7h11v10H3z M14 10l7-3v10l-7-3z',node:'M12 3v18 M3 12h18 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',text:'M5 5h14 M12 5v14 M9 19h6',sprite:'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4',game:'M6 9h12a4 4 0 0 1 0 8c-1.5 0-2.5-1-3.5-2h-5c-1 1-2 2-3.5 2a4 4 0 0 1 0-8z M8 11v4 M6 13h4 M16 12h.01 M18 14h.01',scene:'M3 19l6-8 4 5 3-3 5 6z M17 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',other:'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z'};
/**
 * @description One icon as an inline SVG built with DOM calls (no markup strings).
 * @param {string} name - An ICONS key; an unknown name draws the plain dot.
 * @returns {SVGElement} The icon, decorative (its label is the text beside it).
 */
export function sceneIcon(name){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',ICONS[name]||ICONS.other);svg.append(path);return svg;}
/**
 * @description The icon for a Godot node class or a Blender object type.
 * @param {string} type - The node class (MeshInstance3D, Camera3D…) or Blender type (MESH, LIGHT…).
 * @returns {string} An ICONS key.
 */
export function nodeIcon(type){const t=String(type||'');return /Mesh|MESH|CSG|SURFACE|META|CURVE/.test(t)?'mesh':/Light|LIGHT/.test(t)?'light':/Camera|CAMERA/.test(t)?'camera':/Label|Text|FONT/.test(t)?'text':/Sprite|2D|Texture|Control/.test(t)?'sprite':'node';}
/** Two views in one screen: Scene (preview, tree, properties, keyframes) and Script & build (source, tools, export). */
function buildViews($,viewport){
 const projectPanel=$('project-panel'),preview=$('preview-img').closest('section'),scenePanel=node('div'),buildPanel=node('div'),row=projectPanel.firstElementChild;
 scenePanel.id='scene-panel';buildPanel.id='build-panel';
 for(const[panel,tab]of[[scenePanel,'view-scene'],[buildPanel,'view-build']]){panel.className='scene-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab);}
 scenePanel.append(preview);
 buildPanel.append($('file-text').closest('section'),$('run-section'),$('godot-tools'),$('blender-tools'),$('import-section'),$('export-format').closest('section'));
 viewport.append($('execution-access'),$('engine-banner'),$('home'),row,scenePanel,buildPanel);
 let view='scene';
 const show=(name,focus)=>{view=name;for(const key of['scene','build']){const tab=$('view-'+key),on=key===name;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;if(on&&focus)tab.focus();}};
 for(const key of['scene','build'])$('view-'+key).addEventListener('click',()=>show(key));
 $('scene-views').addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show(view==='scene'?'build':'scene',true);$('view-'+view).click();}});
 show('scene');
 return{row,scenePanel,buildPanel,current:()=>view};
}
/** The app row: the Project menu, Undo and Save before Revision history and Help (both go into More on a phone). */
function buildHeader($,adapter){
 const header=document.querySelector('header'),history=$('scene-history'),projectMenu=group('Project',$('rename-project'),$('delete-project'));
 projectMenu.dataset.efPhone='more';header.insertBefore(projectMenu,history);history.append($('revision-list').closest('section'));
 for(const[id,label,fn]of[['scene-undo','Undo',()=>adapter.undo()],['scene-save','Save',()=>adapter.prepare()]]){const b=node('button',label);b.id=id;b.type='button';b.disabled=true;if(id==='scene-save')b.dataset.efPhone='more';b.onclick=async()=>{try{await fn();}catch(error){adapter.problem(error);}};header.insertBefore(b,history);}
 return{projectMenu,history};
}
/** Keyframes (Frame, property, Set keyframe) for the Properties pane. */
function buildFrameTools(){
 const frameTools=node('div'),frameLabel=node('label','Frame '),frameInput=node('input'),channel=node('select'),addKey=node('button','Set keyframe'),animationNote=node('p','Transform edits on animated objects set a keyframe at the displayed frame.');
 frameTools.className='scene-frame-tools';frameInput.type='number';frameInput.min='1';frameInput.max='1000000';frameInput.step='1';frameInput.value='1';frameInput.setAttribute('aria-label','Scene frame');frameLabel.append(frameInput);
 for(const[key,label]of[['location','Position'],['rotation','Rotation'],['scale','Scale']]){const o=node('option',label);o.value=key;channel.append(o);}channel.setAttribute('aria-label','Keyframe channel');addKey.type='button';addKey.disabled=true;
 frameTools.append(node('h3','Keyframes'),frameLabel,channel,addKey,animationNote);
 return{frameTools,frameInput,channel,addKey};
}
export async function bindSceneFoundation(adapter){
 const{createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js'),$=id=>document.getElementById(id),root=document.body,main=document.querySelector('main'),navigation=document.querySelector('.layout > aside'),inspector=node('aside'),viewport=node('section');
 inspector.className='scene-native-tools';viewport.className='scene-viewport';main.append(inspector,viewport);
 const heading=node('h2','Scene objects'),tree=node('div'),objectState=node('p'),reload=node('button','Refresh objects'),paging=node('div'),previous=node('button','Previous objects'),next=node('button','Next objects'),objectsBox=node('div'),navHint=node('p','Open a project to see its scene objects.');tree.className='scene-object-tree';reload.type=previous.type=next.type='button';reload.className=previous.className=next.className='scene-secondary';navHint.className='muted small';paging.append(previous,next);objectsBox.append(heading,reload,objectState,tree,paging);navigation.append(navHint,objectsBox);
 const views=buildViews($,viewport),{projectMenu,history}=buildHeader($,adapter),{frameTools,frameInput,channel,addKey}=buildFrameTools();
 inspector.append(frameTools);
 let foundation,objects=[],selectedId=null,selected=null,scenes=[],loadedIdentity=null,requestedIdentity=null,requestId=0,loading=false,writing=false,offset=0,frame=null,total=0,projectSeen=null;
 const identity=()=>JSON.stringify([adapter.state.project?.projectId,adapter.state.project?.revision]);
 const selection=()=>({kind:adapter.state.project?.kind==='godot'?'godot-node':'blender-object',ids:selectedId?[(adapter.state.project?.kind==='godot'?String(objects.findIndex(o=>o.id===selectedId)):selectedId)+':'+String(frame??0)]:[]});
 const properties=()=>!selected?[]:adapter.state.project?.kind==='blender'?blenderProperties(selected):godotNodeProperties(selected);
 const current=(id,origin)=>id===requestId&&origin===identity();
 function draw(){tree.replaceChildren();for(const object of objects){const b=node('button'),icon=node('span'),name=node('span',object.name),type=node('span',' · '+object.type);icon.className='scene-node-icon';icon.append(sceneIcon(nodeIcon(object.type)));name.className='scene-node-name';type.className='scene-sr';b.append(icon,name,type);b.title=object.type;b.type='button';b.dataset.sceneObject=object.id;b.setAttribute('aria-pressed',String(object.id===selectedId));b.disabled=loading||writing;b.onclick=()=>choose(object.id);tree.append(b);}objectState.textContent=loading?'Reading native scene objects…':objects.length?`${total} native objects`:'No native objects loaded.';previous.disabled=loading||writing||offset===0;next.disabled=loading||writing||offset+objects.length>=total;paging.hidden=adapter.state.project?.kind!=='blender'||total<=24;frameTools.hidden=adapter.state.project?.kind!=='blender';const more=inspector.closest('.ef-more-tools');if(more)more.hidden=frameTools.hidden;frameInput.disabled=!adapter.state.project||loading||writing;channel.disabled=addKey.disabled=!adapter.state.project||!selected?.editable||loading||writing;foundation?.refresh();assistant.refresh();}
 async function inspectBlender(name=null,requestedFrame=frame){const p=adapter.state.project,out=await adapter.api('POST','/projects/'+p.projectId+'/objects/inspect',{expectedRevision:p.revision,...(name===null?{}:{objectName:name}),offset,...(requestedFrame===null?{}:{frame:requestedFrame})});if(out.result?.isError)throw new Error(out.result.text||'Native Blender inspection failed');if(out.project.revision!==p.revision)throw new Error('The native scene changed during inspection. Refresh its objects.');return parseBlenderInspection(JSON.stringify(out.inspection));}
 async function readObjects({force=false}={}){
  const p=adapter.state.project;if(!p||writing)return;const origin=identity();if(!force&&requestedIdentity===origin)return;requestedIdentity=origin;const id=++requestId;loading=true;draw();
  try{
   if(p.kind==='blender'){const reply=await inspectBlender();if(!current(id,origin))return;objects=reply.objects;total=reply.total;frame=frame??reply.frame;frameInput.value=String(frame);if(!objects.some(o=>o.id===selectedId))selectedId=objects.find(o=>o.type==='MESH')?.id||objects[0]?.id||null;if(selectedId){const details=await inspectBlender(selectedId);if(!current(id,origin))return;selected=details.selected||null;}else selected=null;}
   else{const files=(adapter.state.detail?.files||[]).filter(f=>f.path.endsWith('.tscn'));scenes=[];for(const file of files){const reply=await adapter.api('POST','/projects/'+p.projectId+'/files/read',{path:file.path});if(!current(id,origin))return;if(reply.binary||reply.truncated)continue;scenes.push(parseGodotScene(reply.text,file.path));}objects=scenes.flatMap(s=>s.nodes);total=objects.length;if(!objects.some(o=>o.id===selectedId))selectedId=objects[0]?.id||null;selected=objects.find(o=>o.id===selectedId)||null;frame=null;}
   if(current(id,origin))loadedIdentity=origin;
  }catch(error){if(current(id,origin)){selected=null;loadedIdentity=null;adapter.problem(error);objectState.textContent='Native objects could not be read. '+error.message;}}
  finally{if(id===requestId){loading=false;draw();}}
 }
 async function choose(id){if(loading||writing)return;selectedId=id;selected=null;if(adapter.state.project.kind==='blender'){const origin=identity(),request=++requestId;loading=true;draw();try{const reply=await inspectBlender(id);if(!current(request,origin))return;selected=reply.selected||null;}catch(error){adapter.problem(error);}finally{if(request===requestId){loading=false;draw();foundation.showPanel('properties');}}}else{selected=objects.find(o=>o.id===id)||null;draw();foundation.showPanel('properties');}}
 async function edit(key,value,{keyframe=false}={}){
  if(!selected||writing||loading||adapter.state.busy||loadedIdentity!==identity())throw new Error('Read the current native object before editing.');if(adapter.fileDraft())throw new Error('Save or discard the source-file edit before changing object properties.');const origin=identity(),id=selectedId,p=adapter.state.project,object=selected;writing=true;draw();try{
   let out;if(p.kind==='blender')out=await adapter.api('POST','/projects/'+p.projectId+'/objects/edit',{expectedRevision:p.revision,objectName:object.id,frame:frame??1,operationJson:JSON.stringify(keyframe?{kind:'keyframe',channel:key}:{kind:'set-property',property:key,value})});
   else{const scene=scenes.find(s=>s.nodes.some(n=>n.id===id));if(!scene)throw new Error('The source scene changed. Refresh its objects.');out=await adapter.api('PUT','/projects/'+p.projectId+'/files',{path:scene.path,text:patchGodotNode(scene,id,key,value),expectedRevision:p.revision});}
   if(out.result?.isError)throw new Error(out.result.text||'The native engine refused the edit.');if(origin!==identity())throw new Error('The open scene changed. Its new selection was kept.');if(!out.changed&&p.kind==='blender')throw new Error('The native engine did not save an object change.');await adapter.refresh(true);loadedIdentity=null;requestedIdentity=null;adapter.notice('Saved native object as revision '+out.project.revision+'.');
  }finally{writing=false;draw();}await readObjects({force:true});
 }
 const getState=()=>({documentId:adapter.state.project?.projectId??null,revision:adapter.state.project?.revision??null,title:adapter.state.project?.title||'Scene Studio',dirty:adapter.fileDraft(),busy:adapter.state.busy||loading||writing,readOnly:!adapter.state.project||loadedIdentity!==identity()||adapter.fileDraft(),canUndo:adapter.state.project?.revision>1,status:loading?'Reading native scene':writing?'Saving native object':adapter.fileDraft()?'Source edits pending':'Saved native revision'});
 const {createRegisteredEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const assistant=await createRegisteredEditorAssistant({app:'scene-studio',bot:'scene-studio-director',title:'Scene Studio AI partner',root,getState:()=>{const value=getState();return{...value,dirty:value.dirty||foundation?.hasPending()};},getSelection:selection});
 foundation=createEditorFoundation({root,ai:assistant.element,header:document.querySelector('header'),navigation,viewport,inspector,navigationLabel:'Objects',status:$('status'),getState,getSelection:selection,getProperties:properties,applyProperty:async(key,value,context)=>{if(context.documentId!==adapter.state.project?.projectId||context.revision!==adapter.state.project?.revision||JSON.stringify(context.selection)!==JSON.stringify(selection()))throw new Error('The selected native scene object or frame changed.');await edit(key,value);},actions:{save:()=>adapter.prepare(),undo:()=>adapter.undo(),export:()=>{$('view-build').click();$('export-format').focus();}}});
 reload.onclick=()=>readObjects({force:true});previous.onclick=()=>{offset=Math.max(0,offset-24);readObjects({force:true});};next.onclick=()=>{offset+=24;readObjects({force:true});};frameInput.onchange=async()=>{const n=Number(frameInput.value);if(!Number.isInteger(n)||n<1||n>1000000){adapter.problem(new Error('Choose a whole scene frame from 1 to 1000000.'));return;}frame=n;await choose(selectedId);};addKey.onclick=async()=>{try{await foundation.flushPending();await edit(channel.value,null,{keyframe:true});}catch(error){adapter.problem(error);}};
 root.classList.add('scene-foundation');document.querySelector('.layout').style.display='none';main.hidden=true;
 const refresh=()=>{const p=adapter.state.project,view=views.current();
  projectMenu.hidden=history.hidden=$('scene-views').hidden=objectsBox.hidden=views.row.hidden=!p;navHint.hidden=!!p;
  views.scenePanel.hidden=!p||view!=='scene';views.buildPanel.hidden=!p||view!=='build';if(p&&view==='scene')adapter.state.viewer?.resize?.();
  $('scene-undo').disabled=!p||p.revision<2||adapter.state.busy||loading||writing;$('scene-save').disabled=!p||adapter.state.busy||loading||writing;
  if(projectSeen!==p?.projectId){projectSeen=p?.projectId;requestId++;objects=[];selectedId=null;selected=null;frame=null;offset=0;total=0;loadedIdentity=requestedIdentity=null;loading=false;}draw();if(p&&!writing&&!adapter.state.busy&&requestedIdentity!==identity())queueMicrotask(()=>readObjects());};
 for(const key of['scene','build'])$('view-'+key).addEventListener('click',refresh);
 refresh();
 return{...foundation,destroy:()=>{assistant.destroy();foundation.destroy();},refresh,selection:()=>selected?{kind:adapter.state.project.kind,node:selected.path||selected.id,frame}:null};
}
