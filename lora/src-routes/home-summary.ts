/** Saved lora evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*)::text AS characters FROM oshal_lora_characters WHERE owner_sub = $1 AND created_at <= $2",
  "SELECT count(*) FILTER (WHERE m.status IN ('queued','training'))::text AS active, count(*) FILTER (WHERE m.status='failed')::text AS failed FROM oshal_lora_models m JOIN oshal_lora_characters c ON c.id=m.character_id WHERE c.owner_sub = $1 AND c.created_at <= $2 AND m.created_at <= $2",
  "SELECT c.display_name, c.active_version, m.version, m.status, m.created_at, s.overall::text, s.created_at AS evaluated_at FROM oshal_lora_characters c LEFT JOIN LATERAL (SELECT version, status, created_at FROM oshal_lora_models m WHERE m.character_id=c.id AND m.created_at <= $2 ORDER BY version DESC LIMIT 1) m ON true LEFT JOIN oshal_lora_scores s ON s.character_id=c.id AND s.version=m.version AND s.created_at <= $2 WHERE c.owner_sub = $1 AND c.created_at <= $2 ORDER BY c.created_at DESC, c.id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"characters","characters","Saved characters"],[1,"active","training-active","Queued / training"],[1,"failed","training-failed","Failed versions"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"lora-studio",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r => item(r.display_name, r.version == null ? 'No saved model version' : 'Latest version ' + clip(r.version) + ' · ' + clip(r.status) + ' · registered ' + date(r.created_at), 'Active version: ' + clip(r.active_version ?? 'none') + '. Latest-version evaluation: ' + (r.overall == null ? 'not recorded' : clip(r.overall) + ' on a 0–1 scale at ' + date(r.evaluated_at)) + '. Registration is not a training completion timestamp.', ['prepare-document']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"lora-studio"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"lora-studio"});
  items.push({text:"Character ownership also scopes model and score rows. The latest registered model and its matching evaluation remain separate from the active version. No GPU dispatch or model promotion runs on Home; prepare a model card from recorded evidence.",tone:'neutral',fix:"lora-studio"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
