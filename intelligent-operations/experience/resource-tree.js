/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve observed system labels when the selected filters exclude the cluster row. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Dispose selected pod diagnostics when selection or authorization changes. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Explore observed infrastructure through an exact-identity tree and one status/detail panel without granting execution authority. */
(function(root){
'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const status=a=>['healthy','degraded'].includes(a.health)?a.health:'unknown';
/** @description Build a bounded ownership tree; placement is a fact, never a second parent or a name-based join.
 * @param {object} model Validated Systems projection with exact edges.
 * @returns {object} Forest with grouping-only namespaces, cycle guards and immutable resource IDs. */
function forest(model){
 if(!Array.isArray(model?.rows)||model.rows.length>2000)throw Error('Resource tree is unavailable.');
 const nodes=new Map(),parents=new Map(),groups=new Map(),orphans=[];
 for(const a of model.rows){if(!a?.id||nodes.has(a.id))throw Error('Resource identity is unavailable or repeated.');nodes.set(a.id,{id:a.id,asset:a,children:[]});}
 for(const a of model.rows){
  const owner=(a.neighbors||a.relationships||[]).filter(e=>e.from===a.id&&((e.type==='OWNED_BY')||(a.kind==='container'&&e.type==='RUNS_ON'))).map(e=>nodes.get(e.to)).filter(Boolean);
  if(owner.length===1&&owner[0].asset.provider===a.provider&&owner[0].asset.scope===a.scope)parents.set(a.id,owner[0].id);
 }
 const cycles=new Set();
 for(const id of nodes.keys()){const visited=new Set();let at=id;while(parents.has(at)){if(visited.has(at)){for(const x of visited)cycles.add(x);break;}visited.add(at);at=parents.get(at);}}
 for(const id of cycles)parents.delete(id);
 const roots=[];
 const clusters=model.rows.filter(a=>a.kind==='cluster');
 for(const node of nodes.values()){
  const parent=nodes.get(parents.get(node.id));if(parent){parent.children.push(node);continue;}
  const a=node.asset,scope=JSON.stringify([a.provider,a.scope]);let group=groups.get(scope);
  if(!group){group={id:'scope:'+scope,label:((model.systems||[]).find(s=>s.provider===a.provider&&s.scope===a.scope)?.name||clusters.find(c=>c.provider===a.provider&&c.scope===a.scope)?.name||a.scope)+' · '+a.provider,group:true,children:[],namespaces:new Map()};groups.set(scope,group);roots.push(group);}
  const namespace=typeof a.properties?.namespace==='string'&&a.properties.namespace;
  if(namespace){let ns=group.namespaces.get(namespace);if(!ns){ns={id:group.id+':ns:'+namespace,label:namespace,group:true,children:[]};group.namespaces.set(namespace,ns);group.children.push(ns);}ns.children.push(node);}
  else group.children.push(node);
  if(cycles.has(node.id))orphans.push(node.id);
 }
 const sort=children=>{children.sort((a,b)=>(a.asset?.name||a.label).localeCompare(b.asset?.name||b.label)||a.id.localeCompare(b.id));for(const child of children)sort(child.children);};sort(roots);
 return {roots,nodes,cycles:[...cycles],orphans};
}
/** @description Render one observed resource with related evidence; source values always become text nodes.
 * @param {Element} target Detail host. @param {object} a Selected validated resource.
 * @param {object} actions Explicit navigation/investigation callbacks. @returns {void} */
function detail(target,a,actions={}){
 target.replaceChildren();target.append(text('p',a.kind.toUpperCase(),'eyebrow'),text('h2',a.name));
 const state=text('span',status(a)+' at capture','resource-status '+status(a));target.append(state);
 const facts=text('dl','','resource-facts'),p=a.properties||{};
 const values=[['Observed',a.observedAt],['Provider',a.provider],['Scope',a.scope],['Native identity',a.nativeId],['Namespace',p.namespace],['Phase',p.phase],['Ready',p.readyStatus],['Status reason',p.reason||p.waitingReason],['Image',p.image],['Restart count',p.restarts],['Last termination',p.lastTerminationReason],['Exit code',p.exitCode],['Node',p.nodeName]];
 for(const [key,value] of values)if(value!==undefined&&value!==null&&value!=='')facts.append(text('dt',key),text('dd',String(value)));target.append(facts);
 target.append(text('p','These are saved observations. Refreshing this view rereads records; it does not run a cluster command.','observation-note'));
 const buttons=text('div','','resource-actions');
 if(actions.onFocus){const b=text('button','Open in topology');b.type='button';b.addEventListener('click',()=>actions.onFocus(a.id));buttons.append(b);}
 if(actions.onAsk){const b=text('button','Investigate with AI');b.type='button';b.addEventListener('click',()=>actions.onAsk(a,b));buttons.append(b);}target.append(buttons);
 target.append(text('h3','Related alert observations'));
 if(!(a.events||[]).length)target.append(text('p','No matching alerts in the returned event page.','muted'));
 for(const event of a.events||[]){const b=text('button',(event.normalized?.data?.alertType||'Alert')+' · '+event.normalized?.time);b.type='button';b.addEventListener('click',()=>actions.onEvent?.(event));target.append(b);}
 target.append(text('h3','Observed relationships'));
 for(const edge of a.neighbors||a.relationships||[])target.append(text('p',edge.type+' · '+(edge.from===a.id?'to ':'from ')+(edge.neighbor?edge.neighbor.name+' ('+edge.neighbor.kind+')':(edge.from===a.id?edge.to:edge.from))+(edge.resolved===false?' · unresolved target':''),'resource-edge'));
 if(!(a.neighbors||a.relationships||[]).length)target.append(text('p','No observed relationships.','muted'));
}
/** @description Mount a keyboard-operable exact-identity tree with lazy branch rendering.
 * @param {Element} container Workspace host. @param {object} model Validated Systems records.
 * @param {object} actions Navigation callbacks. @returns {object} Explicit disposal handle. */
function mount(container,model,actions={}){
 const data=forest(model),expanded=new Set(),layout=text('div','','resource-workbench'),list=text('div','','resource-tree'),panel=text('section','','resource-detail');let selected=null,disposed=false,branchId=0,selectionView=null;
 list.setAttribute('role','tree');list.setAttribute('aria-label','Observed systems and resources');panel.setAttribute('aria-label','Resource details');container.replaceChildren();
 const count=text('p',model.counts.total+' matching assets · '+model.counts.degraded+' degraded · '+model.counts.unknown+' unknown','resource-count');container.append(count);
 if(model.partialCollections)container.append(text('p',model.partialCollections+' partial collections: missing resources do not establish deletion.','warning'));
 if(data.cycles.length)container.append(text('p','Some ownership records form a cycle. Those resources are shown independently.','warning'));
 if(!model.rows.length){container.append(text('p','No recorded resources match these filters.'));return {dispose(){disposed=true;container.replaceChildren();}};}
 function select(node){if(disposed||!node.asset)return;selectionView?.dispose();selectionView=null;selected=node.id;for(const row of list.querySelectorAll('[role="treeitem"]'))row.setAttribute('aria-selected',String(row.dataset.resourceId===selected));detail(panel,node.asset,actions);selectionView=actions.onSelect?.(node.asset,panel)||null;}
 function branch(nodes,host,level=1,parentButton=null){for(const node of nodes){
  const row=text('div','','resource-tree-row'),button=text('button','','resource-tree-item');button.type='button';button.dataset.resourceId=node.id;button.setAttribute('role','treeitem');button.setAttribute('aria-level',String(level));button.setAttribute('aria-label',(node.asset?.name||node.label)+' '+(node.asset?node.asset.kind+' '+status(node.asset):'group'));button.setAttribute('aria-selected',String(selected===node.id));button.tabIndex=list.querySelector('[role="treeitem"]')?-1:0;
  const children=text('div','','resource-tree-children');children.setAttribute('role','group');children.id='operations-resource-group-'+(++branchId);if(node.children.length)button.setAttribute('aria-owns',children.id);children.hidden=!expanded.has(node.id);let rendered=false;
  const mark=text('span',node.children.length?(expanded.has(node.id)?'▾':'▸'):'·','resource-expander');mark.setAttribute('aria-hidden','true');button.append(mark,text('span',node.asset?.name||node.label,'resource-name'));
  if(node.asset)button.append(text('small',node.asset.kind),text('span',status(node.asset),'resource-status '+status(node.asset)));else button.append(text('small','group'));
  function toggle(open){if(!node.children.length)return;if(open){expanded.add(node.id);if(!rendered){branch(node.children,children,level+1,button);rendered=true;}}else expanded.delete(node.id);children.hidden=!open;button.setAttribute('aria-expanded',String(open));mark.textContent=open?'▾':'▸';}
  if(node.children.length)button.setAttribute('aria-expanded',String(expanded.has(node.id)));
  button.addEventListener('click',()=>{for(const item of list.querySelectorAll('[role="treeitem"]'))item.tabIndex=-1;button.tabIndex=0;select(node);if(node.children.length)toggle(!expanded.has(node.id));});
  button.addEventListener('keydown',event=>{const rows=[...list.querySelectorAll('[role="treeitem"]')].filter(item=>!item.closest('[hidden]')),i=rows.indexOf(button);let next;
   if(event.key==='ArrowDown')next=rows[i+1];else if(event.key==='ArrowUp')next=rows[i-1];else if(event.key==='Home')next=rows[0];else if(event.key==='End')next=rows.at(-1);
   else if(event.key==='ArrowRight'){if(node.children.length&&!expanded.has(node.id))toggle(true);else next=children.querySelector('[role="treeitem"]');}
   else if(event.key==='ArrowLeft'){if(expanded.has(node.id))toggle(false);else next=parentButton;}
   else return;event.preventDefault();if(next){button.tabIndex=-1;next.tabIndex=0;next.focus();}
  });row.append(button);host.append(row,children);if(expanded.has(node.id))toggle(true);
 }}
 layout.append(list,panel);container.append(layout);branch(data.roots,list);panel.append(text('h2','Select a resource'),text('p','Expand a scope, namespace and workload to inspect its pods and containers. Arrow keys navigate the tree.'));
 return {dispose(){disposed=true;selectionView?.dispose();container.replaceChildren();}};
}
const api={forest,detail,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsResourceTree=api;
})(typeof window==='object'?window:globalThis);
