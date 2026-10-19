/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard deck-builder's routing words: "Make a PowerPoint about photosynthesis for my Biology class" asked from Jarvis reached no application. The words a person uses for a deck or a Word file must stay declared on the bot that holds the create tools.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(PKG, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));

test('deck-builder declares the words people use for a deck or a document', () => {
  const bot = manifest.bots.find(entry => entry.name === 'deck-builder');
  // Multi-word phrases: a phrase outscores a one-word keyword, so "a PowerPoint ... for my Biology class"
  // is not tied with Little Monsters' class words.
  for (const phrase of (bot.routingKeywords || [])) assert.match(phrase, / /, phrase);
  for (const phrase of ['a powerpoint', 'powerpoint about', 'a presentation', 'a slide deck', 'a word document', 'intelligent office']) {
    assert.ok((bot.routingKeywords || []).includes(phrase), phrase);
  }
  const tools = manifest.tools.map(tool => tool.name);
  assert.ok(tools.includes('presentations-create-deck') && tools.includes('presentations-create-document'));
});
