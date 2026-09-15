/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The relay role a relay-capable node carries (backlog B11 on
 *                     |                             | B1's shape, ADR-155 D3 + D10). It decides from the route
 *                     |                             | alone and forwards when the next hop answers. When the next
 *                     |                             | hop is out of reach it stands in for whatever lies beyond:
 *                     |                             | a QUERY is answered from the destination's last heartbeat —
 *                     |                             | an ordinary reply signed with this relay's own pair key,
 *                     |                             | stamped proxy {for, ageS}, carrying that heartbeat as
 *                     |                             | received so the controller can check the far node's own MAC
 *                     |                             | — and a COMMAND waits in a ProxyQueue until the next hop is
 *                     |                             | heard again, then goes out on its original MAC and
 *                     |                             | timestamp, or is dropped naming why if it waited past the
 *                     |                             | replay window. It never reads a payload and never re-signs
 *                     |                             | anything it forwards. Pure: the clock and the link view are
 *                     |                             | the caller's, so a node double, a companion and a test run
 *                     |                             | the same lines.
 */

import { type RelayEnvelope, advance, buildEnvelope, decideForward, signEnvelope } from './envelope';
import { ProxyQueue, type QueueDrop } from './proxy-queue';

/** @description What the node's transport knows about a neighbour right now (an ack, a probe, a beacon). */
export interface LinkView {
  up(nodeId: string): boolean;
}

/** @description How a node is set up for the relay role. */
export interface RelayRoleOptions {
  /** This node's id on every route. */
  self: string;
  /** The key this node shares with the base from enrolment: what its OWN replies — proxy ones included — are signed with. */
  pairKey: string;
  /** The replay window every node enforces, ms: the ceiling on how long a command may be held. */
  replayWindowMs: number;
  /** Commands held at once (default 8). */
  queueCapacity?: number;
  /** A shorter hold than the replay window, ms (leave the far hops time to carry it). */
  holdMs?: number;
}

/** @description What the node does next. `env` is always the envelope as the NEXT hop will receive it. */
export type RoleAction =
  | { action: 'forward'; to: string; env: RelayEnvelope }
  | { action: 'deliver'; env: RelayEnvelope }
  | { action: 'proxy-reply'; to: string; env: RelayEnvelope }
  | { action: 'queued'; id: string; next: string; size: number }
  | { action: 'drop'; id: string; reason: string };

/** @description The default number of commands a relay holds for a node it cannot reach. */
export const DEFAULT_QUEUE_CAPACITY = 8;

interface HeardHeartbeat {
  env: RelayEnvelope;
  heardAtMs: number;
}

function dropOf(d: QueueDrop): RoleAction {
  return { action: 'drop', id: d.id, reason: d.reason };
}

/** @description One node's relay role: forward, deliver, answer by proxy, hold and release. */
export class RelayRole {
  readonly self: string;
  private readonly pairKey: string;
  private readonly queue: ProxyQueue;
  private readonly heard = new Map<string, HeardHeartbeat>();

  /**
   * @description Set the role up. The queue's hold is bounded by the replay window here, once.
   * @param options - Identity, key, replay window, queue size and hold.
   */
  constructor(options: RelayRoleOptions) {
    if (!options.self) throw new RangeError('self must be the id of this node');
    if (!options.pairKey) throw new RangeError('pairKey must be the key this node shares with the base');
    this.self = options.self;
    this.pairKey = options.pairKey;
    this.queue = new ProxyQueue({ capacity: options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY, replayWindowMs: options.replayWindowMs, holdMs: options.holdMs });
  }

  /**
   * @description Handle one envelope as received. Hearing a frame from the previous hop is that link
   * working, so commands waiting for it go first (oldest first); then this envelope's own action.
   * @param env - The envelope as it arrived (`hop` indexes this node).
   * @param nowMs - This node's clock.
   * @param link - The transport's view of the neighbours.
   * @returns The actions, in the order to carry them out.
   */
  receive(env: RelayEnvelope, nowMs: number, link: LinkView): RoleAction[] {
    const decision = decideForward(env, this.self);
    if (decision.action === 'drop') return [{ action: 'drop', id: String(env.id), reason: decision.reason }];
    const prev = env.hop > 0 ? env.route[env.hop - 1] : null;
    const released = prev !== null && link.up(prev) ? this.release(prev, nowMs) : [];
    if (decision.action === 'deliver') return [...released, { action: 'deliver', env }];
    if (env.kind === 'heartbeat') this.heard.set(env.src, { env, heardAtMs: nowMs });
    return [...released, this.onward(env, decision.to, nowMs, link)];
  }

  /**
   * @description The link to `neighbour` is back (a probe, an ack): send what waits for it.
   * @param neighbour - The node reachable again.
   * @param nowMs - This node's clock.
   * @returns Drops for commands held too long, then the forwards, oldest first.
   */
  release(neighbour: string, nowMs: number): RoleAction[] {
    const { deliver, dropped } = this.queue.drain(nowMs, neighbour);
    return [...dropped.map(dropOf), ...deliver.map((env): RoleAction => ({ action: 'forward', to: neighbour, env: advance(env) }))];
  }

  /**
   * @description Give up on every command held past the hold (a periodic tick).
   * @param nowMs - This node's clock.
   * @returns One drop per command, naming its age and the window.
   */
  expire(nowMs: number): RoleAction[] {
    return this.queue.expire(nowMs).map(dropOf);
  }

  /**
   * @description What is held now, oldest first.
   * @returns Ids, ends, the next hop each waits for and its timestamp.
   */
  pending(): ReturnType<ProxyQueue['pending']> {
    return this.queue.pending();
  }

  /** Forward when the next hop answers; otherwise stand in for it by kind — never by payload. */
  private onward(env: RelayEnvelope, next: string, nowMs: number, link: LinkView): RoleAction {
    if (link.up(next)) return { action: 'forward', to: next, env: advance(env) };
    if (env.hop === 0) return { action: 'drop', id: env.id, reason: `next hop ${next} is out of reach of the source` };
    if (env.kind === 'query') return this.proxyReply(env, next, nowMs);
    if (env.kind === 'command') {
      const held = this.queue.enqueue(env, nowMs);
      return held.queued ? { action: 'queued', id: env.id, next, size: held.size } : { action: 'drop', id: env.id, reason: held.reason };
    }
    return { action: 'drop', id: env.id, reason: `next hop ${next} is out of reach; a ${env.kind} is not held (the next one supersedes it)` };
  }

  /**
   * The answer this relay may give for a node it cannot reach: its own reply, back along the route
   * the query came by, signed with its own key, stamped with whom it stands in for and how old the
   * heartbeat it answers from is — and that heartbeat, untouched, as the payload.
   */
  private proxyReply(query: RelayEnvelope, next: string, nowMs: number): RoleAction {
    const last = this.heard.get(query.dst);
    if (!last) return { action: 'drop', id: query.id, reason: `next hop ${next} is out of reach and ${this.self} has heard no heartbeat from ${query.dst} to answer for it` };
    const route = query.route.slice(0, query.hop + 1).reverse();
    const reply = buildEnvelope({ kind: 'reply', route, payload: last.env, ts: nowMs, id: `proxy-${query.id}`, proxy: { for: query.dst, ageS: (nowMs - last.heardAtMs) / 1000 } });
    return { action: 'proxy-reply', to: route[1], env: advance(signEnvelope(reply, this.pairKey)) };
  }
}
