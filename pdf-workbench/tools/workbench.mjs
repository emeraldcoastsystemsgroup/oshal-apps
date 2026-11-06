/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Human drafts, page controls, immutable history and explicit original-owner job polling.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Automatically save PDF drafts before concierge reads; await real jobs and retain concurrent drafts on refresh.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Await the actual approved save-job receipt before refreshing the document, retaining concurrent or switched work.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Screen-standard layout: the document list renders as table rows with an empty row, each page card's move buttons sit in one row, every form field stands under its own label, and a rotated preview is scaled to stay inside its card.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Start in one step on a phone (Roger, trial.oswarm.ai, 2026-11-06, F5: "another unusable demo, the page is locked down"): uploadAndOpen uploads the chosen PDF as an original, creates a document from it and opens it, through the same /sources/upload and /documents routes; createBlank does the same with a one-page Letter PDF written in the page (Roger's rule: an editor opens on a blank document).
 */
import {createPdfEditor} from './editor.mjs';
import {applyContent,pdfErrorMessage} from './content-model.mjs';
let editor=null,renderedFormIdentity=null;
const base='/api/pdf-workbench',$=id=>document.getElementById(id);
let imageAssets=[],saved=null,model=null,ops=[],undo=[],redo=[],permissions={},job=null,timer=null,sourceIndex=[],intent=null,uploadIntent=null,createIntent=null;
let viewEpoch=0,starting=null,polling=null,jobView=null,jobCompletion=null,completeJob=null;
const uuid=()=>crypto.randomUUID();
const status=value=>{$('status').textContent=value;};
export async function api(path,options={}){const response=await fetch(base+path,{credentials:'same-origin',...options,headers:options.body instanceof FormData?{}:{'Content-Type':'application/json',...options.headers}});const result=await response.json();if(!response.ok){const error=new Error(pdfErrorMessage(result.error)??'PDF request failed');error.code=result.error;error.status=response.status;throw error;}return result;}
const post=(path,input)=>api(path,{method:'POST',body:JSON.stringify(input)});
const action=fn=>async()=>{try{await fn();}catch(error){status(pdfErrorMessage(error.code??error.message));}};
function controls(){for(const[name,allowed]of Object.entries({create:permissions.create,save:permissions.change,rotate:permissions.change,remove:permissions.change,extract:permissions.change,merge:permissions.change,annotate:permissions.change,fill:permissions.change,restore:permissions.change,split:permissions.create,ocr:permissions.ocr,'delete-document':permissions.delete,'delete-source':permissions.delete,'cancel-job':!!job&&permissions['job.manage']}))$(name).disabled=!allowed||(['save','restore','rotate','remove','extract','merge','annotate','fill','ocr'].includes(name)&&(!saved||!!job));$('upload').querySelector('button').disabled=!permissions.create;$('download').hidden=true;editor?.controls();}
function options(node,items){node.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.title;return option;}));}
async function refresh(){const[result,sources,images]=await Promise.all([api('/documents'),api('/sources'),api('/image-assets')]);sourceIndex=sources.sources;imageAssets=images.assets;options($('sources'),sourceIndex);$('documents').replaceChildren(...(result.documents.length?result.documents.map(documentRow):[emptyRow('No documents yet. Upload an original, then create a document from it.')]));controls();}
function documentRow(item){const tr=document.createElement('tr'),title=document.createElement('td'),revision=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='link';button.textContent=item.title;button.onclick=action(()=>open(item.id));title.append(button);revision.className='num';revision.textContent=String(item.revision);tr.append(title,revision);return tr;}
function emptyRow(text){const tr=document.createElement('tr'),td=document.createElement('td');tr.className='empty';td.colSpan=2;td.textContent=text;tr.append(td);return tr;}
async function open(id,revision,retained={}){if((ops.length||formDraft().length||editor?.foundation.hasPending()||editor?.hasInline())&&!retained.preserveFields&&!confirm('Discard the unsaved draft?'))return;const epoch=++viewEpoch,prior=JSON.stringify(ops),priorFields=JSON.stringify(formDraft()),priorProperties=editor?.signature();const result=retained.result??await api('/documents/'+id+(revision?'?revision='+revision:''));const editing=await api('/documents/'+id+'/editing-sources?revision='+result.document.revision);if(epoch!==viewEpoch||JSON.stringify(ops)!==prior||JSON.stringify(formDraft())!==priorFields||editor?.signature()!==priorProperties)return;editor?.foundation.discardPending();editor?.discardInline();for(const source of editing.sources){const index=sourceIndex.findIndex(s=>s.id===source.id);if(index<0)sourceIndex.push(source);else sourceIndex[index]=source;}saved={...result.document,inspection:editing.inspection};model=structuredClone(saved.model);ops=[];undo=[];redo=[];intent=null;options($('history'),result.history.map(row=>({id:String(row.revision),title:'Revision '+row.revision})));$('history').value=String(saved.revision);$('document-title').textContent=saved.title;$('revision').textContent='Saved revision '+saved.revision+(saved.revision!==saved.currentRevision?' · historical, read only until restored':'');$('download').href=`${base}/documents/${id}/revisions/${saved.revision}/content`;history.replaceState(null,'','?document='+id);await render({resetForms:true});for(const input of $('forms').querySelectorAll('[data-field]')){const pending=retained.preserveFields?.find(field=>field.name===input.dataset.field);if(pending)input.value=pending.value;}for(const input of $('pages').querySelectorAll('input'))input.checked=retained.selected?.includes(input.value)??false;controls();status('Opened saved PDF.');}
const selected=()=>[...$('pages').querySelectorAll('input:checked')].map(input=>input.value);
function edit(operation){
 if(!saved||saved.revision!==saved.currentRevision||!permissions.change||job)throw new Error('Open the latest revision and wait for any current job before editing.');
 if(ops.length>=64)throw new Error('Save this draft before making more changes.');
 const before={model:structuredClone(model),ops:structuredClone(ops)},next=structuredClone(model);
 if(['add-object','update-object','delete-object'].includes(operation.op))applyContent(next,operation,sourceIndex,undefined,imageAssets);
 else if(operation.op==='rotate')next.pages.find(p=>p.id===operation.page).rotation=(next.pages.find(p=>p.id===operation.page).rotation+operation.degrees)%360;
 else if(operation.op==='reorder')next.pages=operation.pageIds.map(id=>next.pages.find(p=>p.id===id));
 else if(['remove','extract'].includes(operation.op)){next.pages=next.pages.filter(p=>operation.pageIds.includes(p.id)===(operation.op==='extract'));if(!next.pages.length)throw new Error('A document must keep at least one page.');next.annotations=next.annotations.filter(a=>next.pages.some(p=>p.id===a.page));if(next.contentEdits)next.contentEdits=next.contentEdits.filter(a=>next.pages.some(p=>p.id===a.page));if(next.objects)next.objects=next.objects.filter(a=>next.pages.some(p=>p.id===a.page));}
 else if(operation.op==='annotate')next.annotations.push(structuredClone(operation.annotation));
 else if(operation.op==='update-annotation')Object.assign(next.annotations.find(a=>a.id===operation.id),structuredClone(operation.properties));
 else if(operation.op==='remove-annotation')next.annotations=next.annotations.filter(a=>a.id!==operation.id);
 else if(operation.op==='fill')next.fields[operation.name]=operation.value;
 else throw new Error('Unsupported PDF operation.');
 undo.push(before);redo=[];model=next;ops.push(structuredClone(operation));
 status(`${ops.length} unsaved operation(s). Save creates a new revision.`);void render();
}
async function render({resetForms=false}={}){
 if(!saved){$('pages').replaceChildren();$('forms').replaceChildren();renderedFormIdentity=null;controls();editor?.render();return;}
 const formIdentity=JSON.stringify([saved.id,saved.revision]),chosen=selected(),fields=!resetForms&&renderedFormIdentity===formIdentity?formDraft():[];renderedFormIdentity=formIdentity;const host=$('pages'),cards=[...host.children];
 for(const[ordinal,page]of model.pages.entries()){
  let card=cards.find(node=>node.dataset.page===page.id);
  if(!card){
   card=document.createElement('div');card.className='page';card.dataset.page=page.id;
   const label=document.createElement('label'),check=document.createElement('input'),img=document.createElement('img'),moves=document.createElement('div');check.type='checkbox';check.value=page.id;label.append(check,document.createTextNode(''));img.loading='lazy';img.onerror=()=>{img.alt='Preview unavailable; retry the saved page.';};moves.className='row';
   for(const name of ['Move earlier','Move later']){const button=document.createElement('button');button.textContent=name;moves.append(button);}card.append(label,img,moves);
  }
  const check=card.querySelector('label input');check.checked=chosen.includes(page.id);card.classList.toggle('selected',check.checked);check.parentElement.lastChild.textContent=' Page '+(ordinal+1);
  check.onchange=()=>{try{editor?.selectPages();card.classList.toggle('selected',check.checked);}catch(error){check.checked=!check.checked;status(pdfErrorMessage(error.code??error.message));}};
  const img=card.querySelector('img'),preview=`${base}/documents/${saved.id}/pages/${page.id}/preview?revision=${saved.revision}`;img.alt='Saved page '+(ordinal+1);if(img.dataset.savedPreview!==preview){img.dataset.savedPreview=preview;img.src=preview;}
  const [up,down]=card.querySelectorAll('.row button');up.disabled=!permissions.change||ordinal===0;down.disabled=!permissions.change||ordinal===model.pages.length-1;
  up.onclick=action(()=>{const ids=model.pages.map(p=>p.id);[ids[ordinal-1],ids[ordinal]]=[ids[ordinal],ids[ordinal-1]];edit({op:'reorder',pageIds:ids});});down.onclick=action(()=>{const ids=model.pages.map(p=>p.id);[ids[ordinal],ids[ordinal+1]]=[ids[ordinal+1],ids[ordinal]];edit({op:'reorder',pageIds:ids});});
  if(host.children[ordinal]!==card)host.insertBefore(card,host.children[ordinal]??null);
 }
 for(const card of cards)if(!model.pages.some(page=>page.id===card.dataset.page))card.remove();
 const forms=$('forms'),existing=[...forms.children];
 for(const field of saved.inspection.fields){
  let label=existing.find(node=>node.querySelector('[data-field]')?.dataset.field===field.name),input=label?.querySelector('[data-field]');
  if(!label){label=document.createElement('label');label.className='field';const name=document.createElement('span');name.className='name';name.textContent=field.name;
   if(field.options.length){input=document.createElement('select');options(input,(field.type==='Btn'?['/Off',...field.options]:field.options).map(value=>({id:value,title:value})));}else input=document.createElement('input');input.dataset.field=field.name;label.append(name,input);forms.append(label);
  }
  const pending=fields.find(item=>item.name===field.name);input.value=pending?.value??model.fields[field.name]??field.value;input.disabled=!field.supported||!permissions.change;
 }
 for(const label of existing)if(!saved.inspection.fields.some(field=>field.name===label.querySelector('[data-field]')?.dataset.field))label.remove();
 controls();editor?.render();
}
function poll(){polling??=pollNow().finally(()=>{polling=null;});return polling;}
async function pollNow(){
 if(!job)return;
 try{
  const result=await api('/jobs/'+job.id);job=result.job;status(`Job ${job.state}`);
  if(['ready','failed','cancelled'].includes(job.state)){
   clearInterval(timer);timer=null;const done=job,origin=jobView,finish=completeJob;
   job=null;intent=null;jobView=null;completeJob=null;let adopted=false;
   try{
    if(done.state==='ready'){
     if(done.kind==='ocr'){
      const reports=[];
      for(const[index,page]of done.result.pages.entries()){
       let text='',offset=0;
       for(;;){const part=await api(`/jobs/${done.id}/ocr/${index}/${offset}`);text+=part.text;if(part.nextOffset===null)break;offset=part.nextOffset;}
       reports.push(`Page ${page.page+1}: ${page.language}, ${page.quality}, confidence ${page.confidence??'unavailable'}\n${text}`);
      }
      if(origin.epoch===viewEpoch&&origin.id===saved?.id){$('ocr-results').textContent=reports.join('\n\n');adopted=true;}
     }else if(origin.epoch===viewEpoch&&origin.id===saved?.id){
      if(JSON.stringify(ops)!==origin.operations||JSON.stringify(formDraft())!==JSON.stringify(origin.fields)||editor?.signature()!==origin.properties)status('The PDF update is saved. Your newer draft is still here; choose the saved revision to review it.');
      else{const chosen=selected();ops=[];await open(done.document,done.result.revision,{selected:chosen,preserveFields:origin.fields});adopted=saved?.id===done.document&&saved.revision===done.result.revision;}
     }
    }else status(done.error??'Job cancelled; no new revision published.');
   }finally{finish?.({job:done,adopted});controls();}
  }
 }catch(error){status(error.code==='pdf_storage_busy'?'Storage is busy; checking the job again shortly.':error.message);}
}
function start(kind,input){if(starting)return starting;starting=startNow(kind,input).finally(()=>{starting=null;});return starting;}
async function startNow(kind,input){
 if(job)throw new Error('Wait for the current PDF job to finish.');
 const origin={id:saved.id,epoch:viewEpoch,operations:JSON.stringify(ops),fields:formDraft(),properties:editor?.signature()},signature=JSON.stringify([kind,saved.id,input]);
 if(intent?.signature!==signature)intent={signature,key:uuid()};
 const result=await post(`/documents/${saved.id}/${kind==='ocr'?'ocr':'revisions'}`,{...input,requestKey:intent.key});
 job=result.job;jobView=origin;jobCompletion=new Promise(resolve=>{completeJob=resolve;});controls();status('Job queued; the saved PDF remains available.');
 clearInterval(timer);timer=setInterval(()=>void poll(),2000);await poll();
}
$('refresh').onclick=action(refresh);
$('upload').onsubmit=async event=>{event.preventDefault();await action(async()=>{const file=$('file').files[0],name=$('source-title').value,signature=JSON.stringify([file.name,file.size,file.lastModified,name]);if(uploadIntent?.signature!==signature)uploadIntent={signature,key:uuid()};const form=new FormData();form.append('file',file);form.append('title',name);form.append('requestKey',uploadIntent.key);await api('/sources/upload',{method:'POST',body:form});uploadIntent=null;await refresh();status('Original PDF preserved.');})();};
$('file').onchange=()=>{$('source-title').value=$('file').files[0]?.name??'';};
/** Upload a PDF as an original, create a document from it and open it: the phone's one-step start. */
async function uploadAndOpen(file,name){
 if(!permissions.create)throw new Error('Your access does not allow adding a PDF.');
 const title=(name||file.name||'Document').replace(/\.pdf$/i,'').slice(0,160)||'Document',form=new FormData();
 form.append('file',file);form.append('title',title);form.append('requestKey',uuid());
 const uploaded=await api('/sources/upload',{method:'POST',body:form});
 const result=await post('/documents',{source:uploaded.source.id,title,requestKey:uuid()});
 await refresh();await open(result.document.id);status('Opened '+title+'.');
}
/** A one-page US Letter PDF with an empty content stream, built byte by byte so its cross-reference offsets are exact. */
function blankPdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 let body='%PDF-1.4\n';const offsets=[];
 objects.forEach((object,index)=>{offsets.push(body.length);body+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=body.length;body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new File([body],'Blank page.pdf',{type:'application/pdf'});
}
$('create').onclick=action(async()=>{const source=$('sources').value,title=$('title').value||sourceIndex.find(s=>s.id===source)?.title,signature=JSON.stringify([source,title]);if(createIntent?.signature!==signature)createIntent={signature,key:uuid()};const result=await post('/documents',{source,title,requestKey:createIntent.key});createIntent=null;await refresh();await open(result.document.id);});
$('rotate').onclick=action(()=>{const pages=selected();if(!pages.length)throw new Error('Select a page.');for(const page of pages)edit({op:'rotate',page,degrees:90});});
for(const name of ['remove','extract'])$(name).onclick=action(()=>{const pageIds=selected();if(!pageIds.length)throw new Error('Select pages.');edit({op:name,pageIds});});
$('split').onclick=action(async()=>{if(ops.length)throw new Error('Save or undo the draft first.');const pages=saved.model.pages.filter(p=>selected().includes(p.id));if(!pages.length)throw new Error('Select saved pages.');if(new Set(pages.map(p=>p.source)).size!==1||pages.some(p=>p.rotation!==0)||saved.model.annotations.length||Object.keys(saved.model.fields).length)throw new Error('Selected-page copy currently accepts unedited pages from one original; use keep-selected and save for edited pages.');const result=await post('/documents',{source:pages[0].source,indices:pages.map(p=>p.index),title:saved.title+' selected',requestKey:uuid()});await refresh();await open(result.document.id);});
$('merge').onclick=action(async()=>{if(!saved||saved.revision!==saved.currentRevision)throw new Error('Open the latest document.');undo.push({model:structuredClone(model),ops:structuredClone(ops)});redo=[];ops.push({op:'merge',source:$('sources').value,position:model.pages.length});status('Source append queued in draft. Save to inspect its real page instances.');});
$('annotate').onclick=action(()=>{const page=selected()[0];if(!page)throw new Error('Select a page.');const kind=$('annotation-kind').value,annotation={id:uuid(),page,kind,rect:$('annotation-rect').value.split(',').map(Number),color:$('annotation-color').value.slice(1)};if(kind==='text')annotation.text=$('annotation-text').value;if(kind==='ink')annotation.points=$('annotation-points').value.split(';').map(pair=>pair.split(',').map(Number));edit({op:'annotate',annotation});});
$('fill').onclick=action(()=>{for(const input of $('forms').querySelectorAll('[data-field]:not(:disabled)'))if(input.value!==(model.fields[input.dataset.field]??saved.inspection.fields.find(f=>f.name===input.dataset.field).value))edit({op:'fill',name:input.dataset.field,value:input.value});});
$('undo').onclick=action(()=>{const prior=undo.pop();if(!prior)return;redo.push({model:structuredClone(model),ops:structuredClone(ops)});model=prior.model;ops=prior.ops;void render();status('Draft undo applied.');});
$('redo').onclick=action(()=>{const next=redo.pop();if(!next)return;undo.push({model:structuredClone(model),ops:structuredClone(ops)});model=next.model;ops=next.ops;void render();status('Draft redo applied.');});
$('save').onclick=action(()=>saveDraft());
$('cancel-job').onclick=action(async()=>{if(job){await post('/jobs/'+job.id+'/cancel',{});await poll();}});
$('ocr').onclick=action(()=>{if(ops.length)throw new Error('OCR uses the saved revision. Save or undo the draft first.');return start('ocr',{revision:saved.revision,pageIds:selected(),language:$('language').value});});
$('search-button').onclick=action(async()=>{if(!saved)return;const result=await api(`/documents/${saved.id}/text?revision=${saved.revision}`),term=$('search').value.toLowerCase();$('search-results').textContent=result.pages.filter(p=>p.text.toLowerCase().includes(term)).map(p=>`Page ${p.page+1}${p.truncated?' (truncated)':''}:\n${p.text}`).join('\n\n')||'No selectable-text match. OCR scanned pages explicitly.';});
$('open-history').onclick=action(()=>open(saved.id,Number($('history').value)));
$('restore').onclick=action(()=>{if(ops.length)throw new Error('Save or undo the draft first.');return start('revision',{baseRevision:saved.currentRevision,restoreRevision:Number($('history').value)});});
$('delete-document').onclick=action(async()=>{if(!saved||!confirm('Delete this document and all derivative history? Original source PDFs remain.'))return;await api('/documents/'+saved.id,{method:'DELETE'});saved=null;model=null;ops=[];$('pages').replaceChildren();await refresh();status('Document history deleted; original sources remain.');});
$('delete-source').onclick=action(async()=>{if(confirm('Delete this unused original PDF? Saved history references will refuse deletion.')){await api('/sources/'+$('sources').value,{method:'DELETE'});await refresh();}});
editor=await createPdfEditor({uploadAndOpen:(file)=>uploadAndOpen(file),createBlank:()=>uploadAndOpen(blankPdf(),'Blank page'),documentCount:()=>$('documents').querySelectorAll('tr:not(.empty)').length,snapshot:()=>({saved,model,ops,undo,redo,permissions,job,sources:sourceIndex,assets:imageAssets,starting}),edit,post,selected,formDraft,controls,status,save:()=>saveDraft(),export:()=>exportDraft(),prepare:()=>prepareDocumentHandoff(),refresh:context=>refreshDocumentHandoff(context),uploadImage:async(form)=>{const result=await api('/image-assets',{method:'POST',body:form});imageAssets.unshift(result.asset);return result.asset;},removeImage:async id=>{await api('/image-assets/'+id,{method:'DELETE'});imageAssets=imageAssets.filter(a=>a.id!==id);}});
async function saveDraft(wait=false){
 editor.flushInline();await editor.foundation.flushPending();
 for(const operation of formDraft())edit(operation);
 if(!saved)throw new Error('Open a PDF first.');
 if(!ops.length){status('All changes are saved.');return;}
 if(!permissions.change)throw new Error('Your access does not allow saving this PDF.');
 await start('revision',{baseRevision:saved.currentRevision,operations:structuredClone(ops)});if(wait)await waitForJob(jobCompletion);
}
async function exportDraft(){if(job||starting)await waitForJob(jobCompletion);await saveDraft(true);if(!permissions.export)throw new Error('Your access does not allow exporting this PDF.');window.location.assign($('download').href);}
$('download').onclick=event=>{event.preventDefault();void action(exportDraft)();};
try{permissions=(await api('/permissions')).permissions;await refresh();const id=new URL(location.href).searchParams.get('document');if(id)await open(id);}catch(error){status(pdfErrorMessage(error.code??error.message));}controls();

function formDraft(){return [...$('forms').querySelectorAll('[data-field]:not(:disabled)')].filter(input=>input.value!==(model?.fields[input.dataset.field]??saved?.inspection.fields.find(f=>f.name===input.dataset.field)?.value)).map(input=>({op:'fill',name:input.dataset.field,value:input.value}));}
async function waitForJob(completion){
 if(!completion)return;let timeout;
 try{const result=await Promise.race([completion,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('The PDF save is still running. Your draft is kept; ask again after it finishes.')),90000);})]);
  if(result.job.state!=='ready')throw new Error(result.job.error??'The PDF save did not finish. Your draft is kept.');
  if(!result.adopted)throw new Error('The open PDF or its draft changed during the save. Your current work is kept; ask again from the document you want to edit.');
 }finally{clearTimeout(timeout);}
}
async function prepareDocumentHandoff(){
 editor.flushInline();await editor.foundation.flushPending();
 document.activeElement?.blur?.();
 if(starting){await starting;await waitForJob(jobCompletion);}else if(job)await waitForJob(jobCompletion);
 if(!saved)return{app:'pdf-workbench',screen:'surface',surface:'pdf-workbench'};
 const id=saved.id,pendingFields=formDraft();
 const saveDraft=async()=>{if(!permissions.change)throw new Error('Your access does not allow saving this PDF draft.');await start('revision',{baseRevision:saved.currentRevision,operations:structuredClone(ops)});await waitForJob(jobCompletion);};
 for(const operation of pendingFields){if(ops.length>=64)await saveDraft();edit(operation);}
 if(ops.length)await saveDraft();
 if(saved?.id!==id||ops.length||formDraft().length)throw new Error('The current PDF draft could not be saved.');
 return{app:'pdf-workbench',screen:'surface',surface:'pdf-workbench',recordId:saved.id,title:saved.title,fields:{revision:saved.revision,readOnly:saved.revision!==saved.currentRevision,draft:false},selection:editor.selection()};
}
async function waitForApprovedSave(receipt,id,epoch){
 const deadline=Date.now()+90000;
 for(;;){
  if(saved?.id!==id||viewEpoch!==epoch)return false;
  const result=await api('/jobs/'+encodeURIComponent(receipt.id)),current=result.job;
  if(saved?.id!==id||viewEpoch!==epoch)return false;
  if(current.document!==id||current.kind!=='revision')throw new Error('The accepted PDF job does not belong to this document save.');
  if(current.state==='ready')return true;
  if(['failed','cancelled'].includes(current.state))throw new Error(current.error??'The accepted PDF save did not finish. Your current document is kept.');
  if(Date.now()>=deadline)throw new Error('The accepted PDF save is still running. Your current document is kept.');
  await new Promise(resolve=>setTimeout(resolve,250));
 }
}
async function refreshDocumentHandoff(expected,completion){
 if(starting){await starting;await waitForJob(jobCompletion);}else if(job)await waitForJob(jobCompletion);
 const id=saved?.id,epoch=viewEpoch,revision=saved?.revision;
 if(!id||(expected?.recordId&&expected.recordId!==id)||(expected?.fields?.readOnly&&saved.revision!==saved.currentRevision))return;
 const receipt=completion?.job;
 if(receipt){if(receipt.document!==id||receipt.kind!=='revision')return;if(!await waitForApprovedSave(receipt,id,epoch))return;}
 const result=await api('/documents/'+id);
 if(viewEpoch!==epoch||saved?.id!==id||result.document.revision<=revision)return;
 document.activeElement?.blur?.();
 if(ops.length||formDraft().length||editor.foundation.hasPending()||editor.hasInline())throw new Error('The concierge saved an update while you were editing. Your PDF draft is still here; choose the saved revision to review it.');
 await open(id,undefined,{result,selected:selected()});
}
void import('/shared/ui/js/document-handoff.js').then(({registerDocumentSession})=>registerDocumentSession({app:'pdf-workbench',prepare:async()=>{try{return await prepareDocumentHandoff();}catch(error){status(pdfErrorMessage(error.code??error.message));throw error;}},refresh:async(expected,completion)=>{try{await refreshDocumentHandoff(expected,completion);}catch(error){status(pdfErrorMessage(error.code??error.message));throw error;}}})).catch(error=>status('The concierge cannot synchronize this PDF: '+error.message));
