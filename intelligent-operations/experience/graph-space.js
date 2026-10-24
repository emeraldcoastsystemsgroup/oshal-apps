/* CHANGE LOG: local times | maintainer@emeraldcoastsystemsgroup.com | Graph and observation times in the viewer's local time. */
/* CHANGE LOG: readable labels | maintainer@emeraldcoastsystemsgroup.com | Draw node labels after the spheres, selected and degraded first, and skip any label that would overlap one already drawn, so a dense estate stays readable. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Fit small and large observed graphs to the viewport and render a depth compass and shaded resource spheres without continuous work. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Query authorized temporal graphs with bounded presets and render an interactive perspective-projected 3D estate without an animation loop or external assets. */
(function(root){
const localTime=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toLocaleString():String(v);};
'use strict';
const presets=Object.freeze([
 {id:'estate',name:'Observed estate',description:'All recorded assets in the selected graph snapshot.'},
 {id:'dependencies',name:'Dependencies of focus',description:'Follow outgoing DEPENDS_ON, ROUTES_TO and FORWARDS_TO edges, up to four hops.'},
 {id:'dependents',name:'Impact on dependents',description:'Follow incoming dependency and routing edges, up to four hops. Potential impact, not a proven incident cause.'},
 {id:'placement',name:'Placement of focus',description:'Follow RUNS_ON, CONTAINS and OWNED_BY in either direction, up to two hops.'},
 {id:'degraded',name:'Observed degraded assets',description:'Resources explicitly degraded at their observation times; unknown is kept separate.'},
 {id:'stale',name:'Observations older than 15 minutes',description:'Age is measured against the selected graph time, never the current wall clock.'}
]);
/** @description Run a bounded predefined query on the current caller's already admitted snapshot; return exact source IDs and explicit traversal/display limits. */
function query(data,options={}){
 if(!data||!Array.isArray(data.assets)||!Array.isArray(data.relationships)||data.assets.length>2000||data.relationships.length>5000||!Number.isFinite(Date.parse(data.asOf)))throw Error('Graph snapshot is unavailable or exceeds its budget.');
 const preset=presets.find(p=>p.id===(options.preset||'estate'));if(!preset)throw Error('Choose a predefined graph query.');
 const index=new Map();for(const a of data.assets){if(!a||typeof a.id!=='string'||!a.id||index.has(a.id)||!Number.isFinite(Date.parse(a.observedAt))||Date.parse(a.observedAt)>Date.parse(data.asOf))throw Error('Graph identity or observation time is unavailable.');index.set(a.id,a);}
 const edges=data.relationships.filter(e=>index.has(e.from)&&index.has(e.to)),chosen=new Set();let visited=0,limited=false;
 if(['dependencies','dependents','placement'].includes(preset.id)){
  if(!index.has(options.focus))throw Error('Select a focus asset for this graph query.');
  chosen.add(options.focus);let frontier=[options.focus];const placement=preset.id==='placement',types=new Set(placement?['RUNS_ON','CONTAINS','OWNED_BY']:['DEPENDS_ON','ROUTES_TO','FORWARDS_TO']);
  for(let depth=0;depth<(placement?2:4)&&frontier.length;depth++){
   const next=[];for(const id of frontier){visited++;for(const e of edges){if(!types.has(e.type))continue;const target=(placement||preset.id==='dependencies')&&e.from===id?e.to:(placement||preset.id==='dependents')&&e.to===id?e.from:null;if(!target||chosen.has(target))continue;if(chosen.size>=500){limited=true;continue;}chosen.add(target);next.push(target);}}frontier=next;
  }
 }else for(const a of data.assets)if(preset.id==='estate'||preset.id==='degraded'&&a.health==='degraded'||preset.id==='stale'&&Date.parse(data.asOf)-Date.parse(a.observedAt)>900000)chosen.add(a.id);
 const search=String(options.search||'').trim().toLowerCase();
 const matches=[...chosen].map(id=>index.get(id)).filter(a=>(!options.kind||options.kind===a.kind)&&(!search||[a.name,a.nativeId,a.scope,a.kind].join(' ').toLowerCase().includes(search))).sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
 const assets=matches.slice(0,100),visible=new Set(assets.map(a=>a.id)),relations=edges.filter(e=>visible.has(e.from)&&visible.has(e.to));
 return {preset,asOf:data.asOf,assets,relationships:relations.slice(0,500),matched:matches.length,total:data.assets.length,visited,limited,truncated:matches.length>assets.length||relations.length>500,partial:(data.collections||[]).some(c=>!c.complete),unresolved:data.relationships.length-edges.length};
}
/** @description Deterministic XYZ coordinates separate resource types and source scopes; positions encode layout only, never measured network distance. */
function layout(assets){
 const kinds=[...new Set(assets.map(a=>a.kind))].sort(),scopes=[...new Set(assets.map(a=>a.provider+'|'+a.scope))].sort(),counts=new Map();
 return assets.map(a=>{const key=a.kind+'|'+a.provider+'|'+a.scope,row=counts.get(key)||0;counts.set(key,row+1);return {...a,x:(kinds.indexOf(a.kind)-(kinds.length-1)/2)*160,y:row*82,z:(scopes.indexOf(a.provider+'|'+a.scope)-(scopes.length-1)/2)*170+(row%3-1)*45};}).map((a,_,all)=>({...a,y:a.y-(Math.max(...all.map(n=>n.y))+Math.min(...all.map(n=>n.y)))/2}));
}
/** @description Perspective projection with explicit depth, orbit and pan; pure computation supports deterministic acceptance. */
function project(nodes,camera,width,height){
 const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cx=Math.cos(camera.pitch),sx=Math.sin(camera.pitch);
 return nodes.map(n=>{const x=n.x*cy+n.z*sy,z=-n.x*sy+n.z*cy,y=n.y*cx-z*sx,depth=n.y*sx+z*cx,scale=700/(1000+depth)*camera.zoom;return {...n,screenX:width/2+x*scale+camera.panX,screenY:height/2+y*scale+camera.panY,depth,radius:Math.max(5,12*scale)};}).sort((a,b)=>b.depth-a.depth);
}
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
/** @description Mount a CPU canvas with orbit/pan/zoom, selectable nodes and an equivalent accessible node list; return a disposer for access withdrawal and refresh. */
function mount(container,model,onFocus){
 container.replaceChildren();container.append(text('p',model.preset.description));
 const status=text('p',model.assets.length+' of '+model.matched+' matching nodes · '+model.relationships.length+' displayed directed edges · as of '+localTime(model.asOf)+(model.truncated?' · display capped at 100 nodes / 500 edges':'')+(model.limited?' · traversal capped at 500 assets':'')+(model.partial?' · partial observations':''));status.setAttribute('role','status');container.append(status);
 if(!model.assets.length){container.append(text('p','No observed nodes match this query.'));return ()=>{};}
 const wrap=text('div','','graph-space'),canvas=document.createElement('canvas');canvas.className='graph-space-canvas';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Interactive 3D graph. Drag to orbit; Shift-drag to pan; use arrow keys to orbit, plus or minus to zoom. Select nodes in the list below.');wrap.append(canvas);container.append(wrap);
 const ctx=canvas.getContext('2d');if(!ctx){wrap.replaceChildren(text('p','The 3D canvas is unavailable. Use the equivalent node list below.'));}
 const camera={yaw:-0.55,pitch:0.25,zoom:1,panX:0,panY:0},nodes=layout(model.assets);let disposed=false,projected=[],width=600,height=430,selected='',drag=null,fitWidth=0,fit=1;
 const draw=()=>{if(disposed||!ctx)return;const bounds=wrap.getBoundingClientRect();width=Math.max(240,Math.floor(bounds.width||600));height=width<500?360:430;canvas.width=width* Math.min(devicePixelRatio||1,2);canvas.height=height*Math.min(devicePixelRatio||1,2);canvas.style.height=height+'px';ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);if(fitWidth!==width){const base=project(nodes,{yaw:-0.55,pitch:0.25,zoom:1,panX:0,panY:0},width,height),xs=base.map(n=>n.screenX),ys=base.map(n=>n.screenY);fit=Math.max(0.05,Math.min(3,(width-150)/Math.max(80,Math.max(...xs)-Math.min(...xs)),(height-100)/Math.max(80,Math.max(...ys)-Math.min(...ys))));fitWidth=width;}paint(ctx,model,projected=project(nodes,{...camera,zoom:camera.zoom*fit},width,height),width,height,selected);compass(ctx,camera,height);};
 const controls=text('div','','graph-space-controls');for(const [label,action]of [['Orbit left',()=>camera.yaw-=0.2],['Orbit right',()=>camera.yaw+=0.2],['Tilt up',()=>camera.pitch-=0.15],['Tilt down',()=>camera.pitch+=0.15],['Zoom in',()=>camera.zoom=Math.min(3,camera.zoom*1.2)],['Zoom out',()=>camera.zoom=Math.max(0.2,camera.zoom/1.2)],['Reset camera',()=>Object.assign(camera,{yaw:-0.55,pitch:0.25,zoom:1,panX:0,panY:0})]]){const button=text('button',label);button.type='button';button.addEventListener('click',()=>{action();draw();});controls.append(button);}container.append(controls,text('p','Depth separates source scopes; columns separate resource types. Positions are a layout, not physical distance. Arrows follow recorded edge direction. Drag to orbit; Shift-drag to pan. No continuous animation.'));
 canvas.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(e.shiftKey){camera.panX+=dx;camera.panY+=dy;}else{camera.yaw+=dx*0.008;camera.pitch=Math.max(-1.4,Math.min(1.4,camera.pitch+dy*0.008));}drag.x=e.clientX;drag.y=e.clientY;draw();});
 canvas.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const click=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5;drag=null;if(click){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,hit=[...projected].reverse().find(n=>Math.hypot(n.screenX-x,n.screenY-y)<=n.radius+5);if(hit){selected=hit.id;draw();onFocus(hit.id);}}});canvas.addEventListener('pointercancel',()=>{drag=null;});
 canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(0.2,Math.min(3,camera.zoom*(e.deltaY<0?1.1:1/1.1)));draw();},{passive:false});
 canvas.addEventListener('keydown',e=>{const moves={ArrowLeft:()=>camera.yaw-=0.15,ArrowRight:()=>camera.yaw+=0.15,ArrowUp:()=>camera.pitch-=0.1,ArrowDown:()=>camera.pitch+=0.1,'+':()=>camera.zoom=Math.min(3,camera.zoom*1.1),'-':()=>camera.zoom=Math.max(0.2,camera.zoom/1.1)};if(moves[e.key]){e.preventDefault();moves[e.key]();draw();}});
 const list=text('details','');list.open=true;list.append(text('summary','Select a graph node ('+model.assets.length+')'));const grid=text('div','','graph-node-list');for(const a of model.assets){const b=text('button',a.name+' · '+a.kind+' · '+(a.health||'unknown'),'inventory-node');b.type='button';b.setAttribute('aria-label','Explore node '+a.name);b.title=a.nativeId+' · '+a.scope+' · observed '+localTime(a.observedAt);b.addEventListener('click',()=>{selected=a.id;draw();onFocus(a.id);});grid.append(b);}list.append(grid);container.append(list);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(draw):null;observer?.observe(wrap);draw();return ()=>{disposed=true;observer?.disconnect();drag=null;projected=[];container.replaceChildren();};
}
/** @description Paint directed edges before depth-ordered observed resource spheres; health colors always have text equivalents. */
function paint(ctx,model,nodes,width,height,selected){
 ctx.fillStyle='#0b1220';ctx.fillRect(0,0,width,height);const index=new Map(nodes.map(n=>[n.id,n]));
 for(const e of model.relationships){const a=index.get(e.from),b=index.get(e.to),dx=b.screenX-a.screenX,dy=b.screenY-a.screenY,d=Math.hypot(dx,dy);ctx.strokeStyle='#647b94';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.screenX,a.screenY);ctx.lineTo(b.screenX,b.screenY);ctx.stroke();if(d>30){const x=b.screenX-dx/d*(b.radius+5),y=b.screenY-dy/d*(b.radius+5);ctx.fillStyle='#9aafc7';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-dx/d*8+dy/d*4,y-dy/d*8-dx/d*4);ctx.lineTo(x-dx/d*8-dy/d*4,y-dy/d*8+dx/d*4);ctx.fill();}}
 for(const n of nodes){ctx.fillStyle=n.health==='healthy'?'#51d5b1':n.health==='degraded'?'#ffb26c':'#a7b4cb';const color=ctx.fillStyle,shade=ctx.createRadialGradient(n.screenX-n.radius*.3,n.screenY-n.radius*.4,1,n.screenX,n.screenY,n.radius);shade.addColorStop(0,'#f4fbff');shade.addColorStop(.4,color);shade.addColorStop(1,'#26374c');ctx.fillStyle=shade;ctx.beginPath();ctx.arc(n.screenX,n.screenY,n.radius,0,Math.PI*2);ctx.fill();if(n.id===selected){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();}}
 // Labels after every sphere, most important first; a label that would overlap one already drawn is skipped (the node list below names every node).
 ctx.font='12px system-ui';ctx.textAlign='center';const placed=[],rank=n=>(n.id===selected?0:n.health==='degraded'?1:2);
 for(const n of nodes.slice().sort((a,b)=>rank(a)-rank(b)||b.radius-a.radius)){const label=String(n.name).slice(0,26),w=ctx.measureText(label).width+6,box={x:n.screenX-w/2,y:n.screenY+n.radius+4,w,h:16};
  if(n.id!==selected&&placed.some(o=>box.x<o.x+o.w&&o.x<box.x+box.w&&box.y<o.y+o.h&&o.y<box.y+box.h))continue;placed.push(box);ctx.fillStyle='#edf4ff';ctx.fillText(label,n.screenX,n.screenY+n.radius+16);}
}
/** @description A small camera-relative XYZ compass makes orbit and source depth legible without implying measured coordinates. */
function compass(ctx,camera,height){
 const axes=project([{id:'X',x:45,y:0,z:0},{id:'Y',x:0,y:45,z:0},{id:'Z',x:0,y:0,z:45}],{...camera,zoom:1,panX:0,panY:0},0,0);ctx.font='11px system-ui';ctx.textAlign='center';for(const [i,a]of axes.entries()){ctx.strokeStyle=['#76c8ff','#83e7bd','#edb7ff'][i];ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(53,height-53);ctx.lineTo(53+a.screenX,height-53+a.screenY);ctx.stroke();ctx.fillText(a.id,53+a.screenX*1.25,height-53+a.screenY*1.25);}ctx.fillStyle='#a7b4cb';ctx.textAlign='left';ctx.fillText('Resource layout',14,height-12);
}
const api={presets,query,layout,project,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsGraphSpace=api;
})(typeof window==='object'?window:globalThis);
