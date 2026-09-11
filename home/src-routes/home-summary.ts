/** Read cached home metadata only; never refresh a device or execute a scene. */
import * as fs from 'fs';
import * as path from 'path';
export function readHomeSnapshot(root: string, sub: string, file: string): unknown {
 if(!sub || sub==='.' || sub==='..' || /[\\/]/.test(sub)) throw Error('Invalid owner path');
 const base=path.resolve(root), owner=path.resolve(base,sub), target=path.resolve(owner,file);
 if(owner===base || !owner.startsWith(base+path.sep) || path.dirname(owner)!==base || path.dirname(target)!==owner) throw Error('Invalid owner path');
 if(!fs.existsSync(target)) return null;
 const realBase=fs.realpathSync(base), real=fs.realpathSync(target);
 if(!real.startsWith(realBase+path.sep) || path.dirname(real)!==owner || fs.statSync(real).size>2_000_000) throw Error('Invalid snapshot');
 return JSON.parse(fs.readFileSync(real,'utf8'));
}
export function homeSnapshotSummary(index: any, scenes: any, failed=false) {
 if(index!=null && (!Array.isArray(index.devices) || !index.devices.every((d:any)=>d && typeof d==='object'))) throw Error('Invalid device index');
 if(scenes!=null && !Array.isArray(scenes.scenes)) throw Error('Invalid scene index');
 const metrics=[{id:'cached-devices',label:'Cached devices',value:index?String(index.devices.length):'Not indexed'},
 {id:'saved-scenes',label:'Saved scenes',value:scenes?String(scenes.scenes.length):'Not indexed'}];
 const at=new Date(index?.generatedAt||'');
 const detail=Number.isFinite(at.getTime())?'Device index saved '+at.toISOString():'Device index has no recorded refresh time';
 const notes=detail+'. '+metrics.map(m=>m.label+': '+m.value).join('. ')+'. Cached configuration only; no device liveness or successful execution is established.';
 const items=[{text:'Review home configuration',detail,tone:'neutral',fix:'home-dashboard',actions:[{integration:'prepare-document',context:{title:'Home configuration review',notes}}]}];
 return {metrics,tiles:metrics,items,partial:failed,asOf:new Date().toISOString()};
}
