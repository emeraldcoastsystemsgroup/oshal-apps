/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reproduce actual small-page annotation refusal and retain shifted/rotated native page geometry without assuming paper size.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {apply,initial,readablePages} from '../routes/model.mjs';
test('actual failed Jarvis geometry is refused; a saved-page suggestion retains native annotation and original model',()=>{
 const source={id:randomUUID(),pages:[{index:0,cropBox:[0,0,240,200]}],fields:[]},model=initial(source),page=model.pages[0].id;
 const annotation={id:randomUUID(),page,kind:'text',rect:[72,700,300,730],text:'Jarvis manual field'};
 assert.throws(()=>apply(model,[{op:'annotate',annotation}],[source]),/pdf_annotation_geometry/);assert.deepEqual(model.annotations,[]);
 const details=readablePages({model,inspection:{pages:source.pages}})[0];
 const changed=apply(model,[{op:'annotate',annotation:{...annotation,rect:details.textAnnotationRect}}],[source]);
 assert.equal(changed.annotations[0].text,annotation.text);assert.deepEqual(changed.pages,model.pages);assert.deepEqual(model.annotations,[]);
 const next=readablePages({model:changed,inspection:{pages:source.pages}})[0].textAnnotationRect;
 assert.ok(next===null||next[3]<=details.textAnnotationRect[1]||next[1]>=details.textAnnotationRect[3]);
});
test('read geometry follows saved page order, shifted crop origin and rotation without mutating engine models',()=>{
 const ids=[randomUUID(),randomUUID()],source=randomUUID(),model={pages:[{id:ids[1],source,index:1,rotation:90},{id:ids[0],source,index:0,rotation:270}],annotations:[],fields:{}};
 const boxes=[[100,200,340,400],[-40,-20,60,80]],before=structuredClone(model);
 const details=readablePages({model,inspection:{pages:boxes.map(cropBox=>({cropBox}))}});
 assert.deepEqual(model,before);assert.deepEqual(details.map(p=>p.id),[ids[1],ids[0]]);
 for(let i=0;i<2;i++){assert.deepEqual(details[i].cropBox,boxes[i]);const r=details[i].textAnnotationRect,b=boxes[i];assert.ok(r[0]>=b[0]&&r[1]>=b[1]&&r[2]<=b[2]&&r[3]<=b[3]&&r[0]<r[2]&&r[1]<r[3]);}
 assert.throws(()=>readablePages({model,inspection:{pages:[]}}),/pdf_page_geometry_unavailable/);
});
test('out-of-rectangle ink and unsupported text are refused before worker publication',()=>{
 const source={id:randomUUID(),pages:[{index:0,cropBox:[10,20,250,220]}],fields:[]},model=initial(source),a={id:randomUUID(),page:model.pages[0].id,kind:'ink',rect:[20,30,100,80],points:[[25,35],[200,70]]};
 assert.throws(()=>apply(model,[{op:'annotate',annotation:a}],[source]),/pdf_annotation_geometry/);
 assert.throws(()=>apply(model,[{op:'annotate',annotation:{id:a.id,page:a.page,kind:'text',rect:a.rect,text:'Unsupported \u00e9'}}],[source]),/pdf_annotation_text_unsupported/);
});
