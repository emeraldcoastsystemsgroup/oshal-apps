/**
 * Little Monsters — rewards routes (functional + transactional + authz).
 *
 * Mounts createEducationRewardsRoutes against a SMART MOCK POOL (no real DB) and a
 * mocked auth resolver, then drives the endpoints over HTTP. Verifies: GET state,
 * the ATOMIC box spend (the `WHERE boxes > 0` guard that prevents double-opening),
 * the duplicate→sparkle path, and that equipping an un-owned item is rejected.
 */
import express from 'express';
import { afterEach, describe, it, expect, vi } from 'vitest';

// Auth is mocked so the routes don't need a real students table.
vi.mock('@/app/routes/education-access', async (orig) => {
  const actual = await orig<typeof import('@/app/routes/education-access')>();
  return { ...actual, resolveAuthedStudent: vi.fn(async () => ({ studentId: 'stu-1' })) };
});

import { createEducationRewardsRoutes, REWARD_CATALOG } from '@/app/routes/education-rewards-routes';

/** A mock pg pool that answers the rewards queries from a mutable in-memory `state`,
 *  records every SQL it sees (for atomicity assertions), and enforces the same
 *  `boxes > 0` guard the real UPDATE does. */
function makePool(state: { boxes: number; inventory: string[]; equipped?: any; xp?: number; level?: number }) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/create table/i.test(sql)) return { rows: [] };
      if (/insert into lm_rewards.*on conflict.*returning boxes/is.test(sql)) {
        return { rows: [{ boxes: state.boxes, inventory: state.inventory, equipped: state.equipped ?? {} }] };
      }
      if (/select xp, level from lm_students/i.test(sql)) {
        return { rows: [{ xp: state.xp ?? 0, level: state.level ?? 1 }] };
      }
      if (/update lm_rewards set boxes = boxes - 1.*boxes > 0 returning/is.test(sql)) {
        if (state.boxes > 0) { state.boxes -= 1; return { rows: [{ boxes: state.boxes, inventory: state.inventory }] }; }
        return { rows: [] }; // atomic guard: no row → caller must treat as "no boxes"
      }
      if (/update lm_students set xp = xp \+ 5/i.test(sql)) return { rows: [] };
      if (/update lm_rewards set inventory/i.test(sql)) return { rows: [] };
      if (/update lm_rewards set equipped/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

const servers: Array<() => Promise<void>> = [];
async function serve(pool: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/education', createEducationRewardsRoutes({ pool } as never));
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  servers.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${addr.port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map((c) => c())); });

describe('rewards routes', () => {
  it('GET /rewards returns the student state + the catalog', async () => {
    const url = await serve(makePool({ boxes: 2, inventory: ['mon-pink'], xp: 130, level: 2 }));
    const res = await fetch(`${url}/api/education/rewards`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.boxes).toBe(2);
    expect(body.inventory).toContain('mon-pink');
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(body.catalog.length).toBe(REWARD_CATALOG.length);
  });

  it('POST /rewards/open with no boxes returns 400', async () => {
    const url = await serve(makePool({ boxes: 0, inventory: [] }));
    const res = await fetch(`${url}/api/education/rewards/open`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('POST /rewards/open spends ATOMICALLY (boxes > 0 guard) and returns an item', async () => {
    const pool = makePool({ boxes: 2, inventory: [] });
    const url = await serve(pool);
    const res = await fetch(`${url}/api/education/rewards/open`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item?.id).toBeTruthy();
    expect(body.boxesLeft).toBe(1);
    // The whole anti-double-spend guarantee is this guarded UPDATE — assert it was used.
    expect(pool.calls.some((c) => /boxes > 0/i.test(c.sql))).toBe(true);
  });

  it('POST /rewards/open on a duplicate gives a +5 XP sparkle, not a new item', async () => {
    // Own everything → whatever rolls is already owned.
    const url = await serve(makePool({ boxes: 1, inventory: REWARD_CATALOG.map((i) => i.id) }));
    const res = await fetch(`${url}/api/education/rewards/open`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(body.bonusXp).toBe(5);
  });

  it('POST /rewards/equip rejects an un-owned item (403) but accepts an owned one', async () => {
    const url = await serve(makePool({ boxes: 0, inventory: ['mon-pink'] }));
    const bad = await fetch(`${url}/api/education/rewards/equip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'mon-gold' }),
    });
    expect(bad.status).toBe(403);
    const good = await fetch(`${url}/api/education/rewards/equip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'mon-pink' }),
    });
    expect(good.status).toBe(200);
  });

  it('POST /rewards/equip rejects an item id that is not in the catalog (400)', async () => {
    const url = await serve(makePool({ boxes: 0, inventory: ['mon-pink'] }));
    const res = await fetch(`${url}/api/education/rewards/equip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'totally-made-up' }),
    });
    expect(res.status).toBe(400);
  });
});
