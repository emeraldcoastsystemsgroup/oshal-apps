/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06, Switchboard P2 screens (calendar, compose, streams): guard over the served
 *   surfaces. Calendar: the per-day + is 44px and always visible with a day name, the arrows and refresh are named, the
 *   Pipeline line is a legend (no pills that look like filters), and the dialog's button says what Save does with the chosen
 *   status (Published is not offered for a new post). Compose: Write variants waits for a network and says so beside it,
 *   chips report aria-pressed with an inverted fill, Generate is secondary, a network that cannot be posted to gets Copy
 *   (never Publish or Schedule), and the repeated communications-bot line is gone. Streams: refresh is named, the New post
 *   dialog has a Workspace select prefilled from the rail, on a phone the stages are one sideways row and the imports sit
 *   under More, and the policy line clears the frame floor. All three: the primary is the solid accent, no gradient or glow.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'tools', f), 'utf8');
const CAL = read('switchboard-calendar.html');
const COMP = read('switchboard-compose.html');
const STR = read('switchboard-streams.html');

test('calendar: the per-day + is a 44px always-visible button named for its day; arrows and refresh are named', () => {
  const add = CAL.match(/\.colhead \.addday \{([^}]*)\}/)[1];
  assert.match(add, /width:44px; height:44px;/);
  assert.doesNotMatch(add, /opacity:0/);
  assert.doesNotMatch(CAL, /\.col:hover \.colhead \.addday/, 'no hover-only reveal (touch has no hover)');
  assert.match(CAL, /aria-label="New post on '\+DOW\[d\.getDay\(\)\]\+' '\+d\.getDate\(\)\+'"/);
  for (const [id, name] of [['prevBtn', 'Previous week'], ['nextBtn', 'Next week'], ['refreshBtn', 'Refresh']]) {
    assert.match(CAL, new RegExp(`id="${id}"[^>]*aria-label="${name}"`), id);
  }
});

test('calendar: Pipeline is a legend, and the dialog button follows Status with no Published on a new post', () => {
  const legend = CAL.slice(CAL.indexOf('function legend()'), CAL.indexOf('// ── data'));
  assert.doesNotMatch(legend, /class="pill/);
  assert.match(legend, /class="dot"/);
  assert.match(CAL, /var SAVE_LABEL=\{draft:"Save draft",needs_approval:"Send for approval",scheduled:"Schedule post",published:"Save changes"\};/);
  assert.match(CAL, /el\("fStatus"\)\.addEventListener\("change",syncSaveLabel\);/);
  assert.match(CAL, /pub\.hidden=!post; pub\.disabled=!post;/);
});

test('compose: Write variants waits for a network, says so beside it, and chips report their state', () => {
  assert.match(COMP, /<span class="genhint" id="genHint" role="status"><\/span>/);
  assert.match(COMP, /if\(btn && !btn\.dataset\.busy\) btn\.disabled=none;/);
  assert.match(COMP, /hint\.textContent=none\?"Pick a network to write variants for\.":"";/);
  assert.match(COMP, /el\.setAttribute\("aria-pressed", on\?"true":"false"\);/);
  assert.match(COMP, /\.plat\.on \{ border-color:transparent; color:var\(--on-accent\); background:var\(--accent\); \}/);
  assert.match(COMP, /<button class="btn" id="imgBtn">/, 'Generate is secondary; Write variants is the one primary');
});

test('compose: a network this installation cannot post to gets Copy, never Publish or Schedule; one bot line', () => {
  assert.match(COMP, /var canPost=!!v\.publishable && \(!tgt \|\| tgt\.connected!==false\);/);
  assert.match(COMP, /\+   \(canPost\n\s+\? '<div class="pubwrap">'/);
  assert.match(COMP, /<button class="btn sm copybtn">/);
  assert.equal((COMP.match(/communications bot/g) || []).length, 1, 'the communications bot is named once');
});

test('streams: refresh is named; New post asks for the workspace, prefilled from the rail', () => {
  assert.match(STR, /id="refreshBtn" title="Refresh" aria-label="Refresh"/);
  assert.match(STR, /<label for="nWorkspace">Workspace<\/label>\s*<select id="nWorkspace">/);
  assert.match(STR, /\$\("nWorkspace"\)\.value=state\.workspace\|\|"";/);
  assert.match(STR, /var ws=\$\("nWorkspace"\)\.value; if\(ws\) payload\.workspaceId=ws;/);
});

test('streams: on a phone the stages are one sideways row and the imports sit under More; the policy line clears the floor', () => {
  const phone = STR.slice(STR.indexOf('@media (max-width:760px)'));
  assert.match(phone, /\.snav \{ flex-direction:row; flex-wrap:nowrap; overflow-x:auto;/);
  assert.match(phone, /\.importwrap \{ display:none; \}/);
  assert.match(phone, /\.importwrap\.open \{ display:block; position:fixed;/);
  assert.match(STR, /id="moreBtn" aria-expanded="false" aria-controls="importWrap">More<\/button>/);
  assert.match(STR, /under <b>More<\/b>, above the list\./);
  assert.match(STR, /\.wrap \{ max-width:1500px; margin:0 auto; padding:26px 24px 104px; \}/);
});

test('every primary is the solid accent with the on-accent ink: no gradient, no glow', () => {
  for (const [name, html] of Object.entries({ calendar: CAL, compose: COMP, streams: STR })) {
    assert.match(html, /--accent-grad: var\(--ds-accent, var\(--accent\)\);/, name);
    assert.doesNotMatch(html, /--accent-grad: var\(--accent-gradient/, name);
    for (const m of html.matchAll(/\.(?:m?btn\.primary|newbtn) \{([^}]*)\}/g)) {
      assert.doesNotMatch(m[1], /box-shadow/, `${name}: ${m[0].slice(0, 40)}`);
      assert.doesNotMatch(m[1], /color:#fff/, `${name}: ${m[0].slice(0, 40)}`);
    }
  }
});
