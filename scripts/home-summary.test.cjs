/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Exercise packaged Home routes: session gate, unavailable sources, no secret leakage and no outbound dependencies.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Intelligent Communication's digest opens through the kernel's seal, doubled here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: Pumpkin Review printed a saved time as a raw UTC instant ('saved 2026-10-13T10:55:35.857Z'); thirteen review pages render a summary item's detail the same way. Every page that renders item.detail formats its instants in the viewer's zone (localInstants, run as shipped).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Roger F14, 2026-11-06 (Stories: "open episode workflow buttons are large, refresh evidence... its just not following the general sizing of objects"): every review page that styles its own buttons does it on the design standard's scale (docs/ux/design-standard.md §4.1): the body text token at 600, 44px, radius m, a solid --ds-surface-2 fill; never the template's old 9px glass button (9px 13px sides, a translucent --glass-bg fill, 400 weight, 43px tall). The browser half is creative-studio/tests/design-standard-browser.test.mjs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const packages = ['feeds', 'email-summarizer', 'switchboard'];

/** A double of the kernel's seal; the real one is crates/oshald/tests/personal_data_intent.rs in the kernel repository. */
const KERNEL_SEAL = {
  isEncrypted: value => typeof value === 'string' && value.startsWith('opd1:'),
  encryptField: async (_owner, value) => `opd1:${Buffer.from(value).toString('base64')}`,
  decryptField: async (_owner, value) => {
    if (value === 'opd1:corrupt') throw new Error('sealed value could not be opened');
    return Buffer.from(value.slice(5), 'base64').toString();
  },
};

function loadRoute(app, pool) {
  let handler;
  const router = { get: (_path, fn) => { handler = fn; } };
  function load(file) {
    const module = { exports: {} };
    const requireAllowed = name => {
      if (name === 'express') return { Router: () => router };
      if (name === 'crypto') return crypto;
      if (name === './digest-seal') return load(path.join(root, app, 'routes/digest-seal.js'));
      if (name === '@/features/personal-data') return KERNEL_SEAL;
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
test('Email: a seal the kernel cannot open is unavailable', async () => {
  const response = await loadRoute('email-summarizer', {async query() {return {rows:[{summary:'opd1:corrupt',updated_at:new Date()}]};}})();
  assert.equal(response.code,503);
});
test('Email: a summary only the earlier platform could open reads as not saved', async () => {
  const response = await loadRoute('email-summarizer', {async query() {return {rows:[{summary:'aXY=:dGFn:Y2lwaGVy',updated_at:new Date()}]};}})();
  assert.equal(response.code,200);
  assert.equal(response.body.tiles[0].value,'Not saved');
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
test('Email: an opened saved digest becomes a review draft only', async () => {
  const summary=await KERNEL_SEAL.encryptField('alice','A saved commitment to review');
  const response=await loadRoute('email-summarizer',{async query(){return {rows:[{summary,updated_at:new Date()}]};}})();
  assert.equal(response.code,200);
  assert.equal(response.body.items[0].actions[0].context.notes,'A saved commitment to review');
  assert.deepEqual(response.body.items[0].actions.map(a=>a.integration),['prepare-document','review-sales']);
});

/** The CSS rules of a page's <style> blocks as [selectors, declarations] pairs (innermost rules, so a rule inside @media counts too). */
function styleRules(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].split(',').map((s) => s.trim()), m[2].replace(/\s+/g, '')]);
}

test('every review page that styles its own buttons sizes them on the design standard scale, never the old 9px glass button', () => {
  const pages = fs.readdirSync(root).map((dir) => path.join(root, dir, 'tools', 'review.html')).filter((file) => fs.existsSync(file));
  assert.ok(pages.length >= 14, `found ${pages.length} review pages`);
  let styled = 0;
  for (const file of pages) {
    const rules = styleRules(fs.readFileSync(file, 'utf8'));
    for (const [selectors, body] of rules.filter(([s]) => s.some((x) => /(^|[\s>])button\b/.test(x)))) {
      assert.ok(!/--glass-bg|border-radius:9px|padding:9px13px/.test(body), `${file}: ${selectors.join(',')} keeps the old glass button (${body})`);
    }
    const base = rules.filter(([s]) => s.some((x) => x === 'button' || x === 'main button'));
    if (!base.length) continue; // the page draws only another kit's buttons (Little Monsters' .lm-btn)
    styled += 1;
    const all = base.map(([, b]) => b).join(';') + ';' + rules.filter(([s]) => s.includes('button:where(:not(.av-btn))')).map(([, b]) => b).join(';');
    assert.match(all, /font:var\(--ds-text-body/, `${file}: button text is the body token (16px on touch, 15px on a desktop with a fine pointer)`);
    assert.match(all, /font-weight:600/, `${file}: button labels are 600`);
    assert.match(all, /min-height:44px/, `${file}: buttons are 44px touch targets`);
    assert.match(all, /border-radius:var\(--ds-radius-m/, `${file}: buttons use the control radius`);
    assert.match(all, /background:var\(--ds-surface-2/, `${file}: buttons are solid secondary fills`);
  }
  assert.ok(styled >= 13, `${styled} review pages style their own buttons`);
});

test('every review page shows a summary detail\'s saved instants in the viewer\'s zone, not as UTC text', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const pages = fs.readdirSync(root).map((dir) => path.join(root, dir, 'tools', 'review.html')).filter((file) => fs.existsSync(file));
    const rendering = pages.filter((file) => fs.readFileSync(file, 'utf8').includes('item.detail'));
    assert.ok(rendering.length >= 14, `found ${rendering.length} review pages rendering item.detail`);
    for (const file of rendering) {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(!/detail\.textContent\s*=\s*item\.detail\b/.test(html), `${file} renders the raw detail`);
      assert.ok(/detail\.textContent\s*=\s*localInstants\(item\.detail/.test(html), `${file} formats the detail`);
      const line = html.slice(html.indexOf('const localInstants='), html.indexOf('\n', html.indexOf('const localInstants=')));
      const localInstants = new Function(`${line}\nreturn localInstants;`)();
      assert.match(localInstants('mischief / saved 2026-10-13T10:55:35.857Z'), /^mischief \/ saved Oct 13, 2026, 5:55\s?AM$/, file);
      assert.equal(localInstants('no instant here'), 'no instant here');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
