#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: iPhone AirPlay mirroring via headless UxPlay into SOI/EOI-verified JPEGs with sha256 chunked delivery.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: Android screen/UI/app helpers, adb file/clipboard verbs, mirror-ui screen text coordinates, Fire TV LAN scan & verified APK staging/install, and line-buffered BT.709 8fps UxPlay AirPlay pipeline.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: detect uniform-black protected DRM surfaces and asleep screens in adb-frame, report activePackage and activeActivity, and recover seamlessly from rotated Android Wireless Debugging TLS ports.
"""Frame, AirPlay, screen UI, file transfer, clipboard, and TV APK helpers for oshal_phone_bridge.py."""

from concurrent.futures import ThreadPoolExecutor
import base64, glob, hashlib, json, math, os, re, shutil, socket, struct, subprocess, time, zlib
from xml.etree import ElementTree

MIRROR_PACKAGES = ['uxplay', 'libavahi-compat-libdnssd1', 'gstreamer1.0-plugins-base',
                   'gstreamer1.0-plugins-good', 'gstreamer1.0-plugins-bad', 'gstreamer1.0-libav']
SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
PACKAGE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$')
FRAME_ID = re.compile(r'^[0-9a-f]{16}$')
STAGE_ID = re.compile(r'^[A-Za-z0-9_-]{4,64}$')
HEX_SHA256 = re.compile(r'^[0-9a-f]{64}$')
SAFE_FILE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$')
MAX_TRANSFER_BYTES = 4 * 1024 * 1024
MAX_APK_BYTES = 80 * 1024 * 1024
TRANSFER_CHUNK = 12288


def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or len(data) < 24:
        return 0, 0
    return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')


def frames_dir(ctx):
    path = os.path.join(ctx.runtime_dir(), 'frames')
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def keep_frame(ctx, data, ext):
    digest = hashlib.sha256(data).hexdigest()
    folder = frames_dir(ctx)
    with open(os.path.join(folder, f'{digest[:16]}.{ext}'), 'wb') as handle:
        handle.write(data)
    for old in sorted(glob.glob(os.path.join(folder, '*.*')), key=os.path.getmtime, reverse=True)[4:]:
        try:
            os.remove(old)
        except OSError:
            pass
    return digest


def scaled_jpeg(ctx, png, width):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return None
    code, jpeg, _ = ctx.run([ffmpeg, '-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', f'scale={width}:-2',
                             '-q:v', '7', '-f', 'mjpeg', 'pipe:1'], 30, data=png, binary=True)
    return jpeg if code == 0 and jpeg[:2] == b'\xff\xd8' else None


def png_is_uniform_black(png, dev_w, dev_h):
    if len(png) > 65536 or len(png) < 33 or png[24] != 8 or png[25] not in (0, 2, 6):
        return False
    ch = {0: 1, 2: 3, 6: 4}[png[25]]
    idat, idx = [], 8
    while idx + 8 <= len(png):
        ln = int.from_bytes(png[idx:idx + 4], 'big')
        tag = png[idx + 4:idx + 8]
        if idx + 12 + ln > len(png):
            break
        if tag == b'IDAT':
            idat.append(png[idx + 8:idx + 8 + ln])
        elif tag == b'IEND':
            break
        idx += 12 + ln
    try:
        raw = zlib.decompress(b''.join(idat))
    except zlib.error:
        return False
    stride, vis = 1 + dev_w * ch, min(ch, 3)
    if len(raw) < stride * dev_h:
        return False
    step_y, step_x = max(1, dev_h // 16), max(1, dev_w // 16)
    for y in range(0, dev_h, step_y):
        row = raw[y * stride:(y + 1) * stride]
        if row[0] not in (0, 1, 2):
            return False
        for x in range(0, dev_w, step_x):
            if max(row[1 + x * ch:1 + x * ch + vis]) >= 8:
                return False
    return True


def is_uniform_black_frame(ctx, png, jpeg, dev_w, dev_h):
    if dev_w < 64 or dev_h < 64 or (jpeg and len(jpeg) > 8000):
        return False
    ffmpeg = shutil.which('ffmpeg')
    if ffmpeg:
        try:
            code, rgb, _ = ctx.run([ffmpeg, '-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0',
                                    '-vf', 'scale=16:16', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
                                   5, data=png, binary=True)
            if code == 0 and len(rgb) == 768:
                return max(rgb) < 8
        except ctx.Refusal:
            pass
    return png_is_uniform_black(png, dev_w, dev_h)


def inspect_black_surface(ctx, serial):
    try:
        _, out, _ = ctx.adb_shell(
            serial,
            "dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp'; dumpsys power | grep -E 'mWakefulness=|Display Power'",
            4,
        )
    except Exception:
        return {'protectedSurface': False, 'screenAsleep': False, 'activePackage': '', 'activeActivity': ''}
    asleep = bool(re.search(r'mWakefulness=(?:Asleep|Dozing)|state=OFF', out, re.I))
    focus = (re.search(r'mCurrentFocus=[^\n]*?([A-Za-z][\w.]+)/([A-Za-z0-9_.$]+)', out)
             or re.search(r'mFocusedApp=[^\n]*?([A-Za-z][\w.]+)/([A-Za-z0-9_.$]+)', out))
    pkg, act = (focus.group(1), focus.group(2)) if focus else ('', '')
    return {'protectedSurface': not asleep, 'screenAsleep': asleep, 'activePackage': pkg, 'activeActivity': act}


def adb_exec_with_reconnect(ctx, serial, subargs, timeout=30, binary=False):
    code, out, err = ctx.adb_call(['-s', serial] + subargs, timeout, binary=binary)
    err_text = err.decode('utf-8', 'replace') if isinstance(err, bytes) else str(err or '')
    if code and hasattr(ctx, 'reconnect_rotated_serial') and any(w in err_text.lower() for w in ('not found', 'offline', 'closed', 'cannot connect')):
        fresh = ctx.reconnect_rotated_serial(serial)
        if fresh:
            serial = fresh
            code, out, err = ctx.adb_call(['-s', serial] + subargs, timeout, binary=binary)
    return serial, code, out, err


def verb_adb_frame(ctx, args):
    serial = ctx.need_serial(args)
    width = ctx.number(args, 'width', 160, 1080, 432)
    serial, code, png, err = adb_exec_with_reconnect(ctx, serial, ['exec-out', 'screencap', '-p'], 30, binary=True)
    dev_w, dev_h = png_size(png)
    if code or not dev_w:
        raise ctx.adb_refusal(err or 'the phone sent no picture')
    jpeg = scaled_jpeg(ctx, png, width)
    surface = (inspect_black_surface(ctx, serial) if is_uniform_black_frame(ctx, png, jpeg, dev_w, dev_h)
               else {'protectedSurface': False, 'screenAsleep': False, 'activePackage': '', 'activeActivity': ''})
    data, mime = (jpeg, 'image/jpeg') if jpeg else (png, 'image/png')
    digest = keep_frame(ctx, data, 'jpg' if jpeg else 'png')
    text = base64.b64encode(data).decode('ascii')
    return {'ok': True, 'serial': serial, 'id': digest[:16], 'sha256': digest, 'mime': mime, 'bytes': len(data),
            'chunks': max(1, math.ceil(len(text) / ctx.CHUNK)), 'index': 0, 'data': text[:ctx.CHUNK],
            'deviceWidth': dev_w, 'deviceHeight': dev_h, 'slow': not jpeg, **surface}


def verb_frame_chunk(ctx, args):
    frame = str(args.get('id', ''))
    if not FRAME_ID.match(frame):
        raise ctx.Refusal('bad_frame', 'Name the picture by the id adb-frame gave.')
    index = ctx.number(args, 'index', 0, 10000)
    found = glob.glob(os.path.join(frames_dir(ctx), frame + '.*'))
    if not found:
        raise ctx.Refusal('frame_gone', 'That picture is no longer kept; ask for a new one.')
    with open(found[0], 'rb') as handle:
        text = base64.b64encode(handle.read()).decode('ascii')
    if index * ctx.CHUNK >= len(text):
        raise ctx.Refusal('bad_frame', f'That picture has only {math.ceil(len(text) / ctx.CHUNK)} parts.')
    return {'ok': True, 'id': frame, 'index': index, 'data': text[index * ctx.CHUNK:(index + 1) * ctx.CHUNK]}


def verb_adb_apps(ctx, args):
    serial = ctx.need_serial(args)
    packages, err = set(), ''
    for cat in ('LAUNCHER', 'LEANBACK_LAUNCHER'):
        _, out, err = ctx.adb_shell(serial, f'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.{cat}')
        packages |= {m.group(1) for m in re.finditer(r'^\s*([A-Za-z][\w.]*)/', out, re.M)}
    if not packages:
        _, out, err = ctx.adb_shell(serial, 'pm list packages')
        packages = {line[8:].strip() for line in out.splitlines() if line.startswith('package:')}
    packages = sorted(name for name in packages if PACKAGE.match(name))
    if not packages:
        raise ctx.adb_refusal(err or 'no apps were listed')
    while len(json.dumps(packages)) > ctx.MAX_OUT - 400:
        packages.pop()
    return {'ok': True, 'apps': packages}


def verb_adb_launch(ctx, args):
    serial = ctx.need_serial(args)
    name = str(args.get('package', ''))
    if not PACKAGE.match(name):
        raise ctx.Refusal('bad_package', 'Name the app by its package, for example com.android.settings.')
    out = err = ''
    for cat in ('LAUNCHER', 'LEANBACK_LAUNCHER'):
        _, out, err = ctx.adb_shell(serial, f'monkey -p {name} -c android.intent.category.{cat} 1', 30)
        if 'Events injected: 1' in out:
            return {'ok': True, 'opened': name}
    raise ctx.Refusal('not_opened', f'{name} has no screen to open on this device.', adb=(out + err).strip()[-300:])


def ui_items(xml):
    root = ElementTree.fromstring(xml)
    raw_nodes, package, max_w, max_h = [], '', 1080, 2400
    for node in root.iter('node'):
        package = package or node.get('package', '')
        bounds = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not bounds:
            continue
        x1, y1, x2, y2 = (int(v) for v in bounds.groups())
        max_w, max_h = max(max_w, x2), max(max_h, y2)
        label = (node.get('text') or '').strip() or (node.get('content-desc') or '').strip()
        if label:
            raw_nodes.append((label[:80], x1, y1, x2, y2, node.get('clickable') == 'true'))
    items = []
    for label, x1, y1, x2, y2, clickable in raw_nodes:
        cx, cy, bh = (x1 + x2) // 2, (y1 + y2) // 2, max(1, y2 - y1)
        items.append({
            'text': label, 'x': cx, 'y': cy, 'tap': clickable,
            'nx': round(cx / max_w, 3), 'ny': round(cy / max_h, 3),
            'iconNy': round(max(0.03, (y1 - bh * 1.2) / max_h), 3),
        })
    return package, max_w, max_h, items


def verb_adb_ui(ctx, args):
    serial = ctx.need_serial(args)
    serial, _, out, err = adb_exec_with_reconnect(ctx, serial, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], 30)
    if '</hierarchy>' not in out:
        ctx.adb_shell(serial, 'uiautomator dump /sdcard/oshal_ui.xml', 30)
        _, out, err = ctx.adb_call(['-s', serial, 'exec-out', 'cat', '/sdcard/oshal_ui.xml'], 20)
    start, end = out.find('<?xml'), out.rfind('</hierarchy>')
    if start < 0 or end < 0:
        raise ctx.adb_refusal(err or out or 'uiautomator gave no screen')
    xml = out[start:end + len('</hierarchy>')]
    package, dev_w, dev_h, items = ui_items(xml)
    truncated = False
    while len(json.dumps(items)) > ctx.MAX_OUT - 600:
        items.pop()
        truncated = True
    return {'ok': True, 'package': package, 'deviceWidth': dev_w, 'deviceHeight': dev_h,
            'frameSha256': hashlib.sha256(xml.encode('utf-8')).hexdigest(), 'items': items, 'truncated': truncated}


def need_file_name(ctx, args):
    name = str(args.get('name') or '').strip()
    if not SAFE_FILE.match(name) or '..' in name:
        raise ctx.Refusal('bad_filename', 'Choose a plain file name (letters, digits, spaces, dots, dashes or underscores).')
    return name


def transfer_dir(ctx, kind):
    path = os.path.join(ctx.runtime_dir(), kind)
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def verb_adb_files(ctx, args):
    serial = ctx.need_serial(args)
    code, out, err = ctx.adb_shell(serial, "stat -c '%F\t%s\t%Y\t%n' /sdcard/Download/* 2>&1")
    combined = out + '\n' + err
    if code and 'Permission denied' in combined:
        raise ctx.Refusal('storage_unavailable', 'Could not read /sdcard/Download on that device.')
    files = []
    for line in out.splitlines():
        parts = line.split('\t', 3)
        if len(parts) < 4 or not parts[0].startswith('regular'):
            continue
        name = os.path.basename(parts[3].strip())
        if not SAFE_FILE.match(name) or '..' in name:
            continue
        size = int(parts[1]) if parts[1].strip().isdigit() else 0
        files.append({'name': name, 'sizeBytes': size})
        if len(files) >= 50:
            break
    return {'ok': True, 'folder': '/sdcard/Download', 'files': files}


def verb_adb_push(ctx, args):
    serial = ctx.need_serial(args)
    name = need_file_name(ctx, args)
    raw_b64 = args.get('data', '')
    if not isinstance(raw_b64, str) or len(raw_b64) > 20000:
        raise ctx.Refusal('bad_argument', 'Each file chunk must be base64 up to 12 KiB.')
    try:
        chunk = base64.b64decode(raw_b64, validate=True)
    except ValueError:
        raise ctx.Refusal('bad_argument', 'File chunk is not valid base64.')
    stage = os.path.join(transfer_dir(ctx, 'push'), name)
    append = str(args.get('append', '')).lower() in ('true', '1') or int(args.get('index', 0) or 0) > 0
    current = os.path.getsize(stage) if (append and os.path.isfile(stage)) else 0
    if current + len(chunk) > MAX_TRANSFER_BYTES:
        if os.path.isfile(stage):
            os.remove(stage)
        raise ctx.Refusal('too_large', 'Files sent through phone-control may be at most 4 MiB.')
    with open(stage, 'ab' if append else 'wb') as handle:
        handle.write(chunk)
    done_raw = args['final'] if 'final' in args else args.get('done', 'true')
    if str(done_raw).lower() in ('false', '0'):
        return {'ok': True, 'name': name, 'stagedBytes': current + len(chunk), 'done': False}
    remote = f'/sdcard/Download/{name}'
    try:
        size = os.path.getsize(stage)
        code, out, err = ctx.adb_call(['-s', serial, 'push', stage, remote], 45)
    finally:
        try:
            os.remove(stage)
        except OSError:
            pass
    if code:
        raise ctx.adb_refusal(err or out)
    return {'ok': True, 'name': name, 'remotePath': remote, 'sizeBytes': size, 'done': True}


def verb_adb_pull(ctx, args):
    serial = ctx.need_serial(args)
    name = need_file_name(ctx, args)
    offset = ctx.number(args, 'offset', 0, MAX_TRANSFER_BYTES, 0)
    local = os.path.join(transfer_dir(ctx, 'pull'), name)
    remote = f'/sdcard/Download/{name}'
    if offset == 0 or not os.path.isfile(local):
        code, _, _ = ctx.adb_call(['-s', serial, 'pull', remote, local], 45)
        if code or not os.path.isfile(local):
            raise ctx.Refusal('file_not_found', f'{name} could not be read from /sdcard/Download on that device.')
    total = os.path.getsize(local)
    if total > MAX_TRANSFER_BYTES:
        os.remove(local)
        raise ctx.Refusal('too_large', f'{name} is larger than 4 MiB; copy large files directly over USB.')
    with open(local, 'rb') as handle:
        digest = hashlib.sha256(handle.read()).hexdigest() if offset == 0 else ''
        handle.seek(offset)
        piece = handle.read(TRANSFER_CHUNK)
    eof = offset + len(piece) >= total
    if eof:
        try:
            os.remove(local)
        except OSError:
            pass
    return {'ok': True, 'name': name, 'totalBytes': total, 'offset': offset, 'eof': eof,
            'sha256': digest, 'data': base64.b64encode(piece).decode('ascii')}


def verb_adb_clipboard_get(ctx, args):
    serial = ctx.need_serial(args)
    code, out, err = ctx.adb_shell(serial, 'cmd clipboard get-text 2>&1')
    low = (out + '\n' + err).strip().lower()
    if code == 0 and low and not any(t in low for t in ('unknown command', 'exception', 'denying', 'permission denial', 'error:')):
        return {'ok': True, 'text': out.rstrip('\r\n')[:4000]}
    if any(t in low for t in ('denying', 'securityexception', 'permission denial')):
        raise ctx.Refusal('clipboard_denied', 'Android blocks adb from reading the clipboard while another app is in front on Android 10 and newer.')
    raise ctx.Refusal('clipboard_unavailable', 'This Android build does not expose primary clipboard text to adb shell.')


def verb_adb_clipboard_set(ctx, args):
    serial = ctx.need_serial(args)
    text = args.get('text')
    if not isinstance(text, str) or not 1 <= len(text) <= 4000:
        raise ctx.Refusal('bad_argument', 'Clipboard text must be between 1 and 4,000 characters.')
    code, out, err = ctx.adb_shell(serial, 'cmd clipboard set-text ' + ctx.device_quote(text) + ' 2>&1')
    low = (out + '\n' + err).strip().lower()
    if code == 0 and not any(t in low for t in ('unknown command', 'exception', 'denying', 'permission denial', 'error:')):
        return {'ok': True, 'length': len(text)}
    raise ctx.Refusal('clipboard_unavailable', 'This Android build does not allow setting the clipboard from adb shell; use Type in Session instead.')


def receiver_name():
    host = (socket.gethostname() or 'computer').split('.')[0].strip()[:32] or 'computer'
    return f'OSHAL Mirror ({host})'


def prepend_env(env, key, folders):
    existing = env.get(key, '')
    joined = os.pathsep.join(folders)
    if joined:
        env[key] = f'{joined}{os.pathsep}{existing}' if existing else joined


def uxplay_layout(ctx):
    root = os.path.join(ctx.install_dir(), 'uxplay')
    binary = os.path.join(root, 'usr', 'bin', 'uxplay')
    lib_cands = glob.glob(os.path.join(root, 'usr', 'lib', '*')) + glob.glob(os.path.join(root, 'lib', '*')) + [os.path.join(root, 'usr', 'lib'), os.path.join(root, 'lib')]
    gst_cands = glob.glob(os.path.join(root, 'usr', 'lib', '*', 'gstreamer-1.0')) + [os.path.join(root, 'usr', 'lib', 'gstreamer-1.0')]
    env = dict(os.environ)
    prepend_env(env, 'LD_LIBRARY_PATH', [p for p in sorted(set(lib_cands)) if os.path.isdir(p)])
    prepend_env(env, 'GST_PLUGIN_PATH_1_0', [p for p in sorted(set(gst_cands)) if os.path.isdir(p)])
    return root, binary, env


def find_uxplay(ctx):
    override = os.environ.get('OSHAL_UXPLAY_BIN', '').strip()
    if override and os.access(override, os.X_OK):
        return {'path': override, 'env': dict(os.environ), 'source': 'override'}
    _, binary, env = uxplay_layout(ctx)
    if os.access(binary, os.X_OK):
        return {'path': binary, 'env': env, 'source': 'phone-control'}
    system = shutil.which('uxplay')
    return {'path': system, 'env': dict(os.environ), 'source': 'this computer'} if system else None


def uxplay_version(ctx, ux):
    code, out, err = ctx.run([ux['path'], '-v'], 10, ux['env'])
    match = re.search(r'UxPlay\s+(?:version\s+)?(\d+(?:\.\d+)*)', f'{out}\n{err}', re.I)
    if code == 0 and match:
        return {'ok': True, 'text': match.group(1)}
    return {'ok': False, 'text': '', 'error': (err or out).strip()[-300:] or f'uxplay exited {code}'}


def mirror_paths(ctx):
    folder = os.path.join(ctx.runtime_dir(), 'mirror')
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return {'dir': folder, 'pid': os.path.join(folder, 'uxplay.pid'),
            'log': os.path.join(folder, 'uxplay.log'), 'pattern': os.path.join(folder, 'frame-%05d.jpg')}


def mirror_pid(ctx):
    try:
        with open(mirror_paths(ctx)['pid']) as handle:
            pid = int(handle.read().strip())
        if os.stat(f'/proc/{pid}').st_uid != os.getuid():
            return None
    except (OSError, ValueError):
        return None
    names = {'uxplay', os.path.basename(os.environ.get('OSHAL_UXPLAY_BIN', '').strip())} - {''}
    return pid if any(os.path.basename(part) in names for part in ctx.process_argv(pid)) else None


def jpeg_size(data):
    if len(data) < 4 or data[:2] != b'\xff\xd8' or data[-2:] != b'\xff\xd9':
        return 0, 0
    idx, limit = 2, len(data) - 2
    while idx < limit:
        while idx < limit and data[idx] != 0xFF:
            idx += 1
        while idx < limit and data[idx] == 0xFF:
            idx += 1
        if idx >= limit:
            break
        marker, idx = data[idx], idx + 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA or idx + 2 > limit:
            break
        seg_len = struct.unpack('>H', data[idx:idx + 2])[0]
        if seg_len < 2 or idx + seg_len > len(data):
            break
        if marker in SOF_MARKERS and idx + 7 <= len(data):
            height, width = struct.unpack('>HH', data[idx + 3:idx + 7])
            return width, height
        idx += seg_len
    return 0, 0


def latest_mirror_jpeg(ctx):
    ranked = []
    for path in glob.glob(os.path.join(mirror_paths(ctx)['dir'], '*.jpg')):
        try:
            ranked.append((os.stat(path).st_mtime_ns, path))
        except OSError:
            continue
    for stamp, path in sorted(ranked, reverse=True)[:4]:
        try:
            with open(path, 'rb') as handle:
                raw = handle.read()
        except OSError:
            continue
        width, height = jpeg_size(raw)
        if width > 0 and height > 0:
            return raw, width, height, int(stamp // 1_000_000)
    return None, 0, 0, 0


def scaled_mirror_jpeg(ctx, raw, width, src_width):
    ffmpeg = shutil.which('ffmpeg') if width < src_width else None
    if not ffmpeg:
        return raw
    code, out, _ = ctx.run([ffmpeg, '-v', 'error', '-f', 'mjpeg', '-i', 'pipe:0',
                            '-vf', f'scale={width}:-2', '-q:v', '7', '-f', 'mjpeg', 'pipe:1'], 20, data=raw, binary=True)
    return out if code == 0 and jpeg_size(out)[0] > 0 else raw


def mirror_summary(ctx):
    name, ux, pid = receiver_name(), find_uxplay(ctx), mirror_pid(ctx)
    _, width, height, frame_at = latest_mirror_jpeg(ctx) if pid else (None, 0, 0, 0)
    if not ux:
        return {'ready': False, 'running': False, 'receiverName': name, 'hasFrame': False,
                'message': 'AirPlay receiver (UxPlay) is not set up on this computer.'}
    ver = uxplay_version(ctx, ux)
    if not ver['ok']:
        return {'ready': False, 'running': False, 'receiverName': name, 'hasFrame': False,
                'message': f"UxPlay does not run: {ver['error']}"}
    msg = (f'Mirroring live ({width}x{height}) as {name}' if (pid and width)
           else f'Waiting for iPhone Screen Mirroring to {name}' if pid
           else f'AirPlay receiver ready (UxPlay {ver["text"]})')
    return {'ready': True, 'version': ver['text'], 'source': ux['source'], 'running': bool(pid),
            'receiverName': name, 'hasFrame': bool(pid and width), 'width': width or None, 'height': height or None,
            'frameAt': frame_at or None, 'message': msg}


def unpack_uxplay_tree(ctx, stage):
    debs = os.path.join(stage, 'debs')
    os.makedirs(debs, mode=0o700)
    seed = ['uxplay'] + [pkg for pkg in MIRROR_PACKAGES[1:] if not ctx.installed(pkg)]
    ctx.download_and_unpack(seed, debs, stage, label='UxPlay')
    seen, extra = set(seed), ctx.missing_dependencies(debs, set(seed))
    for _ in range(2):
        batch = [pkg for pkg in extra if pkg not in seen]
        if not batch:
            break
        seen.update(batch)
        for deb in glob.glob(os.path.join(debs, '*.deb')):
            os.remove(deb)
        ctx.download_and_unpack(batch, debs, stage, label='UxPlay libraries')
        for dep in ctx.missing_dependencies(debs, set(seen)):
            if dep not in extra:
                extra.append(dep)
    shutil.rmtree(debs, ignore_errors=True)
    return extra


def verb_setup_mirror(ctx, args):
    root, current = uxplay_layout(ctx)[0], find_uxplay(ctx)
    host_ok = all(ctx.installed(pkg) for pkg in MIRROR_PACKAGES[1:])
    if current and (os.path.isfile(os.path.join(root, '.ready')) or host_ok) and uxplay_version(ctx, current)['ok']:
        return {'ok': True, 'mirror': mirror_summary(ctx)}
    if not shutil.which('apt-get') or not shutil.which('dpkg-deb'):
        raise ctx.Refusal('no_apt', 'This computer has no apt-get. Install uxplay and GStreamer plugins, then press Set up this computer again.')
    stage = root + '.new'
    shutil.rmtree(stage, ignore_errors=True)
    try:
        extra = unpack_uxplay_tree(ctx, stage)
    except ctx.Refusal:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    shutil.rmtree(root, ignore_errors=True)
    os.rename(stage, root)
    ux = find_uxplay(ctx)
    ver = uxplay_version(ctx, ux) if ux else {'ok': False, 'error': 'uxplay was not unpacked'}
    if not ver['ok']:
        raise ctx.Refusal('uxplay_failed', 'The downloaded UxPlay does not run on this computer: ' + ver['error'])
    with open(os.path.join(root, '.ready'), 'w') as marker:
        marker.write(ver['text'] + '\n')
    return {'ok': True, 'installed': True, 'libraries': extra, 'mirror': mirror_summary(ctx)}


def start_uxplay_process(ux, name, paths):
    sink = f'videoconvert ! jpegenc quality=75 ! multifilesink location={paths["pattern"]} max-files=3'
    argv = [ux['path'], '-n', name, '-nh', '-as', '0', '-fps', '8', '-bt709', '-nohold', '-avdec', '-vsync', 'no', '-vs', sink]
    stdbuf = shutil.which('stdbuf') if not os.environ.get('OSHAL_UXPLAY_BIN', '').strip() else None
    if stdbuf:
        argv = [stdbuf, '-oL', '-eL'] + argv
    with open(paths['log'], 'wb') as log:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True, close_fds=True, cwd=paths['dir'], env=ux['env'])
    with open(paths['pid'], 'w') as handle:
        handle.write(f'{proc.pid}\n')
    return proc.pid


def verb_mirror_start(ctx, args):
    ux = find_uxplay(ctx)
    if not ux or not uxplay_version(ctx, ux)['ok']:
        raise ctx.Refusal('no_uxplay', 'AirPlay mirroring is not set up on this computer. Press Set up this computer first.')
    if os.environ.get('OSHAL_UXPLAY_SKIP_MDNS_CHECK') != '1':
        if not os.path.exists('/run/avahi-daemon/socket') and not shutil.which('mdnsd'):
            raise ctx.Refusal('no_mdns', 'AirPlay needs avahi-daemon running on this computer so the iPhone can find it on Wi-Fi.')
    name = receiver_name()
    if mirror_pid(ctx):
        return {'ok': True, 'started': False, 'running': True, 'receiverName': name, 'mirror': mirror_summary(ctx)}
    paths = mirror_paths(ctx)
    for stale in glob.glob(os.path.join(paths['dir'], '*.jpg')):
        try:
            os.remove(stale)
        except OSError:
            pass
    start_uxplay_process(ux, name, paths)
    for _ in range(4):
        time.sleep(0.2)
        if not mirror_pid(ctx):
            tail = ctx.log_tail(paths['log'])
            line = (tail.strip().splitlines() or ['UxPlay exited immediately'])[-1][:240]
            raise ctx.Refusal('mirror_failed', f'AirPlay receiver stopped right after starting: {line}', log=tail)
    return {'ok': True, 'started': True, 'running': True, 'receiverName': name, 'mirror': mirror_summary(ctx)}


def verb_mirror_stop(ctx, args):
    paths, pid = mirror_paths(ctx), mirror_pid(ctx)
    stopped = bool(pid and ctx.stop_process(pid))
    for path in [paths['pid']] + glob.glob(os.path.join(paths['dir'], '*.jpg')):
        try:
            os.remove(path)
        except OSError:
            pass
    return {'ok': True, 'stopped': stopped, 'running': False}


def verb_mirror_frame(ctx, args):
    width = ctx.number(args, 'width', 160, 1080, 432)
    if not mirror_pid(ctx):
        raise ctx.Refusal('mirror_not_running', 'Screen mirroring is not running on this computer. Press Start mirroring first.')
    raw, dev_w, dev_h, _ = latest_mirror_jpeg(ctx)
    if not raw:
        raise ctx.Refusal('no_mirror_frame', f'Waiting for your iPhone. Open Control Center → Screen Mirroring → {receiver_name()} on the same Wi-Fi.')
    jpeg = scaled_mirror_jpeg(ctx, raw, width, dev_w)
    digest = keep_frame(ctx, jpeg, 'jpg')
    text = base64.b64encode(jpeg).decode('ascii')
    return {'ok': True, 'id': digest[:16], 'sha256': digest, 'mime': 'image/jpeg', 'bytes': len(jpeg),
            'chunks': max(1, math.ceil(len(text) / ctx.CHUNK)), 'index': 0, 'data': text[:ctx.CHUNK],
            'deviceWidth': dev_w, 'deviceHeight': dev_h, 'slow': False}


def parse_tsv_items(tsv, dev_w, dev_h):
    groups = []
    for line in tsv.splitlines()[1:]:
        cols = line.split('\t')
        if len(cols) < 12 or cols[0] != '5':
            continue
        word = cols[11].strip()
        try:
            x, y, bw, bh, conf = int(cols[6]), int(cols[7]), int(cols[8]), int(cols[9]), float(cols[10])
        except ValueError:
            continue
        if not word or conf < 20 or bw <= 0 or bh <= 0:
            continue
        key = (cols[2], cols[3], cols[4])
        if groups and groups[-1]['key'] == key and 0 <= x - groups[-1]['x2'] <= max(36, int(groups[-1]['bh'] * 1.8)):
            prev = groups[-1]
            prev['text'] = (prev['text'] + ' ' + word)[:80]
            prev['y'] = min(prev['y'], y)
            prev['x2'] = max(prev['x2'], x + bw)
            prev['bh'] = max(prev['bh'], bh)
        else:
            groups.append({'key': key, 'text': word[:80], 'x': x, 'y': y, 'x2': x + bw, 'bh': bh})
    items = []
    for grp in groups:
        bw, bh = grp['x2'] - grp['x'], grp['bh']
        cx, cy = grp['x'] + bw // 2, grp['y'] + bh // 2
        items.append({
            'text': grp['text'], 'x': cx, 'y': cy,
            'nx': round(cx / dev_w, 3), 'ny': round(cy / dev_h, 3),
            'iconNy': round(max(0.03, (grp['y'] - bh * 1.4) / dev_h), 3),
        })
    return items


def verb_mirror_ui(ctx, args):
    if not mirror_pid(ctx):
        raise ctx.Refusal('mirror_not_running', 'Screen mirroring is not running on this computer. Press Start mirroring first.')
    raw, dev_w, dev_h, _ = latest_mirror_jpeg(ctx)
    if not raw:
        raise ctx.Refusal('no_mirror_frame', f'Waiting for your iPhone. Open Control Center → Screen Mirroring → {receiver_name()} on the same Wi-Fi.')
    tess = shutil.which('tesseract')
    if not tess:
        raise ctx.Refusal('no_tesseract', 'Screen text reading needs tesseract-ocr installed on this computer.')
    code, out, err = ctx.run([tess, 'stdin', 'stdout', '--psm', '11', 'tsv'], 15, data=raw)
    if code:
        raise ctx.Refusal('ui_read_failed', f'Could not read text on the mirrored screen: {(err or out).strip()[:200]}')
    items = parse_tsv_items(out, dev_w, dev_h)
    truncated = False
    while len(json.dumps(items)) > ctx.MAX_OUT - 600:
        items.pop()
        truncated = True
    return {'ok': True, 'deviceWidth': dev_w, 'deviceHeight': dev_h,
            'frameSha256': hashlib.sha256(raw).hexdigest(), 'items': items, 'truncated': truncated}


def lan_prefixes(ctx):
    prefixes = []
    if shutil.which('ip'):
        _, out, _ = ctx.run(['ip', '-o', '-4', 'addr', 'show'], 5)
        ips = re.findall(r'inet (\d+\.\d+\.\d+)\.(\d+)/(\d+)', out)
    else:
        ips = []
    for net, host_oct, _ in ips:
        parts = [int(p) for p in net.split('.')]
        if parts[0] == 127 or (parts[0] == 169 and parts[1] == 254):
            continue
        if parts[0] == 172 and 16 <= parts[1] <= 31:
            continue
        if parts[0] == 10 and parts[1] in (88, 254):
            continue
        if parts[0] in (10, 192) and net not in [p[0] for p in prefixes]:
            prefixes.append((net, int(host_oct)))
    return prefixes[:2]


def probe_tcp(target):
    host, port = target
    try:
        with socket.create_connection((host, port), timeout=0.22):
            return host, port
    except OSError:
        return None


def verb_adb_scan_tv(ctx, args):
    override = os.environ.get('OSHAL_SCAN_TV_HOSTS', '').strip()
    targets, subnets = [], []
    if override:
        for tok in override.split(','):
            if ':' in tok:
                h, p = tok.strip().rsplit(':', 1)
                targets.append((h, int(p)))
    else:
        for net, self_oct in lan_prefixes(ctx):
            subnets.append(f'{net}.0/24')
            targets.extend((f'{net}.{idx}', 5555) for idx in range(1, 255) if idx != self_oct)
    known = {}
    try:
        for dev in ctx.list_devices()[0]:
            known[dev['serial']] = dev
    except ctx.Refusal:
        pass
    found = []
    if targets:
        with ThreadPoolExecutor(max_workers=48) as pool:
            for hit in pool.map(probe_tcp, targets):
                if hit:
                    addr = f'{hit[0]}:{hit[1]}'
                    dev = known.get(addr, {})
                    found.append({'host': hit[0], 'port': hit[1], 'address': addr,
                                  'connected': dev.get('state') == 'device', 'model': dev.get('model', '')})
    for serial, dev in sorted(known.items()):
        if ':' in serial and not any(c['address'] == serial for c in found):
            h, p = serial.rsplit(':', 1)
            found.append({'host': h, 'port': int(p) if p.isdigit() else 5555, 'address': serial,
                          'connected': dev.get('state') == 'device', 'model': dev.get('model', '')})
    return {'ok': True, 'subnets': subnets, 'candidates': found[:25]}


def need_stage_fields(ctx, args):
    stage_id = str(args.get('id') or args.get('stageId') or '').strip()
    if not STAGE_ID.match(stage_id):
        raise ctx.Refusal('bad_stage_id', 'Stage id must be 4 to 64 letters, digits, dashes or underscores.')
    expected = str(args.get('sha256') or '').strip().lower()
    if not HEX_SHA256.match(expected):
        raise ctx.Refusal('bad_sha256', 'Expected a 64-character hex sha256.')
    return stage_id, expected


def verb_stage_chunk(ctx, args):
    stage_id, expected = need_stage_fields(ctx, args)
    index = ctx.number(args, 'index', 0, 2000)
    total = ctx.number(args, 'total', 1, 2000)
    if index >= total:
        raise ctx.Refusal('bad_argument', 'Chunk index must be less than total.')
    raw_b64 = args.get('data', '')
    if not isinstance(raw_b64, str) or not raw_b64 or len(raw_b64) > 125000:
        raise ctx.Refusal('bad_argument', 'Stage chunk must be base64 up to 90 KiB.')
    try:
        chunk = base64.b64decode(raw_b64, validate=True)
    except ValueError:
        raise ctx.Refusal('bad_argument', 'Stage chunk is not valid base64.')
    folder = transfer_dir(ctx, 'staged')
    part_path = os.path.join(folder, f'{stage_id}.part')
    apk_path = os.path.join(folder, f'{stage_id}.apk')
    cur = os.path.getsize(part_path) if (index > 0 and os.path.isfile(part_path)) else 0
    if cur + len(chunk) > MAX_APK_BYTES:
        if os.path.isfile(part_path):
            os.remove(part_path)
        raise ctx.Refusal('too_large', 'Staged APK exceeds 80 MiB.')
    with open(part_path, 'ab' if index > 0 else 'wb') as handle:
        handle.write(chunk)
    if index + 1 < total:
        return {'ok': True, 'id': stage_id, 'index': index, 'total': total, 'staged': False, 'bytes': cur + len(chunk)}
    with open(part_path, 'rb') as handle:
        actual = hashlib.sha256(handle.read()).hexdigest()
    size = os.path.getsize(part_path)
    if actual != expected:
        os.remove(part_path)
        raise ctx.Refusal('sha256_mismatch', 'Staged APK checksum did not match expected sha256.')
    os.replace(part_path, apk_path)
    for old in sorted(glob.glob(os.path.join(folder, '*.apk')), key=os.path.getmtime, reverse=True)[2:]:
        try:
            os.remove(old)
        except OSError:
            pass
    return {'ok': True, 'id': stage_id, 'index': index, 'total': total, 'staged': True, 'bytes': size, 'sha256': actual}


def find_local_tv_apk(prefer_android=False):
    explicit = os.environ.get('OSHAL_FIRETV_APK', '').strip()
    if explicit.lower() == 'none':
        return None
    candidates = [explicit] if explicit else []
    if not explicit:
        dirs = [os.environ.get('OSHAL_NODE_DOWNLOADS_DIR', '').strip(),
                os.path.expanduser('~/Documents/projects/oshal-releases/oshal-node'),
                os.path.expanduser('~/.local/share/oshal/downloads')]
        for folder in dirs:
            if folder and os.path.isdir(folder):
                apks = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith('.apk')]
                pri = [p for p in apks if ('android' in os.path.basename(p).lower() or 'orbit' in os.path.basename(p).lower()) and 'firetv' not in os.path.basename(p).lower()] if prefer_android else []
                tvs = [] if prefer_android else [p for p in apks if ('firetv' in os.path.basename(p).lower() or 'tv' in os.path.basename(p).lower())]
                candidates.extend(sorted(pri, key=os.path.getmtime, reverse=True))
                candidates.extend(sorted(tvs, key=os.path.getmtime, reverse=True))
    for path in candidates:
        if path and os.path.isfile(path):
            with open(path, 'rb') as handle:
                digest = hashlib.sha256(handle.read()).hexdigest()
            return {'path': path, 'file': os.path.basename(path), 'bytes': os.path.getsize(path), 'sha256': digest}
    return None


def local_tv_apk_summary():
    apk = find_local_tv_apk()
    return {'file': apk['file'], 'bytes': apk['bytes'], 'sha256': apk['sha256']} if apk else None


def resolve_apk_for_install(ctx, args):
    raw_stage = str(args.get('stageId') or '').strip()
    if raw_stage == 'local':
        local = find_local_tv_apk(prefer_android=bool(args.get('preferAndroid')))
        if not local:
            raise ctx.Refusal('stage_missing', 'No signed oshal companion APK was found on this computer.')
        expected = str(args.get('sha256') or '').strip().lower()
        if expected and local['sha256'] != expected:
            raise ctx.Refusal('sha256_mismatch', 'Local companion APK checksum did not match expected sha256.')
        return local['path'], False
    stage_id, expected = need_stage_fields(ctx, {'stageId': raw_stage, 'sha256': args.get('sha256')})
    apk_path = os.path.join(transfer_dir(ctx, 'staged'), f'{stage_id}.apk')
    if not os.path.isfile(apk_path):
        raise ctx.Refusal('stage_missing', 'Staged APK is not on this computer yet; upload chunks first.')
    with open(apk_path, 'rb') as handle:
        actual = hashlib.sha256(handle.read()).hexdigest()
    if actual != expected:
        os.remove(apk_path)
        raise ctx.Refusal('sha256_mismatch', 'Staged APK checksum did not match expected sha256.')
    return apk_path, True


def verb_adb_install_apk(ctx, args):
    serial = ctx.need_serial(args)
    launch_pkg = str(args.get('launchPackage') or '').strip()
    if launch_pkg and not PACKAGE.match(launch_pkg):
        raise ctx.Refusal('bad_package', 'launchPackage must be an Android package name.')
    apk_path, cleanup = resolve_apk_for_install(ctx, args)
    code, out, err = ctx.adb_call(['-s', serial, 'install', '-r', apk_path], 120)
    text = (out + '\n' + err).strip()
    low = text.lower()
    if 'unauthorized' in low or 'authenticate' in low:
        raise ctx.Refusal('device_unauthorized', 'Look at your Fire TV screen and tap Allow USB debugging using your Fire TV remote or phone remote app.', adb=text[-300:])
    if 'offline' in low or ('not found' in low and 'device' in low):
        raise ctx.Refusal('device_offline', f'The TV at {serial} is not connected now. Press Load oshal TV again.', adb=text[-300:])
    if code or 'success' not in low:
        if cleanup and os.path.isfile(apk_path):
            os.remove(apk_path)
        reason = (re.search(r'(INSTALL_FAILED_[A-Z0-9_]+)', text) or [None, text[-180:]])[1]
        raise ctx.Refusal('install_failed', f'Fire TV refused the APK ({reason}). Check Apps from Unknown Sources under Developer Options.', adb=text[-300:])
    if cleanup and os.path.isfile(apk_path):
        os.remove(apk_path)
    launched = False
    if launch_pkg:
        for cat in ('LEANBACK_LAUNCHER', 'LAUNCHER', 'DEFAULT'):
            _, lout, _ = ctx.adb_shell(serial, f'monkey -p {launch_pkg} -c android.intent.category.{cat} 1', 25)
            if 'Events injected: 1' in lout:
                launched = True
                break
        if not launched and launch_pkg == 'com.oshal.remote':
            acode, aout, _ = ctx.adb_shell(serial, 'am start -n com.oshal.remote/.ui.SignInActivity', 25)
            launched = (acode == 0 and 'Error' not in aout)
    return {'ok': True, 'serial': serial, 'installed': True, 'launched': launched, 'launchPackage': launch_pkg or None}
