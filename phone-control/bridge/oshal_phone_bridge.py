#!/usr/bin/env python3
# 26 | maintainer@emeraldcoastsystemsgroup.com | Follow package1.15.0; no bridge verb changes.
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: bridge on the operator computer via shell.exec: Android adb + iPhone BLE keyboard in oshal_phone_ble.py, closed verb list, single bounded JSON line.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Unpack missing adb shared libraries from Depends and surface adb startup errors clearly.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: version tracks package.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: version tracks package.
# 5 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: Fire TV / Android TV network adb (adb-connect-tv, OK, PLAY_PAUSE, Leanback launcher).
# 6 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: iPhone AirPlay mirroring through UxPlay (setup-mirror, mirror-start, mirror-stop, mirror-frame).
# 7 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: delegate mirror/TV/transfer helpers to oshal_phone_mirror.py and calibration/RDP/unified input primitives to oshal_phone_ops.py (ble-calibrate, rdp-probe, screen-info, pointer-move, pointer-click, pointer-drag, keyboard-type, keyboard-key).
# 8 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: add ble-sync verb, MENU Android keycode, optional BLE address routing, avahi-browse Android TLS connect discovery (host-filtered & Fire TV excluded), rotated Wireless Debugging TLS port auto-reconnect, and bump bridge version to 1.4.1.
# 9 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the verbs lan-discover and lan-control (TVs and streaming sticks on this computer's home network) from oshal_phone_lan.py, which ships beside the other bridge files; uninstall also forgets the saved TV pairings.
# 10 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1: version tracks package (Connect in console hidden in the page); no verb changed.
# 11 | maintainer@emeraldcoastsystemsgroup.com | 1.5.2: version tracks package (device-concierge routing words); no verb changed.
# 12 | maintainer@emeraldcoastsystemsgroup.com | 1.5.3: version tracks package (the page's missing isTvNode import); no verb changed.
# 13 | maintainer@emeraldcoastsystemsgroup.com | 1.5.4: the verbs ble-pair-answer (the person's Allow or Reject for a device waiting to pair with OSHAL-KB) and ble-keep (keep a device that was paired before oshal asked); oshal_phone_ble.py no longer answers or trusts a pairing by itself.
# 14 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0: version only, to stay the package's version (the page installs the matching bridge by itself); nothing in the bridge changed.
# 15 | maintainer@emeraldcoastsystemsgroup.com | 1.6.1: version only, to stay the package's version (the page installs the matching bridge by itself); nothing else here changed.
# 16 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0: ships oshal_phone_links.py (a link opened on an Android or Fire TV goes to the named streaming app).
# 17 | maintainer@emeraldcoastsystemsgroup.com | 1.8.0 (T45 part 4; Roger, 2026-11-10: "a way to control an app that is running in the background"): lan-control on an Android TV reads what is playing and in which app (now_playing) and sends play, pause, next, previous and stop to the app playing, in front or not (oshal_phone_links.py).
# 18 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0 (T45 part 2; Roger, 2026-11-10: "plays it on any device in his connected devices"): launch_url with app oshal opens a Marquee page in the oshal TV app (oshal_phone_links.py).
# 19 | maintainer@emeraldcoastsystemsgroup.com | 1.9.1: version only, as the package's version (the honesty test holds them equal); no verb changed.
# 20 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0: version only, as the package's version; no verb changed.
# 21 | maintainer@emeraldcoastsystemsgroup.com | 1.11.0 (T80): lan-control play_title plays a show or film by its name on an Android or Fire TV.
# 22 | maintainer@emeraldcoastsystemsgroup.com | 1.12.0 (T79): lan-control tv_apps says which streaming apps an Android or Fire TV has (oshal_phone_apps.py), reading its package list and pressing nothing.
# 23 | maintainer@emeraldcoastsystemsgroup.com | 1.12.1: the version follows the package (its device list tool now says it lists TVs too); no verb changed.
# 24 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0 (T79): lan-control tv_apps also answers the TV's model and maker when they can be read (oshal_phone_apps.py); no verb changed.
# 25 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): the version follows the package (every person now adds and controls their own devices; that is the package's permission catalog); no verb changed.
# 27 | maintainer@emeraldcoastsystemsgroup.com | Follow package1.16.0; version metadata only, with the same bridge verbs and protocol.
# 28 | maintainer@emeraldcoastsystemsgroup.com | Follow package1.17.0; version metadata only, with unchanged bridge verbs and protocol.
# 29 | maintainer@emeraldcoastsystemsgroup.com | Follow package 1.18.0 (the Fire TV phone-app guide is a package route, not a bridge verb); version metadata only, with unchanged bridge verbs and protocol.
# 30 | maintainer@emeraldcoastsystemsgroup.com | Follow package 1.19.0 (the Fire TV guide declares devicePath in the manifest); version metadata only, with unchanged bridge verbs and protocol.
"""oshal phone bridge: one closed verb, one JSON line."""

import base64, glob, hashlib, json, os, re, shutil, signal, socket, subprocess, sys, time
from types import SimpleNamespace

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import oshal_phone_mirror  # noqa: E402
import oshal_phone_ops  # noqa: E402
import oshal_phone_lan  # noqa: E402

VERSION = '1.19.0'
MAX_OUT = 19000
CHUNK = 16000
FILES = ('oshal_phone_bridge.py', 'oshal_phone_ble.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py', 'oshal_phone_lan.py',
         'oshal_phone_links.py', 'oshal_phone_play.py', 'oshal_phone_apps.py')
WRAPPER = 'oshal-phone-bridge'
ADB_PACKAGES = ['adb', 'android-libbase', 'android-libboringssl', 'android-libcutils', 'android-liblog', 'android-libziparchive']
EARLIER_PORT_HEX = '0100007F:BADB'
EARLIER_SCRIPT = 'oshal_ble_hid.py'
ANDROID_KEYS = {'HOME': 3, 'BACK': 4, 'RECENTS': 187, 'MENU': 82, 'VOLUME_UP': 24, 'VOLUME_DOWN': 25, 'POWER': 26,
                'ENTER': 66, 'BACKSPACE': 67, 'TAB': 61, 'UP': 19, 'DOWN': 20, 'LEFT': 21, 'RIGHT': 22,
                'OK': 23, 'PLAY_PAUSE': 85}
TV_PORT = 5555
TV_HOST = re.compile(r'^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]{0,252})$')
ADDRESS = re.compile(r'^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]{0,252}):(\d{1,5})$')
SERIAL = re.compile(r'^[A-Za-z0-9\[][A-Za-z0-9._:\[\]-]{0,159}$')


class Refusal(Exception):
    def __init__(self, code, message, **extra):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra


def emit(payload):
    text = json.dumps(payload, separators=(',', ':'), ensure_ascii=True)
    if len(text) > MAX_OUT:
        text = json.dumps({'ok': False, 'error': 'output_too_large', 'message': 'The answer was larger than the computer can send back.'})
    sys.stdout.write(text + '\n')
    sys.stdout.flush()


def parse_args(argv):
    if not argv:
        raise Refusal('no_verb', 'Name what to do, for example: oshal-phone-bridge help')
    verb, rest, args, idx = argv[0], argv[1:], {}, 0
    while idx < len(rest):
        tok = rest[idx]
        if tok in ('--b64', '--json') and idx + 1 < len(rest):
            raw = rest[idx + 1]
            try:
                text = base64.b64decode(raw, validate=True).decode('utf-8') if tok == '--b64' else raw
                val = json.loads(text)
            except (ValueError, UnicodeDecodeError) as err:
                raise Refusal('bad_argument', f'The {tok} argument is not valid: {err}')
            if not isinstance(val, dict):
                raise Refusal('bad_argument', f'The {tok} argument must be a JSON object.')
            args.update(val)
            idx += 2
        elif '=' in tok and not tok.startswith('-'):
            name, val = tok.split('=', 1)
            args[name] = val
            idx += 1
        else:
            raise Refusal('bad_argument', f'Unexpected argument {tok[:40]!r}. Use name=value pairs.')
    return verb, args


def run(command, timeout=30, env=None, data=None, binary=False, cwd=None):
    try:
        done = subprocess.run(command, input=data, capture_output=True, timeout=timeout, env=env, cwd=cwd)
    except FileNotFoundError:
        raise Refusal('missing_program', f'{os.path.basename(command[0])} is not installed on this computer.')
    except subprocess.TimeoutExpired:
        raise Refusal('timed_out', f'{os.path.basename(command[0])} did not answer within {timeout} s.')
    out = done.stdout if binary else done.stdout.decode('utf-8', 'replace')
    return done.returncode, out, done.stderr.decode('utf-8', 'replace')


def home():
    return os.path.expanduser('~')


def install_dir():
    return os.environ.get('OSHAL_PHONE_BRIDGE_HOME') or os.path.join(home(), '.local', 'share', 'oshal-phone-bridge')


def runtime_dir():
    base = os.environ.get('XDG_RUNTIME_DIR')
    path = (os.path.join(base, 'oshal-phone-bridge') if base and os.path.isdir(base)
            else os.path.join(home(), '.local', 'state', 'oshal-phone-bridge', 'run'))
    if len(os.path.join(path, 'ble.sock').encode()) > 100:
        path = os.path.join('/tmp', f'oshal-phone-bridge-{os.getuid()}')
    os.makedirs(path, mode=0o700, exist_ok=True)
    if os.stat(path).st_uid != os.getuid():
        raise Refusal('unsafe_folder', f'{path} belongs to another account; phone-control will not use it.')
    os.chmod(path, 0o700)
    return path


def sha256_file(path):
    try:
        with open(path, 'rb') as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def number(args, name, low, high, default=None):
    val = args.get(name, default)
    try:
        val = int(val)
    except (TypeError, ValueError):
        raise Refusal('bad_argument', f'{name} must be a whole number.')
    if not low <= val <= high:
        raise Refusal('bad_argument', f'{name} must be between {low} and {high}.')
    return val


def adb_layout():
    root = os.path.join(install_dir(), 'adb')
    binary = os.path.join(root, 'usr', 'lib', 'android-sdk', 'platform-tools', 'adb')
    android = sorted(glob.glob(os.path.join(root, 'usr', 'lib', '*', 'android')))
    libs = android + [os.path.dirname(folder) for folder in android]
    return root, binary, (os.pathsep.join(libs) if android else None)


def find_adb():
    override = os.environ.get('OSHAL_ADB_BIN', '').strip()
    if override and os.access(override, os.X_OK):
        return {'path': override, 'env': dict(os.environ), 'source': 'override'}
    _, binary, libs = adb_layout()
    if os.access(binary, os.X_OK) and libs:
        return {'path': binary, 'env': dict(os.environ, LD_LIBRARY_PATH=libs), 'source': 'phone-control'}
    system = shutil.which('adb')
    return {'path': system, 'env': dict(os.environ), 'source': 'this computer'} if system else None


def adb_version(adb):
    code, out, err = run([adb['path'], 'version'], 15, adb['env'])
    match = re.search(r'^Version (\d+)\.(\d+)\.(\d+)', out, re.M)
    if not match:
        return {'text': '', 'major': 0, 'error': (err or out).strip()[-300:] or f'adb exited {code}'}
    return {'text': match.group(0)[8:], 'major': int(match.group(1))}


def adb_call(arguments, timeout=30, binary=False, data=None):
    adb = find_adb()
    if not adb:
        raise Refusal('no_adb', 'adb is not set up on this computer. Press Set up this computer in phone-control.')
    return run([adb['path']] + arguments, timeout, adb['env'], data=data, binary=binary)


def adb_words(text, address=''):
    low = text.lower()
    if 'not found' in low and 'device' in low:
        return 'not_connected', 'The phone is not connected to this computer. Open Connect a device and press Connect.'
    if 'unauthorized' in low:
        return 'unauthorized', 'The phone has not allowed this computer yet. Unlock the phone and press Allow.'
    if 'wrong password' in low or 'pairing failed' in low or 'protocol fault' in low:
        return 'pairing_refused', 'The phone refused the pairing code. Open Pair device with pairing code again and use the new code.'
    if any(w in low for w in ('unable to start pairing', 'connection refused', 'no route', 'timed out',
                              'failed to connect', 'cannot connect', 'network is unreachable')):
        return 'no_answer', (f'The phone did not answer at {address or "that address"}. Check the IP address and port '
                             'on the phone; the phone and this computer must be on the same Wi-Fi.')
    return 'adb_failed', 'adb did not do it.'


def adb_refusal(text, address=''):
    code, words = adb_words(text, address)
    return Refusal(code, words, adb=text.strip()[-400:])


def need_address(val):
    val = str(val or '').strip()
    match = ADDRESS.match(val)
    if not match or not 1 <= int(match.group(1)) <= 65535:
        raise Refusal('bad_address', 'Type the address as the phone shows it, for example 192.168.1.42:37123.')
    return val


LAST_ROTATED_SERIAL = {}


def need_serial(args):
    val = str(args.get('serial') or '').strip()
    if not SERIAL.match(val):
        raise Refusal('bad_serial', 'Name the phone by the address adb lists for it.')
    return LAST_ROTATED_SERIAL.get(val, val)


def rotatable_host(serial):
    match = re.fullmatch(r'(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})', str(serial or ''))
    if not match or int(match.group(2)) == TV_PORT:
        return ''
    return match.group(1)


def reconnect_rotated_serial(serial):
    host = rotatable_host(serial)
    if not host:
        return ''
    try:
        fresh = discover_connect_address(host)
    except Refusal:
        return ''
    _, out, err = adb_call(['connect', fresh], 15)
    if not re.search(r'^(already )?connected to ', (out + '\n' + err).strip(), re.M):
        return ''
    if fresh != serial:
        adb_call(['disconnect', serial], 5)
    LAST_ROTATED_SERIAL[serial] = fresh
    return fresh


def adb_device_call(serial, subargs, timeout=30, binary=False):
    cur = LAST_ROTATED_SERIAL.get(serial, serial)
    code, out, err = adb_call(['-s', cur] + subargs, timeout, binary=binary)
    if code and any(w in err.lower() for w in ('not found', 'offline', 'closed', 'cannot connect')):
        fresh = reconnect_rotated_serial(cur)
        if fresh:
            LAST_ROTATED_SERIAL[serial] = fresh
            cur = fresh
            code, out, err = adb_call(['-s', cur] + subargs, timeout, binary=binary)
    return cur, code, out, err


def adb_shell(serial, command, timeout=30):
    _, code, out, err = adb_device_call(serial, ['shell', command], timeout)
    if code and ('device' in err and 'not found' in err or 'offline' in err or 'unauthorized' in err):
        raise adb_refusal(err)
    return code, out, err


def installed(package):
    code, out, _ = run(['dpkg-query', '-W', '-f=${Status}', package], 15)
    return code == 0 and out.endswith('install ok installed')


def missing_dependencies(debs, initial=None):
    names, seen = set(), set(ADB_PACKAGES if initial is None else initial)
    for deb in sorted(glob.glob(os.path.join(debs, '*.deb'))):
        _, depends, _ = run(['dpkg-deb', '-f', deb, 'Depends'], 15)
        for clause in depends.split(','):
            name = clause.strip().split('|')[0].split('(')[0].strip().split(':')[0]
            if name and name not in seen:
                seen.add(name)
                if not installed(name):
                    names.add(name)
    return sorted(names)


def download_and_unpack(packages, debs, stage, label='adb'):
    code, _, err = run(['apt-get', 'download'] + packages, 240, cwd=debs)
    if code:
        raise Refusal('download_failed', f'apt-get could not download {label}: ' + (err.strip().splitlines() or ['?'])[-1][:300])
    for deb in sorted(glob.glob(os.path.join(debs, '*.deb'))):
        code, _, err = run(['dpkg-deb', '-x', deb, stage], 60)
        if code:
            raise Refusal('unpack_failed', f'dpkg-deb could not unpack {os.path.basename(deb)}: {err.strip()[:200]}')


def verb_setup_adb(args):
    cur = find_adb()
    if cur and adb_version(cur)['major'] >= 30:
        return {'ok': True, 'adb': adb_summary(cur, devices=False)}
    if not shutil.which('apt-get') or not shutil.which('dpkg-deb'):
        raise Refusal('no_apt', 'This computer has no apt-get. Install Android platform-tools (adb 30 or newer), then press Set up this computer again.')
    root = adb_layout()[0]
    stage, debs = root + '.new', os.path.join(root + '.new', 'debs')
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(debs, mode=0o700)
    try:
        download_and_unpack(ADB_PACKAGES, debs, stage)
        extra = missing_dependencies(debs)
        if extra:
            for deb in glob.glob(os.path.join(debs, '*.deb')):
                os.remove(deb)
            download_and_unpack(extra, debs, stage)
            extra += [name for name in missing_dependencies(debs) if name not in extra]
    except Refusal:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    shutil.rmtree(debs)
    shutil.rmtree(root, ignore_errors=True)
    os.rename(stage, root)
    adb = find_adb()
    ver = adb_version(adb) if adb else {'major': 0, 'error': 'adb was not unpacked'}
    if ver.get('error'):
        raise Refusal('adb_failed', 'The downloaded adb does not run on this computer: ' + ver['error'])
    if ver['major'] < 30:
        raise Refusal('adb_too_old', 'The adb this computer can download is older than 30, which cannot pair over Wi-Fi.')
    return {'ok': True, 'installed': True, 'libraries': extra, 'adb': adb_summary(adb, devices=False)}


def list_devices():
    code, out, err = adb_call(['devices', '-l'], 20)
    if code:
        raise adb_refusal(err)
    devices, ignored = [], 0
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2 or line.startswith('*'):
            continue
        serial, state = parts[0], parts[1]
        if serial.startswith('emulator-') and state == 'offline':
            ignored += 1
            continue
        extra = dict(part.split(':', 1) for part in parts[2:] if ':' in part)
        devices.append({'serial': serial, 'state': state, 'model': extra.get('model', '').replace('_', ' '),
                        'wireless': ':' in serial or '._adb-tls-connect.' in serial})
    return devices, ignored


def adb_summary(adb=None, devices=True):
    adb = adb or find_adb()
    if not adb:
        return {'ready': False, 'message': 'adb is not set up on this computer.'}
    ver = adb_version(adb)
    words = ('Android tools ready' if ver['major'] >= 30 else f"adb does not run: {ver['error']}" if ver.get('error')
             else 'adb is older than 30 and cannot pair over Wi-Fi.')
    summary = {'ready': ver['major'] >= 30, 'version': ver['text'], 'source': adb['source'], 'message': words}
    if devices and summary['ready']:
        summary['devices'], summary['ignoredEmulatorPorts'] = list_devices()
    return summary


def verb_adb_pair(args):
    address = need_address(args.get('address'))
    code = str(args.get('code', '')).strip()
    if not re.fullmatch(r'\d{6}', code):
        raise Refusal('bad_code', 'The pairing code is the 6 digits under Wi-Fi pairing code on the phone.')
    _, out, err = adb_call(['pair', address, code], 45)
    text = (out + '\n' + err).strip()
    if 'Successfully paired' in text:
        return {'ok': True, 'paired': address, 'adb': text.splitlines()[0][:200]}
    raise adb_refusal(text, address)


def avahi_tls_candidates():
    avahi = os.environ.get('OSHAL_AVAHI_BIN', '').strip() or ('' if os.environ.get('OSHAL_ADB_BIN') else 'avahi-browse')
    if not avahi:
        return []
    try:
        done = subprocess.run([avahi, '-rpt', '--terminate', '_adb-tls-connect._tcp'],
                              capture_output=True, text=True, timeout=4)
        text = done.stdout or ''
    except subprocess.TimeoutExpired as exc:
        raw = exc.stdout or ''
        text = raw if isinstance(raw, str) else raw.decode('utf-8', 'replace')
    except (FileNotFoundError, OSError):
        return []
    rows = []
    for line in text.splitlines():
        parts = line.split(';')
        if len(parts) >= 9 and parts[0] == '=' and parts[4] == '_adb-tls-connect._tcp':
            ip, port, txt = parts[7].strip(), parts[8].strip(), ';'.join(parts[9:])
            if re.fullmatch(r'\d{1,3}(?:\.\d{1,3}){3}', ip) and port.isdigit() and 1 <= int(port) <= 65535:
                rows.append((ip, port, txt))
    return rows


def discover_connect_address(host=None):
    target = str(host or '').strip()
    if target and not TV_HOST.match(target):
        raise Refusal('bad_address', 'Type the phone IP address, for example 192.168.1.42.')
    _, out, _ = adb_call(['mdns', 'services'], 12)
    entries = []
    for line in out.splitlines():
        if '_adb-tls-connect._tcp' in line and line.split():
            addr = line.split()[-1]
            if ADDRESS.match(addr):
                h, p = addr.rsplit(':', 1)
                entries.append((h, p, line))
    entries.extend(avahi_tls_candidates())
    tv_ips = set()
    if not target:
        try:
            tv_ips = {d['serial'].rsplit(':', 1)[0] for d in list_devices()[0]
                      if d['serial'].endswith(f':{TV_PORT}') or re.match(r'^AFT', d.get('model') or '', re.I)}
        except Refusal:
            tv_ips = set()
    found = []
    for h, p, meta in entries:
        if target and h != target:
            continue
        if not target and (int(p) == TV_PORT or h in tv_ips or re.search(r'name=["\']?AFT', meta, re.I)):
            continue
        cand = f'{h}:{p}'
        if cand not in found:
            found.append(cand)
    if len(found) == 1 or (target and found):
        return found[0]
    if not found:
        msg = (f'Could not auto-detect the Wireless debugging port for {target}. Type {target}:<port> from the top of the Wireless debugging screen into Connect address.'
               if target else "No phone on this network is offering Wireless debugging. Type the IP address and port from the phone's Wireless debugging screen into Connect address.")
        raise Refusal('not_found', msg)
    raise Refusal('choose', 'More than one phone offers Wireless debugging; type the address of yours.', candidates=found)


def verb_adb_connect(args):
    raw_addr = str(args.get('address') or '').strip()
    raw_host = str(args.get('host') or '').strip()
    address = need_address(raw_addr or discover_connect_address(raw_host or None))
    _, out, err = adb_call(['connect', address], 25)
    text = (out + '\n' + err).strip()
    if re.search(r'^(already )?connected to ', text, re.M):
        return {'ok': True, 'serial': address, 'adb': text.splitlines()[0][:200]}
    fresh = reconnect_rotated_serial(address) if raw_addr else ''
    if fresh:
        return {'ok': True, 'serial': fresh, 'adb': f'connected to {fresh}'}
    raise adb_refusal(text, address)


def tv_address(val):
    val = str(val or '').strip()
    if TV_HOST.match(val):
        val = f'{val}:{TV_PORT}'
    match = ADDRESS.match(val)
    if not match or not 1 <= int(match.group(1)) <= 65535:
        raise Refusal('bad_address', "Type the TV's IP address, for example 192.168.1.42. It is under Settings, My Fire TV, About, Network.")
    return val


def verb_adb_connect_tv(args):
    address = tv_address(args.get('address'))
    _, out, err = adb_call(['connect', address], 25)
    text = (out + '\n' + err).strip()
    state = next((dev['state'] for dev in list_devices()[0] if dev['serial'] == address), '')
    if state == 'device':
        return {'ok': True, 'serial': address, 'adb': text.splitlines()[0][:200] if text else ''}
    if state == 'unauthorized' or 'authenticate' in text.lower():
        raise Refusal('tv_unauthorized', 'The TV is asking "Allow USB debugging?". On the TV, tick Always allow from this computer and choose OK, then press Connect TV again.', adb=text[-400:])
    if any(w in text.lower() for w in ('connection refused', 'no route', 'timed out', 'failed to connect', 'cannot connect', 'network is unreachable', 'unable to connect')):
        raise Refusal('no_answer', f'The TV did not answer at {address}. Check the address under Settings, My Fire TV, About, Network; turn on ADB debugging under Developer options; the TV and this computer must be on the same network.', adb=text[-400:])
    raise adb_refusal(text, address)


def verb_adb_disconnect(args):
    serial = need_serial(args)
    _, out, err = adb_call(['disconnect', serial], 15)
    return {'ok': True, 'serial': serial, 'adb': (out + err).strip()[:200]}


def verb_adb_devices(args):
    devices, ignored = list_devices()
    return {'ok': True, 'devices': devices, 'ignoredEmulatorPorts': ignored}


def verb_adb_info(args):
    serial = need_serial(args)
    code, out, err = adb_shell(serial, 'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; wm size')
    if code:
        raise adb_refusal(err or out)
    lines = out.splitlines()
    size = re.findall(r'(\d+)x(\d+)', out)
    width, height = (int(size[-1][0]), int(size[-1][1])) if size else (0, 0)
    return {'ok': True, 'serial': LAST_ROTATED_SERIAL.get(serial, serial), 'manufacturer': (lines[0:1] or [''])[0].strip(),
            'model': (lines[1:2] or [''])[0].strip(), 'android': (lines[2:3] or [''])[0].strip(),
            'width': width, 'height': height}


def verb_adb_tap(args):
    serial = need_serial(args)
    x, y = number(args, 'x', 0, 20000), number(args, 'y', 0, 20000)
    code, out, err = adb_shell(serial, f'input tap {x} {y}')
    if code:
        raise adb_refusal(err or out)
    return {'ok': True, 'tapped': [x, y]}


def verb_adb_swipe(args):
    serial = need_serial(args)
    pts = [number(args, name, 0, 20000) for name in ('x1', 'y1', 'x2', 'y2')]
    dur = number(args, 'ms', 50, 3000, 300)
    code, out, err = adb_shell(serial, 'input swipe {} {} {} {} {}'.format(*pts, dur))
    if code:
        raise adb_refusal(err or out)
    return {'ok': True, 'swiped': pts}


def verb_adb_key(args):
    serial = need_serial(args)
    key = str(args.get('key', '')).upper()
    if key not in ANDROID_KEYS:
        raise Refusal('unknown_key', f'There is no {key or "empty"} key here. Keys: ' + ', '.join(sorted(ANDROID_KEYS)))
    code, out, err = adb_shell(serial, f'input keyevent {ANDROID_KEYS[key]}')
    if code:
        raise adb_refusal(err or out)
    return {'ok': True, 'key': key}


def android_text_segments(text):
    if not isinstance(text, str) or not text:
        raise Refusal('no_text', 'Type something to send.')
    if len(text) > 500:
        raise Refusal('too_long', 'Send at most 500 characters at a time.')
    bad = sorted({ch for ch in text if ch != '\n' and not ' ' <= ch <= '~'})
    if bad:
        raise Refusal('cannot_type', 'Android typing over adb takes only plain keyboard characters; it cannot type ' + ' '.join(bad[:10]) + '. Nothing was sent.')
    if '%s' in text:
        raise Refusal('cannot_type', 'The two characters %s cannot be typed over adb: Android reads them as a space. Nothing was sent.')
    return text.split('\n')


def device_quote(val):
    return "'" + val.replace("'", "'\\''") + "'"


def verb_adb_text(args):
    serial = need_serial(args)
    for idx, seg in enumerate(android_text_segments(args.get('text'))):
        if idx:
            adb_shell(serial, 'input keyevent 66')
        if seg:
            code, out, err = adb_shell(serial, 'input text ' + device_quote(seg.replace(' ', '%s')))
            if code:
                raise adb_refusal(err or out)
    return {'ok': True, 'typed': len(args.get('text'))}


def ble_paths():
    folder = runtime_dir()
    return {'socket': os.path.join(folder, 'ble.sock'), 'pid': os.path.join(folder, 'ble.pid'), 'log': os.path.join(folder, 'ble.log')}


def process_argv(pid):
    try:
        with open(f'/proc/{pid}/cmdline', 'rb') as handle:
            return [part.decode('utf-8', 'replace') for part in handle.read().split(b'\0') if part]
    except OSError:
        return []


def ble_pid():
    try:
        with open(ble_paths()['pid']) as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        return None
    return pid if any(part.endswith('oshal_phone_ble.py') for part in process_argv(pid)) else None


def ble_request(op, payload=None, timeout=60):
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(timeout)
    try:
        conn.connect(ble_paths()['socket'])
        conn.sendall(json.dumps(dict(payload or {}, op=op)).encode('utf-8') + b'\n')
        reply = b''
        while not reply.endswith(b'\n'):
            part = conn.recv(65536)
            if not part:
                break
            reply += part
    except (FileNotFoundError, ConnectionRefusedError):
        raise Refusal('ble_not_running', 'The Bluetooth keyboard is not running on this computer. Press Set up this computer in phone-control.')
    except socket.timeout:
        raise Refusal('timed_out', 'The Bluetooth keyboard did not answer in time.')
    except OSError as err:
        raise Refusal('ble_not_running', f'The Bluetooth keyboard could not be reached: {err}.')
    finally:
        conn.close()
    try:
        return json.loads(reply.decode('utf-8'))
    except ValueError:
        raise Refusal('ble_failed', 'The Bluetooth keyboard gave no answer.')


def bluetooth_prerequisites():
    found = {'ready': False, 'bluez': None, 'adapter': None}
    if shutil.which('bluetoothctl'):
        _, out, _ = run(['bluetoothctl', '--version'], 10)
        found['bluez'] = out.strip().split()[-1] if out.strip() else None
    try:
        import dbus  # noqa: F401
        from gi.repository import GLib  # noqa: F401
    except ImportError:
        return dict(found, message='Bluetooth needs python3-dbus and python3-gi on this computer.')
    try:
        bus = dbus.SystemBus()
        objects = dbus.Interface(bus.get_object('org.bluez', '/'), 'org.freedesktop.DBus.ObjectManager').GetManagedObjects()
    except dbus.exceptions.DBusException as err:
        return dict(found, message='No Bluetooth adapter on this computer.', detail=err.get_dbus_name())
    adapters = sorted((str(p), props['org.bluez.Adapter1']) for p, props in objects.items() if 'org.bluez.Adapter1' in props)
    if not adapters:
        return dict(found, message='No Bluetooth adapter on this computer.')
    path, props = adapters[0]
    found['adapter'] = {'path': path, 'address': str(props.get('Address', '')), 'name': str(props.get('Alias', '')),
                        'powered': bool(props.get('Powered')), 'pairable': bool(props.get('Pairable'))}
    return dict(found, ready=True, message='Bluetooth ready')


def find_earlier_keyboard():
    try:
        with open('/proc/net/tcp') as handle:
            rows = [line.split() for line in handle.read().splitlines()[1:]]
    except OSError:
        return None
    inodes = {row[9] for row in rows if len(row) > 9 and row[1].upper() == EARLIER_PORT_HEX and row[3] == '0A'}
    if not inodes:
        return None
    targets = {f'socket:[{inode}]' for inode in inodes}
    for pid in (name for name in os.listdir('/proc') if name.isdigit()):
        try:
            if os.stat(f'/proc/{pid}').st_uid != os.getuid():
                continue
            if any(os.readlink(f'/proc/{pid}/fd/{fd}') in targets for fd in os.listdir(f'/proc/{pid}/fd')):
                argv = process_argv(pid)
                if argv and os.path.basename(argv[-1]) == EARLIER_SCRIPT:
                    return {'pid': int(pid), 'argv': argv, 'cwd': os.readlink(f'/proc/{pid}/cwd')}
        except OSError:
            continue
    return None


def stop_process(pid, seconds=5):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return True
    end = time.time() + seconds
    while time.time() < end:
        if not os.path.exists(f'/proc/{pid}'):
            return True
        time.sleep(0.2)
    os.kill(pid, signal.SIGKILL)
    time.sleep(0.5)
    return not os.path.exists(f'/proc/{pid}')


def start_detached(argv, log_path, cwd):
    with open(log_path, 'ab') as log:
        return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True, close_fds=True, cwd=cwd).pid


def self_check(seconds=20):
    end, last = time.time() + seconds, 'it did not start'
    while time.time() < end:
        try:
            status = ble_request('status', timeout=3)
            if status.get('registered') and status.get('advertising'):
                return True, status
            last = status.get('problem') or 'it has not registered with BlueZ yet'
        except Refusal as refusal:
            last = refusal.message
        time.sleep(0.5)
    return False, last


def log_tail(path, size=600):
    try:
        with open(path, 'rb') as handle:
            handle.seek(max(0, os.path.getsize(path) - size))
            return handle.read().decode('utf-8', 'replace')
    except OSError:
        return ''


def verb_ensure(args):
    prereq = bluetooth_prerequisites()
    if not prereq['ready']:
        raise Refusal('no_bluetooth', prereq['message'], bluetooth=prereq)
    if ble_pid():
        ok, status = self_check(5)
        if ok and status.get('code') == sha256_file(os.path.join(HERE, 'oshal_phone_ble.py')):
            return {'ok': True, 'started': False, 'ble': status}
        stop_process(ble_pid())
    earlier = find_earlier_keyboard()
    if earlier and str(args.get('replaceEarlier', '')).lower() not in ('true', '1'):
        raise Refusal('earlier_keyboard_running', f'An earlier test keyboard (process {earlier["pid"]}) is using Bluetooth on this computer. Press Replace the earlier test keyboard to let phone-control take over.',
                      earlier={'pid': earlier['pid'], 'program': os.path.basename(earlier['argv'][-1])})
    if earlier:
        with open(os.path.join(install_dir(), 'earlier-keyboard.json'), 'w') as handle:
            json.dump(dict(earlier, stoppedAt=time.time()), handle)
        stop_process(earlier['pid'])
    paths = ble_paths()
    start_detached([sys.executable, '-I', os.path.join(HERE, 'oshal_phone_ble.py'), 'serve', runtime_dir()], paths['log'], runtime_dir())
    ok, status = self_check(20)
    if ok:
        return {'ok': True, 'started': True, 'replacedEarlier': bool(earlier), 'ble': status}
    if ble_pid():
        stop_process(ble_pid())
    restored = None
    if earlier:
        rpid = start_detached(earlier['argv'], os.path.join(runtime_dir(), 'earlier-keyboard.log'), earlier['cwd'])
        time.sleep(3)
        restored = {'pid': rpid, 'listening': find_earlier_keyboard() is not None}
    raise Refusal('self_check_failed', f'The Bluetooth keyboard did not come up within 20 s: {status}.',
                  restoredEarlier=restored, log=log_tail(paths['log']))


def verb_stop(args):
    pid = ble_pid()
    return {'ok': True, 'stopped': bool(pid and stop_process(pid))}


def ble_op(op, payload=None):
    reply = ble_request(op, payload or {})
    if not reply.get('ok'):
        raise Refusal(reply.get('error', 'ble_failed'), reply.get('message', 'The Bluetooth keyboard did not do it.'),
                      **{k: v for k, v in reply.items() if k not in ('ok', 'error', 'message')})
    return reply


def ble_passthrough(op, fields):
    return lambda args: ble_op(op, {name: args[name] for name in fields if name in args})


def file_hashes():
    hashes = {name: sha256_file(os.path.join(HERE, name)) for name in FILES}
    hashes[WRAPPER] = sha256_file(os.path.join(home(), '.local', 'bin', WRAPPER))
    return hashes


MIRROR_CTX = SimpleNamespace(
    Refusal=Refusal, CHUNK=CHUNK, MAX_OUT=MAX_OUT, run=run, install_dir=install_dir, runtime_dir=runtime_dir,
    installed=installed, missing_dependencies=missing_dependencies, download_and_unpack=download_and_unpack,
    process_argv=process_argv, stop_process=stop_process, log_tail=log_tail, number=number,
    need_serial=need_serial, adb_call=adb_call, adb_device_call=adb_device_call,
    reconnect_rotated_serial=reconnect_rotated_serial, adb_shell=adb_shell, adb_refusal=adb_refusal,
    device_quote=device_quote, list_devices=list_devices, ble_op=ble_op, verb_adb_connect_tv=verb_adb_connect_tv,
    verb_adb_info=verb_adb_info, verb_adb_tap=verb_adb_tap, verb_adb_swipe=verb_adb_swipe,
    verb_adb_text=verb_adb_text, verb_adb_key=verb_adb_key,
)


def verb_mirror(fn):
    return lambda args: getattr(oshal_phone_mirror, fn)(MIRROR_CTX, args)


def verb_ops(fn):
    return lambda args: getattr(oshal_phone_ops, fn)(MIRROR_CTX, args)


def verb_lan(fn):
    return lambda args: getattr(oshal_phone_lan, fn)(MIRROR_CTX, args)


def verb_version(args):
    return {'ok': True, 'version': VERSION, 'files': file_hashes(), 'python': sys.version.split()[0]}


def verb_status(args):
    try:
        ble = ble_request('status', timeout=5) if ble_pid() else None
    except Refusal:
        ble = None
    earlier = find_earlier_keyboard()
    try:
        adb = adb_summary(devices=str(args.get('adb', 'true')).lower() != 'false')
    except Refusal as refusal:
        adb = {'ready': False, 'message': refusal.message}
    return {'ok': True, 'version': VERSION, 'files': file_hashes(), 'python': sys.version.split()[0],
            'bluetooth': bluetooth_prerequisites(), 'ble': ble, 'ffmpeg': bool(shutil.which('ffmpeg')),
            'earlierKeyboard': {'pid': earlier['pid']} if earlier else None, 'adb': adb,
            'tvApk': oshal_phone_mirror.local_tv_apk_summary(),
            'mirror': oshal_phone_mirror.mirror_summary(MIRROR_CTX), 'readAt': int(time.time() * 1000)}


def verb_uninstall(args):
    removed = []
    pid = ble_pid()
    if pid and stop_process(pid):
        removed.append('keyboard')
    mpid = oshal_phone_mirror.mirror_pid(MIRROR_CTX)
    if mpid and stop_process(mpid):
        removed.append('mirror')
    _, binary, _ = adb_layout()
    for proc in (name for name in os.listdir('/proc') if name.isdigit()):
        try:
            if os.readlink(f'/proc/{proc}/exe') == binary:
                stop_process(int(proc))
                removed.append('adb server')
        except OSError:
            continue
    if oshal_phone_lan.forget_tokens():
        removed.append('TV pairings')
    wrapper = os.path.join(home(), '.local', 'bin', WRAPPER)
    if os.path.exists(wrapper):
        os.remove(wrapper)
        removed.append(wrapper)
    shutil.rmtree(runtime_dir(), ignore_errors=True)
    shutil.rmtree(install_dir(), ignore_errors=True)
    removed.append(install_dir())
    return {'ok': True, 'removed': removed}


VERBS = {
    'help': (lambda args: {'ok': True, 'version': VERSION, 'verbs': HELP}),
    'version': verb_version, 'status': verb_status, 'setup-adb': verb_setup_adb, 'uninstall': verb_uninstall,
    'setup-mirror': verb_mirror('verb_setup_mirror'), 'mirror-start': verb_mirror('verb_mirror_start'),
    'mirror-stop': verb_mirror('verb_mirror_stop'), 'mirror-frame': verb_mirror('verb_mirror_frame'),
    'mirror-ui': verb_mirror('verb_mirror_ui'), 'ensure': verb_ensure, 'stop': verb_stop,
    'ble-status': ble_passthrough('status', ()), 'ble-sync': ble_passthrough('sync', ('address', 'waitS')),
    'ble-pair-window': ble_passthrough('pair-window', ('seconds',)),
    'ble-devices': ble_passthrough('devices', ()), 'ble-remove': ble_passthrough('forget', ('address',)),
    'ble-pair-answer': ble_passthrough('pair-answer', ('address', 'allow')), 'ble-keep': ble_passthrough('keep', ('address',)),
    'ble-type': ble_passthrough('type', ('text', 'enter', 'address')),
    'ble-key': ble_passthrough('key', ('key', 'address')),
    'ble-mouse': ble_passthrough('mouse', ('dx', 'dy', 'click', 'rehome', 'address')),
    'ble-move': ble_passthrough('move', ('nx', 'ny', 'landscape', 'rehome', 'spanX', 'spanY', 'address')),
    'ble-tap': ble_passthrough('tap', ('nx', 'ny', 'landscape', 'rehome', 'spanX', 'spanY', 'address')),
    'ble-swipe': ble_passthrough('swipe', ('nx1', 'ny1', 'nx2', 'ny2', 'ms', 'landscape', 'spanX', 'spanY', 'address')),
    'ble-drag': ble_passthrough('drag', ('nx1', 'ny1', 'nx2', 'ny2', 'holdMs', 'landscape', 'spanX', 'spanY', 'address')),
    'ble-scroll': ble_passthrough('scroll', ('dy', 'address')),
    'ble-open': ble_passthrough('open', ('name', 'address')),
    'ble-calibrate': verb_ops('verb_ble_calibrate'), 'rdp-probe': verb_ops('verb_rdp_probe'),
    'screen-info': verb_ops('verb_screen_info'), 'pointer-move': verb_ops('verb_pointer_move'),
    'pointer-click': verb_ops('verb_pointer_click'), 'pointer-drag': verb_ops('verb_pointer_drag'),
    'keyboard-type': verb_ops('verb_keyboard_type'), 'keyboard-key': verb_ops('verb_keyboard_key'),
    'adb-pair': verb_adb_pair, 'adb-connect': verb_adb_connect, 'adb-connect-tv': verb_adb_connect_tv,
    'adb-scan-tv': verb_mirror('verb_adb_scan_tv'), 'stage-chunk': verb_mirror('verb_stage_chunk'),
    'adb-install-apk': verb_mirror('verb_adb_install_apk'), 'adb-disconnect': verb_adb_disconnect,
    'adb-devices': verb_adb_devices, 'adb-info': verb_adb_info, 'adb-tap': verb_adb_tap, 'adb-swipe': verb_adb_swipe,
    'adb-text': verb_adb_text, 'adb-key': verb_adb_key, 'adb-apps': verb_mirror('verb_adb_apps'),
    'adb-launch': verb_mirror('verb_adb_launch'), 'adb-ui': verb_mirror('verb_adb_ui'),
    'adb-frame': verb_mirror('verb_adb_frame'), 'frame-chunk': verb_mirror('verb_frame_chunk'),
    'adb-files': verb_mirror('verb_adb_files'), 'adb-push': verb_mirror('verb_adb_push'),
    'adb-pull': verb_mirror('verb_adb_pull'), 'adb-clipboard-get': verb_mirror('verb_adb_clipboard_get'),
    'adb-clipboard-set': verb_mirror('verb_adb_clipboard_set'),
    'lan-discover': verb_lan('verb_lan_discover'), 'lan-control': verb_lan('verb_lan_control'),
}
HELP = {
    'status': 'Bluetooth, keyboard, AirPlay mirror, adb and phones',
    'ensure': 'start iPhone keyboard [replaceEarlier=true]', 'stop': 'stop iPhone keyboard',
    'setup-mirror': 'unpack UxPlay + GStreamer', 'mirror-start': 'start AirPlay receiver',
    'mirror-stop': 'stop AirPlay receiver', 'mirror-frame': '[width=432] mirrored iPhone JPEG',
    'mirror-ui': 'mirrored iPhone screen text and coordinates',
    'ble-sync': 'reconnect Bluetooth and center pointer [address=MAC]',
    'ble-pair-window': 'open pairing window [seconds=120]', 'ble-devices': 'paired iPhones',
    'ble-remove': 'forget paired device: address=...', 'ble-type': 'type on iPhone: text=... [enter=true]',
    'ble-pair-answer': 'answer a device waiting to pair: address=... allow=true|false',
    'ble-keep': 'keep a device paired before oshal asked: address=...',
    'ble-key': 'key=Home|Spotlight|VolumeUp|VolumeDown|Enter|Escape|Backspace|Tab|Up|Down|Left|Right',
    'ble-mouse': 'move iPhone pointer: dx= dy= [click=true] [rehome=true]',
    'ble-move': 'move iPhone pointer: nx=0..1 ny=0..1',
    'ble-tap': 'tap iPhone screen: nx=0..1 ny=0..1', 'ble-swipe': 'swipe iPhone: nx1= ny1= nx2= ny2=',
    'ble-drag': 'long-press drag iPhone icon: nx1= ny1= nx2= ny2= [holdMs=700]',
    'ble-scroll': 'scroll iPhone wheel: dy=-40..40', 'ble-open': 'open iPhone app: name="Notes"',
    'ble-calibrate': 'learn iOS pointer gain from live AirPlay mirror [address=MAC]',
    'rdp-probe': 'verify TCP + X.224 RDP handshake: host=... [port=3389]',
    'screen-info': 'detect screen width x height and visible text: [platform=ios|android]',
    'pointer-move': 'move pointer to (x, y): x= y= [width= height=]',
    'pointer-click': 'click screen at (x, y): x= y= [width= height=]',
    'pointer-drag': 'drag or swipe (x1, y1)->(x2, y2): [holdMs=700]',
    'keyboard-type': 'type text into focused input: text=... [enter=true]',
    'keyboard-key': 'press named key: key=Enter|Backspace|Home|Up|Down|Left|Right|Select|Back|Menu|PlayPause',
    'setup-adb': 'unpack adb 30+', 'adb-pair': 'address=IP:port code=123456', 'adb-connect': '[address=IP:port]',
    'adb-connect-tv': 'address=IP[:port]', 'adb-scan-tv': 'scan Wi-Fi LAN for Fire TV / Android TV port 5555',
    'stage-chunk': 'id= index= total= sha256= data=', 'adb-install-apk': 'serial= stageId= sha256= [launchPackage=...]',
    'adb-devices': 'connected Android devices', 'adb-info': 'serial=...', 'adb-tap': 'serial= x= y=',
    'adb-swipe': 'serial= x1= y1= x2= y2= [ms=300]', 'adb-text': 'serial= text="..."',
    'adb-key': 'serial= key=' + '|'.join(sorted(ANDROID_KEYS)), 'adb-apps': 'serial=', 'adb-launch': 'serial= package=',
    'adb-ui': 'serial=', 'adb-frame': 'serial= [width=432]', 'frame-chunk': 'id= index=',
    'adb-files': 'serial=', 'adb-push': 'serial= name= data=', 'adb-pull': 'serial= name= [offset=0]',
    'adb-clipboard-get': 'serial=', 'adb-clipboard-set': 'serial= text="..."',
    'adb-disconnect': 'serial=', 'version': 'bridge version and file hashes', 'uninstall': 'remove bridge',
    'lan-discover': 'find TVs and streaming sticks on this computer\'s home network, read-only, installs nothing '
                    '[wake=[{"mac":..,"address":..}] wakes only those saved TVs]',
    'lan-control': 'kind=android-tv|samsung-tizen|roku address=<private IPv4> action=wake|off|volume_up|volume_down|mute|'
                   'up|down|left|right|select|home|back|play_pause|launch_url|open_app|pair [mac=..] [url=https://..]',
}


def main(argv):
    try:
        verb, args = parse_args(argv)
        if verb not in VERBS:
            raise Refusal('unknown_verb', f'There is no {verb[:40]!r} here. Run: oshal-phone-bridge help')
        emit(dict({'ok': True, 'verb': verb}, **VERBS[verb](args)))
        return 0
    except Refusal as refusal:
        emit(dict(refusal.extra, ok=False, error=refusal.code, message=refusal.message))
        return 3
    except Exception as err:
        import traceback
        traceback.print_exc()
        emit({'ok': False, 'error': 'bridge_failed', 'message': f'The bridge failed: {type(err).__name__}: {err}'})
        return 4


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
