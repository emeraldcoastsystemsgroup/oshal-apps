/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Systems tab (1.8.2): add stackForest (Server -> Cluster/VM -> Node -> Workloads hierarchy with bottom-up alert and health roll-up), isPersonalSatelliteAsset filter excluding Orbit desktop/phone/TV satellites, and + / − resource-expander toggles. */
/** CHANGE LOG: installations label | maintainer@emeraldcoastsystemsgroup.com | "monitored installation" names only a scope whose host a heartbeat filed (properties.monitoredBy); any other import, such as a Scenario lab host, keeps its provider, because every imported host wore that label with no card behind it. */
/** CHANGE LOG: installations | maintainer@emeraldcoastsystemsgroup.com | A monitored installation's host shows its host name and public address, and its group reads "monitored installation" instead of the provider code "import". */
/** CHANGE LOG: node explorer | maintainer@emeraldcoastsystemsgroup.com | Show node capacity/allocatable, pressure conditions, versions, roles, taints, addresses and the pods scheduled on the node, with a jump that expands the tree to the exact pod. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve observed system labels when the selected filters exclude the cluster row. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Dispose selected pod diagnostics when selection or authorization changes. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Explore observed infrastructure through an exact-identity tree and one status/detail panel without granting execution authority. */
(function(root){
'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const status=a=>['healthy','degraded'].includes(a.health)?a.health:'unknown';
const SATELLITE_KINDS=new Set(['oshal-node-desktop','orbit-desktop','desktop','laptop','phone','mobile','tv','firetv','tablet','leaf','personal-device','satellite','computer']);
const DEFAULT_K3S_WORKLOADS=[
 {name:'oshal-saas-blue',kind:'workload',kindLabel:'Workload · Pod :38880',readings:'Active slot · HTTP :38880'},
 {name:'oshal-saas-green',kind:'workload',kindLabel:'Workload · Pod :38881',readings:'Standby slot · HTTP :38881'},
 {name:'oshal-saas-door',kind:'service',kindLabel:'Service · Proxy :38882',readings:'Cutover door · HTTP :38882'},
 {name:'postgres-blue-0',kind:'database',kindLabel:'Database · StatefulSet',readings:'Primary PostgreSQL'},
 {name:'postgres-green-0',kind:'database',kindLabel:'Database · StatefulSet',readings:'Standby PostgreSQL'}
];

/** @description Exclude personal satellite devices (Orbit computers, phones, TVs, tablets, leaf nodes) that belong in Your devices. */
function isPersonalSatelliteAsset(item){
 if(!item||typeof item!=='object')return false;
 const p=item.properties||item.attributes||item.labels||{};
 if(item.provider==='your-devices'||item.personalDevice===true||p.personalDevice===true)return true;
 for(const v of [item.kind,item.deviceKind,item.category,item.role,p.kind,p.deviceKind,p.role,p.category]){
  if(typeof v==='string'&&SATELLITE_KINDS.has(v.trim().toLowerCase()))return true;
 }
 const name=String(item.name||item.host||item.id||'').trim().toLowerCase();
 if(name==='my-computer'||/^spark-[0-9a-f]{4}$/.test(name))return true;
 return false;
}

/** @description Parse container names from a heartbeat check reading or container map. */
function parseContainers(row){
 const map=row.readings?.containers;
 if(map&&typeof map==='object')return Object.entries(map).map(([name,up])=>({name,up:Number(up)>0}));
 const check=(row.checks||[]).find(c=>c.id==='containers');
 const raw=String(check?.reading||'');
 const idx=raw.indexOf(':');
 if(idx<0)return [];
 const list=raw.slice(idx+1).split(';')[0].split(',').map(s=>s.trim()).filter(Boolean);
 return list.map(entry=>{
  const [name,val]=entry.split('=').map(s=>s.trim());
  return {name,up:val===undefined?check.state!=='bad':val!=='0'};
 }).filter(c=>c.name);
}

/** @description Match active firing alerts (excluding cleared or silence watch synthetic alarms) to a workload or server. */
function activeAlertsOf(row){
 return (row.firing||[]).filter(a=>a&&!a.clearing&&a.alertType!=='InstallationSilent');
}

function alertTarget(alert){
 return String(alert.pod||alert.container||alert.slot||alert.service||alert.labels?.pod||alert.labels?.container||alert.labels?.service||'').trim().toLowerCase();
}

/** @description Compute bottom-up alert and health roll-up for a stack tree node. */
function rollupStackNode(node){
 const seen=new Set(),childAlerts=[];
 for(const child of node.children||[]){
  rollupStackNode(child);
  for(const a of child.totalAlerts||[]){
   const key=a.fingerprint||a.id||(a.alertType+':'+(a.service||a.summary||''));
   if(!seen.has(key)){seen.add(key);childAlerts.push(a);}
  }
 }
 const direct=(node.directAlerts||[]).filter(a=>{
  const key=a.fingerprint||a.id||(a.alertType+':'+(a.service||a.summary||''));
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
 node.directAlerts=direct;
 node.childAlerts=childAlerts;
 node.totalAlerts=[...direct,...childAlerts];
 node.rolledUpCount=childAlerts.length;
 node.criticalCount=node.totalAlerts.filter(a=>a.severity==='critical').length;
 node.warningCount=node.totalAlerts.length-node.criticalCount;
 const rank={critical:5,silent:4,degraded:3,warn:3,late:2,unknown:1,healthy:0,reporting:0};
 let worst=node.directHealth||'healthy';
 if(node.criticalCount>0)worst='critical';
 else if(node.totalAlerts.length>0&&(rank[worst]??0)<3)worst='degraded';
 for(const child of node.children||[]){
  if((rank[child.effectiveHealth]??0)>(rank[worst]??0))worst=child.effectiveHealth;
 }
 node.effectiveHealth=worst;
 node.tone=worst==='critical'||worst==='silent'||worst==='degraded'?'bad':worst==='warn'||worst==='late'||worst==='unknown'||node.totalAlerts.length?'warn':'good';
 return node;
}

/** @description Build the 4-level stack (Server -> Cluster/VM -> Node -> Workloads) for monitored installations and topology assets. */
function stackForest(installations=[],graph=null){
 const roots=[],assets=(graph?.assets||[]).filter(a=>!isPersonalSatelliteAsset(a));
 for(const row of installations||[]){
  if(!row||isPersonalSatelliteAsset(row))continue;
  const hostName=row.host||row.name||row.sourceId,containers=parseContainers(row),alerts=activeAlertsOf(row),matched=new Set();
  const hasK3s=containers.some(c=>c.name==='k3s'||c.name.includes('k8s'))||String(row.name||'').includes('spark');
  const children=[];
  if(hasK3s){
   const k8sPods=assets.filter(a=>a.kind==='pod'&&(a.scope===row.sourceId||a.scope==='k3s'||a.properties?.namespace==='oshal-saas'));
   const specs=k8sPods.length?k8sPods.map(p=>({name:p.name,kind:'pod',kindLabel:'Workload · Pod',readings:p.properties?.phase||'Running',health:p.health})):DEFAULT_K3S_WORKLOADS;
   const workloads=specs.map(spec=>{
    const wAlerts=alerts.filter(a=>{const t=alertTarget(a);if(t&&t===spec.name.toLowerCase()){matched.add(a);return true;}return false;});
    return {id:row.sourceId+':w:'+spec.name,name:spec.name,kind:spec.kind,kindLabel:spec.kindLabel,level:4,readings:spec.readings,directHealth:wAlerts.some(a=>a.severity==='critical')?'critical':wAlerts.length||spec.health==='degraded'?'degraded':'healthy',directAlerts:wAlerts,children:[]};
   });
   const node={id:row.sourceId+':node:k3s-0',name:hostName+'-k3s-node-0',kind:'node',kindLabel:'Node',level:3,readings:workloads.length+' workloads scheduled',directHealth:'healthy',directAlerts:[],children:workloads};
   children.push({id:row.sourceId+':cluster:oshal-k8s-saas-cp',name:'oshal-k8s-saas-cp',kind:'cluster',kindLabel:'Kubernetes cluster · k3s',level:2,readings:'1 node · '+workloads.length+' workloads',directHealth:'healthy',directAlerts:[],children:[node]});
  }
  const hostContainers=containers.filter(c=>c.name!=='k3s');
  const hostWorkloads=hostContainers.map(c=>{
   const kind=/postgres|pg|db/i.test(c.name)?'database':/kernel|slot|caddy|site/i.test(c.name)?'service':'container';
   const label=kind==='database'?'Database · Container':kind==='service'?'Service · Container':'Workload · Container';
   const wAlerts=alerts.filter(a=>{const t=alertTarget(a);if(t&&t===c.name.toLowerCase()){matched.add(a);return true;}return false;});
   return {id:row.sourceId+':hw:'+c.name,name:c.name,kind,kindLabel:label,level:4,readings:c.up?'Running':'Stopped',directHealth:!c.up||wAlerts.length?'degraded':'healthy',directAlerts:wAlerts,children:[]};
  });
  for(const a of alerts){
   const t=alertTarget(a);
   if(t&&!matched.has(a)){
    matched.add(a);
    hostWorkloads.push({id:row.sourceId+':hw:'+t,name:t,kind:'service',kindLabel:'Workload · Service',level:4,readings:a.alertType||'Alerting',directHealth:a.severity==='critical'?'critical':'degraded',directAlerts:[a],children:[]});
   }
  }
  if(hostWorkloads.length||!children.length){
   const hNode={id:row.sourceId+':node:host',name:hostName+'-node',kind:'node',kindLabel:'Node',level:3,readings:hostWorkloads.length+' host workloads',directHealth:row.state==='never'?'unknown':'healthy',directAlerts:[],children:hostWorkloads};
   children.push({id:row.sourceId+':vm:host-stack',name:hostName+'-runtime',kind:'vm',kindLabel:'VM / Host stack',level:2,readings:'1 node · '+hostWorkloads.length+' workloads',directHealth:row.state==='never'?'unknown':'healthy',directAlerts:[],children:[hNode]});
  }
  const serverDirect=alerts.filter(a=>!matched.has(a));
  const rootHealth=row.state==='silent'?'silent':row.state==='late'?'late':row.state==='never'?'unknown':row.health==='degraded'?'degraded':row.health==='unknown'?'unknown':'healthy';
  const checkSummary=(row.checks||[]).filter(c=>['site','containers','disk'].includes(c.id)&&c.reading&&c.reading!=='Not reported').map(c=>c.label+': '+c.reading.replace(/: [^;]*/,'')).join(' · ');
  roots.push(rollupStackNode({
   id:'server:'+row.sourceId,sourceId:row.sourceId,name:hostName,title:row.name||hostName,kind:'server',kindLabel:'Server',level:1,
   state:row.state||'reporting',readings:checkSummary||(row.url||'Monitored installation'),directHealth:rootHealth,directAlerts:serverDirect,children
  }));
 }
 return roots;
}

/** @description Build a bounded ownership tree; placement is a fact, never a second parent or a name-based join. */
function forest(model){
 if(!Array.isArray(model?.rows)||model.rows.length>2000)throw Error('Resource tree is unavailable.');
 const nodes=new Map(),parents=new Map(),groups=new Map(),orphans=[],seenIds=new Set();
 for(const a of model.rows){
  if(!a?.id||seenIds.has(a.id))throw Error('Resource identity is unavailable or repeated.');
  seenIds.add(a.id);
  if(isPersonalSatelliteAsset(a))continue;
  nodes.set(a.id,{id:a.id,asset:a,children:[]});
 }
 for(const a of model.rows){
  if(!nodes.has(a.id))continue;
  const owner=(a.neighbors||a.relationships||[]).filter(e=>e.from===a.id&&((e.type==='OWNED_BY')||(a.kind==='container'&&e.type==='RUNS_ON'))).map(e=>nodes.get(e.to)).filter(Boolean);
  if(owner.length===1&&owner[0].asset.provider===a.provider&&owner[0].asset.scope===a.scope)parents.set(a.id,owner[0].id);
 }
 const cycles=new Set();
 for(const id of nodes.keys()){const visited=new Set();let at=id;while(parents.has(at)){if(visited.has(at)){for(const x of visited)cycles.add(x);break;}visited.add(at);at=parents.get(at);}}
 for(const id of cycles)parents.delete(id);
 const roots=[],clusters=model.rows.filter(a=>a.kind==='cluster'&&!isPersonalSatelliteAsset(a));
 for(const node of nodes.values()){
  const parent=nodes.get(parents.get(node.id));if(parent){parent.children.push(node);continue;}
  const a=node.asset,scope=JSON.stringify([a.provider,a.scope]);let group=groups.get(scope);
  if(!group){group={id:'scope:'+scope,label:((model.systems||[]).find(s=>s.provider===a.provider&&s.scope===a.scope)?.name||clusters.find(c=>c.provider===a.provider&&c.scope===a.scope)?.name||a.scope)+' · '+((model.systems||[]).find(s=>s.provider===a.provider&&s.scope===a.scope)?.monitored||model.rows.some(r=>r.provider===a.provider&&r.scope===a.scope&&r.properties?.monitoredBy)?'monitored installation':a.provider),group:true,children:[],namespaces:new Map()};groups.set(scope,group);roots.push(group);}
  const namespace=typeof a.properties?.namespace==='string'&&a.properties.namespace;
  if(namespace){let ns=group.namespaces.get(namespace);if(!ns){ns={id:group.id+':ns:'+namespace,label:namespace,group:true,children:[]};group.namespaces.set(namespace,ns);group.children.push(ns);}ns.children.push(node);}
  else group.children.push(node);
  if(cycles.has(node.id))orphans.push(node.id);
 }
 const sort=children=>{children.sort((a,b)=>(a.asset?.name||a.label).localeCompare(b.asset?.name||b.label)||a.id.localeCompare(b.id));for(const child of children)sort(child.children);};sort(roots);
 return {roots,nodes,cycles:[...cycles],orphans};
}

/** @description Render one observed resource with related evidence; source values always become text nodes. */
function detail(target,a,actions={}){
 target.replaceChildren();target.append(text('p',a.kind.toUpperCase(),'eyebrow'),text('h2',a.name));
 const state=text('span',status(a)+' at capture','resource-status '+status(a));target.append(state);
 const facts=text('dl','','resource-facts'),p=a.properties||{};
 const values=[['Observed',a.observedAt],['Provider',a.provider],['Host name',p.hostName],['Public address',p.publicAddress],['Scope',a.scope],['Native identity',a.nativeId],['Namespace',p.namespace],['Phase',p.phase],['Ready',p.readyStatus],['Status reason',p.reason||p.waitingReason],['Image',p.image],['Restart count',p.restarts],['Last termination',p.lastTerminationReason],['Exit code',p.exitCode],['Node',p.nodeName]];
 for(const [key,value] of values)if(value!==undefined&&value!==null&&value!=='')facts.append(text('dt',key),text('dd',String(value)));target.append(facts);
 if(a.kind==='node')nodeFacts(target,a,actions);
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

/** @description Node detail: capacity against allocatable, pressure conditions, versions, roles, taints, addresses and the pods scheduled on the node. */
function nodeFacts(target,a,actions){
 const p=a.properties||{},section=text('section','','node-facts');section.append(text('h3','Node facts'));
 if(p.pressure)section.append(text('p','Pressure at capture: '+p.pressure,'warning'));
 if(p.unschedulable===true)section.append(text('p','Cordoned (unschedulable) at capture.','warning'));
 const table=text('table','','node-capacity'),head=text('tr');for(const h of ['Resource','Capacity','Allocatable'])head.append(text('th',h));table.append(head);
 for(const [label,c,al] of [['CPU',p.capacityCpu,p.allocatableCpu],['Memory',p.capacityMemory,p.allocatableMemory],['Pods',p.capacityPods,p.allocatablePods]]){if(c==null&&al==null)continue;const row=text('tr');row.append(text('td',label),text('td',c==null?'not recorded':String(c)),text('td',al==null?'not recorded':String(al)));table.append(row);}
 if(table.childElementCount>1)section.append(table);else section.append(text('p','Capacity was not recorded in this scan; import a current scan to see it.','muted'));
 const facts=text('dl','','resource-facts');
 for(const [key,value] of [['Conditions',p.conditions],['Roles',p.roles],['Taints',p.taints],['Internal IP',p.internalIp],['Hostname',p.hostname],['Kubelet',p.kubeletVersion],['OS',p.osImage],['Container runtime',p.containerRuntime],['Architecture',p.architecture],['Kernel',p.kernelVersion],['Provider ID',p.providerId]])if(value!==undefined&&value!==null&&value!=='')facts.append(text('dt',key),text('dd',String(value)));
 section.append(facts);
 const pods=(a.neighbors||a.relationships||[]).filter(e=>e.to===a.id&&e.type==='RUNS_ON'&&e.neighbor&&e.neighbor.kind==='pod');
 section.append(text('h3','Pods on this node · '+pods.length));
 if(!pods.length)section.append(text('p','No pod placement recorded on this node in the loaded graph.','muted'));
 const list=text('ul','','node-pods');for(const e of pods.slice(0,100)){const li=text('li'),b=text('button',e.neighbor.name+(e.neighbor.properties?.namespace?' · '+e.neighbor.properties.namespace:'')+' · '+(e.neighbor.health||'unknown'));b.type='button';b.className='node-pod';b.addEventListener('click',()=>actions.onJump?.(e.neighbor.id));li.append(b);list.append(li);}
 if(pods.length>100)list.append(text('li','First 100 pods shown.'));section.append(list);target.append(section);
}

/** @description Mount a keyboard-operable exact-identity tree with lazy branch rendering. */
function mount(container,model,actions={}){
 const data=forest(model),expanded=new Set(),layout=text('div','','resource-workbench'),list=text('div','','resource-tree'),panel=text('section','','resource-detail');let selected=null,disposed=false,branchId=0,selectionView=null;
 list.setAttribute('role','tree');list.setAttribute('aria-label','Observed systems and resources');panel.setAttribute('aria-label','Resource details');container.replaceChildren();
 const count=text('p',model.counts.total+' matching assets · '+model.counts.degraded+' degraded · '+model.counts.unknown+' unknown','resource-count');container.append(count);
 if(model.partialCollections)container.append(text('p',model.partialCollections+' partial collections: missing resources do not establish deletion.','warning'));
 if(data.cycles.length)container.append(text('p','Some ownership records form a cycle. Those resources are shown independently.','warning'));
 if(!model.rows.length){container.append(text('p','No recorded resources match these filters.'));return {dispose(){disposed=true;container.replaceChildren();}};}
 const jumpActions={...actions,onJump:id=>reveal(id)};
 function select(node){if(disposed||!node.asset)return;selectionView?.dispose();selectionView=null;selected=node.id;for(const row of list.querySelectorAll('[role="treeitem"]'))row.setAttribute('aria-selected',String(row.dataset.resourceId===selected));detail(panel,node.asset,jumpActions);selectionView=actions.onSelect?.(node.asset,panel)||null;}
 function reveal(id){if(disposed||!data.nodes.has(id))return;const path=[];const walk=(items,trail)=>{for(const n of items){if(n.id===id){path.push(...trail);return true;}if(walk(n.children,[...trail,n]))return true;}return false;};walk(data.roots,[]);for(const n of path)expanded.add(n.id);list.replaceChildren();branchId=0;branch(data.roots,list);const button=list.querySelector('[data-resource-id="'+CSS.escape(id)+'"]');if(button){for(const item of list.querySelectorAll('[role="treeitem"]'))item.tabIndex=-1;button.tabIndex=0;button.focus();}select(data.nodes.get(id));}
 function branch(nodes,host,level=1,parentButton=null){for(const node of nodes){
  const row=text('div','','resource-tree-row'),button=text('button','','resource-tree-item');button.type='button';button.dataset.resourceId=node.id;button.setAttribute('role','treeitem');button.setAttribute('aria-level',String(level));button.setAttribute('aria-label',(node.asset?.name||node.label)+' '+(node.asset?node.asset.kind+' '+status(node.asset):'group'));button.setAttribute('aria-selected',String(selected===node.id));button.tabIndex=list.querySelector('[role="treeitem"]')?-1:0;
  const children=text('div','','resource-tree-children');children.setAttribute('role','group');children.id='operations-resource-group-'+(++branchId);if(node.children.length)button.setAttribute('aria-owns',children.id);children.hidden=!expanded.has(node.id);let rendered=false;
  const mark=text('span',node.children.length?(expanded.has(node.id)?'−':'+'):'·','resource-expander');mark.setAttribute('aria-hidden','true');button.append(mark,text('span',node.asset?.name||node.label,'resource-name'));
  if(node.asset)button.append(text('small',node.asset.kind),text('span',status(node.asset),'resource-status '+status(node.asset)));else button.append(text('small','group'));
  function toggle(open){if(!node.children.length)return;if(open){expanded.add(node.id);if(!rendered){branch(node.children,children,level+1,button);rendered=true;}}else expanded.delete(node.id);children.hidden=!open;button.setAttribute('aria-expanded',String(open));mark.textContent=open?'−':'+';}
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
const api={forest,detail,nodeFacts,mount,stackForest,isPersonalSatelliteAsset};
root.OperationsResourceTree=api;
if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
