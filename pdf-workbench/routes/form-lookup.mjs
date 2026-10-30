/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Find saved form values by literal field name within a bounded response, without enumerating every field or truncating values.
 */
import {fail,integer,LIMITS} from './model.mjs';
export const LOOKUP_BYTES=8192;
const PAGE_SIZE=8;
/**
 * @description Page matching saved form fields, preserving exact values and their original model-part index.
 * @param {object} document Authorized immutable saved document from PdfStore.get.
 * @param {{query:string,offset?:string}} options Literal name fragment and matching-result offset.
 * @returns {object} Byte-bounded matching fields with explicit pagination; never a truncated value.
 */
export function findFormFields(document,{query,offset='0'}){
 if(typeof query!=='string'||!query.trim()||query.length>128||query.includes('\0'))fail(400,'pdf_invalid_field_query');
 const start=integer(Number(offset),0,LIMITS.fields),needle=query.trim().toLowerCase();
 const matches=document.inspection.fields.map((field,index)=>({field,index})).filter(({field})=>field.name.toLowerCase().includes(needle));
 if(start>matches.length)fail(400,'pdf_invalid_field_offset');
 const response={document:document.id,revision:document.revision,query,offset:start,total:matches.length,fields:[],nextOffset:null};
 for(const{field,index}of matches.slice(start,start+PAGE_SIZE)){
  const item={index,name:field.name,type:field.type,value:field.value??null,supported:field.supported===true};
  const candidate={...response,fields:[...response.fields,item],nextOffset:start+response.fields.length+1<matches.length?start+response.fields.length+1:null};
  if(Buffer.byteLength(JSON.stringify(candidate))>LOOKUP_BYTES){if(!response.fields.length)fail(413,'pdf_field_lookup_item_limit');break;}
  response.fields.push(item);
 }
 response.nextOffset=start+response.fields.length<matches.length?start+response.fields.length:null;
 return response;
}
