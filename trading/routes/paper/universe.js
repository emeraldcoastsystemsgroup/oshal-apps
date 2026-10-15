/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper engine's default universe and sector map, copied from the legacy engine's multi-timeframe.ts DEFAULT_UNIVERSE and portfolio.ts SECTOR (reference only; nothing here is imported from the old platform). The kernel's World price writer tracks the same list, so every default name can be priced by prices.latest.
 *
 * @module paper/universe
 */
'use strict';

/** The names the paper autopilot scans when the person pinned none (159 liquid US listings). */
const DEFAULT_UNIVERSE = Object.freeze([
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'ORCL', 'CRM', 'ADBE',
  'AMD', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'NOW', 'INTU', 'AMAT', 'MU',
  'PANW', 'SNOW', 'SHOP', 'UBER', 'PLTR', 'SKHY',
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'SCHW', 'BLK', 'AXP', 'SPGI',
  'BX', 'V', 'MA', 'PYPL', 'COF', 'USB', 'PNC', 'TFC', 'CB', 'MMC',
  'WMT', 'COST', 'PG', 'KO', 'PEP', 'MCD', 'DIS', 'NKE', 'HD', 'LOW',
  'SBUX', 'TGT', 'CAT', 'GE', 'HON', 'UPS', 'BA', 'MMM', 'CL', 'PM',
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'MPC', 'VLO', 'OXY', 'WMB',
  'KMI', 'HAL', 'DVN', 'HES', 'BKR',
  'JNJ', 'LLY', 'PFE', 'MRK', 'ABBV', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN',
  'GILD', 'CVS', 'UNH', 'MDT', 'ISRG', 'VRTX', 'REGN', 'ZTS', 'BIIB', 'MRNA',
  'XBI', 'IBB', 'FBT', 'ARKG', 'GNOM',
  'ARM', 'MRVL', 'TSM', 'ASML', 'LRCX', 'KLAC', 'MPWR', 'ANET', 'SMCI', 'VRT',
  'CRWD', 'DDOG', 'NET', 'MDB', 'ZS', 'APP',
  'COIN', 'HOOD', 'SOFI', 'NU', 'AFRM',
  'DASH', 'ABNB', 'RBLX', 'CVNA', 'DUOL',
  'AXON', 'RKLB', 'PWR', 'ETN',
  'VST', 'CEG', 'GEV', 'NRG',
  'FCX', 'NEM', 'LIN', 'APD', 'SCCO', 'NUE', 'STLD', 'ALB', 'MP',
  'STX', 'WDC', 'SNDK', 'PSTG', 'NTAP',
  'MCO', 'VRSN', 'KHC',
  'TEM', 'AB',
]);

const SECTOR_GROUPS = [
  ['tech', ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'INTC', 'CSCO', 'QCOM',
    'TXN', 'IBM', 'NOW', 'INTU', 'AMAT', 'PANW', 'SNOW', 'SHOP', 'UBER', 'PLTR', 'VRSN', 'ARM', 'MRVL', 'TSM', 'ASML',
    'LRCX', 'KLAC', 'MPWR', 'ANET', 'SMCI', 'CRWD', 'DDOG', 'NET', 'MDB', 'ZS', 'APP']],
  ['financials', ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'SCHW', 'BLK', 'AXP', 'SPGI', 'BX', 'V', 'MA', 'PYPL', 'COF', 'USB',
    'PNC', 'TFC', 'CB', 'MMC', 'MCO', 'AB', 'COIN', 'HOOD', 'SOFI', 'NU', 'AFRM']],
  ['consumer', ['WMT', 'COST', 'PG', 'KO', 'PEP', 'MCD', 'DIS', 'NKE', 'HD', 'LOW', 'SBUX', 'TGT', 'CAT', 'GE', 'HON', 'UPS',
    'BA', 'MMM', 'CL', 'PM', 'KHC', 'DASH', 'ABNB', 'RBLX', 'CVNA', 'DUOL']],
  ['energy', ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'MPC', 'VLO', 'OXY', 'WMB', 'KMI', 'HAL', 'DVN', 'HES', 'BKR']],
  ['pharma', ['JNJ', 'LLY', 'PFE', 'MRK', 'ABBV', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD', 'CVS', 'UNH', 'MDT', 'ISRG',
    'VRTX', 'REGN', 'ZTS', 'BIIB', 'MRNA', 'TEM']],
  ['materials', ['FCX', 'NEM', 'LIN', 'APD', 'SCCO', 'NUE', 'STLD', 'ALB', 'MP']],
  ['storage', ['MU', 'SKHY', 'STX', 'WDC', 'SNDK', 'PSTG', 'NTAP']],
  ['biotech-etf', ['XBI', 'IBB', 'FBT', 'ARKG', 'GNOM']],
  ['industrial', ['AXON', 'RKLB', 'PWR', 'ETN', 'VRT']],
  ['ai-power', ['VST', 'CEG', 'GEV', 'NRG']],
];

/** Symbol → sector, for the per-sector cap. */
const SECTOR = Object.freeze(Object.fromEntries(SECTOR_GROUPS.flatMap(([sector, names]) => names.map((s) => [s, sector]))));

/**
 * @description The sector bucket the per-sector cap counts a symbol under.
 * @param {string} symbol - Ticker.
 * @returns {string} The sector, or 'other' for a name outside the map.
 */
function sectorOf(symbol) {
  return SECTOR[String(symbol || '').toUpperCase()] || 'other';
}

module.exports = { DEFAULT_UNIVERSE, SECTOR, sectorOf };
