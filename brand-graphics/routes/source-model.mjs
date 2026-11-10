/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Return a fresh transient contract edit key without changing saved source or retry semantics.
 * CHANGE LOG: 1.4.0 | maintainer@emeraldcoastsystemsgroup.com | Comments (RP-BRG-06): a source keeps comment threads on the brief or on a scene, each with replies and a resolved flag, inside the person's own owner-scoped source revisions (no new table, route or permission). Typed operations add-comment, reply-comment, resolve-comment, remove-comment and replace-comments; at most 64 threads, 20 replies each, 1,000 characters a comment. A source saved before 1.4.0 has no comments field and validates as before; it gains an empty list on its next save.
 */
import {randomUUID} from 'node:crypto';
/** Owned typed brand source. Rendered evidence is never represented as editable scene layers. */
import {exact,uuid,integer,text,fail} from './vendor/source-project-store.mjs';
export const KIND='brand';
const MODES=['intro', 'graphic'];
function link(value){text(value,2000,{empty:true});if(value){try{const parsed=new URL(value,'https://source.invalid');if(!['http:','https:'].includes(parsed.protocol))throw Error();}catch{fail(400,'source_invalid_link');}}return value;}
function scene(value){exact(value,['id','title','text','duration']);return{id:uuid(value.id),title:text(value.title,120),text:text(value.text,2000,{empty:true}),duration:integer(value.duration,1,120)};}
/** Comment limits: threads per source, replies per thread, characters per comment. */
export const COMMENT_LIMITS=Object.freeze({threads:64,replies:20,text:1000});
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function instant(value){if(typeof value!=='string'||!INSTANT.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'source_invalid_time');return value;}
function commentText(value){const words=text(value,COMMENT_LIMITS.text);if(!words.trim())fail(400,'source_invalid_text');return words;}
function reply(value){exact(value,['id','text','at']);return{id:uuid(value.id),text:commentText(value.text),at:instant(value.at)};}
/** A thread is on the brief, or on one scene by its id (a thread on a scene that was later removed is kept and shown as such). */
function target(value){return value==='brief'?value:uuid(value);}
function comment(value){exact(value,['id','target','text','at'],['resolved','replies']);const replies=value.replies??[];if(!Array.isArray(replies)||replies.length>COMMENT_LIMITS.replies)fail(400,'source_comment_limit');if(value.resolved!==undefined&&typeof value.resolved!=='boolean')fail(400,'source_invalid_input');
 const out={id:uuid(value.id),target:target(value.target),text:commentText(value.text),at:instant(value.at),resolved:value.resolved===true,replies:replies.map(reply)};if(new Set(out.replies.map(v=>v.id)).size!==out.replies.length)fail(400,'source_duplicate_comment');return out;}
function comments(list){if(!Array.isArray(list)||list.length>COMMENT_LIMITS.threads)fail(400,'source_comment_limit');const out=list.map(comment);if(new Set(out.map(v=>v.id)).size!==out.length)fail(400,'source_duplicate_comment');return out;}
export function validate(model){exact(model,['version','kind','title','notes','sourceUrl','mode','scenes'],['comments']);if(model.version!==1||model.kind!==KIND||!MODES.includes(model.mode)||!Array.isArray(model.scenes)||model.scenes.length>32)fail(400,'source_invalid_model');const scenes=model.scenes.map(scene);if(new Set(scenes.map(v=>v.id)).size!==scenes.length)fail(400,'source_duplicate_scene');return{version:1,kind:KIND,title:text(model.title,120),notes:text(model.notes,2000,{empty:true}),sourceUrl:link(model.sourceUrl),mode:model.mode,scenes,comments:comments(model.comments??[])};}
function thread(next,id){const found=(next.comments??=[]).find(v=>v.id===uuid(id));if(!found)fail(404,'source_comment_missing');return found;}
export function apply(model,operations){if(!Array.isArray(operations)||!operations.length||operations.length>16)fail(400,'source_invalid_operations');const next=structuredClone(model);for(const op of operations){switch(op.op){
 case 'set-brief':exact(op,['op','values']);exact(op.values,[],['title','notes','sourceUrl','mode']);if(!Object.keys(op.values).length)fail(400,'source_empty_operation');Object.assign(next,op.values);break;
 case 'replace-scenes':exact(op,['op','scenes']);if(!Array.isArray(op.scenes)||op.scenes.length>32)fail(400,'source_invalid_model');next.scenes=op.scenes.map(scene);break;
 case 'add-scene':exact(op,['op','scene'],['after']);{const value=scene(op.scene);if(next.scenes.some(v=>v.id===value.id))fail(409,'source_duplicate_scene');const at=op.after===undefined?next.scenes.length:next.scenes.findIndex(v=>v.id===uuid(op.after))+1;if(op.after!==undefined&&at===0)fail(404,'source_scene_missing');next.scenes.splice(at,0,value);}break;
 case 'set-scene':exact(op,['op','id','values']);exact(op.values,[],['title','text','duration']);if(!Object.keys(op.values).length)fail(400,'source_empty_operation');{const target=next.scenes.find(v=>v.id===uuid(op.id));if(!target)fail(404,'source_scene_missing');Object.assign(target,op.values);}break;
 case 'remove-scene':exact(op,['op','id']);{const at=next.scenes.findIndex(v=>v.id===uuid(op.id));if(at<0)fail(404,'source_scene_missing');next.scenes.splice(at,1);}break;
 case 'move-scene':exact(op,['op','id','index']);{const at=next.scenes.findIndex(v=>v.id===uuid(op.id));if(at<0)fail(404,'source_scene_missing');const index=integer(op.index,0,next.scenes.length-1);next.scenes.splice(index,0,next.scenes.splice(at,1)[0]);}break;
 case 'add-comment':exact(op,['op','comment']);{const value=comment(op.comment);if((next.comments??=[]).some(v=>v.id===value.id))fail(409,'source_duplicate_comment');next.comments.push(value);}break;
 case 'reply-comment':exact(op,['op','id','reply']);{const found=thread(next,op.id),value=reply(op.reply);if(found.replies.some(v=>v.id===value.id))fail(409,'source_duplicate_comment');found.replies.push(value);}break;
 case 'resolve-comment':exact(op,['op','id','resolved']);if(typeof op.resolved!=='boolean')fail(400,'source_invalid_input');thread(next,op.id).resolved=op.resolved;break;
 case 'remove-comment':exact(op,['op','id']);thread(next,op.id);next.comments=next.comments.filter(v=>v.id!==uuid(op.id));break;
 case 'replace-comments':exact(op,['op','comments']);next.comments=comments(op.comments);break;
 default:fail(400,'source_unsupported_operation');
 }}return validate(next);}
export const CONTRACT={kind:KIND,version:1,
 wire:{discriminator:'op',closed:true,rule:'Each operations item is an object with op exactly as shown and only the listed fields. values is an object containing only changed fields, never an array. Do not use type or invent operation names.',request:{id:'actual source-read project UUID',baseRevision:'actual source-read revision',requestKey:'copy the top-level requestKey unchanged for this exact intent',operations:'1..16 operation objects'}},
 limits:{scenes:32,operations:16,title:120,notes:2000,sceneText:2000,duration:[1,120],comments:COMMENT_LIMITS.threads,replies:COMMENT_LIMITS.replies,commentText:COMMENT_LIMITS.text},operations:{
  'replace-scenes':{op:'replace-scenes',scenes:'complete ordered array of at most 32 typed scenes with stable IDs'},
  'set-brief':{op:'set-brief',values:{title:'optional text <=120 characters',notes:'optional text <=2000 characters',sourceUrl:'optional http(s) link or relative path <=2000 characters',mode:MODES}},
  'add-scene':{op:'add-scene',scene:{id:'new UUID v4',title:'text <=120 characters',text:'text <=2000 characters',duration:'integer seconds 1..120'},after:'optional existing scene UUID; omit to append'},
  'set-scene':{op:'set-scene',id:'existing scene UUID',values:{title:'optional text <=120 characters',text:'optional text <=2000 characters',duration:'optional integer seconds 1..120'}},
  'remove-scene':{op:'remove-scene',id:'existing scene UUID'},'move-scene':{op:'move-scene',id:'existing scene UUID',index:'zero-based index'},
  'add-comment':{op:'add-comment',comment:{id:'new UUID v4',target:'brief, or an existing scene UUID',text:'text <=1000 characters',at:'ISO 8601 UTC time'}},
  'reply-comment':{op:'reply-comment',id:'existing comment UUID',reply:{id:'new UUID v4',text:'text <=1000 characters',at:'ISO 8601 UTC time'}},
  'resolve-comment':{op:'resolve-comment',id:'existing comment UUID',resolved:'true or false'},
  'remove-comment':{op:'remove-comment',id:'existing comment UUID'},
  'replace-comments':{op:'replace-comments',comments:'complete array of at most 64 comment threads'}},
 examples:[{purpose:'Change only the existing selected scene text. Substitute its actual source-read ID for the illustrative ID.',operations:[{op:'set-scene',id:'33333333-3333-4333-8333-333333333333',values:{text:'Updated scene text'}}]},{purpose:'Change brief notes only.',operations:[{op:'set-brief',values:{notes:'Updated brief notes'}}]}],
 concurrency:'Read current project and use its revision as baseRevision. A conflict changes nothing. Restore appends a new immutable revision.',generation:'Source edits never spend provider credits or change existing generated outputs.'};

/** Fresh transient request identity; never stored in the source model. */
export function sourceContract(){return{...CONTRACT,requestKey:randomUUID(),requestKeyRule:"Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body."};}
