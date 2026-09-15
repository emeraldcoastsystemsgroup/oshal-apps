/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The command queue a relay keeps for a node it cannot reach
 *                     |                             | (backlog B11, ADR-155 D10): bounded, delivered oldest first,
 *                     |                             | and never held past the destination's replay window —
 *                     |                             | because the relay cannot re-sign, a queued command must
 *                     |                             | still verify at the far end on its ORIGINAL MAC and
 *                     |                             | timestamp, and one the far end would refuse as stale is
 *                     |                             | dropped here, naming why, instead of being carried out to
 *                     |                             | be refused there. Pure: time is always the caller's.
 */

import type { RelayEnvelope } from './envelope';

/** @description The most commands one relay may hold (an ESP32 has the memory; the controller should not need more). */
export const PROXY_QUEUE_MAX_CAPACITY = 64;

/** @description How a queue is sized. */
export interface ProxyQueueOptions {
  /** Commands held at once (1..PROXY_QUEUE_MAX_CAPACITY). */
  capacity: number;
  /** The destination's replay window, ms — the hard ceiling on how long a command may be held. */
  replayWindowMs: number;
  /** How long a command may wait, measured from its own timestamp, ms (default and ceiling: the replay window). */
  holdMs?: number;
}

/** @description The queue's answer to one command. */
export type EnqueueResult = { queued: true; size: number } | { queued: false; reason: string };

/** @description One command the queue gave up on, and why. */
export interface QueueDrop {
  id: string;
  src: string;
  dst: string;
  reason: string;
}

/** @description What one drain hands back: the commands to forward now (oldest first) and those dropped. */
export interface DrainResult {
  deliver: RelayEnvelope[];
  dropped: QueueDrop[];
}

/** The next hop an envelope held at this relay goes to: the route one past the holder. */
function nextHopOf(env: RelayEnvelope): string {
  return env.route[env.hop + 1];
}

/** @description A bounded, oldest-first hold for commands whose next hop is out of reach. */
export class ProxyQueue {
  readonly capacity: number;
  readonly holdMs: number;
  private readonly held: RelayEnvelope[] = [];

  /**
   * @description Size the queue. Refuses a hold longer than the replay window: a command held that
   * long would arrive stale and be refused by the node it was meant for.
   * @param options - Capacity, the destination's replay window and an optional shorter hold.
   */
  constructor(options: ProxyQueueOptions) {
    const { capacity, replayWindowMs } = options;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > PROXY_QUEUE_MAX_CAPACITY) throw new RangeError(`capacity must be an integer from 1 to ${PROXY_QUEUE_MAX_CAPACITY}`);
    if (!Number.isFinite(replayWindowMs) || replayWindowMs <= 0) throw new RangeError('replayWindowMs must be a positive number of milliseconds');
    const holdMs = options.holdMs ?? replayWindowMs;
    if (!Number.isFinite(holdMs) || holdMs <= 0) throw new RangeError('holdMs must be a positive number of milliseconds');
    if (holdMs > replayWindowMs) throw new RangeError(`holdMs ${holdMs} exceeds the ${replayWindowMs} ms replay window: the destination would refuse the command as stale`);
    this.capacity = capacity;
    this.holdMs = holdMs;
  }

  /** @description Commands held now. */
  get size(): number {
    return this.held.length;
  }

  /**
   * @description The ids held, oldest first, with the next hop each waits for.
   * @returns A copy; the queue is not exposed.
   */
  pending(): Array<{ id: string; src: string; dst: string; next: string; ts: number }> {
    return this.held.map((env) => ({ id: env.id, src: env.src, dst: env.dst, next: nextHopOf(env), ts: env.ts }));
  }

  /**
   * @description Hold a command whose next hop is out of reach. Only commands wait: a query is
   * answered by proxy, and a reply or heartbeat is superseded by the next one.
   * @param env - The command as this relay holds it (its `hop` indexes this relay).
   * @param nowMs - The relay's clock.
   * @returns Queued with the new size, or refused with the reason.
   */
  enqueue(env: RelayEnvelope, nowMs: number): EnqueueResult {
    if (env.kind !== 'command') return { queued: false, reason: `only commands are held for a node out of reach; a ${env.kind} is not queued` };
    if (env.hop + 1 >= env.route.length) return { queued: false, reason: 'nothing to hold: this node is the destination' };
    const ageMs = nowMs - env.ts;
    if (ageMs > this.holdMs) return { queued: false, reason: expiredReason(ageMs, this.holdMs) };
    if (this.held.some((h) => h.src === env.src && h.id === env.id)) return { queued: false, reason: `command ${env.id} from ${env.src} is already held` };
    if (this.held.length >= this.capacity) return { queued: false, reason: `proxy queue full: ${this.capacity} commands already held` };
    this.held.push(env);
    return { queued: true, size: this.held.length };
  }

  /**
   * @description Release what waits for `nextHop` — its link is back — oldest first; anything held
   * past the hold (for any next hop) is dropped with the reason.
   * @param nowMs - The relay's clock.
   * @param nextHop - The neighbour that is reachable again.
   * @returns The commands to forward now and the ones dropped.
   */
  drain(nowMs: number, nextHop: string): DrainResult {
    const dropped = this.expire(nowMs);
    const deliver = this.held.filter((env) => nextHopOf(env) === nextHop);
    for (let i = this.held.length - 1; i >= 0; i -= 1) if (nextHopOf(this.held[i]) === nextHop) this.held.splice(i, 1);
    return { deliver, dropped };
  }

  /**
   * @description Drop every command held past the hold — the destination's replay window would refuse it.
   * @param nowMs - The relay's clock.
   * @returns The drops, oldest first, each naming its age and the window.
   */
  expire(nowMs: number): QueueDrop[] {
    const dropped: QueueDrop[] = [];
    for (let i = 0; i < this.held.length; ) {
      const env = this.held[i];
      const ageMs = nowMs - env.ts;
      if (ageMs > this.holdMs) { dropped.push({ id: env.id, src: env.src, dst: env.dst, reason: expiredReason(ageMs, this.holdMs) }); this.held.splice(i, 1); } else i += 1;
    }
    return dropped;
  }
}

function expiredReason(ageMs: number, holdMs: number): string {
  return `held ${Math.round(ageMs)} ms since it was signed, past the ${Math.round(holdMs)} ms the destination's replay window allows: it would be refused as stale`;
}
