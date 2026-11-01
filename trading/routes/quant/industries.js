/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reading the first real groups: GEO sat under Homebuilders, Exxon under Oil refining, Corning under Aluminum and FedEx under Airlines. Each range now has a name that fits what it holds, and JPMorgan's SEC record is too large to read through the kernel, so its code is kept here.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Plain industry names from the Standard Industrial Classification code each company reports to the SEC, so the list can be read by industry. Grouping only: an industry never changes a score.
 */
'use strict';

/** SIC ranges, first match wins, so a narrow range sits before the wider one around it. */
const SIC_RANGES = Object.freeze([
  [100, 999, 'Farming & fishing'], [1040, 1049, 'Gold & silver mining'], [1000, 1099, 'Metal mining'], [1200, 1299, 'Coal mining'], [1300, 1399, 'Oil & gas'], [1400, 1499, 'Minerals mining'],
  [1500, 1599, 'Builders & contractors'], [1600, 1799, 'Construction & engineering'], [2000, 2099, 'Food & drink'], [2100, 2199, 'Tobacco'], [2200, 2399, 'Clothing & textiles'], [2400, 2599, 'Wood & furniture'],
  [2600, 2699, 'Paper & packaging'], [2700, 2799, 'Publishing & printing'], [2830, 2836, 'Drugs & biotech'], [2870, 2879, 'Fertilizer & farm chemicals'], [2800, 2899, 'Chemicals'], [2900, 2999, 'Oil majors & refining'],
  [3000, 3199, 'Rubber, plastics & footwear'], [3200, 3299, 'Glass & building materials'], [3300, 3329, 'Steel & iron'], [3330, 3399, 'Aluminum, copper & wire'], [3400, 3499, 'Metal products'], [3570, 3579, 'Computers & hardware'],
  [3500, 3599, 'Machinery'], [3660, 3669, 'Communications equipment'], [3670, 3679, 'Semiconductors & components'], [3600, 3699, 'Electrical equipment'], [3710, 3716, 'Autos & parts'], [3720, 3729, 'Aerospace & defense'],
  [3760, 3769, 'Aerospace & defense'], [3700, 3799, 'Ships, rail & other vehicles'], [3840, 3851, 'Medical devices'], [3800, 3899, 'Instruments & measurement'], [3900, 3999, 'Other manufacturing'], [4000, 4099, 'Railroads'],
  [4100, 4299, 'Trucking & transit'], [4400, 4499, 'Shipping'], [4500, 4599, 'Air transport'], [4600, 4699, 'Pipelines'], [4700, 4799, 'Travel & logistics'], [4800, 4899, 'Telecom & broadcasting'],
  [4991, 4991, 'Power & gas utilities'], [4950, 4999, 'Water & waste'], [4900, 4949, 'Power & gas utilities'], [5000, 5199, 'Wholesale'], [5200, 5999, 'Retail & restaurants'], [6000, 6099, 'Banks'], [6100, 6199, 'Lenders & finance services'],
  [6200, 6299, 'Brokers & asset managers'], [6300, 6499, 'Insurance'], [6500, 6599, 'Real estate'], [6798, 6798, 'REITs'], [6700, 6799, 'Holding & investment companies'], [7000, 7099, 'Hotels & casinos'],
  [7370, 7379, 'Software & internet'], [7300, 7399, 'Business services'], [7200, 7299, 'Consumer services'], [7500, 7699, 'Consumer services'], [7800, 7999, 'Entertainment & leisure'], [8000, 8099, 'Healthcare services'],
  [8100, 8999, 'Research & professional services'],
]);

/** Codes for companies whose SEC record is larger than the kernel will fetch, so a read can never bring them. */
const SIC_OF_LARGE_RECORDS = Object.freeze({ JPM: '6021' });

/**
 * @description A company's SIC code: what it reported, or the kept code when its record is too large to read.
 * @param {string} symbol - Ticker.
 * @param {object|undefined} company - Its stored company record.
 * @returns {string|null} The code.
 */
function sicOf(symbol, company) {
  return (company && company.sic) || SIC_OF_LARGE_RECORDS[symbol] || null;
}

/**
 * @description A company's plain industry name.
 * @param {number|string|null} sic - Its SIC code.
 * @returns {string|null} The name, or null when the code is missing or outside every range.
 */
function industryOf(sic) {
  const code = Number(sic);
  if (!Number.isInteger(code) || code <= 0) return null;
  const hit = SIC_RANGES.find(([from, to]) => code >= from && code <= to);
  return hit ? hit[2] : null;
}

module.exports = { SIC_RANGES, sicOf, industryOf };
