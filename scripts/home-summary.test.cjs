/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Exercise packaged Home routes: session gate, unavailable sources, no secret leakage and no outbound dependencies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const packages = ['feeds', 'email-summarizer', 'switchboard'];

function loadRoute(app, pool) {
  let handler;
  const router = { get: (_path, fn) => { handler = fn; } };
  function load(file) {
    const module = { exports: {} };
    const requireAllowed = name => {
      if (name === 'express') return { Router: () => router };
      if (name === 'crypto') return crypto;
      if (name === './session-crypto') return load(path.join(root, app, 'routes/session-crypto.js'));
      throw new Error(`Unexpected runtime dependency: ${name}`);
    };
    new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(requireAllowed, module, module.exports);
    return module.exports;
  }
  load(path.join(root, app, 'routes/home-summary.js')).createHomeSummaryRoutes({ pool });
  return async (oidc = { isAuthenticated: () => true, user: { sub: 'alice' } }) => {
    const response = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(body) { this.body = body; } };
    await handler({ oidc, query: { user_sub: 'mallory' }, body: { user_sub: 'mallory' } }, response);
    return response;
  };
}

for (const app of packages) {
  test(`${app}: unauthenticated subjects never query`, async () => {
    const request = loadRoute(app, { query() { throw new Error('No query permitted'); } });
    for (const oidc of [null, { user: {sub:'alice'} }, { isAuthenticated:()=>false, user:{sub:'alice'} }, {isAuthenticated:()=>true}]) {
      const response = await request(oidc);
      assert.equal(response.code,401);
      assert.equal(response.headers['Cache-Control'],'no-store');
    }
  });
  test(`${app}: uses the signed-in owner and reads only on repeated GET`, async () => {
    const queries = [];
    const request = loadRoute(app, { async query(sql, args) {
      assert.match(sql,/^SELECT\b/);
      assert.match(sql,/WHERE user_sub = \$1/);
      assert.equal(args[0],'alice');
      queries.push(sql);
      return {rows: []};
    } });
    for (let i=0; i<2; i++) assert.equal((await request()).code,200);
    assert.ok(queries.length >= 2);
  });
  test(`${app}: unavailable source is not an empty success or leaked error`, async () => {
    const response = await loadRoute(app, {async query() {throw new Error('database-password-secret');}})();
    assert.equal(response.code,503);
    assert.ok(!JSON.stringify(response.body).includes('database-password-secret'));
  });
}
test('Feeds: a failed sync read preserves index counts and marks the missing source', async () => {
  const response = await loadRoute('feeds', {async query(sql) {
    if(sql.includes('feed_settings')) throw new Error('offline');
    return {rows:[{day:'3',five_days:'9',channels:'2'}]};
  }})();
  assert.equal(response.code,200);
  assert.equal(response.body.partial,true);
  assert.equal(response.body.metrics[0].value,'3');
  assert.equal(response.body.metrics[3].value,'Unavailable');
  assert.ok(response.body.items.some(i=>i.tone==='warn'));
});
test('Switchboard: unavailable outbox never zeroes it or discards publishing state', async () => {
  const response = await loadRoute('switchboard', {async query(sql) {
    if(sql.includes('reply_outbox')) throw new Error('offline');
    return {rows:[{review:'2',scheduled:'3',overdue:'1',failed:'0'}]};
  }})();
  assert.equal(response.code,200);
  assert.equal(response.body.partial,true);
  assert.equal(response.body.metrics[0].value,'2');
  assert.equal(response.body.metrics[4].value,'Unavailable');
});
test('Email: corrupt saved ciphertext is unavailable', async () => {
  const response = await loadRoute('email-summarizer', {async query() {return {rows:[{summary:'bad:cipher:text',updated_at:new Date()}]};}})();
  assert.equal(response.code,503);
});
test('Feeds: latest saved entries carry their own bounded context and never other owners', async () => {
  const response = await loadRoute('feeds', {async query(sql,args) {
    assert.equal(args[0],'alice');
    if(sql.includes('ORDER BY posted_at')) {
      assert.match(sql,/LIMIT 3/);
      assert.match(sql,/interval '120 hours'/);
      return {rows:[{channel_name:'Project discussion',text:'Selected evidence '.repeat(200),posted_at:new Date()}]};
    }
    return {rows:[]};
  }})();
  const item=response.body.items.find(i=>i.actions?.length);
  assert.deepEqual(item.actions.map(a=>a.integration),['prepare-document','prepare-post']);
  assert.match(item.actions[0].context.notes,/Project discussion/);
  assert.equal(item.actions[0].context.notes.length,2000);
});
test('Email: decrypted saved digest becomes a review draft only', async () => {
  const prior=process.env.SESSION_SECRET;process.env.SESSION_SECRET='fixture-secret';
  try {
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest(),iv);
    const encrypted=Buffer.concat([cipher.update('A saved commitment to review','utf8'),cipher.final()]);
    const summary=[iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join(':');
    const response=await loadRoute('email-summarizer',{async query(){return {rows:[{summary,updated_at:new Date()}]};}})();
    assert.equal(response.code,200);
    assert.equal(response.body.items[0].actions[0].context.notes,'A saved commitment to review');
    assert.deepEqual(response.body.items[0].actions.map(a=>a.integration),['prepare-document','review-sales']);
  } finally {if(prior===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=prior;}
});
