/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Atomic structured Office edits shared by manual controls, persistence and approved assistant tools.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-02..03): anchored comment thread operations (`add-comment`, `reply-comment`, `resolve-comment`, `remove-comment`), tracked Word changes (`propose-change`, `accept-change`, `reject-change`, `accept-all-changes`, `reject-all-changes`) and automatic anchor maintenance across text/block/page edits.
 */
import{validate,clone,fail,exact,uid,paragraph,style,runs,plain,address,coordinates,LIMITS,integer,array}from'./model.mjs';
import{diffText,shiftAnchors,prunePageAnchors,pruneItemAnchors,styleAt}from'./collab.mjs';
const find=(items,id)=>{const value=items.find(value=>value.id===id);if(!value)fail('office_selection_changed','The selected item is unavailable.');return value;};

export function patchRuns(values,start,end,patch,replacement){
 const content=plain(values);
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>content.length)fail('office_invalid_range','Select a valid text range.');
 const output=[];let offset=0,inserted=false;
 for(const run of values){
  const from=offset,to=offset+run.text.length;offset=to;
  if(to<=start||from>=end){
   if(!inserted&&replacement!==undefined&&from>=end){output.push({text:replacement,style:style({...run.style,...patch})});inserted=true;}
   output.push(clone(run));continue;
  }
  if(from<start)output.push({...clone(run),text:run.text.slice(0,start-from)});
  const selected=run.text.slice(Math.max(0,start-from),Math.min(run.text.length,end-from));
  if(replacement===undefined)output.push({text:selected,style:style({...run.style,...patch})});
  else if(!inserted){output.push({text:replacement,style:style({...run.style,...patch})});inserted=true;}
  if(to>end)output.push({...clone(run),text:run.text.slice(end-from)});
 }
 if(replacement!==undefined&&!inserted)output.push({text:replacement,style:style({...values.at(-1)?.style,...patch})});
 const compact=[];
 for(const run of output){
  if(!run.text&&output.length>1)continue;
  const last=compact.at(-1);
  if(last&&JSON.stringify(last.style)===JSON.stringify(run.style))last.text+=run.text;
  else compact.push(run);
 }
 return runs(compact.length?compact:[{text:'',style:style(values[0]?.style)}]);
}

function target(model,operation){const page=find(model.pages,operation.page),items=model.kind==='pptx'?page.objects:page.blocks;return{page,items,item:operation.id?find(items,operation.id):null};}
const range=(model,operation)=>{const sheet=find(model.sheets,operation.sheet),a=coordinates(operation.from),b=coordinates(operation.to??operation.from);if(a.row>b.row||a.column>b.column||b.row>=sheet.rowCount||b.column>=sheet.columnCount||(b.row-a.row+1)*(b.column-a.column+1)>LIMITS.cells)fail('office_invalid_range','Choose a valid bounded cell range.');return{sheet,a,b};};

const OP_FIELDS=Object.freeze({
 'document':['patch'],'add-page':['after'],'remove-page':['id'],'move-page':['id','index'],'page':['id','patch'],
 'add-object':['page','object','index'],'add-block':['page','block','index'],
 'update-object':['page','id','patch'],'update-block':['page','id','patch'],
 'remove-object':['page','id'],'remove-block':['page','id'],
 'move-object':['page','id','index'],'move-block':['page','id','index'],
 'text-range':['page','id','start','end','style','text'],'table-cell':['page','id','from','value'],
 'cell':['sheet','from','to','value','style'],'format-range':['sheet','from','to','patch'],
 'clear-range':['sheet','from','to'],'paste-range':['sheet','from','rows'],
 'add-sheet':['name'],'move-sheet':['id','index'],'remove-sheet':['id'],'sheet':['id','patch'],
 'add-comment':['comment'],'reply-comment':['id','reply'],'resolve-comment':['id','resolved'],'remove-comment':['id'],
 'propose-change':['page','id','start','end','text','author','createdAt','changeId','deleteId'],
 'accept-change':['id'],'reject-change':['id'],'accept-all-changes':[],'reject-all-changes':[]
});

function rejectOneChange(model,changeId){
 const index=model.changes.findIndex(entry=>entry.id===changeId);
 if(index<0)fail('office_selection_changed','The tracked change is unavailable.');
 const change=model.changes[index];
 const{item}=target(model,{page:change.page,id:change.blockId});
 if(change.type==='insert'){
  item.runs=patchRuns(item.runs,change.start,change.end,{},'');
  model.changes.splice(index,1);
  shiftAnchors(model,change.page,change.blockId,change.start,change.end,0);
 }else{
  item.runs=patchRuns(item.runs,change.start,change.start,change.style,change.text);
  model.changes.splice(index,1);
  shiftAnchors(model,change.page,change.blockId,change.start,change.start,change.text.length);
 }
}

function applyCommentOp(model,op){
 if(model.kind==='xlsx')fail('office_invalid_edit','This operation does not apply to workbooks.');
 model.comments??=[];
 if(op.op==='add-comment'){
  const entry=clone(op.comment??{});
  entry.id??=uid();entry.createdAt??=new Date().toISOString();entry.resolved??=false;entry.replies??=[];
  const{item}=target(model,{page:entry.page,id:entry.targetId});
  if(!item.runs)fail('office_invalid_edit','Comments target editable text.');
  entry.quote??=plain(item.runs).slice(entry.start,entry.end);
  model.comments.push(entry);return;
 }
 if(op.op==='reply-comment'){
  const comment=find(model.comments,op.id),reply=clone(op.reply??{});
  reply.id??=uid();reply.createdAt??=new Date().toISOString();
  comment.replies.push(reply);return;
 }
 if(op.op==='resolve-comment'){
  const comment=find(model.comments,op.id);
  if(typeof op.resolved!=='boolean')fail('office_invalid_edit','Choose resolved true or false.');
  comment.resolved=op.resolved;return;
 }
 find(model.comments,op.id);
 model.comments=model.comments.filter(entry=>entry.id!==op.id);
}

function applyChangeOp(model,op){
 if(model.kind!=='docx')fail('office_invalid_edit','Tracked changes apply to Word documents.');
 model.changes??=[];
 if(op.op==='propose-change'){
  const{item}=target(model,op);
  if(!item.runs)fail('office_invalid_edit','Select editable text.');
  const before=plain(item.runs),start=integer(op.start,0,before.length),end=integer(op.end,start,before.length);
  const removed=before.slice(start,end),inserted=String(op.text??'');
  if(!removed&&!inserted)return;
  const baseStyle=styleAt(item.runs,start),prevAnchor=model.changes.at(-1)?.start;
  item.runs=patchRuns(item.runs,start,end,{},inserted);
  shiftAnchors(model,op.page,op.id,start,end,inserted.length);
  const author=String(op.author??'Reviewer').trim()||'Reviewer',createdAt=String(op.createdAt??new Date().toISOString());
  if(removed.length){
   const prev=model.changes.at(-1);
   if(!inserted.length&&!op.deleteId&&prev&&prev.page===op.page&&prev.blockId===op.id&&prev.type==='delete'&&prev.author===author&&(end===prevAnchor||start===prevAnchor))prev.text=end===prevAnchor?removed+prev.text:prev.text+removed;
   else model.changes.push({id:op.deleteId??uid(),page:op.page,blockId:op.id,type:'delete',start,end:start,text:removed,style:baseStyle,author,createdAt});
  }
  if(inserted.length){
   const prev=model.changes.at(-1);
   if(!removed.length&&!op.changeId&&prev&&prev.page===op.page&&prev.blockId===op.id&&prev.type==='insert'&&prev.author===author&&prev.end===start){prev.end+=inserted.length;prev.text+=inserted;}
   else model.changes.push({id:op.changeId??uid(),page:op.page,blockId:op.id,type:'insert',start,end:start+inserted.length,text:inserted,style:baseStyle,author,createdAt});
  }
  return;
 }
 if(op.op==='accept-change'){find(model.changes,op.id);model.changes=model.changes.filter(entry=>entry.id!==op.id);return;}
 if(op.op==='reject-change'){rejectOneChange(model,op.id);return;}
 if(op.op==='accept-all-changes'){model.changes=[];return;}
 if(op.op==='reject-all-changes'){const ids=model.changes.map(entry=>entry.id).reverse();for(const id of ids)rejectOneChange(model,id);}
}

function applyPageItem(model,op){
 const{items,item}=target(model,op);
 if(op.op.startsWith('add-')){exact(op.object??op.block,Object.keys(op.object??op.block??{}));items.splice(integer(op.index??items.length,0,items.length),0,clone(op.object??op.block));return;}
 if(op.op.startsWith('update-')){
  exact(op.patch,Object.keys(op.patch??{}));
  if('id'in op.patch||'type'in op.patch)fail('office_invalid_edit','Object identity and type cannot be overwritten.');
  const beforeText=item.runs?plain(item.runs):null;
  Object.assign(item,clone(op.patch));
  if(beforeText!==null&&item.runs){
   const afterText=plain(item.runs);
   if(afterText!==beforeText){const d=diffText(beforeText,afterText);shiftAnchors(model,op.page,op.id,d.start,d.oldEnd,d.inserted.length);}
  }
  return;
 }
 if(op.op.startsWith('remove-')){items.splice(items.indexOf(item),1);pruneItemAnchors(model,op.page,op.id);return;}
 if(op.op.startsWith('move-')){integer(op.index,0,items.length-1);items.splice(items.indexOf(item),1);items.splice(op.index,0,item);return;}
 if(op.op==='text-range'){
  if(!item.runs)fail('office_invalid_edit','Select editable text.');
  item.runs=patchRuns(item.runs,op.start,op.end,op.style??{},op.text);
  if(op.text!==undefined)shiftAnchors(model,op.page,op.id,op.start,op.end,op.text.length);
  return;
 }
 const at=coordinates(op.from);
 if(item.type!=='table'||!item.rows[at.row]?.[at.column])fail('office_invalid_edit','Select a table cell.');
 item.rows[at.row][at.column]=runs(op.value);
}

function apply(model,op){
 if(!op||!Object.hasOwn(OP_FIELDS,op.op))fail('office_invalid_edit','This editing operation is unsupported.');
 exact(op,['op',...OP_FIELDS[op.op]]);
 if(op.op.endsWith('-object')&&model.kind!=='pptx'||op.op.endsWith('-block')&&model.kind!=='docx'||(['cell','format-range','clear-range','paste-range','add-sheet','move-sheet','remove-sheet','sheet'].includes(op.op)&&model.kind!=='xlsx')||(['add-page','remove-page','move-page','page','text-range','table-cell'].includes(op.op)&&model.kind==='xlsx'))fail('office_invalid_edit','This operation does not apply to this document type.');
 if(['document','page','sheet','update-object','update-block','format-range'].includes(op.op))exact(op.patch,Object.keys(op.patch??{}));
 if(['add-comment','reply-comment','resolve-comment','remove-comment'].includes(op.op)){applyCommentOp(model,op);return;}
 if(['propose-change','accept-change','reject-change','accept-all-changes','reject-all-changes'].includes(op.op)){applyChangeOp(model,op);return;}
 if(op.op==='document'){exact(op.patch,['title','pageWidth','pageHeight','margins','header','footer']);Object.assign(model,clone(op.patch));return;}
 if(op.op==='add-page'){const at=op.after?model.pages.findIndex(page=>page.id===op.after)+1:model.pages.length;if(op.after&&at===0)fail('office_selection_changed','The page changed.');const page={id:uid(),name:model.kind==='pptx'?'New slide':'New page',background:'#ffffff',[model.kind==='pptx'?'objects':'blocks']:model.kind==='pptx'?[]:[paragraph('',{fontSize:12})]};model.pages.splice(at,0,page);return;}
 if(op.op==='remove-page'){find(model.pages,op.id);model.pages=model.pages.filter(page=>page.id!==op.id);prunePageAnchors(model,op.id);return;}
 if(op.op==='move-page'){const page=find(model.pages,op.id);integer(op.index,0,model.pages.length-1);model.pages.splice(model.pages.indexOf(page),1);model.pages.splice(op.index,0,page);return;}
 if(op.op==='page'){const page=find(model.pages,op.id);exact(op.patch,model.kind==='pptx'?['name','background']:['name']);Object.assign(page,clone(op.patch));return;}
 if(['add-object','add-block','update-object','update-block','remove-object','remove-block','move-object','move-block','text-range','table-cell'].includes(op.op)){applyPageItem(model,op);return;}
 if(op.op==='add-sheet'){model.sheets.push({id:uid(),name:op.name,cells:{},rowCount:30,columnCount:12});return;}
 if(op.op==='move-sheet'){const sheet=find(model.sheets,op.id);integer(op.index,0,model.sheets.length-1);model.sheets.splice(model.sheets.indexOf(sheet),1);model.sheets.splice(op.index,0,sheet);return;}
 if(op.op==='remove-sheet'){find(model.sheets,op.id);model.sheets=model.sheets.filter(sheet=>sheet.id!==op.id);return;}
 if(op.op==='sheet'){const sheet=find(model.sheets,op.id);exact(op.patch,['name','rowCount','columnCount','columnWidths','rowHeights','frozenRows','frozenColumns']);Object.assign(sheet,clone(op.patch));return;}
 if(['cell','format-range','clear-range','paste-range'].includes(op.op)){
  const{sheet,a,b}=range(model,op);
  if(op.op==='paste-range'){array(op.rows,LIMITS.rows,1);let count=0;for(const row of op.rows){array(row,LIMITS.columns,1);count+=row.length;}if(count>LIMITS.cells)fail('office_invalid_range','Paste exceeds the supported cell limit.');for(let r=0;r<op.rows.length;r++)for(let c=0;c<op.rows[r].length;c++){const key=address(a.row+r,a.column+c);if(a.row+r>=sheet.rowCount||a.column+c>=sheet.columnCount)fail('office_invalid_range','Paste exceeds sheet bounds.');sheet.cells[key]={value:op.rows[r][c],style:sheet.cells[key]?.style??{}};}return;}
  for(let r=a.row;r<=b.row;r++)for(let c=a.column;c<=b.column;c++){const key=address(r,c),cell=sheet.cells[key]??{value:'',style:{}};if(op.op==='clear-range'){delete sheet.cells[key];continue;}if(op.op==='cell')sheet.cells[key]={value:op.value,style:op.style??cell.style};else sheet.cells[key]={...cell,style:{...cell.style,...op.patch}};}return;
 }
 fail('office_invalid_edit','This editing operation is unsupported.');
}

export function applyOperations(source,operations){const model=validate(source);if(!Array.isArray(operations)||!operations.length||operations.length>LIMITS.operations)fail('office_operation_limit','Use 1–64 editing operations.');for(const operation of operations)apply(model,operation);return validate(model);}
export function newObject(type,index=0){const base={id:uid(),type,x:60+index*12,y:80+index*12,width:300,height:120,rotation:0,fill:type==='text'?'transparent':'#3b82f6',stroke:'#172033',strokeWidth:type==='text'?0:1,opacity:1,shadow:null};if(type==='text')base.runs=[{text:'Edit this text',style:style({fontSize:24})}];if(type==='table')base.rows=Array.from({length:3},(_,row)=>Array.from({length:3},(_,column)=>[{text:row===0?'Column '+(column+1):'',style:style({fontSize:14,bold:row===0})}]));return base;}
export function history(initial,{limit=50,bytes=33554432}={}){let entries=[JSON.stringify(validate(initial))],index=0;const read=()=>JSON.parse(entries[index]);return{current:read,canUndo:()=>index>0,canRedo:()=>index<entries.length-1,commit(value){const next=JSON.stringify(validate(value));if(next===entries[index])return read();entries=entries.slice(0,index+1);entries.push(next);while(entries.length>1&&(entries.length>limit||entries.reduce((sum,row)=>sum+row.length,0)>bytes))entries.shift();index=entries.length-1;return read();},undo(){index=Math.max(0,index-1);return read();},redo(){index=Math.min(entries.length-1,index+1);return read();},reset(value){entries=[JSON.stringify(validate(value))];index=0;return read();}};}
