"use strict";
/**
 * CHANGE LOG
 * ----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * ----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.0: TVs and streaming sticks on the person's home network. This package never reaches a network (its sandbox has none): its routes build the closed phone-control bridge command (lan-discover, lan-control) that the Smart Home page or Jarvis runs on the person's own computer through the kernel's /api/computers, and they record what that computer answered: the TVs found (Samsung Tizen, Roku, Android TV, Google Cast) and each press's result. A plan always says planned, never done; a TV's on/off state changes only when the computer's answer for that TV said the press worked. Stored per person in lan-tvs.json under the package's lasting folder.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.3: a plan's next step says how Jarvis carries it out. home-lan-discover and home-lan-control declare a computerPlan, so the kernel offers home-bot computer.run_plan and attaches a planId to this answer: pass that planId to computer.run_plan, which runs exactly this command once on the person's own computer, then record the computer's answer with home-lan-record. Without computer.run_plan or a planId nothing ran: say it is planned and name the Smart Home TV button that runs it. The command is unchanged and still fits the kernel's plan grammar (tests/home-lan-devices.test.cjs).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | home 1.7.0 (T45 part 4; Roger, 2026-11-10: "a way to control an app that is running in the background"): on an Android or Fire TV, now_playing reads what is playing and in which app, and play, pause, next, previous and stop reach the app playing it even when another app is in front (Phone & Device Control's bridge 1.8.0). The TV keeps what was last read as nowPlaying, and the answer says it in words; a Roku or Samsung TV refuses them in words.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | home 1.9.1 (Lane TV1; Roger, 2026-11-13, asked that Jarvis open an application such as Netflix on his Roku and Samsung TVs and know where it is): on a Roku or a Samsung TV, launch_app plans opening one application by its checked id (or by its name once the TV's applications were read), on a Roku also a title by the application's own content id and media type, never a web address; list_apps plans reading the TV's applications, which the TV then keeps; active_app plans reading what is in front (a Samsung TV answers about one named application). The recorded answer says what the TV itself reported in front after the press and nothing more: neither kind shows its screen. An Android or Fire TV refuses the three in words, a title on a Samsung TV is refused in words, and a computer whose bridge answers bad_action is told how to update it (Phone & Device Control's bridge 1.20.0).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | home 1.9.2: launch_url action label and Samsung open_app refusal name the product Open Swarm; oshal TV app component wording stays unchanged.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGE_VERSION = exports.ACTION_WORDS = exports.MEDIA_TYPES = exports.FRONT_ACTIONS = exports.MEDIA_ACTIONS = exports.LAN_ACTIONS = exports.LAN_KINDS = void 0;
exports.privateIpv4 = privateIpv4;
exports.readLan = readLan;
exports.writeLan = writeLan;
exports.bridgeCommand = bridgeCommand;
exports.computerOf = computerOf;
exports.planDiscover = planDiscover;
exports.findTv = findTv;
exports.planControl = planControl;
exports.appIdOf = appIdOf;
exports.frontArgs = frontArgs;
exports.readReply = readReply;
exports.foundTv = foundTv;
exports.mergeFound = mergeFound;
exports.recordDiscover = recordDiscover;
exports.applyControl = applyControl;
exports.nowPlayingOf = nowPlayingOf;
exports.playingWords = playingWords;
exports.appsOf = appsOf;
exports.frontOf = frontOf;
exports.frontWords = frontWords;
exports.recordControl = recordControl;
exports.recordAnswer = recordAnswer;
exports.registerLanDeviceRoutes = registerLanDeviceRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** @description The kinds of TV the computer bridge can press; Google Cast devices ('cast') are only reported. */
exports.LAN_KINDS = ['android-tv', 'samsung-tizen', 'roku'];
/** @description The closed list of presses a plan can carry; the bridge refuses anything else on its own too. */
exports.LAN_ACTIONS = ['wake', 'off', 'volume_up', 'volume_down', 'mute', 'up', 'down', 'left', 'right', 'select',
    'home', 'back', 'play_pause', 'launch_url', 'open_app', 'pair', 'now_playing', 'play', 'pause', 'next', 'previous', 'stop',
    'launch_app', 'list_apps', 'active_app'];
/** @description The presses that read or steer the app playing on an Android or Fire TV, in front or not (bridge 1.8.0). */
exports.MEDIA_ACTIONS = ['now_playing', 'play', 'pause', 'next', 'previous', 'stop'];
/** @description On a Roku or a Samsung TV: open one application, list the applications, say what is in front (bridge 1.20.0). */
exports.FRONT_ACTIONS = ['launch_app', 'list_apps', 'active_app'];
/** @description The kinds of title a Roku application opens by its content id (Roku's deep-link media types). */
exports.MEDIA_TYPES = ['movie', 'episode', 'season', 'series', 'shortFormVideo', 'tvSpecial', 'livefeed', 'sportsevent'];
/** @description What each press is called on the page and in an answer. */
exports.ACTION_WORDS = {
    wake: 'Wake', off: 'Turn off', volume_up: 'Volume up', volume_down: 'Volume down', mute: 'Mute', up: 'Up',
    down: 'Down', left: 'Left', right: 'Right', select: 'OK', home: 'Home', back: 'Back', play_pause: 'Play or pause',
    launch_url: 'Show Open Swarm', open_app: 'Open the oshal TV app', pair: 'Pair', install_app: 'Install the TV app',
    now_playing: 'What\'s playing', play: 'Play', pause: 'Pause', next: 'Next', previous: 'Previous', stop: 'Stop',
    launch_app: 'Open an application', list_apps: 'List the applications', active_app: 'What\'s in front',
};
const NOT_FOR = {
    'android-tv': [...exports.FRONT_ACTIONS], 'samsung-tizen': ['open_app', ...exports.MEDIA_ACTIONS], roku: ['launch_url', 'open_app', 'pair', ...exports.MEDIA_ACTIONS],
};
/** @description The phone-control bridge version that has every TV press here (the application ones came in 1.20.0). */
exports.BRIDGE_VERSION = '1.20.0';
const BRIDGE_SCRIPT = '"$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py"';
const STORE_FILE = 'lan-tvs.json';
const MAX_TVS = 48;
const MAX_WAKE = 8;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/;
const SAFE_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*)?$/;
const NODE_ID = /^[0-9A-Fa-f-]{8,64}$/;
// A press this package planned is always one the current bridge knows, so bad_action from a computer means an older bridge.
const OLD_BRIDGE = new Set(['unknown_verb', 'bridge_not_installed', 'bad_action']);
const ROKU_APP = /^\d{1,10}$/;
const SAMSUNG_APP = /^(?:\d{1,20}|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)$/;
const CONTENT_ID = /^[A-Za-z0-9_.~:-]{1,255}$/;
const MAX_APP_ID = 80;
const MAX_APPS = 100;
const PLAYER_WORDS = { play: 'playing', pause: 'paused', buffer: 'buffering', stop: 'stopped', startup: 'starting', open: 'opening' };
/**
 * @description Whether text is a dotted IPv4 address in a private home-network range (10/8, 172.16/12, 192.168/16).
 * @param text The address.
 * @returns True for a private home-network address.
 */
function privateIpv4(text) {
    const match = IPV4.exec(String(text ?? '').trim());
    if (!match)
        return false;
    const [a, b, c, d] = match.slice(1).map(Number);
    if (Math.max(a, b, c, d) > 255)
        return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function clip(value, size = 80) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, size);
}
function cleanMac(value) {
    const mac = String(value ?? '').trim().toLowerCase().replace(/-/g, ':');
    return MAC.test(mac) && !(parseInt(mac.slice(0, 2), 16) & 1) ? mac : null;
}
function storeDir() {
    return process.env.OSHAL_HOME_DATA_DIR || process.env.OSHAL_PACKAGE_DATA_DIR || '/app/home-data';
}
function storePath(sub) {
    return node_path_1.default.join(storeDir(), String(sub || 'default').replace(/[^a-zA-Z0-9._-]/g, '_'), STORE_FILE);
}
/**
 * @description The person's own saved TVs and last scan; empty when nothing is saved.
 * @param sub The signed-in person's subject.
 * @returns The saved TVs and the last scan.
 */
function readLan(sub) {
    try {
        const doc = JSON.parse(node_fs_1.default.readFileSync(storePath(sub), 'utf8'));
        return { tvs: Array.isArray(doc.tvs) ? doc.tvs.slice(0, MAX_TVS) : [], lastScan: doc.lastScan || null };
    }
    catch {
        return { tvs: [], lastScan: null };
    }
}
/**
 * @description Save the person's TVs in their own folder only, never a shared file.
 * @param sub The signed-in person's subject.
 * @param store What to save.
 * @returns False when this installation cannot keep it.
 */
function writeLan(sub, store) {
    const file = storePath(sub);
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true, mode: 0o700 });
        const temp = `${file}.${process.pid}.new`;
        node_fs_1.default.writeFileSync(temp, JSON.stringify({ tvs: store.tvs.slice(0, MAX_TVS), lastScan: store.lastScan }, null, 2), { mode: 0o600 });
        node_fs_1.default.renameSync(temp, file);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * @description The one shell command that runs a bridge verb on the person's computer: the installed bridge, a closed
 *   verb and one base64 argument, so nothing a person types reaches the shell as text.
 * @param verb lan-discover or lan-control.
 * @param args The verb's arguments.
 * @returns The command.
 */
function bridgeCommand(verb, args) {
    return `python3 -I ${BRIDGE_SCRIPT} ${verb} --b64 ${Buffer.from(JSON.stringify(args), 'utf8').toString('base64')}`;
}
/**
 * @description Which computer the caller named (its id from the computers list, its name, or both), checked.
 * @param value An object with id and name, or a name.
 * @returns The computer, or null when none was named.
 */
function computerOf(value) {
    const raw = typeof value === 'string' ? { name: value } : (value && typeof value === 'object' ? value : null);
    if (!raw)
        return null;
    const id = NODE_ID.test(String(raw.id ?? '')) ? String(raw.id) : null;
    const name = clip(raw.name, 80) || null;
    return id || name ? { id, name } : null;
}
function refusal(status, error, message, extra = {}) {
    return { status, body: { ok: false, error, message, ...extra } };
}
function nextStep(op, computer, record) {
    const scan = op === 'discover';
    const where = computer?.name ? `the computer "${computer.name}", which this plan names` : "the person's own computer";
    const button = scan ? 'Scan for TVs under TVs and streaming sticks on the Smart Home screen runs it'
        : "the TV's card under TVs and streaming sticks on the Smart Home screen presses it";
    return `Planned, not done yet. When computer.run_plan is offered, pass the planId this answer carries to computer.run_plan: `
        + `the ${scan ? 'scan' : 'press'} runs at once on ${where}. Then call home-lan-record with `
        + `${JSON.stringify({ op, ...record, computer: computer?.name || '<the computer computer.run_plan names>' })} and "reply" set to `
        + `the one JSON line the computer printed. Without computer.run_plan or a planId nothing ran: say the ${scan ? 'scan' : 'press'} `
        + `is planned and that ${button}. Until home-lan-record answers, say the request is planned, never that it was done.`;
}
/**
 * @description The plan for a scan: the command for the person's computer. It wakes saved TVs only when asked to
 *   (wakeSaved), because a woken TV may turn its screen on.
 * @param sub The signed-in person's subject.
 * @param body { computer?, wakeSaved? }.
 * @returns 200 with the planned command; nothing has run.
 */
function planDiscover(sub, body) {
    const computer = computerOf(body.computer);
    const wake = body.wakeSaved === true
        ? readLan(sub).tvs.filter((tv) => tv.mac).slice(0, MAX_WAKE).map((tv) => ({ mac: tv.mac, address: tv.address }))
        : [];
    const args = wake.length ? { wake } : {};
    return { status: 200, body: {
            ok: true, planned: true, executed: false, status: 'planned', op: 'discover', verb: 'lan-discover', args,
            command: bridgeCommand('lan-discover', args), computer, bridgeVersion: exports.BRIDGE_VERSION, wakes: wake.length,
            next: nextStep('discover', computer, {}),
        } };
}
/**
 * @description The saved TV a request names: its id, address or name (whole or in part), or its kind when only one fits.
 * @param tvs The saved TVs.
 * @param ref What the person or the page named.
 * @returns The TV, or the TVs that fit when not exactly one does.
 */
function findTv(tvs, ref) {
    const want = clip(ref, 120).toLowerCase();
    if (!want)
        return { matches: [] };
    const exact = tvs.find((tv) => tv.id === want || tv.address === want || tv.name.toLowerCase() === want);
    if (exact)
        return { tv: exact };
    const words = want.replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['the', 'my', 'tv', 'on'].includes(w));
    const kindWord = (tv) => `${tv.kind} ${tv.kind === 'samsung-tizen' ? 'samsung' : ''} ${tv.kind === 'android-tv' ? 'android fire google' : ''}`;
    const fits = tvs.filter((tv) => words.length && words.every((w) => `${tv.name} ${tv.room || ''} ${tv.model || ''} ${kindWord(tv)}`.toLowerCase().includes(w)));
    return fits.length === 1 ? { tv: fits[0] } : { matches: fits };
}
function urlFor(body, host) {
    const given = clip(body.url, 300);
    if (given)
        return given.length <= 256 && SAFE_URL.test(given) ? given : null;
    const bare = clip(host, 200).toLowerCase();
    return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d{1,5})?$/.test(bare) && !/^localhost\b/.test(bare) ? `https://${bare}/` : null;
}
/**
 * @description The plan for one press on one saved TV, refused in words when it cannot be done.
 * @param sub The signed-in person's subject.
 * @param body { device, action, url?, computer? }.
 * @param host The request's host, for the page Show Open Swarm opens when no url is given.
 * @returns 200 with the planned command, or a refusal.
 */
function planControl(sub, body, host = '') {
    const tvs = readLan(sub).tvs;
    const found = findTv(tvs, body.device);
    if (!found.tv) {
        return found.matches?.length
            ? refusal(409, 'which_tv', `More than one TV fits "${clip(body.device)}": say which.`, { candidates: found.matches.map((tv) => tv.name) })
            : refusal(404, 'tv_not_found', `No saved TV is called "${clip(body.device)}". Scan for TVs first (home-lan-discover).`, { saved: tvs.map((tv) => tv.name) });
    }
    const tv = found.tv;
    const action = clip(body.action, 20).toLowerCase();
    if (!exports.LAN_ACTIONS.includes(action))
        return refusal(400, 'bad_action', `action is one of ${exports.LAN_ACTIONS.join(', ')}.`);
    if (!tv.controllable || tv.kind === 'cast')
        return refusal(409, 'not_controllable', `${tv.name} is a Google Cast device; your computer cannot press its buttons.`);
    if (NOT_FOR[tv.kind]?.includes(action))
        return refusal(400, 'not_for_this_tv', notForWords(tv, action));
    const args = { kind: tv.kind, address: tv.address, action };
    if (tv.mac)
        args.mac = tv.mac;
    if (exports.FRONT_ACTIONS.includes(action)) {
        const extra = frontArgs(tv, action, body);
        if (extra.refused)
            return extra.refused;
        Object.assign(args, extra.args);
    }
    if (action === 'launch_url') {
        const url = urlFor(body, host);
        if (!url)
            return refusal(400, 'url_required', 'Say which https page to open on the TV (at most 256 characters).');
        args.url = url;
    }
    const computer = tv.computer || computerOf(body.computer);
    return { status: 200, body: {
            ok: true, planned: true, executed: false, status: 'planned', op: 'control', verb: 'lan-control', action,
            actionWords: exports.ACTION_WORDS[action], device: { id: tv.id, name: tv.name, kind: tv.kind, address: tv.address }, args,
            command: bridgeCommand('lan-control', args), computer, bridgeVersion: exports.BRIDGE_VERSION,
            next: nextStep('control', computer, { device: tv.id, action }),
        } };
}
/**
 * @description The id of the application a request names on a Roku or a Samsung TV: a name the TV listed, or an id in
 *   the one shape that kind of TV uses. Nothing else reaches a plan.
 * @param tv The saved TV.
 * @param value The id or the name.
 * @returns The id, or the refusal.
 */
function appIdOf(tv, value) {
    const text = clip(value, 120);
    if (!text)
        return { refused: refusal(400, 'app_required', `Say which application on ${tv.name}: its id, or its name once its applications have been read (action list_apps).`) };
    const apps = tv.apps || [];
    const want = text.toLowerCase();
    const exact = apps.filter((app) => app.name.toLowerCase() === want);
    if (exact.length === 1)
        return { id: exact[0].id };
    if (tv.kind === 'roku' ? ROKU_APP.test(text) : text.length <= MAX_APP_ID && SAMSUNG_APP.test(text))
        return { id: text };
    const fits = exact.length ? exact : apps.filter((app) => app.name.toLowerCase().includes(want));
    if (fits.length === 1)
        return { id: fits[0].id };
    if (fits.length > 1)
        return { refused: refusal(409, 'which_app', `More than one application on ${tv.name} fits "${text}": say which.`, { candidates: fits.slice(0, 12).map((app) => `${app.name} (${app.id})`) }) };
    return { refused: refusal(400, 'app_unknown', apps.length
            ? `${tv.name} listed no application called "${text}". Name one it listed (home-lan-devices shows them) or give its id.`
            : `No application list is saved for ${tv.name} yet. Read its applications first (action list_apps), then name one or give its id.`) };
}
/**
 * @description What a launch_app, list_apps or active_app plan carries besides the TV: the application's id and, on a
 *   Roku, a title's content id and media type, each checked against its closed shape.
 * @param tv The saved Roku or Samsung TV.
 * @param action The press.
 * @param body { app?, contentId?, mediaType? }.
 * @returns The arguments, or the refusal.
 */
function frontArgs(tv, action, body) {
    const roku = tv.kind === 'roku';
    if (action === 'list_apps' || (action === 'active_app' && roku))
        return { args: {} };
    if (action === 'active_app' && !clip(body.app, 120)) {
        return { refused: refusal(400, 'app_required', `${tv.name} is a Samsung TV, which answers about one application at a time: say which application (its id, or its name once list_apps has read them), and it says whether that one is running and in front.`) };
    }
    const app = appIdOf(tv, body.app);
    if (!app.id)
        return { refused: app.refused };
    const content = clip(body.contentId, 300);
    const media = clip(body.mediaType, 40);
    if (action === 'active_app' || (!content && !media))
        return { args: { app: app.id } };
    if (!roku)
        return { refused: refusal(400, 'title_not_on_samsung', `A title cannot be opened directly on ${tv.name}, a Samsung TV: only the application. Leave contentId out.`) };
    if (!CONTENT_ID.test(content))
        return { refused: refusal(400, 'bad_content', "contentId is the application's own id for the title (letters, digits and . _ ~ : - only, at most 255 characters), never a web address.") };
    const mediaType = exports.MEDIA_TYPES.find((name) => name.toLowerCase() === media.toLowerCase());
    if (media && !mediaType)
        return { refused: refusal(400, 'bad_media_type', `mediaType is one of ${exports.MEDIA_TYPES.join(', ')}.`) };
    return { args: { app: app.id, contentId: content, ...(mediaType ? { mediaType } : {}) } };
}
function notForWords(tv, action) {
    if (exports.FRONT_ACTIONS.includes(action))
        return `${tv.name} is an Android or Fire TV: its applications are listed and opened through Phone & Device Control, and now_playing here says what is playing. This press is for a Roku or a Samsung TV.`;
    if (exports.MEDIA_ACTIONS.includes(action))
        return `What is playing, and play, pause, next and previous for the app playing it, work on Android and Fire TVs. On ${tv.name} use Play/Pause.`;
    if (tv.kind === 'roku' && action === 'launch_url')
        return `${tv.name} is a Roku, which cannot open a web page.`;
    if (tv.kind === 'roku' && action === 'pair')
        return `${tv.name} is a Roku: it needs no pairing.`;
    return `${tv.name} is not an Android TV, so the oshal TV app cannot run on it. Use Show Open Swarm instead.`;
}
/**
 * @description The bridge's answer from what the page or Jarvis sent: the object, a run result's stdout, or the line.
 * @param value The answer as sent.
 * @returns The bridge's answer, or null when there is none.
 */
function readReply(value) {
    if (value && typeof value === 'object') {
        const object = value;
        // A run result (computer.run's result.stdout, /api/computers' output.stdout) carries its own ok: read its line first.
        const out = object.output?.stdout ?? object.result?.stdout ?? object.stdout;
        if (typeof out === 'string')
            return readReply(out);
        return typeof object.ok === 'boolean' ? object : null;
    }
    if (typeof value !== 'string')
        return null;
    for (const line of value.trim().split('\n').reverse()) {
        try {
            const parsed = JSON.parse(line.trim());
            if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean')
                return parsed;
        }
        catch { /* not the bridge's line */ }
    }
    return null;
}
function appState(adb) {
    const version = Number.isInteger(adb.appVersionCode) ? adb.appVersionCode : null;
    return { state: clip(adb.state, 20), appVersionCode: version, appInstalled: version !== null };
}
function tvId(mac, address) {
    return mac ? `tv-${mac.replace(/:/g, '')}` : `tv-ip-${address.replace(/\./g, '-')}`;
}
/**
 * @description One found TV from the computer's answer, checked and bounded.
 * @param raw One entry of the scan's found list.
 * @param computer The computer that found it.
 * @param now When.
 * @returns The TV, or null when the entry is not one.
 */
function foundTv(raw, computer, now) {
    const item = raw && typeof raw === 'object' ? raw : null;
    const kind = String(item?.kind ?? '');
    if (!item || !privateIpv4(item.address) || ![...exports.LAN_KINDS, 'cast'].includes(kind))
        return null;
    const address = String(item.address).trim();
    const mac = cleanMac(item.mac);
    const adb = item.adb && typeof item.adb === 'object' ? item.adb : null;
    const samsung = item.samsung && typeof item.samsung === 'object' ? item.samsung : null;
    const power = item.power === 'on' || item.power === 'off' ? item.power : null;
    return {
        id: tvId(mac, address), name: clip(item.name) || 'TV', kind, address, mac, model: clip(item.model, 60) || null,
        os: clip(item.os, 30) || null, room: clip(item.room, 40) || null, controllable: kind !== 'cast' && item.controllable !== false,
        power, computer, steps: clip(item.steps, 400) || null, lastSeenAt: now, lastResult: null,
        adb: adb ? appState(adb) : null,
        samsung: samsung ? { paired: samsung.tokenSaved === true } : null,
    };
}
/**
 * @description Merge a scan into the saved TVs: by hardware address first, then by address; earlier results are kept.
 * @param store The saved TVs, changed in place.
 * @param found The TVs the scan found.
 * @returns How many were added and updated.
 */
function mergeFound(store, found) {
    let added = 0;
    let updated = 0;
    for (const tv of found) {
        const at = store.tvs.findIndex((old) => old.id === tv.id || (old.address === tv.address && (!old.mac || !tv.mac || old.mac === tv.mac)));
        if (at < 0) {
            if (store.tvs.length >= MAX_TVS)
                continue;
            store.tvs.push(tv);
            added += 1;
            continue;
        }
        const old = store.tvs[at];
        store.tvs[at] = { ...tv, id: old.id, lastResult: old.lastResult, nowPlaying: old.nowPlaying ?? null, samsung: tv.samsung ? { paired: tv.samsung.paired || Boolean(old.samsung?.paired) } : old.samsung,
            ...(old.apps ? { apps: old.apps, appsAt: old.appsAt ?? null } : {}), ...(old.front ? { front: old.front } : {}) };
        updated += 1;
    }
    store.tvs.sort((a, b) => a.name.localeCompare(b.name));
    return { added, updated };
}
function oldBridgeHint(error) {
    return OLD_BRIDGE.has(String(error)) ? `The phone bridge on that computer is older than ${exports.BRIDGE_VERSION}. Open Smart Home, `
        + 'TVs and streaming sticks, and press Scan for TVs once: the page updates it, then ask again.' : undefined;
}
/**
 * @description Record a scan's answer: the TVs found are saved for the person; a refused scan is recorded in its words.
 * @param sub The signed-in person's subject.
 * @param body { computer, reply }.
 * @param now When.
 * @returns What was recorded, with the Android TVs to add to Phone & Device Control.
 */
function recordDiscover(sub, body, now = new Date().toISOString()) {
    const reply = readReply(body.reply);
    if (!reply)
        return refusal(400, 'reply_unreadable', 'Send the one JSON line the computer printed for the scan.');
    const computer = computerOf(body.computer);
    const store = readLan(sub);
    if (reply.ok !== true) {
        store.lastScan = { at: now, ok: false, found: 0, computer, error: clip(reply.error, 40) || 'failed', message: clip(reply.message, 400) };
        if (!writeLan(sub, store))
            return refusal(503, 'not_saved', 'Smart Home cannot save on this installation.');
        return { status: 200, body: { ok: false, recorded: true, error: store.lastScan.error, message: store.lastScan.message, hint: oldBridgeHint(reply.error) } };
    }
    if (reply.verb !== 'lan-discover' || !Array.isArray(reply.found))
        return refusal(400, 'wrong_reply', 'That answer is not from a TV scan.');
    const found = reply.found.slice(0, 32).map((item) => foundTv(item, computer, now)).filter((tv) => Boolean(tv));
    const { added, updated } = mergeFound(store, found);
    store.lastScan = { at: now, ok: true, found: found.length, computer, error: null, message: `Found ${found.length}.` };
    if (!writeLan(sub, store))
        return refusal(503, 'not_saved', 'Smart Home cannot save on this installation.');
    const phoneControl = found.filter((tv) => tv.kind === 'android-tv' && tv.adb && tv.adb.state !== 'off')
        .map((tv) => ({ name: tv.name, address: `${tv.address}:5555`, platform: 'android', form: 'tv', computerNodeId: computer?.id || null }));
    return { status: 200, body: { ok: true, recorded: true, found: found.length, added, updated, devices: store.tvs, lastScan: store.lastScan, phoneControl,
            said: found.length ? `Found ${found.map((tv) => tv.name).join(', ')}.` : 'No TVs or streaming sticks answered on that network.' } };
}
/**
 * @description What a press's answer changes on the saved TV: the result always, the power only when the press worked.
 * @param tv The saved TV, changed in place.
 * @param action The press.
 * @param reply The computer's answer.
 * @param now When.
 * @returns The recorded result.
 */
function applyControl(tv, action, reply, now) {
    const ok = reply.ok === true;
    const media = ok && exports.MEDIA_ACTIONS.includes(action);
    if (media)
        tv.nowPlaying = nowPlayingOf(reply.now, now);
    const front = ok && exports.FRONT_ACTIONS.includes(action);
    if (front && action === 'list_apps')
        Object.assign(tv, { apps: appsOf(reply.apps), appsAt: now });
    if (front && action !== 'list_apps')
        tv.front = frontOf(reply, now);
    const result = { action, ok, error: ok ? null : clip(reply.error, 40) || 'failed',
        message: media ? playingWords(tv, action, tv.nowPlaying ?? null) : front ? frontWords(tv, action, reply)
            : ok ? `${exports.ACTION_WORDS[action] || action}: done on ${tv.name}.` : clip(reply.message, 400) || 'The computer did not do it.', at: now };
    tv.lastResult = result;
    if (ok && (reply.power === 'on' || reply.power === 'off'))
        tv.power = reply.power;
    // A Samsung TV's REST port (an application opened or read there) needs no pairing, so only its remote channel proves one.
    if (tv.kind === 'samsung-tizen' && ok && (!front || action === 'list_apps' || reply.via === 'remote-channel'))
        tv.samsung = { paired: true };
    if (tv.kind === 'samsung-tizen' && reply.error === 'samsung_allow_on_tv')
        tv.samsung = { paired: false };
    if (action === 'install_app' && ok)
        tv.adb = { state: 'device', appVersionCode: tv.adb?.appVersionCode ?? null, appInstalled: true };
    return result;
}
/**
 * @description What the bridge said is playing, kept short, or null when nothing has played. Pure.
 * @param value The bridge's now. @param at When it was read. @returns The record to keep.
 */
function nowPlayingOf(value, at) {
    if (!value || typeof value !== 'object')
        return null;
    const item = value;
    return { app: clip(item.app, 60) || 'An app', title: clip(item.title, 200) || null, state: clip(item.state, 20) || 'none', inFront: item.inFront === true, at };
}
/**
 * @description A media press's answer in words: what is playing, in which app, and that it is behind another app. Pure.
 * @param tv The TV. @param action The press. @param playing What it said after. @returns One sentence.
 */
function playingWords(tv, action, playing) {
    if (!playing)
        return `Nothing has played on ${tv.name} yet.`;
    const what = playing.title ? `${playing.app}: ${playing.title}` : playing.app;
    const where = playing.inFront ? '' : ' (behind another app)';
    const state = playing.state === 'none' ? 'idle' : playing.state;
    return action === 'now_playing' ? `On ${tv.name}, ${what} is ${state}${where}.` : `${exports.ACTION_WORDS[action]} sent on ${tv.name}; ${what} is now ${state}${where}.`;
}
const part = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const flag = (value) => (typeof value === 'boolean' ? value : null);
/**
 * @description The applications a TV listed, checked and bounded: an id that is one plain token and a name. Pure.
 * @param value The bridge's apps. @returns At most a hundred applications.
 */
function appsOf(value) {
    return (Array.isArray(value) ? value : []).map((item) => ({ id: clip(part(item)?.id, 120), name: clip(part(item)?.name, 60) }))
        .filter((app) => app.name && app.id.length <= MAX_APP_ID && (ROKU_APP.test(app.id) || SAMSUNG_APP.test(app.id))).slice(0, MAX_APPS);
}
/**
 * @description What the TV reported about an application after launch_app or active_app, kept short: a Roku's answer
 *   names what is in front; a Samsung TV's says whether the one application asked about is running and visible. Pure.
 * @param reply The bridge's answer. @param at When it was read. @returns The record to keep, or null.
 */
function frontOf(reply, at) {
    const seen = part(reply.front);
    const asked = part(reply.app);
    if (seen) {
        return { id: clip(seen.id, MAX_APP_ID) || null, name: seen.home === true ? 'Home screen' : clip(seen.name, 60) || 'An application', inFront: true, running: true,
            screensaver: clip(seen.screensaver, 60) || null, player: clip(part(reply.player)?.state, 20) || null, at };
    }
    if (!asked)
        return null;
    return { id: clip(asked.id, MAX_APP_ID) || null, name: clip(asked.name, 60) || 'An application', inFront: flag(reply.visible), running: flag(reply.running), screensaver: null, player: null, at };
}
function rokuWords(tv, action, name, reply) {
    const seen = part(reply.front);
    const home = seen?.home === true;
    const frontName = clip(seen?.name, 60) || 'another application';
    if (action === 'launch_app') {
        if (reply.inFront === true)
            return `${name} is in front on ${tv.name}.${reply.contentId ? ' The title was asked for by its id; a Roku does not say which title is showing.' : ''}`;
        return seen ? `Open an application was sent to ${tv.name}, but ${name} was not in front when the Roku was read: ${home ? 'its home screen' : frontName} was.`
            : `Open an application was sent to ${tv.name}; the Roku did not say what is in front.`;
    }
    if (!seen)
        return `${tv.name} did not say what is in front.`;
    const saver = clip(seen.screensaver, 60);
    const playing = home ? '' : PLAYER_WORDS[clip(part(reply.player)?.state, 20)];
    return `On ${tv.name}, ${home ? 'the home screen' : frontName} is in front${playing ? `, its player ${playing}` : ''}${saver ? `, with the screensaver ${saver} showing` : ''}.`;
}
function samsungWords(tv, action, name, reply) {
    const running = flag(reply.running);
    const visible = flag(reply.visible);
    const sent = action === 'launch_app';
    if (visible === true)
        return sent ? `${name} is running and in front on ${tv.name}.` : `On ${tv.name}, ${name} is running and in front.`;
    if (running === true)
        return sent ? `${name} is running on ${tv.name} but is not in front.` : `On ${tv.name}, ${name} is running but is not in front.`;
    if (running === false)
        return sent ? `Open an application was sent to ${tv.name}, but the TV says ${name} is not running.` : `On ${tv.name}, ${name} is not running.`;
    return sent ? `Open an application was sent to ${tv.name}; the TV did not say whether ${name} is running.` : `${tv.name} did not say whether ${name} is running.`;
}
/**
 * @description A launch_app, list_apps or active_app answer in words: only what the TV itself reported. Neither a Roku
 *   nor a Samsung TV shows its screen, so the words never go past the application in front. Pure.
 * @param tv The TV, after its record was updated. @param action The press. @param reply The bridge's answer. @returns One or two sentences.
 */
function frontWords(tv, action, reply) {
    if (action === 'list_apps') {
        const apps = tv.apps || [];
        if (!apps.length)
            return `${tv.name} listed no applications.`;
        return `${tv.name} has ${apps.length} application${apps.length === 1 ? '' : 's'}: ${apps.slice(0, 40).map((app) => `${app.name} (${app.id})`).join(', ')}${apps.length > 40 ? ', and more' : ''}.`;
    }
    const asked = part(reply.app);
    const name = clip(asked?.name, 60) || clip(asked?.id, MAX_APP_ID) || 'The application';
    return tv.kind === 'roku' ? rokuWords(tv, action, name, reply) : samsungWords(tv, action, name, reply);
}
function replyMatches(tv, action, reply) {
    if (reply.ok !== true)
        return true;
    if (action === 'install_app')
        return reply.verb === 'adb-install-apk' && String(reply.serial ?? '').startsWith(`${tv.address}:`);
    return reply.verb === 'lan-control' && reply.address === tv.address && reply.action === action;
}
/**
 * @description Record one press's answer for one saved TV. An answer for another TV or another press is refused.
 * @param sub The signed-in person's subject.
 * @param body { device, action, reply }.
 * @param now When.
 * @returns What was recorded.
 */
function recordControl(sub, body, now = new Date().toISOString()) {
    const reply = readReply(body.reply);
    if (!reply)
        return refusal(400, 'reply_unreadable', 'Send the one JSON line the computer printed for the press.');
    const store = readLan(sub);
    const tv = store.tvs.find((item) => item.id === clip(body.device, 120)) || findTv(store.tvs, body.device).tv;
    if (!tv)
        return refusal(404, 'tv_not_found', 'That TV is not saved in Smart Home.');
    const action = clip(body.action, 20).toLowerCase();
    if (![...exports.LAN_ACTIONS, 'install_app'].includes(action))
        return refusal(400, 'bad_action', 'Name the press this answer is for.');
    if (!replyMatches(tv, action, reply))
        return refusal(400, 'wrong_reply', `That answer is not for ${exports.ACTION_WORDS[action]} on ${tv.name}.`);
    const result = applyControl(tv, action, reply, now);
    if (!writeLan(sub, store))
        return refusal(503, 'not_saved', 'Smart Home cannot save on this installation.');
    return { status: 200, body: { ok: result.ok, recorded: true, device: tv, result, said: result.message, hint: oldBridgeHint(reply.error) } };
}
/**
 * @description Record what the computer answered: a scan (op discover), a press (op control) or an app install (op install).
 * @param sub The signed-in person's subject.
 * @param body { op, ... }.
 * @returns What was recorded.
 */
function recordAnswer(sub, body) {
    const op = clip(body.op, 20);
    if (op === 'discover')
        return recordDiscover(sub, body);
    if (op === 'control' || op === 'install')
        return recordControl(sub, { ...body, action: op === 'install' ? 'install_app' : body.action });
    return refusal(400, 'bad_op', 'op is discover or control.');
}
/**
 * @description Mount the TV routes under /api/home/lan: the saved TVs, the scan and press plans, and the record step.
 * @param router The package router.
 * @param callerSub Resolves the signed-in person's subject, or null.
 * @returns {void}
 */
function registerLanDeviceRoutes(router, callerSub) {
    const send = (res, answer) => { res.setHeader('Cache-Control', 'no-store'); res.status(answer.status).json(answer.body); };
    const person = (req, res) => {
        const sub = callerSub(req);
        if (!sub)
            res.status(401).json({ error: 'not_authenticated' });
        return sub;
    };
    router.get('/lan/devices', (req, res) => {
        const sub = person(req, res);
        if (sub)
            send(res, { status: 200, body: { ok: true, ...readLan(sub), bridgeVersion: exports.BRIDGE_VERSION } });
    });
    router.post('/lan/discover-plan', (req, res) => {
        const sub = person(req, res);
        if (sub)
            send(res, planDiscover(sub, (req.body || {})));
    });
    router.post('/lan/control-plan', (req, res) => {
        const sub = person(req, res);
        const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
        if (sub)
            send(res, planControl(sub, (req.body || {}), host));
    });
    router.post('/lan/record', (req, res) => {
        const sub = person(req, res);
        if (sub)
            send(res, recordAnswer(sub, (req.body || {})));
    });
}
