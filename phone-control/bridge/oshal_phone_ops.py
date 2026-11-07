# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: learnable BLE pointer calibration (ble-calibrate + ble-profiles.json), RDP X.224 port probe (rdp-probe), and unified screen/pointer/keyboard bridge verbs (screen-info, pointer-move, pointer-click, pointer-drag, keyboard-type, keyboard-key).
"""Calibration, RDP probe, and unified pointer/keyboard verbs for oshal_phone_bridge.py."""

import io, json, os, re, shutil, socket, struct, time
import oshal_phone_mirror

HOST_RE = re.compile(r'^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]{0,252})$')
X224_CR = b'\x03\x00\x00\x13\x0e\xe0\x00\x00\x00\x00\x00\x01\x00\x08\x00\x03\x00\x00\x00'
RDP_PROTOCOLS = {0: 'Standard RDP', 1: 'TLS', 2: 'NLA (CredSSP)', 3: 'NLA (CredSSP)'}
IOS_KEY_ALIASES = {
    'ENTER': 'Enter', 'RETURN': 'Enter', 'OK': 'Select', 'SELECT': 'Select',
    'BACKSPACE': 'Backspace', 'ESCAPE': 'Escape', 'ESC': 'Escape', 'TAB': 'Tab',
    'HOME': 'Home', 'BACK': 'Back', 'MENU': 'Menu', 'PLAY_PAUSE': 'PlayPause', 'PLAYPAUSE': 'PlayPause',
    'UP': 'Up', 'ARROWUP': 'Up', 'DOWN': 'Down', 'ARROWDOWN': 'Down',
    'LEFT': 'Left', 'ARROWLEFT': 'Left', 'RIGHT': 'Right', 'ARROWRIGHT': 'Right',
    'VOLUME_UP': 'VolumeUp', 'VOLUMEUP': 'VolumeUp', 'VOLUME_DOWN': 'VolumeDown', 'VOLUMEDOWN': 'VolumeDown',
    'SPOTLIGHT': 'Spotlight',
}
ANDROID_KEY_ALIASES = {
    'ENTER': 'ENTER', 'RETURN': 'ENTER', 'SELECT': 'OK', 'OK': 'OK',
    'BACKSPACE': 'BACKSPACE', 'ESCAPE': 'BACK', 'ESC': 'BACK', 'BACK': 'BACK', 'TAB': 'TAB',
    'HOME': 'HOME', 'MENU': 'RECENTS', 'RECENTS': 'RECENTS', 'PLAYPAUSE': 'PLAY_PAUSE', 'PLAY_PAUSE': 'PLAY_PAUSE',
    'UP': 'UP', 'ARROWUP': 'UP', 'DOWN': 'DOWN', 'ARROWDOWN': 'DOWN',
    'LEFT': 'LEFT', 'ARROWLEFT': 'LEFT', 'RIGHT': 'RIGHT', 'ARROWRIGHT': 'RIGHT',
    'VOLUMEUP': 'VOLUME_UP', 'VOLUME_UP': 'VOLUME_UP', 'VOLUMEDOWN': 'VOLUME_DOWN', 'VOLUME_DOWN': 'VOLUME_DOWN',
    'POWER': 'POWER',
}


def ble_profiles_path():
    base = os.environ.get('XDG_STATE_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'state')
    return os.path.join(base, 'oshal-phone-bridge', 'ble-profiles.json')


def load_ble_profiles():
    try:
        with open(ble_profiles_path(), 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_ble_profile(address, profile):
    path = ble_profiles_path()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    profiles = load_ble_profiles()
    key = str(address or 'DEFAULT').strip().upper() or 'DEFAULT'
    profiles[key] = profile
    profiles['DEFAULT'] = profile
    tmp = path + '.new'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(profiles, handle, indent=2, sort_keys=True)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    return path


def decode_luma_grid(ctx, raw, max_w=220):
    orig_w, orig_h = oshal_phone_mirror.jpeg_size(raw)
    if orig_w <= 0 or orig_h <= 0:
        return None
    gw = min(orig_w, max_w)
    gh = max(16, int(round(orig_h * gw / orig_w)))
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw)).convert('L').resize((gw, gh))
        return {'gw': gw, 'gh': gh, 'px': img.tobytes(), 'w': orig_w, 'h': orig_h}
    except Exception:
        ffmpeg = shutil.which('ffmpeg')
        if not ffmpeg:
            return None
        code, out, _ = ctx.run([ffmpeg, '-v', 'error', '-f', 'mjpeg', '-i', 'pipe:0',
                                '-vf', f'scale={gw}:{gh}', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
                               10, data=raw, binary=True)
        return {'gw': gw, 'gh': gh, 'px': out, 'w': orig_w, 'h': orig_h} if code == 0 and len(out) == gw * gh else None


def measure_step_px(g0, g1, axis):
    if not g0 or not g1 or g0['gw'] != g1['gw'] or g0['gh'] != g1['gh']:
        return None
    gw, p0, p1 = g0['gw'], g0['px'], g1['px']
    scale = (g1['w'] / gw) if axis == 'x' else (g1['h'] / g1['gh'])
    span_grid = gw if axis == 'x' else g1['gh']
    vals = [((idx % gw) if axis == 'x' else (idx // gw)) for idx in range(len(p0)) if abs(p1[idx] - p0[idx]) >= 18]
    if len(vals) < 4:
        return None
    spread = max(vals) - min(vals)
    if spread > span_grid * 0.14:
        mid = sum(vals) / len(vals)
        lo, hi = [v for v in vals if v <= mid], [v for v in vals if v > mid]
        if lo and hi:
            return round((sum(hi) / len(hi) - sum(lo) / len(lo)) * scale, 2)
    return round((sum(vals) / len(vals)) * scale, 2)


def sample_cal_frame(ctx, pause_s):
    time.sleep(pause_s)
    raw, dev_w, dev_h, _ = oshal_phone_mirror.latest_mirror_jpeg(ctx)
    return decode_luma_grid(ctx, raw) if raw else None, dev_w, dev_h


def verb_ble_calibrate(ctx, args):
    if not oshal_phone_mirror.mirror_pid(ctx):
        raise ctx.Refusal('mirror_not_running', 'Start iPhone screen mirroring first so calibration can watch the AssistiveTouch pointer move.')
    raw0, dev_w, dev_h, _ = oshal_phone_mirror.latest_mirror_jpeg(ctx)
    if not raw0:
        raise ctx.Refusal('no_mirror_frame', f'Mirroring has no live frame yet. Choose {oshal_phone_mirror.receiver_name()} in iPhone Screen Mirroring first.')
    homed = ctx.ble_op('home', {})
    phones = homed.get('phones') or []
    address = str(args.get('address') or (phones[0].get('address') if phones else '') or 'DEFAULT').strip().upper()
    dev_kind = str(args.get('deviceKind') or (phones[0].get('name') if phones else '') or 'iPhone').strip()[:80]
    pause_s = max(0.02, min(0.8, float(os.environ.get('OSHAL_BLE_CALIB_SETTLE', '0.22'))))
    g0, _, _ = sample_cal_frame(ctx, pause_s)
    dx_slow, dy_slow, dx_fast = 160, 240, 160
    for _ in range(8):
        ctx.ble_op('mouse', {'dx': dx_slow // 8, 'dy': 0, 'click': False})
    g1, _, _ = sample_cal_frame(ctx, pause_s)
    for _ in range(12):
        ctx.ble_op('mouse', {'dx': 0, 'dy': dy_slow // 12, 'click': False})
    g2, _, _ = sample_cal_frame(ctx, pause_s)
    ctx.ble_op('mouse', {'dx': dx_fast, 'dy': 0, 'click': False})
    g3, _, _ = sample_cal_frame(ctx, pause_s)
    ctx.ble_op('home', {})
    px_x = measure_step_px(g0, g1, 'x')
    px_y = measure_step_px(g1, g2, 'y')
    px_fast = measure_step_px(g2, g3, 'x')
    default_sx, default_sy = (932, 430) if dev_w > dev_h else (430, 932)
    gain_x = round(px_x / dx_slow, 4) if px_x and px_x >= 16 else round(dev_w / default_sx, 4)
    gain_y = round(px_y / dy_slow, 4) if px_y and px_y >= 16 else round(dev_h / default_sy, 4)
    span_x = max(180, min(2200, int(round(dev_w / max(0.15, gain_x)))))
    span_y = max(180, min(2200, int(round(dev_h / max(0.15, gain_y)))))
    accel = round((px_fast / dx_fast) / gain_x, 3) if (px_fast and px_x and px_x >= 16) else 1.0
    measured = bool(px_x and px_x >= 16 and px_y and px_y >= 16)
    profile = {
        'device_kind': dev_kind, 'address': address, 'width': dev_w, 'height': dev_h,
        'gain_x': gain_x, 'gain_y': gain_y, 'span_x': span_x, 'span_y': span_y,
        'accel': max(0.5, min(4.0, accel)), 'measured': measured,
        'calibrated_at': int(time.time() * 1000),
        'samples': {'dx_slow': dx_slow, 'px_x': px_x, 'dy_slow': dy_slow, 'px_y': px_y, 'dx_fast': dx_fast, 'px_fast': px_fast},
    }
    saved_to = save_ble_profile(address, profile)
    return {'ok': True, 'address': address, 'width': dev_w, 'height': dev_h, 'profile': profile, 'savedTo': saved_to}


def verb_rdp_probe(ctx, args):
    host = str(args.get('host') or '').strip()
    if not host or not HOST_RE.match(host):
        raise ctx.Refusal('bad_host', 'Enter the computer IP address or hostname, for example 192.168.1.50.')
    port = ctx.number(args, 'port', 1, 65535, 3389)
    t0 = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=2.5) as sock:
            sock.settimeout(2.0)
            sock.sendall(X224_CR)
            try:
                buf = sock.recv(64)
            except OSError:
                buf = b''
    except OSError as err:
        raise ctx.Refusal('rdp_unreachable', f'Could not reach {host}:{port} over TCP ({err}). Turn on Remote Desktop and allow TCP port {port} in the firewall.')
    latency_ms = max(0, int(round((time.monotonic() - t0) * 1000)))
    confirm = len(buf) >= 7 and buf[0] == 0x03 and (buf[5] & 0xF0) == 0xD0
    proto_code = struct.unpack('<I', buf[15:19])[0] if (confirm and len(buf) >= 19 and buf[11] == 0x02) else 0
    proto = RDP_PROTOCOLS.get(proto_code, 'RDP') if confirm else 'TCP open (no X.224 confirm)'
    msg = (f'RDP ready at {host}:{port} ({proto}).' if confirm
           else f'TCP port {host}:{port} is open, though it did not send an RDP X.224 handshake.')
    return {'ok': True, 'host': host, 'port': port, 'address': f'{host}:{port}', 'reachable': True,
            'tcpOpen': True, 'rdpHandshake': confirm, 'rdpConfirm': confirm, 'security': proto,
            'protocol': proto, 'latencyMs': latency_ms, 'message': msg}


def resolve_target(ctx, args):
    plat = str(args.get('platform') or '').strip().lower()
    if plat == 'android' or (not plat and args.get('serial')):
        return 'android', ctx.need_serial(args)
    return 'ios', str(args.get('address') or '').strip()


def detect_dimensions(ctx, kind, target, args):
    w = int(float(args['width'])) if args.get('width') else 0
    h = int(float(args['height'])) if args.get('height') else 0
    if w > 0 and h > 0:
        return w, h, True
    if kind == 'android':
        info = ctx.verb_adb_info({'serial': target})
        if info.get('width') and info.get('height'):
            return int(info['width']), int(info['height']), True
        return 1080, 2400, False
    _, mw, mh, _ = oshal_phone_mirror.latest_mirror_jpeg(ctx) if oshal_phone_mirror.mirror_pid(ctx) else (None, 0, 0, 0)
    if mw > 0 and mh > 0:
        return mw, mh, True
    prof = load_ble_profiles().get(str(target or 'DEFAULT').upper()) or load_ble_profiles().get('DEFAULT') or {}
    if prof.get('width') and prof.get('height'):
        return int(prof['width']), int(prof['height']), False
    return 430, 932, False


def resolve_coords(ctx, kind, target, args, x_key='x', y_key='y', nx_key='nx', ny_key='ny'):
    w, h, live = detect_dimensions(ctx, kind, target, args)
    if nx_key in args and ny_key in args and x_key not in args:
        nx = max(0.0, min(1.0, float(args[nx_key])))
        ny = max(0.0, min(1.0, float(args[ny_key])))
        return round(nx * w), round(ny * h), nx, ny, w, h, live
    px = max(0, min(w, int(round(float(args.get(x_key, w / 2))))))
    py = max(0, min(h, int(round(float(args.get(y_key, h / 2))))))
    return px, py, round(px / max(1, w), 4), round(py / max(1, h), 4), w, h, live


def verb_screen_info(ctx, args):
    kind, target = resolve_target(ctx, args)
    include_ui = str(args.get('includeUi', 'true')).lower() not in ('false', '0')
    w, h, live = detect_dimensions(ctx, kind, target, args)
    items = []
    if include_ui:
        try:
            ui = (oshal_phone_mirror.verb_adb_ui(ctx, {'serial': target}) if kind == 'android'
                  else oshal_phone_mirror.verb_mirror_ui(ctx, {}) if live else {'items': []})
            items = ui.get('items') or []
        except ctx.Refusal:
            items = []
    return {'ok': True, 'platform': kind, 'width': w, 'height': h,
            'orientation': 'landscape' if w > h else 'portrait', 'hasFrame': live, 'items': items}


def verb_pointer_move(ctx, args):
    kind, target = resolve_target(ctx, args)
    px, py, nx, ny, w, h, _ = resolve_coords(ctx, kind, target, args)
    if kind == 'android':
        ctx.adb_shell(target, f'input motionevent MOVE {px} {py}', 10)
        return {'ok': True, 'platform': 'android', 'x': px, 'y': py, 'nx': nx, 'ny': ny, 'width': w, 'height': h}
    reply = ctx.ble_op('move', {'nx': nx, 'ny': ny, 'landscape': w > h, 'address': target})
    return dict(reply, platform='ios', x=px, y=py, nx=nx, ny=ny, width=w, height=h)


def verb_pointer_click(ctx, args):
    kind, target = resolve_target(ctx, args)
    px, py, nx, ny, w, h, _ = resolve_coords(ctx, kind, target, args)
    if kind == 'android':
        reply = ctx.verb_adb_tap({'serial': target, 'x': px, 'y': py})
        return dict(reply, platform='android', x=px, y=py, nx=nx, ny=ny, width=w, height=h)
    reply = ctx.ble_op('tap', {'nx': nx, 'ny': ny, 'landscape': w > h, 'address': target})
    return dict(reply, platform='ios', x=px, y=py, nx=nx, ny=ny, width=w, height=h)


def verb_pointer_drag(ctx, args):
    kind, target = resolve_target(ctx, args)
    x1, y1, nx1, ny1, w, h, _ = resolve_coords(ctx, kind, target, args, 'x1', 'y1', 'nx1', 'ny1')
    x2, y2, nx2, ny2, _, _, _ = resolve_coords(ctx, kind, target, dict(args, width=w, height=h), 'x2', 'y2', 'nx2', 'ny2')
    hold_ms = int(float(args.get('holdMs') or 0))
    ms = max(80, min(4000, int(float(args.get('ms') or (max(750, hold_ms) if hold_ms > 350 else 280)))))
    if kind == 'android':
        reply = ctx.verb_adb_swipe({'serial': target, 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'ms': ms})
        return dict(reply, platform='android', x1=x1, y1=y1, x2=x2, y2=y2, width=w, height=h)
    op = 'drag' if hold_ms > 350 else 'swipe'
    payload = {'nx1': nx1, 'ny1': ny1, 'nx2': nx2, 'ny2': ny2, 'landscape': w > h, 'address': target}
    payload['holdMs' if op == 'drag' else 'ms'] = hold_ms if op == 'drag' else ms
    reply = ctx.ble_op(op, payload)
    return dict(reply, platform='ios', x1=x1, y1=y1, x2=x2, y2=y2, width=w, height=h)


def verb_keyboard_type(ctx, args):
    kind, target = resolve_target(ctx, args)
    text = str(args.get('text') or '')
    enter = str(args.get('enter') or '').lower() in ('true', '1')
    if kind == 'android':
        reply = ctx.verb_adb_text({'serial': target, 'text': text})
        if enter:
            ctx.verb_adb_key({'serial': target, 'key': 'ENTER'})
        return dict(reply, platform='android', typed=len(text), enter=enter)
    reply = ctx.ble_op('type', {'text': text, 'enter': enter})
    return dict(reply, platform='ios', enter=enter)


def verb_keyboard_key(ctx, args):
    kind, target = resolve_target(ctx, args)
    raw = str(args.get('key') or '').strip()
    norm = raw.upper().replace('-', '_')
    if kind == 'android':
        mapped = ANDROID_KEY_ALIASES.get(norm, raw.upper())
        reply = ctx.verb_adb_key({'serial': target, 'key': mapped})
        return dict(reply, platform='android', key=mapped)
    mapped = IOS_KEY_ALIASES.get(norm, raw)
    reply = ctx.ble_op('key', {'key': mapped})
    return dict(reply, platform='ios', key=mapped)
