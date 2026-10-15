#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Connector-copy honesty. The native installation's connector list (live GET
 *   /api/connect/list, 1149 providers on 2026-10-11) has no uber, uber-eats, duffel, alpaca, yahoo or paypal connector, and it
 *   declares walmart while the runtime runs no Walmart operation. Eats, Rides, Purchasing, Travel and Intelligent Communication
 *   still told people to "connect" those providers, that a feature "will work once an X connection is added", or to add an X
 *   token on the Connections page (/utilities). This check reads every package's tools/, ui/ and personas/ text (persona
 *   comment lines excluded) and refuses a sentence that tells a person to connect, link or add one of those providers, or
 *   sends them to Connections for one. A sentence that forbids it ("Never tell the rider to connect Uber") is not an
 *   instruction and passes. Known violators outside this change are named in PENDING and must still violate, so the list
 *   cannot go stale.
 *
 * Usage: node scripts/check-connector-copy.mjs [repositoryRoot]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Providers with no usable connector on this installation, as people name them. walmart is declared but the runtime runs
 * none of its operations, so connecting it changes nothing either.
 */
export const NO_RAIL_PROVIDERS = Object.freeze(['Uber Eats', 'Uber', 'Duffel', 'Walmart', 'Alpaca', 'Yahoo Mail', 'Yahoo', 'PayPal']);

const NAME = `(${NO_RAIL_PROVIDERS.map((n) => n.replace(/ /g, '\\s+')).join('|')})`;
/** Instruction shapes: "connect Uber", "add a Walmart key", "an Uber connection is added", "Duffel token on the Connections page",
 * "Connect Google, Outlook or Yahoo". */
const SHAPES = Object.freeze([
  new RegExp(`\\b(?:connect|link|add)(?:ed|ing|s)?\\b(?:\\s+(?:a|an|your|the|it|them))?\\s+${NAME}\\b`, 'i'),
  new RegExp(`\\b${NAME}\\s+(?:connection|token|key|account)\\s+(?:is\\s+added|on\\s+the\\s+Connections\\s+page|at\\s+/utilities|in\\s+Connections)`, 'i'),
  new RegExp(`\\b${NAME}\\b[^.\\n]{0,40}(?:/utilities|Connections\\s+page)`, 'i'),
  // "Connect Google, Outlook or Yahoo": the provider at the end of a list the verb governs.
  new RegExp(`\\b(?:connect|link|add)\\b[^.\\n'"]{0,40}(?:,|\\bor\\b|\\band\\b)\\s+${NAME}\\b`, 'i'),
]);
/** A sentence that forbids the instruction is not one. */
const FORBIDS = /\b(?:never|do not|don't)\b[^.\n]*\b(?:tell|ask|send|say|offer|suggest)\b/i;

/** Known violators in other lanes' files: `<file>: <provider sentence>`; each must still violate. */
export const PENDING = new Set([
  // Intelligent Communication's persona (Switchboard carries a copy) still names Yahoo Mail under Connections.
  'email-summarizer/personas/email-summarizer.yaml:44',
  'switchboard/personas/email-summarizer.yaml:44',
]);

/** Every text file a person reads in one package: tools/, ui/ (pages and scripts) and personas/ (prompts). */
function packageTextFiles(root, pkg) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); } else if (/\.(html|js|mjs|cjs|yaml|yml)$/.test(e.name)) out.push(p);
    }
  };
  for (const sub of ['tools', 'ui', 'personas']) walk(path.join(root, pkg, sub));
  return out;
}

/** The sentence around a match: from the previous full stop (or line start) to the next. */
function sentenceAround(line, index) {
  const start = Math.max(line.lastIndexOf('. ', index), line.lastIndexOf('; ', index), 0);
  const end = line.indexOf('. ', index);
  return line.slice(start, end < 0 ? line.length : end + 1);
}

/**
 * @description Find copy that tells a person to connect a provider this installation has no connector or rail for.
 * @param {string} root - Repository root.
 * @returns {Array<{where: string, text: string}>} One finding per offending line (`<file>:<line>`).
 */
export function findConnectorPromises(root = ROOT) {
  const findings = [];
  const packages = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(root, e.name, 'oshal-app.yaml')));
  for (const { name: pkg } of packages) {
    for (const file of packageTextFiles(root, pkg)) {
      const yaml = /\.ya?ml$/.test(file);
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (yaml && /^\s*#/.test(line)) return;
        for (const shape of SHAPES) {
          const m = shape.exec(line);
          if (!m || FORBIDS.test(sentenceAround(line, m.index))) continue;
          findings.push({ where: `${path.relative(root, file).split(path.sep).join('/')}:${i + 1}`, text: line.trim().slice(0, 200) });
          break;
        }
      });
    }
  }
  return findings;
}

/**
 * @description The check: new findings fail, and a PENDING entry that no longer violates fails too (the list stays true).
 * @param {string} root - Repository root.
 * @returns {{ errors: string[] }} The failures, in words.
 */
export function checkConnectorCopy(root = ROOT) {
  const findings = findConnectorPromises(root);
  const seen = new Set(findings.map((f) => f.where));
  const errors = findings.filter((f) => !PENDING.has(f.where))
    .map((f) => `${f.where}: tells a person to connect a provider this installation has no connector or rail for: ${f.text}`);
  for (const p of PENDING) if (!seen.has(p)) errors.push(`${p}: listed in PENDING but no longer violates; remove it from PENDING`);
  return { errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors } = checkConnectorCopy(path.resolve(process.argv[2] || ROOT));
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length) process.exit(1);
  console.log('✓ no package tells a person to connect a provider this installation has no connector or rail for');
}
