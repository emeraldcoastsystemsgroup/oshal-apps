/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | NGD, ORLA, SAND and BITF returned no prices at Schwab on the first full read, so they leave the themes.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger asked for the niches a size-ordered list misses: mining and metals, uranium, crypto and the like. Hand-kept groups of tickers, a label and nothing more: a theme adds names to the pool and a filter to the screen, and never changes a score. Funds appear only where a fund is the plain way to hold the thing, as with gold, silver and crypto.
 */
'use strict';

/** Hand-kept themes. A ticker that no longer trades shows up as "no data", so a stale entry is visible and harmless. */
const THEMES = Object.freeze([
  { name: 'Gold & silver', tickers: ['NEM', 'B', 'AEM', 'KGC', 'AU', 'GFI', 'WPM', 'FNV', 'RGLD', 'PAAS', 'HL', 'AG', 'CDE', 'EGO', 'BTG', 'IAG', 'HMY', 'SBSW', 'OR', 'SSRM', 'EQX', 'FSM', 'TFPM', 'GAU', 'USAU', 'DRD', 'CGAU', 'MUX', 'EXK', 'ASM', 'PPTA', 'IDR', 'GLD', 'IAU', 'SLV', 'GDX', 'GDXJ', 'SIL', 'SILJ', 'PPLT', 'PALL'] },
  { name: 'Copper & base metals', tickers: ['FCX', 'SCCO', 'TECK', 'HBM', 'ERO', 'TGB', 'BHP', 'RIO', 'VALE', 'MTAL', 'TMQ', 'TMC', 'NEXA', 'COPX', 'CPER', 'XME', 'PICK'] },
  { name: 'Steel & aluminum', tickers: ['NUE', 'STLD', 'CLF', 'CMC', 'RS', 'MT', 'TX', 'GGB', 'SID', 'ATI', 'CRS', 'WS', 'AA', 'CENX', 'KALU', 'ASTL', 'MTUS', 'TS', 'SLX'] },
  { name: 'Uranium & nuclear', tickers: ['CCJ', 'UEC', 'UUUU', 'NXE', 'DNN', 'LEU', 'OKLO', 'SMR', 'NNE', 'BWXT', 'URG', 'EU', 'URA', 'URNM', 'NLR'] },
  { name: 'Lithium & rare earths', tickers: ['ALB', 'SQM', 'LAC', 'SGML', 'MP', 'USAR', 'UAMY', 'NB', 'IONR', 'CRML', 'ABAT', 'LAR', 'LIT', 'REMX'] },
  { name: 'Coal', tickers: ['BTU', 'AMR', 'CNR', 'ARLP', 'HCC', 'METC', 'NRP', 'SXC', 'NC'] },
  { name: 'Crypto stocks', tickers: ['MSTR', 'COIN', 'HOOD', 'MARA', 'RIOT', 'CLSK', 'HUT', 'CORZ', 'IREN', 'CIFR', 'WULF', 'BTDR', 'HIVE', 'APLD', 'CAN', 'BMNR', 'SBET', 'GLXY', 'BLSH', 'CRCL', 'GEMI', 'BKKT', 'EXOD', 'KULR'] },
  { name: 'Crypto funds', tickers: ['IBIT', 'FBTC', 'GBTC', 'BITB', 'ARKB', 'BTC', 'HODL', 'ETHA', 'ETHE', 'FETH', 'ETH', 'BITO'] },
  { name: 'Defense & space', tickers: ['LMT', 'NOC', 'GD', 'RTX', 'LHX', 'HII', 'KTOS', 'AVAV', 'RKLB', 'LUNR', 'ASTS', 'RDW', 'PL', 'BKSY', 'MRCY', 'LDOS', 'BAH', 'CACI', 'SAIC', 'HEI', 'TDG', 'CW', 'DRS'] },
  { name: 'Drones & robotics', tickers: ['AVAV', 'KTOS', 'RCAT', 'ONDS', 'JOBY', 'ACHR', 'UMAC', 'DPRO', 'SERV', 'RR', 'ISRG', 'TER', 'SYM', 'PATH'] },
  { name: 'Quantum computing', tickers: ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ'] },
  { name: 'AI hardware', tickers: ['NVDA', 'AMD', 'AVGO', 'MRVL', 'SMCI', 'VRT', 'ANET', 'CRDO', 'ALAB', 'COHR', 'LITE', 'NBIS', 'CRWV', 'DELL', 'MU'] },
  { name: 'Solar & hydrogen', tickers: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'NXT', 'ARRY', 'SHLS', 'CSIQ', 'JKS', 'DQ', 'PLUG', 'BE', 'FCEL', 'BLDP'] },
  { name: 'Ocean shipping', tickers: ['ZIM', 'STNG', 'FRO', 'DHT', 'INSW', 'TNK', 'SBLK', 'GNK', 'DAC', 'GSL', 'MATX'] },
  { name: 'Water', tickers: ['AWK', 'WTRG', 'AWR', 'CWT', 'MSEX', 'YORW', 'XYL', 'WMS', 'MWA', 'BMI'] },
  { name: 'Cannabis', tickers: ['TLRY', 'CGC', 'CRON', 'ACB', 'SNDL'] },
  { name: 'Fertilizer & farming', tickers: ['NTR', 'MOS', 'CF', 'FMC', 'CTVA', 'DE', 'AGCO', 'ADM', 'BG', 'ICL', 'SMG', 'LNN', 'ANDE'] },
  { name: 'Obesity drugs', tickers: ['LLY', 'NVO', 'VKTX', 'AMGN', 'PFE', 'HIMS', 'ALT'] },
  { name: 'Gene editing', tickers: ['CRSP', 'NTLA', 'BEAM', 'EDIT', 'PRME'] },
]);

/** The theme every name a member of Congress has traded carries. */
const CONGRESS_THEME = 'Traded by Congress';

const THEMES_BY_TICKER = new Map();
for (const { name, tickers } of THEMES) for (const ticker of tickers) THEMES_BY_TICKER.set(ticker, [...(THEMES_BY_TICKER.get(ticker) || []), name]);

/**
 * @description The theme names a stock belongs to.
 * @param {string} symbol - Ticker.
 * @param {Set<string>} [congressNames] - Every name a member of Congress has traded.
 * @returns {string[]} Theme names, possibly none.
 */
function themesOf(symbol, congressNames) {
  const themes = THEMES_BY_TICKER.get(symbol) || [];
  return congressNames && congressNames.has(symbol) ? [...themes, CONGRESS_THEME] : themes;
}

/**
 * @description Every ticker named in any theme.
 * @returns {string[]} Tickers, each once.
 */
function themeTickers() {
  return [...THEMES_BY_TICKER.keys()];
}

module.exports = { THEMES, CONGRESS_THEME, themesOf, themeTickers };
