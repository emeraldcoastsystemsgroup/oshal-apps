/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-07): document sharing (`view`, `comment`, `edit`), collaborator edit enforcement, immutable access auditing, and cross-person native sandbox mirror when `OSHAL_PACKAGE_DATA_DIR` is mounted.
 */
import{randomUUID}from'node:crypto';
import{existsSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{validate,fail,exact,oneOf,text,integer,stableJSON}from'../../tools/office/model.mjs';
import{applyOperations}from'../../tools/office/operations.mjs';
import{sha}from'./formats.mjs';

export const SHARE_ROLES=['view','comment','edit'];
const COMMENT_OPS=new Set(['add-comment','reply-comment','resolve-comment','propose-change']);
const UUID_RE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validId=id=>{if(typeof id!=='string'||!UUID_RE.test(id))fail('office_invalid_id','Choose a valid identity.');return id;};

function mirrorDir(){
 const root=process.env.OSHAL_PACKAGE_DATA_DIR;
 if(!root)return null;
 const dir=join(root,'office-shares');
 mkdirSync(dir,{recursive:true,mode:0o700});
 return dir;
}

function readMirror(docId){
 const dir=mirrorDir();if(!dir)return null;
 const path=join(dir,docId+'.json');
 if(!existsSync(path))return null;
 try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}
}

function writeMirror(docId,record){
 const dir=mirrorDir();if(!dir)return;
 const tmp=join(dir,`${docId}.${randomUUID()}.tmp`),dest=join(dir,docId+'.json');
 writeFileSync(tmp,JSON.stringify(record),{mode:0o600});
 renameSync(tmp,dest);
}

export function removeMirror(docId){
 const dir=mirrorDir();if(!dir)return;
 rmSync(join(dir,docId+'.json'),{force:true});
}

export async function auditAccess(store,{ownerKey,documentId,action,role,detail=''}){
 const act=store.originalActor,id=randomUUID(),createdAt=new Date().toISOString();
 const client=await store.ctx.pool.connect();
 let begun=false;
 try{
  await client.query('BEGIN');begun=true;
  await store.configureSession(client);
  await client.query('INSERT INTO office_editor_share_audit(id,owner_key,document_id,tenant_id,actor_issuer,actor_sub,action,role,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,ownerKey,documentId,act.tenant,act.issuer,act.sub,action,role,String(detail).slice(0,240),createdAt]);
  await client.query('COMMIT');begun=false;
 }catch{if(begun)await client.query('ROLLBACK').catch(()=>{});}
 finally{client.release();}
 const mirror=readMirror(documentId);
 if(mirror&&mirror.tenantId===act.tenant){
  mirror.audit.unshift({id,actorIssuer:act.issuer,actorSub:act.sub,action,role,detail:String(detail).slice(0,240),createdAt});
  mirror.audit=mirror.audit.slice(0,200);
  writeMirror(documentId,mirror);
 }
}

export async function syncOwnerFromMirror(store,client,docId){
 const mirror=readMirror(docId);
 if(!mirror||mirror.ownerKey!==store.owner)return;
 const head=(await client.query('SELECT * FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[store.owner,docId])).rows[0];
 if(!head||mirror.head.current_revision<=head.current_revision)return;
 for(const rev of mirror.revisions){
  if(rev.revision<=head.current_revision)continue;
  const source=stableJSON(rev.model),bytes=Buffer.byteLength(source);
  await client.query('INSERT INTO office_editor_revisions(owner_key,document_id,revision,model,sha256,bytes) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[store.owner,docId,rev.revision,source,sha(Buffer.from(source)),bytes]);
 }
 await client.query('UPDATE office_editor_documents SET title=$3,current_revision=$4,updated_at=now() WHERE owner_key=$1 AND id=$2 AND current_revision=$5 RETURNING id',[store.owner,docId,mirror.head.title,mirror.head.current_revision,head.current_revision]);
}

export async function refreshOwnerMirror(store,client,docId){
 if(!mirrorDir())return;
 const shares=(await client.query('SELECT * FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2',[store.owner,docId])).rows;
 const existing=readMirror(docId);
 if(!shares.length&&!existing){return;}
 const head=(await client.query('SELECT * FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[store.owner,docId])).rows[0];
 if(!head){removeMirror(docId);return;}
 const revs=(await client.query('SELECT * FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 ORDER BY revision ASC',[store.owner,docId])).rows.map(r=>({revision:r.revision,model:typeof r.model==='string'?JSON.parse(r.model):r.model,sha256:r.sha256,created_at:r.created_at}));
 writeMirror(docId,{ownerKey:store.owner,tenantId:store.originalActor.tenant,ownerIssuer:store.originalActor.issuer,ownerSub:store.originalActor.sub,head,revisions:revs,shares,audit:existing?.audit??[]});
}

export async function resolveSharedRow(store,client,id,revision){
 validId(id);
 const act=store.originalActor;
 const share=(await client.query('SELECT * FROM office_editor_shares WHERE document_id=$1 AND tenant_id=$2 AND grantee_issuer=$3 AND grantee_sub=$4',[id,act.tenant,act.issuer,act.sub])).rows[0];
 if(share){
  const head=(await client.query('SELECT * FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[share.owner_key,id])).rows[0];
  if(!head)return null;
  const saved=(await client.query('SELECT * FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3',[share.owner_key,id,revision??head.current_revision])).rows[0];
  if(!saved)fail('office_revision_missing','This saved revision is unavailable.',404);
  const model=typeof saved.model==='string'?JSON.parse(saved.model):saved.model;
  if(sha(Buffer.from(stableJSON(model)))!==saved.sha256)fail('office_revision_corrupt','The saved document failed its integrity check.',503);
  const history=(await client.query('SELECT revision,created_at FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 ORDER BY revision DESC',[share.owner_key,id])).rows;
  return{docOwnerKey:share.owner_key,accessRole:share.role,ownerSub:share.owner_sub,history,document:{id:head.id,title:model.title,kind:model.kind,revision:saved.revision,currentRevision:head.current_revision,updatedAt:head.updated_at,sha256:saved.sha256,model,original:null}};
 }
 const mirror=readMirror(id);
 if(!mirror||mirror.tenantId!==act.tenant)return null;
 const mShare=mirror.shares.find(s=>s.grantee_issuer===act.issuer&&s.grantee_sub===act.sub);
 if(!mShare)return null;
 const targetRev=revision??mirror.head.current_revision,saved=mirror.revisions.find(r=>r.revision===targetRev);
 if(!saved)fail('office_revision_missing','This saved revision is unavailable.',404);
 return{docOwnerKey:mirror.ownerKey,accessRole:mShare.role,ownerSub:mirror.ownerSub,history:[...mirror.revisions].reverse().map(r=>({revision:r.revision,created_at:r.created_at})),document:{id:mirror.head.id,title:saved.model.title,kind:saved.model.kind,revision:saved.revision,currentRevision:mirror.head.current_revision,updatedAt:mirror.head.updated_at,sha256:saved.sha256,model:saved.model,original:null}};
}

export async function listSharedSummaries(store,client){
 const act=store.originalActor,seen=new Set(),items=[];
 const dbShares=(await client.query('SELECT * FROM office_editor_shares WHERE tenant_id=$1 AND grantee_issuer=$2 AND grantee_sub=$3',[act.tenant,act.issuer,act.sub])).rows;
 for(const share of dbShares){
  const head=(await client.query('SELECT id,title,kind,current_revision,updated_at FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[share.owner_key,share.document_id])).rows[0];
  if(!head)continue;
  seen.add(head.id);
  items.push({id:head.id,title:head.title,kind:head.kind,revision:head.current_revision,updatedAt:head.updated_at,shared:true,accessRole:share.role,ownerSub:share.owner_sub});
 }
 const dir=mirrorDir();
 if(dir){
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){
   const mirror=readMirror(file.slice(0,-5));
   if(!mirror||mirror.tenantId!==act.tenant||seen.has(mirror.head.id))continue;
   const share=mirror.shares.find(s=>s.grantee_issuer===act.issuer&&s.grantee_sub===act.sub);
   if(share)items.push({id:mirror.head.id,title:mirror.head.title,kind:mirror.head.kind,revision:mirror.head.current_revision,updatedAt:mirror.head.updated_at,shared:true,accessRole:share.role,ownerSub:mirror.ownerSub});
  }
 }
 return items;
}

export function stampCollaboratorOps(operations,accessRole,actorSub){
 if(!Array.isArray(operations)||!operations.length)fail('office_invalid_edit','Supply at least one collaborative operation.');
 if(accessRole==='comment'&&operations.some(op=>!COMMENT_OPS.has(op?.op))){
  fail('office_share_comment_only','Comment access allows comments and suggested changes only.',403);
 }
 return operations.map(op=>{
  if(op.op==='add-comment')return{...op,comment:{...(op.comment??{}),author:actorSub}};
  if(op.op==='reply-comment')return{...op,reply:{...(op.reply??{}),author:actorSub}};
  if(op.op==='propose-change')return{...op,author:actorSub};
  return op;
 });
}

export async function saveSharedDocument(store,id,input,imageValidation){
 validId(id);exact(input,['baseRevision','requestKey','model','operations']);
 integer(input.baseRevision,1,99);validId(input.requestKey);
 const act=store.originalActor;
 const outcome=await store.tx('read',true,async client=>{
  const shared=await resolveSharedRow(store,client,id);
  if(!shared)return{missing:true};
  if(shared.accessRole==='view')return{denied:'view',ownerKey:shared.docOwnerKey};
  if(shared.accessRole==='comment'&&input.model!==undefined)return{denied:'comment_model',ownerKey:shared.docOwnerKey};
  let nextModel;
  try{
   const ops=input.operations?stampCollaboratorOps(input.operations,shared.accessRole,act.sub):null;
   nextModel=ops?applyOperations(shared.document.model,ops):validate(input.model);
  }catch(err){
   if(err.code==='office_share_comment_only')return{denied:'comment_op',ownerKey:shared.docOwnerKey,error:err};
   throw err;
  }
  if(nextModel.kind!==shared.document.kind)fail('office_kind_changed','Save a separate document to change its Office type.');
  if(shared.document.revision!==input.baseRevision)fail('office_revision_conflict','A newer revision exists. Reopen the shared document.',409);
  await imageValidation(nextModel);
  const nextRev=shared.document.revision+1,source=stableJSON(nextModel),bytes=Buffer.byteLength(source),digest=sha(Buffer.from(source));
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[BigInt('0x'+shared.docOwnerKey.slice(0,15)).toString()]);
  const dbShare=(await client.query('SELECT id FROM office_editor_shares WHERE document_id=$1 AND tenant_id=$2 AND grantee_issuer=$3 AND grantee_sub=$4',[id,act.tenant,act.issuer,act.sub])).rows[0];
  if(dbShare){
   await client.query('INSERT INTO office_editor_revisions(owner_key,document_id,revision,model,sha256,bytes) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[shared.docOwnerKey,id,nextRev,source,digest,bytes]);
   const up=await client.query('UPDATE office_editor_documents SET title=$3,current_revision=$4,updated_at=now() WHERE owner_key=$1 AND id=$2 AND current_revision=$5 RETURNING updated_at',[shared.docOwnerKey,id,nextModel.title,nextRev,shared.document.revision]);
   if(!up.rows.length)fail('office_revision_conflict','The shared document changed while saving.',409);
  }
  const mirror=readMirror(id);
  if(mirror){
   mirror.revisions.push({revision:nextRev,model:nextModel,sha256:digest,created_at:new Date().toISOString()});
   mirror.head={...mirror.head,title:nextModel.title,current_revision:nextRev,updated_at:new Date().toISOString()};
   writeMirror(id,mirror);
  }
  const refreshed=await resolveSharedRow(store,client,id,nextRev);
  return{saved:refreshed};
 });
 if(outcome.missing){await auditAccess(store,{ownerKey:store.owner,documentId:id,action:'denied',role:'none',detail:'collaborate_missing'});fail('office_document_missing','This document is unavailable to your account.',404);}
 if(outcome.denied){
  await auditAccess(store,{ownerKey:outcome.ownerKey,documentId:id,action:'denied',role:outcome.denied==='view'?'view':'comment',detail:outcome.denied});
  if(outcome.error)throw outcome.error;
  fail('office_share_forbidden','Your share permission does not allow editing this document.',403);
 }
 const s=outcome.saved;
 await auditAccess(store,{ownerKey:s.docOwnerKey,documentId:id,action:s.accessRole==='comment'?'comment':'edit',role:s.accessRole,detail:'revision:'+s.document.revision});
 return{document:{...s.document,accessRole:s.accessRole,ownerSub:s.ownerSub,canEdit:s.accessRole==='edit',canComment:true,canShare:false}};
}

export async function listDocumentShares(store,id){
 validId(id);
 return store.tx('read',true,async client=>{
  await syncOwnerFromMirror(store,client,id);
  const head=(await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[store.owner,id])).rows[0];
  if(!head){await auditAccess(store,{ownerKey:store.owner,documentId:id,action:'denied',role:'none',detail:'list_shares'});fail('office_share_owner_only','Only the document owner can view or manage sharing.',403);}
  const shares=(await client.query('SELECT id,grantee_issuer,grantee_sub,role,created_at,updated_at FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2 ORDER BY created_at ASC',[store.owner,id])).rows.map(r=>({id:r.id,granteeIssuer:r.grantee_issuer,granteeSub:r.grantee_sub,role:r.role,createdAt:r.created_at,updatedAt:r.updated_at}));
  const dbAudit=(await client.query('SELECT id,actor_sub,action,role,detail,created_at FROM office_editor_share_audit WHERE owner_key=$1 AND document_id=$2 ORDER BY created_at DESC LIMIT 50',[store.owner,id])).rows.map(a=>({id:a.id,actorSub:a.actor_sub,action:a.action,role:a.role,detail:a.detail,createdAt:a.created_at}));
  const mirrorAudit=(readMirror(id)?.audit??[]).map(a=>({id:a.id,actorSub:a.actorSub,action:a.action,role:a.role,detail:a.detail,createdAt:a.createdAt}));
  const seen=new Set(dbAudit.map(a=>a.id));
  const audit=[...dbAudit,...mirrorAudit.filter(a=>!seen.has(a.id))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,50);
  return{shares,audit};
 });
}

export async function grantDocumentShare(store,id,input){
 validId(id);exact(input,['granteeSub','granteeIssuer','role','requestKey']);
 if(input.requestKey!==undefined)validId(input.requestKey);
 const role=oneOf(input.role,SHARE_ROLES),act=store.originalActor;
 const granteeSub=text(input.granteeSub,255).trim(),granteeIssuer=text(input.granteeIssuer??act.issuer,255).trim();
 if(!granteeSub||!granteeIssuer)fail('office_invalid_share','Enter a person identifier to share with.');
 if(granteeSub===act.sub&&granteeIssuer===act.issuer)fail('office_share_self','You already own this document.');
 const share=await store.tx('change',true,async client=>{
  await syncOwnerFromMirror(store,client,id);
  const head=(await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[store.owner,id])).rows[0];
  if(!head)fail('office_share_owner_only','Only the document owner can share this document.',403);
  const existing=(await client.query('SELECT id FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2 AND grantee_issuer=$3 AND grantee_sub=$4',[store.owner,id,granteeIssuer,granteeSub])).rows[0];
  let shareId;
  if(existing){
   shareId=existing.id;
   await client.query('UPDATE office_editor_shares SET role=$3,updated_at=now() WHERE owner_key=$1 AND id=$2',[store.owner,shareId,role]);
  }else{
   if(Number((await client.query('SELECT count(*)::int AS n FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2',[store.owner,id])).rows[0].n)>=50)fail('office_share_limit','A document supports at most 50 collaborators.',413);
   shareId=randomUUID();
   await client.query('INSERT INTO office_editor_shares(owner_key,id,document_id,tenant_id,owner_issuer,owner_sub,grantee_issuer,grantee_sub,role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[store.owner,shareId,id,act.tenant,act.issuer,act.sub,granteeIssuer,granteeSub,role]);
  }
  await refreshOwnerMirror(store,client,id);
  return{id:shareId,documentId:id,granteeIssuer,granteeSub,role};
 });
 await auditAccess(store,{ownerKey:store.owner,documentId:id,action:'share_grant',role,detail:`grantee:${granteeSub}`});
 return{share};
}

export async function revokeDocumentShare(store,id,shareId){
 validId(id);validId(shareId);
 const removed=await store.tx('change',true,async client=>{
  await syncOwnerFromMirror(store,client,id);
  const existing=(await client.query('SELECT * FROM office_editor_shares WHERE owner_key=$1 AND id=$2 AND document_id=$3',[store.owner,shareId,id])).rows[0];
  if(!existing)fail('office_share_missing','That share entry is unavailable.',404);
  await client.query('DELETE FROM office_editor_shares WHERE owner_key=$1 AND id=$2',[store.owner,shareId]);
  await refreshOwnerMirror(store,client,id);
  return existing;
 });
 await auditAccess(store,{ownerKey:store.owner,documentId:id,action:'share_revoke',role:removed.role,detail:`grantee:${removed.grantee_sub}`});
 return{revoked:true,id:shareId};
}
