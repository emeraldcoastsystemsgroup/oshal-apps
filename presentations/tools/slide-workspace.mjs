/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Edit selected slides through the existing outline model with keyboard thumbnails and local draft history.
 */
function sectionsCopy(sections) {
  if (!Array.isArray(sections)) throw new TypeError('Slide sections must be an array.');
  return sections.map(section => {
    if (!section || typeof section.title !== 'string' || typeof section.content !== 'string') throw new TypeError('Slides require title and raw content strings.');
    return {title: section.title, content: section.content};
  });
}
/** Preserve the original outline delimiter and every existing raw content line. */
export function serializeSections(sections) {
  return sectionsCopy(sections).map(section => {
    if (!section.title.trim() || /[\r\n]/.test(section.title)) throw new TypeError('Each slide needs a single-line title.');
    if (/\n\s*\n/.test(section.content)) throw new TypeError('A blank line separates slides; use one line per text item.');
    return section.title + (section.content ? '\n' + section.content : '');
  }).join('\n\n');
}
function color(value) { return typeof value === 'string' && /^#?[a-f0-9]{6}$/i.test(value) ? '#' + value.replace(/^#/, '') : ''; }
function bulletLineIndexes(content) {
  const indexes = [];
  for (const [index, raw] of content.split('\n').entries()) {
    const line = raw.trim();
    if (!line || /^#(?!#)/.test(line)) continue;
    // Structured layouts keep their exact DSL in the selected-slide text editor.
    if (/^##\s|^\||^>|^(?:—|--|–)\s/.test(line) || line.includes('::') || /^.{1,60}?\s*:\s*[\d,.$%xkmbt\s-]+$/i.test(line)) return null;
    indexes.push(index);
  }
  return indexes;
}
/** Root owns the authoritative outline and actual Guide/export adapters.
 * This controller never fetches, stores a second graph, generates files or calls AI.
 */
export function createSlideWorkspace({host, readSections, writeSections, getTheme, renderDraft, onChange = () => {}}) {
  if (!host?.ownerDocument || [readSections, writeSections, getTheme, renderDraft, onChange].some(fn => typeof fn !== 'function')) throw new TypeError('Complete slide workspace adapters are required.');
  const document = host.ownerDocument;
  let sections = [], selected = -1, signature = '', initialized = false, writing = false, destroyed = false;
  let undo = [], redo = [], themeSignature = '';
  const removers = [];
  const element = (tag, className, text) => {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  const listen = (node, name, callback) => {node.addEventListener(name, callback); removers.push(() => node.removeEventListener(name, callback));};
  const status = element('div', 'office-slide-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const announce = message => {status.textContent = message;};
  const root = element('section', 'office-slide-workspace'); root.setAttribute('aria-label', 'Slide workspace');
  const toolbar = element('div', 'office-slide-toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Slide editing');
  const buttons = {};
  function button(name, label, callback) {
    const node = element('button', 'office-slide-button', label); node.type = 'button'; node.dataset.slideAction = name;
    listen(node, 'click', () => {try {callback();} catch (error) {announce(error.message);}}); toolbar.append(node); buttons[name] = node;
  }
  const layout = element('div', 'office-slide-layout');
  const rail = element('nav', 'office-slide-rail'); rail.setAttribute('aria-label', 'Slides');
  const center = element('div', 'office-slide-center');
  const heading = element('div', 'office-slide-heading');
  const counter = element('span', 'office-slide-counter'); counter.setAttribute('aria-live', 'polite');
  const note = element('span', 'office-slide-note', 'Themed draft · Generate creates the Office file'); heading.append(counter, note);
  const draft = element('div', 'office-slide-canvas'); draft.setAttribute('aria-label', 'Selected slide draft');
  const textEditor = element('details', 'office-slide-text-editor');
  const summary = element('summary', '', 'Edit selected slide text');
  const titleLabel = element('label', '', 'Slide title'), titleInput = element('input', 'office-slide-title-input'); titleInput.type = 'text'; titleInput.setAttribute('aria-label', 'Slide title'); titleLabel.append(titleInput);
  const contentLabel = element('label', '', 'Slide text'), contentInput = element('textarea', 'office-slide-content-input'); contentInput.setAttribute('aria-label', 'Slide text'); contentInput.rows = 6; contentLabel.append(contentInput);
  const syntaxNote = element('p', 'office-slide-note', 'One line per point. Tables, charts and layout directives stay in this slide.'); textEditor.append(summary, titleLabel, contentLabel, syntaxNote);
  center.append(heading, draft, textEditor); layout.append(rail, center); root.append(toolbar, layout, status); host.replaceChildren(root);
  const snapshot = () => ({sections: sectionsCopy(sections), selected});
  const selection = () => selected < 0 || !sections[selected] ? null : {kind: 'pptx', index: selected + 1, title: sections[selected].title};
  function adopt(incoming) {
    sections = sectionsCopy(incoming); signature = JSON.stringify(sections);
    selected = sections.length ? Math.max(0, Math.min(selected, sections.length - 1)) : -1;
  }
  function publish(next, nextSelection, reason, retainHistory = true) {
    if (destroyed) return;
    serializeSections(next); // Refuse ambiguous outline edits instead of losing text.
    const prior = snapshot(); writing = true;
    try {writeSections(sectionsCopy(next)); adopt(readSections()); selected = sections.length ? Math.max(0, Math.min(nextSelection, sections.length - 1)) : -1;}
    finally {writing = false;}
    if (retainHistory) {undo.push(prior); if (undo.length > 100) undo.shift(); redo = [];}
    paint(true); announce(reason + ' · unsaved draft'); onChange({reason, selection: selection()});
  }
  function mutate(reason, change) {const next = sectionsCopy(sections); const index = change(next); publish(next, index ?? selected, reason);}
  function history(backward) {
    const from = backward ? undo : redo, to = backward ? redo : undo;
    const entry = from.at(-1); if (!entry) return;
    const current = snapshot(); publish(entry.sections, entry.selected, backward ? 'Undo' : 'Redo', false); from.pop(); to.push(current); paint(true);
  }
  button('add', 'Add slide', () => mutate('Added slide', next => {const index = selected + 1; next.splice(index, 0, {title: 'New slide', content: ''}); return index;}));
  button('duplicate', 'Duplicate', () => mutate('Duplicated slide', next => {next.splice(selected + 1, 0, {...next[selected]}); return selected + 1;}));
  button('delete', 'Delete', () => mutate('Deleted slide', next => {next.splice(selected, 1); return Math.min(selected, next.length - 1);}));
  button('earlier', 'Move earlier', () => mutate('Moved slide earlier', next => {[next[selected - 1], next[selected]] = [next[selected], next[selected - 1]]; return selected - 1;}));
  button('later', 'Move later', () => mutate('Moved slide later', next => {[next[selected], next[selected + 1]] = [next[selected + 1], next[selected]]; return selected + 1;}));
  button('undo', 'Undo', () => history(true)); button('redo', 'Redo', () => history(false));
  button('text', 'Edit text', () => {textEditor.open = true; contentInput.focus();});
  function edit(field, value) {
    if (selected < 0) return;
    const next = sectionsCopy(sections); next[selected][field] = value;
    if (JSON.stringify(next) === signature) return;
    publish(next, selected, 'Edited slide ' + (selected + 1));
  }
  listen(titleInput, 'input', () => {try {edit('title', titleInput.value);} catch (error) {announce(error.message + ' Your last valid text is retained.');}});
  listen(contentInput, 'input', () => {try {edit('content', contentInput.value);} catch (error) {announce(error.message + ' Your last valid text is retained.');}});
  function choose(index, focus = false) {selected = index; paint(); announce('Selected slide ' + (index + 1)); onChange({reason: 'selection', selection: selection()}); if (focus) rail.querySelector('[aria-current="true"]')?.focus();}
  listen(rail, 'click', event => {const item = event.target.closest?.('[data-slide-index]'); if (item && rail.contains(item)) choose(Number(item.dataset.slideIndex));});
  listen(rail, 'keydown', event => {
    const current = event.target.closest?.('[data-slide-index]'); if (!current) return;
    const index = Number(current.dataset.slideIndex); let target;
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) target = Math.min(index + 1, sections.length - 1);
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) target = Math.max(index - 1, 0);
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = sections.length - 1;
    if (target !== undefined) {event.preventDefault(); choose(target, true);}
  });
  listen(draft, 'input', event => {
    const editable = event.target.closest?.('[data-slide-edit]'); if (!editable) return;
    try {
      if (editable.dataset.slideEdit === 'title') edit('title', editable.textContent);
      else {const lines = sections[selected].content.split('\n'); lines[Number(editable.dataset.slideLine)] = editable.textContent; edit('content', lines.join('\n'));}
    } catch (error) {announce(error.message + ' Your last valid text is retained.');}
  });
  listen(draft, 'keydown', event => {if (event.target.closest?.('[data-slide-edit]') && event.key === 'Enter') {event.preventDefault(); textEditor.open = true; contentInput.focus();}});
  listen(draft, 'focusout', () => queueMicrotask(() => {if (!draft.contains(document.activeElement)) paintDraft(sections[selected], false);}));
  function makeEditable(node, field, raw, line) {
    node.textContent = raw; node.contentEditable = 'plaintext-only'; node.dataset.slideEdit = field;
    if (line !== undefined) node.dataset.slideLine = String(line);
    node.setAttribute('role', 'textbox'); node.setAttribute('aria-label', field === 'title' ? 'Edit slide title on canvas' : 'Edit slide point ' + (line + 1)); node.setAttribute('spellcheck', 'true');
  }
  function paint(preserveEditing = false) {
    if (destroyed) return;
    const theme = getTheme(); const current = sections[selected];
    counter.textContent = current ? 'Slide ' + (selected + 1) + ' of ' + sections.length : 'No slides yet';
    rail.replaceChildren(...sections.map((section, index) => {
      const node = element('button', 'office-slide-thumbnail'); node.type = 'button'; node.dataset.slideIndex = String(index); node.tabIndex = selected === index ? 0 : -1;
      node.setAttribute('aria-current', String(index === selected)); node.setAttribute('aria-label', 'Slide ' + (index + 1) + ': ' + section.title);
      const miniature = element('span', 'office-slide-miniature'); miniature.style.background = color(theme?.colors?.canvas); miniature.style.color = color(theme?.colors?.ink);
      const title = element('strong', 'office-slide-mini-title', section.title); const lines = element('span', 'office-slide-mini-lines', section.content.split('\n').filter(Boolean).slice(0, 3).join('\n'));
      miniature.append(title, lines); node.append(element('span', 'office-slide-number', String(index + 1)), miniature); return node;
    }));
    for (const name of ['duplicate', 'delete', 'text']) buttons[name].disabled = !current;
    buttons.earlier.disabled = selected <= 0; buttons.later.disabled = selected < 0 || selected >= sections.length - 1;
    buttons.undo.disabled = !undo.length; buttons.redo.disabled = !redo.length;
    titleInput.disabled = contentInput.disabled = !current;
    if (!preserveEditing || document.activeElement !== titleInput) titleInput.value = current?.title ?? '';
    if (!preserveEditing || document.activeElement !== contentInput) contentInput.value = current?.content ?? '';
    paintDraft(current, preserveEditing);
  }
  function paintDraft(current, preserveEditing) {
    if (destroyed || (preserveEditing && draft.contains(document.activeElement))) return;
    if (!current) {draft.replaceChildren(element('div', 'office-slide-empty', 'Add a slide or ask your Guide to build a first draft.')); return;}
    try {
      // Trusted root adapter uses the original escaped draft renderer. This is
      // an approximate Office draft, never a renderer or OOXML fidelity claim.
      draft.innerHTML = String(renderDraft({...current}, selected + 1));
      const kick = draft.querySelector('.kick'); if (kick) kick.textContent = 'Slide ' + (selected + 1);
      const title = draft.querySelector('.ttl'); if (title) makeEditable(title, 'title', current.title);
      const indexes = bulletLineIndexes(current.content), bullets = draft.querySelectorAll('.body > ul > li');
      if (indexes && bullets.length === Math.min(indexes.length, 9)) for (const [index, bullet] of [...bullets].entries()) makeEditable(bullet, 'content', current.content.split('\n')[indexes[index]], indexes[index]);
    } catch {draft.replaceChildren(element('div', 'office-slide-empty', 'Draft look is unavailable. Edit this slide’s text and retry its theme.'));}
  }
  function refresh() {
    if (destroyed) return;
    const incoming = sectionsCopy(readSections()), nextSignature = JSON.stringify(incoming);
    if (initialized && !writing && nextSignature !== signature) {undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo = [];}
    const nextTheme = JSON.stringify(getTheme() ?? null), themeChanged = nextTheme !== themeSignature;
    const changed = nextSignature !== signature;
    themeSignature = nextTheme; adopt(incoming); initialized = true; paint((!changed || writing) && !themeChanged);
  }
  refresh();
  return {refresh, getSelection: selection, destroy() {if (destroyed) return; destroyed = true; for (const remove of removers) remove(); host.replaceChildren(); undo = []; redo = [];}};
}
