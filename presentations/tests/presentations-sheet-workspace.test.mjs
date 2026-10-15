/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Source-preserving spreadsheet transformations against the existing outline format. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSheet, editSheetCell, appendSheetDimension, columnLabel } from '../tools/sheet-workspace.mjs';

test('column addresses extend past Z and AA', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columnLabel), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('table header and Markdown separator survive targeted editing', () => {
  const sheet = { title: 'Budget', content: '  | Item | Value |\n| --- | ---: |\n  | Rent | 1500 |\n| Food | 400 |' };
  assert.deepEqual(readSheet(sheet).rows, [['Item', 'Value'], ['Rent', '1500'], ['Food', '400']]);
  const edited = editSheetCell(sheet, 2, 1, '=SUM(B2:B3)');
  assert.equal(edited.content, '  | Item | Value |\n| --- | ---: |\n  | Rent | 1500 |\n| Food | =SUM(B2:B3) |');
  assert.equal(sheet.content.includes('400'), true, 'input is immutable');
});

test('existing metric display syntax is preserved until its own cell is edited', () => {
  const section = { title: 'Income', content: 'Salary: $1.2M\nWork: 94%\nOther: 1,240' };
  assert.equal(readSheet(section).kind, 'series');
  assert.equal(editSheetCell(section, 2, 1, '96%').content, 'Salary: $1.2M\nWork: 96%\nOther: 1,240');
  const formula = editSheetCell(section, 1, 1, '=B3*2');
  assert.equal(readSheet(formula).kind, 'table');
  assert.deepEqual(readSheet(formula).rows, [['Label', 'Value'], ['Salary', '=B3*2'], ['Work', '94%'], ['Other', '1,240']]);
});

test('mixed prose, groups, directives, quotes and lone table rows stay in the source inspector', () => {
  for (const content of ['| A | B |', '| A | B |\n| 1 | 2 |\nA note', '## Sales\nQ1: 20', '> Quote: 10', '#layout: 12', '- Expense: 42', 'Margin :: 94%', 'Plain prose', `Huge: ${'9'.repeat(400)}`]) {
    const section = { title: 'Original', content };
    assert.equal(readSheet(section).kind, 'source', content);
    assert.throws(() => editSheetCell(section, 0, 0, 'changed'), /source inspector/);
    assert.equal(section.content, content);
  }
});

test('new and extended tables keep headers/data and do not drop irregular columns', () => {
  const empty = editSheetCell({ title: 'New', content: '' }, 3, 2, '9');
  assert.equal(readSheet(empty).rows[3][2], '9');
  const irregular = { title: 'Irregular', content: '| A | B |\n| 1 | 2 | 3 |' };
  const widened = appendSheetDimension(irregular, 'column');
  assert.deepEqual(readSheet(widened).rows, [['A', 'B', '', ''], ['1', '2', '3', '']]);
  assert.equal(appendSheetDimension(irregular, 'row').content, '| A | B |\n| 1 | 2 | 3 |\n|  |  |  |');
  assert.throws(() => editSheetCell(irregular, 1, 0, 'a|b'), /pipe/);
  assert.throws(() => editSheetCell(irregular, 1, 0, 'a\nb'), /line break/);
});

test('entered formula text survives the actual shipped outline parser without fake evaluation', () => {
  const html = readFileSync(new URL('../tools/presentations.html', import.meta.url), 'utf8');
  const actual = html.match(/function parseOutline\(text\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(actual, 'actual Office outline parser found');
  const parseOutline = Function(`${actual}; return parseOutline;`)();
  const sections = [editSheetCell({ title: 'Budget', content: '| Label | Value |\n| Income | 20 |' }, 1, 1, '=SUM(B2:B4)'), { title: 'Notes', content: '> Original quote\n## Group\nkept' }];
  assert.deepEqual(parseOutline(sections.map(section => `${section.title}\n${section.content}`).join('\n\n')), sections);
});


test('the shipped outline source profile preserves document paragraphs and refuses malformed or oversized structures',()=>{
 const html=readFileSync(new URL('../tools/presentations.html',import.meta.url),'utf8');
 const start=html.indexOf('function parseOutline('),end=html.indexOf('// ADR-043 item A:',start);
 const {parse,serialize}=Function(html.slice(start,end)+';return {parse:parseOutline,serialize:serializeOfficeSections};')();
 const sections=[{title:'Introduction',content:'  One  \n\nTwo\n\n\nThree'},{title:'Details',content:'Final line'}];
 assert.deepEqual(parse(serialize(sections)),sections);
 assert.equal(serialize([{title:'Legacy',content:'Exact line\nAnother'}]),'Legacy\nExact line\nAnother');
 const bad=[{format:'oshal-office-outline/2',sections}, {format:'oshal-office-outline/1',sections,owner:'forged'},
  {format:'oshal-office-outline/1',sections:[{title:'Title',content:'Content',extra:true}]},
  {format:'oshal-office-outline/1',sections:[{title:'Bad\nheading',content:'Content'}]},
  {format:'oshal-office-outline/1',sections:[{title:'Title',content:7}]},
  {format:'oshal-office-outline/1',sections:Array(101).fill({title:'Title',content:''})},
  {format:'oshal-office-outline/1',sections:[{title:'Title',content:'x'.repeat(262145)}]}];
 for(const value of bad)assert.deepEqual(parse(JSON.stringify(value)),[]);
 assert.deepEqual(parse('{"format":"oshal-office-outline/1",broken'),[]);
 assert.deepEqual(parse(JSON.stringify({format:'oshal-office-outline/1',sections})+' '.repeat(1048576)),[]);
});
