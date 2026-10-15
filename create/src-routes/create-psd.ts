/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve original PSD bytes, conversion findings and editable owned layers in one original-owner transaction.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, lstat, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { CreateProjectStore } from './create-project-store';
import { projectInput, type ProjectValidator } from './create-project-validation';
import { ProjectError, PROJECT_ASSET_PREFIX, type ProjectOwner, type ProjectAsset, type ProjectSnapshot, type ConfirmProjectAccess } from './create-project-types';

export const PSD_PROFILE = Object.freeze({ version: 1, fileBytes: 4194304, retainedSourceBytes: 4194304,
  pngBytes: 16777216, imageBytes: 8388608, dimension: 2048, canvasPixels: 4194304,
  decodedPixels: 8388608, pixelLayers: 32, records: 64, groupDepth: 4, concurrentRequests:2, parserWorkers:2, parserTimeoutMs:10000 });
interface Finding { code: string; layer: number | null; editable: boolean }
interface PixelLayer { index: number; width: number; height: number; section: number; rgba?: Uint8Array }
interface Parsed { width: number; height: number; editable: boolean; flattenable: boolean; report: Finding[]; merged: Uint8Array; layers: PixelLayer[] }
interface Parser { psdDocument: (parsed: Parsed, assets: Map<number,ProjectAsset>, title: string) => unknown }
export interface PsdSelection { title: string; mode: 'editable' | 'flattened'; expectedSha256: string; requestKey: string }
interface SourceRow { project_id: string; sha256: string; byte_length: number; report: Finding[]; import_mode: string; request_digest: string; request_key: string }
interface Image { asset: ProjectAsset; bytes: Buffer }
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function psdSourceMetadata(source:Pick<SourceRow,'project_id'|'sha256'|'byte_length'|'report'|'import_mode'>):object {
  return { profileVersion:1,projectId:source.project_id,importedRevision:1,sha256:source.sha256,bytes:Number(source.byte_length),mode:source.import_mode,report:source.report };
}
let workers = 0;

/** Bound parsing workers independently of input compression; no arbitrary source module is accepted. */
export async function parsePsd(bytes: Buffer, packageDir: string): Promise<Parsed> {
  if (!bytes.length || bytes.length > PSD_PROFILE.fileBytes) throw new ProjectError(413,'psd_file_limit');
  if (workers >= 2) throw new ProjectError(503,'psd_import_busy');
  workers++;
  try {
    const input = Uint8Array.from(bytes).buffer;
    return await new Promise<Parsed>((resolveResult, reject) => {
      let replied = false;
      const worker = new Worker(pathToFileURL(resolve(packageDir,'tools/editor/psd-worker.mjs')), { workerData: input, transferList: [input], resourceLimits: { maxOldGenerationSizeMb: 128 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new ProjectError(503,'psd_parser_timeout')); }, 10000);
      worker.once('message',(message: {parsed?:Parsed;error?:string}) => {
        replied = true;
        clearTimeout(timer); void worker.terminate();
        if (message.parsed) resolveResult(message.parsed);
        else reject(new ProjectError(message.error?.includes('limit') ? 413 : 400, message.error ?? 'invalid_psd'));
      });
      worker.once('error',() => { clearTimeout(timer); reject(new ProjectError(400,'invalid_psd')); });
      worker.once('exit',() => { clearTimeout(timer); if (!replied) reject(new ProjectError(503,'psd_parser_unavailable')); });
    });
  } finally { workers--; }
}
export function psdInspection(bytes: Buffer, parsed: Parsed): object {
  return { profile: PSD_PROFILE, sha256: digest(bytes), bytes: bytes.length, width: parsed.width, height: parsed.height,
    editable: parsed.editable, flattened: parsed.flattenable, pixelLayers: parsed.layers.filter(l => !l.section).length, report: parsed.report };
}
function parser(packageDir: string): Promise<Parser> {
  const file=resolve(packageDir,'tools/editor/psd-reader.mjs'), url=pathToFileURL(file);
  url.searchParams.set('revision',digest(readFileSync(file))); return import(url.href) as Promise<Parser>;
}
export function psdSelection(value: Record<string,unknown>): PsdSelection {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160
    || typeof value.mode !== 'string' || !['editable','flattened'].includes(value.mode)
    || typeof value.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || typeof value.requestKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.requestKey)) throw new ProjectError(400,'invalid_psd_selection');
  return { title: value.title.trim(), mode: value.mode as PsdSelection['mode'], expectedSha256: value.expectedSha256, requestKey: value.requestKey };
}
async function original(client: PoolClient, owner: ProjectOwner, key: string): Promise<SourceRow | undefined> {
  const result=await client.query<SourceRow>('SELECT project_id,sha256,byte_length,report,import_mode,request_digest,request_key FROM create_psd_sources WHERE owner_issuer=$1 AND owner_sub=$2 AND request_key=$3', [owner.issuer,owner.sub,key]); return result.rows[0];
}
async function revisionOne(client: PoolClient, owner: ProjectOwner, id: string): Promise<ProjectSnapshot> {
  const result=await client.query('SELECT p.project_id,r.title,r.document,p.created_at,r.created_at AS updated_at FROM create_projects p JOIN create_project_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=1',[owner.issuer,owner.sub,id]);
  const row=result.rows[0]; if (!row) throw new ProjectError(503,'psd_source_unavailable');
  return { id: row.project_id,title: row.title,revision:1,document:row.document,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString() };
}
async function prepareImages(parsed: Parsed, selection: PsdSelection): Promise<Map<number,Image>> {
  if (selection.mode === 'editable' && !parsed.editable) throw new ProjectError(422,'psd_editable_unsupported');
  if (selection.mode === 'flattened' && !parsed.flattenable) throw new ProjectError(422,'psd_flattened_unsupported');
  const source=selection.mode === 'editable' ? parsed.layers.filter(l => !l.section) : [{ index:-1,width:parsed.width,height:parsed.height,rgba:parsed.merged }];
  const images=new Map<number,Image>(); let total=0;
  for (const layer of source) {
    if (!layer.rgba) throw new ProjectError(400,'psd_pixel_layer_unsupported');
    const bytes=await sharp(Buffer.from(layer.rgba), { raw:{width:layer.width,height:layer.height,channels:4},limitInputPixels:PSD_PROFILE.canvasPixels }).png().toBuffer();
    total+=bytes.length; if (bytes.length>PSD_PROFILE.imageBytes || total>PSD_PROFILE.pngBytes) throw new ProjectError(413,'psd_png_limit');
    const id=randomUUID(); images.set(layer.index,{bytes,asset:{id,src:PROJECT_ASSET_PREFIX+id,width:layer.width,height:layer.height,bytes:bytes.length,sha256:digest(bytes)}});
  }
  return images;
}
/** One owned writer/client couples image parts, original parts, report and first editable revision. */
export async function importPsd(store: CreateProjectStore, owner: ProjectOwner, bytes: Buffer, parsed: Parsed,
  selection: PsdSelection, validator: ProjectValidator, packageDir: string, dataRoot: string, confirm: ConfirmProjectAccess): Promise<object> {
  const sha=digest(bytes); if (sha!==selection.expectedSha256) throw new ProjectError(409,'psd_source_changed');
  const requestDigest=digest(JSON.stringify(['create-psd/1',sha,selection.mode,selection.title]));
  const files:{path:string;dev:number;ino:number}[]=[]; let completed=false;
  try {
    const result=await store.transaction(owner,true,async client => {
      await store.ownerLock(client,owner);
      const previous=await original(client,owner,selection.requestKey);
      if (previous) { if (previous.request_digest!==requestDigest) throw new ProjectError(409,'psd_request_conflict'); return {project:await revisionOne(client,owner,previous.project_id),source:psdSourceMetadata(previous),replayed:true}; }
      const total=await client.query<{bytes:string|number}>('SELECT COALESCE(SUM(byte_length),0)::bigint AS bytes FROM create_psd_sources WHERE owner_issuer=$1 AND owner_sub=$2',[owner.issuer,owner.sub]);
      if (Number(total.rows[0].bytes)+bytes.length>PSD_PROFILE.retainedSourceBytes) throw new ProjectError(413,'psd_original_storage_limit');
      const images=await prepareImages(parsed,selection), assets=new Map([...images].map(([index,value])=>[index,value.asset]));
      let document: unknown;
      if (selection.mode==='editable') {
        try { document=(await parser(packageDir)).psdDocument(parsed,assets,selection.title); } catch { throw new ProjectError(400,'psd_group_frame_unsupported'); }
      } else {
        const image=assets.get(-1)!; document={version:1,name:selection.title,width:parsed.width,height:parsed.height,background:'transparent',
          layers:[{id:'psd-merged',type:'image',name:'Flattened PSD preview',assetId:image.id,x:0,y:0,w:parsed.width,h:parsed.height,rotation:0,opacity:1,visible:true,locked:false}],
          images:{[image.id]:{src:image.src,width:image.width,height:image.height}}};
      }
      const input=projectInput({title:selection.title,document},validator);
      for (const image of images.values()) {
        await confirm();
        if (!store.nativeImageStorage) {
          const directory=join(dataRoot,digest(JSON.stringify([owner.issuer,owner.sub]))); await mkdir(directory,{recursive:true,mode:0o700});
          const stat=await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectError(503,'project_asset_storage_unavailable');
          const path=join(directory,image.asset.id+'.png'); await writeFile(path,image.bytes,{flag:'wx',mode:0o600});
          const file=await lstat(path); files.push({path,dev:file.dev,ino:file.ino});
        }
        await store.addAssetInTransaction(client,owner,image.asset,image.bytes);
      }
      const project=await store.createInTransaction(client,owner,input);
      await client.query('INSERT INTO create_psd_sources (project_id,owner_issuer,owner_sub,request_key,request_digest,sha256,byte_length,import_mode,report) VALUES ($3,$1,$2,$4,$5,$6,$7,$8,$9::jsonb)',
        [owner.issuer,owner.sub,project.id,selection.requestKey,requestDigest,sha,bytes.length,selection.mode,JSON.stringify(parsed.report)]);
      for (let offset=0,index=0;offset<bytes.length;offset+=65536,index++) {
        const part=bytes.subarray(offset,offset+65536);
        await client.query('INSERT INTO create_psd_source_parts (project_id,owner_issuer,owner_sub,part_index,byte_length,sha256,content_base64) VALUES ($3,$1,$2,$4,$5,$6,$7)',[owner.issuer,owner.sub,project.id,index,part.length,digest(part),part.toString('base64')]);
      }
      return {project,source:psdSourceMetadata({project_id:project.id,sha256:sha,byte_length:bytes.length,report:parsed.report,import_mode:selection.mode}),replayed:false};
    },confirm);
    completed=true; return result;
  } finally {
    if (!completed && files.length) {
      // A lost COMMIT acknowledgement must never remove already published files.
      // If the original is durably present (or reconciliation itself refuses),
      // retain immutable bytes; the same sealed request key recovers publication.
      let absent=false;
      try { absent=await store.transaction(owner,false,async client=>!(await original(client,owner,selection.requestKey))); } catch { /* uncertain commit retains bytes */ }
      if (absent) for (const file of files) { const current=await lstat(file.path); if (current.isFile() && !current.isSymbolicLink() && current.dev===file.dev && current.ino===file.ino) await unlink(file.path); }
    }
  }
}

/** Read only an actual original owned project/source join, then verify every byte before releasing it. */
export async function readPsdSource(store: CreateProjectStore, owner: ProjectOwner, id: string, content: boolean, confirm: ConfirmProjectAccess): Promise<{source:SourceRow;bytes?:Buffer}> {
  return store.transaction(owner,false,async client=>{
    const metadata=await client.query<SourceRow>('SELECT s.project_id,s.sha256,s.byte_length,s.report,s.import_mode,s.request_digest,s.request_key FROM create_psd_sources s JOIN create_projects p ON p.project_id=s.project_id AND p.owner_issuer=s.owner_issuer AND p.owner_sub=s.owner_sub WHERE s.owner_issuer=$1 AND s.owner_sub=$2 AND s.project_id=$3',[owner.issuer,owner.sub,id]);
    const source=metadata.rows[0]; if (!source) throw new ProjectError(404,'psd_source_not_found');
    if (!Number.isSafeInteger(Number(source.byte_length)) || Number(source.byte_length)<1 || Number(source.byte_length)>PSD_PROFILE.fileBytes || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new ProjectError(503,'psd_source_unavailable');
    if (!content) return {source};
    const parts=await client.query('SELECT part_index,byte_length,sha256,content_base64 FROM create_psd_source_parts WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 ORDER BY part_index',[owner.issuer,owner.sub,id]), chunks:Buffer[]=[];let size=0;
    if (parts.rows.length!==Math.ceil(Number(source.byte_length)/65536)) throw new ProjectError(503,'psd_source_unavailable');
    for (const [index,part] of parts.rows.entries()) {
      await confirm(); if (part.part_index!==index || typeof part.content_base64!=='string' || part.content_base64.length>87384) throw new ProjectError(503,'psd_source_unavailable');
      const bytes=Buffer.from(part.content_base64,'base64');size+=bytes.length;
      if (bytes.length!==Math.min(65536,Number(source.byte_length)-index*65536) || bytes.length!==Number(part.byte_length) || bytes.toString('base64')!==part.content_base64 || digest(bytes)!==part.sha256 || size>PSD_PROFILE.fileBytes) throw new ProjectError(503,'psd_source_unavailable');chunks.push(bytes);
    }
    const bytes=Buffer.concat(chunks,size); if (size!==Number(source.byte_length) || digest(bytes)!==source.sha256) throw new ProjectError(503,'psd_source_unavailable');return {source,bytes};
  },confirm);
}
