#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: the bridge on the person's own computer (Roger, 2026-11-06: "phone control fix it place"). OSHAL Node runs it through shell.exec when the person presses a button in phone-control: Android over adb (Wi-Fi pairing, the screen, taps, keys, typing, apps and the words on screen) and an iPhone through the resident Bluetooth keyboard in oshal_phone_ble.py. A closed list of verbs, one JSON argument, one JSON line back, never more than 19,000 characters, so it fits the computer's answer.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Set up also fetches any library adb needs that the computer lacks (read from the adb packages' own Depends, unpacked beside it), and an adb that cannot start says why instead of reading as too old.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: the version follows the package; no behaviour change.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: the version follows the package; no behaviour change.
"""oshal phone bridge.

Usage: oshal_phone_bridge.py <verb> [--b64 <base64 JSON> | --json '<JSON>' | name=value ...]
Run `oshal_phone_bridge.py help` for the verbs and their arguments.
Every run prints exactly one JSON line.
"""

import base64
import glob
import hashlib
import json
import math
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from xml.etree import ElementTree

VERSION = '1.1.2'
MAX_OUT = 19000
CHUNK = 16000
HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ('oshal_phone_bridge.py', 'oshal_phone_ble.py')
WRAPPER = 'oshal-phone-bridge'
ADB_PACKAGES = ['adb', 'android-libbase', 'android-libboringssl', 'android-libcutils', 'android-liblog',
                'android-libziparchive']
# The earlier hand-started test keyboard this replaces, found by what it is, never by where it lives.
EARLIER_PORT_HEX = '0100007F:BADB'  # 127.0.0.1:47835
EARLIER_SCRIPT = 'oshal_ble_hid.py'
ANDROID_KEYS = {'HOME': 3, 'BACK': 4, 'RECENTS': 187, 'VOLUME_UP': 24, 'VOLUME_DOWN': 25, 'POWER': 26,
                'ENTER': 66, 'BACKSPACE': 67, 'TAB': 61, 'UP': 19, 'DOWN': 20, 'LEFT': 21, 'RIGHT': 22}
ADDRESS = re.compile(r'^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]{0,252}):(\d{1,5})$')
SERIAL = re.compile(r'^[A-Za-z0-9\[][A-Za-z0-9._:\[\]-]{0,159}$')
PACKAGE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$')
FRAME_ID = re.compile(r'^[0-9a-f]{16}$')


class Refusal(Exception):
    """A run that could not do what was asked, with a code, the words for the person and any detail."""

    def __init__(self, code, message, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra


# ───────────────────────── output, arguments, programs ─────────────────────────

def emit(payload):
    """Print the one JSON line; an answer that would not fit says so instead of being cut."""
    text = json.dumps(payload, separators=(',', ':'), ensure_ascii=True)
    if len(text) > MAX_OUT:
        text = json.dumps({'ok': False, 'error': 'output_too_large',
                           'message': 'The answer was larger than the computer can send back.'})
    sys.stdout.write(text + '\n')
    sys.stdout.flush()


def parse_args(argv):
    """The verb and its arguments: --b64 (what phone-control sends), --json, or name=value (for a person or Jarvis)."""
    if not argv:
        raise Refusal('no_verb', 'Name what to do, for example: oshal-phone-bridge help')
    verb, rest, args, index = argv[0], argv[1:], {}, 0
    while index < len(rest):
        token = rest[index]
        if token in ('--b64', '--json') and index + 1 < len(rest):
            raw = rest[index + 1]
            try:
                text = base64.b64decode(raw, validate=True).decode('utf-8') if token == '--b64' else raw
                value = json.loads(text)
            except (ValueError, UnicodeDecodeError) as error:
                raise Refusal('bad_argument', f'The {token} argument is not valid: {error}')
            if not isinstance(value, dict):
                raise Refusal('bad_argument', f'The {token} argument must be a JSON object.')
            args.update(value)
            index += 2
        elif '=' in token and not token.startswith('-'):
            name, value = token.split('=', 1)
            args[name] = value
            index += 1
        else:
            raise Refusal('bad_argument', f'Unexpected argument {token[:40]!r}. Use name=value pairs.')
    return verb, args


def run(command, timeout=30, env=None, data=None, binary=False, cwd=None):
    """Run one program without a shell. @returns (exit code, stdout, stderr)."""
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
    return os.path.join(home(), '.local', 'share', 'oshal-phone-bridge')


def runtime_dir():
    """Where the resident keyboard's socket, pid and pictures live: private to this account. A unix socket
    path is at most 107 bytes, so a long home falls back to a private folder under /tmp."""
    base = os.environ.get('XDG_RUNTIME_DIR')
    if base and os.path.isdir(base):
        path = os.path.join(base, 'oshal-phone-bridge')
    else:
        path = os.path.join(home(), '.local', 'state', 'oshal-phone-bridge', 'run')
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
    """A whole number argument inside its bounds."""
    value = args.get(name, default)
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise Refusal('bad_argument', f'{name} must be a whole number.')
    if not low <= value <= high:
        raise Refusal('bad_argument', f'{name} must be between {low} and {high}.')
    return value


# ───────────────────────── adb ─────────────────────────

def adb_layout():
    """Our own adb copy: the folder, the program and the folders its libraries are in."""
    root = os.path.join(install_dir(), 'adb')
    binary = os.path.join(root, 'usr', 'lib', 'android-sdk', 'platform-tools', 'adb')
    android = sorted(glob.glob(os.path.join(root, 'usr', 'lib', '*', 'android')))
    libs = android + [os.path.dirname(folder) for folder in android]
    return root, binary, (os.pathsep.join(libs) if android else None)


def find_adb():
    """The adb setup installed (the one it checked) first, then this computer's own."""
    _, binary, libs = adb_layout()
    if os.access(binary, os.X_OK) and libs:
        return {'path': binary, 'env': dict(os.environ, LD_LIBRARY_PATH=libs), 'source': 'phone-control'}
    system = shutil.which('adb')
    if system:
        return {'path': system, 'env': dict(os.environ), 'source': 'this computer'}
    return None


def adb_version(adb):
    """adb's platform-tools version (wireless pairing needs 30 or newer), or why it did not run."""
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
    """adb's own failure, with what to do about it in words."""
    lower = text.lower()
    if 'not found' in lower and 'device' in lower:
        return 'not_connected', 'The phone is not connected to this computer. Open Connect a device and press Connect.'
    if 'unauthorized' in lower:
        return 'unauthorized', 'The phone has not allowed this computer yet. Unlock the phone and press Allow.'
    if 'wrong password' in lower or 'pairing failed' in lower or 'protocol fault' in lower:
        return 'pairing_refused', 'The phone refused the pairing code. Open Pair device with pairing code again and use the new code.'
    if any(word in lower for word in ('unable to start pairing', 'connection refused', 'no route', 'timed out',
                                      'failed to connect', 'cannot connect', 'network is unreachable')):
        return 'no_answer', (f'The phone did not answer at {address or "that address"}. Check the IP address and port '
                             'on the phone; the pairing port changes each time that dialog opens, and the phone and '
                             'this computer must be on the same Wi-Fi.')
    return 'adb_failed', 'adb did not do it.'


def adb_refusal(text, address=''):
    code, words = adb_words(text, address)
    return Refusal(code, words, adb=text.strip()[-400:])


def need_address(value):
    value = str(value or '').strip()
    match = ADDRESS.match(value)
    if not match or not 1 <= int(match.group(1)) <= 65535:
        raise Refusal('bad_address', 'Type the address as the phone shows it, for example 192.168.1.42:37123.')
    return value


def need_serial(args):
    value = str(args.get('serial') or '').strip()
    if not SERIAL.match(value):
        raise Refusal('bad_serial', 'Name the phone by the address adb lists for it.')
    return value


def adb_shell(serial, command, timeout=30):
    """One command in the phone's own shell; a phone that is gone says so in words."""
    code, out, err = adb_call(['-s', serial, 'shell', command], timeout)
    if code and ('device' in err and 'not found' in err or 'offline' in err or 'unauthorized' in err):
        raise adb_refusal(err)
    return code, out, err


def installed(package):
    code, out, _ = run(['dpkg-query', '-W', '-f=${Status}', package], 15)
    return code == 0 and out.endswith('install ok installed')


def missing_dependencies(debs):
    """The libraries the downloaded packages need that this computer does not have (two levels deep)."""
    names, seen = set(), set(ADB_PACKAGES)
    for deb in sorted(glob.glob(os.path.join(debs, '*.deb'))):
        _, depends, _ = run(['dpkg-deb', '-f', deb, 'Depends'], 15)
        for clause in depends.split(','):
            name = clause.strip().split('|')[0].split('(')[0].strip().split(':')[0]
            if name and name not in seen:
                seen.add(name)
                if not installed(name):
                    names.add(name)
    return sorted(names)


def download_and_unpack(packages, debs, stage):
    code, _, err = run(['apt-get', 'download'] + packages, 240, cwd=debs)
    if code:
        raise Refusal('download_failed', 'apt-get could not download adb: ' + (err.strip().splitlines() or ['?'])[-1][:300])
    for deb in sorted(glob.glob(os.path.join(debs, '*.deb'))):
        code, _, err = run(['dpkg-deb', '-x', deb, stage], 60)
        if code:
            raise Refusal('unpack_failed', f'dpkg-deb could not unpack {os.path.basename(deb)}: {err.strip()[:200]}')


def verb_setup_adb(args):
    """adb 30 or newer on this computer, without root: apt-get download and dpkg-deb -x into our own folder,
    with any library it needs that this computer lacks."""
    current = find_adb()
    if current and adb_version(current)['major'] >= 30:
        return {'ok': True, 'adb': adb_summary(current, devices=False)}
    if not shutil.which('apt-get') or not shutil.which('dpkg-deb'):
        raise Refusal('no_apt', 'This computer has no apt-get. Install Android platform-tools (adb 30 or newer), '
                                'then press Set up this computer again.')
    root = adb_layout()[0]
    stage = root + '.new'
    shutil.rmtree(stage, ignore_errors=True)
    debs = os.path.join(stage, 'debs')
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
    version = adb_version(adb) if adb else {'major': 0, 'error': 'adb was not unpacked'}
    if version.get('error'):
        raise Refusal('adb_failed', 'The downloaded adb does not run on this computer: ' + version['error'])
    if version['major'] < 30:
        raise Refusal('adb_too_old', 'The adb this computer can download is older than 30, which cannot pair over Wi-Fi.')
    return {'ok': True, 'installed': True, 'libraries': extra, 'adb': adb_summary(adb, devices=False)}


def list_devices():
    """adb's devices: an emulator port nobody is using (another program on 5554-5585) is left out."""
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
    version = adb_version(adb)
    words = ('Android tools ready' if version['major'] >= 30 else f"adb does not run: {version['error']}" if version.get('error')
             else 'adb is older than 30 and cannot pair over Wi-Fi.')
    summary = {'ready': version['major'] >= 30, 'version': version['text'], 'source': adb['source'], 'message': words}
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


def discover_connect_address():
    """The phone's connect address from adb's own mDNS, when exactly one phone offers it."""
    _, out, _ = adb_call(['mdns', 'services'], 20)
    found = sorted({line.split()[-1] for line in out.splitlines() if '_adb-tls-connect._tcp' in line and line.split()})
    if len(found) == 1:
        return found[0]
    if not found:
        raise Refusal('not_found', "No phone on this network is offering Wireless debugging. Type the IP address and "
                                   "port from the phone's Wireless debugging screen into Connect address.")
    raise Refusal('choose', 'More than one phone offers Wireless debugging; type the address of yours.', candidates=found)


def verb_adb_connect(args):
    address = need_address(args.get('address') or discover_connect_address())
    _, out, err = adb_call(['connect', address], 25)
    text = (out + '\n' + err).strip()
    if re.search(r'^(already )?connected to ', text, re.M):
        return {'ok': True, 'serial': address, 'adb': text.splitlines()[0][:200]}
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
    code, out, err = adb_shell(serial, 'getprop ro.product.manufacturer; getprop ro.product.model; '
                                       'getprop ro.build.version.release; wm size')
    if code:
        raise adb_refusal(err or out)
    lines = out.splitlines()
    size = re.findall(r'(\d+)x(\d+)', out)
    width, height = (int(size[-1][0]), int(size[-1][1])) if size else (0, 0)
    return {'ok': True, 'serial': serial, 'manufacturer': (lines[0:1] or [''])[0].strip(),
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
    points = [number(args, name, 0, 20000) for name in ('x1', 'y1', 'x2', 'y2')]
    duration = number(args, 'ms', 50, 3000, 300)
    code, out, err = adb_shell(serial, 'input swipe {} {} {} {} {}'.format(*points, duration))
    if code:
        raise adb_refusal(err or out)
    return {'ok': True, 'swiped': points}


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
    """What adb's input text can type: plain keyboard characters; a new line is the Enter key."""
    if not isinstance(text, str) or not text:
        raise Refusal('no_text', 'Type something to send.')
    if len(text) > 500:
        raise Refusal('too_long', 'Send at most 500 characters at a time.')
    bad = sorted({char for char in text if char != '\n' and not ' ' <= char <= '~'})
    if bad:
        raise Refusal('cannot_type', 'Android typing over adb takes only plain keyboard characters; it cannot type '
                      + ' '.join(bad[:10]) + '. Nothing was sent.')
    if '%s' in text:
        raise Refusal('cannot_type', 'The two characters %s cannot be typed over adb: Android reads them as a space. Nothing was sent.')
    return text.split('\n')


def device_quote(value):
    """Quote for the phone's own shell."""
    return "'" + value.replace("'", "'\\''") + "'"


def verb_adb_text(args):
    serial = need_serial(args)
    segments = android_text_segments(args.get('text'))
    for index, segment in enumerate(segments):
        if index:
            adb_shell(serial, 'input keyevent 66')
        if segment:
            code, out, err = adb_shell(serial, 'input text ' + device_quote(segment.replace(' ', '%s')))
            if code:
                raise adb_refusal(err or out)
    return {'ok': True, 'typed': len(args.get('text'))}


def verb_adb_apps(args):
    serial = need_serial(args)
    _, out, err = adb_shell(serial, 'cmd package query-activities --brief -a android.intent.action.MAIN '
                                    '-c android.intent.category.LAUNCHER')
    packages = {match.group(1) for match in re.finditer(r'^\s*([A-Za-z][\w.]*)/', out, re.M)}
    if not packages:
        _, out, err = adb_shell(serial, 'pm list packages')
        packages = {line[8:].strip() for line in out.splitlines() if line.startswith('package:')}
    packages = sorted(name for name in packages if PACKAGE.match(name))
    if not packages:
        raise adb_refusal(err or 'no apps were listed')
    while len(json.dumps(packages)) > MAX_OUT - 400:
        packages.pop()
    return {'ok': True, 'apps': packages}


def verb_adb_launch(args):
    serial = need_serial(args)
    name = str(args.get('package', ''))
    if not PACKAGE.match(name):
        raise Refusal('bad_package', 'Name the app by its package, for example com.android.settings.')
    _, out, err = adb_shell(serial, f'monkey -p {name} -c android.intent.category.LAUNCHER 1', 30)
    if 'Events injected: 1' in out:
        return {'ok': True, 'opened': name}
    raise Refusal('not_opened', f'{name} has no screen to open on this phone.', adb=(out + err).strip()[-300:])


def ui_items(xml):
    """The words on the screen and the centre of each, from uiautomator's dump."""
    root = ElementTree.fromstring(xml)
    items, package = [], ''
    for node in root.iter('node'):
        package = package or node.get('package', '')
        label = (node.get('text') or '').strip() or (node.get('content-desc') or '').strip()
        bounds = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not label or not bounds:
            continue
        x1, y1, x2, y2 = (int(value) for value in bounds.groups())
        items.append({'text': label[:80], 'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2,
                      'tap': node.get('clickable') == 'true'})
    return package, items


def verb_adb_ui(args):
    serial = need_serial(args)
    _, out, err = adb_call(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 30)
    if '</hierarchy>' not in out:
        adb_shell(serial, 'uiautomator dump /sdcard/oshal_ui.xml', 30)
        _, out, err = adb_call(['-s', serial, 'exec-out', 'cat', '/sdcard/oshal_ui.xml'], 20)
    start, end = out.find('<?xml'), out.rfind('</hierarchy>')
    if start < 0 or end < 0:
        raise adb_refusal(err or out or 'uiautomator gave no screen')
    package, items = ui_items(out[start:end + len('</hierarchy>')])
    truncated = False
    while len(json.dumps(items)) > MAX_OUT - 500:
        items.pop()
        truncated = True
    return {'ok': True, 'package': package, 'items': items, 'truncated': truncated}


# ───────────────────────── pictures of the phone's screen ─────────────────────────

def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or len(data) < 24:
        return 0, 0
    return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')


def frames_dir():
    path = os.path.join(runtime_dir(), 'frames')
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def keep_frame(data, extension):
    """Keep the picture for its chunks; only the newest four stay."""
    digest = hashlib.sha256(data).hexdigest()
    folder = frames_dir()
    with open(os.path.join(folder, f'{digest[:16]}.{extension}'), 'wb') as handle:
        handle.write(data)
    kept = sorted(glob.glob(os.path.join(folder, '*.*')), key=os.path.getmtime, reverse=True)
    for old in kept[4:]:
        os.remove(old)
    return digest


def scaled_jpeg(png, width):
    """A narrower JPEG through ffmpeg, when this computer has it; otherwise None."""
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return None
    code, jpeg, _ = run([ffmpeg, '-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', f'scale={width}:-2',
                         '-q:v', '7', '-f', 'mjpeg', 'pipe:1'], 30, data=png, binary=True)
    return jpeg if code == 0 and jpeg[:2] == b'\xff\xd8' else None


def verb_adb_frame(args):
    serial = need_serial(args)
    width = number(args, 'width', 160, 1080, 432)
    code, png, err = adb_call(['-s', serial, 'exec-out', 'screencap', '-p'], 30, binary=True)
    device_width, device_height = png_size(png)
    if code or not device_width:
        raise adb_refusal(err or 'the phone sent no picture')
    jpeg = scaled_jpeg(png, width)
    data, mime = (jpeg, 'image/jpeg') if jpeg else (png, 'image/png')
    digest = keep_frame(data, 'jpg' if jpeg else 'png')
    text = base64.b64encode(data).decode('ascii')
    return {'ok': True, 'id': digest[:16], 'sha256': digest, 'mime': mime, 'bytes': len(data),
            'chunks': max(1, math.ceil(len(text) / CHUNK)), 'index': 0, 'data': text[:CHUNK],
            'deviceWidth': device_width, 'deviceHeight': device_height, 'slow': not jpeg}


def verb_frame_chunk(args):
    frame = str(args.get('id', ''))
    if not FRAME_ID.match(frame):
        raise Refusal('bad_frame', 'Name the picture by the id adb-frame gave.')
    index = number(args, 'index', 0, 10000)
    found = glob.glob(os.path.join(frames_dir(), frame + '.*'))
    if not found:
        raise Refusal('frame_gone', 'That picture is no longer kept; ask for a new one.')
    with open(found[0], 'rb') as handle:
        text = base64.b64encode(handle.read()).decode('ascii')
    if index * CHUNK >= len(text):
        raise Refusal('bad_frame', f'That picture has only {math.ceil(len(text) / CHUNK)} parts.')
    return {'ok': True, 'id': frame, 'index': index, 'data': text[index * CHUNK:(index + 1) * CHUNK]}


# ───────────────────────── the resident Bluetooth keyboard ─────────────────────────

def ble_paths():
    folder = runtime_dir()
    return {'socket': os.path.join(folder, 'ble.sock'), 'pid': os.path.join(folder, 'ble.pid'),
            'log': os.path.join(folder, 'ble.log')}


def process_argv(pid):
    try:
        with open(f'/proc/{pid}/cmdline', 'rb') as handle:
            return [part.decode('utf-8', 'replace') for part in handle.read().split(b'\0') if part]
    except OSError:
        return []


def ble_pid():
    """The resident keyboard's process, when it is ours and alive."""
    try:
        with open(ble_paths()['pid']) as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        return None
    return pid if any(part.endswith('oshal_phone_ble.py') for part in process_argv(pid)) else None


def ble_request(op, payload=None, timeout=60):
    """One request to the resident keyboard over its private socket."""
    path = ble_paths()['socket']
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(timeout)
    try:
        connection.connect(path)
        connection.sendall(json.dumps(dict(payload or {}, op=op)).encode('utf-8') + b'\n')
        reply = b''
        while not reply.endswith(b'\n'):
            part = connection.recv(65536)
            if not part:
                break
            reply += part
    except (FileNotFoundError, ConnectionRefusedError):
        raise Refusal('ble_not_running', 'The Bluetooth keyboard is not running on this computer. '
                                         'Press Set up this computer in phone-control.')
    except socket.timeout:
        raise Refusal('timed_out', 'The Bluetooth keyboard did not answer in time.')
    except OSError as error:
        raise Refusal('ble_not_running', f'The Bluetooth keyboard could not be reached: {error}.')
    finally:
        connection.close()
    try:
        return json.loads(reply.decode('utf-8'))
    except ValueError:
        raise Refusal('ble_failed', 'The Bluetooth keyboard gave no answer.')


def bluetooth_prerequisites():
    """What this computer has for the iPhone keyboard: BlueZ over the system bus, its Python bindings, an adapter."""
    found = {'ready': False, 'bluez': None, 'adapter': None}
    if shutil.which('bluetoothctl'):
        _, out, _ = run(['bluetoothctl', '--version'], 10)
        found['bluez'] = out.strip().split()[-1] if out.strip() else None
    try:
        import dbus  # noqa: F401  (the system's python3-dbus)
        from gi.repository import GLib  # noqa: F401
    except ImportError:
        return dict(found, message='Bluetooth needs python3-dbus and python3-gi on this computer.')
    try:
        bus = dbus.SystemBus()
        objects = dbus.Interface(bus.get_object('org.bluez', '/'), 'org.freedesktop.DBus.ObjectManager').GetManagedObjects()
    except dbus.exceptions.DBusException as error:
        return dict(found, message='No Bluetooth adapter on this computer.', detail=error.get_dbus_name())
    adapters = sorted((str(path), props['org.bluez.Adapter1']) for path, props in objects.items()
                      if 'org.bluez.Adapter1' in props)
    if not adapters:
        return dict(found, message='No Bluetooth adapter on this computer.')
    path, props = adapters[0]
    found['adapter'] = {'path': path, 'address': str(props.get('Address', '')), 'name': str(props.get('Alias', '')),
                        'powered': bool(props.get('Powered')), 'pairable': bool(props.get('Pairable'))}
    return dict(found, ready=True, message='Bluetooth ready')


def find_earlier_keyboard():
    """The earlier hand-started test keyboard, if it runs: a listener on 127.0.0.1:47835 whose program is
    oshal_ble_hid.py, owned by this account."""
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
    """A process that outlives this command: its own session, no inherited output."""
    with open(log_path, 'ab') as log:
        return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True, close_fds=True, cwd=cwd).pid


def self_check(seconds=20):
    """The resident keyboard registered with BlueZ and advertises within the time, or why not."""
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


def restore_earlier(earlier):
    """Start the earlier test keyboard again exactly as it was started."""
    pid = start_detached(earlier['argv'], os.path.join(runtime_dir(), 'earlier-keyboard.log'), earlier['cwd'])
    time.sleep(3)
    return {'pid': pid, 'listening': find_earlier_keyboard() is not None}


def verb_ensure(args):
    """The resident keyboard running; it replaces the earlier test keyboard only when the person said so."""
    prerequisites = bluetooth_prerequisites()
    if not prerequisites['ready']:
        raise Refusal('no_bluetooth', prerequisites['message'], bluetooth=prerequisites)
    if ble_pid():
        ok, status = self_check(5)
        if ok:
            return {'ok': True, 'started': False, 'ble': status}
        stop_process(ble_pid())
    earlier = find_earlier_keyboard()
    if earlier and str(args.get('replaceEarlier', '')).lower() not in ('true', '1'):
        raise Refusal('earlier_keyboard_running', f'An earlier test keyboard (process {earlier["pid"]}) is using '
                      'Bluetooth on this computer. Press Replace the earlier test keyboard to let phone-control take over.',
                      earlier={'pid': earlier['pid'], 'program': os.path.basename(earlier['argv'][-1])})
    if earlier:
        with open(os.path.join(install_dir(), 'earlier-keyboard.json'), 'w') as handle:
            json.dump(dict(earlier, stoppedAt=time.time()), handle)
        stop_process(earlier['pid'])
    paths = ble_paths()
    start_detached([sys.executable, '-I', os.path.join(HERE, 'oshal_phone_ble.py'), 'serve', runtime_dir()],
                   paths['log'], runtime_dir())
    ok, status = self_check(20)
    if ok:
        return {'ok': True, 'started': True, 'replacedEarlier': bool(earlier), 'ble': status}
    pid = ble_pid()
    if pid:
        stop_process(pid)
    restored = restore_earlier(earlier) if earlier else None
    raise Refusal('self_check_failed', f'The Bluetooth keyboard did not come up within 20 s: {status}.',
                  restoredEarlier=restored, log=log_tail(paths['log']))


def log_tail(path, size=600):
    try:
        with open(path, 'rb') as handle:
            handle.seek(max(0, os.path.getsize(path) - size))
            return handle.read().decode('utf-8', 'replace')
    except OSError:
        return ''


def verb_stop(args):
    pid = ble_pid()
    return {'ok': True, 'stopped': bool(pid and stop_process(pid))}


def ble_passthrough(op, fields):
    def verb(args):
        reply = ble_request(op, {name: args[name] for name in fields if name in args})
        if not reply.get('ok'):
            raise Refusal(reply.get('error', 'ble_failed'), reply.get('message', 'The Bluetooth keyboard did not do it.'),
                          **{key: value for key, value in reply.items() if key not in ('ok', 'error', 'message')})
        return reply
    return verb


# ───────────────────────── this bridge itself ─────────────────────────

def file_hashes():
    hashes = {name: sha256_file(os.path.join(HERE, name)) for name in FILES}
    hashes[WRAPPER] = sha256_file(os.path.join(home(), '.local', 'bin', WRAPPER))
    return hashes


def verb_version(args):
    return {'ok': True, 'version': VERSION, 'files': file_hashes(), 'python': sys.version.split()[0]}


def verb_status(args):
    """Everything phone-control shows about this computer, read now."""
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
            'readAt': int(time.time() * 1000)}


def verb_uninstall(args):
    """Take this bridge off the computer: the keyboard, our adb and our files. The phone's own pairing stays."""
    removed = []
    pid = ble_pid()
    if pid and stop_process(pid):
        removed.append('keyboard')
    root, binary, _ = adb_layout()
    for proc in (name for name in os.listdir('/proc') if name.isdigit()):
        try:
            if os.readlink(f'/proc/{proc}/exe') == binary:
                stop_process(int(proc))
                removed.append('adb server')
        except OSError:
            continue
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
    'ensure': verb_ensure, 'stop': verb_stop,
    'ble-status': ble_passthrough('status', ()),
    'ble-pair-window': ble_passthrough('pair-window', ('seconds',)),
    'ble-devices': ble_passthrough('devices', ()),
    'ble-type': ble_passthrough('type', ('text', 'enter')),
    'ble-key': ble_passthrough('key', ('key',)),
    'ble-mouse': ble_passthrough('mouse', ('dx', 'dy', 'click')),
    'ble-open': ble_passthrough('open', ('name',)),
    'adb-pair': verb_adb_pair, 'adb-connect': verb_adb_connect, 'adb-disconnect': verb_adb_disconnect,
    'adb-devices': verb_adb_devices, 'adb-info': verb_adb_info, 'adb-tap': verb_adb_tap, 'adb-swipe': verb_adb_swipe,
    'adb-text': verb_adb_text, 'adb-key': verb_adb_key, 'adb-apps': verb_adb_apps, 'adb-launch': verb_adb_launch,
    'adb-ui': verb_adb_ui, 'adb-frame': verb_adb_frame, 'frame-chunk': verb_frame_chunk,
}
HELP = {
    'status': 'everything about this computer: Bluetooth, the keyboard, adb and its phones',
    'ensure': 'start the iPhone keyboard [replaceEarlier=true]', 'stop': 'stop the iPhone keyboard',
    'ble-pair-window': 'let a new iPhone pair for seconds=120', 'ble-devices': 'the iPhones paired with this computer',
    'ble-type': 'type on the iPhone: text="..." [enter=true]', 'ble-key': 'key=Home|Spotlight|VolumeUp|VolumeDown|Enter|Escape|Backspace|Tab|Up|Down|Left|Right',
    'ble-mouse': 'move the iPhone pointer: dx= dy= [click=true] (AssistiveTouch on)', 'ble-open': 'open an iPhone app by name: name="Notes"',
    'setup-adb': 'get adb 30 or newer', 'adb-pair': 'address=IP:port code=123456', 'adb-connect': '[address=IP:port]',
    'adb-devices': 'the Android phones adb sees', 'adb-info': 'serial=...', 'adb-tap': 'serial= x= y=',
    'adb-swipe': 'serial= x1= y1= x2= y2= [ms=300]', 'adb-text': 'serial= text="..."',
    'adb-key': 'serial= key=' + '|'.join(sorted(ANDROID_KEYS)), 'adb-apps': 'serial=', 'adb-launch': 'serial= package=',
    'adb-ui': 'serial= (the words on the screen and where they are)', 'adb-frame': 'serial= [width=432]',
    'frame-chunk': 'id= index=', 'adb-disconnect': 'serial=', 'version': 'this bridge and its files',
    'uninstall': 'take the bridge off this computer',
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
    except Exception as error:  # still one JSON line; the trace goes to stderr for whoever reads it
        import traceback
        traceback.print_exc()
        emit({'ok': False, 'error': 'bridge_failed', 'message': f'The bridge failed: {type(error).__name__}: {error}'})
        return 4


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
