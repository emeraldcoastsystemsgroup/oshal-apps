/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the oshal design standard for Publishing Studio (docs/ux/design-standard.md §3.1, §3.3, §4.2-§4.4, §4.10, §5.1; Canva and Adobe Express, REFP CONVENTIONS §5.5, C-DES-1..5; Roger F6). The page's own layers: opaque top-layer menus and sheets with Done that Escape, a tap outside and the phone's Back close (DS-39); one tool row (Text, Image, Shape, Pages, Styles, Concierge, the planned Brand, More last) that scrolls sideways at the bottom of a phone and sits in the app row on a desktop, and switches to the chosen item's tools (Font, Size, Colour, Alignment, Arrange); the selection float at the item (Duplicate, Delete, More); the publication menu (New with a size, Open, Duplicate, Share and export, Saved history, Delete with an in-page confirm); the desktop's 240 px Pages pane and 320 px Properties | Concierge tabs; Your publications with one New at the bottom right; Help for the limits and how-to. Planned controls (RP-PUB-01..07) come from the shared planned-control helper and do nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.4.1: without the platform's planned-control helper (an older platform) the studio still opens and simply draws no planned control.
 */
const make=(doc,tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const ICONS={
 text:'<path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
 image:'<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 17 5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="15.5" cy="9" r="1.5" fill="currentColor"/>',
 shape:'<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
 pages:'<path d="M7 3h8l4 4v14H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 7v14h11" fill="none" stroke="currentColor" stroke-width="2"/>',
 styles:'<path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
 concierge:'<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor"/>',
 brand:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 0 0 16" fill="currentColor"/>',
 more:'<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>',
 done:'<path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
 font:'<path d="M4 20 10 4h1l6 16M6.5 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 20v-6" stroke="currentColor" stroke-width="2"/>',
 size:'<path d="M3 7V5h10v2M8 5v14M14 12v-1h7v1M17.5 11v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
 colour:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
 align:'<path d="M4 6h16M4 10h10M4 14h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
 arrange:'<path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3m-3 15-3-3m3 3 3-3M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
 cutout:'<circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"/>',
 duplicate:'<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
 comment:'<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
function icon(doc,name,size=22){const span=make(doc,'span','pub-glyph');span.setAttribute('aria-hidden','true');span.innerHTML=`<svg viewBox="0 0 24 24" width="${size}" height="${size}">${ICONS[name]}</svg>`;return span;}

/**
 * @description Modal top-layer menus and sheets (design standard §4.3, §4.4): opaque dialogs that close on Done, Escape, a tap
 * outside or the browser's Back (one history entry each, DS-39). Borrowed page elements are put back where they were, so their
 * ids and handlers keep working. Shaped on Video 1.13.0's layers.
 * @param {Document} doc the editor's document
 * @returns {{create:Function,open:Function,close:Function,top:Function}} the layer controls
 */
export function createLayers(doc){
 const win=doc.defaultView,stack=[];let ignore=0;
 win.addEventListener('popstate',()=>{if(ignore>0){ignore-=1;return;}const top=stack.at(-1);if(top)void close(top.dialog,{history:false});});
 function create(title,className){
  const dialog=make(doc,'dialog','ds-layer '+className),head=make(doc,'header','ds-layer-head'),handle=make(doc,'span','ds-layer-handle'),heading=make(doc,'h2','ds-layer-title',title),done=make(doc,'button','ds-layer-done','Done'),body=make(doc,'div','ds-layer-body');
  dialog.dataset.dsSheet='';dialog.setAttribute('aria-label',title);done.type='button';handle.setAttribute('aria-hidden','true');head.append(handle,heading,done);dialog.append(head,body);
  done.addEventListener('click',()=>void close(dialog));dialog.addEventListener('cancel',event=>{event.preventDefault();void close(dialog);});
  dialog.addEventListener('click',event=>{if(event.target===dialog)void close(dialog);});doc.body.append(dialog);
  return{dialog,body,heading};
 }
 async function open(layer,{nodes=[],anchor=null,onClose=null}={}){
  const restore=nodes.filter(Boolean).map(node=>{const mark=doc.createComment('layer');node.before(mark);layer.body.append(node);return()=>mark.replaceWith(node);});
  stack.push({dialog:layer.dialog,restore,onClose});layer.dialog.showModal();
  if(anchor&&win.matchMedia('(min-width:801px)').matches){const box=anchor.getBoundingClientRect(),width=Math.max(240,layer.dialog.offsetWidth);layer.dialog.classList.add('ds-anchored');layer.dialog.style.left=Math.max(8,Math.min(box.right-width,win.innerWidth-width-8))+'px';layer.dialog.style.top=Math.min(box.bottom+4,Math.max(8,win.innerHeight-layer.dialog.offsetHeight-8))+'px';}
  try{win.history.pushState({...(win.history.state||{}),dsLayer:stack.length},'');}catch{/* embedded without history access: Done and Escape still close it */}
 }
 async function close(dialog,{history=true}={}){
  const index=stack.findIndex(entry=>entry.dialog===dialog);if(index<0)return;const [entry]=stack.splice(index,1);
  for(const undo of entry.restore.reverse())undo();dialog.close();dialog.remove();entry.onClose?.();
  if(history){
   const address=win.location.href;ignore+=1;
   await new Promise(resolve=>{let fired=false;const done=()=>{if(fired)return;fired=true;win.removeEventListener('popstate',done);resolve();};win.addEventListener('popstate',done);try{win.history.back();}catch{done();}setTimeout(()=>{if(!fired&&ignore>0)ignore-=1;done();},600);});
   try{if(win.location.href!==address)win.history.replaceState(win.history.state,'',address);}catch{/* embedded without history access */}
  }
 }
 return{create,open,close,top:()=>stack.at(-1)?.dialog??null};
}

/**
 * @description Build Publishing Studio's screen on the shared editor: app row, tool row, sheets and panes, the selection float,
 * the desktop tabs and the publications view. Every command runs the workbench's own operation (api), so history, validation,
 * authority and the concierge handoff stay where they were.
 * @param {object} api the workbench's operations and state (workbench.mjs)
 * @param {{foundation:object,assistant:object,plannedControl:Function}} parts the shared editor, its concierge and the planned-control helper
 * @returns {{refresh:Function,confirm:Function,float:Function,painted:Function}} the shell's hooks for the workbench
 */
export function createPublishingShell(api,{foundation,assistant,plannedControl:helper}){
 const doc=document,root=doc.body,$=id=>doc.getElementById(id),shell=root.querySelector('.ef-shell'),layers=createLayers(doc);
 const wide=()=>!matchMedia('(max-width:800px)').matches,{state}=api;
 const act=work=>async event=>{event?.preventDefault?.();try{await work(event);}catch(error){api.status(error.message,true);}};
 const sec=name=>$('pub-sec-'+name);
 // Without the platform's planned-control helper (an older platform) a planned control is simply not drawn.
 const plannedControl=(d,options)=>helper?helper(d,options):null;
 const planned=(backlog,label,glyph,className='pub-tool')=>plannedControl(doc,{backlog,label,icon:glyph?icon(doc,glyph):undefined,className});

 // ── Layers: menus, sheets and the in-page confirm ──
 function menu(title,items,anchor){
  const layer=layers.create(title,'ds-menu'),list=make(doc,'div','ds-menu-list');list.setAttribute('role','menu');
  for(const item of items){
   if(!item)continue;if(item==='-'){list.append(make(doc,'hr','ds-menu-sep'));continue;}
   if(item.planned){const row=plannedControl(doc,{backlog:item.planned,label:item.label,variant:'menu',className:'ds-menu-row'});if(row)list.append(row);continue;}
   const entry=make(doc,'button','ds-menu-row'+(item.danger?' ds-danger':''),item.label);entry.type='button';entry.disabled=Boolean(item.disabled);entry.setAttribute('role','menuitem');
   if(item.danger)entry.dataset.dsDestructive='';
   entry.onclick=act(async()=>{await layers.close(layer.dialog);await item.run();});list.append(entry);
  }
  layer.body.append(list);return layers.open(layer,{anchor});
 }
 function sheet(title,nodes,{extra=[],half=false,onClose}={}){const layer=layers.create(title,'ds-sheet'+(half?' pub-half':''));return layers.open(layer,{nodes,onClose}).then(()=>{layer.body.append(...extra);return layer;});}
 function confirm({title,text,action}){
  return new Promise(resolve=>{
   const layer=layers.create(title,'ds-sheet ds-confirm'),words=make(doc,'p','pub-confirm-text',text),row=make(doc,'div','ds-confirm-actions'),cancel=make(doc,'button','ds-layer-done','Cancel'),go=make(doc,'button','ds-danger-fill',action);
   let answer=false;cancel.type=go.type='button';go.dataset.dsDestructive='';
   cancel.onclick=()=>void layers.close(layer.dialog);go.onclick=()=>{answer=true;void layers.close(layer.dialog);};
   row.append(cancel,go);layer.body.append(words,row);void layers.open(layer,{onClose:()=>resolve(answer)});
  });
 }

 // ── Panels: a sheet on a phone, the right pane's Properties tab on a desktop ──
 const SECTION_TITLES={text:'Text',format:'Text style',arrange:'Arrange',page:'Page',master:'Master',styles:'Styles',image:'Image'};
 let explicit=null;
 function panel(name,focus){
  if(wide()){explicit=name;tab('properties');layout();const target=sec(name);target?.scrollIntoView({block:'nearest'});(focus?$(focus):target?.querySelector('input:not([type=file]),select,textarea'))?.focus({preventScroll:true});return;}
  const nodes=[$('field-edits'),$('discard-fields'),sec(name)];
  if(name==='page')nodes.push(sec('master'));
  return sheet(SECTION_TITLES[name],nodes,{half:name!=='image'}).then(()=>{if(focus)$(focus)?.focus({preventScroll:true});});
 }
 /** Which sections the desktop's Properties pane shows: the chosen tool's, else the selection's, else the page's own (§5.1). */
 function layout(){
  const item=api.selected(),kind=item?item.storyId?'frame':item.kind:'';
  // A text frame shows its text and style; Arrange (geometry) is a tool of its own, as in the references' Position panel.
  const auto=!state.document?'summary':!item?'page master':kind==='frame'?'text format':kind==='text'?'format arrange':'arrange';
  // A tool the selection already shows scrolls to its section; any other (Styles, Image, Page settings) shows on its own.
  root.dataset.pubPanel=explicit&&!auto.split(' ').includes(explicit)?explicit:auto;
 }

 // ── The tool row (N3): one row, More last; a chosen item's own tools (N4) ──
 const row=make(doc,'nav','pub-toolrow');row.dataset.dsToolrow='';row.setAttribute('aria-label','Tools');$('pub-tools-slot').append(row);
 function tool(label,glyph,run,{phoneOnly=false,cls=''}={}){const button=make(doc,'button','pub-tool'+(phoneOnly?' pub-phone-only':'')+(cls?' '+cls:''));button.type='button';button.append(icon(doc,glyph),make(doc,'span','pub-word',label));button.onclick=act(run);return button;}
 const moreTool=()=>{const button=tool('More','more',()=>moreTools(button));button.setAttribute('aria-haspopup','dialog');return button;};
 async function addText(){const item=await api.addItem('frame');explicit=null;layout();if(item&&!wide()){await panel('text');const area=$('story-text');area.focus({preventScroll:true});area.select();}else if(item){panel('text','story-text');$('story-text').select();}}
 async function addShape(){await api.addItem('rect');explicit=null;layout();}
 function mainTools(){return[
  tool('Text','text',addText),tool('Image','image',()=>panel('image')),tool('Shape','shape',addShape),
  ...(state.document?[tool('Pages','pages',()=>pagesSheet(),{phoneOnly:true}),tool('Styles','styles',()=>panel('styles'))]:[]),
  tool('Concierge','concierge',()=>openConcierge(),{phoneOnly:true,cls:'pub-concierge'}),
  planned('RP-PUB-05','Brand','brand'),moreTool()];}
 function itemTools(item){
  // Done leaves the item's tools on a phone; a desktop leaves them with a click on the page (or Escape), so its row keeps room for More.
  const done=tool('Done','done',()=>api.selectPage(state.page),{phoneOnly:true}),more=moreTool();
  if(item.storyId)return[done,tool('Text','text',()=>panel('text','story-text'),{phoneOnly:true}),tool('Font','font',()=>panel('format','fmt-font')),tool('Size','size',()=>panel('format','fmt-size')),tool('Colour','colour',()=>panel('format','fmt-color')),tool('Align','align',()=>panel('format','fmt-align')),tool('Arrange','arrange',()=>panel('arrange')),more];
  if(item.kind==='image')return[done,tool('Arrange','arrange',()=>panel('arrange')),planned('RP-PUB-03','Remove background','cutout'),more];
  if(item.kind==='rect')return[done,tool('Colour','colour',()=>panel('arrange','pub-fill-field')),tool('Arrange','arrange',()=>panel('arrange')),more];
  return[done,...(item.kind==='text'?[tool('Font','font',()=>panel('format','fmt-font')),tool('Size','size',()=>panel('format','fmt-size'))]:[]),tool('Arrange','arrange',()=>panel('arrange')),more];
 }
 let rowKey='';
 function refreshRow(){
  const item=api.selected(),key=state.view+'|'+(item?(item.storyId?'frame':item.kind)+':'+item.id:'none')+'|'+Boolean(state.document);
  if(key===rowKey&&row.children.length)return;rowKey=key;row.replaceChildren(...(state.view!=='editor'?[]:item?itemTools(item):mainTools()).filter(Boolean));
 }

 // ── Menus ──
 /** The app row's ⋯: the publication's own commands (C-DES-3: pages, resize, select multiple), then checks and Help. */
 function moreMenu(anchor){return menu('More',[
  ...(!wide()&&!$('save').hidden?[{label:'Save revision',run:()=>api.run('save:click'),disabled:$('save').disabled},'-']:[]),
  {label:'Pages…',run:()=>pagesSheet(),disabled:!state.document},
  {planned:'RP-PUB-04',label:'Resize'},{planned:'RP-PUB-02',label:'Select multiple'},{planned:'RP-PUB-02',label:'Group'},
  ...(wide()?[]:[{planned:'RP-PUB-06',label:'Comment'}]),'-',
  {label:'Render and check…',run:()=>exportSheet(),disabled:!state.document},{label:'Saved history…',run:()=>historySheet(),disabled:!state.document},
  {label:'Refresh files',run:()=>api.run('refresh:click')},'-',{label:'Help',run:()=>helpSheet()}],anchor);}
 /** The tool row's More (N3, its last item): the rest of what can be added to a page and the page's own settings. */
 function moreTools(anchor){return menu('More tools',[
  {label:'Add page number',run:()=>api.addItem('number')},
  ...(state.document?[{label:'Page settings…',run:()=>panel('page')},{label:'Master…',run:()=>panel('master')}]:[])],anchor);}
 function newMenu(anchor){return menu('New',[{label:'Blank Letter page',run:()=>api.newPublication('letter')},{label:'Blank A4 page',run:()=>api.newPublication('a4')},{planned:'RP-PUB-01',label:'From template'}],anchor);}
 function documentMenu(anchor){const d=state.document;return menu(d?.title??'Untitled publication',[
  {label:'New blank Letter page',run:()=>api.newPublication('letter')},{label:'New blank A4 page',run:()=>api.newPublication('a4')},{planned:'RP-PUB-01',label:'New from template'},'-',
  ...(state.documents.length?[{label:'Open…',run:()=>api.showList()}]:[]),
  {label:'Duplicate',run:()=>api.duplicateDocument(),disabled:!d},{label:'Share and export…',run:()=>exportSheet(),disabled:!d},{label:'Saved history…',run:()=>historySheet(),disabled:!d},'-',
  {label:'Delete publication',danger:true,disabled:!d,run:()=>api.run('delete-document:click')}],anchor);}
 function itemMenu(anchor){const item=api.selected();if(!item)return;return menu(item.storyId?'Text frame':item.kind==='rect'?'Shape':item.kind==='image'?'Image':'Item',[
  ...(item.storyId?[{label:'Edit text…',run:()=>panel('text','story-text')},{label:'Text style…',run:()=>panel('format')}]:[]),
  {label:'Arrange…',run:()=>panel('arrange')},{label:'Duplicate',run:()=>api.duplicateItem()},'-',{label:'Delete',danger:true,run:()=>api.run('remove-object:click')}],anchor);}

 // ── Sheets ──
 function pagesSheet(){
  if(wide()){$('page-rail').querySelector('[aria-current=true]')?.focus();return;}
  const settings=make(doc,'button','pub-secondary','Page settings…'),master=make(doc,'button','pub-secondary','Master…');settings.type=master.type='button';
  return sheet('Pages',[$('page-rail'),root.querySelector('.pub-page-tools')],{extra:[settings,master],half:true}).then(layer=>{
   const closeThen=work=>act(async()=>{await layers.close(layer.dialog);await work();});settings.onclick=closeThen(()=>panel('page'));master.onclick=closeThen(()=>panel('master'));
   $('page-rail').addEventListener('click',event=>{if(event.target.closest('button'))void layers.close(layer.dialog);},{once:true});
  });
 }
 function exportSheet(){
  const pdf=make(doc,'div','pub-export-row'),layoutRow=make(doc,'div','pub-export-row'),check=make(doc,'div','pub-export-row'),download=make(doc,'button','pub-secondary','Download PDF');download.type='button';download.onclick=act(()=>api.downloadPdf());
  pdf.append(make(doc,'span','pub-export-name','PDF for print'),download);layoutRow.append(make(doc,'span','pub-export-name','Layout file'));check.append(make(doc,'span','pub-export-name','Render and preflight'));
  return sheet('Share and export',[],{extra:[pdf,layoutRow,check,plannedControl(doc,{backlog:'RP-PUB-07',label:'Schedule or post',variant:'menu',className:'ds-menu-row'})].filter(Boolean)}).then(layer=>{
   const borrow=(node,host)=>{const mark=doc.createComment('export');node.before(mark);host.append(node);node.hidden=false;return()=>mark.replaceWith(node);};
   const back=[borrow($('export-layout'),layoutRow),borrow($('render'),check),borrow($('cancel-render'),check),borrow($('preflight'),layer.body)];
   layer.dialog.addEventListener('close',()=>{for(const undo of back.reverse())undo();},{once:true});
  });
 }
 function historySheet(){const field=$('history').closest('label');return sheet('Saved history',[field,$('open-history'),$('restore-history'),$('reopen')]);}
 function helpSheet(){return sheet('Help',[],{extra:[
  'Frames you see on the page are the layout. Text is drawn in its frame as you type; Render and check sets the exact text flow and makes the print PDF, which Download PDF does for you.',
  'Save revision keeps a version you can return to in Saved history. Download PDF and Render save your changes first.',
  'Text in a linked story flows into its next frame when rendered. The draft draws a story in its first frame.',
  'Publishing Studio sets English and basic Latin text in Libertinus Serif, up to 8 pages, with an RGB PDF. PDF/X, CMYK, ICC profiles, IDML and complex scripts are not supported.',
 ].map(text=>make(doc,'p','pub-help',text))});}
 async function openConcierge(){
  if(wide()){tab('concierge');return;}
  await sheet('Concierge',[assistant.element]);assistant.element.querySelector('textarea')?.focus({preventScroll:true});
 }

 // ── The desktop's right pane: Properties | Concierge tabs (§3.3, no fourth column) ──
 const tabs=make(doc,'div','pub-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Side pane');
 const tabButton=(name,label)=>{const button=make(doc,'button','pub-tab',label);button.type='button';button.setAttribute('role','tab');button.dataset.tab=name;button.onclick=()=>tab(name);return button;};
 tabs.append(tabButton('properties','Properties'),tabButton('concierge','Concierge'));shell.querySelector('.ef-body').append(tabs);
 // One assistant entry (DS-33, the shared editor's F12 rule): while the Today bar's own Concierge opens this editor's concierge,
 // the Concierge tab is drawn only while the concierge is open, so the way back to Properties is beside it.
 let shellOwns=false;
 function syncTabs(){const closed=root.dataset.editorConcierge!=='open',paneButton=shell.querySelector('.ef-panes [aria-controls$="-concierge"]');if(closed&&paneButton)shellOwns=paneButton.hidden;tabs.children[1].hidden=shellOwns&&closed;}
 function tab(name){
  root.dataset.pubTab=name;for(const button of tabs.children)button.setAttribute('aria-selected',String(button.dataset.tab===name));
  if(name==='concierge'){if(root.dataset.editorConcierge!=='open')foundation.showPanel('ai');}
  else if(root.dataset.editorConcierge==='open')shell.dispatchEvent(new CustomEvent('editor-concierge:hide'));
  syncTabs();
 }
 new MutationObserver(()=>{const open=root.dataset.editorConcierge==='open';if(wide()&&(root.dataset.pubTab==='concierge')!==open)tab(open?'concierge':'properties');else syncTabs();}).observe(root,{attributes:true,attributeFilter:['data-editor-concierge']});

 // ── The selection float (N4) ──
 function float(item){
  if(state.document?.revision!==state.document?.currentRevision)return null;
  const bar=make(doc,'div','pub-float');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Chosen item');
  const button=(glyph,label,run,danger)=>{const b=make(doc,'button','pub-icon pub-float-button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.append(icon(doc,glyph,20));if(danger){b.dataset.dsDestructive='';b.classList.add('pub-danger');}b.onclick=act(run);return b;};
  const more=button('more','More for this item',()=>itemMenu(more));more.setAttribute('aria-haspopup','dialog');
  bar.append(button('duplicate','Duplicate',()=>api.duplicateItem()),button('trash',item.storyId?'Delete text frame':'Delete',()=>api.run('remove-object:click'),true),more);
  return bar;
 }

 // ── Format: the chosen text's own style, applied as it changes ──
 function styleTarget(){
  const item=api.selected(),m=state.model;if(!item||!m)return null;
  const paragraph=item.storyId?m.stories.find(s=>s.id===item.storyId)?.paragraphs[0]:item.kind==='text'?item.paragraph:null;if(!paragraph)return null;
  const character=paragraph.runs[0]?.style??'default';return{character,paragraph:paragraph.style,cs:m.characterStyles[character],ps:m.paragraphStyles[paragraph.style]};
 }
 const hex=color=>'#'+color.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''),rgb=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
 function setCharacter(values){const t=styleTarget();if(!t)throw new Error('Choose a text frame first.');api.edit({op:'set-character-style',name:t.character,values:{...t.cs,...values}});refreshFormat();}
 function setParagraph(values){const t=styleTarget();if(!t)throw new Error('Choose a text frame first.');api.edit({op:'set-paragraph-style',name:t.paragraph,values:{...t.ps,...values}});refreshFormat();}
 $('fmt-size').addEventListener('change',act(()=>{const size=Number($('fmt-size').value);if(!Number.isFinite(size)||size<6||size>96)throw new Error('Choose a size from 6 to 96 points.');setCharacter({size});}));
 $('fmt-color').addEventListener('change',act(()=>setCharacter({color:rgb($('fmt-color').value)})));
 $('fmt-bold').addEventListener('click',act(()=>setCharacter({weight:styleTarget()?.cs.weight===700?400:700})));
 $('fmt-italic').addEventListener('click',act(()=>setCharacter({style:styleTarget()?.cs.style==='italic'?'normal':'italic'})));
 $('fmt-align').addEventListener('click',act(event=>{const button=event.target.closest('[data-align]');if(button)setParagraph({align:button.dataset.align});}));
 function refreshFormat(){
  const t=styleTarget();if(!t)return;
  $('fmt-size').value=t.cs.size;$('fmt-color').value=hex(t.cs.color);$('fmt-bold').setAttribute('aria-pressed',String(t.cs.weight===700));$('fmt-italic').setAttribute('aria-pressed',String(t.cs.style==='italic'));
  for(const button of $('fmt-align').children)button.setAttribute('aria-pressed',String(button.dataset.align===t.ps.align));
  $('fmt-note').textContent=`Changes the “${t.character}” and “${t.paragraph}” styles, wherever they are used.`;
 }

 // ── App row, publications view, Comment ──
 $('document-menu').onclick=act(()=>documentMenu($('document-menu')));
 $('more-menu').onclick=act(()=>moreMenu($('more-menu')));
 $('back-to-list').onclick=act(()=>api.showList());
 // Escape with nothing open lets go of the chosen item, as Done does on a phone (a field being typed in keeps its own Escape).
 doc.addEventListener('keydown',event=>{if(event.key!=='Escape'||layers.top()||!api.selected()||event.target.closest?.('input,textarea,select'))return;act(()=>api.selectPage(state.page))(event);});
 let pagesChoice=null;
 $('pages-toggle').onclick=()=>{pagesChoice=root.dataset.pubPages==='closed'?'open':'closed';painted();};
 $('add-first').onclick=act(addText);
 $('new-publication').onclick=act(()=>newMenu($('new-publication')));
 $('place-image').onclick=act(async()=>{if(!$('object-asset').value)throw new Error('Upload an image first, then place it.');await api.addItem('image');explicit=null;layout();if(!wide())await layers.close(layers.top());});
 const comment=plannedControl(doc,{backlog:'RP-PUB-06',label:'Comment',icon:icon(doc,'comment',20),words:false,className:'pub-icon pub-desk-only'});if(comment)$('comment-slot').append(comment);
 // One assistant entry (DS-33): the editor opens with its concierge closed; the Concierge tool or tab opens it.
 shell.dispatchEvent(new CustomEvent('editor-concierge:hide'));tab('properties');

 /** After every paint: the view, the row, the panes and the format fields follow the document and the selection. */
 let lastItem=null;
 function painted(){
  const item=api.selected()?.id??null;if(item!==lastItem){explicit=null;lastItem=item;}
  root.dataset.pubView=state.view;$('publications').hidden=state.view!=='list';
  $('pub-your-images').hidden=!state.assets.length;
  const pages=pagesChoice??((state.model?.pages.length??0)>1?'open':'closed');root.dataset.pubPages=pages;
  $('pages-toggle').setAttribute('aria-expanded',String(pages==='open'));$('pages-toggle').setAttribute('aria-label',pages==='open'?'Hide pages':'Show pages');$('pages-toggle').title=$('pages-toggle').getAttribute('aria-label');
  $('back-to-list').hidden=state.view!=='editor'||!(state.documents.length||state.document);
  for(const id of ['document-menu','undo','redo','more-menu'])$(id).hidden=state.view!=='editor';
  refreshRow();layout();refreshFormat();syncTabs();
  const fill=root.querySelector('[data-editor-property="color"]');if(fill)fill.id='pub-fill-field';
 }
 /** After Upload and place, a phone's Image sheet steps aside so the placed picture is what the person sees. */
 function placed(){if(!wide()&&layers.top())void layers.close(layers.top());}
 return{confirm,float,painted,placed,refresh:painted,menu,layers};
}
