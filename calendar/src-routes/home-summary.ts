/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Personal event preparation from an explicit, caller-owned calendar snapshot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | With no snapshot, say what is actually missing: on the native kernel the caller's connections (connectors.metadata intent) tell "connected, not synced yet" from "not connected" and "reconnect"; where that intent is absent the original guidance is kept.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The summary also lists the events the person added in OSHAL (routes/own-events.js), merged with the synced ones by start and marked "added in OSHAL" in place of "synced", with an "Added in OSHAL" tile; with none added the answer is unchanged. The concierge's calendar-upcoming tool and the screen read this route, so an event saved through Jarvis is found again here.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | An added event's detail names its start in words in the zone it was entered in ('Fri, Nov 6, 2026, 6:00 PM CST / added in OSHAL'), not '2026-11-07T01:00:00.000Z' (sweep 9: the Office calendar card and the screen showed the raw UTC instant). Every event item also carries its machine start and allDay, which the screen's audience views read instead of the words.
 */
/** Personal event preparation from an explicit, caller-owned calendar snapshot. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { readOwnEvents, type OwnEvent } from './own-events';

const log = createChildLogger({ module: 'calendar.home-summary' });
/** Connector ids that name the one Google grant (the kernel resolves these aliases to the same authorization). */
const GOOGLE_PROVIDERS = new Set(['google', 'gmail', 'google-calendar', 'google-drive']);
/** What the caller's Google connection allows, as far as this screen can know. */
export type GoogleState = 'connected' | 'reconnect' | 'not-connected' | 'unknown';
const NO_SNAPSHOT: Record<GoogleState, string> = {
 connected: 'Google is connected, but no calendar is synced yet. Open Calendar and sync upcoming events.',
 reconnect: 'Your Google connection has expired or was revoked. Reconnect Google in Identity, then open Calendar and sync.',
 'not-connected': 'Connect Google in Identity, then open Calendar and sync upcoming events.',
 unknown: 'Connect Google in Identity, then open Calendar and sync upcoming events.',
};

/**
 * @description Classify the caller's Google connection from the kernel's connection metadata (never a credential).
 * A connection is usable unless revoked, or past its expiry with nothing to renew it.
 * @param meta - The connectors.metadata answer: `{ connections: [{ provider, revoked, expires_at_ms, renewable }] }`.
 * @param now - Clock seam in milliseconds.
 * @returns The connection state; `unknown` when the answer has no connection list.
 */
export function googleState(meta: any, now = Date.now()): GoogleState {
 const rows = Array.isArray(meta?.connections) ? meta.connections : null;
 if (!rows) return 'unknown';
 const google = rows.filter((c: any) => GOOGLE_PROVIDERS.has(String(c?.provider || '').toLowerCase()));
 if (!google.length) return 'not-connected';
 const usable = google.some((c: any) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
 return usable ? 'connected' : 'reconnect';
}

/**
 * @description Ask the native kernel for the caller's connections. A framework without the intent, or a refused intent,
 * is `unknown`, which keeps the original guidance rather than guessing.
 * @param ctx - The application context (the native bridge carries `intent`).
 * @returns The Google connection state.
 */
export async function readGoogleState(ctx: AppContext): Promise<GoogleState> {
 const intent = (ctx as unknown as { intent?: (name: string, input: unknown) => Promise<unknown> }).intent;
 if (typeof intent !== 'function') return 'unknown';
 try { return googleState(await intent.call(ctx, 'connectors.metadata', {})); } catch { return 'unknown'; }
}

/** The four planning offers every event item carries, with the event as their context. */
function eventItem(title:string, detail:string, url:unknown, start:string, allDay:boolean):any {
 return {text:title,detail,start,allDay,fix:'calendar-review',actions:['plan-gift','plan-meal','plan-trip','prepare-meeting'].map(integration=>({integration,context:{title,notes:(detail+'. Prepare for this event. Confirm the occasion, preferences, budget, timing and participants with me. Do not assume a gift is appropriate.').slice(0,2000),...(typeof url==='string'&&/^https:\/\/calendar\.google\.com\//.test(url)?{sourceUrl:url}:{})}}))};
}

/**
 * @description The Home summary: the synced snapshot's upcoming events and, when the person added any in OSHAL, those too.
 * @param snapshot - The caller's calendar_preparation_snapshots row, if any.
 * @param now - Clock seam.
 * @param google - The caller's Google connection state, for the not-synced note.
 * @param own - The caller's own events from routes/own-events.js (readOwnEvents), soonest first.
 * @returns Metrics (mirrored as tiles), event items then the coverage note, and the read time.
 */
export function calendarEvidence(snapshot:any, now=new Date(), google:GoogleState='unknown', own:OwnEvent[]=[]):any {
 const saved=snapshot && Number.isFinite(new Date(snapshot.synced_at).getTime()) && new Date(snapshot.synced_at)<=now;
 const events:any[]=saved&&Array.isArray(snapshot.events)?snapshot.events:[];
 const today=Date.parse(now.toISOString().slice(0,10));
 const upcoming=events.filter(e=>e&&typeof e.title==='string'&&typeof e.start==='string'&&Number.isFinite(Date.parse(e.start))&&Date.parse(e.start)>=(e.allDay?today:now.getTime())&&Date.parse(e.start)<now.getTime()+30*86400000).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const added=own.filter(e=>Date.parse(e.start)>=(e.allDay?today:now.getTime()));
 const metrics:any[]=[{id:'upcoming-5d',label:'Saved events / 5d',value:saved?String(upcoming.filter(e=>Date.parse(e.start)<now.getTime()+5*86400000).length):'Not synced'},{id:'upcoming-30d',label:'Saved events / 30d',value:saved?String(upcoming.length):'Not synced'}];
 if(added.length)metrics.push({id:'own-upcoming',label:'Added in OSHAL',value:String(added.length)});
 const merged=[...upcoming.map(e=>({start:e.start,item:eventItem(e.title.slice(0,120),e.start+(e.allDay?' / all day':'')+' / synced '+new Date(snapshot.synced_at).toISOString(),e.url,e.start,e.allDay===true)})),
  ...added.map(e=>({start:e.start,item:eventItem(e.title.slice(0,120),(e.local||e.start)+' / added in OSHAL'+(e.location?' / '+e.location.slice(0,80):''),undefined,e.start,e.allDay)}))]
  .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const items:any[]=merged.slice(0,3+Math.min(added.length,5)).map(e=>e.item);
 items.push({text:saved?'Saved primary-calendar snapshot, up to 250 events. Sync explicitly for changes; this is not a complete multi-calendar agenda.':NO_SNAPSHOT[google]??NO_SNAPSHOT.unknown,fix:'calendar-review',tone:'neutral'});
 return {metrics,tiles:metrics,items,asOf:now.toISOString(),partial:false};
}

/**
 * @description The caller's own events for the summary. A read failure (for example before the own-events migration ran)
 * is logged and leaves the synced summary standing.
 */
async function ownForSummary(ctx:AppContext, sub:string):Promise<OwnEvent[]> {
 try { return await readOwnEvents(ctx, sub); } catch (err) { log.error({ err }, 'Own calendar events unavailable for the summary'); return []; }
}

export function createHomeSummaryRoutes(ctx:AppContext):Router {
 const r=Router();r.get('/',async(req,res)=>{res.setHeader('Cache-Control','no-store');const o=(req as any).oidc,sub=o?.user?.sub;if(!sub||o?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
 try{const q=await ctx.pool.query({text:'SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = $1',values:[sub],query_timeout:1800} as any);const snapshot=q.rows[0];const own=await ownForSummary(ctx,String(sub));res.json(calendarEvidence(snapshot,new Date(),snapshot?'unknown':await readGoogleState(ctx),own));}catch(err){log.error({err},'Calendar snapshot read failed');res.status(503).json({error:'Calendar snapshot unavailable'});}});return r;
}
