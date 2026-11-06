/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Adapt the shared editor shell and typed inspector to Publishing's owned draft operations and immutable revisions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Share the saved-document concierge and controller-owned cards, preserving selection, manual follow-up and history.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.6, phones (Roger, trial.oswarm.ai, 2026-11-06, F6, and the trial check: no visible first action, a two-row toolbar, two empty-looking boxes): with no publication open the empty state's one primary action is New publication (the rail's own Create publication form, its defaults), with Your publications as a text link; the dead document buttons, the history and the empty-page text wait until a publication is open; the first pane is named Publications.
 */
const geometry = ['x', 'y', 'width', 'height'];
const textOf = paragraph => paragraph?.runs?.map(run => run.text).join('') ?? '';
const simple = paragraphs => paragraphs?.length === 1 && paragraphs[0].runs.length === 1;
const color = values => '#' + values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');

export function publishingSelection(document, selectedPage, item) {
  return {kind: item ? item.storyId ? 'text frame' : item.kind === 'rect' ? 'rectangle' : item.kind ?? 'object' : 'page',
    ids: document ? [item ? selectedPage.id + '/' + item.id : selectedPage?.id].filter(Boolean) : []};
}

/** Only the owning application interprets a property key as an actual edit. */
export function publishingProperties(model, selectedPage, item) {
  if (!model || !selectedPage || !item) return [];
  const frame = Boolean(item.storyId), bleed = frame ? 0 : selectedPage.bleed;
  const linked = frame && model.pages.flatMap(page => page.frames).filter(value => value.storyId === item.storyId).length > 1;
  const fields = geometry.map(key => ({key, label: {x: 'X', y: 'Y', width: 'Width', height: 'Height'}[key],
    type: 'number', value: item[key], unit: 'pt', step: 0.1, group: 'Geometry',
    min: key === 'x' || key === 'y' ? -bleed : frame ? 12 : 1,
    max: key === 'x' || key === 'width' ? selectedPage.width + bleed : selectedPage.height + bleed,
    disabled: linked && (key === 'width' || key === 'height')}));
  if (item.kind === 'rect') fields.push({key: 'color', label: 'Fill color', type: 'color', value: color(item.color), group: 'Appearance'});
  const story = frame && model.stories.find(value => value.id === item.storyId);
  if (story && simple(story.paragraphs)) fields.push({key: 'text', label: 'Story text', type: 'textarea',
    value: textOf(story.paragraphs[0]), group: 'Text'});
  if (item.kind === 'text' && item.paragraph.runs.length === 1) fields.push({key: 'text', label: 'Text', type: 'textarea',
    value: textOf(item.paragraph), group: 'Text'});
  return fields;
}

function geometryValues(selectedPage, item, key, value) {
  const next = {...item, [key]: value}, frame = Boolean(item.storyId), bleed = frame ? 0 : selectedPage.bleed;
  if (!Number.isFinite(value) || next.width < (frame ? 12 : 1) || next.height < (frame ? 12 : 1)
      || next.x < -bleed || next.y < -bleed || next.x + next.width > selectedPage.width + bleed
      || next.y + next.height > selectedPage.height + bleed) {
    throw new Error('Keep the item inside the page bounds with a valid width and height.');
  }
  return {[key]: value};
}

/** Produce the same closed native operations used by the existing workbench. */
export function publishingPropertyOperation(model, selectedPage, item, key, value) {
  const field = publishingProperties(model, selectedPage, item).find(field => field.key === key);
  if (!field || field.disabled) throw new Error('This property cannot be changed for the selected item.');
  let values;
  if (geometry.includes(key)) values = geometryValues(selectedPage, item, key, value);
  else if (key === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Choose a valid fill color.');
    values = {color: [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16))};
  } else if (key === 'text') {
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > 65536) throw new Error('Text exceeds the publishing profile.');
    const paragraph = structuredClone(item.storyId ? model.stories.find(story => story.id === item.storyId).paragraphs[0] : item.paragraph);
    paragraph.runs[0].text = value;
    if (item.storyId) return {op: 'replace-story', story: item.storyId, paragraphs: [paragraph]};
    values = {paragraph};
  }
  return item.storyId ? {op: 'set-frame', frame: item.id, values}
    : {op: 'set-object', page: selectedPage.id, object: item.id, values};
}

/** Install the shared presentation; persistence, validation and authority stay in Publishing. */
export async function bindPublishingFoundation(adapter) {
  const {createEditorFoundation} = await import('/shared/ui/js/editor-foundation.js');
  const {createEditorAssistant} = await import('/shared/ui/js/editor-assistant.js');
  const {state, selected, page, hasDraft, requireAppliedFields, edit, actions} = adapter;
  const root = document.body, main = document.querySelector('main');
  const selection = () => publishingSelection(state.document, page(), selected());
  const assistant = createEditorAssistant({app:'publishing-studio',bot:'publishing-editor',title:'Publishing concierge',root,
    prepare:adapter.prepare,refresh:adapter.refreshDocument,
    getState:()=>({documentId:state.document?.id??null,revision:state.document?.revision??null,
      selection:selection(),dirty:hasDraft(),busy:state.busy})});
  // Keep the workbench's documented control identifiers while sharing its real native conversation.
  assistant.element.querySelector('textarea').id = 'chat-message';
  assistant.element.querySelector('button[type="submit"]').id = 'chat-send';
  assistant.element.querySelector('.ef-assistant-log').id = 'chat-log';
  assistant.element.querySelector('.ef-assistant-help').id = 'chat-context';
  document.querySelector('.chat').replaceChildren(assistant.element);
  const workspace = main.querySelector('.workspace'), count = () => document.querySelectorAll('#documents button').length;
  const start = {when: () => !state.document, lede: 'Lay out a booklet, flyer or newsletter, then download it as a print-ready PDF.',
    label: 'New publication', run: () => document.getElementById('new').requestSubmit(),
    replaces: [workspace.querySelector('.document-bar'), document.getElementById('draft-note'), document.getElementById('spread'),
      document.getElementById('preflight'), ...workspace.querySelectorAll(':scope > .toolbar, :scope > details')],
    secondary: [{label: () => count() ? `Your publications (${count()})` : '', panel: 'navigation'}]};
  const foundation = createEditorFoundation({
    root, navigationLabel: 'Publications', start, header: document.querySelector('header.top'), navigation: main.querySelector('.rail'),
    viewport: main.querySelector('.workspace'), inspector: main.querySelector('.inspector'),
    ai: document.querySelector('.chat'), status: document.getElementById('status'),
    getState: () => ({documentId: state.document?.id ?? null, revision: state.document?.revision ?? null,
      title: state.document?.title ?? 'Publishing Studio', dirty: hasDraft(), busy: state.busy,
      readOnly: !state.document || state.document.revision !== state.document.currentRevision,
      canUndo: state.undo.length > 0, canRedo: state.redo.length > 0,
      status: document.getElementById('status').textContent,
      error: document.getElementById('status').dataset.error === 'true' ? document.getElementById('status').textContent : null}),
    getSelection: selection,
    getProperties: () => publishingProperties(state.model, page(), selected()),
    applyProperty: (key, value, context) => {
      const current = selection();
      if (context.documentId !== state.document?.id || context.revision !== state.document?.revision
          || JSON.stringify(context.selection) !== JSON.stringify(current)) throw new Error('The selection changed. Select the item again before editing.');
      requireAppliedFields();
      edit(publishingPropertyOperation(state.model, page(), selected(), key, value));
    }, actions,
  });
  main.hidden = true;
  root.classList.add('publishing-foundation');
  root.dataset.editorFoundation = 'ready';
  const refresh = foundation.refresh, destroy = foundation.destroy;
  foundation.refresh = () => {assistant.refresh();refresh();};
  foundation.destroy = () => {assistant.destroy();destroy();};
  return foundation;
}
