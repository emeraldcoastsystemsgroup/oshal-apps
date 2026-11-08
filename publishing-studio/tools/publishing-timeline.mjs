/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: per-item animation presets, collapsible video timeline preview playback, and async H.264 MP4 video rendering/download (RP-PUB-08).
 */
const make=(doc,tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const PRESETS=[
 ['','None (static)'],
 ['fade-in','Fade in'],
 ['rise','Rise'],
 ['pan-left','Pan left'],
 ['pan-right','Pan right'],
 ['pop','Pop'],
 ['wipe','Wipe'],
];

function computeTransform(anim,localTime){
 if(!anim?.preset)return{opacity:'1',transform:'',clipPath:''};
 const delay=Number(anim.delay??0),dur=Math.max(0.1,Number(anim.duration??0.8));
 const raw=(localTime-delay)/dur,t=Math.max(0,Math.min(1,raw));
 const ease=1-Math.pow(1-t,3);
 switch(anim.preset){
  case'fade-in':return{opacity:String(ease.toFixed(3)),transform:'',clipPath:''};
  case'rise':return{opacity:String(ease.toFixed(3)),transform:`translate(0px, ${((1-ease)*28).toFixed(1)}px)`,clipPath:''};
  case'pan-left':return{opacity:String(ease.toFixed(3)),transform:`translate(${((1-ease)*40).toFixed(1)}px, 0px)`,clipPath:''};
  case'pan-right':return{opacity:String(ease.toFixed(3)),transform:`translate(${(-(1-ease)*40).toFixed(1)}px, 0px)`,clipPath:''};
  case'pop':{const sc=0.82+0.18*ease;return{opacity:String(ease.toFixed(3)),transform:`scale(${sc.toFixed(3)})`,clipPath:''};}
  case'wipe':return{opacity:t<=0?'0':'1',transform:'',clipPath:`inset(0 ${(100-ease*100).toFixed(1)}% 0 0)`};
  default:return{opacity:'1',transform:'',clipPath:''};
 }
}

export function createPublishingTimeline(api,{layers,sheet,act}){
 const doc=document,$=id=>doc.getElementById(id),{state}=api;
 const tl={open:false,playing:false,time:0,raf:0,lastTick:0};

 function pageTimings(){
  const pages=state.model?.pages??[];let start=0;
  return pages.map((p,index)=>{const duration=Number(p.duration??3);const row={index,page:p,start,duration,end:start+duration};start+=duration;return row;});
 }
 function totalDuration(){const rows=pageTimings();return rows.at(-1)?.end??3;}

 function resetPreviewStyles(){
  for(const node of doc.querySelectorAll('#spread [data-visual-item]')){
   node.style.opacity='';node.style.transform='';node.style.clipPath='';node.style.transformBox='';node.style.transformOrigin='';
  }
 }

 function applyPreviewAt(globalTime){
  if(!tl.open||!state.model){resetPreviewStyles();return;}
  const rows=pageTimings();if(!rows.length)return;
  const active=rows.find(r=>globalTime<r.end)??rows.at(-1);
  if(active&&state.page!==active.index&&!api.hasDraft())api.selectPage(active.index,state.item);
  const local=Math.max(0,globalTime-(active?.start??0)),p=state.model.pages[state.page];
  if(!p)return;
  for(const item of [...p.objects,...p.frames]){
   const node=doc.querySelector(`#spread [data-visual-item="${CSS.escape(item.id)}"]`);
   if(!node)continue;
   if(!item.animation){node.style.opacity='';node.style.transform='';node.style.clipPath='';continue;}
   const css=computeTransform(item.animation,local);
   node.style.transformBox='fill-box';node.style.transformOrigin='center';
   node.style.opacity=css.opacity;node.style.transform=css.transform;node.style.clipPath=css.clipPath;
  }
 }

 function stopPlayback(){
  tl.playing=false;
  if(tl.raf){cancelAnimationFrame(tl.raf);tl.raf=0;}
  const btn=$('pub-tl-play');if(btn)btn.textContent='Play';
 }

 function stepPlayback(ts){
  if(!tl.playing)return;
  const dt=tl.lastTick?(ts-tl.lastTick)/1000:0;tl.lastTick=ts;
  const total=totalDuration();
  tl.time+=dt;
  if(tl.time>=total){tl.time=0;stopPlayback();syncTimeline();resetPreviewStyles();return;}
  syncScrubberOnly();applyPreviewAt(tl.time);
  tl.raf=requestAnimationFrame(stepPlayback);
 }

 function togglePlay(){
  if(tl.playing){stopPlayback();return;}
  if(!state.model)return;
  if(tl.time>=totalDuration())tl.time=0;
  tl.playing=true;tl.lastTick=0;
  const btn=$('pub-tl-play');if(btn)btn.textContent='Pause';
  applyPreviewAt(tl.time);
  tl.raf=requestAnimationFrame(stepPlayback);
 }

 function syncScrubberOnly(){
  const scrub=$('pub-tl-scrub'),readout=$('pub-tl-time'),total=totalDuration();
  if(scrub){scrub.max=String(total);scrub.value=String(Math.min(total,tl.time));}
  if(readout)readout.textContent=`${tl.time.toFixed(1)}s / ${total.toFixed(1)}s`;
 }

 function syncTimeline(){
  const host=$('video-timeline');if(!host)return;
  const visible=tl.open&&state.view==='editor'&&Boolean(state.document);
  host.hidden=!visible;
  if(!visible){stopPlayback();resetPreviewStyles();return;}
  const p=api.page(),total=totalDuration();
  const controls=make(doc,'div','pub-tl-controls'),play=make(doc,'button','pub-secondary',tl.playing?'Pause':'Play'),scrub=make(doc,'input','pub-tl-scrub'),readout=make(doc,'span','pub-tpl-meta',`${tl.time.toFixed(1)}s / ${total.toFixed(1)}s`),durBtn=make(doc,'button','pub-secondary',`Page ${state.page+1}: ${Number(p?.duration??3).toFixed(1)}s`),mp4Btn=make(doc,'button','pub-secondary pub-action-fill','Download MP4'),closeBtn=make(doc,'button','pub-secondary','Hide');
  play.id='pub-tl-play';scrub.id='pub-tl-scrub';readout.id='pub-tl-time';durBtn.id='pub-tl-dur';mp4Btn.id='pub-tl-export';closeBtn.id='pub-tl-close';
  play.type=durBtn.type=mp4Btn.type=closeBtn.type='button';
  scrub.type='range';scrub.min='0';scrub.max=String(total);scrub.step='0.05';scrub.value=String(Math.min(total,tl.time));scrub.setAttribute('aria-label','Timeline playhead');
  play.onclick=()=>togglePlay();
  scrub.oninput=()=>{stopPlayback();tl.time=Number(scrub.value);syncScrubberOnly();applyPreviewAt(tl.time);};
  durBtn.onclick=act(()=>openAnimateSheet());
  mp4Btn.onclick=act(()=>downloadMp4());
  closeBtn.onclick=()=>toggleTimeline(false);
  controls.append(play,scrub,readout,durBtn,mp4Btn,closeBtn);
  const tracks=make(doc,'div','pub-tl-tracks');
  for(const item of p?[...p.frames,...p.objects]:[]){
   const label=item.animation?`${item.id}: ${item.animation.preset} (${item.animation.duration}s)`:`${item.id}: static`;
   const chip=make(doc,'button','pub-secondary pub-tl-chip',label);chip.type='button';
   chip.onclick=act(()=>{api.selectPage(state.page,item.id);return openAnimateSheet();});
   tracks.append(chip);
  }
  host.replaceChildren(controls,tracks);
 }

 function toggleTimeline(force){
  tl.open=force!==undefined?Boolean(force):!tl.open;
  if(!tl.open){stopPlayback();tl.time=0;resetPreviewStyles();}
  syncTimeline();
 }

 async function renderVideo(){
  api.editable();api.requireAppliedFields();
  if(state.videoJob)throw new Error('A video render is already running.');
  if(state.ops.length||api.hasDraft())await api.save();
  const d=api.editable(),view=api.viewSnapshot();
  const started=await api.request(`/documents/${d.id}/render-video`,{method:'POST',body:{revision:d.revision,requestKey:crypto.randomUUID()}});
  state.videoJob=started.job.id;api.controls();api.status('Rendering animated MP4 video…');
  const id=state.videoJob,deadline=Date.now()+305000;
  try{
   while(api.sameView(view)&&state.videoJob===id&&Date.now()<deadline){
    const {job}=await api.request('/video-jobs/'+id);
    if(!api.sameView(view)||state.videoJob!==id)return false;
    if(['ready','failed','cancelled','expired','abandoned'].includes(job.state)){
     state.videoJob=null;api.controls();
     if(job.state==='ready'){state.videoRendered=true;api.status('Video ready.');return true;}
     api.status('Video render '+job.state,true);return false;
    }
    await new Promise(r=>setTimeout(r,350));
   }
   throw new Error('Timed out waiting for video render.');
  }finally{state.videoJob=null;api.controls();}
 }

 async function downloadMp4(){
  api.requireDocument();api.requireAppliedFields();
  if(api.hasDraft())await api.save();
  if(!state.videoRendered){if(!await renderVideo())return;}
  await api.download('mp4');
 }

 async function openAnimateSheet(){
  if(!state.document)await api.newPublication('letter');
  const p=api.page(),item=api.selected(),cur=item?.animation??null;
  const wrap=make(doc,'div'),presetLbl=make(doc,'label','',item?`Motion preset (${item.id})`:'Page preset (all items)'),presetSel=make(doc,'select'),nums=make(doc,'div','numbers'),durLbl=make(doc,'label','','Item duration (s)'),durIn=make(doc,'input'),delLbl=make(doc,'label','','Start delay (s)'),delIn=make(doc,'input'),pageLbl=make(doc,'label','',`Page ${state.page+1} duration (s)`),pageIn=make(doc,'input'),actions=make(doc,'div','pub-pair'),applyBtn=make(doc,'button','pub-secondary pub-action-fill',item?'Apply animation':'Animate page'),tlBtn=make(doc,'button','pub-secondary','Show timeline');
  presetSel.id='pub-anim-preset';durIn.id='pub-anim-duration';delIn.id='pub-anim-delay';pageIn.id='pub-page-duration';applyBtn.id='pub-anim-apply';tlBtn.id='pub-anim-timeline';
  for(const [val,lbl]of PRESETS){const o=make(doc,'option','',lbl);o.value=val;presetSel.append(o);}
  presetSel.value=cur?.preset??(item?'':'rise');
  durIn.type=delIn.type=pageIn.type='number';durIn.min='0.1';durIn.max='10';durIn.step='0.1';durIn.value=String(cur?.duration??0.8);
  delIn.min='0';delIn.max='20';delIn.step='0.1';delIn.value=String(cur?.delay??0);
  pageIn.min='0.5';pageIn.max='30';pageIn.step='0.5';pageIn.value=String(p?.duration??3);
  applyBtn.type=tlBtn.type='button';
  presetLbl.append(presetSel);durLbl.append(durIn);delLbl.append(delIn);nums.append(durLbl,delLbl);pageLbl.append(pageIn);actions.append(applyBtn,tlBtn);
  wrap.append(presetLbl,nums,pageLbl,actions);
  const layer=await sheet('Animate',[],{extra:[wrap],half:true});
  applyBtn.onclick=act(async()=>{
   api.editable();const preset=presetSel.value,duration=Number(durIn.value),delay=Number(delIn.value),pageDur=Number(pageIn.value);
   if(!Number.isFinite(pageDur)||pageDur<0.5||pageDur>30)throw new Error('Page duration must be 0.5 to 30 seconds.');
   api.edit({op:'set-page',page:p.id,values:{duration:pageDur}});
   if(item){
    const anim=preset?{preset,duration,delay}:null;
    api.edit(item.storyId?{op:'set-frame',frame:item.id,values:{animation:anim}}:{op:'set-object',page:p.id,object:item.id,values:{animation:anim}});
   }else if(preset){
    api.layout(m=>{const pg=m.pages[state.page];[...pg.objects,...pg.frames].forEach((v,idx)=>{v.animation={preset,duration,delay:Math.round(idx*0.2*10)/10};});});
   }
   await layers.close(layer.dialog);toggleTimeline(true);api.status('Animation updated.');
  });
  tlBtn.onclick=act(async()=>{await layers.close(layer.dialog);toggleTimeline(true);});
 }

 function decoratePreview(){if(tl.open&&tl.playing)applyPreviewAt(tl.time);}

 return{isOpen:()=>tl.open,toggleTimeline,syncTimeline,openAnimateSheet,downloadMp4,renderVideo,decoratePreview};
}
