#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: TVs and streaming sticks on the home network, found and pressed from the person's own computer (the server never scans a network). lan-discover reads the neighbor table of this computer's real network interfaces (private IPv4 only; docker, bridge, veth, VPN and tunnel interfaces skipped), asks SSDP for one second and avahi for Cast, Android TV remote and wireless-debugging services, sends Wake-on-LAN only to the MACs the caller names (TVs the person saved), probes the found addresses on the TV ports in parallel and fingerprints them read-only (Samsung Tizen /api/v2/, Roku /query/device-info, Google Cast eureka_info, adb state from the bridge's own adb and the installed oshal TV app version); it never connects adb to a new TV and never installs anything. lan-control sends one closed action to one TV at a private IPv4 address: Samsung Tizen over its TLS WebSocket remote channel (pairing token kept 0600 on this computer, never sent anywhere else; the first use answers "press Allow on the TV"), Roku over ECP keypresses, Android TV over the bridge's adb helpers (keyevents, a VIEW intent for an https page, the oshal TV app).
"""TVs and streaming sticks on this computer's home network: lan-discover and lan-control for oshal_phone_bridge.py."""

from concurrent.futures import ThreadPoolExecutor
import base64, hashlib, http.client, json, os, re, shutil, socket, ssl, struct, subprocess, time
from xml.etree import ElementTree

ADB_PORT = 5555
SAMSUNG_REST_PORT = 8001
SAMSUNG_WSS_PORT = 8002
CAST_PORT = 8008
ROKU_PORT = 8060
PROBE_PORTS = (5555, 6466, 7000, 8001, 8002, 8008, 8009, 8060)
TV_PORTS = frozenset((5555, 6466, 8001, 8002, 8008, 8009, 8060))
ANDROID_REMOTE_PORT = 6466
WAKE_PORTS = (9, 7)
SSDP_GROUP = ('239.255.255.250', 1900)
SSDP_SEARCH = (b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\n'
               b'MX: 1\r\nST: ssdp:all\r\n\r\n')
AVAHI_TYPES = ('_googlecast._tcp', '_adb-tls-connect._tcp', '_androidtvremote2._tcp')
KINDS = ('android-tv', 'samsung-tizen', 'roku')
ACTIONS = ('wake', 'off', 'volume_up', 'volume_down', 'mute', 'up', 'down', 'left', 'right', 'select', 'home',
           'back', 'play_pause', 'launch_url', 'open_app', 'pair')
ANDROID_KEYCODES = {'wake': 224, 'off': 223, 'volume_up': 24, 'volume_down': 25, 'mute': 164, 'up': 19, 'down': 20,
                    'left': 21, 'right': 22, 'select': 23, 'home': 3, 'back': 4, 'play_pause': 85}
SAMSUNG_KEYS = {'off': 'KEY_POWER', 'volume_up': 'KEY_VOLUP', 'volume_down': 'KEY_VOLDOWN', 'mute': 'KEY_MUTE',
                'up': 'KEY_UP', 'down': 'KEY_DOWN', 'left': 'KEY_LEFT', 'right': 'KEY_RIGHT', 'select': 'KEY_ENTER',
                'home': 'KEY_HOME', 'back': 'KEY_RETURN', 'play_pause': 'KEY_PLAY'}
ROKU_KEYS = {'wake': 'PowerOn', 'off': 'PowerOff', 'volume_up': 'VolumeUp', 'volume_down': 'VolumeDown',
             'mute': 'VolumeMute', 'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right', 'select': 'Select',
             'home': 'Home', 'back': 'Back', 'play_pause': 'Play'}
SKIP_INTERFACE = re.compile(r'^(?:lo|docker|br-|veth|tailscale|virbr|cni|flannel|cali|vxlan|kube|podman|lxcbr|lxdbr|'
                            r'zt|wg|tun|tap)')
IPV4 = re.compile(r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
MAC = re.compile(r'^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$')
SAFE_URL = re.compile(r'^https://[A-Za-z0-9.-]+(?::\d{1,5})?(?:/[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*)?$')
TOKEN = re.compile(r'^[A-Za-z0-9]{1,64}$')
APP_PACKAGE = 'com.oshal.remote'
CLIENT_NAME = 'oshal'
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
HTTP_LIMIT = 65536
MAX_FOUND = 24
MAX_WAKE = 8
WAKE_SETTLE_S = 1.5
CONNECT_WAIT_S = 6.0
ALLOW_WAIT_S = 15.0
PAIR_WAIT_S = 30.0
GOOGLE_TV_STEPS = ('On the TV: open Settings, then System, then About, and select Android TV OS build seven times until '
                   'it says you are a developer. Go back to System, open Developer options and turn on USB debugging '
                   '(on newer models also Wireless debugging). Then press Scan again.')
FIRE_TV_STEPS = ('On the Fire TV: open Settings, then My Fire TV, then About, and select the device name seven times. '
                 'Go back to My Fire TV, open Developer options and turn on ADB debugging. Then press Scan again.')
CONNECT_STEPS = ('This computer has not connected to the TV yet. Press Connect on its card: the TV asks "Allow USB '
                 'debugging?"; choose Always allow from this computer, then OK.')
ALLOW_STEPS = ('The TV is asking "Allow USB debugging?". On the TV choose Always allow from this computer, then OK, '
               'and press Connect again.')


def private_ipv4(text):
    """Whether text is a dotted IPv4 address in a private home-network range (10/8, 172.16/12, 192.168/16)."""
    match = IPV4.match(str(text or '').strip())
    if not match:
        return False
    a, b, c, d = (int(part) for part in match.groups())
    if max(a, b, c, d) > 255:
        return False
    return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def need_lan_address(ctx, value):
    """The TV's address, or a refusal in words: only a private IPv4 address on the home network is accepted."""
    text = str(value or '').strip()
    match = IPV4.match(text)
    if not match or max(int(part) for part in match.groups()) > 255:
        raise ctx.Refusal('bad_address', "Name the TV by its IP address on your home network, for example 192.168.1.50.")
    if not private_ipv4(text):
        raise ctx.Refusal('public_address', f'{text} is not an address on a home network. Only a TV at a private '
                          'address (10.x, 172.16-31.x or 192.168.x) can be controlled from this computer.')
    return text


def need_mac(ctx, value):
    """A unicast hardware address in lowercase colon form, or a refusal."""
    text = str(value or '').strip()
    if not MAC.match(text):
        raise ctx.Refusal('bad_mac', 'A TV hardware address looks like 00:11:22:33:44:55.')
    raw = bytes.fromhex(re.sub('[:-]', '', text))
    if raw[0] & 1 or raw == b'\0' * 6:
        raise ctx.Refusal('bad_mac', f'{text} is a group address, not one TV.')
    return ':'.join('%02x' % byte for byte in raw)


def need_url(ctx, value):
    """An https page of at most 256 characters with no quotes or spaces, or a refusal."""
    text = str(value or '').strip()
    if len(text) > 256 or not SAFE_URL.match(text):
        raise ctx.Refusal('bad_url', 'Only an https address of at most 256 characters can be opened on a TV.')
    return text


def need_kind(ctx, value):
    """One of the TV kinds this bridge can control, or a refusal."""
    kind = str(value or '').strip().lower()
    if kind not in KINDS:
        raise ctx.Refusal('bad_kind', 'kind is android-tv, samsung-tizen or roku.')
    return kind


def need_action(ctx, kind, value):
    """One action from the closed list that this kind of TV can do, or a refusal in words."""
    action = str(value or '').strip().lower()
    if action not in ACTIONS:
        raise ctx.Refusal('bad_action', 'action is one of ' + ', '.join(ACTIONS) + '.')
    if kind == 'roku' and action == 'launch_url':
        raise ctx.Refusal('roku_cannot_open_pages', 'A Roku cannot open a web page, so oshal cannot be opened on it. '
                          'Use its arrows, OK, Home, Back and the volume buttons.')
    if kind == 'roku' and action == 'pair':
        raise ctx.Refusal('not_needed', 'A Roku needs no pairing: its buttons work right away.')
    if kind != 'android-tv' and action == 'open_app':
        raise ctx.Refusal('not_android', 'The oshal TV app runs on Android TVs. On this TV use Open oshal, which '
                          'opens the page in its browser.' if kind == 'samsung-tizen' else
                          'The oshal TV app runs on Android TVs, not on a Roku.')
    return action


def need_wake_list(ctx, value):
    """The saved TVs to wake before a scan: at most eight, each a unicast MAC with an optional private address."""
    if value in (None, '', []):
        return []
    if not isinstance(value, list) or len(value) > MAX_WAKE:
        raise ctx.Refusal('bad_argument', f'wake is a list of at most {MAX_WAKE} saved TVs.')
    wake = []
    for item in value:
        item = item if isinstance(item, dict) else {'mac': item}
        address = str(item.get('address') or '').strip()
        wake.append({'mac': need_mac(ctx, item.get('mac')), 'address': address if private_ipv4(address) else ''})
    return wake


def ipv4_int(text):
    return struct.unpack('!I', socket.inet_aton(text))[0]


def subnet_of(address, prefix):
    """The (network, mask) pair of an interface address."""
    mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF if prefix else 0
    return ipv4_int(address) & mask, mask


def in_subnets(address, subnets):
    """Whether a private address sits on one of this computer's home networks."""
    if not private_ipv4(address):
        return False
    value = ipv4_int(address)
    return any(value & mask == network for network, mask in subnets)


def subnet_text(subnet):
    network, mask = subnet
    return '%s/%d' % (socket.inet_ntoa(struct.pack('!I', network)), bin(mask).count('1'))


def broadcasts(subnets):
    """Where a Wake-on-LAN packet goes: every home network's broadcast address and the local broadcast."""
    targets = [socket.inet_ntoa(struct.pack('!I', network | (~mask & 0xFFFFFFFF))) for network, mask in subnets]
    return sorted(set(targets)) + ['255.255.255.255']


def parse_interfaces(text):
    """(name, address, prefix) of each real network interface with a private IPv4 address, from `ip -o -4 addr`."""
    rows = []
    for line in text.splitlines():
        match = re.search(r'^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)', line)
        if not match:
            continue
        name = match.group(1).split('@')[0]
        if not SKIP_INTERFACE.match(name) and private_ipv4(match.group(2)):
            rows.append((name, match.group(2), int(match.group(3))))
    return rows


def parse_neighbors(text, interfaces):
    """{address: {mac, interface}} for live neighbors on the named interfaces, from `ip -4 neigh show`."""
    found = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[1] != 'dev' or parts[2] not in interfaces or not private_ipv4(parts[0]):
            continue
        if parts[-1] in ('FAILED', 'INCOMPLETE'):
            continue
        mac = parts[parts.index('lladdr') + 1].lower() if 'lladdr' in parts[:-1] else ''
        found[parts[0]] = {'mac': mac if MAC.match(mac) else '', 'interface': parts[2]}
    return found


def lan_interfaces(ctx):
    """This computer's real home-network interfaces, or none when `ip` is missing."""
    try:
        _, out, _ = ctx.run(['ip', '-o', '-4', 'addr', 'show'], 5)
    except ctx.Refusal:
        return []
    return parse_interfaces(out)


def neighbors(ctx, interfaces):
    """The neighbor table of the home-network interfaces."""
    try:
        _, out, _ = ctx.run(['ip', '-4', 'neigh', 'show'], 5)
    except ctx.Refusal:
        return {}
    return parse_neighbors(out, {name for name, _, _ in interfaces})


def magic_packet(mac):
    """The Wake-on-LAN magic packet: six 0xFF bytes and the MAC sixteen times."""
    return b'\xff' * 6 + bytes.fromhex(mac.replace(':', '')) * 16


def send_wake(macs, targets, ports=None):
    """Send one magic packet per MAC to each broadcast target; answers the MACs a packet left for."""
    sent = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for mac in macs:
            delivered = False
            for target in targets:
                for port in ports or WAKE_PORTS:
                    try:
                        sock.sendto(magic_packet(mac), (target, port))
                        delivered = True
                    except OSError:
                        continue
            if delivered:
                sent.append(mac)
    return sent


def parse_ssdp(data):
    """The headers of one SSDP answer, lowercased, or None when it is not one."""
    text = data[:4096].decode('utf-8', 'replace')
    lines = text.split('\r\n') if '\r\n' in text else text.split('\n')
    if not lines or not re.match(r'^(HTTP/1\.[01] 200|NOTIFY \*)', lines[0]):
        return None
    headers = {}
    for line in lines[1:]:
        name, sep, value = line.partition(':')
        if sep and name.strip():
            headers[name.strip().lower()] = value.strip()[:200]
    return headers


def ssdp_search(seconds=1.0, target=None):
    """Ask the network who is there for `seconds`: {address: [headers, ...]} of every SSDP answer."""
    answers = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.settimeout(0.2)
        sock.sendto(SSDP_SEARCH, target or SSDP_GROUP)
        end = time.monotonic() + seconds
        while time.monotonic() < end and len(answers) < 64:
            try:
                data, (host, _) = sock.recvfrom(4096)
            except socket.timeout:
                continue
            headers = parse_ssdp(data)
            if headers is not None:
                answers.setdefault(host, []).append(headers)
    except OSError:
        pass
    finally:
        sock.close()
    return answers


def parse_avahi(text, kind):
    """{address: kind} from `avahi-browse -rpt` lines for one service type."""
    found = {}
    for line in text.splitlines():
        parts = line.split(';')
        if len(parts) >= 9 and parts[0] == '=' and parts[2] == 'IPv4' and parts[4] == kind:
            found[parts[7].strip()] = kind
    return found


def avahi_browse(kind, binary=None):
    """One avahi service type for up to three seconds; nothing when avahi is not installed."""
    avahi = binary or shutil.which('avahi-browse')
    if not avahi:
        return {}
    try:
        done = subprocess.run([avahi, '-rpt', '--terminate', kind], capture_output=True, text=True, timeout=3)
        text = done.stdout or ''
    except subprocess.TimeoutExpired as exc:
        text = exc.stdout.decode('utf-8', 'replace') if isinstance(exc.stdout, bytes) else (exc.stdout or '')
    except OSError:
        return {}
    return parse_avahi(text, kind)


def port_open(address, port, timeout=0.25):
    """Whether a TCP connection to the port is accepted; the connection is closed at once and nothing is sent."""
    try:
        with socket.create_connection((address, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe_all(addresses, ports=None, timeout=0.25):
    """{address: [open ports]} for every address and port, probed in parallel."""
    pairs = [(address, port) for address in addresses for port in (ports or PROBE_PORTS)]
    found = {}
    if not pairs:
        return found
    with ThreadPoolExecutor(max_workers=min(64, len(pairs))) as pool:
        for (address, port), ok in zip(pairs, pool.map(lambda pair: port_open(pair[0], pair[1], timeout), pairs)):
            if ok:
                found.setdefault(address, []).append(port)
    return found


def http_get(address, port, path, timeout=1.5):
    """(status, body) of one read-only GET on the LAN, never through a proxy; (0, b'') when nothing answers."""
    conn = http.client.HTTPConnection(address, port, timeout=timeout)
    try:
        conn.request('GET', path, headers={'User-Agent': 'oshal-phone-bridge', 'Accept': '*/*'})
        response = conn.getresponse()
        return response.status, response.read(HTTP_LIMIT)
    except (OSError, http.client.HTTPException, ValueError):
        return 0, b''
    finally:
        conn.close()


def clip(value, size=80):
    text = re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()
    return text[:size]


def parse_samsung(status, body):
    """What a Samsung Tizen TV says about itself at /api/v2/, or None."""
    if status != 200:
        return None
    try:
        doc = json.loads(body.decode('utf-8', 'replace'))
    except ValueError:
        return None
    device = doc.get('device') if isinstance(doc, dict) else None
    if not isinstance(device, dict):
        return None
    state = str(device.get('PowerState') or '').lower()
    mac = str(device.get('wifiMac') or '').lower()
    return {'name': clip(device.get('name') or doc.get('name')), 'model': clip(device.get('modelName') or device.get('model'), 60),
            'os': clip(device.get('OS'), 30), 'mac': mac if MAC.match(mac) else '',
            'duid': clip(device.get('duid'), 80), 'tokenAuth': str(device.get('TokenAuthSupport')).lower() == 'true',
            'power': 'off' if state == 'standby' else 'on', 'version': clip(doc.get('version'), 20)}


def parse_roku(status, body):
    """What a Roku says about itself at /query/device-info, or None."""
    if status != 200 or b'<!DOCTYPE' in body or b'<!ENTITY' in body:
        return None
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return None
    if root.tag != 'device-info':
        return None
    field = lambda name: (root.findtext(name) or '').strip()  # noqa: E731
    mac = field('wifi-mac').lower() or field('ethernet-mac').lower()
    power = field('power-mode')
    return {'name': clip(field('user-device-name') or field('friendly-device-name') or field('model-name')),
            'model': clip(field('model-name') or field('model-number'), 60), 'os': clip('Roku OS ' + field('software-version'), 30),
            'room': clip(field('user-device-location'), 40), 'mac': mac if MAC.match(mac) else '',
            'isTv': field('is-tv') == 'true', 'power': 'on' if power == 'PowerOn' else ('off' if power else None)}


def parse_cast(status, body):
    """What a Google Cast device says about itself at /setup/eureka_info, or None."""
    if status != 200:
        return None
    try:
        doc = json.loads(body.decode('utf-8', 'replace'))
    except ValueError:
        return None
    if not isinstance(doc, dict):
        return None
    info = doc.get('device_info') if isinstance(doc.get('device_info'), dict) else {}
    caps = info.get('capabilities') if isinstance(info.get('capabilities'), dict) else {}
    return {'name': clip(doc.get('name')), 'model': clip(info.get('model_name'), 60),
            'manufacturer': clip(info.get('manufacturer'), 40), 'display': caps.get('display_supported')}


def ssdp_hints(answers):
    """Which kind the SSDP answers of one address point at, from their server and service names."""
    text = ' '.join(' '.join(headers.values()) for headers in answers).lower()
    hints = set()
    if 'roku' in text:
        hints.add('roku')
    if 'samsung' in text:
        hints.add('samsung')
    if 'amazon' in text or 'aft' in text:
        hints.add('fire')
    return hints


def adb_snapshot(ctx):
    """The network devices this computer's adb knows, by address; never connects to anything new."""
    try:
        devices, _ = ctx.list_devices()
    except ctx.Refusal as refusal:
        return {'ready': False, 'message': refusal.message, 'devices': {}}
    table = {}
    for device in devices:
        host, _, port = device['serial'].rpartition(':')
        if IPV4.match(host) and port.isdigit():
            table[host] = device
    return {'ready': True, 'message': 'adb ready', 'devices': table}


def app_version(ctx, serial):
    """The installed oshal TV app's versionCode on an authorized TV, or None when it is not there."""
    try:
        _, out, _ = ctx.adb_shell(serial, f'dumpsys package {APP_PACKAGE} | grep -m1 versionCode', 10)
    except ctx.Refusal:
        return None
    match = re.search(r'versionCode=(\d+)', out)
    return int(match.group(1)) if match else None


def adb_entry(ctx, address, ports, adb):
    """The adb standing of one address, read-only."""
    device = adb['devices'].get(address)
    if device and device['state'] == 'device':
        return {'state': 'device', 'serial': device['serial'], 'appVersionCode': app_version(ctx, device['serial']),
                'model': clip(device.get('model'), 60)}
    if device:
        return {'state': device['state'], 'serial': device['serial']}
    if ADB_PORT in ports:
        return {'state': 'not-connected', 'serial': f'{address}:{ADB_PORT}'}
    return {'state': 'off'}


def classify(ports, facts):
    """The kind of TV an address is, from what it said about itself and its ports; None when it is not a TV.
    An open port alone never makes a Samsung or a Roku: another computer may serve on 8001 or 8060."""
    ports, hints = set(ports), facts.get('hints') or set()
    if facts.get('samsung') or (SAMSUNG_WSS_PORT in ports and 'samsung' in hints):
        return 'samsung-tizen'
    if facts.get('roku') or (ROKU_PORT in ports and 'roku' in hints):
        return 'roku'
    if ADB_PORT in ports or ANDROID_REMOTE_PORT in ports or facts.get('adbKnown'):
        return 'android-tv'
    cast = facts.get('cast') or {}
    if cast and (cast.get('display') is True or re.search(r'tv|chromecast', cast.get('model', ''), re.I)):
        return 'cast'
    return None


def android_steps(entry, hints):
    """What the person does on an Android TV whose adb this computer cannot use yet, in words."""
    state = (entry.get('adb') or {}).get('state')
    if state == 'device':
        return None
    if state == 'unauthorized':
        return ALLOW_STEPS
    if state == 'not-connected':
        return CONNECT_STEPS
    fire = 'fire' in hints or re.search(r'^AFT|fire', entry.get('model') or entry.get('name') or '', re.I)
    return FIRE_TV_STEPS if fire else GOOGLE_TV_STEPS


def fingerprint(ctx, address, seen, ports, adb):
    """Read what one address says about itself (read-only) and describe it, or None when it is not a TV."""
    facts = {'hints': ssdp_hints(seen.get('ssdp', []))}
    if SAMSUNG_REST_PORT in ports or 'samsung' in facts['hints']:
        facts['samsung'] = parse_samsung(*http_get(address, SAMSUNG_REST_PORT, '/api/v2/'))
    if ROKU_PORT in ports:
        facts['roku'] = parse_roku(*http_get(address, ROKU_PORT, '/query/device-info'))
    if CAST_PORT in ports and not facts.get('samsung') and not facts.get('roku'):
        facts['cast'] = parse_cast(*http_get(address, CAST_PORT, '/setup/eureka_info?params=name,device_info'))
    facts['adbKnown'] = address in adb['devices']
    kind = classify(ports, facts)
    if not kind:
        return None
    return describe(ctx, address, kind, seen, ports, facts, adb)


def describe(ctx, address, kind, seen, ports, facts, adb):
    """One found TV as the answer carries it: compact, bounded, no raw replies."""
    info = facts.get('samsung') or facts.get('roku') or facts.get('cast') or {}
    entry = {'address': address, 'kind': kind, 'name': info.get('name') or '', 'model': info.get('model') or '',
             'os': info.get('os') or '', 'room': info.get('room') or '', 'power': info.get('power'),
             'mac': seen.get('mac') or info.get('mac') or '', 'ports': sorted(ports),
             'via': sorted(seen.get('via', [])), 'controllable': kind in KINDS, 'steps': None}
    if kind == 'android-tv':
        entry['adb'] = adb_entry(ctx, address, ports, adb)
        entry['model'] = entry['model'] or entry['adb'].get('model', '')
        entry['steps'] = android_steps(entry, facts['hints'])
    if kind == 'samsung-tizen':
        entry['samsung'] = {'tokenAuth': bool(info.get('tokenAuth')), 'tokenSaved': bool(read_token(entry['mac'], address))}
    if not entry['name']:
        entry['name'] = {'samsung-tizen': 'Samsung TV', 'roku': 'Roku', 'android-tv': entry['model'] or 'Android TV',
                         'cast': 'Google Cast device'}[kind]
    return entry


def collect(ctx, interfaces, subnets, wake):
    """Every candidate address on the home networks: neighbors, SSDP and avahi answers, and saved TVs to wake.
    This computer's own addresses are never candidates."""
    seen, own = {}, {address for _, address, _ in interfaces}

    def add(address, via, mac=''):
        if address not in own and in_subnets(address, subnets):
            item = seen.setdefault(address, {'mac': '', 'via': set(), 'ssdp': []})
            item['via'].add(via)
            item['mac'] = item['mac'] or mac
            return item
        return None

    for address, row in neighbors(ctx, interfaces).items():
        add(address, 'neighbors', row['mac'])
    with ThreadPoolExecutor(max_workers=4) as pool:
        ssdp = pool.submit(ssdp_search, 1.0)
        avahi = [pool.submit(avahi_browse, kind) for kind in AVAHI_TYPES]
        for address, answers in ssdp.result().items():
            item = add(address, 'ssdp')
            if item is not None:
                item['ssdp'].extend(answers[:4])
        for job in avahi:
            for address in job.result():
                add(address, 'mdns')
    for item in wake:
        if item['address']:
            add(item['address'], 'saved', item['mac'])
    return seen


def bounded(answer, max_out):
    """The answer with as many found TVs as fit in one bridge line."""
    while answer['found'] and len(json.dumps(answer, separators=(',', ':'))) > max_out - 400:
        answer['found'].pop()
        answer['truncated'] = True
    return answer


def verb_lan_discover(ctx, args):
    """lan-discover: find TVs and streaming sticks on this computer's home network, read-only."""
    wake = need_wake_list(ctx, args.get('wake'))
    started = time.monotonic()
    interfaces = lan_interfaces(ctx)
    if not interfaces:
        raise ctx.Refusal('no_home_network', 'This computer is not on a home network (no Wi-Fi or Ethernet address '
                          'in 10.x, 172.16-31.x or 192.168.x), so it cannot look for TVs.')
    subnets = sorted({subnet_of(address, prefix) for _, address, prefix in interfaces})
    woke = send_wake([item['mac'] for item in wake], broadcasts(subnets)) if wake else []
    if woke:
        time.sleep(WAKE_SETTLE_S)
    seen = collect(ctx, interfaces, subnets, wake)
    ports = probe_all(sorted(seen))
    adb = adb_snapshot(ctx)
    candidates = [address for address in sorted(seen, key=ipv4_int)
                  if TV_PORTS & set(ports.get(address, [])) or address in adb['devices']
                  or ssdp_hints(seen[address]['ssdp']) & {'roku', 'samsung'}]
    with ThreadPoolExecutor(max_workers=8) as pool:
        found = list(pool.map(lambda a: fingerprint(ctx, a, seen[a], ports.get(a, []), adb), candidates))
    found = [entry for entry in found if entry][:MAX_FOUND]
    return bounded({'found': found, 'woke': woke, 'subnets': [subnet_text(s) for s in subnets],
                    'looked': len(seen), 'adb': {'ready': adb['ready'], 'message': adb['message']},
                    'tookMs': int((time.monotonic() - started) * 1000)}, ctx.MAX_OUT)


def state_dir():
    """This computer's own folder for TV pairings: kept across restarts, readable by this account only."""
    return os.environ.get('OSHAL_PHONE_BRIDGE_STATE') or os.path.join(os.path.expanduser('~'), '.local', 'state',
                                                                      'oshal-phone-bridge')


def tokens_path():
    return os.path.join(state_dir(), 'samsung-tokens.json')


def read_tokens():
    try:
        with open(tokens_path()) as handle:
            doc = json.load(handle)
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def read_token(mac, address):
    """The saved Samsung pairing token of one TV, by its MAC first and its address second."""
    tokens = read_tokens()
    for key in (mac, address):
        token = str((tokens.get(key) or {}).get('token') or '') if key else ''
        if TOKEN.match(token):
            return token
    return ''


def save_token(mac, address, token):
    """Keep a TV's pairing token on this computer only, in a file this account alone can read."""
    folder = state_dir()
    os.makedirs(folder, mode=0o700, exist_ok=True)
    if os.stat(folder).st_uid != os.getuid():
        return False
    os.chmod(folder, 0o700)
    tokens = read_tokens()
    tokens[mac or address] = {'token': token, 'address': address, 'savedAt': int(time.time())}
    temp = tokens_path() + '.new'
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(tokens, handle)
    os.chmod(temp, 0o600)
    os.replace(temp, tokens_path())
    return True


def forget_tokens():
    """Remove every saved TV pairing (the bridge's uninstall)."""
    try:
        os.remove(tokens_path())
        return True
    except OSError:
        return False


class Channel:
    """One WebSocket connection to a TV: its socket and the bytes read past the last frame."""

    def __init__(self, sock):
        self.sock, self.buffer = sock, b''

    def fill(self, need, deadline):
        """Read until `need` bytes are buffered; False when the deadline passes or the TV closes."""
        while len(self.buffer) < need:
            left = deadline - time.monotonic()
            if left <= 0:
                return False
            self.sock.settimeout(min(left, 1.0))
            try:
                part = self.sock.recv(65536)
            except (socket.timeout, ssl.SSLWantReadError):
                continue
            except OSError:
                return False
            if not part:
                return False
            self.buffer += part
        return True

    def take(self, size):
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data


def ws_frame(opcode, payload):
    """One masked client frame (RFC 6455)."""
    size = len(payload)
    head = bytes([0x80 | opcode])
    if size < 126:
        head += bytes([0x80 | size])
    elif size < 65536:
        head += bytes([0x80 | 126]) + struct.pack('!H', size)
    else:
        head += bytes([0x80 | 127]) + struct.pack('!Q', size)
    mask = os.urandom(4)
    return head + mask + bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))


def ws_read_frame(ctx, channel, deadline):
    """(fin, opcode, payload) of the next frame, or None at the deadline or when the TV closed."""
    if not channel.fill(2, deadline):
        return None
    first, second = channel.buffer[0], channel.buffer[1]
    size, offset = second & 0x7F, 2
    if size == 126:
        if not channel.fill(4, deadline):
            return None
        size, offset = struct.unpack('!H', channel.buffer[2:4])[0], 4
    elif size == 127:
        if not channel.fill(10, deadline):
            return None
        size, offset = struct.unpack('!Q', channel.buffer[2:10])[0], 10
    if size > HTTP_LIMIT:
        raise ctx.Refusal('tv_failed', 'The TV sent a message too large to read.')
    masked = 4 if second & 0x80 else 0
    if not channel.fill(offset + masked + size, deadline):
        return None
    frame = channel.take(offset + masked + size)
    payload = frame[offset + masked:]
    if masked:
        key = frame[offset:offset + 4]
        payload = bytes(byte ^ key[index % 4] for index, byte in enumerate(payload))
    return bool(first & 0x80), first & 0x0F, payload


def ws_next_json(ctx, channel, deadline):
    """The next text message as JSON (pings answered, other frames skipped), or None at the deadline or close."""
    parts = []
    while True:
        frame = ws_read_frame(ctx, channel, deadline)
        if frame is None:
            return None
        fin, opcode, payload = frame
        if opcode == 0x8:
            return None
        if opcode == 0x9:
            channel.sock.sendall(ws_frame(0xA, payload))
            continue
        if opcode in (0x1, 0x0):
            parts.append(payload)
            if not fin:
                continue
            try:
                message = json.loads(b''.join(parts).decode('utf-8', 'replace'))
            except ValueError:
                message = None
            parts = []
            if isinstance(message, dict):
                return message


def ws_send_json(channel, message):
    channel.sock.sendall(ws_frame(0x1, json.dumps(message, separators=(',', ':')).encode('utf-8')))


def ws_close(channel):
    """Say goodbye to the TV and close the connection."""
    try:
        channel.sock.sendall(ws_frame(0x8, struct.pack('!H', 1000)))
    except OSError:
        pass
    try:
        channel.sock.close()
    except OSError:
        pass


def tls_context():
    """TLS for a TV on the home network: its certificate is self-signed by the maker, so it is not checked."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def ws_handshake(ctx, channel, host, path):
    """The WebSocket upgrade; refusals in words when the TV says no."""
    key = base64.b64encode(os.urandom(16)).decode('ascii')
    channel.sock.sendall((f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                          f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode('ascii'))
    deadline = time.monotonic() + 5
    while b'\r\n\r\n' not in channel.buffer:
        if len(channel.buffer) > 8192 or not channel.fill(len(channel.buffer) + 1, deadline):
            raise ctx.Refusal('tv_not_answering', 'The TV did not open its remote channel.')
    head = channel.take(channel.buffer.index(b'\r\n\r\n') + 4).decode('latin-1')
    lines = head.split('\r\n')
    if not re.match(r'^HTTP/1\.[01] 101\b', lines[0]):
        raise ctx.Refusal('samsung_refused', 'The TV refused its remote channel (' + clip(lines[0], 60) + '). On the TV '
                          'check Settings, General, External Device Manager, Device Connection Manager.')
    headers = {name.strip().lower(): value.strip() for name, _, value in (line.partition(':') for line in lines[1:])}
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode('ascii')).digest()).decode('ascii')
    if headers.get('sec-websocket-accept') != accept:
        raise ctx.Refusal('tv_failed', 'The TV answered the remote channel with a bad handshake.')


def samsung_path(token):
    name = base64.b64encode(CLIENT_NAME.encode('utf-8')).decode('ascii').replace('=', '%3D')
    return '/api/v2/channels/samsung.remote.control?name=' + name + (f'&token={token}' if token else '')


def samsung_open(ctx, address, token):
    """The TLS WebSocket to a Samsung TV's remote channel."""
    try:
        raw = socket.create_connection((address, SAMSUNG_WSS_PORT), timeout=4)
    except OSError:
        raise ctx.Refusal('tv_not_answering', f'The TV at {address} did not answer its remote channel. Turn it on or '
                          'press Wake first.')
    try:
        sock = tls_context().wrap_socket(raw)
    except (ssl.SSLError, OSError) as err:
        raw.close()
        raise ctx.Refusal('tv_failed', f'The TV refused a secure remote connection: {clip(err, 120)}.')
    channel = Channel(sock)
    try:
        ws_handshake(ctx, channel, f'{address}:{SAMSUNG_WSS_PORT}', samsung_path(token))
    except BaseException:
        ws_close(channel)
        raise
    return channel


def samsung_wait_connect(ctx, channel, deadline):
    """The TV's connect event (its data), None while it still asks the person, or a refusal when they said no."""
    while True:
        message = ws_next_json(ctx, channel, deadline)
        if message is None:
            return None
        event = message.get('event')
        if event == 'ms.channel.connect':
            return message.get('data') if isinstance(message.get('data'), dict) else {}
        if event == 'ms.channel.unauthorized':
            raise ctx.Refusal('samsung_refused', 'The TV refused oshal. On the TV open Settings, General, External '
                              'Device Manager, Device Connection Manager, Device List, remove oshal, then press Pair.')
        if event == 'ms.channel.timeOut':
            raise ctx.Refusal('samsung_allow_on_tv', 'Press Allow on the TV, then Retry.')


def samsung_session(ctx, address, mac, wait=None):
    """An allowed remote channel to a Samsung TV; the token it hands out is kept on this computer only."""
    token = read_token(mac, address)
    channel = samsung_open(ctx, address, token)
    limit = wait or (CONNECT_WAIT_S if token else ALLOW_WAIT_S)
    try:
        data = samsung_wait_connect(ctx, channel, time.monotonic() + limit)
    except BaseException:
        ws_close(channel)
        raise
    if data is None:
        ws_close(channel)
        raise ctx.Refusal('samsung_allow_on_tv', 'The TV is asking whether to allow oshal. Press Allow on the TV '
                          'with its remote, then press Retry.')
    fresh = str(data.get('token') or '')
    saved = bool(TOKEN.match(fresh)) and fresh != token and save_token(mac, address, fresh)
    return channel, bool(token) or saved


def samsung_key(channel, key):
    """Press one remote key on the TV, then give it a moment to act before the channel closes."""
    ws_send_json(channel, {'method': 'ms.remote.control', 'params': {
        'Cmd': 'Click', 'DataOfCmd': key, 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'}})
    time.sleep(0.4)


def samsung_launch(ctx, channel, url):
    """Open an https page in the TV's own browser."""
    ws_send_json(channel, {'method': 'ms.channel.emit', 'params': {'event': 'ed.apps.launch', 'to': 'host', 'data': {
        'appId': 'org.tizen.browser', 'action_type': 'NATIVE_LAUNCH', 'metaTag': url}}})
    deadline = time.monotonic() + 3
    while True:
        message = ws_next_json(ctx, channel, deadline)
        if message is None:
            return {'opened': 'org.tizen.browser', 'confirmed': False, 'url': url}
        if message.get('event') == 'ed.apps.launch':
            if str(message.get('data')) == '404':
                raise ctx.Refusal('no_browser', 'This TV has no browser that oshal can open.')
            return {'opened': 'org.tizen.browser', 'confirmed': True, 'url': url}


def samsung_power(address, seconds=0.0):
    """'on', 'off' (standby) or None when the TV's own status page does not answer within `seconds`."""
    end = time.monotonic() + seconds
    while True:
        info = parse_samsung(*http_get(address, SAMSUNG_REST_PORT, '/api/v2/', 1.5))
        if info or time.monotonic() >= end:
            return info['power'] if info else None
        time.sleep(0.5)


def lan_subnets(ctx):
    return sorted({subnet_of(address, prefix) for _, address, prefix in lan_interfaces(ctx)})


def wake_and_wait(ctx, address, mac, port, seconds=8.0):
    """Send Wake-on-LAN to the named MAC and wait for the TV's control port; (woke, answering)."""
    if port_open(address, port, 0.5):
        return False, True
    if not mac:
        return False, False
    send_wake([mac], broadcasts(lan_subnets(ctx)))
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if port_open(address, port, 0.5):
            return True, True
        time.sleep(0.5)
    return True, False


def not_answering(ctx, address, woke):
    note = (' A Wake-on-LAN packet was sent.' if woke else ' Save the TV with its hardware address to wake it.')
    return ctx.Refusal('tv_not_answering', f'The TV at {address} did not answer.{note} If it is fully off, turn it on '
                       'with its remote once; some TVs also need "Power on with mobile" or network standby turned on.')


def samsung_wake(ctx, address, mac):
    """Wake a Samsung TV: Wake-on-LAN, then the power key when it answers in standby."""
    woke, _ = wake_and_wait(ctx, address, mac, SAMSUNG_REST_PORT)
    power = samsung_power(address, 6.0 if woke else 0.0)
    if power is None:
        raise not_answering(ctx, address, woke)
    if power == 'on':
        return {'power': 'on', 'woke': woke}
    channel, _ = samsung_session(ctx, address, mac)
    try:
        samsung_key(channel, 'KEY_POWER')
    finally:
        ws_close(channel)
    return {'power': 'on', 'woke': woke, 'key': 'KEY_POWER'}


def samsung_control(ctx, address, action, mac, url):
    """One action on a Samsung Tizen TV over its remote channel."""
    if action == 'wake':
        return samsung_wake(ctx, address, mac)
    if action == 'off' and samsung_power(address) == 'off':
        return {'power': 'off', 'already': True}
    channel, paired = samsung_session(ctx, address, mac, PAIR_WAIT_S if action == 'pair' else None)
    try:
        if action == 'pair':
            return {'paired': True, 'tokenSaved': paired}
        if action == 'launch_url':
            return samsung_launch(ctx, channel, url)
        samsung_key(channel, SAMSUNG_KEYS[action])
    finally:
        ws_close(channel)
    return dict({'key': SAMSUNG_KEYS[action]}, **({'power': 'off'} if action == 'off' else {}))


def roku_keypress(ctx, address, key):
    """One ECP keypress on a Roku."""
    conn = http.client.HTTPConnection(address, ROKU_PORT, timeout=3)
    try:
        conn.request('POST', '/keypress/' + key, body=b'', headers={'Content-Length': '0'})
        response = conn.getresponse()
        response.read(1024)
        status = response.status
    except (OSError, http.client.HTTPException):
        raise ctx.Refusal('tv_not_answering', f'The Roku at {address} did not answer. Check it is on and on this Wi-Fi.')
    finally:
        conn.close()
    if status == 403:
        raise ctx.Refusal('roku_control_off', 'This Roku does not take commands from the network. On the Roku open '
                          'Settings, System, Advanced system settings, Control by mobile apps, and set Network access '
                          'to Default.')
    if status != 200:
        raise ctx.Refusal('roku_failed', f'The Roku answered HTTP {status} to {key}.')


def roku_control(ctx, address, action, mac, url):
    """One action on a Roku over ECP."""
    woke = False
    if action == 'wake':
        woke, answering = wake_and_wait(ctx, address, mac, ROKU_PORT)
        if not answering:
            raise not_answering(ctx, address, woke)
    roku_keypress(ctx, address, ROKU_KEYS[action])
    result = {'key': ROKU_KEYS[action], 'woke': woke}
    if action in ('wake', 'off'):
        result['power'] = 'on' if action == 'wake' else 'off'
    return result


def android_connect(ctx, address):
    """The TV's adb serial, connecting this computer when needed (the TV asks Allow the first time)."""
    serial = f'{address}:{ADB_PORT}'
    if any(d['serial'] == serial and d['state'] == 'device' for d in ctx.list_devices()[0]):
        return serial
    reply = ctx.verb_adb_connect_tv({'address': serial})
    return reply.get('serial') or serial


def android_shell(ctx, serial, command, timeout=20):
    code, out, err = ctx.adb_shell(serial, command, timeout)
    if code:
        raise ctx.adb_refusal(err or out)
    return out


def android_open_app(ctx, serial):
    """Open the oshal TV app when it is installed."""
    if f'package:{APP_PACKAGE}' not in android_shell(ctx, serial, f'pm list packages {APP_PACKAGE}').split():
        raise ctx.Refusal('app_not_installed', 'The oshal TV app is not on this TV yet. Press Install the TV app first.')
    for category in ('LEANBACK_LAUNCHER', 'LAUNCHER'):
        _, out, _ = ctx.adb_shell(serial, f'monkey -p {APP_PACKAGE} -c android.intent.category.{category} 1', 25)
        if 'Events injected: 1' in out:
            return {'opened': APP_PACKAGE}
    raise ctx.Refusal('app_failed', 'The oshal TV app did not open on this TV.')


def android_control(ctx, address, action, mac, url):
    """One action on an Android TV through this computer's adb."""
    woke = False
    if action == 'wake':
        woke, answering = wake_and_wait(ctx, address, mac, ADB_PORT)
        if not answering:
            raise not_answering(ctx, address, woke)
    serial = android_connect(ctx, address)
    if action == 'pair':
        return {'paired': True, 'serial': serial}
    if action == 'open_app':
        return dict(android_open_app(ctx, serial), serial=serial)
    if action == 'launch_url':
        out = android_shell(ctx, serial, 'am start -a android.intent.action.VIEW -d ' + ctx.device_quote(url))
        if 'Error' in out:
            raise ctx.Refusal('no_browser', 'This TV has no app that opens web pages. Use Open the oshal app instead.')
        return {'serial': serial, 'opened': 'browser', 'url': url}
    android_shell(ctx, serial, f'input keyevent {ANDROID_KEYCODES[action]}')
    result = {'serial': serial, 'key': ANDROID_KEYCODES[action], 'woke': woke}
    if action in ('wake', 'off'):
        result['power'] = 'on' if action == 'wake' else 'off'
    return result


CONTROLLERS = {'android-tv': android_control, 'samsung-tizen': samsung_control, 'roku': roku_control}


def verb_lan_control(ctx, args):
    """lan-control: one closed action on one TV at a private address on this computer's home network."""
    kind = need_kind(ctx, args.get('kind'))
    address = need_lan_address(ctx, args.get('address'))
    action = need_action(ctx, kind, args.get('action'))
    mac = need_mac(ctx, args.get('mac')) if args.get('mac') not in (None, '') else ''
    url = need_url(ctx, args.get('url')) if action == 'launch_url' else ''
    started = time.monotonic()
    result = CONTROLLERS[kind](ctx, address, action, mac, url)
    return dict({'kind': kind, 'address': address, 'action': action, 'sent': True,
                 'tookMs': int((time.monotonic() - started) * 1000)}, **result)
