/** Saved sports-edge evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*)::text AS teams FROM sports_followed_teams WHERE user_sub = $1 AND created_at<=$2",
  "SELECT count(*)::text AS leagues FROM sports_fantasy_leagues WHERE user_sub = $1 AND linked_at<=$2",
  "SELECT count(*) FILTER(WHERE settled=false)::text AS pending,count(*) FILTER(WHERE settled=true AND graded_at<=$2 AND graded_at>$2::timestamptz-interval '120 hours')::text AS graded FROM sports_fantasy_calls WHERE user_sub = $1 AND created_at<=$2",
  "SELECT p.league,p.home_team,p.away_team,p.game_date,p.generated_at FROM sports_previews p WHERE p.generated_at<=$2 AND p.game_date>=$2 AND p.game_date<=$2::timestamptz+interval '7 days' AND EXISTS(SELECT 1 FROM sports_followed_teams f WHERE f.user_sub = $1 AND f.created_at<=$2 AND f.league=p.league AND f.team IN (p.home_team,p.away_team)) ORDER BY p.game_date,p.event_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"teams","followed-teams","Followed teams"],[1,"leagues","fantasy-leagues","Saved fantasy leagues"],[2,"pending","calls-ungraded","Ungraded fantasy calls"],[2,"graded","graded-5d","Fantasy calls graded/5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"sports-edge-home",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(3).forEach(r=>item(clip(r.away_team)+' at '+clip(r.home_team),clip(r.league)+' / scheduled '+date(r.game_date),'Cached preview built '+date(r.generated_at)+'. Confirm the current schedule, venue, availability and travel needs before making plans. This is a saved sports preview, not a betting recommendation or a ticket booking.', ['plan-meal','plan-trip']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"sports-edge-home"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"sports-edge-home"});
  items.push({text:"Shows the caller's followed teams, linked fantasy leagues and saved fantasy-call grading state. Upcoming cached previews must match a followed team; preview time remains visible because schedules can change. Prepare a watch-party meal or trip discussion, without refreshing odds, placing bets, adjusting fantasy lineups or booking travel.",tone:'neutral',fix:"sports-edge-home"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
