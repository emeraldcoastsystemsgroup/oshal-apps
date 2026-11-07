/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Direct text editing preserves typed runs and native browser text selection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..04): render run highlight fills, comment range marks, tracked insertion/deletion spans and find-hit highlights while keeping transient markers invisible to readRuns and selection offset math.
 */
import{style,plain}from'./model.mjs';
export const PT=96/72;

function makeSpan(doc,runStyle,content){
 const span=doc.createElement('span');
 span.textContent=content;
 span.dataset.runStyle=JSON.stringify(runStyle);
 Object.assign(span.style,{
  fontFamily:runStyle.fontFamily,fontSize:runStyle.fontSize*PT+'px',
  fontWeight:runStyle.bold?'700':'400',fontStyle:runStyle.italic?'italic':'normal',
  textDecoration:runStyle.underline?'underline':'none',color:runStyle.color,
  backgroundColor:runStyle.highlight&&runStyle.highlight!=='transparent'?runStyle.highlight:''
 });
 return span;
}

function appendTransientAt(doc,nodes,pos,comments,changes){
 for(const change of changes)if(change.type==='delete'&&change.start===pos){
  const del=doc.createElement('del');del.className='office-change-del';del.contentEditable='false';
  del.dataset.officeTransient='true';del.dataset.changeId=change.id;del.title=`Deleted by ${change.author}`;
  del.textContent=change.text;nodes.push(del);
 }
 for(const comment of comments)if(!comment.resolved&&comment.start===comment.end&&comment.start===pos){
  const pin=doc.createElement('sup');pin.className='office-comment-pin';pin.contentEditable='false';
  pin.dataset.officeTransient='true';pin.dataset.commentId=comment.id;pin.title=`${comment.author}: ${comment.text}`;
  pin.textContent='💬';nodes.push(pin);
 }
}

export function paintRuns(element,values,decorations=null){
 const doc=element.ownerDocument,comments=decorations?.comments??[],changes=decorations?.changes??[],hits=decorations?.hits??[];
 element.style.textAlign=values[0]?.style.align??'left';
 if(!comments.length&&!changes.length&&!hits.length){
  element.replaceChildren(...values.map(run=>makeSpan(doc,run.style,run.text)));return;
 }
 const full=plain(values),cuts=new Set([0,full.length]);
 let cursor=0;for(const run of values){cursor+=run.text.length;cuts.add(cursor);}
 for(const item of [...comments,...changes,...hits]){
  if(Number.isInteger(item.start))cuts.add(Math.max(0,Math.min(full.length,item.start)));
  if(Number.isInteger(item.end))cuts.add(Math.max(0,Math.min(full.length,item.end)));
 }
 const points=[...cuts].sort((a,b)=>a-b),nodes=[];
 const styleFor=offset=>{let pos=0;for(const run of values){const end=pos+run.text.length;if(offset<end)return run.style;pos=end;}return values.at(-1)?.style??style();};
 if(!full.length){
  appendTransientAt(doc,nodes,0,comments,changes);
  nodes.push(makeSpan(doc,values[0]?.style??style(),''));
  element.replaceChildren(...nodes);return;
 }
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1];
  appendTransientAt(doc,nodes,a,comments,changes);
  if(b<=a)continue;
  const span=makeSpan(doc,styleFor(a),full.slice(a,b));
  const comment=comments.find(entry=>!entry.resolved&&entry.start<entry.end&&entry.start<=a&&entry.end>=b);
  if(comment){span.classList.add('office-comment-mark');span.dataset.commentId=comment.id;}
  const ins=changes.find(entry=>entry.type==='insert'&&entry.start<=a&&entry.end>=b);
  if(ins){span.classList.add('office-change-ins');span.dataset.changeId=ins.id;span.title=`Inserted by ${ins.author}`;}
  const hit=hits.find(entry=>entry.start<=a&&entry.end>=b);
  if(hit){const mark=doc.createElement('mark');mark.className='office-find-hit'+(hit.active?' office-find-active':'');mark.textContent=span.textContent;span.textContent='';span.append(mark);}
  nodes.push(span);
 }
 appendTransientAt(doc,nodes,full.length,comments,changes);
 element.replaceChildren(...nodes);
}

export function readRuns(element,fallback){
 const values=[];
 function walk(node,current){
  if(node.nodeType===3){if(node.nodeValue)values.push({text:node.nodeValue,style:style(current)});return;}
  if(node.nodeType!==1||node.dataset?.officeTransient==='true')return;
  let next=current;
  if(node.dataset.runStyle){try{next=style(JSON.parse(node.dataset.runStyle));}catch{next=current;}}
  if(['B','STRONG'].includes(node.tagName))next={...next,bold:true};
  if(['I','EM'].includes(node.tagName))next={...next,italic:true};
  if(node.tagName==='U')next={...next,underline:true};
  if(node.tagName==='BR'){values.push({text:'\n',style:style(next)});return;}
  for(const child of node.childNodes)walk(child,next);
 }
 for(const child of element.childNodes)walk(child,fallback);
 const compact=[];
 for(const run of values){
  const last=compact.at(-1);
  if(last&&JSON.stringify(last.style)===JSON.stringify(run.style))last.text+=run.text;
  else compact.push(run);
 }
 return compact.length?compact:[{text:'',style:style(fallback)}];
}

function offsetInElement(root,targetNode,targetOffset){
 let total=0,done=false;
 function walk(node){
  if(done)return;
  if(node===targetNode){
   if(node.nodeType===3){total+=Math.min(targetOffset,node.nodeValue.length);done=true;return;}
   for(let i=0;i<targetOffset&&i<node.childNodes.length;i++)walk(node.childNodes[i]);
   done=true;return;
  }
  if(node.nodeType===3){total+=node.nodeValue.length;return;}
  if(node.nodeType!==1||node.dataset?.officeTransient==='true')return;
  if(node.tagName==='BR'){total+=1;return;}
  for(const child of node.childNodes){walk(child);if(done)return;}
 }
 walk(root);
 return total;
}

export function textRange(element){
 const selection=element.ownerDocument.getSelection();
 if(!selection?.rangeCount||!element.contains(selection.anchorNode)||!element.contains(selection.focusNode))return null;
 const a=offsetInElement(element,selection.anchorNode,selection.anchorOffset);
 const b=offsetInElement(element,selection.focusNode,selection.focusOffset);
 return{start:Math.min(a,b),end:Math.max(a,b)};
}

function insertPlain(element,text){
 const selection=element.ownerDocument.getSelection();
 if(!selection?.rangeCount||!element.contains(selection.anchorNode))return;
 const range=selection.getRangeAt(0);range.deleteContents();
 const node=element.ownerDocument.createTextNode(text);
 range.insertNode(node);range.setStartAfter(node);range.collapse(true);
 selection.removeAllRanges();selection.addRange(range);
 element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
}

export function editableText(element,values,{enabled,decorations=null,onInput,onSelection,onFocus}){
 paintRuns(element,values,decorations);
 element.contentEditable=enabled?'true':'false';element.spellcheck=true;
 element.setAttribute('role','textbox');element.setAttribute('aria-multiline','true');
 element.addEventListener('focus',()=>onFocus?.());
 element.addEventListener('input',()=>onInput(readRuns(element,values[0]?.style)));
 const select=()=>{const range=textRange(element);if(range)onSelection?.(range);};
 element.addEventListener('mouseup',select);element.addEventListener('keyup',select);
 element.addEventListener('touchend',()=>setTimeout(select,0));
 element.addEventListener('beforeinput',event=>{if(['insertParagraph','insertLineBreak'].includes(event.inputType)){event.preventDefault();insertPlain(element,'\n');}});
 element.addEventListener('paste',event=>{event.preventDefault();insertPlain(element,event.clipboardData.getData('text/plain'));});
 element.addEventListener('drop',event=>event.preventDefault());
}
