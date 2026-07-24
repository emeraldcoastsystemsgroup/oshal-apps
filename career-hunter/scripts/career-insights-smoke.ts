/**
 * Verifies the career-graph INSIGHTS AQL against live ArangoDB using a synthetic model (no
 * better-sqlite3 needed — the host can't load its Linux-built native binary). ADR-045 jobs carve-out.
 * Run: ARANGO_URL=http://localhost:58529 ARANGO_ROOT_PASSWORD=oshal \
 *      npx ts-node -r tsconfig-paths/register scripts/career-insights-smoke.ts
 */
import { insights } from '@/app/routes/career-graph-routes';
import { createGraphConnector, type GraphNode, type GraphEdge } from '@/features/graph';

const nodes: GraphNode[] = [
  { id: 'me', labels: ['user'], props: {} },
  { id: 'skill:cicd', labels: ['skill'], props: { key: 'cicd' } },
  { id: 'skill:sre', labels: ['skill'], props: { key: 'sre' } },
  { id: 'company:1', labels: ['company'], props: { name: 'L3Harris', referral: 2 } },
  { id: 'company:2', labels: ['company'], props: { name: 'Abridge', referral: 0 } },
  { id: 'company:3', labels: ['company'], props: { name: 'Distyl', referral: 0 } },
  { id: 'industry:defense', labels: ['industry'], props: { name: 'Defense' } },
  { id: 'industry:ai', labels: ['industry'], props: { name: 'AI' } },
  { id: 'recruiter:1', labels: ['recruiter'], props: { firm: 'R1' } },
  { id: 'recruiter:2', labels: ['recruiter'], props: { firm: 'R2' } },
  { id: 'bucket:cleared', labels: ['bucket'], props: { name: 'Cleared / GovTech' } },
  { id: 'bucket:exec', labels: ['bucket'], props: { name: 'Exec Search' } },
];
const edges: GraphEdge[] = [
  { from: 'me', to: 'skill:cicd', type: 'gap', props: { n_jobs: 14640, avg_fit: 40 } },
  { from: 'me', to: 'skill:sre', type: 'gap', props: { n_jobs: 7784, avg_fit: 45 } },
  { from: 'me', to: 'company:1', type: 'fit', props: { score: 92 } },
  { from: 'me', to: 'company:2', type: 'fit', props: { score: 88 } },
  { from: 'me', to: 'company:3', type: 'fit', props: { score: 80 } },
  { from: 'me', to: 'company:1', type: 'applied' },
  { from: 'company:1', to: 'industry:defense', type: 'in_industry' },
  { from: 'company:2', to: 'industry:ai', type: 'in_industry' },
  { from: 'company:3', to: 'industry:defense', type: 'in_industry' },
  { from: 'recruiter:1', to: 'bucket:cleared', type: 'in_bucket' },
  { from: 'recruiter:2', to: 'bucket:exec', type: 'in_bucket' },
];

async function main(): Promise<void> {
  const c = createGraphConnector();
  if (!c) throw new Error('connector null — ARANGO_URL not set');
  const g = await c.getPersonGraph('career-insights-smoke');
  await g.upsertNodes(nodes);
  await g.upsertEdges(edges);
  console.log(JSON.stringify(await insights(g), null, 2));
}
main().then(() => process.exit(0)).catch((err) => { console.error('INSIGHTS SMOKE FAIL:', err); process.exit(1); });
