#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Gate publication on single bot ownership and explicit workflow/concierge imports using the framework's real YAML and dependency contract.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve referenced platform owners from bounded canonical framework declarations while retaining exact bot and duplicate-identity checks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @description Read source manifests with the same dependency parser used at installation.
 * @param {string} root Store source root.
 * @param {string} frameworkRoot Framework checkout with its locked dependencies.
 * @returns {{manifests: Map<string, object>, problems: string[]}} Parsed declarations and refusals.
 */
export function readDeclarations(root, frameworkRoot) {
  if (!frameworkRoot) throw new Error('Set OSHAL_FRAMEWORK to the framework checkout; bot dependencies were not checked');
  const require = createRequire(path.resolve(frameworkRoot, 'package.json'));
  const yaml = require('js-yaml');
  const contract = require(path.resolve(frameworkRoot, 'scripts/oshal-app-dependencies.js'));
  const manifests = new Map();
  const problems = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name, 'oshal-app.yaml');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    try {
      const manifest = yaml.load(fs.readFileSync(file, 'utf8'));
      if (!manifest || typeof manifest.name !== 'string') throw new Error('application name is missing');
      if (manifests.has(manifest.name)) throw new Error('duplicate application name');
      const dependencies = contract.readAppDependencies(manifest);
      manifests.set(manifest.name, { ...manifest, dependencies, directory: path.dirname(file) });
    } catch (error) {
      problems.push(`${entry.name}: ${error.message}`);
    }
  }
  if (!manifests.size) problems.push('no application manifests were checked');
  platformBotOwners(manifests, frameworkRoot, yaml, contract, problems);
  return { manifests, problems };
}

/** Include only referenced platform declarations; this publication check grants nothing. */
function platformBotOwners(manifests, frameworkRoot, yaml, contract, problems) {
  const checked = new Set();
  for (const manifest of manifests.values()) {
    for (const bot of [...manifest.dependencies.required.bots, ...manifest.dependencies.optional.bots]) {
      if (manifests.has(bot.app) || checked.has(bot.app)) continue;
      checked.add(bot.app);
      if (checked.size > 256 || !/^[a-z][a-z0-9-]{0,127}$/.test(bot.app)) {
        problems.push('platform bot owner lookup is invalid or exceeds its declaration bound');
        continue;
      }
      const file = path.join(frameworkRoot, 'swarm-apps', `${bot.app}.yaml`);
      if (!fs.existsSync(file)) continue;
      try {
        const metadata = fs.lstatSync(file);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) {
          throw new Error('platform owner requires a bounded regular declaration');
        }
        const owner = yaml.load(fs.readFileSync(file, 'utf8'));
        if (!owner || owner.name !== bot.app || !Array.isArray(owner.bots)) {
          throw new Error('platform owner identity or bot declarations do not match');
        }
        manifests.set(owner.name, { ...owner, dependencies: contract.readAppDependencies(owner), directory: frameworkRoot });
      } catch (error) {
        problems.push(`${bot.app}: ${error.message}`);
      }
    }
  }
}

/** A workflow may have nested graph nodes or explicit phase workers. */
function workflowBots(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    if (['workerBot', 'reviewerBot', 'agentBinding', 'bot'].includes(key) && typeof item === 'string') found.add(item);
    else if (item && typeof item === 'object') workflowBots(item, found);
  }
  return found;
}

function ownedBots(manifests, problems) {
  const names = new Map();
  const ids = new Map();
  for (const [app, manifest] of manifests) {
    for (const bot of manifest.bots ?? []) {
      for (const [index, value, label] of [[names, bot.name, 'name'], [ids, bot.agentId, 'identity']]) {
        if (typeof value !== 'string' || !value) { problems.push(`${app}: bot ${label} is missing`); continue; }
        if (index.has(value)) problems.push(`${app}: bot ${label} ${value} is already owned by ${index.get(value)}`);
        index.set(value, app);
      }
    }
  }
  return names;
}

function importedBots(app, manifest, manifests, problems) {
  const required = new Set();
  for (const tier of ['required', 'optional']) {
    for (const bot of manifest.dependencies[tier].bots ?? []) {
      const owner = manifests.get(bot.app);
      if (!owner?.bots?.some((owned) => owned.name === bot.name)) {
        problems.push(`${app}: ${tier} bot ${bot.app}/${bot.name} has no owning declaration`);
      }
      if (tier === 'required') required.add(bot.name);
    }
  }
  return required;
}

function consumerProblems(app, manifest, manifests, problems) {
  const required = importedBots(app, manifest, manifests, problems);
  const owned = new Set((manifest.bots ?? []).flatMap((bot) => [bot.name, bot.agentId]));
  for (const name of workflowBots([manifest.workflow, ...(manifest.workflows ?? [])])) {
    if (!owned.has(name) && !required.has(name)) problems.push(`${app}: workflow bot ${name} needs an owned declaration or required bot import`);
  }
  // A chatBot is metadata-only in the shared concierge contract. Borrowing the
  // platform concierge must never turn it into an app-owned executable identity.
  if (manifest.kind === 'group' && manifest.chatBot) {
    const resolved = manifest.dependencies.required.apps.some((name) => {
      const member = manifests.get(name);
      const concierge = member?.chatBot ?? member?.workflow?.workerBot ?? member?.bots?.[0]?.name;
      return concierge === manifest.chatBot;
    });
    if (!resolved) problems.push(`${app}: group concierge needs the canonical concierge of a required member`);
  }
}

/**
 * @description Judge ownership and references across the actual parsed application graph.
 * @param {Map<string, object>} manifests Declarations normalized by readDeclarations.
 * @returns {string[]} Publication refusals; empty only when every binding resolves.
 */
export function botDependencyProblems(manifests) {
  const problems = [];
  ownedBots(manifests, problems);
  for (const [app, manifest] of manifests) consumerProblems(app, manifest, manifests, problems);
  return problems;
}

/**
 * @description Run the store gate without activating an application or invoking a bot.
 * @param {string[]} argv Optional source root.
 * @returns {number} Zero only for fully checked valid declarations.
 */
export function main(argv = process.argv.slice(2)) {
  try {
    const { manifests, problems } = readDeclarations(argv[0] ?? ROOT, process.env.OSHAL_FRAMEWORK);
    problems.push(...botDependencyProblems(manifests));
    for (const problem of problems) console.error(problem);
    if (problems.length) return 1;
    console.log(`Bot ownership and imports verified for ${manifests.size} applications`);
    return 0;
  } catch (error) {
    console.error(`Bot dependency check refused: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
