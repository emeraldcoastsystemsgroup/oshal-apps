/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the build hash of this package's engine
 *                     |                             | tree, computed EXACTLY as engine/container/scene_engine_bridge.py
 *                     |                             | computes it (same file list, same framing, CRLF folded to LF),
 *                     |                             | so the api refuses a container built from a different engine
 *                     |                             | than the package now ships. A spec runs both.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** The files the image bakes that change the engine's answers (mirror of RUNTIME_FILES in the bridge). */
export const RUNTIME_FILES = [
  'container/Dockerfile',
  'container/scene_engine_bridge.py',
  'mcp_client.py',
  'sandbox_exec.py',
  'scene_ops.py',
  'requirements-lock.txt',
  'scripts/blender_export.py',
  'scripts/blender_new.py',
  'scripts/blender_render.py',
  'scripts/godot_export_glb.gd',
  'scripts/godot_instance_model.gd',
] as const;

/**
 * @description Hash the engine tree, or null when it is not readable at all.
 * @param engineDir - The package's engine/ directory.
 * @returns Hex sha256, or null.
 */
export function engineBuildHash(engineDir: string): string | null {
  if (!engineDir || !fs.existsSync(engineDir)) return null;
  const digest = createHash('sha256');
  for (const rel of RUNTIME_FILES) {
    digest.update(Buffer.from(rel + '\0', 'utf8'));
    const file = path.join(engineDir, rel);
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file);
      digest.update(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
    }
    digest.update(Buffer.from('\0', 'utf8'));
  }
  return digest.digest('hex');
}
