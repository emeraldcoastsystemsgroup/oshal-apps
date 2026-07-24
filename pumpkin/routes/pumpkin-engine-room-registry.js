"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:46:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: in-memory pumpkin projector "rooms" for the paired-remote topology (mirrors the Jarvis TV-room pattern). A projector registers a room + gets a pairing token; a phone/control remote lists the owner's rooms and pushes speak/preset/mode events, which fan out to the room's live SSE listeners. TTL-swept (pairing-style volatility) and strictly scoped by OIDC sub.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pumpkinRooms = exports.PumpkinRoomRegistry = void 0;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'pumpkin-rooms' });
/** Room drops off the list this long after its last heartbeat. */
const ROOM_TTL_MS = 90 * 1000;
/** Slugify a room label into a safe id token (≤40 chars). */
function roomSlug(room) {
    return String(room || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'main';
}
/** Per-user key so one account's rooms never collide with another's. */
function key(sub, room) {
    return `${sub}|${room}`;
}
/**
 * In-memory registry of live projector rooms. All access is scoped by the owner's OIDC sub, so a
 * caller can only ever see, subscribe to, or push into their OWN rooms. Volatile by design — a
 * projector that stops heartbeating simply disappears.
 */
class PumpkinRoomRegistry {
    rooms = new Map();
    /** Drop rooms that stopped heartbeating (and close nothing — dead listeners self-clean on write). */
    sweep() {
        const now = Date.now();
        for (const [k, v] of this.rooms) {
            if (now - v.lastSeen > ROOM_TTL_MS && v.listeners.size === 0)
                this.rooms.delete(k);
        }
    }
    /**
     * @description Register (or refresh) a projector room for a user and return its slug + pairing
     * token. The token is minted once per room and required to push into it.
     * @param sub - The owner's OIDC sub.
     * @param label - Human room label ("Front Porch").
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
    /** Refresh a room's heartbeat. Returns false if unknown. */
    heartbeat(sub, room) {
        const entry = this.rooms.get(key(sub, roomSlug(room)));
        if (!entry)
            return false;
        entry.lastSeen = Date.now();
        return true;
    }
    /** List the owner's rooms (token-free). */
    list(sub) {
        this.sweep();
        const now = Date.now();
        const out = [];
        for (const v of this.rooms.values()) {
            if (v.sub !== sub)
                continue;
            out.push({ room: v.room, label: v.label, live: now - v.lastSeen <= ROOM_TTL_MS });
        }
        return out;
    }
    /**
     * @description Subscribe a projector's SSE connection to a room. Returns an unsubscribe fn, or
     * null if the room doesn't exist for this owner.
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
     * (constant-time compared) so only a paired remote can drive the screen. Returns the number of
     * listeners reached, or -1 when the token/room is invalid.
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
        for (const l of entry.listeners) {
            try {
                l(evt);
            }
            catch (err) {
                logger.error({ err, room }, 'pumpkin listener push failed');
            }
        }
        return entry.listeners.size;
    }
}
exports.PumpkinRoomRegistry = PumpkinRoomRegistry;
/** Process-wide singleton — rooms live for the api process lifetime. */
exports.pumpkinRooms = new PumpkinRoomRegistry();
//# sourceMappingURL=pumpkin-engine-room-registry.js.map