"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:46:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: in-memory pumpkin projector "rooms" for the paired-remote topology (mirrors the Jarvis TV-room pattern). A projector registers a room + gets a pairing token; a phone/control remote lists the owner's rooms and pushes speak/preset/mode events, which fan out to the room's live SSE listeners. TTL-swept (pairing-style volatility) and strictly scoped by OIDC sub.
 * 2026-08-01 12:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Swarm-driveable + truthful counts. (1) pushTrusted(): a TOKEN-FREE delivery path for the service-secret door — the 18-byte pairing token is minted at register() and only ever returned to the registering BROWSER, so no bot could ever obtain it and nothing in the swarm could make the prop speak. The browser path (push) keeps the constant-time token compare UNCHANGED and forever: the token is what stops a second signed-in tab, a stale device, or an XSS'd page under the same account from seizing a screen. (2) One fanout() delivery implementation that PRUNES listeners that throw or return false — res.write() on a destroyed socket does not throw synchronously in Node, so dead SSE connections were never removed and push() reported an inflated count ("spoken on 2 screens" with one screen dark). (3) ROOM_MAX_IDLE_MS hard ceiling + a background sweep timer: sweep() previously ran ONLY from register()/list(), and a half-open socket pinned a room and its token for the whole process lifetime. (4) list() now reports listeners so a caller can tell "registered" from "actually watching". (5) resolveSpeakTargets(): headless room resolution that never guesses and never silently succeeds. (6) roomSlug is now exported and trims dashes AFTER the length slice so slug(slug(x)) === slug(x) — three surfaces derive this key independently.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pumpkinRooms = exports.PumpkinRoomRegistry = exports.ROOM_MAX_IDLE_MS = exports.ROOM_TTL_MS = void 0;
exports.roomSlug = roomSlug;
exports.resolveSpeakTargets = resolveSpeakTargets;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'pumpkin-rooms' });
/** Room drops off the list this long after its last heartbeat (a healthy projector beats every 30s). */
exports.ROOM_TTL_MS = 90 * 1000;
/**
 * Hard idle ceiling. A room whose owner stopped heartbeating for this long is evicted REGARDLESS of
 * listener count. The TTL path alone cannot reclaim a room pinned by a half-open socket (the listener
 * set is non-empty forever), which leaked the room AND its pairing token for the process lifetime.
 * 15 minutes against a 30-second heartbeat is a 30x margin, so a live projector can never reach it.
 */
exports.ROOM_MAX_IDLE_MS = 15 * 60 * 1000;
/** How often the background sweep runs; sweep() used to fire only from register()/list(). */
const SWEEP_INTERVAL_MS = 30 * 1000;
/**
 * @description Slugify a room label into a safe id token (≤40 chars). The dash trim runs AFTER the
 * length slice so the function is IDEMPOTENT — `roomSlug(roomSlug(x)) === roomSlug(x)` for all x.
 * That property is load-bearing: the projector, the phone remote, and the control surface each
 * derive this pairing key independently, and a label long enough to be sliced mid-separator used to
 * yield a trailing-dash slug that re-slugified to a DIFFERENT room (silently landing a push in a
 * room nobody was subscribed to).
 * @param room - The raw room label or an already-slugified room id.
 * @returns The canonical room key, never empty ('main' when nothing survives).
 */
function roomSlug(room) {
    return String(room || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/(^-|-$)/g, '') || 'main';
}
/** Per-user key so one account's rooms never collide with another's. */
function key(sub, room) {
    return `${sub}|${room}`;
}
/** Best-effort unref so the sweep timer never holds a test runner or a draining process open. */
function unrefTimer(timer) {
    const maybe = timer;
    if (typeof maybe.unref === 'function')
        maybe.unref();
}
/**
 * In-memory registry of live projector rooms. All access is scoped by the owner's OIDC sub, so a
 * caller can only ever see, subscribe to, or push into their OWN rooms. Volatile by design — a
 * projector that stops heartbeating simply disappears.
 */
class PumpkinRoomRegistry {
    rooms = new Map();
    sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    constructor() {
        unrefTimer(this.sweepTimer);
    }
    /**
     * Deliver one event to a room's listeners, pruning any transport that throws or explicitly reports
     * itself dead (returns `false`). The ONE delivery implementation — both the token path and the
     * trusted path route through it, so pruning and the returned count can never diverge.
     */
    fanout(entry, evt) {
        const dead = [];
        let delivered = 0;
        for (const l of entry.listeners) {
            try {
                if (l(evt) === false)
                    dead.push(l);
                else
                    delivered += 1;
            }
            catch (err) {
                logger.error({ err, room: entry.room }, 'pumpkin listener push failed');
                dead.push(l);
            }
        }
        for (const l of dead)
            entry.listeners.delete(l);
        return delivered;
    }
    /** Tell a room's listeners it is gone, then drop it. A client MUST re-register, not reconnect. */
    evict(k, entry) {
        for (const l of entry.listeners) {
            try {
                l({ type: 'evicted' });
            }
            catch (err) {
                logger.error({ err, room: entry.room }, 'pumpkin evict notify failed');
            }
        }
        entry.listeners.clear();
        this.rooms.delete(k);
        logger.info({ room: entry.room }, 'pumpkin room evicted past the idle ceiling');
    }
    /**
     * Drop rooms that stopped heartbeating. Two conditions: the original zero-listener TTL (a
     * projector that closed its tab), and a hard idle ceiling that reclaims a room pinned by a wedged
     * listener. A projector heartbeating every 30s satisfies neither.
     */
    sweep() {
        const now = Date.now();
        for (const [k, v] of this.rooms) {
            const idle = now - v.lastSeen;
            if (idle > exports.ROOM_TTL_MS && v.listeners.size === 0) {
                this.rooms.delete(k);
                continue;
            }
            if (idle > exports.ROOM_MAX_IDLE_MS)
                this.evict(k, v);
        }
    }
    /**
     * @description Register (or refresh) a projector room for a user and return its slug + pairing
     * token. The token is minted once per room and required to push into it from a browser. An
     * EXISTING room returns its EXISTING token, which is what makes a projector re-register safe for
     * a phone remote that is already paired mid-party.
     * @param sub - The owner's OIDC sub.
     * @param label - Human room label ("Front Porch").
     * @returns The canonical room slug, its stored label, and the pairing token.
     */
    register(sub, label) {
        this.sweep();
        const room = roomSlug(label);
        const k = key(sub, room);
        const existing = this.rooms.get(k);
        if (existing) {
            existing.lastSeen = Date.now();
            existing.label = (String(label || '').trim() || existing.label).slice(0, 40);
            return { room, label: existing.label, token: existing.token };
        }
        const entry = {
            sub,
            room,
            label: (String(label || '').trim() || 'Main').slice(0, 40),
            token: crypto_1.default.randomBytes(18).toString('hex'),
            lastSeen: Date.now(),
            listeners: new Set(),
        };
        this.rooms.set(k, entry);
        logger.info({ sub, room }, 'pumpkin room registered');
        return { room, label: entry.label, token: entry.token };
    }
    /** Refresh a room's heartbeat. Returns false if unknown (the caller MUST then re-register). */
    heartbeat(sub, room) {
        const entry = this.rooms.get(key(sub, roomSlug(room)));
        if (!entry)
            return false;
        entry.lastSeen = Date.now();
        return true;
    }
    /**
     * @description Does this owner have this room right now? Lets the SSE route choose its status code
     * BEFORE writeHead — a 200-then-end is a dropped connection to EventSource, which retries it
     * silently forever; a non-2xx is terminal and hands recovery back to the client.
     * @param sub - The owner's OIDC sub.
     * @param room - Room slug or label (slugified here).
     * @returns True when the room exists for this owner.
     */
    has(sub, room) {
        return this.rooms.has(key(sub, roomSlug(room)));
    }
    /**
     * @description Total rooms held across all owners. Exists so eviction/TTL behaviour is assertable
     * without reaching into private state.
     * @returns The number of rooms currently registered.
     */
    count() {
        return this.rooms.size;
    }
    /**
     * @description Stop the background sweep timer. Production never calls this (the timer is
     * unref'd); it exists so a test runner can shut the singleton down deterministically.
     * @returns Nothing.
     */
    stop() {
        clearInterval(this.sweepTimer);
    }
    /**
     * @description List the owner's rooms (token-free), including how many transports are attached so
     * a caller can distinguish "registered" from "actually being watched".
     * @param sub - The owner's OIDC sub.
     * @returns One descriptor per room this owner holds.
     */
    list(sub) {
        this.sweep();
        const now = Date.now();
        const out = [];
        for (const v of this.rooms.values()) {
            if (v.sub !== sub)
                continue;
            out.push({ room: v.room, label: v.label, live: now - v.lastSeen <= exports.ROOM_TTL_MS, listeners: v.listeners.size });
        }
        return out;
    }
    /**
     * @description Subscribe a projector's SSE connection to a room. Returns an unsubscribe fn, or
     * null if the room doesn't exist for this owner.
     * @param sub - The owner's OIDC sub.
     * @param room - Room slug or label.
     * @param listener - The transport; return false from it once it can no longer be written to.
     * @returns An unsubscribe function, or null when the room is unknown.
     */
    subscribe(sub, room, listener) {
        const entry = this.rooms.get(key(sub, roomSlug(room)));
        if (!entry)
            return null;
        entry.listeners.add(listener);
        entry.lastSeen = Date.now();
        return () => entry.listeners.delete(listener);
    }
    /**
     * @description Push an event to every live listener of a room. Requires the room's pairing token
     * (constant-time compared) so only a paired remote can drive the screen. This is the BROWSER door
     * and its token requirement is permanent: an OIDC session for the owner is deliberately NOT
     * sufficient to seize a screen the browser did not register.
     * @param sub - The owner's OIDC sub.
     * @param room - Room slug or label.
     * @param token - The pairing token handed back by register().
     * @param evt - The event to fan out.
     * @returns Listeners the event was DELIVERED to (dead transports pruned, not counted), or -1 when
     * the room is unknown or the token does not match.
     */
    push(sub, room, token, evt) {
        const entry = this.rooms.get(key(sub, roomSlug(room)));
        if (!entry)
            return -1;
        const a = Buffer.from(String(token || ''));
        const b = Buffer.from(entry.token);
        if (a.length !== b.length || !crypto_1.default.timingSafeEqual(a, b))
            return -1;
        entry.lastSeen = Date.now();
        return this.fanout(entry, evt);
    }
    /**
     * @description Push WITHOUT the pairing token. The token is minted inside register() and returned
     * only to the registering browser, so a swarm caller can never hold one — this is the door a
     * trusted service call comes through. It MUST only be called from a handler that has already
     * required hasValidServiceSecret(req); an OIDC session must never reach it.
     *
     * Deliberately does NOT refresh lastSeen: liveness is the projector's to assert via its own
     * heartbeat, so a bot can never resurrect (or indefinitely pin) a room whose screen went away.
     * @param sub - The OWNER's sub, resolved from the trusted X-OSHAL-User-Sub header.
     * @param room - Room slug or label.
     * @param evt - The event to fan out.
     * @returns Listeners the event was DELIVERED to, or -1 when the room is unknown for this owner.
     */
    pushTrusted(sub, room, evt) {
        const entry = this.rooms.get(key(sub, roomSlug(room)));
        if (!entry)
            return -1;
        return this.fanout(entry, evt);
    }
}
exports.PumpkinRoomRegistry = PumpkinRoomRegistry;
/** Process-wide singleton — rooms live for the api process lifetime. */
exports.pumpkinRooms = new PumpkinRoomRegistry();
/**
 * @description Resolve which room(s) a HEADLESS caller (a bot, a CLI, any service-secret holder)
 * meant, without ever guessing. A swarm caller has no picker UI and no browser state, so every
 * ambiguous or empty case is an explicit, machine-readable refusal rather than a silent success —
 * "the pumpkin said it" when no screen was listening is the single worst answer this API can give.
 * @param sub - The owner's OIDC sub.
 * @param requested - Optional room slug OR label (case-insensitive), or '*' to fan out to all live
 * rooms. Omitted means "the caller's one live room", which is only unambiguous when there is exactly one.
 * @returns `{ok:true, targets}` with at least one live room, or `{ok:false, status, body}` carrying
 * the HTTP status and a stable `error` code (no_live_pumpkin / ambiguous_room / unknown_room).
 */
function resolveSpeakTargets(sub, requested) {
    const rooms = exports.pumpkinRooms.list(sub);
    const live = rooms.filter((r) => r.live);
    const want = String(requested ?? '').trim();
    if (want === '*') {
        if (live.length === 0)
            return { ok: false, status: 409, body: { error: 'no_live_pumpkin', rooms: [] } };
        return { ok: true, targets: live };
    }
    if (want) {
        const slug = roomSlug(want);
        const lower = want.toLowerCase();
        const hit = live.find((r) => r.room === slug) || live.find((r) => r.label.toLowerCase() === lower);
        if (!hit)
            return { ok: false, status: 404, body: { error: 'unknown_room', room: want, rooms } };
        return { ok: true, targets: [hit] };
    }
    if (live.length === 0)
        return { ok: false, status: 409, body: { error: 'no_live_pumpkin', rooms: [] } };
    if (live.length === 1)
        return { ok: true, targets: live };
    return {
        ok: false,
        status: 409,
        body: { error: 'ambiguous_room', rooms: live, hint: 'name one in `room`, or pass room:"*" to speak on all of them' },
    };
}
//# sourceMappingURL=pumpkin-engine-room-registry.js.map