/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Return a fresh transient contract edit key without changing saved source or retry semantics. */
import {randomUUID} from 'node:crypto';
/** Typed original-photo/crop source. Generated portrait rows and image bytes remain separate evidence. */
import{createRequire}from'node:module';
import{exact,uuid,integer,text,fail}from'./vendor/source-project-store.mjs';
const catalog=createRequire(import.meta.url)('./portrait-catalog.js');
const keys=['background','attire','headwear','prop','finish','framing'];
function finite(v,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(400,'source_invalid_geometry');return v;}
function crop(value,photo,aspect){exact(value,['id','x','y','w','h']);const next={id:uuid(value.id),x:finite(value.x,0,photo.width),y:finite(value.y,0,photo.height),w:finite(value.w,1,photo.width),h:finite(value.h,1,photo.height)};if(next.x+next.w>photo.width+1e-7||next.y+next.h>photo.height+1e-7||Math.abs(next.w/next.h-aspect)>1e-6)fail(400,'source_invalid_crop');return next;}
function photo(value,aspect){exact(value,['id','assetId','sha256','width','height','crops']);if(typeof value.sha256!=='string'||!/^([a-f0-9]{64})$/.test(value.sha256)||!Array.isArray(value.crops)||value.crops.length>6)fail(400,'source_invalid_photo');const next={id:uuid(value.id),assetId:uuid(value.assetId),sha256:value.sha256,width:integer(value.width,1,16384),height:integer(value.height,1,16384)};if(next.width*next.height>16777216)fail(413,'source_photo_pixel_limit');next.crops=value.crops.map(v=>crop(v,next,aspect));return next;}
export function validate(value){exact(value,['version','kind','title','mode','style','aspect','notes','settings','photos']);if(value.version!==1||value.kind!=='portrait'||!catalog.isPortraitMode(value.mode)||value.style!==null&&!catalog.findStyle(value.mode,value.style)||![0.8,1,0.75].includes(value.aspect)||!Array.isArray(value.photos)||value.photos.length>6)fail(400,'source_invalid_model');exact(value.settings,[],keys);for(const key of Object.keys(value.settings))text(value.settings[key],80,{empty:true});if(catalog.validateOverrides(value.settings))fail(400,'source_invalid_settings');const photos=value.photos.map(v=>photo(v,value.aspect));const ids=[...photos.map(v=>v.id),...photos.flatMap(v=>v.crops.map(c=>c.id))];if(new Set(ids).size!==ids.length||photos.reduce((n,p)=>n+p.crops.length,0)>6||value.mode!=='group'&&(photos.length>1||photos.some(p=>p.crops.length>1)))fail(400,'source_invalid_photo_selection');return{version:1,kind:'portrait',title:text(value.title,120),mode:value.mode,style:value.style,aspect:value.aspect,notes:text(value.notes,300,{empty:true}),settings:{...value.settings},photos};}
export const references=model=>model.photos.map(v=>v.assetId);
export function verifyReferences(model,assets){for(const photo of model.photos){const asset=assets.get(photo.assetId);if(!asset||asset.sha256!==photo.sha256||asset.metadata.width!==photo.width||asset.metadata.height!==photo.height)fail(409,'source_photo_changed');}}
export function apply(model,operations){if(!Array.isArray(operations)||!operations.length||operations.length>16)fail(400,'source_invalid_operations');const next=structuredClone(model);for(const op of operations){switch(op.op){
 case 'set-brief':exact(op,['op','values']);exact(op.values,[],['title','mode','style','aspect','notes','settings']);Object.assign(next,op.values);break;
 case 'replace-photos':exact(op,['op','photos']);next.photos=op.photos;break;
 case 'add-photo':exact(op,['op','photo']);next.photos.push(op.photo);break;
 case 'remove-photo':exact(op,['op','id']);{const at=next.photos.findIndex(v=>v.id===uuid(op.id));if(at<0)fail(404,'source_photo_missing');next.photos.splice(at,1);}break;
 case 'add-crop':exact(op,['op','photo','crop']);{const photo=next.photos.find(v=>v.id===uuid(op.photo));if(!photo)fail(404,'source_photo_missing');photo.crops.push(op.crop);}break;
 case 'set-crop':exact(op,['op','id','values']);exact(op.values,[],['x','y','w','h']);{const target=next.photos.flatMap(v=>v.crops).find(v=>v.id===uuid(op.id));if(!target)fail(404,'source_crop_missing');Object.assign(target,op.values);}break;
 case 'remove-crop':exact(op,['op','id']);{const photo=next.photos.find(v=>v.crops.some(c=>c.id===uuid(op.id)));if(!photo)fail(404,'source_crop_missing');photo.crops=photo.crops.filter(c=>c.id!==op.id);}break;
 default:fail(400,'source_unsupported_operation');
 }}return validate(next);}
export const CATALOG_SECTIONS=Object.freeze(['styles',...keys]);
/** Model reads return one actual closed catalog section, without UI icons or preset payloads. */
export function sourceContract(section){
 if(section===undefined)return{...CONTRACT,requestKey:randomUUID(),requestKeyRule:"Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body."};
 if(typeof section!=='string'||!CATALOG_SECTIONS.includes(section))fail(400,'source_invalid_catalog_section');
 const current=catalog.clientCatalog();
 const values=section==='styles'?Object.fromEntries(Object.entries(current.presets).map(([mode,presets])=>[mode,presets.map(value=>value.id)])):
  ['',...current[{background:'backgrounds',attire:'attire',headwear:'headwear',prop:'props',finish:'finishes',framing:'framings'}[section]].map(value=>value.id)];
 return{kind:'portrait',version:1,section,values,requestKey:randomUUID(),requestKeyRule:"Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body."};
}
export const CONTRACT={kind:'portrait',version:1,
 wire:{discriminator:'op',closed:true,rule:'Each operations item is an object with op exactly as shown and only the listed fields. values is an object of changed fields, never an array. Do not invent operation names or use type as the discriminator.',request:{id:'actual source-read project UUID',baseRevision:'actual source-read revision',requestKey:'copy the top-level requestKey unchanged for this exact intent',operations:'1..16 operation objects'}},
 operations:{
  'set-brief':{op:'set-brief',values:{title:'text <=120 characters',mode:['professional','character','group'],style:'null or an actual style ID matching mode',aspect:[0.8,1,0.75],notes:'text <=300 characters',settings:'object of selected background, attire, headwear, prop, finish and framing IDs; replaces settings'}},
  'replace-photos':{op:'replace-photos',photos:'complete ordered array of photo objects matching shapes.photo'},
  'add-photo':{op:'add-photo',photo:'one photo object matching shapes.photo'},
  'remove-photo':{op:'remove-photo',id:'existing photo UUID'},
  'add-crop':{op:'add-crop',photo:'existing photo UUID',crop:'one crop object matching shapes.crop'},
  'set-crop':{op:'set-crop',id:'existing crop UUID',values:{x:'optional source-pixel number',y:'optional source-pixel number',w:'optional positive source-pixel number',h:'optional positive source-pixel number'}},
  'remove-crop':{op:'remove-crop',id:'existing crop UUID'}},
 shapes:{photo:{id:'new UUID v4',assetId:'actual owned uploaded asset UUID',sha256:'actual asset SHA256',width:'verified source width',height:'verified source height',crops:'array of shapes.crop'},crop:{id:'new UUID v4',x:'source pixels',y:'source pixels',w:'source pixels',h:'source pixels'}},
 examples:[{purpose:'Move an existing crop and update notes in one held edit. Replace the illustrative crop ID with the actual source-read crop ID.',operations:[{op:'set-crop',id:'33333333-3333-4333-8333-333333333333',values:{x:17}},{op:'set-brief',values:{notes:'Preserve the original photo'}}]}],
 limits:{photos:6,totalCrops:6,operations:16,assetBytes:4194304,photoPixels:16777216,notes:300},
 rules:['Crop geometry must remain in the source bounds and preserve the project aspect. Change width and height together.','Solo modes allow one photo/one crop. Group allows six total crops. Changing mode or aspect must leave every crop valid.','Source edits never generate an image, spend credits or change generated portraits.','Read current source and use its returned revision as baseRevision. Immutable originals are referenced only by protected owned asset ID/digest.'],
 catalog:{tool:'portrait-studio-source-contract',input:{section:CATALOG_SECTIONS},rule:'Omit section for this operation contract. Request a section to read its exact allowed IDs. Empty settings ID inherits the preset; styles are grouped by mode.'}};
