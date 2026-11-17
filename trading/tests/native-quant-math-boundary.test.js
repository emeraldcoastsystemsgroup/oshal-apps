/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant's math core stays outside the order authority and stays pure: no module under routes/quant/math joins any version's order-authority closure (followed by the kernel's literal-require rules), each loads only its siblings (no file, network, database, model or order path), and each file keeps the store's header, size and documentation rules.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

const root = path.resolve(__dirname, '..');
const MATH = 'routes/quant/math';
const yamlRoots = [__dirname, path.resolve(__dirname, '../../scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [path.resolve(process.env.OSHAL_FRAMEWORK)] : [])];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));
const mathFiles = fs.readdirSync(path.join(root, MATH)).filter((f) => f.endsWith('.js')).map((f) => `${MATH}/${f}`);

/**
 * @description The package files a module loads by literal relative require (the kernel's order-authority rule).
 * @param {string} rel - Module path inside the package.
 * @returns {string[]} Resolved package paths.
 */
function literalLoads(rel) {
  if (rel.endsWith('.json')) return [];
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  return [...text.matchAll(/\brequire[ \t\r\n]*\([ \t\r\n]*(['"])([^'"\n]+)['"][ \t\r\n]*\)/g)].map((m) => m[2])
    .filter((spec) => spec.startsWith('./') || spec.startsWith('../'))
    .map((spec) => {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      return [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`].find((c) => fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile());
    })
    .filter(Boolean);
}

/**
 * @description Every file reachable from declared order-authority sources.
 * @param {string[]} sources - Declared sources.
 * @returns {Set<string>} The closure.
 */
function closure(sources) {
  const seen = new Set(), pending = [...sources];
  while (pending.length) {
    const rel = pending.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    pending.push(...literalLoads(rel));
  }
  return seen;
}

test('no math module joins any version of the order-authority closure', () => {
  const declared = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8')).orderAuthority;
  const versions = declared.versions ? Object.values(declared.versions).map((v) => v.sources) : [declared.sources];
  assert.ok(versions.length && versions.every((s) => Array.isArray(s) && s.length), 'orderAuthority declares its sources');
  for (const sources of versions) {
    const covered = closure(sources);
    assert.ok(covered.has('routes/live/management.js') || covered.has('routes/trading-native-management.js'), 'the closure is followed');
    for (const file of mathFiles) assert.ok(!covered.has(file), `${file} must stay outside the order authority`);
  }
});

test('the math core loads only its own siblings: no file, network, database, model or order path', () => {
  for (const file of mathFiles) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const specs = [...text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.equal((text.match(/\brequire\s*\(/g) || []).length, specs.length, `${file} has a computed require`);
    for (const spec of specs) assert.match(spec, /^\.\/[a-z-]+$/, `${file} loads ${spec}`);
    assert.doesNotMatch(text, /\b(pool|intent|fetch|process\.env|trading\.orders|XMLHttpRequest|WebSocket)\b/, `${file} reaches outside pure math`);
  }
  assert.ok(mathFiles.length >= 17, `every module is checked (${mathFiles.length})`);
});

test('each math file has its change log, stays under 1000 code lines, keeps functions under 50 lines, and documents them', () => {
  for (const file of mathFiles) {
    const text = fs.readFileSync(path.join(root, file), 'utf8'), lines = text.split('\n');
    assert.match(text.slice(0, 400), /CHANGE LOG\n \* 1 \| maintainer@emeraldcoastsystemsgroup\.com \| /, `${file} header`);
    const code = lines.filter((l) => l.trim() && !/^\s*(\/\/|\/\*\*?|\*)/.test(l));
    assert.ok(code.length < 1000, `${file} has ${code.length} code lines`);
    lines.forEach((line, i) => {
      const fn = /^(async )?function ([A-Za-z0-9_]+)\(/.exec(line);
      if (!fn) return;
      const end = lines.findIndex((l, j) => j > i && /^}/.test(l));
      assert.ok(end - i < 50, `${file} ${fn[2]} is ${end - i} lines`);
      const doc = lines.slice(Math.max(0, i - 40), i).join('\n'), block = doc.slice(doc.lastIndexOf('/**'));
      assert.match(block, /@description[\s\S]*@returns/, `${file} ${fn[2]} needs JSDoc with @description and @returns`);
    });
  }
});
