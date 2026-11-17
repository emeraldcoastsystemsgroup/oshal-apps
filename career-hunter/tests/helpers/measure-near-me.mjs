/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4: time My jobs' Within and Distance from home on the fictional volume (60,000 jobs, 8,000 AI matches, 500 saved), two in five on-site with a city point near a made-up home, one in seven of those made fully remote, the rest the fixture's own fully remote jobs, beside the sorts that already walk every scored match. Prints milliseconds and row counts only. Run: node career-hunter/tests/helpers/measure-near-me.mjs
 */
import {createRequire} from 'node:module';
import {volumeFixture} from './career-volume-fixture.mjs';
const require = createRequire(import.meta.url), Database = require('../../../scripts/toolchain/node_modules/better-sqlite3');
const f = volumeFixture();
try {
  const db = new Database(':memory:');
  db.prepare('ATTACH DATABASE ? AS corpus').run(f.paths.corpusDb);
  db.exec(`UPDATE corpus.postings_corpus SET city='fixture town', lat=44.0567+((id % 400)-200)/200.0, lon=-121.308+((id % 300)-150)/150.0, remote=0, location='Fixture Town, OR' WHERE id % 5 < 2;
    UPDATE corpus.postings_corpus SET remote=1, location='Remote - US' WHERE id % 7 = 0;`);
  db.close();
  await (await import('../../routes/career-search-scope.js')).saveJobSearchScope(f.paths.userDir, {near:'Bend, OR', radiusMiles:50, includeRemote:true});
  const rows = [];
  for (const url of ['/jobs?status=saved&sort=ai&per=50', '/jobs?status=saved&sort=distance&per=50', '/jobs?status=saved&within=25&sort=distance&per=50',
    '/jobs?matches=1&sort=salary&per=25&remote=', '/jobs?matches=1&sort=distance&per=25&remote=', '/jobs?matches=1&within=25&per=25&remote=',
    '/jobs?status=queue&sort=distance&per=25', '/jobs?status=tracked&within=100&per=25']) {
    const times = [];
    let answer;
    for (let i = 0; i < 3; i++) { const t = performance.now(); answer = await f.call('GET', url); times.push(performance.now() - t); }
    rows.push({url, status:answer.status, rows:answer.json.jobs?.length ?? null, ms:times.map(n => Math.round(n))});
  }
  console.log(JSON.stringify(rows, null, 1));
} finally { f.close(); }
