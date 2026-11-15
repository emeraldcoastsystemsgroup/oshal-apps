/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the shipped nightly launcher on invented native jobs, with the rail answering from the real Workday-only employer detail guard: a job nothing on the native kernel can read never takes a nightly slot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The guard is the real employer detail guard with its Oracle shape. Jobs of an Oracle board on an admitted host are scored from saved real responses; an Oracle board on another host, like an Eightfold board or a SmartRecruiters company, still takes no slot.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The guard's SmartRecruiters shape too: jobs of a SmartRecruiters company are scored from a saved real posting, and a closed posting is skipped after one read and tried again.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A job of each source kind whose description the pull keeps is scored from that listing text with no detail read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {employerDetailUrl} = require('../lib/career-employer-detail.js');
const oracle = (host, id) => `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%22${id}%22,siteNumber=CX_1`;

test('a native nightly pass spends its slots only on jobs a reader on the native kernel can describe', () => {
  const launcher = readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  const start = launcher.indexOf('function corpusRuns('), end = launcher.indexOf('\n/**', start);
  const code = vm.runInNewContext(launcher.slice(start, end) + ';corpusRuns("score-titles",[])')[0][1];
  const range = (first, last) => Array.from({length: last - first + 1}, (_, i) => first + i);
  const asked = [
    ...[46, 47].map(n => `https://invented.wd5.myworkdayjobs.com/wday/cxs/invented/Careers/job/Remote/Engineer_R-${n}`),
    ...range(59, 64).map(n => `https://api.smartrecruiters.com/v1/companies/InventedCo/postings/${7000000 + n}`),
    ...range(65, 70).map(n => oracle('invented.fa.us2.oraclecloud.com', 7000000 + n)),
    // Never asked for when the selection works: Eightfold has no reader there, and this Oracle host is not admitted.
    ...range(1, 45).map(n => `https://invented.eightfold.ai/api/apply/v2/jobs/${7000000 + n}`),
    ...range(71, 73).map(n => oracle('invented.fa.em2.oraclecloud.com', 7000000 + n)),
  ];
  const guard = Object.fromEntries(asked.map(url => [url, employerDetailUrl(url) !== null]));
  assert.equal(Object.values(guard).filter(Boolean).length, 14, 'the guard reads the two Workday, six SmartRecruiters and six admitted Oracle postings');
  const out = spawnSync(process.env.CAREER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-nightly-unreadable-contract.py', import.meta.url))],
    {input: JSON.stringify({code, guard}), encoding: 'utf8', timeout: 180000});
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /Ran 3 tests/);
});
