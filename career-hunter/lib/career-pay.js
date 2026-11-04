/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require explicit comparable currency and pay units instead of treating unknown employer rates as annual USD.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share unit-aware pay-range predicates and sourced occupation estimates across search and the owner's board.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'career-pay-benchmarks.json'), 'utf8'));
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const UNSUITABLE = ['%adjunct%', '%per course%', '%per-course%', 'intern %', '% intern%', '%internship%', '%apprentice%'];
const sqlString = value => "'" + value.replace(/'/g, "''") + "'";
const likeSql = patterns => '(' + patterns.map(p => `p.title LIKE ${sqlString(p)}`).join(' OR ') + ')';
const patternRegex = p => new RegExp('^' + p.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
const rules = model.rules.map(rule => ({...rule, matches: rule.patterns.map(patternRegex), excludedMatches: (rule.excludes || []).map(patternRegex)}));
const unsuitable = UNSUITABLE.map(patternRegex);
const HAS_PAY = "(COALESCE(p.salary_source,'listed') <> 'heuristic' AND (p.salary_min > 0 OR p.salary_max > 0))";
// No national USD guess for a foreign or unspecified location. Remote alone is not a country.
const ELIGIBLE = `(p.state IN (${STATES.map(sqlString).join(',')}) OR p.location LIKE '%United States%' OR instr(' ' || replace(replace(upper(COALESCE(p.location,'')),',',' '),'-',' ') || ' ', ' USA ') > 0)
 AND NOT ${likeSql(UNSUITABLE)}
 AND COALESCE(p.job_type,'') NOT IN ('intern','internship','apprentice')`;

class PayRangeError extends Error {
  constructor(message) { super(message); this.name = 'PayRangeError'; this.status = 400; this.code = 'invalid_pay_range'; }
}

function range(query = {}) {
  const bound = key => {
    if (query[key] == null || query[key] === '') return null;
    if (typeof query[key] !== 'string' || !/^\d+(\.\d{1,2})?$/.test(query[key])) throw new PayRangeError('Enter a positive pay amount with at most two decimal places.');
    const n = Number(query[key]);
    if (!Number.isFinite(n) || n <= 0 || n > 10000000) throw new PayRangeError('Pay amounts must be between 0 and 10,000,000.');
    return n;
  };
  const min = bound('min_pay'), max = bound('max_pay');
  const period = query.pay_period || 'year';
  if (!['year', 'hour', 'month'].includes(period)) throw new PayRangeError('Choose annual, hourly, or monthly pay.');
  if (min != null && max != null && min > max) throw new PayRangeError('Minimum pay cannot be higher than maximum pay.');
  return {min, max, period};
}

function band(soc, period) {
  const occupation = model.occupations[soc];
  const values = occupation[period === 'hour' ? 'hour' : 'year'];
  return values.every(n => Number.isFinite(n) && n > 0)
    ? values.map(n => period === 'month' ? Math.round(n / 12) : n) : null;
}

/** Inclusive interval overlap; missing endpoints use the reported endpoint as a point. */
function overlaps(values, selected) {
  return (!selected.min || values[1] >= selected.min) && (!selected.max || values[0] <= selected.max);
}

/** Apply the same estimate and range rules IN SQL, before pools, LIMIT, and OFFSET. */
function payFilter(query = {}) {
  const selected = range(query);
  if (selected.min == null && selected.max == null) return {sql: '', args: []};
  const args = [], comparisons = [];
  if (selected.min != null) { comparisons.push('COALESCE(NULLIF(p.salary_max,0),NULLIF(p.salary_min,0)) >= ?'); args.push(selected.min); }
  if (selected.max != null) { comparisons.push('COALESCE(NULLIF(p.salary_min,0),NULLIF(p.salary_max,0)) <= ?'); args.push(selected.max); }
  const unknown = query.include_unknown_pay === '1' ? 1 : 0;
  const eligible = ELIGIBLE + (selected.period === 'hour' ? '' : " AND COALESCE(p.job_type,'') NOT IN ('parttime','part-time','part_time')");
  const cases = rules.map(rule => {
    const values = band(rule.soc, selected.period);
    return `WHEN ${likeSql(rule.patterns)}${rule.excludes ? ' AND NOT '+likeSql(rule.excludes) : ''} THEN ${values ? Number(overlaps(values, selected)) : unknown}`;
  }).join('\n');
  return {sql: `(CASE WHEN ${HAS_PAY} THEN CASE WHEN
    UPPER(p.salary_currency) = 'USD' AND p.salary_period = ${sqlString(selected.period)}
    AND ${comparisons.join(' AND ')} THEN 1 ELSE 0 END
    WHEN ${eligible} THEN CASE ${cases} ELSE ${unknown} END ELSE ${unknown} END) = 1`, args};
}

/** Employer pay is untouched. Replace absent/old generic guesses with a dated public benchmark. */
function decoratePay(job, query = {}) {
  const hasPay = job.salary_source !== 'heuristic' && (job.salary_min > 0 || job.salary_max > 0);
  if (hasPay) return {...job, salary_estimate: job.salary_source === 'ai_estimated'
    ? {source: 'AI estimate', confidence: 'low', method: 'Model estimate, not an employer quote.'} : null};
  const copy = {...job, salary_min: null, salary_max: null, salary_source: null};
  const title = String(job.title || ''), location = String(job.location || '');
  const period = query.pay_period || 'year';
  const eligible = (STATES.includes(job.state) || (/United States/i.test(location) || location.split(/[,-]/).some(part => part.trim().toUpperCase() === 'USA')))
    && !unsuitable.some(re => re.test(title)) && !['intern', 'internship', 'apprentice'].includes(job.job_type)
    && (period === 'hour' || !['parttime','part-time','part_time'].includes(job.job_type));
  const rule = eligible && rules.find(r => r.matches.some(re => re.test(title)) && !r.excludedMatches.some(re => re.test(title)));
  const values = rule && band(rule.soc, period);
  if (!values) return {...copy, salary_estimate_unavailable: /adjunct|per.course/i.test(title)
    ? 'Per-course or hourly employer rate needed for this teaching role.' : 'No reliable occupation benchmark for this role and location.'};
  return {...copy, salary_min: values[0], salary_max: values[1], salary_currency: 'USD', salary_period: period,
    salary_source: 'bls_estimated', salary_estimate: {source: model.source, survey: model.survey,
      url: model.sourceUrl, occupation: model.occupations[rule.soc].name, soc: rule.soc,
      geography: 'US national', confidence: 'low',
      method: 'Title-matched occupation, 25th–75th percentile wages. Not employer-listed or adjusted for experience, local market, or part-time hours.'}};
}

module.exports = {PayRangeError, range, payFilter, decoratePay};
