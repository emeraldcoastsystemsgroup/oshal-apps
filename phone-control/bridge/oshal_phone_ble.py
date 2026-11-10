#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: resident BlueZ BLE HID keyboard, consumer control and mouse peripheral (OSHAL-KB) over a private 0600 unix socket.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: forget removes one paired device from this computer's adapter (BlueZ RemoveDevice).
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: mark paired devices Trusted=True for automatic BLE HID reconnection, keep advertisement alive, detect AssistiveTouch-off state, and add calibrated tap, swipe, drag and scroll HID mouse operations with unchanged REPORT_MAP.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: add Generic Attribute Service 0x1801 (Service Changed 0x2A05) with BlueZ registration fallback, actively reconnect bonded devices via BlueZ Device1.Connect() on startup/demand/ble-sync, center pointer on sync, and eliminate BLE HID mouse report flooding for smooth iOS AssistiveTouch swipes.
# 5 | maintainer@emeraldcoastsystemsgroup.com | 1.5.4: the pairing agent no longer says yes by itself (open-work audit 2026-11-10; Orbit Add hub section 2.6 items 1-2). It answered every request with PIN 0000 / passkey 0 / confirm and marked the device Trusted, and every paired or bonded device on the adapter (the person's own mouse and headphones too) was marked Trusted on start, on each device list and when the window closed. Now each pairing request is held (PairingGate) until the person answers it with pair-answer, no answer in OSHAL_BLE_PAIR_ANSWER_S (30) seconds rejects it, only one Allow per window (the window then closes), a pairing BlueZ completes without asking the agent (Just Works with NoInputNoOutput) is asked about the same way after the fact and removed unless allowed, a device that paired in the window without an Allow is removed when the window closes, and only allowed devices (ble-allowed.json, 0600, beside ble-profiles.json) are trusted or reconnected; keep adds a device that was paired before.
"""Resident BLE HID peripheral for phone-control (`python3 -I oshal_phone_ble.py serve <runtime folder>`)."""

import fcntl, hashlib, json, os, re, signal, socket, sys, threading, time
import dbus, dbus.exceptions, dbus.mainloop.glib, dbus.service
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
ADDRESS_RE = re.compile(r'^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$')
MAX_TEXT = 300
with open(os.path.abspath(__file__), 'rb') as _own:
    CODE_SHA256 = hashlib.sha256(_own.read()).hexdigest()

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
    keys = {' ': (0, 0x2C), '\n': (0, 0x28), '\t': (0, 0x2B)}
    for idx, ch in enumerate('abcdefghijklmnopqrstuvwxyz'):
        keys[ch], keys[ch.upper()] = (0, 0x04 + idx), (0x02, 0x04 + idx)
    for idx, ch in enumerate('1234567890'):
        keys[ch] = (0, 0x1E + idx)
    for idx, ch in enumerate('!@#$%^&*()'):
        keys[ch] = (0x02, 0x1E + idx)
    plain = {'-': 0x2D, '=': 0x2E, '[': 0x2F, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38}
    shifted = {'_': 0x2D, '+': 0x2E, '{': 0x2F, '}': 0x30, '|': 0x31, ':': 0x33, '"': 0x34, '~': 0x35, '<': 0x36, '>': 0x37, '?': 0x38}
    keys.update({ch: (0, code) for ch, code in plain.items()})
    keys.update({ch: (0x02, code) for ch, code in shifted.items()})
    return keys


def bool_arg(value):
    return str(value or '').lower() in ('true', '1')


def ble_profiles_path():
    base = os.environ.get('XDG_STATE_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'state')
    return os.path.join(base, 'oshal-phone-bridge', 'ble-profiles.json')


def ble_allowed_path():
    return os.path.join(os.path.dirname(ble_profiles_path()), 'ble-allowed.json')


def answer_seconds():
    try:
        return max(1.0, min(120.0, float(os.environ.get('OSHAL_BLE_PAIR_ANSWER_S', '30'))))
    except ValueError:
        return 30.0


class PairingGate:
    """Holds each pairing request until the person answers it, and keeps the devices they allowed."""

    def __init__(self, path, clock=time.time, limit=None):
        self.path, self.clock = path, clock
        self.limit = answer_seconds() if limit is None else limit
        self.pending, self.granted = {}, False
        try:
            with open(path, 'r', encoding='utf-8') as handle:
                listed = json.load(handle).get('allowed', [])
        except (OSError, ValueError, AttributeError):
            listed = []
        self.allowed = {str(a).upper() for a in listed if ADDRESS_RE.match(str(a))}

    def _save(self):
        os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
        part = self.path + '.part'
        fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump({'allowed': sorted(self.allowed)}, handle)
        os.chmod(part, 0o600)
        os.replace(part, self.path)

    def is_allowed(self, address):
        return str(address or '').upper() in self.allowed

    def allow(self, address):
        self.allowed.add(address.upper())
        self._save()

    def forget(self, address):
        if self.is_allowed(address):
            self.allowed.discard(str(address).upper())
            self._save()

    def open(self):
        self.granted = False

    def hold(self, address, name, passkey, accept, reject, window_open):
        address = str(address or '').upper()
        if self.is_allowed(address):
            accept()
            return 'allowed'
        if not window_open or self.granted or not ADDRESS_RE.match(address) or (address not in self.pending and len(self.pending) >= 4):
            reject()
            return 'refused'
        earlier = self.pending.pop(address, None)
        if earlier:
            earlier['reject']()
        self.pending[address] = {'name': str(name or '')[:80], 'passkey': passkey, 'until': self.clock() + self.limit,
                                 'accept': accept, 'reject': reject}
        return 'held'

    def answer(self, address, allow):
        address = str(address or '').strip().upper()
        if not ADDRESS_RE.match(address):
            return {'ok': False, 'error': 'bad_address', 'message': 'Name the device by its Bluetooth address.'}
        self.expire()
        held = self.pending.pop(address, None)
        if not held:
            return {'ok': False, 'error': 'no_request', 'message': 'No device is waiting to pair with that address now.'}
        if not bool_arg(allow):
            held['reject']()
            return {'ok': True, 'answered': 'rejected', 'address': address}
        self.allow(address)
        self.granted = True
        held['accept']()
        self.reject_all()
        return {'ok': True, 'answered': 'allowed', 'address': address}

    def expire(self):
        now = self.clock()
        for address in [a for a, held in self.pending.items() if now >= held['until']]:
            self.pending.pop(address)['reject']()
        return False

    def reject_all(self):
        for address in list(self.pending):
            self.pending.pop(address)['reject']()

    def requests(self):
        now = self.clock()
        return [dict({'address': a, 'name': h['name'], 'secondsLeft': max(0, int(h['until'] - now))},
                     **({'passkey': f"{int(h['passkey']):06d}"} if h['passkey'] is not None else {}))
                for a, h in sorted(self.pending.items())]


def span_for(landscape=False, span_x=None, span_y=None, address=None, phones=None):
    if span_x is not None and span_y is not None:
        return max(100, min(2400, int(span_x))), max(100, min(2400, int(span_y)))
    is_land = bool_arg(landscape)
    try:
        with open(ble_profiles_path(), 'r', encoding='utf-8') as handle:
            profiles = json.load(handle)
    except (OSError, ValueError):
        profiles = {}
    addrs = [str(p.get('address') if isinstance(p, dict) else '').upper() for p in (phones or [])]
    keys = [str(address or '').strip().upper()] + addrs + ['DEFAULT']
    for key in keys:
        prof = profiles.get(key) if key and isinstance(profiles, dict) else None
        if isinstance(prof, dict) and prof.get('span_x') and prof.get('span_y'):
            sx, sy = max(100, min(2400, int(prof['span_x']))), max(100, min(2400, int(prof['span_y'])))
            return (max(sx, sy), min(sx, sy)) if is_land else (min(sx, sy), max(sx, sy))
    return (932, 430) if is_land else (430, 932)


KEYMAP = build_keymap()
NAMED_KEYS = {
    'Home': [('consumer', 0x0040), ('key', 0x08, 0x0B)],
    'Spotlight': [('consumer', 0x0221), ('key', 0x08, 0x2C)],
    'VolumeUp': [('consumer', 0x00E9)],
    'VolumeDown': [('consumer', 0x00EA)],
    'Enter': [('key', 0, 0x28)],
    'Select': [('consumer', 0x0041), ('key', 0, 0x28)],
    'Back': [('consumer', 0x0224), ('key', 0, 0x29)],
    'Menu': [('consumer', 0x0040), ('key', 0, 0x65)],
    'PlayPause': [('consumer', 0x00CD)],
    'Escape': [('key', 0, 0x29)],
    'Backspace': [('key', 0, 0x2A)],
    'Tab': [('key', 0, 0x2B)],
    'Right': [('key', 0, 0x4F)],
    'Left': [('key', 0, 0x50)],
    'Down': [('key', 0, 0x51)],
    'Up': [('key', 0, 0x52)],
}


class Rejected(dbus.exceptions.DBusException):
    _dbus_error_name = 'org.bluez.Error.Rejected'


class Agent(dbus.service.Object):
    """Asks the person about every pairing: nothing is answered or trusted until they allow it (PairingGate)."""

    def __init__(self, bus, path, peripheral=None):
        self.bus, self.peripheral = bus, peripheral
        dbus.service.Object.__init__(self, bus, path)

    def _ask(self, device, passkey, ok, err, value=None):
        def accept():
            self.peripheral.trust(device)
            ok() if value is None else ok(value)
        self.peripheral.ask(device, passkey, accept, lambda: err(Rejected('The person did not allow this pairing.')))

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='os', out_signature='', async_callbacks=('ok', 'err'))
    def AuthorizeService(self, device, uuid, ok, err):
        self._ask(device, None, ok, err)

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='s', async_callbacks=('ok', 'err'))
    def RequestPinCode(self, device, ok, err):
        self._ask(device, None, ok, err, '0000')

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='u', async_callbacks=('ok', 'err'))
    def RequestPasskey(self, device, ok, err):
        self._ask(device, None, ok, err, dbus.UInt32(0))

    @dbus.service.method(AGENT_IFACE, in_signature='ouq', out_signature='')
    def DisplayPasskey(self, device, passkey, entered):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='os', out_signature='')
    def DisplayPinCode(self, device, pincode):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='ou', out_signature='', async_callbacks=('ok', 'err'))
    def RequestConfirmation(self, device, passkey, ok, err):
        self._ask(device, int(passkey), ok, err)

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='', async_callbacks=('ok', 'err'))
    def RequestAuthorization(self, device, ok, err):
        self._ask(device, None, ok, err)

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Cancel(self):
        pass


class Advertisement(dbus.service.Object):
    PATH = '/org/bluez/oshal/advertisement0'

    def __init__(self, bus, peripheral=None):
        self.peripheral = peripheral
        dbus.service.Object.__init__(self, bus, self.PATH)

    @dbus.service.method(PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return {'Type': 'peripheral', 'ServiceUUIDs': dbus.Array(['1812'], signature='s'),
                'LocalName': dbus.String('OSHAL-KB'), 'Appearance': dbus.UInt16(0x03C1)}

    @dbus.service.method(AD_IFACE, in_signature='', out_signature='')
    def Release(self):
        if self.peripheral is not None:
            self.peripheral.advertising = False


class Descriptor(dbus.service.Object):
    def __init__(self, bus, chrc, uuid, flags, value):
        self.path, self.chrc, self.uuid, self.flags = chrc.path + '/desc0', chrc, uuid, flags
        self.value = [dbus.Byte(b) for b in value]
        dbus.service.Object.__init__(self, bus, self.path)

    def properties(self):
        return {DESC_IFACE: {'Characteristic': dbus.ObjectPath(self.chrc.path), 'UUID': self.uuid, 'Flags': self.flags}}

    @dbus.service.method(PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return self.properties()[DESC_IFACE]

    @dbus.service.method(DESC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        return self.value[int(options.get('offset', 0)):]


class Characteristic(dbus.service.Object):
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
        if self.uuid == uuid16('2a05'):
            self.send([0x01, 0x00, 0xFF, 0xFF])

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


def uuid16(short):
    return f'0000{short}-0000-1000-8000-00805f9b34fb'


class Service(dbus.service.Object):
    def __init__(self, bus, index, uuid):
        self.path, self.uuid, self.characteristics = f'/org/bluez/oshal/service_v2_{index}', uuid, []
        dbus.service.Object.__init__(self, bus, self.path)

    def add(self, bus, uuid, flags, value, descriptor=None):
        chrc = Characteristic(bus, self, len(self.characteristics), uuid, flags, value)
        if descriptor:
            chrc.descriptors.append(Descriptor(bus, chrc, uuid16('2908'), ['encrypt-read'], descriptor))
        self.characteristics.append(chrc)
        return chrc

    def properties(self):
        return {SERVICE_IFACE: {'UUID': self.uuid, 'Primary': True,
                                'Characteristics': dbus.Array([dbus.ObjectPath(c.path) for c in self.characteristics], signature='o')}}


class Application(dbus.service.Object):
    PATH = '/org/bluez/oshal/app_v2'

    def __init__(self, bus, report_flag, include_gatt=True):
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
        self.service_changed = None
        if include_gatt:
            gatt = Service(bus, 3, uuid16('1801'))
            self.service_changed = gatt.add(bus, uuid16('2a05'), ['indicate'], [0x01, 0x00, 0xFF, 0xFF])
            self.services = [gatt, hid, battery, info]
        else:
            self.services = [hid, battery, info]

    def objects(self):
        for svc in self.services:
            yield svc
            for chrc in svc.characteristics:
                yield chrc
                yield from chrc.descriptors

    @dbus.service.method(OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        return {dbus.ObjectPath(item.path): item.properties() for item in self.objects()}

    def remove(self):
        for item in list(self.objects()) + [self]:
            item.remove_from_connection()


class Peripheral:
    def __init__(self, bus, adapter_path):
        self.bus, self.adapter_path = bus, adapter_path
        self.adapter = bus.get_object(BLUEZ, adapter_path)
        self.props = dbus.Interface(self.adapter, PROP_IFACE)
        self.agent = Agent(bus, AGENT_PATH, self)
        self.gate, self.paired_at_open = PairingGate(ble_allowed_path()), set()
        self.advertisement = Advertisement(bus, self)
        self.app, self.report_flag, self.include_gatt = None, 'encrypt-notify', True
        self.registered = self.advertising = self.ad_pending = False
        self.problem, self.window_until = None, 0

    def start(self):
        self.props.Set(ADAPTER_IFACE, 'Powered', dbus.Boolean(True))
        self.register(self.report_flag)
        self.ensure_advertising(force=True)

    def ensure_advertising(self, force=False):
        if self.advertising or self.ad_pending or (not force and not self.registered):
            return
        self.ad_pending = True
        try:
            dbus.Interface(self.adapter, AD_MANAGER_IFACE).RegisterAdvertisement(
                dbus.ObjectPath(Advertisement.PATH), {}, reply_handler=self.advertised, error_handler=self.ad_failed)
        except dbus.exceptions.DBusException as error:
            self.ad_failed(error)

    def ad_failed(self, error):
        self.ad_pending = False
        if 'AlreadyExists' in str(error):
            self.advertising = True
            return
        self.failed('advertisement', error)

    def devices(self):
        try:
            objects = dbus.Interface(self.bus.get_object(BLUEZ, '/'), OM_IFACE).GetManagedObjects()
        except dbus.exceptions.DBusException:
            return {}
        return {str(path): ifaces[DEVICE_IFACE] for path, ifaces in objects.items()
                if DEVICE_IFACE in ifaces and str(ifaces[DEVICE_IFACE].get('Adapter', '')) == self.adapter_path}

    def trust(self, device):
        try:
            dbus.Interface(self.bus.get_object(BLUEZ, device), PROP_IFACE).Set(DEVICE_IFACE, 'Trusted', dbus.Boolean(True))
        except dbus.exceptions.DBusException:
            pass

    def ask(self, device, passkey, accept, reject):
        dev = self.devices().get(str(device), {})
        held = self.gate.hold(str(dev.get('Address', '')), str(dev.get('Alias', dev.get('Name', ''))), passkey,
                              accept, reject, self.window_until > time.time())
        print(f'pairing request {device}: {held}', flush=True)
        if held == 'held':
            GLib.timeout_add(int(self.gate.limit * 1000) + 50, self.gate.expire)

    def remove_path(self, path):
        try:
            dbus.Interface(self.adapter, ADAPTER_IFACE).RemoveDevice(dbus.ObjectPath(path))
            print(f'removed {path}: nobody allowed its pairing', flush=True)
        except dbus.exceptions.DBusException as err:
            print(f'remove {path}: {err}', flush=True)

    def watch_window(self):
        """A pairing BlueZ completes without asking the agent (Just Works) is asked about after the fact."""
        if self.window_until <= time.time():
            return False
        for path, dev in self.devices().items():
            addr = str(dev.get('Address', '')).upper()
            if not (dev.get('Paired') or dev.get('Bonded')) or addr in self.paired_at_open or addr in self.gate.pending \
                    or self.gate.is_allowed(addr):
                continue
            held = self.gate.hold(addr, str(dev.get('Alias', dev.get('Name', ''))), None, lambda p=path: self.trust(p),
                                  lambda p=path: self.remove_path(p), True)
            print(f'paired without asking {path}: {held}', flush=True)
            if held == 'held':
                GLib.timeout_add(int(self.gate.limit * 1000) + 50, self.gate.expire)
        return True

    def answer_pairing(self, address, allow):
        reply = self.gate.answer(address, allow)
        if reply.get('answered') == 'allowed':
            GLib.timeout_add_seconds(5, lambda: self.close_window() and False)
        return reply

    def keep(self, address):
        want = str(address or '').strip().upper()
        if not ADDRESS_RE.match(want):
            return {'ok': False, 'error': 'bad_address', 'message': 'Name the device by its Bluetooth address.'}
        for path, dev in self.devices().items():
            if str(dev.get('Address', '')).upper() == want and (dev.get('Paired') or dev.get('Bonded')):
                self.gate.allow(want)
                self.trust(path)
                return {'ok': True, 'kept': want}
        return {'ok': False, 'error': 'not_paired', 'message': 'That device is not paired with this computer.'}

    def connect_bonded(self, address=None):
        want = str(address or '').strip().upper()
        if want and not ADDRESS_RE.match(want):
            return {'ok': False, 'error': 'bad_address', 'message': 'Name the device by its Bluetooth address.'}
        try:
            objects = dbus.Interface(self.bus.get_object(BLUEZ, '/'), OM_IFACE).GetManagedObjects()
        except dbus.exceptions.DBusException as err:
            return {'ok': False, 'error': 'ble_failed', 'message': f'BlueZ did not list devices: {err}'}
        matched, attempted = [], []
        for path, ifaces in objects.items():
            dev = ifaces.get(DEVICE_IFACE)
            if not dev or str(dev.get('Adapter', '')) != self.adapter_path:
                continue
            addr = str(dev.get('Address', '')).upper()
            if not (dev.get('Paired') or dev.get('Bonded')) or (want and addr != want):
                continue
            if not self.gate.is_allowed(addr):
                if want:
                    return {'ok': False, 'error': 'not_allowed', 'message': 'That device was paired before oshal asked. Press Keep next to it in Phone & Device Control if it is yours.'}
                continue
            matched.append(addr)
            obj = self.bus.get_object(BLUEZ, path)
            if not dev.get('Connected'):
                attempted.append(addr)
                try:
                    dbus.Interface(obj, DEVICE_IFACE).Connect(
                        reply_handler=lambda p=path: print(f'connected {p}', flush=True),
                        error_handler=lambda e, p=path: print(f'connect {p}: {e}', flush=True))
                except dbus.exceptions.DBusException as err:
                    print(f'connect {path}: {err}', flush=True)
        return {'ok': True, 'matched': matched, 'attempted': attempted}

    def _startup_connect(self):
        self.connect_bonded()
        return False

    def register(self, flag):
        self.app, self.report_flag = Application(self.bus, flag, include_gatt=self.include_gatt), flag
        dbus.Interface(self.adapter, GATT_MANAGER_IFACE).RegisterApplication(
            dbus.ObjectPath(Application.PATH), {}, reply_handler=self.registered_ok, error_handler=self.register_failed)

    def registered_ok(self):
        self.registered = True
        print(f'registered with reports {self.report_flag} (gatt={self.include_gatt})', flush=True)
        GLib.timeout_add(1000, self._startup_connect)

    def register_failed(self, error):
        if self.include_gatt:
            self.app.remove()
            self.include_gatt = False
            self.register(self.report_flag)
            return
        if self.report_flag == 'encrypt-notify':
            self.app.remove()
            self.register('notify')
            return
        self.failed('application', error)

    def advertised(self):
        self.ad_pending, self.advertising = False, True
        print('advertising OSHAL-KB', flush=True)

    def failed(self, what, error):
        self.problem = f'BlueZ refused the {what}: {error}'
        print(self.problem, flush=True)

    def adapter_state(self):
        vals = self.props.GetAll(ADAPTER_IFACE)
        return {'address': str(vals.get('Address', '')), 'name': str(vals.get('Alias', '')),
                'powered': bool(vals.get('Powered')), 'pairable': bool(vals.get('Pairable'))}

    def phones(self):
        mgr = dbus.Interface(self.bus.get_object(BLUEZ, '/'), OM_IFACE)
        found = []
        for _, ifaces in mgr.GetManagedObjects().items():
            dev = ifaces.get(DEVICE_IFACE)
            if dev and str(dev.get('Adapter', '')) == self.adapter_path and (dev.get('Paired') or dev.get('Connected')):
                found.append({'address': str(dev.get('Address', '')), 'name': str(dev.get('Alias', '')),
                              'paired': bool(dev.get('Paired')), 'bonded': bool(dev.get('Bonded', False)),
                              'trusted': bool(dev.get('Trusted', False)), 'connected': bool(dev.get('Connected')),
                              'allowed': self.gate.is_allowed(dev.get('Address', ''))})
        return sorted(found, key=lambda item: (not item['connected'], item['name']))

    def pairing(self):
        self.gate.expire()
        return self.gate.requests()

    def forget(self, address):
        if not isinstance(address, str) or not ADDRESS_RE.match(address):
            return {'ok': False, 'error': 'bad_address', 'message': 'Name the device by its Bluetooth address.'}
        mgr = dbus.Interface(self.bus.get_object(BLUEZ, '/'), OM_IFACE)
        for path, ifaces in mgr.GetManagedObjects().items():
            dev = ifaces.get(DEVICE_IFACE)
            if dev and str(dev.get('Adapter', '')) == self.adapter_path and str(dev.get('Address', '')).upper() == address.upper():
                dbus.Interface(self.adapter, ADAPTER_IFACE).RemoveDevice(path)
                self.gate.forget(address)
                return {'ok': True, 'removed': address}
        return {'ok': False, 'error': 'not_paired', 'message': 'That device is not paired with this computer.'}

    def status(self):
        self.ensure_advertising()
        sub = {name: rep.notifying for name, rep in self.app.reports.items()} if self.app else {}
        return {'ok': True, 'registered': self.registered, 'advertising': self.advertising, 'problem': self.problem,
                'reportSecurity': self.report_flag, 'adapter': self.adapter_state(), 'subscribed': sub,
                'phones': self.phones(), 'pairing': self.pairing(), 'pairWindowSeconds': max(0, int(self.window_until - time.time())),
                'pid': os.getpid(), 'code': CODE_SHA256}

    def open_window(self, seconds):
        mgr = dbus.Interface(self.bus.get_object(BLUEZ, '/org/bluez'), AGENT_MANAGER_IFACE)
        if self.window_until <= time.time():
            mgr.RegisterAgent(dbus.ObjectPath(AGENT_PATH), 'NoInputNoOutput')
            mgr.RequestDefaultAgent(dbus.ObjectPath(AGENT_PATH))
            self.gate.open()
            self.paired_at_open = {str(d.get('Address', '')).upper() for d in self.devices().values() if d.get('Paired') or d.get('Bonded')}
        self.props.Set(ADAPTER_IFACE, 'Pairable', dbus.Boolean(True))
        self.ensure_advertising()
        if self.window_until <= time.time():
            GLib.timeout_add(1000, self.watch_window)
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
        self.gate.reject_all()
        for path, dev in self.devices().items():
            addr = str(dev.get('Address', '')).upper()
            if (dev.get('Paired') or dev.get('Bonded')) and addr not in self.paired_at_open and not self.gate.is_allowed(addr):
                try:
                    dbus.Interface(self.adapter, ADAPTER_IFACE).RemoveDevice(dbus.ObjectPath(path))
                    print(f'removed {addr}: it paired in the window without an Allow', flush=True)
                except dbus.exceptions.DBusException:
                    pass
        try:
            dbus.Interface(self.bus.get_object(BLUEZ, '/org/bluez'), AGENT_MANAGER_IFACE).UnregisterAgent(dbus.ObjectPath(AGENT_PATH))
        except dbus.exceptions.DBusException:
            pass
        self.props.Set(ADAPTER_IFACE, 'Pairable', dbus.Boolean(False))
        self.ensure_advertising()

    def listening(self, report):
        self.ensure_advertising()
        if not self.app or not self.app.reports[report].notifying:
            return []
        return [phone['name'] for phone in self.phones() if phone['connected'] and phone['paired']]

    def stop(self):
        self.close_window()
        for call in (lambda: dbus.Interface(self.adapter, AD_MANAGER_IFACE).UnregisterAdvertisement(dbus.ObjectPath(Advertisement.PATH)),
                     lambda: dbus.Interface(self.adapter, GATT_MANAGER_IFACE).UnregisterApplication(dbus.ObjectPath(Application.PATH))):
            try:
                call()
            except dbus.exceptions.DBusException:
                pass


class MainThread:
    @staticmethod
    def call(fn, timeout=10):
        done, box = threading.Event(), {}

        def step():
            try:
                box['value'] = fn()
            except Exception as err:
                box['error'] = err
            done.set()
            return False

        GLib.idle_add(step)
        if not done.wait(timeout):
            raise TimeoutError('the Bluetooth loop did not answer')
        if 'error' in box:
            raise box['error']
        return box.get('value')


class Keyboard:
    def __init__(self, peripheral):
        self.peripheral, self.lock = peripheral, threading.Lock()
        self.ptr_x, self.ptr_y, self.homed_at = 0.0, 0.0, 0.0

    def report(self, name, data, pause):
        MainThread.call(lambda: self.peripheral.app.reports[name].send(data))
        time.sleep(pause)

    def press(self, modifier, usage):
        self.report('keyboard', [modifier, 0, usage, 0, 0, 0, 0, 0], 0.04)
        self.report('keyboard', [0] * 8, 0.04)

    def consumer(self, usage):
        self.report('consumer', [usage & 0xFF, (usage >> 8) & 0xFF], 0.05)
        self.report('consumer', [0, 0], 0.05)

    def ensure_listening(self, report, address=None, wait_s=None):
        wait = float(os.environ.get('OSHAL_BLE_CONNECT_WAIT_S', '3.2')) if wait_s is None else max(0.0, float(wait_s))
        phones, kb_on, paired = MainThread.call(lambda: (
            self.peripheral.listening(report), bool(self.peripheral.listening('keyboard')), bool(self.peripheral.phones())))
        if phones or not paired or wait <= 0:
            return phones, kb_on
        MainThread.call(lambda: self.peripheral.connect_bonded(address))
        deadline = time.time() + wait
        while time.time() < deadline:
            time.sleep(0.15)
            phones, kb_on = MainThread.call(lambda: (
                self.peripheral.listening(report), bool(self.peripheral.listening('keyboard'))))
            if phones:
                break
        return phones, kb_on

    def need(self, report, address=None):
        phones, kb_on = self.ensure_listening(report, address=address)
        if not phones:
            if report == 'mouse' and kb_on:
                return None, {'ok': False, 'error': 'assistive_touch_off', 'sent': False,
                              'message': 'Turn on AssistiveTouch on your iPhone (Settings → Accessibility → Touch → AssistiveTouch) so Bluetooth taps and swipes work.'}
            return None, {'ok': False, 'error': 'no_phone_listening', 'sent': False,
                          'message': 'No phone is listening: unlock your iPhone with Bluetooth on (or tap OSHAL-KB in Settings → Bluetooth) and press Sync.'}
        return phones, None

    def home_pointer(self):
        for _ in range(12):
            self.report('mouse', [0, (-110) & 0xFF, (-110) & 0xFF, 0], 0.016)
        self.ptr_x, self.ptr_y, self.homed_at = 0.0, 0.0, time.time()

    def ensure_homed(self, force=False):
        if force or self.homed_at == 0.0 or (time.time() - self.homed_at) > 25.0:
            self.home_pointer()

    def move_to(self, tx, ty):
        cx, cy, tx, ty = int(round(self.ptr_x)), int(round(self.ptr_y)), int(round(tx)), int(round(ty))
        while cx != tx or cy != ty:
            sx, sy = max(-75, min(75, tx - cx)), max(-75, min(75, ty - cy))
            self.report('mouse', [0, sx & 0xFF, sy & 0xFF, 0], 0.016)
            cx, cy = cx + sx, cy + sy
        self.ptr_x, self.ptr_y = float(tx), float(ty)

    def _hold_path(self, x1, y1, x2, y2, steps, pause, hold_start, hold_end):
        self.ensure_homed(False)
        self.move_to(x1, y1)
        self.report('mouse', [1, 0, 0, 0], hold_start)
        cx, cy = x1, y1
        for idx in range(1, steps + 1):
            tx, ty = round(x1 + (x2 - x1) * idx / steps), round(y1 + (y2 - y1) * idx / steps)
            sx, sy = max(-127, min(127, tx - cx)), max(-127, min(127, ty - cy))
            self.report('mouse', [1, sx & 0xFF, sy & 0xFF, 0], pause)
            cx, cy = cx + sx, cy + sy
        if hold_end > 0:
            self.report('mouse', [1, 0, 0, 0], hold_end)
        self.report('mouse', [0, 0, 0, 0], 0.035)
        self.ptr_x, self.ptr_y = float(cx), float(cy)
        return cx, cy

    def sync(self, address=None, wait_s=None):
        want = str(address or '').strip().upper()
        if want and not ADDRESS_RE.match(want):
            return {'ok': False, 'error': 'bad_address', 'message': 'Name the device by its Bluetooth address.'}
        conn_info = MainThread.call(lambda: self.peripheral.connect_bonded(want or None))
        if not conn_info.get('ok'):
            return conn_info
        wait = float(os.environ.get('OSHAL_BLE_SYNC_WAIT_S', '4.0')) if wait_s is None else max(0.0, min(10.0, float(wait_s)))
        deadline = time.time() + wait
        st = MainThread.call(self.peripheral.status)
        while time.time() < deadline:
            sub = st.get('subscribed', {})
            targets = [p for p in st.get('phones', []) if not want or p['address'].upper() == want]
            if any(p.get('connected') for p in targets) and sub.get('mouse'):
                break
            if not targets:
                break
            time.sleep(0.15)
            st = MainThread.call(self.peripheral.status)
        phones, sub = st.get('phones', []), st.get('subscribed', {})
        targets = [p for p in phones if not want or p['address'].upper() == want]
        if not targets:
            return {'ok': False, 'error': 'not_paired', 'connected': False, 'subscribed': sub, 'phones': phones,
                    'message': 'No paired iPhone was found on this computer. Open Add a device → Pair an iPhone.'}
        connected = any(p.get('connected') for p in targets)
        if connected and sub.get('mouse'):
            sx, sy = span_for(False, None, None, want or targets[0]['address'], targets)
            with self.lock:
                self.home_pointer()
                self.move_to(sx // 2, sy // 2)
            return {'ok': True, 'connected': True, 'subscribed': sub, 'phones': phones, 'pointerCentered': True,
                    'assistiveTouchOff': False, 'message': 'Bluetooth synced and pointer centered on your iPhone.'}
        if connected and sub.get('keyboard'):
            return {'ok': True, 'connected': True, 'subscribed': sub, 'phones': phones, 'pointerCentered': False,
                    'assistiveTouchOff': True,
                    'message': 'Bluetooth keyboard is connected, but AssistiveTouch is off — enable Settings → Accessibility → Touch → AssistiveTouch on your iPhone.'}
        return {'ok': True, 'connected': connected, 'subscribed': sub, 'phones': phones, 'pointerCentered': False,
                'assistiveTouchOff': False,
                'message': 'Reconnecting OSHAL-KB… Keep your iPhone unlocked with Bluetooth on (or tap OSHAL-KB once in Settings → Bluetooth) and press Sync again.'}

    def type_text(self, text, enter, address=None):
        if not isinstance(text, str) or not text or len(text) > MAX_TEXT:
            return {'ok': False, 'error': 'bad_text', 'message': f'Send between 1 and {MAX_TEXT} characters.'}
        bad = sorted({ch for ch in text if ch not in KEYMAP})
        if bad:
            return {'ok': False, 'error': 'cannot_type', 'sent': False,
                    'message': 'The keyboard types plain keyboard characters only; it cannot type ' + ' '.join(bad[:10]) + '. Nothing was sent.'}
        phones, refusal = self.need('keyboard', address=address)
        if refusal:
            return refusal
        with self.lock:
            for ch in text:
                self.press(*KEYMAP[ch])
            if enter:
                self.press(0, 0x28)
        return {'ok': True, 'sent': True, 'typed': len(text), 'phones': phones}

    def key(self, name, address=None):
        steps = NAMED_KEYS.get(name)
        if not steps:
            return {'ok': False, 'error': 'unknown_key', 'sent': False,
                    'message': f'There is no {name or "empty"} key. Keys: ' + ', '.join(sorted(NAMED_KEYS))}
        phones, refusal = self.need('consumer' if steps[0][0] == 'consumer' else 'keyboard', address=address)
        if refusal:
            return refusal
        with self.lock:
            for step in steps:
                self.consumer(step[1]) if step[0] == 'consumer' else self.press(step[1], step[2])
        return {'ok': True, 'sent': True, 'key': name, 'phones': phones}

    def mouse(self, dx, dy, click, rehome=False, address=None):
        dx, dy = max(-2000, min(2000, int(dx))), max(-2000, min(2000, int(dy)))
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        sx, sy = span_for(False, None, None, address, phones)
        with self.lock:
            if bool_arg(rehome):
                self.home_pointer()
                self.move_to(sx // 2, sy // 2)
            while dx or dy:
                step_x, step_y = max(-75, min(75, dx)), max(-75, min(75, dy))
                self.report('mouse', [0, step_x & 0xFF, step_y & 0xFF, 0], 0.016)
                dx, dy = dx - step_x, dy - step_y
                self.ptr_x, self.ptr_y = max(0.0, self.ptr_x + step_x), max(0.0, self.ptr_y + step_y)
            if click:
                self.report('mouse', [1, 0, 0, 0], 0.05)
                self.report('mouse', [0, 0, 0, 0], 0.05)
        return {'ok': True, 'sent': True, 'phones': phones}

    def home(self, address=None):
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        with self.lock:
            self.home_pointer()
        return {'ok': True, 'sent': True, 'homed': True, 'phones': phones}

    def move(self, nx, ny, landscape=False, rehome=False, span_x=None, span_y=None, address=None):
        nx, ny = max(0.0, min(1.0, float(nx))), max(0.0, min(1.0, float(ny)))
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        sx, sy = span_for(landscape, span_x, span_y, address, phones)
        tx, ty = round(nx * sx), round(ny * sy)
        with self.lock:
            self.ensure_homed(bool_arg(rehome))
            self.move_to(tx, ty)
        return {'ok': True, 'sent': True, 'moved': [tx, ty], 'span': [sx, sy], 'phones': phones}

    def tap(self, nx, ny, landscape=False, rehome=False, span_x=None, span_y=None, address=None):
        nx, ny = max(0.0, min(1.0, float(nx))), max(0.0, min(1.0, float(ny)))
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        sx, sy = span_for(landscape, span_x, span_y, address, phones)
        tx, ty = round(nx * sx), round(ny * sy)
        with self.lock:
            self.ensure_homed(bool_arg(rehome))
            self.move_to(tx, ty)
            self.report('mouse', [1, 0, 0, 0], 0.045)
            self.report('mouse', [0, 0, 0, 0], 0.030)
        return {'ok': True, 'sent': True, 'tapped': [tx, ty], 'span': [sx, sy], 'phones': phones}

    def swipe(self, nx1, ny1, nx2, ny2, ms=260, landscape=False, span_x=None, span_y=None, address=None):
        c = [max(0.0, min(1.0, float(v))) for v in (nx1, ny1, nx2, ny2)]
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        sx, sy = span_for(landscape, span_x, span_y, address, phones)
        x1, y1, x2, y2 = round(c[0] * sx), round(c[1] * sy), round(c[2] * sx), round(c[3] * sy)
        steps = max(12, min(18, int(round(max(abs(x2 - x1), abs(y2 - y1)) / 28)) or 12))
        dur_ms = max(80, min(1500, int(ms or 260)))
        pause = 0.018 if dur_ms <= 360 else min(0.030, dur_ms / 1000.0 / steps)
        with self.lock:
            cx, cy = self._hold_path(x1, y1, x2, y2, steps, pause, 0.065, 0.030)
        return {'ok': True, 'sent': True, 'swiped': [x1, y1, cx, cy], 'span': [sx, sy], 'phones': phones}

    def drag(self, nx1, ny1, nx2, ny2, hold_ms=700, landscape=False, span_x=None, span_y=None, address=None):
        c = [max(0.0, min(1.0, float(v))) for v in (nx1, ny1, nx2, ny2)]
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        sx, sy = span_for(landscape, span_x, span_y, address, phones)
        x1, y1, x2, y2 = round(c[0] * sx), round(c[1] * sy), round(c[2] * sx), round(c[3] * sy)
        hold_s = max(300, min(1500, int(hold_ms or 700))) / 1000.0
        with self.lock:
            cx, cy = self._hold_path(x1, y1, x2, y2, 16, 0.018, hold_s, 0.12)
        return {'ok': True, 'sent': True, 'dragged': [x1, y1, cx, cy], 'span': [sx, sy], 'phones': phones}

    def scroll(self, dy, address=None):
        dy = max(-40, min(40, int(dy)))
        phones, refusal = self.need('mouse', address=address)
        if refusal:
            return refusal
        with self.lock:
            self.report('mouse', [0, 0, 0, dy & 0xFF], 0.025)
        return {'ok': True, 'sent': True, 'scrolled': dy, 'phones': phones}

    def open_app(self, name, address=None):
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            return {'ok': False, 'error': 'bad_name', 'message': 'Name the app, for example Notes.'}
        opened = self.key('Spotlight', address=address)
        if not opened.get('ok'):
            return opened
        time.sleep(0.8)
        typed = self.type_text(name.strip(), True, address=address)
        return dict(typed, opened=name.strip()) if typed.get('ok') else typed


def answer(peripheral, kb, req):
    op = req.get('op')
    handlers = {
        'status': lambda: MainThread.call(peripheral.status),
        'sync': lambda: kb.sync(req.get('address'), req.get('waitS')),
        'devices': lambda: MainThread.call(lambda: {'ok': True, 'phones': peripheral.phones(), 'pairing': peripheral.pairing()}),
        'pair-answer': lambda: MainThread.call(lambda: peripheral.answer_pairing(req.get('address'), req.get('allow'))),
        'keep': lambda: MainThread.call(lambda: peripheral.keep(req.get('address'))),
        'forget': lambda: MainThread.call(lambda: peripheral.forget(req.get('address'))),
        'pair-window': lambda: MainThread.call(lambda: peripheral.open_window(max(30, min(300, int(req.get('seconds', 120)))))),
        'home': lambda: kb.home(req.get('address')),
        'type': lambda: kb.type_text(req.get('text'), bool_arg(req.get('enter')), req.get('address')),
        'key': lambda: kb.key(str(req.get('key', '')), req.get('address')),
        'mouse': lambda: kb.mouse(req.get('dx', 0), req.get('dy', 0), bool_arg(req.get('click')), req.get('rehome', False), req.get('address')),
        'move': lambda: kb.move(req.get('nx', 0.5), req.get('ny', 0.5), req.get('landscape', False), req.get('rehome', False), req.get('spanX'), req.get('spanY'), req.get('address')),
        'tap': lambda: kb.tap(req.get('nx', 0.5), req.get('ny', 0.5), req.get('landscape', False), req.get('rehome', False), req.get('spanX'), req.get('spanY'), req.get('address')),
        'swipe': lambda: kb.swipe(req.get('nx1', 0.5), req.get('ny1', 0.7), req.get('nx2', 0.5), req.get('ny2', 0.3), req.get('ms', 260), req.get('landscape', False), req.get('spanX'), req.get('spanY'), req.get('address')),
        'drag': lambda: kb.drag(req.get('nx1', 0.5), req.get('ny1', 0.5), req.get('nx2', 0.5), req.get('ny2', 0.5), req.get('holdMs', 700), req.get('landscape', False), req.get('spanX'), req.get('spanY'), req.get('address')),
        'scroll': lambda: kb.scroll(req.get('dy', -6), req.get('address')),
        'open': lambda: kb.open_app(req.get('name'), req.get('address')),
    }
    if op not in handlers:
        return {'ok': False, 'error': 'unknown_op', 'message': f'There is no {op!r} here.'}
    try:
        return handlers[op]()
    except (ValueError, TypeError) as err:
        return {'ok': False, 'error': 'bad_argument', 'message': str(err)}
    except (dbus.exceptions.DBusException, TimeoutError) as err:
        return {'ok': False, 'error': 'ble_failed', 'message': f'Bluetooth refused it: {err}'}


def serve_socket(path, peripheral, kb):
    if os.path.exists(path):
        os.remove(path)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(path)
    os.chmod(path, 0o600)
    srv.listen(8)

    def one(conn):
        with conn:
            conn.settimeout(60)
            data = b''
            while not data.endswith(b'\n') and len(data) < 65536:
                part = conn.recv(65536)
                if not part:
                    break
                data += part
            try:
                req = json.loads(data.decode('utf-8'))
                reply = answer(peripheral, kb, req) if isinstance(req, dict) else None
            except ValueError:
                reply = None
            conn.sendall(json.dumps(reply or {'ok': False, 'error': 'bad_request', 'message': 'Send one JSON object per line.'}).encode('utf-8') + b'\n')

    def accept_loop():
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=one, args=(conn,), daemon=True).start()

    threading.Thread(target=accept_loop, daemon=True).start()


def first_adapter(bus):
    mgr = dbus.Interface(bus.get_object(BLUEZ, '/'), OM_IFACE)
    adapters = sorted(str(p) for p, ifaces in mgr.GetManagedObjects().items() if ADAPTER_IFACE in ifaces)
    if not adapters:
        raise SystemExit('No Bluetooth adapter on this computer.')
    return adapters[0]


def serve(runtime):
    lock = open(os.path.join(runtime, 'ble.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
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
