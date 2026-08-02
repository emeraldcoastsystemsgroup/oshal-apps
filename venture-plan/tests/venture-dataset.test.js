/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Added the source-overreach guard: an assumption that quotes a numeric range from its cited page (`sourceStatedRange`) and then claims a value outside it cannot be graded above `low` and must be flagged as needing a quote. The venture's single largest funding driver was graded `benchmarked` with a clickable link to a page stating roughly half what the record claimed.
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: provenance + arithmetic guards over the venture input datasets. The whole point of splitting assumptions from computation is that a number can never appear without either a source or a derivation; these tests are what make that true rather than aspirational. They assert (a) every sourceId referenced resolves, (b) every cost-bearing record carries a source AND a confidence, (c) every band is ordered low <= high, (d) every cross-reference between gates/risks and assumptions/BOM lines resolves, and (e) the golden vectors reconcile against the bom array by independent recomputation - so a silently edited unitCostBand goes red instead of quietly re-pricing the venture.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const VENTURES_DIR = path.join(__dirname, '..', 'ventures');

/**
 * @description Load every venture input dataset in ventures/. Returns them paired with
 * their filename so an assertion failure names the file a human has to open.
 * @returns {Array<{file: string, data: object}>} Every parsed dataset.
 */
function loadVentures() {
  const files = fs.readdirSync(VENTURES_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'ventures/ must contain at least one dataset');
  return files.map((file) => ({
    file,
    data: JSON.parse(fs.readFileSync(path.join(VENTURES_DIR, file), 'utf8')),
  }));
}

/**
 * @description Walk an arbitrary JSON value and yield every object that carries a
 * `sourceId` or `secondarySourceIds`. Used to prove provenance without hard-coding the
 * dataset's shape, so a NEW section added later is covered by the same guard rather than
 * silently escaping it.
 * @param {unknown} node - Any node of the parsed dataset.
 * @param {string} trail - Dotted path to `node`, for assertion messages.
 * @param {Array<{trail: string, obj: object}>} out - Accumulator.
 * @returns {Array<{trail: string, obj: object}>} Every sourced object found.
 */
function collectSourced(node, trail, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectSourced(v, `${trail}[${i}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    if ('sourceId' in node || 'secondarySourceIds' in node) out.push({ trail, obj: node });
    for (const [k, v] of Object.entries(node)) collectSourced(v, `${trail}.${k}`, out);
  }
  return out;
}

/**
 * @description Walk an arbitrary JSON value and yield every `band` / `unitCostBand` /
 * `costBand`-shaped object, i.e. anything with numeric `low` and `high`.
 * @param {unknown} node - Any node of the parsed dataset.
 * @param {string} trail - Dotted path to `node`.
 * @param {Array<{trail: string, band: object}>} out - Accumulator.
 * @returns {Array<{trail: string, band: object}>} Every band found.
 */
function collectBands(node, trail, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectBands(v, `${trail}[${i}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    if (typeof node.low === 'number' && typeof node.high === 'number') out.push({ trail, band: node });
    for (const [k, v] of Object.entries(node)) collectBands(v, `${trail}.${k}`, out);
  }
  return out;
}

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

for (const { file, data } of loadVentures()) {
  test(`${file}: every referenced sourceId resolves to a declared source`, () => {
    const declared = new Set(Object.keys(data.sources || {}));
    assert.ok(declared.size > 0, 'dataset must declare sources');
    for (const { trail, obj } of collectSourced(data, '$', [])) {
      if (obj.sourceId) {
        assert.ok(declared.has(obj.sourceId), `${trail} cites undeclared source "${obj.sourceId}"`);
      }
      for (const sid of obj.secondarySourceIds || []) {
        assert.ok(declared.has(sid), `${trail} cites undeclared secondary source "${sid}"`);
      }
    }
  });

  test(`${file}: every declared source carries a label, url and retrieval date`, () => {
    for (const [id, s] of Object.entries(data.sources || {})) {
      assert.ok(s.label && s.label.length > 3, `source ${id} needs a label`);
      assert.ok(s.url, `source ${id} needs a url`);
      assert.match(s.retrievedAt, /^\d{4}-\d{2}-\d{2}$/, `source ${id} needs an ISO retrievedAt`);
      assert.ok(s.kind, `source ${id} needs a kind so a reader can weigh it`);
    }
  });

  test(`${file}: every assumption is sourced, confidence-rated and unit-bearing`, () => {
    assert.ok(Array.isArray(data.assumptions) && data.assumptions.length > 0);
    const seen = new Set();
    for (const a of data.assumptions) {
      assert.ok(a.id, 'assumption needs an id');
      assert.ok(!seen.has(a.id), `duplicate assumption id ${a.id}`);
      seen.add(a.id);
      assert.ok(a.sourceId, `${a.id} has no sourceId - an unsourced number is exactly what this dataset exists to prevent`);
      assert.ok(VALID_CONFIDENCE.has(a.confidence), `${a.id} confidence must be high|medium|low, got ${a.confidence}`);
      assert.ok(a.unit, `${a.id} needs a unit`);
      assert.ok(a.method, `${a.id} needs a method saying how the value was arrived at`);
      const hasValue = 'value' in a;
      const hasBand = 'band' in a;
      assert.ok(hasValue !== hasBand, `${a.id} must carry exactly one of value or band, not both and not neither`);
    }
  });

  test(`${file}: every BOM line is sourced, confidence-rated and quantity-anchored`, () => {
    assert.ok(Array.isArray(data.bom) && data.bom.length > 0);
    const variantIds = new Set((data.variants || []).map((v) => v.id));
    const seen = new Set();
    for (const b of data.bom) {
      assert.ok(b.id, 'bom line needs an id');
      assert.ok(!seen.has(b.id), `duplicate bom id ${b.id}`);
      seen.add(b.id);
      assert.ok(b.component && b.spec, `${b.id} needs a component and a spec`);
      assert.ok(b.sourceId, `${b.id} has no sourceId`);
      assert.ok(VALID_CONFIDENCE.has(b.confidence), `${b.id} needs a confidence rating`);
      assert.ok(b.unitCostBand, `${b.id} needs a unitCostBand - a point estimate on an unquoted part is a fabrication`);
      assert.ok(b.atQty > 0, `${b.id} needs atQty: a cost band is meaningless without the quantity it was priced at`);
      assert.ok(Array.isArray(b.variantIds) && b.variantIds.length > 0, `${b.id} must belong to a variant`);
      for (const v of b.variantIds) assert.ok(variantIds.has(v), `${b.id} references unknown variant ${v}`);
    }
  });

  test(`${file}: every band is ordered low <= high`, () => {
    const bands = collectBands(data, '$', []);
    assert.ok(bands.length > 0, 'dataset should contain cost/estimate bands');
    for (const { trail, band } of bands) {
      assert.ok(band.low <= band.high, `${trail} is inverted: low ${band.low} > high ${band.high}`);
      assert.ok(band.low >= 0, `${trail} has a negative low bound`);
    }
  });

  test(`${file}: technical gates reference assumptions that exist`, () => {
    const assumptionIds = new Set(data.assumptions.map((a) => a.id));
    const bomIds = new Set(data.bom.map((b) => b.id));
    const swIds = new Set([
      ...(data.softwareBaseline?.exists || []).map((s) => s.id),
      ...(data.softwareBaseline?.doesNotExistAndBlocksRetail || []).map((s) => s.id),
    ]);
    for (const g of data.technicalGates || []) {
      assert.ok(g.id && g.question && g.verdict, `gate ${g.id} needs id, question and verdict`);
      assert.ok(g.severity, `gate ${g.id} needs a severity`);
      for (const ref of g.inputs || []) {
        assert.ok(
          assumptionIds.has(ref) || bomIds.has(ref) || swIds.has(ref),
          `gate ${g.id} references unknown input "${ref}"`,
        );
      }
    }
  });

  test(`${file}: every risk points at something real and says how to resolve it`, () => {
    const known = new Set([
      ...data.assumptions.map((a) => a.id),
      ...data.bom.map((b) => b.id),
      ...(data.technicalGates || []).map((g) => g.id),
      ...(data.regulatory || []).map((r) => r.id),
      ...(data.softwareBaseline?.doesNotExistAndBlocksRetail || []).map((s) => s.id),
    ]);
    assert.ok((data.criticalRisks || []).length > 0, 'a venture with no stated risks has not been examined');
    for (const r of data.criticalRisks) {
      assert.ok(r.id && r.title && r.severity && r.impact, `risk ${r.id} is incomplete`);
      assert.ok(r.mitigation || r.resolveBy, `risk ${r.id} states a problem with no path out of it`);
      const anchors = [r.gate, r.bomLine, r.gap, r.assumption, r.regulatory]
        .concat(r.assumptions || [])
        .filter(Boolean);
      for (const a of anchors) {
        assert.ok(known.has(a), `risk ${r.id} anchors to unknown record "${a}"`);
      }
    }
  });

  test(`${file}: golden BOM vectors reconcile against the bom array by independent recomputation`, () => {
    const mid = (b) => (b.low + b.high) / 2;
    const round2 = (n) => Math.round(n * 100) / 100;
    const vectors = (data.goldenVectors?.vectors || []).filter((v) => v.calculator === 'bomRollUp');
    assert.ok(vectors.length > 0, 'there must be at least one bomRollUp golden vector');

    for (const v of vectors) {
      const lines = data.bom.filter(
        (b) => b.variantIds.includes(v.inputs.variantId) && (v.inputs.includeOptional ? true : !b.optional),
      );
      assert.strictEqual(lines.length, v.expected.lines, `${v.id}: line COUNT drifted for ${v.inputs.variantId}`);
      assert.deepStrictEqual(
        lines.map((l) => l.id),
        v.expected.lineIds,
        `${v.id}: line SELECTION drifted for ${v.inputs.variantId}`,
      );
      const tol = v.tolerance ?? 0.01;
      const low = round2(lines.reduce((a, l) => a + l.unitCostBand.low, 0));
      const midSum = round2(lines.reduce((a, l) => a + mid(l.unitCostBand), 0));
      const high = round2(lines.reduce((a, l) => a + l.unitCostBand.high, 0));
      assert.ok(Math.abs(low - v.expected.exWorksLow) <= tol, `${v.id}: low ${low} != ${v.expected.exWorksLow}`);
      assert.ok(Math.abs(midSum - v.expected.exWorksMid) <= tol, `${v.id}: mid ${midSum} != ${v.expected.exWorksMid}`);
      assert.ok(Math.abs(high - v.expected.exWorksHigh) <= tol, `${v.id}: high ${high} != ${v.expected.exWorksHigh}`);
    }
  });

  test(`${file}: the tariff-scenario vector reconciles against the roll-up it claims to price`, () => {
    const lc = (data.goldenVectors?.vectors || []).find((v) => v.calculator === 'landedCost');
    assert.ok(lc, 'a landedCost golden vector must exist while a duty classification is unresolved');
    const [lowRate, highRate] = lc.inputs.dutyScenarios;
    const ex = lc.inputs.exWorksUnitCost;
    const tol = lc.tolerance ?? 0.01;
    assert.ok(Math.abs(ex * lowRate - lc.expected.dutyLow_USD) <= tol, 'dutyLow_USD does not match its own rate');
    assert.ok(Math.abs(ex * highRate - lc.expected.dutyHigh_USD) <= tol, 'dutyHigh_USD does not match its own rate');
    assert.ok(
      Math.abs(lc.expected.dutyHigh_USD - lc.expected.dutyLow_USD - lc.expected.spread_USD) <= tol,
      'spread_USD is not the difference of its own branches',
    );

    // The vector must price the SAME ex-works the V-A roll-up produces, or it is
    // silently pricing a BOM that no longer exists.
    const va = (data.goldenVectors.vectors || []).find(
      (v) => v.calculator === 'bomRollUp' && v.inputs.variantId === 'V-A',
    );
    assert.strictEqual(ex, va.expected.exWorksMid, 'landedCost vector prices a different ex-works than the V-A roll-up');
  });

  test(`${file}: the physics vectors are internally consistent`, () => {
    const by = (id) => data.goldenVectors.vectors.find((v) => v.id === id);
    const PI = 3.14159;

    const gv1 = by('GV-1');
    assert.ok(Math.abs(gv1.inputs.throwRatio * gv1.inputs.imageWidthIn - gv1.expected.throwDistanceIn) <= gv1.tolerance);

    const gv3 = by('GV-3');
    const e = gv3.inputs.ansiLumens / gv3.inputs.imageArea_m2;
    assert.ok(Math.abs(e - gv3.expected.fullFieldIlluminance_lux) <= gv3.tolerance, 'GV-3 illuminance');
    assert.ok(
      Math.abs((e * gv3.inputs.panelTransmittance) / PI - gv3.expected.featureLuminance_nits) <= gv3.tolerance,
      'GV-3 luminance',
    );

    const gv5 = by('GV-5');
    const black = (gv5.inputs.fullFieldIlluminance_lux / gv5.inputs.contrastRatio) * gv5.inputs.panelTransmittance / PI;
    assert.ok(Math.abs(black - gv5.expected.blackLuminance_nits) <= gv5.tolerance, 'GV-5 black luminance');
    assert.strictEqual(
      black < gv5.inputs.ambientFabricLuminance_nits,
      gv5.expected.visible === false,
      'GV-5 visibility verdict contradicts its own arithmetic',
    );

    const gv6 = by('GV-6');
    const btu = gv6.inputs.projectorWatts * gv6.inputs.heatFraction * 3.412;
    assert.ok(Math.abs(btu - gv6.expected.heat_BTUhr) <= 0.1, 'GV-6 heat');
    assert.ok(Math.abs(btu / (1.08 * gv6.inputs.cfm) - gv6.expected.deltaT_F) <= gv6.tolerance, 'GV-6 deltaT');

    const gv7 = by('GV-7');
    const w = gv7.inputs.blowerW + gv7.inputs.projectorW + gv7.inputs.computeW + gv7.inputs.ampW;
    const amps = w / gv7.inputs.volts;
    assert.strictEqual(w, gv7.expected.totalW, 'GV-7 total watts');
    assert.ok(Math.abs(amps - gv7.expected.currentA) <= gv7.tolerance, 'GV-7 current');
    assert.ok(
      Math.abs(2 * gv7.inputs.cordFt * amps * gv7.inputs.ohmPerFt - gv7.expected.voltageDrop_V) <= gv7.tolerance,
      'GV-7 voltage drop',
    );
  });

  test(`${file}: the honesty posture is declared and the needs-quote share is real`, () => {
    assert.ok(data.provenance?.posture, 'dataset must declare a posture');
    assert.match(
      data.provenance.posture,
      /ESTIMATE|QUOTED|ACTUAL/i,
      'posture must say whether these are estimates, quotes or actuals',
    );
    assert.ok(data.provenance.trackRecord !== undefined, 'dataset must state its track record, including "none"');

    // The guard that matters: for a variant whose parts have never been quoted, the
    // needs-quote share of cost must actually be high. If someone quietly drops the
    // needsQuote flags to make a chart look confident, this goes red.
    const mid = (b) => (b.low + b.high) / 2;
    const lines = data.bom.filter((b) => b.variantIds.includes('V-A') && !b.optional);
    const total = lines.reduce((a, l) => a + mid(l.unitCostBand), 0);
    const unquoted = lines.filter((l) => l.needsQuote).reduce((a, l) => a + mid(l.unitCostBand), 0);
    const share = unquoted / total;
    const expected = data.goldenVectors.vectors.find((v) => v.calculator === 'traceability');
    assert.ok(
      share >= expected.expected.needsQuoteShareOfExWorks_min,
      `needs-quote share fell to ${share.toFixed(4)}; either real quotes arrived (update the vector) or provenance was lost`,
    );
  });

  test(`${file}: an assumption may not claim more than its cited source states`, () => {
    // THIS GUARD EXISTS BECAUSE A REAL RECORD FAILED IT. The ocean-transit
    // assumption — the largest single driver of this venture's funding requirement
    // — was graded `benchmarked`, flagged as needing no quote, and linked to a page
    // that states roughly half what the record claimed. A source-kind column and a
    // confidence column say nothing about whether the number came from the page;
    // only comparing the two does. A record that quotes a numeric range from its
    // source carries `sourceStatedRange`, and a record whose own band goes outside
    // it must be graded `low` and flagged as needing a quote.
    let checked = 0;
    for (const a of data.assumptions || []) {
      const stated = a.sourceStatedRange;
      if (!stated) continue;
      checked += 1;
      assert.ok(Number.isFinite(stated.low) && Number.isFinite(stated.high),
        `$.assumptions ${a.id}: sourceStatedRange needs numeric low and high`);
      assert.ok(stated.low <= stated.high, `$.assumptions ${a.id}: sourceStatedRange is inverted`);
      assert.ok(typeof stated.quote === 'string' && stated.quote.length > 20,
        `$.assumptions ${a.id}: sourceStatedRange must quote what the source actually says`);
      const claimed = a.band ? [a.band.low, a.band.high] : [a.value];
      const outside = claimed.filter((v) => typeof v === 'number' && (v < stated.low || v > stated.high));
      if (outside.length) {
        assert.equal(a.confidence, 'low',
          `$.assumptions ${a.id}: claims ${outside.join(', ')} outside its source's stated ${stated.low}-${stated.high}, so it cannot be graded "${a.confidence}"`);
        assert.equal(a.needsQuote, true,
          `$.assumptions ${a.id}: goes beyond its cited source and must be flagged as needing a quote`);
      }
    }
    assert.ok(checked > 0, 'at least one assumption states the range its source supports');
  });

  test(`${file}: no competitive absolutes anywhere in the prose`, () => {
    // CLAUDE.md anti-drift rule 1. Applies to a business plan's inputs most of all,
    // because a competitive absolute in an input becomes a claim in every document
    // generated from it.
    const banned = /\b(only one|no one else|nobody else|no other (company|product|vendor)|the only (company|product|vendor)|world'?s first|unrivalled|unrivaled)\b/i;
    const walk = (node, trail) => {
      if (typeof node === 'string') {
        const m = node.match(banned);
        assert.ok(!m, `competitive absolute "${m && m[0]}" at ${trail}`);
        return;
      }
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${trail}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
      }
    };
    walk(data, '$');
  });
}
