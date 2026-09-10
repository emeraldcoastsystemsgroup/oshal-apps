/** Saved shared-world evidence for Home. No ingest, classification, schema creation or AI calls. */
import { Router } from 'express';
import { createWorldIntelligenceService, DEFAULT_WORLD_TOPICS } from '@/features/world-data';

// App policy: broad baseline news, not whichever sports fixture was refreshed last.
const briefingSubjects = DEFAULT_WORLD_TOPICS.map(s => s.entity);
const ventureSubjects = new Set(['world:topic:artificial-intelligence', 'world:topic:technology', 'world:topic:healthcare', 'world:topic:energy-oil']);
function ventureCandidate(row: any): boolean {
  // A conservative navigation aid, not an inferred investment opportunity or recommendation.
  const title = text(row.title, 1000);
  return ventureSubjects.has(row.entity) && !!sourceUrl(row.link)
    && /\b(startups?|funding|launch(?:es|ed)?|product|platform|commercial|manufactur\w*|technology|innovation|breakthrough|research)\b/i.test(title)
    && !/\b(kill\w*|murder\w*|court|arrest\w*|death|died|war|shoot\w*|football|basketball|NFL|NCAA|playoffs?|touchdown)\b/i.test(title);
}

const text = (value: unknown, cap = 400) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, cap);
function sourceUrl(value: unknown): string | undefined {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function articleKey(row: any): string {
  const link = sourceUrl(row.link);
  if (!link) return `${text(row.outlet)}:${text(row.title)}`.toLowerCase();
  const url = new URL(link); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function date(value: unknown): string {
  const at = new Date(String(value));
  return Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(at) : 'date unknown';
}

export function createHomeSummaryRoutes(): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const oidc = (req as any).oidc;
    if (!oidc?.user?.sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const service = createWorldIntelligenceService();
    if (!service) { res.status(503).json({ error: 'world_archive_unavailable' }); return; }
    try {
      const snapshot = await service.coverageSnapshot(briefingSubjects);
      const coverage = snapshot.coverage;
      const metrics = [
        { id: 'fetched-24h', label: 'Fetched / 24h', value: coverage?.fetched ?? 'Unavailable' },
        { id: 'new-subject-items-24h', label: 'New subject items / 24h', value: coverage?.new_subject_items ?? 'Unavailable' },
        { id: 'subjects-24h', label: 'Subjects pulled / 24h', value: coverage?.subjects ?? 'Unavailable' },
        { id: 'pulls-24h', label: 'Feed pulls / 24h', value: coverage?.pulls ?? 'Unavailable' },
      ];
      const seen = new Set<string>(), topics = new Set<string>();
      const asOf = new Date(snapshot.at).getTime();
      const articles = [...(snapshot.articles ?? [])].filter(row => {
        const published = new Date(row.pub_date).getTime();
        return briefingSubjects.includes(row.entity) && Number.isFinite(published) && published <= asOf && published > asOf - 48 * 3600_000;
      }).sort((a, b) => new Date(b.pub_date).getTime() - new Date(a.pub_date).getTime()).filter(row => {
        const key = articleKey(row);
        if (seen.has(key) || topics.has(row.entity) || !text(row.title)) return false;
        seen.add(key); topics.add(row.entity); return true;
      }).slice(0, 3);
      const items: Record<string, unknown>[] = articles.map(row => {
        const link = sourceUrl(row.link);
        const title = text(row.title, 120);
        const description = text(row.description, 240);
        const headline = text(row.title, 240).replace(/\s+-\s+[^-]+$/, '');
        const excerpt = description.startsWith(headline) ? '' : description;
        const detail = text(`${row.outlet || 'Source unknown'} · ${row.label || row.entity} · Published ${date(row.pub_date)}. ${excerpt}`);
        return { text: title, detail, sourceUrl: link, tone: 'neutral', fix: 'world-dashboard',
          actions: [
            { integration: 'prepare-document', context: { title, notes: detail, ...(link ? { sourceUrl: link } : {}) } },
            ...(ventureCandidate(row) ? [
              { integration: 'explore-venture', context: { title, notes: detail, sourceUrl: link } },
              { integration: 'prepare-campaign', context: { title, notes: detail, sourceUrl: link } },
              { integration: 'review-sales', context: { title, notes: detail, sourceUrl: link } },
            ] : []),
          ],
          ...(ventureCandidate(row) ? { integration: 'explore-venture', context: { title, notes: detail, sourceUrl: link } } : {}) };
      });
      const upcoming = snapshot.events?.[0];
      if (upcoming) items.push({ text: text(`Upcoming: ${upcoming.title || upcoming.event_type}`, 120),
        detail: `Recorded event · ${text(upcoming.entity_id)} · ${date(upcoming.scheduled_at)} · ${text(upcoming.source)}`,
        highlight: true, tone: 'neutral', fix: 'world-dashboard' });
      const missing = [!coverage && 'coverage', snapshot.articles === null && 'headlines', snapshot.events === null && 'events'].filter(Boolean);
      items.push({ text: missing.length ? `Cannot check ${missing.join(', ')}.` : articles.length ? 'Published within 48 hours · three-topic coverage sample.' : 'No articles published in the last 48 hours in this coverage sample.',
        detail: 'Samples the latest 100 saved items per baseline topic; excludes old or unknown publication dates. Fetched includes repeat pulls; new subject items may repeat articles across subjects. Counts are not distinct events.' + (coverage?.last_pull ? ` Last pull: ${date(coverage.last_pull)}.` : ''),
        tone: missing.length ? 'warn' : 'neutral', fix: 'world-dashboard' });
      res.status(missing.length === 3 ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: snapshot.at, partial: missing.length > 0 });
    } catch { res.status(503).json({ error: 'world_archive_unavailable' }); }
  });
  return router;
}
