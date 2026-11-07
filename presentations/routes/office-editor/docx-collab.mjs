/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | OOXML Word highlight, anchored comment threads (`word/comments.xml`) and tracked revisions (`w:ins`, `w:del`) export and external import.
 */
import{uid,style,plain}from'../../tools/office/model.mjs';
import{xml,first,children,descendants,content}from'./xml.mjs';

const WORD_HIGHLIGHTS=Object.freeze({
 yellow:'#fef08a',green:'#bbf7d0',cyan:'#bae6fd',magenta:'#fbcfe8',blue:'#bfdbfe',red:'#fecaca',
 darkblue:'#93c5fd',darkcyan:'#67e8f9',darkgreen:'#86efac',darkmagenta:'#f0abfc',darkred:'#fca5a5',
 darkyellow:'#fde047',darkgray:'#cbd5e1',lightgray:'#e2e8f0',black:'#cbd5e1'
});

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');

export function parseWordHighlight(props){
 const shd=first(props,'shd')?.attrs.fill;
 if(shd&&/^[0-9a-f]{6}$/i.test(shd)&&shd.toLowerCase()!=='ffffff'&&shd.toLowerCase()!=='auto')return'#'+shd.toLowerCase();
 const named=first(props,'highlight')?.attrs.val?.toLowerCase();
 if(named&&named!=='none')return WORD_HIGHLIGHTS[named]??'#fef08a';
 return'transparent';
}

export function parseRunStyle(props,align='left'){
 const font=first(props,'rFonts')?.attrs.ascii;
 return style({
  fontFamily:font??'Arial',
  fontSize:Number(first(props,'sz')?.attrs.val??24)/2,
  bold:Boolean(first(props,'b'))&&!['0','false','off'].includes(first(props,'b').attrs.val),
  italic:Boolean(first(props,'i'))&&!['0','false','off'].includes(first(props,'i').attrs.val),
  underline:Boolean(first(props,'u'))&&first(props,'u').attrs.val!=='none',
  color:'#'+(first(props,'color')?.attrs.val?.match(/^[a-f0-9]{6}$/i)?.[0]??'172033'),
  highlight:parseWordHighlight(props),
  align
 });
}

function runXml(runText,runStyle,{deleted=false}={}){
 const hex=runStyle.color.slice(1).toUpperCase(),size=Math.round(runStyle.fontSize*2);
 const rPr=[
  `<w:rFonts w:ascii="${esc(runStyle.fontFamily)}" w:hAnsi="${esc(runStyle.fontFamily)}" w:cs="${esc(runStyle.fontFamily)}"/>`,
  runStyle.bold?'<w:b/>':'',runStyle.italic?'<w:i/>':'',runStyle.underline?'<w:u w:val="single"/>':'',
  `<w:color w:val="${hex}"/>`,`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
  runStyle.highlight&&runStyle.highlight!=='transparent'?`<w:shd w:val="clear" w:color="auto" w:fill="${runStyle.highlight.slice(1).toUpperCase()}"/>`:''
 ].join('');
 const tag=deleted?'w:delText':'w:t';
 const parts=String(runText).split('\n');
 const body=parts.map((line,idx)=>(idx?'<w:br/>':'')+`<${tag} xml:space="preserve">${esc(line)}</${tag}>`).join('');
 return`<w:r><w:rPr>${rPr}</w:rPr>${body}</w:r>`;
}

function buildParagraphInnerXml(block,comments,changes,commentIds,nextChangeNum){
 const full=plain(block.runs),cuts=new Set([0,full.length]);
 let cursor=0;for(const run of block.runs){cursor+=run.text.length;cuts.add(cursor);}
 for(const item of [...comments,...changes]){cuts.add(Math.max(0,Math.min(full.length,item.start)));cuts.add(Math.max(0,Math.min(full.length,item.end)));}
 const points=[...cuts].sort((a,b)=>a-b);
 const styleAt=pos=>{let off=0;for(const r of block.runs){const end=off+r.text.length;if(pos<end)return r.style;off=end;}return block.runs.at(-1)?.style??style({fontSize:12});};
 const out=[];
 const emitPoint=(pos,stage)=>{
  if(stage==='start'){
   for(const c of comments)if(c.start===pos)out.push(`<w:commentRangeStart w:id="${commentIds.get(c.id)}"/>`);
   for(const ch of changes)if(ch.type==='delete'&&ch.start===pos){
    const cid=nextChangeNum();
    out.push(`<w:del w:id="${cid}" w:author="${esc(ch.author)}" w:date="${esc(ch.createdAt)}">${runXml(ch.text,ch.style,{deleted:true})}</w:del>`);
   }
   for(const c of comments)if(c.start===c.end&&c.end===pos){
    const id=commentIds.get(c.id);out.push(`<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
   }
  }else{
   for(const c of comments)if(c.start<c.end&&c.end===pos){
    const id=commentIds.get(c.id);out.push(`<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
   }
  }
 };
 emitPoint(0,'start');
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1];if(b<=a)continue;
  const rXml=runXml(full.slice(a,b),styleAt(a));
  const ins=changes.find(ch=>ch.type==='insert'&&ch.start<=a&&ch.end>=b);
  if(ins)out.push(`<w:ins w:id="${nextChangeNum()}" w:author="${esc(ins.author)}" w:date="${esc(ins.createdAt)}">${rXml}</w:ins>`);
  else out.push(rXml);
  emitPoint(b,'end');
  if(i<points.length-2)emitPoint(b,'start');
 }
 return out.join('');
}

function buildCommentsXml(comments,commentIds){
 const items=[];let replyNum=comments.length+1;
 for(const c of comments){
  const cid=commentIds.get(c.id);
  items.push(`<w:comment w:id="${cid}" w:author="${esc(c.author)}" w:date="${esc(c.createdAt)}" w:resolved="${c.resolved?'1':'0'}"><w:p><w:r><w:t xml:space="preserve">${esc(c.text)}</w:t></w:r></w:p></w:comment>`);
  for(const r of c.replies){
   items.push(`<w:comment w:id="${replyNum++}" w:author="${esc(r.author)}" w:date="${esc(r.createdAt)}" w:parentId="${cid}"><w:p><w:r><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r></w:p></w:comment>`);
  }
 }
 return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${items.join('')}</w:comments>`;
}

export async function injectDocxCollab(zip,model){
 const comments=model.comments??[],changes=model.changes??[];
 if(!comments.length&&!changes.length)return;
 const commentIds=new Map(comments.map((c,i)=>[c.id,String(i)]));
 let changeSeq=100;const nextChangeNum=()=>String(changeSeq++);
 const docPath='word/document.xml',docXml=await zip.file(docPath).async('string');
 const flatBlocks=model.pages.flatMap(page=>page.blocks.length?page.blocks.map(block=>({pageId:page.id,block})):[{pageId:page.id,block:null}]);
 let pIndex=0;
 const paragraphEntries=flatBlocks.filter(entry=>!entry.block||entry.block.type!=='table');
 const patched=docXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,(match,offset)=>{
  const before=docXml.slice(0,offset);
  const openTbl=(before.match(/<w:tbl\b/g)??[]).length,closeTbl=(before.match(/<\/w:tbl>/g)??[]).length;
  if(openTbl>closeTbl)return match;
  const entry=paragraphEntries[pIndex++];
  if(!entry?.block||entry.block.type!=='paragraph')return match;
  const bComments=comments.filter(c=>c.page===entry.pageId&&c.targetId===entry.block.id);
  const bChanges=changes.filter(ch=>ch.page===entry.pageId&&ch.blockId===entry.block.id);
  if(!bComments.length&&!bChanges.length)return match;
  const openTag=/^<w:p\b[^>]*>/.exec(match)[0];
  const pPr=/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/.exec(match)?.[0]??'';
  return`${openTag}${pPr}${buildParagraphInnerXml(entry.block,bComments,bChanges,commentIds,nextChangeNum)}</w:p>`;
 });
 zip.file(docPath,patched);
 if(comments.length){
  zip.file('word/comments.xml',buildCommentsXml(comments,commentIds));
  const types=await zip.file('[Content_Types].xml').async('string');
  if(!types.includes('/word/comments.xml')){
   zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
  }
  const relsPath='word/_rels/document.xml.rels',rels=await zip.file(relsPath)?.async('string');
  if(rels&&!rels.includes('/relationships/comments')){
   zip.file(relsPath,rels.replace('</Relationships>','<Relationship Id="rIdOshalComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'));
  }
 }
}

export async function readDocxCommentsMap(zip){
 const file=zip.file('word/comments.xml');
 if(!file)return new Map();
 const root=xml(await file.async('string')),byId=new Map(),repliesByParent=new Map();
 const extDone=new Map();
 const extFile=zip.file('word/commentsExtended.xml');
 if(extFile){
  for(const ex of descendants(xml(await extFile.async('string')),'commentEx')){
   if(ex.attrs.paraId&&ex.attrs.done==='1')extDone.set(ex.attrs.paraId,true);
  }
 }
 for(const node of children(root,'comment')){
  const rawId=String(node.attrs.id??'');if(!rawId)continue;
  const textBody=descendants(node,'t').map(t=>content(t)).join('').trim()||'Comment';
  const author=String(node.attrs.author??'Reviewer').trim()||'Reviewer';
  const createdAt=String(node.attrs.date??'2026-01-01T00:00:00Z').trim()||'2026-01-01T00:00:00Z';
  const paraId=first(node,'p')?.attrs.paraId;
  const resolved=node.attrs.resolved==='1'||node.attrs.done==='1'||Boolean(paraId&&extDone.get(paraId));
  if(node.attrs.parentId!==undefined){
   const list=repliesByParent.get(String(node.attrs.parentId))??[];
   list.push({id:uid(),author,createdAt,text:textBody});
   repliesByParent.set(String(node.attrs.parentId),list);
  }else byId.set(rawId,{rawId,author,createdAt,resolved,text:textBody,replies:[]});
 }
 for(const[parentId,replies]of repliesByParent)if(byId.has(parentId))byId.get(parentId).replies.push(...replies);
 return byId;
}

function extractRunSegments(run,align,{deleted=false}={}){
 const runStyle=parseRunStyle(first(run,'rPr'),align);
 const parts=[''];
 for(const child of run.children){
  if(deleted?(child.name==='delText'||child.name==='t'):child.name==='t')parts[parts.length-1]+=content(child);
  else if(child.name==='tab')parts[parts.length-1]+='\t';
  else if(child.name==='br'){if(child.attrs.type==='page')parts.push('');else parts[parts.length-1]+='\n';}
 }
 return{style:runStyle,parts};
}

export function parseWordParagraphCollab(pNode,align,commentsMap){
 const segments=[{runs:[],changes:[],anchors:new Map()}];
 const cur=()=>segments.at(-1);
 const curLen=()=>cur().runs.reduce((sum,r)=>sum+r.text.length,0);
 function walkChildren(nodes){
  for(const node of nodes){
   if(node.name==='commentRangeStart'&&commentsMap.has(String(node.attrs.id))){
    cur().anchors.set(String(node.attrs.id),{start:curLen(),end:null});
   }else if(node.name==='commentRangeEnd'){
    const key=String(node.attrs.id),a=cur().anchors.get(key);
    if(a)a.end=curLen();
   }else if(node.name==='r'){
    const ref=first(node,'commentReference');
    if(ref&&commentsMap.has(String(ref.attrs.id))&&!cur().anchors.has(String(ref.attrs.id))){
     const pos=curLen();cur().anchors.set(String(ref.attrs.id),{start:pos,end:pos});
    }
    const{style:runStyle,parts}=extractRunSegments(node,align);
    parts.forEach((part,idx)=>{if(idx)segments.push({runs:[],changes:[],anchors:new Map()});if(part)cur().runs.push({text:part,style:runStyle});});
   }else if(node.name==='ins'){
    const start=curLen(),pieces=descendants(node,'r').map(r=>extractRunSegments(r,align));
    const inserted=pieces.map(p=>p.parts.join('')).join('');
    for(const p of pieces){const t=p.parts.join('');if(t)cur().runs.push({text:t,style:p.style});}
    if(inserted)cur().changes.push({type:'insert',start,end:start+inserted.length,text:inserted,style:pieces[0]?.style??style({fontSize:12,align}),author:String(node.attrs.author??'Reviewer').trim()||'Reviewer',createdAt:String(node.attrs.date??'2026-01-01T00:00:00Z')});
   }else if(node.name==='del'){
    const pos=curLen(),pieces=descendants(node,'r').map(r=>extractRunSegments(r,align,{deleted:true}));
    const deleted=pieces.map(p=>p.parts.join('')).join('');
    if(deleted)cur().changes.push({type:'delete',start:pos,end:pos,text:deleted,style:pieces[0]?.style??style({fontSize:12,align}),author:String(node.attrs.author??'Reviewer').trim()||'Reviewer',createdAt:String(node.attrs.date??'2026-01-01T00:00:00Z')});
   }else if(node.children?.length&&!['pPr','drawing','pict'].includes(node.name)){
    walkChildren(node.children);
   }
  }
 }
 walkChildren(pNode.children??[]);
 return segments;
}
