/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Adapt real timeline clips and editable titles to the common document editor without replacing the owned model or history.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Phones (Roger, trial.oswarm.ai, 2026-11-06, F4: "doesn't have an upload vid to edit"): an empty project's one primary action is Add a clip (the real #addClip picker), with Add music as a text link; the first pane is named Media; Open a saved project, New, Undo, Redo and the Project menu move into More, so the app bar is the title, Save, Export and More.
 */
import * as timeline from './timeline-model.mjs';
import {applyMultitrack} from './multitrack-model.mjs';
const number=(key,label,value,min,max,group='Timing')=>({key,label,value,type:'number',min,max,step:1,group,unit:group==='Timing'?'frames':'%'});
const choice=(key,label,value,values)=>({key,label,value,type:'select',options:values.map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),group:'Text'});
export function videoProperties(document,selection){
 if(!selection)return[];
 if(['titles','captions'].includes(selection.kind)){
  const text=document[selection.kind]?.find(item=>item.id===selection.id);if(!text)return[];
  return [{key:'text',label:'Text',type:'textarea',value:text.text,group:'Text'},number('start','Start',text.start,0,1799),number('end','End',text.end,1,1800),choice('position','Position',text.position,['top','center','bottom']),choice('size','Size',text.size,['small','medium','large'])];
 }
 if(document.version===1){const clip=document.segments.find(item=>item.id===selection.id);if(!clip)return[];return[number('in','Source in',clip.in,0,document.sources[clip.source].frames-1),number('out','Source out',clip.out,1,document.sources[clip.source].frames),number('volume','Volume',clip.volume,0,200,'Audio')];}
 const track=document.tracks.find(track=>track.clips.some(clip=>clip.id===selection.id)),clip=track?.clips.find(item=>item.id===selection.id);if(!clip)return[];
 const fields=[number('start','Timeline start',clip.start,0,1799),number('in','Source in',clip.in,0,document.sources[clip.source].frames-1),number('out','Source out',clip.out,1,document.sources[clip.source].frames),number('volume','Volume',clip.volume,0,200,'Audio'),number('fadeIn','Fade in',clip.fadeIn,0,1800),number('fadeOut','Fade out',clip.fadeOut,0,1800)];
 if(track.kind==='video')fields.push(number('x','X',clip.x,-100,100,'Geometry'),number('y','Y',clip.y,-100,100,'Geometry'),number('scale','Scale',clip.scale,10,200,'Geometry'),number('opacity','Opacity',clip.opacity,0,100,'Appearance'),number('brightness','Brightness',clip.brightness,-100,100,'Appearance'),number('contrast','Contrast',clip.contrast,0,300,'Appearance'),number('saturation','Saturation',clip.saturation,0,300,'Appearance'));
 return fields.map(field=>({...field,disabled:track.locked}));
}
export function editVideoProperty(document,selection,key,value){
 const field=videoProperties(document,selection).find(field=>field.key===key);if(!field||field.disabled)throw new Error('Select an editable clip or title.');
 if(['titles','captions'].includes(selection.kind))return document.version===1?timeline.updateTitle(document,selection.id,{[key]:value}):applyMultitrack(document,{type:'updateText',track:selection.kind,id:selection.id,patch:{[key]:value}});
 if(document.version===2)return applyMultitrack(document,{type:'clip',id:selection.id,patch:{[key]:value}});
 const own=document.segments.find(item=>item.id===selection.id);return key==='volume'?timeline.setSegmentVolume(document,own.id,value):timeline.trimSegment(document,own.id,{in:own.in,out:own.out,[key]:value});
}
function disclosure(label,...contents){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=label;details.append(summary,...contents);return details;}
export async function bindVideoFoundation(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js'),$=id=>document.getElementById(id);
 const root=document.body,main=document.querySelector('main.workspace'),media=main.querySelector('.media'),preview=main.querySelector('.preview'),legacy=main.querySelector('.inspector'),advanced=main.querySelector('.multitrack'),output=main.querySelector('.export');
 const inspector=document.createElement('div'),track=document.createElement('div');inspector.className='video-extra-tools';track.className='video-timeline';
 inspector.append(disclosure('Add titles and music',legacy),disclosure('Track, keyframe and caption tools',advanced),disclosure('Export and render',output));
 main.append(inspector);track.append(main.querySelector('.timeline'),$('multiTracks'),$('multiTextList'));main.append(track);
 const projectMenu=disclosure('Project',$('saveAsNew'),$('deleteProject'));document.querySelector('header.bar .actions').append(projectMenu);
 // The same render operation is available in the header while output details remain grouped.
 const exportMenu=disclosure('Export',$('exportMp4'),$('renderPreview'),$('cancelExport'),$('downloadExport'));document.querySelector('header.bar .actions').append(exportMenu);
 const feedback=document.createElement('div');feedback.className='video-export-status';feedback.append($('exportHint'),$('exportProgress'),$('exportStatus'),$('watchExport'));document.querySelector('.status-strip').append(feedback);output.parentElement.remove();
 const currentSelection=()=>{const selection=adapter.selection();return{kind:selection?.kind??'video',ids:selection?[selection.id]:[]};};
 const contextMatches=context=>context.documentId===(adapter.state.projectId??'draft:'+adapter.state.draftEpoch)&&context.revision===adapter.state.revision&&JSON.stringify(context.selection)===JSON.stringify(currentSelection());
 let foundation;
 const getState=()=>({documentId:adapter.state.projectId??'draft:'+adapter.state.draftEpoch,revision:adapter.state.revision,title:adapter.doc().name,dirty:adapter.dirty(),busy:adapter.state.busy,readOnly:!adapter.editable(),canUndo:adapter.state.history.canUndo(),canRedo:adapter.state.history.canRedo(),error:$('error').hidden?null:$('error').textContent});
 const {createRegisteredEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const assistant=await createRegisteredEditorAssistant({app:'video',bot:'video-editor',title:'Video AI partner',root,getState:()=>{const value=getState();return{...value,dirty:value.dirty||foundation?.hasPending()};},getSelection:currentSelection});
 for(const id of ['projectList','newProject','undo','redo'])$(id).dataset.efPhone='more';projectMenu.dataset.efPhone='more';
 const start={when:()=>!Object.keys(adapter.doc().sources||{}).length,lede:'Up to two 30-second MP4 clips and one music file.',label:'Add a clip',input:$('addClip'),denied:'This seat can watch projects but not add media.',
  secondary:[{label:'Add music',run:()=>$('addBed').click()}]};
 foundation=createEditorFoundation({root,navigationLabel:'Media',start,ai:assistant.element,header:document.querySelector('header.bar'),navigation:media,viewport:preview,inspector,timeline:track,status:document.querySelector('.status-strip'),
  getState,getSelection:currentSelection,getProperties:()=>videoProperties(adapter.doc(),adapter.selection()),
  applyProperty:(key,value,context)=>{if(!contextMatches(context))throw new Error('The selected timeline object changed. Select it again.');if(!adapter.apply(current=>editVideoProperty(current,adapter.selection(),key,value)))throw new Error($('error').textContent||'This timeline edit was refused.');},actions:{save:adapter.save,undo:adapter.undo,redo:adapter.redo}});
 main.hidden=true;root.classList.add('video-foundation');
 const selectText=(kind,id)=>{adapter.selectText(kind,id);foundation.refresh();assistant.refresh();foundation.showPanel('properties');};
 for(const host of [$('titleTrack'),$('titles'),$('multiTextList')])host.addEventListener('click',event=>{const node=event.target.closest('[data-select-text]');if(node)selectText(node.dataset.textKind??'titles',node.dataset.selectText);});
 $('titleOverlay').tabIndex=0;$('titleOverlay').setAttribute('role','button');$('titleOverlay').setAttribute('aria-label','Select title on preview');
 $('titleOverlay').addEventListener('click',()=>{const title=adapter.doc().titles.find(item=>adapter.frame()>=item.start&&adapter.frame()<item.end);if(title)selectText('titles',title.id);});
 $('titleOverlay').addEventListener('dblclick',()=>{if(!adapter.editable()||adapter.doc().version!==1)return;const title=adapter.doc().titles.find(item=>adapter.frame()>=item.start&&adapter.frame()<item.end);if(!title)return;selectText('titles',title.id);const original=title.text,epoch=adapter.state.draftEpoch;$('titleOverlay').contentEditable='plaintext-only';$('titleOverlay').focus();const finish=()=>{$('titleOverlay').contentEditable='false';const text=$('titleOverlay').textContent;if(text!==original&&adapter.state.draftEpoch===epoch&&adapter.editable())adapter.apply(current=>timeline.updateTitle(current,title.id,{text}));};$('titleOverlay').addEventListener('blur',finish,{once:true});});
 const refresh=()=>{$('multiTracks').hidden=adapter.doc().version!==2;$('multiTextList').hidden=adapter.doc().version!==2;foundation.refresh();assistant.refresh();};
 return{...foundation,destroy:()=>{assistant.destroy();foundation.destroy();},refresh};
}
