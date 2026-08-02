/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 21:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Guard for the Studio refine-in-place contract (the bug: /studio ignored strategyId and minted a NEW strategy every turn). Proves the prompt carries the CURRENT STRATEGY block only on refinement turns, carries the clarifying-question escape hatch, parseStudioReply still drops invented citations and THROWS on prose-only replies (the route's needsInput signal), and stripBotFences turns that prose into a clean question.
 */
import { describe, it, expect } from 'vitest';
import { parseStudioReply, stripBotFences, studioPrompt } from '../src-routes/trading-strategy-studio-prompt';
import { selectResearch } from '../src-routes/trading-strategy-research';

const FINDINGS = selectResearch('momentum rotation', 4);
const CONFIG = {
  kind: 'rotation', posture: 'balanced', corePct: 50, coreSymbol: 'SPY', takeProfitPct: null,
  rank: 'momentum', cadenceDays: 1, topN: 10, weighting: 'conviction', universe: [], warmupDays: 80, windowDays: 780,
};

describe('studioPrompt — design vs refinement turns', () => {
  it('a fresh design turn has NO current-strategy block', () => {
    const p = studioPrompt('a momentum rotation', FINDINGS);
    expect(p).toContain('TRADER REQUEST: a momentum rotation');
    expect(p).not.toContain('CURRENT STRATEGY');
  });

  it('a refinement turn feeds the current name + config back (the workflow-assistant contract)', () => {
    const p = studioPrompt('drop the take profit', FINDINGS, { name: 'Momentum 10', config: CONFIG });
    expect(p).toContain('CURRENT STRATEGY');
    expect(p).toContain('name: Momentum 10');
    expect(p).toContain(JSON.stringify(CONFIG));
    expect(p).toContain('change');
    expect(p).toContain('ONLY what the request asks for');
  });

  it('always carries the clarifying-question escape hatch (no json block on an unmappable ask)', () => {
    for (const p of [studioPrompt('x', FINDINGS), studioPrompt('x', FINDINGS, { name: 'n', config: CONFIG })]) {
      expect(p).toContain('ONE short clarifying question in plain prose and NO json block');
    }
  });
});

describe('parseStudioReply — citations + the needsInput signal', () => {
  const reply = (citations: string[]) => '```json\n' + JSON.stringify({
    name: 'Momentum 10', description: 'd', hypothesis: 'h', citations, config: CONFIG, narration: 'n',
  }) + '\n```';

  it('keeps only citations that exist in the offered corpus (invented papers die)', () => {
    const real = FINDINGS[0].id;
    const parsed = parseStudioReply(reply([real, 'fake-paper-2029']), FINDINGS);
    expect(parsed.citations.map((c) => c.id)).toEqual([real]);
  });

  it('THROWS on a prose-only reply — the route turns that into { needsInput, message }, never a 502', () => {
    expect(() => parseStudioReply('Which do you want: monthly or daily rebalancing?', FINDINGS)).toThrow();
  });
});

describe('stripBotFences', () => {
  it('strips stray fenced fragments so the clarifying question reads clean', () => {
    const q = stripBotFences('Do you want ```rank: momentum``` or the gravity ranking?');
    expect(q).toBe('Do you want or the gravity ranking?');
    expect(q).not.toContain('```');
  });
});
