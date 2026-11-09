/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.5.0: the bridge's TV module suite (tests/python/test_oshal_phone_lan.py, stdlib unittest against local protocol fakes: Wake-on-LAN bytes, SSDP, a Roku ECP server, a Samsung TLS WebSocket TV, adb stand-ins, the whole read-only discovery) run with the system python3 in a throwaway home, one node case per Python case so store-ci names each one. It fails, never skips, when python3 or openssl is missing, and a run with fewer cases than the suite holds is a failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITE = join(dirname(fileURLToPath(import.meta.url)), 'python', 'test_oshal_phone_lan.py');
const declared = (readFileSync(SUITE, 'utf8').match(/^ {4}def test_\w+\(self\):/gm) || []).length;
const home = mkdtempSync(join(tmpdir(), 'pc-lan-home-'));
const done = spawnSync('python3', ['-I', '-B', SUITE], {
  encoding: 'utf8', timeout: 240000,
  env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, OSHAL_PHONE_BRIDGE_STATE: join(home, 'state') }
});
rmSync(home, { recursive: true, force: true });
const output = `${done.stdout || ''}${done.stderr || ''}`;
const cases = [...output.matchAll(/^(test_\w+) \(__main__\.(\w+)\.\1\) \.\.\. (ok|FAIL|ERROR|skipped.*)$/gm)]
  .map(([, name, group, verdict]) => ({ name, group, verdict }));

test('the TV module suite ran every case it declares and passed', () => {
  assert.equal(done.error, undefined, `python3 could not run: ${done.error?.message}`);
  assert.ok(declared >= 25, `the suite declares ${declared} cases`);
  assert.equal(cases.length, declared, `ran ${cases.length} of ${declared} cases:\n${output.slice(-3000)}`);
  assert.match(output, new RegExp(`^Ran ${declared} tests? in `, 'm'));
  assert.equal(done.status, 0, output.slice(-4000));
});

for (const { name, group, verdict } of cases) {
  test(`${group}: ${name.slice(5).replaceAll('_', ' ')}`, () => {
    assert.equal(verdict, 'ok', `${group}.${name} answered ${verdict}:\n${output.slice(-4000)}`);
  });
}
