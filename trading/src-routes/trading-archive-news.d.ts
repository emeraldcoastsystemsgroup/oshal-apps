/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Types for routes/trading-archive-news.js (Research headlines from the World archive).
 *
 * @module trading-archive-news
 */
import type { NewsItem } from '@/features/trading';
import type { NewsCoverage } from './trading-company-news';

/**
 * @description The newest archived headlines for one ticker, in Research's news shape.
 * @param ctx - Route context on the native kernel (ctx.intent).
 * @param symbol - Upper-case ticker.
 * @param now - The clock.
 * @returns Headlines, newest first, and their coverage.
 */
export function readArchiveNews(ctx: unknown, symbol: string, now?: Date): Promise<{ items: NewsItem[]; coverage: NewsCoverage }>;
