"use strict";
/**
 * Native-kernel Spotify egress for the Spotify concierge.
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the framework's
 * getValidAccessToken answers null and the framework Spotify client (@/app/routes/spotify-client) is an inert
 * stand-in. The kernel instead offers a fenced egress keyed by the manifest: this package declares
 * api.spotify.com with the caller's own spotify connection applied by the kernel as a Bearer token. The package
 * sends requests through the global fetch with no Authorization header and never sees a credential.
 *
 * This module holds what that path needs: whether the caller has a usable spotify connection (from the kernel's
 * connectors.metadata intent, metadata only), and the same six Web API helpers the framework client offers, with
 * the same signatures and the same normalized shapes. The token argument they take is the sentinel the route
 * carries under the kernel and is never sent. A kernel "not connected" refusal becomes SpotifyNotConnected so the
 * route can give its own not-connected answer. Outside the kernel (OSHAL_EGRESS unset) nothing here is used.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: spotify connection state from connectors.metadata, the kernel egress call to api.spotify.com (no Authorization; "not connected" mapped to SpotifyNotConnected), and package-local spotifyMe / spotifySearchTracks / spotifyNowPlaying / spotifyMyPlaylists / spotifyTopTracks / spotifyCreatePlaylist mirroring the framework client for the native kernel.
 *
 * @module kernel-spotify
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyNotConnected = exports.KERNEL_TOKEN = void 0;
exports.kernelEgress = kernelEgress;
exports.readConnections = readConnections;
exports.kernelSpotifyToken = kernelSpotifyToken;
exports.spotifyMe = spotifyMe;
exports.spotifySearchTracks = spotifySearchTracks;
exports.spotifyNowPlaying = spotifyNowPlaying;
exports.spotifyMyPlaylists = spotifyMyPlaylists;
exports.spotifyTopTracks = spotifyTopTracks;
exports.spotifyCreatePlaylist = spotifyCreatePlaylist;
const API = 'https://api.spotify.com/v1';
/** The sentinel token the routes carry under the kernel: the kernel, not the package, holds the credential. */
exports.KERNEL_TOKEN = 'kernel';
/** The kernel refused a request because the caller has no spotify connection. */
class SpotifyNotConnected extends Error {
    constructor(message) {
        super(message);
        this.name = 'SpotifyNotConnected';
    }
}
exports.SpotifyNotConnected = SpotifyNotConnected;
/**
 * @description True inside the native kernel's package sandbox, where the manifest egress declaration carries the credential.
 * @returns Whether Spotify requests go through the kernel egress.
 */
function kernelEgress() {
    return process.env.OSHAL_EGRESS === 'kernel';
}
/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the Spotify request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @param onError - Told about a refused intent so the route can log it.
 * @returns The connectors.metadata answer, or null.
 */
async function readConnections(ctx, onError = () => undefined) {
    const intent = ctx?.intent;
    if (typeof intent !== 'function')
        return null;
    try {
        const answer = await intent.call(ctx, 'connectors.metadata', {});
        return answer && typeof answer === 'object' ? answer : null;
    }
    catch (err) {
        onError(err);
        return null;
    }
}
/**
 * @description The route's token under the kernel: the sentinel when the caller's spotify connection is usable (or the
 * metadata cannot say), null when there is none or it is revoked or past its expiry with nothing to renew it.
 * @param meta - The connectors.metadata answer (or null when unknown).
 * @param now - Clock seam in milliseconds.
 * @returns The sentinel token, or null for the route's not-connected answer.
 */
function kernelSpotifyToken(meta, now = Date.now()) {
    if (!meta || !Array.isArray(meta.connections))
        return exports.KERNEL_TOKEN;
    const rows = meta.connections.filter((c) => String(c?.provider || '').toLowerCase() === 'spotify');
    const usable = rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
    return usable ? exports.KERNEL_TOKEN : null;
}
/** One Spotify call through the kernel egress → parsed JSON, or throws with the status + body snippet like the framework client. */
async function call(path, init) {
    let r;
    try {
        r = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
    }
    catch (err) {
        const message = String(err?.message || '');
        if (/not connected/i.test(message))
            throw new SpotifyNotConnected(message);
        throw err;
    }
    if (r.status === 204)
        return {};
    const text = await r.text();
    if (!r.ok) {
        const err = new Error(`spotify ${r.status}: ${text.slice(0, 200)}`);
        err.status = r.status;
        throw err;
    }
    try {
        return text ? JSON.parse(text) : {};
    }
    catch {
        return {};
    }
}
/** Smallest image at-or-above a target width (Spotify returns largest-first). */
function pickImage(images) {
    if (!Array.isArray(images) || !images.length)
        return null;
    return images[images.length - 1].url || images[0].url || null;
}
/** A Spotify track object in the framework client's SpotifyTrack shape. */
function normTrack(t) {
    return {
        id: String(t?.id || ''),
        uri: String(t?.uri || (t?.id ? `spotify:track:${t.id}` : '')),
        title: String(t?.name || 'Unknown'),
        artist: (t?.artists || []).map((a) => a?.name).filter(Boolean).join(', ') || 'Unknown',
        album: String(t?.album?.name || ''),
        imageUrl: pickImage(t?.album?.images),
        durationMs: Number(t?.duration_ms || 0),
        url: String(t?.external_urls?.spotify || (t?.id ? `https://open.spotify.com/track/${t.id}` : '')),
        previewUrl: t?.preview_url || null,
        explicit: !!t?.explicit,
    };
}
/** A Spotify playlist object in the framework client's SpotifyPlaylist shape. */
function normPlaylist(p) {
    return {
        id: String(p?.id || ''),
        name: String(p?.name || 'Untitled'),
        trackCount: Number(p?.tracks?.total || 0),
        imageUrl: pickImage(p?.images),
        url: String(p?.external_urls?.spotify || (p?.id ? `https://open.spotify.com/playlist/${p.id}` : '')),
        owner: String(p?.owner?.display_name || p?.owner?.id || ''),
        isPublic: !!p?.public,
    };
}
/**
 * @description The connected account's profile (display name, market, free vs premium) through the kernel egress.
 * @param _token - The kernel sentinel; never sent.
 * @returns The bounded profile.
 */
async function spotifyMe(_token) {
    const j = await call('/me');
    return {
        id: String(j?.id || ''),
        displayName: String(j?.display_name || j?.id || 'You'),
        product: String(j?.product || 'free'),
        imageUrl: pickImage(j?.images),
        country: String(j?.country || ''),
    };
}
/**
 * @description Search tracks (the concierge's discovery primitive) through the kernel egress.
 * @param _token - The kernel sentinel; never sent.
 * @param query - The search text; empty answers [] without a request.
 * @param limit - Result count, clamped to 1..50.
 * @returns The matching tracks.
 */
async function spotifySearchTracks(_token, query, limit = 12) {
    const q = String(query || '').trim();
    if (!q)
        return [];
    const market = process.env.SPOTIFY_MARKET || 'from_token';
    const j = await call(`/search?type=track&limit=${Math.min(50, Math.max(1, limit))}&market=${encodeURIComponent(market)}&q=${encodeURIComponent(q)}`);
    return (j?.tracks?.items || []).map(normTrack).filter((t) => t.id);
}
/**
 * @description What the caller is playing right now through the kernel egress.
 * @param _token - The kernel sentinel; never sent.
 * @returns The track and play state, or null when nothing is playing.
 */
async function spotifyNowPlaying(_token) {
    const j = await call('/me/player/currently-playing?market=from_token');
    if (!j || !j.item)
        return null;
    return { track: normTrack(j.item), isPlaying: !!j.is_playing };
}
/**
 * @description The caller's own and followed playlists through the kernel egress.
 * @param _token - The kernel sentinel; never sent.
 * @param limit - Result count, clamped to 1..50.
 * @returns The playlists.
 */
async function spotifyMyPlaylists(_token, limit = 24) {
    const j = await call(`/me/playlists?limit=${Math.min(50, Math.max(1, limit))}`);
    return (j?.items || []).map(normPlaylist).filter((p) => p.id);
}
/**
 * @description The caller's top tracks through the kernel egress; any failed read answers [] as in the framework client
 * (that is also the top-tracks route's not-connected answer).
 * @param _token - The kernel sentinel; never sent.
 * @param limit - Result count, clamped to 1..50.
 * @returns The top tracks.
 */
async function spotifyTopTracks(_token, limit = 10) {
    try {
        const j = await call(`/me/top/tracks?limit=${Math.min(50, Math.max(1, limit))}&time_range=medium_term`);
        return (j?.items || []).map(normTrack).filter((t) => t.id);
    }
    catch {
        return [];
    }
}
/**
 * @description Create a playlist on the caller's account and add the given track URIs, through the kernel egress.
 * @param _token - The kernel sentinel; never sent.
 * @param userId - The Spotify user id that owns the new playlist.
 * @param name - Playlist name (clipped to 100).
 * @param trackUris - Track URIs to add (first 100).
 * @param opts - Description and visibility.
 * @returns The new playlist with its open.spotify.com link and the added count.
 */
async function spotifyCreatePlaylist(_token, userId, name, trackUris, opts) {
    const created = await call(`/users/${encodeURIComponent(userId)}/playlists`, {
        method: 'POST',
        body: JSON.stringify({
            name: String(name || 'OSHAL Mix').slice(0, 100),
            description: String(opts?.description || 'Built by the OSHAL Spotify concierge').slice(0, 300),
            public: opts?.isPublic ?? false,
        }),
    });
    const playlist = normPlaylist(created);
    let added = 0;
    const uris = (trackUris || []).filter(Boolean).slice(0, 100);
    if (playlist.id && uris.length) {
        await call(`/playlists/${playlist.id}/tracks`, { method: 'POST', body: JSON.stringify({ uris }) });
        added = uris.length;
    }
    return { ...playlist, trackCount: added, added };
}
//# sourceMappingURL=kernel-spotify.js.map