#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.12.0 (T79, the device inventory): lan-control tv_apps against a
#   scripted TV (its package list as adb shell answers it, every command it receives recorded): a Fire TV and an Android
#   TV name the streaming apps they have from one read of pm list packages and nothing else is sent, so nothing is
#   pressed, woken or opened; every other package is only counted, never named; one service installed twice is one
#   app; an empty list and an adb failure are refused in words; a Roku and a Samsung TV are refused in words, by the
#   module and by the installed bridge verb; the closed list holds every app Open a Link and Play a Show know.
"""Tests for oshal_phone_apps.py: which streaming apps an Android or Fire TV has (stdlib unittest, no TV)."""

import base64
import json
import os
import subprocess
import sys
import unittest
from types import SimpleNamespace

BRIDGE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'bridge')
sys.path.insert(0, BRIDGE)
sys.dont_write_bytecode = True
import oshal_phone_bridge as bridge  # noqa: E402
import oshal_phone_apps as apps  # noqa: E402
import oshal_phone_lan as lan  # noqa: E402
import oshal_phone_links as links  # noqa: E402
import oshal_phone_play as play  # noqa: E402

ADDRESS = '192.168.50.20'
SERIAL = ADDRESS + ':5555'
# A Fire TV's list: Prime Video is its own Fire TV app, and four packages are none of the known apps.
FIRE_TV = '\n'.join('package:' + name for name in (
    'com.amazon.tv.launcher', 'com.amazon.firebat', 'com.netflix.ninja', 'com.android.settings',
    'com.amazon.firetv.youtube', 'com.oshal.remote', 'com.amazon.device.software.ota', 'org.example.privatebank')) + '\n'
# A Google TV's list, as an older adb shell answers it (CRLF line ends).
ANDROID_TV = '\r\n'.join('package:' + name for name in (
    'com.google.android.tvlauncher', 'com.amazon.amazonvideo.livingroom', 'com.disney.disneyplus', 'com.wbd.stream',
    'com.hulu.livingroomplus', 'com.google.android.youtube.tv')) + '\r\n'


class ScriptedTv:
    """A TV as the bridge's adb shell reaches it: it answers pm list packages and records every command it receives."""

    def __init__(self, listing, fail=''):
        self.listing, self.fail, self.commands = listing, fail, []

    def __call__(self, serial, command, timeout=30):
        self.commands.append((serial, command))
        if self.fail:
            return 1, '', self.fail
        return (0, self.listing, '') if command == 'pm list packages' else (0, '', '')


def context(tv, connected):
    """The bridge's own context with this computer's adb replaced by the scripted TV, already authorized."""
    return SimpleNamespace(**dict(vars(bridge.MIRROR_CTX), adb_shell=tv,
                                  list_devices=lambda: ([{'serial': SERIAL, 'state': 'device', 'model': 'TEST_TV'}], 0),
                                  verb_adb_connect_tv=lambda args: connected.append(args) or {'serial': args['address']}))


def tv_apps(tv, kind='android-tv'):
    connected = []
    reply = lan.verb_lan_control(context(tv, connected), {'kind': kind, 'address': ADDRESS, 'action': 'tv_apps'})
    return reply, connected


class TvApps(unittest.TestCase):
    def test_a_fire_tv_names_its_streaming_apps_and_presses_nothing(self):
        tv = ScriptedTv(FIRE_TV)
        reply, connected = tv_apps(tv)
        self.assertEqual(tv.commands, [(SERIAL, 'pm list packages')], 'one read; no key, wake or app was sent')
        self.assertEqual(reply['apps'], [
            {'key': 'netflix', 'name': 'Netflix', 'package': 'com.netflix.ninja'},
            {'key': 'prime', 'name': 'Prime Video', 'package': 'com.amazon.firebat'},
            {'key': 'youtube', 'name': 'YouTube', 'package': 'com.amazon.firetv.youtube'},
            {'key': 'oshal', 'name': 'oshal TV app', 'package': 'com.oshal.remote'}])
        self.assertEqual(reply['unknownCount'], 4)
        self.assertEqual((reply['kind'], reply['action'], reply['serial']), ('android-tv', 'tv_apps', SERIAL))
        answer = json.dumps(reply)
        for unknown in ('com.amazon.tv.launcher', 'com.android.settings', 'org.example.privatebank'):
            self.assertNotIn(unknown, answer, 'a package outside the closed list is counted, never named')
        self.assertEqual(connected, [], 'a TV this computer already reaches is not connected again')

    def test_a_google_tv_answers_its_own_packages_and_a_service_installed_twice_is_one_app(self):
        reply, _ = tv_apps(ScriptedTv(ANDROID_TV))
        self.assertEqual([(x['key'], x['package']) for x in reply['apps']], [
            ('prime', 'com.amazon.amazonvideo.livingroom'), ('disney', 'com.disney.disneyplus'), ('max', 'com.wbd.stream'),
            ('hulu', 'com.hulu.livingroomplus'), ('youtube', 'com.google.android.youtube.tv')])
        self.assertEqual(reply['unknownCount'], 1)
        twice = apps.known_apps({'com.amazon.avod', 'com.amazon.firebat', 'com.hbo.hbonow', 'com.wbd.stream'})
        self.assertEqual(twice, {'apps': [{'key': 'prime', 'name': 'Prime Video', 'package': 'com.amazon.avod'},
                                          {'key': 'max', 'name': 'Max', 'package': 'com.hbo.hbonow'}],
                                 'unknownCount': 0})

    def test_a_tv_with_none_of_them_answers_no_apps_and_counts_the_rest(self):
        reply, _ = tv_apps(ScriptedTv('package:com.google.android.tvlauncher\npackage:com.android.vending\n'))
        self.assertEqual((reply['apps'], reply['unknownCount']), ([], 2))

    def test_an_empty_list_and_an_adb_failure_are_refused_in_words(self):
        for listing in ('', 'Error: could not access the Package Manager.  Is the system running?\n'):
            tv = ScriptedTv(listing)
            with self.assertRaises(bridge.Refusal) as caught:
                tv_apps(tv)
            self.assertEqual(caught.exception.code, 'no_app_list', listing)
            self.assertIn('without a list of its apps', caught.exception.message)
            self.assertEqual(tv.commands, [(SERIAL, 'pm list packages')])
        with self.assertRaises(bridge.Refusal) as caught:
            tv_apps(ScriptedTv(FIRE_TV, fail=f"error: device '{SERIAL}' not found"))
        self.assertEqual(caught.exception.code, 'not_connected')

    def test_a_roku_and_a_samsung_tv_are_refused_in_words_by_the_module_and_the_installed_verb(self):
        for kind in ('roku', 'samsung-tizen'):
            tv = ScriptedTv(FIRE_TV)
            with self.assertRaises(bridge.Refusal) as caught:
                tv_apps(tv, kind)
            self.assertEqual(caught.exception.code, 'android_only', kind)
            self.assertIn('Android or Fire TV', caught.exception.message)
            self.assertEqual(tv.commands, [], kind)
        args = base64.b64encode(json.dumps({'kind': 'roku', 'address': '192.168.50.21', 'action': 'tv_apps'}).encode())
        done = subprocess.run([sys.executable, '-I', '-B', os.path.join(BRIDGE, 'oshal_phone_bridge.py'), 'lan-control',
                               '--b64', args.decode()], capture_output=True, text=True, timeout=30)
        lines = done.stdout.strip().split('\n')
        self.assertEqual(len(lines), 1, done.stdout + done.stderr)
        reply = json.loads(lines[0])
        self.assertEqual((reply['ok'], reply['error'], done.returncode), (False, 'android_only', 3),
                         'tv_apps is one of the installed verb\'s closed actions')

    def test_the_closed_list_holds_every_app_open_a_link_and_play_a_show_know(self):
        known = {key: (name, packages) for key, name, packages in apps.KNOWN_APPS}
        self.assertEqual(len(known), len(apps.KNOWN_APPS), 'one entry per app')
        for key, (packages, _sites) in links.STREAMING_APPS.items():
            self.assertEqual(known[key][0], links.NAMES[key])
            self.assertEqual(known[key][1][:len(packages)], packages, f'{key}: the packages Open a Link opens come first')
        for key, (package, _search) in play.SEARCH.items():
            self.assertIn(package, known[key][1], f'{key}: the package Play a Show drives')
        self.assertEqual(apps.KNOWN_APPS[-1], ('oshal', 'oshal TV app', (links.OSHAL_TV_APP,)))
        self.assertIn('tv_apps', lan.ACTIONS)

    def test_package_lines_are_read_and_anything_else_is_ignored(self):
        text = ('package:com.a.b\r\npackage:com.c.d\nWARNING: linker noise\n\npackage:\npackage:not a package\n'
                'package:com.e.f  \npackage:nodots\n')
        self.assertEqual(apps.installed_packages(text), {'com.a.b', 'com.c.d', 'com.e.f'})
        self.assertEqual(apps.installed_packages(None), set())


if __name__ == '__main__':
    unittest.main(verbosity=2)
