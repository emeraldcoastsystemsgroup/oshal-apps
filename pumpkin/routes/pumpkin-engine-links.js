"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 22:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: the SERVER-side device-link builder behind GET /api/pumpkin/links and GET /api/pumpkin/qr. Both routes were documented across a whole README section and both QR runbook steps but never existed, so the control surface's Projector-link card and BOTH QR images sat permanently in their degraded fallback — a URL built from the cockpit browser's own address, i.e. http://localhost:35457 on the operator's laptop, which cannot open on a phone. The browser is structurally the wrong place to build these: only the server knows the public origin (PUMPKIN_PUBLIC_ORIGIN → APP_URL → the request host) and owns roomSlug(). The QR target is a CLOSED whitelist of the two pages this app serves — never a caller-supplied URL, which would turn a signed-in cockpit into a QR-phishing generator. The pairing token is never placed in a link, a QR, or a /links response.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePublicOrigin = resolvePublicOrigin;
exports.pumpkinQrTargetUrl = pumpkinQrTargetUrl;
exports.readQrTarget = readQrTarget;
exports.buildPumpkinLinks = buildPumpkinLinks;
const pumpkin_engine_room_registry_1 = require("./pumpkin-engine-room-registry");
/** Longest label we will echo back into a URL. Matches the room registry's own label cap. */
const MAX_LABEL_CHARS = 40;
/** Longest preset slug we will echo back. Matches pumpkin_presets.name. */
const MAX_PRESET_CHARS = 64;
/**
 * @description Resolve the origin that absolute device links are built from.
 *
 * Precedence is deliberate. `PUMPKIN_PUBLIC_ORIGIN` exists for the split-host case (the cockpit is
 * reached on one address, the prop's phone/projector on another). `APP_URL` is the deployment's own
 * public address and is what every other outward-facing link in the platform uses. The request host
 * is the LAST resort, and it is the one that produces `localhost` — which is precisely the dead link
 * this whole module exists to stop the browser from generating.
 * @param env - Process env (injected so the resolution order is directly testable).
 * @param requestOrigin - Fallback origin derived from the request (`https://<host>`).
 * @returns An origin with no trailing slash and no path.
 */
function resolvePublicOrigin(env, requestOrigin) {
    const configured = String(env.PUMPKIN_PUBLIC_ORIGIN || env.APP_URL || '').trim();
    const chosen = configured || String(requestOrigin || '').trim();
    return chosen.replace(/\s+/g, '').replace(/\/+$/, '');
}
/** Normalize an untrusted run mode. Anything unrecognized is mimic — never an LLM-spending default. */
function readMode(v) {
    return v === 'autonomous' ? 'autonomous' : 'mimic';
}
/** Normalize an untrusted preset name to the same slug shape the preset store uses. */
function readPreset(v) {
    const slug = String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, MAX_PRESET_CHARS);
    return slug || 'inflatable';
}
/** Normalize an untrusted room label. Empty collapses to the registry's own default. */
function readLabel(v) {
    return String(v ?? '').trim().slice(0, MAX_LABEL_CHARS) || 'Main';
}
/**
 * @description Build the exact URL a QR should encode for one of the two allowed targets.
 *
 * Split out from {@link buildPumpkinLinks} because the QR route has to re-derive the SAME string
 * from the SAME query the surface used — if the two drifted, the printed code and the copyable link
 * would point at different rooms and only the phone would find out.
 * @param origin - The resolved public origin.
 * @param target - Which of the two pages to encode.
 * @param request - The untrusted label/mode/preset.
 * @returns The absolute URL to encode.
 */
function pumpkinQrTargetUrl(origin, target, request) {
    const links = buildPumpkinLinks(origin, request);
    return target === 'remote' ? links.remoteUrl : links.projectorUrl;
}
/**
 * @description Normalize a QR target. Returns null for anything outside the closed set, so the route
 * can 400 instead of encoding a caller-chosen destination — an authenticated QR generator that will
 * encode arbitrary URLs is a phishing tool wearing the deployment's own domain.
 * @param v - Untrusted query value.
 * @returns The target, or null when it is not one of the two pages this app serves.
 */
function readQrTarget(v) {
    return v === 'projector' || v === 'remote' ? v : null;
}
/**
 * @description Build every device URL the control surface shows.
 *
 * The room slug is derived HERE, by the same `roomSlug()` the registry keys rooms with, so the
 * printed/copied link can never name a room the push path would not find. `listen=ptt` is explicit
 * on the projector link because a projector that comes up with an always-open microphone in a yard
 * full of children should be a deliberate choice, never a default carried by a copied URL.
 * @param origin - The resolved public origin (see {@link resolvePublicOrigin}).
 * @param request - The untrusted label/mode/preset the surface asked about.
 * @returns Absolute device URLs plus the two relative QR paths.
 */
function buildPumpkinLinks(origin, request) {
    const label = readLabel(request.label);
    const room = (0, pumpkin_engine_room_registry_1.roomSlug)(label);
    const mode = readMode(request.mode);
    const preset = readPreset(request.preset);
    const base = String(origin || '').replace(/\/+$/, '');
    const qrQuery = `label=${encodeURIComponent(label)}&mode=${encodeURIComponent(mode)}&preset=${encodeURIComponent(preset)}`;
    return {
        origin: base,
        room,
        label,
        mode,
        preset,
        projectorUrl: `${base}/pumpkin/?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(mode)}&preset=${encodeURIComponent(preset)}&listen=ptt`,
        projectorShortUrl: `${base}/pumpkin/`,
        remoteUrl: `${base}/api/pumpkin/remote?room=${encodeURIComponent(room)}`,
        projectorQrUrl: `/api/pumpkin/qr?target=projector&${qrQuery}`,
        remoteQrUrl: `/api/pumpkin/qr?target=remote&${qrQuery}`,
    };
}
//# sourceMappingURL=pumpkin-engine-links.js.map
