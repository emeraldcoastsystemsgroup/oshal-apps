/**
 * TMDB client — thin, key-in helpers for the Movies & TV concierge.
 *
 * The Movie Database (themoviedb.org) is a free, rich catalog API: search, trending,
 * details, trailers, recommendations, and "where to watch" (JustWatch streaming-provider
 * data). This module normalizes TMDB's verbose objects into the small shapes the surface +
 * concierge use (titles, where-to-watch, trailer). Pure read over HTTP — no storage.
 *
 * Auth: the key is EITHER a v3 API key (sent as ?api_key=) OR a v4 read access token (a JWT,
 * sent as Authorization: Bearer). We detect which by shape so the operator can paste either.
 *
 * Handoffs: TMDB returns a JustWatch aggregate "link" for where-to-watch (not per-provider
 * deep links), so "Watch" opens that page; movie tickets are a separate Fandango deep link
 * (buildTicketsUrl). OSHAL never streams or sells — discovery here, the viewer acts there.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-20 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — searchMulti, trending,
 *            | details (+ where-to-watch + trailer), recommendations. v3-key / v4-token aware.
 * 2026-06-21 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-065: route HTTP through the shared
 *            | ConnectorClient runtime (retries, rate-limit, structured errors). Same public API +
 *            | output shapes; the movies surface is unchanged. /api/connectors/tmdb is now canonical.
 * ---------------------------------------------------------------------------
 * @module tmdb-client
 */

import { ConnectorClient } from '@/app/connectors/runtime';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const REGION = process.env.MOVIES_REGION || 'US';

export interface TmdbTitle {
  id: number;
  mediaType: 'movie' | 'tv';
  key: string;            // composite "movie:603" — stable id the concierge references
  title: string;
  year: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number;         // vote_average (0–10)
  genres: string[];
  tmdbUrl: string;        // themoviedb.org page (deep link)
}

export interface WhereToWatch {
  link: string | null;                 // JustWatch aggregate page for the region
  flatrate: Array<{ name: string; logoUrl: string | null }>;  // subscription streaming
  rent: Array<{ name: string; logoUrl: string | null }>;
  buy: Array<{ name: string; logoUrl: string | null }>;
}

/** A v4 read-access token is a JWT (`eyJ…`, sent as Bearer); else it's a v3 key (`?api_key=`). Exported for tests. */
export const isV4 = (key: string) => String(key).startsWith('eyJ');

/**
 * Authenticated TMDB GET → parsed JSON. Routed through the shared ConnectorClient (ADR-065) so it
 * inherits retries/backoff, the rate-limit governor, and a structured ConnectorError (which still
 * carries `.status`). v4 token → Bearer; v3 key → ?api_key=. Same return shape as before.
 */
async function get(key: string, pathAndQuery: string): Promise<any> {
  const client = new ConnectorClient({
    provider: 'tmdb',
    baseUrl: BASE,
    auth: isV4(key)
      ? { type: 'bearer', token: async () => key }
      : { type: 'apiKeyQuery', param: 'api_key', value: key },
    rateLimit: { burst: 20, perSecond: 20 },
    retry: { maxRetries: 3, honorRetryAfter: true },
  });
  return client.request(pathAndQuery); // pathAndQuery includes its own query; appended verbatim
}

function img(path: string | null | undefined, size: string): string | null {
  return path ? `${IMG}/${size}${path}` : null;
}

export function normTitle(r: any, forceType?: 'movie' | 'tv'): TmdbTitle | null {
  const mediaType: 'movie' | 'tv' = (forceType || r?.media_type || (r?.title ? 'movie' : 'tv')) as any;
  if (mediaType !== 'movie' && mediaType !== 'tv') return null; // skip person results
  const id = Number(r?.id || 0);
  if (!id) return null;
  const name = String(r?.title || r?.name || 'Untitled');
  const date = String(r?.release_date || r?.first_air_date || '');
  return {
    id, mediaType, key: `${mediaType}:${id}`, title: name,
    year: date ? date.slice(0, 4) : '',
    overview: String(r?.overview || ''),
    posterUrl: img(r?.poster_path, 'w342'),
    backdropUrl: img(r?.backdrop_path, 'w780'),
    rating: Math.round((Number(r?.vote_average) || 0) * 10) / 10,
    genres: Array.isArray(r?.genres) ? r.genres.map((g: any) => g?.name).filter(Boolean)
      : Array.isArray(r?.genre_ids) ? [] : [],
    tmdbUrl: `https://www.themoviedb.org/${mediaType}/${id}`,
  };
}

/** Multi-search across movies + TV (the concierge's discovery primitive). */
export async function tmdbSearch(key: string, query: string, limit = 18): Promise<TmdbTitle[]> {
  const q = String(query || '').trim();
  if (!q) return [];
  const j = await get(key, `/search/multi?include_adult=false&query=${encodeURIComponent(q)}`);
  return (j?.results || []).map((r: any) => normTitle(r)).filter(Boolean).slice(0, limit) as TmdbTitle[];
}

/** Trending this week across movies + TV — the default "what's hot" view. */
export async function tmdbTrending(key: string, limit = 18): Promise<TmdbTitle[]> {
  const j = await get(key, `/trending/all/week`);
  return (j?.results || []).map((r: any) => normTitle(r)).filter(Boolean).slice(0, limit) as TmdbTitle[];
}

/** Full details for one title (genres, runtime) — used on the detail panel. */
export async function tmdbDetails(key: string, mediaType: 'movie' | 'tv', id: number): Promise<TmdbTitle | null> {
  const j = await get(key, `/${mediaType}/${id}`);
  return normTitle(j, mediaType);
}

/** Where to stream/rent/buy in the region (JustWatch data via TMDB). */
export async function tmdbWhereToWatch(key: string, mediaType: 'movie' | 'tv', id: number): Promise<WhereToWatch> {
  const j = await get(key, `/${mediaType}/${id}/watch/providers`);
  const region = j?.results?.[REGION] || {};
  const map = (arr: any[]) => (arr || []).map((p: any) => ({ name: String(p?.provider_name || ''), logoUrl: img(p?.logo_path, 'w92') })).filter((p: any) => p.name);
  return {
    link: region.link || null,
    flatrate: map(region.flatrate),
    rent: map(region.rent),
    buy: map(region.buy),
  };
}

/** The best YouTube trailer URL for a title, or null. */
export async function tmdbTrailer(key: string, mediaType: 'movie' | 'tv', id: number): Promise<string | null> {
  const j = await get(key, `/${mediaType}/${id}/videos`);
  const vids = (j?.results || []).filter((v: any) => v?.site === 'YouTube');
  const pick = vids.find((v: any) => v?.type === 'Trailer' && v?.official)
    || vids.find((v: any) => v?.type === 'Trailer')
    || vids.find((v: any) => v?.type === 'Teaser') || vids[0];
  return pick?.key ? `https://www.youtube.com/watch?v=${pick.key}` : null;
}

/** Similar/recommended titles for a given title. */
export async function tmdbRecommendations(key: string, mediaType: 'movie' | 'tv', id: number, limit = 12): Promise<TmdbTitle[]> {
  const j = await get(key, `/${mediaType}/${id}/recommendations`);
  return (j?.results || []).map((r: any) => normTitle(r, mediaType)).filter(Boolean).slice(0, limit) as TmdbTitle[];
}

/**
 * Deep-link to buy movie tickets — a Fandango search for the title (no clean consumer
 * ticketing API, so this is a handoff the viewer completes on Fandango). Optional location
 * sharpens the search. Works for any movie title.
 */
export function buildTicketsUrl(title: string, location?: string): string {
  const q = [title, location].filter(Boolean).join(' ');
  return `https://www.fandango.com/search?q=${encodeURIComponent(q)}`;
}
