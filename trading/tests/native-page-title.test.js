/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The page title is the application display name alone: it reaches the assistant as the screen's name and shows in the browser tab (it read "Trading" while the application is Intelligent Trades).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('the page title is the application display name, nothing more', () => {
  const name = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8').match(/^displayName: *(.+)$/m)[1].trim();
  const titles = fs.readFileSync(path.join(root, 'tools', 'trading.html'), 'utf8').match(/<title>[^<]*<\/title>/g);
  assert.equal(name, 'Intelligent Trades');
  assert.deepEqual(titles, [`<title>${name}</title>`], 'one title, and it is the display name');
});
