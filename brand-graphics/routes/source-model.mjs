/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Return a fresh transient contract edit key without changing saved source or retry semantics. */
import {randomUUID} from 'node:crypto';
/** Owned typed brand source. Rendered evidence is never represented as editable scene layers. */
import {exact,uuid,integer,text,fail} from './vendor/source-project-store.mjs';
export const KIND='brand';
const MODES=['intro', 'graphic'];
function link(value){text(value,2000,{empty:true});if(value){try{const parsed=new URL(value,'https://source.invalid');if(!['http:','https:'].includes(parsed.protocol))throw Error();}catch{fail(400,'source_invalid_link');}}return value;}
function scene(value){exact(value,['id','title','text','duration']);return{id:uuid(value.id),title:text(value.title,120),text:text(value.text,2000,{empty:true}),duration:integer(value.duration,1,120)};}
export function validate(model){exact(model,['version','kind','title','notes','sourceUrl','mode','scenes']);if(model.version!==1||model.kind!==KIND||!MODES.includes(model.mode)||!Array.isArray(model.scenes)||model.scenes.length>32)fail(400,'source_invalid_model');const scenes=model.scenes.map(scene);if(new Set(scenes.map(v=>v.id)).size!==scenes.length)fail(400,'source_duplicate_scene');return{version:1,kind:KIND,title:text(model.title,120),notes:text(model.notes,2000,{empty:true}),sourceUrl:link(model.sourceUrl),mode:model.mode,scenes};}
export function apply(model,operations){if(!Array.isArray(operations)||!operations.length||operations.length>16)fail(400,'source_invalid_operations');const next=structuredClone(model);for(const op of operations){switch(op.op){
 case 'set-brief':exact(op,['op','values']);exact(op.values,[],['title','notes','sourceUrl','mode']);if(!Object.keys(op.values).length)fail(400,'source_empty_operation');Object.assign(next,op.values);break;
 case 'replace-scenes':exact(op,['op','scenes']);if(!Array.isArray(op.scenes)||op.scenes.length>32)fail(400,'source_invalid_model');next.scenes=op.scenes.map(scene);break;
 case 'add-scene':exact(op,['op','scene'],['after']);{const value=scene(op.scene);if(next.scenes.some(v=>v.id===value.id))fail(409,'source_duplicate_scene');const at=op.after===undefined?next.scenes.length:next.scenes.findIndex(v=>v.id===uuid(op.after))+1;if(op.after!==undefined&&at===0)fail(404,'source_scene_missing');next.scenes.splice(at,0,value);}break;
 case 'set-scene':exact(op,['op','id','values']);exact(op.values,[],['title','text','duration']);if(!Object.keys(op.values).length)fail(400,'source_empty_operation');{const target=next.scenes.find(v=>v.id===uuid(op.id));if(!target)fail(404,'source_scene_missing');Object.assign(target,op.values);}break;
 case 'remove-scene':exact(op,['op','id']);{const at=next.scenes.findIndex(v=>v.id===uuid(op.id));if(at<0)fail(404,'source_scene_missing');next.scenes.splice(at,1);}break;
 case 'move-scene':exact(op,['op','id','index']);{const at=next.scenes.findIndex(v=>v.id===uuid(op.id));if(at<0)fail(404,'source_scene_missing');const index=integer(op.index,0,next.scenes.length-1);next.scenes.splice(index,0,next.scenes.splice(at,1)[0]);}break;
 default:fail(400,'source_unsupported_operation');
 }}return validate(next);}
export const CONTRACT={kind:KIND,version:1,
 wire:{discriminator:'op',closed:true,rule:'Each operations item is an object with op exactly as shown and only the listed fields. values is an object containing only changed fields, never an array. Do not use type or invent operation names.',request:{id:'actual source-read project UUID',baseRevision:'actual source-read revision',requestKey:'copy the top-level requestKey unchanged for this exact intent',operations:'1..16 operation objects'}},
 limits:{scenes:32,operations:16,title:120,notes:2000,sceneText:2000,duration:[1,120]},operations:{
  'replace-scenes':{op:'replace-scenes',scenes:'complete ordered array of at most 32 typed scenes with stable IDs'},
  'set-brief':{op:'set-brief',values:{title:'optional text <=120 characters',notes:'optional text <=2000 characters',sourceUrl:'optional http(s) link or relative path <=2000 characters',mode:MODES}},
  'add-scene':{op:'add-scene',scene:{id:'new UUID v4',title:'text <=120 characters',text:'text <=2000 characters',duration:'integer seconds 1..120'},after:'optional existing scene UUID; omit to append'},
  'set-scene':{op:'set-scene',id:'existing scene UUID',values:{title:'optional text <=120 characters',text:'optional text <=2000 characters',duration:'optional integer seconds 1..120'}},
  'remove-scene':{op:'remove-scene',id:'existing scene UUID'},'move-scene':{op:'move-scene',id:'existing scene UUID',index:'zero-based index'}},
 examples:[{purpose:'Change only the existing selected scene text. Substitute its actual source-read ID for the illustrative ID.',operations:[{op:'set-scene',id:'33333333-3333-4333-8333-333333333333',values:{text:'Updated scene text'}}]},{purpose:'Change brief notes only.',operations:[{op:'set-brief',values:{notes:'Updated brief notes'}}]}],
 concurrency:'Read current project and use its revision as baseRevision. A conflict changes nothing. Restore appends a new immutable revision.',generation:'Source edits never spend provider credits or change existing generated outputs.'};

/** Fresh transient request identity; never stored in the source model. */
export function sourceContract(){return{...CONTRACT,requestKey:randomUUID(),requestKeyRule:"Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body."};}
