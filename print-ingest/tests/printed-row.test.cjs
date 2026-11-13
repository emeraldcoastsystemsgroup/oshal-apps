/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0 (T11): the page's own functions in a sandbox. A document that came from a printer says so: "Came from a printer", the computer it was printed to, the sending address, its pages, its size and when, as text (a hostile name is escaped), with a note when only the first 200,000 characters were kept; its meta line no longer says "unknown machine". Other documents are unchanged. Opening the full inbox (and a tab) takes the printed documents first and then lists; a failed take says they still wait. The company view names the computer a printed document came through, never its sending address.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = html.indexOf('{', html.indexOf(')', start)); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('never closed');
}
const sb = {};
vm.createContext(sb);
vm.runInContext(['esc', 'metaLine', 'sizeWords', 'printedLine'].map(extract).join('\n')
  + '\nglobalThis.t = { metaLine, sizeWords, printedLine };', sb);

const printedAt = '2026-11-12T04:00:00.000Z';
function printed(overrides = {}) {
  return { textChars: 1200, createdAt: printedAt, sidecar: { source: 'printer', printerName: 'Office PC', clientIp: '192.168.1.20', textPages: 3, bytes: 123456, receivedAt: printedAt, ...overrides } };
}

test('a printed document says it came from a printer, where it was printed to and from, its pages, size and time', () => {
  const line = sb.t.printedLine(printed());
  assert.match(line, /<span class="badge">Came from a printer<\/span>/);
  assert.match(line, /Printed to Office PC from 192\.168\.1\.20/);
  assert.match(line, / · 3 pages · 121 KB · /);
  assert.ok(line.includes(new Date(printedAt).toLocaleString()), 'when it was printed');
  assert.doesNotMatch(sb.t.metaLine(printed()), /unknown machine/, 'its meta line does not call it an unknown machine');
  assert.match(sb.t.printedLine(printed({ textPages: 1, bytes: 3 * 1048576 })), / · 1 page · 3\.0 MB · /);
  assert.match(sb.t.printedLine(printed({ truncated: true })), /only its first 200,000 characters were kept/);
});

test('every printed value is text: a hostile computer name is escaped', () => {
  const line = sb.t.printedLine(printed({ printerName: '<img src=x onerror=alert(1)>' }));
  assert.ok(!line.includes('<img'), line);
  assert.match(line, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a document from anywhere else is shown as before', () => {
  const sent = { textChars: 10, createdAt: printedAt, sidecar: { source: 'send-to' } };
  assert.equal(sb.t.printedLine(sent), '');
  assert.match(sb.t.metaLine(sent), /^unknown machine · 10 characters/);
});

test('the full inbox takes the printed documents before it lists, and says when they still wait', () => {
  const start = html.slice(html.indexOf('if (!window.AppView || !AppView.active()) {'));
  assert.match(start, /refresh\(\);\n\s*\}\);\n\s*\}\);\n\n\s*refresh\(\);\n\}/, 'the page and each tab refresh');
  assert.match(extract('refresh'), /collectPrinted\(\)\.catch\(\(\) => \{\}\)\.finally\(load\)/);
  const collect = extract('collectPrinted');
  assert.match(collect, /fetch\(API \+ '\/printed\/collect', \{\s*method: 'POST'/);
  assert.match(collect, /They wait in the swarm and are taken next time/);
  assert.match(html, /<p class="sub" id="printedNote" hidden><\/p>/);
});

test('the company view names the computer a printed document came through, never its sending address', () => {
  const block = html.slice(html.indexOf('<script src="/shared/ui/js/app-view.js"></script>'));
  const origin = block.slice(block.indexOf('function origin(doc)'), block.indexOf('// A pending document shows'));
  assert.match(origin, /if \(s\.source === 'printer'\) return 'Printed to ' \+ \(s\.printerName \|\| 'your computer'\);/);
  assert.doesNotMatch(origin, /clientIp/);
});
