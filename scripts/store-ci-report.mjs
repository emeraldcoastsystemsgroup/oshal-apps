/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Say what a store gate run is going to run and what it ran, in words a person and a wrapper can both read. A scoped run leaves most package jobs to the scheduled full run, so it has to say so before it starts (which jobs run, which are left and why) and on its last line, and it must never end on the line a full pass ends on. The same facts go to a result file (STORE_CI_RESULT_FILE): the hook reads the mode from it, store-push reads which jobs failed so a second try reruns only those, and the scheduled full run turns it into its dated receipt.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PUBLISH_WALL } from './store-ci-scope.mjs';

/**
 * @description Count the jobs and checks a scope runs and leaves.
 * @param {object[]} checks The runner's plan, in workflow order.
 * @param {boolean[]} run Whether each check runs.
 * @returns {{jobs:string[],run:string[],part:string[],left:string[],runChecks:number,total:number}} Every
 *   job; the jobs with a check that runs; those of them with a check that does not; the jobs left whole.
 */
export function scopeCounts(checks, run) {
  const jobs = [...new Set(checks.map((check) => check.job))];
  const some = (job, wanted) => checks.some((check, index) => check.job === job && run[index] === wanted);
  const running = jobs.filter((job) => some(job, true));
  return {
    jobs,
    run: running,
    part: running.filter((job) => some(job, false)),
    left: jobs.filter((job) => !some(job, true)),
    runChecks: run.filter(Boolean).length,
    total: checks.length,
  };
}

/**
 * @description The one line a scoped run ends on, after its verdict.
 * @param {object} scope The decided scope.
 * @param {ReturnType<typeof scopeCounts>} counts Its counts.
 * @returns {string} "scoped, not the full suite: N of M jobs run (...), K left ...; changed packages: ...".
 */
export function scopedTail(scope, counts) {
  return `scoped, not the full suite: ${counts.run.length} of ${counts.jobs.length} jobs run `
    + `(${counts.runChecks} of ${counts.total} checks), ${counts.left.length} left to the scheduled full run; `
    + `changed packages: ${scope.changed.join(', ') || 'none'}.`;
}

/** @description Whether any check of this plan runs inside or names the package. */
function hasStep(scope, folder) {
  return scope.placement.places.some((place) => place.kind === 'package' && place.packages.includes(folder));
}

/**
 * @description What the run will do, printed before anything runs.
 * @param {object} scope The decided scope.
 * @param {object[]} checks The runner's plan.
 * @returns {string[]} The lines of the plan.
 */
export function planLines(scope, checks) {
  if (scope.mode === 'full') return [`scope: FULL — ${scope.reason}`, '  every store-ci job runs'];
  const counts = scopeCounts(checks, scope.run);
  const always = counts.jobs.filter((job) => scope.placement.always.includes(job));
  const inside = checks.filter((check, index) => scope.placement.places[index].kind === 'always' && !always.includes(check.job));
  const also = [...scope.selected].filter(([, reason]) => reason !== 'changed')
    .map(([folder, reason]) => `${folder} (${reason}${hasStep(scope, folder) ? '' : '; no store-ci step runs in or names it'})`);
  const quiet = scope.changed.filter((folder) => !hasStep(scope, folder));
  const lines = [
    `scope: SCOPED — ${scope.paths.length} changed path(s) since ${scope.base.slice(0, 8)}; the whole suite is left to the scheduled full run`,
    `  changed packages: ${scope.changed.join(', ') || 'none'}`,
  ];
  if (quiet.length) lines.push(`  no store-ci step runs in or names: ${quiet.join(', ')}`);
  if (also.length) lines.push(`  also selected: ${also.join(', ')}`);
  lines.push(`  always, the publish wall and the structural rules: ${always.join(', ')}`);
  if (inside.length) lines.push(`  whole-tree steps inside package jobs, always run: ${inside.map((check) => `${check.job} · ${check.label}`).join('; ')}`);
  const packageJobs = counts.run.filter((job) => !always.includes(job) && checks.some((check, index) => check.job === job && scope.run[index] && scope.placement.places[index].kind === 'package'));
  lines.push(`  package jobs run: ${packageJobs.join(', ') || 'none'}`);
  lines.push(`  left to the scheduled full run (${counts.left.length} jobs, ${counts.total - counts.runChecks} checks): ${counts.left.join(', ') || 'none'}`
    + `${counts.part.length ? `; and in part: ${counts.part.join(', ')}` : ''}`);
  lines.push('      nothing this change touches is in, required by, optionally used by or read by the tests of those packages');
  return lines;
}

/**
 * @description The names of the failed cases in a suite's TAP output, for a receipt.
 * @param {string} output The check's combined output.
 * @returns {string[]} Up to forty "not ok" case names, without their numbers.
 */
export function failingTests(output) {
  return [...new Set((output ?? '').split(/\r?\n/)
    .map((line) => /^\s*not ok \d+\s*-?\s*(.*)$/.exec(line)?.[1]?.trim())
    .filter(Boolean))].slice(0, 40);
}

/**
 * @description Whether a failed run is worth one more try: only when every failure is a package suite
 *   that ran and went red. A structural check, a missing service and a suite stopped at the deadline
 *   fail the same way twice.
 * @param {object[]} failures The failed results.
 * @param {object[]} blocked The blocked results.
 * @returns {boolean} True when a rerun of the failed jobs can change the verdict.
 */
export function worthRetry(failures, blocked) {
  return failures.length > 0 && blocked.length === 0
    && failures.every((failure) => failure.place === 'package' && !failure.environment);
}

/**
 * @description Decide whether a rerun may run only the jobs that failed in the first run. It may when the
 *   first run failed in package suites alone, on this same tree, under this same plan; the publish wall
 *   runs again regardless. Otherwise the reason is returned and the whole plan runs.
 * @param {string} file The first run's result file.
 * @param {object} scope The scope decided now.
 * @param {string} plan This run's plan key.
 * @param {string} tree This tree's fingerprint.
 * @returns {{jobs:string[],prior:object}|{refused:string}} The jobs to rerun, or why not.
 */
export function acceptRetry(file, scope, plan, tree) {
  let prior;
  try {
    prior = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { refused: "the first run's result could not be read" };
  }
  if (prior?.schema !== 1 || !Array.isArray(prior.failed)) return { refused: "the first run's result could not be read" };
  if (prior.verdict !== 'failed' || prior.retryable !== true || prior.failed.length === 0) {
    return { refused: "the first run's failure is not one a second try changes" };
  }
  if (!tree || prior.tree !== tree) return { refused: 'the tree changed since the first run' };
  if (prior.mode !== scope.mode || prior.plan !== plan) return { refused: 'the plan is not the one the first run ran' };
  return { jobs: [...new Set(prior.failed.map((failure) => failure.job))], prior };
}

/**
 * @description Narrow a plan to a rerun: the jobs that failed, and the publish wall.
 * @param {object[]} checks The runner's plan.
 * @param {boolean[]} run The plan's run flags.
 * @param {string[]} jobs The jobs that failed in the first run.
 * @returns {boolean[]} Run flags for the rerun.
 */
export function rerunFlags(checks, run, jobs) {
  return run.map((on, index) => on && (jobs.includes(checks[index].job) || PUBLISH_WALL.includes(checks[index].job)));
}

/**
 * @description Build the result a wrapper reads.
 * @param {object} facts mode, verdict, summary, scope, counts, results, unrun, tree, head, plan, retry, seconds.
 * @returns {object} The result object.
 */
export function buildResult({ verdict, summary, scope, counts, results = [], unrun = [], tree, head, plan, retry, seconds = 0 }) {
  const of = (status) => results.filter((result) => result.status === status);
  const failures = of('FAIL');
  return {
    schema: 1,
    at: new Date().toISOString(),
    mode: scope.mode,
    reason: scope.reason,
    verdict,
    summary,
    head,
    base: scope.base,
    tree,
    plan,
    changedPackages: scope.changed,
    selectedPackages: Object.fromEntries(scope.selected),
    jobs: { total: counts.jobs.length, run: counts.run, part: counts.part, left: counts.left },
    checks: {
      total: counts.total, run: counts.runChecks, ran: results.length, passed: of('PASS').length, failed: failures.length,
      partial: of('PARTIAL').length, skipped: of('SKIPPED').length, blocked: of('BLOCKED').length,
    },
    failed: failures.map((failure) => ({
      job: failure.job, title: failure.title, detail: failure.detail, place: failure.place,
      tests: failingTests(failure.output),
    })),
    notFullyRun: [...of('PARTIAL'), ...of('SKIPPED')].map((result) => ({ title: result.title, detail: result.detail })),
    unrun,
    retryable: worthRetry(failures, of('BLOCKED')),
    ...(retry?.jobs ? { retryOf: retry.jobs, firstRun: retry.prior.failed } : {}),
    services: scope.services,
    placement: { always: scope.placement.always, packages: scope.placement.packages, unplaced: scope.placement.unplaced },
    seconds: Math.round(seconds),
  };
}

/**
 * @description Write the result where STORE_CI_RESULT_FILE names, when it names a file.
 * @param {string} file The path, or ''.
 * @param {object} result The result object.
 * @returns {void}
 */
export function writeResult(file, result) {
  if (file) writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}
