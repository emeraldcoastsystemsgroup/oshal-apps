/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep bounded polygon computation outside the editor thread and return inert validated geometry.
 */
import { combinePaths } from './vector-geometry.mjs';
import { validateProject } from './model-validation.mjs';
self.onmessage = event => {
  try { self.postMessage({ result: combinePaths(validateProject(event.data.project), event.data.ids, event.data.operation) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
