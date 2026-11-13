/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify occupation pay estimates and both real feed filters use whole-word CTO/CIO matches instead of unrelated title substrings.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const require = createRequire(import.meta.url);
const pay = require('../lib/career-pay');
const {fetchBrowsePage} = require('../routes/career-browse-feed');
const {fetchBoardPage} = require('../routes/career-board-feed');
let db;
before(() => {
  db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  const engine = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  for (const schema of ['CORPUS_SCHEMA','USER_SCHEMA']) db.exec(engine.match(new RegExp(schema+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1]);
  db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Employer')");
  const insert = db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,state,active,target_role,job_type,
    salary_min,salary_max,salary_currency,salary_period,salary_source,first_seen_at) VALUES(?,1,?,?,'Destin, FL',?,1,1,?,?,?,?,?,?,datetime('now'))`);
  const rows = [
    [1,'Software Developer','FL','fte',null,null,null,null,null],
    [2,'Software Developer','FL','fte',50000,60000,'USD','year','listed'],
    [3,'HVAC Specialist','FL','fte',null,null,null,null,null],
    [4,'Software Developer','FL','fte',30,40,'USD','hour','listed'],
    [5,'Software Developer','FL','fte',90000,110000,'EUR','year','listed'],
    [6,'Unknown position','FL','fte',null,null,null,null,null],
    [7,'Adjunct Computer Science Professor','FL','parttime',null,null,null,null,null],
    [8,'Software Developer','GB','fte',null,null,null,null,null],
    [9,'HVAC Specialist','FL','fte',180000,220000,'USD','year','heuristic'],
    [10,'One-sided offer','FL','fte',null,100000,'USD','year','listed'],
    [11,'Software Developer','FL','parttime',null,null,null,null,null],
  ];
  for(const [id,...values] of rows) {
    insert.run(id,'job-'+id,...values);
    db.prepare('INSERT INTO user_signals(posting_id,fit_score,ai_fit_score,status) VALUES(?,80,80,\'new\')').run(id);
  }
  db.exec('PRAGMA query_only=1');
});
after(() => db.close());
const ids = page => page.jobs.map(j=>j.id).sort((a,b)=>a-b);
for(const [name,fetch] of [['search',fetchBrowsePage],['board',fetchBoardPage]]) {
  test(`${name}: both bounds filter employer and estimated bands before paging`, () => {
    const result = fetch(db,{min_pay:'100000',max_pay:'120000',per:'200'});
    assert.deepEqual(ids(result),[1,10]);
    assert.equal(result.jobs.find(j=>j.id===1).salary_source,'bls_estimated');
    assert.equal(result.jobs.find(j=>j.id===1).salary_min,105210);
    assert.equal(result.jobs.find(j=>j.id===1).salary_max,171980);
  });
  test(`${name}: upper-only and inclusive endpoints work; old tech guesses are replaced`, () => {
    assert.deepEqual(ids(fetch(db,{max_pay:'60000',per:'200'})),[2,3,9]);
    assert.deepEqual(ids(fetch(db,{min_pay:'77060',max_pay:'77060',per:'200'})),[3,9]);
  });
  test(`${name}: hourly pay is never compared with annual amounts`, () => {
    const result = fetch(db,{min_pay:'30',max_pay:'35',pay_period:'hour',per:'200'});
    assert.deepEqual(ids(result),[3,4,9]);
    const estimated = result.jobs.find(j=>j.id===3);
    assert.equal(estimated.salary_period,'hour');
    assert.equal(estimated.salary_min,23.25);
    assert.equal(estimated.salary_max,37.05);
  });
  test(`${name}: including unknowns is explicit and never admits wrong units or currencies`, () => {
    assert.deepEqual(ids(fetch(db,{min_pay:'100000',max_pay:'120000',include_unknown_pay:'1',per:'200'})),[1,6,7,8,10,11]);
  });
  test(`${name}: an invalid reversed range is refused`, () => {
    assert.throws(()=>fetch(db,{min_pay:'120000',max_pay:'80000'}),pay.PayRangeError);
  });
}
test('estimate provenance is dated, clearly national, and never replaces employer pay', () => {
  const estimate = pay.decoratePay({title:'HVAC Specialist',state:'FL'});
  assert.equal(estimate.salary_estimate.survey,'May 2025');
  assert.equal(estimate.salary_estimate.soc,'49-9021');
  assert.equal(estimate.salary_estimate.confidence,'low');
  assert.match(estimate.salary_estimate.method,/Not employer-listed/);
  const employer = {title:'Software Developer',state:'FL',salary_min:50000,salary_max:60000,salary_source:'listed'};
  assert.equal(pay.decoratePay(employer).salary_min,50000);
  assert.equal(pay.decoratePay(employer).salary_estimate,null);
});
test('no fake annual rate for adjuncts, internships, foreign or ambiguous titles', () => {
  for(const job of [{title:'Adjunct Professor',state:'FL'}, {title:'Software Intern',state:'FL'},
    {title:'Software Developer',location:'London, UK'}, {title:'Unknown position',state:'FL'}]) {
    assert.equal(pay.decoratePay(job).salary_min,null);
    assert.ok(pay.decoratePay(job).salary_estimate_unavailable);
  }
});
test('range validation rejects non-scalars, injection, negative, nonfinite, and invalid units', () => {
  for(const q of [{min_pay:'1 OR 1=1'},{min_pay:['1']},{max_pay:'-1'},{max_pay:'Infinity'},{pay_period:'week'}])
    assert.throws(()=>pay.payFilter(q),pay.PayRangeError);
  assert.doesNotThrow(()=>pay.payFilter({min_pay:'25.50',max_pay:'40',pay_period:'hour'}));
});

test('occupation mapping distinguishes software roles from road drivers and internal from intern', () => {
  for (const title of ['Junior Developer','Internal Software Engineer','Linux Driver Engineer'])
    assert.equal(pay.decoratePay({title,state:'FL'}).salary_estimate.soc,'15-1252',title);
  assert.equal(pay.decoratePay({title:'Delivery Driver',state:'FL'}).salary_estimate.soc,'53-3033');
  assert.equal(pay.decoratePay({title:'Software Engineer',location:'Jerusalem'}).salary_min,null);
});

const TITLE_CASES = [
  ['Supply Chain Director', null], ['Independent Contractor', null], ['Building Inspector', null],
  ['Instructor', null], ['Order Selector', null], ['Tractor Trailer Driver', '53-3054'],
  ['Postdoctoral Researcher', null], ['Sociologist', null],
  ['Director of Engineering', '11-9041'], ['Technical Instructor', '25-1194'],
  ['Contractor - Delivery Driver', '53-3033'],
  ['CTO', '11-3021'], ['cio', '11-3021'], ['Fractional CTO', '11-3021'],
  ['CIO Advisor', '11-3021'], ['Deputy (cTo)', '11-3021'], ['CTO/CIO', '11-3021'],
  ['CIO: Technology', '11-3021'], ['CTO\tAdvisor', '11-3021'], ['Deputy\nCIO', '11-3021'],
  ['CTO’s Office', '11-3021'], ['Chief Technology Officer', '11-3021'],
  ['Chief Information Officer', '11-3021'],
  ['xCTO', null], ['CTOx', null], ['2CTO', null], ['CTO2', null],
  ['_CTO', null], ['CTO_', null], ['xCIO', null], ['CIOx', null],
  ['2CIO', null], ['CIO2', null], ['_CIO', null], ['CIO_', null],
];

test('CTO/CIO estimate words keep boundaries and let specific occupation rules win', () => {
  for (const [title, soc] of TITLE_CASES) {
    const job = pay.decoratePay({title, state:'FL'});
    assert.equal(job.salary_estimate?.soc ?? null, soc, title);
    if (soc === null) assert.match(job.salary_estimate_unavailable, /No reliable occupation benchmark/);
  }
});

test('CTO/CIO boundaries agree in SQL and estimates for punctuation, spaces and word characters', () => {
  const fixture = new DatabaseSync(':memory:');
  const filter = pay.payFilter({min_pay:'150000'});
  const statement = fixture.prepare(`SELECT ${filter.sql} AS accepted FROM
    (SELECT ? AS title, 'FL' AS state, '' AS location, 'fte' AS job_type,
      NULL AS salary_source, NULL AS salary_min, NULL AS salary_max,
      NULL AS salary_currency, NULL AS salary_period) p`);
  const wordCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
  const separators = Array.from({length:95},(_,index) => String.fromCharCode(index + 32))
    .concat(['\t','\n','\r','\f','\v','é','—']);
  try {
    for (const word of ['CTO','cio']) for (const character of separators)
      for (const title of [character + word, word + character]) {
        const expected = !wordCharacters.includes(character);
        assert.equal(pay.decoratePay({title,state:'FL'}).salary_estimate?.soc === '11-3021', expected, title);
        assert.equal(Boolean(statement.get(...filter.args,title).accepted), expected, title);
      }
  } finally { fixture.close(); }
});

/** Populate isolated real feed tables without changing the earlier pay fixtures. */
function titleDatabase() {
  const fixture = new DatabaseSync(':memory:');
  fixture.exec("ATTACH DATABASE ':memory:' AS corpus");
  const engine = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  for (const schema of ['CORPUS_SCHEMA','USER_SCHEMA'])
    fixture.exec(engine.match(new RegExp(schema+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1]);
  fixture.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Title fixture')");
  const posting = fixture.prepare(`INSERT INTO corpus.postings_corpus
    (id,company_id,ats_job_id,title,location,state,active,target_role,job_type,first_seen_at)
    VALUES(?,1,?,?,'Destin, FL','FL',1,1,'fte',datetime('now'))`);
  const signal = fixture.prepare("INSERT INTO user_signals(posting_id,fit_score,ai_fit_score,status) VALUES(?,80,80,'new')");
  TITLE_CASES.forEach(([title], index) => {
    posting.run(index + 1, 'title-' + index, title);
    signal.run(index + 1);
  });
  fixture.exec('PRAGMA query_only=1');
  return fixture;
}

for (const [name,fetch] of [['search',fetchBrowsePage],['board',fetchBoardPage]]) {
  test(`${name}: pay filters and shown CTO/CIO estimates agree before paging`, () => {
    const fixture = titleDatabase();
    try {
      const page = fetch(fixture,{min_pay:'150000',per:'200'});
      const expected = TITLE_CASES.flatMap(([,soc],index) =>
        ['11-3021','11-9041'].includes(soc) ? [index + 1] : []);
      assert.deepEqual(ids(page), expected);
      for (const job of page.jobs) assert.equal(job.salary_estimate.soc, TITLE_CASES[job.id - 1][1], job.title);
      const withUnknown = fetch(fixture,{min_pay:'150000',include_unknown_pay:'1',per:'200'});
      assert.deepEqual(ids(withUnknown), TITLE_CASES.flatMap(([,soc],index) =>
        !['25-1194','53-3033','53-3054'].includes(soc) ? [index + 1] : []));
      const first = fetch(fixture,{min_pay:'150000',per:'2'});
      assert.equal(first.jobs.length, 2);
      assert.ok(first.jobs.every(job => expected.includes(job.id)));
    } finally { fixture.close(); }
  });
}
