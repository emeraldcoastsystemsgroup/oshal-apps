#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.5.0: the bridge's TV module (bridge/oshal_phone_lan.py) against local protocol fakes, never a real TV: argument checks and refusals (a public address is refused), the Wake-on-LAN packet bytes received on a local UDP socket, the neighbor-table, interface, SSDP, Samsung, Roku and Cast parsers, an SSDP responder, a fake Roku ECP server that records each keypress, a fake Samsung TV speaking TLS WebSocket (self-signed certificate made with openssl) for the Allow prompt, the pairing token saved 0600 on this computer, key presses and the browser launch, and the whole discovery with two fake TVs: nothing installed, no adb connect, Wake-on-LAN only to the MACs named. Run by tests/phone-control-lan.test.mjs in store-ci.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0 (T45 part 3): launch_url wakes the TV and opens the link with am start -W; with an app it opens in that streaming app only on its own site and only when installed.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.8.0 (T45 part 4): now_playing names the app, the title, its state and that it is behind the home screen, reading only; pause, play, next, previous and stop send their media key and answer what the sessions say after; nothing played yet and a Roku or Samsung TV are refused in words.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0 (T45 part 2): a Marquee page opens in the oshal TV app as oshal://open?path=...; any other address, an app older than 0.8.6 and a missing app are refused in words.
# 5 | maintainer@emeraldcoastsystemsgroup.com | OK is KEYCODE_ENTER (66) on an Android TV.
"""Unit and protocol-fake tests for oshal_phone_lan.py (stdlib unittest)."""

import base64, hashlib, http.server, json, os, shutil, socket, ssl, stat, struct, subprocess, sys, tempfile
import threading, time, unittest
from types import SimpleNamespace
from unittest import mock

BRIDGE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'bridge')
sys.path.insert(0, BRIDGE)
sys.dont_write_bytecode = True
import oshal_phone_bridge as bridge  # noqa: E402
import oshal_phone_lan as lan  # noqa: E402
import oshal_phone_links as links  # noqa: E402

MAC_A = '02:00:5e:10:20:30'
MAC_B = '02:00:5e:40:50:60'
SAMSUNG_DOC = {'device': {'name': 'Den TV', 'modelName': 'QN00TEST', 'OS': 'Tizen', 'PowerState': 'on',
                          'TokenAuthSupport': 'true', 'wifiMac': MAC_A, 'duid': 'uuid:test-duid'},
               'name': 'Den TV', 'version': '2.0.25'}
ROKU_XML = (b'<?xml version="1.0" encoding="UTF-8" ?><device-info><model-name>Roku Test Stick</model-name>'
            b'<friendly-device-name>Guest room stick</friendly-device-name><user-device-location>Guest room'
            b'</user-device-location><wifi-mac>' + MAC_B.encode() + b'</wifi-mac><is-tv>false</is-tv>'
            b'<power-mode>PowerOn</power-mode><software-version>15.0.0</software-version></device-info>')


def context(**overrides):
    """The bridge's own context, with the named helpers replaced."""
    return SimpleNamespace(**dict(vars(bridge.MIRROR_CTX), **overrides))


def free_port(host='127.0.0.1'):
    with socket.socket() as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


class Recorder(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, routes):
        self.routes, self.seen = routes, []
        super().__init__(address, Handler)


class Handler(http.server.BaseHTTPRequestHandler):
    def answer(self):
        self.server.seen.append((self.command, self.path))
        status, body = self.server.routes.get((self.command, self.path.split('?')[0]), (404, b''))
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = answer

    def log_message(self, *args):
        pass


def serve(host, routes):
    server = Recorder((host, 0), routes)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class FakeSamsung(threading.Thread):
    """A Samsung TV's remote channel: TLS, the WebSocket upgrade, then the events a test asks for."""

    def __init__(self, cert, key, events):
        super().__init__(daemon=True)
        self.events, self.paths, self.messages = events, [], []
        self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.tls.load_cert_chain(cert, key)
        self.sock = socket.socket()
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen(4)
        self.sock.settimeout(0.2)
        self.port, self.stopped = self.sock.getsockname()[1], False

    def run(self):
        while not self.stopped:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                continue
            try:
                self.serve(self.tls.wrap_socket(conn, server_side=True))
            except (OSError, ssl.SSLError):
                pass

    def serve(self, conn):
        conn.settimeout(5)
        head = b''
        while b'\r\n\r\n' not in head:
            head += conn.recv(1)
        lines = head.decode().split('\r\n')
        self.paths.append(lines[0].split()[1])
        key = next(line.split(':', 1)[1].strip() for line in lines if line.lower().startswith('sec-websocket-key'))
        accept = base64.b64encode(hashlib.sha1((key + lan.WS_GUID).encode()).digest()).decode()
        conn.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode())
        for event in self.events(lines[0]):
            conn.sendall(server_frame(json.dumps(event).encode()))
        self.read_client(conn)
        conn.close()

    def read_client(self, conn):
        buffer = b''
        while True:
            try:
                part = conn.recv(65536)
            except (socket.timeout, OSError):
                return
            if not part:
                return
            buffer += part
            while True:
                frame = client_frame(buffer)
                if frame is None:
                    break
                opcode, data, buffer = frame
                if opcode == 8:
                    return
                message = json.loads(data)
                self.messages.append(message)
                if message.get('method') == 'ms.channel.emit':
                    conn.sendall(server_frame(json.dumps({'event': 'ed.apps.launch', 'data': 200}).encode()))

    def stop(self):
        self.stopped = True
        self.sock.close()


def client_frame(buffer):
    """(opcode, unmasked payload, rest) of one masked client frame, or None until it has all arrived."""
    if len(buffer) < 2:
        return None
    size, offset = buffer[1] & 0x7F, 2
    if size == 126:
        if len(buffer) < 4:
            return None
        size, offset = struct.unpack('!H', buffer[2:4])[0], 4
    if len(buffer) < offset + 4 + size:
        return None
    mask, payload = buffer[offset:offset + 4], buffer[offset + 4:offset + 4 + size]
    return buffer[0] & 0x0F, bytes(b ^ mask[i % 4] for i, b in enumerate(payload)), buffer[offset + 4 + size:]


def server_frame(payload):
    return bytes([0x81, len(payload)]) + payload if len(payload) < 126 else (
        bytes([0x81, 126]) + struct.pack('!H', len(payload)) + payload)


class Arguments(unittest.TestCase):
    ctx = context()

    def refused(self, code, fn, *args):
        with self.assertRaises(bridge.Refusal) as caught:
            fn(*args)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception.message

    def test_private_addresses_only(self):
        for address in ('10.0.0.5', '172.16.0.9', '172.31.255.1', '192.168.7.20'):
            self.assertEqual(lan.need_lan_address(self.ctx, address), address)
        for address in ('8.8.8.8', '192.0.2.5', '198.51.100.7', '172.32.0.1', '100.64.0.1', '127.0.0.1'):
            self.assertIn('is not an address on a home network', self.refused('public_address', lan.need_lan_address,
                                                                              self.ctx, address))
        for address in ('', 'tv.local', '300.1.1.1', '10.20.30.5:8002', '192.168.1'):
            self.refused('bad_address', lan.need_lan_address, self.ctx, address)

    def test_a_public_address_is_refused_by_the_installed_verb(self):
        args = base64.b64encode(json.dumps({'kind': 'roku', 'address': '203.0.113.9', 'action': 'home'}).encode())
        done = subprocess.run([sys.executable, '-I', '-B', os.path.join(BRIDGE, 'oshal_phone_bridge.py'), 'lan-control',
                               '--b64', args.decode()], capture_output=True, text=True, timeout=30)
        lines = done.stdout.strip().split('\n')
        self.assertEqual(len(lines), 1)
        reply = json.loads(lines[0])
        self.assertEqual((reply['ok'], reply['error'], done.returncode), (False, 'public_address', 3))

    def test_closed_actions_and_kinds(self):
        self.assertIn('action is one of', self.refused('bad_action', lan.need_action, self.ctx, 'roku', 'reboot'))
        self.assertIn('cannot open a web page', self.refused('roku_cannot_open_pages', lan.need_action, self.ctx,
                                                              'roku', 'launch_url'))
        self.refused('not_needed', lan.need_action, self.ctx, 'roku', 'pair')
        self.refused('not_android', lan.need_action, self.ctx, 'samsung-tizen', 'open_app')
        self.refused('bad_kind', lan.need_kind, self.ctx, 'lg-webos')
        self.assertEqual(lan.need_action(self.ctx, 'android-tv', 'OPEN_APP'), 'open_app')
        self.assertEqual(lan.need_action(self.ctx, 'samsung-tizen', 'pair'), 'pair')

    def test_urls_macs_and_wake_lists(self):
        self.assertEqual(lan.need_url(self.ctx, 'https://home.test/nexus?a=1'), 'https://home.test/nexus?a=1')
        for url in ('http://home.test/', 'https://home.test/' + 'a' * 260, "https://home.test/'x", 'https://a b/',
                    'javascript:alert(1)'):
            self.refused('bad_url', lan.need_url, self.ctx, url)
        self.assertEqual(lan.need_mac(self.ctx, '02-00-5E-10-20-30'), MAC_A)
        for mac in ('01:00:5e:00:00:01', 'ff:ff:ff:ff:ff:ff', '00:00:00:00:00:00', '02:00:5e:10:20', 'zz:00:5e:10:20:30'):
            self.refused('bad_mac', lan.need_mac, self.ctx, mac)
        self.assertEqual(lan.need_wake_list(self.ctx, [MAC_A, {'mac': MAC_B, 'address': '10.20.30.9'}]),
                         [{'mac': MAC_A, 'address': ''}, {'mac': MAC_B, 'address': '10.20.30.9'}])
        self.assertEqual(lan.need_wake_list(self.ctx, [{'mac': MAC_B, 'address': '8.8.8.8'}])[0]['address'], '')
        self.refused('bad_argument', lan.need_wake_list, self.ctx, [MAC_A] * 9)


class WakeOnLan(unittest.TestCase):
    def test_magic_packet_bytes_reach_the_network(self):
        packet = lan.magic_packet(MAC_A)
        raw = bytes.fromhex(MAC_A.replace(':', ''))
        self.assertEqual(len(packet), 102)
        self.assertEqual(packet, b'\xff' * 6 + raw * 16)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver:
            receiver.bind(('127.0.0.1', 0))
            receiver.settimeout(2)
            sent = lan.send_wake([MAC_A], ['127.0.0.1'], ports=(receiver.getsockname()[1],))
            data, _ = receiver.recvfrom(1024)
        self.assertEqual((sent, data), ([MAC_A], packet))

    def test_broadcast_targets(self):
        subnets = [lan.subnet_of('10.20.30.20', 24), lan.subnet_of('10.4.0.2', 16)]
        self.assertEqual(lan.broadcasts(subnets), ['10.20.30.255', '10.4.255.255', '255.255.255.255'])
        self.assertTrue(lan.in_subnets('10.20.30.200', subnets))
        self.assertFalse(lan.in_subnets('192.168.2.200', subnets))
        self.assertEqual(lan.subnet_text(subnets[0]), '10.20.30.0/24')


class Parsers(unittest.TestCase):
    def test_interfaces_skip_containers_tunnels_and_public(self):
        text = '\n'.join([
            '1: lo    inet 127.0.0.1/8 scope host lo',
            '2: wlp1s0    inet 10.20.30.20/24 brd 10.20.30.255 scope global wlp1s0',
            '3: docker0    inet 172.17.0.1/16 scope global docker0',
            '4: br-0123abcd    inet 192.168.48.1/20 scope global br-0123abcd',
            '5: tailscale0    inet 100.101.1.2/32 scope global tailscale0',
            '6: veth9@if5    inet 10.0.0.9/24 scope global veth9',
            '7: enp2s0    inet 203.0.113.4/24 scope global enp2s0',
            '8: eth1@if9    inet 10.20.0.4/16 scope global eth1'])
        self.assertEqual(lan.parse_interfaces(text), [('wlp1s0', '10.20.30.20', 24), ('eth1', '10.20.0.4', 16)])

    def test_neighbors_on_home_interfaces_only(self):
        text = '\n'.join([
            f'10.20.30.30 dev wlp1s0 lladdr {MAC_A.upper()} REACHABLE',
            f'10.20.30.31 dev wlp1s0 lladdr {MAC_B} STALE',
            '10.20.30.32 dev wlp1s0 FAILED',
            '10.20.30.33 dev wlp1s0 INCOMPLETE',
            '172.17.0.2 dev docker0 lladdr 02:42:ac:11:00:02 REACHABLE',
            '203.0.113.1 dev wlp1s0 lladdr 02:00:5e:00:00:09 REACHABLE'])
        self.assertEqual(lan.parse_neighbors(text, {'wlp1s0'}), {
            '10.20.30.30': {'mac': MAC_A, 'interface': 'wlp1s0'},
            '10.20.30.31': {'mac': MAC_B, 'interface': 'wlp1s0'}})

    def test_ssdp_samsung_roku_and_cast_answers(self):
        roku = lan.parse_ssdp(b'HTTP/1.1 200 OK\r\nSERVER: Roku/15.0 UPnP/1.0\r\nST: roku:ecp\r\nUSN: uuid:roku:ecp:X\r\n\r\n')
        self.assertEqual((roku['server'], roku['st']), ('Roku/15.0 UPnP/1.0', 'roku:ecp'))
        self.assertIsNone(lan.parse_ssdp(b'M-SEARCH * HTTP/1.1\r\n\r\n'))
        self.assertEqual(lan.ssdp_hints([roku, {'server': 'Samsung Tizen'}]), {'roku', 'samsung'})
        samsung = lan.parse_samsung(200, json.dumps(dict(SAMSUNG_DOC, device=dict(SAMSUNG_DOC['device'],
                                                                                   PowerState='standby'))).encode())
        self.assertEqual((samsung['name'], samsung['model'], samsung['os'], samsung['mac'], samsung['power'],
                          samsung['tokenAuth']), ('Den TV', 'QN00TEST', 'Tizen', MAC_A, 'off', True))
        self.assertIsNone(lan.parse_samsung(404, b'{}'))
        self.assertIsNone(lan.parse_samsung(200, b'not json'))
        stick = lan.parse_roku(200, ROKU_XML)
        self.assertEqual((stick['name'], stick['model'], stick['room'], stick['mac'], stick['power'], stick['isTv']),
                         ('Guest room stick', 'Roku Test Stick', 'Guest room', MAC_B, 'on', False))
        self.assertIsNone(lan.parse_roku(200, b'<!DOCTYPE x [<!ENTITY a "b">]><device-info/>'))
        self.assertIsNone(lan.parse_roku(200, b'<other/>'))
        cast = lan.parse_cast(200, json.dumps({'name': 'Hall screen', 'device_info': {
            'model_name': 'Chromecast', 'capabilities': {'display_supported': True}}}).encode())
        self.assertEqual((cast['name'], cast['model'], cast['display']), ('Hall screen', 'Chromecast', True))

    def test_classification_needs_what_the_device_said(self):
        self.assertEqual(lan.classify([8001, 8002], {'samsung': {'name': 'x'}}), 'samsung-tizen')
        self.assertIsNone(lan.classify([8001], {}), 'an open 8001 alone is not a Samsung')
        self.assertEqual(lan.classify([8002], {'hints': {'samsung'}}), 'samsung-tizen')
        self.assertEqual(lan.classify([8060], {'roku': {'name': 'x'}}), 'roku')
        self.assertIsNone(lan.classify([8060], {}), 'an open 8060 alone is not a Roku')
        self.assertEqual(lan.classify([5555], {}), 'android-tv')
        self.assertEqual(lan.classify([6466, 8008, 8009], {}), 'android-tv')
        self.assertEqual(lan.classify([8008, 8009], {'cast': {'display': True, 'model': ''}}), 'cast')
        self.assertIsNone(lan.classify([8008, 8009], {'cast': {'display': False, 'model': 'Speaker'}}))
        self.assertIsNone(lan.classify([7000], {}))

    def test_steps_for_an_android_tv_this_computer_cannot_use_yet(self):
        self.assertEqual(lan.android_steps({'adb': {'state': 'off'}, 'model': 'AFTTEST'}, set()), lan.FIRE_TV_STEPS)
        self.assertEqual(lan.android_steps({'adb': {'state': 'off'}, 'model': ''}, set()), lan.GOOGLE_TV_STEPS)
        self.assertIn('Developer options', lan.GOOGLE_TV_STEPS)
        self.assertEqual(lan.android_steps({'adb': {'state': 'unauthorized'}}, set()), lan.ALLOW_STEPS)
        self.assertEqual(lan.android_steps({'adb': {'state': 'not-connected'}}, set()), lan.CONNECT_STEPS)
        self.assertIsNone(lan.android_steps({'adb': {'state': 'device'}}, set()))

    def test_an_answer_is_bounded_to_one_bridge_line(self):
        entry = {'address': '10.20.30.40', 'name': 'x' * 70, 'steps': lan.GOOGLE_TV_STEPS}
        answer = lan.bounded({'found': [dict(entry) for _ in range(80)]}, bridge.MAX_OUT)
        self.assertTrue(answer['truncated'])
        self.assertLess(len(json.dumps(answer)), bridge.MAX_OUT)


class Ssdp(unittest.TestCase):
    def test_a_device_that_answers_the_search_is_heard(self):
        responder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        responder.bind(('127.0.0.1', 0))
        responder.settimeout(2)

        def answer():
            data, source = responder.recvfrom(4096)
            if data.startswith(b'M-SEARCH * HTTP/1.1') and b'ssdp:discover' in data:
                responder.sendto(b'HTTP/1.1 200 OK\r\nSERVER: Roku/15.0 UPnP/1.0\r\nST: roku:ecp\r\n\r\n', source)

        thread = threading.Thread(target=answer, daemon=True)
        thread.start()
        answers = lan.ssdp_search(0.6, ('127.0.0.1', responder.getsockname()[1]))
        thread.join(2)
        responder.close()
        self.assertEqual(list(answers), ['127.0.0.1'])
        self.assertEqual(lan.ssdp_hints(answers['127.0.0.1']), {'roku'})


class Roku(unittest.TestCase):
    def setUp(self):
        self.server = serve('127.0.0.1', {('POST', f'/keypress/{key}'): (200, b'') for key in lan.ROKU_KEYS.values()})
        patches = [mock.patch.object(lan, 'ROKU_PORT', self.server.server_address[1]),
                   mock.patch.object(lan, 'need_lan_address', lambda ctx, value: value)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.server.shutdown)

    def control(self, action, **extra):
        return lan.verb_lan_control(context(), dict({'kind': 'roku', 'address': '127.0.0.1', 'action': action}, **extra))

    def test_each_press_is_one_ecp_keypress(self):
        reply = self.control('volume_down')
        self.assertEqual((reply['sent'], reply['key'], reply['action']), (True, 'VolumeDown', 'volume_down'))
        for action in ('up', 'select', 'home', 'back', 'mute', 'play_pause'):
            self.control(action)
        self.assertEqual([path for _, path in self.server.seen], ['/keypress/VolumeDown', '/keypress/Up',
                         '/keypress/Select', '/keypress/Home', '/keypress/Back', '/keypress/VolumeMute', '/keypress/Play'])
        self.assertTrue(all(method == 'POST' for method, _ in self.server.seen))

    def test_wake_and_off_report_power_only_from_an_answered_press(self):
        self.assertEqual(self.control('wake')['power'], 'on')
        self.assertEqual(self.control('off')['power'], 'off')
        self.assertNotIn('power', self.control('left'))

    def test_a_roku_that_refuses_network_control_is_said_in_words(self):
        self.server.routes[('POST', '/keypress/Home')] = (403, b'ECP command not allowed in limited mode')
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('home')
        self.assertEqual(caught.exception.code, 'roku_control_off')
        self.assertIn('Control by mobile apps', caught.exception.message)

    def test_a_roku_that_does_not_answer_is_said_in_words(self):
        with mock.patch.object(lan, 'ROKU_PORT', free_port()):
            with self.assertRaises(bridge.Refusal) as caught:
                self.control('home')
        self.assertEqual(caught.exception.code, 'tv_not_answering')


class Samsung(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('openssl'):
            raise AssertionError('openssl is needed to make the fake TV certificate')
        cls.folder = tempfile.mkdtemp(prefix='lan-tls-')
        cls.cert, cls.key = os.path.join(cls.folder, 'tv.pem'), os.path.join(cls.folder, 'tv.key')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cls.key, '-out', cls.cert,
                        '-days', '1', '-subj', '/CN=tv.test'], check=True, capture_output=True, timeout=60)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def setUp(self):
        self.state = tempfile.mkdtemp(prefix='lan-state-')
        self.addCleanup(shutil.rmtree, self.state, True)
        self.rest = serve('127.0.0.1', {('GET', '/api/v2/'): (200, json.dumps(SAMSUNG_DOC).encode())})
        self.addCleanup(self.rest.shutdown)
        self.allowed = True
        self.tv = FakeSamsung(self.cert, self.key, self.events)
        self.tv.start()
        self.addCleanup(self.tv.stop)
        for patch in [mock.patch.dict(os.environ, {'OSHAL_PHONE_BRIDGE_STATE': self.state}),
                      mock.patch.object(lan, 'SAMSUNG_WSS_PORT', self.tv.port),
                      mock.patch.object(lan, 'SAMSUNG_REST_PORT', self.rest.server_address[1]),
                      mock.patch.object(lan, 'need_lan_address', lambda ctx, value: value),
                      mock.patch.object(lan, 'ALLOW_WAIT_S', 1.0), mock.patch.object(lan, 'PAIR_WAIT_S', 1.0)]:
            patch.start()
            self.addCleanup(patch.stop)

    def events(self, request_line):
        """What the fake TV says: nothing while the person has not pressed Allow, the token once they have."""
        if 'token=24680' in request_line:
            return [{'event': 'ms.channel.connect', 'data': {'id': 'c1'}}]
        return [{'event': 'ms.channel.connect', 'data': {'id': 'c1', 'token': '24680'}}] if self.allowed else []

    def control(self, action, **extra):
        args = dict({'kind': 'samsung-tizen', 'address': '127.0.0.1', 'action': action, 'mac': MAC_A}, **extra)
        return lan.verb_lan_control(context(), args)

    def test_first_use_asks_allow_on_the_tv_and_saves_nothing(self):
        self.allowed = False
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('volume_up')
        self.assertEqual(caught.exception.code, 'samsung_allow_on_tv')
        self.assertIn('Press Allow on the TV', caught.exception.message)
        self.assertFalse(os.path.exists(lan.tokens_path()))
        self.assertEqual(self.tv.messages, [], 'no key is sent before the TV allowed oshal')
        self.assertIn('name=b3NoYWw%3D', self.tv.paths[0])
        self.assertNotIn('token=', self.tv.paths[0])

    def test_allow_saves_the_token_0600_here_and_the_key_is_pressed(self):
        reply = self.control('volume_up')
        self.assertEqual((reply['sent'], reply['key']), (True, 'KEY_VOLUP'))
        self.assertEqual(self.tv.messages[-1], {'method': 'ms.remote.control', 'params': {
            'Cmd': 'Click', 'DataOfCmd': 'KEY_VOLUP', 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'}})
        self.assertEqual(stat.S_IMODE(os.stat(lan.tokens_path()).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.state).st_mode), 0o700)
        self.assertEqual(json.load(open(lan.tokens_path()))[MAC_A]['token'], '24680')
        self.assertNotIn('24680', json.dumps(reply), 'the token never leaves this computer in an answer')
        self.control('back')
        self.assertIn('token=24680', self.tv.paths[-1], 'the saved token is used the next time')
        self.assertEqual(self.tv.messages[-1]['params']['DataOfCmd'], 'KEY_RETURN')

    def test_pair_and_open_oshal_in_the_tv_browser(self):
        self.assertEqual(self.control('pair')['paired'], True)
        reply = self.control('launch_url', url='https://home.test/')
        self.assertEqual((reply['opened'], reply['confirmed']), ('org.tizen.browser', True))
        launch = self.tv.messages[-1]['params']
        self.assertEqual((launch['event'], launch['data']['appId'], launch['data']['metaTag']),
                         ('ed.apps.launch', 'org.tizen.browser', 'https://home.test/'))

    def test_off_reads_power_first_and_a_refusal_is_said(self):
        self.assertEqual(self.control('off')['power'], 'off')
        self.assertEqual(self.tv.messages[-1]['params']['DataOfCmd'], 'KEY_POWER')
        standby = dict(SAMSUNG_DOC, device=dict(SAMSUNG_DOC['device'], PowerState='standby'))
        self.rest.routes[('GET', '/api/v2/')] = (200, json.dumps(standby).encode())
        count = len(self.tv.paths)
        again = self.control('off')
        self.assertEqual((again['power'], again.get('already')), ('off', True))
        self.assertEqual(len(self.tv.paths), count, 'a TV already in standby is not pressed')
        self.tv.events = lambda line: [{'event': 'ms.channel.unauthorized'}]
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('mute')
        self.assertEqual(caught.exception.code, 'samsung_refused')


# 1.8.0 (T45 part 4): `dumpsys media_session` as an Android 9 to 11 TV prints it: YouTube playing (or paused) behind the
# home screen, and a Netflix session that has stopped and carries no title.
MEDIA_EMPTY = """MEDIA SESSION SERVICE (dumpsys media_session)

  0 sessions listeners.
  Global priority session is null
  Media button session is null
  Sessions Stack - have 0 sessions:
"""


def media_sessions(playing):
    return f"""MEDIA SESSION SERVICE (dumpsys media_session)

  4 sessions listeners.
  Global priority session is null
Record for full_user=0
  Media key listener: null
  Media button session is com.amazon.firetv.youtube/YouTube (userId=0)
  Sessions Stack - have 2 sessions:
    YouTube com.amazon.firetv.youtube/YouTube (userId=0)
      ownerPid=8123, ownerUid=10071, userId=0
      package=com.amazon.firetv.youtube
      launchIntent=null
      mediaButtonReceiver=null
      active=true
      flags=3
      rating type=0
      controller=android.media.session.ISessionController$Stub$Proxy@3c1d2e
      state=PlaybackState {{state={3 if playing else 2}, position=48211, buffered position=0, speed=1.0, updated=1234, actions=822, custom actions=[], active item id=-1, error=null}}
      audioAttrs=AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_MOVIE flags=0x800 tags= bundle=null
      volumeType=1, controlType=2, max=15, current=8
      metadata: size=5, description=Big Buck Bunny 60fps 4K, Blender Foundation, null
      queueTitle=null, size=0
    NetflixMediaSession com.netflix.ninja/NetflixMediaSession (userId=0)
      ownerPid=7001, ownerUid=10066, userId=0
      package=com.netflix.ninja
      active=false
      state=PlaybackState {{state=1, position=0, buffered position=0, speed=0.0, updated=99, actions=0, custom actions=[], active item id=-1, error=null}}
      metadata: size=0, description=null, null, null
"""


class Android(unittest.TestCase):
    def setUp(self):
        self.commands, self.connected = [], []
        self.devices = [{'serial': '192.168.50.20:5555', 'state': 'device', 'model': 'TEST_TV'}]

        def shell(serial, command, timeout=30):
            self.commands.append((serial, command))
            if command.startswith('pm list packages'):
                return 0, 'package:' + lan.APP_PACKAGE if self.installed else '', ''
            if command.startswith('pm path '):
                name = command.split()[-1]
                return (0, 'package:/data/app/' + name + '/base.apk', '') if name in self.streaming else (1, '', '')
            if command.startswith('am start') and 'oshal://open' in command and self.old_oshal:
                return 0, 'Starting: Intent { act=android.intent.action.VIEW }\nError: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW pkg=com.oshal.remote }\n', ''
            if command.startswith('am start'):
                return 0, 'Starting: Intent\nStatus: ok\n', ''
            if command == 'dumpsys media_session':
                return 0, media_sessions(self.playing) if self.playing is not None else MEDIA_EMPTY, ''
            if command == 'dumpsys window windows':
                return 0, '  mCurrentFocus=Window{4f2a1c u0 com.amazon.tv.launcher/com.amazon.tv.launcher.ui.HomeActivity}\n', ''
            if command in ('input keyevent 127', 'input keyevent 86'):
                self.playing = False if self.playing is not None else None
            if command == 'input keyevent 126':
                self.playing = True if self.playing is not None else None
            return 0, 'Events injected: 1' if command.startswith('monkey') else 'ok', ''

        self.installed, self.streaming = True, {'com.netflix.ninja', 'com.amazon.firetv.youtube', 'com.oshal.remote'}
        self.playing = True
        self.old_oshal = False
        links.SETTLE_S = 0
        self.ctx = context(list_devices=lambda: (self.devices, 0), adb_shell=shell,
                           verb_adb_connect_tv=lambda args: self.connected.append(args) or {'serial': args['address']})

    def control(self, action, **extra):
        args = dict({'kind': 'android-tv', 'address': '192.168.50.20', 'action': action}, **extra)
        return lan.verb_lan_control(self.ctx, args)

    def test_keys_are_keyevents_through_the_bridge_adb(self):
        for action, code in (('volume_up', 24), ('mute', 164), ('select', 66), ('back', 4), ('off', 223)):
            reply = self.control(action)
            self.assertEqual(self.commands[-1], ('192.168.50.20:5555', f'input keyevent {code}'))
            self.assertEqual(reply['key'], code)
        self.assertEqual(reply['power'], 'off')
        self.assertEqual(self.connected, [], 'an authorized TV is not connected again')

    def test_a_page_opens_through_a_quoted_view_intent_and_the_app_only_when_installed(self):
        self.control('launch_url', url='https://home.test/a?b=1&c=$x')
        self.assertEqual([c for _, c in self.commands[-2:]], ['input keyevent KEYCODE_WAKEUP',
                         "am start -W -a android.intent.action.VIEW -d 'https://home.test/a?b=1&c=$x'"])
        self.assertEqual(self.control('open_app')['opened'], lan.APP_PACKAGE)
        self.installed = False
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('open_app')
        self.assertEqual(caught.exception.code, 'app_not_installed')

    def test_a_link_opens_in_its_streaming_app_on_its_own_site_only_and_when_installed(self):
        reply = self.control('launch_url', url='https://www.netflix.com/title/80057281', app='netflix')
        self.assertEqual((reply['opened'], reply['app']), ('com.netflix.ninja', 'netflix'))
        self.assertEqual(self.commands[0][1], 'input keyevent KEYCODE_WAKEUP', 'the TV is woken before the link')
        self.assertEqual(self.commands[-1][1],
                         "am start -W -a android.intent.action.VIEW -d 'https://www.netflix.com/title/80057281' com.netflix.ninja")
        self.assertEqual(self.control('launch_url', url='https://m.youtube.com/watch?v=aqz-KE-bpKQ', app='youtube')['opened'],
                         'com.amazon.firetv.youtube')
        for url, app, code in (('https://www.netflix.com.evil.test/title/1', 'netflix', 'not_that_app'),
                               ('https://www.hulu.com/watch/1', 'netflix', 'not_that_app'),
                               ('https://www.disneyplus.com/video/1', 'disney', 'not_installed'),
                               ('https://www.netflix.com/title/1', 'kodi', 'unknown_app')):
            with self.assertRaises(bridge.Refusal) as caught:
                self.control('launch_url', url=url, app=app)
            self.assertEqual(caught.exception.code, code, url)

    def test_a_marquee_page_opens_in_the_oshal_tv_app_and_an_old_or_missing_app_is_said(self):
        reply = self.control('launch_url', url='https://home.test/api/free-library/app#/guide/movie/35/play', app='oshal')
        self.assertEqual((reply['opened'], reply['app']), ('com.oshal.remote', 'oshal'))
        self.assertEqual(self.commands[-1][1], "am start -W -a android.intent.action.VIEW -d "
                         "'oshal://open?path=%2Fapi%2Ffree-library%2Fapp%23%2Fguide%2Fmovie%2F35%2Fplay' com.oshal.remote")
        for url in ('https://home.test/api/computers', 'https://home.test/api/free-library/app?x=1', 'https://home.test/api/free-library/media/x'):
            with self.assertRaises(bridge.Refusal) as caught:
                self.control('launch_url', url=url, app='oshal')
            self.assertEqual(caught.exception.code, 'not_that_app', url)
        self.old_oshal = True
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('launch_url', url='https://home.test/api/free-library/app', app='oshal')
        self.assertEqual(caught.exception.code, 'app_too_old')
        self.streaming.discard('com.oshal.remote')
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('launch_url', url='https://home.test/api/free-library/app', app='oshal')
        self.assertEqual(caught.exception.code, 'not_installed')

    def test_what_is_playing_names_the_app_the_title_and_that_it_is_behind_the_home_screen(self):
        reply = self.control('now_playing')
        self.assertEqual([c for _, c in self.commands], ['dumpsys media_session', 'dumpsys window windows'], 'reading presses nothing')
        self.assertEqual(reply['now'], {'package': 'com.amazon.firetv.youtube', 'app': 'YouTube', 'state': 'playing',
                                        'title': 'Big Buck Bunny 60fps 4K', 'active': True, 'inFront': False})
        self.assertEqual([(x['app'], x['state'], x['title']) for x in reply['sessions']],
                         [('YouTube', 'playing', 'Big Buck Bunny 60fps 4K'), ('Netflix', 'stopped', None)])
        self.assertEqual((reply['front'], reply['mediaKeysTo']), ('com.amazon.tv.launcher', 'com.amazon.firetv.youtube'))

    def test_a_media_key_reaches_the_app_in_the_background_and_the_answer_reads_what_it_did(self):
        reply = self.control('pause')
        self.assertEqual([c for _, c in self.commands], ['input keyevent 127', 'dumpsys media_session', 'dumpsys window windows'])
        self.assertEqual((reply['key'], reply['now']['app'], reply['now']['state'], reply['now']['inFront']), (127, 'YouTube', 'paused', False))
        self.assertEqual(self.control('play')['now']['state'], 'playing', 'the answer is read after the press, not assumed')
        for action, code in (('next', 87), ('previous', 88), ('stop', 86)):
            self.assertEqual(self.control(action)['key'], code)
            self.assertIn(('192.168.50.20:5555', f'input keyevent {code}'), self.commands)

    def test_nothing_played_yet_is_said_and_other_tvs_refuse_media_in_words(self):
        self.playing = None
        self.assertEqual(self.control('now_playing')['now'], None)
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('pause')
        self.assertEqual(caught.exception.code, 'nothing_playing')
        for kind in ('roku', 'samsung-tizen'):
            with self.assertRaises(bridge.Refusal) as caught:
                lan.verb_lan_control(self.ctx, {'kind': kind, 'address': '192.168.50.21', 'action': 'now_playing'})
            self.assertEqual(caught.exception.code, 'android_only', kind)

    def test_a_tv_this_computer_never_connected_is_connected_on_the_press(self):
        self.devices = []
        self.control('home')
        self.assertEqual(self.connected, [{'address': '192.168.50.20:5555'}])
        self.ctx.verb_adb_connect_tv = mock.Mock(side_effect=bridge.Refusal('tv_unauthorized', 'Allow USB debugging?'))
        with self.assertRaises(bridge.Refusal) as caught:
            self.control('home')
        self.assertEqual(caught.exception.code, 'tv_unauthorized')


class Discovery(unittest.TestCase):
    def setUp(self):
        self.samsung = serve('127.0.0.2', {('GET', '/api/v2/'): (200, json.dumps(SAMSUNG_DOC).encode())})
        self.roku = serve('127.0.0.3', {('GET', '/query/device-info'): (200, ROKU_XML)})
        self.addCleanup(self.samsung.shutdown)
        self.addCleanup(self.roku.shutdown)
        rest, ecp = self.samsung.server_address[1], self.roku.server_address[1]
        self.woken, self.adb_calls = [], []
        neighbors = {'127.0.0.2': {'mac': MAC_A, 'interface': 'wlp1s0'}, '127.0.0.3': {'mac': MAC_B, 'interface': 'wlp1s0'},
                     '127.0.0.4': {'mac': '02:00:5e:70:80:90', 'interface': 'wlp1s0'}}
        for patch in [mock.patch.object(lan, 'SAMSUNG_REST_PORT', rest), mock.patch.object(lan, 'ROKU_PORT', ecp),
                      mock.patch.object(lan, 'PROBE_PORTS', (rest, ecp)), mock.patch.object(lan, 'TV_PORTS', frozenset((rest, ecp))),
                      mock.patch.object(lan, 'lan_interfaces', lambda ctx: [('wlp1s0', '127.0.0.1', 8)]),
                      mock.patch.object(lan, 'in_subnets', lambda address, subnets: address.startswith('127.')),
                      mock.patch.object(lan, 'neighbors', lambda ctx, interfaces: neighbors),
                      mock.patch.object(lan, 'ssdp_search', lambda seconds: {}),
                      mock.patch.object(lan, 'avahi_browse', lambda kind: {}),
                      mock.patch.object(lan, 'WAKE_SETTLE_S', 0),
                      mock.patch.object(lan, 'send_wake', lambda macs, targets: self.woken.extend(macs) or list(macs))]:
            patch.start()
            self.addCleanup(patch.stop)
        state = tempfile.mkdtemp(prefix='lan-discover-')
        self.addCleanup(shutil.rmtree, state, True)
        patch = mock.patch.dict(os.environ, {'OSHAL_PHONE_BRIDGE_STATE': state})
        patch.start()
        self.addCleanup(patch.stop)

        def refuse(*args, **kwargs):
            self.adb_calls.append(args)
            raise AssertionError(f'discovery must not run adb or connect: {args}')

        self.ctx = context(list_devices=lambda: ([], 0), adb_call=refuse, adb_shell=refuse, verb_adb_connect_tv=refuse)

    def test_two_tvs_are_found_read_only(self):
        reply = lan.verb_lan_discover(self.ctx, {})
        found = {entry['address']: entry for entry in reply['found']}
        self.assertEqual(sorted(found), ['127.0.0.2', '127.0.0.3'], 'an address with no TV port is left out')
        den, stick = found['127.0.0.2'], found['127.0.0.3']
        self.assertEqual((den['kind'], den['name'], den['model'], den['os'], den['power'], den['mac']),
                         ('samsung-tizen', 'Den TV', 'QN00TEST', 'Tizen', 'on', MAC_A))
        self.assertEqual(den['samsung'], {'tokenAuth': True, 'tokenSaved': False})
        self.assertEqual((stick['kind'], stick['name'], stick['room'], stick['power'], stick['mac']),
                         ('roku', 'Guest room stick', 'Guest room', 'on', MAC_B))
        self.assertTrue(all(entry['controllable'] and entry['via'] == ['neighbors'] for entry in found.values()))
        self.assertEqual((reply['woke'], self.woken, self.adb_calls), ([], [], []), 'no packet, no adb, no install')
        self.assertTrue(all(method == 'GET' for method, _ in self.samsung.seen + self.roku.seen))
        self.assertLess(len(json.dumps(reply)), bridge.MAX_OUT)

    def test_wake_goes_only_to_the_macs_named(self):
        reply = lan.verb_lan_discover(self.ctx, {'wake': [{'mac': MAC_B, 'address': '10.20.30.77'}]})
        self.assertEqual((reply['woke'], self.woken), ([MAC_B], [MAC_B]))
        with self.assertRaises(bridge.Refusal):
            lan.verb_lan_discover(self.ctx, {'wake': ['ff:ff:ff:ff:ff:ff']})

    def test_no_home_network_is_said_in_words(self):
        with mock.patch.object(lan, 'lan_interfaces', lambda ctx: []):
            with self.assertRaises(bridge.Refusal) as caught:
                lan.verb_lan_discover(self.ctx, {})
        self.assertEqual(caught.exception.code, 'no_home_network')


class Pairings(unittest.TestCase):
    def test_uninstall_forgets_saved_tv_pairings(self):
        folder = tempfile.mkdtemp(prefix='lan-forget-')
        self.addCleanup(shutil.rmtree, folder, True)
        with mock.patch.dict(os.environ, {'OSHAL_PHONE_BRIDGE_STATE': folder}):
            self.assertTrue(lan.save_token(MAC_A, '10.20.30.40', '13579'))
            self.assertEqual(lan.read_token('', '10.20.30.40'), '', 'saved under the MAC when there is one')
            self.assertEqual(lan.read_token(MAC_A, '10.20.30.41'), '13579')
            self.assertTrue(lan.forget_tokens())
            self.assertEqual(lan.read_token(MAC_A, ''), '')
            self.assertFalse(lan.forget_tokens())


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(verbosity=2, descriptions=False))
