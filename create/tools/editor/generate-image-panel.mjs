/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Generate an image from a sentence on screen, the same route as the concierge's create-generate-image tool: pending edits are saved first, and the picture lands as a new undoable layer of this project.
 */
import { $, state, api, jsonRequest, notify, handle, subscribe, dirty } from './editor-state.mjs';
import { saveProject } from './editor-projects.mjs';
import { serializeProject } from './model.mjs';

const panel = { busy: false, status: '' };

/** The words for a refusal the person can act on; anything else keeps the server's own sentence. */
function refusalText(error) {
  const text = String(error?.message || error);
  if (/image_daily_cap_reached/.test(text)) return 'You have reached today\'s limit for generated images.';
  if (/image_provider_unavailable/.test(text)) return 'This installation has no image generator available right now.';
  return text;
}

function render() {
  const section = $('generateImagePanel');
  section.hidden = !state.permissions?.generate || !state.permissions?.change;
  $('generateSend').disabled = panel.busy;
  $('generateStatus').textContent = panel.status;
}

async function send() {
  const prompt = $('generatePrompt').value.trim();
  if (!prompt) throw new Error('Say what the image should show.');
  panel.busy = true; panel.status = 'Generating. This can take up to a minute.'; notify();
  try {
    if (!state.id || dirty()) await saveProject();
    const { project } = await api('/generated-images', jsonRequest('POST', { id: state.id, prompt }));
    state.project = state.history.commit(project.document); state.revision = project.revision;
    state.saved = serializeProject(project.document); state.conflict = false; state.saveFailed = false;
    panel.status = `Added as a new layer. Saved as revision ${project.revision}.`; $('generatePrompt').value = '';
  } catch (error) { panel.status = refusalText(error); } finally { panel.busy = false; notify(); }
}

/**
 * @description Wire the Generate an image panel; it shows only to a person who may generate and change this project.
 * @returns {void}
 */
export function bindGenerateImagePanel() {
  $('generateSend').onclick = handle(send);
  subscribe(render); render();
}
