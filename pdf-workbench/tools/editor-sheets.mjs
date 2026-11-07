/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Modal workflow sheets for caller signatures (drawn or transparent-background image), multi-photo PDF creation, PDF size reduction and approximate-layout Office exports (.docx, .xlsx, .pptx).
 */
const el=(tag,attrs={})=>Object.assign(document.createElement(tag),attrs);
const uuid=()=>crypto.randomUUID();

export function formatBytes(bytes){
 if(!Number.isFinite(bytes)||bytes<0)return'0 B';
 if(bytes<1024)return`${bytes} B`;
 if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;
 return`${(bytes/1048576).toFixed(2)} MB`;
}

function bufferToBase64(bytes){
 let binary='';const view=new Uint8Array(bytes),chunk=0x8000;
 for(let i=0;i<view.length;i+=chunk)binary+=String.fromCharCode(...view.subarray(i,i+chunk));
 return btoa(binary);
}

async function normalizePhotoFile(file){
 if(!['image/jpeg','image/png'].includes(file.type)&&!/\.(jpe?g|png)$/i.test(file.name))throw new Error('Choose JPEG or PNG photos.');
 const bitmap=await createImageBitmap(file);
 try{
  const maxSide=2200,scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  if(scale===1&&['image/jpeg','image/png'].includes(file.type)&&file.size<=2097152){
   const buf=await file.arrayBuffer();
   return{name:file.name||'photo.jpg',type:file.type,data:bufferToBase64(buf),preview:URL.createObjectURL(file)};
  }
  const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=el('canvas',{width:w,height:h}),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,w,h);
  const outType=file.type==='image/png'&&file.size<=1048576?'image/png':'image/jpeg';
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,outType,0.88));
  if(!blob||blob.size>4194304)throw new Error('Photo is too large even after resizing.');
  return{name:file.name||'photo.jpg',type:outType,data:bufferToBase64(await blob.arrayBuffer()),preview:URL.createObjectURL(blob)};
 }finally{bitmap.close();}
}

async function encodeSignatureImage(file,transparentBg){
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height));
  const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=el('canvas',{width:w,height:h}),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,w,h);
  if(transparentBg){
   const img=ctx.getImageData(0,0,w,h),px=img.data;
   for(let i=0;i<px.length;i+=4)if(px[i]>236&&px[i+1]>236&&px[i+2]>236)px[i+3]=0;
   ctx.putImageData(img,0,0);
  }
  const outType=transparentBg||file.type==='image/png'?'image/png':'image/jpeg';
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,outType,0.92));
  if(!blob||blob.size>1048576)throw new Error('Signature image exceeds 1 MB; choose a smaller image.');
  return{dataBase64:bufferToBase64(await blob.arrayBuffer()),previewUrl:canvas.toDataURL(outType)};
 }finally{bitmap.close();}
}

function bindSignaturePad(canvas,getColor){
 const ctx=canvas.getContext('2d');let hasInk=false;
 ctx.lineCap='round';ctx.lineJoin='round';
 canvas.onpointerdown=event=>{
  if(event.button!==0)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);
  const rect=canvas.getBoundingClientRect(),pt=e=>[(e.clientX-rect.left)*(canvas.width/rect.width),(e.clientY-rect.top)*(canvas.height/rect.height)];
  let prev=pt(event);hasInk=true;ctx.strokeStyle=getColor();ctx.lineWidth=3.2;
  ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(prev[0]+0.1,prev[1]+0.1);ctx.stroke();
  const move=e=>{if(e.pointerId!==event.pointerId)return;const cur=pt(e);ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(cur[0],cur[1]);ctx.stroke();prev=cur;};
  const stop=e=>{if(e.pointerId!==event.pointerId)return;canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',stop);canvas.removeEventListener('pointercancel',stop);};
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
 };
 return{
  clear:()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false;},
  hasInk:()=>hasInk,
  toBase64:async()=>{const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));return bufferToBase64(await blob.arrayBuffer());}
 };
}

function createSavedSignaturesSection({adapter,canPlace,placeById,feedback}){
 const wrap=el('section',{className:'pdf-sig-saved'}),list=el('div',{className:'pdf-sig-list'});
 wrap.append(el('h3',{textContent:'Saved signatures'}),list);
 async function refresh(){
  const {signatures=[]}=await adapter.api('/signatures');list.replaceChildren();
  if(!signatures.length){list.append(el('p',{className:'help',textContent:'No saved signatures yet.'}));return;}
  for(const sig of signatures){
   const row=el('div',{className:'pdf-sig-row'}),img=el('img',{alt:sig.title,src:`/api/pdf-workbench/signatures/${sig.id}/content`}),name=el('span',{className:'pdf-sig-name',textContent:sig.title});
   const useBtn=el('button',{type:'button',className:'primary',textContent:'Place',disabled:!canPlace()});
   useBtn.setAttribute('aria-label',`Place signature ${sig.title}`);useBtn.onclick=async()=>{try{await placeById(sig.id);}catch(e){feedback(e);}};
   const delBtn=el('button',{type:'button',textContent:'Delete',disabled:!adapter.snapshot().permissions.delete});
   delBtn.dataset.dsDestructive='';delBtn.setAttribute('aria-label',`Delete signature ${sig.title}`);
   delBtn.onclick=async()=>{try{if(await adapter.ask(`Delete saved signature "${sig.title}"?`,'Delete signature')){await adapter.del(`/signatures/${sig.id}`);await refresh();}}catch(e){feedback(e);}};
   row.append(img,name,useBtn,delBtn);list.append(row);
  }
 }
 return{wrap,refresh};
}

export async function openSignatureSheet({layers,adapter,canPlace,onPlaceAsset,feedback}){
 const layer=layers.create('Signature','ds-sheet'),body=layer.body;
 const note=el('p',{className:'help pdf-disclosure',textContent:'Drawn or uploaded signatures are visual page placements saved in your personal store, not cryptographic or certified digital signatures.'});
 const placeById=async sigId=>{const res=await adapter.post(`/signatures/${sigId}/place`,{requestKey:uuid()});adapter.registerAsset(res.asset);onPlaceAsset(res.asset);await layers.close(layer.dialog);};
 const saved=createSavedSignaturesSection({adapter,canPlace,placeById,feedback});
 let sourceKind='drawn',uploadedFile=null,encodedUpload=null;
 const tabs=el('div',{className:'row'}),drawTab=el('button',{type:'button',textContent:'Draw'}),imgTab=el('button',{type:'button',textContent:'Upload image'});
 drawTab.setAttribute('aria-pressed','true');imgTab.setAttribute('aria-pressed','false');tabs.append(drawTab,imgTab);
 const drawBox=el('div',{className:'pdf-sig-box'}),canvas=el('canvas',{width:440,height:160,className:'pdf-sig-pad'}),inkColor=el('input',{type:'color',value:'#111827'}),clearBtn=el('button',{type:'button',textContent:'Clear pad'});
 canvas.setAttribute('aria-label','Signature drawing pad');inkColor.setAttribute('aria-label','Signature ink color');
 const pad=bindSignaturePad(canvas,()=>inkColor.value);clearBtn.onclick=()=>pad.clear();
 const padTools=el('div',{className:'row'});padTools.append(inkColor,clearBtn);drawBox.append(canvas,padTools);
 const imgBox=el('div',{className:'pdf-sig-box',hidden:true}),fileIn=el('input',{type:'file',accept:'image/png,image/jpeg'}),bgLabel=el('label',{className:'row'}),bgCheck=el('input',{type:'checkbox',checked:true}),imgPreview=el('img',{className:'pdf-sig-upload-preview',hidden:true,alt:'Uploaded signature preview'});
 fileIn.setAttribute('aria-label','Signature image file');bgLabel.append(bgCheck,document.createTextNode(' Remove white background'));
 const rebuildUpload=async()=>{if(!uploadedFile)return;try{encodedUpload=await encodeSignatureImage(uploadedFile,bgCheck.checked);imgPreview.src=encodedUpload.previewUrl;imgPreview.hidden=false;}catch(e){feedback(e);}};
 fileIn.onchange=()=>{uploadedFile=fileIn.files[0]??null;void rebuildUpload();};bgCheck.onchange=()=>void rebuildUpload();
 imgBox.append(fileIn,bgLabel,imgPreview);
 const switchTab=next=>{sourceKind=next;drawTab.setAttribute('aria-pressed',String(next==='drawn'));imgTab.setAttribute('aria-pressed',String(next==='image'));drawBox.hidden=next!=='drawn';imgBox.hidden=next!=='image';};
 drawTab.onclick=()=>switchTab('drawn');imgTab.onclick=()=>switchTab('image');
 const titleField=el('div',{className:'field wide'}),titleIn=el('input',{value:'My signature',maxLength:160});
 titleIn.setAttribute('aria-label','Signature label');titleField.append(el('label',{textContent:'Signature label'}),titleIn);
 const actions=el('div',{className:'actions'}),saveOnly=el('button',{type:'button',textContent:'Save for later'}),savePlace=el('button',{type:'button',className:'primary',textContent:'Save & place',disabled:!canPlace()});
 const persist=async andPlace=>{
  const dataBase64=sourceKind==='drawn'?(pad.hasInk()?await pad.toBase64():null):encodedUpload?.dataBase64;
  if(!dataBase64)throw new Error(sourceKind==='drawn'?'Draw your signature on the pad first.':'Choose a PNG or JPEG signature image first.');
  const res=await adapter.post('/signatures',{title:titleIn.value.trim()||'My signature',dataBase64,sourceKind,transparentBg:sourceKind==='drawn'?true:Boolean(bgCheck.checked),requestKey:uuid()});
  if(andPlace&&canPlace())await placeById(res.signature.id);else{pad.clear();await saved.refresh();adapter.status('Signature saved to your personal store.');}
 };
 saveOnly.onclick=async()=>{try{await persist(false);}catch(e){feedback(e);}};savePlace.onclick=async()=>{try{await persist(true);}catch(e){feedback(e);}};
 actions.append(saveOnly,savePlace);body.append(note,saved.wrap,el('hr',{className:'ds-menu-sep'}),tabs,drawBox,imgBox,titleField,actions);
 await saved.refresh();await layers.open(layer);
}

export async function openPhotosSheet({layers,adapter,feedback}){
 const layer=layers.create('Create PDF from photos','ds-sheet'),body=layer.body,items=[];
 const titleWrap=el('div',{className:'field wide'}),titleIn=el('input',{maxLength:160,placeholder:'Defaults to first photo name'});
 titleIn.setAttribute('aria-label','Document title');titleWrap.append(el('label',{textContent:'Document title'}),titleIn);
 const pickIn=el('input',{type:'file',accept:'image/jpeg,image/png',multiple:true,hidden:true}),camIn=el('input',{type:'file',accept:'image/jpeg,image/png',hidden:true});
 camIn.setAttribute('capture','environment');pickIn.setAttribute('aria-label','Choose photos');camIn.setAttribute('aria-label','Take photo');
 const pickBtn=el('button',{type:'button',textContent:'Choose photos…'}),camBtn=el('button',{type:'button',textContent:'Take photo…'}),pickRow=el('div',{className:'row'});
 pickBtn.onclick=()=>pickIn.click();camBtn.onclick=()=>camIn.click();pickRow.append(pickBtn,camBtn,pickIn,camIn);
 const list=el('div',{className:'pdf-photo-list'}),createBtn=el('button',{type:'button',className:'primary',textContent:'Create PDF',disabled:true});
 function renderList(){
  list.replaceChildren();createBtn.disabled=!items.length;
  items.forEach((item,idx)=>{
   const row=el('div',{className:'pdf-photo-row'}),thumb=el('img',{src:item.preview,alt:item.name}),name=el('span',{className:'pdf-sig-name',textContent:`${idx+1}. ${item.name}`});
   const up=el('button',{type:'button',className:'pdf-tool',textContent:'Earlier',disabled:idx===0}),down=el('button',{type:'button',className:'pdf-tool',textContent:'Later',disabled:idx===items.length-1}),rm=el('button',{type:'button',className:'pdf-tool',textContent:'Remove'});
   up.setAttribute('aria-label',`Move photo ${idx+1} earlier`);down.setAttribute('aria-label',`Move photo ${idx+1} later`);rm.setAttribute('aria-label',`Remove photo ${idx+1}`);
   up.onclick=()=>{[items[idx-1],items[idx]]=[items[idx],items[idx-1]];renderList();};
   down.onclick=()=>{[items[idx],items[idx+1]]=[items[idx+1],items[idx]];renderList();};
   rm.onclick=()=>{URL.revokeObjectURL(item.preview);items.splice(idx,1);renderList();};
   row.append(thumb,name,up,down,rm);list.append(row);
  });
 }
 async function addFiles(fileList){
  for(const file of [...fileList]){if(items.length>=32)break;try{items.push(await normalizePhotoFile(file));}catch(e){feedback(e);}}
  if(items.length&&!titleIn.value.trim())titleIn.value=items[0].name.replace(/\.(jpe?g|png)$/i,'').slice(0,160)||'Photos';
  renderList();
 }
 pickIn.onchange=()=>{void addFiles(pickIn.files);pickIn.value='';};camIn.onchange=()=>{void addFiles(camIn.files);camIn.value='';};
 createBtn.onclick=async()=>{
  createBtn.disabled=true;
  try{
   const title=(titleIn.value.trim()||items[0]?.name.replace(/\.(jpe?g|png)$/i,'')||'Photos').slice(0,160);
   const res=await adapter.post('/documents/from-photos',{title,photos:items.map(({name,type,data})=>({name,type,data})),requestKey:uuid()});
   for(const it of items)URL.revokeObjectURL(it.preview);
   await adapter.listDocuments();await layers.close(layer.dialog);await adapter.openDocument(res.document.id);adapter.status(`Created ${title} (${items.length} page(s)).`);
  }catch(e){createBtn.disabled=!items.length;feedback(e);}
 };
 const actions=el('div',{className:'actions'});actions.append(createBtn);
 body.append(el('p',{className:'help',textContent:'Select up to 32 JPEG or PNG photos. Reorder them before creating a multi-page PDF.'}),titleWrap,pickRow,list,actions);
 await layers.open(layer);
}

export async function openCompressSheet({layers,adapter,feedback}){
 const layer=layers.create('Reduce file size','ds-sheet'),body=layer.body;
 const field=el('div',{className:'field wide'}),select=el('select');select.setAttribute('aria-label','Compression level');
 select.append(el('option',{value:'balanced',textContent:'Balanced (150 DPI, quality 72)'}),el('option',{value:'maximum',textContent:'Smaller file (110 DPI, quality 52)'}));
 field.append(el('label',{textContent:'Compression level'}),select);
 const outcome=el('div',{className:'pdf-sheet-result',hidden:true}),runBtn=el('button',{type:'button',className:'primary',textContent:'Reduce file size'});
 runBtn.onclick=async()=>{
  runBtn.disabled=true;
  try{
   const s=adapter.snapshot();if(!s.saved)throw new Error('Open a PDF first.');
   if(s.ops.length||adapter.formDraft().length)await adapter.save(true);
   const docId=adapter.snapshot().saved.id,res=await adapter.post(`/documents/${docId}/compress`,{level:select.value,requestKey:uuid()});
   await adapter.listDocuments();await adapter.openDocument(docId,res.revision);
   const pct=res.beforeBytes>0?Math.round(res.savedBytes/res.beforeBytes*100):0;
   outcome.replaceChildren(
    el('p',{textContent:`Before: ${formatBytes(res.beforeBytes)} · After: ${formatBytes(res.afterBytes)} · Saved: ${formatBytes(res.savedBytes)} (${pct}%)`}),
    Object.assign(el('a',{className:'btn primary',href:res.downloadUrl,textContent:'Download compressed PDF'}),{download:'compressed.pdf'})
   );
   outcome.hidden=false;adapter.status(`Saved compressed revision ${res.revision} (${formatBytes(res.beforeBytes)} → ${formatBytes(res.afterBytes)}).`);
  }catch(e){feedback(e);}finally{runBtn.disabled=false;}
 };
 const actions=el('div',{className:'actions'});actions.append(runBtn);
 body.append(el('p',{className:'help',textContent:'Recompresses embedded images and PDF streams as a new revision. Your original source and earlier revisions remain intact.'}),field,actions,outcome);
 await layers.open(layer);
}

export async function openConvertSheet({layers,adapter,initialFormat='docx',feedback}){
 const layer=layers.create('Convert PDF','ds-sheet'),body=layer.body;
 const field=el('div',{className:'field wide'}),select=el('select');select.setAttribute('aria-label','Output format');
 for(const[val,text]of [['docx','Word document (.docx)'],['xlsx','Excel workbook (.xlsx)'],['pptx','PowerPoint presentation (.pptx)']])select.append(el('option',{value:val,textContent:text}));
 select.value=initialFormat;field.append(el('label',{textContent:'Output format'}),select);
 const outcome=el('div',{className:'pdf-sheet-result',hidden:true}),runBtn=el('button',{type:'button',className:'primary',textContent:'Convert & download'});
 runBtn.onclick=async()=>{
  runBtn.disabled=true;
  try{
   const s=adapter.snapshot();if(!s.saved)throw new Error('Open a PDF first.');
   if((s.ops.length||adapter.formDraft().length)&&s.permissions.change)await adapter.save(true);
   const cur=adapter.snapshot().saved,res=await adapter.post(`/documents/${cur.id}/convert`,{format:select.value,revision:cur.revision});
   const link=Object.assign(el('a',{className:'btn primary',href:res.downloadUrl,textContent:`Download ${res.filename}`}),{download:res.filename});
   outcome.replaceChildren(el('p',{textContent:`Ready: ${res.filename} (${formatBytes(res.bytes)})`}),link);
   outcome.hidden=false;adapter.status(`Converted ${cur.title} to ${res.filename}.`);
  }catch(e){feedback(e);}finally{runBtn.disabled=false;}
 };
 const actions=el('div',{className:'actions'});actions.append(runBtn);
 body.append(el('p',{className:'help pdf-disclosure',textContent:'Converted Office files reconstruct paragraphs, detected tables and embedded images approximately; complex multi-column PDF layouts may shift.'}),field,actions,outcome);
 await layers.open(layer);
}
