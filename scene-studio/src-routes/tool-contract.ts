/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — which upstream MCP tools Scene Studio runs (the
 *                     |                             | same allowlists as engine/scene_ops.py GODOT_TOOLS / BLENDER_TOOLS,
 *                     |                             | kept in step by a spec), the templates and export formats per
 *                     |                             | project kind, and how a tool call's body becomes MCP arguments:
 *                     |                             | the framework's own fields are dropped, and an argument the engine
 *                     |                             | injects (projectPath, blend_file) is refused, never forwarded.
 */

import { RequestError } from './project-service';

/** godot-mcp tools a Godot project may call (engine/scene_ops.py GODOT_TOOLS). */
export const GODOT_TOOLS: readonly string[] = Object.freeze([
  'create_scene', 'add_node', 'load_sprite', 'export_mesh_library', 'save_scene', 'get_uid', 'get_project_info',
]);

/** Blender Lab MCP tools that work on a Blender project's .blend (engine BLENDER_TOOLS with file=True). */
export const BLENDER_PROJECT_TOOLS: readonly string[] = Object.freeze([
  'execute_blender_code_for_cli',
  'get_blendfile_summary_datablocks_for_cli',
  'get_blendfile_summary_missing_files_for_cli',
  'get_blendfile_summary_of_linked_libraries_for_cli',
  'get_blendfile_summary_path_info_for_cli',
  'get_blendfile_summary_usage_guess_for_cli',
]);

/** Blender Lab MCP documentation tools (no project; the docs ship inside the engine). */
export const BLENDER_DOC_TOOLS: readonly string[] = Object.freeze(['search_api_docs', 'get_python_api_docs', 'search_manual_docs']);

export const TEMPLATES: Readonly<Record<'godot' | 'blender', readonly string[]>> = Object.freeze({
  godot: Object.freeze(['3d', '2d', 'empty']),
  blender: Object.freeze(['default', 'empty']),
});

export const EXPORT_FORMATS: Readonly<Record<'godot' | 'blender', readonly string[]>> = Object.freeze({
  godot: Object.freeze(['zip']),
  blender: Object.freeze(['glb', 'fbx', 'obj', 'stl', 'zip']),
});

/** Fields the framework's tool executor or this package owns; never forwarded to an MCP tool. */
const FRAMEWORK_FIELDS = new Set(['projectId', 'timeoutMs', 'headers', 'method', 'body', 'confirm']);
/** Arguments the engine sets from the project itself; a caller supplying one is refused. */
const ENGINE_OWNED = new Set(['projectPath', 'blend_file']);

/**
 * @description A tool call's MCP arguments: either `{arguments: {...}}` or the body's own fields
 * (a concierge's tool input arrives flat), minus framework fields and `drop`.
 * @param body - Request body.
 * @param drop - Extra keys this route consumes itself.
 * @returns The arguments object. @throws RequestError when an engine-owned argument is supplied.
 */
export function toolArguments(body: Record<string, unknown>, drop: readonly string[] = []): Record<string, unknown> {
  const nested = body.arguments;
  const source = nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (ENGINE_OWNED.has(key)) throw new RequestError(`${key} is set by Scene Studio from the project, not by the caller`, key);
    if (FRAMEWORK_FIELDS.has(key) || drop.includes(key) || (source === body && key === 'arguments')) continue;
    out[key] = value;
  }
  return out;
}
