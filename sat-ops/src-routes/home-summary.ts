/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Describe actual simulator registry persistence and heartbeat evidence without hardware claims. */
import type { SatFleetSummary } from '@/features/sat-ops/services/sat-fleet';
import type { TleCatalogEntry } from '@/features/sat-ops/model/orbit-types';
export function satHomeSummary(fleet: SatFleetSummary[], catalog: TleCatalogEntry[], now=Date.now(), registryKind?:string) {
 const durable=registryKind==='native-scoped-durable';
 const provenance=durable?'Caller-scoped durable simulation registry':'Shared process-local simulation registry';
 const metrics=[{id:'sim-nodes',label:'Simulation nodes',value:String(fleet.length)},
 {id:'sim-online',label:'Recent sim heartbeats',value:String(fleet.filter(s=>s.online).length)},
 {id:'sim-offline',label:'Stale sim heartbeats',value:String(fleet.filter(s=>!s.online).length)},
 {id:'tle-records',label:'Loaded TLE records',value:String(catalog.length)}];
 const items:any[]=fleet.slice().sort((a,b)=>Number(a.online)-Number(b.online)).slice(0,3).map(s=>{
 const title=String(s.satId).slice(0,100),detail='SIMULATION / '+s.engine+' / '+(s.online?'recent heartbeat':'stale heartbeat');
 const notes=detail+'. Last received: '+(s.lastSeenMs==null?'never':new Date(s.lastSeenMs).toISOString())+'. '+provenance+'; not a live spacecraft. Review the simulation before preparing an analysis.';
 return {text:title,detail,tone:s.online?'neutral':'warn',fix:'sat-ops',actions:[{integration:'prepare-document',context:{title,notes}}]};
 });
 items.push({text:provenance+(durable?'; survives API restart. ':'; resets with the API process. ')+'TLE records are loaded inputs, not orbit-quality certification.',tone:'neutral',fix:'sat-ops'});
 return {metrics,tiles:metrics,items,partial:false,asOf:new Date(now).toISOString()};
}
