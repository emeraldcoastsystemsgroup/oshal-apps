/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve selected saved packet identity, contact facts, grouped roles and month precision across genuine export models and professional style changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {validate} from '../../presentations/tools/office/model.mjs';
import {renderOffice} from '../../presentations/routes/office-editor/formats.mjs';

const require = createRequire(import.meta.url);
const models = () => require('../tools/career-export-model.js');
const Office = require('../tools/career-resume-office.js');
const source = fs.readFileSync(new URL('../routes/career-resume-studio-routes.js', import.meta.url), 'utf8');
const reader = source.match(/async function readDoc\(dir\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(reader, 'actual canonically compiled packet reader is present');
const read = vm.runInNewContext('(' + reader + ')', {fs_1: {promises: fs.promises}, path,
  require: createRequire(new URL('../routes/career-resume-studio-routes.js', import.meta.url))});
const text = model => model.pages.flatMap(page => page.blocks).flatMap(block =>
  block.runs?.map(run => run.text) || block.rows?.flatMap(row => row.flatMap(cell => cell.map(run => run.text))) || []);
const packet = () => ({resume: {headline: 'Recorded platform lead', summary: 'Recorded summary.',
  experience: [{id: 'parent', title: 'Consultant', org: 'Employer', span: 'Jan 2020 – Present', bullets: ['Parent fact.']},
    {id: 'child', parent_role_id: 'parent', title: 'Lead', org: 'Client', span: 'Mar 2021 – Apr 2022', bullets: ['Client fact.']}],
  skills: ['Recorded skill'], open_source: [{title: 'Maintainer', org: 'Project', span: 'Jun 2019 – Dec 2019', bullets: ['Open project fact.']}]},
  cover: {greeting: 'Dear team,', paragraphs: ['Recorded cover paragraph.'], closing: 'Regards,'},
  meta: {name: 'Packet Candidate', company: 'Selected Employer', title: 'Selected Role', contact: {name: 'Packet Candidate', email: 'packet@example.test'}}});

function runtime() {
  let root = process.env.STORE_CI_TOOLCHAIN || new URL('../../scripts/toolchain/', import.meta.url).pathname;
  if (path.basename(root) === 'node_modules') root = path.dirname(root);
  const actual = createRequire(path.join(root, 'package.json'));
  return {Pptx: actual('pptxgenjs'), word: actual('docx'), Excel: actual('exceljs'), Zip: actual('jszip')};
}

function pdfText(bytes) {
  const streams = [], source = bytes.toString('latin1');
  for (const match of source.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    streams.push([...match[1].matchAll(/\(([^)]*)\) Tj/g)].map(part => part[1]).join(' '));
  }
  return streams.join('\n').replace(/\s+/g, ' ');
}

test('stored packet contact comes only from the same original snapshot without changing generated content', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-export-contact-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const original = {posting_id: 225, profile_snapshot: {profile: {name: 'Original Candidate', email: 'original@example.test',
    phone: '555-0100', location: 'Original City', password: 'not exposed', linkedin: {invalid: true}}},
  generated: {resume: packet().resume, cover: packet().cover}};
  const file = path.join(dir, 'application.json'), serialized = JSON.stringify(original);
  fs.writeFileSync(file, serialized);
  const result = await read(dir);
  assert.ok(result.meta.contact && typeof result.meta.contact === 'object', 'saved packet contact is available without looking up a different current profile');
  assert.deepEqual(JSON.parse(JSON.stringify(result.meta.contact)), {name: 'Original Candidate', email: 'original@example.test', phone: '555-0100', location: 'Original City'});
  assert.deepEqual(JSON.parse(JSON.stringify(result.resume)), original.generated.resume);
  assert.equal(fs.readFileSync(file, 'utf8'), serialized, 'reading for export never rewrites the packet');
});

test('unrecorded and malformed packet contact stays unknown rather than borrowing current identity', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-export-unknown-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const profile_snapshot of [undefined, {profile: {email: {}, phone: false, location: 'x'.repeat(4097), name: ''}}]) {
    fs.writeFileSync(path.join(dir, 'application.json'), JSON.stringify({posting_id: 225, generated: {resume: {}, cover: {}}, profile_snapshot}));
    const result = await read(dir);
    assert.deepEqual(JSON.parse(JSON.stringify(result.meta.contact)), {});
  }
});

test('professional styling retains all saved manual Office text and stable role identities', () => {
  const source = Office.resumeToModel(packet().resume, packet().meta);
  source.pages[0].blocks.push({...source.pages[0].blocks[0], id: 'manual', runs: [{...source.pages[0].blocks[0].runs[0], text: 'Manually edited sentence.'}]});
  const before = structuredClone(source), styled = models().styled(source, 'professional');
  assert.deepEqual(source, before, 'no mutation of saved source');
  assert.deepEqual(text(styled), text(source));
  assert.deepEqual(styled.pages.flatMap(page => page.blocks.map(block => block.id)), source.pages.flatMap(page => page.blocks.map(block => block.id)));
  assert.equal(styled.pages[0].blocks[0].runs[0].style.fontFamily, 'Georgia');
  assert.doesNotThrow(() => validate(styled));
});

test('packet and cover models preserve their selected facts, dates and grouping without the current profile', () => {
  const saved = packet(), before = structuredClone(saved);
  const model = models().fromPacket(saved, 'resume', 'ats');
  assert.doesNotThrow(() => validate(model));
  const words = text(model);
  for (const expected of ['Packet Candidate', 'packet@example.test', 'Jan 2020 – Present', 'Mar 2021 – Apr 2022',
    'Parent fact.', 'Client fact.', 'Open project fact.', 'Jun 2019 – Dec 2019']) assert.ok(words.some(value => value.includes(expected)), expected);
  assert.ok(words.indexOf('Consultant — Employer') < words.indexOf('Lead — Client'));
  const cover = models().fromPacket(saved, 'cover', 'ats');
  assert.doesNotThrow(() => validate(cover));
  for (const expected of ['Recorded cover paragraph.', 'Dear team,', 'Regards,', 'Selected Employer', 'Selected Role']) assert.ok(text(cover).some(value => value.includes(expected)), expected);
  assert.deepEqual(saved, before);
});

test('missing and malformed saved content refuses instead of inventing a blank or coerced document', () => {
  for (const resume of [null, {}, {headline: {}}, {skills: ['Recorded', {unknown: true}]}, {experience: [{title: {unknown: true}}]}]) {
    assert.throws(() => models().fromPacket({resume, meta: {}}, 'resume'), /no résumé|unreadable/);
  }
  for (const cover of [null, {}, {paragraphs: []}, {paragraphs: ['Recorded', {}]}]) {
    assert.throws(() => models().fromPacket({cover, meta: {}}, 'cover'), /no generated cover/);
  }
});

test('real Word, PDF and RTF bytes carry selected packet and cover facts with recorded months', async () => {
  const libraries = runtime();
  for (const kind of ['resume', 'cover']) {
    const source = packet(), model = models().fromPacket(source, kind, 'ats');
    const expected = kind === 'resume' ? ['Jan 2020', 'Mar 2021', 'Apr 2022', 'Client fact.', 'packet@example.test']
      : ['Recorded cover paragraph.', 'Packet Candidate', 'Selected Employer', 'Selected Role'];
    const docx = await renderOffice(model, 'docx', libraries), zip = await libraries.Zip.loadAsync(docx);
    const xml = await zip.file('word/document.xml').async('string');
    const pdf = await renderOffice(model, 'pdf', libraries), rtf = await renderOffice(model, 'rtf', libraries);
    assert.ok(pdf.subarray(0, 8).toString().startsWith('%PDF-'));
    assert.ok(rtf.subarray(0, 8).toString().startsWith('{\\rtf1'));
    for (const value of expected) {
      assert.ok(xml.includes(value), 'actual DOCX: ' + value);
      assert.ok(pdfText(pdf).includes(value), 'actual PDF: ' + value);
      assert.ok(rtf.toString('ascii').includes(value), 'actual RTF: ' + value);
    }
  }
});

test('professional Word and PDF render saved manual text rather than rebuilding it from the profile', async () => {
  const saved = Office.resumeToModel(packet().resume, packet().meta);
  const summary = saved.pages[0].blocks.find(block => block.runs?.[0]?.text === 'Recorded summary.');
  summary.runs[0].text = 'Manual sentence saved only in the Office document.';
  const model = models().styled(saved, 'professional'), libraries = runtime();
  const docx = await renderOffice(model, 'docx', libraries), zip = await libraries.Zip.loadAsync(docx);
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes(summary.runs[0].text));
  assert.ok(pdfText(await renderOffice(model, 'pdf', libraries)).includes(summary.runs[0].text));
  assert.ok(!xml.includes('Recorded summary.'), 'the old profile summary is not substituted');
});
