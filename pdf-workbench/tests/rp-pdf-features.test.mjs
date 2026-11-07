/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | End-to-end backend, engine, PDF dictionary, OOXML archive and forced two-arm RLS verification for RP-PDF-01..10.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {fixture} from './fixtures/fixture.mjs';

const python=()=>process.env.OSHAL_PDF_TEST_PYTHON||'python3';

async function apiJson(f,path,{method='GET',body,owner='alice'}={}){
 const headers={'x-test-owner':owner,...(body?{'Content-Type':'application/json'}:{})};
 const res=await fetch(f.url+'/api/pdf-workbench'+path,{method,headers,body:body?JSON.stringify(body):undefined});
 return{status:res.status,data:await res.json()};
}

async function uploadFixturePdf(f,filePath,title='Source PDF',owner='alice'){
 const bytes=await readFile(filePath),form=new FormData();
 form.append('file',new Blob([bytes],{type:'application/pdf'}),'source.pdf');
 form.append('title',title);form.append('requestKey',randomUUID());
 const up=await fetch(f.url+'/api/pdf-workbench/sources/upload',{method:'POST',headers:{'x-test-owner':owner},body:form});
 assert.equal(up.status,200);const {source}=await up.json();
 const doc=await apiJson(f,'/documents',{method:'POST',owner,body:{source:source.id,title,requestKey:randomUUID()}});
 assert.equal(doc.status,200);return doc.data.document;
}

async function commitRevision(f,docId,baseRevision,operations,owner='alice'){
 const queued=await apiJson(f,`/documents/${docId}/revisions`,{method:'POST',owner,body:{baseRevision,operations,requestKey:randomUUID()}});
 assert.equal(queued.status,202,JSON.stringify(queued.data));
 for(let i=0;i<80;i++){
  const polled=await apiJson(f,`/jobs/${queued.data.job.id}`,{owner});
  if(polled.data.job.state==='ready')return polled.data.job;
  if(['failed','cancelled'].includes(polled.data.job.state))assert.fail(JSON.stringify(polled.data.job));
  await pause(60);
 }
 assert.fail('PDF revision job timed out');
}

function inspectPdfAnnotsAndPages(pdfBytes){
 const script=`
import io, json, re, sys
from pypdf import PdfReader
reader = PdfReader(io.BytesIO(sys.stdin.buffer.read()))
pages = []
for p in reader.pages:
    cb = [float(v) for v in p.cropbox]
    annots = []
    for ref in (p.get('/Annots') or []):
        a = ref.get_object()
        qp = [float(v) for v in a['/QuadPoints']] if '/QuadPoints' in a else None
        bs = a['/BS'].get_object() if '/BS' in a else None
        sw = float(bs['/W']) if bs and '/W' in bs else None
        annots.append({'subtype': str(a.get('/Subtype')), 'quadPoints': qp, 'strokeWidth': sw})
    xobj = p.get('/Resources', {}).get('/XObject')
    images = 0
    if xobj:
        for k, v in xobj.get_object().items():
            if str(v.get_object().get('/Subtype')) == '/Image':
                images += 1
    contents = p.get_contents()
    if isinstance(contents, list):
        raw_stream = b'\\n'.join(c.get_object().get_data() for c in contents)
    elif contents is not None:
        raw_stream = contents.get_data()
    else:
        raw_stream = b''
    stream = raw_stream.decode('latin1', 'ignore')
    pages.append({'cropBox': cb, 'annots': annots, 'images': images, 'hasVectorStroke': bool(re.search(r'\\bm\\b[\\s\\S]*\\bl\\b[\\s\\S]*\\bS\\b', stream))})
print(json.dumps(pages))
`;
 const res=spawnSync(python(),['-c',script],{input:pdfBytes,maxBuffer:8*1024*1024});
 assert.equal(res.status,0,res.stderr?.toString());
 return JSON.parse(res.stdout.toString());
}

test('RP-PDF-01 & RP-PDF-02: QuadPoints text markups and stroked Ink persist in PDF /Annots and erase cleanly',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const doc=await uploadFixturePdf(f,join(f.directory,'first.pdf'),'Markup test'),pageId=doc.model.pages[0].id;
 const wordsRes=await apiJson(f,`/documents/${doc.id}/pages/${pageId}/words?revision=1`);
 assert.equal(wordsRes.status,200);assert.ok(wordsRes.data.words.length>=2,'word boxes extracted');
 const w0=wordsRes.data.words[0].rect,quad=[w0[0],w0[3],w0[2],w0[3],w0[0],w0[1],w0[2],w0[1]],inkId=randomUUID();
 await commitRevision(f,doc.id,1,[
  {op:'annotate',annotation:{id:randomUUID(),page:pageId,kind:'highlight',rect:w0,quadPoints:[quad],color:'ffcc00'}},
  {op:'annotate',annotation:{id:randomUUID(),page:pageId,kind:'underline',rect:[10,40,120,58],quadPoints:[[10,58,120,58,10,40,120,40]],color:'2563eb'}},
  {op:'annotate',annotation:{id:randomUUID(),page:pageId,kind:'strikethrough',rect:[10,65,120,82],quadPoints:[[10,82,120,82,10,65,120,65]],color:'dc2626'}},
  {op:'annotate',annotation:{id:inkId,page:pageId,kind:'ink',rect:[20,90,140,150],points:[[20,90],[80,150],[140,110]],color:'1d4ed8',strokeWidth:4.5}}
 ]);
 const rev2=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${doc.id}/revisions/2/content`)).arrayBuffer());
 const inspected2=inspectPdfAnnotsAndPages(rev2)[0].annots;
 for(const sub of ['/Highlight','/Underline','/StrikeOut']){
  const found=inspected2.find(a=>a.subtype===sub);assert.ok(found,sub+' persisted');assert.equal(found.quadPoints.length,8);
 }
 const ink=inspected2.find(a=>a.subtype==='/Ink');assert.ok(ink);assert.equal(ink.strokeWidth,4.5);
 await commitRevision(f,doc.id,2,[{op:'remove-annotation',id:inkId}]);
 const rev3=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${doc.id}/revisions/3/content`)).arrayBuffer());
 const inspected3=inspectPdfAnnotsAndPages(rev3)[0].annots;
 assert.equal(inspected3.some(a=>a.subtype==='/Ink'),false,'eraser removed Ink stroke cleanly');
 assert.equal(inspected3.filter(a=>['/Highlight','/Underline','/StrikeOut'].includes(a.subtype)).length,3);
});

test('RP-PDF-03: caller signatures enforce forced two-arm RLS, stamp as PDF image XObjects and delete safely',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const png=spawnSync(python(),['-c',"from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGBA',(120,40),(17,24,39,220)).save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())"]);
 assert.equal(png.status,0);const dataBase64=png.stdout.toString().trim();
 const created=await apiJson(f,'/signatures',{method:'POST',body:{title:'Alice Sign',dataBase64,sourceKind:'drawn',transparentBg:true,requestKey:randomUUID()}});
 assert.equal(created.status,200);const sigId=created.data.signature.id;assert.equal(created.data.signature.notCertifiedDigitalSignature,true);
 assert.equal((await apiJson(f,'/signatures',{owner:'bob'})).data.signatures.length,0,'Bob sees zero Alice signatures');
 assert.equal((await fetch(`${f.url}/api/pdf-workbench/signatures/${sigId}/content`,{headers:{'x-test-owner':'bob'}})).status,404);
 const rlsClient=await f.ctx.pool.connect();
 try{
  await rlsClient.query('BEGIN');
  await rlsClient.query("SELECT set_config('pdf.owner_issuer','pdf-http-fixture',true),set_config('pdf.owner_sub','alice',true),set_config('app.current_user_id','pdf-http-fixture:bob',true)");
  assert.equal((await rlsClient.query('SELECT count(*)::int AS n FROM pdf_signatures')).rows[0].n,0,'two-arm RLS blocks mismatched app.current_user_id');
  await rlsClient.query("SELECT set_config('app.current_user_id','pdf-http-fixture:alice',true)");
  assert.equal((await rlsClient.query('SELECT count(*)::int AS n FROM pdf_signatures')).rows[0].n,1,'matching two-arm RLS permits owner read');
  await assert.rejects(rlsClient.query("UPDATE pdf_signatures SET title='Mutated'"),/immutable/i);
  await rlsClient.query('ROLLBACK');
 }finally{rlsClient.release();}
 const doc=await uploadFixturePdf(f,join(f.directory,'first.pdf'),'Signed doc'),pageId=doc.model.pages[0].id;
 const placed=await apiJson(f,`/signatures/${sigId}/place`,{method:'POST',body:{requestKey:randomUUID()}});
 assert.equal(placed.status,200);
 await commitRevision(f,doc.id,1,[{op:'add-object',page:pageId,item:{id:randomUUID(),kind:'image',asset:placed.data.asset.id,rect:[30,30,150,70]}}]);
 assert.equal((await apiJson(f,`/signatures/${sigId}`,{method:'DELETE'})).status,200,'caller signature deleted without breaking revision');
 const pdfBytes=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${doc.id}/revisions/2/content`)).arrayBuffer());
 assert.ok(inspectPdfAnnotsAndPages(pdfBytes)[0].images>=1,'signature XObject embedded in exported PDF');
});

test('RP-PDF-04 & RP-PDF-05: adjacent-sized blank page insertion and check/cross vector marks persist in exported PDF',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const doc=await uploadFixturePdf(f,join(f.directory,'first.pdf'),'Marks and blank'),firstPage=doc.model.pages[0].id,blankId=randomUUID();
 await commitRevision(f,doc.id,1,[
  {op:'rotate',page:firstPage,degrees:90},
  {op:'insert-blank',position:1,id:blankId},
  {op:'add-object',page:blankId,item:{id:randomUUID(),kind:'check',rect:[30,30,54,54],stroke:'111827',strokeWidth:2.4}},
  {op:'add-object',page:blankId,item:{id:randomUUID(),kind:'cross',rect:[70,30,94,54],stroke:'dc2626',strokeWidth:2.4}}
 ]);
 const pdfBytes=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${doc.id}/revisions/2/content`)).arrayBuffer());
 const pages=inspectPdfAnnotsAndPages(pdfBytes);
 assert.equal(pages.length,3,'2 original pages + 1 inserted blank page');
 assert.deepEqual(pages[1].cropBox,[0,0,200,240],'blank page matches rotated neighbor dimensions');
 assert.equal(pages[1].hasVectorStroke,true,'check and cross vector paths stroked into PDF stream');
});

test('RP-PDF-06 & RP-PDF-07: multi-photo PDF creation and real stream/image size reduction keep original history',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const gen=spawnSync(python(),['-c',`
import io, json, base64, random
from PIL import Image
random.seed(7)
out = []
for w, h in [(1400, 1000), (900, 1300)]:
    raw = bytes(random.getrandbits(8) for _ in range(w * h * 3))
    im = Image.frombytes('RGB', (w, h), raw)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=98)
    out.append(base64.b64encode(buf.getvalue()).decode())
print(json.dumps(out))
`],{maxBuffer:16*1024*1024});
 assert.equal(gen.status,0);const[p1,p2]=JSON.parse(gen.stdout.toString());
 const created=await apiJson(f,'/documents/from-photos',{method:'POST',body:{title:'Camera roll',photos:[{name:'landscape.jpg',type:'image/jpeg',data:p1},{name:'portrait.jpg',type:'image/jpeg',data:p2}],requestKey:randomUUID()}});
 assert.equal(created.status,200);const docId=created.data.document.id;
 const rev1Bytes=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${docId}/revisions/1/content`)).arrayBuffer());
 const pages1=inspectPdfAnnotsAndPages(rev1Bytes);
 assert.equal(pages1.length,2);assert.ok(pages1[0].cropBox[2]>pages1[0].cropBox[3],'page 1 landscape');assert.ok(pages1[1].cropBox[3]>pages1[1].cropBox[2],'page 2 portrait');
 const comp=await apiJson(f,`/documents/${docId}/compress`,{method:'POST',body:{level:'maximum',requestKey:randomUUID()}});
 assert.equal(comp.status,200);assert.equal(comp.data.revision,2);
 assert.equal(comp.data.beforeBytes,rev1Bytes.length);assert.ok(comp.data.afterBytes<comp.data.beforeBytes,'compressed PDF is smaller');
 assert.equal(comp.data.savedBytes,comp.data.beforeBytes-comp.data.afterBytes);
 const rev2Bytes=Buffer.from(await fetch(f.url+comp.data.downloadUrl).then(r=>r.arrayBuffer()));
 assert.equal(rev2Bytes.length,comp.data.afterBytes);assert.equal(rev2Bytes.subarray(0,5).toString(),'%PDF-');
 const rev1Again=Buffer.from(await(await fetch(`${f.url}/api/pdf-workbench/documents/${docId}/revisions/1/content`)).arrayBuffer());
 assert.equal(rev1Again.length,rev1Bytes.length,'revision 1 preserved untouched');
});

test('RP-PDF-08, RP-PDF-09 & RP-PDF-10: valid OOXML .docx/.xlsx/.pptx exports and non-mutating RLS view preferences',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const tablePdfPath=join(f.directory,'tabular.pdf');
 const buildPdf=spawnSync(python(),['-c',`
import sys
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
w = PdfWriter()
for idx, lines in enumerate([[('Item',40,720),('Qty',180,720),('Price',280,720),('Bolt',40,696),('12',180,696),('4.50',280,696)],[('Summary slide page two',40,700)]]):
    p = w.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    p[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): w._add_object(font)})})
    ops = ' '.join(f'BT /F1 12 Tf 1 0 0 1 {x} {y} Tm ({txt}) Tj ET' for txt, x, y in lines)
    s = DecodedStreamObject(); s.set_data(ops.encode('latin1'))
    p[NameObject('/Contents')] = w._add_object(s)
with open(sys.argv[1], 'wb') as fh: w.write(fh)
`,tablePdfPath]);
 assert.equal(buildPdf.status,0,buildPdf.stderr?.toString());
 const doc=await uploadFixturePdf(f,tablePdfPath,'Quarterly report'),origSha=doc.inspection.sha256;
 for(const fmt of ['docx','xlsx','pptx']){
  const meta=await apiJson(f,`/documents/${doc.id}/convert`,{method:'POST',body:{format:fmt,revision:1}});
  assert.equal(meta.status,200);assert.equal(meta.data.approximateLayout,true);
  const archive=Buffer.from(await fetch(f.url+meta.data.downloadUrl).then(r=>r.arrayBuffer()));
  assert.equal(archive.length,meta.data.bytes);assert.equal(archive.subarray(0,4).toString('hex'),'504b0304');
  const check=spawnSync(python(),['-c',`
import io, json, sys, zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
names = set(z.namelist())
assert '[Content_Types].xml' in names and '_rels/.rels' in names
for n in names:
    if n.endswith('.xml') or n.endswith('.rels'): ET.fromstring(z.read(n))
print(json.dumps({'names': sorted(names), 'blob': b' '.join(z.read(n) for n in names if n.endswith('.xml')).decode('utf-8', 'ignore')}))
`],{input:archive});
  assert.equal(check.status,0,check.stderr?.toString());
  const parsed=JSON.parse(check.stdout.toString());
  assert.match(parsed.blob,/Bolt/);
  if(fmt==='docx')assert.ok(parsed.names.includes('word/document.xml')&&parsed.blob.includes('tbl'));
  if(fmt==='xlsx')assert.ok(parsed.names.includes('xl/worksheets/sheet1.xml'));
  if(fmt==='pptx')assert.ok(parsed.names.includes('ppt/slides/slide1.xml')&&parsed.names.includes('ppt/slides/slide2.xml'));
 }
 assert.deepEqual((await apiJson(f,'/preferences')).data.preferences,{pageLayout:'continuous',nightMode:false});
 const savedPrefs=await apiJson(f,'/preferences',{method:'PUT',body:{pageLayout:'two-page',nightMode:true}});
 assert.deepEqual(savedPrefs.data.preferences,{pageLayout:'two-page',nightMode:true});
 assert.deepEqual((await apiJson(f,'/preferences',{owner:'bob'})).data.preferences,{pageLayout:'continuous',nightMode:false});
 const afterDoc=(await apiJson(f,`/documents/${doc.id}?receipt=1`)).data.document;
 assert.equal(afterDoc.sha256,origSha,'view preferences and night mode never mutate PDF bytes');
});
