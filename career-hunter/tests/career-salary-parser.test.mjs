/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run real adapter/SQLite salary contracts and execute all salary renderers plus currency/unit-aware filters using synthetic evidence only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { payFilter, decoratePay } = require('../lib/career-pay.js');

test('real employer adapters and temporary SQLite preserve exact amounts, units and source evidence', () => {
  const run = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-salary-parser-contract.py', import.meta.url))], {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  assert.match(run.stderr,/Ran 12 tests/);
});

for (const surface of ['career-board.html','career-search.html','career-mobile.html']) {
  test(`${surface}: exact low rates, per-course units and unknown fields stay truthful`, () => {
    const source = readFileSync(new URL('../tools/'+surface,import.meta.url),'utf8');
    const match = source.match(/function salary\([^]*?\n}/);
    assert.ok(match);
    const context = {esc:String};vm.createContext(context);vm.runInContext(match[0],context);
    const fixtures = [
      [{salary_min:157400,salary_max:217800,salary_currency:'USD',salary_period:null},'$157,400–$217,800 · period unknown'],
      [{salary_min:197600,salary_max:264000,salary_currency:'CAD',salary_period:null},'CAD 197,600–CAD 264,000 · period unknown'],
      [{salary_min:157400,salary_max:217800,salary_currency:'USD',salary_period:'year'},'$157k–$218k /yr'],
      [{salary_min:4000,salary_max:8000,salary_currency:'USD',salary_period:'course'},'$4,000–$8,000 /course'],
      [{salary_min:4500,salary_currency:'USD',salary_period:'year'},'$4,500 /yr'],
      [{salary_min:500,salary_max:900,salary_currency:'USD',salary_period:'year'},'$500–$900 /yr'],
      [{salary_min:25.5,salary_max:30,salary_currency:'USD',salary_period:'hour'},'$25.5–$30 /hr'],
      [{salary_min:.5,salary_max:1.25,salary_currency:'USD',salary_period:'hour'},'$0.5–$1.25 /hr'],
      [{salary_min:4000,salary_max:8000,salary_currency:'USD',salary_period:'month'},'$4,000–$8,000 /month'],
      [{salary_min:40,salary_max:60,salary_currency:'USD',salary_period:'week'},'$40–$60 · period unknown'],
      [{salary_min:40,salary_max:60,salary_currency:null,salary_period:'hour'},'40–60 /hr · currency unknown'],
      [{salary_min:null,salary_max:null,salary_currency:'USD',salary_period:'year'},''],
    ];
    for (const [job,expected] of fixtures) assert.equal(context.salary(job),expected,JSON.stringify(job));
    if (surface === 'career-board.html') {
      vm.runInContext(source.match(/function payMeta\([^]*?\n}/)[0],context);
      const listed = decoratePay({...fixtures[0][0],salary_source:'listed'});
      assert.equal(listed.salary_estimate,null);
      assert.doesNotMatch(context.payMeta(listed),/estimate/,'correct employer amounts stay employer-listed');
      assert.match(context.payMeta({...fixtures[2][0],salary_source:'ai_estimated'}),/estimate/);
    }
  });
}

test('pay filters require matching explicit currency and period, including when unknown pay is requested', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE p(id INTEGER, title TEXT, state TEXT, location TEXT, job_type TEXT,
      salary_min REAL,salary_max REAL,salary_currency TEXT,salary_period TEXT,salary_source TEXT);`);
    const insert = db.prepare("INSERT INTO p VALUES(?,'Unknown position','FL','Destin, FL','fte',?,?,?,?,?)");
    for (const row of [
      [1,4000,8000,'USD','year','listed'],[2,4000,8000,'CAD','year','listed'],
      [3,4000,8000,'USD','course','listed'],[4,4000,8000,'USD','month','listed'],
      [5,4000,8000,'USD',null,'listed'],[6,4000,8000,null,'year','listed'],
      [7,40,60,'USD','hour','listed'],[8,500,900,'USD','year','listed'],
      [9,null,null,null,null,null],
    ]) insert.run(...row);
    const ids = query => {
      const filter = payFilter(query);
      return db.prepare('SELECT id FROM p WHERE '+filter.sql+' ORDER BY id').all(...filter.args).map(row=>row.id);
    };
    assert.deepEqual(ids({min_pay:'4000',max_pay:'8000',pay_period:'year'}),[1]);
    assert.deepEqual(ids({min_pay:'4000',max_pay:'8000',pay_period:'year',include_unknown_pay:'1'}),[1,9]);
    assert.deepEqual(ids({min_pay:'40',max_pay:'60',pay_period:'hour'}),[7]);
    assert.deepEqual(ids({min_pay:'500',max_pay:'900',pay_period:'year'}),[8]);
    assert.deepEqual(ids({min_pay:'4000',max_pay:'8000',pay_period:'month'}),[4]);
  } finally {db.close();}
});
