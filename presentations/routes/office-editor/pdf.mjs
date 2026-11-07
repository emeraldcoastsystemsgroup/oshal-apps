/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-05): real multipage PDF 1.7 renderer (styled text, highlights, lists, tables, shapes, workbook grids and embedded RGB XObject images) and UTF-8 plain-text exporter.
 */
import{createRequire}from'node:module';
import{deflateSync}from'node:zlib';
import{validate,plain,address}from'../../tools/office/model.mjs';
import{workbookCalculator,displayValue}from'../../tools/office/formulas.mjs';
const require=createRequire(import.meta.url);

const STANDARD_FONTS=[
 ['F1','Helvetica'],['F2','Helvetica-Bold'],['F3','Helvetica-Oblique'],['F4','Helvetica-BoldOblique'],
 ['F5','Times-Roman'],['F6','Times-Bold'],['F7','Times-Italic'],['F8','Times-BoldItalic'],
 ['F9','Courier'],['F10','Courier-Bold'],['F11','Courier-Oblique'],['F12','Courier-BoldOblique']
];

const WIN_ANSI_EXTRA=new Map([
 [0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],
 [0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],
 [0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],
 [0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]
]);

function fontKey(runStyle){
 const fam=(runStyle.fontFamily??'Arial').toLowerCase();
 const base=/times|georgia|garamond|cambria|serif/.test(fam)&&!/sans/.test(fam)?4:/courier|consolas|monaco|menlo|mono/.test(fam)?8:0;
 const offset=(runStyle.bold?1:0)+(runStyle.italic?2:0);
 return STANDARD_FONTS[base+offset][0];
}

function charWidthFactor(ch,bold){
 if(ch===' ')return 0.28;
 if(/[ilI1.,:;|!'`]/.test(ch))return bold?0.32:0.28;
 if(/[mwMW@%]/.test(ch))return bold?0.82:0.78;
 if(/[A-Z0-9]/.test(ch))return bold?0.66:0.62;
 return bold?0.56:0.52;
}

function measureText(str,runStyle){
 let sum=0;
 for(const ch of str)sum+=charWidthFactor(ch,runStyle.bold);
 return sum*(runStyle.fontSize??12);
}

function pdfString(str){
 let out='(';
 for(const ch of String(str)){
  const code=ch.codePointAt(0);
  const byte=WIN_ANSI_EXTRA.get(code)??(code>=0x20&&code<=0x7e?code:code>=0xa0&&code<=0xff?code:0x3f);
  if(byte===0x28||byte===0x29||byte===0x5c)out+='\\'+String.fromCharCode(byte);
  else if(byte<0x20||byte>0x7e)out+='\\'+byte.toString(8).padStart(3,'0');
  else out+=String.fromCharCode(byte);
 }
 return out+')';
}

function rgbFloats(hexColor){
 const clean=(hexColor&&hexColor!=='transparent'?hexColor:'#172033').replace('#','');
 const n=parseInt(clean,16);
 return[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255].map(v=>v.toFixed(4)).join(' ');
}

function wrapRuns(values,maxWidth){
 const lines=[[]];let lineW=0;
 const tokens=[];
 for(const run of values){
  const parts=run.text.split(/(\n|\s+)/);
  for(const part of parts)if(part)tokens.push({text:part,style:run.style});
 }
 for(const tok of tokens){
  if(tok.text==='\n'){lines.push([]);lineW=0;continue;}
  const w=measureText(tok.text,tok.style);
  if(lineW>0&&lineW+w>maxWidth&&!/^\s+$/.test(tok.text)){lines.push([]);lineW=0;}
  if(lineW===0&&/^\s+$/.test(tok.text)&&lines.length>1)continue;
  lines.at(-1).push({text:tok.text,style:tok.style,width:w});
  lineW+=w;
 }
 return lines.map(segs=>({segments:segs,width:segs.reduce((s,x)=>s+x.width,0),height:Math.max(12,...segs.map(s=>s.style.fontSize))}));
}

function drawWrappedRuns(ops,values,{x,yTop,width,pageHeight,lineMult=1.3,prefix=''}){
 const runValues=prefix?[{text:prefix,style:values[0]?.style??{fontFamily:'Arial',fontSize:12,bold:false,italic:false,underline:false,color:'#172033',highlight:'transparent',align:'left'}},...values]:values;
 const align=values[0]?.style?.align??'left',lines=wrapRuns(runValues,Math.max(24,width));
 let cursorY=yTop;
 for(const line of lines){
  const step=line.height*lineMult,baseline=pageHeight-(cursorY+line.height*0.82);
  let curX=x+(align==='center'?Math.max(0,(width-line.width)/2):align==='right'?Math.max(0,width-line.width):0);
  for(const seg of line.segments){
   if(seg.style.highlight&&seg.style.highlight!=='transparent'){
    ops.push(`q ${rgbFloats(seg.style.highlight)} rg ${curX.toFixed(2)} ${(baseline-line.height*0.22).toFixed(2)} ${seg.width.toFixed(2)} ${(line.height*1.08).toFixed(2)} re f Q`);
   }
   ops.push(`BT /${fontKey(seg.style)} ${seg.style.fontSize.toFixed(2)} Tf ${rgbFloats(seg.style.color)} rg ${curX.toFixed(2)} ${baseline.toFixed(2)} Td ${pdfString(seg.text)} Tj ET`);
   if(seg.style.underline&&seg.text.trim()){
    ops.push(`q 0.6 w ${rgbFloats(seg.style.color)} RG ${curX.toFixed(2)} ${(baseline-1.5).toFixed(2)} m ${(curX+seg.width).toFixed(2)} ${(baseline-1.5).toFixed(2)} l S Q`);
   }
   curX+=seg.width;
  }
  cursorY+=step;
 }
 return cursorY-yTop;
}

async function decodeImages(model){
 const sources=model.kind==='xlsx'?[]:model.pages.flatMap(p=>(model.kind==='pptx'?p.objects:p.blocks).filter(i=>i.type==='image').map(i=>i.src));
 const unique=[...new Set(sources)],sharp=unique.length?require('sharp'):null,map=new Map();
 for(let i=0;i<unique.length;i++){
  const bytes=Buffer.from(unique[i].split(',')[1],'base64');
  const{data,info}=await sharp(bytes,{limitInputPixels:16000000,animated:false}).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  map.set(unique[i],{name:'Im'+(i+1),width:info.width,height:info.height,compressed:deflateSync(data)});
 }
 return map;
}

function renderTableBlock(ops,rows,{x,yTop,width,pageHeight}){
 const colCount=rows[0].length,colW=width/colCount;
 let curY=yTop;
 for(const row of rows){
  const heights=row.map(cell=>{const l=wrapRuns(cell,Math.max(20,colW-8));return Math.max(20,l.reduce((s,line)=>s+line.height*1.25,0)+8);});
  const rowH=Math.max(...heights);
  for(let c=0;c<colCount;c++){
   const cellX=x+c*colW,boxBottom=pageHeight-(curY+rowH);
   ops.push(`q 0.6 w 0.5804 0.6392 0.7216 RG ${cellX.toFixed(2)} ${boxBottom.toFixed(2)} ${colW.toFixed(2)} ${rowH.toFixed(2)} re S Q`);
   drawWrappedRuns(ops,row[c],{x:cellX+4,yTop:curY+4,width:colW-8,pageHeight,lineMult:1.25});
  }
  curY+=rowH;
 }
 return curY-yTop;
}

function layoutWordPages(model,images){
 const w=model.pageWidth,h=model.pageHeight,m=model.margins,usableW=w-m.left-m.right,out=[];
 const frameOps=()=>{
  const ops=[`q 1 1 1 rg 0 0 ${w.toFixed(2)} ${h.toFixed(2)} re f Q`];
  if(model.header)ops.push(`BT /F1 10 Tf 0.3922 0.4549 0.5451 rg ${m.left.toFixed(2)} ${(h-24).toFixed(2)} Td ${pdfString(model.header)} Tj ET`);
  if(model.footer)ops.push(`BT /F1 10 Tf 0.3922 0.4549 0.5451 rg ${m.left.toFixed(2)} 18 Td ${pdfString(model.footer)} Tj ET`);
  return ops;
 };
 for(const page of model.pages){
  let ops=frameOps(),y=m.top,listNum=0;
  const ensureSpace=need=>{if(y>m.top&&y+need>h-m.bottom){out.push({width:w,height:h,ops});ops=frameOps();y=m.top;}};
  for(const blk of page.blocks){
   if(blk.type==='paragraph'){
    listNum=blk.list==='number'?listNum+1:0;
    const prefix=blk.list==='bullet'?'\u2022 ':blk.list==='number'?`${listNum}. `:'';
    const estLines=wrapRuns(blk.runs,Math.max(24,usableW-(prefix?14:0)));
    const estH=blk.spacingBefore+estLines.reduce((s,l)=>s+l.height*blk.lineHeight,0)+blk.spacingAfter;
    ensureSpace(Math.min(estH,h-m.top-m.bottom));
    y+=blk.spacingBefore;
    y+=drawWrappedRuns(ops,blk.runs,{x:m.left+(prefix?12:0),yTop:y,width:usableW-(prefix?12:0),pageHeight:h,lineMult:blk.lineHeight,prefix});
    y+=blk.spacingAfter;
   }else if(blk.type==='table'){
    listNum=0;ensureSpace(36);
    y+=renderTableBlock(ops,blk.rows,{x:m.left,yTop:y,width:usableW,pageHeight:h})+8;
   }else if(blk.type==='image'){
    listNum=0;const img=images.get(blk.src);if(!img)continue;
    const drawW=Math.min(blk.width,usableW),drawH=blk.height*(drawW/blk.width);
    ensureSpace(Math.min(drawH,h-m.top-m.bottom));
    ops.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${m.left.toFixed(2)} ${(h-(y+drawH)).toFixed(2)} cm /${img.name} Do Q`);
    y+=drawH+8;
   }
  }
  out.push({width:w,height:h,ops});
 }
 return out;
}

function drawEllipse(ops,cx,cy,rx,ry){
 const k=0.55228475,ox=rx*k,oy=ry*k;
 ops.push(`${(cx-rx).toFixed(2)} ${cy.toFixed(2)} m ${(cx-rx).toFixed(2)} ${(cy+oy).toFixed(2)} ${(cx-ox).toFixed(2)} ${(cy+ry).toFixed(2)} ${cx.toFixed(2)} ${(cy+ry).toFixed(2)} c`);
 ops.push(`${(cx+ox).toFixed(2)} ${(cy+ry).toFixed(2)} ${(cx+rx).toFixed(2)} ${(cy+oy).toFixed(2)} ${(cx+rx).toFixed(2)} ${cy.toFixed(2)} c`);
 ops.push(`${(cx+rx).toFixed(2)} ${(cy-oy).toFixed(2)} ${(cx+ox).toFixed(2)} ${(cy-ry).toFixed(2)} ${cx.toFixed(2)} ${(cy-ry).toFixed(2)} c`);
 ops.push(`${(cx-ox).toFixed(2)} ${(cy-ry).toFixed(2)} ${(cx-rx).toFixed(2)} ${(cy-oy).toFixed(2)} ${(cx-rx).toFixed(2)} ${cy.toFixed(2)} c h`);
}

function layoutSlidePages(model,images){
 const w=model.pageWidth,h=model.pageHeight;
 return model.pages.map(page=>{
  const ops=[`q ${rgbFloats(page.background??'#ffffff')} rg 0 0 ${w.toFixed(2)} ${h.toFixed(2)} re f Q`];
  for(const obj of page.objects){
   const bottom=h-(obj.y+obj.height);
   if(obj.fill&&obj.fill!=='transparent'||obj.strokeWidth>0){
    ops.push('q');
    if(obj.fill&&obj.fill!=='transparent')ops.push(`${rgbFloats(obj.fill)} rg`);
    if(obj.strokeWidth>0)ops.push(`${obj.strokeWidth.toFixed(2)} w ${rgbFloats(obj.stroke)} RG`);
    if(obj.type==='ellipse')drawEllipse(ops,obj.x+obj.width/2,bottom+obj.height/2,obj.width/2,obj.height/2);
    else ops.push(`${obj.x.toFixed(2)} ${bottom.toFixed(2)} ${obj.width.toFixed(2)} ${obj.height.toFixed(2)} re`);
    ops.push(obj.fill&&obj.fill!=='transparent'&&obj.strokeWidth>0?'B':obj.fill&&obj.fill!=='transparent'?'f':'S','Q');
   }
   if(obj.type==='text')drawWrappedRuns(ops,obj.runs,{x:obj.x+4,yTop:obj.y+4,width:obj.width-8,pageHeight:h,lineMult:1.2});
   else if(obj.type==='table')renderTableBlock(ops,obj.rows,{x:obj.x,yTop:obj.y,width:obj.width,pageHeight:h});
   else if(obj.type==='image'&&images.has(obj.src))ops.push(`q ${obj.width.toFixed(2)} 0 0 ${obj.height.toFixed(2)} ${obj.x.toFixed(2)} ${bottom.toFixed(2)} cm /${images.get(obj.src).name} Do Q`);
  }
  return{width:w,height:h,ops};
 });
}

function layoutWorkbookPages(model){
 const calc=workbookCalculator(model),w=841.89,h=595.28,out=[];
 for(const sheet of model.sheets){
  const keys=Object.keys(sheet.cells);
  let maxR=4,maxC=3;
  for(const key of keys){const m=/^([A-Z]+)(\d+)$/.exec(key);if(!m)continue;let c=0;for(const ch of m[1])c=c*26+ch.charCodeAt(0)-64;maxC=Math.max(maxC,Math.min(10,c));maxR=Math.max(maxR,Math.min(60,Number(m[2])));}
  const colW=(w-72)/maxC,rowH=20;
  let ops=[`q 1 1 1 rg 0 0 ${w} ${h} re f Q`,`BT /F2 14 Tf 0.0902 0.1255 0.2000 rg 36 ${(h-40).toFixed(2)} Td ${pdfString(sheet.name)} Tj ET`],y=54;
  for(let r=0;r<maxR;r++){
   if(y+rowH>h-36){out.push({width:w,height:h,ops});ops=[`q 1 1 1 rg 0 0 ${w} ${h} re f Q`];y=36;}
   for(let c=0;c<maxC;c++){
    const key=address(r,c),cell=sheet.cells[key],val=displayValue(calc.value(sheet.name,key),cell?.style?.numberFormat);
    const cx=36+c*colW,by=h-(y+rowH);
    if(cell?.style?.fill&&cell.style.fill!=='#ffffff')ops.push(`q ${rgbFloats(cell.style.fill)} rg ${cx.toFixed(2)} ${by.toFixed(2)} ${colW.toFixed(2)} ${rowH} re f Q`);
    ops.push(`q 0.5 w 0.8627 0.8863 0.9216 RG ${cx.toFixed(2)} ${by.toFixed(2)} ${colW.toFixed(2)} ${rowH} re S Q`);
    if(val!=='')ops.push(`BT /${fontKey(cell?.style??{})} 10 Tf ${rgbFloats(cell?.style?.color??'#172033')} rg ${(cx+4).toFixed(2)} ${(by+6).toFixed(2)} Td ${pdfString(String(val).slice(0,32))} Tj ET`);
   }
   y+=rowH;
  }
  out.push({width:w,height:h,ops});
 }
 return out;
}

function assemblePdf(pages,images,title){
 const objects=[];
 const addObj=body=>{objects.push(Buffer.isBuffer(body)?body:Buffer.from(body,'latin1'));return objects.length;};
 const catalogId=addObj(''),pagesRootId=addObj('');
 const fontIds=STANDARD_FONTS.map(([key,base])=>[key,addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)]);
 const imageIds=[...images.values()].map(img=>{
  const head=Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.compressed.length} >>\nstream\n`,'latin1');
  return[img.name,addObj(Buffer.concat([head,img.compressed,Buffer.from('\nendstream','latin1')]))];
 });
 const fontDict='<< '+fontIds.map(([k,id])=>`/${k} ${id} 0 R`).join(' ')+' >>';
 const xObjDict=imageIds.length?' /XObject << '+imageIds.map(([k,id])=>`/${k} ${id} 0 R`).join(' ')+' >>':'';
 const pageIds=pages.map(page=>{
  const stream=Buffer.from(page.ops.join('\n'),'latin1');
  const contentId=addObj(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,'latin1'),stream,Buffer.from('\nendstream','latin1')]));
  return addObj(`<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] /Resources << /Font ${fontDict}${xObjDict} >> /Contents ${contentId} 0 R >>`);
 });
 const infoId=addObj(`<< /Title ${pdfString(title)} /Producer (oshal AI Office) >>`);
 objects[catalogId-1]=Buffer.from(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`,'latin1');
 objects[pagesRootId-1]=Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`,'latin1');
 const chunks=[Buffer.from('%PDF-1.7\n%\xff\xff\xff\xff\n','latin1')],offsets=[0];
 let offset=chunks[0].length;
 for(let i=0;i<objects.length;i++){
  offsets.push(offset);
  const wrap=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`,'latin1'),objects[i],Buffer.from('\nendobj\n','latin1')]);
  chunks.push(wrap);offset+=wrap.length;
 }
 const xrefPos=offset;
 const xref=['xref',`0 ${objects.length+1}`,'0000000000 65535 f ',...offsets.slice(1).map(pos=>`${String(pos).padStart(10,'0')} 00000 n `)].join('\n')+'\n';
 const trailer=`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
 chunks.push(Buffer.from(xref+trailer,'latin1'));
 return Buffer.concat(chunks);
}

export async function renderPdf(input){
 const model=validate(input),images=await decodeImages(model);
 const pages=model.kind==='docx'?layoutWordPages(model,images):model.kind==='pptx'?layoutSlidePages(model,images):layoutWorkbookPages(model);
 return assemblePdf(pages,images,model.title);
}

export function renderPlainText(input){
 const model=validate(input);
 if(model.kind==='xlsx'){
  const calc=workbookCalculator(model);
  return Buffer.from(model.sheets.map(sheet=>{
   const rows=[];let maxR=0,maxC=0;
   for(const key of Object.keys(sheet.cells)){const m=/^([A-Z]+)(\d+)$/.exec(key);if(!m)continue;let c=0;for(const ch of m[1])c=c*26+ch.charCodeAt(0)-64;maxC=Math.max(maxC,c);maxR=Math.max(maxR,Number(m[2]));}
   for(let r=0;r<maxR;r++){const line=[];for(let c=0;c<maxC;c++)line.push(displayValue(calc.value(sheet.name,address(r,c)),sheet.cells[address(r,c)]?.style?.numberFormat));rows.push(line.join('\t').replace(/\t+$/,''));}
   return[sheet.name,...rows].join('\n').trimEnd();
  }).join('\n\n')+'\n','utf8');
 }
 const pageTexts=model.pages.map(page=>{
  const lines=[];
  if(model.kind==='docx'&&model.header)lines.push(model.header);
  let num=0;
  for(const item of (model.kind==='pptx'?page.objects:page.blocks)){
   if(item.runs){
    num=item.list==='number'?num+1:0;
    const prefix=item.list==='bullet'?'- ':item.list==='number'?`${num}. `:'';
    lines.push(prefix+plain(item.runs));
   }else if(item.type==='table'){
    num=0;
    for(const row of item.rows)lines.push(row.map(cell=>plain(cell)).join('\t'));
   }
  }
  if(model.kind==='docx'&&model.footer)lines.push(model.footer);
  return lines.join('\n');
 });
 return Buffer.from(pageTexts.join('\n\n')+'\n','utf8');
}
