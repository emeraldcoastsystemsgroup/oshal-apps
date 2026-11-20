/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Inline direct editing for tailored job résumés, cover letters, and classic fallback previews on My résumé: plaintext-safe contenteditable fields, add/remove controls for competencies, bullets, qualifications, and cover paragraphs, story-link preservation, and immediate Save activation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add unmistakable direct-editing toolbar (#tailoredBar) with active editing pill, snapshot-backed Undo/Redo (buttons + Ctrl/Cmd+Z / Shift+Z / Y), section quick-jump buttons (Summary, Experience, Skills, Cover letter), subtle resting editable outlines, click-to-focus row ergonomics, and reset() for clean master-to-tailored transitions.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'career-tailored-editor-css';
  var MAX_HISTORY = 50;
  var BURST_MS = 450;
  var histories = typeof WeakMap === 'function' ? new WeakMap() : null;

  var CSS = [
    '#tailoredBar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 10px;max-width:760px;margin:0 auto 10px;padding:8px 12px;border:1px solid #d5dfe9;border-radius:10px;background:#ffffff;color:#0f1b2d;box-shadow:0 1px 3px rgba(15,27,45,.06);}',
    '#tailoredBar[hidden],body[data-view="office"] #tailoredBar,body:not([data-resume="ready"]) #tailoredBar{display:none!important;}',
    '#tailoredBar .cte-bar-group{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}',
    '#tailoredBar .cte-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:#e6f2f5;color:#0f5f73;font:700 12px/1.2 system-ui;letter-spacing:.01em;white-space:nowrap;}',
    '#tailoredBar .cte-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:34px;padding:4px 10px;border:1px solid #cbd6e2;border-radius:8px;background:#f8fafc;color:#0f1b2d;font:600 12px/1.2 system-ui;cursor:pointer;}',
    '#tailoredBar .cte-btn:hover:not(:disabled),#tailoredBar .cte-btn:focus-visible:not(:disabled){background:#e6f2f5;border-color:#0f5f73;color:#0f5f73;outline:none;}',
    '#tailoredBar .cte-btn:disabled{opacity:.42;cursor:default;}',
    '#tailoredBar .cte-jump{background:#ffffff;color:#334155;}',
    '#sheet [contenteditable="true"]{border-radius:4px;outline:1px solid rgba(15,95,115,.14);outline-offset:2px;transition:outline-color 120ms ease,background-color 120ms ease;cursor:text;min-width:1ch;}',
    '#sheet [contenteditable="true"]:hover{outline:1px dashed rgba(15,95,115,.52);outline-offset:2px;background:rgba(15,95,115,.035);}',
    '#sheet [contenteditable="true"]:focus{outline:2px solid #0f5f73;outline-offset:2px;background:rgba(15,95,115,.06);}',
    '#sheet .cte-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;}',
    '#sheet .cte-item{position:relative;padding-right:26px;cursor:text;}',
    '#sheet .cte-item>.cte-text{display:inline-block;min-width:4ch;max-width:100%;vertical-align:top;}',
    '#sheet .cte-rm{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;min-height:22px;padding:0;margin-left:3px;border:1px solid transparent;border-radius:999px;background:transparent;color:#5b6b80;font:700 14px/1 system-ui;cursor:pointer;opacity:.6;vertical-align:middle;}',
    '#sheet .cte-item>.cte-rm{position:absolute;right:0;top:0;}',
    '#sheet .cte-rm:hover,#sheet .cte-rm:focus-visible{opacity:1;color:#b42318;background:#fef3f2;border-color:#fecdca;outline:none;}',
    '#sheet .cte-add{display:inline-flex;align-items:center;gap:4px;min-height:30px;margin:6px 0 2px;padding:4px 10px;border:1px dashed #9fb3c4;border-radius:999px;background:#f7f9fc;color:#0f5f73;font:600 12px/1.2 system-ui;cursor:pointer;opacity:.88;}',
    '#sheet .cte-add:hover,#sheet .cte-add:focus-visible{opacity:1;background:#e6f2f5;border-color:#0f5f73;outline:none;}',
    '#sheet .comp .cte-add{margin:0;}',
    '#sheet .cover-preview .cte-cover-row{position:relative;padding-right:26px;cursor:text;}',
    '#sheet .cover-preview .cte-cover-row>p{margin:0 0 10px;}',
    '#sheet .cover-preview .cte-cover-row>.cte-rm{position:absolute;right:0;top:0;}',
    '@media (pointer:coarse),(max-width:720px){#tailoredBar .cte-btn{min-height:38px;}#sheet .cte-rm{opacity:.9;width:26px;height:26px;min-height:26px;}#sheet .cte-item,#sheet .cover-preview .cte-cover-row{padding-right:30px;}}',
    '@media print{#tailoredBar,#sheet [data-editor-control]{display:none!important;}#sheet [contenteditable="true"]{outline:none!important;background:transparent!important;}}'
  ].join('\n');

  /** @description Deep-clone resume and cover state into a detached snapshot. */
  function snapshot(state) {
    return JSON.parse(JSON.stringify({ resume: state.resume || {}, cover: state.cover || {} }));
  }

  /** @description Normalize plain text read from a contenteditable node. */
  function cleanText(el, singleLine) {
    var raw = String((el && el.textContent) || '').replace(/\u00a0/g, ' ');
    return singleLine ? raw.replace(/\s+/g, ' ').trim() : raw.replace(/\r\n/g, '\n').trim();
  }

  /** @description Split a skills line on middle dots or commas into trimmed non-empty tokens. */
  function parseSkills(text) {
    return String(text || '').split(/\s*[·,]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** @description Return roles in the exact order renderPreview() renders their .exp blocks. */
  function orderedRoles(list) {
    var items = Array.isArray(list) ? list : [];
    if (root && root.CareerRoleHierarchy && typeof root.CareerRoleHierarchy.ordered === 'function') {
      return root.CareerRoleHierarchy.ordered(items).map(function (row) { return row.role; });
    }
    return items.slice();
  }

  /** @description Inject inline editor styling once into the host document head. */
  function injectStyles(doc) {
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  /** @description Retrieve or create the per-sheet history controller. */
  function getHistory(sheet) {
    if (!histories) return null;
    var entry = histories.get(sheet);
    if (!entry) {
      entry = { past: [], future: [], current: null, burst: false, timer: null, state: null, onRestore: null, bar: null };
      histories.set(sheet, entry);
    }
    return entry;
  }

  /** @description Sync Undo and Redo button disabled state on the toolbar. */
  function syncBarButtons(hist) {
    if (!hist || !hist.bar) return;
    var undoBtn = hist.bar.querySelector('[data-editor-action="undo"]');
    var redoBtn = hist.bar.querySelector('[data-editor-action="redo"]');
    if (undoBtn) undoBtn.disabled = hist.past.length === 0;
    if (redoBtn) redoBtn.disabled = hist.future.length === 0;
  }

  /** @description Push a snapshot onto past, bounded to MAX_HISTORY entries. */
  function pushPast(hist, snap) {
    if (!hist || !snap) return;
    hist.past.push(snap);
    if (hist.past.length > MAX_HISTORY) hist.past.shift();
    hist.future = [];
  }

  /** @description Record the start of a typing burst so Undo works immediately without waiting for blur. */
  function noteTyping(hist) {
    if (!hist || !hist.state) return;
    if (!hist.burst) {
      pushPast(hist, hist.current || snapshot(hist.state));
      hist.burst = true;
      syncBarButtons(hist);
    }
    if (hist.timer) clearTimeout(hist.timer);
    hist.timer = setTimeout(function () { flushBurst(hist); }, BURST_MS);
  }

  /** @description Close an active typing burst and capture the settled state as the next baseline. */
  function flushBurst(hist) {
    if (!hist) return;
    if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; }
    if (hist.burst && hist.state) {
      hist.current = snapshot(hist.state);
      hist.burst = false;
      syncBarButtons(hist);
    }
  }

  /** @description Record an atomic structural mutation (remove/add) around `mutate()`. */
  function recordAtomic(hist, mutate) {
    if (!hist || !hist.state) { mutate(); return; }
    flushBurst(hist);
    var before = hist.current || snapshot(hist.state);
    mutate();
    pushPast(hist, before);
    hist.current = snapshot(hist.state);
    syncBarButtons(hist);
  }

  /** @description Apply an undo or redo step from the snapshot stacks. */
  function stepHistory(sheet, dir) {
    var hist = getHistory(sheet);
    if (!hist || !hist.state) return false;
    var source = dir === 'undo' ? hist.past : hist.future;
    var target = dir === 'undo' ? hist.future : hist.past;
    if (!source.length) return false;
    if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; }
    var now = hist.burst ? snapshot(hist.state) : (hist.current || snapshot(hist.state));
    hist.burst = false;
    var next = source.pop();
    target.push(now);
    if (target.length > MAX_HISTORY) target.shift();
    hist.current = JSON.parse(JSON.stringify(next));
    hist.state.resume = JSON.parse(JSON.stringify(next.resume));
    hist.state.cover = JSON.parse(JSON.stringify(next.cover));
    syncBarButtons(hist);
    if (typeof hist.onRestore === 'function') hist.onRestore(next);
    return true;
  }

  /** @description Focus an editable element and place the caret at the end of its text. */
  function focusEnd(el) {
    if (!el) return;
    el.focus();
    var doc = el.ownerDocument, win = doc && doc.defaultView;
    if (!win || typeof win.getSelection !== 'function' || typeof doc.createRange !== 'function') return;
    var range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = win.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }

  /** @description Find the first focusable editable target for a quick-jump section key. */
  function sectionTarget(sheet, key) {
    if (key === 'summary') return sheet.querySelector(':scope > p.summary[contenteditable="true"]');
    if (key === 'experience') return sheet.querySelector('.exp [contenteditable="true"]');
    if (key === 'skills') return sheet.querySelector('[data-edit-field="skills"]');
    if (key === 'cover') return sheet.querySelector('.cover-preview [contenteditable="true"]');
    return null;
  }

  /** @description Build the mode pill and Undo/Redo button group for #tailoredBar. */
  function buildBarActions(doc, sheet) {
    var left = doc.createElement('div');
    left.className = 'cte-bar-group';
    var pill = doc.createElement('span');
    pill.className = 'cte-pill';
    pill.setAttribute('data-editor-mode', 'direct');
    pill.textContent = '\u270E Direct editing';
    left.appendChild(pill);
    [['undo', 'Undo', 'Undo (Ctrl+Z)', '\u21B6 Undo'], ['redo', 'Redo', 'Redo (Ctrl+Shift+Z)', '\u21B7 Redo']].forEach(function (spec) {
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'cte-btn';
      btn.setAttribute('data-editor-action', spec[0]);
      btn.setAttribute('aria-label', spec[1]);
      btn.title = spec[2];
      btn.textContent = spec[3];
      btn.addEventListener('click', function () { stepHistory(sheet, spec[0]); });
      left.appendChild(btn);
    });
    return left;
  }

  /** @description Build quick-jump section buttons for whichever editable sections exist in #sheet. */
  function buildBarJumps(doc, sheet) {
    var jumps = doc.createElement('div');
    jumps.className = 'cte-bar-group';
    [['summary', 'Summary'], ['experience', 'Experience'], ['skills', 'Skills'], ['cover', 'Cover letter']].forEach(function (pair) {
      if (!sectionTarget(sheet, pair[0])) return;
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'cte-btn cte-jump';
      btn.setAttribute('data-editor-jump', pair[0]);
      btn.textContent = pair[1];
      btn.addEventListener('click', function () {
        var liveTarget = sectionTarget(sheet, pair[0]);
        if (!liveTarget) return;
        if (typeof liveTarget.scrollIntoView === 'function') liveTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusEnd(liveTarget);
      });
      jumps.appendChild(btn);
    });
    return jumps;
  }

  /** @description Mount or refresh the #tailoredBar sibling directly above #sheet. */
  function renderBar(sheet, hist) {
    var doc = sheet.ownerDocument;
    if (!doc || !sheet.parentNode) return null;
    var bar = doc.getElementById('tailoredBar');
    if (!bar) {
      bar = doc.createElement('div');
      bar.id = 'tailoredBar';
      bar.className = 'cte-bar';
      bar.setAttribute('data-editor-control', 'toolbar');
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Direct résumé editor');
      sheet.parentNode.insertBefore(bar, sheet);
    }
    bar.hidden = false;
    bar.innerHTML = '';
    bar.appendChild(buildBarActions(doc, sheet));
    var jumps = buildBarJumps(doc, sheet);
    if (jumps.childNodes.length) bar.appendChild(jumps);
    if (hist) { hist.bar = bar; syncBarButtons(hist); }
    return bar;
  }

  /** @description Hide the editor toolbar and clear active snapshot history when switching documents. */
  function reset(sheet) {
    if (!sheet) return;
    var doc = sheet.ownerDocument;
    var bar = doc && doc.getElementById('tailoredBar');
    if (bar) bar.hidden = true;
    var hist = getHistory(sheet);
    if (hist) {
      if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; }
      hist.past = []; hist.future = []; hist.current = null; hist.burst = false;
    }
  }

  /** @description Create a non-printing inline add control button. */
  function addButton(doc, label, kind, onClick) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cte-add';
    btn.setAttribute('data-editor-control', kind);
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** @description Create a non-printing inline remove control button. */
  function removeButton(doc, label, kind, onClick) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cte-rm';
    btn.setAttribute('data-editor-control', kind);
    btn.setAttribute('contenteditable', 'false');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.textContent = '×';
    btn.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); onClick(); });
    return btn;
  }

  /** @description Insert plaintext at the current selection without HTML markup. */
  function insertPlainText(doc, text) {
    if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) return;
    var sel = doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** @description Wire delegated plaintext paste, single-line Enter guard, Undo/Redo, and Ctrl/Cmd+S once per sheet. */
  function wireSheetGuards(sheet) {
    if (sheet.dataset && sheet.dataset.cteWired === '1') return;
    if (sheet.dataset) sheet.dataset.cteWired = '1';
    sheet.addEventListener('paste', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[contenteditable="true"]') : null;
      if (!target) return;
      event.preventDefault();
      var clip = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
      var text = target.getAttribute('data-edit-single') === '1'
        ? clip.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
        : clip.replace(/\r\n/g, '\n');
      insertPlainText(sheet.ownerDocument, text);
    });
    sheet.addEventListener('keydown', function (event) {
      var mod = event.ctrlKey || event.metaKey;
      var key = String(event.key || '').toLowerCase();
      if (mod && key === 's') {
        event.preventDefault();
        var saveBtn = sheet.ownerDocument.getElementById('save');
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
        return;
      }
      if (mod && (key === 'z' || key === 'y')) {
        var dir = (key === 'y' || event.shiftKey) ? 'redo' : 'undo';
        if (stepHistory(sheet, dir)) { event.preventDefault(); return; }
      }
      var target = event.target && event.target.closest ? event.target.closest('[contenteditable="true"][data-edit-single="1"]') : null;
      if (target && event.key === 'Enter') { event.preventDefault(); target.blur(); }
    });
  }

  /** @description Mark one DOM element editable and sync changes into the backing state. */
  function makeEditable(el, opts, hooks) {
    if (!el) return el;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('data-edit-field', opts.field);
    if (opts.singleLine) el.setAttribute('data-edit-single', '1');
    if (opts.label) el.setAttribute('aria-label', opts.label);
    el.addEventListener('input', function () {
      noteTyping(hooks.hist);
      opts.sync(cleanText(el, Boolean(opts.singleLine)));
      hooks.onEdit();
    });
    el.addEventListener('blur', function () {
      flushBurst(hooks.hist);
      hooks.onCommit();
    });
    return el;
  }

  /** @description Make Core Competencies chips editable with inline add and remove controls. */
  function bindCompetencies(compEl, resume, hooks) {
    var doc = compEl.ownerDocument;
    var syncAll = function () {
      var spans = compEl.querySelectorAll('span[data-edit-field="competency"]');
      resume.competencies = Array.from(spans).map(function (s) { return cleanText(s, true); }).filter(Boolean);
    };
    var wrapChip = function (span) {
      var chip = doc.createElement('div');
      chip.className = 'cte-chip';
      span.parentNode.insertBefore(chip, span);
      chip.appendChild(span);
      makeEditable(span, { field: 'competency', singleLine: true, label: 'Core competency', sync: syncAll }, hooks);
      chip.appendChild(removeButton(doc, 'Remove competency', 'remove-competency', function () {
        recordAtomic(hooks.hist, function () { chip.remove(); syncAll(); });
        hooks.onEdit(); hooks.onCommit();
      }));
      return chip;
    };
    Array.from(compEl.querySelectorAll(':scope > span')).forEach(wrapChip);
    var add = addButton(doc, '+ Add competency', 'add-competency', function () {
      var span = doc.createElement('span');
      compEl.insertBefore(span, add);
      wrapChip(span);
      span.focus();
    });
    compEl.appendChild(add);
  }

  /** @description Wrap one experience bullet list item with editable text, story tracking, and remove control. */
  function bindBulletItem(li, role, ul, hooks) {
    var doc = li.ownerDocument;
    var prev = cleanText(li, false);
    var textSpan = doc.createElement('span');
    textSpan.className = 'cte-text';
    textSpan.textContent = prev;
    li.textContent = '';
    li.classList.add('cte-item');
    li.appendChild(textSpan);
    var syncBullets = function () {
      var nodes = ul.querySelectorAll('span[data-edit-field="role-bullet"]');
      role.bullets = Array.from(nodes).map(function (n) { return cleanText(n, false); }).filter(Boolean);
    };
    makeEditable(textSpan, {
      field: 'role-bullet', singleLine: false, label: 'Experience bullet',
      sync: function (next) {
        if (Array.isArray(role.stories) && prev && prev !== next) {
          role.stories.forEach(function (s) { if (s && s.bullet === prev) s.bullet = next; });
        }
        prev = next;
        syncBullets();
      },
    }, hooks);
    li.addEventListener('click', function (event) {
      if (event.target === li) focusEnd(textSpan);
    });
    li.appendChild(removeButton(doc, 'Remove bullet', 'remove-bullet', function () {
      recordAtomic(hooks.hist, function () { li.remove(); syncBullets(); });
      hooks.onEdit(); hooks.onCommit();
    }));
    return textSpan;
  }

  /** @description Bind one .exp role card to its backing role object in state.resume. */
  function bindExperienceBlock(expEl, role, isMaster, hooks) {
    if (!expEl || !role) return;
    var doc = expEl.ownerDocument;
    if (!isMaster) {
      var er = expEl.querySelector('.er');
      var spans = expEl.querySelectorAll('.er > span');
      if (spans[0]) makeEditable(spans[0], { field: 'role-title', singleLine: true, label: 'Role title', sync: function (v) { role.title = v; } }, hooks);
      if (spans[1]) makeEditable(spans[1], { field: 'role-span', singleLine: true, label: 'Role dates', sync: function (v) { role.span = v; } }, hooks);
      if (er && spans[0]) er.addEventListener('click', function (event) { if (event.target === er) focusEnd(spans[0]); });
      var org = expEl.querySelector('.org');
      if (org) makeEditable(org, { field: 'role-org', singleLine: true, label: 'Organization', sync: function (v) { role.org = v; } }, hooks);
    }
    var ul = expEl.querySelector('ul');
    if (!ul) { ul = doc.createElement('ul'); expEl.appendChild(ul); }
    Array.from(ul.querySelectorAll(':scope > li:not(.story)')).forEach(function (li) {
      bindBulletItem(li, role, ul, hooks);
    });
    expEl.appendChild(addButton(doc, '+ Add bullet', 'add-bullet', function () {
      var li = doc.createElement('li');
      var firstStory = ul.querySelector(':scope > li.story');
      ul.insertBefore(li, firstStory || null);
      var span = bindBulletItem(li, role, ul, hooks);
      span.focus();
    }));
  }

  /** @description Bind an Education or Certifications list for direct inline editing. */
  function bindListSection(ul, fieldKey, label, resume, hooks) {
    var doc = ul.ownerDocument;
    var syncList = function () {
      var nodes = ul.querySelectorAll('span[data-edit-field="' + fieldKey + '"]');
      resume[fieldKey] = Array.from(nodes).map(function (n) { return cleanText(n, true); }).filter(Boolean);
    };
    var wireLi = function (li) {
      var span = doc.createElement('span');
      span.className = 'cte-text';
      span.textContent = cleanText(li, true);
      li.textContent = '';
      li.classList.add('cte-item');
      li.appendChild(span);
      makeEditable(span, { field: fieldKey, singleLine: true, label: label, sync: syncList }, hooks);
      li.addEventListener('click', function (event) { if (event.target === li) focusEnd(span); });
      li.appendChild(removeButton(doc, 'Remove ' + label.toLowerCase(), 'remove-' + fieldKey, function () {
        recordAtomic(hooks.hist, function () { li.remove(); syncList(); });
        hooks.onEdit(); hooks.onCommit();
      }));
      return span;
    };
    Array.from(ul.querySelectorAll(':scope > li')).forEach(wireLi);
    var add = addButton(doc, '+ Add ' + label.toLowerCase(), 'add-' + fieldKey, function () {
      var li = doc.createElement('li');
      ul.appendChild(li);
      wireLi(li).focus();
    });
    ul.parentNode.insertBefore(add, ul.nextSibling);
  }

  /** @description Bind cover letter greeting, paragraphs, and closing for direct inline editing. */
  function bindCoverSection(section, state, hooks) {
    if (!section || !state.cover) return;
    var doc = section.ownerDocument, cover = state.cover;
    var hasGreeting = typeof cover.greeting === 'string' && cover.greeting.length > 0;
    var hasClosing = typeof cover.closing === 'string' && cover.closing.length > 0;
    var paras = Array.from(section.querySelectorAll(':scope > p'));
    var syncCover = function () {
      var bodyNodes = section.querySelectorAll('p[data-edit-field="cover-paragraph"]');
      cover.paragraphs = Array.from(bodyNodes).map(function (p) { return cleanText(p, false); }).filter(Boolean);
    };
    var start = 0, end = paras.length;
    if (hasGreeting && paras[0]) {
      makeEditable(paras[0], { field: 'cover-greeting', singleLine: true, label: 'Cover letter greeting', sync: function (v) { cover.greeting = v; } }, hooks);
      start = 1;
    }
    var closingEl = hasClosing && end > start ? paras[end - 1] : null;
    if (closingEl) {
      makeEditable(closingEl, { field: 'cover-closing', singleLine: true, label: 'Cover letter closing', sync: function (v) { cover.closing = v; } }, hooks);
      end -= 1;
    }
    var wrapParagraph = function (p) {
      var row = doc.createElement('div');
      row.className = 'cte-cover-row';
      p.parentNode.insertBefore(row, p);
      row.appendChild(p);
      makeEditable(p, { field: 'cover-paragraph', singleLine: false, label: 'Cover letter paragraph', sync: syncCover }, hooks);
      row.addEventListener('click', function (event) { if (event.target === row) focusEnd(p); });
      row.appendChild(removeButton(doc, 'Remove paragraph', 'remove-cover-paragraph', function () {
        recordAtomic(hooks.hist, function () { row.remove(); syncCover(); });
        hooks.onEdit(); hooks.onCommit();
      }));
      return row;
    };
    for (var i = start; i < end; i++) wrapParagraph(paras[i]);
    var addBtn = addButton(doc, '+ Add paragraph', 'add-cover-paragraph', function () {
      var p = doc.createElement('p');
      section.insertBefore(p, closingEl || addBtn);
      wrapParagraph(p);
      p.focus();
    });
    section.appendChild(addBtn);
  }

  /** @description Bind all section children inside #sheet after top-level fields. */
  function bindSections(sheet, state, isMaster, hooks) {
    var resume = state.resume, section = '', seen = { exp: 0, add: 0, oss: 0 };
    var roles = { exp: orderedRoles(resume.experience), add: orderedRoles(resume.additional_experience), oss: orderedRoles(resume.open_source) };
    Array.from(sheet.children).forEach(function (child) {
      if (child.tagName === 'H2') { section = cleanText(child, true).toLowerCase(); return; }
      if (child.classList && child.classList.contains('exp')) {
        var bucket = section === 'experience' ? 'exp' : section === 'independent project work' ? 'oss' : section.endsWith(' experience') ? 'add' : '';
        if (bucket && roles[bucket][seen[bucket]]) bindExperienceBlock(child, roles[bucket][seen[bucket]++], isMaster, hooks);
      } else if (section === 'skills' && child.tagName === 'P') {
        makeEditable(child, { field: 'skills', singleLine: false, label: 'Skills', sync: function (v) { resume.skills = parseSkills(v); } }, hooks);
      } else if (section === 'education' && child.tagName === 'UL') {
        bindListSection(child, 'education', 'Education', resume, hooks);
      } else if (section === 'certifications' && child.tagName === 'UL') {
        bindListSection(child, 'certifications', 'Certification', resume, hooks);
      } else if (section === 'clearance' && child.tagName === 'P') {
        makeEditable(child, { field: 'clearance', singleLine: true, label: 'Clearance', sync: function (v) { resume.clearance = v; } }, hooks);
      } else if (!isMaster && child.classList && child.classList.contains('cover-preview')) {
        bindCoverSection(child, state, hooks);
      }
    });
  }

  /**
   * @description Enhance a rendered #sheet preview so every text field is directly editable in place with Undo/Redo and section jumps.
   * @param {HTMLElement} sheet The #sheet container already populated by renderPreview().
   * @param {{state:object,isMaster?:boolean,preserveHistory?:boolean,onEdit?:Function,onCommit?:Function,onRestore?:Function}} options Backing state & callbacks.
   */
  function bind(sheet, options) {
    if (!sheet || !options || !options.state || !options.state.resume) return;
    var state = options.state, resume = state.resume, isMaster = Boolean(options.isMaster);
    var hist = getHistory(sheet);
    if (hist) {
      hist.state = state;
      hist.onRestore = typeof options.onRestore === 'function' ? options.onRestore : null;
      if (!options.preserveHistory) {
        if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; }
        hist.past = []; hist.future = []; hist.burst = false; hist.current = snapshot(state);
      }
    }
    var hooks = {
      hist: hist,
      onEdit: typeof options.onEdit === 'function' ? options.onEdit : function () {},
      onCommit: typeof options.onCommit === 'function' ? options.onCommit : function () {},
    };
    injectStyles(sheet.ownerDocument);
    wireSheetGuards(sheet);
    var headline = sheet.querySelector(':scope > p.headline');
    if (headline) makeEditable(headline, { field: 'headline', singleLine: true, label: 'Headline', sync: function (v) { resume.headline = v; } }, hooks);
    var summary = sheet.querySelector(':scope > p.summary');
    if (summary) makeEditable(summary, { field: 'summary', singleLine: false, label: 'Summary', sync: function (v) { resume.summary = v; } }, hooks);
    var comp = sheet.querySelector(':scope > .comp');
    if (comp) bindCompetencies(comp, resume, hooks);
    bindSections(sheet, state, isMaster, hooks);
    renderBar(sheet, hist);
  }

  var exported = Object.freeze({ bind: bind, reset: reset, undo: function (sheet) { return stepHistory(sheet, 'undo'); }, redo: function (sheet) { return stepHistory(sheet, 'redo'); }, parseSkills: parseSkills, orderedRoles: orderedRoles });
  if (root) root.CareerTailoredEditor = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : null);
