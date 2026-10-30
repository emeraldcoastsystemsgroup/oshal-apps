/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain native inspector drafts by document/selection, collect their existing submit actions for automatic saves, and track original asynchronous work without adding another edit model.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep repeated color/vector control names distinct within one native inspector.
 */
const forms = ['layerSettings','layerTiming','workArea','transform','sceneProperties','textEdit','effectParams','editKey','maskSettings','maskVertex','editFeather'];
const fieldValue = field => field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value;
const usable = field => ['INPUT','SELECT','TEXTAREA'].includes(field.tagName) && !['file','submit','button','reset','hidden'].includes(field.type) && !field.dataset.inspection;
const fields = form => [...(form?.elements ?? [])].filter(usable);
const fieldKey = (field,index) => (field.name ? 'name:'+field.name : field.id ? 'id:'+field.id : 'field')+'@'+index;
function values(form) { return new Map(fields(form).map((field,index)=>[fieldKey(field,index),fieldValue(field)])); }

/**
 * @description Retain unapplied inspector values separately from saved native revisions until the existing edit route accepts them.
 * @param {{root?:Document,context:Function,captureExtra?:Function,restoreExtra?:Function,revision?:Function}} options Document event source and exact native selection descriptor.
 * @returns {object} Draft retention, paint, action and inspection coordination used by the owning workbench.
 */
export function createInspectorDrafts({ root = document, context, captureExtra=()=>[], restoreExtra=()=>{}, revision=()=>null }) {
  const pending = new Map(), baselines = new Map(), actions = new Set(), inspections = new Set();
  let serial = 0, paintDepth = 0, painted = new Set(), inspectionTail=Promise.resolve();
  const inspectionKeys=new Map();
  const key = value => value?.projectId ? JSON.stringify(value) : null;
  const entryKey = (value,id) => key(value)+'|'+id;
  const formById = id => root.getElementById(id);
  function remember(form) {
    if (!form || !forms.includes(form.id)) return;
    const at = context(), scope = key(at); if (!scope) return;
    const id = entryKey(at,form.id), current = values(form), baseline = baselines.get(id);
    if (!baseline) return;
    const patch = new Map([...current].filter(([name,value])=>baseline.get(name)!==value));
    const extra=captureExtra(form.id);
    if (!patch.size&&!extra.length) { pending.delete(id); return; }
    const ranges = fields(form).flatMap((field,index)=>typeof field.selectionStart==='number' ? [[fieldKey(field,index),field.selectionStart,field.selectionEnd]] : []);
    pending.set(id,{id,formId:form.id,context:at,patch,ranges,extra,baseRevision:pending.get(id)?.baseRevision??revision(),serial:++serial});
  }
  function restore(entry) {
    if (key(context())!==key(entry.context)) return;
    restoreExtra(entry.formId,entry.extra);
    fields(formById(entry.formId)).forEach((field,index)=>{
      const id=fieldKey(field,index);if(entry.patch.has(id)) {
        if(field.type==='checkbox'||field.type==='radio')field.checked=entry.patch.get(id);else field.value=entry.patch.get(id);
      }
      const range=entry.ranges.find(([name])=>name===id);if(range&&typeof field.setSelectionRange==='function')field.setSelectionRange(range[1],range[2]);
    });
  }
  function restoreCurrent() { for(const entry of pending.values())restore(entry); }
  function paint(ids,work) {
    for(const id of ids)painted.add(id);paintDepth++;
    try{return work();}finally{
      if(--paintDepth===0){
        const at=context();if(key(at))for(const id of painted)baselines.set(entryKey(at,id),values(formById(id)));
        painted=new Set();restoreCurrent();
        const active=key(context())+'|';for(const id of baselines.keys())if(!id.startsWith(active)&&!pending.has(id))baselines.delete(id);
      }
    }
  }
  function track(set,work) {
    let task;try{task=Promise.resolve(work());}catch(error){task=Promise.reject(error);}set.add(task);
    task.then(()=>set.delete(task),()=>set.delete(task));return task;
  }
  function action(work,event) {
    const form=event?.target?.closest?.('form'),at=context(),id=form&&entryKey(at,form.id),before=pending.get(id);
    return track(actions,async()=>{
      const result=await work(event);
      if(event?.type==='submit'&&pending.get(id)===before)pending.delete(id);
      if(event?.target?.type==='file'&&key(context())===key(at))remember(form);
      return result;
    });
  }
  async function idle() {
    while(actions.size||inspections.size)await Promise.allSettled([...actions,...inspections]);
  }
  root.addEventListener('focusin',event=>{
    const form=event.target.closest?.('form'),at=context();if(form&&forms.includes(form.id)&&key(at)&&!baselines.has(entryKey(at,form.id)))baselines.set(entryKey(at,form.id),values(form));
  });
  for(const type of ['input','change','select'])root.addEventListener(type,event=>{
    if(event.target.disabled||event.target.readOnly||event.target.dataset?.inspection)return;
    remember(event.target.closest?.('form'));
  });
  return {
    paint, restore, restoreCurrent, action, idle,
    inspect(id,work){
      if(inspectionKeys.has(id))return inspectionKeys.get(id);
      const task=track(inspections,()=>inspectionTail.then(work));inspectionKeys.set(id,task);
      inspectionTail=task.catch(()=>{});task.then(()=>inspectionKeys.delete(id),()=>inspectionKeys.delete(id));return task;
    },
    entries: projectId=>[...pending.values()].filter(entry=>entry.context.projectId===projectId).sort((a,b)=>a.serial-b.serial),
    forget(entries){for(const entry of entries)if(pending.get(entry.id)===entry)pending.delete(entry.id);},
    advance(projectId,before,after){for(const entry of pending.values())if(entry.context.projectId===projectId&&entry.baseRevision===before)entry.baseRevision=after;},
    has: projectId=>[...pending.values()].some(entry=>entry.context.projectId===projectId),
  };
}
