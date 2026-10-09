/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Paint the manual video editor from one timeline document (CREATE-EDIT-05d): media list, the segment track sized by duration, the title track, the selected segment's controls, the music bed and the clock. Every string from a document or a file name goes in as text, never as markup; nothing here edits the document.
 */
import { LIMITS, PROFILE } from './timeline-validation.mjs';
import { timelineLayout } from './timeline-model.mjs';

/** @description Seconds for a frame count, as the person reads them (0:04.50). @param {number} frames Frames. @returns {string} Clock text. */
export function clock(frames) {
  const seconds = frames / PROFILE.fps, minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

function element(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

/**
 * @description List the project's media with their measured lengths; unused media can be removed.
 * @param {HTMLElement} list Target list. @param {object} doc Timeline document. @param {boolean} editable Whether changes are allowed.
 * @returns {void}
 */
export function renderSources(list, doc, editable) {
  const used = new Set([...doc.segments.map(segment => segment.source), doc.audioBed?.source].filter(Boolean));
  list.replaceChildren(...Object.entries(doc.sources).map(([key, source]) => {
    const detail = source.kind === 'video' ? `${clock(source.frames)} · ${source.width}×${source.height}${source.audio ? '' : ' · no sound'}` : `${clock(source.frames)} · music`;
    const remove = element('button', { type: 'button', text: 'Remove', disabled: !editable || used.has(key), dataset: { removeSource: key } });
    const add = source.kind === 'video' ? [element('button', { type: 'button', text: 'Add to timeline', disabled: !editable, dataset: { appendSource: key } })] : [];
    return element('li', {}, [element('span', { className: 'source-name', text: source.name }), element('span', { className: 'muted', text: detail }), ...add, remove]);
  }));
  if (!list.children.length) list.append(element('li', { className: 'muted', text: 'No media yet. Add a clip to start.' }));
}

/**
 * @description Draw the main track: one option per segment, as wide as its duration, in playback order.
 * @param {HTMLElement} track Track. @param {object} doc Document. @param {string|null} selected Selected segment ID. @returns {void}
 */
export function renderTrack(track, doc, selected) {
  const rows = timelineLayout(doc);
  track.replaceChildren(...rows.map(row => {
    const source = doc.sources[row.source];
    const option = element('button', { type: 'button', className: 'segment', role: 'option', 'aria-selected': String(row.id === selected),
      dataset: { segment: row.id }, text: `${source.name} · ${clock(row.out - row.in)}` });
    option.style.flexGrow = String(row.out - row.in);
    option.title = `${source.name}: ${clock(row.in)} to ${clock(row.out)} of the clip, at ${clock(row.start)} in the video`;
    return option;
  }));
  if (!rows.length) track.append(element('p', { className: 'muted', text: 'The timeline is empty.' }));
}

/**
 * @description Draw the title track and the title list.
 * @param {HTMLElement} track Title track. @param {HTMLElement} list Title list. @param {object} doc Document. @param {boolean} editable Editable.
 * @returns {void}
 */
export function renderTitles(track, list, doc, editable) {
  const total = Math.max(1, timelineLayout(doc).reduce((sum, row) => sum + row.out - row.in, 0));
  track.replaceChildren(...doc.titles.map(title => {
    const bar = element('span', { className: 'title-bar', text: title.text });
    bar.style.left = `${(title.start / total) * 100}%`; bar.style.width = `${((title.end - title.start) / total) * 100}%`;
    return bar;
  }));
  list.replaceChildren(...doc.titles.map(title => element('li', {}, [
    element('span', { text: `“${title.text}”` }), element('span', { className: 'muted', text: `${clock(title.start)}–${clock(title.end)} · ${title.position} · ${title.size}` }),
    element('button', { type: 'button', text: 'Remove', disabled: !editable, dataset: { removeTitle: title.id } })])));
}

/**
 * @description Fill the selected segment's controls, or say that nothing is selected.
 * @param {object} nodes Inspector elements. @param {object} doc Document. @param {string|null} selected Segment ID. @param {boolean} editable Editable.
 * @returns {void}
 */
export function renderInspector(nodes, doc, selected, editable) {
  const segment = doc.segments.find(item => item.id === selected);
  nodes.none.hidden = !!segment; nodes.controls.hidden = !segment;
  if (!segment) return;
  const source = doc.sources[segment.source];
  nodes.trimIn.max = String(source.frames - 1); nodes.trimOut.max = String(source.frames);
  nodes.trimIn.value = String(segment.in); nodes.trimOut.value = String(segment.out);
  nodes.volume.value = String(segment.volume); nodes.volumeValue.value = `${segment.volume}%`;
  for (const node of [nodes.trimIn, nodes.trimOut, nodes.volume, ...nodes.buttons]) node.disabled = !editable;
}

/**
 * @description Offer the project's music files for the bed and show its volume.
 * @param {HTMLSelectElement} select Bed select. @param {HTMLInputElement} volume Volume. @param {HTMLOutputElement} output Readout. @param {object} doc Document.
 * @param {boolean} editable Editable. @returns {void}
 */
export function renderBed(select, volume, output, doc, editable) {
  const music = Object.entries(doc.sources).filter(([, source]) => source.kind === 'audio');
  select.replaceChildren(element('option', { value: '', text: 'No music' }), ...music.map(([key, source]) => element('option', { value: key, text: source.name })));
  select.value = doc.audioBed?.source ?? '';
  volume.value = String(doc.audioBed?.volume ?? 40); output.value = `${doc.audioBed?.volume ?? 40}%`;
  select.disabled = !editable || !music.length; volume.disabled = !editable || !doc.audioBed;
}

/** @description The frames still available on the 60-second track. @param {object} doc Document. @returns {number} Frames. */
export function remainingFrames(doc) { return LIMITS.totalFrames - timelineLayout(doc).reduce((sum, row) => sum + row.out - row.in, 0); }
