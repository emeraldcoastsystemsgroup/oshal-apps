/**
 * Persistent Smart Home Operations Guide & Runbook (`$OSHAL_PACKAGE_DATA_DIR/operations-guide.json`).
 *
 * Gives Jarvis and `home-bot` a living operational runbook covering SmartThings API capabilities,
 * Samsung Family Hub refrigerator interior cameras (`samsungce.viewInside`, `imageCapture`,
 * OCF `/udo/contents`), auto-discovered device capability inventories, and operator/concierge notes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Initial: persistent Operations Guide & Runbook (`GET /api/home/operations-guide`, `POST /api/home/operations-guide`), auto-discovery device capability logger, and `/api/home/home-summary` insight injection.
 *
 * @module home-operations-guide
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type PlaybookSection = {
  id: string;
  title: string;
  category: string;
  summary: string;
  steps: string[];
};

export type DiscoveredDeviceRecord = {
  key: string;
  deviceId: string | null;
  name: string;
  manufacturerName: string | null;
  categories: string[];
  capabilities: string[];
  cameraCapabilities: string[];
  hasInteriorCameraCapability: boolean;
  highlights: Record<string, unknown> | null;
  lastSeenAt: string;
};

export type GuideEntry = {
  id: string;
  title: string;
  category: string;
  device: string | null;
  content: string;
  updatedAt: string;
};

export type OperationsGuideDocument = {
  version: number;
  updatedAt: string;
  playbooks: PlaybookSection[];
  discoveredDevices: DiscoveredDeviceRecord[];
  entries: GuideEntry[];
};

export const DEFAULT_PLAYBOOKS: PlaybookSection[] = [
  {
    id: 'smartthings-api-discovery',
    title: 'SmartThings API & Live Capability Inspection',
    category: 'smartthings-api',
    summary:
      'Smart Home talks to https://api.smartthings.com/v1 through the kernel egress using the caller\'s SmartThings connection. Use home-device-inspect to read full device descriptors (/v1/devices/{id}) and live multi-component status (/v1/devices/{id}/status).',
    steps: [
      'Call home-devices (GET /api/home/devices) to check cached devices, or home-refresh (POST /api/home/refresh) to pull the latest device list from SmartThings.',
      'Call home-device-inspect (GET /api/home/device-inspect?device=<name|refrigerator|all>) to inspect every component, capability, temperature, door state, and camera attribute on a SmartThings device.',
      'Record any newly discovered device quirks, capability IDs, or operational notes with home-operations-guide-update (POST /api/home/operations-guide).',
    ],
  },
  {
    id: 'samsung-family-hub-refrigerator',
    title: 'Samsung Family Hub Refrigerator — Interior Camera (ViewInside) & Multi-Zone Status',
    category: 'appliances',
    summary:
      'Samsung Family Hub refrigerators connect through SmartThings (not Camera Ops) and expose multi-component status (main, cooler, freezer, icemaker, cvroom) plus interior camera metadata via samsungce.viewInside, imageCapture, videoStream, and execute (/udo/contents).',
    steps: [
      'Always route refrigerator, fridge camera, Family Hub, and SmartThings appliance requests to Smart Home (home-bot), never Camera Ops.',
      'Call home-device-inspect with {"device":"refrigerator"} to query /v1/devices/{id} and /v1/devices/{id}/status for the refrigerator.',
      'Check highlights.cameraCapabilities and highlights.viewInside / highlights.imageCapture: Samsung Family Hub models expose interior shelf captures via samsungce.viewInside (contents/fileIds refreshed when the door closes) or OCF execute (/udo/contents) rather than an RTSP surveillance stream.',
      'Check highlights.temperatures and highlights.doors for live cooler/freezer temperatures (°F/°C), setpoints, and door open/closed contact states.',
    ],
  },
  {
    id: 'runbook-continuous-learning',
    title: 'Keeping the Smart Home Runbook Updated',
    category: 'runbook',
    summary:
      'Both Jarvis and home-bot can read and update this Operations Guide without needing Developer Mode code changes.',
    steps: [
      'Read the current Operations Guide with home-operations-guide (GET /api/home/operations-guide).',
      'Persist new findings, device nicknames, capability notes, or troubleshooting steps with home-operations-guide-update (POST /api/home/operations-guide).',
    ],
  },
];

const memoryGuides = new Map<string, OperationsGuideDocument>();

function resolveGuideDir(): string {
  const configured = (process.env.OSHAL_PACKAGE_DATA_DIR || '').trim();
  if (configured) return configured;
  return path.join(os.tmpdir(), 'oshal-home-package-data');
}

function safeOwnerKey(sub?: string | null): string {
  const cleaned = String(sub || 'default').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return cleaned || 'default';
}

function guideFilePath(sub?: string | null): string {
  const dir = resolveGuideDir();
  const key = safeOwnerKey(sub);
  return path.join(dir, key === 'default' ? 'operations-guide.json' : `operations-guide-${key}.json`);
}

function createSeededDocument(): OperationsGuideDocument {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    playbooks: DEFAULT_PLAYBOOKS,
    discoveredDevices: [],
    entries: [
      {
        id: 'seed-family-hub-camera-note',
        title: 'Samsung Family Hub Fridge Camera & SmartThings Routing',
        category: 'appliances',
        device: 'refrigerator',
        content:
          'SmartThings appliances and Samsung Family Hub refrigerators are managed in Smart Home. Use home-device-inspect (GET /api/home/device-inspect?device=refrigerator) to inspect live component capabilities (samsungce.viewInside, imageCapture, refrigeration, custom.fridgeMode, temperatureMeasurement, thermostatCoolingSetpoint, contactSensor).',
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

export function readOperationsGuide(sub?: string | null): OperationsGuideDocument {
  const key = safeOwnerKey(sub);
  const file = guideFilePath(sub);
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<OperationsGuideDocument>;
      const doc: OperationsGuideDocument = {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        playbooks: Array.isArray(parsed.playbooks) && parsed.playbooks.length > 0 ? parsed.playbooks : DEFAULT_PLAYBOOKS,
        discoveredDevices: Array.isArray(parsed.discoveredDevices) ? parsed.discoveredDevices : [],
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
      memoryGuides.set(key, doc);
      return doc;
    }
  } catch {
    // Fall back to in-memory or seeded document when disk is unavailable.
  }
  const existing = memoryGuides.get(key);
  if (existing) return existing;
  const seeded = createSeededDocument();
  memoryGuides.set(key, seeded);
  return seeded;
}

function writeOperationsGuide(sub: string | null | undefined, doc: OperationsGuideDocument): OperationsGuideDocument {
  const key = safeOwnerKey(sub);
  doc.updatedAt = new Date().toISOString();
  memoryGuides.set(key, doc);
  const file = guideFilePath(sub);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
  } catch {
    // Keep in-memory state if package data dir is not writable in a test sandbox.
  }
  return doc;
}

export function recordDiscoveredDevices(sub: string | null | undefined, rawDevices: Array<Record<string, unknown>>): OperationsGuideDocument {
  const doc = readOperationsGuide(sub);
  if (!Array.isArray(rawDevices) || rawDevices.length === 0) return doc;
  const byKey = new Map<string, DiscoveredDeviceRecord>(doc.discoveredDevices.map((d) => [d.key, d]));
  const now = new Date().toISOString();
  for (const raw of rawDevices.slice(0, 100)) {
    const name = String(raw.userName || raw.name || raw.label || '(unnamed)').slice(0, 160);
    const key = String(raw.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device').slice(0, 120);
    const sources = Array.isArray(raw.sources) ? (raw.sources as Array<Record<string, unknown>>) : [];
    const deviceId = raw.deviceId ? String(raw.deviceId) : sources[0]?.deviceId ? String(sources[0].deviceId) : byKey.get(key)?.deviceId || null;
    const components = Array.isArray(raw.components) ? (raw.components as Array<Record<string, unknown>>) : [];
    const compCaps = components.flatMap((c) => (Array.isArray(c.capabilities) ? (c.capabilities as string[]) : []));
    const rawCaps = Array.isArray(raw.capabilities) ? (raw.capabilities as string[]) : [];
    const capabilities = Array.from(new Set([...rawCaps, ...compCaps].map((c) => String(c)).filter(Boolean))).slice(0, 60);
    const compCats = components.flatMap((c) => (Array.isArray(c.categories) ? (c.categories as string[]) : []));
    const rawCats = Array.isArray(raw.categories) ? (raw.categories as string[]) : [];
    const categories = Array.from(new Set([...rawCats, ...compCats].map((c) => String(c)).filter(Boolean))).slice(0, 20);
    const cameraCapabilities = capabilities.filter((c) => /viewInside|imageCapture|videoStream|camera/i.test(c));
    const prior = byKey.get(key);
    byKey.set(key, {
      key,
      deviceId,
      name,
      manufacturerName: raw.manufacturerName ? String(raw.manufacturerName) : prior?.manufacturerName || null,
      categories: categories.length ? categories : prior?.categories || [],
      capabilities: capabilities.length ? capabilities : prior?.capabilities || [],
      cameraCapabilities: cameraCapabilities.length ? cameraCapabilities : prior?.cameraCapabilities || [],
      hasInteriorCameraCapability: cameraCapabilities.length > 0 || Boolean(prior?.hasInteriorCameraCapability),
      highlights: (raw.highlights as Record<string, unknown>) || prior?.highlights || null,
      lastSeenAt: now,
    });
  }
  doc.discoveredDevices = Array.from(byKey.values()).slice(0, 100);
  return writeOperationsGuide(sub, doc);
}

export function updateOperationsGuideEntry(
  sub: string | null | undefined,
  input: { id?: unknown; title?: unknown; category?: unknown; device?: unknown; content?: unknown; note?: unknown },
): { ok: boolean; error?: string; entry?: GuideEntry; guide?: OperationsGuideDocument } {
  const content = String(input.content || input.note || '').trim().slice(0, 4000);
  const title = String(input.title || (input.device ? `Device note: ${input.device}` : 'Operational note')).trim().slice(0, 200);
  if (!content) {
    return { ok: false, error: 'content_required' };
  }
  const category = String(input.category || 'operations').trim().slice(0, 80) || 'operations';
  const device = input.device ? String(input.device).trim().slice(0, 120) : null;
  const id = String(input.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `note-${Date.now()}`).slice(0, 120);
  const doc = readOperationsGuide(sub);
  const entry: GuideEntry = {
    id,
    title,
    category,
    device,
    content,
    updatedAt: new Date().toISOString(),
  };
  const idx = doc.entries.findIndex((e) => e.id === id || e.title.toLowerCase() === title.toLowerCase());
  if (idx >= 0) doc.entries[idx] = entry;
  else doc.entries.unshift(entry);
  doc.entries = doc.entries.slice(0, 100);
  const saved = writeOperationsGuide(sub, doc);
  return { ok: true, entry, guide: saved };
}

export function buildOperationsGuideSummary(sub?: string | null): {
  detail: string;
  playbooksCount: number;
  entriesCount: number;
  discoveredDeviceCount: number;
  discoveredDevices: Array<{ key: string; name: string; capabilities: string[]; cameraCapabilities: string[] }>;
  recentEntries: Array<{ title: string; device: string | null; content: string }>;
} {
  const doc = readOperationsGuide(sub);
  const discovered = doc.discoveredDevices.slice(0, 15).map((d) => ({
    key: d.key,
    name: d.name,
    capabilities: d.capabilities.slice(0, 20),
    cameraCapabilities: d.cameraCapabilities,
  }));
  const recentEntries = doc.entries.slice(0, 5).map((e) => ({
    title: e.title,
    device: e.device,
    content: e.content.slice(0, 300),
  }));
  const deviceSummary = discovered.length
    ? `Discovered devices (${discovered.length}): ` +
      discovered.map((d) => `${d.name} [${d.capabilities.slice(0, 6).join(', ') || 'indexed'}]`).join('; ')
    : 'No SmartThings devices inspected yet — use home-device-inspect or home-refresh to populate live capabilities';
  const noteSummary = recentEntries.length
    ? `Runbook notes: ${recentEntries.map((e) => `${e.title}: ${e.content}`).join(' | ')}`
    : '';
  return {
    detail: [deviceSummary, noteSummary].filter(Boolean).join('. ').slice(0, 900),
    playbooksCount: doc.playbooks.length,
    entriesCount: doc.entries.length,
    discoveredDeviceCount: doc.discoveredDevices.length,
    discoveredDevices: discovered,
    recentEntries,
  };
}
