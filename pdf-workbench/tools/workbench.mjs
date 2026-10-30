/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Human drafts, page controls, immutable history and explicit original-owner job polling.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Automatically save PDF drafts before concierge reads; await real jobs and retain concurrent drafts on refresh.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Await the actual approved save-job receipt before refreshing the document, retaining concurrent or switched work.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Screen-standard layout: the document list renders as table rows with an empty row, each page card's move buttons sit in one row, every form field stands under its own label, and a rotated preview is scaled to stay inside its card.
 */
const base='/api/pdf-workbench',$=id=>document.getElementById(id);
let saved=null,model=null,ops=[],undo=[],redo=[],permissions={},job=null,timer=null,sourceIndex=[],intent=null,uploadIntent=null,createIntent=null;
let viewEpoch=0,starting=null,polling=null,jobView=null,jobCompletion=null,completeJob=null;
const uuid=()=>crypto.randomUUID();
const status=value=>{$('status').textContent=value;};
export async function api(path,options={}){const response=await fetch(base+path,{credentials:'same-origin',...options,headers:options.body instanceof FormData?{}:{'Content-Type':'application/json',...options.headers}});const result=await response.json();if(!response.ok){const error=new Error(result.error??'PDF request failed');error.code=result.error;error.status=response.status;throw error;}return result;}
const post=(path,input)=>api(path,{method:'POST',body:JSON.stringify(input)});
const action=fn=>async()=>{try{await fn();}catch(error){status(error.message);}};
function controls(){for(const[name,allowed]of Object.entries({create:permissions.create,save:permissions.change,rotate:permissions.change,remove:permissions.change,extract:permissions.change,merge:permissions.change,annotate:permissions.change,fill:permissions.change,restore:permissions.change,split:permissions.create,ocr:permissions.ocr,'delete-document':permissions.delete,'delete-source':permissions.delete,'cancel-job':!!job&&permissions['job.manage']}))$(name).disabled=!allowed||(['save','restore','rotate','remove','extract','merge','annotate','fill','ocr'].includes(name)&&(!saved||!!job));$('upload').querySelector('button').disabled=!permissions.create;$('download').hidden=!permissions.export||!saved;}
function options(node,items){node.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.title;return option;}));}
async function refresh(){const[result,sources]=await Promise.all([api('/documents'),api('/sources')]);sourceIndex=sources.sources;options($('sources'),sourceIndex);$('documents').replaceChildren(...(result.documents.length?result.documents.map(documentRow):[emptyRow('No documents yet. Upload an original, then create a document from it.')]));controls();}
function documentRow(item){const tr=document.createElement('tr'),title=document.createElement('td'),revision=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='link';button.textContent=item.title;button.onclick=action(()=>open(item.id));title.append(button);revision.className='num';revision.textContent=String(item.revision);tr.append(title,revision);return tr;}
function emptyRow(text){const tr=document.createElement('tr'),td=document.createElement('td');tr.className='empty';td.colSpan=2;td.textContent=text;tr.append(td);return tr;}
async function open(id,revision,retained={}){if((ops.length||formDraft().length)&&!retained.preserveFields&&!confirm('Discard the unsaved draft?'))return;const epoch=++viewEpoch,prior=JSON.stringify(ops),priorFields=JSON.stringify(formDraft());const result=retained.result??await api('/documents/'+id+(revision?'?revision='+revision:''));if(epoch!==viewEpoch||JSON.stringify(ops)!==prior||JSON.stringify(formDraft())!==priorFields)return;saved=result.document;model=structuredClone(saved.model);ops=[];undo=[];redo=[];intent=null;options($('history'),result.history.map(row=>({id:String(row.revision),title:'Revision '+row.revision})));$('history').value=String(saved.revision);$('document-title').textContent=saved.title;$('revision').textContent='Saved revision '+saved.revision+(saved.revision!==saved.currentRevision?' · historical, read only until restored':'');$('download').href=`${base}/documents/${id}/revisions/${saved.revision}/content`;history.replaceState(null,'','?document='+id);await render();for(const input of $('forms').querySelectorAll('[data-field]')){const pending=retained.preserveFields?.find(field=>field.name===input.dataset.field);if(pending)input.value=pending.value;}for(const input of $('pages').querySelectorAll('input'))input.checked=retained.selected?.includes(input.value)??false;controls();status('Opened saved PDF.');}
const selected=()=>[...$('pages').querySelectorAll('input:checked')].map(input=>input.value);
function edit(operation){if(!saved||saved.revision!==saved.currentRevision)throw new Error('Open the latest revision before editing.');undo.push({model:structuredClone(model),ops:structuredClone(ops)});redo=[];ops.push(operation);const old=model.pages;
 if(operation.op==='rotate')model.pages.find(p=>p.id===operation.page).rotation=(model.pages.find(p=>p.id===operation.page).rotation+operation.degrees)%360;
 if(operation.op==='reorder')model.pages=operation.pageIds.map(id=>old.find(p=>p.id===id));
 if(['remove','extract'].includes(operation.op)){model.pages=old.filter(p=>operation.pageIds.includes(p.id)===(operation.op==='extract'));if(!model.pages.length){const prior=undo.pop();model=prior.model;ops=prior.ops;throw new Error('A document must keep at least one page.');}model.annotations=model.annotations.filter(a=>model.pages.some(p=>p.id===a.page));}
 if(operation.op==='annotate')model.annotations.push(operation.annotation);
 if(operation.op==='fill')model.fields[operation.name]=operation.value;
 status(`${ops.length} unsaved operation(s). Save creates a new revision.`);void render();}
async function render(){if(!saved)return;$('pages').replaceChildren();for(const[ordinal,page]of model.pages.entries()){const card=document.createElement('div');card.className='page';const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=page.id;check.onchange=()=>card.classList.toggle('selected',check.checked);label.append(check,document.createTextNode(' Page '+(ordinal+1)));const img=document.createElement('img');img.alt='Saved page '+(ordinal+1);img.src=`${base}/documents/${saved.id}/pages/${page.id}/preview?revision=${saved.revision}`;img.onerror=()=>{img.alt='Preview unavailable; retry the saved page.';};const turn=(page.rotation-(saved.model.pages.find(p=>p.id===page.id)?.rotation??0))%360;img.style.transform=`rotate(${turn}deg)${turn%180?' scale(.75)':''}`;const up=document.createElement('button');up.textContent='Move earlier';up.disabled=!permissions.change||ordinal===0;up.onclick=action(()=>{const ids=model.pages.map(p=>p.id);[ids[ordinal-1],ids[ordinal]]=[ids[ordinal],ids[ordinal-1]];edit({op:'reorder',pageIds:ids});});const down=document.createElement('button');down.textContent='Move later';down.disabled=!permissions.change||ordinal===model.pages.length-1;down.onclick=action(()=>{const ids=model.pages.map(p=>p.id);[ids[ordinal],ids[ordinal+1]]=[ids[ordinal+1],ids[ordinal]];edit({op:'reorder',pageIds:ids});});const moves=document.createElement('div');moves.className='row';moves.append(up,down);card.append(label,img,moves);$('pages').append(card);}
 $('forms').replaceChildren();for(const field of saved.inspection.fields){const label=document.createElement('label');label.className='field';const name=document.createElement('span');name.className='name';name.textContent=field.name;let input;if(field.options.length){input=document.createElement('select');options(input,(field.type==='Btn'?['/Off',...field.options]:field.options).map(value=>({id:value,title:value})));}else input=document.createElement('input');input.dataset.field=field.name;input.value=model.fields[field.name]??field.value;input.disabled=!field.supported||!permissions.change;label.append(name,input);$('forms').append(label);}controls();}
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
      if(JSON.stringify(ops)!==origin.operations||JSON.stringify(formDraft())!==JSON.stringify(origin.fields))status('The PDF update is saved. Your newer draft is still here; choose the saved revision to review it.');
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
 const origin={id:saved.id,epoch:viewEpoch,operations:JSON.stringify(ops),fields:formDraft()},signature=JSON.stringify([kind,saved.id,input]);
 if(intent?.signature!==signature)intent={signature,key:uuid()};
 const result=await post(`/documents/${saved.id}/${kind==='ocr'?'ocr':'revisions'}`,{...input,requestKey:intent.key});
 job=result.job;jobView=origin;jobCompletion=new Promise(resolve=>{completeJob=resolve;});controls();status('Job queued; the saved PDF remains available.');
 clearInterval(timer);timer=setInterval(()=>void poll(),2000);await poll();
}
$('refresh').onclick=action(refresh);
$('upload').onsubmit=async event=>{event.preventDefault();await action(async()=>{const file=$('file').files[0],name=$('source-title').value,signature=JSON.stringify([file.name,file.size,file.lastModified,name]);if(uploadIntent?.signature!==signature)uploadIntent={signature,key:uuid()};const form=new FormData();form.append('file',file);form.append('title',name);form.append('requestKey',uploadIntent.key);await api('/sources/upload',{method:'POST',body:form});uploadIntent=null;await refresh();status('Original PDF preserved.');})();};
$('file').onchange=()=>{$('source-title').value=$('file').files[0]?.name??'';};
$('create').onclick=action(async()=>{const source=$('sources').value,title=$('title').value||sourceIndex.find(s=>s.id===source)?.title,signature=JSON.stringify([source,title]);if(createIntent?.signature!==signature)createIntent={signature,key:uuid()};const result=await post('/documents',{source,title,requestKey:createIntent.key});createIntent=null;await refresh();await open(result.document.id);});
$('rotate').onclick=action(()=>{const pages=selected();if(!pages.length)throw new Error('Select a page.');for(const page of pages)edit({op:'rotate',page,degrees:90});});
for(const name of ['remove','extract'])$(name).onclick=action(()=>{const pageIds=selected();if(!pageIds.length)throw new Error('Select pages.');edit({op:name,pageIds});});
$('split').onclick=action(async()=>{if(ops.length)throw new Error('Save or undo the draft first.');const pages=saved.model.pages.filter(p=>selected().includes(p.id));if(!pages.length)throw new Error('Select saved pages.');if(new Set(pages.map(p=>p.source)).size!==1||pages.some(p=>p.rotation!==0)||saved.model.annotations.length||Object.keys(saved.model.fields).length)throw new Error('Selected-page copy currently accepts unedited pages from one original; use keep-selected and save for edited pages.');const result=await post('/documents',{source:pages[0].source,indices:pages.map(p=>p.index),title:saved.title+' selected',requestKey:uuid()});await refresh();await open(result.document.id);});
$('merge').onclick=action(async()=>{if(!saved||saved.revision!==saved.currentRevision)throw new Error('Open the latest document.');undo.push({model:structuredClone(model),ops:structuredClone(ops)});redo=[];ops.push({op:'merge',source:$('sources').value,position:model.pages.length});status('Source append queued in draft. Save to inspect its real page instances.');});
$('annotate').onclick=action(()=>{const page=selected()[0];if(!page)throw new Error('Select a page.');const kind=$('annotation-kind').value,annotation={id:uuid(),page,kind,rect:$('annotation-rect').value.split(',').map(Number),color:$('annotation-color').value.slice(1)};if(kind==='text')annotation.text=$('annotation-text').value;if(kind==='ink')annotation.points=$('annotation-points').value.split(';').map(pair=>pair.split(',').map(Number));edit({op:'annotate',annotation});});
$('fill').onclick=action(()=>{for(const input of $('forms').querySelectorAll('[data-field]:not(:disabled)'))if(input.value!==(model.fields[input.dataset.field]??saved.inspection.fields.find(f=>f.name===input.dataset.field).value))edit({op:'fill',name:input.dataset.field,value:input.value});});
$('undo').onclick=action(()=>{const prior=undo.pop();if(!prior)return;redo.push({model:structuredClone(model),ops:structuredClone(ops)});model=prior.model;ops=prior.ops;void render();status('Draft undo applied.');});
$('redo').onclick=action(()=>{const next=redo.pop();if(!next)return;undo.push({model:structuredClone(model),ops:structuredClone(ops)});model=next.model;ops=next.ops;void render();status('Draft redo applied.');});
$('save').onclick=action(()=>{if(!ops.length)throw new Error('No draft changes.');return start('revision',{baseRevision:saved.currentRevision,operations:ops});});
$('cancel-job').onclick=action(async()=>{if(job){await post('/jobs/'+job.id+'/cancel',{});await poll();}});
$('ocr').onclick=action(()=>{if(ops.length)throw new Error('OCR uses the saved revision. Save or undo the draft first.');return start('ocr',{revision:saved.revision,pageIds:selected(),language:$('language').value});});
$('search-button').onclick=action(async()=>{if(!saved)return;const result=await api(`/documents/${saved.id}/text?revision=${saved.revision}`),term=$('search').value.toLowerCase();$('search-results').textContent=result.pages.filter(p=>p.text.toLowerCase().includes(term)).map(p=>`Page ${p.page+1}${p.truncated?' (truncated)':''}:\n${p.text}`).join('\n\n')||'No selectable-text match. OCR scanned pages explicitly.';});
$('open-history').onclick=action(()=>open(saved.id,Number($('history').value)));
$('restore').onclick=action(()=>{if(ops.length)throw new Error('Save or undo the draft first.');return start('revision',{baseRevision:saved.currentRevision,restoreRevision:Number($('history').value)});});
$('delete-document').onclick=action(async()=>{if(!saved||!confirm('Delete this document and all derivative history? Original source PDFs remain.'))return;await api('/documents/'+saved.id,{method:'DELETE'});saved=null;model=null;ops=[];$('pages').replaceChildren();await refresh();status('Document history deleted; original sources remain.');});
$('delete-source').onclick=action(async()=>{if(confirm('Delete this unused original PDF? Saved history references will refuse deletion.')){await api('/sources/'+$('sources').value,{method:'DELETE'});await refresh();}});
try{permissions=(await api('/permissions')).permissions;await refresh();const id=new URL(location.href).searchParams.get('document');if(id)await open(id);}catch(error){status(error.message);}controls();

function formDraft(){return [...$('forms').querySelectorAll('[data-field]:not(:disabled)')].filter(input=>input.value!==(model?.fields[input.dataset.field]??saved?.inspection.fields.find(f=>f.name===input.dataset.field)?.value)).map(input=>({op:'fill',name:input.dataset.field,value:input.value}));}
async function waitForJob(completion){
 if(!completion)return;let timeout;
 try{const result=await Promise.race([completion,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('The PDF save is still running. Your draft is kept; ask again after it finishes.')),90000);})]);
  if(result.job.state!=='ready')throw new Error(result.job.error??'The PDF save did not finish. Your draft is kept.');
  if(!result.adopted)throw new Error('The open PDF or its draft changed during the save. Your current work is kept; ask again from the document you want to edit.');
 }finally{clearTimeout(timeout);}
}
async function prepareDocumentHandoff(){
 document.activeElement?.blur?.();
 if(starting){await starting;await waitForJob(jobCompletion);}else if(job)await waitForJob(jobCompletion);
 if(!saved)return{app:'pdf-workbench',screen:'surface',surface:'pdf-workbench'};
 const id=saved.id,pendingFields=formDraft();
 const saveDraft=async()=>{if(!permissions.change)throw new Error('Your access does not allow saving this PDF draft.');await start('revision',{baseRevision:saved.currentRevision,operations:structuredClone(ops)});await waitForJob(jobCompletion);};
 for(const operation of pendingFields){if(ops.length>=64)await saveDraft();edit(operation);}
 if(ops.length)await saveDraft();
 if(saved?.id!==id||ops.length||formDraft().length)throw new Error('The current PDF draft could not be saved.');
 return{app:'pdf-workbench',screen:'surface',surface:'pdf-workbench',recordId:saved.id,title:saved.title,fields:{revision:saved.revision,readOnly:saved.revision!==saved.currentRevision,draft:false},selection:selected()};
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
 if(ops.length||formDraft().length)throw new Error('The concierge saved an update while you were editing. Your PDF draft is still here; choose the saved revision to review it.');
 await open(id,undefined,{result,selected:selected()});
}
void import('/shared/ui/js/document-handoff.js').then(({registerDocumentSession})=>registerDocumentSession({app:'pdf-workbench',prepare:async()=>{try{return await prepareDocumentHandoff();}catch(error){status(error.message);throw error;}},refresh:async(expected,completion)=>{try{await refreshDocumentHandoff(expected,completion);}catch(error){status(error.message);throw error;}}})).catch(error=>status('The concierge cannot synchronize this PDF: '+error.message));
