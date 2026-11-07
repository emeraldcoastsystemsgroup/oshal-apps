/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add caller signatures, view preferences, word boxes, photo-to-PDF, PDF size reduction and OOXML conversion to PdfStore.
 */
import {randomUUID} from 'node:crypto';
import {id,title,digest,exact,fail,initial} from './model.mjs';
import {output} from './engine-client.mjs';

const ownerWhere='owner_issuer=$1 AND owner_sub=$2';
const inspectionReceipt=inspection=>({...inspection,pages:inspection.pages.map(({objects,...page})=>page)});

function decodeImageBase64(encoded,limitBytes,code){
 if(typeof encoded!=='string'||encoded.length<8||encoded.length>Math.ceil(limitBytes*4/3)+4)fail(413,code);
 const raw=encoded.replace(/^data:image\/(?:png|jpeg);base64,/i,'');
 const data=Buffer.from(raw,'base64');
 if(!data.length||data.length>limitBytes||data.toString('base64')!==raw)fail(400,'pdf_invalid_encoding');
 return data;
}

export function attachStoreExtensions(PdfStore){
 Object.assign(PdfStore.prototype,{
  async pageWords(document,pageId,rev){
   const saved=await this.content(document,rev,'read');
   const index=saved.model.pages.findIndex(p=>p.id===id(pageId));
   if(index<0)fail(404,'pdf_page_unavailable');
   const rendered=await this.render('read',{op:'words',data:saved.data.toString('base64'),page:index});
   return{page:pageId,index,words:Array.isArray(rendered.words)?rendered.words:[]};
  },

  async getPreferences(){
   return this.transaction('view',async(client,owner)=>{
    const row=(await client.query(`SELECT page_layout,night_mode FROM pdf_view_preferences WHERE ${ownerWhere}`,owner)).rows[0];
    return{preferences:{pageLayout:row?.page_layout??'continuous',nightMode:Boolean(row?.night_mode)}};
   });
  },

  async savePreferences(input){
   exact(input,['pageLayout','nightMode']);
   const current=await this.getPreferences();
   const layout=input.pageLayout??current.preferences.pageLayout;
   const night=input.nightMode??current.preferences.nightMode;
   if(!['continuous','single','two-page'].includes(layout)||typeof night!=='boolean')fail(400,'pdf_invalid_preferences');
   return this.transaction('view',async(client,owner)=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pdf:' || $1 || ':' || $2,0))",owner);
    const updated=await client.query(`UPDATE pdf_view_preferences SET page_layout=$3,night_mode=$4,updated_at=now() WHERE ${ownerWhere} RETURNING page_layout,night_mode`,[...owner,layout,night]);
    const row=updated.rows[0]??(await client.query('INSERT INTO pdf_view_preferences(owner_issuer,owner_sub,page_layout,night_mode) VALUES($1,$2,$3,$4) RETURNING page_layout,night_mode',[...owner,layout,night])).rows[0];
    await this.metadataQuota(client,owner);
    return{preferences:{pageLayout:row.page_layout,nightMode:Boolean(row.night_mode)}};
   });
  },

  async listSignatures(){
   return this.transaction('read',async(client,owner)=>{
    const rows=(await client.query(`SELECT id,title,mime,source_kind,transparent_bg,inspection,created_at FROM pdf_signatures WHERE ${ownerWhere} ORDER BY created_at DESC LIMIT 32`,owner)).rows;
    return{signatures:rows.map(r=>({id:r.id,title:r.title,type:r.mime,sourceKind:r.source_kind,transparentBg:Boolean(r.transparent_bg),createdAt:new Date(r.created_at).toISOString(),...r.inspection}))};
   });
  },

  async saveSignature(input){
   exact(input,['title','dataBase64','sourceKind','transparentBg','requestKey']);
   const name=title(input.title),key=id(input.requestKey),sourceKind=input.sourceKind??'drawn',transparentBg=Boolean(input.transparentBg);
   if(!['drawn','image'].includes(sourceKind))fail(400,'pdf_invalid_signature');
   const data=decodeImageBase64(input.dataBase64,1048576,'pdf_signature_limit');
   const inspected=await this.render('change',{op:'inspect-image',data:data.toString('base64')});
   if(inspected.sha256!==digest(data)||inspected.bytes!==data.length||!['image/png','image/jpeg'].includes(inspected.type))fail(503,'pdf_signature_invalid');
   return this.transaction('change',async(client,owner)=>this.request(client,owner,key,digest(JSON.stringify(['signature',name,sourceKind,transparentBg,digest(data)])),async()=>{
    if(Number((await client.query(`SELECT count(*)::int AS n FROM pdf_signatures WHERE ${ownerWhere}`,owner)).rows[0].n)>=32)fail(413,'pdf_signature_count_limit');
    const sigId=randomUUID(),blob=await this.putBlob(client,owner,data,false);
    await client.query('INSERT INTO pdf_signatures(id,owner_issuer,owner_sub,blob_id,title,mime,source_kind,transparent_bg,inspection) VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9::jsonb)',[...owner,sigId,blob,name,inspected.type,sourceKind,transparentBg,JSON.stringify(inspected)]);
    return{signature:{id:sigId,title:name,type:inspected.type,sourceKind,transparentBg,notCertifiedDigitalSignature:true,...inspected}};
   }));
  },

  async signatureContent(sigId){
   return this.transaction('read',async(client,owner)=>{
    const row=(await client.query(`SELECT blob_id,mime FROM pdf_signatures WHERE ${ownerWhere} AND id=$3`,[...owner,id(sigId)])).rows[0];
    if(!row)fail(404,'pdf_signature_unavailable');
    return{data:await this.blob(client,owner,row.blob_id),type:row.mime};
   });
  },

  async placeSignatureAsset(sigId,input){
   exact(input,['requestKey']);
   const key=id(input.requestKey),target=id(sigId);
   return this.transaction('change',async(client,owner)=>this.request(client,owner,key,digest(JSON.stringify(['place-signature',target])),async()=>{
    const row=(await client.query(`SELECT * FROM pdf_signatures WHERE ${ownerWhere} AND id=$3`,[...owner,target])).rows[0];
    if(!row)fail(404,'pdf_signature_unavailable');
    if(Number((await client.query(`SELECT count(*)::int AS n FROM pdf_image_assets WHERE ${ownerWhere}`,owner)).rows[0].n)>=128)fail(413,'pdf_image_asset_count_limit');
    const data=await this.blob(client,owner,row.blob_id),assetId=randomUUID(),blob=await this.putBlob(client,owner,data,false);
    await client.query('INSERT INTO pdf_image_assets(id,owner_issuer,owner_sub,blob_id,title,mime,inspection) VALUES($3,$1,$2,$4,$5,$6,$7::jsonb)',[...owner,assetId,blob,row.title,row.mime,JSON.stringify(row.inspection)]);
    return{asset:{id:assetId,title:row.title,type:row.mime,...row.inspection}};
   }));
  },

  async removeSignature(sigId){
   return this.transaction('delete',async(client,owner)=>{
    const row=(await client.query(`SELECT * FROM pdf_signatures WHERE ${ownerWhere} AND id=$3`,[...owner,id(sigId)])).rows[0];
    if(!row)fail(404,'pdf_signature_unavailable');
    await client.query(`DELETE FROM pdf_signatures WHERE ${ownerWhere} AND id=$3`,[...owner,sigId]);
    await client.query(`UPDATE pdf_requests SET result='{"deleted":true}'::jsonb WHERE ${ownerWhere} AND result->'signature'->>'id'=$3`,[...owner,sigId]);
    await client.query(`DELETE FROM pdf_blobs WHERE ${ownerWhere} AND id=$3`,[...owner,row.blob_id]);
    return{deleted:true};
   });
  },

  async createFromPhotos(input){
   exact(input,['title','photos','requestKey']);
   const name=title(input.title),key=id(input.requestKey),photos=input.photos;
   if(!Array.isArray(photos)||photos.length<1||photos.length>32)fail(400,'pdf_photo_limit');
   const sanitized=photos.map(item=>{
    exact(item,['name','type','data']);
    if(!['image/jpeg','image/png'].includes(item.type))fail(400,'pdf_content_image_unsupported');
    const raw=decodeImageBase64(item.data,4194304,'pdf_photo_limit');
    return{name:typeof item.name==='string'?item.name.slice(0,120):'photo',type:item.type,data:raw.toString('base64')};
   });
   const rendered=await this.render('create',{op:'photos-to-pdf',photos:sanitized}),pdfData=output(rendered),inspection={...rendered};delete inspection.data;
   return this.transaction('create',async(client,owner)=>this.request(client,owner,key,digest(JSON.stringify(['photos',name,sanitized.map(p=>digest(Buffer.from(p.data,'base64')))])),async()=>{
    if(Number((await client.query(`SELECT count(*)::int AS n FROM pdf_sources WHERE ${ownerWhere}`,owner)).rows[0].n)>=32)fail(413,'pdf_source_count_limit');
    if(Number((await client.query(`SELECT count(*)::int AS n FROM pdf_documents WHERE ${ownerWhere}`,owner)).rows[0].n)>=32)fail(413,'pdf_document_count_limit');
    const sourceId=randomUUID(),srcBlob=await this.putBlob(client,owner,pdfData);
    await client.query('INSERT INTO pdf_sources(id,owner_issuer,owner_sub,blob_id,title,inspection) VALUES($3,$1,$2,$4,$5,$6::jsonb)',[...owner,sourceId,srcBlob,name,JSON.stringify(inspectionReceipt(inspection))]);
    const model=initial({id:sourceId,pages:inspection.pages}),docId=randomUUID();
    await client.query('INSERT INTO pdf_documents(id,owner_issuer,owner_sub,title,current_revision) VALUES($3,$1,$2,$4,1)',[...owner,docId,name]);
    await this.revision(client,owner,docId,1,model,pdfData,inspection);
    return{source:{id:sourceId,title:name,...inspectionReceipt(inspection)},document:{id:docId,title:name,revision:1,model,inspection:inspectionReceipt(inspection)}};
   }));
  },

  async compressDocument(document,input){
   exact(input,['level','requestKey']);
   const level=input.level??'balanced',key=id(input.requestKey),docId=id(document);
   if(!['balanced','maximum'].includes(level))fail(400,'pdf_invalid_input');
   const current=await this.content(docId,undefined,'change');
   const compressed=await this.render('change',{op:'compress',data:current.data.toString('base64'),level}),outBytes=output(compressed);
   const{beforeBytes,afterBytes,savedBytes,data:_raw,...inspection}=compressed;
   return this.transaction('change',async(client,owner)=>this.request(client,owner,key,digest(JSON.stringify(['compress',docId,level,digest(current.data)])),async()=>{
    const{row}=await this.getRow(client,owner,docId);
    if(row.current_revision>=100)fail(413,'pdf_history_limit');
    if(Number((await client.query(`SELECT count(*)::int AS n FROM pdf_sources WHERE ${ownerWhere}`,owner)).rows[0].n)>=32)fail(413,'pdf_source_count_limit');
    const sourceId=randomUUID(),srcBlob=await this.putBlob(client,owner,outBytes),srcTitle=(row.title+' (compressed)').slice(0,160);
    await client.query('INSERT INTO pdf_sources(id,owner_issuer,owner_sub,blob_id,title,inspection) VALUES($3,$1,$2,$4,$5,$6::jsonb)',[...owner,sourceId,srcBlob,srcTitle,JSON.stringify(inspectionReceipt(inspection))]);
    const nextRev=row.current_revision+1,nextModel=initial({id:sourceId,pages:inspection.pages});
    await this.revision(client,owner,docId,nextRev,nextModel,outBytes,inspection);
    const updated=await client.query(`UPDATE pdf_documents SET current_revision=$4,updated_at=now() WHERE ${ownerWhere} AND id=$3 AND current_revision=$5 RETURNING id`,[...owner,docId,nextRev,row.current_revision]);
    if(!updated.rows.length)fail(409,'pdf_revision_conflict');
    return{document:docId,revision:nextRev,level,beforeBytes,afterBytes,savedBytes,sha256:inspection.sha256,downloadUrl:`/api/pdf-workbench/documents/${docId}/revisions/${nextRev}/content`};
   }));
  },

  async convertDocument(document,{format,revision}){
   if(!['docx','xlsx','pptx'].includes(format))fail(400,'pdf_invalid_format');
   const saved=await this.content(id(document),revision,'export');
   const rendered=await this.render('export',{op:'convert',data:saved.data.toString('base64'),format,title:saved.title});
   const archive=Buffer.from(rendered.data??'','base64');
   if(archive.length!==rendered.bytes||digest(archive)!==rendered.sha256||archive.subarray(0,4).toString('hex')!=='504b0304')fail(503,'pdf_conversion_invalid');
   const base=saved.title.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'document';
   return{data:archive,format,type:rendered.type,bytes:rendered.bytes,sha256:rendered.sha256,approximateLayout:true,filename:`${base}.${format}`};
  }
 });
}
