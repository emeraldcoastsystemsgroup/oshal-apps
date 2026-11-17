/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4: a made-up field consultant for the expanded-experience suites (Roger, 2026-11-16: "it covers like 20 different companies over a 4 year span when i was consulting in the field"). Three jobs, the middle one a four-year field consulting job, and 20 short client engagements over those four years stored the way Career's ledger has always stored them (name, role, industry, length in months, technology, marked not public), a few with dates and bullets, none tied to a job yet, plus client account groups and a linked work addendum. Every company here is a made-up sample name.
 */

/** The 20 made-up clients of the four-year field consulting job, in saved order. */
export const CLIENTS = [
  ['Contoso Freight', 'warehouse rollout', 'Logistics'], ['Fabrikam Health', 'claims cutover', 'Healthcare'],
  ['Tailspin Air', 'crew scheduling', 'Aviation'], ['Wingtip Retail', 'point-of-sale upgrade', 'Retail'],
  ['Litware Utilities', 'meter data migration', 'Utilities'], ['Adventure Works', 'payroll move', 'Manufacturing'],
  ['Proseware Insurance', 'quoting engine', 'Insurance'], ['Woodgrove Bank', 'ledger close', 'Banking'],
  ['Coho Winery', 'order to cash', 'Food and beverage'], ['Margie Travel', 'booking engine', 'Travel'],
  ['Lucerne Publishing', 'royalties run', 'Publishing'], ['Alpine Ski House', 'rental system', 'Leisure'],
  ['Blue Yonder Airlines', 'fare filing', 'Aviation'], ['City Power', 'outage reporting', 'Utilities'],
  ['Consolidated Messenger', 'parcel tracking', 'Logistics'], ['Fourth Coffee', 'franchise rollout', 'Food and beverage'],
  ['Graphic Design Institute', 'enrollment portal', 'Education'], ['Humongous Insurance', 'policy admin', 'Insurance'],
  ['Northwind Traders', 'inventory sync', 'Distribution'], ['Trey Research', 'lab samples tracking', 'Life sciences'],
];

/** One stored ledger entry for client n, as the ledger keeps it (no dates, no bullets, no job). */
export function ledgerEntry(n) {
  const [client, project, industry] = CLIENTS[n % CLIENTS.length];
  return {
    project: `${client} ${project}`, role: n % 3 ? 'Implementation consultant' : 'Solution architect', industry,
    duration_months: [1, 2, 3, 0.5, 4, 0.25][n % 6], tech: ['SQL', n % 2 ? 'Java' : 'Python', `Tool ${n + 1}`],
  };
}

/**
 * @description A made-up person with a four-year field consulting job and 20 client engagements over it.
 * @returns {object} a career_db.json
 */
export function consultantProfile() {
  const ledger = CLIENTS.map((_, n) => ledgerEntry(n));
  Object.assign(ledger[0], { start: '2018-02', end: '2018-04', bullets: ['Moved 14 warehouses onto one picking system', 'Trained 60 floor leads'] });
  Object.assign(ledger[1], { start: '2018-05', end: '2018-07' });
  ledger[7].public = false;
  ledger[9].notes = 'Weekend cutover crew';
  return {
    profile: { name: 'Casey Fieldwork', headline: 'Implementation consultant', experience_summary: 'Made-up summary.', clearance: 'None',
      web_presence: { addendum: 'https://example.test/casey-detailed-work-addendum.pdf' } },
    roles: [
      { id: 'r1', title: 'Principal Consultant', org: 'Northwind Advisory', start: '2022-01', end: null,
        deliverables: ['Leads the advisory practice', 'Built the delivery playbook'] },
      { id: 'r2', title: 'Field Implementation Consultant', org: 'Example Systems Group', start: '2018-01', end: '2021-12',
        deliverables: ['Delivered 20 client implementations in four years', 'Ran go-live weekends on site'] },
      { id: 'r3', title: 'Business Analyst', org: 'Sample Bank', start: '2014-06', end: '2017-12', deliverables: ['Wrote the loan reports'] },
    ],
    skills: { Core: { items: ['SQL', 'Python'] } },
    project_ledger: ledger,
    named_accounts: {
      field_clients: CLIENTS.slice(0, 12).map(([client]) => client),
      federal_agencies: ['Sample Federal Agency', 'Example Department', 'Test Bureau'],
      channel_partners: ['Partner One', 'Partner Two'],
    },
    employers: [{ name: 'Example Systems Group', span: '2018-2021', confidence: 'confirmed' }],
  };
}
