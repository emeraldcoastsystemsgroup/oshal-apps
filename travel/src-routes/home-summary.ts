/** App-owned saved travel evidence. Read-only; no provider calls or schema creation. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const queries: string[] = [
  "SELECT count(*)::text AS watches FROM travel_watches WHERE user_sub = $1 AND status='active' AND created_at <= $2",
  "SELECT kind, route_key, query, created_at FROM travel_watches WHERE user_sub = $1 AND status='active' AND created_at <= $2 ORDER BY created_at DESC, watch_id LIMIT 3",
  "SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five_days FROM travel_searches WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours' "
];
const definitions: Array<[number,string,string,string]> = [[0,"watches","saved-fare-watches","Saved fare watches"],[2,"day","flight-searches-24h","Flight searches / 24h"],[2,"five_days","flight-searches-5d","Flight searches / 5 days"]];
const clip=(value:unknown,cap=400)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,cap);
const stamp=(value:unknown)=>{const at=new Date(String(value));return Number.isFinite(at.getTime())?at.toISOString():'date unknown';};
function item(row:any):any {const query=row.query&&typeof row.query==='object'?row.query:{};const selected=Object.fromEntries(['origin','destination','departDate','returnDate','city','checkIn','checkOut','pickupDate','dropoffDate','pax','guests','cabin'].filter(k=>typeof query[k]==='string'||typeof query[k]==='number').map(k=>[k,clip(query[k],120)]));const title=clip(row.route_key,110)||'Saved fare watch';return {text:title,detail:clip(row.kind,25)+' watch · '+stamp(row.created_at),context:{title:'Prepare for my saved travel search',notes:clip('Unconfirmed travel plan: '+JSON.stringify(selected)+'. Saved '+stamp(row.created_at),1600)}};}
export function createHomeSummaryRoutes(ctx:AppContext):Router {
 const router=Router();
 router.get('/',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const oidc=(req as any).oidc,sub=oidc?.user?.sub||oidc?.user?.oid;
  if(!sub||oidc?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
  const now=new Date();
  const results=await Promise.allSettled(queries.map(text=>ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const metrics=definitions.map(([index,key,id,label])=>{const result=results[index];return {id,label,value:result.status==='fulfilled'?String(result.value.rows[0]?.[key]??'0'):'Unavailable',tone:'neutral'};});
  const recent=results[1];
  const items:any[]=recent.status==='fulfilled'?recent.value.rows.map(item).filter(Boolean).slice(0,3).map(({context,...entry}:any)=>({...entry,tone:'neutral',fix:"travel-concierge",actions:["plan-ride","plan-meal","plan-shopping","plan-music"].map(integration=>({integration,context}))})):[];
  const failed=results.filter(r=>r.status==='rejected').length;
  if(failed)items.push({text:'Some saved data cannot be checked.',tone:'warn',fix:"travel-concierge"});
  else if(!items.length)items.push({text:"No saved preparation items to review yet.",tone:'neutral',fix:"travel-concierge"});
  items.push({text:"Saved fare watches and flight searches, not confirmed itineraries. Prices and availability are checked when you search.",tone:'neutral',fix:"travel-concierge"});
  res.status(failed===results.length?503:200).json({metrics,tiles:metrics.slice(0,4),items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
