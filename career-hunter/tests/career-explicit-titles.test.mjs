/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Check caller-selected teaching titles reach scoring and remain visible on the private matched board.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('explicit titles select teaching roles while generic passes retain their lane gate', () => {
  const result = spawnSync(process.env.CAREER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-explicit-titles-contract.py', import.meta.url))],
    { encoding: 'utf8', env: { ...process.env, PYTHONPATH: [fileURLToPath(new URL('../engine', import.meta.url)), process.env.PYTHONPATH].filter(Boolean).join(':') } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /generic lane passed/);
});

test('the scored board requests the caller scored matches across shared role classifications', () => {
  const html = readFileSync(new URL('../tools/career-board.html', import.meta.url), 'utf8');
  assert.match(html, /if\(mode!=='browse'\) p\.set\('lane','all'\)/);
});
