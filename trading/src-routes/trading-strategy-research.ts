/**
 * Strategy-research corpus — the peer-reviewed findings the Strategy Studio cites when it designs a
 * strategy (ADR-095 / studio). Curated + accurate: each entry is a real, published result with its
 * authors, year, journal, and DOI, plus how it maps onto OSHAL Strategy Lab knobs. The studio route
 * passes the relevance-selected subset to the analyst bot and REQUIRES it to cite only from this list,
 * so "where the finding was published" is grounded, not model-invented.
 *
 * This is a curated seed. Graduating it to the RAG corpus (a `trading-research` ChromaDB collection so
 * the analyst can cite a much wider literature + web sources with `web:` provenance) is BACKLOG.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — 9 canonical quant findings (momentum, time-series/trend, reversal, low-vol, BAB, value, momentum crashes, 52w-high) with accurate citations + knob mappings; keyword relevance selector.
 *
 * @module trading-strategy-research
 */

/** How a finding maps onto a StrategyConfig, to steer the drafted knobs. */
export interface ResearchMapping {
  /** Suggested lab kind. */
  kind?: 'rotation' | 'ensemble';
  /** Suggested ranking. */
  rank?: 'gravity' | 'momentum' | 'ensemble' | 'blend';
  /** Suggested rebalance cadence in trading days. */
  cadenceDays?: number;
  /** Free-text note on how to apply it. */
  note: string;
}

/** One published research finding the studio can cite. */
export interface ResearchFinding {
  /** Stable citation id (the studio cites by this). */
  id: string;
  /** Human name of the effect/anomaly. */
  name: string;
  /** Keywords for relevance selection. */
  tags: string[];
  /** One-sentence summary of the published result. */
  finding: string;
  /** Author list. */
  authors: string;
  /** Publication year. */
  year: number;
  /** Journal + volume/issue. */
  journal: string;
  /** DOI / stable URL. */
  url: string;
  /** How it maps onto Strategy Lab knobs. */
  maps: ResearchMapping;
}

/** The curated corpus. Every citation here is a real, published, peer-reviewed result. */
export const STRATEGY_RESEARCH: readonly ResearchFinding[] = Object.freeze([
  {
    id: 'xs-momentum', name: 'Cross-sectional momentum',
    tags: ['momentum', 'winners', 'losers', 'relative strength', 'trend', 'rotation'],
    finding: 'Stocks that outperformed over the past 3–12 months kept outperforming over the next 3–12; buying past winners and selling past losers earned ~1%/month (1965–1989).',
    authors: 'Jegadeesh & Titman', year: 1993, journal: 'Journal of Finance 48(1)',
    url: 'https://doi.org/10.1111/j.1540-6261.1993.tb04702.x',
    maps: { kind: 'rotation', rank: 'momentum', cadenceDays: 21, note: 'Rank on trailing return, hold the top decile, monthly rebalance.' },
  },
  {
    id: 'ts-momentum', name: 'Time-series (absolute) momentum',
    tags: ['trend', 'trend-following', 'time-series momentum', 'managed futures', 'futures', 'absolute momentum'],
    finding: "An asset's own 12-month excess return predicts its next-month return across 58 futures/instruments; a diversified time-series-momentum book had strong risk-adjusted returns and paid off in crises.",
    authors: 'Moskowitz, Ooi & Pedersen', year: 2012, journal: 'Journal of Financial Economics 104(2)',
    url: 'https://doi.org/10.1016/j.jfineco.2011.11.003',
    maps: { kind: 'rotation', rank: 'momentum', cadenceDays: 21, note: 'Own-asset trend sign; the futures-relevant momentum result.' },
  },
  {
    id: 'trend-century', name: 'A century of trend-following',
    tags: ['trend', 'trend-following', 'managed futures', 'futures', 'cta', 'crisis alpha', 'diversified'],
    finding: 'A simple 1/3/12-month trend strategy across equities, bonds, commodities and currencies was consistently profitable 1880–2016, with positive returns in 8 of the 10 largest equity drawdowns ("crisis alpha").',
    authors: 'Hurst, Ooi & Pedersen', year: 2017, journal: 'Journal of Portfolio Management 44(1)',
    url: 'https://doi.org/10.3905/jpm.2017.44.1.015',
    maps: { kind: 'rotation', rank: 'momentum', cadenceDays: 21, note: 'Diversified multi-horizon trend; the CTA/futures framing.' },
  },
  {
    id: 'st-reversal', name: 'Long-horizon reversal (overreaction)',
    tags: ['mean reversion', 'reversal', 'contrarian', 'overreaction'],
    finding: 'Prior long-term losers beat prior winners over the following 3–5 years — the market overreacts and mean-reverts.',
    authors: 'De Bondt & Thaler', year: 1985, journal: 'Journal of Finance 40(3)',
    url: 'https://doi.org/10.1111/j.1540-6261.1985.tb05004.x',
    maps: { kind: 'ensemble', rank: 'ensemble', cadenceDays: 21, note: 'Contrarian tilt; reversal horizon is slow, not intraday.' },
  },
  {
    id: 'low-vol', name: 'Low-volatility anomaly',
    tags: ['low volatility', 'risk', 'volatility', 'defensive', 'idiosyncratic'],
    finding: 'Stocks with high idiosyncratic volatility earned abnormally LOW returns — the opposite of a risk-return tradeoff; low-vol names are underpriced.',
    authors: 'Ang, Hodrick, Xing & Zhang', year: 2006, journal: 'Journal of Finance 61(1)',
    url: 'https://doi.org/10.1111/j.1540-6261.2006.00836.x',
    maps: { kind: 'rotation', rank: 'ensemble', cadenceDays: 21, note: 'Tilt toward low-volatility names; pairs well with a large core.' },
  },
  {
    id: 'bab', name: 'Betting against beta',
    tags: ['beta', 'low beta', 'leverage', 'risk'],
    finding: 'Low-beta assets have higher risk-adjusted returns; a beta-neutral long-low/short-high-beta portfolio earns significant alpha across markets and asset classes.',
    authors: 'Frazzini & Pedersen', year: 2014, journal: 'Journal of Financial Economics 111(1)',
    url: 'https://doi.org/10.1016/j.jfineco.2013.10.005',
    maps: { kind: 'rotation', rank: 'ensemble', cadenceDays: 21, note: 'Low-beta tilt; conservative posture.' },
  },
  {
    id: 'value', name: 'Value (book-to-market)',
    tags: ['value', 'book-to-market', 'fundamentals', 'cheap', 'size'],
    finding: 'High book-to-market ("value") stocks outperform "growth"; size and value together explain the cross-section of average returns better than beta alone.',
    authors: 'Fama & French', year: 1992, journal: 'Journal of Finance 47(2)',
    url: 'https://doi.org/10.1111/j.1540-6261.1992.tb04398.x',
    maps: { kind: 'rotation', rank: 'ensemble', cadenceDays: 63, note: 'Slow-cadence fundamental tilt.' },
  },
  {
    id: 'momentum-crashes', name: 'Momentum crashes',
    tags: ['momentum', 'crash', 'tail risk', 'drawdown', 'risk management', 'skew'],
    finding: 'Momentum suffers rare but severe crashes in panic/rebound markets (e.g. 2009); its returns are negatively skewed, so a momentum book needs dynamic risk-scaling or a stop discipline.',
    authors: 'Daniel & Moskowitz', year: 2016, journal: 'Journal of Financial Economics 122(2)',
    url: 'https://doi.org/10.1016/j.jfineco.2015.12.002',
    maps: { note: 'Risk overlay on a momentum book: stops / vol-scaling, a conservative posture with take-profit.' },
  },
  {
    id: '52w-high', name: '52-week-high momentum',
    tags: ['momentum', '52-week high', 'anchoring', 'breakout', 'proximity'],
    finding: "A stock's nearness to its 52-week high predicts future returns better than past returns themselves — traders anchor on the high and under-react to good news near it.",
    authors: 'George & Hwang', year: 2004, journal: 'Journal of Finance 59(5)',
    url: 'https://doi.org/10.1111/j.1540-6261.2004.00695.x',
    maps: { kind: 'rotation', rank: 'momentum', cadenceDays: 21, note: 'Proximity-to-52-week-high as the momentum signal.' },
  },
]);

/** Default findings when a request matches nothing specific — the broad-market workhorses. */
const DEFAULT_IDS = ['xs-momentum', 'ts-momentum', 'trend-century'];

/**
 * @description Relevance-select the findings most related to a free-text request (keyword overlap on
 * tags + name). Falls back to the default workhorse findings when nothing matches.
 * @param query - The trader's request.
 * @param n - Max findings to return (default 4).
 * @returns The selected findings, most-relevant first.
 */
export function selectResearch(query: string, n = 4): ResearchFinding[] {
  const q = query.toLowerCase();
  const scored = STRATEGY_RESEARCH.map((f) => ({ f, score: relevanceScore(f, q) }));
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.f);
  if (hits.length) return hits.slice(0, n);
  return STRATEGY_RESEARCH.filter((f) => DEFAULT_IDS.includes(f.id)).slice(0, n);
}

/** Keyword-overlap score: tag substring hits (2 pts) + name-word hits (1 pt). */
function relevanceScore(f: ResearchFinding, q: string): number {
  let score = 0;
  for (const t of f.tags) if (q.includes(t)) score += 2;
  for (const w of f.name.toLowerCase().split(/\W+/)) if (w.length > 3 && q.includes(w)) score += 1;
  return score;
}

/** Look up a finding by id (for validating the bot's citations against the real corpus). */
export function findingById(id: string): ResearchFinding | undefined {
  return STRATEGY_RESEARCH.find((f) => f.id === id);
}
