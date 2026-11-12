#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.11.0 (T80): play_title against a scripted Fire TV (its screens as
#   uiautomator dumps, its activities, its media sessions): the search link opens Prime Video's results, the remote moves
#   onto the matching show, OK opens its page, OK presses Resume, and it plays; a YouTube session left saying playing does
#   not count; no match, another app, a bad name and a missing app are refused in words; the matching and the arrow
#   choice are pure.
"""Tests for oshal_phone_play.py: a show played by its name on a Fire TV (stdlib unittest, no TV)."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

BRIDGE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'bridge')
sys.path.insert(0, BRIDGE)
sys.dont_write_bytecode = True
import oshal_phone_bridge as bridge  # noqa: E402
import oshal_phone_play as play  # noqa: E402

PRIME = 'com.amazon.firebat'
SEARCH_SCREEN = '''<hierarchy><node text="" focusable="true" focused="{f0}" bounds="[144,345][366,402]" />
<node content-desc="Top results" focusable="true" focused="false" bounds="[144,567][1864,1047]" />
<node content-desc="{title}, SEASON PREMIERE" focusable="true" focused="{f1}" bounds="[144,567][544,799]" />
<node content-desc="The Wheel of Time, MOST REWATCHED" focusable="true" focused="false" bounds="[1004,567][1404,799]" /></hierarchy>'''
PAGE_SCREEN = '''<hierarchy><node text="The Lord of the Rings: The Rings of Power" bounds="[144,100][900,160]" />
<node text="Season 3, Episode 3 - The Secret Fire  Gandalf works to keep Rhun out of the war" bounds="[144,300][900,360]" />
<node content-desc="Resume&#10;Episode 3, Button, 1 of 6" focusable="true" focused="true" bounds="[144,654][343,765]" />
<node content-desc="Watch from&#10;beginning, Button, 2 of 6" focusable="true" focused="false" bounds="[360,654][560,765]" /></hierarchy>'''
SESSIONS = '''Media button session is com.amazon.firebat/PrimeVideo
    package=com.amazon.firebat
      active=true
      state=PlaybackState {{state={prime}, position=878551, buffered position=0, speed=1.0}}
      metadata: size=8, description=PrimeVideo, null, null
    package=com.amazon.firetv.youtube
      active=false
      state=PlaybackState {{state=3, position=-1, buffered position=0, speed=0.0}}
      metadata: size=4, description=null, null, null'''


class FakeFireTv:
    """A Fire TV as adb shell answers it: the search, the show's page and playback, driven by the keys pressed."""

    def __init__(self, title='The Lord of the Rings: The Rings of Power', prime_state=3, installed=True):
        self.screen, self.focus, self.keys, self.title = 'home', 0, [], title
        self.prime_state, self.installed = prime_state, installed

    def __call__(self, command):
        if command.startswith('input keyevent '):
            return self.press(command.split()[-1])
        if command.startswith('pm path '):
            return 'package:/system/app/firebat.apk\n' if self.installed else ''
        if command.startswith('am start'):
            self.screen, self.focus = 'search', 0
            return 'Starting: Intent\nStatus: ok\n'
        if command.startswith('dumpsys window'):
            activity = {'home': 'com.amazon.tv.launcher/.Home', 'search': PRIME + '/.livingroom.find.SearchResultsActivity',
                        'page': PRIME + '/.livingroom.landing.LandingActivity',
                        'playing': PRIME + '/com.amazon.firebatcore.playback.inappplayback.PlaybackActivity'}[self.screen]
            return f'  mCurrentFocus=Window{{abc u0 {activity}}}\n'
        if command.startswith('dumpsys media_session'):
            return SESSIONS.format(prime=self.prime_state if self.screen == 'playing' else 2)
        if command.startswith('uiautomator dump'):
            if self.screen == 'search':
                return SEARCH_SCREEN.format(title=self.title, f0=str(self.focus == 0).lower(), f1=str(self.focus == 1).lower())
            return PAGE_SCREEN if self.screen == 'page' else '<hierarchy />'
        return ''

    def press(self, key):
        self.keys.append(key)
        if key == '20' and self.screen == 'search':
            self.focus = 1
        elif key == '66' and self.screen == 'search' and self.focus == 1:
            self.screen = 'page'
        elif key == '66' and self.screen == 'page':
            self.screen = 'playing'
        return ''


def context():
    return SimpleNamespace(**vars(bridge.MIRROR_CTX))


class PlayTitle(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(play.time, 'sleep', lambda _s: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_plays_the_show_from_where_the_person_left_off(self):
        tv = FakeFireTv()
        out = play.play_title(context(), 'prime', 'The Rings of Power', tv)
        self.assertEqual(tv.keys, ['KEYCODE_WAKEUP', '20', '66', '66'], 'wake, onto the show, open its page, press Resume')
        self.assertTrue(out['playing'])
        self.assertEqual(out['pressed'], 'Resume Episode 3, Button, 1 of 6')
        self.assertEqual(out['episode'], 'Season 3, Episode 3 - The Secret Fire')
        self.assertEqual((out['moves'], out['app']), (1, 'prime'))
        self.assertEqual(out['nowPlaying']['package'], PRIME)

    def test_a_youtube_session_left_saying_playing_does_not_count(self):
        out = play.play_title(context(), 'prime', 'The Rings of Power', FakeFireTv(prime_state=2))
        self.assertFalse(out['playing'], 'Prime Video paused: the stale YouTube session must not make it playing')

    def test_no_match_another_app_a_bad_name_and_no_app_are_refused_in_words(self):
        ctx = context()
        with self.assertRaises(ctx.Refusal) as caught:
            play.play_title(ctx, 'prime', 'Severance', FakeFireTv())
        self.assertEqual(caught.exception.code, 'not_found')
        with self.assertRaises(ctx.Refusal) as caught:
            play.play_title(ctx, 'netflix', 'Stranger Things', FakeFireTv())
        self.assertEqual(caught.exception.code, 'not_yet')
        with self.assertRaises(ctx.Refusal) as caught:
            play.play_title(ctx, 'prime', 'x', FakeFireTv())
        self.assertEqual(caught.exception.code, 'bad_title')
        with self.assertRaises(ctx.Refusal) as caught:
            play.play_title(ctx, 'prime', 'The Rings of Power', FakeFireTv(installed=False))
        self.assertEqual(caught.exception.code, 'not_installed')

    def test_matching_and_the_arrow_toward_a_tile_are_pure(self):
        self.assertTrue(play.matches('The Lord of the Rings: The Rings of Power, SEASON PREMIERE', 'rings of power'))
        self.assertFalse(play.matches('The Wheel of Time, MOST REWATCHED', 'The Rings of Power'))
        self.assertFalse(play.matches('anything', 'the of'), 'a name of joining words alone matches nothing')
        here = {'x': 255, 'y': 373}
        self.assertEqual(play.toward(here, {'x': 344, 'y': 683}), 'down')
        self.assertEqual(play.toward({'x': 344, 'y': 683}, {'x': 1204, 'y': 683}), 'right')
        self.assertEqual(play.toward(here, here), '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
