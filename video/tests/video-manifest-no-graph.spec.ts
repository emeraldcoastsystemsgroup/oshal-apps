/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 14:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Guard for the ADR-082 graph-block retirement: the video manifest must register video-series WITHOUT a `pipeline: graph` processDefinition (the conductor in the kernel's series-orchestrator.ts is the runtime; the graph engine discards bot replies and was never the live path).
 * 2026-07-19 21:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Moved out of the OSHAL kernel (tests/unit/video-manifest-no-graph.spec.ts) with the carved video app package (ADR-085 Wave 3): the manifest-shape describes now read ../oshal-app.yaml. The dispatch-path engine describes (manifest-worker routing + the graph path staying alive) stayed in the kernel spec — engine coverage never rides out with a surface.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const MANIFEST_PATH = path.resolve(__dirname, '../oshal-app.yaml');

interface VideoManifest {
  ticketType?: string;
  workflow?: {
    name?: string;
    pipeline?: string;
    workerBot?: string;
    processDefinition?: Record<string, unknown>;
  };
}

function loadManifest(): VideoManifest {
  return yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8')) as VideoManifest;
}

describe('video package manifest graph-block retirement (ADR-082)', () => {
  it('registers video-series WITHOUT a graph pipeline or a processDefinition', () => {
    const manifest = loadManifest();
    expect(manifest.ticketType).toBe('video-series');
    expect(manifest.workflow).toBeDefined();
    // The dead block: pipeline 'graph' + an inline nodeGraph. Both must stay gone —
    // the conductor (kernel src/app/series-orchestrator.ts) is the runtime for this
    // ticket type; the graph engine discards each bot's reply.
    expect(manifest.workflow?.pipeline).not.toBe('graph');
    expect(manifest.workflow?.processDefinition).toBeUndefined();
    // The registration still names the writer so a queue-approved ticket lands on the
    // same first stage the conductor drives.
    expect(manifest.workflow?.workerBot).toBe('screenplay-writer');
  });
});
