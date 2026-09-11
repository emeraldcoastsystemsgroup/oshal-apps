import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { GoogleCalendarService } from '@/features/google-calendar/services/google-calendar-service';
/** Explicit sync uses only the caller's Google credentials; no deployment token fallback. */
export function createCalendarSyncRoutes(ctx:AppContext):Router {
 const r=Router();r.post('/',async(req,res)=>{
 const o=(req as any).oidc,sub=o?.user?.sub;if(!sub||o?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
 if(req.body?.confirm!==true){res.status(400).json({error:'Confirm calendar sync'});return;}
 try{
 const token=await getValidAccessToken(ctx.pool,sub,'google');if(!token){res.status(409).json({error:'Connect Google in Identity with Calendar read access, then retry.'});return;}
 const service=new GoogleCalendarService(async()=>token),now=new Date();
 const events=(await service.listUpcoming({calendarId:'primary',timeMin:now.toISOString(),timeMax:new Date(now.getTime()+30*86400000).toISOString(),maxResults:250})).slice(0,250).map(e=>({id:e.id,title:e.summary.slice(0,120),start:e.start,end:e.end,allDay:e.allDay,url:e.htmlLink}));
 await ctx.pool.query('INSERT INTO calendar_preparation_snapshots(user_sub,events,synced_at) VALUES($1,$2,$3) ON CONFLICT(user_sub) DO UPDATE SET events=EXCLUDED.events,synced_at=EXCLUDED.synced_at WHERE calendar_preparation_snapshots.synced_at<=EXCLUDED.synced_at',[sub,JSON.stringify(events),now]);
 res.json({ok:true,count:events.length,syncedAt:now.toISOString(),coverage:'Primary calendar, next 30 days, at most 250 events'});
 }catch{res.status(502).json({error:'Calendar sync failed. Check Google Calendar access and retry; the previous snapshot was retained.'});}
 });return r;
}
