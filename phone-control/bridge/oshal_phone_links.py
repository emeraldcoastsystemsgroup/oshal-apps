# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0 (T45 part 3; Roger, 2026-11-11: "deep links that open the actual
#   film on the TV"): a link opened on an Android or Fire TV goes to the named streaming app, not to whatever Android
#   picks. The app is one of a closed list (Netflix, Prime Video, Disney+, Max, Hulu, YouTube), its link must be on that
#   service's own site, and the first of its Android TV or Fire TV packages that is installed opens it. The TV is woken
#   first, because a link sent while its screen saver runs opens behind it (seen on a Fire TV Stick, AFTMD001).
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.8.0 (T45 part 4; Roger, 2026-11-10: "a way to control an app that is
#   running in the background"): now_playing reads the TV's media sessions (dumpsys media_session) and says which app
#   is playing what, whether it is paused, and whether that app is in front; play, pause, next, previous and stop send
#   the Android media key, which the TV hands to the app that last played even when another app is in front, and the
#   answer reads the sessions again so it says what the press did instead of assuming it.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0 (T45 part 2; Roger, 2026-11-10: "plays it on any device in his connected devices"): app oshal opens a Marquee page of this installation (its own page and #/ screens, no query) in the oshal TV app as oshal://open?path=..., which shows it in the person's own session; not installed, and an app older than 0.8.6 (the link does not resolve), are said in words.
"""Streaming apps on an Android TV or Fire TV: links that open a title inside its app (lan-control launch_url), and
what is playing with the media keys that reach the app playing it, in front or not (now_playing, play, pause, ...)."""

import re
import time
from urllib.parse import quote, urlsplit

# service -> (its packages, Fire TV first then Android TV; the sites its links are on)
STREAMING_APPS = {
    'netflix': (('com.netflix.ninja',), ('netflix.com',)),
    'prime': (('com.amazon.avod', 'com.amazon.amazonvideo.livingroom'), ('primevideo.com', 'amazon.com')),
    'disney': (('com.disney.disneyplus',), ('disneyplus.com',)),
    'max': (('com.hbo.hbonow', 'com.wbd.stream'), ('max.com', 'hbomax.com')),
    'hulu': (('com.hulu.plus', 'com.hulu.livingroomplus'), ('hulu.com',)),
    'youtube': (('com.amazon.firetv.youtube', 'com.google.android.youtube.tv'), ('youtube.com', 'youtu.be')),
}
NAMES = {'netflix': 'Netflix', 'prime': 'Prime Video', 'disney': 'Disney+', 'max': 'Max', 'hulu': 'Hulu', 'youtube': 'YouTube'}


def _on_site(url, sites):
    host = (urlsplit(url).hostname or '').lower()
    return any(host == site or host.endswith('.' + site) for site in sites)


OSHAL_TV_APP = 'com.oshal.remote'
MARQUEE_PAGE = '/api/free-library/app'


def oshal_link(url):
    """The oshal TV app's link for a Marquee page of this installation, or '' when the address is not one. Pure."""
    parts = urlsplit(url)
    if parts.query or not (parts.path == MARQUEE_PAGE and (not parts.fragment or parts.fragment.startswith('/'))):
        return ''
    page = parts.path + ('#' + parts.fragment if parts.fragment else '')
    return 'oshal://open?path=' + quote(page, safe='')


def open_in_oshal(ctx, url, shell):
    """Open a Marquee page in the oshal TV app (0.8.6 or later), which shows it in the person's own session."""
    link = oshal_link(url)
    if not link:
        raise ctx.Refusal('not_that_app', 'The oshal TV app opens only Marquee\'s own page.')
    if not shell('pm path ' + OSHAL_TV_APP).strip().startswith('package:'):
        raise ctx.Refusal('not_installed', 'The oshal TV app is not installed on this TV. Install it from Smart Home, TVs and streaming sticks.')
    out = shell('am start -W -a android.intent.action.VIEW -d ' + ctx.device_quote(link) + ' ' + OSHAL_TV_APP)
    if 'unable to resolve Intent' in out:
        raise ctx.Refusal('app_too_old', 'The oshal TV app on this TV is older than 0.8.6 and cannot open a film yet. It updates itself '
                          'when it is opened: open it once, then press Play on again.')
    if 'Status: ok' not in out:
        raise ctx.Refusal('not_opened', 'The oshal TV app did not open that page.', adb=out.strip()[-300:])
    return {'opened': OSHAL_TV_APP, 'app': 'oshal', 'url': url}


def open_link(ctx, url, app, shell):
    """Wake the TV, then open `url` in the streaming app `app` (or the TV's own choice when no app is named).
    `shell(command)` runs one adb shell command on the TV and answers its output."""
    shell('input keyevent KEYCODE_WAKEUP')
    name = str(app or '').strip().lower()
    if not name:
        out = shell('am start -W -a android.intent.action.VIEW -d ' + ctx.device_quote(url))
        if 'Status: ok' not in out:
            raise ctx.Refusal('no_browser', 'This TV has no app that opens that address. Name the streaming app.')
        return {'opened': 'browser', 'url': url}
    if name == 'oshal':
        return open_in_oshal(ctx, url, shell)
    if name not in STREAMING_APPS:
        raise ctx.Refusal('unknown_app', 'Name the streaming app: ' + ', '.join(sorted(STREAMING_APPS)) + '.')
    packages, sites = STREAMING_APPS[name]
    if not _on_site(url, sites):
        raise ctx.Refusal('not_that_app', f'That address is not on {NAMES[name]}\'s own site.')
    installed = next((p for p in packages if shell('pm path ' + p).strip().startswith('package:')), '')
    if not installed:
        raise ctx.Refusal('not_installed', f'{NAMES[name]} is not installed on this TV.')
    out = shell('am start -W -a android.intent.action.VIEW -d ' + ctx.device_quote(url) + ' ' + installed)
    if 'Status: ok' not in out:
        raise ctx.Refusal('not_opened', f'{NAMES[name]} did not open that link.', adb=out.strip()[-300:])
    return {'opened': installed, 'app': name, 'url': url}


# The media keys an action sends (Android KeyEvent codes); the TV routes them to the app that last played.
MEDIA_KEYS = {'play': 126, 'pause': 127, 'next': 87, 'previous': 88, 'stop': 86}
MEDIA_ACTIONS = ('now_playing',) + tuple(MEDIA_KEYS)
# PlaybackState codes, in words.
STATES = {0: 'none', 1: 'stopped', 2: 'paused', 3: 'playing', 4: 'fast-forwarding', 5: 'rewinding', 6: 'buffering',
          7: 'error', 8: 'connecting', 9: 'skipping', 10: 'skipping', 11: 'skipping'}
SETTLE_S = 1.2
APP_OF = {package: NAMES[name] for name, (packages, _) in STREAMING_APPS.items() for package in packages}


def parse_sessions(text):
    """The media sessions in `dumpsys media_session` output, most recent first: package, app, state, title, active;
    and the package the media keys go to. Pure."""
    sessions, keys_to = [], ''
    for line in text.splitlines():
        line = line.strip()
        hit = re.match(r'Media button session is (?:MediaSessionRecord[^ ]* )?([\w.]+)/', line)
        if hit:
            keys_to = hit.group(1)
        elif line.startswith('package='):
            package = line[len('package='):].split()[0]
            sessions.append({'package': package, 'app': APP_OF.get(package, package), 'state': 'none', 'title': None,
                             'active': False})
        elif sessions and line.startswith('active='):
            sessions[-1]['active'] = line[len('active='):].startswith('true')
        elif sessions and line.startswith('state=PlaybackState'):
            code = re.search(r'state=PlaybackState \{state=(\d+)', line)
            sessions[-1]['state'] = STATES.get(int(code.group(1)), 'none') if code else 'none'
        elif sessions and re.match(r'metadata: ?size=\d+, description=', line):
            words = line.split('description=', 1)[1].rsplit(', ', 2)[0].strip()
            sessions[-1]['title'] = None if words in ('', 'null') else words[:200]
    return sessions, keys_to


def front_package(text):
    """The package whose window has focus in `dumpsys window` output, or ''. Pure."""
    hit = re.search(r'mCurrentFocus=Window\{\S+ u\d+ ([\w.]+)/', text) or re.search(r'mFocusedApp=.*? ([\w.]+)/', text)
    return hit.group(1) if hit else ''


def now_playing(shell):
    """What the TV's media sessions say: every session with whether its app is in front, and the one playing now."""
    sessions, keys_to = parse_sessions(shell('dumpsys media_session'))
    front = front_package(shell('dumpsys window windows'))
    for session in sessions:
        session['inFront'] = session['package'] == front
    playing = next((x for x in sessions if x['state'] == 'playing'), None)
    current = playing or next((x for x in sessions if x['package'] == keys_to), None) or (sessions[0] if sessions else None)
    return {'sessions': sessions[:8], 'now': current, 'front': front or None, 'mediaKeysTo': keys_to or None}


def media(ctx, action, shell):
    """now_playing, or one media key to the app that last played (in front or not) and what the sessions say after."""
    if action == 'now_playing':
        return now_playing(shell)
    if action not in MEDIA_KEYS:
        raise ctx.Refusal('bad_action', 'action is one of ' + ', '.join(MEDIA_ACTIONS) + '.')
    shell(f'input keyevent {MEDIA_KEYS[action]}')
    time.sleep(SETTLE_S)
    after = now_playing(shell)
    if not after['sessions']:
        raise ctx.Refusal('nothing_playing', 'Nothing on this TV has played anything yet, so there is no app to send '
                          f'{action} to. Start a film or a song first.')
    return dict(after, key=MEDIA_KEYS[action])
