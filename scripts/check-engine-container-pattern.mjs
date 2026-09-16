#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Hold every package-owned engine container to the pattern BUILDING-EXTENSIONS.md documents. Four packages arrived at this shape independently and the doc could drift from any of them: the compose project must be the package's own and asserted after `up` (an inherited COMPOSE_PROJECT_NAME put the first one in the core project, where the next deploy swept it), the container must carry no `oshal.tier` label (that is Prometheus' docker_sd selector), no host port may be published, and a stale container must be refused with the install command instead of answered with stale physics. Also fails when an engine package is missing from the doc's precedent table, so the fifth one cannot hand-roll it unnoticed.
 *
 * Usage: node scripts/check-engine-container-pattern.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The doc section this guard keeps honest, and the marker its precedent table rows carry. */
export const DOC_FILE = 'BUILDING-EXTENSIONS.md';
export const DOC_HEADING = 'A package that needs its own engine container';
const DOC_ROW = /^\|\s*`([a-z0-9-]+)`\s*\|/;

/**
 * A heading's text, with its hashes and any `N.` section number stripped — the section keeps its
 * identity when the doc is renumbered or the heading changes level, which it has before.
 */
function headingText(line) {
  const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
  return match ? match[2].replace(/^\d+\.\s*/, '') : null;
}

/**
 * @description Every package directory that owns an engine container, by the one file that
 * defines one. Discovery is structural on purpose: a new package is covered the moment it
 * commits `engine/container/compose.yaml`, with no list to remember to extend.
 * @param repositoryRoot - Store repository root.
 * @returns Sorted package directory names.
 */
export function enginePackages(repositoryRoot = REPOSITORY_ROOT) {
  return fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => fs.existsSync(path.join(repositoryRoot, entry.name, 'engine', 'container', 'compose.yaml')))
    .map((entry) => entry.name)
    .sort();
}

/** Read a file, or null when it is not there — a missing file is a problem, not a crash. */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Every file under a directory tree, skipping caches and maps. */
function filesUnder(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__pycache__') filesUnder(child, out);
    } else if (entry.isFile() && !entry.name.endsWith('.map')) {
      out.push(child);
    }
  }
  return out;
}

/** True when any file in the package's routes/ tree contains the needle. */
function routesMention(repositoryRoot, pkg, needle) {
  return filesUnder(path.join(repositoryRoot, pkg, 'routes'))
    .some((file) => (readOrNull(file) ?? '').includes(needle));
}

/** The compose file's top-level `name:` — the project the engine must land in. */
function composeProjectName(text) {
  const match = /^name:[ \t]*(\S+)[ \t]*$/m.exec(text);
  return match ? match[1] : null;
}

/** Comment lines never satisfy a requirement: a `#` line is prose, not behaviour. */
function codeLines(text) {
  return text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
}

/** The compose service block, minus its comments, for label/port checks. */
function composeCode(text) {
  return codeLines(text).join('\n');
}

/**
 * @description Check one package's engine container against the documented pattern.
 * @param repositoryRoot - Store repository root.
 * @param pkg - Package directory name.
 * @returns Human-readable problems; empty when the package follows the pattern.
 */
export function packageProblems(repositoryRoot, pkg) {
  const problems = [];
  const composePath = path.join(repositoryRoot, pkg, 'engine', 'container', 'compose.yaml');
  const composeText = readOrNull(composePath);
  if (composeText === null) return [`${pkg}: engine/container/compose.yaml is unreadable`];
  const compose = composeCode(composeText);

  const expectedProject = `oshal-${pkg}-engine`;
  const project = composeProjectName(compose);
  if (project !== expectedProject) {
    problems.push(`${pkg}/engine/container/compose.yaml declares project name ${JSON.stringify(project)}, must be "${expectedProject}" — its own project, so a core deploy's --remove-orphans cannot sweep it`);
  }
  if (/(^|\s)oshal\.tier\s*:/.test(compose)) {
    problems.push(`${pkg}/engine/container/compose.yaml labels the engine with oshal.tier — that is Prometheus' docker_sd selector for the core/worker tiers and this container serves no /metrics`);
  }
  if (/^\s+ports:/m.test(compose)) {
    problems.push(`${pkg}/engine/container/compose.yaml publishes a host port — the bridge must be reachable only from the stack network, by alias`);
  }
  if (!/external:\s*true/.test(compose)) {
    problems.push(`${pkg}/engine/container/compose.yaml does not join an external network — the engine must join the running stack's network, not create one`);
  }

  const installPath = path.join(repositoryRoot, pkg, 'engine', 'install-engine.sh');
  const installText = readOrNull(installPath);
  if (installText === null) {
    problems.push(`${pkg}/engine/install-engine.sh is missing — the engine has no documented way to be built and started`);
  } else {
    const install = codeLines(installText).join('\n');
    if (!/^\s*unset\b[^\n]*\bCOMPOSE_PROJECT_NAME\b/m.test(install)) {
      problems.push(`${pkg}/engine/install-engine.sh does not unset COMPOSE_PROJECT_NAME — inherited from the api container it outranks the compose file's name: and puts the engine in the core project`);
    }
    if (project && !new RegExp(`^\\s*PROJECT=${project}\\s*$`, 'm').test(install)) {
      problems.push(`${pkg}/engine/install-engine.sh does not pin PROJECT=${project} to match its compose file`);
    }
    if (!/docker\s+compose\s+-p\s+"?\$(\{)?PROJECT/.test(install)) {
      problems.push(`${pkg}/engine/install-engine.sh does not pass -p "$PROJECT" to docker compose`);
    }
    if (!install.includes('com.docker.compose.project')) {
      problems.push(`${pkg}/engine/install-engine.sh does not assert com.docker.compose.project after up — unsetting the variable is not proof the container landed in the right project`);
    }
  }

  if (!fs.existsSync(path.join(repositoryRoot, pkg, 'routes'))) {
    problems.push(`${pkg}/routes is missing — the capability route is what hands the surface the reason and the install command`);
  } else {
    if (!routesMention(repositoryRoot, pkg, 'install-engine.sh')) {
      problems.push(`${pkg}: no route module names install-engine.sh — the install command must come from the route, never hardcoded in a surface`);
    }
    if (!routesMention(repositoryRoot, pkg, 'installHint') && !routesMention(repositoryRoot, pkg, 'INSTALL_HINT')) {
      problems.push(`${pkg}: no route module surfaces an installHint — a down or stale engine must tell the surface the exact command`);
    }
    if (!routesMention(repositoryRoot, pkg, 'buildHash') && !routesMention(repositoryRoot, pkg, 'build_hash')) {
      problems.push(`${pkg}: no route module compares a build hash — a container built from a different engine tree must be refused, not answered with stale results`);
    }
  }

  return problems;
}

/**
 * @description Every divergence between the shipped engine containers and the documented pattern,
 * including an engine package the doc's precedent table does not list.
 * @param repositoryRoot - Store repository root.
 * @returns Human-readable problems; empty when the repository is consistent.
 */
export function engineContainerProblems(repositoryRoot = REPOSITORY_ROOT) {
  const packages = enginePackages(repositoryRoot);
  const problems = packages.flatMap((pkg) => packageProblems(repositoryRoot, pkg));

  const doc = readOrNull(path.join(repositoryRoot, DOC_FILE));
  if (doc === null) {
    problems.push(`${DOC_FILE} is unreadable — the pattern has nowhere to be documented`);
    return problems;
  }
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((line) => headingText(line) === DOC_HEADING);
  if (start === -1) {
    problems.push(`${DOC_FILE} has no "${DOC_HEADING}" section — a new package would hand-roll the pattern from package source again`);
    return problems;
  }
  const depth = /^(#{1,6})\s/.exec(lines[start])[1].length;
  const end = lines.findIndex((line, index) => {
    if (index <= start) return false;
    const match = /^(#{1,6})\s/.exec(line);
    return Boolean(match) && match[1].length <= depth;
  });
  const section = lines.slice(start, end === -1 ? lines.length : end);
  const documented = section
    .map((line) => DOC_ROW.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[1]);

  for (const pkg of packages) {
    if (!documented.includes(pkg)) {
      problems.push(`${DOC_FILE}: ${pkg} owns an engine container but the section's precedent table does not list it`);
    }
  }
  for (const name of documented) {
    if (!packages.includes(name)) {
      problems.push(`${DOC_FILE}: the precedent table lists ${name}, which owns no engine/container/compose.yaml`);
    }
  }
  return problems;
}

/**
 * @description CLI entry point: print every problem and exit non-zero, or report the count checked.
 * @param repositoryRoot - Store repository root.
 * @returns Nothing; sets process.exitCode on failure.
 */
export function main(repositoryRoot = REPOSITORY_ROOT) {
  const problems = engineContainerProblems(repositoryRoot);
  if (problems.length) {
    console.error(`Engine-container pattern failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`See ${DOC_FILE} — "${DOC_HEADING}".`);
    process.exitCode = 1;
    return;
  }
  const packages = enginePackages(repositoryRoot);
  console.log(`Engine-container pattern passed: ${packages.length} package-owned engine(s) follow it — ${packages.join(', ')}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
