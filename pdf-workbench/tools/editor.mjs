/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Select real PDF objects, edit typed properties and manipulate page content in the shared editor.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Phones (Roger, trial.oswarm.ai, 2026-11-06, F5): the empty state's one primary action is Upload a PDF (pick, upload, create and open in one step), with Blank page and Your documents as text links; the first pane is named Documents; Export, Undo and Redo move into More; Insert and the Document menu open as sheets from the shared shell; and the Document menu shows only what this seat can do now (Cancel job only while a job runs and the seat may manage it, Delete history only with delete).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.2.4 (the trial check, 2026-11-06): the Document menu and Download PDF also wait in More on a phone, so the app bar is one row (title, Save, More).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0, the oshal design standard (docs/ux/design-standard.md §3, §4.3, §4.4, §4.10, §5.1; Acrobat and PDFgear, REFP CONVENTIONS §5.2). With no PDFs the editor opens on one blank Letter page with the text tool active: a tap types, and the first edit makes it an untitled PDF. With PDFs it opens on their thumbnails, newest first, with one New at the bottom right (Blank page, Upload a PDF). One app row: the document name opens the document menu, Search, Undo and Redo as icons, Save only while there is something to save, one primary (Add text on a blank page, then Export) and More. Editing is by mode (Annotate, Edit, Sign, Pages, Concierge), each mode one strip of tools with Done at the top left; Highlight and Note are placed on the page by a drag or a tap. Every menu and sheet is a modal top-layer dialog the phone's Back closes. The functions both references have and oshal does not yet are greyed "Not available yet" controls in their places (RP-PDF-01..10, RP-ALL-01), built by the shared planned-control helper.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0: wire live RP-PDF-01..10 and RP-ALL-01 controls — QuadPoints word markup (highlight, underline, strikethrough), single-finger ink pen and eraser, saved caller signatures, check/cross form marks, blank page insertion, PDF from photos, file size reduction, Office conversions (.docx, .xlsx, .pptx), single/two-page views, night mode and suggested concierge prompts.
 */
import {contentObjects,PDF_FONTS,validateContentProperties,pdfErrorMessage,textCapabilities} from './content-model.mjs';
import {MARKUP_COLORS,selectWordsForDrag,buildQuadMarkup,createWordSelector,startInkDraw,startEraserPass,placeMarkObject,syncResizeHandle,createViewController} from './editor-tools.mjs';
import {openSignatureSheet,openPhotosSheet,openCompressSheet,openConvertSheet} from './editor-sheets.mjs';

const el=(tag,attributes={})=>Object.assign(document.createElement(tag),attributes);
const SUGGESTED_PROMPTS=['Summarize this PDF','Ask about this page'];
const rectProperties=(rect,box)=>['x','y','width','height'].map((key,index)=>({key,label:['X','Y','Width','Height'][index],type:'number',unit:'pt',step:.1,value:Number((index<2?rect[index]:rect[index]-rect[index-2]).toFixed(3)),min:index<2?box[index]:.1,max:index%2===0?box[2]:box[3],group:'Position and size'}));

export function rotatedPoint(x,y,box,rotation){
 const u=(x-box[0])/(box[2]-box[0]),v=(y-box[1])/(box[3]-box[1]);
 return rotation===90?[v,u]:rotation===180?[1-u,v]:rotation===270?[1-v,1-u]:[u,1-v];
}
export function dragDelta(dx,dy,box,rotation){
 const w=box[2]-box[0],h=box[3]-box[1];
 return rotation===90?[dy*w,dx*h]:rotation===180?[-dx*w,dy*h]:rotation===270?[-dy*w,-dx*h]:[dx*w,-dy*h];
}
export function screenToPdf(u,v,box,rotation){
 const w=box[2]-box[0],h=box[3]-box[1],[a,b]=rotation===90?[v,u]:rotation===180?[1-u,v]:rotation===270?[1-v,1-u]:[u,1-v];
 return[box[0]+a*w,box[1]+b*h];
}
export function pdfLine(text){return String(text||'').replace(/\s+/g,' ').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'').trim().slice(0,4000);}

function screenRect(rect,box,rotation){
 const points=[[rect[0],rect[1]],[rect[0],rect[3]],[rect[2],rect[1]],[rect[2],rect[3]]].map(([x,y])=>rotatedPoint(x,y,box,rotation));
 return[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}

function remapAnnotationGeometry(item,nextRect){
 const old=item.rect,ow=Math.max(0.001,old[2]-old[0]),oh=Math.max(0.001,old[3]-old[1]),nw=nextRect[2]-nextRect[0],nh=nextRect[3]-nextRect[1];
 const mx=x=>Number((nextRect[0]+(x-old[0])/ow*nw).toFixed(3)),my=y=>Number((nextRect[1]+(y-old[1])/oh*nh).toFixed(3));
 const out={rect:nextRect};
 if(item.kind==='ink'&&Array.isArray(item.points))out.points=item.points.map(([x,y])=>[mx(x),my(y)]);
 if(Array.isArray(item.quadPoints))out.quadPoints=item.quadPoints.map(q=>q.map((v,i)=>i%2===0?mx(v):my(v)));
 return out;
}

function buildInspectorProperties(selected,pageInfoFn,isEditable){
 if(!selected?.item)return[];
 const {page,item}=selected,box=pageInfoFn(page).box;if(!box||!item.rect)return[];
 const fields=rectProperties(item.rect,box);
 if(item.annotation){
  fields.push({key:'color',label:'Color',type:'color',value:'#'+(item.color??'ffcc00'),group:'Appearance'});
  if(item.kind==='ink')fields.push({key:'strokeWidth',label:'Line weight',type:'number',value:item.strokeWidth??2,min:.5,max:24,unit:'pt',step:.5,group:'Appearance'});
  if(item.kind==='text')fields.push({key:'text',label:'Note text',type:'textarea',value:item.text,group:'Text'});
 }else{
  if(item.kind==='text'){
   const cap=textCapabilities(item);
   fields.push({key:'text',label:'Text',type:'text',value:item.text,group:'Text',disabled:!cap.text},
    {key:'font',label:'Font',type:'select',value:item.fontExplicit||!item.original?(item.font??'Helvetica'):'',options:[...(!item.fontExplicit&&item.original?[{value:'',label:'Keep original ('+item.font+')'}]:[]),...PDF_FONTS.map(v=>({value:v,label:v}))],group:'Text',disabled:!cap.font},
    {key:'fontSize',label:'Font size',type:'number',value:item.fontSize,min:1,max:256,unit:'pt',step:.5,group:'Text',disabled:!cap.size});
   if(!cap.text)fields.push({key:'text-edit-reason',label:'Text editing',type:'text',value:cap.reason,group:'Text',disabled:true});
  }
  for(const[key,label]of [['fill','Fill color'],['stroke','Line color']])if(item[key]!==undefined)fields.push({key,label,type:'color',value:'#'+item[key],group:'Appearance'});
  if(item.strokeWidth!==undefined)fields.push({key:'strokeWidth',label:'Line weight',type:'number',value:item.strokeWidth,min:0,max:40,unit:'pt',step:.25,group:'Appearance'});
  if(item.opacity!==undefined&&['text','path','rectangle','ellipse','image'].includes(item.kind))fields.push({key:'opacity',label:'Opacity',type:'number',value:Math.round(item.opacity*100),min:0,max:100,unit:'%',group:'Appearance'});
 }
 return fields.map(field=>({...field,disabled:field.disabled||!isEditable||!item.editable}));
}

function buildPropertyOperation(selected,key,value,pageInfoFn,isEditable){
 const {page,item}=selected??{};if(!item||!isEditable||!item.editable)throw new Error('Select an editable object in the latest PDF revision.');
 let props;
 if(['x','y','width','height'].includes(key)){
  const rect=[...item.rect],width=rect[2]-rect[0],height=rect[3]-rect[1];
  if(key==='x'){rect[0]=value;rect[2]=value+width;}else if(key==='y'){rect[1]=value;rect[3]=value+height;}else rect[key==='width'?2:3]=rect[key==='width'?0:1]+value;
  props={rect};
 }else props={[key]:key==='opacity'?value/100:['fill','stroke','color'].includes(key)?value.slice(1).toLowerCase():value};
 if(item.annotation){
  if(props.rect){validateContentProperties({rect:props.rect},'path',pageInfoFn(page).box);props=remapAnnotationGeometry(item,props.rect);}
  if(props.text!==undefined&&(!props.text.length||props.text.length>2000||!/^[\x20-\x7e\n]+$/.test(props.text)))throw new Error('PDF notes accept up to 2,000 Latin characters.');
  return{op:'update-annotation',id:item.id,properties:props};
 }
 validateContentProperties(props,item.kind,pageInfoFn(page).box,undefined,item);
 return{op:'update-object',page:page.id,object:item.id,properties:props};
}

function mountSuggestedPrompts(assistant){
 const existing=[...assistant.element.querySelectorAll('button')].some(b=>b.textContent.trim()===SUGGESTED_PROMPTS[0]);
 if(existing)return;
 const bar=el('div',{className:'pdf-prompts'}),input=assistant.element.querySelector('textarea'),form=assistant.element.querySelector('form');
 for(const label of SUGGESTED_PROMPTS){
  const chip=el('button',{type:'button',className:'pdf-chip',textContent:label});
  chip.onclick=()=>{if(!input||!form||input.disabled)return;input.value=label;form.requestSubmit();};
  bar.append(chip);
 }
 assistant.element.querySelector('.ef-assistant-composer')?.before(bar);
}

function bindImageInput(imageInput,ctx){
 imageInput.onchange=async()=>{
  const file=imageInput.files[0];imageInput.value='';if(!file)return;
  try{
   ctx.requireNoDraft();const page=ctx.selectedPage(),s=ctx.snapshot(),docId=s.saved.id,rev=s.saved.revision,draft=JSON.stringify(s.ops),sel=JSON.stringify(ctx.getSelection());
   if(file.size>4194304)throw new Error('Choose an image smaller than 4 MB.');
   const bitmap=await createImageBitmap(file);
   try{
    if(bitmap.width*bitmap.height>16777216)throw new Error('Choose an image with at most 16 million pixels.');
    let payload=file;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>1048576){
     const canvas=el('canvas',{width:bitmap.width,height:bitmap.height}),c2d=canvas.getContext('2d');c2d.drawImage(bitmap,0,0);
     const px=c2d.getImageData(0,0,canvas.width,canvas.height).data;let transparent=false;for(let i=3;i<px.length;i+=4)if(px[i]<255){transparent=true;break;}
     payload=await new Promise(r=>canvas.toBlob(r,transparent?'image/png':'image/jpeg',.9));
    }
    if(!payload||payload.size>1048576)throw new Error('The prepared image is too large; choose a smaller image.');
    const form=new FormData();form.append('file',payload,file.name);form.append('title',file.name.slice(0,160)||'Image');form.append('requestKey',crypto.randomUUID());
    const asset=await ctx.adapter.uploadImage(form),cur=ctx.snapshot();
    if(cur.saved.id===docId&&cur.saved.revision===rev&&JSON.stringify(cur.ops)===draft&&JSON.stringify(ctx.getSelection())===sel&&cur.model?.pages.some(p=>p.id===page.id))ctx.insertAsset(asset,page);
    else throw new Error('The document changed while the image uploaded. The saved image is available in your image library.');
   }finally{bitmap.close();}
  }catch(error){ctx.feedback(error);}
 };
}

function renderObjectOverlay(ctx,item,page,stage,info){
 if(!item.rect||item.rect[0]>=item.rect[2]||item.rect[1]>=item.rect[3])return;
 const rect=screenRect(item.rect,info.box,info.rotation),node=[...stage.querySelectorAll('[data-pdf-object]')].find(n=>n.dataset.pdfObject===item.id)??el('button',{type:'button',className:'pdf-object'});
 node.title=item.kind==='text'?item.text:item.annotation?item.kind+' annotation':item.kind;
 node.dataset.pdfObject=item.id;node.dataset.pdfPage=page.id;
 node.setAttribute('aria-label',item.kind==='text'?'Text: '+item.text.slice(0,100):item.annotation?item.kind+' annotation':item.kind+' object');
 Object.assign(node.style,{left:rect[0]*100+'%',top:rect[1]*100+'%',width:(rect[2]-rect[0])*100+'%',height:(rect[3]-rect[1])*100+'%'});
 node.onclick=ctx.act(()=>ctx.choose(page.id,item.id));
 node.ondblclick=ctx.act(()=>ctx.startInline(item,page,stage,node));
 node.onkeydown=event=>handleObjectKeydown(ctx,event,item,page,stage,node,info);
 node.onpointerdown=event=>handleObjectDrag(ctx,event,item,page,stage,node,info);
 const sel=ctx.getSelection();
 syncResizeHandle(node,{item,page,stage,info,selected:sel?.id===item.id&&sel?.page===page.id,editable:ctx.editable(),screenRect,screenToPdf,onResize:op=>ctx.adapter.edit(op),feedback:ctx.feedback});
 if(node.parentElement!==stage)stage.append(node);
}

function handleObjectKeydown(ctx,event,item,page,stage,node,info){
 if(event.key==='F2'){event.preventDefault();ctx.act(()=>ctx.startInline(item,page,stage,node))();return;}
 if(['Delete','Backspace'].includes(event.key)&&ctx.editable()){event.preventDefault();ctx.act(()=>{ctx.choose(page.id,item.id);ctx.removeSelected.click();})();return;}
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&ctx.editable()){
  event.preventDefault();
  try{
   ctx.choose(page.id,item.id);const step=event.shiftKey?10:1,w=info.box[2]-info.box[0],h=info.box[3]-info.box[1];
   const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
   const delta=dragDelta(dx/(info.rotation%180?h:w),dy/(info.rotation%180?w:h),info.box,info.rotation),rect=item.rect.map((v,i)=>v+delta[i%2]);
   validateContentProperties({rect},'path',info.box);
   ctx.adapter.edit(item.annotation?{op:'update-annotation',id:item.id,properties:remapAnnotationGeometry(item,rect)}:{op:'update-object',page:page.id,object:item.id,properties:{rect}});
  }catch(error){ctx.feedback(error);}
 }
}

function handleObjectDrag(ctx,event,item,page,stage,node,info){
 if(event.button!==0||!ctx.editable()||!item.editable||event.target.closest('.pdf-resize-handle'))return;
 try{ctx.choose(page.id,item.id);}catch(error){ctx.feedback(error);return;}
 const start=[event.clientX,event.clientY],bounds=stage.getBoundingClientRect();let moved=false,delta=[0,0];
 ctx.setActiveDrag(true);node.setPointerCapture(event.pointerId);
 const move=e=>{if(e.pointerId!==event.pointerId)return;const px=[e.clientX-start[0],e.clientY-start[1]];if(!moved&&Math.abs(px[0])+Math.abs(px[1])>3){moved=true;ctx.assistant.refresh();}delta=dragDelta(px[0]/bounds.width,px[1]/bounds.height,info.box,info.rotation);node.style.transform=`translate(${px[0]}px,${px[1]}px)`;};
 const finish=e=>{if(e.pointerId!==event.pointerId)return;ctx.setActiveDrag(false);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',cancel);node.style.transform='';if(moved){try{const rect=item.rect.map((n,i)=>n+delta[i%2]);validateContentProperties({rect},'path',info.box);ctx.adapter.edit(item.annotation?{op:'update-annotation',id:item.id,properties:remapAnnotationGeometry(item,rect)}:{op:'update-object',page:page.id,object:item.id,properties:{rect}});}catch(error){ctx.feedback(error);}}};
 const cancel=e=>{moved=false;finish(e);};node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',cancel);
}

function updateObjectTree(ctx){
 const {saved,model}=ctx.snapshot(),{tree,treeItems}=ctx;tree.hidden=!saved;
 if(!saved){treeItems.replaceChildren();ctx.setTreeTopology(null);return;}
 const rows=model.pages.map(page=>({page,items:[...ctx.objects(page),...model.annotations.filter(a=>a.page===page.id).map(a=>({...a,annotation:true}))]}));
 const topology=JSON.stringify([saved.id,rows.map(r=>[r.page.id,r.items.map(i=>i.id)])]);
 if(topology!==ctx.getTreeTopology()){
  const expanded=new Set([...treeItems.querySelectorAll('details[open]')].map(n=>n.dataset.treePage));treeItems.replaceChildren();
  for(const[ordinal,row]of rows.entries()){
   const group=el('details'),summary=el('summary',{textContent:'Page '+(ordinal+1)}),list=el('div',{className:'pdf-object-list'});group.dataset.treePage=row.page.id;group.open=expanded.has(row.page.id)||ctx.getSelection()?.page===row.page.id||!ordinal;
   summary.onclick=()=>{try{ctx.requireNoDraft();ctx.setSelection({page:row.page.id,id:null});ctx.decorateSelection();ctx.foundation.refresh();ctx.assistant.refresh();}catch(error){ctx.feedback(error);}};
   for(const item of row.items){const button=el('button',{type:'button'});button.dataset.treeObject=item.id;button.dataset.treeOwner=row.page.id;button.onclick=ctx.act(()=>{ctx.choose(row.page.id,item.id);const obj=[...document.querySelectorAll('[data-pdf-object]')].find(n=>n.dataset.pdfObject===item.id&&n.dataset.pdfPage===row.page.id);obj?.scrollIntoView({block:'center',inline:'nearest'});obj?.focus({preventScroll:true});if(innerWidth<800)ctx.foundation.showPanel('properties');});list.append(button);}
   group.append(summary,list);treeItems.append(group);
  }
  ctx.setTreeTopology(topology);
 }
 const buttons=new Map([...treeItems.querySelectorAll('[data-tree-object]')].map(n=>[n.dataset.treeOwner+'/'+n.dataset.treeObject,n]));
 const sel=ctx.getSelection();
 for(const row of rows)for(const item of row.items){const b=buttons.get(row.page.id+'/'+item.id);if(b){b.textContent=item.annotation?(item.kind==='text'?'Note: '+item.text.slice(0,80):item.kind+' annotation'):item.kind==='text'?item.text.slice(0,80):({path:'Shape',image:'Image',group:'Group',rectangle:'Rectangle',ellipse:'Ellipse',check:'Check mark',cross:'Cross mark'}[item.kind]??item.kind);b.setAttribute('aria-pressed',String(sel?.id===item.id&&sel?.page===row.page.id));}}
}

function handleMarkupOrNoteGesture(ctx,event,page,stage,info){
 event.preventDefault();const bounds=stage.getBoundingClientRect(),at=e=>[Math.min(Math.max((e.clientX-bounds.left)/bounds.width,0),1),Math.min(Math.max((e.clientY-bounds.top)/bounds.height,0),1)],start=at(event);
 stage.setPointerCapture?.(event.pointerId);
 const finish=end=>{
  stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',cancel);
  void(async()=>{
   try{
    const tool=ctx.getActiveTool(),tapped=Math.abs(end[0]-start[0])+Math.abs(end[1]-start[1])<.02,id=crypto.randomUUID(),color=ctx.getToolColor();
    if(tool==='check'||tool==='cross'){const op=placeMarkObject(end[0],end[1],{page,info,kind:tool,size:ctx.getMarkSize(),color:'111827',screenToPdf});ctx.adapter.edit(op);ctx.choose(page.id,op.item.id);return;}
    if(tool==='note'){
     const pts=[start,[Math.min(start[0]+.05,1),Math.min(start[1]+.04,1)]].map(([u,v])=>screenToPdf(u,v,info.box,info.rotation));
     const rect=[Math.min(pts[0][0],pts[1][0]),Math.min(pts[0][1],pts[1][1]),Math.max(pts[0][0],pts[1][0]),Math.max(pts[0][1],pts[1][1])];
     ctx.adapter.edit({op:'annotate',annotation:{id,page:page.id,kind:'text',rect,color,text:'Note'}});ctx.choose(page.id,id);if(!ctx.wide())ctx.openFormat();return;
    }
    const words=await ctx.wordSelector.getWords(ctx.snapshot().saved,page.id),p0=screenToPdf(start[0],start[1],info.box,info.rotation),p1=screenToPdf(end[0],end[1],info.box,info.rotation);
    const chosen=words.length?selectWordsForDrag(words,p0,tapped?p0:p1):[],built=chosen.length?buildQuadMarkup(chosen,info.box):null;
    if(built){ctx.adapter.edit({op:'annotate',annotation:{id,page:page.id,kind:tool,rect:built.rect,quadPoints:built.quadPoints,color}});ctx.choose(page.id,id);return;}
    const corners=tapped?[start,[Math.min(start[0]+.3,1),Math.min(start[1]+.035,1)]]:[start,end],pts=corners.map(([u,v])=>screenToPdf(u,v,info.box,info.rotation));
    const rect=[Math.min(pts[0][0],pts[1][0]),Math.min(pts[0][1],pts[1][1]),Math.max(pts[0][0],pts[1][0]),Math.max(pts[0][1],pts[1][1])].map(n=>Number(n.toFixed(3)));
    if(rect[2]-rect[0]<2||rect[3]-rect[1]<2)throw new Error('Drag across the text to mark it up.');
    const quadPoints=[[rect[0],rect[3],rect[2],rect[3],rect[0],rect[1],rect[2],rect[1]]];
    ctx.adapter.edit({op:'annotate',annotation:{id,page:page.id,kind:tool,rect,quadPoints,color}});ctx.choose(page.id,id);
   }catch(error){ctx.feedback(error);}
  })();
 };
 const up=e=>finish(at(e)),cancel=()=>{stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',cancel);};
 stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',cancel);
}

function handleIdleStageGesture(ctx,event,page,stage,info){
 if(!event.target.closest('.pdf-word-bar,.pdf-word-handle'))ctx.wordSelector.clear();
 const bounds=stage.getBoundingClientRect(),sx=event.clientX,sy=event.clientY;
 const u=Math.min(Math.max((sx-bounds.left)/bounds.width,0),1),v=Math.min(Math.max((sy-bounds.top)/bounds.height,0),1);
 let longPressed=false;
 const timer=ctx.editable()?setTimeout(()=>{longPressed=true;void ctx.wordSelector.selectAt(ctx.snapshot().saved,page,stage,info,u,v);},320):0;
 const move=e=>{if(e.pointerId===event.pointerId&&Math.hypot(e.clientX-sx,e.clientY-sy)>6)clearTimeout(timer);};
 const finish=e=>{
  if(e.pointerId!==event.pointerId)return;clearTimeout(timer);
  stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',finish);stage.removeEventListener('pointercancel',abort);
  if(longPressed){ctx.suppressNextClick();return;}
  if(ctx.viewCtrl.getPrefs().pageLayout!=='single')return;
  const dx=e.clientX-sx,dy=e.clientY-sy,total=ctx.snapshot().model?.pages.length??0;
  if(total>1&&Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.5){ctx.suppressNextClick();ctx.viewCtrl.turn(dx<0?1:-1);}
  else if(total>1&&Math.hypot(dx,dy)<10&&(u<=0.12||u>=0.88)){ctx.suppressNextClick();ctx.viewCtrl.turn(u<=0.12?-1:1);}
 };
 const abort=e=>{if(e.pointerId===event.pointerId){clearTimeout(timer);stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',finish);stage.removeEventListener('pointercancel',abort);}};
 stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',finish);stage.addEventListener('pointercancel',abort);
}

async function openPagesSheet(ctx){
 await ctx.ensureDocument();if(!ctx.snapshot().saved)return;
 const layer=ctx.layers.create('Pages','ds-sheet ds-full'),tools=el('div',{className:'pdf-page-tools'}),pages=el('div',{className:'pdf-page-grid'});
 const ownTools=['rotate','remove','extract','split','sources','merge'].map(id=>document.getElementById(id));
 for(const[ordinal,card]of [...document.querySelectorAll('#pages>.page')].entries()){
  const tile=el('div',{className:'pdf-page-tile'}),check=card.querySelector('label input'),label=el('label'),proxy=el('input',{type:'checkbox',checked:check.checked}),img=el('img',{alt:'Page '+(ordinal+1),src:card.querySelector('img').currentSrc||card.querySelector('img').src}),moves=el('div',{className:'pdf-page-moves'});
  proxy.onchange=()=>{check.checked=proxy.checked;check.dispatchEvent(new Event('change'));};label.append(proxy,document.createTextNode(' Page '+(ordinal+1)));
  for(const[index,name]of ['Earlier','Later'].entries()){const srcBtn=card.querySelectorAll('.row button')[index],button=el('button',{type:'button',className:'pdf-tool',textContent:name,disabled:srcBtn?.disabled});button.setAttribute('aria-label','Move page '+(ordinal+1)+' '+name.toLowerCase());button.onclick=async()=>{srcBtn?.click();await ctx.layers.close(layer.dialog);void openPagesSheet(ctx);};moves.append(button);}
  tile.append(img,label,moves);pages.append(tile);
 }
 const insertAt=before=>{
  const s=ctx.snapshot(),chosen=ctx.adapter.selected(),indices=s.model.pages.map((p,i)=>chosen.includes(p.id)?i:-1).filter(i=>i>=0);
  const pos=before?(indices.length?indices[0]:0):(indices.length?indices.at(-1)+1:s.model.pages.length);
  ctx.adapter.edit({op:'insert-blank',position:pos});
 };
 const addAfter=el('button',{type:'button',className:'pdf-tool',textContent:'Add blank page',disabled:!ctx.editable()});
 addAfter.onclick=ctx.act(async()=>{insertAt(false);await ctx.layers.close(layer.dialog);void openPagesSheet(ctx);});
 const addBefore=el('button',{type:'button',className:'pdf-tool',textContent:'Add blank before',disabled:!ctx.editable()});
 addBefore.onclick=ctx.act(async()=>{insertAt(true);await ctx.layers.close(layer.dialog);void openPagesSheet(ctx);});
 tools.append(addAfter,addBefore);
 layer.body.append(tools,pages);await ctx.layers.open(layer,{nodes:ownTools,into:tools,before:tools.firstChild});
}

function buildModeStrips(ctx){
 const colorIn=el('input',{type:'color',className:'pdf-strip-color',value:'#ffcc00'}),widthIn=el('input',{type:'range',className:'pdf-strip-range',min:'1',max:'12',step:'0.5',value:'2.5'}),sizeIn=el('input',{type:'range',className:'pdf-strip-range',min:'12',max:'48',step:'2',value:'20'});
 colorIn.setAttribute('aria-label','Markup color');widthIn.setAttribute('aria-label','Pen width');sizeIn.setAttribute('aria-label','Mark size');
 ctx.getToolColor=()=>colorIn.value.slice(1).toLowerCase();ctx.getPenWidth=()=>Number(widthIn.value)||2.5;ctx.getMarkSize=()=>Number(sizeIn.value)||20;
 const toggleTool=id=>{
  if(['highlight','underline','strikethrough'].includes(id)&&ctx.wordSelector.hasSelection()){
   const c=colorIn.value.slice(1).toLowerCase();if(ctx.wordSelector.applySelected(id,c))return;
  }
  const next=ctx.getActiveTool()===id?null:id;ctx.setActiveTool(next);
  if(next&&MARKUP_COLORS[next])colorIn.value='#'+MARKUP_COLORS[next];
  for(const node of ctx.strip.querySelectorAll('[data-pdf-pick]'))node.setAttribute('aria-pressed',String(node.dataset.pdfPick===next));
 };
 const toolBtn=(label,glyph,run,{toggle}={})=>{const b=el('button',{type:'button',className:'pdf-tool'});b.append(el('span',{className:'pdf-glyph',textContent:glyph}),el('span',{className:'pdf-word',textContent:label}));b.firstChild.setAttribute('aria-hidden','true');if(toggle)b.setAttribute('aria-pressed','false');b.onclick=ctx.act(run);return b;};
 const pick=(label,glyph,id)=>{const b=toolBtn(label,glyph,()=>toggleTool(id),{toggle:true});b.dataset.pdfPick=id;return b;};
 const moreBtn=items=>{const b=toolBtn('More','⋯',()=>ctx.openMenu('More tools',items,b));return b;};
 const format=toolBtn('Format','≡',()=>ctx.openFormat());format.classList.add('pdf-phone-only');
 return()=>({
  annotate:[pick('Highlight','▬','highlight'),pick('Underline','U̲','underline'),pick('Strikethrough','S̶','strikethrough'),pick('Note','✉','note'),pick('Pen','✐','pen'),pick('Eraser','⌫','eraser'),colorIn,widthIn,format,moreBtn([{label:'Annotation by coordinates…',run:()=>ctx.openSheet('Annotation',[ctx.sections.Annotation])}])],
  edit:[ctx.insertMenu,format,ctx.removeSelected,moreBtn([{label:'Saved images…',run:()=>ctx.openSheet('Images',[ctx.assetsSection])},{label:'Form fields…',run:()=>ctx.openSheet('Form fields',[ctx.sections['Form fields']])}])],
  sign:[toolBtn('Text','T',()=>ctx.insertMenu.querySelector('[data-pdf-tool="text"]').click()),pick('Check','✓','check'),pick('Cross','✕','cross'),sizeIn,toolBtn('Signature','✍',()=>openSignatureSheet({layers:ctx.layers,adapter:ctx.adapter,canPlace:()=>ctx.editable(),onPlaceAsset:asset=>ctx.insertAsset(asset),feedback:ctx.feedback})),toolBtn('Fields','☐',()=>ctx.openSheet('Form fields',[ctx.sections['Form fields']])),moreBtn([{label:'Form fields…',run:()=>ctx.openSheet('Form fields',[ctx.sections['Form fields']])}])]
 });
}

function wireMenus(ctx,{newButton,docButton,more,quickFile,assetsSection}){
 const newMenu=anchor=>ctx.openMenu('New',[
  {label:'Blank page',run:()=>{ctx.setBlankRequested(true);ctx.paintView();ctx.syncButtons();}},
  {label:'Upload a PDF…',run:()=>quickFile.click(),disabled:!ctx.snapshot().permissions.create},
  {label:'From photos…',run:()=>openPhotosSheet({layers:ctx.layers,adapter:ctx.adapter,feedback:ctx.feedback}),disabled:!ctx.snapshot().permissions.create}
 ],anchor);
 newButton.onclick=()=>newMenu(newButton);
 docButton.onclick=()=>{const s=ctx.snapshot(),dirty=Boolean(s.ops.length||ctx.adapter.formDraft().length);ctx.openMenu('Document',[
  {label:'New blank page',run:()=>{if(s.saved&&dirty)throw new Error('Save or undo the draft first.');ctx.adapter.close();ctx.setBlankRequested(true);ctx.paintView();ctx.syncButtons();}},
  {label:'Upload a PDF…',run:()=>quickFile.click(),disabled:!s.permissions.create},
  {label:'From photos…',run:()=>openPhotosSheet({layers:ctx.layers,adapter:ctx.adapter,feedback:ctx.feedback}),disabled:!s.permissions.create},'-',
  {label:'Open…',run:()=>ctx.openDocuments()},
  {label:'Originals and images…',run:()=>ctx.openSheet('Originals and images',[ctx.sections['Original sources'],assetsSection])},
  {label:'Saved history…',run:()=>ctx.openSheet('Saved history',[ctx.sections['Saved history']]),disabled:!s.saved},'-',
  {label:'Save revision',run:()=>ctx.adapter.save(),disabled:!s.saved||!dirty||!s.permissions.change},
  {label:'Export PDF',run:()=>ctx.adapter.export(),disabled:!s.saved||!s.permissions.export}],docButton);};
 more.onclick=()=>{const s=ctx.snapshot(),prefs=ctx.viewCtrl.getPrefs();ctx.openMenu('More',[
  {label:'Search…',run:()=>ctx.openSheet('Search',[ctx.sections['Find and OCR']]),disabled:!s.saved},'-',
  {label:'Continuous pages',pressed:prefs.pageLayout==='continuous',run:()=>ctx.viewCtrl.setLayout('continuous')},
  {label:'Single page',pressed:prefs.pageLayout==='single',run:()=>ctx.viewCtrl.setLayout('single')},
  {label:'Two pages',pressed:prefs.pageLayout==='two-page',run:()=>ctx.viewCtrl.setLayout('two-page')},
  {label:'Night mode',pressed:prefs.nightMode,run:()=>ctx.viewCtrl.toggleNight()},'-',
  {label:'Reduce file size…',disabled:!ctx.editable(),run:()=>openCompressSheet({layers:ctx.layers,adapter:ctx.adapter,feedback:ctx.feedback})},
  {label:'Convert to Word (.docx)…',disabled:!s.saved||!s.permissions.export,run:()=>openConvertSheet({layers:ctx.layers,adapter:ctx.adapter,initialFormat:'docx',feedback:ctx.feedback})},
  {label:'Convert to Excel (.xlsx)…',disabled:!s.saved||!s.permissions.export,run:()=>openConvertSheet({layers:ctx.layers,adapter:ctx.adapter,initialFormat:'xlsx',feedback:ctx.feedback})},
  {label:'Convert to PowerPoint (.pptx)…',disabled:!s.saved||!s.permissions.export,run:()=>openConvertSheet({layers:ctx.layers,adapter:ctx.adapter,initialFormat:'pptx',feedback:ctx.feedback})},'-',
  {label:'Help',run:()=>ctx.openSheet('Help',[document.getElementById('pdf-help')])},
  ...(s.job&&s.permissions['job.manage']?[{label:'Cancel job',run:()=>document.getElementById('cancel-job').click()}]:[]),
  ...(s.saved&&s.permissions.delete?[{label:'Delete history',danger:true,run:()=>document.getElementById('delete-document').click()}]:[])],more);};
}

function setupShellChrome(ctx,main,center,right,left){
 const layers=createLayers(document),bar=main.querySelector('.wb-bar')??document.querySelector('.wb-bar'),actions=document.getElementById('actions'),docButton=document.getElementById('doc-menu'),hold=el('div',{hidden:true});
 main.append(hold);for(const id of ['cancel-job','delete-document','download'])hold.append(document.getElementById(id));
 const icon=(label,glyph)=>{const b=el('button',{type:'button',className:'pdf-icon',textContent:glyph});b.setAttribute('aria-label',label);b.title=label;return b;};
 const undo=document.getElementById('undo'),redo=document.getElementById('redo'),save=document.getElementById('save');
 undo.textContent='↶';undo.className='pdf-icon';undo.setAttribute('aria-label','Undo');undo.title='Undo';redo.textContent='↷';redo.className='pdf-icon';redo.setAttribute('aria-label','Redo');redo.title='Redo';
 save.className='pdf-save';save.textContent='Save';
 const search=icon('Search','⌕'),more=icon('More','⋯'),primary=el('button',{type:'button',className:'primary pdf-primary'}),done=el('button',{type:'button',className:'pdf-done',textContent:'Done',hidden:true});
 more.setAttribute('aria-haspopup','dialog');search.classList.add('pdf-search');search.onclick=ctx.act(()=>ctx.openSheet('Search',[ctx.sections['Find and OCR']]));
 actions.replaceChildren(search,undo,redo,save,primary,more);bar.querySelector('.wb-doc').before(done);
 const modebar=el('nav',{className:'pdf-modebar'}),modes=el('div',{className:'pdf-modes'}),strip=el('div',{className:'pdf-strip',hidden:true});modebar.setAttribute('aria-label','Editing modes');strip.dataset.dsToolrow='';
 const modeButtons={};
 for(const[id,label,glyph]of [['annotate','Annotate','✎'],['edit','Edit','T'],['sign','Sign','✍'],['pages','Pages','▦'],['concierge','Concierge','✦']]){
  const b=el('button',{type:'button',className:'pdf-mode'});b.dataset.mode=id;b.append(el('span',{className:'pdf-glyph',textContent:glyph}),el('span',{className:'pdf-word',textContent:label}));b.firstChild.setAttribute('aria-hidden','true');b.onclick=ctx.act(()=>ctx.chooseMode(id));modes.append(b);modeButtons[id]=b;
 }
 modebar.append(modes,strip);bar.querySelector('.wb-doc').after(modebar);
 const home=el('section',{className:'pdf-home',hidden:true}),grid=el('div',{className:'pdf-home-grid'}),newButton=el('button',{type:'button',className:'primary pdf-new',textContent:'New'});
 home.setAttribute('aria-label','Your PDFs');newButton.dataset.efFloating='';newButton.setAttribute('aria-haspopup','dialog');home.append(grid,newButton);
 const blank=el('section',{className:'pdf-blank',hidden:true}),paper=el('div',{className:'pdf-paper'});paper.setAttribute('aria-label','Blank Letter page; tap to type');blank.append(paper);
 center.prepend(home,blank);
 const sections=Object.fromEntries([...right.querySelectorAll(':scope > .pane-section'),...left.querySelectorAll(':scope > .pane-section')].map(s=>[s.querySelector('h3')?.textContent,s]));
 for(const[id,label]of [['rotate','Rotate'],['remove','Delete'],['extract','Keep selected'],['split','Copy'],['merge','Append']]){const n=document.getElementById(id);n.textContent=label;n.classList.add('pdf-tool');}
 document.getElementById('remove').setAttribute('aria-label','Delete selected pages');
 return{layers,undo,redo,save,search,more,primary,done,docButton,modebar,modes,strip,modeButtons,home,grid,newButton,blank,paper,sections};
}

function wireBlankPageTyping(ctx,paper){
 let local=null,commitTimer=0;
 async function commitLocal(){
  clearTimeout(commitTimer);const current=local;if(!current||current.busy)return;const text=pdfLine(current.box.textContent);
  if(!text){current.box.remove();local=null;ctx.paintView();ctx.syncButtons();return;}
  current.busy=true;
  try{
   await ctx.ensureDocument();const page=ctx.snapshot().model.pages[0],{box,rotation}=ctx.pageInfo(page),size=16,line=size*1.4;
   let [x,top]=screenToPdf(current.fx,current.fy,box,rotation);
   x=Math.min(Math.max(x,box[0]+4),box[2]-48);top=Math.min(Math.max(top,box[1]+line+4),box[3]-4);
   const rect=[x,top-line,Math.min(box[2]-4,x+Math.max(40,text.length*size*.56+8)),top],id=crypto.randomUUID();
   ctx.setSelection({page:page.id,id});ctx.adapter.edit({op:'add-object',page:page.id,item:{id,kind:'text',rect,text,font:'Helvetica',fontSize:size,fill:'111827'}});
  }catch(error){ctx.feedback(error);}
  finally{current.box.remove();if(local===current)local=null;ctx.paintView();ctx.syncButtons();}
 }
 function startLocal(fx,fy){
  if(local){local.box.focus();return;}
  if(!ctx.snapshot().permissions.create){ctx.feedback(new Error('Your access does not allow adding a PDF.'));return;}
  const box=el('div',{className:'pdf-local-text'});box.contentEditable='plaintext-only';box.setAttribute('role','textbox');box.setAttribute('aria-label','Text on the page');
  box.style.left=Math.min(fx,.8)*100+'%';box.style.top=Math.min(fy,.95)*100+'%';local={box,fx:Math.min(fx,.8),fy:Math.max(Math.min(fy,.95),.03)};paper.append(box);box.focus();
  box.addEventListener('input',()=>{clearTimeout(commitTimer);commitTimer=setTimeout(()=>void commitLocal(),1500);});
  box.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void commitLocal();}if(e.key==='Escape'){box.textContent='';void commitLocal();}});
  box.addEventListener('blur',()=>void commitLocal());ctx.syncButtons();
 }
 paper.addEventListener('click',event=>{if(event.target!==paper)return;const r=paper.getBoundingClientRect();startLocal((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height);});
 return{startLocal,hasLocal:()=>Boolean(local)};
}

async function runNativePreviews(ctx,epoch){
 const {saved,model,ops,job,starting}=ctx.snapshot();if(!saved||!ops.length||job||starting)return;
 for(const page of model.pages){
  if(epoch!==ctx.getPreviewEpoch())return;
  const key=ctx.previewKey(page);if(!ctx.pageOperations(page).length||ctx.previews.get(page.id)?.key===key)continue;
  try{
   const result=await ctx.adapter.post(`/documents/${saved.id}/draft-preview`,{baseRevision:saved.revision,operations:structuredClone(ops),page:page.id});
   while(ctx.isActiveDrag()&&epoch===ctx.getPreviewEpoch())await new Promise(r=>setTimeout(r,50));
   if(epoch!==ctx.getPreviewEpoch())return;ctx.previews.set(page.id,{key,url:'data:image/png;base64,'+result.data,metadata:result.page});
   const stage=[...document.querySelectorAll('[data-pdf-stage]')].find(n=>n.dataset.pdfStage===page.id);if(!stage)continue;
   stage.querySelector('img').src=ctx.previews.get(page.id).url;stage.classList.remove('preview-pending');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();
   for(const item of [...ctx.objects(page),...model.annotations.filter(a=>a.page===page.id).map(a=>({...a,annotation:true,editable:true}))])renderObjectOverlay(ctx,item,page,stage,ctx.pageInfo(page));
   ctx.decorateSelection();ctx.foundation.refresh();
  }catch(error){
   if(epoch===ctx.getPreviewEpoch()&&!ctx.snapshot().job&&!ctx.snapshot().starting){
    const stage=[...document.querySelectorAll('[data-pdf-stage]')].find(n=>n.dataset.pdfStage===page.id);
    if(stage){stage.classList.add('preview-failed');if(stage.querySelector('.pdf-preview-state'))stage.querySelector('.pdf-preview-state').textContent='Preview failed. Your draft is kept; undo or retry.';}
    ctx.feedback(error);
   }return;
  }
 }
}

function renderDocumentPages(ctx){
 const {saved,model,ops}=ctx.snapshot();
 if(saved?.id!==ctx.getLastDocument()){ctx.setSelection(null);ctx.previews.clear();ctx.wordSelector.clear();ctx.setLastDocument(saved?.id);}
 const sel=ctx.getSelection();
 if(sel&&(!model?.pages.some(p=>p.id===sel.page)||sel.id&&!ctx.target()?.item))ctx.setSelection(null);
 const epoch=ctx.bumpPreviewEpoch();
 if(saved)for(const[ordinal,card]of [...document.querySelectorAll('#pages>.page')].entries()){
  const page=model.pages[ordinal],info=ctx.pageInfo(page);if(!info.box)continue;
  const img=card.querySelector('img'),stage=card.querySelector('.pdf-page-surface')??el('div',{className:'pdf-page-surface'});
  stage.dataset.pdfStage=page.id;stage.style.aspectRatio=info.rotation%180?(info.box[3]-info.box[1])/(info.box[2]-info.box[0]):(info.box[2]-info.box[0])/(info.box[3]-info.box[1]);
  img.style.transform='none';if(stage.parentElement!==card){img.before(stage);stage.append(img);}
  const cached=ctx.previews.get(page.id),key=ctx.previewKey(page),pending=ctx.pageOperations(page).length;
  if(pending&&cached?.key===key){img.src=cached.url;stage.classList.remove('preview-pending','preview-failed');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();}
  else if(pending){stage.classList.add('preview-pending');stage.setAttribute('aria-busy','true');if(!stage.querySelector('.pdf-preview-state'))stage.append(el('span',{className:'pdf-preview-state',textContent:'Updating page preview…'}));}
  else{if(img.getAttribute('src')!==img.dataset.savedPreview)img.src=img.dataset.savedPreview;stage.classList.remove('preview-pending','preview-failed');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();}
  const items=[...ctx.objects(page),...model.annotations.filter(a=>a.page===page.id).map(a=>({...a,annotation:true,editable:true}))];
  for(const node of stage.querySelectorAll('[data-pdf-object]'))if(!items.some(i=>i.id===node.dataset.pdfObject))node.remove();
  for(const item of items)renderObjectOverlay(ctx,item,page,stage,info);
  stage.onclick=event=>{if(ctx.consumeSuppressClick()||ctx.getActiveTool())return;if(event.target===stage||event.target===img){try{ctx.requireNoDraft();ctx.setSelection({page:page.id,id:null});ctx.foundation.refresh();ctx.assistant.refresh();ctx.decorateSelection();}catch(e){ctx.feedback(e);}}};
  stage.onpointerdown=event=>ctx.onStagePointerDown(event,page,stage,info);
 }
 ctx.removeSelected.disabled=!ctx.editable()||!ctx.target()?.item?.editable;
 if(ops.length)ctx.schedulePreviews(()=>void runNativePreviews(ctx,epoch));
 ctx.decorateSelection();updateObjectTree(ctx);ctx.viewCtrl.syncDom();ctx.foundation?.refresh();ctx.assistant.refresh();
}

function createInsertAndAssetControls(ctx,left,root){
 const insertMenu=el('div',{className:'pdf-edit-tools'});
 for(const[kind,label]of [['text','Text'],['rectangle','Rectangle'],['ellipse','Ellipse']]){
  const b=el('button',{type:'button',textContent:label});b.dataset.pdfTool=kind;
  b.onclick=ctx.act(()=>{
   ctx.requireNoDraft();const page=ctx.selectedPage(),{box}=ctx.pageInfo(page),w=box[2]-box[0],h=box[3]-box[1],id=crypto.randomUUID();
   const item={id,kind,rect:[box[0]+w*.1,box[1]+h*.45,box[0]+w*.7,box[1]+h*.6],fill:kind==='text'?'111827':'dbeafe',...(kind==='text'?{text:'New text',font:'Helvetica',fontSize:16}:{stroke:'2563eb',strokeWidth:1})};
   ctx.setSelection({page:page.id,id});ctx.adapter.edit({op:'add-object',page:page.id,item});
   if(kind==='text')requestAnimationFrame(()=>{const n=[...document.querySelectorAll('[data-pdf-object]')].find(x=>x.dataset.pdfObject===id&&x.dataset.pdfPage===page.id),st=n?.closest('[data-pdf-stage]'),it=ctx.objects(ctx.snapshot().model.pages.find(p=>p.id===page.id)??page).find(o=>o.id===id);if(n&&st&&it)try{ctx.startInline(it,page,st,n);}catch(e){ctx.feedback(e);}});
  });
  insertMenu.append(b);
 }
 const imageInput=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true});
 const addImage=el('button',{type:'button',textContent:'Image'});addImage.onclick=ctx.act(()=>{ctx.requireNoDraft();imageInput.click();});
 insertMenu.insertBefore(addImage,insertMenu.children[1]??null);root.append(imageInput);
 for(const b of insertMenu.querySelectorAll('button'))b.classList.add('pdf-tool');
 bindImageInput(imageInput,ctx);
 const assetsSection=el('section',{className:'pane-section pdf-image-library'}),assetSelect=el('select',{ariaLabel:'Saved images'}),insertSaved=el('button',{type:'button',textContent:'Insert saved image'}),deleteSaved=el('button',{type:'button',textContent:'Delete unused image'});
 assetsSection.append(el('h3',{textContent:'Images'}),assetSelect,insertSaved,deleteSaved);left.append(assetsSection);
 insertSaved.onclick=ctx.act(()=>{const asset=ctx.snapshot().assets.find(a=>a.id===assetSelect.value);if(!asset)throw new Error('Choose a saved image.');ctx.insertAsset(asset);});
 deleteSaved.onclick=ctx.act(async()=>{if(assetSelect.value&&await ctx.adapter.ask('Delete this unused image? Images kept by saved document history cannot be deleted.','Delete image')){await ctx.adapter.removeImage(assetSelect.value);refreshAssets();}});
 function refreshAssets(){const chosen=assetSelect.value;assetSelect.replaceChildren(...ctx.snapshot().assets.map(a=>el('option',{value:a.id,textContent:a.title})));if(ctx.snapshot().assets.some(a=>a.id===chosen))assetSelect.value=chosen;insertSaved.disabled=!ctx.editable()||!assetSelect.value;deleteSaved.disabled=!ctx.snapshot().permissions.delete||!assetSelect.value;}
 return{insertMenu,assetsSection,refreshAssets};
}

function createInlineController(ctx){
 let inline=null;
 function flushInline(){
  if(ctx.isActiveDrag())throw new Error('Finish moving the PDF object before saving or asking for an edit.');
  if(!inline)return;
  const cur=inline;ctx.setSelection(cur.selection);
  const change=buildPropertyOperation(ctx.target(),'text',cur.input.value,ctx.pageInfo,ctx.editable());
  ctx.adapter.edit(change);inline=null;cur.input.remove();ctx.foundation.refresh();ctx.assistant.refresh();
 }
 function startInline(item,page,stage,node){
  ctx.requireNoDraft();if(!ctx.editable()||!item.editable||item.kind!=='text'||!textCapabilities(item).text)return;
  ctx.setSelection({page:page.id,id:item.id});
  const input=el('input',{className:'pdf-inline-text',value:item.text,ariaLabel:'Edit selected PDF text'});
  for(const k of ['left','top','width','height'])input.style[k]=node.style[k];
  inline={input,selection:{page:page.id,id:item.id}};stage.append(input);input.focus();input.select();
  input.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();inline=null;input.remove();node.focus();ctx.foundation.refresh();ctx.assistant.refresh();}else if(e.key==='Enter'){e.preventDefault();try{flushInline();}catch(err){input.setAttribute('aria-invalid','true');ctx.feedback(err);}}};
  input.oninput=()=>{ctx.foundation.refresh();ctx.assistant.refresh();};ctx.foundation.refresh();ctx.assistant.refresh();
  input.onblur=()=>{if(inline?.input!==input)return;try{flushInline();}catch(err){input.setAttribute('aria-invalid','true');ctx.feedback(err);}};
 }
 return{flushInline,startInline,discard:()=>{inline?.input.remove();inline=null;},hasInline:()=>Boolean(inline)};
}

function attachModelHelpers(ctx,adapter,root){
 ctx.previews=new Map();
 ctx.snapshot=()=>adapter.snapshot();
 ctx.source=page=>page?.blank?{cropBox:page.cropBox,rotation:0,objects:[],objectCount:0,contentEditable:true}:ctx.snapshot().sources.find(s=>s.id===page.source)?.pages[page.index];
 ctx.pageOperations=page=>{const s=ctx.snapshot();return s.ops.filter(op=>op.page===page.id||op.annotation?.page===page.id||(op.op==='insert-blank'&&op.id===page.id)||['update-annotation','remove-annotation'].includes(op.op)&&(s.model.annotations.find(a=>a.id===op.id)??s.saved.model.annotations.find(a=>a.id===op.id))?.page===page.id||op.op==='fill'&&s.saved.inspection.fields.find(f=>f.name===op.name)?.pages.some(i=>s.saved.model.pages[i]?.id===page.id));};
 ctx.previewKey=page=>{const s=ctx.snapshot();return JSON.stringify([s.saved.id,s.saved.revision,page.id,ctx.pageOperations(page)]);};
 ctx.pageInfo=page=>{const src=ctx.source(page);return{box:src?.cropBox??ctx.snapshot().saved?.inspection.pages[ctx.snapshot().model.pages.indexOf(page)]?.cropBox,rotation:((src?.rotation??0)+page.rotation)%360};};
 ctx.objects=page=>{const s=ctx.snapshot(),cached=ctx.previews.get(page.id),key=ctx.previewKey(page);return contentObjects(ctx.source(page),s.model,page.id,cached?.key===key?cached.metadata:!ctx.pageOperations(page).length?s.saved.inspection.pages[s.saved.model.pages.findIndex(p=>p.id===page.id)]:undefined);};
 ctx.target=()=>{const {model}=ctx.snapshot(),sel=ctx.getSelection(),page=model?.pages.find(p=>p.id===sel?.page);if(!page)return null;const ann=model.annotations.find(a=>a.page===page.id&&a.id===sel?.id);return{page,item:ann?{...ann,annotation:true,editable:true}:ctx.objects(page).find(o=>o.id===sel?.id)};};
 ctx.editable=()=>{const s=ctx.snapshot();return Boolean(s.saved&&s.permissions.change&&s.saved.revision===s.saved.currentRevision&&!s.job);};
 ctx.feedback=error=>adapter.status(pdfErrorMessage(error.code??error.message??String(error)));
 ctx.act=work=>async()=>{try{await work();}catch(error){ctx.feedback(error);}};
 ctx.wide=()=>!matchMedia('(max-width:800px)').matches;
 ctx.selectedPage=()=>{const {model}=ctx.snapshot(),sel=ctx.getSelection(),page=model?.pages.find(p=>p.id===sel?.page)??model?.pages.find(p=>adapter.selected().includes(p.id))??model?.pages[0];if(!page)throw new Error('Open a PDF first.');return page;};
 ctx.selectionIds=()=>{const sel=ctx.getSelection();return sel?.id?[sel.page+'/'+sel.id]:sel?.page?[sel.page]:adapter.selected();};
 ctx.decorateSelection=()=>{
  const sel=ctx.getSelection(),s=ctx.snapshot();
  for(const node of document.querySelectorAll('[data-pdf-object]')){
   const active=node.dataset.pdfObject===sel?.id&&node.dataset.pdfPage===sel?.page;
   node.classList.toggle('is-selected',active);node.setAttribute('aria-pressed',String(active));
   const page=s.model?.pages.find(p=>p.id===node.dataset.pdfPage),stage=node.closest('[data-pdf-stage]');
   if(page&&stage){const item=ctx.objects(page).find(o=>o.id===node.dataset.pdfObject);if(item)syncResizeHandle(node,{item,page,stage,info:ctx.pageInfo(page),selected:active,editable:ctx.editable(),screenRect,screenToPdf,onResize:op=>adapter.edit(op),feedback:ctx.feedback});}
  }
  for(const n of ctx.treeItems.querySelectorAll('[data-tree-object]'))n.setAttribute('aria-pressed',String(n.dataset.treeObject===sel?.id&&n.dataset.treeOwner===sel?.page));
 };
 ctx.insertAsset=(asset,page=ctx.selectedPage())=>{
  ctx.requireNoDraft();const {box}=ctx.pageInfo(page),w=Math.min((box[2]-box[0])*.6,(box[3]-box[1])*.6*asset.width/asset.height),h=w*asset.height/asset.width,id=crypto.randomUUID(),x=box[0]+(box[2]-box[0])*.1,y=box[1]+(box[3]-box[1])*.1;
  ctx.setSelection({page:page.id,id});adapter.edit({op:'add-object',page:page.id,item:{id,kind:'image',asset:asset.id,rect:[x,y,x+w,y+h]}});
 };
 ctx.wordSelector=createWordSelector({adapter,screenToPdf,screenRect,feedback:ctx.feedback,onApplyMarkup:(pageId,kind,rect,quadPoints,color)=>{const id=crypto.randomUUID();adapter.edit({op:'annotate',annotation:{id,page:pageId,kind,rect,quadPoints,color:color||ctx.getToolColor?.()||MARKUP_COLORS[kind]}});ctx.choose(pageId,id);}});
 ctx.viewCtrl=createViewController({root,pagesHost:document.getElementById('pages'),adapter,feedback:ctx.feedback});
}

function attachDialogAndViewHelpers(ctx,chrome,localCtrl){
 const thumbs=new Map();
 ctx.openMenu=(title,items,anchor)=>{
  const layer=ctx.layers.create(title,'ds-menu'),list=el('div',{className:'ds-menu-list'});list.setAttribute('role','menu');
  for(const item of items){
   if(item==='-'){list.append(el('hr',{className:'ds-menu-sep'}));continue;}
   const row=el('button',{type:'button',className:'ds-menu-row'+(item.danger?' ds-danger':''),textContent:item.label,disabled:Boolean(item.disabled)});
   row.setAttribute('role','menuitem');if(item.pressed)row.setAttribute('aria-checked','true');
   row.onclick=ctx.act(async()=>{await ctx.layers.close(layer.dialog);await item.run();});list.append(row);
  }
  layer.body.append(list);void ctx.layers.open(layer,{anchor});
 };
 ctx.openDocuments=async()=>{
  await ctx.adapter.listDocuments();const layer=ctx.layers.create('Your PDFs','ds-sheet'),list=el('div',{className:'ds-menu-list'});
  for(const item of ctx.adapter.documents()??[]){const row=el('button',{type:'button',className:'ds-menu-row',textContent:item.title});row.onclick=ctx.act(async()=>{await ctx.layers.close(layer.dialog);await ctx.adapter.openDocument(item.id);});list.append(row);}
  if(!list.children.length)list.append(el('p',{className:'help',textContent:'No PDFs yet.'}));layer.body.append(list);await ctx.layers.open(layer);
 };
 ctx.openSheet=async(title,nodes)=>{await ctx.layers.open(ctx.layers.create(title,'ds-sheet'),{nodes:nodes.filter(Boolean)});};
 ctx.openFormat=()=>{const side=ctx.root.querySelector('.ef-inspector');if(side)void ctx.openSheet('Format',[side]);};
 ctx.openConcierge=async()=>{
  if(ctx.wide()){if(ctx.root.dataset.editorConcierge==='open')ctx.root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));else ctx.foundation.showPanel('ai');return;}
  await ctx.openSheet('Concierge',[ctx.assistant.element]);ctx.assistant.element.querySelector('textarea')?.focus({preventScroll:true});
 };
 ctx.view=()=>{const s=ctx.snapshot(),docs=ctx.adapter.documents();if(s.saved&&!localCtrl.hasLocal())return'document';if(localCtrl.hasLocal()||ctx.isBlankRequested()||(docs&&!docs.length))return'blank';return docs?'home':'loading';};
 const loadThumb=async(item,host)=>{const k=item.id+'/'+item.revision;try{if(!thumbs.has(k))thumbs.set(k,ctx.adapter.api('/documents/'+item.id).then(r=>{const p=r.document.model.pages[0];return p?`/api/pdf-workbench/documents/${item.id}/pages/${p.id}/preview?revision=${r.document.revision}`:null;}));const url=await thumbs.get(k);if(url&&host.isConnected){const img=el('img',{alt:'',loading:'lazy',src:url});img.onerror=()=>img.remove();host.append(img);}}catch{/* tile stays */}};
 ctx.paintView=()=>{
  const v=ctx.view();chrome.home.hidden=v!=='home';chrome.blank.hidden=v!=='blank';ctx.root.dataset.pdfView=v;ctx.viewCtrl.syncDom();
  if(v!=='document'&&ctx.getMode())ctx.leaveMode();
  if(v==='home'){
   const docs=ctx.adapter.documents()??[];
   chrome.grid.replaceChildren(...docs.map(item=>{const card=el('button',{type:'button',className:'pdf-card'}),thumb=el('span',{className:'pdf-thumb'}),title=el('span',{className:'pdf-card-title',textContent:item.title}),meta=el('span',{className:'pdf-card-meta',textContent:new Date(item.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})});thumb.setAttribute('aria-hidden','true');card.append(thumb,title,meta);card.onclick=ctx.act(()=>ctx.adapter.openDocument(item.id));void loadThumb(item,thumb);return card;}));
  }
 };
}

function initEditorState(ctx){
 let selection=null,treeTopology=null,lastDoc=null,previewEpoch=0,previewTimer=null,activeDrag=false,draftEpoch=0,mode=null,activeTool=null,blankReq=false,suppressClick=false;
 Object.assign(ctx,{
  getSelection:()=>selection,setSelection:v=>{selection=v;},getTreeTopology:()=>treeTopology,setTreeTopology:v=>{treeTopology=v;},
  getLastDocument:()=>lastDoc,setLastDocument:v=>{lastDoc=v;},getPreviewEpoch:()=>previewEpoch,bumpPreviewEpoch:()=>{clearTimeout(previewTimer);return++previewEpoch;},
  schedulePreviews:fn=>{previewTimer=setTimeout(fn,450);},isActiveDrag:()=>activeDrag,setActiveDrag:v=>{activeDrag=v;},
  getActiveTool:()=>activeTool,setActiveTool:v=>{activeTool=v;ctx.root.dataset.pdfTool=v??'';},getMode:()=>mode,setMode:v=>{mode=v;},
  isBlankRequested:()=>blankReq,setBlankRequested:v=>{blankReq=v;},suppressNextClick:()=>{suppressClick=true;},consumeSuppressClick:()=>{const v=suppressClick;suppressClick=false;return v;},
  bumpDraft:()=>++draftEpoch,getDraftEpoch:()=>draftEpoch
 });
}

function attachStateAndEvents(ctx,{chrome,insertCtrl,inlineCtrl,localCtrl,quickFile}){
 let creating=null;
 const pointers=new Map(),cleanPtr=e=>pointers.delete(e.pointerId);
 window.addEventListener('pointerup',cleanPtr);window.addEventListener('pointercancel',cleanPtr);
 Object.assign(ctx,{
  requireNoDraft:()=>{if(inlineCtrl.hasInline())inlineCtrl.flushInline();if(ctx.foundation?.hasPending())throw new Error('Apply or discard the property field before changing the selection.');},
  choose:(page,id)=>{ctx.requireNoDraft();ctx.setSelection({page,id});ctx.decorateSelection();ctx.syncButtons();ctx.assistant.refresh();},
  ensureDocument:async()=>{if(ctx.snapshot().saved)return;creating??=ctx.adapter.createBlank().finally(()=>{creating=null;});await creating;ctx.setBlankRequested(false);},
  leaveMode:()=>{ctx.setMode(null);ctx.setActiveTool(null);delete ctx.root.dataset.pdfMode;chrome.strip.hidden=true;chrome.modes.hidden=false;chrome.done.hidden=true;for(const n of [...chrome.strip.children])n.remove();ctx.syncButtons();}
 });
 const getStrips=buildModeStrips(ctx);
 ctx.chooseMode=async id=>{
  if(id==='pages')return openPagesSheet(ctx);if(id==='concierge')return ctx.openConcierge();
  await ctx.ensureDocument();if(!ctx.snapshot().saved)return;
  ctx.setMode(id);ctx.setActiveTool(null);ctx.root.dataset.pdfMode=id;chrome.strip.replaceChildren(...getStrips()[id]);chrome.strip.hidden=false;chrome.modes.hidden=true;chrome.done.hidden=false;ctx.syncButtons();
  chrome.strip.querySelector('button:not([disabled])')?.focus({preventScroll:true});
 };
 chrome.done.onclick=()=>ctx.leaveMode();
 chrome.primary.onclick=ctx.act(async()=>{if(ctx.view()==='blank')localCtrl.startLocal(.1,.1);else await ctx.adapter.export();});
 ctx.onStagePointerDown=(event,page,stage,info)=>{
  const activeTool=ctx.getActiveTool();
  if(event.button!==0||event.target.closest('[data-pdf-object],.pdf-word-bar,.pdf-word-handle,.pdf-inline-text'))return;
  if(!activeTool){handleIdleStageGesture(ctx,event,page,stage,info);return;}
  if(!ctx.editable())return;ctx.wordSelector.clear();
  if(activeTool==='pen')startInkDraw(event,{page,stage,info,color:ctx.getToolColor(),strokeWidth:ctx.getPenWidth(),pointers,center:ctx.center,screenToPdf,onCommit:ann=>{ctx.adapter.edit({op:'annotate',annotation:ann});ctx.choose(page.id,ann.id);},feedback:ctx.feedback});
  else if(activeTool==='eraser')startEraserPass(event,{page,stage,info,getAnnotations:()=>ctx.snapshot().model?.annotations??[],screenToPdf,onErase:id=>{if(ctx.getSelection()?.id===id)ctx.setSelection(null);ctx.adapter.edit({op:'remove-annotation',id});},feedback:ctx.feedback});
  else handleMarkupOrNoteGesture(ctx,event,page,stage,info);
 };
 const syncConciergeMode=()=>chrome.modeButtons.concierge.classList.toggle('pdf-phone-only',Boolean(ctx.root.querySelector('.ef-panes [aria-controls$="-concierge"]')?.hidden));
 new MutationObserver(syncConciergeMode).observe(ctx.root,{attributes:true,attributeFilter:['data-editor-concierge']});
 ctx.syncButtons=()=>{
  insertCtrl.refreshAssets();ctx.removeSelected.disabled=!ctx.editable()||!ctx.target()?.item?.editable;
  for(const b of insertCtrl.insertMenu.querySelectorAll('button'))b.disabled=!ctx.editable()||ctx.source(ctx.selectedPage())?.contentEditable===false;
  const s=ctx.snapshot(),v=ctx.view(),dirty=Boolean(s.ops.length||ctx.adapter.formDraft().length||inlineCtrl.hasInline()||ctx.foundation?.hasPending());
  chrome.undo.disabled=!ctx.editable()||!s.undo.length;chrome.redo.disabled=!ctx.editable()||!s.redo.length;quickFile.disabled=!s.permissions.create;
  document.getElementById('document-title').textContent=s.saved?.title??(v==='home'?'Your PDFs':'Untitled PDF');
  chrome.save.hidden=!(s.saved&&dirty);chrome.primary.hidden=v==='home'||v==='loading';chrome.primary.textContent=v==='blank'?'Add text':'Export';chrome.primary.disabled=v==='blank'?!s.permissions.create:!s.saved||!s.permissions.export;
  chrome.search.hidden=v!=='document';chrome.undo.hidden=chrome.redo.hidden=v==='home'||v==='loading';chrome.modebar.hidden=v==='home'||v==='loading';
  for(const id of ['annotate','edit','sign'])chrome.modeButtons[id].disabled=!(s.saved?ctx.editable():s.permissions.create);
  chrome.modeButtons.pages.disabled=!(s.saved||s.permissions.create);
  syncConciergeMode();
  document.getElementById('cancel-job').hidden=!(s.job&&s.permissions['job.manage']);document.getElementById('delete-document').hidden=!s.permissions.delete;
  ctx.foundation.refresh();
 };
}

export async function createPdfEditor(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js');
 const {createEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const root=document.body,main=document.querySelector('main.wb'),right=main.querySelector('.wb-right'),center=main.querySelector('.wb-center'),left=main.querySelector('.wb-left');
 const tree=el('section',{className:'pane-section pdf-object-tree'}),treeItems=el('div');tree.hidden=true;tree.append(el('h3',{textContent:'Pages and objects'}),treeItems);left.prepend(tree);
 const removeSelected=el('button',{type:'button',className:'pdf-tool',textContent:'Delete'});removeSelected.setAttribute('aria-label','Delete object');removeSelected.dataset.dsDestructive='';
 const ctx={adapter,root,center,tree,treeItems,removeSelected};
 initEditorState(ctx);attachModelHelpers(ctx,adapter,root);
 const inlineCtrl=createInlineController(ctx);ctx.startInline=inlineCtrl.startInline;ctx.flushInline=inlineCtrl.flushInline;
 const insertCtrl=createInsertAndAssetControls(ctx,left,root);ctx.insertMenu=insertCtrl.insertMenu;ctx.assetsSection=insertCtrl.assetsSection;
 removeSelected.onclick=ctx.act(()=>{ctx.requireNoDraft();const {item,page}=ctx.target()??{};if(!item)throw new Error('Select an object.');adapter.edit(item.annotation?{op:'remove-annotation',id:item.id}:{op:'delete-object',page:page.id,object:item.id});ctx.setSelection(null);ctx.foundation.refresh();});
 ctx.assistant=createEditorAssistant({app:'pdf-workbench',bot:'pdf-editor',title:'PDF AI partner',prompts:SUGGESTED_PROMPTS,root,prepare:()=>adapter.prepare(),refresh:c=>adapter.refresh(c),getState:()=>{const s=ctx.snapshot();return{documentId:s.saved?.id,revision:s.saved?.revision,selection:ctx.selectionIds(),dirty:Boolean(s.ops.length||adapter.formDraft().length||inlineCtrl.hasInline()||ctx.foundation?.hasPending()),busy:Boolean(s.job||s.starting||ctx.isActiveDrag())};}});
 mountSuggestedPrompts(ctx.assistant);
 const quickFile=el('input',{type:'file',accept:'application/pdf,.pdf',hidden:true,id:'quick-pdf'});quickFile.setAttribute('aria-label','PDF to open');root.append(quickFile);
 quickFile.onchange=ctx.act(async()=>{const f=quickFile.files[0];quickFile.value='';if(f){ctx.setBlankRequested(false);await adapter.uploadAndOpen(f);}});
 ctx.foundation=createEditorFoundation({root,navigationLabel:'Documents',header:main.querySelector('.wb-bar'),navigation:left,viewport:center,inspector:right,ai:ctx.assistant.element,status:document.getElementById('status'),
  getState:()=>{const s=ctx.snapshot();return{documentId:s.saved?.id??null,revision:s.saved?.revision??null,title:s.saved?.title??'PDF workbench',dirty:Boolean(s.ops.length||adapter.formDraft().length||inlineCtrl.hasInline()||ctx.foundation?.hasPending()),busy:Boolean(s.job),readOnly:!ctx.editable(),canUndo:s.undo.length>0,canRedo:s.redo.length>0};},
  getSelection:()=>({kind:ctx.target()?.item?.kind==='path'?'shape':ctx.target()?.item?.kind??'page',ids:ctx.selectionIds()}),
  getProperties:()=>buildInspectorProperties(ctx.target(),ctx.pageInfo,ctx.editable()),
  applyProperty:(k,v)=>{try{return adapter.edit(buildPropertyOperation(ctx.target(),k,v,ctx.pageInfo,ctx.editable()));}catch(e){throw new Error(pdfErrorMessage(e.code??e.message));}},
  actions:{undo:()=>document.getElementById('undo').click(),redo:()=>document.getElementById('redo').click(),save:()=>adapter.save(),export:()=>adapter.export()}});
 main.hidden=true;root.classList.add('pdf-chrome');root.addEventListener('editor-foundation:draft',()=>adapter.controls());
 root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
 const chrome=setupShellChrome(ctx,main,center,right,left);ctx.layers=chrome.layers;ctx.strip=chrome.strip;ctx.sections=chrome.sections;
 const localCtrl=wireBlankPageTyping(ctx,chrome.paper);
 attachDialogAndViewHelpers(ctx,chrome,localCtrl);
 attachStateAndEvents(ctx,{chrome,insertCtrl,inlineCtrl,localCtrl,quickFile});
 wireMenus(ctx,{newButton:chrome.newButton,docButton:chrome.docButton,more:chrome.more,quickFile,assetsSection:insertCtrl.assetsSection});
 root.addEventListener('input',e=>{if(e.target.matches('[data-editor-property],.pdf-inline-text'))ctx.bumpDraft();if(e.target.matches('[data-field]')){ctx.foundation?.refresh();ctx.assistant.refresh();}});
 void ctx.viewCtrl.load();
 return{foundation:ctx.foundation,controls:ctx.syncButtons,render:()=>{renderDocumentPages(ctx);ctx.paintView();ctx.assistant.refresh();ctx.syncButtons();},flushInline:inlineCtrl.flushInline,discardInline:inlineCtrl.discard,hasInline:inlineCtrl.hasInline,signature:ctx.getDraftEpoch,draftChanged:()=>{ctx.foundation.refresh();ctx.assistant.refresh();},selectPages:()=>{ctx.requireNoDraft();ctx.setSelection(null);ctx.decorateSelection();ctx.syncButtons();ctx.assistant.refresh();},selection:ctx.selectionIds,layers:chrome.layers};
}

export function createLayers(doc){
 const win=doc.defaultView,stack=[];let ignore=0;
 const make=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
 win.addEventListener('popstate',()=>{if(ignore>0){ignore-=1;return;}const top=stack.at(-1);if(top)void close(top.dialog,{history:false});});
 function create(title,className){
  const dialog=make('dialog','ds-layer '+className),head=make('header','ds-layer-head'),heading=make('h2','ds-layer-title',title),done=make('button','ds-layer-done','Done'),body=make('div','ds-layer-body');
  dialog.dataset.dsSheet='';dialog.setAttribute('aria-label',title);done.type='button';head.append(heading,done);dialog.append(head,body);
  done.addEventListener('click',()=>void close(dialog));dialog.addEventListener('cancel',e=>{e.preventDefault();void close(dialog);});
  dialog.addEventListener('click',e=>{if(e.target===dialog)void close(dialog);});doc.body.append(dialog);
  return{dialog,body,heading};
 }
 async function open(layer,{nodes=[],anchor=null,into=null,before=null}={}){
  const host=into??layer.body,restore=nodes.map(node=>{const mark=doc.createComment('layer'),wasHidden=node.hidden;node.before(mark);host.insertBefore(node,before);node.hidden=false;return()=>{node.hidden=wasHidden;mark.replaceWith(node);};});
  stack.push({dialog:layer.dialog,restore});layer.dialog.showModal();
  if(anchor&&win.matchMedia('(min-width:801px)').matches){const box=anchor.getBoundingClientRect(),width=Math.max(240,layer.dialog.offsetWidth);layer.dialog.style.left=Math.max(8,Math.min(box.left,win.innerWidth-width-8))+'px';layer.dialog.style.top=Math.min(box.bottom+4,win.innerHeight-layer.dialog.offsetHeight-8)+'px';layer.dialog.style.add?.('ds-anchored');layer.dialog.classList.add('ds-anchored');}
  try{win.history.pushState({...(win.history.state||{}),dsLayer:stack.length},'');}catch{/* embedded without history access */}
 }
 async function close(dialog,{history=true}={}){
  const index=stack.findIndex(entry=>entry.dialog===dialog);if(index<0)return;const [entry]=stack.splice(index,1);
  for(const undo of entry.restore.reverse())undo();dialog.close();dialog.remove();
  if(history){
   const address=win.location.href;ignore+=1;
   await new Promise(resolve=>{let fired=false;const done=()=>{if(fired)return;fired=true;win.removeEventListener('popstate',done);resolve();};win.addEventListener('popstate',done);try{win.history.back();}catch{done();}setTimeout(()=>{if(!fired&&ignore>0)ignore-=1;done();},600);});
   try{if(win.location.href!==address)win.history.replaceState(win.history.state,'',address);}catch{/* embedded without history access */}
  }
 }
 return{create,open,close,top:()=>stack.at(-1)?.dialog??null};
}
