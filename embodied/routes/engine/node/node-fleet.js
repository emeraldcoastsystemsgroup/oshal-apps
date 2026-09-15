"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the drone-node fleet (ADR-099, B20), the core DroneFleet's shape for this package: nodes join by authenticated heartbeat (identity, kind, the endpoint the api dials back, the bridge hello, the latest telemetry, events since the api's ack) and are minted on first contact; staleness is the liveness signal — a node that stops heartbeating is offline and cannot be given a world; ids and sizes are bounded so a misbehaving client cannot grow the map or inject path-hostile ids. One fleet per process, shared by the heartbeat mount and the world routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A node belongs to one owner (ADR-114): the sub the mounter resolved from the trusted service user-sub header is recorded on first contact, a heartbeat for that node from another owner is refused, and an owned node is unknown to everyone else — the fleet lists and hands out only what a caller may see (unowned nodes, a loopback development case, are visible to all).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DroneNodeFleet = exports.NodeOffline = exports.NodeValidationError = exports.NODE_ID_RE = exports.MAX_NODES = exports.HEARTBEAT_STALE_MS = void 0;
exports.validateHeartbeat = validateHeartbeat;
exports.sharedNodeFleet = sharedNodeFleet;
/** A node is offline once this long passes without a heartbeat (nodes push every ~2 s; the core drone fleet's window). */
exports.HEARTBEAT_STALE_MS = 15_000;
exports.MAX_NODES = 16;
const EVENT_RETENTION = 50;
const MAX_TELEMETRY_BYTES = 4096;
/** The one legal node-id shape (the core drone fleet's). */
exports.NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const ENDPOINT_RE = /^https?:\/\/\S{1,300}$/;
/** @description A heartbeat the fleet refuses; the message says which field. */
class NodeValidationError extends Error {
    constructor(message) { super(message); this.name = 'NodeValidationError'; }
}
exports.NodeValidationError = NodeValidationError;
/** @description A node the fleet knows but has not heard from within the window (or never). */
class NodeOffline extends Error {
    nodeId;
    lastSeenMs;
    known;
    constructor(nodeId, lastSeenMs, known) {
        super(known ? `node "${nodeId}" is offline (${lastSeenMs === null ? 'never heartbeat' : 'no heartbeat within the window'})` : `unknown node "${nodeId}" — no node of that id has heartbeat in`);
        this.nodeId = nodeId;
        this.lastSeenMs = lastSeenMs;
        this.known = known;
        this.name = 'NodeOffline';
    }
}
exports.NodeOffline = NodeOffline;
const text = (v, field, max) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max)
        throw new NodeValidationError(`${field} must be a string of at most ${max} characters`);
    return v.trim();
};
function validateEvents(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw) || raw.length > 100)
        throw new NodeValidationError('events must be an array of at most 100 entries');
    return raw.map((e) => {
        const ev = (e ?? {});
        if (!Number.isInteger(ev.seq) || ev.seq < 0)
            throw new NodeValidationError('event seq must be a non-negative integer');
        return { seq: ev.seq, at: text(ev.at ?? new Date(0).toISOString(), 'event at', 64), kind: text(ev.kind, 'event kind', 64), text: text(ev.text ?? '-', 'event text', 300) };
    });
}
/** @description Validate one raw heartbeat body fail-closed. @param raw - The request body. @returns The typed heartbeat. */
function validateHeartbeat(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    const nodeId = text(b.nodeId, 'nodeId', 32);
    if (!exports.NODE_ID_RE.test(nodeId))
        throw new NodeValidationError(`nodeId "${nodeId}" is not a node id (letters, digits, - and _, up to 32)`);
    const kind = b.kind === undefined ? 'plant' : b.kind;
    if (kind !== 'plant' && kind !== 'drone')
        throw new NodeValidationError('kind must be "plant" or "drone"');
    const endpointUrl = text(b.endpointUrl, 'endpointUrl', 300);
    if (!ENDPOINT_RE.test(endpointUrl))
        throw new NodeValidationError('endpointUrl must be a plain http(s) URL');
    if (!Number.isInteger(b.protocol))
        throw new NodeValidationError('protocol must be an integer');
    const sessions = b.sessions === undefined ? 0 : b.sessions;
    if (!Number.isInteger(sessions) || sessions < 0)
        throw new NodeValidationError('sessions must be a non-negative integer');
    let telemetry = null;
    if (b.telemetry !== undefined && b.telemetry !== null) {
        if (typeof b.telemetry !== 'object' || Array.isArray(b.telemetry))
            throw new NodeValidationError('telemetry must be an object');
        if (JSON.stringify(b.telemetry).length > MAX_TELEMETRY_BYTES)
            throw new NodeValidationError(`telemetry must serialise to at most ${MAX_TELEMETRY_BYTES} bytes`);
        telemetry = b.telemetry;
    }
    return { nodeId, kind, endpointUrl: endpointUrl.replace(/\/+$/, ''), protocol: b.protocol, engine: text(b.engine, 'engine', 64), version: text(b.version, 'version', 64), buildHash: text(b.buildHash, 'buildHash', 128), sessions: sessions, telemetry, events: validateEvents(b.events) };
}
/**
 * @description The dynamic node registry (ADR-099): id → record, minted on first heartbeat, refreshed after. Deliberately
 * not the bot registry — nodes come and go at runtime; liveness is heartbeat-derived, and an unknown or offline node is a
 * refusal at the moment a world asks for it, not a boot error.
 */
class DroneNodeFleet {
    nodes = new Map();
    staleMs;
    maxNodes;
    constructor(opts = {}) {
        this.staleMs = opts.staleMs ?? exports.HEARTBEAT_STALE_MS;
        this.maxNodes = opts.maxNodes ?? exports.MAX_NODES;
    }
    /**
     * @description Absorb one authenticated heartbeat: validate, mint or refresh, merge events by seq.
     * @param raw - The body. @param nowMs - The clock. @param ownerSub - The owner the mounter resolved for the caller (null = unowned).
     * @returns The node id and the event ack cursor for the node.
     */
    ingest(raw, nowMs, ownerSub = null) {
        const hb = validateHeartbeat(raw);
        let rec = this.nodes.get(hb.nodeId);
        if (!rec) {
            if (this.nodes.size >= this.maxNodes)
                throw new NodeValidationError(`the fleet is at its ${this.maxNodes}-node limit`);
            rec = { nodeId: hb.nodeId, kind: hb.kind, ownerSub, endpointUrl: hb.endpointUrl, hello: { protocol: hb.protocol, engine: hb.engine, version: hb.version, buildHash: hb.buildHash }, sessions: 0, telemetry: null, events: [], firstSeenMs: nowMs, lastSeenMs: nowMs };
            this.nodes.set(hb.nodeId, rec);
        }
        if (rec.ownerSub !== null && rec.ownerSub !== ownerSub)
            throw new NodeValidationError(`node "${hb.nodeId}" belongs to another owner`);
        if (rec.ownerSub === null && ownerSub)
            rec.ownerSub = ownerSub;
        rec.kind = hb.kind;
        rec.endpointUrl = hb.endpointUrl;
        rec.hello = { protocol: hb.protocol, engine: hb.engine, version: hb.version, buildHash: hb.buildHash };
        rec.sessions = hb.sessions ?? 0;
        rec.telemetry = hb.telemetry ?? null;
        rec.lastSeenMs = nowMs;
        const held = rec.events.length ? rec.events[rec.events.length - 1].seq : 0;
        for (const ev of hb.events ?? [])
            if (ev.seq > held)
                rec.events.push(ev);
        if (rec.events.length > EVENT_RETENTION)
            rec.events.splice(0, rec.events.length - EVENT_RETENTION);
        return { nodeId: hb.nodeId, ack: rec.events.length ? rec.events[rec.events.length - 1].seq : held };
    }
    /** @returns Whether the node has heartbeat within the window. */
    isOnline(nodeId, nowMs) {
        const rec = this.nodes.get(nodeId);
        return Boolean(rec && nowMs - rec.lastSeenMs < this.staleMs);
    }
    /** @returns Whether a caller may see a node: its owner, or anyone for an unowned node. */
    visible(rec, forSub) {
        return rec.ownerSub === null || forSub === undefined || rec.ownerSub === forSub;
    }
    /** @description Resolve a node or refuse: an offline node refuses HERE, so no world is ever given a dead link; another owner's node is unknown. */
    get(nodeId, nowMs, forSub) {
        const rec = this.nodes.get(nodeId);
        if (!rec || !this.visible(rec, forSub))
            throw new NodeOffline(nodeId, null, false);
        if (!this.isOnline(nodeId, nowMs))
            throw new NodeOffline(nodeId, rec.lastSeenMs, true);
        return rec;
    }
    /** @description Every node a caller may see, online or not, for the status route and the tile. @param expectedBuildHash - This package's engine tree hash, to flag a stale plant node. @param forSub - The caller; omitted = the machine view of everything. */
    list(nowMs, expectedBuildHash = null, forSub) {
        const out = [];
        for (const rec of this.nodes.values()) {
            if (!this.visible(rec, forSub))
                continue;
            out.push({ nodeId: rec.nodeId, kind: rec.kind, ownerSub: rec.ownerSub, endpointUrl: rec.endpointUrl, engine: rec.hello.engine, version: rec.hello.version, protocol: rec.hello.protocol, buildHash: rec.hello.buildHash, stale: rec.kind === 'plant' && expectedBuildHash ? rec.hello.buildHash !== expectedBuildHash : null, online: this.isOnline(rec.nodeId, nowMs), lastSeenMs: rec.lastSeenMs, ageMs: nowMs - rec.lastSeenMs, sessions: rec.sessions, telemetry: rec.telemetry, events: rec.events.slice(-5) });
        }
        return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    }
    /** @description Forget a node (specs; an operator action later). */
    forget(nodeId) { return this.nodes.delete(nodeId); }
}
exports.DroneNodeFleet = DroneNodeFleet;
let shared = null;
/** @description The one fleet of this process, shared by the heartbeat mount and the world routes. @returns The fleet. */
function sharedNodeFleet() {
    if (!shared)
        shared = new DroneNodeFleet();
    return shared;
}
//# sourceMappingURL=node-fleet.js.map