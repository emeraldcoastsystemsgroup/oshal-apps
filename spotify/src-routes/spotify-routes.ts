/**
 * Spotify Routes — Spotify Concierge surface API
 *
 * Backs the Spotify surface at /cockpit?app=spotify. The framework way:
 *  - DISCOVERY (search, now-playing, the user's playlists, top tracks) and the ACTION
 *    (build a playlist on the user's account) run against the real Spotify Web API with the
 *    caller's OWN brokered token (getValidAccessToken) — no keys in env/compose beyond the
 *    OAuth client. Unlike Uber/Walmart, Spotify HAS a rich consumer API, so this isn't a
 *    curated catalog; it's the user's live Spotify.
 *  - PLAYBACK is the only handoff: pressing play needs Premium + the Web Playback SDK, so the
 *    surface deep-links open.spotify.com and the user plays in their own Spotify app.
 *  - The BRAIN runs on the spotify-concierge bot via ctx.orchestrator (the caller's configured
 *    provider/model), NOT a hardcoded LLM call here. Candidates come from a live search.
 *  - Profile / chat persist per-user in the DB.
 *
 * Per-user isolation: every row + every Spotify call is scoped by the OIDC `sub`.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-20 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Spotify
 *            | concierge: live Web API discovery, build-a-playlist action, deep-link play
 *            | handoff, brain via the orchestrator. Mirrors the eats concierge, music-shaped.
 * 2026-07-18 10:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the
 *            | spotify store package (Wave 2 #2) — first packaged service-or-oidc mount (D2).
 *            | Standard (ctx) factory; surface serves from this package's tools/
 *            | (ctx.appPackageDir); core-remaining relative imports rewritten to @/app/routes
 *            | aliases; spotify-client STAYS CORE (the platform spotify connector runtime imports it — shared-slice rule) and resolves via the @/app/routes alias. ensureSpotifySchema now
 *            | appends buildOwnerRlsPolicyStatements per table (A1.2 chokepoint — was covered
 *            | only by migration 060 on fresh DBs). The spotify-concierge REAL bot-node
 *            | (spotify-bot container / registries / personas / spotifyToolKit.js /
 *            | oshal-spotify.js) stays core per ADR-093 interim. Logic unchanged.
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove Spotify credentials from generic orchestrator dispatch. Spotify Web API calls stay controller-side through getValidAccessToken and the model receives only bounded profile, track, playlist, and playback records.
 *
 * @module spotify-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import type { AppContext } from '@/app/composition/app-context';
import type { Pool } from 'pg';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import {
  spotifyMe, spotifySearchTracks, spotifyNowPlaying, spotifyMyPlaylists,
  spotifyTopTracks, spotifyCreatePlaylist, type SpotifyTrack,
} from '@/app/routes/spotify-client';
import { extractEnvelopeJson, asStringArray, sayOr } from '@/app/routes/concierge-envelope';
import { ConciergeStore } from '@/app/routes/concierge-store';

const logger = createChildLogger({ module: 'spotify-routes' });

/** The spotify-concierge agent (seeded by migration 047; inline bot run via the orchestrator). */
const CONCIERGE_AGENT_ID = 'b00a0000-0000-0000-0000-000000000001';

/** Serve a static surface file from the package's tools dir (ctx.appPackageDir — D10). */
function serveFile(surfaceDir: string, fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    const filePath = path.join(surfaceDir, fileName);
    res.sendFile(filePath, (err: unknown) => {
      if (err) {
        logger.error({ err, fileName }, `Failed to serve ${fileName}`);
        res.status(404).send(`Page not found: ${fileName}`);
      }
    });
  };
}

/** The authenticated listener, resolved from the OIDC session (never client-supplied). */
function resolveListenerSub(req: Request): string {
  const trustedSub = getTrustedServiceUserSub(req);
  if (trustedSub) return trustedSub;
  const oidc = (req as any).oidc;
  if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
    const u = oidc.user || {};
    const sub = u.sub || u.oid;
    if (sub) return String(sub);
  }
  if (process.env.MOCK_OIDC === 'true') return 'demo-listener';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

/** The caller's Spotify access token, or null when they haven't connected Spotify. */
async function token(pool: Pool, sub: string): Promise<string | null> {
  try { return await getValidAccessToken(pool as unknown as never, sub, 'spotify'); }
  catch (err) { logger.warn({ err }, 'spotify token resolve failed'); return null; }
}

// ── Schema ───────────────────────────────────────────────────────────────────

/** Create tables if a fresh deploy hasn't run the migrations yet. Idempotent. */
export async function ensureSpotifySchema(pool: Pool): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'spotify routes',
    statements: [`
    CREATE TABLE IF NOT EXISTS spotify_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      display_name TEXT, favorite_genres TEXT[] NOT NULL DEFAULT '{}',
      favorite_artists TEXT[] NOT NULL DEFAULT '{}', notes TEXT,
      onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS spotify_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS spotify_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES spotify_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS spotify_feedback (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_spotify_feedback_user_note ON spotify_feedback (user_sub, lower(note));
  `,
      ...buildOwnerRlsPolicyStatements('spotify_profile', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('spotify_conversations', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('spotify_messages', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('spotify_feedback', 'user_sub'),
    ],
    requirements: [
      { table: 'spotify_profile', columns: ['user_sub', 'display_name', 'favorite_genres', 'favorite_artists', 'notes', 'onboarded', 'created_at', 'updated_at'] },
      { table: 'spotify_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
      { table: 'spotify_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
      { table: 'spotify_feedback', columns: ['feedback_id', 'user_sub', 'note', 'created_at'] },
    ],
  });
}

async function loadProfile(pool: Pool, sub: string): Promise<any> {
  const r = await pool.query(`SELECT * FROM spotify_profile WHERE user_sub = $1`, [sub]);
  return r.rows[0] || { user_sub: sub, onboarded: false, favorite_genres: [], favorite_artists: [] };
}

// ── Concierge brain ────────────────────────────────────────────────────────--

interface ChatEnvelope {
  say: string;
  show: string[];
  playlist: { name: string; trackIds: string[] } | null;
  remember: string[];
}

function buildConciergePrompt(o: {
  message: string; history: Array<{ role: string; content: string }>;
  candidates: SpotifyTrack[]; topTracks: SpotifyTrack[]; profile: any; notes: string[]; nowPlaying: SpotifyTrack | null;
}): string {
  const p = o.profile || {};
  const profileLine = p.onboarded
    ? `genres:${(p.favorite_genres || []).join(',') || 'any'} | artists:${(p.favorite_artists || []).join(',') || 'any'}`
    : 'NOT ONBOARDED — warmly ask one or two questions first (favorite genres, go-to artists, what they listen to while working/relaxing), then save it.';
  const fmt = (t: SpotifyTrack) => `- id:${t.id} | ${t.title} — ${t.artist}${t.album ? ` (${t.album})` : ''}${t.explicit ? ' [E]' : ''}`;
  const cands = (o.candidates || []).map(fmt).join('\n') || '(no search results for this message — ask what they\'re in the mood for, or that nothing matched)';
  const top = (o.topTracks || []).slice(0, 8).map(fmt).join('\n') || '(unknown)';
  const notes = (o.notes || []).map((n) => `- ${n}`).join('\n') || '(none yet)';
  const now = o.nowPlaying ? `${o.nowPlaying.title} — ${o.nowPlaying.artist}` : '(nothing playing)';
  const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Listener'}: ${h.content}`).join('\n');
  return [
    'You are the Spotify Concierge — a sharp, friendly music buddy on the listener\'s OWN Spotify. Help them find tracks, set a vibe, and build a playlist on their account. Never invent a song, artist, or id — only use the CANDIDATES below (real, from a live Spotify search), by id.',
    'Be conversational and brief. Ask ONE good question when it helps (mood? genre? for what — focus, workout, party?). To recommend, list candidate ids in "show". To BUILD a playlist, set "playlist" with a great name + the candidate ids to include — only when the listener asks for a playlist/mix. Pressing play happens in their Spotify app via a link; you never claim to start playback.',
    '',
    `CANDIDATES (real, from search — the ONLY tracks you may show or add, by id):\n${cands}`,
    '',
    `NOW PLAYING: ${now}`,
    `THEIR TOP TRACKS (taste signal):\n${top}`,
    `LISTENER PROFILE: ${profileLine}`,
    `THINGS THEY TAUGHT YOU:\n${notes}`,
    '',
    convo ? `CONVERSATION SO FAR:\n${convo}` : '',
    '',
    `LISTENER: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your reply (ask a question when useful)", "show": ["candidate id", ...], "playlist": {"name":"Playlist name","trackIds":["id","id"]}, "remember": ["a taste preference to save"] }',
    'Set "playlist" to null unless they asked you to build/make a playlist or mix.',
  ].filter(Boolean).join('\n');
}

/** Parse the Spotify concierge reply envelope (shared extraction in concierge-envelope.ts). */
export function parseEnvelope(text: string): ChatEnvelope {
  const fallbackSay = (text || '').trim();
  const o = extractEnvelopeJson(text);
  if (!o) return { say: fallbackSay, show: [], playlist: null, remember: [] };
  let playlist: ChatEnvelope['playlist'] = null;
  const pl = o.playlist as { name?: unknown; trackIds?: unknown } | undefined;
  if (pl && typeof pl === 'object' && Array.isArray(pl.trackIds) && pl.trackIds.length) {
    playlist = { name: String(pl.name || 'OSHAL Mix'), trackIds: pl.trackIds.map((x) => String(x)) };
  }
  return { say: sayOr(o, fallbackSay), show: asStringArray(o.show), playlist, remember: asStringArray(o.remember) };
}

// ── Router ─────────────────────────────────────────────────────────────────--

export function createSpotifyRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  const store = new ConciergeStore(pool, 'spotify');
  const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');

  ensureSpotifySchema(pool).catch((err) => logger.warn({ err }, 'Spotify schema bootstrap deferred — tables may not exist yet'));

  const listener =
    (fn: (req: Request, res: Response, sub: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let sub: string;
      try { sub = resolveListenerSub(req); }
      catch (e: any) { res.status(e.status || 401).json({ error: e.message }); return; }
      try { await fn(req, res, sub); }
      catch (err: any) { logger.error({ err, path: req.path }, 'spotify route error'); res.status(500).json({ error: err.message || 'internal error' }); }
    };

  // ── Surface ────────────────────────────────────────────────────────────────
  router.get('/app', serveFile(surfaceDir, 'spotify-app.html'));
  router.get('/chat', serveFile(surfaceDir, 'spotify-app.html')); // alias (parity with eats)

  router.get('/config', listener(async (_req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.json({ connected: false, status: 'not_connected', me: null }); return; }
    try {
      const me = await spotifyMe(t);
      res.json({ connected: true, status: 'ok', me });
    } catch (e: any) {
      // 403 here is almost always Spotify "Development Mode" — the authorized account isn't on
      // the app's User Management allowlist, so the token is valid but every call is blocked.
      // Surface it distinctly so the UI can explain the fix instead of looking empty.
      if (e?.status === 403) { res.json({ connected: true, status: 'needs_allowlist', me: null }); return; }
      res.json({ connected: true, status: 'error', me: null, error: e?.message || 'spotify error' });
    }
  }));

  // ── Discovery (live Spotify Web API) ─────────────────────────────────────────
  router.get('/search', listener(async (req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.status(409).json({ error: 'not_connected', items: [] }); return; }
    const q = String(req.query.q || req.query.query || '');
    const items = await spotifySearchTracks(t, q, Number(req.query.limit) || 12);
    res.json({ items });
  }));

  router.get('/now-playing', listener(async (_req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.json({ nowPlaying: null }); return; }
    const np = await spotifyNowPlaying(t);
    res.json({ nowPlaying: np });
  }));

  router.get('/playlists', listener(async (_req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.json({ playlists: [] }); return; }
    res.json({ playlists: await spotifyMyPlaylists(t) });
  }));

  router.get('/top-tracks', listener(async (_req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.json({ items: [] }); return; }
    res.json({ items: await spotifyTopTracks(t) });
  }));

  // ── Build a playlist (real action on the user's account) ─────────────────────
  router.post('/playlist', listener(async (req, res, sub) => {
    const t = await token(pool, sub);
    if (!t) { res.status(409).json({ error: 'not_connected' }); return; }
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const trackUris: string[] = Array.isArray(b.trackUris) ? b.trackUris.map(String).filter(Boolean) : [];
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    if (!trackUris.length) { res.status(400).json({ error: 'at least one track is required' }); return; }
    try {
      const me = await spotifyMe(t);
      const playlist = await spotifyCreatePlaylist(t, me.id, name, trackUris, { description: b.description, isPublic: !!b.isPublic });
      res.json({ playlist, note: 'Created on your Spotify — open it to listen, reorder, or share.' });
    } catch (err: any) {
      if (err?.status === 403) { res.status(403).json({ error: 'Spotify declined — reconnect and allow playlist editing.' }); return; }
      throw err;
    }
  }));

  // ── Profile ────────────────────────────────────────────────────────────────
  router.get('/profile', listener(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));

  router.post('/profile', listener(async (req, res, sub) => {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO spotify_profile (user_sub, display_name, favorite_genres, favorite_artists, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, spotify_profile.display_name),
         favorite_genres=COALESCE(EXCLUDED.favorite_genres, spotify_profile.favorite_genres),
         favorite_artists=COALESCE(EXCLUDED.favorite_artists, spotify_profile.favorite_artists),
         notes=COALESCE(EXCLUDED.notes, spotify_profile.notes),
         onboarded=(EXCLUDED.onboarded OR spotify_profile.onboarded), updated_at=NOW()
       RETURNING *`,
      [sub, b.displayName ?? null, b.favoriteGenres ?? null, b.favoriteArtists ?? null, b.notes ?? null, b.onboarded ?? null]);
    res.json({ profile: r.rows[0] });
  }));

  // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
  router.post('/chat', listener(async (req, res, sub) => {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }
    const t = await token(pool, sub);
    if (!t) { res.status(409).json({ error: 'not_connected', reply: 'Connect your Spotify first (the Cloud / Connections page), then I can find tracks and build playlists for you.' }); return; }

    // Conversation + message + feedback persistence (durable resume, IDOR guard) is shared — ConciergeStore.
    const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
    await store.addMessage(conversationId, sub, 'user', message);
    const history = await store.loadHistory(conversationId);

    const candidates = await spotifySearchTracks(t, message, 12);
    const candById = new Map<string, SpotifyTrack>(candidates.map((c) => [c.id, c]));
    const [topTracks, nowPlayingRes, profile, notes] = await Promise.all([
      spotifyTopTracks(t, 8),
      spotifyNowPlaying(t).catch(() => null),
      loadProfile(pool, sub),
      store.loadNotes(sub),
    ]);

    const prompt = buildConciergePrompt({ message, history, candidates, topTracks, profile, notes, nowPlaying: nowPlayingRes?.track || null });
    let raw = '';
    try {
      const orchestrator = (ctx as any).orchestrator;
      const result = await orchestrator.processMessage(`spotify-${sub}-${randomUUID()}`, prompt, {
        agenticMode: false, autoApprove: false, source: 'spotify', agentId: CONCIERGE_AGENT_ID, userSub: sub,
      });
      raw = String(result?.response || '').trim();
    } catch (e) { logger.error({ e }, 'spotify concierge orchestrate failed'); }
    const env = parseEnvelope(raw);
    if (!env.say) env.say = "I'm having trouble reaching my assistant right now — give me a moment and try again.";

    // Build a playlist if the brain asked for one, mapping its candidate ids → real track URIs.
    let createdPlaylist: any = null;
    if (env.playlist) {
      const uris = env.playlist.trackIds.map((id) => candById.get(id)?.uri).filter(Boolean) as string[];
      if (uris.length) {
        try {
          const me = await spotifyMe(t);
          createdPlaylist = await spotifyCreatePlaylist(t, me.id, env.playlist.name, uris, { description: `Built by the OSHAL Spotify concierge — "${message.slice(0, 120)}"` });
        } catch (e: any) { logger.warn({ e }, 'concierge playlist build failed'); }
      }
    }
    for (const note of env.remember) await store.saveNote(sub, note);

    await store.addMessage(conversationId, sub, 'assistant', env.say);
    await store.touch(conversationId);

    res.json({
      conversationId,
      reply: env.say,
      cards: env.show.map((id) => candById.get(id)).filter(Boolean),
      playlist: createdPlaylist,
      remembered: env.remember,
    });
  }));

  router.get('/conversation', listener(async (req, res, sub) => {
    // Durable resume by id (else latest), user-scoped — shared ConciergeStore.
    res.json(await store.resume(sub, String(req.query.id || '')));
  }));

  return router;
}
