/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Jarvis names the application of a step from the descriptions in its catalog (oshal-kernel ADR-212), and a catalog line shows only an application's first eight declared actions, so Intelligent Trades' Trading Performance (its thirteenth tool) never reached the model. "How did my stocks do last week?" went to Finance in kernel scoreboard round 3 (adr212-40c4ddd8) and on production: both descriptions claimed the person's brokerages and holdings, and neither said which one reports how they performed. Intelligent Trades 1.53.8 states the performance its tools report; Finance 1.4.3 states its holdings are as of the last sync and that performance over time is not tracked. Each statement is checked against the tools the manifest declares, so a description cannot promise what no tool does.
 *
 * Plain `node --test` suite; js-yaml comes from the store toolchain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(TOOLCHAIN, 'package.json'))('js-yaml');

/** A package's manifest, read from its folder. */
function manifest(folder) {
  return yaml.load(fs.readFileSync(path.join(ROOT, folder, 'oshal-app.yaml'), 'utf8'));
}

/** The descriptions of the tools a manifest declares and does not disable, by tool name. */
function tools(app) {
  return new Map((app.tools || []).filter((tool) => tool.enabled !== false)
    .map((tool) => [tool.name, String(tool.description || '')]));
}

/** A description as the kernel's catalog shows it: one line. */
function described(app) {
  return String(app.description || '').split(/\s+/).join(' ');
}

test('Intelligent Trades says it reports how the connected account performed, and a declared tool does', () => {
  const app = manifest('trading');
  const declared = tools(app);
  const text = described(app);
  assert.match(text, /how it performed over a week, a month or a year against the S&P 500/, text);
  assert.match(declared.get('trading_performance') || '', /did over a period/, 'Trading Performance reports a period');
  assert.match(text, /positions, day change/, text);
  assert.match(declared.get('trading_accounts') || '', /day change and current holdings/, 'connected account positions');
});

test('Finance says its holdings are as of the last sync and that it does not track performance over time', () => {
  const app = manifest('finance');
  const text = described(app);
  assert.match(text, /holdings count toward net worth as they stood at the last sync/, text);
  assert.match(text, /how investments performed over time is not tracked here/, text);
  for (const [name, description] of tools(app)) {
    assert.match(description, /last sync|saved finance evidence/, `${name} reads the saved aggregate only`);
    assert.doesNotMatch(description, /over a period|performance|return over/i, `${name} reports no performance`);
  }
});
