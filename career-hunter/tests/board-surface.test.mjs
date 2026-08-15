/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Parse the uncompiled board script and guard filter persistence plus parallel first-load requests.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require pending and failed resume-ingest lifecycle states to take precedence over an older ready profile.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Require guide partial failures to render through textContent with a distinct warning line.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Require proposed guide mutations to render as text and cross a separate confirmation request before execution.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Guard truthful, redacted application provenance across board, approvals, mobile, and submissions surfaces.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Guard the rendered offline autofill affordance, PII warning, and one-time bookmarklet copy flow.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Require supported-site refusal and accurate direct-action versus employer-page event wording.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Prove mobile startup is read-only, draft top-up requires an explicit action, and status uses the owner-scoped durable apply queue.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Require every full-bleed mobile overlay to be grounded on the document's own opaque token so a stacked swipe card cannot show the role behind it.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Guard the one-click node installer: offered only when no computer is connected, announced before it downloads, and never a swarm-wide join code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const surfaceNames = [
  'career-board.html', 'career-approvals.html', 'career-mobile.html', 'career-submissions.html',
];
const surfaces = Object.fromEntries(surfaceNames.map((name) => [
  name, readFileSync(join(here, '..', 'tools', name), 'utf8'),
]));
const html = surfaces['career-board.html'];
const inlineBySurface = Object.fromEntries(Object.entries(surfaces).map(([name, source]) => [
  name, [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]),
]));
const inline = inlineBySurface['career-board.html'];
const body = inline.join('\n;\n');

const PROVENANCE_START = '// APPLICATION_PROVENANCE_START';
const PROVENANCE_END = '// APPLICATION_PROVENANCE_END';

/** Execute only a surface's dependency-free provenance helpers, never its DOM boot code. */
function provenanceRuntime(name) {
  const source = surfaces[name];
  const start = source.indexOf(PROVENANCE_START);
  const end = source.indexOf(PROVENANCE_END, start);
  assert.ok(start >= 0 && end > start, `${name}: provenance helper markers are missing`);
  const context = {};
  const snippet = source.slice(start + PROVENANCE_START.length, end);
  vm.runInNewContext(`${snippet}\nthis.describe=applicationProvenance;this.render=applicationProofHtml;`, context);
  return context;
}

test('every inline script parses — nothing else in the toolchain checks this file', () => {
  for (const [name, scripts] of Object.entries(inlineBySurface)) {
    assert.ok(scripts.length > 0, `${name}: expected inline script blocks`);
    scripts.forEach((src, i) => {
      assert.doesNotThrow(() => new vm.Script(src, { filename: `${name}#${i}` }));
    });
  }
});

test('the filter set is written to localStorage on every change', () => {
  // The surface is an iframe: a ribbon navigation reloads the document and drops in-memory state,
  // so persistence is the only thing that makes a filter survive leaving the tab.
  assert.match(body, /localStorage\.setItem\(FILTER_KEY/);
  assert.match(body, /localStorage\.getItem\(FILTER_KEY/);
  // Every control the operator can set has to be in the persisted set.
  for (const id of ['q', 'sort', 'min_score', 'min_pay', 'days']) {
    assert.ok(new RegExp(`'${id}'`).test(body), `filter control not persisted: ${id}`);
  }
  assert.match(body, /f\.remote\s*=\s*'1'/);   // the checkbox
  assert.match(body, /f\.status\s*=\s*activeStatus/); // the pipeline tab
});

test('filters are restored before the first request goes out', () => {
  const restore = body.indexOf('restoreFilters();');
  const boot = body.indexOf('checkOnboarding(true);');
  assert.ok(restore > -1 && boot > -1, 'expected the boot sequence');
  assert.ok(restore < boot, 'restoreFilters() must run before the first fetch');
});

test('an explicit URL filter wins over the remembered one', () => {
  // A bookmarked or shared link has to render what it says, not this browser's last view.
  assert.match(body, /fromUrl\s*\?\s*url\s*:\s*saved/);
});

test('changing any filter re-queries AND re-remembers', () => {
  // refilter() is the pairing; a listener wired straight to loadJobs would query without saving.
  assert.match(body, /const refilter\s*=\s*\(\)\s*=>\s*\{\s*rememberFilters\(\);\s*loadJobs\(\);\s*\}/);
  assert.match(body, /\['sort','min_score','min_pay','days'\]\.forEach\(k=>\$\(k\)\.addEventListener\('change',refilter\)\)/);
  assert.match(body, /\$\('remote'\)\.addEventListener\('change',refilter\)/);
  assert.match(body, /qt=setTimeout\(refilter,300\)/);
  // The pipeline tabs are a filter too.
  assert.match(body, /activeStatus=b\.dataset\.k;\s*rememberFilters\(\)/);
});

test('a remembered filter is escapable — the operator can see and clear it', () => {
  // Sticky state with no visible exit is how a board looks broken ("where did my jobs go?").
  assert.match(body, /clear filters/);
  assert.match(body, /function clearFilters\(\)/);
});

test('the feed request is issued in parallel with the onboarding gate', () => {
  // /resume/state used to resolve BEFORE the feed started — two serialized round-trips in front
  // of first paint, to answer a question that is "yes" for every returning user.
  assert.match(body, /const feed = prefetch \? fetchJobs\(\)/);
  const gate = body.indexOf("fetch('/api/career-hunter/resume/state')");
  const kick = body.indexOf('const feed = prefetch ? fetchJobs()');
  assert.ok(kick > -1 && gate > kick, 'the feed must be kicked off before awaiting resume/state');
});

test('the current resume ingest lifecycle takes precedence over stale profile readiness', () => {
  const indexing = body.indexOf('if(st && st.indexing)');
  const ready = body.indexOf('if(st && st.hasResume && st.scored>0)');
  assert.ok(indexing > -1 && ready > indexing, 'pending ingest must be checked before old profile data');
  assert.match(body, /st\.ingest\.state==='failed'/);
  assert.match(body, /renderIngestFailure\(st\.ingest\.error\)/);
  assert.match(body, /Upload &amp; retry/);
});

test('the surface tells the operator what a pooled ranking covered', () => {
  // Reporting "ranked within your top N" is the honest counterpart to bounding the pool.
  assert.match(body, /ranked within your top/);
  assert.match(body, /no further scored matches/);
});

test('job guide outcomes and proposals use text-only rendering plus explicit confirmation', () => {
  assert.match(body, /j\.failed&&j\.failed\.length/);
  assert.match(body, /j\.failed\.map\(x=>/);
  assert.match(body, /o\.textContent=lines\.join/);
  assert.match(body, /summary\.textContent='Proposed changes/);
  assert.match(body, /confirm\.onclick=\(\)=>confirmJobActions\(id\)/);
  assert.match(body, /JSON\.stringify\(\{confirmedActions:actions\}\)/);
});

test('every application surface renders four exact provenance states without sensitive values', () => {
  const taskId = 'apply-12345678-1234-1234-1234-ABC123';
  const confirmationPath = 'C:\\private\\tenant\\confirm-42.png';
  const expected = [
    ['manual-mark', 'manual', 'Marked applied manually'],
    ['worker-reported', 'worker', 'Worker reported submitted'],
    ['verified-submission', 'confirmation', 'Confirmation file present'],
    ['unverified', 'unverified', 'Historical applied — unverified'],
  ];
  for (const name of surfaceNames) {
    const runtime = provenanceRuntime(name);
    for (const [source, tone, label] of expected) {
      const record = { status: 'applied', application_source: source,
        application_task_id: taskId, confirmation_path: confirmationPath };
      assert.equal(runtime.describe(record).tone, tone, `${name}: ${source} tone`);
      const rendered = runtime.render(record);
      assert.ok(rendered.includes(label), `${name}: ${source} label`);
      if (source === 'worker-reported') assert.ok(rendered.includes('Worker task …ABC123'));
      assert.ok(!rendered.includes(taskId), `${name}: leaked a full task id`);
      assert.ok(!rendered.includes(confirmationPath), `${name}: leaked a confirmation path`);
    }
  }
});

test('worker reports never inherit confirmation styling or wording, and unknown sources fail closed', () => {
  for (const name of surfaceNames) {
    const runtime = provenanceRuntime(name);
    const worker = runtime.render({ status: 'applied', application_source: 'worker-reported',
      application_task_id: 'apply-12345678-1234-1234-1234-ABC123' });
    assert.ok(!worker.includes('proof-confirmation'), `${name}: worker received confirmation styling`);
    assert.ok(!worker.includes('Confirmation file present'), `${name}: worker was labeled confirmed`);
    const unknown = runtime.describe({ status: 'applied', application_source: 'future-value' });
    assert.equal(unknown.tone, 'unverified', `${name}: unknown provenance must fail closed`);
    const missingFile = runtime.describe({ status: 'applied', application_source: 'verified-submission' });
    assert.equal(missingFile.tone, 'unverified', `${name}: missing confirmation must fail closed`);
    assert.equal(runtime.render({ status: 'generated', application_source: 'worker-reported' }), '',
      `${name}: a non-application inherited stale proof UI`);
  }
});

test('each production renderer escapes every provenance summary field', () => {
  for (const name of surfaceNames) {
    const runtime = provenanceRuntime(name);
    const rendered = runtime.render({
      tone: 'worker" data-owned="yes', label: '<img src=x onerror=alert(1)>',
      detail: '<script>alert(2)</script>',
    });
    assert.ok(!rendered.includes('<img'), `${name}: label became markup`);
    assert.ok(!rendered.includes('<script'), `${name}: detail became markup`);
    assert.ok(!rendered.includes(' data-owned="yes'), `${name}: tone escaped its class attribute`);
    assert.match(rendered, /&lt;img/);
  }
});

test('completed lanes use neutral labels and wire the provenance renderer', () => {
  assert.match(surfaces['career-board.html'], /applied:'Applications recorded'/);
  assert.match(surfaces['career-board.html'], /value="applied">Application records/);
  assert.match(surfaces['career-approvals.html'], /applicationProofHtml\(a\.application_proof\|\|a\)/);
  assert.match(surfaces['career-approvals.html'], /jobs\?status=applied/);
  assert.match(surfaces['career-mobile.html'], /lane\('applied','Application records'/);
  assert.match(surfaces['career-mobile.html'], /applicationProofHtml\(j\)/);
  assert.match(surfaces['career-submissions.html'], /\['applied','Completed'\]/);
  assert.match(surfaces['career-submissions.html'], /applicationProofHtml\(proof\)/);
});

test('manual controls say they are manual and login challenges stay with the operator', () => {
  assert.match(surfaces['career-board.html'], />Mark applied manually<\/button>/);
  assert.match(surfaces['career-approvals.html'], />Mark applied manually<\/button>/);
  assert.match(surfaces['career-mobile.html'], />I applied it manually ✓<\/button>/);
  assert.doesNotMatch(surfaces['career-board.html'], /worker can read|read the one-time verification codes/i);
  assert.match(surfaces['career-board.html'], /email\/SMS codes, and CAPTCHAs pause the run in <b>Needs you<\/b>/);
});

test('mobile startup cannot enqueue drafts and apply status comes from the durable owner queue', () => {
  const mobile = surfaces['career-mobile.html'];
  const loadDeck = mobile.match(/async function loadDeck\(topUp\)\{([\s\S]*?)\n\}/);
  assert.ok(loadDeck, 'mobile loadDeck implementation is missing');
  assert.match(loadDeck[1], /if\(topUp===true\)\{/);
  assert.match(loadDeck[1], /jpost\(CH\+'\/enqueue-drafts',\{limit:20\}\)/);
  assert.doesNotMatch(loadDeck[1], /pending\.length\s*</);
  assert.match(mobile, /loadDeck\(false\); refreshBadges\(\);/);
  assert.match(mobile, /onclick="loadDeck\(true\)"/);
  assert.match(mobile, /jget\(AP\+'\/queue'\)/);
  assert.doesNotMatch(mobile, /jget\(AP\+'\/inflight'\)/);
  assert.match(mobile, /authorizes this one exact task[^<]+final Submit button/);
});

test('the board renders the offline autofill setup with an explicit PII warning', () => {
  assert.match(html, /id="copyAutofill"[^>]*>Copy offline autofill bookmarklet<\/button>/);
  assert.match(html, /Offline Apply \/ Autofill/);
  assert.match(body, /fetch\('\/api\/career-hunter\/autofill\/bookmarklet',\{cache:'no-store'\}\)/);
  assert.match(body, /navigator\.clipboard\.writeText/);
  assert.match(body, /stores your application profile \(including contact details\) inside its URL/);
  assert.match(body, /startsWith\('javascript:'\)/);
  assert.match(html, /supported Ashby, Greenhouse, Lever, Workday, or Distyl application/);
  assert.match(html, /does not directly upload, click, navigate, call the network, create an account, answer demographic questions, or submit/);
  assert.match(html, /Employer page scripts can react to those events/);
});

// ── Full-bleed overlays must be opaque ───────────────────────────────────────
// Every framework theme paints --bg-card / --bg-card-hover at 0.55-0.62 alpha: they are GLASS
// tokens, correct for a panel sitting on the page and wrong for anything stacked ON TOP OF other
// content. The swipe deck renders the next role underneath the lead one in the same `inset:0` box,
// so a lead card painted only in glass let the operator read the next opportunity straight through
// the card they were about to swipe (operator report, 2026-08-12).
//
// The rule is derived, not hardcoded: whatever token the DOCUMENT uses as its own ground is the
// ground a full-bleed overlay has to be painted on. A theme cannot regress it and a renamed alias
// breaks the guard loudly instead of silently.

/** Strip comments so prose about `background` or `inset:0` cannot satisfy a rule match. */
function styleSheetOf(name) {
  return [...surfaces[name].matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Crude but sufficient rule split: `selector { declarations }` pairs, at-rules skipped. */
function rulesOf(css) {
  const rules = [];
  for (const [, selector, block] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = selector.trim();
    if (!sel || sel.startsWith('@')) continue;
    rules.push({ selector: sel, block });
  }
  return rules;
}

/** Read one declaration's value out of a rule block. */
function decl(block, prop) {
  const match = block.match(new RegExp(String.raw`(?:^|;)\s*${prop}\s*:([^;]+)`));
  return match ? match[1].trim() : null;
}

/** Split a background value into layers on TOP-LEVEL commas only — gradients carry their own. */
function backgroundLayers(value) {
  const layers = []; let depth = 0; let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { layers.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

const GLASS = ['--card', '--card2', '--bg-card', '--bg-card-hover'];

test('the mobile surface grounds every full-bleed overlay on the same token as the document', () => {
  const css = styleSheetOf('career-mobile.html');
  const rules = rulesOf(css);

  const htmlRule = rules.find((r) => r.selector === 'html');
  const ground = decl(htmlRule?.block || '', 'background');
  assert.ok(ground, 'the document no longer declares its own opaque ground');

  // Anything positioned over other content at inset:0 AND painting a background.
  const overlays = rules.filter((r) => {
    const position = decl(r.block, 'position');
    return position === 'absolute' && /(?:^|;)\s*inset\s*:\s*0\b/.test(r.block)
      && decl(r.block, 'background');
  });
  assert.ok(overlays.length >= 2,
    `expected the deck card and the sheet to be full-bleed overlays, found: ${overlays.map((r) => r.selector).join(', ')}`);

  for (const rule of overlays) {
    const layers = backgroundLayers(decl(rule.block, 'background'));
    const bottom = layers[layers.length - 1];
    assert.equal(bottom, ground,
      `${rule.selector} is stacked over other content but its bottom background layer is `
      + `"${bottom}" instead of the document ground "${ground}" — content behind it shows through`);
  }
});

test('the lead swipe card is the one that has to be opaque, and it still looks like a card', () => {
  const rules = rulesOf(styleSheetOf('career-mobile.html'));
  const card = rules.find((r) => r.selector === '.jobcard');
  assert.ok(card, '.jobcard rule is missing — the deck was restructured, re-check the opacity rule');
  const layers = backgroundLayers(decl(card.block, 'background'));
  assert.ok(layers.length >= 2, 'the card has a single background layer again, so it is glass-only');
  // The glass gradient is what makes it match the cockpit — it must survive, just not alone.
  assert.ok(GLASS.some((token) => layers[0].includes(token)),
    `the card lost its themed surface: ${layers[0]}`);
  assert.ok(!GLASS.some((token) => layers[layers.length - 1].includes(token)),
    'the card is grounded on a glass token, which is not a ground at all');
  // The deck really does stack, which is what makes all of the above load-bearing.
  assert.match(surfaces['career-mobile.html'], /el\.innerHTML=\(next\?cardHTML\(next,false\):''\)\+cardHTML\(top,true\)/);
});

// ── One-click worker-node install ────────────────────────────────────────────

test('the board offers a node installer exactly where it reports no node', () => {
  // The node picker is the one place on this surface that already knows whether a computer
  // is connected, so it is the place the fix belongs. Offering it when a node IS connected
  // would be handing out credentials nobody asked for.
  assert.match(html, /id="installNode"/, 'the install affordance is gone');
  assert.match(html, /href="\/api\/join\/node-installer"/, 'it no longer points at the installer');
  assert.match(html, /id="installNode"[^>]*hidden/, 'it must start hidden until we know');
  assert.match(body, /install\.hidden = workers\.length > 0/,
    'the installer is not tied to whether a computer is connected');
});

test('the installer downloads in place rather than through a popup', () => {
  // The defect this exists for: the link was target="_blank". This surface runs inside the
  // cockpit's SANDBOXED iframe, and a sandbox without allow-downloads discards the download
  // silently — the popup opened, showed a blank tab, saved nothing, and logged nothing. The
  // server had already rendered the script and recorded it as issued, so both sides looked
  // healthy. Core now grants allow-downloads; this asserts the surface stopped depending on
  // a popup at all, which is what makes the download work regardless of the sandbox.
  assert.match(html, /id="installNode"[^>]*download="install-oshal-node\.cmd"/,
    'the anchor must carry download=, or the browser navigates instead of saving');
  const anchor = html.match(/<a[^>]*id="installNode"[\s\S]*?>/)[0];
  assert.ok(!/target="_blank"/.test(anchor),
    'target="_blank" makes this a popup download, the exact shape a sandbox discards');
});

test('the download ships with the one thing needed to actually run it', () => {
  // Windows refuses a downloaded .ps1 twice — the execution policy rejects unsigned scripts,
  // and the file carries an internet tag. Both refusals are silent on a double-click, so a
  // user who gets the file still gets nowhere. The instruction has to travel WITH the
  // download; a runbook is not where someone looks while staring at a file that did nothing.
  assert.match(html, /id="installHow"[^>]*hidden/,
    'the run instructions must exist and start hidden until a file is handed over');
  assert.match(html, /install-oshal-node\.cmd/,
    'instructions must name the real downloaded filename, not a placeholder');
  assert.match(body, /how\.hidden=false/,
    'the instructions must be revealed when the download is confirmed');
  // Revealing them up-front would be noise for the majority who never click.
  assert.ok(!/id="installHow"(?![^>]*hidden)/.test(html),
    'instructions must not be visible before the download exists');
});

test('the download is a .cmd, because Windows refuses a downloaded .ps1', () => {
  // A downloaded .ps1 is rejected as "not digitally signed" under the DEFAULT RemoteSigned
  // policy, and right-click "Run with PowerShell" passes no bypass — so the only people who
  // could run it were the ones who already knew to change their execution policy. A .cmd is
  // outside execution policy entirely. Core emits the batch header; this asserts the surface
  // asks for the matching filename, or the browser saves it under a name that will not run.
  assert.match(html, /id="installNode"[^>]*download="install-oshal-node\.cmd"/,
    'the download attribute must name a .cmd');
  assert.ok(!/download="install-oshal-node\.ps1"/.test(html),
    'a .ps1 filename puts the file back behind the execution policy');
});

test('the download says what is in the file before it exists', () => {
  // Same rule as the offline autofill bookmarklet: a file carrying a credential is
  // announced BEFORE it lands in Downloads, not documented somewhere afterwards.
  assert.match(body, /window\.confirm\(/);
  assert.match(body, /contains a credential for THIS computer only/);
  assert.match(body, /revoke it any time/i);
  // Cancelling must not still download — the anchor's default has to be prevented.
  assert.match(body, /if\(!ok\)\{ e\.preventDefault\(\); return; \}/);
  assert.match(body, /if\(!name\)\{ e\.preventDefault\(\); return; \}/);
});

test('the board never mints or shows a swarm-wide join code', () => {
  // A per-user surface may hand out a per-device credential. A join code embeds the
  // swarm-wide secret and is worth every node, so it must never appear here.
  assert.ok(!/OSJOIN1/.test(html), 'the board renders a swarm-wide join code');
  assert.ok(!/join\/code/.test(html), 'the board reaches the operator-only join-code route');
  assert.ok(!/SHARED_SECRET/i.test(html));
});
