/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render bounded seven-bit Unicode Word RTF with native lists, paragraph hierarchy, tables and inline PNG/JPEG pictures.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Render optional paragraph bottom border (`borderBottom`) and right tab stop (`tabRight`) in RTF output.
 */
import{createRequire}from'node:module';
import{fail}from'../../tools/office/model.mjs';
const require=createRequire(import.meta.url),twips=value=>Math.round(value*20),MAX_BYTES=10485760;

function escaped(value,font=false){
 let out='';
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i),ch=value[i];
  if(!font&&(ch==='\r'||ch==='\n')){if(ch==='\r'&&value[i+1]==='\n')i++;out+='\\line ';}
  else if(!font&&ch==='\t')out+='\\tab ';
  else if(ch==='\\'||ch==='{'||ch==='}')out+='\\'+ch;
  else if(code>=32&&code<127&&!(font&&ch===';'))out+=ch;
  else out+='\\u'+(code>32767?code-65536:code)+'?';
 }
 return out;
}

function writer(){
 const chunks=[];let length=0;
 return{add(value){length+=value.length;if(length>MAX_BYTES)fail('office_export_limit','This RTF artifact exceeds 10 MiB.');chunks.push(value);},finish:()=>Buffer.from(chunks.join(''),'ascii')};
}

function styleTables(model){
 const fonts=new Map([['Arial',0]]),colors=new Map();
 const add=run=>{
  if(!fonts.has(run.style.fontFamily))fonts.set(run.style.fontFamily,fonts.size);
  for(const value of[run.style.color,run.style.highlight])if(value&&value!=='transparent'&&!colors.has(value.toLowerCase()))colors.set(value.toLowerCase(),colors.size+1);
 };
 for(const page of model.pages)for(const block of page.blocks){
  if(block.type==='paragraph'){
   block.runs.forEach(add);
   if(block.borderBottom&&!colors.has(block.borderBottom.toLowerCase()))colors.set(block.borderBottom.toLowerCase(),colors.size+1);
  }
  if(block.type==='table')for(const row of block.rows)for(const cell of row)cell.forEach(add);
 }
 return{fonts,colors,number:0};
}

function writeTables(out,context){
 out.add('{\\fonttbl');
 for(const[name,index]of context.fonts)out.add('{\\f'+index+'\\fnil\\fcharset0 '+escaped(name,true)+';}');
 out.add('}{\\colortbl;');
 for(const color of context.colors.keys()){
  const n=Number.parseInt(color.slice(1),16);out.add('\\red'+(n>>16)+'\\green'+((n>>8)&255)+'\\blue'+(n&255)+';');
 }
 out.add('}');
 out.add('{\\*\\listtable');
 for(const[id,kind]of[[1,'bullet'],[2,'number']]){
  out.add('{\\list\\listtemplateid'+id+'\\listsimple1{\\listlevel\\levelnfc'+(kind==='bullet'?23:0)+'\\leveljc0\\levelfollow0\\levelstartat1');
  out.add(kind==='bullet'?"{\\leveltext\\'01\\u8226?;}{\\levelnumbers;}":"{\\leveltext\\'02\\'00.;}{\\levelnumbers\\'01;}");
  out.add('\\f0\\fi-252\\li720\\jclisttab\\tx720}\\listid'+id+'}');
 }
 out.add('}{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}{\\listoverride\\listid2\\listoverridecount0\\ls2}}');
}

function richRuns(runs,context){
 return runs.map(run=>{
  const s=run.style,highlight=s.highlight&&s.highlight!=='transparent'?context.colors.get(s.highlight.toLowerCase()):0;
  const controls='\\plain\\f'+context.fonts.get(s.fontFamily)+'\\fs'+Math.round(s.fontSize*2)+'\\b'+Number(s.bold)+'\\i'+Number(s.italic)+'\\ul'+Number(s.underline)+'\\cf'+context.colors.get(s.color.toLowerCase())+'\\highlight'+highlight;
  return'{'+controls+' '+escaped(run.text)+'}';
 }).join('');
}

function paragraph(value,context){
 const align={left:'\\ql',center:'\\qc',right:'\\qr',justify:'\\qj'}[value.runs[0].style.align];
 let controls='\\pard\\plain'+align+'\\sb'+twips(value.spacingBefore)+'\\sa'+twips(value.spacingAfter)+'\\sl'+Math.round(value.lineHeight*240)+'\\slmult1';
 if(value.indentLeft!==undefined)controls+='\\li'+twips(value.indentLeft);
 if(value.keepWithNext)controls+='\\keepn';
 if(value.borderBottom)controls+='\\brdrb\\brdrs\\brdrw15\\brsp40\\brdrcf'+context.colors.get(value.borderBottom.toLowerCase());
 if(value.tabRight!==undefined)controls+='\\tqr\\tx'+twips(value.tabRight);
 if(value.style==='heading1'||value.style==='heading2')controls+='\\outlinelevel'+(value.style==='heading1'?0:1);
 let marker='';
 if(value.list!=='none'){
  const left=twips(value.indentLeft??36),bullet=value.list==='bullet',text=bullet?'•':++context.number+'.';
  controls+='\\ls'+(bullet?1:2)+'\\ilvl0\\li'+left+'\\fi-252\\tx'+left;
  marker='{\\listtext\\pard\\plain\\f0 '+escaped(text)+'\\tab}';
 }
 return controls+' '+marker+richRuns(value.runs,context)+'\\par\n';
}

function table(value,model,context){
 const width=twips(model.pageWidth-model.margins.left-model.margins.right),columns=value.rows[0].length;
 return value.rows.map(row=>{
  const cells=row.map((_cell,index)=>'\\cellx'+Math.round(width*(index+1)/columns)).join('');
  const content=row.map(cell=>'\\pard\\plain\\intbl '+richRuns(cell,context)+'\\cell ').join('');
  return'\\trowd\\trgaph108\\trleft0'+cells+'\n'+content+'\\row\n';
 }).join('')+'\\pard\n';
}

async function picture(value,cache){
 const[type,data]=value.src.slice(11).split(';base64,'),bytes=Buffer.from(data,'base64');
 let metadata=cache.get(value.src);
 if(!metadata){
  if(cache.size>=32||bytes.length>2097152)fail('office_image_limit','Use at most 32 embedded images of at most 2 MiB each.');
  metadata=await require('sharp')(bytes,{limitInputPixels:16000000,animated:false}).metadata();
  if(!['png','jpeg'].includes(metadata.format)||metadata.format!==type||metadata.width>4096||metadata.height>4096)fail('office_invalid_image','Use a PNG/JPEG image up to 4096 pixels per side.');
  const pixels=metadata.width*metadata.height+[...cache.values()].reduce((sum,item)=>sum+item.width*item.height,0);
  if(pixels>33554432)fail('office_image_limit','Embedded images exceed 32 million decoded pixels.');
  cache.set(value.src,metadata);
 }
 return'\\pard {\\pict\\'+(type==='png'?'pngblip':'jpegblip')+'\\picw'+metadata.width+'\\pich'+metadata.height+'\\picwgoal'+twips(value.width)+'\\pichgoal'+twips(value.height)+'\n'+bytes.toString('hex')+'}\\par\n';
}

/** The caller supplies the already validated Word model; only visible content is exported, with no external resources. */
export async function renderRtf(model){
 if(model.kind!=='docx')fail('office_format_mismatch','RTF export is available for Word documents only.');
 const out=writer(),context=styleTables(model),images=new Map();
 out.add('{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1');writeTables(out,context);
 out.add('{\\info{\\title '+escaped(model.title)+'}}');
 out.add('\\paperw'+twips(model.pageWidth)+'\\paperh'+twips(model.pageHeight));
 for(const[key,control]of[['top','margt'],['right','margr'],['bottom','margb'],['left','margl']])out.add('\\'+control+twips(model.margins[key]));
 if(model.header)out.add('{\\header\\pard\\plain '+escaped(model.header)+'\\par}');
 if(model.footer)out.add('{\\footer\\pard\\plain '+escaped(model.footer)+'\\par}');
 out.add('\n');
 for(const[index,page]of model.pages.entries()){
  if(index)out.add('\\page\n');
  if(!page.blocks.length)out.add('\\pard\\par\n');
  for(const block of page.blocks){
   if(block.type==='paragraph')out.add(paragraph(block,context));
   else if(block.type==='table')out.add(table(block,model,context));
   else out.add(await picture(block,images));
  }
 }
 out.add('}');return out.finish();
}
