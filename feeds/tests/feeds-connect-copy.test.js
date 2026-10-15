/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 8: asked what Feeds shows after connecting Slack, the concierge said 'going to Connections (/utilities)'. The served manifest tool instructions and the curator persona name the Connect Slack button (a control the Feeds page renders) and give no path.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(PKG, f), 'utf8');
/** The text a model reads: YAML without its comment lines. */
const prompt = (f) => read(f).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('no instruction the concierge reads gives the /utilities path', () => {
  for (const f of ['oshal-app.yaml', 'personas/feeds-curator.yaml']) {
    const text = prompt(f);
    const paths = text.match(/\(\/utilities\)|under Connections \(\/utilities\)|at \/utilities/g) || [];
    assert.deepEqual(paths, [], `${f} sends the person to a path`);
    assert.match(text, /press Connect Slack on\s+the Feeds page/, `${f} names the button`);
  }
});

test('the button the instructions name is the one the Feeds page renders', () => {
  assert.match(read('tools/feeds.html'), /<button class="btn primary" id="connectBtn">Connect Slack<\/button>/);
});
