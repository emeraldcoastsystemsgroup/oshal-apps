/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The relay envelope: a source-routed, end-to-end authenticated
 *                     |                             | wrapper around the core drone node's {id, command, args}
 *                     |                             | command and its heartbeat, carried hop by hop over whatever
 *                     |                             | radio the chain uses. A relay decides from the route alone
 *                     |                             | (deliver, forward to the next id, or drop naming why); it
 *                     |                             | never reads the payload and cannot forge it (HMAC by the
 *                     |                             | source, verified by the destination); loops, exhausted
 *                     |                             | hop budgets, foreign routes and oversized routes are refused;
 *                     |                             | a heartbeat forwarded inward records each relay and the
 *                     |                             | signal it saw so the controller learns the chain's health;
 *                     |                             | frames larger than a transport's MTU are fragmented and
 *                     |                             | reassembled by sequence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | PROXY (backlog B11, ADR-155 D10). A `query` asks a node for
 *                     |                             | its status; while that node is out of reach the outermost
 *                     |                             | reachable relay answers with an ordinary `reply` of its own,
 *                     |                             | signed with its own pair key and stamped `proxy: {for,
 *                     |                             | ageS}`. The stamp is covered by the MAC (a relay on the way
 *                     |                             | back cannot add, strip or age it); an envelope without one
 *                     |                             | signs exactly as before. Forwarding still reads the route
 *                     |                             | alone — neither the kind nor the stamp changes a decision.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** @description The controller's id on every route. */
export const BASE_ID = 'base';

/** @description The most hops a route may carry. */
export const MAX_ROUTE = 16;

/** @description One record a relay appends to an inward heartbeat. */
export interface ViaRecord {
  node: string;
  rssiDbm: number;
}

/** @description What an envelope carries: a command for a node, a status query, the answer to either, or a heartbeat inward. */
export type EnvelopeKind = 'command' | 'query' | 'reply' | 'heartbeat';

/**
 * @description The stamp on a reply a relay sends on behalf of a node it cannot reach: who it
 * stands in for and how old (seconds, by the relay's clock) the heartbeat it answers from is.
 */
export interface ProxyStamp {
  for: string;
  ageS: number;
}

/** @description The envelope. `hop` indexes `route` at the node currently holding it. */
export interface RelayEnvelope {
  v: 1;
  id: string;
  kind: EnvelopeKind;
  src: string;
  dst: string;
  route: string[];
  hop: number;
  ttl: number;
  ts: number;
  payload: unknown;
  via?: ViaRecord[];
  /** Present only on a reply a relay sends for a node it cannot reach (covered by the MAC). */
  proxy?: ProxyStamp;
  mac?: string;
}

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * @description The route from the base to `dst` through the chain in inward → outward order, or from
 * `dst` back to the base for a reply. The chain order is what the controller knows from positions.
 * @param chainOrder - Node ids from the innermost relay outward (the tip last).
 * @param dst - The destination id (must be on the chain).
 * @param direction - Outward (command) or inward (reply / heartbeat).
 * @returns The route including both ends.
 */
export function routeThrough(chainOrder: string[], dst: string, direction: 'outward' | 'inward'): string[] {
  const at = chainOrder.indexOf(dst);
  if (at < 0) throw new RangeError(`destination ${dst} is not on the chain`);
  const outward = [BASE_ID, ...chainOrder.slice(0, at + 1)];
  if (outward.length > MAX_ROUTE) throw new RangeError(`route longer than ${MAX_ROUTE} hops`);
  return direction === 'outward' ? outward : outward.slice().reverse();
}

/**
 * @description Build an envelope at its source (hop 0, ttl = the route's length).
 * @param fields - Kind, route, payload, timestamp, an optional id and — on a reply only — the proxy stamp.
 * @returns The envelope, unsigned.
 */
export function buildEnvelope(fields: { kind: EnvelopeKind; route: string[]; payload: unknown; ts: number; id?: string; proxy?: ProxyStamp }): RelayEnvelope {
  const route = validateRoute(fields.route);
  const env: RelayEnvelope = { v: 1, id: fields.id ?? `${route[0]}-${fields.ts}-${Math.floor(Math.random() * 1e9)}`, kind: fields.kind, src: route[0], dst: route[route.length - 1], route, hop: 0, ttl: route.length, ts: fields.ts, payload: fields.payload };
  if (fields.proxy !== undefined) env.proxy = validateProxy(fields.proxy, fields.kind, route[0]);
  return env;
}

/**
 * @description A proxy stamp is legal only on a reply, names another well-formed node and carries a
 * finite, non-negative age. Why only a reply: a relay answers FOR a node; it never commands or
 * heartbeats as one.
 * @param proxy - Candidate stamp.
 * @param kind - The envelope's kind.
 * @param src - The envelope's source (the relay itself).
 * @returns The stamp, age rounded to a tenth of a second.
 */
function validateProxy(proxy: ProxyStamp, kind: EnvelopeKind, src: string): ProxyStamp {
  if (kind !== 'reply') throw new RangeError('only a reply may carry a proxy stamp');
  if (!proxy || typeof proxy.for !== 'string' || !NODE_ID.test(proxy.for)) throw new RangeError('proxy.for must be a node id');
  if (proxy.for === src) throw new RangeError('a node does not stand in for itself');
  if (typeof proxy.ageS !== 'number' || !Number.isFinite(proxy.ageS) || proxy.ageS < 0) throw new RangeError('proxy.ageS must be a finite number of seconds, zero or more');
  return { for: proxy.for, ageS: Math.round(proxy.ageS * 10) / 10 };
}

/**
 * @description Validate a route: two to MAX_ROUTE well-formed ids, no repeats.
 * @param route - Candidate.
 * @returns The route.
 */
export function validateRoute(route: unknown): string[] {
  if (!Array.isArray(route) || route.length < 2) throw new RangeError('route needs at least a source and a destination');
  if (route.length > MAX_ROUTE) throw new RangeError(`route longer than ${MAX_ROUTE} hops`);
  const ids = route.map((r) => String(r));
  if (ids.some((id) => !NODE_ID.test(id))) throw new RangeError('route ids must be short lowercase identifiers');
  if (new Set(ids).size !== ids.length) throw new RangeError('route repeats a node (loop)');
  return ids;
}

/**
 * @description The bytes the MAC covers: everything a relay must not change. The proxy stamp joins
 * as a ninth element only when present — as a pair, so its key order cannot matter — which leaves
 * every envelope without one signing exactly as it always did. Total over untrusted input: a stamp
 * that is not an object is covered as itself, so it can neither throw nor pass for an absent one.
 */
function canonical(env: RelayEnvelope): string {
  const covered: unknown[] = [env.v, env.id, env.kind, env.src, env.dst, env.route, env.ts, env.payload];
  const p: unknown = env.proxy;
  if (p !== undefined) covered.push(p && typeof p === 'object' ? [(p as ProxyStamp).for, (p as ProxyStamp).ageS] : p);
  return JSON.stringify(covered);
}

/**
 * @description Sign the envelope end to end with the pair's key (the enrolment secret of the destination).
 * @param env - The envelope.
 * @param key - Shared key.
 * @returns A copy carrying `mac`.
 */
export function signEnvelope(env: RelayEnvelope, key: string): RelayEnvelope {
  return { ...env, mac: createHmac('sha256', key).update(canonical(env)).digest('hex').slice(0, 32) };
}

/**
 * @description Verify the end-to-end MAC in constant time.
 * @param env - The envelope.
 * @param key - Shared key.
 * @returns True when the MAC matches.
 */
export function verifyEnvelope(env: RelayEnvelope, key: string): boolean {
  if (typeof env.mac !== 'string' || env.mac.length !== 32) return false;
  const expected = Buffer.from(createHmac('sha256', key).update(canonical(env)).digest('hex').slice(0, 32), 'utf8');
  const given = Buffer.from(env.mac, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** @description What a node holding an envelope does with it. */
export type ForwardDecision = { action: 'deliver' } | { action: 'forward'; to: string } | { action: 'drop'; reason: string };

/**
 * @description Decide from the route alone. A node forwards only when it is exactly the route's current
 * hop; anything else is dropped with the reason (never silently).
 * @param env - The envelope as received.
 * @param selfId - This node.
 * @returns The decision.
 */
export function decideForward(env: RelayEnvelope, selfId: string): ForwardDecision {
  if (env.v !== 1) return { action: 'drop', reason: 'unknown envelope version' };
  if (!Array.isArray(env.route) || env.route.length < 2 || env.route.length > MAX_ROUTE) return { action: 'drop', reason: 'malformed route' };
  if (env.ttl <= 0) return { action: 'drop', reason: 'ttl exhausted' };
  if (!Number.isInteger(env.hop) || env.hop < 0 || env.hop >= env.route.length) return { action: 'drop', reason: 'hop index off the route' };
  if (env.route[env.hop] !== selfId) return { action: 'drop', reason: `not addressed to ${selfId} at hop ${env.hop}` };
  if (env.route.indexOf(selfId) !== env.hop) return { action: 'drop', reason: 'route loops through this node' };
  if (env.hop === env.route.length - 1) return env.dst === selfId ? { action: 'deliver' } : { action: 'drop', reason: 'route ends at a node that is not the destination' };
  return { action: 'forward', to: env.route[env.hop + 1] };
}

/**
 * @description The envelope as the next hop will receive it.
 * @param env - The envelope.
 * @returns A copy with hop + 1 and ttl − 1.
 */
export function advance(env: RelayEnvelope): RelayEnvelope {
  return { ...env, hop: env.hop + 1, ttl: env.ttl - 1 };
}

/**
 * @description A relay forwarding a heartbeat inward records itself and the signal it saw.
 * @param env - The heartbeat.
 * @param selfId - This relay.
 * @param rssiDbm - Signal of the frame as received.
 * @returns A copy with the record appended (the MAC does not cover `via`).
 */
export function viaAppend(env: RelayEnvelope, selfId: string, rssiDbm: number): RelayEnvelope {
  return { ...env, via: [...(env.via ?? []), { node: selfId, rssiDbm: Math.round(rssiDbm) }] };
}

/** @description Replay protection: an id seen inside the window is refused. */
export class ReplayWindow {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /**
   * @description Accept an envelope once per id inside the window; stale timestamps are refused.
   * @param env - The envelope.
   * @param nowMs - Receiver clock.
   * @returns True when fresh.
   */
  accept(env: RelayEnvelope, nowMs: number): boolean {
    if (Math.abs(nowMs - env.ts) > this.windowMs) return false;
    for (const [id, ts] of this.seen) if (nowMs - ts > this.windowMs) this.seen.delete(id);
    const key = `${env.src}|${env.id}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs);
    return true;
  }
}

/** @description One fragment of a frame too large for a transport's MTU. */
export interface Fragment {
  id: string;
  seq: number;
  count: number;
  data: Uint8Array;
}

/**
 * @description Split bytes into fragments of at most `mtu` payload bytes.
 * @param bytes - The frame.
 * @param mtu - Payload per fragment.
 * @param id - Frame id.
 * @returns The fragments in order.
 */
export function fragment(bytes: Uint8Array, mtu: number, id: string): Fragment[] {
  if (!Number.isInteger(mtu) || mtu < 1) throw new RangeError('mtu must be a positive integer');
  const count = Math.max(1, Math.ceil(bytes.length / mtu));
  const out: Fragment[] = [];
  for (let seq = 0; seq < count; seq += 1) out.push({ id, seq, count, data: bytes.subarray(seq * mtu, (seq + 1) * mtu) });
  return out;
}

/**
 * @description Reassemble fragments (any order); null until every sequence number is present.
 * @param frags - Fragments of one frame.
 * @returns The frame, or null.
 */
export function reassemble(frags: Fragment[]): Uint8Array | null {
  if (!frags.length) return null;
  const { id, count } = frags[0];
  if (frags.some((f) => f.id !== id || f.count !== count)) return null;
  const bySeq = new Map(frags.map((f) => [f.seq, f.data]));
  if (bySeq.size !== count) return null;
  const parts: Uint8Array[] = [];
  for (let seq = 0; seq < count; seq += 1) {
    const part = bySeq.get(seq);
    if (!part) return null;
    parts.push(part);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
