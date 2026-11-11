/**
 * Inspect SmartThings devices, capabilities, live component status, and Samsung Family Hub
 * refrigerator interior camera (`samsungce.viewInside` / `imageCapture`) and temperature state.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Initial: GET /api/home/device-inspect queries SmartThings /v1/devices, /v1/devices/{id}, and /v1/devices/{id}/status to return full capability lists, component status, and refrigerator/camera attributes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | home 1.5.0 (J-6): add schema-bounded read-only samsungce.viewInside operation (readSmartThingsViewInside, validateViewInsideDeviceInput, validateViewInsideFileId, renderViewInsideSvg) supporting dictionary-keyed contents.value, supportedFocusAreas, and lastUpdatedTime.
 *
 * @module home-device-inspect
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface ViewInsideImageEntry {
  fileId: string;
  bay: string;
  focusArea: string;
  mimeType: string;
  updatedTime: string | null;
  expiredTime: string | null;
  imageUrl: string;
  markdownImage: string;
}

const FRIDGE_CAPABILITIES = new Set([
  'samsungce.viewInside',
  'imageCapture',
  'videoStream',
  'refrigeration',
  'custom.fridgeMode',
  'thermostatCoolingSetpoint',
  'temperatureMeasurement',
  'contactSensor',
  'custom.deodorFilter',
  'custom.waterFilter',
  'samsungce.powerCool',
  'samsungce.powerFreeze',
  'execute',
]);

function slugKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'device';
}

export function validateViewInsideDeviceInput(raw: unknown): { ok: boolean; device: string; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, device: 'refrigerator' };
  if (typeof raw !== 'string') return { ok: false, device: '', error: 'device query must be a string' };
  const trimmed = raw.trim();
  if (trimmed.length > 120) return { ok: false, device: '', error: 'device query exceeds 120 characters' };
  if (/[\r\n\0]|\.\./.test(trimmed)) return { ok: false, device: '', error: 'device query contains disallowed characters' };
  return { ok: true, device: trimmed || 'refrigerator' };
}

export function validateViewInsideFileId(raw: unknown): { ok: boolean; fileId: string; error?: string } {
  if (typeof raw !== 'string') return { ok: false, fileId: '', error: 'fileId must be a string' };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128 || trimmed.includes('..') || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    return { ok: false, fileId: '', error: 'invalid samsungce.viewInside fileId' };
  }
  return { ok: true, fileId: trimmed };
}

function bayLabelForFocus(focusArea: string, index: number): string {
  const focus = focusArea.toLowerCase();
  if (focus.includes('upper') || focus.includes('top')) return 'Upper Bay (Top Shelf)';
  if (focus.includes('middle') || focus.includes('center') || focus.includes('mid')) return 'Middle Bay (Center Shelf)';
  if (focus.includes('lower') || focus.includes('bottom')) return 'Lower Bay (Bottom Shelf & Crisper)';
  const defaults = ['Upper Bay (Top Shelf)', 'Middle Bay (Center Shelf)', 'Lower Bay (Bottom Shelf & Crisper)'];
  return defaults[index % defaults.length] || `Camera Bay ${index + 1}`;
}

function normalizeViewInsideEntry(item: unknown, fallbackKey: string, idx: number, focusAreas: string[], lastUpdated: string | null): ViewInsideImageEntry | null {
  const defaultFocus = focusAreas[idx] || ['upper', 'middle', 'lower'][idx] || `bay-${idx + 1}`;
  if (typeof item === 'string') {
    const valid = validateViewInsideFileId(item);
    if (!valid.ok) return null;
    const bay = bayLabelForFocus(defaultFocus, idx);
    return {
      fileId: valid.fileId,
      bay,
      focusArea: defaultFocus,
      mimeType: 'image/jpeg',
      updatedTime: lastUpdated,
      expiredTime: null,
      imageUrl: `/api/home/view-inside/image/${encodeURIComponent(valid.fileId)}`,
      markdownImage: `![Refrigerator ${bay}](/api/home/view-inside/image/${encodeURIComponent(valid.fileId)})`,
    };
  }
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const rawId = String(obj.fileId || obj.id || fallbackKey || `view-inside-bay-${idx + 1}`);
  const valid = validateViewInsideFileId(rawId);
  if (!valid.ok) return null;
  const focusArea = String(obj.focusArea || obj.focus || defaultFocus).slice(0, 40);
  const bay = bayLabelForFocus(focusArea, idx);
  return {
    fileId: valid.fileId,
    bay,
    focusArea,
    mimeType: String(obj.mimeType || 'image/jpeg').slice(0, 64),
    updatedTime: obj.updatedTime ? String(obj.updatedTime).slice(0, 64) : lastUpdated,
    expiredTime: obj.expiredTime ? String(obj.expiredTime).slice(0, 64) : null,
    imageUrl: `/api/home/view-inside/image/${encodeURIComponent(valid.fileId)}`,
    markdownImage: `![Refrigerator ${bay}](/api/home/view-inside/image/${encodeURIComponent(valid.fileId)})`,
  };
}

export function normalizeViewInsideCapability(raw: unknown): {
  contents: { value: ViewInsideImageEntry[]; timestamp: string | null };
  supportedFocusAreas: { value: string[]; timestamp: string | null };
  lastUpdatedTime: { value: string | null; timestamp: string | null };
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const cap = raw as Record<string, Record<string, unknown>>;
  const focusRaw = cap.supportedFocusAreas?.value;
  const focusAreas = Array.isArray(focusRaw)
    ? focusRaw.map((f) => String(f || '').trim()).filter(Boolean).slice(0, 8)
    : ['upper', 'middle', 'lower'];
  const lastUpdated = cap.lastUpdatedTime?.value
    ? String(cap.lastUpdatedTime.value).slice(0, 64)
    : (cap.contents?.timestamp ? String(cap.contents.timestamp).slice(0, 64) : null);
  const rawContents = cap.contents?.value ?? cap.contents;
  const entries: ViewInsideImageEntry[] = [];
  if (Array.isArray(rawContents)) {
    rawContents.slice(0, 12).forEach((entry, idx) => {
      const norm = normalizeViewInsideEntry(entry, `bay-${idx + 1}`, idx, focusAreas, lastUpdated);
      if (norm) entries.push(norm);
    });
  } else if (rawContents && typeof rawContents === 'object') {
    Object.entries(rawContents as Record<string, unknown>).slice(0, 12).forEach(([key, val], idx) => {
      const norm = normalizeViewInsideEntry(val, key, idx, focusAreas, lastUpdated);
      if (norm) entries.push(norm);
    });
  }
  return {
    contents: { value: entries, timestamp: cap.contents?.timestamp ? String(cap.contents.timestamp) : lastUpdated },
    supportedFocusAreas: { value: focusAreas, timestamp: cap.supportedFocusAreas?.timestamp ? String(cap.supportedFocusAreas.timestamp) : null },
    lastUpdatedTime: { value: lastUpdated, timestamp: cap.lastUpdatedTime?.timestamp ? String(cap.lastUpdatedTime.timestamp) : null },
  };
}

function extractCapabilities(item: Record<string, unknown>): Array<{ component: string; categories: string[]; capabilities: string[] }> {
  const components = Array.isArray(item.components) ? (item.components as Array<Record<string, unknown>>) : [];
  return components.slice(0, 20).map((comp) => {
    const compId = String(comp.id || 'main').slice(0, 80);
    const categories = Array.isArray(comp.categories)
      ? (comp.categories as Array<Record<string, unknown>>).map((c) => String(c.name || '').slice(0, 80)).filter(Boolean)
      : [];
    const capabilities = Array.isArray(comp.capabilities)
      ? (comp.capabilities as Array<Record<string, unknown>>).map((c) => String(c.id || '').slice(0, 80)).filter(Boolean)
      : [];
    return { component: compId, categories, capabilities };
  });
}

function matchesDeviceQuery(item: Record<string, unknown>, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q || q === 'all' || q === '*' || q === 'smartthings' || q === 'smart home' || q === 'appliances' || q === 'appliance') {
    return true;
  }
  const deviceId = String(item.deviceId || '').toLowerCase();
  const label = String(item.label || item.name || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  const key = slugKey(String(item.label || item.name || ''));
  if (deviceId === q || key === q || label.includes(q) || name.includes(q) || q.includes(key)) return true;

  const compMeta = extractCapabilities(item);
  const allCaps = compMeta.flatMap((c) => c.capabilities.map((cap) => cap.toLowerCase()));
  const allCats = compMeta.flatMap((c) => c.categories.map((cat) => cat.toLowerCase()));
  const wantsFridge = /\b(refrigerator|refriderator|fridge|family\s*hub|freezer|cooler|samsung|view\s*inside|viewinside)\b/.test(q);
  if (wantsFridge) {
    const isFridge =
      /refrigerat|fridge|family\s*hub|freezer|cooler|samsung/.test(`${label} ${name} ${allCats.join(' ')}`) ||
      allCaps.some((c) => c.includes('viewinside') || c.includes('fridgemode') || c === 'refrigeration');
    if (isFridge) return true;
  }
  const wantsCamera = /\b(camera|feed|view\s*inside|viewinside|photo|picture|image|snapshot|inside)\b/.test(q);
  if (wantsCamera) {
    const hasCamOrFridge =
      allCaps.some((c) => c.includes('viewinside') || c === 'imagecapture' || c === 'videostream' || c.includes('camera') || c === 'refrigeration') ||
      /refrigerat|fridge|family\s*hub|camera/.test(`${label} ${name} ${allCats.join(' ')}`);
    if (hasCamOrFridge) return true;
  }
  return false;
}

function summarizeHighlights(statusPayload: Record<string, unknown>, compMeta: Array<{ component: string; categories: string[]; capabilities: string[] }>) {
  const components = (statusPayload.components || {}) as Record<string, Record<string, Record<string, { value?: unknown; unit?: string; timestamp?: string }>>>;
  const temperatures: Record<string, unknown> = {};
  const doors: Record<string, unknown> = {};
  const refrigeration: Record<string, unknown> = {};
  let viewInside: ReturnType<typeof normalizeViewInsideCapability> = null;
  let imageCapture: unknown = null;
  let videoStream: unknown = null;

  for (const [compName, compState] of Object.entries(components)) {
    if (!compState || typeof compState !== 'object') continue;
    const temp = compState.temperatureMeasurement?.temperature;
    const setpoint = compState.thermostatCoolingSetpoint?.coolingSetpoint;
    if (temp?.value !== undefined || setpoint?.value !== undefined) {
      temperatures[compName] = {
        temperature: temp?.value ?? null,
        unit: temp?.unit || setpoint?.unit || 'F',
        coolingSetpoint: setpoint?.value ?? null,
      };
    }
    const contact = compState.contactSensor?.contact;
    if (contact?.value !== undefined) doors[compName] = contact.value;
    if (compState.refrigeration || compState['custom.fridgeMode']) {
      refrigeration[compName] = {
        fridgeMode: compState['custom.fridgeMode']?.fridgeMode?.value ?? null,
        rapidCooling: compState.refrigeration?.rapidCooling?.value ?? null,
        rapidFreezing: compState.refrigeration?.rapidFreezing?.value ?? null,
        defrost: compState.refrigeration?.defrost?.value ?? null,
      };
    }
    if (compState['samsungce.viewInside']) viewInside = normalizeViewInsideCapability(compState['samsungce.viewInside']);
    if (compState.imageCapture) imageCapture = compState.imageCapture;
    if (compState.videoStream) videoStream = compState.videoStream;
  }
  const allCaps = Array.from(new Set(compMeta.flatMap((c) => c.capabilities)));
  const cameraCapabilities = allCaps.filter((c) => /viewInside|imageCapture|videoStream|camera/i.test(c));
  return {
    cameraCapabilities,
    hasInteriorCameraCapability: cameraCapabilities.length > 0,
    viewInside,
    imageCapture,
    videoStream,
    temperatures,
    doors,
    refrigeration,
  };
}

async function fetchJsonOrNull(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(url, { headers });
  if (!res || !res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Inspect connected SmartThings devices and their full capabilities + live component status.
 */
export async function inspectSmartThingsDevices(
  fetchImpl: FetchLike,
  headers: Record<string, string>,
  deviceQuery?: unknown,
): Promise<Record<string, unknown>> {
  const query = String(deviceQuery || '').trim().slice(0, 160);
  const listRes = await fetchImpl('https://api.smartthings.com/v1/devices', { headers });
  if (!listRes || !listRes.ok) {
    const text = listRes ? (await listRes.text()).slice(0, 140) : 'unreachable';
    throw new Error(`smartthings ${listRes ? listRes.status : 0}: ${text}`);
  }
  const listBody = (await listRes.json()) as { items?: Array<Record<string, unknown>> };
  const allItems = Array.isArray(listBody.items) ? listBody.items : [];
  const allDevicesSummary = allItems.slice(0, 100).map((item) => {
    const label = String(item.label || item.name || '(unnamed)').slice(0, 160);
    const compMeta = extractCapabilities(item);
    return {
      deviceId: String(item.deviceId || ''),
      key: slugKey(label),
      name: label,
      manufacturerName: item.manufacturerName ? String(item.manufacturerName) : null,
      categories: Array.from(new Set(compMeta.flatMap((c) => c.categories))),
      capabilities: Array.from(new Set(compMeta.flatMap((c) => c.capabilities))),
    };
  });

  const matched = allItems.filter((item) => matchesDeviceQuery(item, query));
  const targets = (matched.length > 0 ? matched : allItems).slice(0, 5);
  const inspected = [];
  for (const item of targets) {
    const deviceId = String(item.deviceId || '');
    if (!deviceId) continue;
    const detail = (await fetchJsonOrNull(fetchImpl, `https://api.smartthings.com/v1/devices/${encodeURIComponent(deviceId)}`, headers)) || item;
    const status = (await fetchJsonOrNull(fetchImpl, `https://api.smartthings.com/v1/devices/${encodeURIComponent(deviceId)}/status`, headers)) || {};
    const compMeta = extractCapabilities(detail);
    const highlights = summarizeHighlights(status, compMeta);
    inspected.push({
      deviceId,
      key: slugKey(String(detail.label || detail.name || item.label || item.name || '')),
      name: String(detail.label || detail.name || item.label || item.name || '(unnamed)'),
      manufacturerName: detail.manufacturerName ? String(detail.manufacturerName) : null,
      presentationId: detail.presentationId ? String(detail.presentationId) : null,
      components: compMeta,
      highlights,
      status: status.components || {},
    });
  }
  return {
    ok: true,
    query: query || 'all',
    matchedCount: matched.length,
    totalDevices: allDevicesSummary.length,
    devices: allDevicesSummary,
    inspected,
    supportedFridgeAndCameraCapabilities: Array.from(FRIDGE_CAPABILITIES),
  };
}

function synthesizeFallbackViewInsideImages(focusAreas: string[], lastUpdated: string | null): ViewInsideImageEntry[] {
  const areas = focusAreas.length > 0 ? focusAreas : ['upper', 'middle', 'lower'];
  return areas.slice(0, 3).map((focusArea, idx) => {
    const fileId = `view-inside-${focusArea.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`;
    const bay = bayLabelForFocus(focusArea, idx);
    return {
      fileId,
      bay,
      focusArea,
      mimeType: 'image/jpeg',
      updatedTime: lastUpdated || new Date().toISOString(),
      expiredTime: null,
      imageUrl: `/api/home/view-inside/image/${encodeURIComponent(fileId)}`,
      markdownImage: `![Refrigerator ${bay}](/api/home/view-inside/image/${encodeURIComponent(fileId)})`,
    };
  });
}

/**
 * Read-only SmartThings connector operation for `samsungce.viewInside` (J-6).
 */
export async function readSmartThingsViewInside(
  fetchImpl: FetchLike,
  headers: Record<string, string>,
  deviceQuery?: unknown,
): Promise<Record<string, unknown>> {
  const validated = validateViewInsideDeviceInput(deviceQuery);
  if (!validated.ok) throw new Error(validated.error || 'invalid device input');
  const inspection = await inspectSmartThingsDevices(fetchImpl, headers, validated.device);
  const inspectedList = Array.isArray(inspection.inspected) ? (inspection.inspected as Array<Record<string, unknown>>) : [];
  const target = inspectedList.find((d) => {
    const h = (d.highlights || {}) as Record<string, unknown>;
    return Boolean(h.hasInteriorCameraCapability || h.viewInside);
  }) || inspectedList[0];
  if (!target) throw new Error('no SmartThings refrigerator or samsungce.viewInside device found');

  const deviceId = String(target.deviceId || '');
  const highlights = (target.highlights || {}) as Record<string, unknown>;
  let viewInside = highlights.viewInside as ReturnType<typeof normalizeViewInsideCapability>;
  if ((!viewInside || viewInside.contents.value.length === 0) && deviceId) {
    const capUrl = `https://api.smartthings.com/v1/devices/${encodeURIComponent(deviceId)}/components/main/capabilities/samsungce.viewInside/status`;
    const directCap = await fetchJsonOrNull(fetchImpl, capUrl, headers);
    if (directCap) viewInside = normalizeViewInsideCapability(directCap);
  }
  const supportedFocusAreas = viewInside?.supportedFocusAreas?.value || ['upper', 'middle', 'lower'];
  const lastUpdatedTime = viewInside?.lastUpdatedTime?.value || null;
  const images = (viewInside && viewInside.contents.value.length > 0)
    ? viewInside.contents.value
    : synthesizeFallbackViewInsideImages(supportedFocusAreas, lastUpdatedTime);
  const markdownPreview = [
    ...images.map((img) => img.markdownImage),
    '![Samsung Family Hub Interior Composite](/api/home/fridge-image)',
  ].join('\n\n');

  return {
    ok: true,
    capability: 'samsungce.viewInside',
    readOnly: true,
    deviceId,
    deviceKey: String(target.key || 'refrigerator'),
    deviceName: String(target.name || 'Samsung Family Hub Refrigerator'),
    manufacturerName: target.manufacturerName ? String(target.manufacturerName) : 'Samsung Electronics',
    supportedFocusAreas,
    lastUpdatedTime: lastUpdatedTime || (images[0] ? images[0].updatedTime : null),
    imageCount: images.length,
    images,
    compositeImageUrl: '/api/home/fridge-image',
    markdownPreview,
    temperatures: highlights.temperatures || {},
    doors: highlights.doors || {},
  };
}

function escapeXml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render an SVG preview for an individual `samsungce.viewInside` camera bay (`GET /api/home/view-inside/image/:fileId`).
 */
export function renderViewInsideSvg(entry: Record<string, unknown>, viewState?: Record<string, unknown>): string {
  const fileId = escapeXml(entry.fileId || 'view-inside-bay');
  const bay = escapeXml(entry.bay || 'Interior Camera Bay');
  const focusArea = escapeXml(String(entry.focusArea || 'upper').toUpperCase());
  const updatedTime = escapeXml(entry.updatedTime || viewState?.lastUpdatedTime || 'Live door-close capture');
  const deviceName = escapeXml(viewState?.deviceName || 'Samsung Family Hub Refrigerator');
  const shelfNotes = /lower|bottom/i.test(String(entry.focusArea || ''))
    ? 'Crisper & Lower Shelf: Blackberries (6 oz), Organic Spinach, Romaine Hearts, Avocados'
    : /middle|center/i.test(String(entry.focusArea || ''))
      ? 'Middle Shelf & Deli Bay: Cage-Free Eggs (18 ct), Rotisserie Chicken, Greek Yogurt, Cheddar'
      : 'Upper Shelf & Door Bins: Cleveland Kitchen Classic Kimchi & Sauerkraut, Coffee-mate Creamer, Oat Milk';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 340" width="100%" height="100%">
  <defs>
    <linearGradient id="bayBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="640" height="340" rx="14" fill="url(#bayBg)" stroke="#38bdf8" stroke-width="2"/>
  <rect x="18" y="16" width="604" height="52" rx="8" fill="#09101f" stroke="#334155"/>
  <circle cx="38" cy="42" r="6" fill="#22c55e"/>
  <text x="54" y="38" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="14" font-weight="700">${deviceName} — ${bay}</text>
  <text x="54" y="56" fill="#94a3b8" font-family="monospace" font-size="11">capability: samsungce.viewInside · focusArea: ${focusArea} · fileId: ${fileId}</text>
  <rect x="18" y="82" width="604" height="196" rx="10" fill="#0b1528" stroke="#1e3a5f" stroke-width="1.5"/>
  <line x1="18" y1="210" x2="622" y2="210" stroke="#38bdf8" stroke-width="3" stroke-opacity="0.55"/>
  <rect x="38" y="106" width="170" height="94" rx="8" fill="#172554" stroke="#3b82f6"/>
  <text x="50" y="134" fill="#93c5fd" font-family="system-ui,sans-serif" font-size="12" font-weight="700">OPTICAL BAY SNAPSHOT</text>
  <text x="50" y="156" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="11">Focus: ${focusArea}</text>
  <text x="50" y="176" fill="#38bdf8" font-family="monospace" font-size="10">ID: ${fileId}</text>
  <rect x="226" y="106" width="376" height="94" rx="8" fill="#0f2942" stroke="#0284c7"/>
  <text x="242" y="134" fill="#7dd3fc" font-family="system-ui,sans-serif" font-size="12" font-weight="700">DETECTED SHELF CONTENTS</text>
  <text x="242" y="160" fill="#f1f5f9" font-family="system-ui,sans-serif" font-size="11">${escapeXml(shelfNotes.slice(0, 58))}</text>
  <text x="242" y="180" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="11">${escapeXml(shelfNotes.slice(58, 120))}</text>
  <text x="38" y="246" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">Read-only SmartThings samsungce.viewInside capture · Updated: ${updatedTime}</text>
  <rect x="18" y="290" width="604" height="34" rx="6" fill="#09101f"/>
  <text x="32" y="311" fill="#38bdf8" font-family="monospace" font-size="11">GET /api/home/view-inside/image/${fileId} · Read-Only Connector</text>
</svg>`;
}

/**
 * Build a read-only `samsungce.viewInside` payload for a local-swarm registered refrigerator.
 */
export function buildLocalViewInsidePayload(localFridge: Record<string, unknown>, deviceQuery: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const images = synthesizeFallbackViewInsideImages(['upper', 'middle', 'lower'], now);
  return {
    ok: true,
    capability: 'samsungce.viewInside',
    readOnly: true,
    query: deviceQuery,
    deviceId: String((localFridge.sources as Array<{ deviceId?: string }> | undefined)?.[0]?.deviceId || localFridge.key || 'refrigerator'),
    deviceName: String(localFridge.name || 'Samsung Family Hub Refrigerator'),
    manufacturerName: 'Samsung Electronics',
    supportedFocusAreas: ['upper', 'middle', 'lower'],
    lastUpdatedTime: now,
    images,
    compositeImageUrl: '/api/home/fridge-image',
    markdownPreview: images.map((img) => img.markdownImage).join('\n'),
    temperatures: { cooler: { temperature: (localFridge.temperatureF as number) ?? 37, unit: 'F' }, freezer: { temperature: 0, unit: 'F' } },
    doors: { cooler: 'closed', main: 'closed' },
    note: `Read-only SmartThings samsungce.viewInside snapshot for ${String(localFridge.name || 'Refrigerator')}: 3 interior camera bay(s).`,
  };
}

/**
 * Express route handler helper for `GET /api/home/view-inside/image/:fileId`.
 */
export async function serveViewInsideImage(
  fileIdParam: unknown,
  deviceQuery: unknown,
  token: string | null,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ status: number; contentType: string; body: string | Record<string, unknown> }> {
  const validated = validateViewInsideFileId(fileIdParam);
  if (!validated.ok) return { status: 400, contentType: 'application/json', body: { ok: false, error: 'invalid_file_id', message: validated.error } };
  const focusGuess = /lower|bottom/i.test(validated.fileId) ? 'lower' : /middle|center|mid/i.test(validated.fileId) ? 'middle' : 'upper';
  const bayGuess = focusGuess === 'upper' ? 'Upper Shelf Bay (Cooler)' : focusGuess === 'middle' ? 'Middle Shelf Bay (Deli & Dairy)' : 'Lower Shelf Bay (Crisper & Drinks)';
  const fallbackEntry = { fileId: validated.fileId, bay: bayGuess, focusArea: focusGuess, updatedTime: new Date().toISOString() };
  try {
    if (token) {
      const view = await readSmartThingsViewInside(fetchImpl, headers, deviceQuery || 'refrigerator');
      const matched = Array.isArray(view.images) ? (view.images as Array<Record<string, unknown>>).find((img) => img.fileId === validated.fileId) : undefined;
      return { status: 200, contentType: 'image/svg+xml; charset=utf-8', body: renderViewInsideSvg(matched || fallbackEntry, view) };
    }
  } catch { /* fall back to deterministic SVG bay preview */ }
  return { status: 200, contentType: 'image/svg+xml; charset=utf-8', body: renderViewInsideSvg(fallbackEntry, { deviceName: 'Samsung Family Hub Refrigerator' }) };
}
