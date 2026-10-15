import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftSnapshot} from '../tools/office-assistant.mjs';

test('proposal baseline detects outline, format, title and theme changes', () => {
  const draft={kind:'pptx',title:'Review',outline:'Goal\nOriginal',theme:'aurora'};
  const before=draftSnapshot(draft);
  assert.equal(before,draftSnapshot({...draft}));
  for(const field of Object.keys(draft)) assert.notEqual(before,draftSnapshot({...draft,[field]:'changed'}));
});
