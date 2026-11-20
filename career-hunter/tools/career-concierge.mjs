/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use AI Office's shared assistant and native accounted ask path in Career, docked on desktop and full-width on phones; yield to the résumé document's own assistant.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: on the phone the résumé editor's concierge was "too bunched up to use", and Career's full-screen concierge "cant edit my resume"). This concierge is the one assistant on My résumé too (AI Office's editor opens there with its own off) and on the new Work history page, where it proposes each change as an approval card and the page shows the approved change with Undo. On a phone it fills the screen between Career's bars with a header "Back to <this page>" in place of the close cross, the way a phone app's back button names the screen it returns to; the conversation stays while the person edits and comes back with the Concierge button. The nested editor clears the one-assistant mark on Today, so the mark is kept while this concierge is mounted.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "i want one concierge for the entire app that can do everything that needs to be done in the app"). One assistant, one conversation, on every Career page. A page with no document of its own (Home, Find jobs, My jobs, Settings and the rest) now hands the concierge the same record My résumé and Work history do, the person's Career record, with the page's name and what is open on it, so the kernel keeps one conversation for all of them and the pane shows it on each page; before, each such page began a new conversation that knew nothing of the last. Before a turn on any page but My résumé (which does it itself), text typed in the Word document is saved into the main résumé, and after a turn or an approved card the document is brought up to date (CareerResumeOffice.settle), so what the concierge reads and what My résumé shows are the same thing. The page's context names the tools that page's work uses, which is what the kernel ranks a turn's tools by. An earlier message is shown as the person typed it, without the page details sent along with it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.68.8 (lane MARQUEE1): a Concierge press that came before the concierge mounted (career-frame.js keeps it as data-career-concierge="wanted") opens the concierge as soon as it mounts, instead of being lost; opening or closing clears the button's aria-busy.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.68.9 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window). My résumé no longer draws a résumé editor of its own for a job's tailored résumé; this concierge is that résumé's chat too. The page says which document it has open on <html data-career-record> (`master`, or the posting id of a job's tailored résumé) and the concierge follows it: the window opens that document's own conversation (doc:career-hunter:<posting id> for a tailored résumé, the conversation the kernel files its turns under), and the help line speaks of this job's résumé and cover letter. A page may open the concierge from its own control (openCareerConcierge: My résumé's Edit with AI on a phone), which mounts it first, with its stylesheet, where Career's frame did not; the focus goes back to that control when the concierge closes. One mount per page, however often it is asked for.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.68.17: propagate Intelligent Career's light/slate/teal frame skin (career-frame.css + data-career-frame="concierge") into the same-origin Jarvis concierge iframe whenever Career's frame is active, surviving theme updates and reloads.
 */
const APP='career-hunter';
const EDITING=['resume-studio','work-history'];
const OFFICE_SCRIPT='/api/career-hunter/static/career-resume-office.js';
const STYLESHEET='/api/career-hunter/static/career-concierge.css';
const FRAME_STYLESHEET='/api/career-hunter/static/career-frame.css';
const SKIN_ID='career-concierge-skin';
/** A job's tailored résumé is named by its posting id (the main résumé by `master`). */
const POSTING=/^[1-9]\d{0,14}$/;
/** The help line before a conversation starts: on a page, on an editing page, and on a job's tailored résumé. */
const HELP=Object.freeze({
 page:'Ask about anything in Career, or ask for a change: your jobs, applications, résumé, work history and settings. You approve each change here.',
 editing:'Ask for a change to your résumé or work history. You approve each change here, and Undo on the page puts it back.',
 tailored:'Ask for a change to this job\'s résumé or cover letter. You approve each change here; it is saved and its PDF made again.',
});
/** What the pane sends after a person's own words; an earlier message is shown without it. */
const SENT_ALONG=['\nCurrent saved document and selection: ','\nNo document is open in this application yet'];
/** The tools each page's work uses most, by the page's surface name; the concierge has every tool on every page. */
const PAGE_TOOLS=Object.freeze({
 home:'career_database career_jobs career_resume_read career_settings',
 'search-ui':'career_database career_job career_save career_job_update',
 'board-native':'career_jobs career_job career_job_update career_job_track career_draft career_documents',
 application:'career_job career_documents career_draft career_submission_review career_job_track career_interview',
 submissions:'career_submissions career_submission_sync career_submission_cancel career_submission_answers',
 interview:'career_interview career_interview_prepare career_interview_practice career_job',
 'recruiters-ui':'career_recruiters career_recruiter_add career_recruiter_update career_recruiter_remove',
 'insights-ui':'career_market career_database career_jobs',
 'strengthen-ui':'career_strengthen career_strengthen_answer career_resume_section career_resume_patch',
 'resume-studio':'career_resume_section career_resume_patch career_resume_read career_resume_undo',
 'work-history':'career_resume_section career_resume_patch career_resume_read career_resume_undo',
 'experience-library':'career_experience_bank career_experience_save',
 'master-record-ui':'career_master_record career_resume_section',
 'companies-admin':'career_companies career_company_add career_company_remove career_company_restore career_company_board career_targets',
 settings:'career_settings career_titles_set career_area_set career_remote_only_set career_preparation career_digest career_targets career_target_add',
});
/** What a person asks for from any page: their résumé and work history, their matches and their jobs. */
const ALWAYS_TOOLS='career_resume_read career_resume_section career_resume_patch career_database career_jobs';
/** The page's name as Career's bar shows it (the current page of its section, else the current section), else its title. */
function pageName(doc){
 const current=doc.querySelector('.cf-subnav a[aria-current="page"]')||doc.querySelector('.cf-topbar nav a[aria-current="page"]');
 return((current&&current.textContent)||doc.title||'').trim()||'the page';
}
function backButton(doc,show){
 const back=doc.createElement('button');back.type='button';back.className='cf-concierge-back';
 back.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
 back.addEventListener('click',()=>show(false));
 return back;
}
/** Named when the pane opens, after Career's bar has drawn where the person is. */
function nameBack(doc,back){const label='Back to '+pageName(doc);back.lastChild.textContent=label;back.setAttribute('aria-label',label);}
/** Today's one-assistant mark: the nested editor's own sync removes it, so put it back while this concierge is mounted. */
function keepMark(win,outer,host){
 if(!outer||typeof win.MutationObserver!=='function')return()=>{};
 const observer=new win.MutationObserver(()=>{if(!outer.hasAttribute('data-ef-concierge'))outer.setAttribute('data-ef-concierge',host.hidden?'closed':'open');});
 observer.observe(outer,{attributes:true,attributeFilter:['data-ef-concierge']});
 return()=>observer.disconnect();
}
/**
 * @description The page's surface name: the one the page declares, else the last part of its address.
 * @param {Window} win The page. @returns {string} For example `work-history`, `board-native`, `settings`.
 */
export function surfaceOf(win){
 return win.document.documentElement.dataset.careerSurface||win.location.pathname.split('/').pop()||'home';
}
/**
 * @description What a page with no document of its own hands the concierge: the person's Career record (the same
 * record My résumé and Work history hand over, so every page shares one conversation), the page's name, the job open on
 * it when its address names one, and the tools that page's work uses.
 * The fields keep `draft`, as every Career document's context does: the native kernel narrows a Career turn to
 * read-only by the words of its message (crates/api/src/bot_turns.rs implicit_career_read), the pane sends this context
 * along as part of the message, and that word is what leaves the turn able to hold an approval card.
 * @param {Window} win The page. @returns {object} The context, shaped as a registered document's.
 */
export function pageContext(win){
 const surface=surfaceOf(win),query=new URLSearchParams(win.location.search),job=query.get('postingId')||query.get('id')||'';
 return{app:APP,screen:'surface',surface,recordId:'master',title:pageName(win.document).slice(0,200),
  fields:{readOnly:false,draft:false,page:pageName(win.document).slice(0,120),...(/^[1-9]\d{0,14}$/.test(job)?{job}:{}),
   ...(PAGE_TOOLS[surface]?{tools:PAGE_TOOLS[surface]}:{}),always:ALWAYS_TOOLS,
   everywhere:'The same concierge answers on every Career page and can read or change anything in Career from here.'}};
}
/** Load Career's Word-document keeper on a page that does not carry it; a page without AI Office simply has none. */
function officeKeeper(win){
 if(win.CareerResumeOffice)return Promise.resolve(win.CareerResumeOffice);
 win.__careerOfficeKeeper??=new Promise(resolve=>{
  const script=win.document.createElement('script');script.src=OFFICE_SCRIPT;
  script.onload=()=>resolve(win.CareerResumeOffice||null);script.onerror=()=>resolve(null);win.document.head.append(script);
 });
 return win.__careerOfficeKeeper;
}
/**
 * @description Bring the Word document on My résumé and the main résumé together from whatever page is open.
 * @param {Window} win The page. @param {boolean} save Save text typed in the document into the main résumé first.
 * @returns {Promise<object|null>} What CareerResumeOffice.settle answered, or null where it is not available.
 */
export async function settleDocument(win,save){
 try{const keeper=await officeKeeper(win);return keeper?await keeper.settle({save}):null;}catch{return null;}
}
/** Show an earlier message as the person typed it: the page details the pane sent along are not their words. */
function tidyEarlier(win,log){
 if(typeof win.MutationObserver!=='function')return()=>{};
 const tidy=node=>{
  for(const said of node.querySelectorAll?.('.ef-assistant-user p')??[]){
   const cut=Math.min(...SENT_ALONG.map(mark=>said.textContent.indexOf(mark)).filter(at=>at>=0));
   if(Number.isFinite(cut))said.textContent=said.textContent.slice(0,cut);
  }
 };
 const observer=new win.MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(added=>{if(added.nodeType===1)tidy(added.parentNode);})));
 observer.observe(log,{childList:true});
 return()=>observer.disconnect();
}
/** Apply Intelligent Career's skin into the same-origin concierge iframe whenever Career's frame is active. */
function applyCareerSkin(win,frame){
 if(!frame)return{sync(){},stop(){}};
 let guard=null;
 const sync=()=>{
  if(!win.document.documentElement.hasAttribute('data-career-frame'))return;
  try{
   const fdoc=frame.contentDocument;
   if(!fdoc||!fdoc.documentElement||fdoc.URL==='about:blank')return;
   const root=fdoc.documentElement;
   if(root.getAttribute('data-career-frame')!=='concierge')root.setAttribute('data-career-frame','concierge');
   if(fdoc.head&&!fdoc.getElementById(SKIN_ID)){
    const link=fdoc.createElement('link');link.id=SKIN_ID;link.rel='stylesheet';link.href=FRAME_STYLESHEET;fdoc.head.append(link);
   }
   guard?.disconnect();
   if(typeof win.MutationObserver==='function'){
    guard=new win.MutationObserver(()=>{if(root.getAttribute('data-career-frame')!=='concierge')root.setAttribute('data-career-frame','concierge');});
    guard.observe(root,{attributes:true,attributeFilter:['data-theme','data-career-frame']});
   }
  }catch{/* cross-origin or unloading frame */}
 };
 const onMsg=event=>{if(event.origin===win.location.origin&&event.source===frame.contentWindow&&event.data?.type==='oshal-orb')sync();};
 frame.addEventListener('load',sync);win.addEventListener('message',onMsg);sync();
 return{sync,stop(){frame.removeEventListener('load',sync);win.removeEventListener('message',onMsg);guard?.disconnect();}};
}
const panes=new WeakMap();
/**
 * @description Mount Career's concierge on a page once, however often it is asked for (Career's frame on every Career
 * page, and a page's own control where the frame did not); the shared component owns transport, approval cards,
 * dictation, references and reply speech.
 * @param {Window} [win] The page.
 * @returns {Promise<{open:Function}|undefined>} The concierge, or nothing when another copy of this module mounted one.
 */
export function mountCareerConcierge(win=window){
 // A mount that failed (the shared assistant could not load) is not kept, so the next press tries again.
 if(!panes.has(win))panes.set(win,mount(win).catch(failure=>{panes.delete(win);throw failure;}));
 return panes.get(win);
}
/**
 * @description Open Career's concierge from a page's own control (My résumé's Edit with AI on a phone), mounting it
 * first where Career's frame did not. The focus goes back to that control when the concierge closes.
 * @param {Window} [win] The page. @param {HTMLElement|null} [from] The control the person pressed.
 * @returns {Promise<boolean>} Whether the concierge opened.
 */
export async function openCareerConcierge(win=window,from=null){
 const pane=await mountCareerConcierge(win);
 if(!pane)return false;
 pane.open(from);return true;
}
async function mount(win){
 const doc=win.document,html=doc.documentElement,surface=surfaceOf(win),editing=EDITING.includes(html.dataset.careerSurface);
 if(doc.querySelector('.cf-concierge'))return undefined;
 if(!doc.querySelector(`link[href="${STYLESHEET}"]`)){const sheet=doc.createElement('link');sheet.rel='stylesheet';sheet.href=STYLESHEET;doc.head.append(sheet);}
 const [{createEditorAssistant},{beginDocumentHandoff}]=await Promise.all([import('/shared/ui/js/editor-assistant.js'),import('/shared/ui/js/document-handoff.js')]);
 const host=doc.createElement('aside');host.className='cf-concierge';host.hidden=true;host.setAttribute('aria-label','Career concierge');
 let saved=null,handoff=null,edits=0,preparedEdits=0,opener=null;
 /** The document the page says it has open (My résumé: `master` or a job's posting id), else ''. */
 const declared=()=>html.dataset.careerRecord||'';
 // The person's Career record is the document on every page, so the pane shows the one conversation as soon as it mounts;
 // a page that has its own document open (a job's tailored résumé) is in that document's conversation.
 const state=()=>({documentId:declared()||saved?.recordId||'master',revision:saved?.fields?.revision,dirty:edits!==preparedEdits,busy:false});
 async function prepare(){
  const before=edits;
  // My résumé saves its own open document; on every other page, what was typed there reaches the main résumé first.
  if(surface!=='resume-studio')await settleDocument(win,true);
  handoff=await beginDocumentHandoff({app:APP,surface},{win});
  saved=handoff.context?.recordId?handoff.context:pageContext(win);preparedEdits=before;return saved;
 }
 function drafted(event){if(!host.contains(event.target)){edits++;assistant.refresh();}}
 const assistant=createEditorAssistant({app:APP,bot:'career-concierge',title:'Concierge',root:doc.body,win,
  getState:state,prepare,
  refresh:async()=>{await handoff?.refresh();await win.CareerFrame?.refresh();if(!EDITING.includes(surface))await settleDocument(win,false);},
  prompts:editing?[{label:'Change a date',prompt:'I want to change the start or end month of one of my jobs.'},{label:'Improve a bullet',prompt:'Suggest a stronger first bullet for my most recent job.'}]
   :[{label:'My résumé',prompt:'Is my resume loaded?'},{label:'Saved jobs',prompt:'How many jobs have I saved?'}]});
 host.append(assistant.element);doc.body.append(host);
 const skin=applyCareerSkin(win,assistant.element.querySelector('iframe.jarvis-chat-frame'));
 const help=assistant.element.querySelector('.ef-assistant-help');
 /** The help line for the document the page has open; the shared pane hands a changed line to the window. */
 function word(){help.textContent=POSTING.test(declared())?HELP.tailored:editing?HELP.editing:HELP.page;}
 word();
 const releaseTidy=tidyEarlier(win,assistant.element.querySelector('.ef-assistant-log'));
 let outer=null;
 try{if(win.parent!==win)outer=win.parent.document.documentElement;}catch{/* cross-origin host keeps its own controls */}
 function show(open){
  host.hidden=!open;html.dataset.careerConcierge=open?'open':'closed';
  doc.querySelectorAll('.cf-concierge-toggle').forEach(button=>{button.setAttribute('aria-expanded',String(open));button.removeAttribute('aria-busy');});
  opener?.setAttribute('aria-expanded',String(open));
  if(outer)outer.setAttribute('data-ef-concierge',open?'open':'closed');
  if(open){skin.sync();nameBack(doc,back);assistant.element.querySelector('textarea').focus();}
  else{const from=opener;opener=null;(from?.isConnected&&from.getClientRects().length?from:doc.querySelector('.cf-concierge-toggle'))?.focus();}
  win.dispatchEvent(new win.Event('resize'));
 }
 const back=backButton(doc,show);assistant.element.querySelector('.ef-assistant-header')?.prepend(back);nameBack(doc,back);
 function click(event){if(event.target.closest('.cf-concierge-toggle')){opener=null;show(host.hidden);}}
 function hide(){show(false);}
 function key(event){if(event.key==='Escape'&&!host.hidden){event.stopPropagation();hide();}}
 // An approved card on a page with no document of its own: the Word document follows the main résumé it changed.
 function approved(event){if(event.detail?.app===APP&&!EDITING.includes(surface))void settleDocument(win,false);}
 doc.addEventListener('input',drafted);doc.addEventListener('click',click);host.addEventListener('editor-concierge:hide',hide);doc.addEventListener('keydown',key);
 win.addEventListener('oshal-package-tool-done',approved);
 // The page opened another document: the window opens that document's conversation and the help line speaks of it.
 const follow=typeof win.MutationObserver==='function'?new win.MutationObserver(()=>{assistant.refresh();word();}):null;
 follow?.observe(html,{attributes:true,attributeFilter:['data-career-record']});
 const release=keepMark(win,outer,host);
 // A press that came while this module was on its way (career-frame.js) opens the concierge now.
 show(html.dataset.careerConcierge==='wanted');assistant.refresh();
 win.addEventListener('pagehide',()=>{skin.stop();release();releaseTidy();follow?.disconnect();panes.delete(win);doc.removeEventListener('input',drafted);doc.removeEventListener('click',click);doc.removeEventListener('keydown',key);win.removeEventListener('oshal-package-tool-done',approved);assistant.destroy();host.remove();delete html.dataset.careerConcierge;outer?.removeAttribute('data-ef-concierge');},{once:true});
 return{open(from){opener=from||null;show(true);}};
}
