#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.5.4: a scripted BlueZ on a private D-Bus for the pairing tests (test_oshal_phone_ble_pairing.py). It owns org.bluez with one adapter, its devices, the agent manager and the GATT and advertising managers the bridge registers with, and a test interface that adds devices and starts a pairing by calling the registered agent over D-Bus exactly as bluetoothd does, so the bridge's held answers, its Rejected errors and its Trusted writes cross the real bus.
"""Scripted BlueZ for the bridge pairing tests: `python3 -I fake_bluez.py <bus address>`."""

import sys

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

PROPS = 'org.freedesktop.DBus.Properties'
ADAPTER = '/org/bluez/hci0'


class Obj(dbus.service.Object):
    """A BlueZ object with properties under one or more interfaces."""

    def __init__(self, bus, path, props):
        self.path, self.props = path, props
        dbus.service.Object.__init__(self, bus, path)

    @dbus.service.method(PROPS, in_signature='ss', out_signature='v')
    def Get(self, iface, name):
        return self.props[iface][name]

    @dbus.service.method(PROPS, in_signature='s', out_signature='a{sv}')
    def GetAll(self, iface):
        return dict(self.props.get(iface, {}))

    @dbus.service.method(PROPS, in_signature='ssv', out_signature='')
    def Set(self, iface, name, value):
        self.props.setdefault(iface, {})[name] = value


class Adapter(Obj):
    def __init__(self, bus, world):
        self.world = world
        Obj.__init__(self, bus, ADAPTER, {'org.bluez.Adapter1': {
            'Address': 'AA:AA:AA:AA:AA:01', 'Alias': 'spark', 'Powered': dbus.Boolean(False),
            'Pairable': dbus.Boolean(False)}})

    @dbus.service.method('org.bluez.Adapter1', in_signature='o', out_signature='')
    def RemoveDevice(self, path):
        self.world.remove(str(path))

    @dbus.service.method('org.bluez.GattManager1', in_signature='oa{sv}', out_signature='')
    def RegisterApplication(self, app, options):
        pass

    @dbus.service.method('org.bluez.GattManager1', in_signature='o', out_signature='')
    def UnregisterApplication(self, app):
        pass

    @dbus.service.method('org.bluez.LEAdvertisingManager1', in_signature='oa{sv}', out_signature='')
    def RegisterAdvertisement(self, ad, options):
        pass

    @dbus.service.method('org.bluez.LEAdvertisingManager1', in_signature='o', out_signature='')
    def UnregisterAdvertisement(self, ad):
        pass


class Device(Obj):
    def __init__(self, bus, world, address, name, paired, trusted):
        self.world = world
        path = f"{ADAPTER}/dev_{address.replace(':', '_')}"
        Obj.__init__(self, bus, path, {'org.bluez.Device1': {
            'Address': address, 'Alias': name, 'Name': name, 'Adapter': dbus.ObjectPath(ADAPTER),
            'Paired': dbus.Boolean(paired), 'Bonded': dbus.Boolean(paired), 'Trusted': dbus.Boolean(trusted),
            'Connected': dbus.Boolean(False)}})

    @dbus.service.method('org.bluez.Device1', in_signature='', out_signature='')
    def Connect(self):
        self.world.connects.append(self.props['org.bluez.Device1']['Address'])


class World(dbus.service.Object):
    """The adapter, its devices, the registered agent and the test interface."""

    def __init__(self, bus):
        self.bus, self.devices, self.results, self.connects, self.agent = bus, {}, {}, [], None
        dbus.service.Object.__init__(self, bus, '/')
        self.adapter = Adapter(bus, self)
        self.manager = AgentManager(bus, self)

    def remove(self, path):
        device = self.devices.pop(path, None)
        if device:
            device.remove_from_connection()

    def by_address(self, address):
        return next((d for d in self.devices.values() if d.props['org.bluez.Device1']['Address'] == address), None)

    @dbus.service.method('org.freedesktop.DBus.ObjectManager', out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        out = {dbus.ObjectPath(ADAPTER): self.adapter.props}
        out.update({dbus.ObjectPath(path): device.props for path, device in self.devices.items()})
        return out

    @dbus.service.method('org.oshal.Test', in_signature='ssbb', out_signature='')
    def AddDevice(self, address, name, paired, trusted):
        device = Device(self.bus, self, address, name, paired, trusted)
        self.devices[device.path] = device

    @dbus.service.method('org.oshal.Test', in_signature='ssu', out_signature='s')
    def Pair(self, address, method, passkey):
        device = self.by_address(address)
        if device is None or self.agent is None:
            return 'no agent' if device else 'no device'
        self.results[address] = 'pending'
        agent = dbus.Interface(self.bus.get_object(*self.agent), 'org.bluez.Agent1')
        path = dbus.ObjectPath(device.path)
        args = (path, dbus.UInt32(passkey)) if method == 'RequestConfirmation' else (
            (path, '00001812-0000-1000-8000-00805f9b34fb') if method == 'AuthorizeService' else (path,))

        def accepted(*_):
            self.results[address] = 'accepted'
            device.props['org.bluez.Device1']['Paired'] = dbus.Boolean(True)

        def refused(error):
            self.results[address] = 'rejected:' + str(error.get_dbus_name())

        getattr(agent, method)(*args, reply_handler=accepted, error_handler=refused, timeout=120)
        return 'asked'

    @dbus.service.method('org.oshal.Test', in_signature='s', out_signature='s')
    def Result(self, address):
        return self.results.get(address, 'none')

    @dbus.service.method('org.oshal.Test', in_signature='s', out_signature='a{sv}')
    def DeviceProps(self, address):
        device = self.by_address(address)
        return dict(device.props['org.bluez.Device1']) if device else {'Gone': dbus.Boolean(True)}

    @dbus.service.method('org.oshal.Test', in_signature='', out_signature='as')
    def Connects(self):
        return dbus.Array(self.connects, signature='s')

    @dbus.service.method('org.oshal.Test', in_signature='', out_signature='s')
    def Agent(self):
        return 'none' if self.agent is None else self.agent[1]


class AgentManager(dbus.service.Object):
    def __init__(self, bus, world):
        self.world = world
        dbus.service.Object.__init__(self, bus, '/org/bluez')

    @dbus.service.method('org.bluez.AgentManager1', in_signature='os', out_signature='', sender_keyword='sender')
    def RegisterAgent(self, path, capability, sender=None):
        self.world.agent = (sender, str(path))

    @dbus.service.method('org.bluez.AgentManager1', in_signature='o', out_signature='')
    def RequestDefaultAgent(self, path):
        pass

    @dbus.service.method('org.bluez.AgentManager1', in_signature='o', out_signature='')
    def UnregisterAgent(self, path):
        self.world.agent = None


def main(address):
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.bus.BusConnection(address)
    world = World(bus)
    owned = dbus.service.BusName('org.bluez', bus)
    print('ready', flush=True)
    GLib.MainLoop().run()
    return world, owned


if __name__ == '__main__':
    main(sys.argv[1])
