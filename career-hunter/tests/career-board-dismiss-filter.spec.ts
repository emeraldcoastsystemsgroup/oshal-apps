/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:52:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Regression guard for the operator-reported board bug: dismissed jobs reappeared on every reload. The surface animates a dismissed card away without reloading (ac34b79) while persisting user_signals.status='dismissed', so GET /jobs returning dismissed rows in the default feed was invisible until refresh — then they re-rendered with no Dismiss button (the surface hides it at that status) and could not be cleared. Guards the default-exclusion rule AND the explicit status=dismissed escape hatch the "Dismissed" pipeline tab depends on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildJobFilters, resolveEngineCli } from '../src-routes/career-hunter-routes';

/** The board's default feed request — the surface sends no `status` until a pipeline tab is picked. */
const defaultFeed = {} as Record<string, string>;

describe('buildJobFilters — dismissed jobs must not come back on reload', () => {
  it('excludes dismissed from the default feed', () => {
    const { whereSql } = buildJobFilters(defaultFeed);
    expect(whereSql).toContain("COALESCE(s.status,'') <> 'dismissed'");
  });

  it('still lists dismissed when the Dismissed tab asks for them explicitly', () => {
    const { whereSql, args } = buildJobFilters({ status: 'dismissed' });
    expect(whereSql).toContain('s.status = ?');
    expect(args).toContain('dismissed');
    // The blanket exclusion must NOT also apply, or the tab would always render empty.
    expect(whereSql).not.toContain("<> 'dismissed'");
  });

  it('does not smuggle the exclusion into other status tabs', () => {
    const { whereSql, args } = buildJobFilters({ status: 'applied' });
    expect(whereSql).toContain('s.status = ?');
    expect(args).toContain('applied');
    expect(whereSql).not.toContain("<> 'dismissed'");
  });

  it('keeps excluding dismissed when other filters are combined with the default feed', () => {
    const { whereSql, args } = buildJobFilters({ q: 'platform', remote: '1', min_score: '80' });
    expect(whereSql).toContain("COALESCE(s.status,'') <> 'dismissed'");
    expect(whereSql).toContain('(p.title LIKE ? OR p.description LIKE ?)');
    expect(args).toContain('%platform%');
  });

  it('leaves the always-on active/lane predicates intact, in their sargable form', () => {
    const { whereSql } = buildJobFilters(defaultFeed);
    expect(whereSql).toContain('p.active = 1');
    // Was COALESCE(p.target_role,0) = 1. Identical results on a 0/1/NULL column, but the COALESCE
    // form is unindexable, so the planner could not use idx_corpus_lane (active, target_role) and
    // fell back to materialising ~157K joined rows — the operator-reported 50s board load.
    expect(whereSql).toContain('p.target_role = 1');
    expect(whereSql).not.toContain('COALESCE(p.target_role');
  });

  it('drops the lane predicate for lane=all but still hides dismissed', () => {
    const { whereSql } = buildJobFilters({ lane: 'all' });
    expect(whereSql).not.toContain('p.target_role = 1');
    expect(whereSql).toContain("COALESCE(s.status,'') <> 'dismissed'");
  });
});

/**
 * The carve (core 7194f417) deleted scripts/oshal-jobhunter.js from the framework; the CLI now
 * ships in this package's bin/. The const still pointed at cwd()/scripts, so every engine spawn
 * died MODULE_NOT_FOUND — the board's Match/Score buttons no-oped and the nightly title pass
 * logged reason:'engine-failed' for every user. This guard keeps resolution package-relative.
 */
describe('resolveEngineCli — the engine CLI must resolve inside the package', () => {
  const saved = process.env.JOBHUNTER_CLI;
  afterEach(() => {
    if (saved === undefined) delete process.env.JOBHUNTER_CLI;
    else process.env.JOBHUNTER_CLI = saved;
  });

  it('resolves the packaged bin/, never the deleted core scripts/ path', () => {
    delete process.env.JOBHUNTER_CLI;
    const cli = resolveEngineCli().replace(/\\/g, '/');
    expect(cli).toMatch(/\/career-hunter\/bin\/oshal-jobhunter\.js$/);
    expect(cli).not.toMatch(/\/scripts\/oshal-jobhunter\.js$/);
  });

  it('honors an explicit JOBHUNTER_CLI override', () => {
    process.env.JOBHUNTER_CLI = '/custom/engine.js';
    expect(resolveEngineCli()).toBe('/custom/engine.js');
  });
});
