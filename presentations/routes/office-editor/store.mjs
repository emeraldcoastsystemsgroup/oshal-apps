/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Original-owned immutable Office revisions, sealed retries, original file retention and stale-write rejection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-05, RP-OFF-07): PDF/plain-text export support, two-arm forced-RLS document sharing (`view`, `comment`, `edit`), collaborator edits and immutable access auditing.
 */
import{randomUUID}from'node:crypto';
import{createRequire}from'node:module';
import{validate,initial,fail,exact,integer,stableJSON}from'../../tools/office/model.mjs';
import{applyOperations}from'../../tools/office/operations.mjs';
import{actor,ownerKey,access}from'./authorization.mjs';
import{inspectOffice}from'./importers.mjs';
import{renderOffice,MIME,sha}from'./formats.mjs';
import{auditAccess,syncOwnerFromMirror,refreshOwnerMirror,removeMirror,resolveSharedRow,listSharedSummaries,saveSharedDocument,listDocumentShares,grantDocumentShare,revokeDocumentShare}from'./sharing.mjs';
const require=createRequire(import.meta.url),encode=stableJSON,identifier=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))fail('office_invalid_id','Choose a valid document identity.');return value;};

async function imageValidation(model){
 const values=model.kind==='xlsx'?[]:model.pages.flatMap(page=>(model.kind==='pptx'?page.objects:page.blocks).filter(value=>value.type==='image').map(value=>value.src));
 if(new Set(values).size>32)fail('office_image_limit','Use at most 32 embedded images.');
 let pixels=0;
 for(const value of new Set(values)){
  const bytes=Buffer.from(value.split(',')[1],'base64');
  if(bytes.length>2097152)fail('office_image_limit','Each embedded image must be at most 2 MiB.');
  const sharp=require('sharp'),metadata=await sharp(bytes,{limitInputPixels:16000000,animated:false}).metadata();
  pixels+=metadata.width*metadata.height;
  if(pixels>33554432)fail('office_image_limit','Embedded images exceed 32 million decoded pixels.');
  if(!['png','jpeg'].includes(metadata.format)||metadata.width>4096||metadata.height>4096)fail('office_invalid_image','Use a PNG/JPEG image up to 4096 pixels per side.');
  await sharp(bytes,{limitInputPixels:16000000,animated:false}).raw().toBuffer();
 }
}

function decorateAccess(doc,accessRole='owner',ownerSub=null){
 return{...doc,accessRole,ownerSub,canEdit:accessRole==='owner'||accessRole==='edit',canComment:accessRole!=='view',canShare:accessRole==='owner'};
}

export class OfficeStore{
 constructor(ctx){if(!ctx.pool?.connect||!ctx.authorization?.authorize)throw new Error('office_original_context_required');this.ctx=ctx;this.originalActor=actor(ctx);this.owner=ownerKey(this.originalActor);}
 async configureSession(client){
  await client.query("SET LOCAL statement_timeout='5s'");
  await client.query("SET LOCAL lock_timeout='2s'");
  await client.query("SELECT set_config('office_editor.owner_key',$1,true)",[this.owner]);
  await client.query("SELECT set_config('office_editor.actor_issuer',$1,true)",[this.originalActor.issuer]);
  await client.query("SELECT set_config('office_editor.actor_sub',$1,true)",[this.originalActor.sub]);
  await client.query("SELECT set_config('office_editor.tenant_id',$1,true)",[this.originalActor.tenant]);
 }
 async tx(action,write,work){
  await access(this.ctx,action,this.originalActor);const client=await this.ctx.pool.connect();let begun=false;
  try{
   await client.query(write?'BEGIN':'BEGIN READ ONLY');begun=true;
   await this.configureSession(client);
   if(write)await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[BigInt('0x'+this.owner.slice(0,15)).toString()]);
   const result=await work(client);await access(this.ctx,action,this.originalActor);await client.query('COMMIT');begun=false;await access(this.ctx,action,this.originalActor);return result;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
 async row(client,id,revision){
  identifier(id);
  const head=(await client.query('SELECT * FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id])).rows[0];
  if(!head)fail('office_document_missing','This document is unavailable to your account.',404);
  const saved=(await client.query('SELECT * FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3',[this.owner,id,revision??head.current_revision])).rows[0];
  if(!saved)fail('office_revision_missing','This saved revision is unavailable.',404);
  const model=typeof saved.model==='string'?JSON.parse(saved.model):saved.model;
  if(sha(Buffer.from(encode(model)))!==saved.sha256)fail('office_revision_corrupt','The saved document failed its integrity check.',503);
  return decorateAccess({id:head.id,title:model.title,kind:model.kind,revision:saved.revision,currentRevision:head.current_revision,updatedAt:head.updated_at,sha256:saved.sha256,model,original:head.original_id?{id:head.original_id,name:head.original_name,sha256:head.original_sha256}:null},'owner',this.originalActor.sub);
 }
 async quota(client,bytes){const rows=(await client.query('SELECT COALESCE(sum(bytes),0)::text AS bytes FROM office_editor_revisions WHERE owner_key=$1',[this.owner])).rows[0],originals=(await client.query('SELECT COALESCE(sum(bytes),0)::text AS bytes FROM office_editor_originals WHERE owner_key=$1',[this.owner])).rows[0];if(Number(rows.bytes)+Number(originals.bytes)+bytes>67108864)fail('office_owner_quota','Office revision storage exceeds 64 MiB. Delete an unused document first.',413);}
 async append(client,id,revision,model){const source=encode(model),bytes=Buffer.byteLength(source);await this.quota(client,bytes);await client.query('INSERT INTO office_editor_revisions(owner_key,document_id,revision,model,sha256,bytes) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[this.owner,id,revision,source,sha(Buffer.from(source)),bytes]);}
 async request(client,key,input,work){identifier(key);const fingerprint=sha(Buffer.from(encode(input))),existing=(await client.query('SELECT * FROM office_editor_requests WHERE owner_key=$1 AND request_key=$2',[this.owner,key])).rows[0];if(existing){if(existing.fingerprint!==fingerprint)fail('office_retry_mismatch','This request key already belongs to another edit.',409);if(existing.tombstone)fail('office_deleted_request','The document from this request was deleted.',410);return{...await this.row(client,existing.document_id,existing.revision),replayed:true};}await client.query('DELETE FROM office_editor_requests WHERE owner_key=$1 AND expires_at<$2',[this.owner,new Date().toISOString()]);if(Number((await client.query('SELECT count(*)::int AS n FROM office_editor_requests WHERE owner_key=$1',[this.owner])).rows[0].n)>=256)fail('office_retry_capacity','The retry receipt limit is reached. Try again after old receipts expire.',413);const result=await work();await client.query('INSERT INTO office_editor_requests(owner_key,request_key,fingerprint,document_id,revision,expires_at,tombstone) VALUES($1,$2,$3,$4,$5,$6,false)',[this.owner,key,fingerprint,result.id,result.revision,new Date(Date.now()+86400000).toISOString()]);return result;}
 async list(){
  return this.tx('read',Boolean(process.env.OSHAL_PACKAGE_DATA_DIR),async client=>{
   const rawOwned=(await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1',[this.owner])).rows;
   if(process.env.OSHAL_PACKAGE_DATA_DIR)for(const r of rawOwned)await syncOwnerFromMirror(this,client,r.id);
   const owned=(await client.query('SELECT id,title,kind,current_revision,updated_at FROM office_editor_documents WHERE owner_key=$1 ORDER BY updated_at DESC',[this.owner])).rows.map(row=>({id:row.id,title:row.title,kind:row.kind,revision:row.current_revision,updatedAt:row.updated_at,shared:false,accessRole:'owner',ownerSub:this.originalActor.sub}));
   const shared=await listSharedSummaries(this,client);
   const ownedIds=new Set(owned.map(d=>d.id));
   const merged=[...owned,...shared.filter(d=>!ownedIds.has(d.id))].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
   return{documents:merged};
  });
 }
 async read(id,revision){
  identifier(id);if(revision!==undefined)integer(revision,1,100);
  const outcome=await this.tx('read',Boolean(process.env.OSHAL_PACKAGE_DATA_DIR),async client=>{
   if(process.env.OSHAL_PACKAGE_DATA_DIR)await syncOwnerFromMirror(this,client,id);
   const ownedHead=(await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id])).rows[0];
   if(ownedHead){
    const doc=await this.row(client,id,revision);
    const history=(await client.query('SELECT revision,created_at FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 ORDER BY revision DESC',[this.owner,id])).rows;
    return{docOwnerKey:this.owner,accessRole:'owner',document:doc,history};
   }
   const shared=await resolveSharedRow(this,client,id,revision);
   if(!shared)return{missing:true};
   return{docOwnerKey:shared.docOwnerKey,accessRole:shared.accessRole,document:decorateAccess(shared.document,shared.accessRole,shared.ownerSub),history:shared.history};
  });
  if(outcome.missing){await auditAccess(this,{ownerKey:this.owner,documentId:id,action:'denied',role:'none',detail:'read'});fail('office_document_missing','This document is unavailable to your account.',404);}
  await auditAccess(this,{ownerKey:outcome.docOwnerKey,documentId:id,action:'view',role:outcome.accessRole,detail:'revision:'+outcome.document.revision});
  return{document:outcome.document,history:outcome.history};
 }
 async create(input){exact(input,['model','kind','title','requestKey']);const model=input.model?validate(input.model):initial(input.kind,input.title);await imageValidation(model);return this.tx('create',true,async client=>({document:await this.request(client,input.requestKey,['create',input.model?model:{kind:input.kind,title:input.title}],async()=>{if(Number((await client.query('SELECT count(*)::int AS n FROM office_editor_documents WHERE owner_key=$1',[this.owner])).rows[0].n)>=40)fail('office_document_limit','Your Office account has reached 40 documents.',413);const id=randomUUID();await client.query('INSERT INTO office_editor_documents(owner_key,id,title,kind,current_revision) VALUES($1,$2,$3,$4,1)',[this.owner,id,model.title,model.kind]);await this.append(client,id,1,model);return this.row(client,id,1);})}));}
 async save(id,input){
  identifier(id);exact(input,['baseRevision','requestKey','model','operations','restoreRevision']);integer(input.baseRevision,1,99);
  if(['model','operations','restoreRevision'].filter(key=>input[key]!==undefined).length!==1)fail('office_invalid_edit','Supply one edited model, operation batch or revision to restore.');
  if(input.model)await imageValidation(validate(input.model));
  const isOwner=await this.tx('read',false,async client=>Boolean((await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id])).rows[0]));
  if(!isOwner){
   if(input.restoreRevision!==undefined)fail('office_share_owner_only','Only the document owner can restore historical revisions.',403);
   return saveSharedDocument(this,id,{baseRevision:input.baseRevision,requestKey:input.requestKey,model:input.model,operations:input.operations},imageValidation);
  }
  const result=await this.tx('change',true,async client=>({document:await this.request(client,input.requestKey,['save',id,input],async()=>{
   await syncOwnerFromMirror(this,client,id);
   const before=await this.row(client,id);
   if(before.revision!==input.baseRevision)fail('office_revision_conflict','A newer revision exists. Keep this draft, reopen the saved document or save a copy.',409);
   const model=input.model?validate(input.model):input.restoreRevision?(await this.row(client,id,integer(input.restoreRevision,1,100))).model:applyOperations(before.model,input.operations);
   if(model.kind!==before.kind)fail('office_kind_changed','Save a separate document to change its Office type.');
   await imageValidation(model);
   const next=before.revision+1;await this.append(client,id,next,model);
   const updated=await client.query('UPDATE office_editor_documents SET title=$3,current_revision=$4,updated_at=now() WHERE owner_key=$1 AND id=$2 AND current_revision=$5 RETURNING id',[this.owner,id,model.title,next,before.revision]);
   if(!updated.rows.length)fail('office_revision_conflict','The document changed while saving.',409);
   await refreshOwnerMirror(this,client,id);
   return this.row(client,id,next);
  })}));
  await auditAccess(this,{ownerKey:this.owner,documentId:id,action:'edit',role:'owner',detail:'revision:'+result.document.revision});
  return result;
 }
 async collaborate(id,input){
  identifier(id);
  const isOwner=await this.tx('read',false,async client=>Boolean((await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id])).rows[0]));
  if(isOwner)return this.save(id,input);
  return saveSharedDocument(this,id,input,imageValidation);
 }
 async inspect(bytes){if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10485760)fail('office_import_limit','Office imports accept 1–10 MiB.');const attestation=await this.tx('read',false,async client=>(await client.query('SELECT model_sha256 FROM office_editor_exports WHERE owner_key=$1 AND sha256=$2 AND expires_at>NOW()',[this.owner,sha(bytes)])).rows[0]);const result=await inspectOffice(bytes,undefined,attestation?.model_sha256);await access(this.ctx,'read',this.originalActor);return result;}
 async import(input){exact(input,['data','name','sha256','acceptConversion','requestKey']);if(typeof input.data!=='string'||input.data.length>14000000||!/^[a-zA-Z0-9+/]+={0,2}$/.test(input.data))fail('office_import_limit','Choose a bounded Office file.');const bytes=Buffer.from(input.data,'base64'),inspection=await this.inspect(bytes);if(inspection.sha256!==input.sha256)fail('office_import_changed','Inspect these exact original bytes before importing.');if(inspection.requiresConversion&&input.acceptConversion!==true)fail('office_conversion_review_required','Review and accept the conversion findings before creating the editable copy.');const model=inspection.model,name=String(input.name??'original.'+model.kind).slice(0,200);await imageValidation(model);return this.tx('create',true,async client=>({document:await this.request(client,input.requestKey,['import',inspection.sha256,name,input.acceptConversion],async()=>{if(Number((await client.query('SELECT count(*)::int AS n FROM office_editor_documents WHERE owner_key=$1',[this.owner])).rows[0].n)>=40)fail('office_document_limit','Your Office account has reached 40 documents.',413);await this.quota(client,bytes.length);const original=randomUUID(),id=randomUUID();await client.query('INSERT INTO office_editor_originals(owner_key,id,name,sha256,bytes,findings) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[this.owner,original,name,inspection.sha256,bytes.length,JSON.stringify(inspection.findings)]);for(let offset=0;offset<bytes.length;offset+=65536){await access(this.ctx,'create',this.originalActor);const part=bytes.subarray(offset,offset+65536);await client.query('INSERT INTO office_editor_original_parts(owner_key,original_id,offset_bytes,data_base64,sha256) VALUES($1,$2,$3,$4,$5)',[this.owner,original,offset,part.toString('base64'),sha(part)]);}await client.query('INSERT INTO office_editor_documents(owner_key,id,title,kind,current_revision,original_id,original_name,original_sha256) VALUES($1,$2,$3,$4,1,$5,$6,$7)',[this.owner,id,model.title,model.kind,original,name,inspection.sha256]);await this.append(client,id,1,model);return this.row(client,id,1);})}));}
 async original(id){return this.tx('export',false,async client=>{const document=await this.row(client,id);if(!document.original)fail('office_original_missing','This document has no imported original.',404);const record=(await client.query('SELECT * FROM office_editor_originals WHERE owner_key=$1 AND id=$2',[this.owner,document.original.id])).rows[0],parts=(await client.query('SELECT * FROM office_editor_original_parts WHERE owner_key=$1 AND original_id=$2 ORDER BY offset_bytes',[this.owner,record.id])).rows;let offset=0;const output=[];for(const part of parts){const bytes=Buffer.from(part.data_base64,'base64');if(part.offset_bytes!==offset||sha(bytes)!==part.sha256)fail('office_original_corrupt','The original failed its integrity check.',503);offset+=bytes.length;output.push(bytes);}const bytes=Buffer.concat(output);if(offset!==record.bytes||sha(bytes)!==record.sha256)fail('office_original_corrupt','The original failed its integrity check.',503);return{bytes,mime:MIME[document.kind],name:record.name,findings:record.findings};});}
 async export(id,revision,format){
  identifier(id);
  const outcome=await this.tx('export',Boolean(process.env.OSHAL_PACKAGE_DATA_DIR),async client=>{
   if(process.env.OSHAL_PACKAGE_DATA_DIR)await syncOwnerFromMirror(this,client,id);
   const owned=(await client.query('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id])).rows[0];
   if(owned)return{isOwner:true,docOwnerKey:this.owner,accessRole:'owner',source:await this.row(client,id,revision)};
   const shared=await resolveSharedRow(this,client,id,revision);
   if(!shared)return{missing:true};
   return{isOwner:false,docOwnerKey:shared.docOwnerKey,accessRole:shared.accessRole,source:shared.document};
  });
  if(outcome.missing){await auditAccess(this,{ownerKey:this.owner,documentId:id,action:'denied',role:'none',detail:'export'});fail('office_document_missing','This document is unavailable to your account.',404);}
  const source=outcome.source,actualFormat=format??source.kind;
  if(!Object.hasOwn(MIME,actualFormat))fail('office_format_mismatch','Unsupported export format.');
  const bytes=await renderOffice(source.model,actualFormat);
  if(outcome.isOwner&&['pptx','docx','xlsx'].includes(actualFormat)){
   await this.tx('export',true,async client=>{
    await this.row(client,id,revision);
    await client.query('DELETE FROM office_editor_exports WHERE owner_key=$1 AND expires_at<=NOW()',[this.owner]);
    const existing=(await client.query('SELECT model_sha256 FROM office_editor_exports WHERE owner_key=$1 AND sha256=$2 AND expires_at>NOW()',[this.owner,sha(bytes)])).rows[0];
    if(!existing&&Number((await client.query('SELECT count(*)::int AS n FROM office_editor_exports WHERE owner_key=$1',[this.owner])).rows[0].n)<256){
     await client.query("INSERT INTO office_editor_exports(owner_key,sha256,model_sha256,document_id,revision,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '24 hours')",[this.owner,sha(bytes),source.sha256,id,source.revision]);
    }
   });
  }
  await access(this.ctx,'export',this.originalActor);
  await auditAccess(this,{ownerKey:outcome.docOwnerKey,documentId:id,action:'export',role:outcome.accessRole,detail:`${actualFormat}:revision:${source.revision}`});
  return{bytes,mime:MIME[actualFormat],name:source.title+'.'+(actualFormat==='json'?'office.json':actualFormat),sha256:sha(bytes),revision:source.revision};
 }
 async remove(id,baseRevision){
  return this.tx('delete',true,async client=>{
   await syncOwnerFromMirror(this,client,id);
   const document=await this.row(client,id);
   if(document.revision!==baseRevision)fail('office_revision_conflict','Reopen the current document before deleting it.',409);
   await client.query('UPDATE office_editor_requests SET tombstone=true WHERE owner_key=$1 AND document_id=$2',[this.owner,id]);
   await client.query('DELETE FROM office_editor_documents WHERE owner_key=$1 AND id=$2',[this.owner,id]);
   if(document.original)await client.query('DELETE FROM office_editor_originals WHERE owner_key=$1 AND id=$2',[this.owner,document.original.id]);
   removeMirror(id);
   return{deleted:true};
  });
 }
 async listShares(id){return listDocumentShares(this,id);}
 async grantShare(id,input){return grantDocumentShare(this,id,input);}
 async revokeShare(id,shareId){return revokeDocumentShare(this,id,shareId);}
}
