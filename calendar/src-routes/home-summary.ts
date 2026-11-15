/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Personal event preparation from an explicit, caller-owned calendar snapshot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | With no snapshot, say what is actually missing: on the native kernel the caller's connections (connectors.metadata intent) tell "connected, not synced yet" from "not connected" and "reconnect"; where that intent is absent the original guidance is kept.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The summary also lists the events the person added in OSHAL (routes/own-events.js), merged with the synced ones by start and marked "added in OSHAL" in place of "synced", with an "Added in OSHAL" tile; with none added the answer is unchanged. The concierge's calendar-upcoming tool and the screen read this route, so an event saved through Jarvis is found again here.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | An added event's detail names its start in words in the zone it was entered in ('Fri, Nov 6, 2026, 6:00 PM CST / added in OSHAL'), not '2026-11-07T01:00:00.000Z' (sweep 9: the Office calendar card and the screen showed the raw UTC instant). Every event item also carries its machine start and allDay, which the screen's audience views read instead of the words.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the tile reads "Added in Open Swarm" and an added event is marked "added in Open Swarm" (Roger, 2026-11-13: what a person sees names the product Open Swarm).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: Home reads Google Calendar live (Roger, 2026-11-15: "I put a calendar event on my Google
 *   calendar and its not showing on the landing home ... i would think it would have a combination of calendars"). The summary
 *   showed only the copy saved by the last press of Sync. It now reads the person's Google calendars at that moment
 *   (routes/google-live.js: the primary one and up to nine more they show in Google Calendar, inside one 5-second budget) and
 *   lists them with the events added in Open Swarm as one list by start, each marked "Google Calendar", "Google Calendar: <its
 *   name>" or "added in Open Swarm". The tiles count that combined list ("Events / 5d", "Events / 30d"). Nothing is written: a
 *   GET saves no snapshot. The saved copy is read only when Google did not answer, and then the note says so ("Showing your last
 *   synced copy from <time>: Google did not answer."). Without a connection the note says to connect Google and no longer to
 *   sync. The answer carries `google` (state, read or synced time, calendars read, calendars that did not answer) and each event
 *   item its `source` and `calendar`, for the screen's audience views.
 */
/** The Home summary: the person's Google calendars read live, and the events they added in Open Swarm, as one list by start. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { readOwnEvents, type OwnEvent } from './own-events';
import { copyNote, GOOGLE_NOTE, liveGaps, readGoogleLive, readWords, type GoogleDown, type GoogleLive } from './google-live';
import { localLabel, offsetOf } from './event-time';

const log = createChildLogger({ module: 'calendar.home-summary' });
const DAY_MS = 86_400_000;
/** A tile's value when Google Calendar was not read: a state in words, never a count that leaves Google out. */
const NOT_READ: Record<GoogleDown, string> = { 'not-connected': 'Not connected', reconnect: 'Reconnect', 'not-allowed': 'Reconnect', 'no-answer': 'No answer' };
/** What the summary shows of Google Calendar: read now, the saved copy, or nothing and why. */
export type GoogleShownState = 'live' | 'saved-copy' | GoogleDown;
type Shown = { state: GoogleShownState; events: any[]; note: string; at: string | null; live: Extract<GoogleLive, { state: 'live' }> | null };

/** The note under a live read: which calendars were read just now, and anything they could not cover. */
function liveNote(live: Extract<GoogleLive, { state: 'live' }>, own: number): string {
  return [readWords(live, own ? ', with the events added in Open Swarm' : ''), ...liveGaps(live)].join(' ');
}

/**
 * @description The Google events the summary shows: the live read, else (only when Google did not answer) the saved copy with
 * the honest note, else none and why. A state given as text ('not-connected', from a caller without a live read) is that state.
 * @returns The events, their note and when they were read or saved.
 */
function googleShown(snapshot: any, now: Date, google: GoogleLive | string, own: number): Shown {
  const g: any = typeof google === 'string' ? { state: google in GOOGLE_NOTE ? google : 'not-connected' } : google;
  if (g.state === 'live') return { state: 'live', events: g.events, note: liveNote(g, own), at: g.readAt, live: g };
  const syncedAt = snapshot ? new Date(snapshot.synced_at) : null;
  if (g.state === 'no-answer' && syncedAt && Number.isFinite(syncedAt.getTime()) && syncedAt <= now && Array.isArray(snapshot.events)) {
    const events = snapshot.events.filter((e: any) => e && typeof e.start === 'string').map((e: any) => ({ ...e, calendar: null, local: localLabel(e.start, e.allDay === true, offsetOf(e.start)) }));
    return { state: 'saved-copy', events, note: copyNote(syncedAt), at: syncedAt.toISOString(), live: null };
  }
  const state = g.state as GoogleDown;
  return { state, events: [], note: GOOGLE_NOTE[state] ?? GOOGLE_NOTE['not-connected'], at: null, live: null };
}

/** Where a Google event lives, in the words beside its time. */
function whereOf(event: any, state: GoogleShownState): string {
  if (state === 'saved-copy') return 'Google Calendar, last synced copy';
  return event.calendar ? `Google Calendar: ${event.calendar}` : 'Google Calendar';
}

/** The four planning offers every event item carries, with the event as their context. */
function eventItem(title:string, detail:string, url:unknown, start:string, allDay:boolean, source:'google'|'oshal', calendar:string|null):any {
 return {text:title,detail,start,allDay,source,calendar,fix:'calendar-review',actions:['plan-gift','plan-meal','plan-trip','prepare-meeting'].map(integration=>({integration,context:{title,notes:(detail+'. Prepare for this event. Confirm the occasion, preferences, budget, timing and participants with me. Do not assume a gift is appropriate.').slice(0,2000),...(typeof url==='string'&&/^https:\/\/calendar\.google\.com\//.test(url)?{sourceUrl:url}:{})}}))};
}

/** The `google` block of the answer: what was shown of Google Calendar, for the screen's audience views. */
function googleBlock(shown: Shown): any {
  const live = shown.live;
  return { state: shown.state, readAt: shown.state === 'live' ? shown.at : null, syncedAt: shown.state === 'saved-copy' ? shown.at : null,
    calendars: live ? ['primary', ...live.read] : [], unread: live ? live.unread : [], primaryOnly: live ? !live.listed : null };
}

/**
 * @description The Home summary: the caller's Google calendars (read live, or the saved copy when Google did not answer) and
 * the events they added in Open Swarm, as one list by start, with tiles counting that list and a note saying what was read.
 * @param snapshot - The caller's calendar_preparation_snapshots row, read only when Google did not answer; else null.
 * @param now - Clock seam.
 * @param google - The live read (routes/google-live.js), or a state in words for a caller that made none.
 * @param own - The caller's own events from routes/own-events.js (readOwnEvents), soonest first.
 * @returns Metrics (mirrored as tiles), event items then the note, the read time and the `google` block.
 */
export function calendarEvidence(snapshot:any, now=new Date(), google:GoogleLive|string='not-connected', own:OwnEvent[]=[]):any {
 const today=Date.parse(now.toISOString().slice(0,10)),ahead=(e:any)=>Date.parse(e.start)>=(e.allDay?today:now.getTime());
 const added=own.filter(ahead),shown=googleShown(snapshot,now,google,added.length);
 const upcoming=shown.events.filter((e:any)=>e&&typeof e.title==='string'&&typeof e.start==='string'&&Number.isFinite(Date.parse(e.start))&&ahead(e)&&Date.parse(e.start)<now.getTime()+30*DAY_MS);
 const merged=[...upcoming.map((e:any)=>({start:e.start,item:eventItem(e.title.slice(0,120),`${e.local||e.start} / ${whereOf(e,shown.state)}`,e.url,e.start,e.allDay===true,'google',e.calendar||null)})),
  ...added.map(e=>({start:e.start,item:eventItem(e.title.slice(0,120),(e.local||e.start)+' / added in Open Swarm'+(e.location?' / '+e.location.slice(0,80):''),undefined,e.start,e.allDay,'oshal',null)}))]
  .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const read=shown.state==='live'||shown.state==='saved-copy',within=(days:number)=>String(merged.filter(m=>Date.parse(m.start)<now.getTime()+days*DAY_MS).length);
 const metrics:any[]=[{id:'upcoming-5d',label:'Events / 5d',value:read?within(5):NOT_READ[shown.state as GoogleDown]},{id:'upcoming-30d',label:'Events / 30d',value:read?within(30):NOT_READ[shown.state as GoogleDown]}];
 if(added.length)metrics.push({id:'own-upcoming',label:'Added in Open Swarm',value:String(added.length)});
 const items:any[]=merged.slice(0,3+Math.min(added.length,5)).map(e=>e.item);
 items.push({text:shown.note,fix:'calendar-review',tone:'neutral'});
 const partial=shown.state==='saved-copy'||Boolean(shown.live&&shown.live.unread.length);
 return {metrics,tiles:metrics,items,asOf:now.toISOString(),partial,google:googleBlock(shown)};
}

/**
 * @description The caller's own events for the summary. A read failure (for example before the own-events migration ran)
 * is logged and leaves the Google events standing.
 */
async function ownForSummary(ctx:AppContext, sub:string):Promise<OwnEvent[]> {
 try { return await readOwnEvents(ctx, sub); } catch (err) { log.error({ err }, 'Own calendar events unavailable for the summary'); return []; }
}

/** The saved copy, read only when Google did not answer; a failed read is logged and leaves the note saying Google did not answer. */
async function savedCopy(ctx:AppContext, sub:string):Promise<any> {
 try { const q=await ctx.pool.query({text:'SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = $1',values:[sub],query_timeout:1800} as any);return q.rows[0]||null; }
 catch (err) { log.error({ err }, 'Saved calendar copy unavailable for the summary'); return null; }
}

/**
 * @description GET /api/calendar/home-summary: read only, for the signed-in caller.
 * @param ctx - The application context.
 * @param options - `liveBudgetMs` shortens the Google budget for a test; the kernel mounts the factory with the context alone.
 * @returns The router.
 */
export function createHomeSummaryRoutes(ctx:AppContext, options:{liveBudgetMs?:number}={}):Router {
 const r=Router();r.get('/',async(req,res)=>{res.setHeader('Cache-Control','no-store');const o=(req as any).oidc,sub=o?.user?.sub;if(!sub||o?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
 try{const now=new Date(),own=await ownForSummary(ctx,String(sub));
  const google=await readGoogleLive(ctx,String(sub),{timeMin:now.toISOString(),timeMax:new Date(now.getTime()+30*DAY_MS).toISOString()},options.liveBudgetMs);
  const snapshot=google.state==='no-answer'?await savedCopy(ctx,String(sub)):null;
  res.json(calendarEvidence(snapshot,now,google,own));}
 catch(err){log.error({err},'Calendar home summary failed');res.status(503).json({error:'Calendar is unavailable right now.'});}});return r;
}
