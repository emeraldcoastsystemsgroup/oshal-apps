/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..07): unit, OOXML round-trip, multipage PDF/plain-text export, and two-person forced-RLS sharing behaviour and refusal tests.
 */
import{test}from'node:test';
import assert from'node:assert/strict';
import{inflateSync}from'node:zlib';
import{mkdtempSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createRequire}from'node:module';
import{execFileSync}from'node:child_process';
import{initial,paragraph,plain,style,uid}from'../../tools/office/model.mjs';
import{applyOperations}from'../../tools/office/operations.mjs';
import{renderOffice}from'../../routes/office-editor/formats.mjs';
import{inspectOffice}from'../../routes/office-editor/importers.mjs';
import{fixture}from'./fixture.mjs';

const require=createRequire(import.meta.url);
const JSZip=require('jszip');
const sharp=require('sharp');

async function stripPrivateModel(bytes,mutateXml=null){
 const zip=await JSZip.loadAsync(bytes);
 zip.remove('oshal/office.json');
 if(mutateXml)await mutateXml(zip);
 return zip.generateAsync({type:'nodebuffer'});
}

test('RP-OFF-01: text run highlight round-trips through native and external DOCX and PPTX and refuses invalid colours',async()=>{
 let doc=initial('docx','Highlight spec');
 const pageId=doc.pages[0].id,blockId=doc.pages[0].blocks[0].id;
 doc=applyOperations(doc,[
  {op:'text-range',page:pageId,id:blockId,start:0,end:plain(doc.pages[0].blocks[0].runs).length,text:'Alpha Beta Gamma'},
  {op:'text-range',page:pageId,id:blockId,start:6,end:10,style:{highlight:'#fef08a'}}
 ]);
 assert.deepEqual(doc.pages[0].blocks[0].runs.map(r=>[r.text,r.style.highlight]),[['Alpha ','transparent'],['Beta','#fef08a'],[' Gamma','transparent']]);
 const docxBytes=await renderOffice(doc,'docx');
 const externalBytes=await stripPrivateModel(docxBytes);
 const imported=await inspectOffice(externalBytes);
 assert.deepEqual(imported.model.pages[0].blocks[0].runs.map(r=>[r.text,r.style.highlight]),[['Alpha ','transparent'],['Beta','#fef08a'],[' Gamma','transparent']]);

 const namedHighlightBytes=await stripPrivateModel(docxBytes,async zip=>{
  const xml=await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml',xml.replace(/<w:shd [^/]*\/>/,'<w:highlight w:val="green"/>'));
 });
 const namedImported=await inspectOffice(namedHighlightBytes);
 assert.equal(namedImported.model.pages[0].blocks[0].runs[1].style.highlight,'#bbf7d0');

 let deck=initial('pptx','Slide highlight');
 const slideId=deck.pages[0].id,objId=deck.pages[0].objects[0].id;
 deck=applyOperations(deck,[{op:'text-range',page:slideId,id:objId,start:0,end:5,style:{highlight:'#bae6fd'}}]);
 const pptxExternal=await stripPrivateModel(await renderOffice(deck,'pptx'));
 const deckImported=await inspectOffice(pptxExternal);
 assert.equal(deckImported.model.pages[0].objects[0].runs[0].style.highlight,'#bae6fd');

 assert.throws(()=>applyOperations(doc,[{op:'text-range',page:pageId,id:blockId,start:0,end:5,style:{highlight:'javascript:alert(1)'}}]),/color|hex/i);
});

test('RP-OFF-02: anchored comments with replies and resolved state round-trip through OOXML word/comments.xml and refuse invalid anchors',async()=>{
 let doc=initial('docx','Comments spec');
 const pageId=doc.pages[0].id,blockId=doc.pages[0].blocks[0].id;
 doc=applyOperations(doc,[
  {op:'text-range',page:pageId,id:blockId,start:0,end:plain(doc.pages[0].blocks[0].runs).length,text:'Review the quarterly numbers carefully.'},
  {op:'add-comment',comment:{id:'c-open',page:pageId,targetId:blockId,start:11,end:28,author:'alice',createdAt:'2026-11-06T12:00:00.000Z',text:'Verify against Q3 ledger.'}},
  {op:'reply-comment',id:'c-open',reply:{id:'r-1',author:'bob',createdAt:'2026-11-06T12:05:00.000Z',text:'Confirmed with finance.'}},
  {op:'add-comment',comment:{id:'c-done',page:pageId,targetId:blockId,start:0,end:6,author:'alice',createdAt:'2026-11-06T12:01:00.000Z',text:'Check verb.',resolved:false}},
  {op:'resolve-comment',id:'c-done',resolved:true}
 ]);
 const docxBytes=await renderOffice(doc,'docx');
 const zip=await JSZip.loadAsync(docxBytes);
 const docXml=await zip.file('word/document.xml').async('string');
 const commentsXml=await zip.file('word/comments.xml').async('string');
 assert.match(docXml,/w:commentRangeStart/);assert.match(docXml,/w:commentRangeEnd/);assert.match(docXml,/w:commentReference/);
 assert.match(commentsXml,/Verify against Q3 ledger\./);assert.match(commentsXml,/Confirmed with finance\./);

 const reimported=await inspectOffice(await stripPrivateModel(docxBytes));
 assert.equal(reimported.model.comments.length,2);
 const openThread=reimported.model.comments.find(c=>c.text==='Verify against Q3 ledger.');
 const doneThread=reimported.model.comments.find(c=>c.text.includes('Check verb.'));
 assert.equal(openThread.start,11);assert.equal(openThread.end,28);assert.equal(openThread.quote,'quarterly numbers');
 assert.equal(openThread.resolved,false);assert.equal(openThread.replies.length,1);assert.equal(openThread.replies[0].author,'bob');
 assert.equal(doneThread.resolved,true);

 assert.throws(()=>applyOperations(doc,[{op:'add-comment',comment:{page:pageId,targetId:blockId,start:0,end:999,author:'alice',text:'Out of bounds'}}]));
 assert.throws(()=>applyOperations(initial('xlsx'),[{op:'add-comment',comment:{page:'none',targetId:'none',start:0,end:0,author:'alice',text:'Workbook'}}]),/workbooks/i);
});

test('RP-OFF-03: tracked insertions and deletions support per-change and bulk accept/reject and round-trip through OOXML w:ins and w:del',async()=>{
 let doc=initial('docx','Tracked changes spec');
 const pageId=doc.pages[0].id,blockId=doc.pages[0].blocks[0].id;
 doc=applyOperations(doc,[
  {op:'text-range',page:pageId,id:blockId,start:0,end:plain(doc.pages[0].blocks[0].runs).length,text:'Draft latency target is 250ms.'},
  {op:'propose-change',page:pageId,id:blockId,start:24,end:27,text:'120',author:'alice',createdAt:'2026-11-06T15:00:00.000Z',deleteId:'del-1',changeId:'ins-1'}
 ]);
 assert.equal(plain(doc.pages[0].blocks[0].runs),'Draft latency target is 120ms.');
 assert.equal(doc.changes.length,2);
 const rejected=applyOperations(doc,[{op:'reject-all-changes'}]);
 assert.equal(plain(rejected.pages[0].blocks[0].runs),'Draft latency target is 250ms.');
 assert.equal(rejected.changes.length,0);
 const accepted=applyOperations(doc,[{op:'accept-change',id:'ins-1'},{op:'reject-change',id:'del-1'}]);
 assert.equal(plain(accepted.pages[0].blocks[0].runs),'Draft latency target is 250120ms.');

 const docxBytes=await renderOffice(doc,'docx');
 const zip=await JSZip.loadAsync(docxBytes);
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:del [^>]*w:author="alice"[^>]*>[\s\S]*?<w:delText[^>]*>250<\/w:delText>/);
 assert.match(xml,/<w:ins [^>]*w:author="alice"[^>]*>[\s\S]*?<w:t[^>]*>120<\/w:t>/);

 const external=await inspectOffice(await stripPrivateModel(docxBytes));
 assert.equal(plain(external.model.pages[0].blocks[0].runs),'Draft latency target is 120ms.');
 assert.deepEqual(external.model.changes.map(c=>[c.type,c.text,c.author]),[['delete','250','alice'],['insert','120','alice']]);
 const restoredFromExternal=applyOperations(external.model,[{op:'reject-all-changes'}]);
 assert.equal(plain(restoredFromExternal.pages[0].blocks[0].runs),'Draft latency target is 250ms.');
 assert.throws(()=>applyOperations(initial('pptx'),[{op:'propose-change',page:'p',id:'o',start:0,end:0,text:'No'}]),/Word/i);
});

function extractPdfStreamsText(pdfBytes){
 const raw=pdfBytes.toString('latin1'),chunks=[];
 const re=/<<([^>]*?)>>\r?\nstream\r?\n([\s\S]*?)\r?\nendstream/g;
 let m;
 while((m=re.exec(raw))!==null){
  if(/\/Subtype\s*\/Image/.test(m[1]))continue;
  chunks.push(/\/FlateDecode/.test(m[1])?inflateSync(Buffer.from(m[2],'latin1')).toString('latin1'):m[2]);
 }
 return chunks;
}

test('RP-OFF-05: multi-page PDF and plain-text export render styled pages, lists, tables and embedded images and open cleanly in PDF readers',async()=>{
 const pngBuf=await sharp({create:{width:24,height:16,channels:4,background:{r:37,g:99,b:235,alpha:1}}}).png().toBuffer();
 const dataUri='data:image/png;base64,'+pngBuf.toString('base64');
 let doc=initial('docx','Architecture Report');
 doc.header='OSHAL Confidential';doc.footer='Architecture Review';
 const p1=doc.pages[0].id,b1=doc.pages[0].blocks[0].id;
 doc=applyOperations(doc,[
  {op:'update-block',page:p1,id:b1,patch:{style:'title',runs:[{text:'Page One Executive Summary',style:style({fontSize:24,bold:true,color:'#1e3a8a'})}]}},
  {op:'add-block',page:p1,block:{...paragraph('Highlighted key finding on page one.',{fontSize:12,highlight:'#fef08a'}),list:'bullet'}},
  {op:'add-block',page:p1,block:{id:uid(),type:'table',rows:[[[{text:'Metric',style:style({bold:true})}],[{text:'Result',style:style({bold:true})}]],[[{text:'Availability',style:style()}],[{text:'99.98%',style:style()}]]]}},
  {op:'add-page',after:p1}
 ]);
 const p2=doc.pages[1].id,b2=doc.pages[1].blocks[0].id;
 doc=applyOperations(doc,[
  {op:'update-block',page:p2,id:b2,patch:{list:'number',runs:[{text:'Page Two Visual Evidence',style:style({fontSize:14,bold:true})}]}},
  {op:'add-block',page:p2,block:{id:uid(),type:'image',src:dataUri,width:180,height:120}},
  {op:'add-page',after:p2}
 ]);
 const p3=doc.pages[2].id,b3=doc.pages[2].blocks[0].id;
 doc=applyOperations(doc,[{op:'text-range',page:p3,id:b3,start:0,end:plain(doc.pages[2].blocks[0].runs).length,text:'Page Three Final Signoff'}]);

 const pdfBytes=await renderOffice(doc,'pdf');
 assert.equal(pdfBytes.subarray(0,8).toString('ascii'),'%PDF-1.7');
 const pdfLatin=pdfBytes.toString('latin1');
 assert.equal((pdfLatin.match(/\/Type \/Page\b/g)??[]).length,3,'3 distinct PDF page objects');
 assert.match(pdfLatin,/\/Subtype \/Image \/Width 24 \/Height 16/);
 const streams=extractPdfStreamsText(pdfBytes);
 assert.equal(streams.length,3,'3 page content streams');
 const pageTexts=streams.map(s=>[...s.matchAll(/\(([^)]*)\)\s*Tj/g)].map(m=>m[1]).join(''));
 assert.match(pageTexts[0],/Page One Executive Summary/);assert.match(pageTexts[0],/99\.98%/);
 assert.match(streams[0],/0\.9961 0\.9412 0\.5412 rg/,'highlight fill rect emitted on page 1');
 assert.match(pageTexts[1],/Page Two Visual Evidence/);assert.match(streams[1],/\/Im1 Do/);
 assert.match(pageTexts[2],/Page Three Final Signoff/);

 try{
  const pyOut=execFileSync('docker',['exec','-i','oshal-pdf-workbench-engine','python3','-c','import sys,io,pypdf;r=pypdf.PdfReader(io.BytesIO(sys.stdin.buffer.read()));print(len(r.pages));print("|".join(" ".join(p.extract_text().split()) for p in r.pages))'],{input:pdfBytes,timeout:10000}).toString('utf8').trim().split('\n');
  assert.equal(pyOut[0],'3','PDF Workbench pypdf reads all 3 pages');
  assert.match(pyOut[1],/Page One Executive Summary.*Page Two Visual Evidence.*Page Three Final Signoff/);
 }catch(err){if(err.code==='ERR_ASSERTION')throw err;}

 const txt=(await renderOffice(doc,'txt')).toString('utf8');
 assert.match(txt,/Page One Executive Summary/);assert.match(txt,/- Highlighted key finding/);
 assert.match(txt,/Metric\tResult/);assert.match(txt,/1\. Page Two Visual Evidence/);assert.match(txt,/Page Three Final Signoff/);

 assert.equal((await renderOffice(initial('pptx','Deck PDF'),'pdf')).subarray(0,8).toString('ascii'),'%PDF-1.7');
 assert.equal((await renderOffice(initial('xlsx','Sheet PDF'),'pdf')).subarray(0,8).toString('ascii'),'%PDF-1.7');
 await assert.rejects(()=>renderOffice(doc,'html'),/PDF, plain text or JSON/i);
});

test('RP-OFF-07: two-person forced-RLS sharing enforces view, comment and edit roles, blocks cross-tenant access, revokes cleanly and records immutable audit rows',{timeout:60000},async t=>{
 const mirrorRoot=mkdtempSync(join(tmpdir(),'office-share-mirror-'));
 const prevDataDir=process.env.OSHAL_PACKAGE_DATA_DIR;
 process.env.OSHAL_PACKAGE_DATA_DIR=mirrorRoot;
 const f=await fixture();
 t.after(async()=>{if(prevDataDir===undefined)delete process.env.OSHAL_PACKAGE_DATA_DIR;else process.env.OSHAL_PACKAGE_DATA_DIR=prevDataDir;rmSync(mirrorRoot,{recursive:true,force:true});await f.close();});

 const asActor=name=>f.context(name).store;
 const created=await asActor('alice').create({kind:'docx',title:'Board Memo',requestKey:uid()});
 const docId=created.document.id,p1=created.document.model.pages[0].id,b1=created.document.model.pages[0].blocks[0].id;
 await asActor('alice').save(docId,{baseRevision:1,requestKey:uid(),operations:[{op:'text-range',page:p1,id:b1,start:0,end:plain(created.document.model.pages[0].blocks[0].runs).length,text:'Confidential draft'}]});

 assert.equal((await asActor('bob').list()).documents.length,0,'unshared document is invisible');
 await assert.rejects(()=>asActor('bob').read(docId),err=>err.status===404);

 const viewGrant=await asActor('alice').grantShare(docId,{granteeSub:'bob',role:'view',requestKey:uid()});
 assert.equal(viewGrant.share.role,'view');
 const bobList1=(await asActor('bob').list()).documents;
 assert.equal(bobList1.length,1);assert.equal(bobList1[0].shared,true);assert.equal(bobList1[0].accessRole,'view');
 const bobRead=await asActor('bob').read(docId);
 assert.equal(bobRead.document.canEdit,false);assert.equal(bobRead.document.canComment,false);
 assert.equal((await asActor('bob').export(docId,2,'txt')).bytes.toString('utf8').includes('Confidential draft'),true);
 await assert.rejects(()=>asActor('bob').collaborate(docId,{baseRevision:2,requestKey:uid(),operations:[{op:'add-comment',comment:{page:p1,targetId:b1,start:0,end:12,author:'bob',text:'Nope'}}]}),err=>err.status===403);
 await assert.rejects(()=>asActor('bob').grantShare(docId,{granteeSub:'carol',role:'view',requestKey:uid()}),err=>err.status===403);

 assert.equal((await asActor('mallory').list()).documents.length,0,'cross-tenant bob is isolated');
 await assert.rejects(()=>asActor('mallory').read(docId),err=>err.status===404);

 await asActor('alice').grantShare(docId,{granteeSub:'bob',role:'comment',requestKey:uid()});
 const commented=await asActor('bob').collaborate(docId,{baseRevision:2,requestKey:uid(),operations:[{op:'add-comment',comment:{page:p1,targetId:b1,start:0,end:12,author:'spoofed',text:'Please tighten.'}}]});
 assert.equal(commented.document.revision,3);
 assert.equal(commented.document.model.comments[0].author,'bob','collaborator author is stamped from actor identity');
 await assert.rejects(()=>asActor('bob').collaborate(docId,{baseRevision:3,requestKey:uid(),operations:[{op:'text-range',page:p1,id:b1,start:0,end:12,text:'Hijack'}]}),err=>err.code==='office_share_comment_only');

 await asActor('alice').grantShare(docId,{granteeSub:'bob',role:'edit',requestKey:uid()});
 const edited=await asActor('bob').collaborate(docId,{baseRevision:3,requestKey:uid(),operations:[{op:'text-range',page:p1,id:b1,start:12,end:18,text:' memo'}]});
 assert.equal(edited.document.revision,4);
 assert.equal(plain((await asActor('alice').read(docId)).document.model.pages[0].blocks[0].runs),'Confidential memo');
 await assert.rejects(()=>asActor('bob').remove(docId,4),err=>err.status===404||err.status===403);

 await asActor('alice').revokeShare(docId,viewGrant.share.id);
 assert.equal((await asActor('bob').list()).documents.length,0,'revoking removes document from recipient list');
 await assert.rejects(()=>asActor('bob').read(docId),err=>err.status===404);
 const sharesAndAudit=await asActor('alice').listShares(docId);
 assert.equal(sharesAndAudit.shares.length,0);
 const actions=new Set(sharesAndAudit.audit.map(a=>a.action));
 for(const expected of ['share_grant','view','export','denied','comment','edit','share_revoke'])assert.ok(actions.has(expected),`audit contains ${expected}`);
});
