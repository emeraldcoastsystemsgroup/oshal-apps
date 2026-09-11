/** Saved game-show evidence. GET is owner-scoped, bounded, and side-effect free. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const clip = (v: unknown, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0,cap);
const date = (v: unknown) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
export function createHomeSummaryRoutes(ctx: AppContext): Router {
 const router = Router();
 router.get('/', async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  const oidc = (req as any).oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
  if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({error:'not_authenticated'}); return; }
  const now = new Date();
  const result = await Promise.allSettled([
  "SELECT count(*) FILTER(WHERE status='lobby')::text AS lobby,count(*) FILTER(WHERE status='live')::text AS live,count(*) FILTER(WHERE status='ended' AND updated_at>$2::timestamptz-interval '120 hours')::text AS ended FROM gameshow_rooms WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
  "SELECT name,show_id,status,updated_at FROM gameshow_rooms WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,room_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"lobby","hosted-lobbies","Hosted lobbies"],[0,"live","hosted-live","Hosted live sessions"],[0,"ended","ended-updated-5d","Ended rooms updated/5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"game-show-stage",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(1).forEach(r=>item(r.name||r.show_id,clip(r.status)+' / updated '+date(r.updated_at),'Game format: '+clip(r.show_id)+'. This is your hosted room state; it does not establish current player presence. Review plans for the next gathering.', ['plan-meal','prepare-document']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"game-show-stage"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"game-show-stage"});
  items.push({text:"Counts caller-hosted rooms by persisted lobby/live/ended state; live does not mean a connected player. Ended rooms updated within five days is not a completion timestamp. Plan refreshments or a host brief without starting a game, changing scores or exposing join codes or camera frames.",tone:'neutral',fix:"game-show-stage"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
