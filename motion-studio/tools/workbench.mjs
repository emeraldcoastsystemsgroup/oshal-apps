/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive real saved native compositions with manual layer/property/keyframe/mask controls and fence late responses to the current workspace.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Show the native upload refusal and its actual normalized-byte capacity in the manual workbench.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Import native files and duplicate saved editable revisions; pin manual exports to the displayed revision.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Expose saved native layer organization, timing and nested composition controls with explicit ids and read-only guards.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Edit actual native effect instances with typed schema controls and unchanged-value preservation.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Edit exact keys and native curve/path geometry with original grants and stale gesture fencing.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Preview saved native work areas at exact rational frame ticks with cancellation and original read checks.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Edit saved native static masks and Bezier geometry while preserving animated values and exact references.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Save all retained inspector drafts automatically through native commands before concierge reads; refresh the same editable composition while preserving selection, historical views and concurrent fields.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Requests refused only because the project storage lock was busy are retried (busy-retry.mjs) instead of losing the edit: a manual edit right after a concierge change failed with "Your project storage is busy. Retry shortly." (installed handoff run, 2026-10-29).
 */
import {createInspectorDrafts} from './editor-handoff.mjs';
import {valueChange} from './value-patch.mjs';
import {RenderClient} from './render-client.mjs';
import {fetchRetryingBusy} from './busy-retry.mjs';
import {BundleClient} from './bundle-client.mjs';
import {parseNative,stringifyNative,readProject} from './native-json.mjs';
const $=id=>document.getElementById(id),base='/api/motion-studio';
const state={project:null,historical:false,comp:null,layer:null,time:0,epoch:0,previewEpoch:0,busy:false,busyLease:0,ticks:0,ready:false,permissions:{},catalog:[],checked:new Set(),timingFields:{},effects:[],effect:null,effectInputs:[],fullEffectIntent:null,effectInfo:null,effectStamp:null,effectRenderedStamp:null,effectPending:null,effectEpoch:0,effectAbort:null,keyInfo:null,keyRef:null,keyEpoch:0,keyInitial:{},previewTick:null,workFields:{},playing:false,playEpoch:0,playAbort:null,playTask:Promise.resolve(),fonts:[],textInfo:null,textStamp:null,textEpoch:0,textAbort:null,textInitial:{},textColors:{},mask:null,maskVertex:0,maskInitial:{},maskVertexInitial:{},maskInfo:null,maskStamp:null,maskEpoch:0,maskAbort:null,featherIndex:0,featherInitial:{},propertiesInfo:null,propertiesStamp:null,propertiesEpoch:0,propertiesAbort:null,propertiesPending:null,propertiesInitial:{},sceneInputs:[]};
let handoffBusy=false, collectedEdits=null;
function inspectorContext(){return {projectId:state.project?.id??null,comp:state.comp==null?null:String(state.comp),layer:state.layer==null?null:String(state.layer),time:state.time,tick:state.previewTick,mask:state.mask==null?null:String(state.mask),effect:state.effect==null?null:String(state.effect),vertex:state.maskVertex,feather:state.featherIndex,key:state.keyRef?{...state.keyRef}:null};}
const inspectorDrafts=createInspectorDrafts({context:inspectorContext,revision:()=>state.project?.revision,
 captureExtra:form=>form==='effectParams'?state.effectInputs.filter(field=>field.capture&&field.changed()).map(field=>({prop:String(field.prop),...field.capture()})):[],
 restoreExtra:(form,values)=>{if(form==='effectParams')for(const value of values)state.effectInputs.find(field=>String(field.prop)===value.prop)?.restore?.(value);}
});
async function api(path,options={}){const {response,text}=await fetchRetryingBusy(()=>fetch(base+path,{credentials:'same-origin',redirect:'error',...options}));let body;try{body=parseNative(text);if(body.project)body.project=readProject(body.project);}catch{throw new Error('The studio did not return a usable response.');}if(!response.ok&&body.error==='motion_effect_needs_owned_text_asset')throw new Error('This effect needs an owned source import. Paste inline data where supported.');if(!response.ok)throw new Error(typeof body.detail==='string'&&body.detail.length<=512?body.detail:body.error||'The request was refused.');return body;}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:stringifyNative(body)});
function problem(error){$('error').hidden=false;$('error').textContent=error.message;}
function guard(work){const run=async event=>{event?.preventDefault();$('error').hidden=true;try{await inspectorDrafts.action(work,event);}catch(error){problem(error);}finally{controls();$('status').textContent=state.busy?'Applying…':state.ready?(state.project?'Saved':'Ready'):'Engine unavailable';}};run.handoffWork=work;return run;}
function busy(){stopPlayback();const lease=++state.busyLease;state.busy=true;$('status').textContent='Applying…';controls();return()=>{if(lease===state.busyLease){state.busy=false;controls();}};}
function comp(){return state.project?.document.items[state.comp]?.kind;}
function layer(){return comp()?.layers.find(value=>value.id===state.layer);}
function property(value,path){let node=value?.props;for(const part of path.split('/'))node=node?.children?.find(child=>child.match===part);return node;}
function value(path,fallback){return property(layer(),path)?.value?.v??fallback;}
function controls(){const edit=Boolean(state.project&&state.permissions.change&&!state.historical&&!state.busy&&!handoffBusy),create=Boolean(state.permissions.create&&state.ready&&!state.busy&&!handoffBusy);
  for(const field of $('new').elements)field.disabled=!create;
  for(const field of $('importDocument').elements)field.disabled=!create||!state.permissions.read;
  $('duplicate').disabled=!create||!state.permissions.read||!state.project;
  for(const form of ['add','transform','key','mask','advanced','nest','layerSettings','layerTiming'])for(const field of $(form).elements)field.disabled=!edit||(form!=='add'&&form!=='advanced'&&!layer())||!!state.keyInfo&&['transform','key'].includes(form);
  const keyEdit=edit&&state.keyInfo&&!state.keyInfo.locked;for(const field of $('editKey').elements)field.disabled=!keyEdit;
  $('deleteKey').disabled=!keyEdit;$('editKey').elements.ease.disabled=!keyEdit||state.keyInfo?.holdOnly;$('editKey').elements.value.disabled=!keyEdit||!state.keyInfo?.valueComplete||!['scalar','enum','vec2','vec3','color','bool','layer','string'].includes(state.keyInfo?.valueType);
  for(const id of ['layerUp','layerDown','duplicateLayer','deleteLayer'])$(id).disabled=!edit||!layer();
  $('nest').querySelector('button').disabled=!edit||!state.checked.size;
  for(const input of $('layers').querySelectorAll('input'))input.disabled=!edit;
  for(const field of $('addEffect').elements)field.disabled=!edit||!layer();
  effectControls(edit);
  for(const id of ['effectEnabled','effectUp','effectDown','removeEffect'])$(id).disabled=!edit||!effectGroup();
  $('layerEffects').disabled=!effectGroups().length;
  bundleControls();renderControls();
  $('image').disabled=!edit;$('reuse').disabled=!edit||!$('assets').value;$('dropAsset').disabled=!state.permissions.delete||state.busy||!$('assets').value;$('undo').disabled=!edit||state.project?.revision<=1;$('delete').disabled=!state.project||!state.permissions.delete||state.busy;$('export').disabled=!state.project||!state.permissions.export||state.busy;$('time').disabled=!state.project||!state.permissions.read;
  for(const field of $('workArea').elements)field.disabled=!edit;
  for(const id of ['play','previousFrame','nextFrame','loop'])$(id).disabled=!state.project||!state.permissions.read||state.busy;
  $('play').textContent=state.playing?'Pause':'Play work area';$('play').setAttribute('aria-pressed',String(state.playing));
  propertyControls(edit);
  maskControls(edit);
  const textEdit=edit&&!state.playing&&state.textInfo&&!state.textInfo.locked&&state.textStamp===textStamp();for(const field of $('textEdit').elements)field.disabled=!textEdit;
  $('refreshText').disabled=!state.permissions.read||state.busy||state.playing;
  if(state.textInfo&&!state.playing&&!state.busy&&state.permissions.read){$('textEdit').elements.content.disabled=false;$('textEdit').elements.content.readOnly=!textEdit;}
  $('comps').disabled=handoffBusy;for(const button of document.querySelectorAll('#layers button,#timeline .keyButton'))button.disabled=handoffBusy;
  if(handoffBusy)for(const id of ['time','play','previousFrame','nextFrame','loop','savedMasks','maskVertices','featherPoints','layerEffects'])$(id).disabled=true;
}
function show(){return inspectorDrafts.paint(['layerSettings', 'layerTiming', 'workArea'],()=>showNow());}
function showNow(){const items=state.project?.document.items??{},comps=Object.values(items).filter(item=>item.kind.type==='Comp');if(!comps.some(item=>item.id===state.comp))state.comp=comps[0]?.id;
  $('comps').replaceChildren(...comps.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;return option;}));$('comps').value=state.comp??'';
  const layers=comp()?.layers??[];if(!layers.some(item=>item.id===state.layer))state.layer=layers[0]?.id;
  state.checked=new Set([...state.checked].filter(id=>layers.some(item=>item.id===id)));
  $('layers').replaceChildren(...layers.map(item=>{
    const li=document.createElement('li'),button=document.createElement('button'),check=document.createElement('input');
    check.type='checkbox';check.checked=state.checked.has(item.id);check.setAttribute('aria-label','Select '+item.name+' for precompose');
    check.onchange=()=>{if(check.checked)state.checked.add(item.id);else state.checked.delete(item.id);controls();};
    button.textContent=item.name;button.setAttribute('aria-selected',String(item.id===state.layer));button.onclick=()=>{state.layer=item.id;show();};li.append(check,button);return li;
  }));
  const selected=layer(),settings=$('layerSettings').elements;
  settings.name.value=selected?.name??'';settings.visible.checked=selected?.switches.video??false;
  settings.parent.replaceChildren(new Option('None',''),...layers.filter(item=>item.id!==state.layer).map(item=>new Option(item.name,String(item.id))));settings.parent.value=selected?.parent===null||selected?.parent===undefined?'':String(selected.parent);
  state.timingFields={};for(const[name,field]of[['start','start_time'],['in','in_point'],['out','out_point']]){const text=selected?String(Number(selected[field])/state.ticks):'';$('layerTiming').elements[name].value=text;state.timingFields[name]=text;}

  $('selected').textContent=layer()?.name??'No layer selected';
  refreshProperties().catch(problem);
  const current=comp();$('time').max=current?Number(current.duration)/state.ticks:5;$('time').step=current?current.frame_rate.den/current.frame_rate.num:1/30;$('time').value=state.time;$('timeLabel').textContent=state.time.toFixed(2)+' s';
  state.workFields={};for(const [index,name]of ['start','end'].entries()){const text=current?String(Number(current.work_area[index])/state.ticks):'';$('workArea').elements[name].value=text;state.workFields[name]=text;}
  $('revision').textContent=state.project?state.project.title+' · revision '+state.project.revision:'';$('status').textContent=state.busy?'Applying…':state.project?'Saved':'Ready';
  $('timeline').replaceChildren(...layers.map(item=>{const row=document.createElement('div');row.className='track';const title=document.createElement('strong');title.textContent=item.name;row.append(title);const keys=document.createElement('div');keys.className='keys';const found=[];function walk(node){for(const child of node.children??[]){if(child.keys?.length){const group=document.createElement('div'),name=document.createElement('span');name.textContent=child.name+': ';group.append(name);for(const key of child.keys){const button=document.createElement('button');button.type='button';button.className='keyButton';button.textContent=(Number(key.time)/state.ticks).toFixed(2)+'s ('+key.out_interp+')';button.dataset.layer=String(item.id);button.dataset.prop=String(child.uid);button.dataset.tick=String(key.time);button.setAttribute('aria-label',item.name+' '+child.name+' key '+String(key.time));button.onclick=guard(()=>chooseKey({layer:String(item.id),prop:String(child.uid),timeTicks:String(key.time)}));group.append(button);}keys.append(group);found.push(child.name);}walk(child);}}walk(item.props);if(!found.length)keys.textContent='No keyframes yet';row.append(keys);return row;}));showEffects();showMasks();controls();void refreshText();
}
async function refresh(){if(!state.permissions.read)return;const {projects}=await api('/projects');$('projects').replaceChildren(new Option('Open a composition',''),...projects.map(project=>new Option(project.title,project.id)));if(state.project)$('projects').value=state.project.id;const {assets}=await api('/assets');$('assets').replaceChildren(new Option('Choose a saved photo',''),...assets.map(asset=>new Option(asset.width+' × '+asset.height+' · '+asset.id.slice(0,8),asset.id)));controls();}
async function open(id,revision){const epoch=++state.epoch;const done=busy();try{const {project}=await api('/projects/'+encodeURIComponent(id)+(revision?'/revisions/'+encodeURIComponent(revision):''));if(epoch!==state.epoch)return;const head=revision?await api('/projects/'+encodeURIComponent(id)):null;if(epoch!==state.epoch)return;state.project=project;state.historical=Boolean(head&&head.project.revision!==project.revision);clearKey();$('projects').value=project.id;state.comp=null;state.layer=null;state.checked.clear();state.time=0;show();await preview();}finally{done();}}
async function preview(signal){if(!state.project||!state.permissions.read)return;const epoch=state.epoch,turn=++state.previewEpoch,document=state.project.document,selected=state.comp,current=()=>epoch===state.epoch&&turn===state.previewEpoch&&document===state.project?.document&&selected===state.comp;try{const result=await api('/projects/'+state.project.id+'/revisions/'+state.project.revision+(state.previewTick===null?'/preview/'+state.time:'/preview-ticks/'+state.previewTick)+'/'+(selected===undefined?'auto':String(selected))+'/1280/1',{signal});if(!current())return;$('preview').src='data:image/png;base64,'+result.png;$('preview').hidden=false;$('empty').hidden=true;if(!state.playing)refreshProperties().catch(problem);}catch(error){if(!current()||signal?.aborted)return;$('preview').hidden=true;$('empty').textContent='Preview unavailable for this revision.';$('empty').hidden=false;throw error;}}
async function apply(commands,{previewTick}={}){if(collectedEdits){if(commands.length)collectedEdits.push({commands,previewTick});return;}if(!state.project||state.busy)return;const epoch=state.epoch,id=state.project.id,previousRevision=state.project.revision,oldComps=new Set(Object.values(state.project.document.items).filter(item=>item.kind.type==='Comp').map(item=>item.id)),oldLayers=new Set(comp()?.layers.map(item=>item.id));const done=busy();try{const result=await post('/projects/'+id+'/operations',{baseRevision:state.project.revision,requestKey:crypto.randomUUID(),commandsJson:stringifyNative(commands),compId:String(state.comp)});if(epoch!==state.epoch||state.project?.id!==id)return;inspectorDrafts.advance(id,previousRevision,result.project.revision);state.project=result.project;state.historical=false;clearKey();if(previewTick!==undefined)state.previewTick=previewTick;const addedComp=Object.values(state.project.document.items).find(item=>item.kind.type==='Comp'&&!oldComps.has(item.id));if(addedComp)state.comp=addedComp.id;state.layer=comp()?.layers.find(item=>!oldLayers.has(item.id))?.id??state.layer;show();await refresh();await preview();return result;}finally{done();}}
$('new').onsubmit=guard(async()=>{const form=$('new').elements,epoch=++state.epoch;const done=busy();try{const {project}=await post('/projects',{title:form.title.value,width:Number(form.width.value),height:Number(form.height.value),frameRate:Number(form.frameRate.value),duration:Number(form.duration.value),requestKey:crypto.randomUUID()});if(epoch!==state.epoch)return;state.project=project;state.historical=false;clearKey();state.comp=null;state.layer=null;state.checked.clear();state.time=0;show();await refresh();await preview();}finally{done();}});
$('importDocument').onsubmit=guard(async()=>{
  const form=$('importDocument').elements,file=form.document.files[0];if(!file)throw new Error('Choose an editable native document.');
  if(file.size>4194304)throw new Error('Native document files may be up to 4 MiB.');
  const epoch=++state.epoch,done=busy();try{
    const body=new FormData();body.append('document',file);body.append('title',form.title.value);body.append('requestKey',crypto.randomUUID());
    const result=await api('/projects/import',{method:'POST',body});if(epoch!==state.epoch)return;
    state.project=result.project;state.historical=false;clearKey();state.comp=null;state.layer=null;state.checked.clear();state.time=0;form.document.value='';show();await refresh();await preview();
  }finally{done();}
});
$('duplicate').onclick=guard(async()=>{
  const source=state.project,epoch=++state.epoch,done=busy();try{
    const result=await post('/projects/'+source.id+'/fork',{revision:source.revision,requestKey:crypto.randomUUID()});if(epoch!==state.epoch)return;
    state.project=result.project;state.historical=false;clearKey();state.comp=null;state.layer=null;state.checked.clear();state.time=0;show();await refresh();await preview();
  }finally{done();}
});
$('projects').onchange=guard(async()=>{if($('projects').value)await open($('projects').value);});$('refresh').onclick=guard(refresh);
$('comps').onchange=guard(async()=>{stopPlayback();state.comp=parseNative($('comps').value);clearKey();state.layer=null;state.checked.clear();state.previewEpoch++;show();await preview();});
$('add').onsubmit=guard(async()=>{const form=$('add').elements,kind=form.kind.value,text=form.text.value,color=form.color.value;await apply([{command:kind==='text'?'layer.newText':kind==='solid'||kind==='background'?'layer.newSolid':'layer.newShape',params:kind==='text'?{text,name:[...text.split('\n')[0]].slice(0,40).join(''),size:36,fill:color,position:[comp().width/2,comp().height/2]}:kind==='solid'||kind==='background'?{name:text,color,width:kind==='background'?comp().width:100,height:kind==='background'?comp().height:60}:{name:text,kind:'rect',size:[100,60],fill:color}}]);});
// Every layer operation selects explicit ids within this edit batch; no previous session selection is assumed.
async function layerAction(command,params={}){if(!layer())return;const ids=[state.layer];await apply([{command:'layer.select',params:{layers:ids}},{command,params:{layers:ids,...params}}]);}
$('layerSettings').onsubmit=guard(async()=>{
  if(!layer())return;const selected=layer(),form=$('layerSettings').elements,commands=[{command:'layer.select',params:{layers:[selected.id]}}];
  if(form.name.value!==selected.name)commands.push({command:'layer.rename',params:{layer:selected.id,name:form.name.value}});
  if(form.visible.checked!==selected.switches.video)commands.push({command:'layer.setSwitch',params:{layers:[selected.id],switch:'video',value:form.visible.checked}});
  const parent=form.parent.value===''?null:parseNative(form.parent.value);
  if(parent!==(selected.parent??null)){
    const seen=new Set();for(let cursor=parent;cursor!==null&&cursor!==undefined;){if(cursor===selected.id||seen.has(cursor))throw new Error('Choose a parent that does not depend on this layer.');seen.add(cursor);cursor=comp().layers.find(item=>item.id===cursor)?.parent;}
    commands.push({command:'layer.setParent',params:{layers:[selected.id],parent,compensate:true}});
  }
  if(commands.length>1)await apply(commands);
});
$('layerTiming').onsubmit=guard(async()=>{
  const params={};for(const name of ['start','in','out']){const text=$('layerTiming').elements[name].value;if(text!==state.timingFields[name]){const number=Number(text);if(!text||!Number.isFinite(number))throw new Error('Enter finite timing values in seconds.');params[name]=number;}}
  if(Object.keys(params).length)await layerAction('layer.timing',params);
});
$('layerUp').onclick=guard(()=>layerAction('layer.arrange',{to:'forward'}));$('layerDown').onclick=guard(()=>layerAction('layer.arrange',{to:'backward'}));
$('duplicateLayer').onclick=guard(()=>layerAction('edit.duplicate'));$('deleteLayer').onclick=guard(async()=>{if(confirm('Delete this layer? Composition history keeps the previous version.'))await layerAction('edit.clear');});
$('nest').onsubmit=guard(async()=>{
  const layers=[...state.checked],form=$('nest').elements;if(!layers.length)return;
  await apply([{command:'layer.select',params:{layers}},{command:'layer.precompose',params:{layers,name:form.name.value,mode:'move',adjustDuration:form.trim.checked,open:true}}]);
  state.checked.clear();show();
});
function clearKey(){state.keyInfo=null;state.keyRef=null;state.keyEpoch++;state.previewTick=null;$('keyEditor').hidden=true;}
function secondsTicks(text){if(!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text))throw new Error('Enter a decimal time in seconds.');const negative=text.startsWith('-'),parts=text.replace('-','').split('.'),fraction=parts[1]??'',scale=10n**BigInt(fraction.length),units=BigInt((parts[0]||'0')+fraction)*BigInt(state.ticks);const ticks=(units+scale/2n)/scale*(negative?-1n:1n);if(ticks<-9223372036854775808n||ticks>9223372036854775807n)throw new Error('Time is outside the native range.');return String(ticks);}
async function chooseKey(ref){
  stopPlayback();
  const epoch=state.epoch,turn=++state.keyEpoch,project=state.project,selected=state.comp;
  const result=await api('/projects/'+project.id+'/revisions/'+project.revision+'/keyframes/'+selected+'/'+ref.layer+'/'+ref.prop+'/'+ref.timeTicks);
  if(epoch!==state.epoch||turn!==state.keyEpoch||project.document!==state.project?.document||selected!==state.comp)return;
  state.keyInfo=result.keyframe;state.keyRef=ref;state.layer=parseNative(ref.layer);state.previewTick=BigInt(result.keyframe.compTimeTicks)<0n?'0':result.keyframe.compTimeTicks;state.time=Number(state.previewTick)/state.ticks;
  show();showKeyEditor();await preview();
}
function showKeyEditor(){return inspectorDrafts.paint(['editKey'],()=>showKeyEditorNow());}
function showKeyEditorNow(){
 const info=state.keyInfo;if(!info)return;const form=$('editKey').elements,key=info.key,raw=key.value?.v;
 $('keyEditor').hidden=false;$('keySummary').textContent=info.propertyName+' · '+info.layerTimeTicks+' layer ticks · '+info.compTimeTicks+' composition ticks';
 const fields={seconds:String(Number(info.layerTimeTicks)/state.ticks),ticks:info.layerTimeTicks,value:Array.isArray(raw)?raw.join(', '):raw===undefined?'Value needs full document inspection':String(raw),ease:'unchanged',inX:info.resolvedSpatialIn[0],inY:info.resolvedSpatialIn[1],outX:info.resolvedSpatialOut[0],outY:info.resolvedSpatialOut[1]};
 for(const[name,value]of Object.entries(fields))form[name].value=value;state.keyInitial=Object.fromEntries(Object.keys(fields).map(name=>[name,form[name].value]));$('spatialFields').hidden=!info.spatial;
 const svg=$('keyCurve'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();const samples=info.samples??[];svg.hidden=!samples.length;
 if(samples.length){const values=samples.map(row=>Array.isArray(row.value)?row.value[0]:row.value),min=Math.min(...values),max=Math.max(...values),start=BigInt(samples[0].timeTicks),span=BigInt(samples.at(-1).timeTicks)-start;const path=document.createElementNS(ns,'polyline');path.setAttribute('points',samples.map((row,index)=>(10+(span?Number(BigInt(row.timeTicks)-start)/Number(span)*300:0))+','+(140-(values[index]-min)/(max-min||1)*120)).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#91d2ff');path.setAttribute('stroke-width','2');svg.append(path);}
 $('curveCaption').textContent=info.sampleSpace+(info.hasExpression?' (this property also has an expression)':'');drawMotionPath();controls();
}
function drawMotionPath(){
 const svg=$('motionPath'),info=state.keyInfo,points=info.pathWindow?.points??[],ns='http://www.w3.org/2000/svg';svg.replaceChildren();svg.hidden=!info.spatial||!points.length;if(svg.hidden)return;svg.setAttribute('viewBox','0 0 '+comp().width+' '+comp().height);
 const path=document.createElementNS(ns,'path');let d='M '+points[0].value.slice(0,2).join(' ');
 for(let index=1;index<points.length;index++){const a=points[index-1],b=points[index];d+=(a.outInterp==='Hold'?' M ':' C ')+(a.outInterp==='Hold'?b.value.slice(0,2).join(' '):[a.value[0]+a.out[0],a.value[1]+a.out[1],b.value[0]+b.in[0],b.value[1]+b.in[1],b.value[0],b.value[1]].join(' '));}
 path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#91d2ff');path.setAttribute('stroke-width','1');svg.append(path);
 for(const point of points){const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',point.value[0]);circle.setAttribute('cy',point.value[1]);circle.setAttribute('r',Math.max(comp().width,comp().height)/80);circle.setAttribute('fill',point.timeTicks===info.layerTimeTicks?'#ffbc66':'#91d2ff');circle.dataset.tick=point.timeTicks;circle.setAttribute('aria-label','Move key '+point.timeTicks);circle.setAttribute('tabindex','0');circle.onkeydown=guard(async event=>{if(event.key==='Enter')await chooseKey({...state.keyRef,timeTicks:point.timeTicks});});
 circle.onpointerdown=event=>{if(!state.permissions.change||info.locked||state.busy)return;event.preventDefault();circle.setPointerCapture(event.pointerId);const ref={...state.keyRef,timeTicks:point.timeTicks},project=state.project.id,epoch=state.epoch,document=state.project.document;let changed=false,value=[...point.value];
 circle.onpointermove=move=>{if(epoch!==state.epoch||document!==state.project?.document)return;const matrix=svg.getScreenCTM();if(!matrix)return;const at=new DOMPoint(move.clientX,move.clientY).matrixTransform(matrix.inverse());value[0]=at.x;value[1]=at.y;circle.setAttribute('cx',value[0]);circle.setAttribute('cy',value[1]);changed=true;};
 const finish=guard(async()=>{circle.onpointermove=null;circle.onpointerup=null;circle.onpointercancel=null;if(!changed||epoch!==state.epoch||project!==state.project?.id||document!==state.project.document)return;await apply([{command:'keys.patchExact',params:{...ref,value}}]);if(epoch===state.epoch&&project===state.project?.id)await chooseKey(ref);});circle.onpointerup=finish;circle.onpointercancel=()=>{circle.onpointermove=null;drawMotionPath();};};svg.append(circle);}
}
$('closeKey').onclick=()=>{clearKey();controls();};
$('editKey').onsubmit=guard(async()=>{
 const info=state.keyInfo,ref=state.keyRef,form=$('editKey').elements,project=state.project.id,epoch=state.epoch;if(!info||info.locked)return;
 const params={...ref};let time=ref.timeTicks;
 if(form.ticks.value!==state.keyInitial.ticks){if(!/^-?(?:0|[1-9][0-9]*)$/.test(form.ticks.value))throw new Error('Enter exact integer ticks.');time=form.ticks.value;}
 else if(form.seconds.value!==state.keyInitial.seconds)time=secondsTicks(form.seconds.value);
 if(time!==ref.timeTicks)params.newTimeTicks=time;
 if(form.value.value!==state.keyInitial.value){const text=form.value.value;params.value=['vec2','vec3','color'].includes(info.valueType)?text.split(',').map(value=>{if(!value.trim())throw new Error('Enter every vector component.');return Number(value);}):info.valueType==='bool'?text==='true'?true:text==='false'?false:(()=>{throw new Error('Enter true or false.');})():info.valueType==='layer'?parseNative(text):info.valueType==='string'?text:Number(text);if(typeof params.value==='number'&&!Number.isFinite(params.value)||Array.isArray(params.value)&&params.value.some(v=>!Number.isFinite(v)))throw new Error('Enter finite values.');}
 for(const[name,side]of[['in','spatialIn'],['out','spatialOut']])if(['X','Y'].some(axis=>form[name+axis].value!==state.keyInitial[name+axis]))params[side]=[Number(form[name+'X'].value),Number(form[name+'Y'].value),info['resolvedSpatial'+(name==='in'?'In':'Out')][2]];
 const commands=[];if(Object.keys(params).length>3)commands.push({command:'keys.patchExact',params});
 if(form.ease.value!=='unchanged'){if(!commands.length)commands.push({command:'keys.selectExact',params:ref});commands.push(form.ease.value==='ease'?{command:'keys.easyEase',params:{}}:{command:'keys.interpolation',params:{interpolation:form.ease.value}});}
 if(!commands.length)return;const result=await apply(commands);if(epoch===state.epoch&&project===state.project?.id){const actual=result?.results?.find(value=>value?.changed)?.layerTimeTicks;await chooseKey({...ref,timeTicks:actual===undefined?time:String(actual)});}
});
$('deleteKey').onclick=guard(async()=>{if(!state.keyInfo||state.keyInfo.locked)return;await apply([{command:'keys.selectExact',params:state.keyRef},{command:'keys.delete',params:{}}]);clearKey();controls();});
function effectGroups(){return layer()?.props.children.find(node=>node.match==='effects')?.children??[];}
function effectGroup(){return effectGroups().find(group=>group.uid===state.effect);}
function effectChoices(){const search=$('effectSearch').value.toLowerCase(),selected=$('effectCatalog').value;const list=state.effects.filter(effect=>(effect.name+' '+effect.category).toLowerCase().includes(search));$('effectCatalog').replaceChildren(...list.map(effect=>new Option(effect.category+' · '+effect.name,effect.id)));if(list.some(effect=>effect.id===selected))$('effectCatalog').value=selected;}
function showEffects(){return inspectorDrafts.paint(['effectParams'],()=>showEffectsNow());}
function showEffectsNow(){
  const groups=effectGroups();if(!groups.some(group=>group.uid===state.effect))state.effect=groups[0]?.uid??null;
  $('layerEffects').replaceChildren(...groups.map(group=>new Option(group.name,String(group.uid))));$('layerEffects').value=state.effect===null?'':String(state.effect);
  const valid=state.effectStamp===effectStamp(),group=effectGroup(),schema=state.effects.find(effect=>effect.id===group?.match);$('effectEnabled').checked=group?.enabled??false;if(valid&&state.effectInfo&&state.effectRenderedStamp===state.effectStamp)return;state.effectInputs=[];
  const fields=[];for(const param of schema?.params??[]){
    const prop=valid?state.effectInfo?.properties.find(p=>p.path===param.id):null;if(!prop)continue;const actual=prop.value,box=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=param.name;box.append(title);box.dataset.param=param.id;
    let read,changed,capture,restore;const input=(type,name,value)=>{const field=document.createElement('input');field.type=type;field.name=name;field.value=value;field.setAttribute('aria-label',param.name+(name?' '+name:''));if(name&&name!=='color'){const label=document.createElement('label');label.textContent=name==='alpha'?'Alpha (0–1)':name;label.append(field);box.append(label);}else box.append(field);return field;};
    if(param.options){const select=document.createElement('select');select.setAttribute('aria-label',param.name);select.replaceChildren(...param.options.map(option=>new Option(option.label,String(option.value))));select.value=String(actual);box.append(select);const initial=select.value;read=()=>parseNative(select.value);changed=()=>select.value!==initial;}
    else if(param.type==='bool'){const field=input('checkbox','',actual);field.checked=Boolean(actual);read=()=>field.checked;changed=()=>field.checked!==Boolean(actual);}
    else if(param.type==='scalar'||param.type==='enum'||param.type==='layer'){const field=input('number','',String(actual));field.step=param.type==='scalar'?'any':'1';if(param.min!==undefined)field.min=String(param.min);if(param.max!==undefined)field.max=String(param.max);const initial=field.value;read=()=>parseNative(field.value);changed=()=>field.value!==initial;}
    else if(param.type==='color'){
      const hex='#'+actual.slice(0,3).map(value=>Math.round(Math.max(0,Math.min(1,value))*255).toString(16).padStart(2,'0')).join(''),color=input('color','color',hex),alpha=input('number','alpha',String(actual[3]??1));alpha.min='0';alpha.max='1';alpha.step='any';
      const initialAlpha=alpha.value;read=()=>[...(color.value===hex?actual.slice(0,3):color.value.slice(1).match(/../g).map(v=>parseInt(v,16)/255)),Number(alpha.value)];changed=()=>color.value!==hex||alpha.value!==initialAlpha;
    }else if(param.type==='vec2'||param.type==='vec3'){
      const parts=actual.map((value,index)=>input('number',['X','Y','Z'][index],String(value)));for(const field of parts)field.step='any';const initial=parts.map(field=>field.value);read=()=>parts.map(field=>Number(field.value));changed=()=>parts.some((field,index)=>field.value!==initial[index]);
    }else if(param.type==='string'){const text=effectTextEditor(box,param.name,actual);read=()=>{const value=text.read(),source=value.trim();if(['lut','file','shapeData','configFile'].includes(param.id)&&source){const inline=param.id==='lut'?value.includes('\n')||value.includes('LUT_'):param.id==='file'?value.includes('\n'):param.id==='shapeData'?source.startsWith('{')||source.startsWith('['):false;if(!inline)throw new Error('This effect needs an owned source import. Paste inline data where supported.');}return value;};changed=text.changed;capture=text.capture;restore=text.restore;
      if(['lut','file','shapeData','configFile'].includes(param.id)){const note=document.createElement('small');note.textContent=param.id==='configFile'?'Custom configuration import is not available yet.':'Paste inline data. Files need an owned source import.';box.append(note);}
    }
    else{const note=document.createElement('small');note.textContent='Use the advanced editing command for this parameter.';box.append(note);}
    if(read)state.effectInputs.push({prop:prop.prop,value:actual,read,changed,capture,restore});
    if(prop.keyCount){const note=document.createElement('small');note.textContent='Native current-time value · '+prop.keyCount+' keys'+(prop.hasExpression?' · before expression':'');box.append(note);}
    fields.push(box);
  }
  $('effectFields').replaceChildren(...fields);state.effectRenderedStamp=valid?state.effectStamp:null;
  if(!group)$('effectStatus').textContent='Select an effect.';else if(valid)$('effectStatus').textContent='Native effect values at tick '+state.effectInfo.compTimeTicks+' · before expressions';
}
function effectTextEditor(box,name,initial){
 const field=document.createElement('textarea'),status=document.createElement('small'),controls=document.createElement('div'),previous=document.createElement('input'),next=document.createElement('input'),search=document.createElement('input'),find=document.createElement('input'),file=document.createElement('input'),label=document.createElement('label');
 field.setAttribute('aria-label',name);field.dataset.readText='1';field.maxLength=8192;previous.type=next.type=find.type='button';previous.value='Previous section';next.value='Next section';find.value='Find';search.type='search';search.placeholder='Find text';search.maxLength=512;search.setAttribute('aria-label',name+' find text');for(const control of [previous,next,search,find])control.dataset.inspection='1';file.type='file';file.accept='.txt,.cube,.json,.csv';file.setAttribute('aria-label',name+' replace from text file');label.textContent='Replace from text file';label.append(file);controls.className='pair';controls.append(previous,next,search,find);box.append(field,status,controls,label);
 let value=initial,start=0,end=0,shown='';const pair=n=>n>0&&n<value.length&&/[\uD800-\uDBFF]/.test(value[n-1])&&/[\uDC00-\uDFFF]/.test(value[n]);
 function current(){return field.value===shown?value:value.slice(0,start)+field.value+value.slice(end);}
 function commit(){value=current();}
 function show(){start=Math.min(start,value.length);if(pair(start))start--;end=Math.min(value.length,start+4096);if(pair(end))end--;shown=value.slice(start,end);field.value=shown;status.textContent=value.length>4096?'Text section '+start+'–'+end+' of '+value.length:'Complete text · '+value.length+' units';controls.hidden=value.length<=4096;}
 previous.onclick=()=>{commit();start=Math.max(0,start-4096);show();};next.onclick=()=>{const target=start+field.value.length;commit();start=Math.min(value.length,target);show();};find.onclick=()=>{commit();const at=value.indexOf(search.value);if(at<0){status.textContent='Text not found.';return;}start=at;show();};
 file.onchange=guard(async()=>{const selected=file.files?.[0];if(!selected)return;if(selected.size>2097152)throw new Error('Text exceeds the native document capacity.');const loaded=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());if(!box.isConnected)return;value=loaded;start=0;show();status.textContent+=' · file loaded; save to commit';});
 show();return {read:current,changed:()=>current()!==initial,capture:()=>({value:current(),start}),restore:stored=>{value=stored.value;start=stored.start;show();}};
}
$('effectSearch').oninput=effectChoices;
$('addEffect').onsubmit=guard(async()=>{const before=new Set(effectGroups().map(group=>group.uid));if(!$('effectCatalog').value)return;await layerAction('effect.apply',{effect:$('effectCatalog').value});state.effect=effectGroups().find(group=>!before.has(group.uid))?.uid??state.effect;showEffects();controls();});
$('layerEffects').onchange=()=>{state.effect=parseNative($('layerEffects').value);showEffects();controls();};
async function effectAction(command,params={}){if(!effectGroup())return;await layerAction(command,{layer:state.layer,effect:state.effect,...params});}
$('effectEnabled').onchange=guard(()=>effectAction('effect.toggle',{value:$('effectEnabled').checked}));
$('effectUp').onclick=guard(()=>effectAction('effect.reorder',{index:Math.max(1,effectGroups().findIndex(group=>group.uid===state.effect))}));
$('effectDown').onclick=guard(()=>effectAction('effect.reorder',{index:effectGroups().findIndex(group=>group.uid===state.effect)+2}));
$('removeEffect').onclick=guard(()=>effectAction('effect.remove'));
function effectStamp(){return effectGroup()&&propertiesStamp()?propertiesStamp()+'@'+String(state.effect):null;}
function effectControls(edit){
 const stamp=effectStamp(),valid=stamp&&state.effectStamp===stamp&&state.effectInfo,can=edit&&valid&&!state.effectInfo.locked&&!state.playing;
 const inspect=valid&&!state.busy&&!state.playing&&state.permissions.read;for(const field of $('effectParams').elements){if(field.tagName==='FIELDSET'||field.dataset.inspection)field.disabled=!inspect;else if(field.dataset.readText){field.disabled=!inspect;field.readOnly=!can;}else field.disabled=!can;}
 if(!state.busy&&!state.playing&&state.permissions.read&&stamp&&state.effectStamp!==stamp&&state.effectPending!==stamp)refreshEffect().catch(problem);
}
function refreshEffect(){const stamp=effectStamp();if(state.effectPending&&state.effectPending!==stamp)state.effectAbort?.abort();return inspectorDrafts.inspect('refreshEffect:'+stamp,()=>refreshEffectNow());}
async function refreshEffectNow(){
 const stamp=effectStamp();if(!stamp||state.playing||!state.permissions.read||state.effectStamp===stamp||state.effectPending===stamp)return;
 state.effectAbort?.abort();const controller=new AbortController(),turn=++state.effectEpoch,project=state.project,tick=currentTick(),cid=String(state.comp),lid=String(state.layer),eid=String(state.effect);state.effectAbort=controller;state.effectPending=stamp;state.effectInfo=null;state.effectStamp=null;$('effectStatus').textContent='Inspecting current effect…';showEffects();controls();
 try{const result=await api('/projects/'+project.id+'/revisions/'+project.revision+'/effects/'+cid+'/'+lid+'/'+eid+'/'+tick+'/full',{signal:controller.signal});if(turn!==state.effectEpoch||stamp!==effectStamp())return;state.effectInfo=result.inspection;state.effectStamp=stamp;showEffects();controls();}
 catch(error){if(!controller.signal.aborted&&turn===state.effectEpoch){$('effectStatus').textContent='Current effect values unavailable.';throw error;}}
 finally{if(turn===state.effectEpoch)state.effectPending=null;}
}
$('effectParams').onsubmit=guard(async()=>{
 if(!state.effectInfo||state.effectStamp!==effectStamp()||state.effectInfo.locked||state.playing)throw new Error('Read the current effect values before editing.');
 const fields=state.effectInputs.filter(field=>field.changed()),changes=fields.map(field=>valueChange(field.prop,field.value,field.read()));if(!changes.length)return;
 const info=state.effectInfo,commands=[];for(let n=0;n<changes.length;n+=32)commands.push({command:'properties.patchAt',params:{layer:info.layer,effect:info.effect,compTimeTicks:info.compTimeTicks,changes:changes.slice(n,n+32)}});
 if(new TextEncoder().encode(stringifyNative(commands)).length<=65536)await apply(commands,{previewTick:info.compTimeTicks});
 else await saveFullEffectValues(info,fields.map(field=>({prop:field.prop,value:field.read()})));
});
async function saveFullEffectValues(info,changes){
 if(collectedEdits){collectedEdits.push({effectInfo:info,changes});return;}
 const project=state.project,epoch=state.epoch,done=busy();try{
  const source={baseRevision:project.revision,compId:String(state.comp),layer:info.layer,effect:info.effect,compTimeTicks:info.compTimeTicks,changes},signature=project.id+'@'+stringifyNative(source);if(state.fullEffectIntent?.signature!==signature)state.fullEffectIntent={signature,requestKey:crypto.randomUUID()};const payload={...source,requestKey:state.fullEffectIntent.requestKey},form=new FormData();
  form.append('document',new Blob([stringifyNative(payload)],{type:'application/json'}),'effect-values.json');
  const result=await api('/projects/'+project.id+'/effect-values',{method:'POST',body:form});if(epoch!==state.epoch||state.project?.id!==project.id)return;state.fullEffectIntent=null;inspectorDrafts.advance(project.id,project.revision,result.project.revision);
  state.project=result.project;state.historical=false;state.previewTick=info.compTimeTicks;clearKey();show();await refresh();await preview();
 }finally{done();}
}
// Native inspection supplies the held text value and layer-time mapping; no JS interpolation is substituted.
function textStamp(){return state.project&&layer()&&property(layer(),'text/sourceText')?[state.project.id,state.project.revision,String(state.comp),String(state.layer),state.previewTick??secondsTicks(String(state.time))].join(':'):null;}
function refreshText(force=false){const stamp=textStamp();if(force||state.textStamp!==stamp)state.textAbort?.abort();return inspectorDrafts.inspect('refreshText:'+stamp+':'+force,()=>refreshTextNow(force));}
async function refreshTextNow(force=false){
 const stamp=textStamp();if(!stamp){state.textEpoch++;state.textAbort?.abort();state.textInfo=null;state.textStamp=null;$('textPanel').hidden=true;return;}
 $('textPanel').hidden=false;if(state.playing||!state.permissions.read)return;if(!force&&stamp===state.textStamp)return;
 state.textAbort?.abort();const controller=new AbortController(),turn=++state.textEpoch;state.textAbort=controller;state.textStamp=stamp;state.textInfo=null;$('textStatus').textContent='Reading text at the current time…';controls();
 const project=state.project,compId=String(state.comp),layerId=String(state.layer),tick=state.previewTick??secondsTicks(String(state.time));
 try{
  const result=await api('/projects/'+project.id+'/revisions/'+project.revision+'/text/'+compId+'/'+layerId+'/'+tick+'/full',{signal:controller.signal});
  if(turn!==state.textEpoch||stamp!==textStamp())return;state.textInfo=result.text;
  $('textEdit').elements.content.value=result.text.value.text;$('textEdit').elements.selection.checked=false;$('textEdit').elements.replace.checked=false;$('textEdit').elements.replacement.value='';
  $('textStatus').textContent='Text at the current time · '+result.text.keyCount+' keyframes'+(result.text.hasExpression?' · an expression may change the rendered text':'');$('textStatus').dataset.tick=result.text.compTimeTicks;
  showTextFields();controls();
 }catch(error){if(turn!==state.textEpoch||stamp!==textStamp()||controller.signal.aborted)return;state.textStamp=null;$('textStatus').textContent='Text could not be read.';problem(error);controls();}
}
const textDisplay=text=>text.replace(/\r\n?/g,'\n');
function nativeTextOffset(raw,shownOffset){const chars=[...raw];let native=0,shown=0;while(native<chars.length&&shown<shownOffset){if(chars[native]==='\r'&&chars[native+1]==='\n')native+=2;else native++;shown++;}return native;}
function scalarOffset(text,offset){if(offset>0&&offset<text.length&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff)throw new Error('Select complete characters.');return [...text.slice(0,offset)].length;}
function selectedTextRange(){const field=$('textEdit').elements.content;return [nativeTextOffset(state.textInfo.value.text,scalarOffset(field.value,field.selectionStart)),nativeTextOffset(state.textInfo.value.text,scalarOffset(field.value,field.selectionEnd))];}
const textFields={font:'font',style:'style',size:'size',tracking:'tracking',strokeWidth:'stroke_width',leading:'leading',baselineShift:'baseline_shift',justify:'justify',direction:'direction',applyFill:'apply_fill',applyStroke:'apply_stroke',fauxBold:'faux_bold',fauxItalic:'faux_italic',ligatures:'ligatures',vertical:'vertical'};
const textFlags=new Set(['applyFill','applyStroke','fauxBold','fauxItalic','ligatures','vertical']);
const justifications={Left:'left',Center:'center',Right:'right',JustifyLastLeft:'justifyLeft',JustifyLastCenter:'justifyCenter',JustifyLastRight:'justifyRight',JustifyAll:'justifyAll'};
function textStyleAt(doc,index){let at=0;for(const run of doc.runs??[]){at+=Number(run.len);if(index<at)return run.style;}return doc;}
function textFontStyles(font,selected){const styles=state.fonts.find(f=>f.family===font)?.styles??[];return [...new Set([...styles,selected].filter(Boolean))];}
function showTextFields(){return inspectorDrafts.paint(['textEdit'],()=>showTextFieldsNow());}
function showTextFieldsNow(){
 const info=state.textInfo;if(!info)return;const doc=info.value,form=$('textEdit').elements,range=form.selection.checked?selectedTextRange():null,index=range?.[0]??0,style=textStyleAt(doc,index),para=doc.paragraphs?.[[...doc.text].slice(0,index).filter(c=>c==='\n').length]??doc;
 const actual={...doc,...style,...para};actual.vertical=doc.vertical;form.perChar3d.checked=Boolean(property(layer(),'text/perChar3d')?.value.v);form.font.replaceChildren(...[...new Set([...state.fonts.map(f=>f.family),actual.font])].map(font=>new Option(font,font)));form.font.value=actual.font;
 form.style.replaceChildren(...textFontStyles(actual.font,actual.style).map(style=>new Option(style,style)));
 state.textInitial={content:textDisplay(doc.text),perChar3d:form.perChar3d.checked};for(const [name,key]of Object.entries(textFields)){let v=actual[key];if(name==='justify')v=justifications[v]??v;if(name==='direction')v=String(v).toLowerCase();if(name==='leading')v=v===null?'auto':String(v);if(textFlags.has(name)){form[name].checked=Boolean(v);state.textInitial[name]=form[name].checked;}else{form[name].value=String(v);state.textInitial[name]=form[name].value;}}
 state.textColors={};for(const name of ['fill','stroke']){const color=actual[name];state.textColors[name]=color;form[name].value='#'+color.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');form[name+'Alpha'].value=String(color[3]);state.textInitial[name]=form[name].value;state.textInitial[name+'Alpha']=form[name+'Alpha'].value;}
 form.paragraph.checked=!!doc.box_size;state.textInitial.paragraph=form.paragraph.checked;for(const [name,v]of Object.entries({boxX:doc.box_pos[0],boxY:doc.box_pos[1],boxWidth:doc.box_size?.[0]??200,boxHeight:doc.box_size?.[1]??100})){form[name].value=String(v);state.textInitial[name]=form[name].value;}
 $('textRange').textContent=range?'Selected characters '+range[0]+'–'+range[1]:'All text'+((doc.runs?.length??0)>1?' · mixed formatting':'');$('fontNote').textContent=state.fonts.some(f=>f.family===actual.font)?'Fonts listed here are available to this worker.':'The stored font is unavailable to this worker; its native fallback renders. Preserve it or choose an available font.';
}
$('refreshText').onclick=guard(()=>refreshText(true));
$('textEdit').elements.selection.onchange=guard(()=>{const form=$('textEdit').elements;if(form.content.value!==textDisplay(state.textInfo.value.text))throw new Error('Save content before selecting a character range.');showTextFields();});
$('textEdit').elements.content.onselect=guard(()=>{if($('textEdit').elements.selection.checked)showTextFields();});
$('textEdit').elements.font.onchange=()=>{const form=$('textEdit').elements;form.style.replaceChildren(...textFontStyles(form.font.value,null).map(style=>new Option(style,style)));};
$('textEdit').onsubmit=guard(async()=>{
 const info=state.textInfo;if(!info||state.textStamp!==textStamp())throw new Error('Refresh text at the current time before editing.');const form=$('textEdit').elements,attributes={},range=form.selection.checked?selectedTextRange():undefined;
 if(range){if(form.content.value!==textDisplay(info.value.text))throw new Error('Save content before selecting a character range.');if(range[0]===range[1]&&!form.replace.checked)throw new Error('Select characters to format.');if(form.replace.checked)attributes.text=form.replacement.value;}
 const commands=[];if(!range&&form.content.value!==state.textInitial.content){const old=[...textDisplay(info.value.text)],updated=[...form.content.value];let start=0,oldEnd=old.length,newEnd=updated.length;while(start<oldEnd&&start<newEnd&&old[start]===updated[start])start++;while(oldEnd>start&&newEnd>start&&old[oldEnd-1]===updated[newEnd-1]){oldEnd--;newEnd--;}commands.push({command:'text.patchAt',params:{layer:info.layer,compTimeTicks:info.compTimeTicks,range:[nativeTextOffset(info.value.text,start),nativeTextOffset(info.value.text,oldEnd)],attributes:{text:updated.slice(start,newEnd).join('')}}});}
 for(const name of Object.keys(textFields)){const v=textFlags.has(name)?form[name].checked:form[name].value;if(v===state.textInitial[name])continue;if(textFlags.has(name)||['font','style','justify','direction'].includes(name))attributes[name]=v;else if(name==='leading'&&v.trim().toLowerCase()==='auto')attributes[name]='auto';else{if(!String(v).trim()||!Number.isFinite(Number(v)))throw new Error('Enter finite typography values.');attributes[name]=Number(v);}}
 for(const name of ['fill','stroke'])if(form[name].value!==state.textInitial[name]||form[name+'Alpha'].value!==state.textInitial[name+'Alpha']){const rgb=form[name].value===state.textInitial[name]?state.textColors[name].slice(0,3):form[name].value.slice(1).match(/../g).map(v=>parseInt(v,16)/255),alpha=Number(form[name+'Alpha'].value);if(!form[name+'Alpha'].value||!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('Enter alpha between 0 and 1.');attributes[name]=[...rgb,alpha];}
 if(form.paragraph.checked!==state.textInitial.paragraph||form.paragraph.checked&&['boxX','boxY','boxWidth','boxHeight'].some(name=>form[name].value!==state.textInitial[name])){attributes.box=form.paragraph.checked?['boxX','boxY','boxWidth','boxHeight'].map(name=>{const v=Number(form[name].value);if(!form[name].value||!Number.isFinite(v))throw new Error('Enter finite paragraph box values.');return v;}):null;if(attributes.box&&(attributes.box[2]<1||attributes.box[3]<1))throw new Error('Paragraph box dimensions must be positive.');}
 if(attributes.stroke!==undefined||attributes.strokeWidth!==undefined)attributes.applyStroke=form.applyStroke.checked;
 if(form.perChar3d.checked!==state.textInitial.perChar3d)commands.push({command:'layer.enablePerChar3D',params:{layer:parseNative(info.layer),enabled:form.perChar3d.checked}});
 if(Object.keys(attributes).length)commands.push({command:'text.patchAt',params:{layer:info.layer,compTimeTicks:info.compTimeTicks,attributes,...(range?{range}:{})}});
 if(commands.length)await apply(commands,{previewTick:info.compTimeTicks});
});
$('transform').onsubmit=guard(saveTransforms);

const transformFields={position:['x','y','z'],scale:['scale','scaleY','scaleZ'],rotation:['rotation'],opacity:['opacity'],orientation:['orientationX','orientationY','orientationZ'],rotationX:['rotationX'],rotationY:['rotationY']};
function currentTick(){return state.previewTick??secondsTicks(String(state.time));}
function propertiesStamp(){return state.project&&layer()?state.project.id+'@'+state.project.revision+'@'+String(state.comp)+'@'+String(state.layer)+'@'+currentTick():null;}
function propertyControls(edit){
 const valid=state.propertiesInfo&&state.propertiesStamp===propertiesStamp(),can=edit&&valid&&!state.propertiesInfo.locked&&!state.playing&&!state.keyInfo;
 for(const field of $('transform').elements)field.disabled=!can;
 for(const field of $('sceneProperties').elements)field.disabled=!can;
 for(const field of $('newSceneLayer').elements)field.disabled=!edit;
 $('newSceneLayer').elements.preset.disabled=!edit||$('newSceneLayer').elements.kind.value!=='camera';$('newSceneLayer').elements.cameraType.disabled=!edit||$('newSceneLayer').elements.kind.value!=='camera';
 const special=['Camera','Light'].includes(state.propertiesInfo?.source?.type);$('threeDLayer').disabled=!can||special;
 if(valid){const paths=new Set(state.propertiesInfo.properties.map(p=>p.path));for(const [name,fields]of Object.entries(transformFields))for(const field of fields)$('transform').elements[field].disabled=!can||!paths.has('transform/'+name);}
 if(!state.busy&&!state.playing&&state.permissions.read&&propertiesStamp()&&state.propertiesStamp!==propertiesStamp()&&state.propertiesPending!==propertiesStamp())refreshProperties().catch(problem);
}
function showProperties(){return inspectorDrafts.paint(['transform', 'sceneProperties'],()=>showPropertiesNow());}
function showPropertiesNow(){
 const info=state.propertiesInfo;if(!info)return;const form=$('transform').elements;state.propertiesInitial={};
 for(const [name,fields]of Object.entries(transformFields)){const prop=info.properties.find(p=>p.path==='transform/'+name),values=Array.isArray(prop?.value)?prop.value:[prop?.value];for(let n=0;n<fields.length;n++){form[fields[n]].value=values[n]===undefined?'':String(values[n]);state.propertiesInitial[fields[n]]=form[fields[n]].value;}}
 const scale=info.properties.find(p=>p.path==='transform/scale')?.value;form.linkScale.checked=!!scale&&scale[0]===scale[1];$('threeDLayer').checked=info.threeD||['Camera','Light'].includes(info.source?.type);
 const host=$('scenePropertyFields');host.replaceChildren();state.sceneInputs=[];
 for(const prop of info.properties.filter(p=>!p.path.startsWith('transform/'))){const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=prop.name;fieldset.append(legend);const fields=[];
  if(prop.valueType==='bool'){const label=document.createElement('label'),field=document.createElement('input');field.type='checkbox';field.checked=!!prop.value;label.className='check';label.append(field,document.createTextNode('Enabled'));fieldset.append(label);fields.push(field);}
  else if(prop.valueType==='enum'&&prop.ui?.options){const label=document.createElement('label'),field=document.createElement('select');label.textContent=prop.name;field.replaceChildren(...prop.ui.options.map((name,n)=>new Option(name,String(n))));field.value=String(prop.value);label.append(field);fieldset.append(label);fields.push(field);}
  else {const values=Array.isArray(prop.value)?prop.value:[prop.value];for(let n=0;n<values.length;n++){const label=document.createElement('label'),field=document.createElement('input');label.textContent=values.length===1?prop.name:['X / Red','Y / Green','Z / Blue','Alpha'][n]??String(n);field.type=prop.valueType==='layer'||prop.valueType==='string'?'text':'number';field.step='any';field.value=values[n]===null?'':String(values[n]);label.append(field);fieldset.append(label);fields.push(field);}}
  state.sceneInputs.push({prop,fields,initial:fields.map(f=>f.type==='checkbox'?f.checked:f.value)});host.append(fieldset);
 }
 $('sceneProperties').hidden=!state.sceneInputs.length;$('propertiesStatus').textContent='Native properties at tick '+info.compTimeTicks+' · before expressions'+(info.properties.some(p=>p.hasExpression)?' · an expression may change the rendered values':'');controls();
}
function refreshProperties(force=false){const stamp=propertiesStamp();if(force||state.propertiesPending&&state.propertiesPending!==stamp)state.propertiesAbort?.abort();return inspectorDrafts.inspect('refreshProperties:'+stamp+':'+force,()=>refreshPropertiesNow(force));}
async function refreshPropertiesNow(force=false){
 const stamp=propertiesStamp();if(!stamp||!state.permissions.read||state.playing||!force&&state.propertiesStamp===stamp)return;
 if(!force&&state.propertiesPending===stamp)return;
 state.propertiesAbort?.abort();const controller=new AbortController(),turn=++state.propertiesEpoch,project=state.project,compId=String(state.comp),layerId=String(state.layer),tick=currentTick();state.propertiesAbort=controller;state.propertiesPending=stamp;state.propertiesInfo=null;state.propertiesStamp=null;$('propertiesStatus').textContent='Inspecting current properties…';controls();
 try{const result=await api('/projects/'+project.id+'/revisions/'+project.revision+'/properties/'+compId+'/'+layerId+'/'+tick,{signal:controller.signal});if(turn!==state.propertiesEpoch||stamp!==propertiesStamp())return;state.propertiesInfo=result.inspection;state.propertiesStamp=stamp;showProperties();}
 catch(error){if(!controller.signal.aborted&&turn===state.propertiesEpoch){$('propertiesStatus').textContent='Current properties unavailable.';throw error;}}
 finally{if(turn===state.propertiesEpoch)state.propertiesPending=null;}
}
async function patchProperties(changes){
 if(!state.propertiesInfo||state.propertiesStamp!==propertiesStamp())throw new Error('Read the current properties before editing.');
 if(!changes.length)return;
 const info=state.propertiesInfo,tick=info.compTimeTicks;await apply([{command:'properties.patchAt',params:{layer:info.layer,compTimeTicks:tick,changes}}],{previewTick:tick});
}
async function saveTransforms(){
 if(!state.propertiesInfo||state.propertiesStamp!==propertiesStamp())throw new Error('Read the current properties before editing.');
 const form=$('transform').elements,changes=[];
 if(form.linkScale.checked&&form.scale.value!==state.propertiesInitial.scale)form.scaleY.value=form.scale.value;
 for(const [name,fields]of Object.entries(transformFields)){const prop=state.propertiesInfo.properties.find(p=>p.path==='transform/'+name);if(!prop||!fields.some(field=>form[field].value!==state.propertiesInitial[field]))continue;const values=fields.map((field,n)=>form[field].value===state.propertiesInitial[field]?(Array.isArray(prop.value)?prop.value[n]:prop.value):Number(form[field].value));if(!values.every(Number.isFinite))throw new Error('Enter finite property values.');changes.push({prop:prop.prop,value:Array.isArray(prop.value)?values:values[0]});}
 await patchProperties(changes);
}
$('sceneProperties').onsubmit=guard(async()=>{if(!state.propertiesInfo||state.propertiesStamp!==propertiesStamp())throw new Error('Read the current properties before editing.');const changes=[];for(const entry of state.sceneInputs){if(!entry.fields.some((f,n)=>(f.type==='checkbox'?f.checked:f.value)!==entry.initial[n]))continue;const values=entry.fields.map((f,n)=>f.type==='checkbox'?f.checked:entry.prop.valueType==='layer'?(f.value===''?null:parseNative(f.value)):entry.prop.valueType==='string'?f.value:f.value===entry.initial[n]?(Array.isArray(entry.prop.value)?entry.prop.value[n]:entry.prop.value):Number(f.value));changes.push({prop:entry.prop.prop,value:Array.isArray(entry.prop.value)?values:values[0]});}await patchProperties(changes);});
$('threeDLayer').onchange=guard(async()=>{if(!state.propertiesInfo||state.propertiesStamp!==propertiesStamp())throw new Error('Read the current properties before editing.');await apply([{command:'layer.setSwitch',params:{layers:[state.layer],switch:'threeD',value:$('threeDLayer').checked}}],{previewTick:currentTick()});});
$('newSceneLayer').elements.kind.onchange=()=>{const form=$('newSceneLayer').elements;form.name.value=form.kind.value==='camera'?'Camera':form.kind.selectedOptions[0].textContent;controls();};
$('newSceneLayer').onsubmit=guard(async()=>{const form=$('newSceneLayer').elements;await apply([{command:form.kind.value==='camera'?'layer.newCamera':'layer.newLight',params:form.kind.value==='camera'?{name:form.name.value,preset:form.preset.value,type:form.cameraType.value}:{name:form.name.value,kind:form.kind.value}}]);});

$('key').onsubmit=guard(async()=>{const form=$('key').elements,path=form.path.value,target=state.layer,time=state.time,value=path.endsWith('position')||path.endsWith('scale')?form.value.value.split(',').map(Number):Number(form.value.value),commands=[{command:'prop.addKey',params:{layer:target,path,time,value,timeBase:'comp'}},{command:'keys.select',params:{keys:[{layer:target,path,time}],timeBase:'comp'}}];if(form.ease.value==='ease')commands.push({command:'keys.easyEase',params:{}});else commands.push({command:'keys.interpolation',params:{interpolation:form.ease.value}});await apply(commands);});
$('mask').onsubmit=guard(async()=>{const form=$('mask').elements,before=new Set(maskGroups().map(g=>g.uid));await apply([{command:'layer.addMask',params:{layer:state.layer,shape:form.shape.value,rect:[Number(form.x.value),Number(form.y.value),Number(form.width.value),Number(form.height.value)]}}]);state.mask=maskGroups().find(g=>!before.has(g.uid))?.uid??state.mask;showMasks();controls();});
// Playback samples every exact frame in the saved half-open work area; it never builds a frame cache.
function workPlan(){
  const c=comp();if(!c)throw new Error('Open a composition to preview.');
  const start=BigInt(c.work_area[0]),end=BigInt(c.work_area[1]),duration=BigInt(c.duration),rate=c.frame_rate;
  if(start<0n||end<=start||end>duration||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||rate.num/rate.den>1000)throw new Error('This composition has no usable work area or frame rate.');
  const numerator=BigInt(state.ticks)*BigInt(rate.den),denominator=BigInt(rate.num),count=((end-start)*denominator+numerator-1n)/numerator;
  return{start,end,count,at:index=>start+index*numerator/denominator,index:tick=>((tick-start+1n)*denominator-1n)/numerator,frameMs:1000*rate.den/rate.num};
}
function stopPlayback(){const wasPlaying=state.playing;state.playing=false;state.playEpoch++;state.previewEpoch++;state.playAbort?.abort();state.playAbort=null;$('playbackStatus').textContent='Stopped';controls();if(wasPlaying){void refreshText();void refreshMask();}}
function setPreviewTick(tick){state.previewTick=String(tick);state.time=Number(tick)/state.ticks;$('time').value=state.time;$('timeLabel').textContent=state.time.toFixed(2)+' s';}
function waitFrame(ms,signal){return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();},timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();});}
function startPlayback(){
  const plan=workPlan();clearKey();state.maskEpoch++;state.maskAbort?.abort();state.maskStamp=null;state.maskInfo=null;state.textEpoch++;state.textAbort?.abort();state.textStamp=null;state.textInfo=null;const turn=++state.playEpoch,epoch=state.epoch,document=state.project.document,selected=state.comp,previous=state.playTask,controller=new AbortController();state.playAbort=controller;state.playing=true;controls();
  const current=()=>state.playing&&turn===state.playEpoch&&epoch===state.epoch&&document===state.project?.document&&selected===state.comp;
  state.playTask=(async()=>{
    await previous;let index=0n;
    while(current()){
      const began=performance.now();setPreviewTick(plan.at(index));$('playbackStatus').textContent='Rendering frame '+String(index+1n)+' / '+String(plan.count);
      await preview(controller.signal);if(!current())return;
      $('playbackStatus').textContent='Frame '+String(index+1n)+' / '+String(plan.count);
      index++;if(index===plan.count){if(!$('loop').checked)break;index=0n;}
      await waitFrame(Math.max(0,plan.frameMs-(performance.now()-began)),controller.signal);
    }
  })().catch(error=>{if(current())problem(error);}).finally(()=>{if(turn===state.playEpoch)stopPlayback();});
}
$('play').onclick=guard(()=>{if(state.playing)stopPlayback();else startPlayback();});
async function stepFrame(direction){
  stopPlayback();const tick=BigInt(state.previewTick??secondsTicks(String(state.time)));clearKey();const plan=workPlan();let index;
  if(tick<plan.start)index=0n;else if(tick>=plan.end)index=plan.count-1n;
  else{index=plan.index(tick);if(direction>0)index++;else if(plan.at(index)>=tick)index--;}
  index=index<0n?0n:index>=plan.count?plan.count-1n:index;setPreviewTick(plan.at(index));void refreshText();void refreshMask();await preview();
}
$('previousFrame').onclick=guard(()=>stepFrame(-1));$('nextFrame').onclick=guard(()=>stepFrame(1));
$('workArea').onsubmit=guard(async()=>{
  const params={};for(const name of ['start','end']){const text=$('workArea').elements[name].value;if(text!==state.workFields[name]){const number=Number(text);if(!text.trim()||!Number.isFinite(number))throw new Error('Enter finite work-area times in seconds.');params[name]=number;}}
  if(!Object.keys(params).length)return;
  const start=params.start??Number(comp().work_area[0])/state.ticks,end=params.end??Number(comp().work_area[1])/state.ticks;
  if(start<0||end<=start||end>Number(comp().duration)/state.ticks)throw new Error('Choose a work area inside the composition with its end after its start.');
  await apply([{command:'comp.workArea',params:{comp:state.comp,...params}}]);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});window.addEventListener('pagehide',stopPlayback);
$('time').oninput=guard(async()=>{stopPlayback();state.time=Number($('time').value);state.previewTick=null;$('timeLabel').textContent=state.time.toFixed(2)+' s';void refreshText();void refreshMask();await preview();});
$('image').onchange=guard(async()=>{const file=$('image').files[0];$('image').value='';if(!file)return;const epoch=state.epoch,id=state.project?.id,form=new FormData();form.append('file',file);const {asset}=await api('/assets',{method:'POST',body:form});if(epoch!==state.epoch||id!==state.project?.id)return;await apply([{command:'asset.import',params:{assetId:asset.id,name:file.name}}]);});
$('assets').onchange=controls;$('reuse').onclick=guard(()=>apply([{command:'asset.import',params:{assetId:$('assets').value,name:'Saved photo'}}]));$('dropAsset').onclick=guard(async()=>{if(!confirm('Delete this unused photo? Photos in composition history are protected.'))return;await api('/assets/'+$('assets').value,{method:'DELETE'});await refresh();});
$('undo').onclick=guard(async()=>{const id=state.project.id,epoch=state.epoch,previewTick=state.previewTick;const done=busy();try{const {project}=await post('/projects/'+id+'/restore',{revision:state.project.revision-1,baseRevision:state.project.revision,requestKey:crypto.randomUUID()});if(epoch!==state.epoch||state.project?.id!==id)return;state.project=project;state.historical=false;clearKey();state.previewTick=previewTick;show();await preview();}finally{done();}});
$('export').onclick=guard(async()=>{const response=await fetch(base+'/projects/'+state.project.id+'/revisions/'+state.project.revision+'/export',{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('Export is no longer permitted.');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='composition.ecproj';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('delete').onclick=guard(async()=>{stopPlayback();if(!confirm('Delete this composition and its revision history?'))return;const id=state.project.id,epoch=state.epoch;await api('/projects/'+id,{method:'DELETE'});if(epoch!==state.epoch||state.project?.id!==id)return;state.project=null;state.epoch++;$('preview').hidden=true;$('empty').hidden=false;show();await refresh();});
function commandFields(){const entry=state.catalog.find(item=>item.id===$('commands').value),properties=entry?.schema?.properties??{};$('params').replaceChildren(...Object.entries(properties).map(([key,schema])=>{const label=document.createElement('label');label.textContent=schema.description||key;const input=document.createElement(schema.type==='object'||schema.type==='array'?'textarea':'input');input.name=key;input.dataset.type=schema.type??'string';input.placeholder=key;label.append(input);return label;}));}
$('commands').onchange=commandFields;$('advanced').onsubmit=guard(async()=>{const params={};for(const input of $('params').querySelectorAll('input,textarea')){if(!input.value)continue;params[input.name]=input.dataset.type==='number'||input.dataset.type==='integer'?parseNative(input.value):input.dataset.type==='object'||input.dataset.type==='array'||input.dataset.type==='boolean'?parseNative(input.value):input.value;}await apply([{command:$('commands').value,params}]);});
const bundles=new BundleClient((label,value,total,receipt)=>{if(!bundleActive())return;$('bundleStatus').textContent=label+' · '+Math.round(100*value/total)+'%';$('bundleProgress').hidden=false;$('bundleProgress').max=total;$('bundleProgress').value=value;if(receipt)bundleReceipt(receipt);});
let bundleAbort=null,bundleKind=null,bundleEpoch=0;
function bundleActive(){return bundleAbort&&!bundleAbort.signal.aborted;}
function bundleReceipt(receipt){$('bundleReceipt').hidden=false;$('bundleReceipt').textContent='Transfer '+receipt.id+' · '+receipt.state+' · '+receipt.received+' of '+receipt.bytes+' bytes';$('bundleReceipt').dataset.id=receipt.id;$('bundleCancel').hidden=false;}
function bundleControls(){const upload=state.permissions.read&&state.permissions.create&&!state.busy;for(const field of $('importBundle').elements)field.disabled=!upload;$('bundleExport').disabled=!state.project||!state.permissions.export||state.busy;$('bundleDownload').disabled=!state.permissions.export||state.busy;$('bundleSaveFile').hidden=typeof window.showSaveFilePicker!=='function';$('bundleSaveFile').disabled=!state.permissions.export||state.busy||!state.project&&!bundles.exportRecord?.transfer;$('bundleCancel').disabled=false;}
async function bundleWork(kind,work){const epoch=++bundleEpoch,controller=new AbortController();bundleAbort=controller;bundleKind=kind;const done=busy();$('bundleCancel').hidden=false;try{return await work(controller.signal,()=>epoch===bundleEpoch&&!controller.signal.aborted);}catch(error){if(error.name==='AbortError'){$('bundleStatus').textContent='Transfer stopped. Retry the same file or cancel its staged bytes.';return;}throw error;}finally{if(epoch===bundleEpoch)bundleAbort=null;done();}}
$('importBundle').onsubmit=guard(()=>bundleWork('import',async(signal,current)=>{
 const form=$('importBundle').elements,epoch=state.epoch;await bundles.upload(form.bundle.files[0],form.title.value,{signal});if(!current())return;
 const receipt=await bundles.finish({signal});if(!current()||epoch!==state.epoch)return;const result=await api('/projects/'+receipt.id,{signal});if(!current()||epoch!==state.epoch)return;
 state.epoch++;state.project=result.project;state.historical=false;clearKey();state.comp=null;state.layer=null;state.checked.clear();state.time=0;show();await refresh();await preview();$('bundleStatus').textContent='Imported editable composition.';bundleReceipt(bundles.importRecord.transfer);
}));
$('bundleStage').onclick=guard(()=>bundleWork('import',async(signal,current)=>{const form=$('importBundle').elements,transfer=await bundles.upload(form.bundle.files[0],form.title.value,{signal});if(current()){$('bundleStatus').textContent='Uploaded. Ask the agent to import this transfer.';bundleReceipt(transfer);}}));
async function bundleSave(signal,current){const blob=await bundles.download({signal});if(!current())return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='composition.motionbundle.tar';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('bundleStatus').textContent='Verified bundle downloaded.';bundleReceipt(bundles.exportRecord.transfer);}
$('bundleExport').onclick=guard(()=>bundleWork('export',async(signal,current)=>{const project=state.project;await bundles.prepare(project.id,project.revision,{signal});if(current())await bundleSave(signal,current);}));
$('bundleDownload').onclick=guard(()=>bundleWork('export',bundleSave));
$('bundleSaveFile').onclick=guard(()=>bundleWork('export',async(signal,current)=>{
 // Choose during the actual click's activation, before any request or source production.
 const project=state.project,epoch=state.epoch;
 const handle=await window.showSaveFilePicker({suggestedName:'composition.motionbundle.tar',types:[{description:'Editable Motion bundle',accept:{'application/x-tar':['.tar']}}]});
 if(!current()||epoch!==state.epoch)return;
 if(project)await bundles.prepare(project.id,project.revision,{signal});
 if(!current())return;
 const writable=await handle.createWritable({keepExistingData:false});
 await bundles.download({signal,writable});if(!current())return;
 $('bundleStatus').textContent='Verified bundle saved to file.';bundleReceipt(bundles.exportRecord.transfer);
}));
$('bundleCancel').onclick=guard(async()=>{bundleAbort?.abort();bundleEpoch++;bundleAbort=null;await bundles.cancel(bundleKind||'export');$('bundleReceipt').hidden=true;$('bundleProgress').hidden=true;$('bundleDownload').hidden=true;$('bundleCancel').hidden=true;$('bundleStatus').textContent='Transfer cancelled. Saved compositions are unchanged.';});
const renders=new RenderClient(render=>{
 if($('error').textContent==='The render is updating. Retrying shortly.')$('error').hidden=true;
 $('renderStatus').textContent=render.state==='failed'?'Render failed: '+render.error:render.state==='ready'?'Render complete. Verified output is ready to download.':render.state==='cancelled'?'Render cancelled. Saved source is unchanged.':'Render '+render.state+' · '+render.completedFrames+' / '+render.frames+' frames';
 $('renderProgress').max=render.downloadedBytes?render.bytes:render.frames;$('renderProgress').value=render.downloadedBytes??render.completedFrames;
 $('renderReceipt').textContent='Render '+render.id+' · source revision '+render.revision+' · '+render.documentSha256;
 $('renderSource').hidden=false;$('renderSource').href=base+'/app?project='+render.project+'&revision='+render.revision+'&compId='+render.compId;
 renderControls();
});
function renderControls(){const allowed=!!state.permissions.export;$('renderStart').textContent=renders.record&&['failed','cancelled'].includes(renders.record.state)?'Retry render':'Start render';$('renderCancel').textContent=renders.record?.state==='ready'?'Discard rendered file':'Cancel render';$('renderStart').disabled=!allowed||!state.project||!state.comp||state.busy;$('renderRefresh').disabled=!allowed||!renders.record&&!renders.pendingId;$('renderCancel').disabled=!allowed||!renders.record||['cancelled','failed'].includes(renders.record.state);$('renderDownload').disabled=!allowed||renders.record?.state!=='ready';$('renderSaveFile').hidden=typeof window.showSaveFilePicker!=='function';$('renderSaveFile').disabled=$('renderDownload').disabled;}
$('renderStart').onclick=guard(async()=>{const p=state.project;await renders.start({project:p.id,revision:p.revision,format:$('renderFormat').value,compId:String(state.comp),maxSide:4096});});
$('renderRefresh').onclick=guard(()=>renders.status());$('renderCancel').onclick=guard(()=>renders.cancel());
$('renderDownload').onclick=guard(async()=>{const blob=await renders.download();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='motion-render.'+(renders.record.format==='mp4'?'mp4':'tar');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('renderSaveFile').onclick=guard(async()=>{const ext=renders.record.format==='mp4'?'mp4':'tar';const handle=await window.showSaveFilePicker({suggestedName:'motion-render.'+ext});await renders.download({writable:await handle.createWritable()});});
setInterval(()=>{if((renders.pendingId||renders.record&&['queued','rendering'].includes(renders.record.state))&&state.permissions.export)void renders.status().catch(error=>{$('renderStatus').textContent=error.message;});},2000);
await guard(async()=>{state.permissions=(await api('/permissions')).permissions;const contract=await api('/editing-contract');state.ticks=contract.engine.ticksPerSecond;if(!Number.isSafeInteger(state.ticks)||state.ticks<=0)throw new Error('The engine returned an invalid timeline unit.');state.ready=true;state.catalog=contract.engine.commands;state.effects=contract.engine.effects;state.fonts=contract.engine.fonts;effectChoices();$('commands').replaceChildren(...state.catalog.map(entry=>new Option(entry.label||entry.id,entry.id)));commandFields();show();await refresh();const project=new URLSearchParams(location.search).get('project');if(project){await open(project,new URLSearchParams(location.search).get('revision'));const requested=new URLSearchParams(location.search).get('compId');if(requested){const chosen=Object.values(state.project.document.items).find(item=>item.kind.type==='Comp'&&String(item.id)===requested);if(!chosen)throw new Error('The source composition is unavailable.');state.comp=chosen.id;state.layer=null;show();await preview();}}const job=new URLSearchParams(location.search).get('renderJob');if(job)await renders.status(job);const prepared=new URLSearchParams(location.search).get('bundleTransfer');if(prepared){const transfer=await bundles.useExport(prepared);bundleKind='export';bundleReceipt(transfer);$('bundleDownload').hidden=false;$('bundleStatus').textContent='Prepared bundle ready to download.';bundleControls();}})();// Bootstrap is access-gated and never assumes a provisioned engine.

// Exact native inspection supplies evaluated geometry; the same native commands edit at the supplied Tick.
function maskGroups(){return property(layer(),'masks')?.children?.filter(g=>g.kind?.kind==='Mask')??[];}
function maskGroup(){return maskGroups().find(g=>g.uid===state.mask);}
function maskProperty(name){const p=maskGroup()?.children.find(p=>p.match===name);return p&&state.maskInfo&&state.maskStamp===maskStamp()?{...p,value:state.maskInfo.properties[name].value}:p;}
function maskEditable(){return Boolean(maskGroup()&&state.maskInfo&&state.maskStamp===maskStamp()&&!state.maskInfo.locked&&!state.playing);}
function maskControls(edit){
 const editable=edit&&maskEditable();$('savedMasks').disabled=!maskGroups().length;
 for(const f of $('maskSettings').elements)f.disabled=!editable;
 for(const [name,fields]of [['feather',['featherX','featherY']],['opacity',['opacity']],['expansion',['expansion']]])for(const field of fields)$('maskSettings').elements[field].disabled=!editable||!!state.maskInfo?.properties[name].staticOnly;
 $('maskLocked').disabled=!edit||!maskGroup()||!state.maskInfo||state.maskStamp!==maskStamp()||state.playing||!!layer()?.switches.locked;
 $('refreshMask').disabled=!maskGroup()||!state.permissions.read||state.busy||state.playing;$('keyMaskPath').disabled=!editable||!!state.maskInfo?.properties.path.staticOnly||!!maskProperty('path')?.keys?.some(key=>String(key.time)===state.maskInfo?.layerTimeTicks);
 for(const id of ['maskEarlier','maskLater','duplicateMask','removeMask'])$(id).disabled=!editable;
 const index=maskGroups().findIndex(g=>g.uid===state.mask);$('maskEarlier').disabled=!editable||index<=0;$('maskLater').disabled=!editable||index>=maskGroups().length-1;
 const geometry=editable&&!state.maskInfo.properties.path.staticOnly;for(const f of $('maskVertex').elements)f.disabled=!geometry||!maskProperty('path')?.value?.v?.vertices?.length;
 for(const id of ['maskClosed','insertMaskVertex','removeMaskVertex'])$(id).disabled=!geometry;
 const path=maskProperty('path')?.value?.v,n=path?.vertices?.length??0;
 $('insertMaskVertex').disabled=!geometry||n<2||(!path.closed&&state.maskVertex===n-1);$('removeMaskVertex').disabled=!geometry||n<=1;
 $('maskVertices').disabled=!n;
 for(const f of $('addFeather').elements)f.disabled=!geometry||n<2;const feathers=path?.feather??[];for(const f of $('editFeather').elements)f.disabled=!geometry||!feathers.length;$('removeFeather').disabled=!geometry||!feathers.length;$('featherPoints').disabled=!feathers.length;
}
function showMasks(){return inspectorDrafts.paint(['maskSettings'],()=>showMasksNow());}
function showMasksNow(){
 const groups=maskGroups();if(!groups.some(g=>g.uid===state.mask)){state.mask=groups[0]?.uid??null;state.maskVertex=0;}
 $('savedMasks').replaceChildren(...groups.map(g=>new Option(g.name,String(g.uid))));$('savedMasks').value=String(state.mask??'');
 const g=maskGroup(),f=$('maskSettings').elements;state.maskInitial={};
 const values={name:g?.name??'',mode:g?.kind.mode??'Add',inverted:g?.kind.inverted??false,enabled:g?.enabled??true,featherX:maskProperty('feather')?.value.v[0]??0,featherY:maskProperty('feather')?.value.v[1]??0,opacity:maskProperty('opacity')?.value.v??100,expansion:maskProperty('expansion')?.value.v??0};
 for(const [name,v]of Object.entries(values)){if(typeof v==='boolean'){f[name].checked=v;state.maskInitial[name]=v;}else{f[name].value=String(v);state.maskInitial[name]=f[name].value;}}
 $('maskLocked').checked=g?.kind.locked??false;
 $('maskNote').textContent=!g?'Add a mask to edit it.':state.maskStamp===maskStamp()&&state.maskInfo?'Native values at current time before expressions · '+state.maskInfo.properties.path.keyCount+' path keys. Topology edits keep vertex counts synchronized across native keys.':'Reading native mask at the current time…';$('maskNote').dataset.tick=state.maskStamp===maskStamp()&&state.maskInfo?state.maskInfo.compTimeTicks:'';
 const path=maskProperty('path')?.value.v,vertices=path?.vertices??[];if(state.maskVertex>=vertices.length)state.maskVertex=0;
 $('maskVertices').replaceChildren(...vertices.map((v,i)=>new Option('Vertex '+(i+1),String(i))));$('maskVertices').value=String(state.maskVertex);$('maskClosed').checked=path?.closed??false;showMaskVertex();showFeatherFields(path);drawMaskPath(path);void refreshMask();
}
function showMaskVertex(){return inspectorDrafts.paint(['maskVertex'],()=>showMaskVertexNow());}
function showMaskVertexNow(){const p=maskProperty('path')?.value.v,i=state.maskVertex,v=p?.vertices[i]??[0,0],a=p?.in_tangents[i]??[0,0],b=p?.out_tangents[i]??[0,0];state.maskVertexInitial={};for(const [name,value]of Object.entries({x:v[0],y:v[1],inX:a[0],inY:a[1],outX:b[0],outY:b[1]})){$('maskVertex').elements[name].value=String(value);state.maskVertexInitial[name]=String(value);}}
function drawMaskPath(path){
 const svg=$('maskPath'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();if(!path?.vertices.length)return;
 const v=path.vertices,n=v.length,ins=path.in_tangents,outs=path.out_tangents,points=v.flatMap((p,i)=>[p,[p[0]+ins[i][0],p[1]+ins[i][1]],[p[0]+outs[i][0],p[1]+outs[i][1]]]);
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}const loX=minX-10,loY=minY-10,w=maxX-loX+10,h=maxY-loY+10;svg.setAttribute('viewBox',[loX,loY,w,h].join(' '));
 let d='M '+v[0].join(' ');for(let i=0;i<(path.closed?n:n-1);i++){const j=(i+1)%n;d+=' C '+[v[i][0]+outs[i][0],v[i][1]+outs[i][1],v[j][0]+ins[j][0],v[j][1]+ins[j][1],...v[j]].join(' ');}if(path.closed)d+=' Z';
 const line=document.createElementNS(ns,'path');line.setAttribute('d',d);line.setAttribute('fill','none');line.setAttribute('stroke','#9ecfff');line.setAttribute('stroke-width',String(Math.max(w,h)/150));svg.append(line);
 v.forEach((p,i)=>{const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',p[0]);dot.setAttribute('cy',p[1]);dot.setAttribute('r',String(Math.max(w,h)/65));dot.setAttribute('fill',i===state.maskVertex?'#ffcc66':'#9ecfff');dot.setAttribute('tabindex','0');dot.setAttribute('role','button');dot.setAttribute('aria-label','Select mask vertex '+(i+1));const select=()=>{state.maskVertex=i;showMasks();controls();};dot.onclick=select;dot.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select();}};svg.append(dot);});
}
function requireMaskEdit(name){if(!maskEditable()||state.maskInfo.properties[name].staticOnly)throw new Error('Refresh this unlocked native mask at the current time before editing.');}
async function maskAction(command,params={}){if(!maskEditable())return;await apply([{command:'layer.select',params:{layers:[state.layer]}},{command,params:{layer:state.layer,...(command.startsWith('prop.')?{}:{mask:state.mask}),...params}}],{previewTick:state.previewTick});}
$('savedMasks').onchange=()=>{state.mask=parseNative($('savedMasks').value);state.maskVertex=0;showMasks();controls();};
$('maskVertices').onchange=()=>{state.maskVertex=Number($('maskVertices').value);showMasks();controls();};
$('maskSettings').onsubmit=guard(async()=>{
 if(!maskEditable())return;const f=$('maskSettings').elements,g=maskGroup(),commands=[];
 if(f.name.value!==state.maskInitial.name)commands.push({command:'prop.renameGroup',params:{layer:state.layer,prop:g.uid,name:f.name.value}});
 const header={};for(const name of ['mode','inverted']){const v=name==='inverted'?f[name].checked:f[name].value;if(v!==state.maskInitial[name])header[name]=v;}
 if(Object.keys(header).length)commands.push({command:'layer.setMask',params:{layer:state.layer,mask:g.uid,...header}});
 if(f.enabled.checked!==state.maskInitial.enabled)commands.push({command:'prop.setGroupEnabled',params:{layer:state.layer,prop:g.uid,value:f.enabled.checked}});
 for(const [name,fields]of [['feather',['featherX','featherY']],['opacity',['opacity']],['expansion',['expansion']]])if(fields.some(field=>f[field].value!==state.maskInitial[field])){requireMaskEdit(name);const values=fields.map(field=>{const v=Number(f[field].value);if(!f[field].value||!Number.isFinite(v))throw new Error('Enter finite mask values.');return v;});commands.push({command:'layer.mask.set',params:{layer:state.layer,mask:g.uid,field:name,value:values.length===1?values[0]:values}});}
 if(commands.length){const operations=commands.filter(c=>c.command==='layer.mask.set').map(c=>({command:c.command,params:{field:c.params.field,value:c.params.value}})),header=commands.filter(c=>c.command!=='layer.mask.set');if(operations.length)header.push({command:'mask.patchAt',params:maskPatchParams(operations)});await apply([{command:'layer.select',params:{layers:[state.layer]}},...header],{previewTick:state.maskInfo.compTimeTicks});}
});
$('maskVertex').onsubmit=guard(async()=>{requireMaskEdit('path');const f=$('maskVertex').elements,params={};for(const [name,fields]of [['point',['x','y']],['in',['inX','inY']],['out',['outX','outY']]])if(fields.some(field=>f[field].value!==state.maskVertexInitial[field]))params[name]=fields.map(field=>{const v=Number(f[field].value);if(!f[field].value||!Number.isFinite(v))throw new Error('Enter finite vertex coordinates.');return v;});if(Object.keys(params).length)await apply([{command:'mask.patchAt',params:maskPatchParams([{command:'mask.setVertex',params:{index:state.maskVertex,...params}}])}],{previewTick:state.maskInfo.compTimeTicks});});
$('maskClosed').onchange=guard(async()=>{requireMaskEdit('path');await exactMaskAction('mask.setClosed',{closed:$('maskClosed').checked});});
$('insertMaskVertex').onclick=guard(async()=>{requireMaskEdit('path');await exactMaskAction('mask.insertVertex',{segment:state.maskVertex,t:0.5});});
$('removeMaskVertex').onclick=guard(async()=>{requireMaskEdit('path');await exactMaskAction('mask.deleteVertices',{indices:[state.maskVertex]});});
$('maskLocked').onchange=guard(async()=>{if(!maskGroup()||layer()?.switches.locked)return;await apply([{command:'layer.select',params:{layers:[state.layer]}},{command:'layer.mask.lock',params:{layer:state.layer,mask:state.mask,value:$('maskLocked').checked}}],{previewTick:state.previewTick});});
$('maskEarlier').onclick=guard(()=>maskAction('prop.moveGroup',{prop:state.mask,index:Math.max(1,maskGroups().findIndex(g=>g.uid===state.mask))}));
$('maskLater').onclick=guard(()=>maskAction('prop.moveGroup',{prop:state.mask,index:Math.min(maskGroups().length,maskGroups().findIndex(g=>g.uid===state.mask)+2)}));
$('duplicateMask').onclick=guard(async()=>{const before=new Set(maskGroups().map(g=>g.uid));await maskAction('prop.duplicateGroup',{prop:state.mask});state.mask=maskGroups().find(g=>!before.has(g.uid))?.uid??state.mask;showMasks();controls();});
$('removeMask').onclick=guard(async()=>{if(confirm('Remove this mask? Composition history keeps its previous version.'))await maskAction('mask.remove');});

function maskStamp(){return state.project&&maskGroup()?[state.project.id,state.project.revision,String(state.comp),String(state.layer),String(state.mask),state.previewTick??secondsTicks(String(state.time))].join(':'):null;}
function refreshMask(force=false){const stamp=maskStamp();if(force||state.maskStamp!==stamp)state.maskAbort?.abort();return inspectorDrafts.inspect('refreshMask:'+stamp+':'+force,()=>refreshMaskNow(force));}
async function refreshMaskNow(force=false){
 const stamp=maskStamp();if(!stamp){state.maskEpoch++;state.maskAbort?.abort();state.maskInfo=null;state.maskStamp=null;return;}
 if(state.playing||!state.permissions.read)return;if(!force&&stamp===state.maskStamp)return;
 state.maskAbort?.abort();const controller=new AbortController(),turn=++state.maskEpoch;state.maskAbort=controller;state.maskStamp=stamp;state.maskInfo=null;controls();
 const project=state.project,compId=String(state.comp),layerId=String(state.layer),mask=String(state.mask),tick=state.previewTick??secondsTicks(String(state.time));
 try{const result=await api('/projects/'+project.id+'/revisions/'+project.revision+'/masks/'+compId+'/'+layerId+'/'+mask+'/'+tick+'/full/0',{signal:controller.signal});if(turn!==state.maskEpoch||stamp!==maskStamp())return;state.maskInfo=result.mask;showMasks();controls();}
 catch(error){if(turn!==state.maskEpoch||stamp!==maskStamp()||controller.signal.aborted)return;state.maskStamp=null;state.maskInfo=null;$('maskNote').textContent='Mask could not be read at this time.';problem(error);controls();}
}
function maskPatchParams(operations){if(!state.maskInfo||state.maskStamp!==maskStamp())throw new Error('Refresh the mask at the current time before editing.');return{layer:state.maskInfo.layer,mask:state.maskInfo.mask,compTimeTicks:state.maskInfo.compTimeTicks,operations};}
async function exactMaskAction(command,params){requireMaskEdit(command==='layer.mask.set'?params.field:'path');await apply([{command:'mask.patchAt',params:maskPatchParams([{command,params}])}],{previewTick:state.maskInfo.compTimeTicks});}
$('refreshMask').onclick=guard(()=>refreshMask(true));
$('keyMaskPath').onclick=guard(async()=>{requireMaskEdit('path');const info=state.maskInfo;await apply([{command:'keys.addExact',params:{layer:info.layer,prop:info.properties.path.prop,timeTicks:info.layerTimeTicks}}],{previewTick:info.compTimeTicks});});

function showFeatherFields(path){return inspectorDrafts.paint(['editFeather'],()=>showFeatherFieldsNow(path));}
function showFeatherFieldsNow(path){
 const vertices=path?.vertices??[],segments=path?.closed?vertices.length:Math.max(0,vertices.length-1),feathers=path?.feather??[],add=$('addFeather').elements,edit=$('editFeather').elements;
 const oldSegment=add.segment.value;for(const f of [add.segment,edit.segment])f.replaceChildren(...Array.from({length:segments},(_,i)=>new Option('Segment '+(i+1)+' (vertex '+(i+1)+' to '+((i+1)%vertices.length+1)+')',String(i))));add.segment.value=/^(0|[1-9][0-9]*)$/.test(oldSegment)&&Number(oldSegment)<segments?oldSegment:'0';
 if(state.featherIndex>=feathers.length)state.featherIndex=Math.max(0,feathers.length-1);$('featherPoints').replaceChildren(...feathers.map((f,i)=>new Option('Point '+(i+1)+' · segment '+(Number(f.segment)+1)+' · radius '+f.radius,String(i))));$('featherPoints').value=String(state.featherIndex);
 const current=feathers[state.featherIndex];state.featherInitial={};for(const [name,v]of Object.entries({segment:current?.segment??0,t:current?.t??.5,radius:current?.radius??0,tension:(current?.tension??0)*100})){edit[name].value=String(v);state.featherInitial[name]=edit[name].value;}
}
function featherParams(form,changed=false){const params={};for(const name of ['segment','t','radius','tension']){const text=form[name].value;if(changed&&text===state.featherInitial[name])continue;const value=Number(text);if(!text||!Number.isFinite(value)||name==='segment'&&(!Number.isSafeInteger(value)||value<0)||name==='t'&&(value<0||value>1)||name==='tension'&&(value<0||value>100))throw new Error('Enter a valid segment, position from 0 to 1, finite radius and tension from 0 to 100.');params[name]=value;}return params;}
$('featherPoints').onchange=()=>{state.featherIndex=Number($('featherPoints').value);showFeatherFields(maskProperty('path')?.value.v);controls();};
$('addFeather').onsubmit=guard(async()=>{requireMaskEdit('path');const before=maskProperty('path').value.v.feather?.length??0;await exactMaskAction('mask.featherPoint.add',featherParams($('addFeather').elements));state.featherIndex=before;showMasks();controls();});
$('editFeather').onsubmit=guard(async()=>{requireMaskEdit('path');const params=featherParams($('editFeather').elements,true);if(Object.keys(params).length)await exactMaskAction('mask.featherPoint.set',{index:state.featherIndex,...params});});
$('removeFeather').onclick=guard(()=>exactMaskAction('mask.featherPoint.remove',{index:state.featherIndex}));


async function selectInspectorContext(value){
 clearKey();state.comp=value.comp===null?null:parseNative(value.comp);state.layer=value.layer===null?null:parseNative(value.layer);
 state.time=value.time;state.previewTick=value.tick;state.mask=value.mask===null?null:parseNative(value.mask);state.effect=value.effect===null?null:parseNative(value.effect);
 state.maskVertex=value.vertex;state.featherIndex=value.feather;show();await inspectorDrafts.idle();
 if(value.key){await chooseKey(value.key);await inspectorDrafts.idle();}
}
async function applyCollectedEdits(edits,current){
 let commands=[],tick;
 const flush=async()=>{if(!commands.length)return;await apply(commands,{previewTick:tick});current();commands=[];await inspectorDrafts.idle();current();};
 for(const edit of edits){
  if(edit.effectInfo){await flush();await saveFullEffectValues(edit.effectInfo,edit.changes);current();await inspectorDrafts.idle();current();continue;}
  if(commands.length&&(commands.length+edit.commands.length>32||new TextEncoder().encode(stringifyNative([...commands,...edit.commands])).length>65536))await flush();
  commands.push(...edit.commands);if(edit.previewTick!==undefined)tick=edit.previewTick;
 }
 await flush();
}
async function prepareDocumentHandoff(){
 document.activeElement?.blur?.();stopPlayback();
 const epoch=state.epoch,initialId=state.project?.id;
 await inspectorDrafts.idle();
 const current=()=>{if(state.epoch!==epoch||(initialId&&state.project?.id!==initialId))throw new Error('The open composition changed during the handoff. Ask again from the document you want to edit.');};current();
 if(!state.project)return{app:'motion-studio',screen:'surface',surface:'motion-workbench'};
 if(!state.permissions.read)throw new Error('Your access does not allow the concierge to read this composition.');
 const retained=inspectorContext(),entries=inspectorDrafts.entries(state.project.id);if(state.historical&&entries.length)throw new Error('This is a historical composition. Open its current revision before editing.');if(entries.some(entry=>entry.baseRevision!==state.project.revision))throw new Error('This composition has a newer saved revision. Your inspector drafts are kept; review the saved changes before choosing which to keep.');handoffBusy=true;controls();
 try{
  for(let index=0;index<entries.length;){
   const scope=JSON.stringify(entries[index].context),group=[];
   while(index<entries.length&&JSON.stringify(entries[index].context)===scope)group.push(entries[index++]);
   await selectInspectorContext(group[0].context);current();
   if(JSON.stringify(inspectorContext())!==scope)throw new Error('An edited native layer, keyframe or inspector selection is no longer available. Your field draft is kept.');
   for(const entry of group)inspectorDrafts.restore(entry);
   let edits;collectedEdits=[];
   try{for(const entry of group){const work=$(entry.formId).onsubmit?.handoffWork;if(!work)throw new Error('The native inspector cannot save this draft.');await work();current();}edits=collectedEdits;}
   finally{collectedEdits=null;}
   await applyCollectedEdits(edits,current);current();inspectorDrafts.forget(group);
  }
 }finally{
  collectedEdits=null;
  try{if(state.epoch===epoch&&state.project?.id===retained.projectId){await selectInspectorContext(retained);inspectorDrafts.restoreCurrent();}}
  finally{handoffBusy=false;controls();}
 }
 current();
 if(inspectorDrafts.has(state.project.id))throw new Error('The current composition field draft could not be saved.');
 return{app:'motion-studio',screen:'surface',surface:'motion-workbench',recordId:state.project.id,title:state.project.title,
  fields:{revision:state.project.revision,draft:false,readOnly:state.historical,compId:String(state.comp),...(state.layer==null?{}:{layerId:String(state.layer)}),compTimeTicks:currentTick()}};
}
async function refreshDocumentHandoff(expected){
 await inspectorDrafts.idle();
 const id=state.project?.id,epoch=state.epoch,revision=state.project?.revision;
 if(!id||state.historical||(expected?.recordId&&expected.recordId!==id)||!state.permissions.read)return;
 const {project}=await api('/projects/'+encodeURIComponent(id));
 if(state.epoch!==epoch||state.project?.id!==id||state.project.revision!==revision||project.revision<=revision)return;
 document.activeElement?.blur?.();
 if(inspectorDrafts.has(id))throw new Error('The concierge saved an update while you were editing. Your composition field draft is still here; review the saved revision before choosing which to keep.');
 stopPlayback();const retained=inspectorContext();state.project=project;state.historical=false;
 await selectInspectorContext(retained);await refresh();await preview();
}
try{
 const {registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');
 registerDocumentSession({app:'motion-studio',prepare:async()=>{try{return await prepareDocumentHandoff();}catch(error){problem(error);throw error;}},refresh:async expected=>{try{await refreshDocumentHandoff(expected);}catch(error){problem(error);throw error;}}});
}catch(error){problem(new Error('The concierge cannot synchronize this composition: '+error.message));}
