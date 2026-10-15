/**
 * Spreadsheet workspace over the shared Office outline; no separate workbook state.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Editable outline-backed sheets with source preservation and truthful formula text.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve history through synchronous parent refresh during authoritative writes.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep pending input and focus through unchanged theme/layout refreshes, including empty initial drafts.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Commit pending cells before selection or handoff and retain invalid/source drafts for explicit correction or discard.
 */

const RULE = /^\|[\s:|-]+\|?$/;
const metric = value => {
  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?[%x]?$/i.exec(String(value).trim().replace(/[,$\s]/g, ''));
  return Boolean(match && Number.isFinite(Number(match[1])));
};
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(value => value.trim());
const tableLine = row => `| ${row.join(' | ')} |`;
const copy = sections => sections.map(section => ({ ...section }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function columnLabel(index) {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

/** Only pure supported bodies enter the grid. Mixed structured content stays intact. */
export function readSheet(section) {
  const lines = String(section?.content ?? '').split(/\r?\n/);
  const live = lines.map((line, index) => ({ line, index })).filter(item => item.line.trim());
  if (!live.length) return { kind: 'table', rows: [], lines, indices: [] };
  if (live.every(item => item.line.trim().startsWith('|'))) {
    const data = live.filter(item => !(RULE.test(item.line.trim()) && item.line.includes('-')));
    if (data.length >= 2) return { kind: 'table', rows: data.map(item => cells(item.line)), lines, indices: data.map(item => item.index) };
  }
  const series = live.map(item => /^(.{1,60}?)\s*:\s*(.+)$/.exec(item.line.trim()));
  if (series.every(match => match && match[1].trim() && !match[1].includes('::') && !/^(?:[#>*•]|-\s)/.test(match[1].trim()) && metric(match[2]))) {
    return { kind: 'series', rows: [['Label', 'Value'], ...series.map(match => [match[1].trim(), match[2].trim()])], lines, indices: live.map(item => item.index) };
  }
  return { kind: 'source', rows: [], lines, indices: [], reason: 'This section contains notes or structured content. Edit its original source below; grid conversion would change its meaning.' };
}

function validCell(value) {
  if (/[|\r\n]/.test(value)) throw new Error('Cells cannot contain a pipe or line break in the current outline format. Use the source inspector for structured content.');
}

/** Rewrite only the edited table row or series line; every unrelated source line survives. */
export function editSheetCell(section, row, column, value) {
  value = String(value);
  validCell(value);
  const parsed = readSheet(section);
  if (parsed.kind === 'source') throw new Error('Edit this section in the source inspector.');
  const rows = parsed.rows.map(item => [...item]);
  const width = Math.max(2, column + 1, ...rows.map(item => item.length));
  while (rows.length <= Math.max(row, 1)) rows.push(Array(width).fill(''));
  while (rows[row].length <= column) rows[row].push('');
  rows[row][column] = value;
  // A formula or text in a series Value cannot survive the numeric-series parser.
  // Convert explicitly to a table rather than silently exporting it as a note.
  if (parsed.kind === 'series' && row > 0 && column < 2 && rows[row][0].length > 0 && rows[row][0].length <= 60 && !/[:#]/.test(rows[row][0]) && metric(rows[row][1])) {
    const lines = [...parsed.lines];
    lines[parsed.indices[row - 1]] = `${rows[row][0]}: ${rows[row][1]}`;
    return { ...section, content: lines.join('\n') };
  }
  if (parsed.kind === 'table' && parsed.rows.length) {
    const lines = [...parsed.lines];
    if (row < parsed.indices.length) lines[parsed.indices[row]] = tableLine(rows[row]);
    else for (let i = parsed.indices.length; i < rows.length; i++) lines.push(tableLine(rows[i]));
    return { ...section, content: lines.join('\n') };
  }
  return { ...section, content: rows.map(tableLine).join('\n') };
}

export function appendSheetDimension(section, dimension) {
  const parsed = readSheet(section);
  if (parsed.kind === 'source') throw new Error('Add rows or columns in the original source for this section.');
  const rows = parsed.rows.map(row => [...row]);
  const width = Math.max(2, ...rows.map(row => row.length));
  if (!rows.length) rows.push(Array(width).fill(''), Array(width).fill(''));
  if (dimension === 'row') rows.push(Array(width).fill(''));
  else for (const row of rows) { while (row.length < width) row.push(''); row.push(''); }
  if (dimension === 'row' && parsed.kind === 'table' && parsed.rows.length) return { ...section, content: `${section.content}\n${tableLine(rows.at(-1))}` };
  return { ...section, content: rows.map(tableLine).join('\n') };
}

/** Adapters are synchronous and authoritative; refresh retires history after external edits. */
export function createSheetWorkspace({ host, readSections, writeSections, onChange = () => {} }) {
  if (!host || typeof readSections !== 'function' || typeof writeSections !== 'function') throw new TypeError('A host and outline adapters are required.');
  const doc = host.ownerDocument;
  let sections = [], selected = 0, row = 0, column = 0, rowPage = 0, columnPage = 0;
  let undo = [], redo = [], dead = false, writing = false, rendered = false;
  const root = doc.createElement('section'); root.className = 'sheet-workspace'; root.setAttribute('aria-label', 'Spreadsheet workspace');
  host.append(root);
  const node = (tag, className, text) => { const item = doc.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const toolbar = node('div', 'sheet-toolbar');
  const tabs = node('div', 'sheet-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sheets');
  const titleInput = node('input', 'sheet-title'); titleInput.setAttribute('aria-label', 'Sheet name'); titleInput.maxLength = 200;
  const status = node('p', 'sheet-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-label', 'Sheet edit status'); status.setAttribute('aria-live', 'polite');
  const formula = node('form', 'sheet-formula');
  const address = node('output', 'sheet-address', 'A1'); address.setAttribute('aria-label', 'Selected cell');
  const editor = node('input', 'sheet-value'); editor.setAttribute('aria-label', 'Cell value or formula text'); editor.autocomplete = 'off';
  const apply = node('button', '', 'Apply'); apply.type = 'submit';
  formula.append(address, node('span', 'sheet-fx', 'fx'), editor, apply);
  const notice = node('p', 'sheet-notice', 'Formulas are saved as text. This workspace does not calculate them. The XLSX exporter adds a live SUM total for numeric Label: Value sections.');
  const scroll = node('div', 'sheet-grid-scroll');
  const paging = node('div', 'sheet-paging');
  const sourceBox = node('details', 'sheet-source'); sourceBox.append(node('summary', '', 'Source inspector'));
  const source = node('textarea'); source.setAttribute('aria-label', 'Original sheet source'); source.spellcheck = false;
  const saveSource = node('button', '', 'Apply source'); saveSource.type = 'button'; sourceBox.append(source, saveSource);
  root.append(toolbar, tabs, formula, notice, status, scroll, paging, sourceBox);
  const getSelection = () => sections[selected] ? { kind: 'xlsx', index: selected + 1, title: sections[selected].title, cell: `${columnLabel(column)}${row + 1}` } : null;
  const announce = text => { status.textContent = text; };
  function notify() { onChange(getSelection()); }
  function read() { const result = readSections(); if (!Array.isArray(result)) throw new TypeError('readSections must return sections.'); return copy(result); }
  function write(next) {
    writing = true;
    try { writeSections(copy(next)); } finally { writing = false; }
    return read();
  }
  function current() {
    if (!same(read(), sections)) { refresh(); announce('The outline changed elsewhere. Select a cell again before editing.'); return false; }
    return true;
  }
  function publish(next, message = 'Draft updated.') {
    if (!current()) return false;
    if (same(next, sections)) return true;
    const before = copy(sections);
    try { sections = write(next); }
    catch (error) { announce(error.message || 'The draft could not be updated.'); return false; }
    undo.push(before); if (undo.length > 100) undo.shift(); redo = [];
    selected = Math.min(selected, Math.max(0, sections.length - 1)); render(); announce(message); notify();
    return true;
  }
  function sourcePending() {
    return sections[selected] && source.value !== sections[selected].content;
  }
  function settlePending() {
    if (sourcePending()) {
      announce('Apply the source draft before switching, or press Escape in the source inspector to discard it.');
      sourceBox.open = true; source.focus(); return false;
    }
    const parsed = readSheet(sections[selected]);
    const value = parsed.rows[row]?.[column] ?? '';
    return !sections[selected] || parsed.kind === 'source' || editor.value === value || commitCell();
  }
  const action = (label, run) => {
    const button = node('button', '', label); button.type = 'button'; button.addEventListener('click', () => {
      try { if (settlePending()) run(); } catch (error) { announce(error.message); }
    }); return button;
  };
  const uniqueTitle = base => { let title = base; for (let i = 2; sections.some(section => section.title === title); i++) title = `${base} (${i})`; return title; };
  toolbar.append(action('Add sheet', () => {
    const next = [...sections, { title: uniqueTitle('Sheet'), content: '| Column A | Column B |\n|  |  |' }];
    publish(next); selected = sections.length - 1; row = column = rowPage = columnPage = 0; render(); notify();
  }), titleInput, action('Rename', () => {
    const title = titleInput.value.trim(); if (!title || /[\r\n]/.test(title)) throw new Error('Enter a sheet name on one line.');
    if (sections[selected]) publish(sections.map((section, index) => index === selected ? { ...section, title } : section));
  }), action('Duplicate', () => {
    if (!sections[selected]) return;
    const next = copy(sections); next.splice(selected + 1, 0, { ...sections[selected], title: uniqueTitle(`${sections[selected].title} copy`) });
    publish(next); selected++; render(); notify();
  }), action('Remove', () => { if (sections[selected]) publish(sections.filter((_, index) => index !== selected), 'Sheet removed. Undo restores it.'); }));
  const undoButton = action('Undo', () => history(false)), redoButton = action('Redo', () => history(true));
  toolbar.append(undoButton, redoButton,
    action('Add row', () => changeDimension('row')), action('Add column', () => changeDimension('column')));
  function history(forward) {
    if (!current()) return;
    const from = forward ? redo : undo, to = forward ? undo : redo;
    if (!from.length) return;
    const next = from.at(-1), before = copy(sections), updated = write(next);
    from.pop(); to.push(before); sections = updated; render(); notify(); announce(forward ? 'Change restored.' : 'Change undone.');
    scroll.querySelector('[tabindex="0"]')?.focus();
  }
  function changeDimension(dimension) {
    if (!sections[selected]) return;
    const next = copy(sections); next[selected] = appendSheetDimension(next[selected], dimension); publish(next);
  }
  function selectCell(r, c, focus = false) {
    if (r === row && c === column && editor.value !== (readSheet(sections[selected]).rows[row]?.[column] ?? '')) {
      if (focus) scroll.querySelector('[tabindex="0"]')?.focus();
      return true;
    }
    if ((r !== row || c !== column) && !settlePending()) return false;
    row = Math.max(0, r); column = Math.max(0, c);
    const nextRowPage = Math.floor(row / 50) * 50, nextColumnPage = Math.floor(column / 26) * 26;
    const existing = scroll.querySelector(`[data-row="${row}"][data-column="${column}"]`);
    if (existing && rowPage === nextRowPage && columnPage === nextColumnPage) {
      for (const cell of scroll.querySelectorAll('[role="gridcell"]')) {
        const active = cell === existing; cell.tabIndex = active ? 0 : -1; cell.setAttribute('aria-selected', String(active));
      }
      address.value = `${columnLabel(column)}${row + 1}`;
      editor.value = readSheet(sections[selected]).rows[row]?.[column] ?? '';
    } else { rowPage = nextRowPage; columnPage = nextColumnPage; render(); }
    notify();
    if (focus) scroll.querySelector(`[data-row="${row}"][data-column="${column}"]`)?.focus();
    return true;
  }
  function commitCell() {
    if (!sections[selected]) return false;
    try {
      const prior = readSheet(sections[selected]).kind;
      const next = copy(sections); next[selected] = editSheetCell(next[selected], row, column, editor.value);
      if (sourcePending()) { announce('Apply or discard the source draft before changing a cell.'); return false; }
      return publish(next, prior === 'series' && readSheet(next[selected]).kind === 'table' ? 'Converted this numeric series to a table to preserve the entered text.' : 'Cell updated.');
    } catch (error) { announce(error.message); return false; }
  }
  formula.addEventListener('submit', event => { event.preventDefault(); commitCell(); });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); render(); scroll.querySelector('[tabindex="0"]')?.focus(); }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); if (commitCell()) selectCell(row + (event.key === 'Enter' ? 1 : 0), column + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0), true);
    }
  });
  saveSource.addEventListener('click', () => {
    if (!sections[selected]) return;
    if (/\n\s*\n/.test(source.value)) { announce('A blank line starts another section in the outline. Use the document source editor to split sheets.'); return; }
    publish(sections.map((section, index) => index === selected ? { ...section, content: source.value } : section));
  });
  source.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); source.value = sections[selected]?.content ?? ''; announce('Source draft discarded.'); }
  });
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      event.preventDefault(); history(event.shiftKey);
    }
  });
  function render() {
    if (dead || writing) return;
    rendered = true;
    tabs.replaceChildren(); scroll.replaceChildren(); paging.replaceChildren();
    selected = Math.max(0, Math.min(selected, sections.length - 1));
    for (const [index, section] of sections.entries()) {
      const tab = action(section.title || `Sheet ${index + 1}`, () => { selected = index; row = column = rowPage = columnPage = 0; render(); notify(); });
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === selected));
      tab.tabIndex = index === selected ? 0 : -1;
      tab.addEventListener('keydown', event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); if (!settlePending()) return; selected = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
          row = column = rowPage = columnPage = 0; render(); tabs.children[selected]?.focus(); notify();
        }
      }); tabs.append(tab);
    }
    undoButton.disabled = !undo.length; redoButton.disabled = !redo.length;
    const section = sections[selected]; titleInput.value = section?.title ?? ''; source.value = section?.content ?? '';
    titleInput.disabled = !section; saveSource.disabled = !section;
    if (!section) { formula.hidden = true; scroll.append(node('p', 'sheet-empty', 'Add a sheet to begin.')); return; }
    const parsed = readSheet(section); formula.hidden = parsed.kind === 'source';
    sourceBox.open = parsed.kind === 'source';
    if (parsed.kind === 'source') { scroll.append(node('p', 'sheet-fallback', parsed.reason)); return; }
    const rows = Math.max(12, parsed.rows.length, row + 1), columns = Math.max(8, column + 1, ...parsed.rows.map(item => item.length));
    address.value = `${columnLabel(column)}${row + 1}`; editor.value = parsed.rows[row]?.[column] ?? '';
    const grid = node('table', 'sheet-grid'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', `${section.title} cells`); grid.setAttribute('aria-rowcount', String(rows)); grid.setAttribute('aria-colcount', String(columns));
    const header = node('tr'); header.append(node('th', 'sheet-corner', ''));
    for (let c = columnPage; c < Math.min(columns, columnPage + 26); c++) { const th = node('th', '', columnLabel(c)); th.scope = 'col'; header.append(th); }
    const head = node('thead'); head.append(header); grid.append(head);
    const body = node('tbody');
    for (let r = rowPage; r < Math.min(rows, rowPage + 50); r++) {
      const line = node('tr'); const number = node('th', '', String(r + 1)); number.scope = 'row'; line.append(number);
      for (let c = columnPage; c < Math.min(columns, columnPage + 26); c++) {
        const cell = node('td', r === 0 ? 'sheet-header-cell' : '', parsed.rows[r]?.[c] ?? '');
        cell.dataset.row = r; cell.dataset.column = c; cell.tabIndex = r === row && c === column ? 0 : -1;
        cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', `${columnLabel(c)}${r + 1}`); cell.setAttribute('aria-selected', String(r === row && c === column));
        cell.addEventListener('click', () => selectCell(r, c, true));
        cell.addEventListener('dblclick', () => { selectCell(r, c); editor.focus(); editor.select(); });
        cell.addEventListener('keydown', event => {
          const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, event.shiftKey ? -1 : 1] };
          if (moves[event.key]) { event.preventDefault(); const [dr, dc] = moves[event.key]; selectCell(r + dr, c + dc, true); }
          else if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); editor.focus(); editor.select(); }
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); editor.focus(); editor.value = event.key; }
        }); line.append(cell);
      } body.append(line);
    }
    grid.append(body); scroll.append(grid);
    if (rows > 50 || columns > 26) {
      const previousRows = action('Previous rows', () => selectCell(Math.max(0, rowPage - 50), column, true)); previousRows.disabled = rowPage === 0;
      const nextRows = action('Next rows', () => selectCell(rowPage + 50, column, true)); nextRows.disabled = rowPage + 50 >= rows;
      const previousColumns = action('Previous columns', () => selectCell(row, Math.max(0, columnPage - 26), true)); previousColumns.disabled = columnPage === 0;
      const nextColumns = action('Next columns', () => selectCell(row, columnPage + 26, true)); nextColumns.disabled = columnPage + 26 >= columns;
      paging.append(previousRows, nextRows, previousColumns, nextColumns, node('span', '', `Rows ${rowPage + 1}–${Math.min(rows, rowPage + 50)} of ${rows}; columns ${columnLabel(columnPage)}–${columnLabel(Math.min(columns, columnPage + 26) - 1)}`));
    }
  }
  function refresh() {
    if (dead || writing) return;
    const next = read(), changed = !same(next, sections);
    if (!changed && rendered) return;
    if (changed) { sections = next; undo = []; redo = []; }
    render();
  }
  refresh();
  return { refresh, getSelection, commitPending: settlePending, destroy() { dead = true; root.remove(); sections = []; undo = []; redo = []; } };
}
