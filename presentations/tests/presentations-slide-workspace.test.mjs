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
