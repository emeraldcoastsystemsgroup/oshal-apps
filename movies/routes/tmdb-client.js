"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isV4 = void 0;
exports.normTitle = normTitle;
exports.tmdbSearch = tmdbSearch;
exports.tmdbTrending = tmdbTrending;
exports.tmdbDetails = tmdbDetails;
exports.tmdbWhereToWatch = tmdbWhereToWatch;
exports.tmdbTrailer = tmdbTrailer;
exports.tmdbRecommendations = tmdbRecommendations;
exports.buildTicketsUrl = buildTicketsUrl;
const runtime_1 = require("@/app/connectors/runtime");
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const REGION = process.env.MOVIES_REGION || 'US';
/** A v4 read-access token is a JWT (`eyJ…`, sent as Bearer); else it's a v3 key (`?api_key=`). Exported for tests. */
const isV4 = (key) => String(key).startsWith('eyJ');
exports.isV4 = isV4;
/**
 * Authenticated TMDB GET → parsed JSON. Routed through the shared ConnectorClient (ADR-065) so it
 * inherits retries/backoff, the rate-limit governor, and a structured ConnectorError (which still
 * carries `.status`). v4 token → Bearer; v3 key → ?api_key=. Same return shape as before.
 */
async function get(key, pathAndQuery) {
    const client = new runtime_1.ConnectorClient({
        provider: 'tmdb',
        baseUrl: BASE,
        auth: (0, exports.isV4)(key)
            ? { type: 'bearer', token: async () => key }
            : { type: 'apiKeyQuery', param: 'api_key', value: key },
        rateLimit: { burst: 20, perSecond: 20 },
        retry: { maxRetries: 3, honorRetryAfter: true },
    });
    return client.request(pathAndQuery); // pathAndQuery includes its own query; appended verbatim
}
function img(path, size) {
    return path ? `${IMG}/${size}${path}` : null;
}
function normTitle(r, forceType) {
    const mediaType = (forceType || r?.media_type || (r?.title ? 'movie' : 'tv'));
    if (mediaType !== 'movie' && mediaType !== 'tv')
        return null; // skip person results
    const id = Number(r?.id || 0);
    if (!id)
        return null;
    const name = String(r?.title || r?.name || 'Untitled');
    const date = String(r?.release_date || r?.first_air_date || '');
    return {
        id, mediaType, key: `${mediaType}:${id}`, title: name,
        year: date ? date.slice(0, 4) : '',
        overview: String(r?.overview || ''),
        posterUrl: img(r?.poster_path, 'w342'),
        backdropUrl: img(r?.backdrop_path, 'w780'),
        rating: Math.round((Number(r?.vote_average) || 0) * 10) / 10,
        genres: Array.isArray(r?.genres) ? r.genres.map((g) => g?.name).filter(Boolean)
            : Array.isArray(r?.genre_ids) ? [] : [],
        tmdbUrl: `https://www.themoviedb.org/${mediaType}/${id}`,
    };
}
/** Multi-search across movies + TV (the concierge's discovery primitive). */
async function tmdbSearch(key, query, limit = 18) {
    const q = String(query || '').trim();
    if (!q)
        return [];
    const j = await get(key, `/search/multi?include_adult=false&query=${encodeURIComponent(q)}`);
    return (j?.results || []).map((r) => normTitle(r)).filter(Boolean).slice(0, limit);
}
/** Trending this week across movies + TV — the default "what's hot" view. */
async function tmdbTrending(key, limit = 18) {
    const j = await get(key, `/trending/all/week`);
    return (j?.results || []).map((r) => normTitle(r)).filter(Boolean).slice(0, limit);
}
/** Full details for one title (genres, runtime) — used on the detail panel. */
async function tmdbDetails(key, mediaType, id) {
    const j = await get(key, `/${mediaType}/${id}`);
    return normTitle(j, mediaType);
}
/** Where to stream/rent/buy in the region (JustWatch data via TMDB). */
async function tmdbWhereToWatch(key, mediaType, id) {
    const j = await get(key, `/${mediaType}/${id}/watch/providers`);
    const region = j?.results?.[REGION] || {};
    const map = (arr) => (arr || []).map((p) => ({ name: String(p?.provider_name || ''), logoUrl: img(p?.logo_path, 'w92') })).filter((p) => p.name);
    return {
        link: region.link || null,
        flatrate: map(region.flatrate),
        rent: map(region.rent),
        buy: map(region.buy),
    };
}
/** The best YouTube trailer URL for a title, or null. */
async function tmdbTrailer(key, mediaType, id) {
    const j = await get(key, `/${mediaType}/${id}/videos`);
    const vids = (j?.results || []).filter((v) => v?.site === 'YouTube');
    const pick = vids.find((v) => v?.type === 'Trailer' && v?.official)
        || vids.find((v) => v?.type === 'Trailer')
        || vids.find((v) => v?.type === 'Teaser') || vids[0];
    return pick?.key ? `https://www.youtube.com/watch?v=${pick.key}` : null;
}
/** Similar/recommended titles for a given title. */
async function tmdbRecommendations(key, mediaType, id, limit = 12) {
    const j = await get(key, `/${mediaType}/${id}/recommendations`);
    return (j?.results || []).map((r) => normTitle(r, mediaType)).filter(Boolean).slice(0, limit);
}
/**
 * Deep-link to buy movie tickets — a Fandango search for the title (no clean consumer
 * ticketing API, so this is a handoff the viewer completes on Fandango). Optional location
 * sharpens the search. Works for any movie title.
 */
function buildTicketsUrl(title, location) {
    const q = [title, location].filter(Boolean).join(' ');
    return `https://www.fandango.com/search?q=${encodeURIComponent(q)}`;
}
//# sourceMappingURL=tmdb-client.js.map