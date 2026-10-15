/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: narrated prose read "requiring 2 of ocean freight to achieve a fill ratio of
 *   0.8333333333333334" and "its 10 lead time from order to shelf", and a rejected section showed the machine name the draft
 *   cited ("ledger.ledger.softMoneyCount"). Over a model the COMPILED engine computes from the fixture venture, the COMPILED
 *   proseSection renders the sweep's own sentences as the reader sees them: containers and weeks carry their unit word, the
 *   fill reads as a rounded percent, a token already followed by its unit is not given it twice, and a misnamed figure is
 *   said by its label with no id.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { engine, ventureInput } = require('./fixture-venture');

const M = engine('venture-model');
/** The compiled documents module with its one platform import (the logger) stood in. */
const Docs = (() => {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) };
    return original.call(this, request, ...rest);
  };
  try { return engine('venture-documents'); } finally { Module._load = original; }
})();

/** One prose section rendered as the document shows it. */
function section(figures, text) {
  return Docs.proseSection({ prose: { s: text }, figures }, 'Plan', 's');
}

test('counts, weeks and a ratio read with their units, rounded, in narrated prose', () => {
  const { figures } = M.buildVentureModel(ventureInput());
  const containers = figures['landed.containers'].value, fill = figures['landed.containerFillRatio'].value;
  const weeks = figures['schedule.criticalPathWeeks'].value;
  const md = section(figures, 'Requiring {{fig:landed.containers}} of ocean freight to achieve a fill ratio of {{fig:landed.containerFillRatio}}. '
    + 'The schedule must maintain its {{fig:schedule.criticalPathWeeks}} lead time. It takes {{fig:schedule.criticalPathWeeks}} weeks.');
  const noun = containers === 1 ? 'container' : 'containers';
  assert.ok(md.includes(`Requiring ${containers} ${noun} of ocean freight`), md);
  assert.ok(md.includes(`fill ratio of ${(fill * 100).toFixed(1)}%.`), md);
  const wk = weeks === 1 ? 'week' : 'weeks';
  assert.ok(md.includes(`maintain its ${weeks} ${wk} lead time`), md);
  assert.ok(md.includes(`It takes ${weeks} weeks.`), 'a token the writer follows with its unit is not given it twice');
  assert.doesNotMatch(md, /\d\.\d{3,}/, 'no long float reaches the reader');
});

test('a misnamed figure is said by its label and no machine name reaches the reader', () => {
  const { figures } = M.buildVentureModel(ventureInput());
  const md = section(figures, 'Watch {{fig:ledger.ledger.softMoneyCount}} closely.');
  assert.match(md, /Not written: the strategist's draft cited “Money assumptions nobody has quoted” under a name the model does not use, so the section was rejected/);
  assert.doesNotMatch(md, /ledger\./);
  const unknown = section(figures, 'It needs {{fig:demand.notARealFigure}}.');
  assert.match(unknown, /cited a figure the model did not compute, so the section was rejected/);
  assert.doesNotMatch(unknown, /notARealFigure/);
});
