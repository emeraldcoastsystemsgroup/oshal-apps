#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.5.4: the Bluetooth bridge asks before each pairing and trusts only what the person allowed (open-work audit 2026-11-10; Orbit Add hub section 2.6 items 1-2). The real bridge process (oshal_phone_ble.py serve) runs against a scripted BlueZ (fake_bluez.py) on a private dbus-daemon, and every pairing goes through the agent over D-Bus the way bluetoothd calls it. Before 1.5.4 the agent confirmed every pairing at once and the bridge marked every paired device Trusted; each case here is red against that bridge.
"""Pairing tests for oshal_phone_ble.py against a scripted BlueZ on a private D-Bus (stdlib unittest)."""

import json
import os
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest

import dbus

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.environ.get('OSHAL_BLE_BRIDGE_UNDER_TEST') or os.path.join(HERE, '..', '..', 'bridge', 'oshal_phone_ble.py')
STRANGER, SECOND, THIRD = '7C:4B:26:00:00:0A', '7C:4B:26:00:00:0B', '7C:4B:26:00:00:0C'
MOUSE, LATECOMER = '7C:4B:26:00:00:0D', '7C:4B:26:00:00:0E'
ANSWER_S = 2


def wait_for(check, seconds, what):
    deadline = time.time() + seconds
    while time.time() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f'{what} did not happen within {seconds} s')


class BridgeAgainstScriptedBlueZ(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='ble-pair-')
        self.address = f"unix:path={os.path.join(self.tmp, 'bus')}"
        self.daemon = subprocess.Popen(['dbus-daemon', '--session', '--nofork', '--nopidfile', f'--address={self.address}'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_for(lambda: os.path.exists(os.path.join(self.tmp, 'bus')), 10, 'the private bus')
        self.bluez = subprocess.Popen([sys.executable, '-I', os.path.join(HERE, 'fake_bluez.py'), self.address],
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.assertEqual(self.bluez.stdout.readline().strip(), 'ready')
        self.bus = dbus.bus.BusConnection(self.address)
        self.test = dbus.Interface(self.bus.get_object('org.bluez', '/'), 'org.oshal.Test')
        self.runtime, self.state = os.path.join(self.tmp, 'run'), os.path.join(self.tmp, 'state')
        os.makedirs(self.runtime)
        self.bridge = None

    def start_bridge(self):
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': self.tmp, 'XDG_STATE_HOME': self.state,
               'DBUS_SYSTEM_BUS_ADDRESS': self.address, 'OSHAL_BLE_PAIR_ANSWER_S': str(ANSWER_S)}
        self.log = open(os.path.join(self.tmp, 'ble.log'), 'w')
        self.bridge = subprocess.Popen([sys.executable, '-I', BRIDGE, 'serve', self.runtime], env=env,
                                       stdout=self.log, stderr=subprocess.STDOUT)
        wait_for(lambda: os.path.exists(os.path.join(self.runtime, 'ble.sock')), 15, 'the bridge socket')
        wait_for(lambda: self.op('status').get('ok'), 15, 'the bridge status')

    def stop_bridge(self):
        if self.bridge and self.bridge.poll() is None:
            self.bridge.send_signal(signal.SIGTERM)
            self.bridge.wait(15)

    def tearDown(self):
        self.stop_bridge()
        for proc in (self.bluez, self.daemon):
            proc.kill()
            proc.wait(10)
        self.bluez.stdout.close()
        if getattr(self, 'log', None):
            self.log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def op(self, name, **args):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(30)
            conn.connect(os.path.join(self.runtime, 'ble.sock'))
            conn.sendall(json.dumps(dict(args, op=name)).encode() + b'\n')
            data = b''
            while not data.endswith(b'\n'):
                part = conn.recv(65536)
                if not part:
                    break
                data += part
        return json.loads(data.decode() or '{}')

    def device(self, address):
        return {str(k): v for k, v in self.test.DeviceProps(address).items()}

    def trusted(self, address):
        return bool(self.device(address).get('Trusted'))

    def allowed_file(self):
        path = os.path.join(self.state, 'oshal-phone-bridge', 'ble-allowed.json')
        if not os.path.exists(path):
            return path, []
        with open(path) as handle:
            return path, json.load(handle).get('allowed', [])

    def waiting(self):
        return {item['address']: item for item in self.op('devices').get('pairing', [])}

    def test_a_pairing_nobody_answers_is_rejected_after_the_limit_and_never_trusted(self):
        self.test.AddDevice(STRANGER, 'Stranger phone', False, False)
        self.start_bridge()
        self.assertTrue(self.op('pair-window', seconds=60)['ok'])
        self.assertEqual(self.test.Pair(STRANGER, 'RequestConfirmation', 123456), 'asked')
        held = wait_for(lambda: self.waiting().get(STRANGER), 5, 'the pairing question')
        self.assertEqual((held['name'], held['passkey']), ('Stranger phone', '123456'))
        self.assertEqual(self.test.Result(STRANGER), 'pending', 'the bridge answered before the person did')
        rejected = wait_for(lambda: self.test.Result(STRANGER).startswith('rejected') and self.test.Result(STRANGER),
                            ANSWER_S + 5, 'the rejection')
        self.assertEqual(rejected, 'rejected:org.bluez.Error.Rejected')
        self.assertFalse(self.trusted(STRANGER))
        self.assertEqual(self.waiting(), {})
        self.assertNotIn(STRANGER, self.allowed_file()[1])

    def test_one_allow_trusts_and_remembers_that_device_and_turns_every_other_request_away(self):
        for address, name in ((STRANGER, 'My iPhone'), (SECOND, 'Neighbour'), (THIRD, 'Later')):
            self.test.AddDevice(address, name, False, False)
        self.start_bridge()
        self.assertTrue(self.op('pair-window', seconds=60)['ok'])
        self.test.Pair(STRANGER, 'RequestAuthorization', 0)
        self.test.Pair(SECOND, 'RequestConfirmation', 654321)
        wait_for(lambda: set(self.waiting()) == {STRANGER, SECOND}, 5, 'both questions')
        reply = self.op('pair-answer', address=STRANGER.lower(), allow=True)
        self.assertEqual((reply['ok'], reply['answered']), (True, 'allowed'), reply)
        wait_for(lambda: self.test.Result(STRANGER) == 'accepted', 5, 'the accepted pairing')
        wait_for(lambda: self.test.Result(SECOND).startswith('rejected'), 5, 'the other request turned away')
        self.assertTrue(self.trusted(STRANGER))
        self.assertFalse(self.trusted(SECOND))
        path, allowed = self.allowed_file()
        self.assertEqual(allowed, [STRANGER])
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.test.Pair(THIRD, 'RequestConfirmation', 111111)
        wait_for(lambda: self.test.Result(THIRD).startswith('rejected'), 5, 'a request after the Allow refused')
        wait_for(lambda: self.op('status')['pairWindowSeconds'] == 0, 10, 'the window closing after one Allow')
        self.assertEqual(self.op('pair-answer', address=SECOND, allow=True)['error'], 'no_request')

    def test_a_rejected_request_is_answered_rejected_and_nothing_is_trusted(self):
        self.test.AddDevice(STRANGER, 'Unknown', False, False)
        self.start_bridge()
        self.op('pair-window', seconds=60)
        self.test.Pair(STRANGER, 'RequestPasskey', 0)
        wait_for(lambda: STRANGER in self.waiting(), 5, 'the question')
        self.assertEqual(self.op('pair-answer', address=STRANGER, allow=False)['answered'], 'rejected')
        wait_for(lambda: self.test.Result(STRANGER).startswith('rejected'), 5, 'the rejection')
        self.assertFalse(self.trusted(STRANGER))
        self.assertEqual(self.allowed_file()[1], [])

    def test_a_device_paired_before_is_never_trusted_or_reconnected_by_reading_syncing_or_closing(self):
        self.test.AddDevice(MOUSE, 'My mouse', True, False)
        self.start_bridge()
        time.sleep(1.5)
        listed = {phone['address']: phone for phone in self.op('status')['phones']}
        self.op('devices')
        self.assertFalse(self.trusted(MOUSE), 'reading the device list marked a device nobody allowed Trusted')
        self.assertIs(listed[MOUSE].get('allowed'), False)
        refused = self.op('sync', address=MOUSE, waitS=0)
        self.assertEqual(refused['error'], 'not_allowed', refused)
        self.op('pair-window', seconds=60)
        self.stop_bridge()
        self.assertFalse(self.trusted(MOUSE))
        self.assertNotIn('Gone', self.device(MOUSE), 'a device paired before the window was removed')
        self.assertNotIn(MOUSE, list(self.test.Connects()))

    def test_keep_trusts_a_device_paired_before_and_lets_it_reconnect(self):
        self.test.AddDevice(MOUSE, 'My iPhone', True, False)
        self.start_bridge()
        kept = self.op('keep', address=MOUSE)
        self.assertEqual(kept, {'ok': True, 'kept': MOUSE})
        self.assertTrue(self.trusted(MOUSE))
        self.assertEqual(self.allowed_file()[1], [MOUSE])
        self.op('sync', address=MOUSE, waitS=0)
        wait_for(lambda: MOUSE in list(self.test.Connects()), 5, 'the kept device reconnected')
        self.assertEqual(self.op('keep', address=LATECOMER)['error'], 'not_paired')

    def test_a_pairing_bluez_completed_without_asking_is_asked_about_and_removed_unless_allowed(self):
        self.test.AddDevice(MOUSE, 'My mouse', True, False)
        self.start_bridge()
        self.op('pair-window', seconds=60)
        self.test.AddDevice(LATECOMER, 'Paired without asking', True, False)
        held = wait_for(lambda: self.waiting().get(LATECOMER), 5, 'the after-the-fact question')
        self.assertEqual(held['name'], 'Paired without asking')
        self.assertFalse(self.trusted(LATECOMER))
        wait_for(lambda: 'Gone' in self.device(LATECOMER), ANSWER_S + 5, 'the unanswered device removed')
        self.assertNotIn('Gone', self.device(MOUSE), 'a device paired before the window was removed')
        self.test.AddDevice(THIRD, 'Paired again', True, False)
        self.stop_bridge()
        self.assertEqual(self.device(THIRD), {'Gone': True}, 'closing the window keeps a pairing nobody allowed')

    def test_a_pairing_bluez_completed_without_asking_is_kept_and_trusted_on_allow(self):
        self.start_bridge()
        self.op('pair-window', seconds=60)
        self.test.AddDevice(LATECOMER, 'My iPhone', True, False)
        wait_for(lambda: LATECOMER in self.waiting(), 5, 'the after-the-fact question')
        self.assertEqual(self.op('pair-answer', address=LATECOMER, allow=True)['answered'], 'allowed')
        self.assertTrue(self.trusted(LATECOMER))
        self.assertEqual(self.allowed_file()[1], [LATECOMER])
        self.test.AddDevice(THIRD, 'Second device', True, False)
        wait_for(lambda: 'Gone' in self.device(THIRD), 5, 'a second pairing after the Allow removed')
        self.stop_bridge()
        self.assertNotIn('Gone', self.device(LATECOMER))


if __name__ == '__main__':
    unittest.main(verbosity=2)
