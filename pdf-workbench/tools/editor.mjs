/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Select real PDF objects, edit typed properties and manipulate page content in the shared editor.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Phones (Roger, trial.oswarm.ai, 2026-11-06, F5): the empty state's one primary action is Upload a PDF (pick, upload, create and open in one step), with Blank page and Your documents as text links; the first pane is named Documents; Export, Undo and Redo move into More; Insert and the Document menu open as sheets from the shared shell; and the Document menu shows only what this seat can do now (Cancel job only while a job runs and the seat may manage it, Delete history only with delete).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.2.4 (the trial check, 2026-11-06): the Document menu and Download PDF also wait in More on a phone, so the app bar is one row (title, Save, More).
 */
import {contentObjects,PDF_FONTS,validateContentProperties,pdfErrorMessage,textCapabilities} from './content-model.mjs';
const el=(tag,attributes={})=>Object.assign(document.createElement(tag),attributes);
const rectProperties=(rect,box)=>['x','y','width','height'].map((key,index)=>({key,label:['X','Y','Width','Height'][index],type:'number',unit:'pt',step:.1,value:Number((index<2?rect[index]:rect[index]-rect[index-2]).toFixed(3)),min:index<2?box[index]:.1,max:index%2===0?box[2]:box[3],group:'Position and size'}));
export function rotatedPoint(x,y,box,rotation){
 const u=(x-box[0])/(box[2]-box[0]),v=(y-box[1])/(box[3]-box[1]);
 return rotation===90?[v,u]:rotation===180?[1-u,v]:rotation===270?[1-v,1-u]:[u,1-v];
}
export function dragDelta(dx,dy,box,rotation){
 const w=box[2]-box[0],h=box[3]-box[1];
 return rotation===90?[dy*w,dx*h]:rotation===180?[-dx*w,dy*h]:rotation===270?[-dy*w,-dx*h]:[dx*w,-dy*h];
}
function screenRect(rect,box,rotation){const points=[[rect[0],rect[1]],[rect[0],rect[3]],[rect[2],rect[1]],[rect[2],rect[3]]].map(([x,y])=>rotatedPoint(x,y,box,rotation));return[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}

export async function createPdfEditor(adapter){
 const {createEditorFoundation}=await import('/shared/ui/js/editor-foundation.js');
 const {createEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
 const root=document.body,main=document.querySelector('main.wb'),right=main.querySelector('.wb-right'),center=main.querySelector('.wb-center');
 const toolbar=el('div',{className:'pdf-context-toolbar'}),insert=el('details',{className:'pdf-command-menu'}),insertLabel=el('summary',{textContent:'Insert'}),insertMenu=el('div',{className:'pdf-menu-items'});
 insert.append(insertLabel,insertMenu);
 const tree=el('section',{className:'pane-section pdf-object-tree'}),treeItems=el('div');tree.hidden=true;tree.append(el('h3',{textContent:'Pages and objects'}),treeItems);main.querySelector('.wb-left').prepend(tree);
 let treeTopology=null;
 let selection=null,foundation=null,lastDocument=null,previewEpoch=0,previewTimer=null,inline=null,activeDrag=false,draftEpoch=0;
 root.addEventListener('input',event=>{if(event.target.matches('[data-editor-property],.pdf-inline-text'))draftEpoch++;if(event.target.matches('[data-field]')){foundation?.refresh();assistant.refresh();}});
 const previews=new Map();
 const snapshot=()=>adapter.snapshot();
 const source=(page)=>snapshot().sources.find(s=>s.id===page.source)?.pages[page.index];
 const pageOperations=page=>{const s=snapshot();return s.ops.filter(operation=>operation.page===page.id||operation.annotation?.page===page.id||['update-annotation','remove-annotation'].includes(operation.op)&&(s.model.annotations.find(a=>a.id===operation.id)??s.saved.model.annotations.find(a=>a.id===operation.id))?.page===page.id||operation.op==='fill'&&s.saved.inspection.fields.find(field=>field.name===operation.name)?.pages.some(index=>s.saved.model.pages[index]?.id===page.id));};
 const previewKey=page=>{const s=snapshot();return JSON.stringify([s.saved.id,s.saved.revision,page.id,pageOperations(page)]);};
 const pageInfo=page=>{const s=source(page);return{box:s?.cropBox??snapshot().saved?.inspection.pages[snapshot().model.pages.indexOf(page)]?.cropBox,rotation:((s?.rotation??0)+page.rotation)%360};};
 const objects=page=>{const s=snapshot(),cached=previews.get(page.id),key=previewKey(page);return contentObjects(source(page),s.model,page.id,cached?.key===key?cached.metadata:!pageOperations(page).length?s.saved.inspection.pages[s.saved.model.pages.findIndex(p=>p.id===page.id)]:undefined);};
 const target=()=>{const {model}=snapshot(),page=model?.pages.find(p=>p.id===selection?.page);if(!page)return null;const annotation=model.annotations.find(a=>a.page===page.id&&a.id===selection?.id);return{page,item:annotation?{...annotation,annotation:true,editable:true}:objects(page).find(o=>o.id===selection?.id)};};
 const editable=()=>{const s=snapshot();return Boolean(s.saved&&s.permissions.change&&s.saved.revision===s.saved.currentRevision&&!s.job);};
 const feedback=error=>adapter.status(pdfErrorMessage(error.code??error.message??String(error)));
 const act=work=>async()=>{try{await work();}catch(error){feedback(error);}};
 function requireNoDraft(){if(inline)flushInline();if(foundation?.hasPending())throw new Error('Apply or discard the property field before changing the selection.');}
 function choose(page,id){requireNoDraft();selection={page,id};decorateSelection();syncButtons();assistant.refresh();}
 const selectionIds=()=>selection?.id?[selection.page+'/'+selection.id]:selection?.page?[selection.page]:adapter.selected();
 function properties(){
  const selected=target();if(!selected?.item)return[];
  const {page,item}=selected,box=pageInfo(page).box;if(!box||!item.rect)return[];
  const fields=rectProperties(item.rect,box);
  if(item.annotation){fields.push({key:'color',label:'Color',type:'color',value:'#'+(item.color??'ffcc00'),group:'Appearance'});if(item.kind==='text')fields.push({key:'text',label:'Note text',type:'textarea',value:item.text,group:'Text'});}
  else{
   if(item.kind==='text'){const capability=textCapabilities(item);fields.push({key:'text',label:'Text',type:'text',value:item.text,group:'Text',disabled:!capability.text},
    {key:'font',label:'Font',type:'select',value:item.fontExplicit||!item.original?(item.font??'Helvetica'):'',options:[...(!item.fontExplicit&&item.original?[{value:'',label:'Keep original ('+item.font+')'}]:[]),...PDF_FONTS.map(value=>({value,label:value}))],group:'Text',disabled:!capability.font},
    {key:'fontSize',label:'Font size',type:'number',value:item.fontSize,min:1,max:256,unit:'pt',step:.5,group:'Text',disabled:!capability.size});if(!capability.text)fields.push({key:'text-edit-reason',label:'Text editing',type:'text',value:capability.reason,group:'Text',disabled:true});}
   for(const[key,label]of [['fill','Fill color'],['stroke','Line color']])if(item[key]!==undefined)fields.push({key,label,type:'color',value:'#'+item[key],group:'Appearance'});
   if(item.strokeWidth!==undefined)fields.push({key:'strokeWidth',label:'Line weight',type:'number',value:item.strokeWidth,min:0,max:40,unit:'pt',step:.25,group:'Appearance'});
   if(item.opacity!==undefined&&['text','path','rectangle','ellipse','image'].includes(item.kind))fields.push({key:'opacity',label:'Opacity',type:'number',value:Math.round(item.opacity*100),min:0,max:100,unit:'%',group:'Appearance'});
  }
  return fields.map(field=>({...field,disabled:field.disabled||!editable()||!item.editable}));
 }
 function operation(key,value){
  const {page,item}=target()??{};if(!item||!editable()||!item.editable)throw new Error('Select an editable object in the latest PDF revision.');
  let properties;
  if(['x','y','width','height'].includes(key)){
   const rect=[...item.rect],width=rect[2]-rect[0],height=rect[3]-rect[1];
   if(key==='x'){rect[0]=value;rect[2]=value+width;}else if(key==='y'){rect[1]=value;rect[3]=value+height;}else rect[key==='width'?2:3]=rect[key==='width'?0:1]+value;
   properties={rect};
  }else properties={[key]:key==='opacity'?value/100:['fill','stroke','color'].includes(key)?value.slice(1).toLowerCase():value};
  if(item.annotation){
   if(properties.rect){validateContentProperties({rect:properties.rect},'path',pageInfo(page).box);if(item.kind==='ink'){const old=item.rect,next=properties.rect;properties.points=item.points.map(([x,y])=>[next[0]+(x-old[0])/(old[2]-old[0])*(next[2]-next[0]),next[1]+(y-old[1])/(old[3]-old[1])*(next[3]-next[1])]);}}
   if(properties.text!==undefined&&(!properties.text.length||properties.text.length>2000||! /^[\x20-\x7e\n]+$/.test(properties.text)))throw new Error('PDF notes accept up to 2,000 Latin characters.');
   return{op:'update-annotation',id:item.id,properties};
  }
  validateContentProperties(properties,item.kind,pageInfo(page).box,undefined,item);
  return{op:'update-object',page:page.id,object:item.id,properties};
 }
 function decorateSelection(){for(const node of document.querySelectorAll('[data-pdf-object]')){const active=node.dataset.pdfObject===selection?.id&&node.dataset.pdfPage===selection?.page;node.classList.toggle('is-selected',active);node.setAttribute('aria-pressed',String(active));}for(const node of treeItems.querySelectorAll('[data-tree-object]'))node.setAttribute('aria-pressed',String(node.dataset.treeObject===selection?.id&&node.dataset.treeOwner===selection?.page));}
 function refreshTree(){
  const {saved,model}=snapshot();tree.hidden=!saved;if(!saved){treeItems.replaceChildren();treeTopology=null;return;}
  const rows=model.pages.map(page=>({page,items:[...objects(page),...model.annotations.filter(item=>item.page===page.id).map(item=>({...item,annotation:true}))]}));
  const topology=JSON.stringify([saved.id,rows.map(row=>[row.page.id,row.items.map(item=>item.id)])]);
  if(topology!==treeTopology){
   const expanded=new Set([...treeItems.querySelectorAll('details[open]')].map(node=>node.dataset.treePage));treeItems.replaceChildren();
   for(const[ordinal,row]of rows.entries()){
    const group=el('details'),summary=el('summary',{textContent:'Page '+(ordinal+1)}),list=el('div',{className:'pdf-object-list'});group.dataset.treePage=row.page.id;group.open=expanded.has(row.page.id)||selection?.page===row.page.id||!ordinal;
    summary.onclick=()=>{try{requireNoDraft();selection={page:row.page.id,id:null};decorateSelection();foundation.refresh();assistant.refresh();}catch(error){feedback(error);}};
    for(const item of row.items){const button=el('button',{type:'button'});button.dataset.treeObject=item.id;button.dataset.treeOwner=row.page.id;button.onclick=act(()=>{choose(row.page.id,item.id);const object=[...document.querySelectorAll('[data-pdf-object]')].find(node=>node.dataset.pdfObject===item.id&&node.dataset.pdfPage===row.page.id);object?.scrollIntoView({block:'center',inline:'nearest'});object?.focus({preventScroll:true});if(innerWidth<800)foundation.showPanel('properties');});list.append(button);}
    group.append(summary,list);treeItems.append(group);
   }
   treeTopology=topology;
  }
  const buttons=new Map([...treeItems.querySelectorAll('[data-tree-object]')].map(node=>[node.dataset.treeOwner+'/'+node.dataset.treeObject,node]));for(const row of rows)for(const item of row.items){const button=buttons.get(row.page.id+'/'+item.id);if(button){button.textContent=item.annotation?(item.kind==='text'?'Note: '+item.text.slice(0,80):item.kind+' annotation'):item.kind==='text'?item.text.slice(0,80):({path:'Shape',image:'Image',group:'Group',rectangle:'Rectangle',ellipse:'Ellipse'}[item.kind]??item.kind);button.setAttribute('aria-pressed',String(selection?.id===item.id&&selection?.page===row.page.id));}}
 }
 function flushInline(){
  if(activeDrag)throw new Error('Finish moving the PDF object before saving or asking for an edit.');
  if(!inline)return;
  const current=inline;selection=current.selection;const change=operation('text',current.input.value);
  adapter.edit(change);inline=null;current.input.remove();foundation.refresh();assistant.refresh();
 }
 function startInline(item,page,stage,node){
  requireNoDraft();if(!editable()||!item.editable||item.kind!=='text'||!textCapabilities(item).text)return;selection={page:page.id,id:item.id};
  const input=el('input',{className:'pdf-inline-text',value:item.text,ariaLabel:'Edit selected PDF text'});for(const key of ['left','top','width','height'])input.style[key]=node.style[key];
  inline={input,selection:{...selection}};stage.append(input);input.focus();input.select();
  input.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();inline=null;input.remove();node.focus();foundation.refresh();assistant.refresh();}else if(event.key==='Enter'){event.preventDefault();try{flushInline();}catch(error){input.setAttribute('aria-invalid','true');feedback(error);}}};
  input.oninput=()=>{foundation.refresh();assistant.refresh();};foundation.refresh();assistant.refresh();
  input.onblur=()=>{if(inline?.input!==input)return;try{flushInline();}catch(error){input.setAttribute('aria-invalid','true');feedback(error);}};
 }
 function overlay(item,page,stage,info){
  if(!item.rect||item.rect[0]>=item.rect[2]||item.rect[1]>=item.rect[3])return;
  const rect=screenRect(item.rect,info.box,info.rotation),node=[...stage.querySelectorAll('[data-pdf-object]')].find(node=>node.dataset.pdfObject===item.id)??el('button',{type:'button',className:'pdf-object'});node.title=item.kind==='text'?item.text:item.annotation?item.kind+' annotation':item.kind;
  node.dataset.pdfObject=item.id;node.dataset.pdfPage=page.id;node.setAttribute('aria-label',item.kind==='text'?'Text: '+item.text.slice(0,100):item.annotation?item.kind+' annotation':item.kind+' object');
  Object.assign(node.style,{left:rect[0]*100+'%',top:rect[1]*100+'%',width:(rect[2]-rect[0])*100+'%',height:(rect[3]-rect[1])*100+'%'});
  node.onclick=act(()=>choose(page.id,item.id));node.ondblclick=act(()=>startInline(item,page,stage,node));
  node.onkeydown=event=>{if(event.key==='F2'){event.preventDefault();act(()=>startInline(item,page,stage,node))();}if(['Delete','Backspace'].includes(event.key)&&editable()){event.preventDefault();act(()=>{choose(page.id,item.id);removeSelected.click();})();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&editable()){event.preventDefault();try{choose(page.id,item.id);const step=event.shiftKey?10:1,w=info.box[2]-info.box[0],h=info.box[3]-info.box[1],dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,delta=dragDelta(dx/(info.rotation%180?h:w),dy/(info.rotation%180?w:h),info.box,info.rotation),rect=item.rect.map((value,index)=>value+delta[index%2]);validateContentProperties({rect},'path',info.box);adapter.edit(item.annotation?{op:'update-annotation',id:item.id,properties:{rect,...(item.kind==='ink'?{points:item.points.map(([x,y])=>[x+delta[0],y+delta[1]])}:{})}}:{op:'update-object',page:page.id,object:item.id,properties:{rect}});}catch(error){feedback(error);}}};
  node.onpointerdown=event=>{
   if(event.button!==0||!editable()||!item.editable)return;
   try{choose(page.id,item.id);}catch(error){feedback(error);return;}
   const start=[event.clientX,event.clientY],bounds=stage.getBoundingClientRect();let moved=false,delta=[0,0];activeDrag=true;node.setPointerCapture(event.pointerId);
   const move=e=>{if(e.pointerId!==event.pointerId)return;const pixels=[e.clientX-start[0],e.clientY-start[1]];if(!moved&&Math.abs(pixels[0])+Math.abs(pixels[1])>3){moved=true;assistant.refresh();}delta=dragDelta(pixels[0]/bounds.width,pixels[1]/bounds.height,info.box,info.rotation);node.style.transform=`translate(${pixels[0]}px,${pixels[1]}px)`;};
   const finish=e=>{if(e.pointerId!==event.pointerId)return;activeDrag=false;node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',cancel);node.style.transform='';if(moved){try{const rect=item.rect.map((n,i)=>n+delta[i%2]);validateContentProperties({rect},'path',info.box);const dx=rect[0]-item.rect[0],dy=rect[1]-item.rect[1];if(item.annotation){const properties={rect,...(item.kind==='ink'?{points:item.points.map(([x,y])=>[x+dx,y+dy])}:{})};adapter.edit({op:'update-annotation',id:item.id,properties});}else adapter.edit({op:'update-object',page:page.id,object:item.id,properties:{rect}});}catch(error){feedback(error);}}};
   const cancel=e=>{moved=false;finish(e);};node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',cancel);
  };
  if(node.parentElement!==stage)stage.append(node);
 }
 async function nativePreviews(epoch){
  const {saved,model,ops,job,starting}=snapshot();if(!saved||!ops.length||job||starting)return;
  for(const page of model.pages){
   if(epoch!==previewEpoch)return;
   const key=previewKey(page);if(!pageOperations(page).length||previews.get(page.id)?.key===key)continue;
   try{const result=await adapter.post(`/documents/${saved.id}/draft-preview`,{baseRevision:saved.revision,operations:structuredClone(ops),page:page.id});
    while(activeDrag&&epoch===previewEpoch)await new Promise(resolve=>setTimeout(resolve,50));
    if(epoch!==previewEpoch)return;previews.set(page.id,{key,url:'data:image/png;base64,'+result.data,metadata:result.page});
    const stage=[...document.querySelectorAll('[data-pdf-stage]')].find(node=>node.dataset.pdfStage===page.id);if(!stage)continue;stage.querySelector('img').src=previews.get(page.id).url;stage.classList.remove('preview-pending');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();
    for(const item of [...objects(page),...model.annotations.filter(a=>a.page===page.id).map(a=>({...a,annotation:true,editable:true}))])overlay(item,page,stage,pageInfo(page));decorateSelection();foundation.refresh();
   }catch(error){if(epoch===previewEpoch&&!snapshot().job&&!snapshot().starting){const stage=[...document.querySelectorAll('[data-pdf-stage]')].find(node=>node.dataset.pdfStage===page.id);if(stage){stage.classList.add('preview-failed');if(stage.querySelector('.pdf-preview-state'))stage.querySelector('.pdf-preview-state').textContent='Preview failed. Your draft is kept; undo or retry.';}feedback(error);}return;}
  }
 }
 function render(){
  const {saved,model,ops}=snapshot();if(saved?.id!==lastDocument){selection=null;previews.clear();lastDocument=saved?.id;}if(selection&&(!model?.pages.some(page=>page.id===selection.page)||selection.id&&!target()?.item))selection=null;
  clearTimeout(previewTimer);const epoch=++previewEpoch;
  if(saved)for(const[ordinal,card]of [...document.querySelectorAll('#pages>.page')].entries()){
   const page=model.pages[ordinal],info=pageInfo(page);if(!info.box)continue;
   const img=card.querySelector('img'),stage=card.querySelector('.pdf-page-surface')??el('div',{className:'pdf-page-surface'});stage.dataset.pdfStage=page.id;stage.style.aspectRatio=info.rotation%180?(info.box[3]-info.box[1])/(info.box[2]-info.box[0]):(info.box[2]-info.box[0])/(info.box[3]-info.box[1]);
   img.style.transform='none';if(stage.parentElement!==card){img.before(stage);stage.append(img);}
   const cached=previews.get(page.id),key=previewKey(page),pending=pageOperations(page).length;if(pending&&cached?.key===key){img.src=cached.url;stage.classList.remove('preview-pending','preview-failed');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();}
   else if(pending){stage.classList.add('preview-pending');stage.setAttribute('aria-busy','true');if(!stage.querySelector('.pdf-preview-state'))stage.append(el('span',{className:'pdf-preview-state',textContent:'Updating page preview…'}));}else{if(img.getAttribute('src')!==img.dataset.savedPreview)img.src=img.dataset.savedPreview;stage.classList.remove('preview-pending','preview-failed');stage.setAttribute('aria-busy','false');stage.querySelector('.pdf-preview-state')?.remove();}
   const items=[...objects(page),...model.annotations.filter(a=>a.page===page.id).map(a=>({...a,annotation:true,editable:true}))];for(const node of stage.querySelectorAll('[data-pdf-object]'))if(!items.some(item=>item.id===node.dataset.pdfObject))node.remove();for(const item of items)overlay(item,page,stage,info);
   stage.onclick=event=>{if(event.target===stage||event.target===img){try{requireNoDraft();selection={page:page.id,id:null};foundation.refresh();assistant.refresh();decorateSelection();}catch(error){feedback(error);}}};
   const moves=card.querySelector('.row');if(moves&&!moves.closest('.pdf-page-menu')){const menu=el('details',{className:'pdf-command-menu pdf-page-menu'});menu.append(el('summary',{textContent:'Page actions'}),moves);card.append(menu);}
  }
  for(const button of toolbar.querySelectorAll('button'))button.disabled=!editable();
  removeSelected.disabled=!editable()||!target()?.item?.editable;
  if(ops.length)previewTimer=setTimeout(()=>void nativePreviews(epoch),450);
  decorateSelection();refreshTree();foundation?.refresh();assistant.refresh();
 }
 function selectedPage(){const {model}=snapshot();const page=model?.pages.find(p=>p.id===selection?.page)??model?.pages.find(p=>adapter.selected().includes(p.id))??model?.pages[0];if(!page)throw new Error('Open a PDF first.');return page;}
 for(const[kind,label]of [['text','Text'],['rectangle','Rectangle'],['ellipse','Ellipse']]){
  const button=el('button',{type:'button',textContent:label});button.onclick=act(()=>{requireNoDraft();const page=selectedPage(),{box}=pageInfo(page),w=box[2]-box[0],h=box[3]-box[1],id=crypto.randomUUID();const object={id,kind,rect:[box[0]+w*.1,box[1]+h*.45,box[0]+w*.7,box[1]+h*.6],fill:kind==='text'?'111827':'dbeafe',...(kind==='text'?{text:'New text',font:'Helvetica',fontSize:16}:{stroke:'2563eb',strokeWidth:1})};selection={page:page.id,id};adapter.edit({op:'add-object',page:page.id,item:object});insert.open=false;});insertMenu.append(button);
 }
 const imageInput=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true});
 const addImage=el('button',{type:'button',textContent:'Image'});addImage.onclick=act(()=>{requireNoDraft();imageInput.click();});
 function insertAsset(asset,page=selectedPage()){
  requireNoDraft();const {box}=pageInfo(page),width=Math.min((box[2]-box[0])*.6,(box[3]-box[1])*.6*asset.width/asset.height),height=width*asset.height/asset.width,id=crypto.randomUUID(),x=box[0]+(box[2]-box[0])*.1,y=box[1]+(box[3]-box[1])*.1;
  selection={page:page.id,id};adapter.edit({op:'add-object',page:page.id,item:{id,kind:'image',asset:asset.id,rect:[x,y,x+width,y+height]}});insert.open=false;
 }
 imageInput.onchange=async()=>{
  const file=imageInput.files[0];imageInput.value='';if(!file)return;
  try{
   requireNoDraft();const page=selectedPage(),documentId=snapshot().saved.id,revision=snapshot().saved.revision,draft=JSON.stringify(snapshot().ops),selected=JSON.stringify(selection);if(file.size>4194304)throw new Error('Choose an image smaller than 4 MB.');const bitmap=await createImageBitmap(file);
   try{
    if(bitmap.width*bitmap.height>16777216)throw new Error('Choose an image with at most 16 million pixels.');
    let payload=file;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>1048576){
     const canvas=el('canvas',{width:bitmap.width,height:bitmap.height}),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
     const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<255){transparent=true;break;}
     payload=await new Promise(resolve=>canvas.toBlob(resolve,transparent?'image/png':'image/jpeg',.9));
    }
    if(!payload||payload.size>1048576)throw new Error('The prepared image is too large; choose a smaller image.');
    const form=new FormData();form.append('file',payload,file.name);form.append('title',file.name.slice(0,160)||'Image');form.append('requestKey',crypto.randomUUID());
    const asset=await adapter.uploadImage(form);if(snapshot().saved.id===documentId&&snapshot().saved.revision===revision&&JSON.stringify(snapshot().ops)===draft&&JSON.stringify(selection)===selected&&snapshot().model?.pages.some(p=>p.id===page.id))insertAsset(asset,page);else throw new Error('The document changed while the image uploaded. The saved image is available in your image library.');
   }finally{bitmap.close();}
  }catch(error){feedback(error);}
 };
 const assetsSection=el('section',{className:'pane-section pdf-image-library'}),assetSelect=el('select',{ariaLabel:'Saved images'}),insertSaved=el('button',{type:'button',textContent:'Insert saved image'}),deleteSaved=el('button',{type:'button',textContent:'Delete unused image'});
 assetsSection.append(el('h3',{textContent:'Images'}),assetSelect,insertSaved,deleteSaved);main.querySelector('.wb-left').append(assetsSection);
 insertSaved.onclick=act(()=>{const asset=snapshot().assets.find(a=>a.id===assetSelect.value);if(!asset)throw new Error('Choose a saved image.');insertAsset(asset);});
 deleteSaved.onclick=act(async()=>{if(assetSelect.value&&confirm('Delete this unused image? Images kept by saved document history cannot be deleted.')){await adapter.removeImage(assetSelect.value);refreshAssets();}});
 function refreshAssets(){const chosen=assetSelect.value;assetSelect.replaceChildren(...snapshot().assets.map(asset=>el('option',{value:asset.id,textContent:asset.title})));if(snapshot().assets.some(a=>a.id===chosen))assetSelect.value=chosen;insertSaved.disabled=!editable()||!assetSelect.value;deleteSaved.disabled=!snapshot().permissions.delete||!assetSelect.value;}
 insertMenu.append(addImage);toolbar.append(insert,imageInput);
 const removeSelected=el('button',{type:'button',textContent:'Delete object'});removeSelected.onclick=act(()=>{requireNoDraft();const {item,page}=target()??{};if(!item)throw new Error('Select an object.');adapter.edit(item.annotation?{op:'remove-annotation',id:item.id}:{op:'delete-object',page:page.id,object:item.id});selection=null;foundation.refresh();});toolbar.append(removeSelected);
 center.prepend(toolbar);
 // Advanced commands remain available in deliberate sections, rather than a pile of buttons.
 for(const section of [...right.children]){const title=section.querySelector('h3')?.textContent;if(!title)continue;const details=el('details',{className:'pdf-advanced-section'}),summary=el('summary',{textContent:title});details.append(summary,section);right.append(details);}
 const assistant=createEditorAssistant({app:'pdf-workbench',bot:'pdf-editor',title:'PDF AI partner',root,prepare:()=>adapter.prepare(),refresh:context=>adapter.refresh(context),getState:()=>{const s=snapshot();return{documentId:s.saved?.id,revision:s.saved?.revision,selection:selectionIds(),dirty:Boolean(s.ops.length||adapter.formDraft().length||inline||foundation?.hasPending()),busy:Boolean(s.job||s.starting||activeDrag)};}});
 insert.dataset.efMenu='';
 const quickFile=el('input',{type:'file',accept:'application/pdf,.pdf',hidden:true,id:'quick-pdf'});quickFile.setAttribute('aria-label','PDF to open');root.append(quickFile);
 quickFile.onchange=act(async()=>{const file=quickFile.files[0];quickFile.value='';if(file)await adapter.uploadAndOpen(file);});
 const start={when:()=>!snapshot().saved,lede:'Edit a PDF on your phone.',label:'Upload a PDF',input:quickFile,denied:'This seat can read PDFs but not add one.',replaces:center.querySelector('.pages-hint'),
  secondary:[{label:'Blank page',run:()=>adapter.createBlank()},{label:()=>{const count=adapter.documentCount?.()||0;return count?`Your documents (${count})`:'';},panel:'navigation'}]};
 foundation=createEditorFoundation({root,navigationLabel:'Documents',start,header:main.querySelector('.wb-bar'),navigation:main.querySelector('.wb-left'),viewport:center,inspector:right,ai:assistant.element,status:document.getElementById('status'),
  getState:()=>{const s=snapshot();return{documentId:s.saved?.id??null,revision:s.saved?.revision??null,title:s.saved?.title??'PDF workbench',dirty:Boolean(s.ops.length||adapter.formDraft().length||inline||foundation?.hasPending()),busy:Boolean(s.job),readOnly:!editable(),canUndo:s.undo.length>0,canRedo:s.redo.length>0};},
  getSelection:()=>({kind:target()?.item?.kind==='path'?'shape':target()?.item?.kind??'page',ids:selectionIds()}),getProperties:properties,
  applyProperty:(key,value)=>{try{return adapter.edit(operation(key,value));}catch(error){throw new Error(pdfErrorMessage(error.code??error.message));}},actions:{undo:()=>document.getElementById('undo').click(),redo:()=>document.getElementById('redo').click(),save:()=>adapter.save(),export:()=>adapter.export()}});
 main.hidden=true;root.addEventListener('editor-foundation:draft',()=>adapter.controls());
 document.getElementById('download').hidden=true;document.getElementById('save').textContent='Save';
 const exportButton=el('button',{type:'button',textContent:'Export'});exportButton.onclick=act(()=>adapter.export());
 let commandMenu=null;const actions=document.getElementById('actions');if(actions){const menu=el('details',{className:'pdf-command-menu'}),items=el('div',{className:'pdf-menu-items'});commandMenu=menu;menu.append(el('summary',{textContent:'Document'}),items);for(const id of ['cancel-job','delete-document'])items.append(document.getElementById(id));actions.prepend(exportButton);actions.append(menu);}
 for(const item of [exportButton,document.getElementById('undo'),document.getElementById('redo'),document.getElementById('download'),commandMenu].filter(Boolean))item.dataset.efPhone='more';
 function syncButtons(){refreshAssets();removeSelected.disabled=!editable()||!target()?.item?.editable;for(const button of insertMenu.querySelectorAll('button'))button.disabled=!editable()||source(selectedPage())?.contentEditable===false;const s=snapshot();document.getElementById('undo').disabled=!editable()||!s.undo.length;document.getElementById('redo').disabled=!editable()||!s.redo.length;exportButton.disabled=!s.saved||!s.permissions.export;quickFile.disabled=!s.permissions.create;
  const cancel=document.getElementById('cancel-job'),remove=document.getElementById('delete-document');cancel.hidden=!(s.job&&s.permissions['job.manage']);remove.hidden=!s.permissions.delete;if(commandMenu)commandMenu.hidden=cancel.hidden&&remove.hidden;foundation.refresh();}
 root.addEventListener('click',event=>{const current=event.target.closest('.pdf-command-menu');for(const menu of root.querySelectorAll('.pdf-command-menu[open]'))if(menu!==current||event.target.closest('button'))menu.open=false;});
 root.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented)return;const open=[...root.querySelectorAll('.pdf-command-menu[open]')];if(open.length){event.preventDefault();for(const menu of open)menu.open=false;open[0].querySelector('summary').focus();}});
 return{foundation,controls:syncButtons,render:()=>{render();assistant.refresh();syncButtons();},flushInline,discardInline:()=>{inline?.input.remove();inline=null;},hasInline:()=>Boolean(inline),signature:()=>draftEpoch,draftChanged:()=>{foundation.refresh();assistant.refresh();},selectPages:()=>{requireNoDraft();selection=null;decorateSelection();syncButtons();assistant.refresh();},selection:()=>selection?.id?[selection.page+'/'+selection.id]:selection?.page?[selection.page]:adapter.selected()};
}
