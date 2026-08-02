/**
 * Sensitivity, organisation, timeline and the fatal-flaw register.
 *
 * THE SENSITIVITY DOCUMENT IS THE HONEST REPLACEMENT FOR A CRITIC. "Which of these
 * assumptions most changes the answer" is arithmetic, not an opinion, and the whole
 * model is rebuilt at each end of each researched range to find out. An assumption
 * with no stated range is excluded rather than swept over an invented one, because
 * manufacturing a range manufactures the very uncertainty the chart claims to
 * measure.
 *
 * THE ORGANISATION DOCUMENT REFUSES TO PRICE THE ROLES IN THE BASE PLAN, because
 * the dataset says explicitly that the operator must supply a labour rate and that
 * a number invented here would be worthless. So the base plan is founder-operated
 * at zero salary — which is a real, stateable choice and also the most favourable
 * possible assumption — and a separate staffed scenario shows what any rate does to
 * the answer. "Even paying nobody, it does not work" is a stronger finding than any
 * salary table.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the rebuilt-model tornado on two objectives, the founder-operated versus staffed organisation comparison, the backward-scheduled critical path with its blocking corner, and the fatal-flaw register ranked by what ends the venture rather than by what is easy to mitigate.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/**
 * @description The sensitivity and risk document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function sensitivity(R) {
  return doc([
    '# Sensitivity and risk',
    C.posture(R, R.base),
    C.scenarioLine(R.sweepRun),
    '',
    `**Swept on the market-priced configuration, not on a cost-up one.** A cost-up run solves its shelf price to hold a target contribution rate, so a dearer component raises the price and therefore raises contribution per unit — true, and a chart of it would report that expensive parts are good for margin. Taking the price as observed makes contribution a result.`,
    '',
    `Every bar below was produced by rebuilding the entire model at each end of an assumption's own researched range — ${num(R.cashSweep.rebuilds)} full model rebuilds for the cash chart and ${num(R.marginSweep.rebuilds)} for the margin chart. No analytic shortcut was used, and an assumption with no stated range was excluded rather than swept over an invented one.`,
    '## What moves the funding requirement',
    tornadoTable(R, R.cashSweep.sweep, R.sweepRun, 'peak cash position', usd0),
    '## What moves contribution per unit',
    tornadoTable(R, R.marginSweep.sweep, R.sweepRun, 'contribution per unit', usd),
    '## Excluded from the sweep, and why',
    excludedSection(R),
    '## Swept, and moved nothing',
    inertSection(R),
    '## The risk register',
    riskTable(R),
    '## What the arithmetic cannot rank',
    unrankableSection(R),
    C.footer(R),
  ]);
}

/**
 * @description One tornado chart as a table.
 * @param {object} R - The full run result.
 * @param {object} sweep - The sweep result.
 * @param {object} run - The base run.
 * @param {string} objective - What was measured.
 * @param {Function} fmtSwing - Money formatter for the swing column.
 * @returns {string} A markdown table.
 */
function tornadoTable(R, sweep, run, objective, fmtSwing) {
  const top = sweep.bars.slice(0, 15);
  const max = top.length ? top[0].swingMicros : 1;
  const rows = top.map((b, i) => {
    const a = run.ledger.byId[b.assumptionId];
    const meta = run.meta[b.assumptionId] || {};
    const fmt = (v) => (a.unit === 'micros' ? usd(v) : a.unit === 'bps' ? pct(v) : dec(v, 3));
    const barWidth = Math.max(1, Math.round((b.swingMicros / max) * 24));
    return [
      String(i + 1), cell(b.assumptionId), cell(b.label),
      `${fmt(b.lowValue)} – ${fmt(b.highValue)}`,
      fmtSwing(b.swingMicros), '`' + '#'.repeat(barWidth) + '`',
      b.direction === 'increases' ? 'raises it' : b.direction === 'decreases' ? 'lowers it' : 'no effect',
      cell(a.confidence), meta.needsQuote ? 'yes' : 'no',
    ];
  });
  return [
    `Ranked by how far each input moves the ${objective} across its own range. Showing the top ${num(top.length)} of ${num(sweep.bars.length)} swept inputs.`,
    '',
    table(['#', 'Assumption', 'What it is', 'Range', 'Swing', '', 'A higher value', 'Confidence', 'Needs a quote'],
      rows, ['r', 'l', 'l', 'l', 'r', 'l', 'l', 'l', 'c']),
  ].join('\n');
}

/**
 * @description What the sweep left out.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function excludedSection(R) {
  const excluded = R.cashSweep.sweep.issues.filter((i) => i.where.startsWith('sensitivity:'));
  const rows = excluded.map((i) => [cell(i.where.replace('sensitivity:', '')), cell(i.message)]);
  return [
    `${num(excluded.length)} registered assumptions were not swept because they carry no stated range. That is the correct behaviour: inventing a range for a chart would manufacture the uncertainty the chart exists to measure.`,
    '',
    rows.length ? table(['Assumption', 'Why it was excluded'], rows) : '_Every registered assumption carries a range._',
  ].join('\n');
}

/**
 * @description Inputs that were swept and moved neither objective at all, with
 *   whether the model is even wired to them.
 *
 *   THIS SECTION EXISTS BECAUSE OF A DEFECT IN THIS EXAMPLE'S OWN FIRST DRAFT. Nine
 *   channel inputs — including customer acquisition cost, which is the largest
 *   single deduction on the direct channel — were registered with ranges but never
 *   connected to the model, so the sweep dutifully rebuilt the model twice for each
 *   of them and reported a swing of exactly zero. The chart looked entirely
 *   plausible. "This input does not matter" and "this input is not connected to
 *   anything" produce the same bar, and only one of them is a finding.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function inertSection(R) {
  const rows = R.inert.map((i) => [
    cell(i.id), cell(i.label), i.bound ? 'yes' : '**no**',
    i.bound ? 'connected, and genuinely does not move these two objectives' : 'not connected to this scenario\'s model',
  ]);
  return [
    `${num(R.inert.length)} swept inputs moved neither the funding requirement nor the contribution per unit by a single micro-dollar. Each is listed with whether the model is actually wired to it, because a zero bar has two completely different meanings and a chart cannot tell them apart.`,
    '',
    table(['Assumption', 'What it is', 'Wired to the model', 'Reading'], rows),
    '',
    `**The unwired ones are unwired for a reason that is visible in the scenario definition**: the base run sells through one channel only, in one product tier, on one tariff branch, at production volume. A retailer's margin cannot move a plan with no retailer in it; a marketplace advertising rate cannot move a plan with no marketplace; the value tier's parts are not in the premium tier's bill of materials. Each of them is live in the scenarios where it belongs, and the unit-economics table shows those.`,
    '',
    `**The wired-but-flat ones are the more interesting group.** The sell-through quantity moves neither objective because the cash trough happens months before a single unit is sold and because contribution is measured per unit rather than in total — it is nonetheless the largest unmeasured input in the plan, and it dominates the net income the profit statement reports. The liquidation recovery rate is flat for the same reason. **A tornado chart on a pre-revenue funding requirement measures pre-revenue spending and nothing else**, which is worth knowing before treating it as a ranking of what matters.`,
  ].join('\n');
}

/**
 * @description The dataset's risk register, with the computed swing where one
 *   exists.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function riskTable(R) {
  const swept = new Map(R.cashSweep.sweep.bars.map((b) => [b.assumptionId, b]));
  const rows = R.ds.criticalRisks.map((r) => {
    const ids = [r.bomLine, r.assumption, ...(r.assumptions || [])].filter(Boolean);
    const bar = ids.map((id) => swept.get(id)).find(Boolean);
    return [
      cell(r.id), cell(r.severity), cell(r.title), cell(r.impact),
      bar ? usd0(bar.swingMicros) : 'not modelled',
      cell(r.mitigation || ''), cell(r.resolveBy || ''),
    ];
  });
  return table(['Id', 'Severity', 'Risk', 'Impact', 'Modelled swing', 'Mitigation', 'What would settle it'], rows);
}

/**
 * @description The risks arithmetic cannot rank.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function unrankableSection(R) {
  const notModelled = R.ds.criticalRisks.filter((r) => !r.bomLine && !r.assumption && !r.assumptions);
  return [
    `${num(notModelled.length)} of the ${num(R.ds.criticalRisks.length)} registered risks have no modelled dollar swing at all, and they are not the small ones:`,
    '',
    notModelled.map((r) => `- **${cell(r.title)}** (${cell(r.severity)}) — ${cell(r.impact)}`).join('\n'),
    '',
    `A tornado chart ranks the risks that are already numbers. It cannot rank a risk that has no number, and three of the most likely endings for this venture — condensation on the optics, a microphone that cannot hear over the blower, and software that cannot run a full evening unattended — are in exactly that category. **Reading the chart as a complete risk ranking is the specific mistake this document exists to prevent.**`,
  ].join('\n');
}

/**
 * @description The organisation and hiring plan.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function organisation(R) {
  const staffed = R.byId['va-mid-8528-dtc-staffed'];
  const base = R.base;
  const roles = R.ds.assumptions.find((a) => a.id === 'A-HR-2');
  const rate = base.ledger.byId['M-LABOUR-RATE'];
  const roleRows = staffed.model.headcount.assumptionRefs.length
    ? staffed.input.roles.map((r) => [
      cell(r.title), cell(r.kind), dec(r.fteRatio, 2), cell(r.startMonth), cell(r.endMonth || 'end of horizon'),
      usd0(r.annualBaseMicros), usd0(Math.round(r.annualBaseMicros * r.fteRatio)),
    ])
    : [];
  return doc([
    '# Organisation and hiring',
    C.posture(R, base),
    '## The base plan employs nobody, and that is deliberate',
    [
      `The dataset lists six functions a hardware venture needs that a software team does not have, and then says something unusual and correct: the costs are "deliberately not stated — the engine should price these against a labour-rate assumption the operator supplies, not against a number invented here."`,
      '',
      `So the base plan is founder-operated at zero salary. That is a real choice a first-timer makes, and it is also **the most favourable possible assumption**. Every profit and cash figure elsewhere in this document set is computed with nobody being paid. If the venture does not work under that assumption it does not work under any staffing assumption, which is a stronger finding than any salary table.`,
    ].join('\n'),
    '## The functions the venture needs regardless of who does them',
    table(['Function', 'Why a software team does not already have it'], functionRows(R, roles), ['l', 'l']),
    '## What happens when they are paid',
    [
      `A separate scenario prices all six against a clearly-labelled placeholder of ${usd0(rate.value)} per role per year fully loaded, over a ${usd0(rate.band.low)}–${usd0(rate.band.high)} range, at half-time each for fourteen months. **That rate is not in the dataset and is not researched; it exists only to show the shape of the effect.**`,
      '',
      roleRows.length ? table(['Role', 'Kind', 'FTE', 'From', 'To', 'Annual base (placeholder)', 'Annual at FTE'], roleRows, ['l', 'l', 'r', 'l', 'l', 'r', 'r']) : '',
      '',
      staffedComparison(R, base, staffed),
    ].join('\n'),
    '## The one role the plan cannot do without',
    [
      `Every other function can be deferred, contracted or done badly for one season. Sourcing cannot. ${ratioPct(base.landed.shareRatio)} of the landed cost rests on lines nobody has quoted, the top of the sensitivity chart is a component whose required specification may not exist at its assumed price, and the two highest-leverage open questions in the whole venture are both answered by a person making supplier phone calls.`,
      '',
      `In an organisation of one, that is the thing the one person should be doing, and it should be happening before any of the ${usd0(-R.preRevenue[base.spec.id].totalMicros)} of pre-revenue spend is committed.`,
    ].join('\n'),
    C.footer(R),
  ]);
}

/**
 * @description The six functions, from the dataset.
 * @param {object} R - The full run result.
 * @param {object} roles - The dataset role list record.
 * @returns {Array<Array<string>>} Table rows.
 */
function functionRows(R, roles) {
  const why = {
    'mechanical/industrial designer (enclosure, panel, cradle)': 'There is no enclosure, no panel specification and no cradle; all three are physical parts that must survive a night outdoors.',
    'compliance and certification manager': 'Four certification regimes apply and none has been booked; a missed standard is a recall rather than a variance.',
    'sourcing and supplier-quality manager (SRM)': 'No supplier has been contacted. This is the function that converts the plan from guesses into quotes.',
    'logistics and customs coordinator': 'One shipment a year, a step-function freight cost, and an unresolved tariff classification worth more than the margin.',
    'retail account/sales manager for the category-review cycle': 'The category-review calendar runs 9 to 12 months ahead of the season and outreach starts months before that.',
    'customer support with a seasonal spike': 'A product that fails at night, unattended, in the rain, generates its support load in a six-week window.',
  };
  return roles.value.map((r) => [cell(r), cell(why[r] || '')]);
}

/**
 * @description Founder-operated versus staffed.
 * @param {object} R - The full run result.
 * @param {object} base - The founder-operated run.
 * @param {object} staffed - The staffed run.
 * @returns {string} A markdown table plus its reading.
 */
function staffedComparison(R, base, staffed) {
  const rows = [
    ['Headcount cost across the horizon', usd0(base.model.headcount.totalMicros), usd0(staffed.model.headcount.totalMicros)],
    ['Peak full-time equivalents', num(base.model.headcount.peakFte), num(staffed.model.headcount.peakFte)],
    ['Fixed costs across the horizon', usd0(base.model.financials.totals.fixedCostsMicros), usd0(staffed.model.financials.totals.fixedCostsMicros)],
    ['Net income across the horizon', usd0(base.model.financials.totals.netIncomeMicros), usd0(staffed.model.financials.totals.netIncomeMicros)],
    ['Peak funding required', usd0(base.model.financials.peakCash.fundingRequiredMicros), usd0(staffed.model.financials.peakCash.fundingRequiredMicros)],
  ];
  return [
    table(['', 'Founder-operated', 'Six roles at half time'], rows, ['l', 'r', 'r']),
    '',
    `_Both columns are cost-up runs, so their shelf price floats up with their cost to hold a target contribution rate. The net income figures are therefore comparable with each other and with nothing else, and no break-even volume is quoted for either: in a cost-up run it is an artefact of the pricing rule. The decision-relevant figures are in the market-priced runs._`,
    '',
    `**Staffing this venture properly costs ${usd0(staffed.model.headcount.totalMicros)} against a single production run that turns over ${usd0(R.byId['va-market-dtc'].model.financials.totals.revenueMicros)} at the one price point that clears its cost.** That is the arithmetic reason a hardware venture at this scale is a founder-operated venture or it is not a venture; and it is also why the six functions above end up being done part-time, by one person, badly, which is where the certification and sourcing failures come from.`,
  ].join('\n');
}

/**
 * @description The timeline and critical-path document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function timeline(R) {
  const base = R.base;
  const worst = R.byId['va-high-8528-dtc'];
  return doc([
    '# Timeline and critical path',
    C.posture(R, base),
    '## Scheduled backward from the shelf',
    'A seasonal product has one date that does not move. Everything else is scheduled backward from it, and the engine reports the gap rather than describing the plan as tight.',
    '',
    criticalPathTable(R, base),
    '## The corner where the season is lost',
    [
      `At the high end of the lead-time and qualification ranges the same plan **blocks**. ${C.scenarioLine(worst)}`,
      '',
      criticalPathTable(R, worst),
      '',
      `The engine's own words: "${cell((worst.model.issues.find((i) => i.code === 'critical-path-misses-window') || {}).message || 'the window is missed')}"`,
      '',
      `**That is not a schedule risk, it is a lost year.** A seasonal product that arrives in November has not made a smaller profit; it has made no revenue at all and holds a full run of inventory with near-zero residual value until the following August. And the two inputs that produce it — component lead time and supplier qualification time — are both registered by this run as guesses, because the dataset states neither.`,
    ].join('\n'),
    '## The dates that are not in the engine',
    calendarSection(R),
    '## The month-by-month plan',
    cashEventTable(R, base),
    C.footer(R),
  ]);
}

/**
 * @description The critical path for a run.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function criticalPathTable(R, run) {
  const cp = run.model.schedule.criticalPath;
  const s = run.input.season;
  const rows = [
    ['Tooling ordered', cell(run.input.timing.toolingMonth), usd0(run.model.bom.oneTimeMicros)],
    ['Production order placed', cell(run.input.timing.poMonth), `${pct(run.ledger.byId['A-WC-1-DEPOSIT'].value)} deposit`],
    ['Latest a purchase order could be placed', cell(cp.latestPoMonth), 'computed backward from the window'],
    ['Longest qualification plus lead time', `${num(run.model.bom.longestLeadWeeks)} weeks`, `driven by \`${cell(run.model.bom.longestLeadComponentId)}\``],
    ['Ocean transit', `${num(run.input.timing.transitWeeks)} weeks`, 'from the dataset'],
    ['Receiving and put-away', `${num(run.input.timing.receivingWeeks)} weeks`, 'registered by this run; not in the dataset'],
    ['Critical path, order to shelf', `${num(cp.totalWeeks)} weeks`, ''],
    ['Goods available', cell(cp.goodsAvailableMonth), ''],
    ['Selling window opens', cell(s.sellWindowStart), `${num(s.sellWindowWeeks)} weeks long`],
    ['**Weeks late**', cp.weeksLate > 0 ? `**${num(cp.weeksLate)} — the window is missed**` : `**${num(cp.weeksLate)} — the window is made**`, ''],
  ];
  return table(['', 'When', 'Note'], rows, ['l', 'l', 'l']);
}

/**
 * @description Calendar constraints the engine does not model.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function calendarSection(R) {
  const cal2 = R.ds.assumptions.find((a) => a.id === 'A-CAL-2');
  const cal1 = R.ds.assumptions.find((a) => a.id === 'A-CAL-1');
  const cal3 = R.ds.assumptions.find((a) => a.id === 'A-CAL-3');
  const ch3 = R.ds.channels.find((c) => c.id === 'CH-3');
  return [
    `**The retail calendar is the binding constraint on the whole venture and it is not in the production schedule at all.**`,
    '',
    `- ${cell(cal2.label)}: ${cell(cal2.value)} ${cell(cal2.whyItMatters)}`,
    `- ${cell(cal1.label)}: ${num(cal1.band.low)}–${num(cal1.band.high)} months. ${cell(cal1.method)}`,
    `- ${cell(cal3.label)}: ${cell(cal3.value)}`,
    '',
    `Compounded, the dataset puts first contact for a big-box set two Halloweens out for a product that does not yet exist. And the harder constraint is not the calendar: ${cell(ch3.firstTimeVendorReality)}`,
    '',
    `**That is the schedule reason the sequencing in the decision summary is what it is**, and it holds regardless of what the cost model says. Even if every cost band landed at its best corner tomorrow, the shelf is not available for two seasons.`,
  ].join('\n');
}

/**
 * @description Every dated cash movement the engine scheduled.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function cashEventTable(R, run) {
  const rows = run.model.schedule.events
    .slice()
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((e) => [cell(e.month), cell(e.kind), usd0(e.amountMicros), cell(e.note)]);
  const compliance = Object.entries(run.input.fixedOpexByMonth).filter(([, v]) => v > 0)
    .map(([month, v]) => [cell(month), 'compliance', usd0(-v), 'Certification and compliance spend']);
  return table(['Month', 'Event', 'Amount', 'What it is'],
    [...rows, ...compliance].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)), ['l', 'l', 'r', 'l']);
}

/**
 * @description The fatal-flaw register: what ends the venture, ranked by whether
 *   it ends it rather than by whether it is easy to mitigate.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function fatalFlaws(R) {
  const flaws = buildFlaws(R);
  const rows = flaws.map((f, i) => [
    String(i + 1), cell(f.what), cell(f.evidence), cell(f.endsIt), cell(f.settledBy), cell(f.cost),
  ]);
  return doc([
    '# Fatal-flaw register',
    C.posture(R, R.base),
    'Ranked by whether the flaw ends the venture, not by how easy it is to write a mitigation for. A register sorted by mitigability is a register designed to be comfortable.',
    '',
    table(['#', 'Flaw', 'Evidence', 'How it ends the venture', 'What would settle it', 'Cost to settle'], rows),
    '## The single assumption whose falsity kills it',
    killerSection(R),
    '## What is NOT a fatal flaw, and is often mistaken for one',
    notFatalSection(R),
    C.footer(R),
  ]);
}

/**
 * @description Assemble the ranked flaw list from computed results and the dataset.
 * @param {object} R - The full run result.
 * @returns {Array<object>} The flaws.
 */
function buildFlaws(R) {
  const box = R.byId['va-market-bigbox'].model.waterfalls[0];
  const kit = R.byId['vb-market-dtc'].model.waterfalls[0];
  const kitInv = R.marketInversions.find((m) => m.runId === 'vb-market-dtc').inversions;
  return [
    {
      what: 'The retail shelf is unreachable at any researched cost corner',
      evidence: `At the top observed animatronics price the unit contributes ${usd(box.contributionPerUnitMicros)}; the kit contributes ${usd(kit.contributionPerUnitMicros)} at the incumbent anchor`,
      endsIt: 'The product the operator asked for — an item sold in a store — does not exist at these costs. Volume makes it worse.',
      settledBy: 'Three supplier quotes; if they land near the low corner, re-run',
      cost: 'Sourcing time',
    },
    {
      what: 'No factory price rescues the value tier sold direct',
      evidence: `Maximum landed cost the incumbent price carries is ${usd(kitInv.maxAffordableLandedUnitMicros)}; the engine reports no factory price, not even zero, reaches it`,
      endsIt: 'Channel costs alone exceed the price. Free goods would not make it work.',
      settledBy: 'A cheaper route to market, or a higher price the market has not shown',
      cost: 'Not settleable by sourcing',
    },
    ...physicalFlaws(R),
    ...softwareAndLegalFlaws(R),
  ];
}

/**
 * @description The three flaws that live in the physical product itself.
 * @param {object} R - The full run result.
 * @returns {Array<object>} The flaws.
 */
function physicalFlaws(R) {
  const top = R.cashSweep.sweep.topThree[0];
  return [
    {
      what: 'The required short-throw optics may not exist at the assumed price',
      evidence: `Top of the sensitivity chart: \`${cell(top.assumptionId)}\` moves peak cash by ${usd0(top.swingMicros)}; the geometry gate says a 1.2–1.5:1 unit does not close inside the envelope`,
      endsIt: 'If short throw is only available in the higher module tier, the premium tier\'s cost rises past every price point in the plan',
      settledBy: 'Three supplier requests for quotation with a stated throw ratio and a measured-lumens test report',
      cost: 'Sourcing time',
    },
    {
      what: 'Condensation on the optics overnight',
      evidence: 'The airflow that makes the thermal gate pass is the same airflow that pulls dew and rain past the optics for six hours',
      endsIt: 'Fails at night, unattended, in the customer\'s yard. The worst failure mode a consumer product has, and the likeliest returns driver.',
      settledBy: 'One prototype and an overnight dew-cycle test',
      cost: 'A prototype',
    },
    {
      what: 'The product may not be able to hear a child',
      evidence: 'A continuously-running blower is a broadband noise source inside the same enclosure, two to four feet from the microphone. Entirely unmeasured.',
      endsIt: 'If it cannot hear from the walkway the headline feature does not work and the product is an expensive light',
      settledBy: 'A sound-pressure measurement at the microphone position with the blower running',
      cost: 'An afternoon',
    },
  ];
}

/**
 * @description The flaws that live in the software, the paperwork and the market.
 * @param {object} R - The full run result.
 * @returns {Array<object>} The flaws.
 */
function softwareAndLegalFlaws(R) {
  return [
    {
      what: 'The software cannot run a full evening unattended',
      evidence: 'A hard 24-hour session cap ends the session with a sign-out panel and needs a human at the device',
      endsIt: 'A retail unit cannot require a daily browser sign-in. The prop goes dark mid-party.',
      settledBy: 'A scoping session on a device-token rail versus a fully local runtime',
      cost: 'Estimated 3–8 weeks of engineering, low confidence',
    },
    {
      what: 'The tariff classification is unresolved and worth more than the margin',
      evidence: `${usd(R.byId['va-mid-8528-dtc'].model.landed.buyerUnitMicros - R.byId['va-mid-9505-dtc'].model.landed.buyerUnitMicros)} per unit turns on it, against contribution of ${usd(R.byId['va-market-dtc'].model.waterfalls[0].contributionPerUnitMicros)} on the one configuration that clears`,
      endsIt: 'Does not end it alone, but decides whether the margin exists',
      settledBy: 'A customs broker\'s written classification opinion or a binding ruling request',
      cost: 'A broker\'s fee, unpriced in this dataset',
    },
    {
      what: 'There is no demand evidence of any kind',
      evidence: 'The sell-through figure the whole revenue line rests on is registered as an outright guess; the dataset states the volume is not derived from any demand forecast',
      endsIt: 'A one-shot seasonal bet placed months before any demand signal exists, with no chance to reorder inside the window',
      settledBy: 'A software-only season, or a small paid acquisition test',
      cost: 'Near zero',
    },
    {
      what: 'The marketing copy decides the regulatory burden',
      evidence: 'The children\'s-product determination turns on how the product is represented in packaging and advertising, and the most compelling sentence about it is a child talking to it',
      endsIt: 'Adds per-lot laboratory testing, a certificate and permanent tracking labels — after the packaging is printed',
      settledBy: 'A compliance opinion on the intended packaging copy, before printing',
      cost: 'A compliance opinion',
    },
  ];
}

/**
 * @description The single assumption whose falsity kills the venture.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function killerSection(R) {
  const b04 = R.base.ledger.byId['B-04'];
  const cross = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'B-04');
  const top = R.cashSweep.sweep.topThree[0];
  return [
    `**\`B-04\` — that a projector with a 0.5–0.8 throw ratio and a measured 150–400 ANSI lumens exists at ${usd(b04.band.low)}–${usd(b04.band.high)} in five-thousand-unit quantities.**`,
    '',
    `It is the top of the sensitivity chart on its own merits, moving the peak cash requirement by ${usd0(top.swingMicros)} across its range. It is the only single driver whose movement turns the big-box configuration contribution-positive, at ${usd(cross.crossing)}. And the dataset flags the band itself as unsafe: the cheap projector class this price assumes is built around a 1.2–1.5:1 throw ratio, which does not close the geometry inside a six-foot envelope.`,
    '',
    `So the number that carries the most weight in the plan is attached to the question nobody has asked. If the required optics are only available in the higher module tier, the premium tier's bill of materials rises past every price point in this document set and the tier is over. If a supplier confirms the band, the venture has its first quoted line and the plan is worth rebuilding.`,
    '',
    `**Everything else in this register can be worked around, deferred or designed out. This one is a phone call and a fact.**`,
  ].join('\n');
}

/**
 * @description Things commonly feared here that the arithmetic clears.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function notFatalSection(R) {
  const ds = R.ds;
  const tg3 = ds.technicalGates.find((g) => g.id === 'TG-3');
  const tg4 = ds.technicalGates.find((g) => g.id === 'TG-4');
  const tg2 = ds.technicalGates.find((g) => g.id === 'TG-2');
  const tg6 = ds.technicalGates.find((g) => g.id === 'TG-6');
  return [
    'Four things that sound like showstoppers and are not, each closed by arithmetic rather than by reassurance:',
    '',
    `- **A grey glowing rectangle from a cheap projector.** ${cell(tg3.verdict.split('.').slice(0, 3).join('.'))}.`,
    `- **Cooking the inside of the inflatable.** ${cell(tg4.verdict.split('.').slice(0, 2).join('.'))}.`,
    `- **Being invisible in a yard.** ${cell(tg2.verdict.split('.').slice(0, 2).join('.'))}.`,
    `- **Needing more than one household outlet.** ${cell(tg6.verdict.split('.').slice(0, 2).join('.'))}.`,
    '',
    `**The physical form factor is not a risk either.** A projection inflatable of this kind ships today at an observed ${usd(R.base.ledger.byId['MKT-INCUMBENT-ANCHOR'].value)} retail, which demonstrates that a projector inside a cold-air inflatable, outdoors, for a full season, is a solved manufacturing problem. This venture is not inventing the form factor; it is putting a different light engine inside a proven one. That incumbent is simultaneously the reason the value tier has no price headroom.`,
  ].join('\n');
}

module.exports = { sensitivity, organisation, timeline, fatalFlaws };
