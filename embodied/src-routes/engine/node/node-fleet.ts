/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the drone-node fleet (ADR-099, B20), the core DroneFleet's shape for this package: nodes join by authenticated heartbeat (identity, kind, the endpoint the api dials back, the bridge hello, the latest telemetry, events since the api's ack) and are minted on first contact; staleness is the liveness signal — a node that stops heartbeating is offline and cannot be given a world; ids and sizes are bounded so a misbehaving client cannot grow the map or inject path-hostile ids. One fleet per process, shared by the heartbeat mount and the world routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A node belongs to one owner (ADR-114): the sub the mounter resolved from the trusted service user-sub header is recorded on first contact, a heartbeat for that node from another owner is refused, and an owned node is unknown to everyone else — the fleet lists and hands out only what a caller may see (unowned nodes, a loopback development case, are visible to all).
 */

import type { BridgeHello } from '../physics/bridge-client';

/** A node is offline once this long passes without a heartbeat (nodes push every ~2 s; the core drone fleet's window). */
export const HEARTBEAT_STALE_MS = 15_000;
export const MAX_NODES = 16;
const EVENT_RETENTION = 50;
const MAX_TELEMETRY_BYTES = 4096;
/** The one legal node-id shape (the core drone fleet's). */
export const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const ENDPOINT_RE = /^https?:\/\/\S{1,300}$/;

/** `plant`: a simulator that accepts `load` (the engine container). `drone`: a real body — one instance, no `load`, no `clone`. */
export type NodeKind = 'plant' | 'drone';

export interface NodeEvent { seq: number; at: string; kind: string; text: string }

/** One heartbeat as a node sends it (validated fail-closed at ingest). */
export interface NodeHeartbeat {
  nodeId: string;
  kind: NodeKind;
  endpointUrl: string;
  protocol: number;
  engine: string;
  version: string;
  buildHash: string;
  sessions?: number;
  telemetry?: Record<string, unknown> | null;
  events?: NodeEvent[];
}

/** What the fleet keeps per node. */
export interface NodeRecord {
  nodeId: string;
  kind: NodeKind;
  /** The person the node belongs to (the trusted service user sub its heartbeats carry); null = unowned, visible to all. */
  ownerSub: string | null;
  endpointUrl: string;
  hello: BridgeHello;
  sessions: number;
  telemetry: Record<string, unknown> | null;
  events: NodeEvent[];
  firstSeenMs: number;
  lastSeenMs: number;
}

/** One row of the fleet listing the tile and the status route show. */
export interface NodeSummary {
  nodeId: string;
  kind: NodeKind;
  ownerSub: string | null;
  endpointUrl: string;
  engine: string;
  version: string;
  protocol: number;
  buildHash: string;
  /** For a plant node: whether its build differs from this package's engine tree (null when unknown or not a plant). */
  stale: boolean | null;
  online: boolean;
  lastSeenMs: number;
  ageMs: number;
  sessions: number;
  telemetry: Record<string, unknown> | null;
  events: NodeEvent[];
}

/** @description A heartbeat the fleet refuses; the message says which field. */
export class NodeValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'NodeValidationError'; }
}

/** @description A node the fleet knows but has not heard from within the window (or never). */
export class NodeOffline extends Error {
  constructor(readonly nodeId: string, readonly lastSeenMs: number | null, readonly known: boolean) {
    super(known ? `node "${nodeId}" is offline (${lastSeenMs === null ? 'never heartbeat' : 'no heartbeat within the window'})` : `unknown node "${nodeId}" — no node of that id has heartbeat in`);
    this.name = 'NodeOffline';
  }
}

const text = (v: unknown, field: string, max: number): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new NodeValidationError(`${field} must be a string of at most ${max} characters`);
  return v.trim();
};

function validateEvents(raw: unknown): NodeEvent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 100) throw new NodeValidationError('events must be an array of at most 100 entries');
  return raw.map((e) => {
    const ev = (e ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(ev.seq) || (ev.seq as number) < 0) throw new NodeValidationError('event seq must be a non-negative integer');
    return { seq: ev.seq as number, at: text(ev.at ?? new Date(0).toISOString(), 'event at', 64), kind: text(ev.kind, 'event kind', 64), text: text(ev.text ?? '-', 'event text', 300) };
  });
}

/** @description Validate one raw heartbeat body fail-closed. @param raw - The request body. @returns The typed heartbeat. */
export function validateHeartbeat(raw: unknown): NodeHeartbeat {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nodeId = text(b.nodeId, 'nodeId', 32);
  if (!NODE_ID_RE.test(nodeId)) throw new NodeValidationError(`nodeId "${nodeId}" is not a node id (letters, digits, - and _, up to 32)`);
  const kind = b.kind === undefined ? 'plant' : b.kind;
  if (kind !== 'plant' && kind !== 'drone') throw new NodeValidationError('kind must be "plant" or "drone"');
  const endpointUrl = text(b.endpointUrl, 'endpointUrl', 300);
  if (!ENDPOINT_RE.test(endpointUrl)) throw new NodeValidationError('endpointUrl must be a plain http(s) URL');
  if (!Number.isInteger(b.protocol)) throw new NodeValidationError('protocol must be an integer');
  const sessions = b.sessions === undefined ? 0 : b.sessions;
  if (!Number.isInteger(sessions) || (sessions as number) < 0) throw new NodeValidationError('sessions must be a non-negative integer');
  let telemetry: Record<string, unknown> | null = null;
  if (b.telemetry !== undefined && b.telemetry !== null) {
    if (typeof b.telemetry !== 'object' || Array.isArray(b.telemetry)) throw new NodeValidationError('telemetry must be an object');
    if (JSON.stringify(b.telemetry).length > MAX_TELEMETRY_BYTES) throw new NodeValidationError(`telemetry must serialise to at most ${MAX_TELEMETRY_BYTES} bytes`);
    telemetry = b.telemetry as Record<string, unknown>;
  }
  return { nodeId, kind, endpointUrl: endpointUrl.replace(/\/+$/, ''), protocol: b.protocol as number, engine: text(b.engine, 'engine', 64), version: text(b.version, 'version', 64), buildHash: text(b.buildHash, 'buildHash', 128), sessions: sessions as number, telemetry, events: validateEvents(b.events) };
}

/**
 * @description The dynamic node registry (ADR-099): id → record, minted on first heartbeat, refreshed after. Deliberately
 * not the bot registry — nodes come and go at runtime; liveness is heartbeat-derived, and an unknown or offline node is a
 * refusal at the moment a world asks for it, not a boot error.
 */
export class DroneNodeFleet {
  private readonly nodes = new Map<string, NodeRecord>();
  private readonly staleMs: number;
  private readonly maxNodes: number;

  constructor(opts: { staleMs?: number; maxNodes?: number } = {}) {
    this.staleMs = opts.staleMs ?? HEARTBEAT_STALE_MS;
    this.maxNodes = opts.maxNodes ?? MAX_NODES;
  }

  /**
   * @description Absorb one authenticated heartbeat: validate, mint or refresh, merge events by seq.
   * @param raw - The body. @param nowMs - The clock. @param ownerSub - The owner the mounter resolved for the caller (null = unowned).
   * @returns The node id and the event ack cursor for the node.
   */
  ingest(raw: unknown, nowMs: number, ownerSub: string | null = null): { nodeId: string; ack: number } {
    const hb = validateHeartbeat(raw);
    let rec = this.nodes.get(hb.nodeId);
    if (!rec) {
      if (this.nodes.size >= this.maxNodes) throw new NodeValidationError(`the fleet is at its ${this.maxNodes}-node limit`);
      rec = { nodeId: hb.nodeId, kind: hb.kind, ownerSub, endpointUrl: hb.endpointUrl, hello: { protocol: hb.protocol, engine: hb.engine, version: hb.version, buildHash: hb.buildHash }, sessions: 0, telemetry: null, events: [], firstSeenMs: nowMs, lastSeenMs: nowMs };
      this.nodes.set(hb.nodeId, rec);
    }
    if (rec.ownerSub !== null && rec.ownerSub !== ownerSub) throw new NodeValidationError(`node "${hb.nodeId}" belongs to another owner`);
    if (rec.ownerSub === null && ownerSub) rec.ownerSub = ownerSub;
    rec.kind = hb.kind; rec.endpointUrl = hb.endpointUrl;
    rec.hello = { protocol: hb.protocol, engine: hb.engine, version: hb.version, buildHash: hb.buildHash };
    rec.sessions = hb.sessions ?? 0; rec.telemetry = hb.telemetry ?? null; rec.lastSeenMs = nowMs;
    const held = rec.events.length ? rec.events[rec.events.length - 1].seq : 0;
    for (const ev of hb.events ?? []) if (ev.seq > held) rec.events.push(ev);
    if (rec.events.length > EVENT_RETENTION) rec.events.splice(0, rec.events.length - EVENT_RETENTION);
    return { nodeId: hb.nodeId, ack: rec.events.length ? rec.events[rec.events.length - 1].seq : held };
  }

  /** @returns Whether the node has heartbeat within the window. */
  isOnline(nodeId: string, nowMs: number): boolean {
    const rec = this.nodes.get(nodeId);
    return Boolean(rec && nowMs - rec.lastSeenMs < this.staleMs);
  }

  /** @returns Whether a caller may see a node: its owner, or anyone for an unowned node. */
  private visible(rec: NodeRecord, forSub: string | null | undefined): boolean {
    return rec.ownerSub === null || forSub === undefined || rec.ownerSub === forSub;
  }

  /** @description Resolve a node or refuse: an offline node refuses HERE, so no world is ever given a dead link; another owner's node is unknown. */
  get(nodeId: string, nowMs: number, forSub?: string | null): NodeRecord {
    const rec = this.nodes.get(nodeId);
    if (!rec || !this.visible(rec, forSub)) throw new NodeOffline(nodeId, null, false);
    if (!this.isOnline(nodeId, nowMs)) throw new NodeOffline(nodeId, rec.lastSeenMs, true);
    return rec;
  }

  /** @description Every node a caller may see, online or not, for the status route and the tile. @param expectedBuildHash - This package's engine tree hash, to flag a stale plant node. @param forSub - The caller; omitted = the machine view of everything. */
  list(nowMs: number, expectedBuildHash: string | null = null, forSub?: string | null): NodeSummary[] {
    const out: NodeSummary[] = [];
    for (const rec of this.nodes.values()) {
      if (!this.visible(rec, forSub)) continue;
      out.push({ nodeId: rec.nodeId, kind: rec.kind, ownerSub: rec.ownerSub, endpointUrl: rec.endpointUrl, engine: rec.hello.engine, version: rec.hello.version, protocol: rec.hello.protocol, buildHash: rec.hello.buildHash, stale: rec.kind === 'plant' && expectedBuildHash ? rec.hello.buildHash !== expectedBuildHash : null, online: this.isOnline(rec.nodeId, nowMs), lastSeenMs: rec.lastSeenMs, ageMs: nowMs - rec.lastSeenMs, sessions: rec.sessions, telemetry: rec.telemetry, events: rec.events.slice(-5) });
    }
    return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  /** @description Forget a node (specs; an operator action later). */
  forget(nodeId: string): boolean { return this.nodes.delete(nodeId); }
}

let shared: DroneNodeFleet | null = null;
/** @description The one fleet of this process, shared by the heartbeat mount and the world routes. @returns The fleet. */
export function sharedNodeFleet(): DroneNodeFleet {
  if (!shared) shared = new DroneNodeFleet();
  return shared;
}
