/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the drone-node fleet (ADR-099, B20), the core DroneFleet's shape for this package: nodes join by authenticated heartbeat (identity, kind, the endpoint the api dials back, the bridge hello, the latest telemetry, events since the api's ack) and are minted on first contact; staleness is the liveness signal — a node that stops heartbeating is offline and cannot be given a world; ids and sizes are bounded so a misbehaving client cannot grow the map or inject path-hostile ids. One fleet per process, shared by the heartbeat mount and the world routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A node belongs to one owner (ADR-114): the sub the mounter resolved from the trusted service user-sub header is recorded on first contact, a heartbeat for that node from another owner is refused, and an owned node is unknown to everyone else — the fleet lists and hands out only what a caller may see (unowned nodes, a loopback development case, are visible to all).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-175 hardening (security review of #420): a node's heartbeat no longer decides where the swarm secret goes. Each record mints a random COMMAND KEY, returned only in that node's own heartbeat reply, and commands to the node carry it instead of SWARM_SERVICE_SECRET. The endpoint host must be on EMBODIED_NODE_ENDPOINT_HOSTS (default: the engine's compose aliases), which closes the SSRF. A node owner holds at most MAX_NODES_PER_OWNER records, and a full fleet evicts a record silent for STALE_EVICT_MS before refusing.
 */

import { randomBytes } from 'node:crypto';
import type { BridgeHello } from '../physics/bridge-client';

/** A node is offline once this long passes without a heartbeat (nodes push every ~2 s; the core drone fleet's window). */
export const HEARTBEAT_STALE_MS = 15_000;
export const MAX_NODES = 16;
/** One owner's share of the fleet: nobody can fill it alone (ADR-175 review, finding 5). */
export const MAX_NODES_PER_OWNER = 8;
/** A full fleet evicts a record silent this long before refusing a new node. */
export const STALE_EVICT_MS = 10 * 60_000;
/** The hosts a node may declare as its command endpoint unless EMBODIED_NODE_ENDPOINT_HOSTS says otherwise: the engine's compose aliases. */
export const DEFAULT_ENDPOINT_HOSTS: readonly string[] = ['embodied-engine', 'embodied-px4'];
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
  /** The key every command to this node carries (x-node-command-key). Minted per record, returned only in its own heartbeat reply. */
  commandKey: string;
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
  private readonly maxPerOwner: number;
  /** Hosts a node may name as its command endpoint (lowercase). */
  readonly endpointHosts: readonly string[];

  constructor(opts: { staleMs?: number; maxNodes?: number; maxPerOwner?: number; endpointHosts?: readonly string[] } = {}) {
    this.staleMs = opts.staleMs ?? HEARTBEAT_STALE_MS;
    this.maxNodes = opts.maxNodes ?? MAX_NODES;
    this.maxPerOwner = opts.maxPerOwner ?? MAX_NODES_PER_OWNER;
    this.endpointHosts = (opts.endpointHosts ?? endpointHostsFromEnv()).map((h) => h.toLowerCase());
  }

  /**
   * @description Absorb one authenticated heartbeat: validate, mint or refresh, merge events by seq.
   * @param raw - The body. @param nowMs - The clock. @param ownerSub - The owner the mounter resolved for the caller (null = unowned).
   * @returns The node id and the event ack cursor for the node.
   */
  ingest(raw: unknown, nowMs: number, ownerSub: string | null = null): { nodeId: string; ack: number; commandKey: string } {
    const hb = validateHeartbeat(raw);
    this.assertEndpointHost(hb.endpointUrl);
    let rec = this.nodes.get(hb.nodeId);
    if (!rec) {
      this.admitNewRecord(ownerSub, nowMs);
      rec = { nodeId: hb.nodeId, kind: hb.kind, ownerSub, endpointUrl: hb.endpointUrl, hello: { protocol: hb.protocol, engine: hb.engine, version: hb.version, buildHash: hb.buildHash }, sessions: 0, telemetry: null, events: [], firstSeenMs: nowMs, lastSeenMs: nowMs, commandKey: randomBytes(32).toString('base64url') };
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
    return { nodeId: hb.nodeId, ack: rec.events.length ? rec.events[rec.events.length - 1].seq : held, commandKey: rec.commandKey };
  }

  /** @description Refuse an endpoint whose host is not an allowed node host (the api dials it). @param endpointUrl - The declared URL. */
  private assertEndpointHost(endpointUrl: string): void {
    let host = '';
    try { host = new URL(endpointUrl).hostname.toLowerCase(); } catch { throw new NodeValidationError('endpointUrl must be a plain http(s) URL'); }
    if (!this.endpointHosts.includes(host)) {
      throw new NodeValidationError(`endpoint host "${host}" is not an allowed node host (EMBODIED_NODE_ENDPOINT_HOSTS: ${this.endpointHosts.join(', ')})`);
    }
  }

  /** @description Make room for a new record or refuse: one owner's cap first, then a stale record yields its slot. @param ownerSub - The new node's owner. @param nowMs - The clock. */
  private admitNewRecord(ownerSub: string | null, nowMs: number): void {
    const owned = [...this.nodes.values()].filter((r) => r.ownerSub !== null && r.ownerSub === ownerSub).length;
    if (ownerSub !== null && owned >= this.maxPerOwner) throw new NodeValidationError(`this owner is at its ${this.maxPerOwner}-node limit`);
    if (this.nodes.size < this.maxNodes) return;
    let stalest: NodeRecord | null = null;
    for (const r of this.nodes.values()) if (nowMs - r.lastSeenMs >= STALE_EVICT_MS && (!stalest || r.lastSeenMs < stalest.lastSeenMs)) stalest = r;
    if (!stalest) throw new NodeValidationError(`the fleet is at its ${this.maxNodes}-node limit`);
    this.nodes.delete(stalest.nodeId);
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

/** @description The allowed node endpoint hosts from EMBODIED_NODE_ENDPOINT_HOSTS (comma-separated), else the defaults. @returns Hosts. */
export function endpointHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = String(env.EMBODIED_NODE_ENDPOINT_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return listed.length ? listed : [...DEFAULT_ENDPOINT_HOSTS];
}

let shared: DroneNodeFleet | null = null;
/** @description The one fleet of this process, shared by the heartbeat mount and the world routes. @returns The fleet. */
export function sharedNodeFleet(): DroneNodeFleet {
  if (!shared) shared = new DroneNodeFleet();
  return shared;
}
