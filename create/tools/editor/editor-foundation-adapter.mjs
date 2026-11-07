/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Connect the shared editor shell and typed properties to Create's existing validated edits, history and document saves.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create--create-editor): the shared inspector is the one Format inspector. With nothing selected it shows the canvas (width, height, background, transparent) and edits it through the same project operation Canvas settings used; the Font field offers the brand, basic and Office faces the deleted duplicate form listed. The navigation pane is named Layers, the status strip is gone (the Saved caption lives in the app row), the concierge says image and starts closed so the canvas keeps a third column.
 */
import { $, state, canEdit, dirty, edit, notify, subscribe } from './editor-state.mjs';
import { saveProject } from './editor-projects.mjs';
import { prepareEditorDocument, refreshEditorDocument } from './editor-handoff.mjs';
import { worldLayer } from './group-geometry.mjs';
import { fontChoices } from './brand-editor.mjs';

const selected = () => state.project.layers.find(layer => layer.id === state.selected);
const identity = () => state.id ?? `draft:${state.documentSession}`;
const CANVAS = '#canvas';
const selection = () => ({ kind: ({rect:'shape',ellipse:'shape',freehand:'drawing',path:'path',image:'image',text:'text',group:'group',adjustment:'adjustment'})[selected()?.type]??'layer', ids: selected() ? [state.selected] : [] });
const number = (key, label, value, min, max, unit = 'px') => ({ key, label, type: 'number', value, min, max, unit, step: 'any', group: 'Geometry' });
const text = (key, label, value, type = 'text') => ({ key, label, value, type, group: 'Text' });
const color = (key, label, value) => ({ key, label, value, type: /^#[a-f\d]{6}$/i.test(value) ? 'color' : 'text', group: 'Appearance' });
/** The Format pane's subject: the selected layer, or the canvas itself when nothing is selected. */
const formatSelection = () => selected() ? selection() : { kind: 'canvas', ids: [CANVAS] };

/** With nothing selected, Format edits the canvas: size and background, as Canvas settings did. */
function canvasProperties() {
  const { width, height, background } = state.project, transparent = background === 'transparent';
  return [{ ...number('width', 'Width', width, 1, 8192), group: 'Canvas', step: 1 }, { ...number('height', 'Height', height, 1, 8192), group: 'Canvas', step: 1 },
    { key: 'background', label: 'Background', type: 'color', value: transparent ? '#ffffff' : background, group: 'Canvas', disabled: transparent || !canEdit() },
    { key: 'transparent', label: 'Transparent', type: 'checkbox', value: transparent, group: 'Canvas', disabled: !canEdit() }];
}

function applyCanvasProperty(key, value, expected) {
  if (selected() || expected.documentId !== identity() || expected.revision !== state.revision || expected.selection.ids[0] !== CANVAS) throw new Error('The selection changed. Check the canvas again before editing.');
  const patch = key === 'transparent' ? { background: value ? 'transparent' : '#ffffff' } : key === 'background' ? { background: value } : { [key]: Math.round(value) };
  if (!['width', 'height', 'background', 'transparent'].includes(key)) throw new Error('This property cannot be changed on the canvas.');
  edit({ type: 'project', patch });
}

/** Expose only properties the current renderer and immutable model actually support. */
export function createLayerProperties() {
  const layer = selected(); if (!layer) return canvasProperties();
  const fields = [text('name', 'Layer name', layer.name)];
  if (layer.type !== 'adjustment') fields.push(
    number('x', 'X', layer.x, -32768, 32768), number('y', 'Y', layer.y, -32768, 32768),
    number('w', 'Width', layer.w, .1, 32768), number('h', 'Height', layer.h, .1, 32768),
    number('rotation', 'Rotation', layer.rotation, -360, 360, '°'));
  fields.push({ ...number('opacity', 'Opacity', Math.round(layer.opacity * 10000) / 100, 0, 100, '%'), group: 'Appearance' });
  if (['rect', 'ellipse', 'text', 'path'].includes(layer.type)) fields.push(color('fill', 'Color', layer.fill));
  if (['rect', 'ellipse', 'freehand', 'path'].includes(layer.type)) fields.push(
    color('stroke', 'Outline color', layer.stroke),
    { ...number('strokeWidth', 'Outline weight', layer.strokeWidth, layer.type === 'freehand' ? .1 : 0, 512), group: 'Appearance' });
  if (['rect','ellipse'].includes(layer.type)) {
    const shape=layer.shape??(layer.type==='ellipse'?'ellipse':'rectangle');
    fields.push({key:'shape',label:'Shape',type:'select',value:shape,group:'Appearance',options:[['rectangle','Rectangle'],['rounded-rectangle','Rounded rectangle'],['ellipse','Ellipse'],['triangle','Triangle'],['diamond','Diamond']].map(([value,label])=>({value,label}))});
    if(shape==='rounded-rectangle')fields.push({...number('radius','Corner radius',layer.radius??12,0,4096),group:'Appearance'});
  }
  if (['rect','ellipse','freehand','path'].includes(layer.type)) fields.push(
    {key:'dash',label:'Dash pattern',type:'text',value:(layer.dash??[]).join(', '),group:'Outline'},
    {key:'cap',label:'Line cap',type:'select',value:layer.cap??(layer.type==='freehand'?'round':'butt'),group:'Outline',options:['butt','round','square'].map(value=>({value,label:value}))},
    {key:'join',label:'Line join',type:'select',value:layer.join??(layer.type==='freehand'?'round':'miter'),group:'Outline',options:['miter','round','bevel'].map(value=>({value,label:value}))});
  if (layer.type!=='adjustment') {
    fields.push({key:'shadowEnabled',label:'Shadow',type:'checkbox',value:Boolean(layer.shadow),group:'Shadow'});
    if(layer.shadow)fields.push({...color('shadowColor','Shadow color',layer.shadow.color),group:'Shadow'},
      {...number('shadowOpacity','Shadow opacity',layer.shadow.opacity*100,0,100,'%'),group:'Shadow'},
      {...number('shadowBlur','Shadow blur',layer.shadow.blur,0,64),group:'Shadow'},
      {...number('shadowX','Shadow X',layer.shadow.offsetX,-512,512),group:'Shadow'},
      {...number('shadowY','Shadow Y',layer.shadow.offsetY,-512,512),group:'Shadow'});
  }
  if (layer.type === 'text') fields.push(text('text', 'Text', layer.text, 'textarea'),
    { ...number('fontSize', 'Font size', layer.fontSize, 1, 1024), group: 'Text' },
    { key: 'fontFamily', label: 'Font', type: 'select', value: layer.fontFamily, group: 'Text', options: fontChoices(layer.fontFamily) },
    { key: 'fontWeight', label: 'Weight', type: 'select', value: String(layer.fontWeight), group: 'Text', options: Array.from({ length: 9 }, (_, index) => ({ value: String((index + 1) * 100), label: ({ 400: 'Regular', 700: 'Bold' })[(index + 1) * 100] ?? String((index + 1) * 100) })) },
    { key: 'align', label: 'Alignment', type: 'select', value: layer.align, group: 'Text', options: ['left', 'center', 'right'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) });
  const locked = worldLayer(state.project, layer).locked;
  return fields.map(field => ({ ...field, disabled: locked }));
}

/** Keep the same domain command path and group scaling rules as the existing inspector. */
export function applyLayerProperty(key, value, expected) {
  if (expected?.selection?.ids?.[0] === CANVAS) return applyCanvasProperty(key, value, expected);
  const layer = selected();
  if (!layer || expected.documentId !== identity() || expected.revision !== state.revision ||
      expected.selection.ids.length !== 1 || expected.selection.ids[0] !== layer.id) throw new Error('The selected layer changed. Select it again before editing.');
  const field = createLayerProperties().find(property => property.key === key);
  if (!field || field.disabled) throw new Error('This property cannot be changed on the selected layer.');
  let patch = { [key]: key === 'opacity' ? value / 100 : key === 'fontWeight' ? Number(value) : value };
  if(key==='dash'){if(typeof value!=='string'||value.length>160)throw Error('Use at most 16 positive dash lengths separated by commas.');patch={dash:value.trim()?value.trim().split(/[\s,]+/).map(Number):[]};}
  if(key==='shadowEnabled'){if(typeof value!=='boolean')throw Error('Choose whether to show a shadow.');patch={shadow:value?{color:'#000000',opacity:.3,blur:12,offsetX:4,offsetY:4}:null};}
  const shadowKey={shadowColor:'color',shadowOpacity:'opacity',shadowBlur:'blur',shadowX:'offsetX',shadowY:'offsetY'}[key];
  if(shadowKey){if(!layer.shadow)throw Error('Enable the shadow first.');patch={shadow:{...layer.shadow,[shadowKey]:key==='shadowOpacity'?value/100:value}};}
  if (layer.type === 'group') {
    if (key === 'w') patch.h = value * layer.baseHeight / layer.baseWidth;
    else if (key === 'h') patch.w = value * layer.baseWidth / layer.baseHeight;
  }
  edit({ type: 'update', id: layer.id, patch });
}

function editorState() {
  return { documentId: identity(), revision: state.revision, title: state.project.name,
    selection:selection(), dirty: dirty(), busy: state.loading || state.saving, readOnly: !canEdit(),
    canUndo: state.history.canUndo(), canRedo: state.history.canRedo(),
    status: $('saveStatus').textContent, error: $('editorError').textContent };
}

/** The application retains its model, authority, renderer, advanced tools and AI handoff. */
export async function bindEditorFoundation() {
  const { createEditorFoundation } = await import('/shared/ui/js/editor-foundation.js');
  const {createEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
  const root = document.querySelector('.editor-workspace'), navigation = root.querySelector('.tool-panel');
  const inspector = root.querySelector('.inspector-panel');
  const layers = inspector.querySelector('section'); layers.classList.add('create-foundation-layers'); navigation.prepend(layers);
  const assistant=createEditorAssistant({app:'create',bot:'create-editor',title:'Create AI partner',root,prepare:async()=>({...await prepareEditorDocument(),selection:selection()}),refresh:refreshEditorDocument,getState:editorState});
  const help = assistant.element.querySelector('.ef-assistant-help'); if (help) help.textContent = 'Ask about this image or request a change. Your draft is saved before each message.';
  assistant.element.querySelector('.ef-assistant-log')?.setAttribute('aria-label', 'Image conversation');
  const releaseAssistant=subscribe(()=>assistant.refresh());
  const foundation = createEditorFoundation({ root, ai:assistant.element, navigation, navigationLabel: 'Layers', viewport: root.querySelector('.canvas-panel'), inspector,
    header: document.querySelector('.editor-header'),
    getState: editorState, getSelection: formatSelection, getProperties: createLayerProperties, applyProperty: applyLayerProperty,
    subscribe, actions: { undo: () => $('undo').click(), redo: () => $('redo').click(), save: () => saveProject() } });
  // The canvas keeps its column: the concierge opens from its one entry (the Today bar's Concierge, or the pane bar) instead of starting open.
  root.querySelector('[data-editor-foundation]')?.dispatchEvent(new CustomEvent('editor-concierge:hide'));
  if (document.activeElement?.closest?.('.ef-panes')) document.activeElement.blur();
  state.foundation = foundation;
  const pendingFields = () => notify();
  root.addEventListener('editor-foundation:draft', pendingFields);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { root.removeEventListener('editor-foundation:draft', pendingFields);releaseAssistant();assistant.destroy(); foundation.destroy(); }
  }, { once: true });
  return foundation;
}
