/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: company headlines from the kernel's World archive (the feeds.news intent) for Research on the native kernel. Research news needed a Finnhub connection this installation does not have, while the archive collects tens of thousands of recent headlines per ticker. Each item keeps its outlet, link and first-seen time; repeated headlines and unsafe links are dropped, and the coverage note says where the headlines come from.
 *
 * @module trading-archive-news
 */
'use strict';

const WINDOW_DAYS = 7;
const LIMIT = 25;

/**
 * @description An article link the page may navigate to: http(s), no credentials, no control characters.
 * @param {unknown} raw - The stored link.
 * @returns {string|null} The link, or null.
 */
function articleUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || /[\u0000- \u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/**
 * @description A small stable numeric id for one archived item (NewsItem ids are numbers).
 * @param {string} hash - The archive's item hash.
 * @returns {number} A non-negative safe integer.
 */
function itemId(hash) {
  let h = 0;
  for (const c of String(hash)) h = (h * 31 + c.charCodeAt(0)) % 9007199254740881;
  return h;
}

/**
 * @description The newest archived headlines for one ticker, in Research's news shape.
 * @param {{intent: Function}} ctx - Route context on the native kernel.
 * @param {string} symbol - Upper-case ticker.
 * @param {Date} [now] - The clock (the coverage window).
 * @returns {Promise<{items: object[], coverage: object}>} Headlines, newest first, and where they came from.
 */
async function readArchiveNews(ctx, symbol, now = new Date()) {
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) throw new Error('Company news symbol is invalid.');
  const answer = await ctx.intent('feeds.news', { entity: `world:ticker:${symbol.toLowerCase()}`, days: WINDOW_DAYS, limit: 100 });
  const items = [], seen = new Set();
  let excluded = 0;
  for (const row of (answer && answer.items) || []) {
    const url = articleUrl(row.link), headline = typeof row.title === 'string' ? row.title.trim() : '';
    const at = Date.parse(row.pubDate || row.firstSeenAt);
    const key = headline.toLowerCase();
    if (!url || !headline || !Number.isFinite(at) || seen.has(url) || seen.has(key)) { excluded += 1; continue; }
    seen.add(url); seen.add(key);
    items.push({ id: itemId(row.itemHash), symbols: [symbol], headline, summary: String(row.summary || '').slice(0, 2000),
      source: String(row.outlet || '').trim() || 'World archive', url, createdAt: new Date(at).toISOString() });
    if (items.length === LIMIT) break;
  }
  return { items, coverage: { source: 'World archive headlines', fetchedAt: now.toISOString(),
    from: new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString(), through: now.toISOString(), excluded,
    note: 'Headlines oshal\'s World archive collected for this ticker from public news feeds over the last seven days; each shows its outlet and time. Repeated headlines are shown once.' } };
}

module.exports = { readArchiveNews };
