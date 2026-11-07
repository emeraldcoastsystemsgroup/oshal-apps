/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real structured PPTX, DOCX and XLSX artifacts through the native runtime's pinned Office libraries.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..03, RP-OFF-05): export run highlight shading, OOXML Word comments and tracked changes, multipage PDF 1.7 and UTF-8 plain text.
 */
import{createRequire}from'node:module';
import{createHash}from'node:crypto';
import{validate,fail,stableJSON}from'../../tools/office/model.mjs';
import{workbookCalculator}from'../../tools/office/formulas.mjs';
import{injectDocxCollab}from'./docx-collab.mjs';
import{renderPdf,renderPlainText}from'./pdf.mjs';
const require=createRequire(import.meta.url),hex=value=>value.slice(1),inch=value=>value/72;
export const MIME={
 pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 json:'application/vnd.oshal.office+json',
 pdf:'application/pdf',
 txt:'text/plain; charset=utf-8'
};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const modelHash=model=>sha(Buffer.from(stableJSON(model)));
export function dependencies(){try{return{Pptx:require('pptxgenjs'),word:require('docx'),Excel:require('exceljs'),Zip:require('jszip')};}catch{fail('office_runtime_unavailable','The pinned Office runtime is unavailable on this installation.',503);}}
function textOptions(value){return{fontFace:value.fontFamily,fontSize:value.fontSize,bold:value.bold,italic:value.italic,underline:value.underline,color:hex(value.color),...(value.highlight&&value.highlight!=='transparent'?{highlight:hex(value.highlight)}:{}),align:value.align};}
function pptShadow(value){if(!value)return undefined;return{type:'outer',color:hex(value.color),opacity:value.opacity,blur:value.blur,angle:(Math.atan2(value.y,value.x)*180/Math.PI+360)%360,offset:Math.hypot(value.x,value.y)};}
async function pptx(model,{Pptx}){const deck=new Pptx();deck.defineLayout({name:'OSHAL',width:inch(model.pageWidth),height:inch(model.pageHeight)});deck.layout='OSHAL';deck.title=model.title;deck.author='OSHAL';deck.subject='Editable presentation';deck.lang='en-US';for(const page of model.pages){const slide=deck.addSlide();slide.background={color:hex(page.background??'#ffffff')};for(const object of page.objects){const options={x:inch(object.x),y:inch(object.y),w:inch(object.width),h:inch(object.height),rotate:object.rotation,objectName:object.id,fill:{color:object.fill==='transparent'?'FFFFFF':hex(object.fill),transparency:object.fill==='transparent'?100:100*(1-object.opacity)},line:{color:hex(object.stroke),width:object.strokeWidth,transparency:object.strokeWidth?100*(1-object.opacity):100},shadow:pptShadow(object.shadow)};if(object.type==='text')slide.addText(object.runs.map(run=>({text:run.text,options:textOptions(run.style)})),{...options,...textOptions(object.runs[0].style),margin:0,valign:'top',wrap:true,transparency:100*(1-object.opacity)});else if(object.type==='image')slide.addImage({...options,data:object.src,transparency:100*(1-object.opacity)});else if(object.type==='table')slide.addTable(object.rows.map(row=>row.map(cell=>({text:cell.map(run=>({text:run.text,options:textOptions(run.style)})),options:{fill:options.fill,color:hex(cell[0].style.color),fontFace:cell[0].style.fontFamily,fontSize:cell[0].style.fontSize}}))),{...options,margin:3,autoPage:false,colW:inch(object.width)/object.rows[0].length,rowH:inch(object.height)/object.rows.length,border:{type:'solid',color:hex(object.stroke),pt:object.strokeWidth}});else slide.addShape(object.type==='ellipse'?deck.ShapeType.ellipse:deck.ShapeType.rect,options);}}return Buffer.from(await deck.write({outputType:'nodebuffer'}));}
function wordRun(run,word){
 const hasHighlight=run.style.highlight&&run.style.highlight!=='transparent';
 return new word.TextRun({
  text:run.text,font:run.style.fontFamily,size:Math.round(run.style.fontSize*2),
  bold:run.style.bold,italics:run.style.italic,underline:run.style.underline?{}:undefined,
  color:hex(run.style.color),
  ...(hasHighlight?{shading:{type:word.ShadingType.CLEAR,color:'auto',fill:hex(run.style.highlight).toUpperCase()}}:{})
 });
}
function wordParagraph(value,word){return new word.Paragraph({children:value.runs.map(run=>wordRun(run,word)),alignment:value.runs[0].style.align,spacing:{before:Math.round(value.spacingBefore*20),after:Math.round(value.spacingAfter*20),line:Math.round(value.lineHeight*240)},bullet:value.list==='bullet'?{level:0}:undefined,numbering:value.list==='number'?{reference:'office-numbering',level:0}:undefined});}
function wordBlock(value,word){if(value.type==='paragraph')return wordParagraph(value,word);if(value.type==='table')return new word.Table({width:{size:100,type:word.WidthType.PERCENTAGE},rows:value.rows.map(row=>new word.TableRow({children:row.map(cell=>new word.TableCell({children:[new word.Paragraph({children:cell.map(run=>wordRun(run,word))})]}))}))});const [,type,data]=/^data:image\/(png|jpeg);base64,(.+)$/.exec(value.src);return new word.Paragraph({children:[new word.ImageRun({type:type==='jpeg'?'jpg':'png',data:Buffer.from(data,'base64'),transformation:{width:value.width*96/72,height:value.height*96/72}})]});}
async function docx(model,{word}){const sectionProperties={page:{size:{width:Math.round(model.pageWidth*20),height:Math.round(model.pageHeight*20)},margin:Object.fromEntries(Object.entries(model.margins).map(([key,value])=>[key,Math.round(value*20)]))}};const sections=model.pages.map(page=>({properties:sectionProperties,headers:model.header?{default:new word.Header({children:[new word.Paragraph(model.header)]})}:undefined,footers:model.footer?{default:new word.Footer({children:[new word.Paragraph(model.footer)]})}:undefined,children:page.blocks.length?page.blocks.map(value=>wordBlock(value,word)):[new word.Paragraph('')]}));const document=new word.Document({title:model.title,creator:'OSHAL',description:'Editable document',numbering:{config:[{reference:'office-numbering',levels:[{level:0,format:word.LevelFormat.DECIMAL,text:'%1.',alignment:word.AlignmentType.LEFT}]}]},sections});return word.Packer.toBuffer(document);}
export const NUMBER_FORMATS={general:'General',number:'0.00',currency:'"$"#,##0.00',percent:'0.00%',date:'yyyy-mm-dd'};
async function xlsx(model,{Excel}){const workbook=new Excel.Workbook();workbook.creator='OSHAL';workbook.title=model.title;workbook.calcProperties.fullCalcOnLoad=true;const calculator=workbookCalculator(model);for(const source of model.sheets){const sheet=workbook.addWorksheet(source.name,{views:[{state:source.frozenRows||source.frozenColumns?'frozen':'normal',xSplit:source.frozenColumns,ySplit:source.frozenRows}]});for(const[index,width]of Object.entries(source.columnWidths))sheet.getColumn(Number(index)+1).width=(width-5)/7;for(const[index,height]of Object.entries(source.rowHeights))sheet.getRow(Number(index)+1).height=height*72/96;for(const[key,value]of Object.entries(source.cells)){const cell=sheet.getCell(key),s=value.style;if(typeof value.value==='string'&&value.value.startsWith('=')){const result=calculator.result(source.name,key);cell.value={formula:value.value.slice(1),result:result.error?{error:result.error==='#CYCLE!'?'#REF!':result.error}:result.value};}else cell.value=value.value;cell.font={name:s.fontFamily,size:s.fontSize,bold:s.bold,italic:s.italic,underline:s.underline,color:{argb:'FF'+hex(s.color)}};cell.alignment={horizontal:s.align,vertical:'middle',wrapText:true};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+hex(s.fill)}};cell.numFmt=NUMBER_FORMATS[s.numberFormat];if(s.border)cell.border=Object.fromEntries(['top','right','bottom','left'].map(side=>[side,{style:'thin',color:{argb:'FF94A3B8'}}]));}}return Buffer.from(await workbook.xlsx.writeBuffer());}
async function packageDigest(zip){const parts=[];for(const name of Object.keys(zip.files).filter(name=>!zip.files[name].dir&&name!=='oshal/office.json').sort()){const data=await zip.file(name).async('nodebuffer');parts.push([name,sha(data)]);}return sha(Buffer.from(JSON.stringify(parts)));}
async function embed(bytes,model,{Zip}){const zip=await Zip.loadAsync(bytes);if(model.kind==='docx')await injectDocxCollab(zip,model);const types=await zip.file('[Content_Types].xml').async('string');zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/oshal/office.json" ContentType="application/vnd.oshal.office+json"/></Types>'));const relationships=await zip.file('_rels/.rels').async('string');zip.file('_rels/.rels',relationships.replace('</Relationships>','<Relationship Id="oshalOfficeSource" Type="https://oshal.ai/relationships/office-source" Target="oshal/office.json"/></Relationships>'));const digest=await packageDigest(zip);zip.file('oshal/office.json',JSON.stringify({version:1,visiblePackageSha256:digest,model}));return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});}
export async function renderOffice(input,format=input.kind,runtime=dependencies()){
 const model=validate(input);
 if(format==='json')return Buffer.from(JSON.stringify(model,null,2));
 if(format==='txt')return renderPlainText(model);
 if(format==='pdf'){const pdf=await renderPdf(model);if(pdf.length>10485760)fail('office_export_limit','This PDF artifact exceeds 10 MiB.');return pdf;}
 if(format!==model.kind)fail('office_format_mismatch','Export the document in its own Office format, PDF, plain text or JSON.');
 const bytes=await({pptx,docx,xlsx}[format])(model,runtime);
 const output=await embed(bytes,model,runtime);
 if(output.length>10485760)fail('office_export_limit','This Office artifact exceeds 10 MiB.');
 return output;
}
export async function embeddedModel(zip){const source=zip.file('oshal/office.json');if(!source)return null;const text=await source.async('string');if(Buffer.byteLength(text)>5000000)fail('office_import_limit','The embedded editable source exceeds the import limit.');let record;try{record=JSON.parse(text);}catch{fail('office_import_invalid','The embedded source is unreadable.');}if(record.version!==1||record.visiblePackageSha256!==await packageDigest(zip))return null;return validate(record.model);}
