/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:46:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: in-memory pumpkin projector "rooms" for the paired-remote topology (mirrors the Jarvis TV-room pattern). A projector registers a room + gets a pairing token; a phone/control remote lists the owner's rooms and pushes speak/preset/mode events, which fan out to the room's live SSE listeners. TTL-swept (pairing-style volatility) and strictly scoped by OIDC sub.
 */

import crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { PumpkinMode, PumpkinExpression } from './pumpkin-engine-types';

const logger = createChildLogger({ module: 'pumpkin-rooms' });

/** Room drops off the list this long after its last heartbeat. */
const ROOM_TTL_MS = 90 * 1000;

/** An event fanned out to a room's live projector listeners. */
export type PumpkinEvent =
  | { type: 'speak'; say: string; expression: PumpkinExpression; intensity: number; voiceId?: string; rate?: number; mimic?: boolean }
  | { type: 'preset'; name: string }
  | { type: 'mode'; mode: PumpkinMode }
  | { type: 'ping' };

type Listener = (evt: PumpkinEvent) => void;

interface PumpkinRoom {
  sub: string;
  room: string;
  label: string;
  token: string;
  lastSeen: number;
  listeners: Set<Listener>;
}

/** Public (token-free) room descriptor the remote sees when picking a screen. */
export interface PumpkinRoomInfo {
  room: string;
  label: string;
  live: boolean;
}

/** Slugify a room label into a safe id token (≤40 chars). */
function roomSlug(room: string): string {
  return String(room || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'main';
}

/** Per-user key so one account's rooms never collide with another's. */
function key(sub: string, room: string): string {
  return `${sub}|${room}`;
}

/**
 * In-memory registry of live projector rooms. All access is scoped by the owner's OIDC sub, so a
 * caller can only ever see, subscribe to, or push into their OWN rooms. Volatile by design — a
 * projector that stops heartbeating simply disappears.
 */
export class PumpkinRoomRegistry {
  private readonly rooms = new Map<string, PumpkinRoom>();

  /** Drop rooms that stopped heartbeating (and close nothing — dead listeners self-clean on write). */
  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.rooms) {
      if (now - v.lastSeen > ROOM_TTL_MS && v.listeners.size === 0) this.rooms.delete(k);
    }
  }

  /**
   * @description Register (or refresh) a projector room for a user and return its slug + pairing
   * token. The token is minted once per room and required to push into it.
   * @param sub - The owner's OIDC sub.
   * @param label - Human room label ("Front Porch").
   */
  register(sub: string, label: string): { room: string; label: string; token: string } {
    this.sweep();
    const room = roomSlug(label);
    const k = key(sub, room);
    const existing = this.rooms.get(k);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.label = (String(label || '').trim() || existing.label).slice(0, 40);
      return { room, label: existing.label, token: existing.token };
    }
    const entry: PumpkinRoom = {
      sub,
      room,
      label: (String(label || '').trim() || 'Main').slice(0, 40),
      token: crypto.randomBytes(18).toString('hex'),
      lastSeen: Date.now(),
      listeners: new Set(),
    };
    this.rooms.set(k, entry);
    logger.info({ sub, room }, 'pumpkin room registered');
    return { room, label: entry.label, token: entry.token };
  }

  /** Refresh a room's heartbeat. Returns false if unknown. */
  heartbeat(sub: string, room: string): boolean {
    const entry = this.rooms.get(key(sub, roomSlug(room)));
    if (!entry) return false;
    entry.lastSeen = Date.now();
    return true;
  }

  /** List the owner's rooms (token-free). */
  list(sub: string): PumpkinRoomInfo[] {
    this.sweep();
    const now = Date.now();
    const out: PumpkinRoomInfo[] = [];
    for (const v of this.rooms.values()) {
      if (v.sub !== sub) continue;
      out.push({ room: v.room, label: v.label, live: now - v.lastSeen <= ROOM_TTL_MS });
    }
    return out;
  }

  /**
   * @description Subscribe a projector's SSE connection to a room. Returns an unsubscribe fn, or
   * null if the room doesn't exist for this owner.
   */
  subscribe(sub: string, room: string, listener: Listener): (() => void) | null {
    const entry = this.rooms.get(key(sub, roomSlug(room)));
    if (!entry) return null;
    entry.listeners.add(listener);
    entry.lastSeen = Date.now();
    return () => entry.listeners.delete(listener);
  }

  /**
   * @description Push an event to every live listener of a room. Requires the room's pairing token
   * (constant-time compared) so only a paired remote can drive the screen. Returns the number of
   * listeners reached, or -1 when the token/room is invalid.
   */
  push(sub: string, room: string, token: string, evt: PumpkinEvent): number {
    const entry = this.rooms.get(key(sub, roomSlug(room)));
    if (!entry) return -1;
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(entry.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return -1;
    entry.lastSeen = Date.now();
    for (const l of entry.listeners) {
      try { l(evt); } catch (err) { logger.error({ err, room }, 'pumpkin listener push failed'); }
    }
    return entry.listeners.size;
  }
}

/** Process-wide singleton — rooms live for the api process lifetime. */
export const pumpkinRooms = new PumpkinRoomRegistry();
