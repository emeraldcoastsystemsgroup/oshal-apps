/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the Oracle Recruiting Cloud detail reader against saved real public responses, with the rail answering from the real employer detail guard's verdicts: one read per job through the admitted address, the whole description, and nothing marked on a closed posting or any refusal.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The SmartRecruiters detail reader too, against three saved real postings and a closed one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {employerDetailUrl} = require('../lib/career-employer-detail.js');

test('the detail readers read each admitted posting once and mark nothing on a refusal', () => {
  const index = JSON.parse(readFileSync(new URL('./employer-detail-fixtures/index.json', import.meta.url), 'utf8'));
  const urls = index.fixtures.map(entry => entry.url);
  assert.ok(urls.every(url => employerDetailUrl(url) === url), 'every saved fixture was read at an address the guard admits as is');
  const guard = Object.fromEntries(urls.map(url => [url, employerDetailUrl(url) !== null]));
  const oracleHosts = Object.fromEntries(['jpmc.fa.oraclecloud.com', 'eeho.fa.us2.oraclecloud.com', 'egup.fa.us6.oraclecloud.com',
    'iawmqy.fa.ocs.oraclecloud.com', 'abc-xyz-saasfaprod1.fa.ocs.oraclecloud.com', 'eeho.fa.em2.oraclecloud.com',
    'a.b.fa.us2.oraclecloud.com', 'fa.us2.oraclecloud.com', 'eeho.oraclecloud.com', '-x.fa.oraclecloud.com',
    'eeho.fa.us2.oraclecloud.com.evil.test'].map(host => [host, employerDetailUrl(
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%221%22,siteNumber=CX`) !== null]));
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const egress = [.../^egress:\n((?:[ #].*\n|\n)*?)(?=^\S)/m.exec(manifest)[1].matchAll(/host:\s*'?([^'\s]+)'?/g)].map(match => match[1]);
  const out = spawnSync(process.env.CAREER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-detail-readers-contract.py', import.meta.url))],
    {input: JSON.stringify({guard, oracleHosts, egress}), encoding: 'utf8', timeout: 120000});
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /Ran 8 tests/);
});
