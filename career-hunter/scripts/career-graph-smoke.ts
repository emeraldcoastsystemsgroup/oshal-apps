/**
 * Career-graph carve-out smoke test (ADR-045 jobs) — runs the REAL ingest + insights against the
 * live career-hunter sqlite + a live ArangoDB. Not part of the build (outside src/).
 * Run: CG_USER=.cg-smoke/user.db CG_CORPUS=.cg-smoke/corpus.db \
 *      ARANGO_URL=http://localhost:58529 ARANGO_ROOT_PASSWORD=oshal \
 *      npx ts-node -r tsconfig-paths/register scripts/career-graph-smoke.ts
 */
import { buildModel, insights } from '@/app/routes/career-graph-routes';
import { createGraphConnector } from '@/features/graph';

async function main(): Promise<void> {
  const userPath = process.env.CG_USER as string;
  const corpusPath = process.env.CG_CORPUS as string;
  const { nodes, edges } = buildModel(userPath, corpusPath);
  const c = createGraphConnector();
  if (!c) throw new Error('connector null — ARANGO_URL not set');
  const g = await c.getPersonGraph('career-smoke-user');
  const n = await g.upsertNodes(nodes);
  const e = await g.upsertEdges(edges);
  console.log(`model: ${nodes.length} nodes / ${edges.length} edges  →  ingested ${n} / ${e}`);
  console.log(JSON.stringify(await insights(g), null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error('CAREER-GRAPH SMOKE FAIL:', err); process.exit(1); });
