/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shared bounded PDF content operations use immutable source object identities.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Support blank-page content objects and stroked vector check/cross marks.
 */
export const PDF_FONTS=Object.freeze(['Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique']);
const refuse=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function closed(value,keys,fail){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(400,'pdf_invalid_content_operation');}
function validRect(rect,box){return Array.isArray(rect)&&rect.length===4&&rect.every((n,i)=>Number.isFinite(n)&&n>=box[i%2]&&n<=box[i%2+2])&&rect[2]>rect[0]&&rect[3]>rect[1];}
export const printablePdfText=(text,encoding='latin1')=>typeof text==='string'&&text.length>0&&text.length<=4000&&(encoding==='latin1'?/^[\x20-\x7e\u00a0-\u00ff]+$/:/^[\x20-\x7e]+$/).test(text);
export function textCapabilities(item){const explicit=item.fontExplicit||item.original===false,encoding=explicit?'latin1':item.textEncoding;return{encoding,text:explicit?printablePdfText(item.text):item.textEditable===true,size:explicit?printablePdfText(item.text):item.fontSizeEditable===true,font:printablePdfText(item.text),reason:item.textEditReason??'Choose a supported standard font explicitly before editing this source text.'};}
export function validateContentProperties(properties,kind,box,fail=refuse,target){
 closed(properties,['rect','text','font','fontSize','fill','stroke','strokeWidth','opacity'],fail);
 if(!Object.keys(properties).length)fail(400,'pdf_empty_content_change');
 if(properties.rect!==undefined&&!validRect(properties.rect,box))fail(400,'pdf_content_geometry');
 for(const key of ['fill','stroke'])if(properties[key]!==undefined&&(typeof properties[key]!=='string'||!/^[0-9a-f]{6}$/.test(properties[key])))fail(400,'pdf_content_color');
 for(const[key,min,max]of [['fontSize',1,256],['strokeWidth',0,40],['opacity',0,1]])if(properties[key]!==undefined&&(!Number.isFinite(properties[key])||properties[key]<min||properties[key]>max))fail(400,'pdf_content_number');
 if(properties.font!==undefined&&!PDF_FONTS.includes(properties.font))fail(400,'pdf_content_font_unsupported');
 if(properties.text!==undefined&&(kind!=='text'||typeof properties.text!=='string'||!properties.text.length||properties.text.length>4000||! /^[\x20-\x7e\u00a0-\u00ff]+$/.test(properties.text)))fail(400,'pdf_content_text_unsupported');
 if(kind!=='text'&&['font','fontSize','text'].some(key=>properties[key]!==undefined))fail(400,'pdf_content_property_unsupported');
 if(!['text','path','rectangle','ellipse'].includes(kind)&&properties.fill!==undefined)fail(400,'pdf_content_property_unsupported');
 if(!['text','path','rectangle','ellipse','check','cross'].includes(kind)&&['stroke','strokeWidth'].some(key=>properties[key]!==undefined))fail(400,'pdf_content_property_unsupported');
 if(kind==='text'&&target){const capabilities=textCapabilities(target);if(properties.font!==undefined){if(!printablePdfText(properties.text??target.text))fail(400,'pdf_content_text_unsupported');}else if(properties.text!==undefined&&(!capabilities.text||!printablePdfText(properties.text,capabilities.encoding))||properties.fontSize!==undefined&&!capabilities.size)fail(400,'pdf_content_font_reencoding_unsupported');}
 return properties;
}
/** Source ordinals remain stable across save, reorder and repeated non-form page instances. */
export function contentObjects(sourcePage,model,page,renderedPage){
 const deleted=(model.contentEdits??[]).filter(e=>e.page===page&&e.deleted).map(e=>Number(e.object.slice(1)));
 const originals=(sourcePage?.objects??[]).map(item=>{
  const edit=model.contentEdits?.find(e=>e.page===page&&e.object===item.id);
  const ordinal=Number(item.id.slice(1)),current=renderedPage?.objects?.find(o=>o.id==='o'+(ordinal-deleted.filter(n=>n<ordinal).length));
  const policy=Object.fromEntries(['textEditable','fontSizeEditable','fontReplaceable','textEncoding','textEditReason'].map(key=>[key,item[key]]));
  return edit?.deleted?null:{...item,...current,...edit?.properties,...policy,editable:item.editable!==false&&current?.editable!==false,id:item.id,page,original:true,fontExplicit:PDF_FONTS.includes(edit?.properties?.font)};
 }).filter(Boolean);
 return [...originals,...(model.objects??[]).filter(item=>item.page===page).map((item,index)=>{
  const current=renderedPage?.objects?.find(o=>o.id==='o'+((sourcePage?.objectCount??sourcePage?.objects?.length??0)-deleted.length+index));
  return {...item,...current,id:item.id,kind:item.kind,page,original:false,editable:true};
 })];
}
export function applyContent(model,operation,sources,fail=refuse,assets=[]){
 closed(operation,operation.op==='add-object'?['op','page','item']:operation.op==='delete-object'?['op','page','object']:['op','page','object','properties'],fail);
 const page=model.pages.find(p=>p.id===operation.page);
 if(!page)fail(400,'pdf_invalid_page_selection');
 const sourcePage=page.blank?{cropBox:page.cropBox,rotation:0,contentEditable:true,objects:[],objectCount:0}:sources.find(s=>s.id===page.source)?.pages[page.index],box=sourcePage?.cropBox;
 if(!Array.isArray(box)||box.length!==4)fail(503,'pdf_page_geometry_unavailable');
 if(sourcePage.contentEditable===false)fail(400,'pdf_content_page_unsupported');
 model.contentEdits??=[];model.objects??=[];
 if(operation.op==='add-object'){
  const object=operation.item;
  closed(object,['id','kind','rect','text','font','fontSize','fill','stroke','strokeWidth','opacity','asset'],fail);
  if(!uuid(object.id)||![...model.objects,...model.annotations].every(item=>item.id!==object.id)||!['text','rectangle','ellipse','image','check','cross'].includes(object.kind))fail(400,'pdf_invalid_content_object');
  const {id,kind,asset,...properties}=object;validateContentProperties(properties,kind,box,fail);
  if(!validRect(object.rect,box)||kind==='text'&&!object.text)fail(400,'pdf_invalid_content_object');
  if(kind==='image'){
   if(!uuid(asset)||!assets.some(a=>a.id===asset))fail(404,'pdf_image_asset_unavailable');
  }else if(asset!==undefined)fail(400,'pdf_invalid_content_object');
  model.objects.push({...structuredClone(object),page:page.id});
 }else{
  if(typeof operation.object!=='string')fail(400,'pdf_invalid_content_object');
  const object=contentObjects(sourcePage,model,page.id).find(o=>o.id===operation.object);
  if(!object)fail(404,'pdf_content_object_unavailable');
  if(!object.editable)fail(400,'pdf_content_object_unsupported');
  if(operation.op==='delete-object'){
   if(object.original){const existing=model.contentEdits.find(e=>e.page===page.id&&e.object===object.id);if(existing){delete existing.properties;existing.deleted=true;}else model.contentEdits.push({page:page.id,object:object.id,deleted:true});}
   else model.objects=model.objects.filter(o=>o.id!==object.id);
  }else if(operation.op==='update-object'){
   validateContentProperties(operation.properties,object.kind,box,fail,object);
   if(object.original){let existing=model.contentEdits.find(e=>e.page===page.id&&e.object===object.id);if(!existing){existing={page:page.id,object:object.id,properties:{}};model.contentEdits.push(existing);}Object.assign(existing.properties,structuredClone(operation.properties));}
   else Object.assign(model.objects.find(o=>o.id===object.id),structuredClone(operation.properties));
  }else fail(400,'pdf_operation_unsupported');
 }
 if(model.contentEdits.length>2048||model.objects.length>128)fail(413,'pdf_content_limit');
}

const messages=new Map([
 ['pdf_content_geometry','Keep the object inside the page with a positive width and height.'],
 ['pdf_content_number','Use a value within the supported range for this property.'],
 ['pdf_content_text_unsupported','Use1–4000 printable Latin-1 characters for this PDF text object.'],
 ['pdf_content_font_reencoding_unsupported','Choose a supported standard font explicitly; the original font cannot safely encode this text or size edit.'],
 ['pdf_content_font_unsupported','Choose one of the supported standard PDF fonts.'],
 ['pdf_content_property_unsupported','This property cannot be changed on the selected PDF object.'],
 ['pdf_content_page_unsupported','This page uses Type3 glyph programs. Its native content stays read only; page organization and annotations remain available.'],
 ['pdf_content_object_unsupported','This PDF object cannot be edited in the current profile.'],
 ['pdf_content_object_unavailable','The selected object changed. Select it again.'],
 ['pdf_permission_denied','Your current role does not allow this PDF action.'],
 ['pdf_image_asset_unavailable','The original image is unavailable. Choose an owned image from the library.'],
 ['pdf_image_asset_in_use','Saved history uses this image. Delete that document history before removing the image.'],
 ['pdf_revision_conflict','A newer PDF revision is saved. Your draft is retained; reopen the document before retrying.'],
 ['pdf_engine_busy','The PDF engine is busy. Your draft is retained; try again shortly.'],
 ['pdf_operation_limit','Save this operation batch before adding more changes.']
]);
export const pdfErrorMessage=value=>messages.get(value)??value;
