/** Source-model regression only; no framework, provider, storage or native authority seam. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {serializeSections} from '../tools/slide-workspace.mjs';
const source = readFileSync(new URL('../tools/presentations.html', import.meta.url), 'utf8');
const parser = source.slice(source.indexOf('function parseOutline('), source.indexOf('// ADR-043 item A:', source.indexOf('function parseOutline(')));
const context = vm.createContext({}); vm.runInContext(parser, context);
const parse = text => JSON.parse(JSON.stringify(vm.runInContext('parseOutline(input)', Object.assign(context, {input:text}))));
test('slide workspace roundtrips the original outline including tables/charts/layout/image/quote/column lines', () => {
 const sections=[{title:'Overview',content:'First point\nSecond point'}, {title:'Structured slide',content:'#layout: comparison\n#image: https://example.invalid/image.png\n## Left\nA & B\n## Right\nQ1: 120\n| Name | Value |\n| A | =SUM(B2:B4) |\n> Direct quote\n— Source\n94% :: uptime'}];
 const before=structuredClone(sections);assert.deepEqual(parse(serializeSections(sections)),sections);assert.deepEqual(sections,before);assert.equal(serializeSections([]),'');
 const changed=structuredClone(sections);changed[0].content='Only this slide changes';assert.deepEqual(parse(serializeSections(changed))[1],sections[1]);
});
test('ambiguous title/blank-body delimiters refuse rather than silently converting selected text into new slides',()=>{
 for(const value of [[{title:'',content:'Body'}],[{title:'Title\nAnother title',content:'Body'}],[{title:'Title',content:'A\n\nB'}]])assert.throws(()=>serializeSections(value),TypeError);
 assert.throws(()=>serializeSections([{title:'Title',content:42}]),TypeError);
});
test('directive helpers read, replace and remove #layout/#image/#caption without touching the slide text',async()=>{
 const {readDirective,writeDirective}=await import('../tools/slide-workspace.mjs');
 const body='First point\n#layout: comparison\nSecond point\n#caption: Team photo';
 assert.equal(readDirective(body,'layout'),'comparison');assert.equal(readDirective(body,'caption'),'Team photo');assert.equal(readDirective(body,'image'),'');
 const uri='data:image/jpeg;base64,/9j/AAAA';
 const withImage=writeDirective(body,'image',uri);
 assert.equal(readDirective(withImage,'image'),uri);
 assert.deepEqual(withImage.split('\n').filter(l=>!/^#/.test(l)),['First point','Second point'],'the text lines survive untouched');
 const swapped=writeDirective(withImage,'layout','image-right');
 assert.equal(readDirective(swapped,'layout'),'image-right');assert.equal(swapped.split('\n').filter(l=>/^#layout:/i.test(l)).length,1,'one layout line, replaced not duplicated');
 const removed=writeDirective(writeDirective(swapped,'caption',''),'image','');
 assert.equal(readDirective(removed,'image'),'');assert.equal(readDirective(removed,'caption'),'');
 assert.doesNotThrow(()=>serializeSections([{title:'T',content:removed}]),'removal never leaves a blank line that would split the slide');
 assert.equal(writeDirective('#image: old','image',''),'','a directive-only body empties cleanly');
});
test('splitDesign separates the design directives from the prose; mergeDesign keeps them through helper edits',async()=>{
 const {splitDesign,mergeDesign}=await import('../tools/slide-workspace.mjs');
 const uri='data:image/png;base64,iVBORw0KGgo=';
 const content=`#image: ${uri}\n#caption: Team photo\nFirst point\nSecond point`;
 const split=splitDesign(content);
 assert.deepEqual(split.design,[`#image: ${uri}`,'#caption: Team photo']);
 assert.equal(split.body,'First point\nSecond point');
 assert.deepEqual(splitDesign('plain only').design,[]);
 // The helper rewrites the prose: the person's image and caption survive.
 const merged=mergeDesign(content,['Tighter first point','Sharper second point']);
 assert.equal(merged,`#image: ${uri}\n#caption: Team photo\nTighter first point\nSharper second point`);
 // The helper sets its own caption/layout: its line wins, the image still survives.
 const recaptioned=mergeDesign(content,['#caption: New words','Body line']);
 assert.match(recaptioned,new RegExp('^#image: '));assert.ok(recaptioned.includes('#caption: New words'));assert.ok(!recaptioned.includes('Team photo'));
 // A returned "(attached)" marker is a placeholder, never written; a real https image URL is.
 assert.equal(mergeDesign(content,['#image: (attached)','Body']),`#image: ${uri}\n#caption: Team photo\nBody`);
 const linked=mergeDesign(content,['#image: https://example.invalid/pic.png','Body']);
 assert.ok(linked.includes('#image: https://example.invalid/pic.png'));assert.ok(!linked.includes(uri),'a person-given image URL replaces the stored image');
 assert.equal(mergeDesign('',['#image: (attached)','Only body']),'Only body','a new section never gets the placeholder');
});
