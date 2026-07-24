/**
 * Little Monsters — pure-logic tests (no DB, no server).
 *
 * Covers the deterministic building blocks of the gamification loop: the XP→level
 * curve, the XP event table, the reward catalog's integrity, and the rarity-weighted
 * box roll. These are the pieces a regression would most quietly break.
 */
import { describe, it, expect } from 'vitest';
import { levelFromXP, XP_TABLE } from '@/app/routes/education-routes';
import { rollItem, REWARD_CATALOG } from '@/app/routes/education-rewards-routes';

describe('LM XP + level curve', () => {
  it('starts at level 1 with 0 XP and never decreases as XP grows', () => {
    expect(levelFromXP(0)).toBe(1);
    let prev = 1;
    for (let xp = 0; xp <= 6000; xp += 25) {
      const lvl = levelFromXP(xp);
      expect(lvl).toBeGreaterThanOrEqual(prev);
      prev = lvl;
    }
  });

  it('crosses into level 2 at the first 100-XP threshold', () => {
    expect(levelFromXP(99)).toBe(1);
    expect(levelFromXP(100)).toBeGreaterThanOrEqual(2);
  });

  it('exposes positive XP for every game + study event that drives the loop', () => {
    for (const evt of ['game_warmup', 'game_played', 'tutor_question', 'quiz_completed', 'flashcard_session', 'study_session']) {
      expect(XP_TABLE[evt], evt).toBeGreaterThan(0);
    }
  });

  it('awards no XP for an unknown event type', () => {
    expect(XP_TABLE['definitely-not-an-event']).toBeUndefined();
  });
});

describe('LM reward catalog + box roll', () => {
  it('every catalog item has a unique id and a well-formed shape', () => {
    const ids = new Set<string>();
    for (const item of REWARD_CATALOG) {
      expect(ids.has(item.id), `duplicate id ${item.id}`).toBe(false);
      ids.add(item.id);
      expect(['monster', 'accessory']).toContain(item.type);
      expect(['common', 'uncommon', 'rare', 'legendary']).toContain(item.rarity);
      if (item.type === 'monster') {
        expect(typeof item.hue === 'number' || item.rainbow === true, `monster ${item.id} needs a hue or rainbow`).toBe(true);
      } else {
        expect(item.emoji, `accessory ${item.id} needs an emoji`).toBeTruthy();
        expect(['top', 'eyes', 'side']).toContain(item.pos);
      }
    }
  });

  it('includes the always-owned default pink monster', () => {
    expect(REWARD_CATALOG.find((i) => i.id === 'mon-pink')).toBeTruthy();
  });

  it('rollItem only ever returns items that exist in the catalog', () => {
    const ids = new Set(REWARD_CATALOG.map((i) => i.id));
    for (let i = 0; i < 500; i++) expect(ids.has(rollItem().id)).toBe(true);
  });

  it('is rarity-weighted: common is far more frequent than legendary', () => {
    let common = 0, legendary = 0;
    for (let i = 0; i < 4000; i++) {
      const r = rollItem().rarity;
      if (r === 'common') common++;
      else if (r === 'legendary') legendary++;
    }
    // common weight 60 vs legendary 3 → expect a wide gap (guard, not an exact ratio).
    expect(common).toBeGreaterThan(legendary * 4);
  });
});
