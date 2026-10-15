/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Move complete editable bundles through protected bounded chunks with verified digests and retryable original receipts.
 */
import {Sha256,sha256Bytes,sha256Blob} from './sha256-stream.mjs';
export const BUNDLE_BYTES = 264 * 1024 * 1024, CHUNK_BYTES = 1048576;
export async function sha256(bytes) {return sha256Bytes(bytes);}
function active(signal){if(signal?.aborted)throw new DOMException('Transfer stopped.','AbortError');}
const base='/api/motion-studio';
async function reply(response) {
  let body;try{body=await response.json();}catch{throw new Error('The studio did not return a usable transfer response.');}
  if(!response.ok){const error=new Error(body.detail||body.error||'Transfer refused.');error.status=response.status;throw error;}return body;
}
async function json(path,body,signal){active(signal);return reply(await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal}));}
async function retry(work,signal){for(let n=0;;n++){try{return await work();}catch(error){if(signal?.aborted||error.name==='AbortError'||n>=2||error.status&&![502,503,504].includes(error.status))throw error;await new Promise(done=>setTimeout(done,200*(n+1)));active(signal);}}}
function verifyTransfer(value,kind){if(!value||value.kind!==kind||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>BUNDLE_BYTES||!Number.isSafeInteger(value.received)||value.received<0||value.received>value.bytes||!Number.isSafeInteger(value.chunkBytes)||value.chunkBytes!==CHUNK_BYTES||!/^[0-9a-f-]{36}$/.test(value.id)||!/^[0-9a-f]{64}$/.test(value.sha256))throw new Error('The studio returned an invalid transfer receipt.');return value;}
export class BundleClient {
  constructor(progress=()=>{}){this.progress=progress;this.importRecord=null;this.exportRecord=null;}
  async upload(file,title,{signal}={}) {
    if(!file||file.size<1||file.size>BUNDLE_BYTES)throw new Error('Choose a bundle up to 264 MiB.');
    if(!this.importRecord||this.importRecord.file!==file||this.importRecord.title!==title){
      if(this.importRecord?.transfer)await this.cancel('import');
      this.importRecord={file,title,requestKey:crypto.randomUUID()};
    }
    const record=this.importRecord;this.progress('Checking bundle',0,file.size);active(signal);
    if(!record.sha256)record.sha256=await sha256Blob(file,{signal,progress:(bytes,total)=>this.progress('Checking bundle',bytes,total)});active(signal);
    const begin=await retry(()=>json('/bundle-imports',{bytes:file.size,sha256:record.sha256,title,requestKey:record.requestKey},signal),signal);
    record.transfer=verifyTransfer(begin.transfer,'import');
    for(let offset=record.transfer.received;offset<file.size;){
      active(signal);const bytes=await file.slice(offset,offset+CHUNK_BYTES).arrayBuffer();
      const result=await retry(async()=>reply(await fetch(base+'/bundle-imports/'+record.transfer.id+'/chunks/'+offset,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal})),signal);
      const next=verifyTransfer(result.transfer,'import');if(next.id!==record.transfer.id||next.received!==offset+bytes.byteLength||next.sha256!==record.sha256)throw new Error('The studio did not acknowledge these bundle bytes.');
      record.transfer=next;offset=next.received;this.progress('Uploading bundle',offset,file.size);
    }
    active(signal);this.progress('Bundle uploaded',file.size,file.size,record.transfer);return record.transfer;
  }
  async finish({signal}={}) {
    const record=this.importRecord;if(!record?.transfer||record.transfer.received!==record.transfer.bytes)throw new Error('Upload a complete bundle first.');
    const result=await retry(()=>json('/bundle-imports/'+record.transfer.id+'/finish',{},signal),signal);active(signal);
    if(result.transfer?.state!=='complete'||!result.project?.id)throw new Error('The bundle did not produce a saved composition.');
    record.transfer=result.transfer;return result.project;
  }
  async prepare(project,revision,{signal}={}) {
    if(!this.exportRecord||!this.exportRecord.requestKey||this.exportRecord.project!==project||this.exportRecord.revision!==revision){if(this.exportRecord?.transfer)await this.cancel('export');this.exportRecord={project,revision,requestKey:crypto.randomUUID()};}
    const record=this.exportRecord;this.progress('Preparing bundle',0,1);
    const result=await retry(()=>json('/projects/'+project+'/bundle-exports',{revision,requestKey:record.requestKey},signal),signal);
    record.transfer=verifyTransfer(result.transfer,'export');if(record.transfer.project!==project||record.transfer.revision!==revision||record.transfer.state!=='ready')throw new Error('The bundle is not ready.');return record.transfer;
  }
  async useExport(id,{signal}={}) {
    const result=await json('/bundle-exports/'+encodeURIComponent(id),undefined,signal),transfer=verifyTransfer(result.transfer,'export');
    if(transfer.state!=='ready')throw new Error('This export is not ready.');this.exportRecord={project:transfer.project,revision:transfer.revision,transfer};return transfer;
  }
  async download({signal,writable}={}) {
    const transfer=this.exportRecord?.transfer;
    if(writable&&(!writable.write||!writable.close||!writable.abort))throw new Error('Choose a usable writable file.');
    const parts=[],digest=new Sha256();let committing=false;
    try{
    if(!transfer||transfer.state!=='ready')throw new Error('Prepare an export first.');
    for(let offset=0;offset<transfer.bytes;){
      active(signal);const {chunk}=await retry(()=>json('/bundle-exports/'+transfer.id+'/chunks/'+offset,undefined,signal),signal);
      if(!chunk||typeof chunk.dataBase64!=='string'||chunk.dataBase64.length>Math.ceil(CHUNK_BYTES/3)*4)throw new Error('Bundle download failed its integrity check.');
      let decoded;try{decoded=atob(chunk.dataBase64);}catch{throw new Error('Bundle download failed its integrity check.');}
      const view=new Uint8Array(decoded.length);for(let n=0;n<decoded.length;n++)view[n]=decoded.charCodeAt(n);const bytes=view.buffer,next=offset+bytes.byteLength;
      if(btoa(decoded)!==chunk.dataBase64||!bytes.byteLength||bytes.byteLength!==Math.min(CHUNK_BYTES,transfer.bytes-offset)||chunk.id!==transfer.id||chunk.offset!==offset||chunk.bytes!==transfer.bytes||chunk.sha256!==transfer.sha256||chunk.nextOffset!==(next===transfer.bytes?null:next)||await sha256(bytes)!==chunk.chunkSha256)throw new Error('Bundle download failed its integrity check.');
      active(signal);digest.update(bytes);if(writable)await writable.write(bytes);else parts.push(bytes);active(signal);offset=next;this.progress('Downloading bundle',offset,transfer.bytes,transfer);
    }
    if(digest.digest()!==transfer.sha256)throw new Error('The complete bundle failed its integrity check.');active(signal);
    if(writable){committing=true;await writable.close();return {saved:true,bytes:transfer.bytes,sha256:transfer.sha256};}
    return new Blob(parts,{type:'application/x-tar'});
    }catch(error){if(writable&&!committing)try{await writable.abort();}catch{throw new Error('Transfer failed; the browser could not confirm that its temporary file was discarded.');}throw error;}
  }
  async cancel(kind) {
    const record=kind==='import'?this.importRecord:this.exportRecord;
    // Resolve a possibly settled begin/prepare reply with the same original key before
    // claiming cancellation. A busy/withdrawn source refuses; retain the key for a later retry.
    if(record&&!record.transfer&&record.requestKey){
      if(kind==='import'&&record.sha256){const result=await retry(()=>json('/bundle-imports',{bytes:record.file.size,sha256:record.sha256,title:record.title,requestKey:record.requestKey}));record.transfer=verifyTransfer(result.transfer,'import');}
      else if(kind==='export'){const result=await retry(()=>json('/projects/'+record.project+'/bundle-exports',{revision:record.revision,requestKey:record.requestKey}));record.transfer=verifyTransfer(result.transfer,'export');}
    }
    if(record?.transfer){await retry(()=>json('/bundle-'+(kind==='import'?'imports':'exports')+'/'+record.transfer.id+'/cancel',{}));}
    if(kind==='import')this.importRecord=null;else this.exportRecord=null;
  }
}
