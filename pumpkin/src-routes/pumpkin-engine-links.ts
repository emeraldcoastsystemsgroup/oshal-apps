/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 22:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: the SERVER-side device-link builder behind GET /api/pumpkin/links and GET /api/pumpkin/qr. Both routes were documented across a whole README section and both QR runbook steps but never existed, so the control surface's Projector-link card and BOTH QR images sat permanently in their degraded fallback — a URL built from the cockpit browser's own address, i.e. http://localhost:35457 on the operator's laptop, which cannot open on a phone. The browser is structurally the wrong place to build these: only the server knows the public origin (PUMPKIN_PUBLIC_ORIGIN → APP_URL → the request host) and owns roomSlug(). The QR target is a CLOSED whitelist of the two pages this app serves — never a caller-supplied URL, which would turn a signed-in cockpit into a QR-phishing generator. The pairing token is never placed in a link, a QR, or a /links response.
 * 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | The projector link points at the page this package now serves (/api/pumpkin/projector; the native kernel never served the framework's /pumpkin/ directory, so the link was a 404), and requestOrigin() keeps the Host header's port and uses http on loopback (the fallback was https://<hostname> with no port, so a loopback install handed out https://127.0.0.1/... which opens nothing).
 */

import { roomSlug } from './pumpkin-engine-room-registry';
import type { PumpkinMode } from './pumpkin-engine-types';

/** The two pages a pumpkin QR may ever encode. A closed set — never a caller-supplied URL. */
export type PumpkinQrTarget = 'projector' | 'remote';

/** What a caller asked the link builder to describe. All fields are untrusted and normalized here. */
export interface PumpkinLinkRequest {
  /** Human room label the operator typed ("Front Porch"). */
  label?: unknown;
  /** Run mode the projector should start in. */
  mode?: unknown;
  /** Saved look the projector should start on. */
  preset?: unknown;
}

/** Every URL the control surface shows, built once, server-side. */
export interface PumpkinLinks {
  /** The public origin these absolute links were built from (shown so a misconfig is visible). */
  origin: string;
  /** Canonical room slug — the pairing key the projector, the phone and the swarm must all agree on. */
  room: string;
  /** The label as stored/typed, trimmed. */
  label: string;
  mode: PumpkinMode;
  preset: string;
  /** ABSOLUTE — it gets carried to another device. */
  projectorUrl: string;
  /** ABSOLUTE, and deliberately query-free: the form worth typing on a projector's on-screen keyboard. */
  projectorShortUrl: string;
  /** ABSOLUTE — scanned/copied onto a phone. */
  remoteUrl: string;
  /** RELATIVE — an <img src> inside the cockpit iframe must resolve against the cockpit's own host. */
  projectorQrUrl: string;
  /** RELATIVE, same reason. */
  remoteQrUrl: string;
}

/**
 * The projector page this package serves (GET /api/pumpkin/projector). The framework's old /pumpkin/ page directory
 * is not served by the native kernel, so a link to it was a 404 on the projector device.
 */
export const PROJECTOR_PATH = '/api/pumpkin/projector';

/** A Host header value: a DNS name, IPv4 or bracketed IPv6 literal, with an optional port. Nothing else is echoed. */
const HOST_VALUE = /^(\[[0-9a-f:.]{2,45}\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::(\d{1,5}))?$/i;

/** Loopback names: a browser reaches these over plain http on the machine itself. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * @description The origin a request was made to, for links carried to another device when no public origin is
 * configured. The Host header keeps the port (`127.0.0.1:38788`); the old fallback used the port-less hostname and
 * forced https, so a loopback install handed out `https://127.0.0.1/...`, which opens nothing. Loopback is reached
 * over plain http on the machine itself; anything else is https (a deployment's reverse proxy terminates TLS, and
 * the transport the package sees is always http, so the request's own protocol cannot say).
 * @param hostHeader - The request's Host header (untrusted; anything that is not a host is ignored).
 * @param hostname - The port-less hostname, used when the Host header is missing or not a host.
 * @returns An origin with scheme, host and any port; no trailing slash.
 */
export function requestOrigin(hostHeader: unknown, hostname: string): string {
  const raw = typeof hostHeader === 'string' ? hostHeader.trim() : '';
  const match = raw.length <= 253 ? HOST_VALUE.exec(raw) : null;
  const ok = match && !(match[2] && Number(match[2]) > 65535);
  const host = ok ? match[0].toLowerCase() : String(hostname || '').toLowerCase();
  const name = ok ? match[1].toLowerCase() : host;
  return `${LOOPBACK.test(name) ? 'http' : 'https'}://${host}`;
}

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
export function resolvePublicOrigin(env: NodeJS.ProcessEnv, requestOrigin: string): string {
  const configured = String(env.PUMPKIN_PUBLIC_ORIGIN || env.APP_URL || '').trim();
  const chosen = configured || String(requestOrigin || '').trim();
  return chosen.replace(/\s+/g, '').replace(/\/+$/, '');
}

/** Normalize an untrusted run mode. Anything unrecognized is mimic — never an LLM-spending default. */
function readMode(v: unknown): PumpkinMode {
  return v === 'autonomous' ? 'autonomous' : 'mimic';
}

/** Normalize an untrusted preset name to the same slug shape the preset store uses. */
function readPreset(v: unknown): string {
  const slug = String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, MAX_PRESET_CHARS);
  return slug || 'inflatable';
}

/** Normalize an untrusted room label. Empty collapses to the registry's own default. */
function readLabel(v: unknown): string {
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
export function pumpkinQrTargetUrl(origin: string, target: PumpkinQrTarget, request: PumpkinLinkRequest): string {
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
export function readQrTarget(v: unknown): PumpkinQrTarget | null {
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
export function buildPumpkinLinks(origin: string, request: PumpkinLinkRequest): PumpkinLinks {
  const label = readLabel(request.label);
  const room = roomSlug(label);
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
    projectorUrl: `${base}${PROJECTOR_PATH}?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(mode)}&preset=${encodeURIComponent(preset)}&listen=ptt`,
    projectorShortUrl: `${base}${PROJECTOR_PATH}`,
    remoteUrl: `${base}/api/pumpkin/remote?room=${encodeURIComponent(room)}`,
    projectorQrUrl: `/api/pumpkin/qr?target=projector&${qrQuery}`,
    remoteQrUrl: `/api/pumpkin/qr?target=remote&${qrQuery}`,
  };
}
