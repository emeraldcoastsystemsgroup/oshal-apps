/** AI Office to the oshal design standard: the app row, the phone's bottom bar, the desktop's docked panes, menus and
 * sheets, your documents, the selection bar and collaboration surfaces.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.19.0, the oshal design standard (docs/ux/design-standard.md §3.1, §3.3, §4.3, §4.4, §4.10, §5.1; Google Docs, Word and ONLYOFFICE, REFP CONVENTIONS §5.1). One app row: Back to your documents, the document's name with its menu (New, Open, Rename, Duplicate, Export, Delete), Undo, Redo, Save while there is something to save and Export as the one primary once there is content; an existing document on a phone opens to read with one Edit. The phone's bottom bar is Format, Insert, Comment, Concierge and More (Slides or Sheets first for a deck or a workbook); each opens an opaque sheet with Done that the phone's Back closes. On a desktop Slides sit in a 240px left pane and Format and Concierge are tabs of one docked 320px right pane, so the canvas is never covered and Zoom Fit refits when a pane changes. With documents saved, the first screen is your documents, newest first, with one New at the bottom right. A selection raises a bar at the selection: Cut, Copy, Paste, Comment and More. Every confirm is in the page.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.19.0, any platform: the shared planned-control helper is optional (fallbackPlanned builds the same markup and inert press), so the editor still starts where /shared/ui/js/planned-control.js is not served, as on the store gate's pinned platform.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..07): replace all seven AI Office planned controls with working Highlight, Comment, Suggest changes, Find and replace, PDF and plain-text export, Mobile view, and Share controls while retaining RP-ALL-01 Summarize.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 2.20.4: hostedAssistant() reads ?assistant=host, which a host page that frames this editor and owns the screen's one assistant passes (Career's My résumé, career-hunter 1.61.0, where Career's concierge edits the résumé). Then the side pane has only Format, the phone's bottom bar has no Concierge, and Generate a draft is not offered, because there is no AI Office concierge on that screen to answer them. Without the option nothing changes.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 2.20.2 (RP-ALL-01): remove duplicate greyed Summarize planned control from the AI Office Concierge prompt strip because the kernel editor-assistant already renders live Summarize and Suggest improvements prompt chips.
 */
import{clone,uid,plain}from'./model.mjs';
/** @description Whether the page that frames this editor owns the screen's one assistant (?assistant=host). @returns {boolean} */
export const hostedAssistant=()=>new URLSearchParams(location.search).get('assistant')==='host';
import{state,notify,status,dirty,pristine,editable,currentPage,currentItem,edit,api}from'./state.mjs';
import{guard,openDocument,newDocument,refreshDocuments,mayReplace}from'./files.mjs';
import{fit,invalidate}from'./render.mjs';
import{formatName,openGenerationAssistant}from'./entry-actions.mjs';
import{openCommentsSheet,openSuggestChangesSheet,openShareSheet}from'./collab-ui.mjs';
import{openFindAndReplace}from'./find-ui.mjs';

const $=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const wide=()=>!matchMedia('(max-width:800px)').matches;
const ICONS={format:'M5 19h14M8 15l4-10 4 10M9.5 11h5',insert:'M12 5v14M5 12h14',comment:'M4 5h16v11H10l-6 4z',concierge:'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',more:'M5 12h.01M12 12h.01M19 12h.01',slides:'M4 6h16v12H4z',sheets:'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','22');svg.setAttribute('height','22');svg.setAttribute('aria-hidden','true');path.setAttribute('d',ICONS[name]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width',name==='more'?'3':'1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;}

export function createLayers(doc){
 const win=doc.defaultView,stack=[];let ignore=0;
 win.addEventListener('popstate',()=>{if(ignore>0){ignore-=1;return;}const top=stack.at(-1);if(top)void close(top.dialog,{history:false});});
 function create(title,className){
  const dialog=make('dialog','ds-layer '+className),head=make('header','ds-layer-head'),heading=make('h2','ds-layer-title',title),done=make('button','ds-layer-done','Done'),body=make('div','ds-layer-body');
  dialog.dataset.dsSheet='';dialog.setAttribute('aria-label',title);done.type='button';head.append(heading,done);dialog.append(head,body);
  done.addEventListener('click',()=>void close(dialog));dialog.addEventListener('cancel',event=>{event.preventDefault();void close(dialog);});
  dialog.addEventListener('click',event=>{if(event.target===dialog)void close(dialog);});doc.body.append(dialog);
  return{dialog,body,heading};
 }
 function open(layer,{nodes=[],anchor=null,onClose=null}={}){
  const restore=nodes.filter(Boolean).map(node=>{const mark=doc.createComment('layer');node.before(mark);const hidden=node.hidden;node.hidden=false;layer.body.append(node);return()=>{node.hidden=hidden;mark.replaceWith(node);};});
  stack.push({dialog:layer.dialog,restore,onClose});layer.dialog.showModal();
  if(anchor&&wide()){const box=anchor.getBoundingClientRect(),width=Math.max(240,layer.dialog.offsetWidth);layer.dialog.classList.add('ds-anchored');layer.dialog.style.left=Math.max(8,Math.min(box.right-width,win.innerWidth-width-8))+'px';layer.dialog.style.top=Math.min(box.bottom+4,Math.max(8,win.innerHeight-layer.dialog.offsetHeight-8))+'px';}
  try{win.history.pushState({...(win.history.state||{}),officeLayer:stack.length},'');}catch{/* embedded */}
  return layer;
 }
 async function close(dialog,{history=true}={}){
  const index=stack.findIndex(entry=>entry.dialog===dialog);if(index<0)return;const[entry]=stack.splice(index,1);
  try{entry.onClose?.();}catch(error){status(error.message,true);}
  for(const undo of entry.restore.reverse())undo();dialog.close();dialog.remove();
  if(history){
   const address=win.location.href;ignore+=1;
   await new Promise(resolve=>{let fired=false;const done=()=>{if(fired)return;fired=true;win.removeEventListener('popstate',done);resolve();};win.addEventListener('popstate',done);try{win.history.back();}catch{done();}setTimeout(()=>{if(!fired&&ignore>0)ignore-=1;done();},600);});
   try{if(win.location.href!==address)win.history.replaceState(win.history.state,'',address);}catch{/* embedded */}
  }
  notify();
 }
 return{create,open,close,closeAll:async()=>{while(stack.length)await close(stack.at(-1).dialog);},top:()=>stack.at(-1)?.dialog??null};
}

function buildMenuList(items,planned,runRow){
 const list=make('div','ds-menu-list');list.setAttribute('role','menu');
 for(const item of items){
  if(item==='-'){list.append(make('hr','ds-menu-sep'));continue;}
  if(item.planned){list.append(planned(item.planned,item.label,{variant:'menu',className:'ds-menu-row'}));continue;}
  const entry=make('button','ds-menu-row'+(item.danger?' ds-danger':''),item.label);
  entry.type='button';entry.disabled=Boolean(item.disabled);entry.setAttribute('role','menuitem');
  if(item.id)entry.dataset.officeMenu=item.id;
  entry.onclick=runRow(item);list.append(entry);
 }
 return list;
}

function bindHomeAndHeader({root,layers,act,menu,sheet}){
 const click=id=>()=>{const node=$(id);if(node.disabled)throw new Error('That action is not available right now.');node.click();};
 const inertNode=id=>$(id)?.disabled;
 const setView=view=>{root.dataset.officeView=view;document.documentElement.dataset.officeView=view;$('office-home').hidden=view!=='home';$('document-canvas').hidden=view==='home';};
 const focusFirstLine=()=>requestAnimationFrame(()=>{if(root.dataset.officeView!=='document'||!editable())return;$('document-canvas').querySelector('.office-word-page [contenteditable=true]')?.focus({preventScroll:true});});
 const newMenu=anchor=>menu('New',[{label:'Blank document',id:'new-docx',run:()=>startNew('docx')},{label:'Presentation',id:'new-pptx',run:()=>startNew('pptx')},{label:'Spreadsheet',id:'new-xlsx',run:()=>startNew('xlsx')}],anchor);
 async function startNew(kind){if(!await newDocument(kind))return;state.reading=false;setView('document');invalidate();notify();if(kind==='docx')focusFirstLine();}
 function paintHome(){
  const list=$('office-home-list'),rows=state.documents??[];
  list.replaceChildren(...rows.map(row=>{
   const card=make('button','office-doc-card'),paper=make('span','office-doc-paper office-doc-'+row.kind),title=make('span','office-doc-title',row.title||'Untitled');
   const prefix=row.shared?`Shared by ${row.ownerSub} (${row.accessRole}) · `:'';
   const meta=make('span','office-doc-meta',prefix+formatName(row.kind)+' · '+new Date(row.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}));
   card.type='button';card.dataset.documentId=row.id;paper.setAttribute('aria-hidden','true');paper.textContent=row.kind==='pptx'?'P':row.kind==='xlsx'?'X':'W';
   card.append(paper,title,meta);card.onclick=act(()=>openExisting(row.id));return card;
  }));
  if(!rows.length)list.append(make('p','office-home-empty','No documents yet.'));
 }
 async function showHome(){await layers.closeAll();await refreshDocuments();paintHome();setView('home');const url=new URL(location.href);url.searchParams.delete('document');url.searchParams.delete('kind');try{window.history.replaceState(window.history.state,'',url);}catch{}notify();$('office-home-new').focus({preventScroll:true});}
 async function openExisting(id){await openDocument(id);if(state.id!==id)return;state.reading=!wide();setView('document');invalidate();notify();}
 function renameSheet(){
  const input=$('document-title'),label=make('label','office-field','Name');label.append(input);input.hidden=false;
  const done=()=>{if(input.value!==state.model.title&&state.pendingSettings.has('document-title'))input.dispatchEvent(new Event('change'));};
  const layer=sheet('Rename',[],[label],{onClose:()=>{done();$('office-commands').prepend(input);}});
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void layers.close(layer.dialog);}};
  requestAnimationFrame(()=>{input.focus();input.select();});return layer;
 }
 function exportSheet(){
  const rows=make('div','office-export-rows'),row=(name,id)=>{const line=make('div','office-export-row'),btn=make('button','','Download');btn.type='button';btn.disabled=inertNode(id);btn.onclick=act(async()=>{await layers.closeAll();$(id).click();});line.append(make('span','office-export-name',name),btn);return line;};
  rows.append(row(formatName(state.model.kind)+' file (.'+state.model.kind+')','export-document'),row('PDF (.pdf)','export-pdf'),row('Plain text (.txt)','export-txt'),row('Editable project (.json)','export-json'));
  if(state.original)rows.append(row('Original import','download-original'));
  return sheet('Export',[],[rows]);
 }
 function documentMenu(anchor){
  const layer=menu(state.model.title||'Untitled',[{label:'New…',id:'new',run:()=>newMenu(anchor)},{label:'Open…',id:'open',run:()=>showHome()},{label:'Open a file…',id:'open-file',run:click('open-file'),disabled:inertNode('open-file')},'-',{label:'Rename…',id:'rename',run:()=>renameSheet(),disabled:!editable()},{label:'Duplicate',id:'duplicate',run:click('save-copy'),disabled:inertNode('save-copy')},{label:'Export…',id:'export',run:()=>exportSheet()},{label:'Version history…',id:'history',run:()=>sheet('Version history',[$('office-revisions')]),disabled:!state.id},'-',{label:'Delete',id:'delete',danger:true,run:click('delete-document'),disabled:inertNode('delete-document')}],anchor);
  layer.heading.title=state.model.title;return layer;
 }
 $('office-back').onclick=act(async()=>{if(!await mayReplace())return;state.foundation?.discardPending();await showHome();});
 $('document-name').onclick=act(()=>documentMenu($('document-name')));
 $('office-export').onclick=act(()=>exportSheet());
 $('office-edit').onclick=act(()=>{state.reading=false;invalidate();notify();focusFirstLine();});
 $('office-home-new').onclick=act(()=>newMenu($('office-home-new')));
 return{click,inertNode,setView,showHome,openExisting,focusFirstLine,paintHome};
}

function bindPanesAndFormat({root,foundation,layers,act,planned,sheet}){
 let pane='format',lastShellOwns=false,formatTab='text';
 const tabs=make('div','office-pane-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Side pane');
 function syncPane(){
  const open=root.dataset.editorConcierge==='open';pane=open?'concierge':'format';root.dataset.officePane=pane;
  const shellBtn=root.querySelector('.ef-panes [aria-controls$="-concierge"]');if(!open)lastShellOwns=Boolean(shellBtn?.hidden);
  for(const tab of tabs.querySelectorAll('[role=tab]')){const on=tab.dataset.pane===pane;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;}
  const own=tabs.querySelector('[data-pane=concierge]');if(own)own.hidden=lastShellOwns&&!open;
 }
 function showPane(next){
  if(next==='concierge')foundation.showPanel('ai');
  else if(root.dataset.editorConcierge==='open')root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
  pane=next;syncPane();requestAnimationFrame(fit);
 }
 for(const[key,label]of hostedAssistant()?[['format','Format']]:[['format','Format'],['concierge','Concierge']]){const tab=make('button','office-pane-tab',label);tab.type='button';tab.dataset.pane=key;tab.setAttribute('role','tab');tab.onclick=()=>showPane(key);tabs.append(tab);}
 root.querySelector('.ef-body').append(tabs);
 const conciergeSheet=()=>sheet('Concierge',[$('office-ai')],[],{});
 async function generate(){
  if(wide())showPane('concierge');else if(!layers.top()?.querySelector('#office-ai'))await conciergeSheet();
  openGenerationAssistant({foundation:{showPanel(){}},element:$('office-ai'),model:state.model});
 }
 const prompts=make('div','office-prompts'),draft=make('button','office-chip','Generate a draft');draft.type='button';draft.onclick=act(()=>generate());
 prompts.append(draft);
 $('office-ai')?.querySelector('.ef-assistant-composer')?.before(prompts);
 new MutationObserver(()=>{syncPane();requestAnimationFrame(fit);}).observe(root,{attributes:true,attributeFilter:['data-editor-concierge']});
 const formatTabs=make('div','office-format-tabs');formatTabs.setAttribute('role','tablist');formatTabs.setAttribute('aria-label','Format');
 const properties=root.querySelector('.ef-properties');properties.prepend(formatTabs);
 function applyFormatTab(){
  const groups=[...properties.querySelectorAll('.ef-property-group')],named=g=>g.querySelector(':scope>legend')?.textContent??'',para=groups.filter(g=>named(g)==='Paragraph');
  formatTabs.hidden=!para.length||groups.length<2;if(formatTabs.hidden)formatTab='text';
  for(const g of groups)g.hidden=!formatTabs.hidden&&(formatTab==='paragraph')!==(named(g)==='Paragraph');
  for(const tab of formatTabs.children){const on=tab.dataset.formatTab===formatTab;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;}
  root.toggleAttribute('data-office-selected',groups.length>0);
 }
 for(const[key,label]of [['text','Text'],['paragraph','Paragraph']]){const tab=make('button','office-format-tab',label);tab.type='button';tab.dataset.formatTab=key;tab.setAttribute('role','tab');tab.onclick=()=>{formatTab=key;applyFormatTab();};formatTabs.append(tab);}
 new MutationObserver(()=>applyFormatTab()).observe(properties,{childList:true,subtree:true});
 const formatSheet=()=>{const layer=sheet('Format',[root.querySelector('.ef-inspector')],[],{half:true});applyFormatTab();return layer;};
 return{showPane,syncPane,applyFormatTab,generate,formatSheet,conciergeSheet};
}

function bindSelectionAndCanvas({root,layers,act,menu,duplicate,arrange,removeItem}){
 let objectClipboard=null;
 const selectionBar=make('div','office-selection-bar');selectionBar.setAttribute('popover','manual');selectionBar.setAttribute('role','toolbar');selectionBar.setAttribute('aria-label','Selection');document.body.append(selectionBar);
 const selButton=(label,run)=>{const btn=make('button','office-sel',label);btn.type='button';for(const t of ['pointerdown','mousedown'])btn.addEventListener(t,e=>e.preventDefault());btn.onclick=act(run);return btn;};
 const hasTextRange=()=>Boolean(state.range&&state.range.start!==state.range.end);
 async function cut(){if(hasTextRange()){if(!document.execCommand('cut'))throw new Error('Cut was refused here. Use your keyboard to cut.');return;}objectClipboard=clone(currentItem());await removeItem();}
 async function copy(){if(hasTextRange()){if(!document.execCommand('copy'))throw new Error('Copy was refused here. Use your keyboard to copy.');status('Copied');return;}objectClipboard=clone(currentItem());status('Copied');}
 async function paste(){
  if(!hasTextRange()&&objectClipboard&&state.model.kind==='pptx'){const next={...clone(objectClipboard),id:uid(),x:objectClipboard.x+18,y:objectClipboard.y+18};edit([{op:'add-object',page:currentPage().id,object:next}]);state.selected=next.id;notify();return;}
  let clip;try{clip=await navigator.clipboard.readText();}catch{throw new Error('This browser blocked reading the clipboard. Use your keyboard to paste.');}
  if(!document.execCommand('insertText',false,clip))throw new Error('Paste needs the caret in the text. Tap the text, then paste.');
 }
 selectionBar.append(selButton('Cut',cut),selButton('Copy',copy),selButton('Paste',paste),selButton('Comment',()=>openCommentsSheet(layers,act)),selButton('⋯',()=>menu('Selection',[{label:'Duplicate',run:()=>duplicate()},...(state.model.kind==='pptx'?[{label:'Bring forward',run:()=>arrange(1)},{label:'Send backward',run:()=>arrange(-1)}]:[]),'-',{label:'Delete',danger:true,run:()=>removeItem()}],selectionBar)));
 selectionBar.lastElementChild.setAttribute('aria-label','More for the selection');
 function placeSelectionBar(){
  const item=currentItem(),show=root.dataset.officeView==='document'&&editable()&&state.model.kind!=='xlsx'&&!layers.top()&&(hasTextRange()||(item&&(state.model.kind==='pptx'||item.type!=='paragraph')));
  if(!show){if(selectionBar.matches(':popover-open'))selectionBar.hidePopover();return;}
  let box=null;if(hasTextRange()){const sel=document.getSelection();if(sel?.rangeCount)box=sel.getRangeAt(0).getBoundingClientRect();}
  if(!box||!box.width)box=$('document-canvas').querySelector('[data-object="'+CSS.escape(state.selected)+'"]')?.getBoundingClientRect();
  if(!box){if(selectionBar.matches(':popover-open'))selectionBar.hidePopover();return;}
  if(!selectionBar.matches(':popover-open'))selectionBar.showPopover();
  const gap=hasTextRange()?8:40,h=selectionBar.offsetHeight,w=selectionBar.offsetWidth,above=box.top-h-gap,top=above>=8?above:Math.min(box.bottom+gap,innerHeight-h-8);
  selectionBar.style.top=Math.round(top)+'px';selectionBar.style.left=Math.round(Math.max(8,Math.min(box.left+box.width/2-w/2,innerWidth-w-8)))+'px';
 }
 $('document-canvas').addEventListener('click',event=>{
  const pin=event.target.closest?.('.office-comment-pin[data-comment-id]');
  if(pin){event.stopPropagation();openCommentsSheet(layers,act,{focusCommentId:pin.dataset.commentId});return;}
  if(state.model.kind!=='docx'||!editable()||root.dataset.officeView!=='document')return;
  const page=event.target.closest('.office-word-page');if(event.target!==$('document-canvas')&&event.target!==page)return;
  const line=[...$('document-canvas').querySelectorAll('.office-word-page [contenteditable=true]')].at(-1);if(!line)return;
  line.focus({preventScroll:true});const r=document.createRange();r.selectNodeContents(line);r.collapse(false);const sel=document.getSelection();sel.removeAllRanges();sel.addRange(r);
 });
 document.addEventListener('selectionchange',()=>requestAnimationFrame(placeSelectionBar));
 $('document-canvas').addEventListener('scroll',()=>requestAnimationFrame(placeSelectionBar),{passive:true});
 return{placeSelectionBar};
}

function bindToolbarsAndMenus({layers,act,planned,menu,sheet,click,inertNode,insert,generate,formatSheet,conciergeSheet}){
 const pageSetupSheet=()=>{const sp=state.model.kind==='xlsx';return sheet(sp?'Sheet setup':'Page setup',[$(sp?'sheet-settings':'page-settings')]);};
 const pagesSheet=()=>{const layer=sheet(state.model.kind==='xlsx'?'Sheets':'Slides',[$('office-navigation')]);layer.body.addEventListener('click',e=>{if(e.target.closest('#page-list button'))setTimeout(()=>void layers.close(layer.dialog),0);});return layer;};
 const helpSheet=()=>sheet('Help',[],[make('p','office-help',$('canvas-help').textContent),make('p','office-help','Ctrl+Z undoes · Ctrl+Y redoes · Ctrl+S saves · Delete removes the selected object. Exports are native, editable Office files.')]);
 const insertItems=()=>{
  const kind=state.model.kind,item=(label,id)=>({label,id,run:click(id),disabled:inertNode(id)}),add=(label,type)=>({label,id:'insert-'+type,run:()=>insert(type),disabled:document.querySelector('[data-insert="'+type+'"]')?.disabled});
  const list=kind==='pptx'?[add('Text box','text'),add('Image','image'),add('Table','table'),add('Rectangle','rect'),add('Ellipse','ellipse'),'-',item('New slide','add-page')]:kind==='docx'?[item('Paragraph','add-paragraph'),add('Table','table'),add('Image','image'),'-',item('New page','add-page')]:[item('Row','add-row'),item('Column','add-column'),item('Sheet','add-page')];
  return hostedAssistant()?list:[...list,'-',{label:'Generate a draft…',id:'generate',run:()=>generate(),disabled:inertNode('generate-document')}];
 };
 function moreItems(){
  const items=[{label:'Page setup…',id:'page-setup',run:()=>pageSetupSheet()},{label:'Print…',id:'print',run:()=>window.print()}];
  if(state.model.kind!=='xlsx')items.push({label:'Objects…',id:'objects',run:()=>{const layer=sheet('Objects',[$('object-list')]);layer.body.addEventListener('click',e=>{if(e.target.closest('[data-select-object]'))setTimeout(()=>void layers.close(layer.dialog),0);});return layer;}});
  if(state.permissions.legacyAccess)items.push({label:'Previous generated files…',id:'previous',run:()=>sheet('Previous generated files',[$('office-previous-files')])});
  items.push({label:'Help',id:'help',run:()=>helpSheet()},'-',{label:'Find and replace…',id:'find-replace',disabled:state.model.kind==='xlsx',run:()=>openFindAndReplace(layers,act)},{label:state.suggesting?'Suggest changes (On)…':'Suggest changes…',id:'suggest-changes',disabled:state.model.kind!=='docx',run:()=>openSuggestChangesSheet(layers,act)},{label:state.mobileView?'Mobile view: On':'Mobile view',id:'mobile-view',disabled:state.model.kind!=='docx',run:()=>{state.mobileView=!state.mobileView;fit();notify();}},{label:'Share…',id:'share',run:()=>openShareSheet(layers,act)});
  return items;
 }
 $('office-page-menu').onclick=act(()=>{const noun=state.model.kind==='xlsx'?'sheet':state.model.kind==='docx'?'page':'slide';return menu('Page actions',[{label:'Move earlier',run:click('move-page-up'),disabled:inertNode('move-page-up')},{label:'Move later',run:click('move-page-down'),disabled:inertNode('move-page-down')},'-',{label:'Remove '+noun,danger:true,run:click('remove-page'),disabled:inertNode('remove-page')}],$('office-page-menu'));});
 $('open-page-setup').onclick=act(()=>pageSetupSheet());
 const bar=make('nav','office-bottom-bar');bar.setAttribute('aria-label','Document tools');bar.dataset.efFloating='';document.body.append(bar);let barKind=null;
 const barItem=(label,name,run)=>{const btn=make('button','office-bar-item');btn.type='button';btn.append(icon(name),make('span','office-bar-label',label));btn.onclick=act(run);return btn;};
 const sheetMenu=items=>buildMenuList(items,planned,item=>act(async()=>{await layers.close(layers.top());await item.run();}));
 function paintBar(){
  const kind=state.model.kind;if(kind===barKind)return;barKind=kind;
  const first=kind==='pptx'?barItem('Slides','slides',()=>pagesSheet()):kind==='xlsx'?barItem('Sheets','sheets',()=>pagesSheet()):null;
  const comment=kind==='docx'?barItem('Comment','comment',()=>openCommentsSheet(layers,act)):null;
  bar.replaceChildren(...[first,barItem('Format','format',()=>formatSheet()),barItem('Insert','insert',()=>sheet('Insert',[],[sheetMenu(insertItems())])),comment,hostedAssistant()?null:barItem('Concierge','concierge',()=>conciergeSheet()),barItem('More','more',()=>sheet('More',[],[sheetMenu(moreItems())]))].filter(Boolean));
 }
 const desk=$('office-desktop-tools'),deskInsert=make('button','office-tool','Insert ▾'),deskComment=make('button','office-tool','Comment'),deskMore=make('button','office-icon-action','⋯'),zoomLabel=make('label','office-zoom');
 deskInsert.type=deskComment.type=deskMore.type='button';deskInsert.setAttribute('aria-haspopup','dialog');deskComment.setAttribute('aria-haspopup','dialog');deskMore.setAttribute('aria-haspopup','dialog');deskMore.setAttribute('aria-label','More');deskMore.title='More';zoomLabel.append(make('span','office-sr-only','Zoom'),$('zoom'));
 deskInsert.onclick=act(()=>menu('Insert',insertItems(),deskInsert));deskComment.onclick=act(()=>openCommentsSheet(layers,act));deskMore.onclick=act(()=>menu('More',moreItems(),deskMore));
 desk.append(deskInsert,deskComment,zoomLabel,deskMore);
 return{paintBar,syncDesk:()=>{deskComment.disabled=state.model.kind==='xlsx';}};
}

function hasContent(){
 const model=state.model;
 if(model.kind==='xlsx')return model.sheets.some(s=>Object.values(s.cells).some(c=>String(c?.value??'')!==''));
 if(model.kind==='pptx')return model.pages.some(p=>p.objects.length>0);
 return model.pages.some(p=>p.blocks.some(b=>b.type!=='paragraph'||plain(b.runs).trim()!==''));
}

function paintFacts(){
 const model=state.model,list=$('office-doc-facts');
 if(model.kind==='xlsx'){list.replaceChildren();return;}
 const pt=v=>Math.round(v)+' pt',rows=[[model.kind==='pptx'?'Slide size':'Page size',pt(model.pageWidth)+' × '+pt(model.pageHeight)]];
 if(model.kind==='docx')rows.push(['Margins',[model.margins.top,model.margins.right,model.margins.bottom,model.margins.left].map(Math.round).join(' · ')+' pt']);
 rows.push([model.kind==='pptx'?'Slides':'Pages',String(model.pages.length)]);
 list.replaceChildren(...rows.flatMap(([t,v])=>[make('dt','',t),make('dd','',v)]));
 $('office-doc-summary-title').textContent=model.kind==='pptx'?'Presentation':'Document';
}

export function bindDesign({foundation,plannedControl,insert,removeItem,arrange,duplicate}){
 const root=$('office-root'),layers=createLayers(document),act=work=>guard(async event=>{await work(event);});
 const planned=(backlog,label,options={})=>plannedControl(document,{backlog,label,...options});
 const sheet=(title,nodes=[],extra=[],options={})=>{const layer=layers.create(title,'ds-sheet'+(options.half?' ds-half':''));layer.body.append(...extra);return layers.open(layer,{nodes,onClose:options.onClose});};
 const menu=(title,items,anchor)=>{const layer=layers.create(title,'ds-menu');layer.body.append(buildMenuList(items,planned,item=>act(async()=>{await layers.close(layer.dialog);await item.run();})));return layers.open(layer,{anchor});};
 state.confirm=({title,message,action,danger=false})=>new Promise(resolve=>{let answer=false;const layer=layers.create(title,'ds-sheet ds-confirm'),row=make('div','office-dialog-actions'),cancel=make('button','','Cancel'),go=make('button',danger?'ds-danger-fill':'primary',action);cancel.type=go.type='button';if(danger)go.dataset.dsDestructive='';cancel.onclick=()=>void layers.close(layer.dialog);go.onclick=()=>{answer=true;void layers.close(layer.dialog);};row.append(cancel,go);layer.body.append(make('p','office-confirm-text',message),row);layers.open(layer,{onClose:()=>setTimeout(()=>resolve(answer))});});
 const home=bindHomeAndHeader({root,layers,act,menu,sheet});
 const panes=bindPanesAndFormat({root,foundation,layers,act,planned,sheet});
 const tools=bindToolbarsAndMenus({layers,act,planned,menu,sheet,click:home.click,inertNode:home.inertNode,insert,generate:panes.generate,formatSheet:panes.formatSheet,conciergeSheet:panes.conciergeSheet});
 const sel=bindSelectionAndCanvas({root,layers,act,menu,duplicate,arrange,removeItem});
 function refresh(){
  const view=root.dataset.officeView||'document',reading=state.reading&&view==='document',content=hasContent(),canExport=Boolean(state.permissions.export);
  const canStartEdit=Boolean(state.id?(state.accessRole==='owner'?state.permissions.change:state.canEdit):state.permissions.create);
  $('document-name-text').textContent=state.model.title||'Untitled';$('document-name').setAttribute('aria-label','Document menu: '+(state.model.title||'Untitled'));
  const untouched=pristine()||(!state.id&&!content&&!state.history.canUndo()&&!state.pendingSettings.size);if(untouched&&!state.error)$('save-state').textContent='';
  $('save-document').hidden=reading||untouched||!editable()||!dirty();$('office-edit').hidden=!reading||!canStartEdit;$('office-export').hidden=(reading&&canStartEdit)||!content||!canExport;
  for(const id of ['undo','redo'])$(id).hidden=reading;
  root.toggleAttribute('data-office-reading',reading);document.documentElement.toggleAttribute('data-office-reading',reading);
  root.dataset.officeRail=state.model.kind==='docx'&&state.model.pages.length<2?'off':'on';
  for(const line of $('document-canvas').querySelectorAll('.office-word-page .office-rich-text'))line.toggleAttribute('data-office-empty',line.textContent==='');
  tools.paintBar();tools.syncDesk();paintFacts();panes.syncPane();panes.applyFormatTab();sel.placeSelectionBar();
 }
 home.setView('document');panes.syncPane();tools.paintBar();
 document.addEventListener('keydown',e=>{if(e.key==='Tab')document.documentElement.setAttribute('data-office-keyboard','');},true);
 document.addEventListener('pointerdown',()=>document.documentElement.removeAttribute('data-office-keyboard'),true);
 root.querySelector('.ef-shell').dispatchEvent(new CustomEvent('editor-concierge:hide'));
 matchMedia('(max-width:800px)').addEventListener('change',()=>{refresh();requestAnimationFrame(fit);});
 return{refresh,showHome:home.showHome,openExisting:home.openExisting,generate:panes.generate,showFormat:()=>{if(wide())panes.showPane('format');},focusFirstLine:home.focusFirstLine,layers,setView:home.setView};
}

export function fallbackPlanned(doc,{backlog,label,icon,words=true,variant='tool',className=''}={}){
 const button=doc.createElement('button');button.type='button';if(className)button.className=className;
 if(icon){const glyph=typeof icon==='string'?Object.assign(doc.createElement('span'),{textContent:icon}):icon;glyph.setAttribute('aria-hidden','true');button.append(glyph);}
 if(words)button.append(Object.assign(doc.createElement('span'),{className:'ds-not-yet-name',textContent:label}));
 if(variant==='menu')button.append(Object.assign(doc.createElement('span'),{className:'ds-not-yet-note',textContent:'Not available yet'}));
 button.setAttribute('aria-disabled','true');button.setAttribute('data-ds-not-yet','');button.setAttribute('data-ds-backlog',backlog);button.setAttribute('aria-label',label+', not available yet');button.title='Not available yet';
 if(!doc.documentElement.hasAttribute('data-office-planned-guard')){doc.documentElement.setAttribute('data-office-planned-guard','');for(const type of ['click','keydown','pointerdown','mousedown','touchstart'])doc.addEventListener(type,event=>{if(!event.target.closest?.('[data-ds-not-yet]'))return;if(type==='click'||type==='keydown')event.preventDefault();event.stopImmediatePropagation();},true);}
 return button;
}

export async function hasDocuments(){const list=await api('/documents');state.documents=list.documents;return list.documents.length>0;}
