/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 11:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — performanceFromEquitySeries (the /performance fallback for the LIVE book, which has no broker equity-curve endpoint). The regression under test is the SPY-base misalignment: with MORE SPY closes than recorded equity days (the normal case — only ~9 live-equity days exist), the benchmark must normalize to the first close OF THE COMPARED WINDOW (cl[0]), not spyCloses[0], or vs-S&P compares a 9-day portfolio return against a 23-day SPY return.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Moved out of the OSHAL kernel (tests/unit/trading-performance-fallback.spec.ts) with the carved trading app package (ADR-085 Wave 3): its subject performanceFromEquitySeries lives in the packaged surface now, so the guard moves WITH it — imports flip to ../src-routes/trading-routes-book-read-builders. Run from the package root with the framework checkout on the vitest alias path (camera/movies-envelope precedent). Assertions unchanged.
 */
import { describe, it, expect } from 'vitest';
import { performanceFromEquitySeries } from '../src-routes/trading-routes-book-read-builders';

// 09:00 UTC on a given day → epoch seconds, so the day-key math is deterministic.
const NOW = Math.floor(Date.parse('2026-07-15T21:00:00Z') / 1000);

function series(...eq: number[]) {
  // Ascending days ending 2026-07-15.
  const days = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-14', '2026-07-15'];
  return eq.map((equity, i) => ({ etDay: days[i] ?? `2026-07-${String(7 + i).padStart(2, '0')}`, equity }));
}

describe('performanceFromEquitySeries — total return', () => {
  it('computes return from the window base to live equity', () => {
    const p = performanceFromEquitySeries(series(50000, 51000), 52000, [], null, 50000, '1M', 'live', NOW)!;
    // window base 50000 → live 52000 = +4.0%
    expect(p.summary.totalReturnPct).toBeCloseTo(4, 2);
    expect(p.summary.inceptionReturnPct).toBeCloseTo(4, 2); // inceptionBase 50000 too
    expect(p.summary.equity).toBe(52000);
  });

  it('separates the since-inception base from the window base', () => {
    // window starts at 51000 but the account has been recorded since 50000.
    const p = performanceFromEquitySeries(series(51000, 51500), 52000, [], null, 50000, '1W', 'live', NOW)!;
    expect(p.summary.totalReturnPct).toBeCloseTo((52000 / 51000 - 1) * 100, 2); // window
    expect(p.summary.inceptionReturnPct).toBeCloseTo((52000 / 50000 - 1) * 100, 2); // inception
  });

  it('returns null for an empty series (caller then 503s honestly)', () => {
    expect(performanceFromEquitySeries([], 52000, [100], 101, 0, '1M', 'live', NOW)).toBeNull();
    expect(performanceFromEquitySeries(series(0, 0), 52000, [], null, 0, '1M', 'live', NOW)).toBeNull();
  });

  it('extends the portfolio curve to a live NOW point', () => {
    const p = performanceFromEquitySeries(series(50000, 51000), 52000, [], null, 50000, '1M', 'live', NOW)!;
    const last = p.portfolio[p.portfolio.length - 1];
    expect(last.t).toBe(NOW);
    expect(last.pct).toBeCloseTo(4, 2); // 52000 vs 50000 window base
  });
});

describe('performanceFromEquitySeries — vs-S&P alignment (the regression)', () => {
  it('normalizes SPY to the WINDOW base (cl[0]), not spyCloses[0], when SPY has more closes than equity days', () => {
    // 2 recorded equity days (07-07, 07-08), but 5 SPY closes (the normal real-world shape).
    // The daily window is 2 days → n=2 → cl = last 2 closes [450,460], base = cl[0] = 450, then the
    // line extends to NOW via spyNow=465. If the base were WRONGLY spyCloses[0]=400, SPY would read
    // (465/400-1)=+16.25% over 5 days instead of the aligned (465/450-1)=+3.33% over 2 days.
    const eq = series(50000, 50500);
    const spyCloses = [400, 420, 440, 450, 460];
    const p = performanceFromEquitySeries(eq, 51000, spyCloses, 465, 50000, '1M', 'live', NOW)!;
    expect(p.summary.spyReturnPct).toBeCloseTo((465 / 450 - 1) * 100, 1);       // aligned base 450
    expect(p.summary.spyReturnPct).not.toBeCloseTo((465 / 400 - 1) * 100, 1);   // NOT the full-array base
  });

  it('vs-S&P = portfolio return minus SPY return, over the SAME window', () => {
    const eq = series(50000, 50500);
    const spyCloses = [400, 420, 440, 450, 460];
    const p = performanceFromEquitySeries(eq, 51000, spyCloses, 465, 50000, '1M', 'live', NOW)!;
    const expectedPort = (51000 / 50000 - 1) * 100;   // +2.0%  (live 51000 vs window base 50000)
    const expectedSpy = (465 / 450 - 1) * 100;        // ≈ +3.33% (spyNow vs aligned base 450)
    expect(p.summary.vsSpyPct).toBeCloseTo(expectedPort - expectedSpy, 1);
  });

  it('handles an empty SPY series (portfolio still returns; vs-S&P is just the portfolio)', () => {
    const p = performanceFromEquitySeries(series(50000, 51000), 52000, [], null, 50000, '1M', 'live', NOW)!;
    expect(p.spy).toHaveLength(0);
    expect(p.summary.spyReturnPct).toBe(0);
    expect(p.summary.vsSpyPct).toBeCloseTo(p.summary.totalReturnPct, 2);
  });
});
