/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: behaviour, refusal, forced-RLS and Chromium UI proofs for RP-PUB-01..08 (templates, multi-select and grouping, subject cutout, format resize, Create brand kit, pinned comments, social scheduling/posting, and item animation with MP4 video timeline export).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {fixture} from './fixtures/fixture.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
import {mountSharedEditor} from './fixtures/shared-ui.mjs';
import {openStudio,pick} from './fixtures/publishing-ui.mjs';

const {chromium}=requireRuntime('playwright');
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}return t;})();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
function pngChunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const tag=Buffer.from(type,'ascii');const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([len,tag,data,crc]);}

function makeRgbaPng(w,h,pixelAt){
 const raw=Buffer.alloc(h*(1+w*4));
 for(let y=0;y<h;y++){
  const row=y*(1+w*4);raw[row]=0;
  for(let x=0;x<w;x++){const[r,g,b,a]=pixelAt(x,y),off=row+1+x*4;raw[off]=r;raw[off+1]=g;raw[off+2]=b;raw[off+3]=a;}
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
}

function decodeUnfilteredRgbaPng(buf){
 let off=8,w=0,h=0;const idat=[];
 while(off<buf.length){
  const len=buf.readUInt32BE(off),type=buf.subarray(off+4,off+8).toString('ascii'),data=buf.subarray(off+8,off+8+len);
  if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);}
  else if(type==='IDAT')idat.push(data);
  off+=12+len;
 }
 const raw=inflateSync(Buffer.concat(idat)),stride=1+w*4;
 return{w,h,alpha:(x,y)=>raw[y*stride+1+x*4+3]};
}

async function jsonReq(base,path,{method='GET',body,owner='alice'}={}){
 const res=await fetch(base+'/api/publishing-studio'+path,{
  method,
  headers:{'x-test-owner':owner,...(body!==undefined?{'content-type':'application/json'}:{})},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),
 });
 const data=await res.json().catch(()=>null);
 return{status:res.status,data};
}

async function uploadPng(base,title,pngBytes,owner='alice'){
 const fd=new FormData();
 fd.append('file',new Blob([pngBytes],{type:'image/png'}),'sample.png');
 fd.append('title',title);
 fd.append('requestKey',randomUUID());
 const res=await fetch(base+'/api/publishing-studio/assets/upload',{method:'POST',headers:{'x-test-owner':owner},body:fd});
 return{status:res.status,data:await res.json()};
}

async function waitRenderReady(base,jobPath,jobId,owner='alice'){
 for(let i=0;i<80;i++){
  const {status,data}=await jsonReq(base,`${jobPath}/${jobId}`,{owner});
  assert.equal(status,200);
  if(data.job.state==='ready')return data.job;
  if(['failed','cancelled','expired','abandoned'].includes(data.job.state))assert.fail('render failed: '+JSON.stringify(data.job));
  await new Promise(r=>setTimeout(r,200));
 }
 assert.fail('render job timed out');
}

test('RP-PUB-01: starter templates create populated editable layouts, render Typst PDFs and refuse unknown templateId',{timeout:180000},async t=>{
 const f=await fixture({http:true,extend:mountSharedEditor});t.after(()=>f.close());
 const list=await jsonReq(f.url,'/templates');
 assert.equal(list.status,200);
 assert.deepEqual(list.data.templates.map(x=>x.id),['event-flyer','newsletter','booklet']);
 const bad=await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Bad',pageCount:1,templateId:'unknown-id',requestKey:randomUUID()}});
 assert.equal(bad.status,400);assert.equal(bad.data.error,'publishing_template_unsupported');
 for(const tpl of ['event-flyer','newsletter','booklet']){
  const made=await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Starter '+tpl,pageCount:1,templateId:tpl,requestKey:randomUUID()}});
  assert.equal(made.status,200);assert.ok(made.data.document.model.stories.length>=1);
 }
 const flyer=(await jsonReq(f.url,'/documents')).data.documents.find(d=>d.title==='Starter event-flyer');
 const rJob=await jsonReq(f.url,`/documents/${flyer.id}/render`,{method:'POST',body:{revision:1,requestKey:randomUUID()}});
 assert.equal(rJob.status,202);await waitRenderReady(f.url,'/jobs',rJob.data.job.id);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:412,height:743},isMobile:true,hasTouch:true});
 await openStudio(page,f.url);await page.locator('#new-publication').tap();
 await page.locator('dialog[open] .ds-menu-row',{hasText:'From template'}).tap();
 await page.locator('dialog[open] .pub-tpl-card',{hasText:'Event flyer'}).locator('button').tap();
 await page.locator('#document-title').filter({hasText:'Event flyer'}).waitFor();
 assert.ok(await page.locator('#spread .selection-box').count()>=2);
});

test('RP-PUB-02: multi-select, Group, Ungroup, group move and group delete persist and refuse single-item group',{timeout:180000},async t=>{
 const f=await fixture({http:true,extend:mountSharedEditor});t.after(()=>f.close());
 const made=await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Grouping flyer',pageCount:1,templateId:'event-flyer',requestKey:randomUUID()}});
 const docId=made.data.document.id;
 const badEdit=await jsonReq(f.url,`/documents/${docId}/edits`,{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),operationsJson:JSON.stringify([{op:'set-frame',frame:'frame1',values:{groupId:''}}])}});
 assert.equal(badEdit.status,400);assert.equal(badEdit.data.error,'publishing_model_invalid');
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await openStudio(page,f.url,docId);
 await page.locator('#spread .selection-box[data-item="hero_title"]').click();
 await page.locator('#more-menu').click();
 assert.equal(await page.locator('dialog[open] .ds-menu-row',{hasText:'Group'}).isDisabled(),true,'single item cannot be grouped');
 await page.locator('dialog[open] .ds-menu-row',{hasText:'Select multiple'}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog.ds-menu[open]'));
 await page.locator('#spread .selection-box[data-item="frame1"]').click();
 await pick(page,'#more-menu','Group');
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2');
 const savedP=(await jsonReq(f.url,`/documents/${docId}`)).data.document.model.pages[0];
 const heroTitle=savedP.objects.find(o=>o.id==='hero_title');
 assert.ok(heroTitle.groupId&&heroTitle.groupId===savedP.frames[0].groupId);
 const beforeFrameY=savedP.frames[0].y,box=await page.locator('#spread .selection-box[data-item="hero_title"]').boundingBox();
 await page.mouse.move(box.x+30,box.y+20);await page.mouse.down();await page.mouse.move(box.x+30,box.y+45,{steps:4});await page.mouse.up();
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 3');
 const movedP=(await jsonReq(f.url,`/documents/${docId}`)).data.document.model.pages[0];
 assert.ok(movedP.frames[0].y>beforeFrameY+10,'dragging one grouped member moves its peer');
 await pick(page,'#more-menu','Ungroup');
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 4');
 assert.equal((await jsonReq(f.url,`/documents/${docId}`)).data.document.model.pages[0].frames[0].groupId,undefined);
 await page.locator('#spread .selection-box[data-item="accent_bar"]').click({position:{x:8,y:8}});
 await pick(page,'#more-menu','Select multiple');
 await page.locator('#spread .selection-box[data-item="date_line"]').click();
 await page.locator('[data-ds-toolrow] > button',{hasText:'Delete'}).click();
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 5');
 const afterDelete=(await jsonReq(f.url,`/documents/${docId}`)).data.document.model.pages[0];
 assert.equal(afterDelete.objects.some(o=>o.id==='accent_bar'||o.id==='date_line'),false,'multi-selected items delete together');
});

test('RP-PUB-03: Remove background extracts foreground RGBA PNG keeping original intact and refuses uniform images',{timeout:180000},async t=>{
 const f=await fixture({http:true,extend:mountSharedEditor});t.after(()=>f.close());
 const subjectPng=makeRgbaPng(120,120,(x,y)=>(x>=35&&x<85&&y>=35&&y<85)?[190,30,45,255]:[225,238,250,255]);
 const up=await uploadPng(f.url,'Portrait card',subjectPng);
 assert.equal(up.status,201);
 const origId=up.data.asset.id,origSha=up.data.asset.sha256;
 const cut=await jsonReq(f.url,`/assets/${origId}/remove-background`,{method:'POST',body:{title:'Portrait cutout',requestKey:randomUUID()}});
 assert.equal(cut.status,201);assert.notEqual(cut.data.asset.id,origId);assert.equal(cut.data.sourceAssetId,origId);
 const cutBytes=Buffer.from(await (await fetch(`${f.url}/api/publishing-studio/assets/${cut.data.asset.id}/content`)).arrayBuffer());
 const decoded=decodeUnfilteredRgbaPng(cutBytes);
 assert.equal(decoded.alpha(2,2),0,'border background becomes transparent');
 assert.equal(decoded.alpha(60,60),255,'central foreground subject stays opaque');
 const origBytes=Buffer.from(await (await fetch(`${f.url}/api/publishing-studio/assets/${origId}/content`)).arrayBuffer());
 assert.deepEqual(origBytes,subjectPng,'original asset bytes remain untouched');
 assert.equal((await jsonReq(f.url,'/assets')).data.assets.find(a=>a.id===origId).sha256,origSha);
 const flatPng=makeRgbaPng(120,120,()=>[200,200,200,255]);
 const flatUp=await uploadPng(f.url,'Uniform wall',flatPng);
 const refused=await jsonReq(f.url,`/assets/${flatUp.data.asset.id}/remove-background`,{method:'POST',body:{requestKey:randomUUID()}});
 assert.equal(refused.status,422);assert.equal(refused.data.error,'publishing_subject_not_detected');
});

test('RP-PUB-04: Resize creates scaled owned publication copies across formats and refuses unsupported format',{timeout:180000},async t=>{
 const f=await fixture({http:true});t.after(()=>f.close());
 const src=(await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Source brochure',pageCount:4,templateId:'booklet',requestKey:randomUUID()}})).data.document;
 const bad=await jsonReq(f.url,`/documents/${src.id}/resize`,{method:'POST',body:{size:'billboard',requestKey:randomUUID()}});
 assert.equal(bad.status,400);assert.equal(bad.data.error,'publishing_page_size_unsupported');
 const sq=await jsonReq(f.url,`/documents/${src.id}/resize`,{method:'POST',body:{size:'square',title:'Square booklet',requestKey:randomUUID()}});
 assert.equal(sq.status,201);assert.notEqual(sq.data.document.id,src.id);
 const p0=sq.data.document.model.pages[0];
 assert.deepEqual([p0.width,p0.height],[540,540]);
 for(const pg of sq.data.document.model.pages){
  for(const fr of pg.frames)assert.ok(fr.x>=0&&fr.x+fr.width<=pg.width&&fr.y>=0&&fr.y+fr.height<=pg.height);
 }
 const rJob=await jsonReq(f.url,`/documents/${sq.data.document.id}/render`,{method:'POST',body:{revision:1,requestKey:randomUUID()}});
 assert.equal(rJob.status,202);await waitRenderReady(f.url,'/jobs',rJob.data.job.id);
 assert.equal((await jsonReq(f.url,`/documents/${src.id}`)).data.document.model.pages[0].width,src.model.pages[0].width);
});

test('RP-PUB-05: Brand tool is withheld without kit, applies Create colours/fonts/logo in one tap when present, and refuses bad hex',{timeout:180000},async t=>{
 let currentKit=null;
 const logoPng=makeRgbaPng(96,96,(x,y)=>(x>=16&&x<80&&y>=16&&y<80)?[30,58,138,255]:[255,255,255,0]);
 const f=await fixture({http:true,createProbe:true,extend:app=>{
  mountSharedEditor(app);
  app.get('/api/authorization/me',(_q,r)=>r.json({status:'catalog',tier:'editor',denied:false}));
  app.get('/api/create/brand-kit',(_q,r)=>r.json({kit:currentKit,revision:currentKit?1:0}));
  app.get('/api/create/project-assets/logo-1',(_q,r)=>r.type('image/png').send(logoPng));
 }});
 t.after(()=>f.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:412,height:743},isMobile:true,hasTouch:true});
 await openStudio(page,f.url);
 assert.equal((await page.locator('[data-ds-toolrow] > button').allTextContents()).includes('Brand'),false,'withheld when kit is null');
 currentKit={name:'Harbor Studio',colors:{primary:'#1E3A8A',secondary:'#0F766E',accent:'#D97706',dark:'#111827'},fonts:{heading:'Liberation Sans',body:'Libertinus Serif'},logo:{src:'/api/create/project-assets/logo-1',width:96,height:96}};
 const doc=(await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Branded flyer',pageCount:1,templateId:'event-flyer',requestKey:randomUUID()}})).data.document;
 await openStudio(page,f.url,doc.id);
 await page.locator('[data-ds-toolrow] > button',{hasText:'Brand'}).waitFor();
 await page.locator('[data-ds-toolrow] > button',{hasText:'Brand'}).tap();
 await page.locator('dialog[open] #pub-brand-apply').tap();
 await page.waitForFunction(()=>document.querySelector('#revision').textContent==='Revision 2');
 const updated=(await jsonReq(f.url,`/documents/${doc.id}`)).data.document.model;
 assert.equal(updated.characterStyles.header.font,'Liberation Sans');
 assert.deepEqual(updated.pages[0].objects.find(o=>o.id==='hero_band').color,[30,58,138]);
 assert.ok(updated.pages[0].objects.some(o=>o.id==='brand_logo'&&o.kind==='image'),'logo placed on page 1');
 const bad=await jsonReq(f.url,`/documents/${doc.id}/apply-brand-kit`,{method:'POST',body:{baseRevision:2,primaryColor:'not-hex',requestKey:randomUUID()}});
 assert.equal(bad.status,400);assert.equal(bad.data.error,'publishing_brand_kit_invalid');
});

test('RP-PUB-06: pinned comments support replies, resolve, forced-RLS cross-user isolation and missing-target refusal',{timeout:180000},async t=>{
 const f=await fixture({http:true,extend:mountSharedEditor});t.after(()=>f.close());
 const doc=(await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Commented flyer',pageCount:1,templateId:'event-flyer',requestKey:randomUUID()}})).data.document;
 const missing=await jsonReq(f.url,`/documents/${doc.id}/comments`,{method:'POST',body:{pageId:'page1',targetType:'frame',targetId:'ghost',body:'Where?',requestKey:randomUUID()}});
 assert.equal(missing.status,404);assert.equal(missing.data.error,'publishing_comment_target_missing');
 const created=await jsonReq(f.url,`/documents/${doc.id}/comments`,{method:'POST',body:{pageId:'page1',targetType:'frame',targetId:'frame1',body:'Tighten headline kerning.',requestKey:randomUUID()}});
 assert.equal(created.status,201);const cid=created.data.comment.id;
 const reply=await jsonReq(f.url,`/documents/${doc.id}/comments/${cid}/replies`,{method:'POST',body:{body:'Updated to 28 pt.',requestKey:randomUUID()}});
 assert.equal(reply.status,201);
 const resolved=await jsonReq(f.url,`/documents/${doc.id}/comments/${cid}`,{method:'PATCH',body:{resolved:true,requestKey:randomUUID()}});
 assert.equal(resolved.status,200);assert.equal(resolved.data.comment.resolved,true);
 assert.equal((await jsonReq(f.url,`/documents/${doc.id}/comments`,{owner:'bob'})).status,404,'forced RLS hides alice comments from bob');
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await openStudio(page,f.url,doc.id);
 await page.locator('#spread .pub-comment-pin').waitFor();
 await page.locator('#open-comments').click();
 await page.locator('dialog[open] .pub-comment-card').first().waitFor();
 assert.equal(await page.locator('dialog[open] .pub-comment-card').count(),1);
});

test('RP-PUB-07: social schedule/post enforces confirm, render and connector gates, publishes via egress and runs due under forced RLS',{timeout:180000},async t=>{
 const f=await fixture({http:true});t.after(()=>f.close());
 const doc=(await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Social launch',pageCount:1,templateId:'event-flyer',requestKey:randomUUID()}})).data.document;
 const noConfirm=await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{method:'POST',body:{revision:1,channel:'twitter',caption:'Live tonight!',confirm:false,requestKey:randomUUID()}});
 assert.equal(noConfirm.status,428);assert.equal(noConfirm.data.error,'publishing_confirmation_required');
 const disconn=await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{method:'POST',body:{revision:1,channel:'twitter',caption:'Live tonight!',confirm:true,requestKey:randomUUID()}});
 assert.equal(disconn.status,409);assert.equal(disconn.data.error,'publishing_connector_disconnected');
 f.states.get('alice').connectors={connections:[{provider:'twitter',revoked:false},{provider:'linkedin',revoked:false}]};
 const unrendered=await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{method:'POST',body:{revision:1,channel:'twitter',caption:'Live tonight!',confirm:true,requestKey:randomUUID()}});
 assert.equal(unrendered.status,409);assert.equal(unrendered.data.error,'publishing_render_required');
 const rJob=await jsonReq(f.url,`/documents/${doc.id}/render`,{method:'POST',body:{revision:1,requestKey:randomUUID()}});
 await waitRenderReady(f.url,'/jobs',rJob.data.job.id);
 const sent=[];
 f.states.get('alice').socialFetch=async(url,init={})=>{
  if(String(url).endsWith('/v2/userinfo'))return new Response(JSON.stringify({sub:'alice-li'}),{status:200,headers:{'content-type':'application/json'}});
  sent.push({url,body:init.body?JSON.parse(init.body):null});
  return new Response(JSON.stringify({data:{id:'tw-99'},id:'li-88'}),{status:201,headers:{'content-type':'application/json'}});
 };
 const nowPost=await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{method:'POST',body:{revision:1,channel:'twitter',caption:'Join us at 7 PM!',confirm:true,requestKey:randomUUID()}});
 assert.equal(nowPost.status,201);assert.equal(nowPost.data.post.status,'published');assert.equal(nowPost.data.post.remoteId,'tw-99');
 const futureIso=new Date(Date.now()+3600_000).toISOString();
 const sched=await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{method:'POST',body:{revision:1,channel:'linkedin',caption:'Tomorrow morning brief.',scheduledFor:futureIso,confirm:true,requestKey:randomUUID()}});
 assert.equal(sched.status,201);assert.equal(sched.data.post.status,'scheduled');
 assert.equal((await jsonReq(f.url,`/documents/${doc.id}/social-posts`,{owner:'bob'})).status,404);
 await f.db.query(`UPDATE publishing_social_posts SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1`,[sched.data.post.id]);
 assert.equal((await jsonReq(f.url,'/social/run-due',{method:'POST',body:{},owner:'bob'})).data.published,0,'bob schedule never dispatches alice posts');
 const due=await jsonReq(f.url,'/social/run-due',{method:'POST',body:{},owner:'alice'});
 assert.equal(due.status,200);assert.equal(due.data.published,1);assert.equal(sent.length,2);
});

test('RP-PUB-08: item animations, timeline UI and H.264 MP4 video export coexist with print PDF and refuse unrendered video',{timeout:180000},async t=>{
 const f=await fixture({http:true,extend:mountSharedEditor});t.after(()=>f.close());
 const doc=(await jsonReq(f.url,'/documents',{method:'POST',body:{title:'Animated promo',pageCount:1,templateId:'event-flyer',requestKey:randomUUID()}})).data.document;
 const badAnim=await jsonReq(f.url,`/documents/${doc.id}/edits`,{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),operationsJson:JSON.stringify([{op:'set-frame',frame:'frame1',values:{animation:{preset:'spin-3d',duration:1,delay:0}}}])}});
 assert.equal(badAnim.status,400);assert.equal(badAnim.data.error,'publishing_model_invalid');
 const unrenderedMp4=await jsonReq(f.url,`/documents/${doc.id}/export`,{method:'POST',body:{revision:1,format:'mp4'}});
 assert.equal(unrenderedMp4.status,409);assert.equal(unrenderedMp4.data.error,'publishing_video_render_required');
 const edited=await jsonReq(f.url,`/documents/${doc.id}/edits`,{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),operationsJson:JSON.stringify([{op:'set-page',page:'page1',values:{duration:1.5}},{op:'set-frame',frame:'frame1',values:{animation:{preset:'rise',duration:0.8,delay:0}}},{op:'set-object',page:'page1',object:'hero_band',values:{animation:{preset:'wipe',duration:0.7,delay:0.1}}}])}});
 assert.equal(edited.status,200);
 const vJob=await jsonReq(f.url,`/documents/${doc.id}/render-video`,{method:'POST',body:{revision:2,requestKey:randomUUID()}});
 assert.equal(vJob.status,202);await waitRenderReady(f.url,'/video-jobs',vJob.data.job.id);
 const exported=await jsonReq(f.url,`/documents/${doc.id}/export`,{method:'POST',body:{revision:2,format:'mp4'}});
 assert.equal(exported.status,200);assert.ok(exported.data.bytes>4000);
 const mp4Bytes=Buffer.from(await (await fetch(f.url+exported.data.contentUrl)).arrayBuffer());
 assert.equal(mp4Bytes.subarray(4,8).toString('ascii'),'ftyp','valid ISO BMFF / H.264 MP4 output');
 const pJob=await jsonReq(f.url,`/documents/${doc.id}/render`,{method:'POST',body:{revision:2,requestKey:randomUUID()}});
 await waitRenderReady(f.url,'/jobs',pJob.data.job.id);
 const pdfExp=await jsonReq(f.url,`/documents/${doc.id}/export`,{method:'POST',body:{revision:2,format:'pdf'}});
 assert.equal(pdfExp.status,200);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await openStudio(page,f.url,doc.id,2);
 await pick(page,'#more-menu','Video timeline');
 await page.locator('#video-timeline:not([hidden]) #pub-tl-scrub').waitFor();
 assert.equal(await page.locator('#pub-tl-play').isEnabled(),true);
});
