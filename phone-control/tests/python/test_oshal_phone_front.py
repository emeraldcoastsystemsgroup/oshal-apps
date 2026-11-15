#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.0 (Lane TV1): lan-control launch_app, list_apps and active_app on a
#   Roku and a Samsung TV (bridge/oshal_phone_front.py) against stand-ins on 127.0.0.1, never a real TV. A stand-in Roku
#   speaks ECP (/query/apps, /query/active-app, /query/media-player, POST /launch/<id>) and records every request it
#   receives; a stand-in Samsung TV answers GET and POST /api/v2/applications/<id> and, on its TLS WebSocket remote
#   channel, ed.apps.launch and ed.installedApp.get. An application opens by its checked id, a Roku title by a bounded
#   content id that is never a web address, and the answer says what the TV itself reported in front afterwards; a
#   refused id, title or media type sends nothing; a Samsung TV that refuses the REST launch is asked over its paired
#   remote channel, and a title on a Samsung TV is refused in words; an Android TV is refused in words.
"""Tests for oshal_phone_front.py: an application opened, listed and read in front on a Roku or a Samsung TV."""

import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'bridge')
sys.path.insert(0, BRIDGE)
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import oshal_phone_bridge as bridge  # noqa: E402
import oshal_phone_lan as lan  # noqa: E402
import oshal_phone_front as front  # noqa: E402
import test_oshal_phone_lan as fakes  # noqa: E402  (the fake Samsung remote channel and its frame helpers)

MAC = '02:00:5e:10:20:30'
TIZEN_APP = '3201907018807'
APPS_XML = (b'<?xml version="1.0" encoding="UTF-8" ?><apps>'
            b'<app id="12" type="appl" version="5.1.98079463">Netflix</app>'
            b'<app id="2285" type="appl" version="6.71.2">Hulu</app>'
            b'<app id="837" type="appl" version="2.23.110">YouTube</app>'
            b'<app id="tvinput.hdmi1" type="tvin" version="1.0.0">HDMI 1</app></apps>')
PLAYER_XML = (b'<?xml version="1.0" encoding="UTF-8" ?><player error="false" state="pause">'
              b'<plugin bandwidth="19111730 bps" id="12" name="Netflix"/>'
              b'<format audio="eac3" captions="none" drm="none" video="hevc_b" video_res="3840x2160"/>'
              b'<position>3183 ms</position><duration>59158 ms</duration><is_live>false</is_live></player>')
NAMES = {'12': 'Netflix', '2285': 'Hulu', '837': 'YouTube'}


class RokuStandIn(http.server.ThreadingHTTPServer):
    """A Roku's ECP port: its application list, what is in front, its player, and POST /launch/<id>. It records every
    request. A launch brings the application to the front after `settle` more reads of /query/active-app."""
    daemon_threads = True

    def __init__(self):
        self.seen, self.front, self.saver, self.pending = [], None, None, None
        self.settle, self.refuse, self.stays_home = 0, 0, False
        super().__init__(('127.0.0.1', 0), RokuHandler)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    def active_xml(self):
        if self.pending and not self.stays_home:
            self.settle -= 1
            if self.settle < 0:
                self.front, self.pending = self.pending, None
        app = (f'<app id="{self.front}" type="appl" version="1.0">{NAMES[self.front]}</app>' if self.front
               else '<app>Roku</app>')
        saver = f'<screensaver id="5533" type="ssvr" version="1.1.1">{self.saver}</screensaver>' if self.saver else ''
        return f'<?xml version="1.0" encoding="UTF-8" ?><active-app>{app}{saver}</active-app>'.encode()


class RokuHandler(http.server.BaseHTTPRequestHandler):
    def answer(self):
        tv = self.server
        tv.seen.append((self.command, self.path))
        path = self.path.split('?')[0]
        status, body = 404, b''
        if tv.refuse:
            status, body = tv.refuse, b'ECP command not allowed'
        elif (self.command, path) == ('GET', '/query/apps'):
            status, body = 200, APPS_XML
        elif (self.command, path) == ('GET', '/query/active-app'):
            status, body = 200, tv.active_xml()
        elif (self.command, path) == ('GET', '/query/media-player'):
            status, body = 200, PLAYER_XML
        elif self.command == 'POST' and path.startswith('/launch/') and path[len('/launch/'):] in NAMES:
            status, tv.pending = 200, path[len('/launch/'):]
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = answer

    def log_message(self, *args):
        pass


class SamsungRest(http.server.ThreadingHTTPServer):
    """A Samsung TV's REST port: GET /api/v2/applications/<id> says running and visible for one installed application,
    POST opens it. `post_status` makes it refuse the launch the way a TV that wants its paired channel does."""
    daemon_threads = True

    def __init__(self):
        self.seen, self.post_status, self.get_status = [], 200, 200
        self.apps = {TIZEN_APP: {'id': TIZEN_APP, 'name': 'Netflix', 'running': False, 'version': '5.3.130',
                                     'visible': False}}
        super().__init__(('127.0.0.1', 0), SamsungHandler)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    def open(self, app):
        self.apps[app].update(running=True, visible=True)


class SamsungHandler(http.server.BaseHTTPRequestHandler):
    def answer(self):
        tv = self.server
        tv.seen.append((self.command, self.path))
        prefix = '/api/v2/applications/'
        app = tv.apps.get(self.path[len(prefix):]) if self.path.startswith(prefix) else None
        status, doc = 404, {'code': 404, 'message': 'Not found error.', 'status': 404}
        if app and self.command == 'GET':
            status, doc = (200, app) if tv.get_status == 200 else (tv.get_status, {'code': tv.get_status})
        elif app and self.command == 'POST' and tv.post_status == 200:
            tv.open(app['id'])
            status, doc = 200, {'ok': True}
        elif app and self.command == 'POST':
            status, doc = tv.post_status, {'code': tv.post_status}
        body = json.dumps(doc).encode()
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = answer

    def log_message(self, *args):
        pass


class SamsungChannel(fakes.FakeSamsung):
    """The fake Samsung remote channel, answering each message a test scripts: `replies(message)` gives the events."""

    def __init__(self, cert, key, events, replies):
        super().__init__(cert, key, events)
        self.replies = replies

    def read_client(self, conn):
        buffer = b''
        while True:
            try:
                part = conn.recv(65536)
            except OSError:
                return
            if not part:
                return
            buffer += part
            while True:
                frame = fakes.client_frame(buffer)
                if frame is None:
                    break
                opcode, data, buffer = frame
                if opcode == 8:
                    return
                message = json.loads(data)
                self.messages.append(message)
                for event in self.replies(message):
                    conn.sendall(fakes.server_frame(json.dumps(event).encode()))


def refusal(case, code, fn):
    with case.assertRaises(bridge.Refusal) as caught:
        fn()
    case.assertEqual(caught.exception.code, code, caught.exception.message)
    return caught.exception.message


class RokuDirect(unittest.TestCase):
    def setUp(self):
        self.tv = RokuStandIn()
        self.addCleanup(self.tv.shutdown)
        for patch in [mock.patch.object(lan, 'ROKU_PORT', self.tv.server_address[1]),
                      mock.patch.object(lan, 'need_lan_address', lambda ctx, value: value),
                      mock.patch.object(front, 'FRONT_WAIT_S', 2.0), mock.patch.object(front, 'FRONT_STEP_S', 0.01)]:
            patch.start()
            self.addCleanup(patch.stop)

    def control(self, action, **extra):
        return lan.verb_lan_control(fakes.context(), dict({'kind': 'roku', 'address': '127.0.0.1', 'action': action}, **extra))

    def test_an_application_opens_by_its_id_and_the_answer_reads_what_came_to_the_front(self):
        self.tv.settle = 2
        reply = self.control('launch_app', app='12')
        self.assertEqual((reply['action'], reply['app'], reply['inFront']), ('launch_app', {'id': '12', 'name': 'Netflix'}, True))
        self.assertEqual(reply['front'], {'id': '12', 'name': 'Netflix', 'home': False, 'screensaver': None})
        self.assertEqual(self.tv.seen[:2], [('GET', '/query/apps'), ('POST', '/launch/12')])
        self.assertEqual([path for _, path in self.tv.seen[2:]], ['/query/active-app'] * 3, 'read until it is in front')
        self.assertNotIn('contentId', reply)

    def test_a_title_opens_by_the_applications_own_content_id_and_media_type(self):
        reply = self.control('launch_app', app=12, contentId='80057281', mediaType='MOVIE')
        self.assertIn(('POST', '/launch/12?contentId=80057281&mediaType=movie'), self.tv.seen)
        self.assertEqual((reply['contentId'], reply['mediaType'], reply['inFront']), ('80057281', 'movie', True))
        self.control('launch_app', app='837', contentId='amzn1.dv.gti:aa-bb_cc~1')
        self.assertIn(('POST', '/launch/837?contentId=amzn1.dv.gti%3Aaa-bb_cc~1'), self.tv.seen)

    def test_a_launch_that_does_not_come_to_the_front_is_said_and_not_assumed(self):
        self.tv.stays_home = True
        with mock.patch.object(front, 'FRONT_WAIT_S', 0.1):
            reply = self.control('launch_app', app='2285')
        self.assertEqual((reply['app']['name'], reply['inFront'], reply['front']['home']), ('Hulu', False, True))

    def test_what_is_in_front_names_the_application_the_screensaver_and_the_player(self):
        self.tv.front, self.tv.saver = '12', 'Roku Digital Clock'
        reply = self.control('active_app')
        self.assertEqual(reply['front'], {'id': '12', 'name': 'Netflix', 'home': False, 'screensaver': 'Roku Digital Clock'})
        self.assertEqual(reply['player'], {'state': 'pause', 'app': {'id': '12', 'name': 'Netflix'},
                                           'positionMs': 3183, 'durationMs': 59158})
        self.assertEqual(self.tv.seen, [('GET', '/query/active-app'), ('GET', '/query/media-player')], 'reading presses nothing')

    def test_the_home_screen_is_said_as_the_home_screen(self):
        reply = self.control('active_app')
        self.assertEqual(reply['front'], {'id': None, 'name': 'Roku', 'home': True, 'screensaver': None})

    def test_the_applications_are_listed_with_their_ids_and_a_tv_input_is_only_counted(self):
        reply = self.control('list_apps')
        self.assertEqual(reply['apps'], [{'id': '12', 'name': 'Netflix'}, {'id': '2285', 'name': 'Hulu'},
                                         {'id': '837', 'name': 'YouTube'}])
        self.assertEqual((reply['total'], reply['otherCount']), (3, 1))
        self.assertEqual(self.tv.seen, [('GET', '/query/apps')], 'listing opens nothing')
        self.assertLess(len(json.dumps(reply)), bridge.MAX_OUT)

    def test_an_id_a_title_or_a_media_type_outside_the_closed_shapes_sends_nothing(self):
        for app in ('dev', 'tvinput.hdmi1', '12/../keypress/Home', '12?x=1', '', '1' * 11, True):
            code = 'app_required' if app == '' else 'bad_app'
            refusal(self, code, lambda: self.control('launch_app', app=app))
        for content in ('https://evil.test/watch', 'a b', 'a&mediaType=x', 'a/b', 'x' * 256):
            self.assertIn('never a web address', refusal(self, 'bad_content', lambda: self.control('launch_app', app='12', contentId=content)))
        refusal(self, 'bad_media_type', lambda: self.control('launch_app', app='12', contentId='1', mediaType='trailer'))
        refusal(self, 'bad_content', lambda: self.control('launch_app', app='12', mediaType='movie'))
        self.assertEqual(self.tv.seen, [], 'a refused request never reaches the Roku')

    def test_an_application_the_roku_does_not_have_is_not_launched(self):
        message = refusal(self, 'app_not_installed', lambda: self.control('launch_app', app='99999'))
        self.assertIn('99999', message)
        self.assertEqual(self.tv.seen, [('GET', '/query/apps')], 'nothing is launched')

    def test_a_roku_that_refuses_network_control_and_one_that_does_not_answer_are_said_in_words(self):
        self.tv.refuse = 403
        for action, extra in (('launch_app', {'app': '12'}), ('list_apps', {}), ('active_app', {})):
            self.assertIn('Control by mobile apps', refusal(self, 'roku_control_off', lambda: self.control(action, **extra)))
        with mock.patch.object(lan, 'ROKU_PORT', fakes.free_port()):
            refusal(self, 'tv_not_answering', lambda: self.control('active_app'))


class SamsungDirect(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('openssl'):
            raise AssertionError('openssl is needed to make the fake TV certificate')
        cls.folder = tempfile.mkdtemp(prefix='front-tls-')
        cls.cert, cls.key = os.path.join(cls.folder, 'tv.pem'), os.path.join(cls.folder, 'tv.key')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cls.key, '-out', cls.cert,
                        '-days', '1', '-subj', '/CN=tv.test'], check=True, capture_output=True, timeout=60)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def setUp(self):
        self.state = tempfile.mkdtemp(prefix='front-state-')
        self.addCleanup(shutil.rmtree, self.state, True)
        self.rest = SamsungRest()
        self.addCleanup(self.rest.shutdown)
        self.allowed, self.launch_answer, self.listed = True, 200, [
            {'appId': TIZEN_APP, 'app_type': 2, 'icon': '/opt/x/netflix.png', 'is_lock': 0, 'name': 'Netflix'},
            {'appId': 'org.tizen.browser', 'app_type': 4, 'icon': '/opt/x/browser.png', 'is_lock': 0, 'name': 'Internet'},
            {'appId': '../../etc', 'app_type': 2, 'name': 'Not an id'}]
        self.channel = SamsungChannel(self.cert, self.key, self.events, self.replies)
        self.channel.start()
        self.addCleanup(self.channel.stop)
        for patch in [mock.patch.dict(os.environ, {'OSHAL_PHONE_BRIDGE_STATE': self.state}),
                      mock.patch.object(lan, 'SAMSUNG_WSS_PORT', self.channel.port),
                      mock.patch.object(lan, 'SAMSUNG_REST_PORT', self.rest.server_address[1]),
                      mock.patch.object(lan, 'need_lan_address', lambda ctx, value: value),
                      mock.patch.object(lan, 'ALLOW_WAIT_S', 1.0),
                      mock.patch.object(front, 'FRONT_WAIT_S', 1.0), mock.patch.object(front, 'FRONT_STEP_S', 0.01),
                      mock.patch.object(front, 'LAUNCH_WAIT_S', 1.0), mock.patch.object(front, 'APPS_WAIT_S', 1.0)]:
            patch.start()
            self.addCleanup(patch.stop)

    def events(self, request_line):
        if 'token=24680' in request_line:
            return [{'event': 'ms.channel.connect', 'data': {'id': 'c1'}}]
        return [{'event': 'ms.channel.connect', 'data': {'id': 'c1', 'token': '24680'}}] if self.allowed else []

    def replies(self, message):
        event = (message.get('params') or {}).get('event')
        if event == 'ed.apps.launch':
            if self.launch_answer == 200:
                self.rest.open(message['params']['data']['appId'])
            return [{'event': 'ed.apps.launch', 'data': self.launch_answer}]
        if event == 'ed.installedApp.get' and self.listed is not None:
            return [{'event': 'ed.installedApp.get', 'from': 'host', 'data': {'data': self.listed}}]
        return []

    def control(self, action, **extra):
        args = dict({'kind': 'samsung-tizen', 'address': '127.0.0.1', 'action': action, 'mac': MAC}, **extra)
        return lan.verb_lan_control(fakes.context(), args)

    def test_an_application_opens_over_the_tv_rest_interface_and_the_answer_says_running_and_in_front(self):
        reply = self.control('launch_app', app=TIZEN_APP)
        self.assertEqual(self.rest.seen[0], ('POST', '/api/v2/applications/' + TIZEN_APP))
        self.assertTrue(all(pair == ('GET', '/api/v2/applications/' + TIZEN_APP) for pair in self.rest.seen[1:]))
        self.assertEqual((reply['app']['id'], reply['app']['name'], reply['running'], reply['visible'], reply['inFront'], reply['via']),
                         (TIZEN_APP, 'Netflix', True, True, True, 'rest'))
        self.assertEqual(self.channel.paths, [], 'the remote channel is not opened when the REST launch worked')

    def test_an_application_the_tv_does_not_have_is_said(self):
        message = refusal(self, 'app_not_installed', lambda: self.control('launch_app', app='111299001912'))
        self.assertIn('111299001912', message)
        self.assertEqual(self.channel.paths, [])

    def test_a_tv_that_refuses_the_rest_launch_is_asked_over_its_paired_remote_channel(self):
        self.rest.post_status, self.allowed = 401, False
        self.assertIn('Press Allow on the TV', refusal(self, 'samsung_allow_on_tv', lambda: self.control('launch_app', app=TIZEN_APP)))
        self.assertEqual(self.channel.messages, [], 'nothing is launched before the TV allowed oshal')
        self.allowed = True
        reply = self.control('launch_app', app=TIZEN_APP)
        self.assertEqual(self.channel.messages[-1], {'method': 'ms.channel.emit', 'params': {'event': 'ed.apps.launch', 'to': 'host', 'data': {
            'appId': TIZEN_APP, 'action_type': 'DEEP_LINK', 'metaTag': ''}}})
        self.assertEqual((reply['via'], reply['running'], reply['visible'], reply['inFront']), ('remote-channel', True, True, True))
        self.assertNotIn('24680', json.dumps(reply), 'the pairing token never leaves this computer in an answer')
        self.launch_answer = 404
        refusal(self, 'app_not_installed', lambda: self.control('launch_app', app=TIZEN_APP))

    def test_running_and_in_front_are_read_for_one_named_application(self):
        self.rest.apps[TIZEN_APP].update(running=True, visible=False)
        reply = self.control('active_app', app=TIZEN_APP)
        self.assertEqual((reply['app'], reply['running'], reply['visible'], reply['inFront']),
                         ({'id': TIZEN_APP, 'name': 'Netflix', 'version': '5.3.130'}, True, False, False))
        self.assertEqual(self.rest.seen, [('GET', '/api/v2/applications/' + TIZEN_APP)], 'reading opens nothing')
        self.assertIn('one application at a time', refusal(self, 'app_required', lambda: self.control('active_app')))
        self.assertEqual(len(self.rest.seen), 1, 'a read with no application named asks the TV nothing')

    def test_a_title_is_not_opened_on_a_samsung_tv_and_ids_are_closed(self):
        message = refusal(self, 'samsung_title_not_built', lambda: self.control('launch_app', app=TIZEN_APP, contentId='80057281'))
        self.assertIn('Samsung', message)
        for app in ('../x', 'a/b', 'x y', 'Netflix', 'a.' + 'b' * 80, 'org.tizen.browser?x=1'):
            refusal(self, 'bad_app', lambda: self.control('launch_app', app=app))
        refusal(self, 'app_required', lambda: self.control('launch_app'))
        self.assertEqual((self.rest.seen, self.channel.paths), ([], []), 'a refused request never reaches the TV')

    def test_the_applications_are_listed_when_the_tv_lists_them_and_said_when_it_does_not(self):
        reply = self.control('list_apps')
        self.assertEqual(self.channel.messages[-1], {'method': 'ms.channel.emit', 'params': {'event': 'ed.installedApp.get', 'to': 'host'}})
        self.assertEqual(reply['apps'], [{'id': TIZEN_APP, 'name': 'Netflix'}, {'id': 'org.tizen.browser', 'name': 'Internet'}])
        self.assertEqual((reply['total'], reply['otherCount']), (2, 1))
        self.assertEqual(self.rest.seen, [], 'listing opens nothing')
        self.listed = None
        self.assertIn('did not list its applications', refusal(self, 'samsung_no_app_list', lambda: self.control('list_apps')))


class OtherKinds(unittest.TestCase):
    def test_an_android_tv_is_sent_to_phone_and_device_control_in_words(self):
        calls = []

        def never(*args, **kwargs):
            calls.append(args)
            raise AssertionError(f'nothing may run on the TV: {args}')

        ctx = fakes.context(list_devices=never, adb_shell=never, adb_call=never, verb_adb_connect_tv=never)
        for action in front.ACTIONS:
            with self.assertRaises(bridge.Refusal) as caught:
                lan.verb_lan_control(ctx, {'kind': 'android-tv', 'address': '192.168.50.20', 'action': action, 'app': '12'})
            self.assertEqual(caught.exception.code, 'roku_samsung_only', action)
            self.assertIn('Phone & Device Control', caught.exception.message)
        self.assertEqual(calls, [])

    def test_the_installed_bridge_names_the_three_actions_and_ships_this_module(self):
        done = subprocess.run([sys.executable, '-I', '-B', os.path.join(BRIDGE, 'oshal_phone_bridge.py'), 'help'],
                              capture_output=True, text=True, timeout=30)
        reply = json.loads(done.stdout.strip().split('\n')[-1])
        for action in ('launch_app', 'list_apps', 'active_app'):
            self.assertIn(action, reply['verbs']['lan-control'])
        self.assertIn('oshal_phone_front.py', bridge.FILES)
        self.assertEqual(front.ACTIONS, ('launch_app', 'list_apps', 'active_app'))
        self.assertTrue(set(front.ACTIONS) <= set(lan.ACTIONS))


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(verbosity=2, descriptions=False))
