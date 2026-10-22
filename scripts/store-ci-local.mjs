#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run every store-ci job against the working tree so the release gate stops costing billed Actions minutes. This repository is PRIVATE, so every `pull_request:` run is billed; store-ci fired 217 times in the first sixteen days of September alone, at ~18.9 billed minutes each. The trigger is now workflow_dispatch-only and THIS is the gate. It does not re-implement the workflow: it PARSES .github/workflows/store-ci.yml and refuses to run when a job, step or glob it cannot account for appears there, so the local gate cannot silently drift away from the cloud one it replaces.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new trading job: a Vitest `run:` policy entry, and OSHAL_FRAMEWORK as a capability resolved from a checkout that has Vitest. The trading package's 17 spec files had never run in any gate - `grep -rn "trading" .github/workflows/` returned nothing and the framework-coupled config lists only lora and vids - so the package that places real orders with the operator's money was the one package this mirror could not see. Vitest is not node:test, so the TAP zero-test rule below cannot grade it; scripts/run-trading-specs.mjs refuses a zero-test run itself and this grades its exit code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make a skip reach the EXIT CODE, and offer the kernel checkout to every suite. Entry 1 printed "a skipped check is not a green one" and then exited 0, so on any layout without a sibling ../oshal checkout — which is every fresh clone — the little-monsters SECURITY suite, kalshi and career-hunter were all skipped and the run still reported success to the hook and to `$?`. A check that did not run now fails the run; `--allow-skips` is the deliberate opt-out and still names every skip. Also export OSHAL_CORE_DIR wherever a kernel checkout resolves: the two real-Multer resume cases skip on a runner that has none, so a workstation can now run two cases store-ci itself cannot. STORE_CI_LOCAL_ROOT lets the guard spec drive this over a fixture store.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new service-activations job: one `check` policy entry for scripts/check-service-activations.mjs. The gate REFUSES to run when it meets a command it has no policy for, so the entry is what keeps the ADR-157 declaration check from being a job this mirror cannot see.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new connector-declaration check: one `check` policy entry for scripts/check-connector-declarations.mjs. The gate REFUSES to run when it meets a command it has no policy for, so without this entry the check that keeps every package's connector allow-list DECLARED would be a step this mirror cannot see - and an undeclared package hands its users the entire provider catalog.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new forced-row-security check: one `check` policy entry for scripts/check-forced-rls.mjs. The gate REFUSES to run when it meets a command it has no policy for, so without this entry the job that refuses a migration enabling row security without FORCEing it would be a step this mirror cannot see - and PostgreSQL exempts the table OWNER, which is the role the api connects as, so an unforced table carries a policy that never once executes.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's whole-tree concierge-coverage check. The local gate refuses commands it has no policy for, so this entry keeps the surface-without-right-rail contract present in the on-box pre-push gate as well as workflow_dispatch.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's medium-property drift check (ADR-160 S5a): one `check` policy entry for scripts/check-medium-properties.mjs. The gate REFUSES to run when it meets a command it has no policy for, so without this entry the job that keeps three labs' copies of seawater and air one answer would be a step this mirror cannot see.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new Career loader-driver step: one `provision` policy entry and the CAREER_LOADER_NODE_PATH capability, resolved to a local node_modules that holds BOTH pg and better-sqlite3. Without the entry the gate would refuse the whole workflow at the new install command; without the capability the career-hunter step could not hand the cutover contracts their loader drivers.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's ADR-160 contract check: one `check` policy entry for scripts/check-adr160-contract.mjs. The gate REFUSES to run when it meets a command it has no policy for, so without this entry the cross-lab vehicle-record, stage and medium-shape guard would be a step this mirror cannot see.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new test-catalogs job: one `check` policy entry for scripts/check-test-catalogs.mjs, which runs the framework's own catalog loader over every package. Its framework checkout is the existing OSHAL_FRAMEWORK capability (the job provisions it with the same `npm ci --prefix framework` as trading), so a workstation without one reports the check SKIPPED, never green. This is the push-time half of the fix for embodied 0.17.0, which the kernel refused at install for one expected line over 500 characters while every check in this gate passed.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's new app-scopes job: one `check` policy entry for scripts/check-app-scopes.mjs, which calls the framework's own app-scope contract over every package. Its framework checkout is the existing OSHAL_FRAMEWORK capability, so a workstation without one reports the check SKIPPED, never green. dev-workspace-index 0.2.0's `scope: deployment` passed this whole gate and was refused by the kernel database mid-install on 2026-09-28.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's rating-ledger step: one `check` policy entry for `node scripts/ai-usage-ledger.mjs --check` with an optional `--allow-unrated`, so the local gate runs it instead of refusing an unknown command.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Drop --allow-unrated from ai-usage-ledger check policy now that all 67 store packages are rated.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | Run the bot dependency gate beside the framework scope checks so canonical ownership errors block every push.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Mirror the explicit Presentations Chromium prerequisite and require the real Career engine pins and python alias rather than grading --version as provisioned dependencies.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | The gate owns its toolchain. Every capability used to resolve out of OSHAL_ROOT / OSHAL_CORE_DIR or a sibling ../oshal checkout, so on the operator's box each push borrowed TypeScript, Vitest, Playwright, Express, Multer, pg and better-sqlite3 from the old TypeScript platform (oshal/src), which nothing may depend on. They now come from scripts/toolchain only (package.json + package-lock.json pinning the versions that checkout resolved; install with `npm ci --prefix scripts/toolchain`, or name another node_modules root with STORE_CI_TOOLCHAIN). The sibling auto-detection is gone and the inherited OSHAL_ROOT / OSHAL_FRAMEWORK / OSHAL_CORE_DIR / OSHAL_CORE_ROOT / KALSHI_BROWSER_DEPS / CAREER_LOADER_NODE_PATH / NODE_PATH are dropped from every child, so no suite can reach that checkout through the environment either. Checks that need the platform's SOURCE rather than its node_modules (its catalog, scope and dependency loaders, the trading specs' @/ tree, the Presentations renderer, the fantasy-leagues skill) report SKIPPED with the legacy dependency named; the three framework-job steps that read only node_modules run on the toolchain.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | Carry store-ci's store-bots job: a `check` policy entry for scripts/check-store-bots.mjs and a `provision` entry for its `npm ci --prefix scripts/toolchain`, whose STORE_TOOLCHAIN_YAML capability is the gate toolchain's own js-yaml (reported SKIPPED with the install command when absent, never green).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CHANGE LOG: maintainer@emeraldcoastsystemsgroup.com | Isolate fixture Git commands from inherited pre-push repository locations.

// STORE_CI_LOCAL_ROOT exists so the guard spec can drive this runner over a small fixture store
// instead of the real 45-check one. Nothing else sets it.
const ROOT = process.env.STORE_CI_LOCAL_ROOT
  ? resolve(process.env.STORE_CI_LOCAL_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'store-ci.yml');
const ALLOW_SKIPS = process.argv.includes('--allow-skips');

// The gate's own pinned dev toolchain. Resolved against ROOT (not this file) so the guard spec's
// fixture store, which has none, still proves the missing-prerequisite path. STORE_CI_TOOLCHAIN is
// the one override: any directory whose node_modules carries the pinned set.
const TOOLCHAIN = resolve(process.env.STORE_CI_TOOLCHAIN || join(ROOT, 'scripts', 'toolchain'));
const INSTALL = process.env.STORE_CI_TOOLCHAIN
  ? `STORE_CI_TOOLCHAIN=${TOOLCHAIN} has no such module`
  : 'the gate toolchain is not installed - run: npm ci --prefix scripts/toolchain';

// Variables that used to point this gate, and the suites it runs, at the old TypeScript platform
// checkout (oshal/src). They are dropped from every child: the gate sets the ones a step needs from
// the toolchain, and a suite that wants more than node_modules must report its skip, not find the
// legacy tree through an inherited variable.
const LEGACY_ENV = [
  'OSHAL_ROOT', 'OSHAL_FRAMEWORK', 'OSHAL_FRAMEWORK_ROOT', 'OSHAL_CORE_DIR', 'OSHAL_CORE_ROOT',
  'KALSHI_BROWSER_DEPS', 'CAREER_LOADER_NODE_PATH', 'NODE_PATH',
];

/**
 * @description Read a YAML block scalar (`|` or `>`) that begins on the line after `index`.
 * @param {string[]} lines Every line of the workflow.
 * @param {number} index Index of the line carrying the `run:` key.
 * @param {number} indent Column of the key that owns the block.
 * @param {string} style The block indicator, `|` or `>`.
 * @returns {string} The block joined with newlines (literal) or spaces (folded).
 */
function blockScalar(lines, index, indent, style) {
  const body = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() && (line.match(/^ */)?.[0].length ?? 0) <= indent) break;
    if (line.trim()) body.push(line.trim());
  }
  return style.startsWith('>') ? body.join(' ') : body.join('\n');
}

/**
 * @description Collect the lines belonging to one `- ` sequence item at a known indent.
 * @param {string[]} lines Every line of the workflow.
 * @param {number} start Index of the `- ` line.
 * @param {number} indent Column of the dash.
 * @returns {number} Index one past the last line of the item.
 */
function itemEnd(lines, start, indent) {
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    if (!lines[cursor].trim()) continue;
    const column = lines[cursor].match(/^ */)?.[0].length ?? 0;
    if (column <= indent) return cursor;
  }
  return lines.length;
}

/**
 * @description Parse one workflow step into the fields the local runner needs.
 * @param {string[]} lines Every line of the workflow.
 * @param {number} start Index of the step's `- ` line.
 * @param {number} end Index one past the step's last line.
 * @param {number} indent Column of the step's dash.
 * @returns {{name:string,uses:string,run:string,workingDirectory:string,env:string[],nodeVersion:string}} The step.
 */
function parseStep(lines, start, end, indent) {
  const step = { name: '', uses: '', run: '', workingDirectory: '', env: [], nodeVersion: '' };
  for (let cursor = start; cursor < end; cursor += 1) {
    const text = lines[cursor].replace(/^(\s*)-\s+/, (_m, pad) => `${pad}  `);
    const pair = /^(\s*)([A-Za-z-]+):\s*(.*?)\s*$/.exec(text);
    if (!pair) continue;
    const [, pad, key, rawValue] = pair;
    const value = rawValue.replace(/\s+#.*$/, '').trim();
    if (key === 'name' && pad.length === indent + 2 && !step.name) step.name = value;
    else if (key === 'uses') step.uses = value;
    else if (key === 'working-directory') step.workingDirectory = value;
    else if (key === 'node-version') step.nodeVersion = value.replace(/['"]/g, '');
    else if (key === 'run') {
      step.run = /^[>|][+-]?$/.test(value) ? blockScalar(lines, cursor, pad.length, value) : value;
    } else if (key === 'env' && value === '') {
      for (let scan = cursor + 1; scan < end; scan += 1) {
        const inner = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*\S/.exec(lines[scan]);
        if (!inner || inner[1].length <= pad.length) break;
        step.env.push(inner[2]);
      }
    }
  }
  return step;
}

/**
 * @description Parse `.github/workflows/store-ci.yml` into its jobs, in file order.
 * @param {string} source The workflow text.
 * @returns {Array<{id:string,name:string,needs:string[],steps:object[]}>} Jobs in declaration order.
 */
function parseJobs(source) {
  const lines = source.split(/\r?\n/);
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) throw new Error(`${WORKFLOW}: no jobs: block`);
  const jobs = [];
  for (let index = jobsAt + 1; index < lines.length; index += 1) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (!header) continue;
    const end = itemEnd(lines, index, 2);
    const body = lines.slice(index, end);
    const needsLine = body.find((line) => /^ {4}needs:\s*/.test(line));
    const needs = needsLine
      ? (/\[([^\]]*)\]/.exec(needsLine)?.[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean)
      : [];
    const stepsAt = body.findIndex((line) => /^ {4}steps:\s*$/.test(line));
    if (stepsAt < 0) throw new Error(`${WORKFLOW}: job ${header[1]} declares no steps`);
    const steps = [];
    for (let cursor = stepsAt + 1; cursor < body.length; cursor += 1) {
      const dash = /^( {6})-\s+\S/.exec(body[cursor]);
      if (!dash) continue;
      const stop = itemEnd(body, cursor, 6);
      steps.push(parseStep(body, cursor, stop, 6));
      cursor = stop - 1;
    }
    jobs.push({ id: header[1], name: body[1]?.replace(/^ {4}name:\s*/, '').trim() || header[1], needs, steps });
    index = end - 1;
  }
  return jobs;
}

/**
 * @description The reviewed policy for every non-test `run:` command store-ci executes.
 *   Anything a step runs that is not matched here stops the runner: an unmapped command is a
 *   job this gate would otherwise skip in silence, which is the whole failure mode it exists
 *   to prevent.
 */
const POLICY = [
  { match: /^node\s+scripts\/security\/check-store-test-discovery\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-catalog\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-engine-container-pattern\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-service-activations\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-connector-declarations\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-concierge-coverage\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-forced-rls\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-medium-properties\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-adr160-contract\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-test-catalogs\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-app-scopes\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-bot-dependencies\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/check-store-bots\.mjs$/, kind: 'check' },
  { match: /^node\s+scripts\/ai-usage-ledger\.mjs\s+--check$/, kind: 'check' },
  { match: /^node\s+scripts\/check-store-separation\.mjs\s+\.$/, kind: 'check' },
  { match: /^node\s+scripts\/check-no-public-secret-fallback\.mjs\s+\.$/, kind: 'check' },
  { match: /^node\s+--test\s+/, kind: 'test' },
  { match: /^npm\s+test$/, kind: 'test' },
  // The trading specs are Vitest, not node:test, and they resolve @/ out of a framework checkout,
  // so the workflow calls one script rather than typing a binary path a workstation cannot have.
  // The script is graded on its EXIT CODE alone here, which is why it refuses a zero-test run
  // itself instead of leaving that to the TAP reader below.
  { match: /^node\s+scripts\/run-trading-specs\.mjs$/, kind: 'test' },
  { match: /^npm\s+install\b[\s\S]*\btypescript@/, kind: 'provision', capability: 'OSHAL_ROOT' },
  { match: /^npm\s+install\b[\s\S]*\bbetter-sqlite3@/, kind: 'provision', capability: 'CAREER_LOADER_NODE_PATH' },
  { match: /^npm\s+ci\b[\s\S]*--prefix\s+framework$/, kind: 'provision', capability: 'OSHAL_FRAMEWORK' },
  { match: /^mkdir[\s\S]*playwright[\s\S]*install --with-deps chromium$/, kind: 'provision', capability: 'KALSHI_BROWSER_DEPS' },
  { match: /^node framework\/node_modules\/playwright\/cli\.js install --with-deps chromium$/, kind: 'provision', capability: 'OSHAL_FRAMEWORK' },
  { match: /^node scripts\/toolchain\/node_modules\/playwright\/cli\.js install --with-deps chromium$/, kind: 'provision', capability: 'STORE_TOOLCHAIN_BROWSER' },
  { match: /^python\s+-m\s+pip\s+install\b/, kind: 'provision', capability: 'CAREER_PYTHON' },
  { match: /^npm\s+ci\b[\s\S]*--prefix\s+scripts\/toolchain$/, kind: 'provision', capability: 'STORE_TOOLCHAIN_YAML' },
];

/**
 * @description Classify one step's command against the reviewed policy.
 * @param {object} step A parsed workflow step.
 * @param {string} jobId The owning job id, for the refusal message.
 * @returns {{kind:string,capability?:string}} The matched policy entry.
 */
function classify(step, jobId) {
  const entry = POLICY.find(({ match }) => match.test(step.run));
  if (!entry) {
    throw new Error(
      `${WORKFLOW}: job ${jobId} runs a command this local gate has no policy for:\n    ${step.run}\n`
      + '  Add it to POLICY in scripts/store-ci-local.mjs. A command nobody mapped is a check '
      + 'nobody runs.',
    );
  }
  return entry;
}

/**
 * @description Steps whose job checks out the framework (the OSHAL_FRAMEWORK capability) but which
 *   read only node_modules from it, never its source. Locally the gate toolchain supplies those
 *   modules, so these run; every other step of a framework job is reported SKIPPED. Each entry names
 *   the modules it reads, and its declared framework variables are pointed at the toolchain.
 */
const TOOLCHAIN_SUFFICES = [
  { workingDirectory: 'trading', match: /^node\s+--test\s+"tests\/\*native\*\.test\.js"$/, modules: ['express', 'playwright', 'js-yaml'] },
  { workingDirectory: '', match: /^node\s+--test\s+scripts\/run-trading-specs\.test\.mjs$/, modules: ['vitest'] },
  { workingDirectory: 'futures-research', match: /^node\s+--test\s+"tests\/\*\.test\.cjs"$/, modules: ['express', 'js-yaml'] },
  { workingDirectory: 'intelligent-sports', match: /^node\s+--test\s+tests\/toolbar\.test\.cjs$/, modules: ['js-yaml'] },
];

/**
 * @description Why a step that needs the framework's SOURCE cannot run here. Matched on the command
 *   and working directory; the last entry is the fallback for a framework step nobody described.
 */
const LEGACY_REASONS = [
  { match: /check-test-catalogs/, what: 'its scripts/oshal-test-catalog.js loader and js-yaml' },
  { match: /check-app-scopes/, what: 'its scripts/oshal-app-scope.js contract and js-yaml' },
  { match: /check-bot-dependencies/, what: 'its scripts/oshal-app-dependencies.js contract and swarm-apps/*.yaml' },
  { match: /run-trading-specs\.mjs$/, what: 'its src/ tree: the trading specs import @/features/trading, @/app/* and src-routes/*.ts' },
  { match: /^presentations\b/, what: 'its src/features/presentation-generation renderer, compiled by the suites' },
  { match: /^fantasy-football\b/, what: 'its src/features/fantasy-leagues skill, compiled by the suites' },
  { match: /./, what: 'its source tree' },
];

/**
 * @description The SKIPPED reason for a step that needs the legacy TypeScript platform's source.
 * @param {object} step A parsed workflow step.
 * @returns {string} The reason, naming the legacy dependency.
 */
function legacyReason(step) {
  const key = `${step.workingDirectory ? `${step.workingDirectory} ` : ''}${step.run}`;
  const { what } = LEGACY_REASONS.find(({ match }) => match.test(key));
  return `LEGACY: needs the old TypeScript platform checkout (oshal/src) - ${what}. The native kernel `
    + 'does not run that code and this gate no longer resolves it.';
}

/**
 * @description Find the gate toolchain when it carries a module a capability needs.
 * @param {string} moduleName The node module the capability needs.
 * @returns {string} The toolchain root holding node_modules/<moduleName>, or '' when absent.
 */
function findModuleRoot(moduleName) {
  return existsSync(join(TOOLCHAIN, 'node_modules', moduleName, 'package.json')) ? TOOLCHAIN : '';
}

/** Verify the same Python alias and exact engine dependencies the cloud install provides. */
function careerPythonCapability() {
  const requirements = join(ROOT, 'career-hunter', 'engine', 'requirements.txt');
  if (!existsSync(requirements)) return '';
  const probe = spawnSync('python', ['-c', [
    'import importlib.metadata as m, pathlib, sys',
    'pins = [line.split("#", 1)[0].strip() for line in pathlib.Path(sys.argv[1]).read_text().splitlines()]',
    'for pin in filter(None, pins):',
    '    name, version = pin.split("==", 1)',
    '    assert m.version(name) == version, name + " does not match the engine pin"',
    'print(sys.executable)',
  ].join('\n'), requirements], {encoding: 'utf8', timeout: 10_000});
  return !probe.error && probe.status === 0 ? probe.stdout.trim() : '';
}

/**
 * @description Resolve locally what the cloud runner provisions with an install step.
 * @returns {Record<string,{value:string,reason:string}>} Capability name to its local resolution.
 */
function resolveCapabilities() {
  const typescriptRoot = findModuleRoot('typescript');
  const pgRoot = findModuleRoot('pg');
  const loaderRoot = pgRoot && pgRoot === findModuleRoot('better-sqlite3') ? pgRoot : '';
  const browserRoot = findModuleRoot('playwright') && findModuleRoot('express') ? findModuleRoot('playwright') : '';
  const python = careerPythonCapability();
  return {
    OSHAL_ROOT: {
      value: typescriptRoot,
      reason: `no TypeScript compiler found — ${INSTALL}`,
    },
    // Not declared by any workflow step: the cloud runner installs no Multer, so the two
    // real-Multer cases skip THERE. The toolchain carries it, so exporting it lets this gate
    // run two cases store-ci cannot.
    OSHAL_CORE_DIR: {
      value: findModuleRoot('multer'),
      reason: `no Multer — ${INSTALL}`,
    },
    // store-ci checks the old TypeScript platform out for these jobs and its suites read that
    // checkout's SOURCE, not only its node_modules. This gate never resolves it: such a step is a
    // SKIP naming the legacy dependency (legacyReason), which is non-zero without --allow-skips.
    // The steps that need only node_modules are listed in TOOLCHAIN_SUFFICES and run.
    OSHAL_FRAMEWORK: {
      value: '',
      reason: 'LEGACY: needs the old TypeScript platform checkout (oshal/src), which this gate no longer resolves',
    },
    KALSHI_BROWSER_DEPS: {
      value: browserRoot,
      reason: `no playwright + express — ${INSTALL} (Chromium: node scripts/toolchain/node_modules/playwright/cli.js install chromium)`,
    },
    // The store bot contract reads manifests and personas with the gate toolchain's own js-yaml.
    STORE_TOOLCHAIN_YAML: {
      value: findModuleRoot('js-yaml'),
      reason: `no js-yaml — ${INSTALL}`,
    },
    STORE_TOOLCHAIN_BROWSER: {
      value: browserRoot,
      reason: `no playwright + express — ${INSTALL}; install Chromium with the toolchain Playwright CLI`,
    },
    CAREER_PYTHON: {
      value: python,
      reason: 'Career requires python on PATH with exact engine/requirements.txt pins; activate a disposable venv installed from that file',
    },
    // The Career cutover contracts run the real SQLite -> PostgreSQL loader, which needs both
    // database drivers from ONE node_modules (store-ci installs them into their own prefix).
    CAREER_LOADER_NODE_PATH: {
      value: loaderRoot ? join(loaderRoot, 'node_modules') : '',
      reason: `no pg + better-sqlite3 — ${INSTALL}`,
    },
  };
}

/**
 * @description Split a workflow command into argv without a shell, so no quoting is re-interpreted.
 * @param {string} command The command exactly as store-ci declares it.
 * @returns {string[]} The argv tokens, quotes stripped.
 */
function tokenize(command) {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * @description Read node:test's TAP summary and every skip reason it reported.
 * @param {string} output Combined stdout/stderr of a `node --test --test-reporter=tap` run.
 * @returns {{pass:number,fail:number,skipped:number,reasons:string[]}|null} Counts, or null if not TAP.
 */
function tapSummary(output) {
  const lines = output.split(/\r?\n/);
  const read = (key) => {
    const hit = lines.find((line) => new RegExp(`^# ${key} (\\d+)$`).test(line));
    return hit ? Number(/(\d+)$/.exec(hit)[1]) : null;
  };
  const pass = read('pass');
  if (pass === null) return null;
  const reasons = [...new Set(lines
    .filter((line) => /# SKIP/.test(line))
    .map((line) => line.replace(/^.*?#\s*SKIP\s*/, '').trim())
    .filter(Boolean))];
  return { pass, fail: read('fail') ?? 0, skipped: read('skipped') ?? 0, reasons };
}

/**
 * @description Execute one mirrored check and grade it the way store-ci would.
 * @param {object} check The planned check.
 * @returns {{status:string,detail:string,seconds:number}} The graded outcome.
 */
function runCheck(check) {
  const isTap = /^node\s+--test\s+/.test(check.command);
  const argv = tokenize(check.command);
  const useNode = argv[0] === 'node';
  const args = argv.slice(1);
  if (isTap) args.splice(args.indexOf('--test') + 1, 0, '--test-reporter=tap');
  const started = Date.now();
  // NODE_TEST_CONTEXT must never reach a child: a `node --test` process that inherits it reports
  // its results to the PARENT runner and exits 0 even when cases fail. Every verdict below is read
  // from an exit code, so inheriting it would turn this whole gate into a vacuous pass whenever it
  // is itself invoked from a test — which is exactly how its own guard spec runs it.
  const { NODE_TEST_CONTEXT: _drop, ...cleanEnv } = process.env;
  // A pre-push hook exports its repository location. A fixture's `git -C` cannot
  // override GIT_DIR: carrying it into tests writes fixture commits into this repo.
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
    'GIT_SHALLOW_FILE', 'GIT_CEILING_DIRECTORIES',
  ]) delete cleanEnv[key];
  for (const key of LEGACY_ENV) delete cleanEnv[key];
  const options = {
    cwd: join(ROOT, check.workingDirectory || '.'),
    env: { ...cleanEnv, ...check.env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  };
  // `npm` is a .cmd shim on Windows, which Node refuses to spawn directly; the command is a
  // fixed, policy-matched literal, so handing that one to the shell introduces no injection.
  const result = useNode
    ? spawnSync(process.execPath, args, options)
    : spawnSync(check.command, { ...options, shell: true });
  const seconds = (Date.now() - started) / 1000;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) return { status: 'FAIL', detail: result.error.message, seconds, output };
  const tap = isTap ? tapSummary(output) : null;
  if (isTap && !tap) {
    return { status: 'FAIL', detail: 'no TAP summary — the runner produced no verdict', seconds, output };
  }
  if (tap && tap.pass === 0 && tap.fail === 0) {
    return { status: 'FAIL', detail: 'ZERO tests ran — a glob that matches nothing exits 0', seconds, output };
  }
  if (result.status !== 0) {
    return { status: 'FAIL', detail: tap ? `${tap.fail} failing of ${tap.pass + tap.fail}` : `exit ${result.status}`, seconds, output };
  }
  if (tap?.skipped) {
    return { status: 'PARTIAL', detail: `${tap.pass} passed, ${tap.skipped} SKIPPED: ${tap.reasons.join(' | ')}`, seconds, output };
  }
  return { status: 'PASS', detail: tap ? `${tap.pass} tests` : 'ok', seconds, output };
}

/**
 * @description Work out what one step needs, the environment it gets, and why it cannot run.
 * @param {object} step A parsed workflow step.
 * @param {string[]} required Capabilities the step's job provisioned before it.
 * @param {Record<string,{value:string,reason:string}>} capabilities Locally resolved capabilities.
 * @returns {{env:Record<string,string>,skipReason:string}} The child environment and skip reason ('' when runnable).
 */
function resolveStep(step, required, capabilities) {
  const envNeeds = step.env.filter((key) => key in capabilities || key === 'CAREER_TEST_POSTGRES_ADMIN_URL');
  const needed = new Set([...required, ...envNeeds]);
  const env = {};
  let toolchainGap = '';
  const suffices = TOOLCHAIN_SUFFICES.find((s) => s.workingDirectory === step.workingDirectory && s.match.test(step.run));
  if (needed.has('OSHAL_FRAMEWORK') && suffices) {
    // Only node_modules are read, so the toolchain stands in for the framework checkout.
    needed.delete('OSHAL_FRAMEWORK');
    const absent = suffices.modules.filter((name) => !findModuleRoot(name));
    if (absent.length) toolchainGap = `no ${absent.join(' + ')} — ${INSTALL}`;
    for (const key of step.env.filter((k) => k === 'OSHAL_FRAMEWORK' || k === 'OSHAL_CORE_ROOT')) env[key] = TOOLCHAIN;
  }
  const missing = [...needed].filter((key) => capabilities[key] && !capabilities[key].value);
  for (const key of needed) {
    if (capabilities[key]?.value) env[key] = capabilities[key].value;
  }
  // Always offered, never required: a suite that can use Multer from the toolchain should, and one
  // that cannot simply ignores it. It is deliberately not part of `missing`.
  if (capabilities.OSHAL_CORE_DIR.value) env.OSHAL_CORE_DIR = capabilities.OSHAL_CORE_DIR.value;
  if (missing.includes('OSHAL_FRAMEWORK')) return { env, skipReason: legacyReason(step) };
  return { env, skipReason: missing.length ? capabilities[missing[0]].reason : toolchainGap };
}

/**
 * @description Turn the parsed workflow into the ordered list of checks to run locally.
 * @param {Array<object>} jobs The parsed jobs.
 * @param {Record<string,{value:string,reason:string}>} capabilities Locally resolved capabilities.
 * @returns {Array<object>} Checks in workflow order, each already marked runnable or skipped.
 */
function plan(jobs, capabilities) {
  const seen = new Set();
  const checks = [];
  for (const job of jobs) {
    for (const need of job.needs) {
      if (!seen.has(need)) throw new Error(`${WORKFLOW}: job ${job.id} needs ${need}, which is not declared earlier`);
    }
    seen.add(job.id);
    const required = [];
    for (const step of job.steps.filter((s) => s.run)) {
      const entry = classify(step, job.id);
      if (entry.kind === 'provision') { required.push(entry.capability); continue; }
      const { env, skipReason } = resolveStep(step, required, capabilities);
      checks.push({
        job: job.id,
        jobName: job.name,
        label: step.name || step.run,
        command: step.run,
        workingDirectory: step.workingDirectory,
        needs: job.needs,
        env,
        skipReason,
      });
    }
  }
  return checks;
}

/** @description Run every mirrored store-ci check against the working tree and report one verdict. */
function main() {
  const jobs = parseJobs(readFileSync(WORKFLOW, 'utf8'));
  const declared = jobs.flatMap((job) => job.steps.map((s) => s.nodeVersion).filter(Boolean));
  const highest = Math.max(...declared.map(Number));
  const local = Number(process.versions.node.split('.')[0]);
  const capabilities = resolveCapabilities();
  const checks = plan(jobs, capabilities);

  // The drift guard. Every job store-ci declares has to produce at least one local check: a job
  // that contributes none is a gate that quietly stopped existing the moment the trigger changed.
  const covered = new Set(checks.map((check) => check.job));
  const uncovered = jobs.filter((job) => !covered.has(job.id)).map((job) => job.id);
  if (uncovered.length) {
    throw new Error(`${WORKFLOW}: ${uncovered.length} job(s) produce no local check: ${uncovered.join(', ')}`);
  }

  console.log(`store-ci-local — ${checks.length} checks mirroring all ${jobs.length} store-ci jobs `
    + `(${WORKFLOW.replace(ROOT, '.')})`);
  console.log(`node ${process.versions.node} (store-ci declares ${[...new Set(declared)].sort().join(', ')})`);
  console.log(`toolchain ${TOOLCHAIN}${capabilities.OSHAL_ROOT.value ? '' : ` — ${INSTALL}`}`);
  const inherited = LEGACY_ENV.filter((key) => process.env[key]);
  if (inherited.length) {
    console.log(`ignoring inherited ${inherited.join(', ')}: no suite here resolves the old platform checkout`);
  }
  if (local < highest) {
    console.error(`REFUSED: store-ci runs some jobs on node ${highest}; this is node ${local}. `
      + 'Running them on an older runtime would prove something the release does not.');
    process.exitCode = 1;
    return;
  }
  console.log('');

  const results = [];
  const failedJobs = new Set();
  for (const check of checks) {
    const blockedBy = check.needs.find((need) => failedJobs.has(need));
    const where = check.workingDirectory ? `${check.workingDirectory}/` : '';
    const title = `${check.job} · ${where}${check.label}`.slice(0, 96);
    let outcome;
    if (blockedBy) {
      outcome = { status: 'BLOCKED', detail: `store-ci gate '${blockedBy}' failed; this job would not have run`, seconds: 0 };
    } else if (check.skipReason) {
      outcome = { status: 'SKIPPED', detail: check.skipReason, seconds: 0 };
    } else {
      // Live feedback only on a terminal; piped into a log the carriage return would leave the
      // half-written progress line sitting beside the verdict it was meant to be overwritten by.
      if (process.stdout.isTTY) process.stdout.write(`${`  ..    ${title}`.padEnd(118)}\r`);
      outcome = runCheck(check);
    }
    if (outcome.status === 'FAIL') failedJobs.add(check.job);
    results.push({ ...check, ...outcome, title });
    const time = outcome.seconds ? ` (${outcome.seconds.toFixed(1)}s)` : '';
    const verdict = `${outcome.status.padEnd(8)}${title}${time}`;
    console.log(process.stdout.isTTY ? verdict.padEnd(118) : verdict);
    if (outcome.status !== 'PASS') console.log(`          ${outcome.detail}`);
  }

  const failures = results.filter((r) => r.status === 'FAIL');
  const blocked = results.filter((r) => r.status === 'BLOCKED');
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  const partial = results.filter((r) => r.status === 'PARTIAL');
  console.log('');
  console.log(`summary: ${results.filter((r) => r.status === 'PASS').length} passed, ${failures.length} failed, `
    + `${partial.length} partial, ${skipped.length} skipped, ${blocked.length} blocked`);
  for (const r of partial) console.log(`  PARTIAL  ${r.title}\n           ${r.detail}`);
  for (const r of skipped) console.log(`  SKIPPED  ${r.title}\n           ${r.detail}`);
  for (const r of blocked) console.log(`  BLOCKED  ${r.title}\n           ${r.detail}`);
  for (const r of failures) {
    console.log(`  FAILED   ${r.title}\n           ${r.detail}`);
    // Head AND tail, never the middle: a failing suite puts the assertion near the top and the
    // TAP summary at the very bottom, and a naive truncation loses whichever one you needed.
    const lines = (r.output ?? '').split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(0, 12)) console.log(`           | ${line}`);
    if (lines.length > 24) {
      console.log(`           | … ${lines.length - 24} lines omitted …`);
      for (const line of lines.slice(-12)) console.log(`           | ${line}`);
    }
  }
  if (failures.length) {
    console.log('\nstore-ci-local FAILED — do not push.');
    process.exitCode = 1;
    return;
  }
  // A skip is not a pass. The exit code is what a hook and a human reading `$?` act on, so a check
  // that did not run has to be visible THERE and not only in the text above it. `--allow-skips`
  // is the deliberate opt-out for a workstation that cannot supply a prerequisite.
  const unrun = skipped.length + partial.length;
  if (unrun && !ALLOW_SKIPS) {
    console.log(`\nstore-ci-local INCOMPLETE — ${skipped.length} check(s) did not run and `
      + `${partial.length} ran with skipped cases. They are named above.`);
    console.log('Supply the prerequisite, or re-run with --allow-skips to accept them deliberately.');
    process.exitCode = 1;
    return;
  }
  if (unrun) {
    console.log('\nstore-ci-local PASSED with --allow-skips. The skips above did NOT run; '
      + 'nothing here proves them.');
    return;
  }
  console.log('\nstore-ci-local PASSED.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
