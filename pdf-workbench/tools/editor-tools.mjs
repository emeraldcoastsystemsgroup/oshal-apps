/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Interactive PDF page tools: word-level QuadPoints markup selection, long-press drag handles, single-finger ink with two-finger scroll, stroke eraser, check/cross form marks, corner resize handles and single/two-page/night view controller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reader parity (CREATE-TOOL-PDF-WORKBENCH-03): add word-bar Copy and Sentence selection (including read-only viewers), selectable HTML text layer, zoom/fit-width + pinch-to-zoom, page jump input, print button and goToPage() navigation.
 */
import {validateContentProperties} from './content-model.mjs';

const el=(tag,attrs={})=>Object.assign(document.createElement(tag),attrs);
const clamp=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
export const MARKUP_COLORS={highlight:'ffcc00',underline:'2563eb',strikethrough:'dc2626',pen:'1d4ed8',note:'ffcc00'};

function pointToSegmentDistSq(px,py,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,lenSq=dx*dx+dy*dy;
 if(lenSq<1e-6)return(px-ax)**2+(py-ay)**2;
 const t=clamp(((px-ax)*dx+(py-ay)*dy)/lenSq,0,1);
 return(px-(ax+t*dx))**2+(py-(ay+t*dy))**2;
}

function nearestWordIndex(words,pt,maxDist=18){
 let best=-1,bestDist=maxDist*maxDist;
 for(let i=0;i<words.length;i++){
  const [x0,y0,x1,y1]=words[i].rect;
  const cx=clamp(pt[0],x0,x1),cy=clamp(pt[1],y0,y1),d=(pt[0]-cx)**2+(pt[1]-cy)**2;
  if(d<=bestDist){bestDist=d;best=i;}
 }
 return best;
}

export function selectWordsForDrag(words,startPt,endPt){
 if(!words?.length)return[];
 const i0=nearestWordIndex(words,startPt,14),i1=nearestWordIndex(words,endPt,14);
 if(i0>=0&&i1>=0)return words.slice(Math.min(i0,i1),Math.max(i0,i1)+1);
 const box=[Math.min(startPt[0],endPt[0]),Math.min(startPt[1],endPt[1]),Math.max(startPt[0],endPt[0]),Math.max(startPt[1],endPt[1])];
 return words.filter(({rect:r})=>r[0]<box[2]&&r[2]>box[0]&&r[1]<box[3]&&r[3]>box[1]);
}

export function buildQuadMarkup(chosen,cropBox){
 const lines=new Map();
 for(const word of chosen){
  const key=word.line??0,cur=lines.get(key);
  if(!cur)lines.set(key,[...word.rect]);
  else{cur[0]=Math.min(cur[0],word.rect[0]);cur[1]=Math.min(cur[1],word.rect[1]);cur[2]=Math.max(cur[2],word.rect[2]);cur[3]=Math.max(cur[3],word.rect[3]);}
 }
 const merged=[...lines.values()].slice(0,64).map(r=>[
  Number(clamp(r[0],cropBox[0],cropBox[2]).toFixed(3)),Number(clamp(r[1],cropBox[1],cropBox[3]).toFixed(3)),
  Number(clamp(r[2],cropBox[0],cropBox[2]).toFixed(3)),Number(clamp(r[3],cropBox[1],cropBox[3]).toFixed(3))
 ]).filter(r=>r[2]-r[0]>=0.5&&r[3]-r[1]>=0.5);
 if(!merged.length)return null;
 const rect=[Math.min(...merged.map(r=>r[0])),Math.min(...merged.map(r=>r[1])),Math.max(...merged.map(r=>r[2])),Math.max(...merged.map(r=>r[3]))];
 const quadPoints=merged.map(([x0,y0,x1,y1])=>[x0,y1,x1,y1,x0,y0,x1,y0]);
 return{rect,quadPoints};
}

async function copyPlainText(text){
 if(!text)return false;
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{/* fallback below */}
 try{const area=el('textarea',{value:text});Object.assign(area.style,{position:'fixed',opacity:'0',pointerEvents:'none'});document.body.append(area);area.select();const ok=document.execCommand?.('copy');area.remove();return Boolean(ok);}catch{return false;}
}

export function createWordSelector({adapter,screenToPdf,screenRect,onApplyMarkup,isEditable=()=>true,feedback}){
 const cache=new Map();
 let state=null;
 async function getWords(saved,pageId){
  if(!saved||!saved.model.pages.some(p=>p.id===pageId))return[];
  const key=`${saved.id}:${saved.revision}:${pageId}`;
  if(!cache.has(key))cache.set(key,adapter.api(`/documents/${saved.id}/pages/${pageId}/words?revision=${saved.revision}`).then(r=>r.words??[]).catch(()=>[]));
  return cache.get(key);
 }
 function clear(){state?.layer?.remove();state=null;}
 function chosenWords(){
  if(!state)return[];
  const lo=Math.min(state.startIdx,state.endIdx),hi=Math.max(state.startIdx,state.endIdx);
  return state.words.slice(lo,hi+1);
 }
 function expandSentence(){
  if(!state)return;
  const cur=state.words[state.startIdx];if(!cur?.rect)return;
  const cy=(cur.rect[1]+cur.rect[3])/2,tol=Math.max(8,(cur.rect[3]-cur.rect[1])*0.85);
  const sameLine=state.words.map((w,i)=>w.rect&&Math.abs((w.rect[1]+w.rect[3])/2-cy)<=tol?i:-1).filter(i=>i>=0);
  if(sameLine.length){state.startIdx=sameLine[0];state.endIdx=sameLine.at(-1);renderSelection();}
 }
 async function copySelected(){
  const words=chosenWords(),text=words.map(w=>w.text).join(' ').trim();
  if(!text)return;
  document.body.dataset.pdfCopiedText=text;
  await copyPlainText(text);
  adapter.status?.(`Copied ${words.length} word(s).`);
 }
 function applySelected(kind,color){
  if(!state)return false;
  const built=buildQuadMarkup(chosenWords(),state.info.box);
  if(!built)return false;
  const pageId=state.pageId;clear();
  onApplyMarkup(pageId,kind,built.rect,built.quadPoints,color);
  return true;
 }
 function renderSelection(){
  if(!state)return;
  state.layer.replaceChildren();
  const selected=chosenWords();if(!selected.length)return;
  const sRects=selected.map(w=>screenRect(w.rect,state.info.box,state.info.rotation));
  for(const r of sRects){
   const box=el('span',{className:'pdf-word-highlight'});
   Object.assign(box.style,{left:r[0]*100+'%',top:r[1]*100+'%',width:(r[2]-r[0])*100+'%',height:(r[3]-r[1])*100+'%'});
   state.layer.append(box);
  }
  const first=sRects[0],last=sRects.at(-1);
  for(const[which,pos]of [['start',[first[0],first[3]]],['end',[last[2],last[3]]]]){
   const handle=el('button',{type:'button',className:`pdf-word-handle is-${which}`});
   handle.dataset.handle=which;handle.setAttribute('aria-label',`Selection ${which} handle`);
   Object.assign(handle.style,{left:pos[0]*100+'%',top:pos[1]*100+'%'});
   bindHandleDrag(handle,which);state.layer.append(handle);
  }
  const bar=el('div',{className:'pdf-word-bar'});bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Selected text markup');
  const topY=Math.min(...sRects.map(r=>r[1])),below=topY<=.24,leftX=clamp((first[0]+last[2])/2,.15,.85);
  bar.classList.toggle('is-below',below);
  Object.assign(bar.style,{left:leftX*100+'%',top:(below?Math.max(...sRects.map(r=>r[3]))+.02:topY-.015)*100+'%'});
  const copyBtn=el('button',{type:'button',className:'pdf-tool',textContent:'Copy'});copyBtn.setAttribute('aria-label','Copy selected text');
  copyBtn.onclick=e=>{e.stopPropagation();void copySelected().catch(feedback);};bar.append(copyBtn);
  const lineBtn=el('button',{type:'button',className:'pdf-tool',textContent:'Sentence'});lineBtn.setAttribute('aria-label','Select full line');
  lineBtn.onclick=e=>{e.stopPropagation();expandSentence();};bar.append(lineBtn);
  if(isEditable()){
   for(const[kind,label]of [['highlight','Highlight'],['underline','Underline'],['strikethrough','Strikethrough']]){
    const btn=el('button',{type:'button',className:'pdf-tool',textContent:label});
    btn.onclick=e=>{e.stopPropagation();try{applySelected(kind);}catch(err){feedback(err);}};bar.append(btn);
   }
  }
  const dismiss=el('button',{type:'button',className:'pdf-tool',textContent:'×'});dismiss.setAttribute('aria-label','Clear text selection');
  dismiss.onclick=e=>{e.stopPropagation();clear();};bar.append(dismiss);
  state.layer.append(bar);
 }
 function bindHandleDrag(handle,which){
  handle.onpointerdown=event=>{
   event.stopPropagation();event.preventDefault();handle.setPointerCapture(event.pointerId);
   const bounds=state.stage.getBoundingClientRect();
   const move=e=>{
    if(e.pointerId!==event.pointerId||!state)return;
    const u=clamp((e.clientX-bounds.left)/bounds.width,0,1),v=clamp((e.clientY-bounds.top)/bounds.height,0,1);
    const idx=nearestWordIndex(state.words,screenToPdf(u,v,state.info.box,state.info.rotation),48);
    if(idx>=0){if(which==='start')state.startIdx=idx;else state.endIdx=idx;renderSelection();}
   };
   const stop=e=>{if(e.pointerId!==event.pointerId)return;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);};
   handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
  };
 }
 async function selectAt(saved,page,stage,info,u,v){
  const words=await getWords(saved,page.id);if(!words.length)return false;
  const idx=nearestWordIndex(words,screenToPdf(u,v,info.box,info.rotation),20);if(idx<0)return false;
  clear();const layer=el('div',{className:'pdf-word-selection'});stage.append(layer);
  state={pageId:page.id,stage,info,words,startIdx:idx,endIdx:idx,layer};renderSelection();return true;
 }
 return{getWords,clear,hasSelection:()=>Boolean(state),applySelected,selectAt};
}

export function startInkDraw(event,{page,stage,info,color,strokeWidth,pointers,center,screenToPdf,onCommit,feedback}){
 const bounds=stage.getBoundingClientRect(),at=e=>[clamp((e.clientX-bounds.left)/bounds.width,0,1),clamp((e.clientY-bounds.top)/bounds.height,0,1)];
 pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
 if(pointers.size>1)return;
 event.preventDefault();stage.setPointerCapture?.(event.pointerId);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
 svg.setAttribute('class','pdf-live-ink');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');
 poly.setAttribute('fill','none');poly.setAttribute('stroke','#'+color);poly.setAttribute('stroke-width',String(Math.max(2,strokeWidth*1.5)));poly.setAttribute('stroke-linecap','round');poly.setAttribute('stroke-linejoin','round');
 svg.append(poly);stage.append(svg);
 const samples=[at(event)];let cancelled=false;
 const updatePoly=()=>poly.setAttribute('points',samples.map(([u,v])=>`${(u*1000).toFixed(1)},${(v*1000).toFixed(1)}`).join(' '));updatePoly();
 const move=e=>{
  if(pointers.has(e.pointerId)){const prev=pointers.get(e.pointerId);if(pointers.size>=2){if(!cancelled){cancelled=true;svg.remove();}center.scrollTop-=e.clientY-prev.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});return;}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});}
  if(e.pointerId!==event.pointerId||cancelled)return;
  if(pointers.size>=2){cancelled=true;svg.remove();return;}
  const next=at(e),last=samples.at(-1);if(Math.hypot(next[0]-last[0],next[1]-last[1])>=0.002){samples.push(next);updatePoly();}
 };
 const finish=e=>{
  pointers.delete(e.pointerId);if(e.pointerId!==event.pointerId)return;
  stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',finish);stage.removeEventListener('pointercancel',abort);svg.remove();
  if(cancelled||samples.length<2)return;
  try{
   const step=Math.max(1,Math.ceil(samples.length/200)),picked=samples.filter((_,i)=>i%step===0||i===samples.length-1).slice(0,256);
   const pts=picked.map(([u,v])=>screenToPdf(u,v,info.box,info.rotation).map(n=>Number(clamp(n,info.box[0]+0.2,info.box[2]-0.2).toFixed(2))));
   for(const p of pts){p[0]=Number(clamp(p[0],info.box[0],info.box[2]).toFixed(2));p[1]=Number(clamp(p[1],info.box[1],info.box[3]).toFixed(2));}
   let x0=Math.min(...pts.map(p=>p[0])),y0=Math.min(...pts.map(p=>p[1])),x1=Math.max(...pts.map(p=>p[0])),y1=Math.max(...pts.map(p=>p[1]));
   if(x1-x0<1){x0=Math.max(info.box[0],x0-0.6);x1=Math.min(info.box[2],x1+0.6);}
   if(y1-y0<1){y0=Math.max(info.box[1],y0-0.6);y1=Math.min(info.box[3],y1+0.6);}
   onCommit({id:crypto.randomUUID(),page:page.id,kind:'ink',rect:[Number(x0.toFixed(2)),Number(y0.toFixed(2)),Number(x1.toFixed(2)),Number(y1.toFixed(2))],points:pts,color,strokeWidth});
  }catch(err){feedback(err);}
 };
 const abort=e=>{cancelled=true;finish(e);};
 stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',finish);stage.addEventListener('pointercancel',abort);
}

export function startEraserPass(event,{page,stage,info,getAnnotations,screenToPdf,onErase,feedback}){
 event.preventDefault();stage.setPointerCapture?.(event.pointerId);
 const bounds=stage.getBoundingClientRect(),erased=new Set();
 const eraseAt=e=>{
  const u=clamp((e.clientX-bounds.left)/bounds.width,0,1),v=clamp((e.clientY-bounds.top)/bounds.height,0,1),[px,py]=screenToPdf(u,v,info.box,info.rotation);
  for(const ann of getAnnotations()){
   if(ann.page!==page.id||ann.kind!=='ink'||erased.has(ann.id))continue;
   const tol=Math.max(10,(ann.strokeWidth??2)*2.5),tolSq=tol*tol,pts=ann.points??[];
   const hit=pts.some((p,i)=>i>0&&pointToSegmentDistSq(px,py,pts[i-1][0],pts[i-1][1],p[0],p[1])<=tolSq)||(px>=ann.rect[0]-tol&&px<=ann.rect[2]+tol&&py>=ann.rect[1]-tol&&py<=ann.rect[3]+tol&&pts.length<2);
   if(hit){erased.add(ann.id);try{onErase(ann.id);}catch(err){feedback(err);}}
  }
 };
 eraseAt(event);
 const move=e=>{if(e.pointerId===event.pointerId)eraseAt(e);};
 const stop=e=>{if(e.pointerId!==event.pointerId)return;stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',stop);stage.removeEventListener('pointercancel',stop);};
 stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',stop);stage.addEventListener('pointercancel',stop);
}

export function placeMarkObject(u,v,{page,info,kind,size,color,screenToPdf}){
 const [cx,cy]=screenToPdf(u,v,info.box,info.rotation),s=clamp(Number(size)||20,10,64);
 const x0=clamp(cx-s/2,info.box[0]+1,Math.max(info.box[0]+1,info.box[2]-s-1));
 const y0=clamp(cy-s/2,info.box[1]+1,Math.max(info.box[1]+1,info.box[3]-s-1));
 const rect=[Number(x0.toFixed(2)),Number(y0.toFixed(2)),Number(Math.min(info.box[2],x0+s).toFixed(2)),Number(Math.min(info.box[3],y0+s).toFixed(2))];
 return{op:'add-object',page:page.id,item:{id:crypto.randomUUID(),kind,rect,stroke:color||'111827',strokeWidth:Number(Math.max(1.6,s*0.11).toFixed(2))}};
}

export function syncResizeHandle(node,{item,page,stage,info,selected,editable,screenRect,screenToPdf,onResize,feedback}){
 const resizable=selected&&editable&&item.editable&&!item.annotation&&['image','rectangle','ellipse','check','cross'].includes(item.kind);
 let handle=node.querySelector('.pdf-resize-handle');
 if(!resizable){handle?.remove();return;}
 if(!handle){handle=el('span',{className:'pdf-resize-handle'});handle.setAttribute('aria-label','Resize object');node.append(handle);}
 handle.onpointerdown=event=>{
  event.stopPropagation();event.preventDefault();handle.setPointerCapture(event.pointerId);
  const bounds=stage.getBoundingClientRect(),sr=screenRect(item.rect,info.box,info.rotation);
  let nextScreen=[...sr],moved=false;
  const move=e=>{
   if(e.pointerId!==event.pointerId)return;moved=true;
   const u=clamp((e.clientX-bounds.left)/bounds.width,sr[0]+0.015,1),v=clamp((e.clientY-bounds.top)/bounds.height,sr[1]+0.015,1);
   nextScreen=[sr[0],sr[1],u,v];
   Object.assign(node.style,{width:(u-sr[0])*100+'%',height:(v-sr[1])*100+'%'});
  };
  const finish=e=>{
   if(e.pointerId!==event.pointerId)return;
   handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);
   if(!moved)return;
   try{
    const a=screenToPdf(nextScreen[0],nextScreen[1],info.box,info.rotation),b=screenToPdf(nextScreen[2],nextScreen[3],info.box,info.rotation);
    const rect=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])].map(n=>Number(n.toFixed(2)));
    validateContentProperties({rect},item.kind,info.box,undefined,item);
    onResize({op:'update-object',page:page.id,object:item.id,properties:{rect}});
   }catch(err){feedback(err);}
  };
  const cancel=e=>{moved=false;finish(e);};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);
 };
}

function renderSelectableLayer(stage,words,info,screenRect){
 let layer=stage.querySelector('.pdf-text-layer');
 if(!layer){layer=el('div',{className:'pdf-text-layer'});layer.setAttribute('aria-label','Selectable page text');stage.append(layer);}
 layer.replaceChildren();
 for(const w of words){
  if(!Array.isArray(w.rect)||w.rect.length!==4)continue;
  const r=screenRect(w.rect,info.box,info.rotation),span=el('span',{className:'pdf-text-word',textContent:w.text+' '});
  Object.assign(span.style,{left:r[0]*100+'%',top:r[1]*100+'%',width:Math.max(0.5,(r[2]-r[0])*100)+'%',height:Math.max(0.5,(r[3]-r[1])*100)+'%'});
  layer.append(span);
 }
}

function bindPinchZoom(host,getZoom,setZoom){
 let startDist=0,startZoom=1;
 const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
 host.addEventListener('touchstart',e=>{if(e.touches.length===2&&!document.body.dataset.pdfTool){startDist=dist(e.touches);startZoom=getZoom();}},{passive:true});
 host.addEventListener('touchmove',e=>{if(e.touches.length===2&&startDist>10&&!document.body.dataset.pdfTool){e.preventDefault();setZoom(startZoom*(dist(e.touches)/startDist),{fit:false});}},{passive:false});
 host.addEventListener('touchend',e=>{if(e.touches.length<2)startDist=0;},{passive:true});
}

function buildReaderBar(actions){
 const bar=el('div',{className:'pdf-pager pdf-reader-bar',hidden:true});
 bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','PDF reader controls');
 const prev=el('button',{type:'button',className:'pdf-tool',textContent:'Previous'});prev.setAttribute('aria-label','Previous page');
 const jump=el('input',{id:'pdf-page-jump',type:'number',min:'1',className:'pdf-page-jump',value:'1'});jump.setAttribute('aria-label','Jump to page');
 const label=el('span',{className:'pdf-pager-label'});
 const next=el('button',{type:'button',className:'pdf-tool',textContent:'Next'});next.setAttribute('aria-label','Next page');
 const zoomOut=el('button',{type:'button',className:'pdf-tool',textContent:'−'});zoomOut.setAttribute('aria-label','Zoom out');
 const zoomVal=el('span',{className:'pdf-zoom-readout',textContent:'100%'});zoomVal.setAttribute('aria-label','Zoom level');
 const zoomIn=el('button',{type:'button',className:'pdf-tool',textContent:'+'});zoomIn.setAttribute('aria-label','Zoom in');
 const fitBtn=el('button',{type:'button',className:'pdf-tool',textContent:'Fit'});fitBtn.setAttribute('aria-label','Fit width');fitBtn.setAttribute('aria-pressed','true');
 const selectBtn=el('button',{type:'button',className:'pdf-tool',textContent:'Select text'});selectBtn.setAttribute('aria-label','Select text');selectBtn.setAttribute('aria-pressed','false');
 const printBtn=el('button',{type:'button',className:'pdf-tool',textContent:'Print'});printBtn.setAttribute('aria-label','Print PDF');
 prev.onclick=()=>actions.turn(-1);next.onclick=()=>actions.turn(1);
 jump.onchange=()=>{const n=Number(jump.value);if(Number.isInteger(n)&&n>=1&&n!==actions.currentPage())actions.goToPage(n);};
 jump.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const n=Number(jump.value);if(Number.isInteger(n)&&n>=1)actions.goToPage(n);jump.blur();}};
 zoomOut.onclick=()=>actions.stepZoom(-0.25);zoomIn.onclick=()=>actions.stepZoom(0.25);
 fitBtn.onclick=()=>actions.fitWidth();selectBtn.onclick=()=>actions.toggleSelectText();printBtn.onclick=()=>window.print();
 const nav=el('div',{className:'pdf-reader-group'}),zoom=el('div',{className:'pdf-reader-group'});
 nav.append(prev,jump,label,next);zoom.append(zoomOut,zoomVal,zoomIn,fitBtn,selectBtn,printBtn);
 bar.append(nav,zoom);
 return{bar,prev,jump,label,next,zoomOut,zoomVal,zoomIn,fitBtn,selectBtn,printBtn};
}

export function createViewController({root,pagesHost,adapter,feedback,screenRect,getWords,pageInfo}){
 let prefs={pageLayout:'continuous',nightMode:false},pageIndex=0,zoom=1,fitWidth=true,selectText=false;
 const ui=buildReaderBar({
  turn:delta=>turn(delta),goToPage:n=>goToPage(n),currentPage:()=>pageIndex+1,stepZoom:d=>setZoom(zoom+d,{fit:false}),
  fitWidth:()=>setZoom(1,{fit:true}),toggleSelectText:()=>{selectText=!selectText;syncDom();}
 });
 pagesHost.before(ui.bar);
 bindPinchZoom(pagesHost,()=>zoom,(z,opts)=>setZoom(z,opts));
 async function syncTextLayers(){
  const stages=[...pagesHost.querySelectorAll('[data-pdf-stage]')];
  if(!selectText){for(const st of stages)st.querySelector('.pdf-text-layer')?.remove();return;}
  if(!getWords||!screenRect||!pageInfo)return;
  const s=adapter.snapshot();if(!s.saved||!s.model)return;
  for(const stage of stages){
   const page=s.model.pages.find(p=>p.id===stage.dataset.pdfStage);if(!page)continue;
   const words=await getWords(page.id),info=pageInfo(page);
   if(selectText&&info?.box&&stage.isConnected)renderSelectableLayer(stage,words,info,screenRect);
  }
 }
 function syncDom(){
  root.dataset.pdfLayout=prefs.pageLayout;root.dataset.pdfNight=prefs.nightMode?'true':'false';
  root.dataset.pdfZoom=String(Math.round(zoom*100));root.dataset.pdfFitWidth=fitWidth?'true':'false';
  root.dataset.pdfSelectText=selectText?'true':'false';
  pagesHost.style.setProperty('--pdf-zoom',String(zoom));
  const cards=[...pagesHost.querySelectorAll(':scope > .page')],total=cards.length;
  pageIndex=total?clamp(pageIndex,0,total-1):0;
  cards.forEach((card,i)=>card.classList.toggle('is-current-page',i===pageIndex));
  const show=root.dataset.pdfView==='document'&&total>0;
  ui.bar.hidden=!show;
  if(show){
   ui.label.textContent=`Page ${pageIndex+1} of ${total}`;ui.jump.max=String(total);ui.jump.value=String(pageIndex+1);
   ui.prev.disabled=pageIndex<=0;ui.next.disabled=pageIndex>=total-1;
   ui.zoomVal.textContent=`${Math.round(zoom*100)}%`;ui.zoomOut.disabled=zoom<=0.5;ui.zoomIn.disabled=zoom>=3;
   ui.fitBtn.setAttribute('aria-pressed',String(fitWidth));ui.selectBtn.setAttribute('aria-pressed',String(selectText));
  }
  void syncTextLayers();
 }
 function setZoom(nextZoom,{fit=false}={}){zoom=Number(clamp(nextZoom,0.5,3).toFixed(2));fitWidth=Boolean(fit);syncDom();}
 function goToPage(oneBased,{scroll=true,updateUrl=true}={}){
  const cards=[...pagesHost.querySelectorAll(':scope > .page')],total=cards.length;if(!total)return false;
  const target=clamp(Math.trunc(Number(oneBased)||1),1,total);
  pageIndex=target-1;syncDom();
  if(scroll&&cards[pageIndex])cards[pageIndex].scrollIntoView?.({block:'start',behavior:'auto'});
  const docId=adapter.snapshot().saved?.id;
  if(updateUrl&&docId)try{const u=new URL(location.href);u.searchParams.set('document',docId);u.searchParams.set('page',String(target));history.replaceState(history.state,'',u.pathname+u.search);}catch{/* embedded */}
  adapter.status?.(`Page ${target} of ${total}`);
  return true;
 }
 function turn(delta){const total=pagesHost.querySelectorAll(':scope > .page').length;if(!total)return;goToPage(pageIndex+1+delta,{scroll:true,updateUrl:true});}
 async function savePrefs(patch){
  prefs={...prefs,...patch};syncDom();
  try{const res=await adapter.put('/preferences',{pageLayout:prefs.pageLayout,nightMode:prefs.nightMode});if(res?.preferences)prefs=res.preferences;syncDom();}catch(err){feedback(err);}
 }
 async function load(){try{const res=await adapter.api('/preferences');if(res?.preferences)prefs=res.preferences;syncDom();}catch{/* default view preferences apply */}}
 return{load,syncDom,turn,goToPage,setZoom,getZoom:()=>({zoom,fitWidth,page:pageIndex+1}),getPrefs:()=>({...prefs}),setLayout:pageLayout=>savePrefs({pageLayout}),toggleNight:()=>savePrefs({nightMode:!prefs.nightMode})};
}
