/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Adapt the shared editor shell and typed inspector to Publishing's owned draft operations and immutable revisions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Share the saved-document concierge and controller-owned cards, preserving selection, manual follow-up and history.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the oshal design standard (docs/ux/design-standard.md §3, §4, §5.1; CONVENTIONS §5.5): the shared editor carries Publishing's own screen (publishing-shell.mjs) instead of the start card and the Navigation / Properties / Concierge band: one app row, one tool row, sheets on a phone and the Pages | canvas | Properties·Concierge panes on a desktop. The typed inspector moves into the Arrange section, and for a text frame it shows geometry only (its story is edited in the Text sheet), so there is one inspector.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.6, phones (Roger, trial.oswarm.ai, 2026-11-06, F6, and the trial check: no visible first action, a two-row toolbar, two empty-looking boxes): with no publication open the empty state's one primary action is New publication (the rail's own Create publication form, its defaults), with Your publications as a text link; the dead document buttons, the history and the empty-page text wait until a publication is open; the first pane is named Publications.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.4.1: the planned-control helper is optional: a platform without it opens the studio without its placeholders.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: forward board decoration and document-open hooks from the publishing shell (RP-PUB-06, RP-PUB-08).
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
  // The planned-control helper is a newer platform file: on a platform without it the studio still opens, without its greyed placeholders.
  const {plannedControl} = await import('/shared/ui/js/planned-control.js').catch(() => ({plannedControl: null}));
  const {createPublishingShell} = await import('./publishing-shell.mjs');
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
  const foundation = createEditorFoundation({
    root, header: document.querySelector('header.top'), navigation: main.querySelector('.rail'),
    viewport: main.querySelector('.workspace'), inspector: main.querySelector('.inspector'),
    ai: document.querySelector('.chat'), status: document.getElementById('status'),
    getState: () => ({documentId: state.document?.id ?? null, revision: state.document?.revision ?? null,
      title: state.document?.title ?? 'Publishing Studio', dirty: hasDraft(), busy: state.busy,
      readOnly: !state.document || state.document.revision !== state.document.currentRevision,
      canUndo: state.undo.length > 0, canRedo: state.redo.length > 0,
      status: document.getElementById('status').textContent,
      error: document.getElementById('status').dataset.error === 'true' ? document.getElementById('status').textContent : null}),
    getSelection: selection,
    // One inspector (design standard §5.1): a frame's story text is edited in the Text sheet, so Arrange shows its geometry.
    getProperties: () => publishingProperties(state.model, page(), selected()).filter(field => !(field.key === 'text' && selected()?.storyId)),
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
  // The typed inspector is the Arrange section's (one inspector, not a second geometry form).
  document.getElementById('pub-arrange-host').append(root.querySelector('.ef-common-properties'));
  const shell = createPublishingShell(adapter, {foundation, assistant, plannedControl});
  Object.assign(adapter.ui, {confirm: shell.confirm, float: shell.float, painted: shell.painted, placed: shell.placed, decorateBoard: shell.decorateBoard, onDocumentLoaded: shell.onDocumentLoaded});
  root.dataset.editorFoundation = 'ready';
  const refresh = foundation.refresh, destroy = foundation.destroy;
  foundation.refresh = () => {assistant.refresh();refresh();};
  foundation.destroy = () => {assistant.destroy();destroy();};
  adapter.paint();
  if (state.document) void shell.onDocumentLoaded(adapter.viewSnapshot());
  return foundation;
}
