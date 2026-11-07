/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Closed page-instance operations preserve original source identities and history.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Declare independent owner metadata and sealed retry retention bounds.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Expose actual saved crop bounds and reject invalid native annotation geometry before queueing.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Issue fresh contract request keys and support blank pages, QuadPoints text markup, ink strokeWidth and check/cross marks.
 */
import {randomUUID,createHash} from 'node:crypto';
import {applyContent} from '../tools/content-model.mjs';
export const LIMITS=Object.freeze({bytes:4194304,pages:32,operations:64,annotations:128,fields:256,ownerBytes:33554432,ownerMetadataBytes:8388608,requestCount:256,requestBytes:2097152,requestResultBytes:262144,requestHours:24,title:160});
export class PdfError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
export const fail=(status,code)=>{throw new PdfError(status,code);};
export function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(400,'pdf_invalid_input');}
export function id(value){if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))fail(400,'pdf_invalid_id');return value;}
export function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'pdf_invalid_number');return value;}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function title(value){if(typeof value!=='string'||!value.trim()||value.length>LIMITS.title)fail(400,'pdf_invalid_title');return value;}
export function bytes(value){if(!Buffer.isBuffer(value)||value.length<5||value.length>LIMITS.bytes||value.subarray(0,5).toString()!=='%PDF-')fail(value?.length>LIMITS.bytes?413:400,'pdf_input_limit_or_format');return value;}
export function initial(source,indices){const chosen=indices??source.pages.map(p=>p.index);if(!Array.isArray(chosen)||!chosen.length||chosen.length>LIMITS.pages)fail(400,'pdf_page_limit');return{pages:chosen.map(index=>({id:randomUUID(),source:id(source.id),index:integer(index,0,source.pages.length-1),rotation:0})),annotations:[],fields:{}};}
/** Actual PDF crop coordinates stay unrotated; never substitute a paper-size default. */
const validCropBox=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[0]<box[2]&&box[1]<box[3];
const pageCropBox=(page,sources)=>page?.blank?page.cropBox:sources.find(source=>source.id===page?.source)?.pages[page?.index]?.cropBox;
function neighborCropBox(model,position,sources){
 const neighbor=model.pages[Math.max(0,Math.min(position-1,model.pages.length-1))];
 if(!neighbor)return[0,0,612,792];
 const box=pageCropBox(neighbor,sources);
 if(!validCropBox(box))fail(503,'pdf_page_geometry_unavailable');
 const srcRot=neighbor.blank?0:(sources.find(s=>s.id===neighbor.source)?.pages[neighbor.index]?.rotation??0);
 const swapped=((srcRot+(neighbor.rotation??0))%180)!==0,w=box[2]-box[0],h=box[3]-box[1];
 return[0,0,swapped?h:w,swapped?w:h];
}
function validateAnnotation(annotation,page,sources){
 const box=pageCropBox(page,sources);
 if(!validCropBox(box))fail(503,'pdf_page_geometry_unavailable');
 const rect=annotation.rect;
 if(!Array.isArray(rect)||rect.length!==4||rect.some((value,i)=>!Number.isFinite(value)||value<box[i%2]||value>box[i%2+2])||rect[0]>=rect[2]||rect[1]>=rect[3])fail(400,'pdf_annotation_geometry');
 if(!['text','highlight','underline','strikethrough','ink'].includes(annotation.kind)||annotation.color!==undefined&&(typeof annotation.color!=='string'||! /^[0-9a-f]{6}$/.test(annotation.color)))fail(400,'pdf_invalid_annotation');
 if(annotation.quadPoints!==undefined){
  if(!['highlight','underline','strikethrough'].includes(annotation.kind))fail(400,'pdf_invalid_annotation');
  if(!Array.isArray(annotation.quadPoints)||annotation.quadPoints.length<1||annotation.quadPoints.length>64||annotation.quadPoints.some(q=>!Array.isArray(q)||q.length!==8||q.some((v,i)=>!Number.isFinite(v)||(i%2===0?v<rect[0]-0.01||v>rect[2]+0.01:v<rect[1]-0.01||v>rect[3]+0.01))))fail(400,'pdf_annotation_geometry');
 }
 if(annotation.strokeWidth!==undefined&&(annotation.kind!=='ink'||!Number.isFinite(annotation.strokeWidth)||annotation.strokeWidth<0.5||annotation.strokeWidth>24))fail(400,'pdf_invalid_annotation');
 if(annotation.kind==='text'&&(typeof annotation.text!=='string'||!annotation.text.length||annotation.text.length>2000||!/^[\x20-\x7e\n]+$/.test(annotation.text)))fail(400,'pdf_annotation_text_unsupported');
 if(annotation.kind==='ink'&&(!Array.isArray(annotation.points)||annotation.points.length<2||annotation.points.length>256||annotation.points.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some((value,i)=>!Number.isFinite(value)||value<rect[i]||value>rect[i+2]))))fail(400,'pdf_annotation_geometry');
}
/** Saved inspection and stable native page order refer to the same physical pages. */
export function readablePages(document){
 return document.model.pages.map((page,index)=>{
  const box=document.inspection.pages[index]?.cropBox;
  if(!validCropBox(box))fail(503,'pdf_page_geometry_unavailable');
  const width=box[2]-box[0],height=box[3]-box[1],size=Math.min(60,height*.2),step=size+height*.03;
  let textAnnotationRect=null;
  for(let row=0;row<8;row++){
   const top=box[3]-height*.05-row*step;if(top-size<box[1]+height*.05)break;
   const rect=[box[0]+width*.05,top-size,box[0]+width*.75,top];
   const occupied=document.model.annotations.some(a=>a.page===page.id&&Array.isArray(a.rect)&&a.rect[0]<rect[2]&&a.rect[2]>rect[0]&&a.rect[1]<rect[3]&&a.rect[3]>rect[1]);
   if(!occupied){textAnnotationRect=rect;break;}
  }
  return{...page,cropBox:[...box],textAnnotationRect};
 });
}
const selected=(model,value)=>{if(!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(v=>!model.pages.some(p=>p.id===id(v))))fail(400,'pdf_invalid_page_selection');return new Set(value);};
function applySingleOp(model,operation,sources,assets){
 if(operation?.op==='reorder'){exact(operation,['op','pageIds']);const chosen=selected(model,operation.pageIds);if(chosen.size!==model.pages.length)fail(400,'pdf_reorder_requires_all_pages');model.pages=operation.pageIds.map(v=>model.pages.find(p=>p.id===v));}
 else if(operation?.op==='rotate'){exact(operation,['op','page','degrees']);const page=model.pages.find(p=>p.id===id(operation.page));if(!page||![90,180,270].includes(operation.degrees))fail(400,'pdf_invalid_rotation');page.rotation=(page.rotation+operation.degrees)%360;}
 else if(['remove','extract'].includes(operation?.op)){exact(operation,['op','pageIds']);const chosen=selected(model,operation.pageIds);model.pages=model.pages.filter(p=>chosen.has(p.id)===(operation.op==='extract'));if(!model.pages.length)fail(400,'pdf_empty_document');model.annotations=model.annotations.filter(a=>model.pages.some(p=>p.id===a.page));}
 else if(operation?.op==='merge'){exact(operation,['op','source','indices','position']);const source=sources.find(s=>s.id===id(operation.source));if(!source)fail(404,'pdf_source_unavailable');const incoming=initial(source,operation.indices);model.pages.splice(integer(operation.position,0,model.pages.length),0,...incoming.pages);}
 else if(operation?.op==='insert-blank'){exact(operation,['op','position','id']);const pos=integer(operation.position,0,model.pages.length),pageId=operation.id===undefined?randomUUID():id(operation.id);if(model.pages.some(p=>p.id===pageId))fail(400,'pdf_invalid_page_selection');model.pages.splice(pos,0,{id:pageId,blank:true,cropBox:neighborCropBox(model,pos,sources),rotation:0});}
 else if(operation?.op==='annotate'){exact(operation,['op','annotation']);const annotation=operation.annotation;exact(annotation,['id','page','kind','rect','text','points','color','quadPoints','strokeWidth']);id(annotation.id);id(annotation.page);const page=model.pages.find(p=>p.id===annotation.page);if(!page||model.annotations.some(a=>a.id===annotation.id))fail(400,'pdf_invalid_annotation');validateAnnotation(annotation,page,sources);model.annotations.push(structuredClone(annotation));}
 else if(operation?.op==='update-annotation'){exact(operation,['op','id','properties']);const annotation=model.annotations.find(a=>a.id===id(operation.id));if(!annotation)fail(404,'pdf_annotation_unavailable');exact(operation.properties,['rect','text','points','color','quadPoints','strokeWidth']);const next={...annotation,...operation.properties};validateAnnotation(next,model.pages.find(p=>p.id===annotation.page),sources);Object.assign(annotation,structuredClone(operation.properties));}
 else if(['update-object','delete-object','add-object'].includes(operation?.op))applyContent(model,operation,sources,fail,assets);
 else if(operation?.op==='remove-annotation'){exact(operation,['op','id']);const annotation=id(operation.id);if(!model.annotations.some(a=>a.id===annotation))fail(404,'pdf_annotation_unavailable');model.annotations=model.annotations.filter(a=>a.id!==annotation);}
 else if(operation?.op==='fill'){exact(operation,['op','name','value']);if(typeof operation.name!=='string'||operation.name.length>512||typeof operation.value!=='string'||operation.value.length>4096)fail(400,'pdf_invalid_field');const field=sources.flatMap(s=>(s.fields??[]).map(f=>({...f,source:s.id,name:s.id+'.'+f.name}))).find(f=>f.name===operation.name);if(!field?.supported||!field.pages.some(index=>model.pages.some(p=>p.source===field.source&&p.index===index)))fail(400,'pdf_field_unsupported');model.fields[operation.name]=operation.value;}
 else fail(400,'pdf_operation_unsupported');
}
/** The trusted store resolves every merge source with original owner grants before this function. */
export function apply(before,operations,sources,assets=[]){
 if(!Array.isArray(operations)||!operations.length||operations.length>LIMITS.operations)fail(400,'pdf_operation_limit');
 const model=structuredClone(before);
 for(const operation of operations){
  applySingleOp(model,operation,sources,assets);
  if(model.pages.length>LIMITS.pages||model.annotations.length>LIMITS.annotations||Object.keys(model.fields).length>LIMITS.fields)fail(413,'pdf_model_limit');
 }
 // Values from removed widget pages must not survive as hidden orphan fields.
 const available=new Set();for(const source of sources)for(const field of source.fields??[])if(field.pages.some(index=>model.pages.some(p=>p.source===source.id&&p.index===index)))available.add(source.id+'.'+field.name);
 model.fields=Object.fromEntries(Object.entries(model.fields).filter(([name])=>available.has(name)));
 if(model.contentEdits)model.contentEdits=model.contentEdits.filter(item=>model.pages.some(page=>page.id===item.page));
 if(model.objects)model.objects=model.objects.filter(item=>model.pages.some(page=>page.id===item.page));
 if(Buffer.byteLength(JSON.stringify(model))>524288)fail(413,'pdf_model_limit');
 return model;
}
export function editingContract(){return{...CONTRACT,requestKey:randomUUID(),requestKeyRule:'Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body.'};}
export const CONTRACT=Object.freeze({version:1,limits:LIMITS,operations:['reorder','rotate','remove','extract','merge','insert-blank','annotate','update-annotation','remove-annotation','update-object','delete-object','add-object','fill'],operationSchemas:{
 reorder:{required:['op','pageIds'],op:'reorder',pageIds:'exact permutation of all current page instance UUIDs'},
 rotate:{required:['op','page','degrees'],op:'rotate',page:'current page instance UUID',degrees:[90,180,270]},
 remove:{required:['op','pageIds'],op:'remove',pageIds:'unique nonempty current page instance UUIDs; keep at least one page'},
 extract:{required:['op','pageIds'],op:'extract',pageIds:'unique nonempty current page instance UUIDs to keep in this new revision'},
 merge:{required:['op','source','position'],op:'merge',source:'actual owned original source UUID',position:'integer insertion index 0..current page count',indices:'optional nonempty original page ordinals 0..source page count-1'},
 'insert-blank':{required:['op','position'],op:'insert-blank',position:'integer insertion index 0..current page count; matches adjacent page dimensions',id:'optional fresh UUID'},
 annotate:{required:['op','annotation'],op:'annotate',annotation:{required:['id','page','kind','rect'],id:'fresh UUID',page:'actual current page instance UUID',kind:['text','highlight','underline','strikethrough','ink'],rect:'four finite coordinates [x0,y0,x1,y1] wholly inside actual page.cropBox from pdf-read-document; use its textAnnotationRect for text when placement is unspecified',text:'text only, ASCII/newline up to2000',points:'ink only, 2..256 contained [x,y] pairs',quadPoints:'optional 1..64 eight-float QuadPoints inside rect for highlight/underline/strikethrough',strokeWidth:'optional 0.5..24 stroke width for ink',color:'optional six lower-case hexadecimal RGB digits'}},
 'update-object':{required:['op','page','object','properties'],op:'update-object',page:'current page instance UUID',object:'stable source object ID or inserted object UUID from objects model part',properties:'closed fields rect/text/font/fontSize/fill/stroke/strokeWidth/opacity; actual object kind constrains fields'},
 'delete-object':{required:['op','page','object'],op:'delete-object',page:'current page instance UUID',object:'actual stable object ID; ordinary editing, not certified redaction'},
 'add-object':{required:['op','page','item'],op:'add-object',page:'current page instance UUID',item:'fresh UUID id, kind text/rectangle/ellipse/image/check/cross, rect and explicit text/font/fontSize/fill/stroke/strokeWidth/opacity/asset as applicable'},
 'update-annotation':{required:['op','id','properties'],op:'update-annotation',id:'actual annotation UUID',properties:'rect/text/points/color/quadPoints/strokeWidth; preserve the annotation kind and page'},
 'remove-annotation':{required:['op','id'],op:'remove-annotation',id:'actual annotation UUID in current model'},
 fill:{required:['op','name','value'],op:'fill',name:'actual supported full source-UUID-prefixed field name from form-fields',value:'ASCII string respecting field maxLength, or an exact returned checkbox/radio/choice option'}
 },textReplacementExample:{op:'update-object',page:'actual-page-instance-uuid',object:'actual-selected-object-id',properties:{text:'New native text'}},approval:{tool:'pdf-apply-operations',mode:'ask',envelope:['id','baseRevision','requestKey','operations'],rule:'Only this tool returned native proposal creates a real controller approval card. Markdown or prose is not a card or an executed edit. Preserve omitted properties and wait for actual release;202 is queued until job ready.'},coordinates:'PDF crop-box user units; bottom-left origin, prior to page rotation. Read actual pages[].cropBox; never assume a standard paper size. pages[].textAnnotationRect is an optional valid text placement avoiding existing native annotations; null means no suggested placement.',annotations:['text','highlight','underline','strikethrough','ink'],forms:['supported AcroForm text (ASCII Helvetica appearance)','checkbox','radio','single choice'],ocr:{explicit:true,languages:['eng'],selectedPages:10,originalUnchanged:true},formLookup:{tool:'pdf-read-model-part',part:'form-fields',queryParameter:'query',match:'literal case-insensitive field-name fragment',pageItems:8,responseBytes:8192,completeValues:true,pageIds:'pdf-read-document receipt',preserveUntouched:'additive native operations preserve untouched objects without enumeration'},unsupported:['encrypted PDFs','signed PDFs','XFA','active actions/attachments','nested form-XObject text edits (whole groups may transform)', 'text reflow', 'new text outside printable Latin-1','redaction','digital signing','PDF/A','repeated form-bearing page copies','unsupported fonts/field appearances']});
