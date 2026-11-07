/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Anchored comment threads, tracked insertions and deletions, and offset maintenance across structured Office edits.
 */
import{fail,exact,text,integer,array,style,plain,clone,uid}from'./model.mjs';

export const COLLAB_LIMITS=Object.freeze({comments:200,replies:50,changes:500});

function targetRuns(model,pageId,targetId){
 const page=model.pages?.find(entry=>entry.id===pageId);
 if(!page)fail('office_invalid_model','Comment or change references a missing page.');
 const items=model.kind==='pptx'?page.objects:page.blocks;
 const item=items.find(entry=>entry.id===targetId);
 if(!item?.runs)fail('office_invalid_model','Comment or change must target editable text.');
 return item.runs;
}

function replyEntry(input,seen){
 exact(input,['id','author','createdAt','text']);
 if(typeof input.id!=='string'||!input.id||input.id.length>80||seen.has(input.id))fail('office_invalid_id','Comment replies need unique IDs.');
 seen.add(input.id);
 const author=text(input.author,120).trim(),createdAt=text(input.createdAt,64).trim(),body=text(input.text,4000).trim();
 if(!author||!createdAt||!body)fail('office_invalid_text','Comment replies require author, timestamp and text.');
 return{id:input.id,author,createdAt,text:body};
}

export function validateComments(model,input,seen){
 return array(input??[],COLLAB_LIMITS.comments).map(entry=>{
  exact(entry,['id','page','targetId','start','end','quote','author','createdAt','resolved','text','replies']);
  if(typeof entry.id!=='string'||!entry.id||entry.id.length>80||seen.has(entry.id))fail('office_invalid_id','Comments need unique IDs.');
  seen.add(entry.id);
  const runs=targetRuns(model,entry.page,entry.targetId),len=plain(runs).length;
  const start=integer(entry.start,0,len),end=integer(entry.end,start,len);
  const author=text(entry.author,120).trim(),createdAt=text(entry.createdAt,64).trim(),body=text(entry.text,4000).trim();
  if(!author||!createdAt||!body)fail('office_invalid_text','Comments require author, timestamp and text.');
  if(typeof entry.resolved!=='boolean')fail('office_invalid_model','Comment resolved state must be boolean.');
  const quote=text(entry.quote??plain(runs).slice(start,end),500);
  return{id:entry.id,page:entry.page,targetId:entry.targetId,start,end,quote,author,createdAt,resolved:entry.resolved,text:body,replies:array(entry.replies??[],COLLAB_LIMITS.replies).map(reply=>replyEntry(reply,seen))};
 });
}

export function validateChanges(model,input,seen){
 return array(input??[],COLLAB_LIMITS.changes).map(entry=>{
  exact(entry,['id','page','blockId','type','start','end','text','style','author','createdAt']);
  if(typeof entry.id!=='string'||!entry.id||entry.id.length>80||seen.has(entry.id))fail('office_invalid_id','Tracked changes need unique IDs.');
  seen.add(entry.id);
  if(entry.type!=='insert'&&entry.type!=='delete')fail('office_invalid_option','Tracked change type must be insert or delete.');
  const runs=targetRuns(model,entry.page,entry.blockId),content=plain(runs),len=content.length;
  const body=text(entry.text);
  if(!body.length)fail('office_invalid_text','Tracked changes require non-empty text.');
  const start=integer(entry.start,0,len),end=integer(entry.end,start,len);
  if(entry.type==='insert'&&(end-start!==body.length||content.slice(start,end)!==body))fail('office_invalid_model','Tracked insertion range must match block text.');
  if(entry.type==='delete'&&start!==end)fail('office_invalid_model','Tracked deletion uses a collapsed anchor offset.');
  const author=text(entry.author,120).trim(),createdAt=text(entry.createdAt,64).trim();
  if(!author||!createdAt)fail('office_invalid_text','Tracked changes require author and timestamp.');
  return{id:entry.id,page:entry.page,blockId:entry.blockId,type:entry.type,start,end,text:body,style:style(entry.style),author,createdAt};
 });
}

export function diffText(before,after){
 let start=0;
 const minLen=Math.min(before.length,after.length);
 while(start<minLen&&before[start]===after[start])start++;
 let oldEnd=before.length,newEnd=after.length;
 while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
 return{start,oldEnd,newEnd,removed:before.slice(start,oldEnd),inserted:after.slice(start,newEnd)};
}

function mapSpan(start,end,editStart,oldEnd,insertedLength){
 const delta=insertedLength-(oldEnd-editStart);
 if(start===end){
  const pos=start<editStart?start:start>oldEnd?start+delta:editStart+insertedLength;
  return[pos,pos];
 }
 if(editStart>=end)return[start,end];
 if(oldEnd<=start)return[start+delta,end+delta];
 const nextStart=start<editStart?start:editStart+insertedLength;
 const nextEnd=end>oldEnd?end+delta:editStart+insertedLength;
 return[nextStart,Math.max(nextStart,nextEnd)];
}

export function shiftAnchors(model,pageId,targetId,editStart,oldEnd,insertedLength,{skipChangeId=null}={}){
 if(Array.isArray(model.comments)){
  for(const comment of model.comments){
   if(comment.page!==pageId||comment.targetId!==targetId)continue;
   const[nextStart,nextEnd]=mapSpan(comment.start,comment.end,editStart,oldEnd,insertedLength);
   comment.start=nextStart;comment.end=nextEnd;
  }
 }
 if(Array.isArray(model.changes)){
  const kept=[];
  for(const change of model.changes){
   if(change.id===skipChangeId){kept.push(change);continue;}
   if(change.page!==pageId||change.blockId!==targetId){kept.push(change);continue;}
   const[nextStart,nextEnd]=mapSpan(change.start,change.end,editStart,oldEnd,insertedLength);
   if(change.type==='delete'){
    change.start=change.end=nextStart;
    kept.push(change);continue;
   }
   if(nextEnd<=nextStart)continue;
   const runs=targetRuns(model,pageId,targetId),slice=plain(runs).slice(nextStart,nextEnd);
   if(!slice.length)continue;
   change.start=nextStart;change.end=nextEnd;change.text=slice;
   kept.push(change);
  }
  model.changes=kept;
 }
}

export function prunePageAnchors(model,pageId){
 if(Array.isArray(model.comments))model.comments=model.comments.filter(entry=>entry.page!==pageId);
 if(Array.isArray(model.changes))model.changes=model.changes.filter(entry=>entry.page!==pageId);
}

export function pruneItemAnchors(model,pageId,itemId){
 if(Array.isArray(model.comments))model.comments=model.comments.filter(entry=>!(entry.page===pageId&&entry.targetId===itemId));
 if(Array.isArray(model.changes))model.changes=model.changes.filter(entry=>!(entry.page===pageId&&entry.blockId===itemId));
}

export function styleAt(values,offset){
 let cursor=0;
 for(const run of values){
  const next=cursor+run.text.length;
  if(offset<=next)return clone(run.style);
  cursor=next;
 }
 return clone(values.at(-1)?.style??style());
}

export function makeChangeId(prefix='chg'){return`${prefix}-${uid()}`;}
