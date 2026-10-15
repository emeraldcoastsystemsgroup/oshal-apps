import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {apply,initial} from '../routes/model.mjs';
test('stable original-page identities survive reorder/rotation/extract and foreign sources refuse',()=>{
 const source={id:randomUUID(),pages:[{index:0},{index:1}],fields:[]},before=initial(source),first=before.pages[0].id,second=before.pages[1].id;
 const after=apply(before,[{op:'reorder',pageIds:[second,first]},{op:'rotate',page:first,degrees:90},{op:'extract',pageIds:[first]}],[source]);
 assert.equal(after.pages[0].id,first);assert.equal(after.pages[0].index,0);assert.equal(after.pages[0].rotation,90);assert.equal(before.pages.length,2);assert.equal(before.pages[0].rotation,0);
 assert.throws(()=>apply(before,[{op:'remove',pageIds:[first,second]}],[source]),/pdf_empty_document/);
 assert.throws(()=>apply(before,[{op:'merge',source:randomUUID(),position:0}],[source]),/pdf_source_unavailable/);
 assert.throws(()=>apply(before,[{op:'rotate',page:first,degrees:45}],[source]),/pdf_invalid_rotation/);
 assert.throws(()=>apply(before,[{op:'reorder',pageIds:[first]}],[source]),/pdf_reorder_requires_all_pages/);
});
