#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: the resident Bluetooth keyboard, consumer control and mouse an iPhone pairs with as OSHAL-KB. The GATT layout, report map and advertisement are the ones proven on 2026-11-05 (typed "hello from oshal" into Notes), so a phone that bonded with that test keyboard keeps its handles. Changed from it: a private unix socket instead of an open port on 127.0.0.1, the auto-accepting pairing agent only during a pairing window the person opens, report notifications that need an encrypted (bonded) link where BlueZ supports it, "sent" only when a phone has subscribed to that report, and unknown keys and characters refused in words instead of answered as done.
"""Resident BLE HID peripheral for phone-control. Started by `oshal_phone_bridge.py ensure`:

    python3 -I oshal_phone_ble.py serve <runtime folder>

It listens on <runtime folder>/ble.sock for one JSON line per request and answers one JSON line.
"""

import fcntl
import json
import os
import signal
import socket
import sys
import threading
import time

import dbus
import dbus.exceptions
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BLUEZ = 'org.bluez'
ADAPTER_IFACE = 'org.bluez.Adapter1'
DEVICE_IFACE = 'org.bluez.Device1'
GATT_MANAGER_IFACE = 'org.bluez.GattManager1'
AD_MANAGER_IFACE = 'org.bluez.LEAdvertisingManager1'
AGENT_MANAGER_IFACE = 'org.bluez.AgentManager1'
AGENT_IFACE = 'org.bluez.Agent1'
OM_IFACE = 'org.freedesktop.DBus.ObjectManager'
PROP_IFACE = 'org.freedesktop.DBus.Properties'
SERVICE_IFACE = 'org.bluez.GattService1'
CHRC_IFACE = 'org.bluez.GattCharacteristic1'
DESC_IFACE = 'org.bluez.GattDescriptor1'
AD_IFACE = 'org.bluez.LEAdvertisement1'
AGENT_PATH = '/org/bluez/oshal/agent'
MAX_TEXT = 300

# Report 1 keyboard (modifier, reserved, six keys), report 2 consumer usage (16 bit), report 3 mouse
# (buttons, dx, dy, wheel). Byte for byte the map of the proven test keyboard.
REPORT_MAP = [
    0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01, 0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00,
    0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x06,
    0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00, 0xC0,
    0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x02, 0x15, 0x00, 0x26, 0xFF, 0x03, 0x19, 0x00, 0x2A,
    0xFF, 0x03, 0x75, 0x10, 0x95, 0x01, 0x81, 0x00, 0xC0,
    0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x85, 0x03, 0x09, 0x01, 0xA1, 0x00, 0x05, 0x09, 0x19, 0x01,
    0x29, 0x03, 0x15, 0x00, 0x25, 0x01, 0x95, 0x03, 0x75, 0x01, 0x81, 0x02, 0x95, 0x01, 0x75, 0x05,
    0x81, 0x01, 0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08,
    0x95, 0x03, 0x81, 0x06, 0xC0, 0xC0,
]


def build_keymap():
    """US keyboard usage codes for every plain keyboard character: (modifier, usage)."""
    keys = {' ': (0, 0x2C), '\n': (0, 0x28), '\t': (0, 0x2B)}
    for index, char in enumerate('abcdefghijklmnopqrstuvwxyz'):
        keys[char], keys[char.upper()] = (0, 0x04 + index), (0x02, 0x04 + index)
    for index, char in enumerate('1234567890'):
        keys[char] = (0, 0x1E + index)
    for index, char in enumerate('!@#$%^&*()'):
        keys[char] = (0x02, 0x1E + index)
    plain = {'-': 0x2D, '=': 0x2E, '[': 0x2F, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34, '`': 0x35,
             ',': 0x36, '.': 0x37, '/': 0x38}
    shifted = {'_': 0x2D, '+': 0x2E, '{': 0x2F, '}': 0x30, '|': 0x31, ':': 0x33, '"': 0x34, '~': 0x35,
               '<': 0x36, '>': 0x37, '?': 0x38}
    keys.update({char: (0, code) for char, code in plain.items()})
    keys.update({char: (0x02, code) for char, code in shifted.items()})
    return keys


KEYMAP = build_keymap()
# A named key is a list of steps: ('consumer', usage) or ('key', modifier, usage). Home and Spotlight send
# both the consumer usage and the keyboard shortcut, as the proven keyboard did.
NAMED_KEYS = {
    'Home': [('consumer', 0x0040), ('key', 0x08, 0x0B)], 'Spotlight': [('consumer', 0x0221), ('key', 0x08, 0x2C)],
    'VolumeUp': [('consumer', 0x00E9)], 'VolumeDown': [('consumer', 0x00EA)], 'Enter': [('key', 0, 0x28)],
    'Escape': [('key', 0, 0x29)], 'Backspace': [('key', 0, 0x2A)], 'Tab': [('key', 0, 0x2B)],
    'Right': [('key', 0, 0x4F)], 'Left': [('key', 0, 0x50)], 'Down': [('key', 0, 0x51)], 'Up': [('key', 0, 0x52)],
}


class Agent(dbus.service.Object):
    """Accepts a pairing request. Registered only while a pairing window the person opened is open."""

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='os', out_signature='')
    def AuthorizeService(self, device, uuid):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='s')
    def RequestPinCode(self, device):
        return '0000'

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='u')
    def RequestPasskey(self, device):
        return dbus.UInt32(0)

    @dbus.service.method(AGENT_IFACE, in_signature='ouq', out_signature='')
    def DisplayPasskey(self, device, passkey, entered):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='os', out_signature='')
    def DisplayPinCode(self, device, pincode):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='ou', out_signature='')
    def RequestConfirmation(self, device, passkey):
        print(f'pairing confirmed for {device}', flush=True)

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='')
    def RequestAuthorization(self, device):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Cancel(self):
        pass


class Advertisement(dbus.service.Object):
    PATH = '/org/bluez/oshal/advertisement0'

    def __init__(self, bus):
        dbus.service.Object.__init__(self, bus, self.PATH)

    @dbus.service.method(PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return {'Type': 'peripheral', 'ServiceUUIDs': dbus.Array(['1812'], signature='s'),
                'LocalName': dbus.String('OSHAL-KB'), 'Appearance': dbus.UInt16(0x03C1)}

    @dbus.service.method(AD_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass


class Descriptor(dbus.service.Object):
    def __init__(self, bus, characteristic, uuid, flags, value):
        self.path = characteristic.path + '/desc0'
        self.characteristic, self.uuid, self.flags = characteristic, uuid, flags
        self.value = [dbus.Byte(b) for b in value]
        dbus.service.Object.__init__(self, bus, self.path)

    def properties(self):
        return {DESC_IFACE: {'Characteristic': dbus.ObjectPath(self.characteristic.path), 'UUID': self.uuid,
                             'Flags': self.flags}}

    @dbus.service.method(PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return self.properties()[DESC_IFACE]

    @dbus.service.method(DESC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        return self.value[int(options.get('offset', 0)):]


class Characteristic(dbus.service.Object):
    """One GATT characteristic; a report remembers whether a phone subscribed to it."""

    def __init__(self, bus, service, index, uuid, flags, value):
        self.path = f'{service.path}/char{index}'
        self.service, self.uuid, self.flags = service, uuid, flags
        self.value = [dbus.Byte(b) for b in value]
        self.descriptors, self.notifying, self.subscribed_at = [], False, None
        dbus.service.Object.__init__(self, bus, self.path)

    def properties(self):
        return {CHRC_IFACE: {'Service': dbus.ObjectPath(self.service.path), 'UUID': self.uuid, 'Flags': self.flags,
                             'Descriptors': dbus.Array([dbus.ObjectPath(d.path) for d in self.descriptors], signature='o')}}

    @dbus.service.method(PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return self.properties()[CHRC_IFACE]

    @dbus.service.method(CHRC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        return self.value[int(options.get('offset', 0)):]

    @dbus.service.method(CHRC_IFACE, in_signature='aya{sv}')
    def WriteValue(self, value, options):
        self.value = value

    @dbus.service.method(CHRC_IFACE)
    def StartNotify(self):
        self.notifying, self.subscribed_at = True, time.time()
        print(f'subscribed {self.path}', flush=True)

    @dbus.service.method(CHRC_IFACE)
    def StopNotify(self):
        self.notifying = False
        print(f'unsubscribed {self.path}', flush=True)

    @dbus.service.signal(PROP_IFACE, signature='sa{sv}as')
    def PropertiesChanged(self, interface, changed, invalidated):
        pass

    def send(self, data):
        self.value = [dbus.Byte(b & 0xFF) for b in data]
        self.PropertiesChanged(CHRC_IFACE, {'Value': dbus.Array(self.value, signature='y')}, [])


class Service(dbus.service.Object):
    def __init__(self, bus, index, uuid):
        self.path = f'/org/bluez/oshal/service_v2_{index}'
        self.uuid, self.characteristics = uuid, []
        dbus.service.Object.__init__(self, bus, self.path)

    def add(self, bus, uuid, flags, value, descriptor=None):
        characteristic = Characteristic(bus, self, len(self.characteristics), uuid, flags, value)
        if descriptor:
            characteristic.descriptors.append(Descriptor(bus, characteristic, uuid16('2908'), ['encrypt-read'],
                                                         descriptor))
        self.characteristics.append(characteristic)
        return characteristic

    def properties(self):
        return {SERVICE_IFACE: {'UUID': self.uuid, 'Primary': True,
                                'Characteristics': dbus.Array([dbus.ObjectPath(c.path) for c in self.characteristics],
                                                              signature='o')}}


def uuid16(short):
    return f'0000{short}-0000-1000-8000-00805f9b34fb'


class Application(dbus.service.Object):
    """HID, battery and device information services, in the proven order (BlueZ assigns handles by it)."""
    PATH = '/org/bluez/oshal/app_v2'

    def __init__(self, bus, report_flag):
        dbus.service.Object.__init__(self, bus, self.PATH)
        hid = Service(bus, 0, uuid16('1812'))
        hid.add(bus, uuid16('2a4a'), ['encrypt-read'], [0x11, 0x01, 0x00, 0x03])
        hid.add(bus, uuid16('2a4b'), ['encrypt-read'], REPORT_MAP)
        hid.add(bus, uuid16('2a4e'), ['encrypt-read', 'write-without-response'], [0x01])
        hid.add(bus, uuid16('2a4c'), ['write-without-response'], [0x00])
        self.reports = {
            'keyboard': hid.add(bus, uuid16('2a4d'), ['encrypt-read', report_flag], [0] * 8, [0x01, 0x01]),
            'consumer': hid.add(bus, uuid16('2a4d'), ['encrypt-read', report_flag], [0] * 2, [0x02, 0x01]),
            'mouse': hid.add(bus, uuid16('2a4d'), ['encrypt-read', report_flag], [0] * 4, [0x03, 0x01]),
        }
        battery = Service(bus, 1, uuid16('180f'))
        battery.add(bus, uuid16('2a19'), ['read', 'notify'], [100])
        info = Service(bus, 2, uuid16('180a'))
        info.add(bus, uuid16('2a50'), ['read'], [0x02, 0x15, 0x19, 0xEE, 0xEE, 0x00, 0x01])
        self.services = [hid, battery, info]

    def objects(self):
        for service in self.services:
            yield service
            for characteristic in service.characteristics:
                yield characteristic
                yield from characteristic.descriptors

    @dbus.service.method(OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        return {dbus.ObjectPath(item.path): item.properties() for item in self.objects()}

    def remove(self):
        for item in list(self.objects()) + [self]:
            item.remove_from_connection()


class Peripheral:
    """The keyboard on one adapter: registration, the pairing window, the phones and the reports."""

    def __init__(self, bus, adapter_path):
        self.bus, self.adapter_path = bus, adapter_path
        self.adapter = bus.get_object(BLUEZ, adapter_path)
        self.props = dbus.Interface(self.adapter, PROP_IFACE)
        self.agent = Agent(bus, AGENT_PATH)
        self.advertisement = Advertisement(bus)
        self.app, self.report_flag = None, 'encrypt-notify'
        self.registered = self.advertising = False
        self.problem, self.window_until = None, 0

    def start(self):
        self.props.Set(ADAPTER_IFACE, 'Powered', dbus.Boolean(True))
        self.register(self.report_flag)
        dbus.Interface(self.adapter, AD_MANAGER_IFACE).RegisterAdvertisement(
            dbus.ObjectPath(Advertisement.PATH), {}, reply_handler=self.advertised,
            error_handler=lambda error: self.failed('advertisement', error))

    def register(self, flag):
        self.app, self.report_flag = Application(self.bus, flag), flag
        dbus.Interface(self.adapter, GATT_MANAGER_IFACE).RegisterApplication(
            dbus.ObjectPath(Application.PATH), {}, reply_handler=self.registered_ok, error_handler=self.register_failed)

    def registered_ok(self):
        self.registered = True
        print(f'registered with reports {self.report_flag}', flush=True)

    def register_failed(self, error):
        # A BlueZ that does not know encrypt-notify refuses the flags; the proven plain notify is the fallback.
        if self.report_flag == 'encrypt-notify':
            print(f'encrypt-notify refused ({error}); registering with notify', flush=True)
            self.app.remove()
            self.register('notify')
            return
        self.failed('application', error)

    def advertised(self):
        self.advertising = True
        print('advertising OSHAL-KB', flush=True)

    def failed(self, what, error):
        self.problem = f'BlueZ refused the {what}: {error}'
        print(self.problem, flush=True)

    def adapter_state(self):
        values = self.props.GetAll(ADAPTER_IFACE)
        return {'address': str(values.get('Address', '')), 'name': str(values.get('Alias', '')),
                'powered': bool(values.get('Powered')), 'pairable': bool(values.get('Pairable'))}

    def phones(self):
        """Devices this adapter knows that are paired or connected."""
        manager = dbus.Interface(self.bus.get_object(BLUEZ, '/'), OM_IFACE)
        found = []
        for path, interfaces in manager.GetManagedObjects().items():
            device = interfaces.get(DEVICE_IFACE)
            if not device or str(device.get('Adapter', '')) != self.adapter_path:
                continue
            if device.get('Paired') or device.get('Connected'):
                found.append({'address': str(device.get('Address', '')), 'name': str(device.get('Alias', '')),
                              'paired': bool(device.get('Paired')), 'bonded': bool(device.get('Bonded', False)),
                              'connected': bool(device.get('Connected'))})
        return sorted(found, key=lambda item: (not item['connected'], item['name']))

    def status(self):
        subscribed = {name: report.notifying for name, report in self.app.reports.items()} if self.app else {}
        return {'ok': True, 'registered': self.registered, 'advertising': self.advertising, 'problem': self.problem,
                'reportSecurity': self.report_flag, 'adapter': self.adapter_state(), 'subscribed': subscribed,
                'phones': self.phones(), 'pairWindowSeconds': max(0, int(self.window_until - time.time())),
                'pid': os.getpid()}

    def open_window(self, seconds):
        manager = dbus.Interface(self.bus.get_object(BLUEZ, '/org/bluez'), AGENT_MANAGER_IFACE)
        if self.window_until <= time.time():
            manager.RegisterAgent(dbus.ObjectPath(AGENT_PATH), 'NoInputNoOutput')
            manager.RequestDefaultAgent(dbus.ObjectPath(AGENT_PATH))
        self.props.Set(ADAPTER_IFACE, 'Pairable', dbus.Boolean(True))
        self.window_until = time.time() + seconds
        GLib.timeout_add_seconds(seconds, self.close_window_when_due)
        return {'ok': True, 'pairWindowSeconds': seconds, 'name': 'OSHAL-KB'}

    def close_window_when_due(self):
        if self.window_until and time.time() + 0.5 >= self.window_until:
            self.close_window()
        return False

    def close_window(self):
        if not self.window_until:
            return
        self.window_until = 0
        try:
            dbus.Interface(self.bus.get_object(BLUEZ, '/org/bluez'), AGENT_MANAGER_IFACE).UnregisterAgent(
                dbus.ObjectPath(AGENT_PATH))
        except dbus.exceptions.DBusException as error:
            print(f'unregistering the agent: {error}', flush=True)
        self.props.Set(ADAPTER_IFACE, 'Pairable', dbus.Boolean(False))
        print('pairing window closed', flush=True)

    def listening(self, report):
        """The phones that will receive this report: it is subscribed and a paired phone is connected."""
        if not self.app or not self.app.reports[report].notifying:
            return []
        return [phone['name'] for phone in self.phones() if phone['connected'] and phone['paired']]

    def stop(self):
        self.close_window()
        for call in (lambda: dbus.Interface(self.adapter, AD_MANAGER_IFACE).UnregisterAdvertisement(
                         dbus.ObjectPath(Advertisement.PATH)),
                     lambda: dbus.Interface(self.adapter, GATT_MANAGER_IFACE).UnregisterApplication(
                         dbus.ObjectPath(Application.PATH))):
            try:
                call()
            except dbus.exceptions.DBusException as error:
                print(f'stopping: {error}', flush=True)


class MainThread:
    """D-Bus is not thread safe: every BlueZ call runs on the GLib loop and the socket thread waits for it."""

    @staticmethod
    def call(function, timeout=10):
        done, box = threading.Event(), {}

        def step():
            try:
                box['value'] = function()
            except Exception as error:  # reported to the caller, never swallowed
                box['error'] = error
            done.set()
            return False

        GLib.idle_add(step)
        if not done.wait(timeout):
            raise TimeoutError('the Bluetooth loop did not answer')
        if 'error' in box:
            raise box['error']
        return box.get('value')


class Keyboard:
    """What a request asks for, sent as HID reports, one request at a time."""

    def __init__(self, peripheral):
        self.peripheral, self.lock = peripheral, threading.Lock()

    def report(self, name, data, pause):
        MainThread.call(lambda: self.peripheral.app.reports[name].send(data))
        time.sleep(pause)

    def press(self, modifier, usage):
        self.report('keyboard', [modifier, 0, usage, 0, 0, 0, 0, 0], 0.04)
        self.report('keyboard', [0] * 8, 0.04)

    def consumer(self, usage):
        self.report('consumer', [usage & 0xFF, (usage >> 8) & 0xFF], 0.05)
        self.report('consumer', [0, 0], 0.05)

    def need(self, report):
        phones = MainThread.call(lambda: self.peripheral.listening(report))
        if not phones:
            return None, {'ok': False, 'error': 'no_phone_listening', 'sent': False,
                          'message': 'No phone is listening: pair an iPhone with OSHAL-KB and keep it near this computer.'}
        return phones, None

    def type_text(self, text, enter):
        if not isinstance(text, str) or not text or len(text) > MAX_TEXT:
            return {'ok': False, 'error': 'bad_text', 'message': f'Send between 1 and {MAX_TEXT} characters.'}
        bad = sorted({char for char in text if char not in KEYMAP})
        if bad:
            return {'ok': False, 'error': 'cannot_type', 'sent': False,
                    'message': 'The keyboard types plain keyboard characters only; it cannot type ' + ' '.join(bad[:10])
                               + '. Nothing was sent.'}
        phones, refusal = self.need('keyboard')
        if refusal:
            return refusal
        with self.lock:
            for char in text:
                self.press(*KEYMAP[char])
            if enter:
                self.press(0, 0x28)
        return {'ok': True, 'sent': True, 'typed': len(text), 'phones': phones}

    def key(self, name):
        steps = NAMED_KEYS.get(name)
        if not steps:
            return {'ok': False, 'error': 'unknown_key', 'sent': False,
                    'message': f'There is no {name or "empty"} key. Keys: ' + ', '.join(sorted(NAMED_KEYS))}
        phones, refusal = self.need('consumer' if steps[0][0] == 'consumer' else 'keyboard')
        if refusal:
            return refusal
        with self.lock:
            for step in steps:
                self.consumer(step[1]) if step[0] == 'consumer' else self.press(step[1], step[2])
        return {'ok': True, 'sent': True, 'key': name, 'phones': phones}

    def mouse(self, dx, dy, click):
        dx, dy = max(-2000, min(2000, int(dx))), max(-2000, min(2000, int(dy)))
        phones, refusal = self.need('mouse')
        if refusal:
            return refusal
        with self.lock:
            while dx or dy:
                step_x, step_y = max(-100, min(100, dx)), max(-100, min(100, dy))
                self.report('mouse', [0, step_x, step_y, 0], 0.025)
                dx, dy = dx - step_x, dy - step_y
            if click:
                self.report('mouse', [1, 0, 0, 0], 0.05)
                self.report('mouse', [0, 0, 0, 0], 0.05)
        return {'ok': True, 'sent': True, 'phones': phones}

    def open_app(self, name):
        """Spotlight, the app's name, Enter: how a keyboard opens an app on an iPhone."""
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            return {'ok': False, 'error': 'bad_name', 'message': 'Name the app, for example Notes.'}
        opened = self.key('Spotlight')
        if not opened.get('ok'):
            return opened
        time.sleep(0.8)
        typed = self.type_text(name.strip(), True)
        return dict(typed, opened=name.strip()) if typed.get('ok') else typed


def answer(peripheral, keyboard, request):
    """One request, one reply."""
    op = request.get('op')
    try:
        if op == 'status':
            return MainThread.call(peripheral.status)
        if op == 'devices':
            return {'ok': True, 'phones': MainThread.call(peripheral.phones)}
        if op == 'pair-window':
            seconds = max(30, min(300, int(request.get('seconds', 120))))
            return MainThread.call(lambda: peripheral.open_window(seconds))
        if op == 'type':
            return keyboard.type_text(request.get('text'), str(request.get('enter', '')).lower() in ('true', '1'))
        if op == 'key':
            return keyboard.key(str(request.get('key', '')))
        if op == 'mouse':
            return keyboard.mouse(request.get('dx', 0), request.get('dy', 0),
                                  str(request.get('click', '')).lower() in ('true', '1'))
        if op == 'open':
            return keyboard.open_app(request.get('name'))
        return {'ok': False, 'error': 'unknown_op', 'message': f'There is no {op!r} here.'}
    except (ValueError, TypeError) as error:
        return {'ok': False, 'error': 'bad_argument', 'message': str(error)}
    except (dbus.exceptions.DBusException, TimeoutError) as error:
        print(f'request {op} failed: {error}', flush=True)
        return {'ok': False, 'error': 'ble_failed', 'message': f'Bluetooth refused it: {error}'}


def serve_socket(path, peripheral, keyboard):
    """The private socket: this account only (the folder is 0700, the socket 0600)."""
    if os.path.exists(path):
        os.remove(path)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    os.chmod(path, 0o600)
    server.listen(8)

    def one(connection):
        with connection:
            connection.settimeout(60)
            data = b''
            while not data.endswith(b'\n') and len(data) < 65536:
                part = connection.recv(65536)
                if not part:
                    break
                data += part
            try:
                request = json.loads(data.decode('utf-8'))
                reply = answer(peripheral, keyboard, request) if isinstance(request, dict) else None
            except ValueError:
                reply = None
            reply = reply or {'ok': False, 'error': 'bad_request', 'message': 'Send one JSON object per line.'}
            connection.sendall(json.dumps(reply).encode('utf-8') + b'\n')

    def loop():
        while True:
            connection, _ = server.accept()
            threading.Thread(target=one, args=(connection,), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()


def first_adapter(bus):
    manager = dbus.Interface(bus.get_object(BLUEZ, '/'), OM_IFACE)
    adapters = sorted(str(path) for path, interfaces in manager.GetManagedObjects().items() if ADAPTER_IFACE in interfaces)
    if not adapters:
        raise SystemExit('No Bluetooth adapter on this computer.')
    return adapters[0]


def serve(runtime):
    lock = open(os.path.join(runtime, 'ble.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('already running', flush=True)
        return 0
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    peripheral = Peripheral(bus, first_adapter(bus))
    peripheral.start()
    with open(os.path.join(runtime, 'ble.pid'), 'w') as handle:
        handle.write(str(os.getpid()))
    serve_socket(os.path.join(runtime, 'ble.sock'), peripheral, Keyboard(peripheral))
    loop = GLib.MainLoop()

    def quit_loop():
        peripheral.stop()
        loop.quit()
        return False

    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, quit_loop)
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGINT, quit_loop)
    print(f'serving on {runtime}', flush=True)
    loop.run()
    for name in ('ble.sock', 'ble.pid'):
        try:
            os.remove(os.path.join(runtime, name))
        except OSError:
            pass
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != 'serve' or not os.path.isdir(sys.argv[2]):
        sys.exit('usage: oshal_phone_ble.py serve <runtime folder>')
    sys.exit(serve(sys.argv[2]))
