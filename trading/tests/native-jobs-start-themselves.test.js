/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Which Trading jobs may start by themselves is a money decision (Roger, 2026-11-03: anything that spends money or trades stays off), so the exact list is pinned: a job added to it, the order-placing watcher above all, goes red here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | No application screen names a spending figure when it turns a job on: a figure there would overwrite the cap saved on the job's Jobs row (Roger, 2026-11-04).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const yamlRoots = [__dirname, join(__dirname, '../../scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [process.env.OSHAL_FRAMEWORK] : [])];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));

test('only the jobs that place no order and spend nothing start by themselves', () => {
  const manifest = yaml.load(readFileSync(join(__dirname, '..', 'oshal-app.yaml'), 'utf8'));
  const marked = manifest.schedules.filter((job) => job.startsItself === true).map((job) => job.id).sort();
  assert.deepEqual(marked, ['futures-research', 'oshal-daily-report', 'quant-desk']);
  const ids = manifest.schedules.map((job) => job.id);
  for (const stays of ['portfolio-watcher', 'paper-autopilot', 'report-video']) {
    assert.ok(ids.includes(stays), `${stays} is still declared`);
  }
});

test('turning a job on names no spending figure, so the cap saved on the Jobs screen stands', () => {
  const ui = join(__dirname, '../tools/ui');
  const files = [...readdirSync(ui).filter(name => name.endsWith('.js')).map(name => join(ui, name)),
    join(__dirname, '../../career-hunter/tools/career-job-actions.js')];
  assert.ok(files.length > 5, 'the screens were found');
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /runBudgetMicros|dailyBudgetMicros/, file);
  }
});
