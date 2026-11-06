/** Keep generation beside the current editable Office document; opening AI never submits a turn. */
export const formatName=kind=>({pptx:'PowerPoint',docx:'Word',xlsx:'Excel'}[kind]??'Office');
export function openGenerationAssistant({foundation,element,model}){
 const input=element.querySelector('textarea');
 if(!foundation||!input)throw new Error('The Concierge is still opening. Try again in a moment.');
 foundation.showPanel('ai');
 if(!input.value.trim()){
  const noun={pptx:'PowerPoint presentation',docx:'Word document',xlsx:'Excel workbook'}[model.kind]??'Office document';
  const title=String(model.title||'').trim();
  input.value=title&&!/^Untitled\b/i.test(title)?`Help me develop this ${noun}, “${title}”, in the open document. `:`Create the content in this open ${noun} about `;
 }
 input.focus();input.setSelectionRange?.(input.value.length,input.value.length);
}
export function previousFileRows(result){
 const rows=result.documents??result.items??result.files??result.decks??[];
 return(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof(row.fileName??row.file_name)==='string'&&/\.(pptx|docx|xlsx)$/i.test(row.fileName??row.file_name));
}
export function previousFileUrl(record,base){
 const value=record.downloadUrl??record.url;
 if(typeof value!=='string'||!value.trim())throw new Error('This saved file has no usable download URL.');
 const url=new URL(value,base);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('This saved file has no usable download URL.');
 return url;
}
