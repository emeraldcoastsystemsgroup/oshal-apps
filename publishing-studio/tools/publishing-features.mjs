/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: starter templates, multi-select and grouping, subject background cutout, format resize, Create brand kit integration, pinned comments, and social post scheduling/publishing (RP-PUB-01..07).
 */
const make=(doc,tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const FORMAT_OPTIONS=[
 ['letter','US Letter · 8.5 × 11 in (612 × 792 pt)'],
 ['a4','A4 · 210 × 297 mm (595.3 × 841.9 pt)'],
 ['a5','A5 Booklet · 148 × 210 mm (419.5 × 595.3 pt)'],
 ['square','Social Square · 1:1 (540 × 540 pt)'],
 ['portrait','Social Portrait · 4:5 (540 × 675 pt)'],
 ['widescreen','Widescreen · 16:9 (960 × 540 pt)'],
];

function authHeaders(){
 const token=sessionStorage.getItem('oshal.token');
 return token?{Authorization:'Bearer '+token}:{};
}

function relinkRemainingStories(m,removedIds){
 const allFrames=new Map(m.pages.flatMap(p=>p.frames).map(f=>[f.id,f]));
 const keptStories=[];
 for(const story of m.stories){
  const chain=[];let cur=story.firstFrame;const seen=new Set();
  while(cur&&!seen.has(cur)){
   seen.add(cur);
   const f=allFrames.get(cur);
   if(!f)break;
   if(!removedIds.has(f.id))chain.push(f);
   cur=f.nextFrame;
  }
  if(!chain.length)continue;
  story.firstFrame=chain[0].id;
  for(let i=0;i<chain.length;i++)chain[i].nextFrame=chain[i+1]?.id??null;
  keptStories.push(story);
 }
 m.stories=keptStories;
}

export function createPublishingFeatures(api,{layers,sheet,act,onBrandChanged}){
 const doc=document,{state}=api,brandState={kit:null};

 function selectedItems(){
  const p=api.page();if(!p)return[];
  return [...p.frames,...p.objects].filter(v=>state.selectedIds.has(v.id));
 }
 function canGroup(){return selectedItems().length>=2;}
 function canUngroup(){return selectedItems().some(v=>Boolean(v.groupId));}
 function isSingleGroupSelected(){const items=selectedItems();return items.length>=1&&items.every(v=>v.groupId&&v.groupId===items[0].groupId);}

 function toggleMultiSelect(){
  api.requireDocument();if(!api.guardFields())return;
  state.multiSelect=!state.multiSelect;
  if(state.multiSelect&&state.item)state.selectedIds.add(state.item);
  api.paint();
  api.status(state.multiSelect?'Select multiple active: tap frames or shapes to add them.':'Single selection restored.');
 }

 function toggleGroup(){
  api.editable();if(!api.guardFields())return;
  const items=selectedItems();
  const singleGroup=items.length>=1&&items.every(v=>v.groupId&&v.groupId===items[0].groupId);
  if(singleGroup){
   const gid=items[0].groupId;
   api.layout(m=>{for(const v of [...m.pages[state.page].frames,...m.pages[state.page].objects])if(v.groupId===gid)delete v.groupId;});
   state.multiSelect=false;api.paint();api.status('Ungrouped items.');return;
  }
  if(items.length<2)throw new Error('Select at least two items on the page to group them.');
  const gid=api.uid('grp');
  api.layout(m=>{for(const v of [...m.pages[state.page].frames,...m.pages[state.page].objects])if(state.selectedIds.has(v.id))v.groupId=gid;});
  state.multiSelect=false;api.paint();api.status(`Grouped ${items.length} items.`);
 }

 function deleteSelectedItems(){
  api.editable();if(!api.guardFields())return;
  const ids=new Set(selectedItems().map(v=>v.id));
  if(!ids.size)throw new Error('Select at least one item.');
  api.layout(m=>{
   relinkRemainingStories(m,ids);
   const p=m.pages[state.page];
   p.objects=p.objects.filter(o=>!ids.has(o.id));
   p.frames=p.frames.filter(f=>!ids.has(f.id));
  });
  state.item=null;state.selectedIds.clear();state.multiSelect=false;
  api.paint();api.status(`Deleted ${ids.size} selected item${ids.size===1?'':'s'}.`);
 }

 async function openTemplateGallery(){
  if(state.document&&api.hasDraft()){api.editable();api.requireAppliedFields();await api.save();}
  const {templates}=await api.request('/templates');
  const grid=make(doc,'div','pub-tpl-grid');
  const layerRef={dialog:null};
  for(const tpl of templates){
   const card=make(doc,'div','pub-tpl-card'),head=make(doc,'h3','',tpl.name),meta=make(doc,'p','pub-tpl-meta',`${String(tpl.size||'letter').toUpperCase()} · ${tpl.pageCount} ${tpl.pageCount===1?'page':'pages'}`),desc=make(doc,'p','pub-note',tpl.summary),use=make(doc,'button','pub-secondary pub-action-fill','Use template');
   use.type='button';use.dataset.templateId=tpl.id;
   use.onclick=act(async()=>{
    if(layerRef.dialog)await layers.close(layerRef.dialog);
    await api.locked(async()=>{
     const created=await api.request('/documents',{method:'POST',body:{title:tpl.name,pageCount:tpl.pageCount,templateId:tpl.id,requestKey:crypto.randomUUID()}});
     await api.loadDocument(created.document.id);await api.refresh();
    });
    api.status('Created copy from template '+tpl.name);
   });
   card.append(head,meta,desc,use);grid.append(card);
  }
  const layer=await sheet('Start from a template',[],{extra:[grid]});
  layerRef.dialog=layer.dialog;
 }

 async function removeSelectedImageBackground(){
  api.editable();api.requireAppliedFields();
  const item=api.selected();
  if(!item||item.kind!=='image')throw new Error('Select an image on the page first.');
  api.status('Removing image background…');
  const res=await api.request(`/assets/${encodeURIComponent(item.assetId)}/remove-background`,{method:'POST',body:{requestKey:crypto.randomUUID()}});
  await api.refresh();
  const cut=res.asset;
  api.layout(m=>{
   if(!m.assets.some(a=>a.id===cut.id))m.assets.push({id:cut.id,sha256:cut.sha256,bytes:cut.bytes,mime:cut.mime});
   const target=m.pages[state.page].objects.find(o=>o.id===item.id);
   if(target)target.assetId=cut.id;
  });
  await api.save();
  api.status('Removed background as a new transparent PNG; original image kept.');
 }

 async function openResizeSheet(){
  const d=api.requireDocument();
  const wrap=make(doc,'div'),sizeLabel=make(doc,'label','','New format'),sel=make(doc,'select'),titleLabel=make(doc,'label','','Copy title'),titleIn=make(doc,'input'),go=make(doc,'button','pub-secondary pub-action-fill','Create resized copy');
  sel.id='pub-resize-size';titleIn.id='pub-resize-title';titleIn.maxLength=160;go.id='pub-resize-submit';go.type='button';
  for(const [val,label]of FORMAT_OPTIONS){const o=make(doc,'option','',label);o.value=val;sel.append(o);}
  sel.value='a4';
  const syncTitle=()=>{titleIn.value=`${d.title.slice(0,136)} (${sel.value.toUpperCase()})`;};
  syncTitle();sel.onchange=syncTitle;
  sizeLabel.append(sel);titleLabel.append(titleIn);wrap.append(sizeLabel,titleLabel,go);
  const layer=await sheet('Resize into another format',[],{extra:[wrap],half:true});
  go.onclick=act(async()=>{
   if(api.hasDraft()){api.editable();api.requireAppliedFields();await api.save();}
   const size=sel.value,nextTitle=titleIn.value.trim()||`${d.title.slice(0,136)} (${size.toUpperCase()})`;
   await layers.close(layer.dialog);
   await api.locked(async()=>{
    const res=await api.request(`/documents/${d.id}/resize`,{method:'POST',body:{size,title:nextTitle,requestKey:crypto.randomUUID()}});
    await api.loadDocument(res.document.id);await api.refresh();
    api.status('Opened resized copy '+res.document.title);
   });
  });
 }

 async function probeBrandKit(){
  try{
   const perms=await api.request('/permissions').catch(()=>null);
   if(!perms?.createProbe){brandState.kit=null;return;}
   const access=await fetch('/api/authorization/me?app=create',{credentials:'same-origin',headers:authHeaders()}).then(r=>r.ok?r.json():null).catch(()=>null);
   const open=access&&(access.status==='legacy'||(access.denied!==true&&typeof access.tier==='string'&&access.tier!=='deny'));
   if(!open){brandState.kit=null;return;}
   const res=await fetch('/api/create/brand-kit',{credentials:'same-origin',headers:authHeaders()});
   if(!res.ok){brandState.kit=null;return;}
   const body=await res.json().catch(()=>null);
   brandState.kit=body?.kit&&typeof body.kit==='object'?body.kit:null;
   onBrandChanged?.();
  }catch{brandState.kit=null;}
 }

 async function importBrandLogo(kit){
  const src=kit?.logo?.src;if(typeof src!=='string'||!src.startsWith('/api/create/'))return undefined;
  const res=await fetch(src,{credentials:'same-origin',headers:authHeaders()});
  if(!res.ok)return undefined;
  const blob=await res.blob();
  if(!['image/png','image/jpeg'].includes(blob.type)||blob.size<1||blob.size>4194304)return undefined;
  const fd=new FormData();
  fd.append('file',new File([blob],'brand-logo.'+(blob.type==='image/png'?'png':'jpg'),{type:blob.type}));
  fd.append('title',((kit.name||'Brand')+' logo').slice(0,160));
  fd.append('requestKey',crypto.randomUUID());
  const uploaded=await api.request('/assets/upload',{method:'POST',body:fd});
  await api.refresh();
  return uploaded.asset?.id;
 }

 async function openBrandSheet(){
  const kit=brandState.kit;if(!kit)throw new Error('No brand kit is configured in Creative Studio.');
  const box=make(doc,'div'),title=make(doc,'h3','',kit.name||'Your brand kit'),swatches=make(doc,'div','pub-brand-swatches');
  for(const [role,hexVal]of Object.entries(kit.colors??{})){
   if(typeof hexVal!=='string')continue;
   const pill=make(doc,'span','pub-brand-swatch'),dot=make(doc,'span','pub-swatch-dot');
   dot.style.background=hexVal;pill.append(dot,doc.createTextNode(`${role}: ${hexVal}`));swatches.append(pill);
  }
  const fonts=make(doc,'p','pub-note',`Heading: ${kit.fonts?.heading||'Sans'} · Body: ${kit.fonts?.body||'Serif'}${kit.logo?.src?' · Logo ready':''}`);
  const applyBtn=make(doc,'button','pub-secondary pub-action-fill','Apply brand');applyBtn.id='pub-brand-apply';applyBtn.type='button';
  box.append(title,swatches,fonts,applyBtn);
  const layer=await sheet('Brand kit',[],{extra:[box],half:true});
  applyBtn.onclick=act(async()=>{
   await layers.close(layer.dialog);
   if(!state.document)await api.newPublication('letter');
   if(api.hasDraft()){api.editable();api.requireAppliedFields();await api.save();}
   const d=api.editable(),logoAssetId=await importBrandLogo(kit);
   const res=await api.request(`/documents/${d.id}/apply-brand-kit`,{method:'POST',body:{baseRevision:d.revision,requestKey:crypto.randomUUID(),kit,...(logoAssetId?{logoAssetId}:{})}});
   await api.locked(()=>api.loadDocument(d.id,undefined,{pageId:api.page()?.id,item:state.item,keepHistory:true,result:undefined}));
   await api.refresh();
   api.status(`Applied brand kit (${res.appliedBrand.headingFont} / ${res.appliedBrand.bodyFont}).`);
  });
 }

 async function loadComments(view=api.viewSnapshot()){
  if(!view.id)return;
  try{
   const res=await api.request(`/documents/${view.id}/comments`);
   if(!api.sameView(view))return;
   state.comments=res.comments??[];
   api.boards();
  }catch{/* read-only viewer or closed view */}
 }

 function decorateComments(section,p){
  if(!state.document||!state.comments.length)return;
  const rows=state.comments.filter(c=>c.pageId===p.id);
  if(!rows.length)return;
  const pad=p.bleed+12,W=p.width+2*pad,H=p.height+2*pad,overlay=make(doc,'div','page-overlay');
  overlay.style.aspectRatio=`${W} / ${H}`;
  rows.forEach((c,idx)=>{
   const pin=make(doc,'button','pub-comment-pin',String(idx+1));
   pin.type='button';pin.dataset.commentId=c.id;pin.dataset.resolved=String(Boolean(c.resolved));
   pin.setAttribute('aria-label',`Comment ${idx+1}: ${c.body.slice(0,48)}`);
   pin.style.left=((c.pinX+pad)/W*100)+'%';pin.style.top=((c.pinY+pad)/H*100)+'%';
   pin.onclick=act(e=>{e.stopPropagation();return openCommentsSheet(c.id);});
   overlay.append(pin);
  });
  section.append(overlay);
 }

 function renderCommentCard(c,d,rerender){
  const card=make(doc,'div','pub-comment-card'),head=make(doc,'div','pub-comment-head');
  card.dataset.commentCard=c.id;
  head.append(make(doc,'span','',`${c.authorName} · ${c.targetType==='page'?'Page':c.targetId}${c.resolved?' · Resolved':''}`));
  const body=make(doc,'p','',c.body),replies=make(doc,'div','pub-reply-list');
  for(const r of c.replies??[])replies.append(make(doc,'p','pub-note',`${r.authorName}: ${r.body}`));
  const replyIn=make(doc,'input'),actions=make(doc,'div','pub-pair'),replyBtn=make(doc,'button','pub-secondary','Reply'),resBtn=make(doc,'button','pub-secondary',c.resolved?'Reopen':'Resolve'),delBtn=make(doc,'button','pub-secondary pub-danger','Delete');
  replyIn.placeholder='Write a reply…';replyIn.maxLength=2000;replyBtn.type=resBtn.type=delBtn.type='button';
  replyBtn.onclick=act(async()=>{const txt=replyIn.value.trim();if(!txt)throw new Error('Enter a reply first.');await api.request(`/documents/${d.id}/comments/${c.id}/replies`,{method:'POST',body:{body:txt,requestKey:crypto.randomUUID()}});await rerender();});
  resBtn.onclick=act(async()=>{await api.request(`/documents/${d.id}/comments/${c.id}`,{method:'PATCH',body:{resolved:!c.resolved,requestKey:crypto.randomUUID()}});await rerender();});
  delBtn.onclick=act(async()=>{await api.request(`/documents/${d.id}/comments/${c.id}`,{method:'DELETE',body:{}});await rerender();});
  actions.append(replyBtn,resBtn,delBtn);
  card.append(head,body,...(c.replies?.length?[replies]:[]),replyIn,actions);
  return card;
 }

 async function openCommentsSheet(focusId=null){
  if(!state.document)await api.newPublication('letter');
  if(api.hasDraft()){api.editable();api.requireAppliedFields();await api.save();}
  const d=api.requireDocument(),p=api.page(),item=api.selected();
  const targetType=item?(item.storyId?'frame':'object'):'page',targetId=item?item.id:p.id;
  const host=make(doc,'div'),targetNote=make(doc,'p','pub-note',`Pinning to ${targetType==='page'?`Page ${state.page+1}`:`${targetType} ${targetId}`}`),area=make(doc,'textarea'),addBtn=make(doc,'button','pub-secondary pub-action-fill','Pin comment'),list=make(doc,'div','pub-tpl-grid');
  area.id='pub-comment-body';area.rows=2;area.maxLength=2000;area.placeholder='Add a note pinned here…';
  addBtn.id='pub-comment-submit';addBtn.type='button';
  const rerender=async()=>{
   const res=await api.request(`/documents/${d.id}/comments`);
   state.comments=res.comments??[];api.boards();
   list.replaceChildren(...(state.comments.length?state.comments.map(c=>renderCommentCard(c,d,rerender)):[make(doc,'p','pub-note','No comments yet.')]));
   if(focusId)list.querySelector(`[data-comment-card="${CSS.escape(focusId)}"]`)?.scrollIntoView({block:'nearest'});
  };
  addBtn.onclick=act(async()=>{
   const txt=area.value.trim();if(!txt)throw new Error('Write a comment before pinning.');
   await api.request(`/documents/${d.id}/comments`,{method:'POST',body:{pageId:p.id,targetType,targetId,body:txt,requestKey:crypto.randomUUID()}});
   area.value='';await rerender();api.status('Comment pinned.');
  });
  host.append(targetNote,area,addBtn,list);
  list.replaceChildren(...(state.comments.length?state.comments.map(c=>renderCommentCard(c,d,rerender)):[make(doc,'p','pub-note','No comments yet.')]));
  await sheet('Comments',[],{extra:[host]});
  await rerender();
 }

 function renderSocialPosts(posts,d,listHost,rerender){
  listHost.replaceChildren(...(posts.length?posts.map(post=>{
   const row=make(doc,'div','pub-post-card'),info=make(doc,'span','',`${post.channel.toUpperCase()} · ${post.status}${post.scheduledFor?' · '+new Date(post.scheduledFor).toLocaleString():''}: ${post.caption.slice(0,60)}`);
   row.append(info);
   if(post.status!=='published'){
    const cancel=make(doc,'button','pub-secondary pub-danger','Cancel');cancel.type='button';
    cancel.onclick=act(async()=>{await api.request(`/documents/${d.id}/social-posts/${post.id}`,{method:'DELETE',body:{}});await rerender();});
    row.append(cancel);
   }
   return row;
  }):[make(doc,'p','pub-note','No scheduled or published social posts yet.')]));
 }

 async function openSocialSheet(){
  const d=api.requireDocument();
  const [{channels},initialPosts]=await Promise.all([api.request('/social/channels'),api.request(`/documents/${d.id}/social-posts`)]);
  const wrap=make(doc,'div'),chLabel=make(doc,'label','','Account'),chSel=make(doc,'select'),connNote=make(doc,'p','pub-note'),capLabel=make(doc,'label','','Caption'),cap=make(doc,'textarea'),count=make(doc,'p','pub-tpl-meta'),modeLabel=make(doc,'label','','Timing'),modeSel=make(doc,'select'),whenLabel=make(doc,'label','','Scheduled time'),whenIn=make(doc,'input'),chkRow=make(doc,'label','pub-check-row'),chk=make(doc,'input'),go=make(doc,'button','pub-secondary pub-action-fill','Post now'),list=make(doc,'div','pub-tpl-grid');
  chSel.id='pub-social-channel';cap.id='pub-social-caption';cap.rows=3;modeSel.id='pub-social-mode';whenIn.id='pub-social-when';whenIn.type='datetime-local';chk.id='pub-social-confirm';chk.type='checkbox';go.id='pub-social-submit';go.type='button';
  for(const ch of channels){const o=make(doc,'option','',`${ch.label} (${ch.connected?'Connected':'Not connected'})`);o.value=ch.id;chSel.append(o);}
  for(const [v,lbl]of [['now','Post now'],['schedule','Schedule for later']]){const o=make(doc,'option','',lbl);o.value=v;modeSel.append(o);}
  whenIn.value=new Date(Date.now()+3600_000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const syncUi=()=>{
   const ch=channels.find(c=>c.id===chSel.value)??channels[0];
   connNote.textContent=ch?.connected?`${ch.label} is connected.`:`${ch?.label??'Account'} is not connected yet (${ch?.authorizePath??'/connectors'}).`;
   count.textContent=`${cap.value.length} / ${ch?.limit??280} characters`;
   whenLabel.hidden=modeSel.value!=='schedule';
   go.textContent=modeSel.value==='schedule'?'Schedule post':'Post now';
  };
  chSel.onchange=syncUi;cap.oninput=syncUi;modeSel.onchange=syncUi;syncUi();
  chkRow.append(chk,make(doc,'span','','I confirm publishing this rendered layout to the selected account.'));
  chLabel.append(chSel);capLabel.append(cap);modeLabel.append(modeSel);whenLabel.append(whenIn);
  wrap.append(chLabel,connNote,capLabel,count,modeLabel,whenLabel,chkRow,go,list);
  const rerender=async()=>{const latest=await api.request(`/documents/${d.id}/social-posts`);renderSocialPosts(latest.posts??[],d,list,rerender);};
  renderSocialPosts(initialPosts.posts??[],d,list,rerender);
  await sheet('Schedule or post',[],{extra:[wrap]});
  go.onclick=act(async()=>{
   if(api.hasDraft()){api.editable();api.requireAppliedFields();await api.save();}
   if(!state.rendered){api.status('Rendering publication before social post…');if(!await api.render())return;}
   const cur=api.requireDocument(),scheduledFor=modeSel.value==='schedule'?new Date(whenIn.value).toISOString():undefined;
   const res=await api.request(`/documents/${cur.id}/social-posts`,{method:'POST',body:{revision:cur.revision,channel:chSel.value,caption:cap.value,confirm:chk.checked,...(scheduledFor?{scheduledFor}:{}),requestKey:crypto.randomUUID()}});
   cap.value='';chk.checked=false;syncUi();await rerender();
   api.status(res.post.status==='scheduled'?'Social post scheduled.':'Published to '+chSel.value+'.');
  });
 }

 void probeBrandKit();
 return{hasBrandKit:()=>Boolean(brandState.kit),probeBrandKit,openTemplateGallery,toggleMultiSelect,canGroup,canUngroup,isSingleGroupSelected,toggleGroup,deleteSelectedItems,removeSelectedImageBackground,openResizeSheet,openBrandSheet,loadComments,decorateComments,openCommentsSheet,openSocialSheet};
}
