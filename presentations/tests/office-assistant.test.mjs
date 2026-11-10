/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify proposal baseline detects outline, format, title and theme changes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.2 (RP-ALL-01): verify AI Office design.mjs does not inject a duplicate greyed Summarize planned control beside the kernel's live Summarize prompt chip.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {draftSnapshot} from '../tools/office-assistant.mjs';

test('proposal baseline detects outline, format, title and theme changes', () => {
  const draft={kind:'pptx',title:'Review',outline:'Goal\nOriginal',theme:'aurora'};
  const before=draftSnapshot(draft);
  assert.equal(before,draftSnapshot({...draft}));
  for(const field of Object.keys(draft)) assert.notEqual(before,draftSnapshot({...draft,[field]:'changed'}));
});

test('concierge prompt bar keeps Generate a draft without a duplicate greyed RP-ALL-01 Summarize chip', () => {
  const design = readFileSync(new URL('../tools/office/design.mjs', import.meta.url), 'utf8');
  assert.match(design, /make\('button','office-chip','Generate a draft'\)/);
  assert.doesNotMatch(design, /planned\(['"]RP-ALL-01['"]/);
});
