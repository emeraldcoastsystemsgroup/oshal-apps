/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Normalize real raster pixels and resolve only original-actor asset bytes for the compositor.
 */
import { createRequire } from 'node:module';
import { MotionError, LIMITS } from './project-store.mjs';
const require=createRequire(import.meta.url);
export async function decodeRaster(bytes) {
  let sharp;try{sharp=require('sharp');}catch{throw new MotionError(503,'motion_raster_decoder_unavailable');}
  try{
    const metadata=await sharp(bytes,{limitInputPixels:LIMITS.pixels,failOn:'error'}).metadata();
    if(!['png','jpeg','webp'].includes(metadata.format))throw new Error('unsupported');
    const {data,info}=await sharp(bytes,{limitInputPixels:LIMITS.pixels,failOn:'error'}).rotate().toColourspace('srgb').png().toBuffer({resolveWithObject:true});
    return{bytes:data,type:'image/png',width:info.width,height:info.height};
  }catch{throw new MotionError(400,'motion_raster_refused');}
}
export async function ownedAssets(document,store,extras=[]) {
  const ids=new Set(extras);
  for(const item of Object.values(document.items??{})){
    if(item?.kind?.type!=='Footage')continue;
    const match=typeof item.kind.path==='string'&&/^oshal-asset:([^@]+)@[0-9a-f]{64}$/.exec(item.kind.path);
    if(!match)throw new MotionError(400,'motion_owned_source_required');ids.add(match[1]);
  }
  if(ids.size>LIMITS.references)throw new MotionError(413,'motion_asset_reference_limit');
  let total=0;const result=[];
  for(const id of ids){const asset=await store.asset(id);total+=asset.bytes.length;if(total>6291456)throw new MotionError(413,'motion_asset_transport_limit');result.push({id,sha256:asset.sha256,data:asset.bytes.toString('base64')});}
  return result;
}
