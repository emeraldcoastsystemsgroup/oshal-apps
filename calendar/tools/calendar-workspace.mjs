/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The personal month calendar: owner events and the saved Google snapshot, add and remove OSHAL events.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The design standard (docs/ux/design-standard.md; UX audit decision calendar--calendar-review). One calendar row (Previous, Today, Next, the month, More); the grid is the work and starts right under it. Adding an event is the one primary, "+ New event" at the bottom right (X1, §5.6), and opens the add form as a sheet on a phone and a dialog on a desktop instead of a closed "Add an event to OSHAL" disclosure below the fold. Sync Google is one item of More, and its scope is said in the step that asks before it runs. Remove and Sync confirm in the page, never with window.confirm (DS-30). The selected day is inverted and today carries an accent ring; on a phone a day shows dots and the selected day's events are rows below the grid. A save or a removal tells the page (calendar:changed), so a list elsewhere on the page refreshes in the same step.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A layer's history entry waits for every pending Back of the page, and an in-page ask resolves only once its own entry is gone, so the Back a closing ask sends cannot take the next layer's entry and leave Calendar.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Few words before the work (DS-31): a calendar that read fine says nothing in its status line (the workspace carries data-state loading, ready or error instead, and a partial read or a failure is still said), and the selected day's heading and empty line are short ("Fri, Nov 6", "No events."; the full date stays its accessible name).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | UX sweep (D1=glass): mark modal dialogs (.calendar-sheet, .calendar-confirm) and the top-layer More menu (.calendar-menu) with data-no-glass so sheets and menus stay crisp and opaque under glass card mode.
 */
export const dateKey=d=>`${d.getFullYear().toString().padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function monthWindow(date){const first=new Date(date.getFullYear(),date.getMonth(),1),last=new Date(date.getFullYear(),date.getMonth()+1,0);return {from:dateKey(first),to:dateKey(last)};}
export function localInstant(value){const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);if(!m)throw Error('Enter a local date and time.');const n=m.slice(1).map(Number),d=new Date(0);d.setFullYear(n[0],n[1]-1,n[2]);d.setHours(n[3],n[4],0,0);if(dateKey(d)!==value.slice(0,10)||d.getHours()!==n[3]||d.getMinutes()!==n[4])throw Error('That local time does not exist in your time zone.');return d.toISOString();}
function element(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}

/** One queue for the whole page: a layer's history entry is pushed only once every Back a closing layer asked for has landed. */
let settling=Promise.resolve();
/**
 * @description A layer the browser's Back closes (DS-39): opening it adds one history entry; Back closes it; closing it
 *   another way takes the entry back off. Entries are pushed only after every pending Back of this page has landed, so a
 *   Back still in flight from the layer that just closed can never take the next layer's entry (and leave the page).
 * @param {{isOpen:Function,close:Function}} layer - Whether the layer is open, and how to close it without touching history.
 * @returns {{opened:Function,closed:Function}} opened() after it opens; closed() after it closes, resolving once the entry is gone.
 */
export function backCloses(layer){
 let state='none',ticket=0;
 window.addEventListener('popstate',()=>{if(state!=='pushed')return;state='none';if(layer.isOpen())layer.close();});
 return{opened(){if(state!=='none')return;state='pushing';const mine=++ticket;settling.then(()=>{if(state!=='pushing'||mine!==ticket)return;if(!layer.isOpen()){state='none';return;}try{history.pushState({calendarLayer:true},'');state='pushed';}catch(_){state='none';}});},
  closed(){if(state==='pushing'){state='none';return settling;}if(state!=='pushed')return settling;state='none';
   const gone=new Promise(resolve=>{let timer=0;const done=()=>{clearTimeout(timer);window.removeEventListener('popstate',done);resolve();};window.addEventListener('popstate',done);timer=setTimeout(done,600);try{history.back();}catch(_){done();}});
   settling=settling.then(()=>gone);return gone;}};
}

/**
 * @description An in-page confirmation (DS-30: never window.confirm): a modal dialog that names what will happen and offers
 *   Cancel and the action. Escape, Cancel, a tap on the backdrop and the browser's Back all answer no.
 * @param {Document} doc - The page.
 * @param {{title:string,text?:string,action:string,destructive?:boolean}} ask - The question, one sentence, and the action's word.
 * @returns {Promise<boolean>} true only when the person pressed the action.
 */
export function confirmInPage(doc,{title,text,action,destructive=false}){
 const dialog=element('dialog',null,'calendar-confirm'),heading=element('h2',title),body=text?element('p',text):null,row=element('div',null,'calendar-confirm-actions');
 dialog.setAttribute('data-no-glass','');dialog.setAttribute('data-ds-sheet','');
 const cancel=element('button','Cancel','calendar-tertiary'),go=element('button',action,destructive?'calendar-destructive':'calendar-primary');
 cancel.type=go.type='button';dialog.setAttribute('aria-labelledby',(heading.id='calendar-confirm-'+Math.random().toString(36).slice(2)));
 row.append(cancel,go);dialog.append(heading,...(body?[body]:[]),row);doc.body.append(dialog);
 return new Promise(resolve=>{
  let answered=false;const history=backCloses({isOpen:()=>dialog.open,close:()=>finish(false,true)});
  function finish(yes,fromBack){if(answered)return;answered=true;if(dialog.open)dialog.close();const gone=fromBack?Promise.resolve():history.closed();dialog.remove();gone.then(()=>resolve(yes));}
  cancel.onclick=()=>finish(false);go.onclick=()=>finish(true);
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('click',e=>{if(e.target===dialog)finish(false);});
  dialog.showModal();history.opened();cancel.focus({preventScroll:true});
 });
}

/**
 * @description The More menu of the calendar row: a button that opens a top-layer, opaque menu (popover), anchored under
 *   it and kept on screen. A choice, an outside tap, Escape and Back close it.
 * @param {Document} doc - The page.
 * @param {Array<{label:string,run?:Function,href?:string,meta?:Function}>} items - The menu rows, in order.
 * @returns {{button:HTMLButtonElement,menu:HTMLElement,refresh:Function}} The trigger to place in the row, the menu, and a refresh of the rows' meta lines.
 */
function moreMenu(doc,items){
 const button=element('button','⋯','calendar-more');button.type='button';button.setAttribute('aria-label','More');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
 const menu=element('div',null,'calendar-menu');menu.id='calendar-more-menu';menu.setAttribute('role','menu');menu.setAttribute('popover','auto');menu.setAttribute('data-no-glass','');button.setAttribute('aria-controls',menu.id);
 const metas=[];
 for(const item of items){
  const row=item.href?element('a',null,'calendar-menu-item'):element('button',null,'calendar-menu-item');row.setAttribute('role','menuitem');
  row.append(element('span',item.label,'calendar-menu-label'));
  if(item.meta){const meta=element('span','','calendar-menu-meta');row.append(meta);metas.push(()=>{meta.textContent=item.meta()||'';meta.hidden=!meta.textContent;});}
  if(item.href){row.href=item.href;row.target='_blank';row.rel='noopener';row.addEventListener('click',()=>menu.hidePopover());}
  else{row.type='button';row.addEventListener('click',()=>{menu.hidePopover();settled.then(item.run);});}
  menu.append(row);
 }
 const history=backCloses({isOpen:()=>menu.matches(':popover-open'),close:()=>menu.hidePopover()});let settled=Promise.resolve();
 function place(){const r=button.getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;let left=Math.min(r.right-w,innerWidth-w-8);left=Math.max(8,left);let top=r.bottom+4;if(top+h>innerHeight-8)top=Math.max(8,r.top-h-4);menu.style.left=left+'px';menu.style.top=top+'px';}
 // The history entry is added in the press itself, so a Back right after the menu appears closes it instead of leaving.
 button.addEventListener('click',()=>{for(const m of metas)m();menu.togglePopover();if(menu.matches(':popover-open'))history.opened();});
 // beforetoggle runs inside hidePopover(), so a chosen row waits for its history entry to go before it opens a layer of its own.
 menu.addEventListener('beforetoggle',e=>{if(e.newState==='closed')settled=history.closed();});
 menu.addEventListener('toggle',e=>{const open=e.newState==='open';button.setAttribute('aria-expanded',String(open));if(open){place();history.opened();menu.querySelector('.calendar-menu-item')?.focus({preventScroll:true});}});
 doc.body.append(menu);
 return{button,menu,refresh(){for(const m of metas)m();}};
}

/**
 * @description Mount the personal calendar into a host element.
 * @param {HTMLElement} host - Where the calendar draws (the page's #personalCalendar section).
 * @param {{menu?:Array<{label:string,run?:Function,href?:string}>}} [options] - Extra More-menu rows the page adds after the calendar's own.
 * @returns {{refresh:Function,destroy:Function}} Re-read the month, or take the calendar down.
 */
export function createCalendarWorkspace(host,options={}){
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';let month=new Date(),selected=dateKey(month),data=null,generation=0,controller=null,dead=false;
 host.classList.add('calendar-workspace');
 const toolbar=element('div',null,'calendar-toolbar'),heading=element('h2'),previous=element('button','‹','calendar-icon'),today=element('button','Today'),next=element('button','›','calendar-icon');
 previous.setAttribute('aria-label','Previous month');next.setAttribute('aria-label','Next month');for(const b of [previous,today,next])b.type='button';
 const status=element('p',null,'calendar-status');status.setAttribute('role','status');const coverage={text:''},body=element('div',null,'calendar-body'),grid=element('div',null,'calendar-grid'),agenda=element('section',null,'calendar-agenda');
 grid.setAttribute('aria-label','Month calendar');body.setAttribute('data-ds-work','');body.append(grid,agenda);
 const say=text=>{status.textContent=text;};
 // The add form: the same fields and rules as before, in a sheet (phone) or dialog (desktop) the one primary opens.
 const sheet=element('dialog',null,'calendar-sheet'),sheetHead=element('div',null,'calendar-sheet-head'),sheetTitle=element('h2','New event'),done=element('button','Cancel','calendar-tertiary'),form=element('form');
 sheet.setAttribute('data-no-glass','');sheet.setAttribute('data-ds-sheet','');
 sheet.setAttribute('aria-labelledby',(sheetTitle.id='calendar-new-title'));done.type='button';sheetHead.append(sheetTitle,done);sheet.append(element('span',null,'calendar-handle'),sheetHead,form);
 const inputs={};for(const [name,label,type,max] of [['title','Title','text',120],['allDay','All day','checkbox'],['start','Start','datetime-local'],['end','End (exclusive for all-day events)','datetime-local'],['location','Location','text',200],['notes','Notes','text',2000]]){const l=element('label',label,'calendar-field'+(type==='checkbox'?' calendar-check':'')),input=element('input');input.name=name;input.type=type;if(max)input.maxLength=max;if(['title','start'].includes(name))input.required=true;l.append(input);form.append(l);inputs[name]=input;}
 const save=element('button','Save event','calendar-primary');save.type='submit';const formStatus=element('p',null,'calendar-form-status');formStatus.setAttribute('role','alert');
 form.append(element('p',`Times use ${zone}. Events stay in OSHAL; they are not written to Google.`,'calendar-meta'),formStatus,save);
 const add=element('button','+ New event','calendar-new calendar-primary');add.type='button';add.setAttribute('data-ds-primary','');
 const sheetHistory=backCloses({isOpen:()=>sheet.open,close:()=>closeSheet(true)});
 function openSheet(){if(sheet.open)return;formStatus.textContent='';if(!inputs.start.value&&!inputs.allDay.checked)inputs.start.value=selected+'T09:00';sheet.showModal();add.hidden=true;reportInset?.();sheetHistory.opened();inputs.title.focus({preventScroll:true});}
 function closeSheet(fromBack=false){if(save.disabled)return;if(sheet.open)sheet.close();add.hidden=false;reportInset?.();if(!fromBack)sheetHistory.closed();}
 add.onclick=openSheet;done.onclick=()=>closeSheet();sheet.addEventListener('cancel',e=>{e.preventDefault();closeSheet();});sheet.addEventListener('click',e=>{if(e.target===sheet)closeSheet();});
 const request=async(path,options={})=>{
  const abort=new AbortController(),cancel=()=>abort.abort();let timedOut=false;
  if(options.signal?.aborted)abort.abort();else options.signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;abort.abort();},12000);
  try{const r=await fetch('/api/calendar'+path,{credentials:'same-origin',cache:'no-store',...options,signal:abort.signal});const j=await r.json().catch(e=>{if(abort.signal.aborted)throw e;return {};});if(!r.ok)throw Error(j.error||`Calendar request refused (HTTP ${r.status}).`);return j;}
  catch(e){if(timedOut)throw Error('Calendar request timed out. Reload to check current saved data before retrying a change.');throw e;}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
 };
 const changed=()=>host.dispatchEvent(new CustomEvent('calendar:changed',{bubbles:true}));
 async function syncGoogle(){
  const yes=await confirmInPage(document,{title:'Sync Google events?',text:'This reads your primary Google calendar for the next 30 days, up to 250 events, and saves only their titles, times and links. Who is coming and what an event says stay in Google.',action:'Sync'});
  if(!yes)return;say('Syncing your primary calendar…');
  try{const j=await request('/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});await refresh();say(`${j.count??0} events saved from Google.`);changed();}catch(e){say(e.message);}
 }
 const menu=moreMenu(document,[{label:'Sync Google events',run:syncGoogle,meta:()=>coverage.text},{label:'Manage Google connection',href:'/utilities'},...(options.menu||[])]);
 toolbar.append(previous,today,next,heading,menu.button);
 host.replaceChildren(toolbar,status,body,add,sheet);
 function dayEvents(day){return (data?.events||[]).filter(e=>e.firstDay<=day&&e.lastDay>=day);}
 function clockOf(ev){const at=v=>new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone});return (ev.allDay?'All day':at(ev.start))+(ev.end?' → '+(ev.allDay?ev.end:at(ev.end)):'');}
 async function removeEvent(ev,button){
  if(!await confirmInPage(document,{title:`Remove “${ev.title}”?`,text:`${clockOf(ev)}. It comes off your OSHAL calendar and cannot be brought back.`,action:'Remove',destructive:true}))return;
  button.disabled=true;try{await request('/events/'+encodeURIComponent(ev.id),{method:'DELETE'});await refresh();say('Event removed.');changed();}catch(e){say(e.message);button.disabled=false;}
 }
 function drawAgenda(){const when=new Date(selected+'T12:00:00'),title=element('h3',when.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}));title.setAttribute('aria-label',when.toLocaleDateString(undefined,{dateStyle:'full'}));agenda.replaceChildren(title);const events=dayEvents(selected);if(!events.length)agenda.append(element('p',data?'No events.':'Not read yet.','calendar-empty'));for(const ev of events){const row=element('article',null,'calendar-event '+ev.source),text=element('div',null,'calendar-event-text'),title=element('strong',ev.title);text.append(title,element('p',`${ev.source==='oshal'?'OSHAL':'Google'} · ${clockOf(ev)}`));if(ev.location)text.append(element('p',ev.location));if(ev.notes)text.append(element('p',ev.notes));row.append(text);if(ev.source==='oshal'){const remove=element('button','Remove','calendar-destructive');remove.type='button';remove.setAttribute('aria-label','Remove '+ev.title);remove.onclick=()=>removeEvent(ev,remove);row.append(remove);}else{try{const url=new URL(ev.url);if(url.protocol==='https:'&&url.hostname==='calendar.google.com'&&!url.username&&!url.password){const a=element('a','Open in Google Calendar');a.href=url.href;a.target='_blank';a.rel='noopener';text.append(a);}}catch(_){}}agenda.append(row);}}
 function draw(){heading.textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});grid.replaceChildren();for(const name of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])grid.append(element('div',name,'calendar-weekday'));const w=monthWindow(month),first=new Date(w.from+'T12:00:00');for(let i=0;i<first.getDay();i++)grid.append(element('div',null,'calendar-blank'));for(let i=1;i<=Number(w.to.slice(-2));i++){const day=w.from.slice(0,8)+String(i).padStart(2,'0'),button=element('button',null,'calendar-day');button.type='button';button.dataset.day=day;const events=dayEvents(day);button.setAttribute('aria-label',day+(events.length?`, ${events.length} ${events.length===1?'event':'events'}`:''));button.setAttribute('aria-pressed',String(day===selected));if(day===dateKey(new Date()))button.setAttribute('aria-current','date');button.append(element('span',String(i),'calendar-day-number'));const chips=element('span',null,'calendar-chips'),dots=element('span',null,'calendar-dots');for(const ev of events.slice(0,3)){chips.append(element('span',ev.title,'calendar-chip '+ev.source));dots.append(element('span',null,'calendar-dot '+ev.source));}if(events.length>3)chips.append(element('span',`+${events.length-3} more`,'calendar-chip'));if(events.length)button.append(chips,dots);button.onclick=()=>{selected=day;draw();};grid.append(button);}drawAgenda();}
 async function refresh(){const ticket=++generation;controller?.abort();controller=new AbortController();data=null;host.dataset.state='loading';host.setAttribute('aria-busy','true');draw();say('');try{const w=monthWindow(month),j=await request('/events/agenda?'+new URLSearchParams({...w,tz:zone}),{signal:controller.signal});if(dead||ticket!==generation)return;data=j;host.dataset.state='ready';host.removeAttribute('aria-busy');say(j.partial?j.warnings.join(' '):'');coverage.text=j.snapshot.state==='missing'?'Not synced yet':`Last synced ${new Date(j.snapshot.syncedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}`;menu.refresh();draw();}catch(e){if(ticket===generation&&!dead&&e.name!=='AbortError'){host.dataset.state='error';host.removeAttribute('aria-busy');say(e.message);agenda.replaceChildren(element('p','Calendar could not be read. No empty calendar is assumed.','calendar-empty'));}}}
 function move(delta){month=new Date(month.getFullYear(),month.getMonth()+delta,1);selected=dateKey(month);refresh();}previous.onclick=()=>move(-1);next.onclick=()=>move(1);today.onclick=()=>{month=new Date();selected=dateKey(month);refresh();};
 inputs.allDay.onchange=()=>{for(const key of ['start','end']){inputs[key].value='';inputs[key].type=inputs.allDay.checked?'date':'datetime-local';}};
 form.onsubmit=async e=>{
  e.preventDefault();save.disabled=true;done.disabled=true;for(const input of Object.values(inputs))input.disabled=true;formStatus.textContent='';
  const navigation=generation;let saved=false;
  try{const allDay=inputs.allDay.checked,start=allDay?inputs.start.value:localInstant(inputs.start.value),end=inputs.end.value?(allDay?inputs.end.value:localInstant(inputs.end.value)):undefined;
   await request('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,title:inputs.title.value,start,end,allDay,timeZone:allDay?undefined:zone,location:inputs.location.value,notes:inputs.notes.value})});
   saved=true;form.reset();inputs.start.type=inputs.end.type='datetime-local';
   if(generation===navigation){selected=allDay?start:dateKey(new Date(start));month=new Date(selected+'T12:00:00');}
  }catch(error){formStatus.textContent=error.message;}
  finally{save.disabled=false;done.disabled=false;for(const input of Object.values(inputs))input.disabled=false;}
  if(saved){closeSheet();await refresh();say('Event saved in OSHAL.');changed();}
 };
 // The shell's assistant button rests above --oshal-app-bottom-inset (the contract the shared editor and Create Home use), so
 // the page reports New event's top edge and the button sits above it instead of on it; cleared when the page goes away.
 const outer=(()=>{try{return window.parent!==window&&window.frameElement?{html:window.parent.document.documentElement,frame:window.frameElement}:null;}catch(_){return null;}})();
 function reportInset(){if(!outer)return;try{const box=add.getBoundingClientRect();if(add.hidden||!box.height){outer.html.style.removeProperty('--oshal-app-bottom-inset');return;}outer.html.style.setProperty('--oshal-app-bottom-inset',Math.max(0,Math.round(window.parent.innerHeight-(outer.frame.getBoundingClientRect().top+box.top)+8))+'px');}catch(_){/* the Today page went away */}}
 const clearInset=()=>{try{outer?.html.style.removeProperty('--oshal-app-bottom-inset');}catch(_){/* gone */}};
 reportInset();window.addEventListener('resize',reportInset);window.addEventListener('pagehide',clearInset);
 refresh();return{refresh,destroy(){dead=true;generation++;controller?.abort();menu.menu.remove();clearInset();host.replaceChildren();}};
}
