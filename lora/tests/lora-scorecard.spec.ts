import { describe, expect, it } from 'vitest';
import { cellScore, summarizeScore, computeWeakCells, type ScoreCell } from '../src-routes/scorecard';

/** A small validation matrix: two cameras, two expressions — side-profile is the weak axis. */
const cells: ScoreCell[] = [
  { cell: 'standing|front view|grin', camera: 'front view', expression: 'grin', action: 'standing', identity: 0.9, quality: 0.8 },
  { cell: 'running|front view|scream', camera: 'front view', expression: 'scream', action: 'running', identity: 0.88, quality: 0.82 },
  { cell: 'standing|side profile|grin', camera: 'side profile', expression: 'grin', action: 'standing', identity: 0.55, quality: 0.5 },
  { cell: 'running|side profile|scream', camera: 'side profile', expression: 'scream', action: 'running', identity: 0.5, quality: 0.52 },
];

describe('lora scorecard math', () => {
  it('blends identity 0.6 / quality 0.4 when no explicit score is given', () => {
    expect(cellScore({ cell: 'x', identity: 1, quality: 0 })).toBeCloseTo(0.6, 5);
    expect(cellScore({ cell: 'x', identity: 0, quality: 1 })).toBeCloseTo(0.4, 5);
  });

  it('prefers an explicit per-cell score and clamps to 0..1', () => {
    expect(cellScore({ cell: 'x', identity: 0, quality: 0, score: 0.73 })).toBe(0.73);
    expect(cellScore({ cell: 'x', identity: 0, quality: 0, score: 9 })).toBe(1);
  });

  it('summarizes overall/identity/quality means and the worst cell', () => {
    const s = summarizeScore(cells);
    expect(s.identityMean).toBeCloseTo((0.9 + 0.88 + 0.55 + 0.5) / 4, 3);
    expect(s.minCell).toBeCloseTo(cellScore(cells[3]), 4); // the running|side-profile cell is worst
    expect(s.overall).toBeGreaterThan(0);
    expect(s.overall).toBeLessThan(1);
  });

  it('flags the systematically weak axis (side profile) and not the strong one', () => {
    const weak = computeWeakCells(cells, 0.08);
    const values = weak.map((w) => w.value);
    expect(values).toContain('side profile');
    expect(values).not.toContain('front view');
    // weakest returned first
    expect(weak[0].mean).toBeLessThanOrEqual(weak[weak.length - 1].mean);
  });

  it('returns no weak cells for an empty matrix', () => {
    expect(computeWeakCells([])).toEqual([]);
    expect(summarizeScore([]).overall).toBe(0);
  });
});
