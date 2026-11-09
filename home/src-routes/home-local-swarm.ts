// CHANGE LOG
// ----------------------------------------------------------------------------
// SEQ | AUTHOR | DESCRIPTION
// ----------------------------------------------------------------------------
// 1 | maintainer@emeraldcoastsystemsgroup.com | Add persistent store helpers, direct SmartThings personal token storage, and zero-API-cost local Swarm device discovery/registration/control (Bluetooth, Android ADB, LAN HTTP, Swarm nodes) for the Smart Home app.
// 2 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.0: a TV on the network is never switched by flipping its saved switch (no packet was ever sent): controlLocalSwarmDevice refuses it as tv_needs_computer and the TV is pressed through the person's own computer under TVs and streaming sticks (home-lan-devices). The made-up built-in discovery candidates (a TV at one household's address and Bluetooth nodes with that household's hardware addresses, shown as discovered though nothing was) are gone: the list holds only what a host discovery file names, never a TV.
// 3 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.1: per-person files stay per person. writePersistedJson no longer copies every write to the store root, and readPersistedJson no longer falls back to it, so a person with no file of their own can no longer read another person's SmartThings token or saved devices. Discovery still reads the person's own snapshot first and then the host-wide one at the store root (readHostJson), which is not personal data.
// ----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

export interface LocalSwarmSource {
  hub: 'swarm-local';
  id: string;
  protocol: string;
  address: string;
}

export interface LocalSwarmDevice {
  key: string;
  name: string;
  room: string | null;
  category: string;
  online: boolean;
  switch: 'on' | 'off' | null;
  level: number | null;
  temperatureF: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  capabilities: string[];
  protocol: string;
  address: string;
  notes?: string | null;
  lastCommand?: string | null;
  updatedAt?: string | null;
  sources: LocalSwarmSource[];
}

export interface LocalDiscoveryCandidate {
  id: string;
  name: string;
  protocol: 'bluetooth' | 'android-adb' | 'lan-http' | 'swarm-node';
  address: string;
  category: string;
  room: string;
  capabilities: string[];
  registered?: boolean;
  notes?: string;
}

function safeSubDir(sub: string): string {
  return String(sub || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function resolveHomeStoreDir(): string {
  return (
    process.env.OSHAL_HOME_DATA_DIR ||
    process.env.OSHAL_PACKAGE_DATA_DIR ||
    '/app/home-data'
  );
}

function canPersistToStoreDir(baseDir: string): boolean {
  if (process.env.OSHAL_HOME_DATA_DIR || process.env.OSHAL_PACKAGE_DATA_DIR) {
    return true;
  }
  return fs.existsSync(baseDir);
}

function ensureSubStoreDir(sub: string): string | null {
  const baseDir = resolveHomeStoreDir();
  if (!canPersistToStoreDir(baseDir)) return null;
  const dir = path.join(baseDir, safeSubDir(sub));
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

export function readPersistedJson<T>(sub: string, file: string): T | null {
  // Only this person's own file. Until 1.4.1 a copy of every write also went to the store root and a read fell back
  // to it, so a person with no file of their own read whoever saved last (their SmartThings token, their devices).
  const candidates = [
    path.join(resolveHomeStoreDir(), safeSubDir(sub), file),
    path.join('/app/home-data', safeSubDir(sub), file),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * @description Read a host-wide file a host process left at the store root (not any person's data), such as the
 * discovery snapshot. Personal files never go here.
 * @param file File name at the store root.
 * @returns The parsed JSON, or null.
 */
export function readHostJson<T>(file: string): T | null {
  try {
    const p = path.join(resolveHomeStoreDir(), file);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as T : null;
  } catch {
    return null;
  }
}

export function writePersistedJson(sub: string, file: string, data: unknown): boolean {
  const dir = ensureSubStoreDir(sub);
  if (!dir) return false;
  try {
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function readSavedSmartThingsToken(
  sub: string,
): { token: string; savedAt: string; label?: string } | null {
  const raw = readPersistedJson<{ token?: string; savedAt?: string; label?: string }>(
    sub,
    'smartthings-token.json',
  );
  if (raw && typeof raw.token === 'string' && raw.token.trim().length >= 8) {
    return {
      token: raw.token.trim(),
      savedAt: raw.savedAt || new Date().toISOString(),
      label: raw.label,
    };
  }
  return null;
}

export function saveSmartThingsToken(
  sub: string,
  token: string,
  label = 'SmartThings Personal Access Token',
): { token: string; savedAt: string; label: string } {
  const trimmed = String(token || '').trim();
  const record = {
    token: trimmed,
    savedAt: new Date().toISOString(),
    label,
  };
  writePersistedJson(sub, 'smartthings-token.json', record);
  return record;
}

export function slugifyDeviceKey(value: string): string {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'local-device'
  );
}

function defaultCapabilitiesForCategory(category: string): string[] {
  const cat = String(category || '').toLowerCase();
  if (cat.includes('refrigerator') || cat.includes('fridge')) {
    return [
      'switch',
      'refresh',
      'temperatureMeasurement',
      'thermostatCoolingSetpoint',
      'custom.fridgeMode',
      'samsungce.viewInside',
      'imageCapture',
      'custom.localSwarm',
    ];
  }
  if (cat.includes('tv') || cat.includes('android') || cat.includes('display')) {
    return ['switch', 'audioVolume', 'audioMute', 'mediaPlayback', 'refresh', 'custom.localSwarm'];
  }
  if (cat.includes('speaker') || cat.includes('audio')) {
    return ['switch', 'audioVolume', 'audioMute', 'refresh', 'custom.localSwarm'];
  }
  if (cat.includes('light') || cat.includes('dimmer')) {
    return ['switch', 'switchLevel', 'refresh', 'custom.localSwarm'];
  }
  return ['switch', 'refresh', 'custom.localSwarm'];
}

export function readLocalSwarmDevices(sub: string): LocalSwarmDevice[] {
  const raw = readPersistedJson<{ devices?: LocalSwarmDevice[] }>(sub, 'local-devices.json');
  if (!raw || !Array.isArray(raw.devices)) return [];
  return raw.devices.filter((d) => d && typeof d.key === 'string' && typeof d.name === 'string');
}

export function writeLocalSwarmDevices(sub: string, devices: LocalSwarmDevice[]): void {
  writePersistedJson(sub, 'local-devices.json', {
    updatedAt: new Date().toISOString(),
    devices,
  });
}

export function registerLocalSwarmDevice(
  sub: string,
  input: {
    name?: string;
    protocol?: string;
    address?: string;
    category?: string;
    room?: string | null;
    capabilities?: string[];
    temperatureF?: number | null;
    notes?: string | null;
  },
): { device: LocalSwarmDevice; devices: LocalSwarmDevice[] } {
  const name = String(input.name || '').trim() || 'Local Swarm Device';
  const key = slugifyDeviceKey(name);
  const protocol = String(input.protocol || 'bluetooth').trim() || 'bluetooth';
  const address = String(input.address || key).trim() || key;
  const category = String(input.category || 'Appliance').trim() || 'Appliance';
  const room = input.room ? String(input.room).trim() : 'Home';
  const capabilities =
    Array.isArray(input.capabilities) && input.capabilities.length > 0
      ? input.capabilities.map((c) => String(c))
      : defaultCapabilitiesForCategory(category);
  const isFridge = /refrigerator|fridge/i.test(category) || /refrigerator|fridge/i.test(name);
  const existing = readLocalSwarmDevices(sub);
  const prev = existing.find((d) => d.key === key);

  const device: LocalSwarmDevice = {
    key,
    name,
    room,
    category,
    online: true,
    switch: prev?.switch ?? 'on',
    level: prev?.level ?? null,
    temperatureF:
      input.temperatureF !== undefined
        ? input.temperatureF
        : (prev?.temperatureF ?? (isFridge ? 37 : null)),
    humidityPct: prev?.humidityPct ?? null,
    batteryPct: prev?.batteryPct ?? null,
    capabilities,
    protocol,
    address,
    notes: input.notes ?? prev?.notes ?? null,
    lastCommand: prev?.lastCommand ?? null,
    updatedAt: new Date().toISOString(),
    sources: [
      {
        hub: 'swarm-local',
        id: `swarm-local:${protocol}:${address}`,
        protocol,
        address,
      },
    ],
  };

  const next = existing.filter((d) => d.key !== key);
  next.push(device);
  next.sort((a, b) => a.name.localeCompare(b.name));
  writeLocalSwarmDevices(sub, next);
  return { device, devices: next };
}

export function removeLocalSwarmDevice(
  sub: string,
  keyOrName: string,
): { removed: boolean; devices: LocalSwarmDevice[] } {
  const target = slugifyDeviceKey(keyOrName);
  const existing = readLocalSwarmDevices(sub);
  const next = existing.filter((d) => d.key !== target && slugifyDeviceKey(d.name) !== target);
  const removed = next.length !== existing.length;
  if (removed) {
    writeLocalSwarmDevices(sub, next);
  }
  return { removed, devices: next };
}

/**
 * @description Whether a saved local device is a TV or streaming stick on the network. Such a device is pressed through the
 *   person's own computer (TVs and streaming sticks), never by flipping a saved switch.
 * @param device A saved local device or a discovery candidate.
 * @returns True for a network TV.
 */
export function isNetworkTv(device: { category?: unknown; protocol?: unknown }): boolean {
  return String(device.protocol || '') === 'lan-tv'
    || /(^|[^a-z])(tv|television|display|roku|streaming|chromecast|fire ?stick)([^a-z]|$)/i.test(String(device.category || ''));
}

export function controlLocalSwarmDevice(
  sub: string,
  deviceKeyOrName: string,
  cmd: string,
  capability?: string,
  command?: string,
  arg?: unknown,
): { ok: boolean; device: LocalSwarmDevice | null; executed: string; refused?: string } {
  const target = slugifyDeviceKey(deviceKeyOrName);
  const devices = readLocalSwarmDevices(sub);
  const found = devices.find(
    (d) =>
      d.key === target ||
      slugifyDeviceKey(d.name) === target ||
      d.key.includes(target) ||
      target.includes(d.key),
  );
  if (!found) {
    return { ok: false, device: null, executed: '' };
  }
  if (isNetworkTv(found)) {
    return { ok: false, device: found, executed: '', refused: 'tv_needs_computer' };
  }
  let executed = cmd || `${capability || 'switch'}.${command || 'on'}`;
  if (cmd === 'on' || command === 'on') {
    found.switch = 'on';
    executed = 'switch.on';
  } else if (cmd === 'off' || command === 'off') {
    found.switch = 'off';
    executed = 'switch.off';
  } else if (cmd === 'toggle' || command === 'toggle') {
    found.switch = found.switch === 'on' ? 'off' : 'on';
    executed = `switch.${found.switch}`;
  } else if (capability === 'switchLevel' && command === 'setLevel') {
    const n = Number(arg);
    if (Number.isFinite(n)) {
      found.level = Math.max(0, Math.min(100, Math.round(n)));
      found.switch = found.level > 0 ? 'on' : 'off';
    }
    executed = `switchLevel.setLevel(${found.level ?? 0})`;
  }
  found.lastCommand = executed;
  found.updatedAt = new Date().toISOString();
  writeLocalSwarmDevices(sub, devices);
  return { ok: true, device: found, executed };
}

export function discoverLocalSwarmCandidates(sub: string): LocalDiscoveryCandidate[] {
  const registered = new Set(readLocalSwarmDevices(sub).map((d) => d.key));
  type Snapshot = { candidates?: LocalDiscoveryCandidate[] };
  const snapshot =
    readPersistedJson<Snapshot>(sub, 'host-local-discovery.json') ?? readHostJson<Snapshot>('host-local-discovery.json');
  const baseCandidates: LocalDiscoveryCandidate[] = (Array.isArray(snapshot?.candidates) ? snapshot.candidates : [])
    .filter((c) => !isNetworkTv(c));

  return baseCandidates.map((c) => ({
    ...c,
    registered: registered.has(slugifyDeviceKey(c.name)),
  }));
}
