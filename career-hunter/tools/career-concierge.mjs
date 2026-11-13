/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use AI Office's shared assistant and native accounted ask path in Career, docked on desktop and full-width on phones; yield to the résumé document's own assistant.
 */
const APP='career-hunter';
/** Mount once; the shared component owns transport, approval cards, dictation, references and reply speech. */
export async function mountCareerConcierge(win=window){
 const doc=win.document,html=doc.documentElement;
 if(doc.querySelector('.cf-concierge')||(html.dataset.careerSurface==='resume-studio'||win.location.pathname.endsWith('/resume-studio')))return;
 const [{createEditorAssistant},{beginDocumentHandoff}]=await Promise.all([import('/shared/ui/js/editor-assistant.js'),import('/shared/ui/js/document-handoff.js')]);
 const host=doc.createElement('aside');host.className='cf-concierge';host.hidden=true;host.setAttribute('aria-label','Career concierge');
 let saved=null,handoff=null,edits=0,preparedEdits=0;
 const state=()=>({documentId:saved?.recordId??null,revision:saved?.fields?.revision,dirty:edits!==preparedEdits,busy:false});
 async function prepare(){
  const before=edits;handoff=await beginDocumentHandoff({app:APP,surface:win.location.pathname.split('/').pop()},{win});
  saved=handoff.context;preparedEdits=before;return saved;
 }
 function drafted(event){if(!host.contains(event.target)){edits++;assistant.refresh();}}
 const assistant=createEditorAssistant({app:APP,bot:'career-concierge',title:'Concierge',root:doc.body,win,
  getState:state,prepare,
  refresh:async()=>{await handoff?.refresh();await win.CareerFrame?.refresh();},
  prompts:[{label:'My résumé',prompt:'Is my resume loaded?'},{label:'Saved jobs',prompt:'How many jobs have I saved?'}]});
 host.append(assistant.element);doc.body.append(host);
 assistant.element.querySelector('.ef-assistant-help').textContent='Ask about your saved résumé, matches or applications.';
 let outer=null;
 try{if(win.parent!==win)outer=win.parent.document.documentElement;}catch{/* cross-origin host keeps its own controls */}
 function show(open){
  host.hidden=!open;html.dataset.careerConcierge=open?'open':'closed';
  doc.querySelectorAll('.cf-concierge-toggle').forEach(button=>button.setAttribute('aria-expanded',String(open)));
  if(outer)outer.setAttribute('data-ef-concierge',open?'open':'closed');
  if(open)assistant.element.querySelector('textarea').focus();else doc.querySelector('.cf-concierge-toggle')?.focus();
  win.dispatchEvent(new win.Event('resize'));
 }
 function click(event){if(event.target.closest('.cf-concierge-toggle'))show(host.hidden);}
 function hide(){show(false);}
 function key(event){if(event.key==='Escape'&&!host.hidden){event.stopPropagation();hide();}}
 doc.addEventListener('input',drafted);doc.addEventListener('click',click);host.addEventListener('editor-concierge:hide',hide);doc.addEventListener('keydown',key);
 show(false);
 win.addEventListener('pagehide',()=>{doc.removeEventListener('input',drafted);doc.removeEventListener('click',click);doc.removeEventListener('keydown',key);assistant.destroy();host.remove();delete html.dataset.careerConcierge;outer?.removeAttribute('data-ef-concierge');},{once:true});
}
