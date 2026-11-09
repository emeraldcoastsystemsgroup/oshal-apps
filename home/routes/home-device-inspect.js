"use strict";
/**
 * Inspect SmartThings devices, capabilities, live component status, and Samsung Family Hub
 * refrigerator interior camera (`samsungce.viewInside` / `imageCapture`) and temperature state.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Initial: GET /api/home/device-inspect queries SmartThings /v1/devices, /v1/devices/{id}, and /v1/devices/{id}/status to return full capability lists, component status, and refrigerator/camera attributes.
 *
 * @module home-device-inspect
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectSmartThingsDevices = inspectSmartThingsDevices;
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
function slugKey(label) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'device';
}
function extractCapabilities(item) {
    const components = Array.isArray(item.components) ? item.components : [];
    return components.slice(0, 20).map((comp) => {
        const compId = String(comp.id || 'main').slice(0, 80);
        const categories = Array.isArray(comp.categories)
            ? comp.categories.map((c) => String(c.name || '').slice(0, 80)).filter(Boolean)
            : [];
        const capabilities = Array.isArray(comp.capabilities)
            ? comp.capabilities.map((c) => String(c.id || '').slice(0, 80)).filter(Boolean)
            : [];
        return { component: compId, categories, capabilities };
    });
}
function matchesDeviceQuery(item, query) {
    const q = query.toLowerCase().trim();
    if (!q || q === 'all' || q === '*' || q === 'smartthings' || q === 'smart home' || q === 'appliances' || q === 'appliance') {
        return true;
    }
    const deviceId = String(item.deviceId || '').toLowerCase();
    const label = String(item.label || item.name || '').toLowerCase();
    const name = String(item.name || '').toLowerCase();
    const key = slugKey(String(item.label || item.name || ''));
    if (deviceId === q || key === q || label.includes(q) || name.includes(q) || q.includes(key))
        return true;
    const compMeta = extractCapabilities(item);
    const allCaps = compMeta.flatMap((c) => c.capabilities.map((cap) => cap.toLowerCase()));
    const allCats = compMeta.flatMap((c) => c.categories.map((cat) => cat.toLowerCase()));
    const wantsFridge = /\b(refrigerator|refriderator|fridge|family\s*hub|freezer|cooler|samsung|view\s*inside|viewinside)\b/.test(q);
    if (wantsFridge) {
        const isFridge = /refrigerat|fridge|family\s*hub|freezer|cooler|samsung/.test(`${label} ${name} ${allCats.join(' ')}`) ||
            allCaps.some((c) => c.includes('viewinside') || c.includes('fridgemode') || c === 'refrigeration');
        if (isFridge)
            return true;
    }
    const wantsCamera = /\b(camera|feed|view\s*inside|viewinside|photo|picture|image|snapshot|inside)\b/.test(q);
    if (wantsCamera) {
        const hasCamOrFridge = allCaps.some((c) => c.includes('viewinside') || c === 'imagecapture' || c === 'videostream' || c.includes('camera') || c === 'refrigeration') ||
            /refrigerat|fridge|family\s*hub|camera/.test(`${label} ${name} ${allCats.join(' ')}`);
        if (hasCamOrFridge)
            return true;
    }
    return false;
}
function summarizeHighlights(statusPayload, compMeta) {
    const components = (statusPayload.components || {});
    const temperatures = {};
    const doors = {};
    const refrigeration = {};
    let viewInside = null;
    let imageCapture = null;
    let videoStream = null;
    for (const [compName, compState] of Object.entries(components)) {
        if (!compState || typeof compState !== 'object')
            continue;
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
        if (contact?.value !== undefined)
            doors[compName] = contact.value;
        if (compState.refrigeration || compState['custom.fridgeMode']) {
            refrigeration[compName] = {
                fridgeMode: compState['custom.fridgeMode']?.fridgeMode?.value ?? null,
                rapidCooling: compState.refrigeration?.rapidCooling?.value ?? null,
                rapidFreezing: compState.refrigeration?.rapidFreezing?.value ?? null,
                defrost: compState.refrigeration?.defrost?.value ?? null,
            };
        }
        if (compState['samsungce.viewInside'])
            viewInside = compState['samsungce.viewInside'];
        if (compState.imageCapture)
            imageCapture = compState.imageCapture;
        if (compState.videoStream)
            videoStream = compState.videoStream;
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
async function fetchJsonOrNull(fetchImpl, url, headers) {
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok)
        return null;
    return await res.json();
}
/**
 * Inspect connected SmartThings devices and their full capabilities + live component status.
 */
async function inspectSmartThingsDevices(fetchImpl, headers, deviceQuery) {
    const query = String(deviceQuery || '').trim().slice(0, 160);
    const listRes = await fetchImpl('https://api.smartthings.com/v1/devices', { headers });
    if (!listRes || !listRes.ok) {
        const text = listRes ? (await listRes.text()).slice(0, 140) : 'unreachable';
        throw new Error(`smartthings ${listRes ? listRes.status : 0}: ${text}`);
    }
    const listBody = await listRes.json();
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
        if (!deviceId)
            continue;
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
