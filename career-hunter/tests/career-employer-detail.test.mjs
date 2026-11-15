/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Career rail's closed list of employer detail reads: Workday as before, plus exactly one Oracle Recruiting Cloud requisition-details shape; every other path, query, host, scheme, port, credential or method is refused before any request, and every admitted host is declared, without a credential, in the package's egress block.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The SmartRecruiters posting shape: one posting of one company, nothing else on that host or near it, the same credential-free GET, and api.smartrecruiters.com declared without a credential.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const guard = require('../lib/career-employer-detail.js');
const {employerDetailUrl, employerDetailGet} = guard;

const ORACLE = 'https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001';
const ORACLE_PATH = '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails';
const SR = 'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000161629479';
const WORKDAY = 'https://fixture.wd5.myworkdayjobs.com/wday/cxs/fixture/Careers/job/Local/Engineer_REQ-1';
const oracle = (host, query = '?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001', path = ORACLE_PATH) => `https://${host}${path}${query}`;

test('the documented Oracle requisition-details read is admitted on the four candidate-site host forms, rebuilt from its checked parts', () => {
  for (const host of ['jpmc.fa.oraclecloud.com', 'eeho.fa.us2.oraclecloud.com', 'egup.fa.us6.oraclecloud.com',
    'iawmqy.fa.ocs.oraclecloud.com', 'abc-xyz-saasfaprod1.fa.ocs.oraclecloud.com']) {
    assert.equal(employerDetailUrl(oracle(host)), oracle(host), host);
  }
  assert.equal(employerDetailUrl(oracle('iawmqy.fa.ocs.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22R283698%22,siteNumber=cx_1001')),
    oracle('iawmqy.fa.ocs.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22R283698%22,siteNumber=cx_1001'));
  // The same address spelled with literal quotes, an upper-case host or the default port is the same read.
  assert.equal(employerDetailUrl(ORACLE.replaceAll('%22', '"')), ORACLE);
  assert.equal(employerDetailUrl(ORACLE.replace('eeho.fa.us2', 'EEHO.FA.US2')), ORACLE);
  assert.equal(employerDetailUrl(ORACLE.replace('oraclecloud.com/', 'oraclecloud.com:443/')), ORACLE);
});

test('anything else on an Oracle host, or an Oracle-looking host that is not a candidate site, is refused', () => {
  const refused = [
    // Other resources, the list, the candidate pages, traversal and near-misses of the path.
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=findReqs;siteNumber=CX_45001', '/hcmRestApi/resources/latest/recruitingCEJobRequisitions'),
    oracle('eeho.fa.us2.oraclecloud.com', '', '/hcmRestApi/resources/latest/recruitingCECandidates'),
    oracle('eeho.fa.us2.oraclecloud.com', '', '/hcmUI/CandidateExperience/en/sites/CX_45001/job/346395'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, ORACLE_PATH + '/'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, ORACLE_PATH + '/346395'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, '/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitionDetails'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, ORACLE_PATH + '/../recruitingCECandidates'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, ORACLE_PATH + '/%2e%2e/recruitingCECandidates'),
    oracle('eeho.fa.us2.oraclecloud.com', undefined, ORACLE_PATH.replace('/latest/', '/latest%2F')),
    // Every query that is not exactly the one ById finder.
    oracle('eeho.fa.us2.oraclecloud.com', ''),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&expand=all&finder=ById;Id=%22346395%22,siteNumber=CX_45001'),
    oracle('eeho.fa.us2.oraclecloud.com', '?finder=ById;Id=%22346395%22,siteNumber=CX_45001&onlyData=true'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001&fields=ExternalContactEmail'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=PrimaryKey;Id=%22346395%22'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ByIdNoCache;Id=%22346395%22,siteNumber=CX_45001'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&q=Id>0'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001&next=https://evil.test/'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22https://evil.test/%22,siteNumber=CX_45001'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22..%2F..%22,siteNumber=CX_45001'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=346395,siteNumber=CX_45001'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001#x'),
    oracle('eeho.fa.us2.oraclecloud.com', '?onlyData=true&finder=ById;%49d=%22346395%22,siteNumber=CX_45001'),
    // Hosts that are not one candidate-site pod in an admitted form.
    oracle('fa.us2.oraclecloud.com'), oracle('a.b.fa.us2.oraclecloud.com'), oracle('eeho.fa.em2.oraclecloud.com'),
    oracle('eeho.oraclecloud.com'), oracle('objectstorage.us-ashburn-1.oraclecloud.com'), oracle('-x.fa.oraclecloud.com'),
    oracle('eeho.fa.us2.oraclecloud.com.evil.test'), oracle('evil.test'), oracle('eeho.fa.us2.oraclecloud.com:8443'),
    oracle('user:secret@eeho.fa.us2.oraclecloud.com'), ORACLE.replace('https:', 'http:'),
    `https://evil.test/?u=${encodeURIComponent(ORACLE)}`,
  ];
  for (const url of refused) assert.equal(employerDetailUrl(url), null, url);
});

test('the documented SmartRecruiters posting read is admitted for one posting of one company and nothing else', () => {
  assert.equal(employerDetailUrl(SR), SR);
  assert.equal(employerDetailUrl('https://api.smartrecruiters.com/v1/companies/abbvie/postings/3743990016859246'),
    'https://api.smartrecruiters.com/v1/companies/abbvie/postings/3743990016859246');
  assert.equal(employerDetailUrl(SR.replace('.com/', '.com:443/')), SR);
  const refused = [
    'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings',
    'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&offset=0',
    `${SR}?fields=creator`, `${SR}?next=https://evil.test/`, `${SR}#x`, `${SR}/`, `${SR}/apply`,
    'https://api.smartrecruiters.com/v1/companies/BoschGroup',
    'https://api.smartrecruiters.com/v1/candidates',
    'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/cf41e674-72a3-4088-8443-a98dcd3fee4c',
    'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000161629479/../../../candidates',
    'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000161629479%2F..%2F1',
    'https://api.smartrecruiters.com/v1/companies/Bosch.Group/postings/744000161629479',
    'https://api.smartrecruiters.com/v1/companies/%42oschGroup/postings/744000161629479',
    'https://jobs.smartrecruiters.com/BoschGroup/744000161629479',
    'https://careers.smartrecruiters.com/BoschGroup/744000161629479',
    SR.replace('api.smartrecruiters.com', 'api.smartrecruiters.com.evil.test'),
    SR.replace('api.smartrecruiters.com', 'evil.test'), SR.replace('https:', 'http:'),
    SR.replace('.com/', '.com:8443/'), SR.replace('https://', 'https://user:secret@'),
    `https://evil.test/v1/companies/BoschGroup/postings/744000161629479?host=api.smartrecruiters.com`,
  ];
  for (const url of refused) assert.equal(employerDetailUrl(url), null, url);
});

test('Workday stays as it was, and a Workday shape does not open the new hosts or the new shapes Workday', () => {
  assert.equal(employerDetailUrl(WORKDAY), WORKDAY);
  for (const url of [`${WORKDAY}?x=1`, WORKDAY.replace('fixture/Careers', 'foreign/Careers'),
    'https://fixture.wd5.myworkdayjobs.com/account', 'https://api.smartrecruiters.com/wday/cxs/fixture/Careers/job/Local/a',
    `https://fixture.wd5.myworkdayjobs.com${ORACLE_PATH}?onlyData=true&finder=ById;Id=%221%22,siteNumber=CX`,
    'https://fixture.wd5.myworkdayjobs.com/v1/companies/BoschGroup/postings/1', 'https://gmail.googleapis.com/gmail/v1/users/me/messages']) {
    assert.equal(employerDetailUrl(url), null, url);
  }
});

test('the read is a credential-free GET that follows no redirect, a body that asks for anything else is refused unread, and size stays bounded', async () => {
  const calls = [];
  const ctx = {http: {fetch: async (url, options) => {
    calls.push({url, options});
    return new Response(url.includes('large') ? 'x' : '{"ok":1}', {status: 200, headers: {'content-type': 'application/json'}});
  }}};
  for (const url of [ORACLE, SR]) {
    const answer = await employerDetailGet(ctx, {operation: 'employer-detail-get', url});
    assert.deepEqual(answer, {status: 200, body: {ok: true, status: 200, body: '{"ok":1}', contentType: 'application/json'}});
  }
  assert.deepEqual(calls, [ORACLE, SR].map(url => ({url, options: {method: 'GET', redirect: 'manual', headers: {Accept: 'application/json'}}})));
  for (const extra of [{method: 'POST'}, {body: '{}'}, {headers: {Authorization: 'Bearer foreign'}}, {redirect: 'follow'}, {credential: 'gmail'}]) {
    for (const url of [ORACLE, SR]) {
      assert.deepEqual(await employerDetailGet(ctx, {operation: 'employer-detail-get', url, ...extra}),
        {status: 400, body: {ok: false, error: 'invalid-employer-detail'}}, JSON.stringify(extra));
    }
  }
  assert.equal(calls.length, 2, 'a refused body makes no request');
  const big = {http: {fetch: async () => new Response('x'.repeat(256 * 1024 + 1), {status: 200})}};
  assert.equal((await employerDetailGet(big, {operation: 'employer-detail-get', url: SR})).status, 502);
  const redirect = {http: {fetch: async () => new Response(null, {status: 303, headers: {location: 'https://evil.test/', 'content-type': 'application/json'}})}};
  assert.deepEqual((await employerDetailGet(redirect, {operation: 'employer-detail-get', url: ORACLE})).body,
    {ok: true, status: 303, body: '', contentType: 'application/json'}, 'a redirect is reported, never followed');
});

/** The package's egress declarations as the kernel matches them: an exact host, or `*.domain` for any subdomain. */
function egressBlock() {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const block = /^egress:\n((?:[ #].*\n|\n)*?)(?=^\S)/m.exec(manifest)[1];
  return block.split(/\n(?=  - host:)/).filter(entry => entry.includes('host:')).map(entry => ({
    host: /host:\s*'?([^'\s]+)'?/.exec(entry)[1], credential: /credential:/.test(entry)}));
}
const declared = (declarations, host) => declarations.find(({host: pattern}) => pattern.startsWith('*.')
  ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : pattern === host);

test('every host the rail admits is declared in the egress block, with no credential, and the block adds only those hosts', () => {
  const declarations = egressBlock();
  for (const url of [ORACLE, SR, WORKDAY, oracle('jpmc.fa.oraclecloud.com'), oracle('egup.fa.us6.oraclecloud.com'),
    oracle('iawmqy.fa.ocs.oraclecloud.com')]) {
    const host = new URL(employerDetailUrl(url)).hostname;
    const declaration = declared(declarations, host);
    assert.ok(declaration, `${host} is declared`);
    assert.equal(declaration.credential, false, `${host} carries no credential`);
  }
  assert.deepEqual(declarations.filter(({credential}) => !credential).map(({host}) => host),
    ['*.myworkdayjobs.com', '*.fa.oraclecloud.com', '*.fa.us2.oraclecloud.com', '*.fa.us6.oraclecloud.com',
      '*.fa.ocs.oraclecloud.com', 'api.smartrecruiters.com']);
  assert.deepEqual(declarations.filter(({credential}) => credential).map(({host}) => host), ['gmail.googleapis.com']);
  for (const host of ['eeho.fa.em2.oraclecloud.com', 'objectstorage.us-ashburn-1.oraclecloud.com', 'jobs.smartrecruiters.com']) {
    assert.equal(declared(declarations, host), undefined, `${host} is not reachable`);
  }
});
