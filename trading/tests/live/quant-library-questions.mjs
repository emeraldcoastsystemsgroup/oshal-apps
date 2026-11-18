/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.2 (lane QUANTLIB1): the quant library's questions and the citation grade, shared by the live proof on the test slot and the bot-fast replay, so both grade a reply the same way. A reply cites a shelf work that explains the question's idea when it names the work's title and one of its authors as the passage's QUANT LIBRARY line gives them, and, for a SUMMARY, says that it is a summary. The blue proof of 1.62.0 counted a link alone, or a title with its licence; the coordinator's bar for bot-fast (2026-11-17) is the title and author from the passage's own line and "this source is a summary" where it applies.
 * -----------------------------------------------------------------------------
 */

/** Library questions: the reply must cite a shelf work that explains one of these ideas. */
export const LIBRARY = Object.freeze([
  { q: 'What is the Kelly criterion, in plain words, and where does it come from?', ideas: [15] },
  { q: 'Explain the Sharpe ratio and what it leaves out.', ideas: [8] },
  { q: 'What is the efficient frontier? Which work introduced it?', ideas: [12] },
  { q: 'Explain GARCH and GJR-GARCH volatility models in plain words.', ideas: [37, 38] },
  { q: 'Why do market makers quote a bid-ask spread when some traders are better informed?', ideas: [47, 48, 45] },
  { q: 'What is the square-root law of market impact?', ideas: [49] },
  { q: 'How does a Kalman filter track a changing hedge ratio for a pair of stocks?', ideas: [50, 43] },
  { q: 'What is backtest overfitting, and how does the deflated Sharpe ratio deal with it?', ideas: [44] },
]);

/** Ordinary questions: the same tools must run with or without recall, and the library stays out of the answer. */
export const ORDINARY = Object.freeze([
  { q: 'What are my paper positions?', tools: ['trading_positions', 'trading_paper_accounts', 'trading_status', 'trading_account'] },
  { q: 'Is my Schwab account connected?', tools: ['trading_accounts'] },
  { q: 'What is on my watchlist?', tools: ['trading_watchlist'] },
]);

/** The library's own marks: an ordinary answer that shows one let a passage in where it does not bear. */
export const LIBRARY_MARKERS = /QUANT LIBRARY|Wikipedia contributors|creativecommons|\bCC BY\b|arXiv|doi\.org/i;

/** @description Text compared without case, accents or punctuation. @param {string} text Text. @returns {string} Plain words. */
export function plain(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** @description The name an author is cited by: the surname, without a suffix; "Wikipedia contributors" is cited as Wikipedia. @param {string} author Full name. @returns {string} Plain surname. */
export function surname(author) {
  const words = plain(author).split(' ').filter((word) => !['jr', 'sr', 'ii', 'iii', 'iv'].includes(word));
  if (words[1] === 'contributors') return words[0];
  return words[words.length - 1] || '';
}

/**
 * @description How a reply cites one work: its title (the first 28 characters, compared as plain words), one of its
 *   authors by surname, whether it says "summary", and whether it names the licence family or gives the link.
 * @param {string} reply The reply.
 * @param {object} work A works.json record.
 * @returns {{title: boolean, author: boolean, summary: boolean, licence: boolean}} What the reply holds.
 */
export function citation(reply, work) {
  const text = ` ${plain(reply)} `;
  const title = text.includes(plain(work.title).slice(0, 28).trim());
  const author = work.authors.some((name) => surname(name) && text.includes(` ${surname(name)} `));
  const family = plain(work.licence.name.replace(/\s+\d.*$/, ''));
  const licence = Boolean((work.link && String(reply).includes(work.link)) || (family && text.includes(` ${family} `)));
  return { title, author, summary: /summar/i.test(String(reply)), licence };
}

/**
 * @description The shelf work a reply cites for these ideas: title and author as the passage's line gives them, and a
 *   SUMMARY said as one; null when none.
 * @param {string} reply The reply.
 * @param {number[]} ideas The question's ideas.
 * @param {object[]} works The shelf's works.json records.
 * @returns {object|null} The cited work.
 */
export function citedWork(reply, ideas, works) {
  return works.find((work) => {
    if (!work.ideas.some((idea) => ideas.includes(idea))) return false;
    const held = citation(reply, work);
    return held.title && held.author && (work.kind !== 'summary' || held.summary);
  }) || null;
}
