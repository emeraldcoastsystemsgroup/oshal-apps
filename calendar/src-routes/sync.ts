/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve optional sync dependencies only after authentication and explicit confirmation so independent screens remain available.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Native kernel: with OSHAL_EGRESS=kernel the sync reads the primary calendar through the global fetch with no token; the kernel applies the caller's google-calendar connection declared in the manifest egress block. A refusal for a missing connection, or a 401/403 from Google, answers the same 409 as a missing token. The legacy broker + GoogleCalendarService path is unchanged elsewhere.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
const log = createChildLogger({ module: 'calendar.sync' });
const CALENDAR_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_EVENTS = 250;
const NOT_CONNECTED = 'Connect Google in Identity with Calendar read access, then retry.';
/** One stored snapshot row: the minimized event shape the screens and briefs read. */
export interface CalendarRow { id: string; title: string; start: string | null; end: string | null; allDay: boolean; url: string | null }

/**
 * @description True inside the native kernel's package sandbox, where the manifest's egress declaration carries the Google credential.
 * @returns Whether requests go through the kernel egress.
 */
export function kernelEgress(): boolean {
 return process.env.OSHAL_EGRESS === 'kernel';
}

/**
 * @description Map one Calendar API event onto the stored row, exactly as the framework's GoogleCalendarService normalized it
 * (untitled fallback, dateTime before date, all-day only for date-only starts); description and attendees never leave this function.
 * @param e - A Calendar API v3 event resource.
 * @returns The minimized snapshot row.
 */
export function calendarRow(e: any): CalendarRow {
 return { id: String(e?.id || ''), title: String(e?.summary || '(untitled)').slice(0, 120), start: e?.start?.dateTime || e?.start?.date || null,
  end: e?.end?.dateTime || e?.end?.date || null, allDay: !!e?.start?.date && !e?.start?.dateTime, url: e?.htmlLink || null };
}

/**
 * @description Read the primary calendar's single instances in the window through the kernel egress. The package sends no
 * Authorization header: the kernel applies the caller's declared google-calendar connection, renewing it when needed.
 * @param timeMin - ISO window start.
 * @param timeMax - ISO window end.
 * @returns Rows, or null when the caller has no usable Google connection (kernel refusal, 401 or 403).
 */
export async function kernelPrimaryEvents(timeMin: string, timeMax: string): Promise<CalendarRow[] | null> {
 const query = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(MAX_EVENTS) });
 let res: Response;
 try { res = await fetch(`${CALENDAR_EVENTS}?${query.toString()}`, { headers: { accept: 'application/json' } }); }
 catch (err) { if (/not connected/i.test(String((err as Error)?.message || ''))) return null; throw err; }
 if (res.status === 401 || res.status === 403) return null;
 if (!res.ok) throw Object.assign(new Error(`google calendar answered HTTP ${res.status}`), { status: res.status });
 const data: any = await res.json();
 return (Array.isArray(data?.items) ? data.items : []).slice(0, MAX_EVENTS).map(calendarRow);
}

/** Legacy framework path: the caller's brokered Google token and the framework Calendar service. */
async function legacyPrimaryEvents(ctx: AppContext, sub: string, timeMin: string, timeMax: string): Promise<CalendarRow[] | null> {
 const { getValidAccessToken } = require('@/app/routes/connectors-routes') as typeof import('@/app/routes/connectors-routes');
 const { GoogleCalendarService } = require('@/features/google-calendar') as typeof import('@/features/google-calendar');
 const token = await getValidAccessToken(ctx.pool, sub, 'google'); if (!token) return null;
 const service = new GoogleCalendarService(async () => token);
 return (await service.listUpcoming({ calendarId: 'primary', timeMin, timeMax, maxResults: MAX_EVENTS })).slice(0, MAX_EVENTS)
  .map(e => ({ id: e.id, title: e.summary.slice(0, 120), start: e.start, end: e.end, allDay: e.allDay, url: e.htmlLink }));
}

/** Explicit sync uses only the caller's Google credentials; no deployment token fallback. */
export function createCalendarSyncRoutes(ctx:AppContext):Router {
 const r=Router();r.post('/',async(req,res)=>{
 const o=(req as any).oidc,sub=o?.user?.sub;if(!sub||o?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
 if(req.body?.confirm!==true){res.status(400).json({error:'Confirm calendar sync'});return;}
 try{
 const now=new Date(),timeMin=now.toISOString(),timeMax=new Date(now.getTime()+30*86400000).toISOString();
 const events=kernelEgress()?await kernelPrimaryEvents(timeMin,timeMax):await legacyPrimaryEvents(ctx,sub,timeMin,timeMax);
 if(!events){res.status(409).json({error:NOT_CONNECTED});return;}
 await ctx.pool.query('INSERT INTO calendar_preparation_snapshots(user_sub,events,synced_at) VALUES($1,$2,$3) ON CONFLICT(user_sub) DO UPDATE SET events=EXCLUDED.events,synced_at=EXCLUDED.synced_at WHERE calendar_preparation_snapshots.synced_at<=EXCLUDED.synced_at',[sub,JSON.stringify(events),now]);
 res.json({ok:true,count:events.length,syncedAt:now.toISOString(),coverage:'Primary calendar, next 30 days, at most 250 events'});
 }catch(err){log.error({ err }, 'Calendar sync failed');res.status(502).json({error:'Calendar sync failed. Check Google Calendar access and retry; the previous snapshot was retained.'});}
 });return r;
}
