# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.11.0 (T80; Roger, 2026-11-12: "hey jarvis in the game room open rings of power
#   season 3 where i left off .. make it do that"): play_title plays a show or film on an Android or Fire TV by its title,
#   the way a person does with the remote, and reads the screen after every move. It opens the streaming app's own search
#   for the title, moves the focus to the result whose name matches, presses OK, then presses the button the show's page
#   puts first (Resume, which is where the person left off, or Play), and answers what the TV's media sessions say. Proven
#   by hand on the office Fire TV (AFTMD001) with Prime Video: Season 3, Episode 3 resumed at 11:42. Prime Video on a Fire
#   TV is the one service this does so far; another is refused in words.
"""Play a show or a film on an Android or Fire TV by its title: the app's search, the matching result, Resume or Play,
and what the media sessions say afterwards (lan-control play_title)."""

import html
import re
import time
from urllib.parse import quote

import oshal_phone_links

# service -> (its package on a Fire TV, its search link with {q}). Prime Video's Fire TV app takes watch.amazon.com links.
SEARCH = {'prime': ('com.amazon.firebat', 'https://watch.amazon.com/search?phrase={q}')}
NAMES = {'prime': 'Prime Video'}
# The buttons that start or resume playback on a show's page, as their labels begin.
START = ('resume', 'continue watching', 'play', 'watch now', 'watch with', 'watch episode', 'watch season')
# Android key codes the moves send.
KEYS = {'up': 19, 'down': 20, 'left': 21, 'right': 22, 'ok': 66}
MAX_MOVES = 10
SCREEN = '/sdcard/oshal-play.xml'
STOP_WORDS = {'the', 'a', 'an', 'of', 'and', 'season', 'episode'}


def words(text):
    """The lower-case words of `text` without punctuation or small joining words. Pure."""
    return [w for w in re.findall(r'[a-z0-9]+', str(text or '').lower()) if w not in STOP_WORDS]


def matches(label, title):
    """Whether a screen label names the title: every word of the title is in it. Pure."""
    want = words(title)
    return bool(want) and set(want) <= set(words(label))


def parse_screen(xml):
    """The screen's labelled nodes from a uiautomator dump: (label, centre, focused), and the focused one. Pure."""
    nodes, focused = [], None
    for raw in re.findall(r'<node [^>]*>', xml or ''):
        label = html.unescape(_attr(raw, 'text') or _attr(raw, 'content-desc')).replace('\n', ' ').strip()
        box = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', raw)
        if not box:
            continue
        x1, y1, x2, y2 = (int(v) for v in box.groups())
        node = {'label': label, 'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2, 'focusable': ' focusable="true"' in raw}
        if ' focused="true"' in raw:
            focused = node
        if label:
            nodes.append(node)
    return nodes, focused


def _attr(raw, name):
    hit = re.search(r' ' + name + r'="([^"]*)"', raw)
    return hit.group(1) if hit else ''


def toward(focused, target):
    """The arrow that moves the focus from `focused` toward `target`: the larger gap first. Pure."""
    dx, dy = target['x'] - focused['x'], target['y'] - focused['y']
    if abs(dy) >= abs(dx) and abs(dy) > 8:
        return 'down' if dy > 0 else 'up'
    if abs(dx) > 8:
        return 'right' if dx > 0 else 'left'
    return ''


def front_activity(shell):
    """The activity in front: package/class from dumpsys window, or ''."""
    hit = re.search(r'mCurrentFocus=Window\{\S+ u\d+ ([\w.]+/[\w.$]+)', shell('dumpsys window windows'))
    return hit.group(1) if hit else ''


def wait_for(shell, part, seconds=12.0):
    """Wait until the activity in front names `part`; True when it did."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if part in front_activity(shell):
            return True
        time.sleep(0.6)
    return False


def screen(shell):
    return parse_screen(shell(f'uiautomator dump {SCREEN} >/dev/null 2>&1; cat {SCREEN}'))


def move_to(shell, pick, moves_left):
    """Press arrows until the focused node is the one `pick(nodes)` names; answers it and the moves used, or (None, n)."""
    used = 0
    while used <= moves_left:
        nodes, focused = screen(shell)
        target = pick(nodes)
        if target is None or focused is None:
            return None, used
        if focused['label'] == target['label'] or (focused['x'], focused['y']) == (target['x'], target['y']):
            return focused, used
        arrow = toward(focused, target)
        if not arrow:
            return None, used
        shell(f'input keyevent {KEYS[arrow]}')
        used += 1
        time.sleep(0.5)
    return None, used


def _result(nodes, title):
    return next((n for n in nodes if n['focusable'] and matches(n['label'], title)), None)


def _start_button(nodes):
    return next((n for n in nodes if n['focusable'] and n['label'].lower().startswith(START)), None)


def _episode_line(nodes):
    hit = next((n['label'] for n in nodes if re.match(r'Season \d+, Episode \d+', n['label'])), '')
    return hit.split('  ')[0][:120]


def play_title(ctx, app, title, shell):
    """Play `title` in the streaming app `app` on this TV and answer what the TV says is playing."""
    name = str(app or 'prime').strip().lower()
    if name not in SEARCH:
        raise ctx.Refusal('not_yet', 'Playing a show by its name works with Prime Video on a Fire TV so far. For '
                          + oshal_phone_links.NAMES.get(name, name) + ', open its link with launch_url instead.')
    asked = str(title or '').strip()
    if not 2 <= len(asked) <= 80 or not words(asked):
        raise ctx.Refusal('bad_title', 'Name the show or film (2 to 80 characters).')
    package, link = SEARCH[name]
    shell('input keyevent KEYCODE_WAKEUP')
    if not shell('pm path ' + package).strip().startswith('package:'):
        raise ctx.Refusal('not_installed', f'{NAMES[name]} is not installed on this TV.')
    out = shell('am start -W -a android.intent.action.VIEW -d ' + ctx.device_quote(link.format(q=quote(asked))) + ' ' + package)
    if 'Status: ok' not in out or not wait_for(shell, 'SearchResults'):
        raise ctx.Refusal('no_search', f'{NAMES[name]} did not open its search for that name.', adb=out.strip()[-300:])
    time.sleep(1.0)
    found, used = move_to(shell, lambda nodes: _result(nodes, asked), MAX_MOVES)
    if found is None:
        raise ctx.Refusal('not_found', f'{NAMES[name]} found nothing named "{asked}" that the remote could reach.')
    shell(f'input keyevent {KEYS["ok"]}')
    if not wait_for(shell, 'Landing') and not wait_for(shell, 'Detail', 4):
        raise ctx.Refusal('no_page', f'{NAMES[name]} did not open the page for {found["label"][:80]}.')
    time.sleep(1.5)
    button, more = move_to(shell, _start_button, MAX_MOVES - used)
    if button is None:
        raise ctx.Refusal('no_play_button', f'The page for {found["label"][:80]} shows no Resume or Play button.')
    episode = _episode_line(screen(shell)[0])
    shell(f'input keyevent {KEYS["ok"]}')
    wait_for(shell, 'Playback', 15)
    time.sleep(2.0)
    return dict({'app': name, 'title': found['label'][:120], 'pressed': button['label'][:60], 'episode': episode or None,
                 'moves': used + more}, **app_playing(shell, package))


def app_playing(shell, package):
    """Whether `package`'s own media session plays now and it is in front. Another app's session that still says
    playing (a YouTube session left from earlier, seen on AFTMD001) does not count."""
    state = oshal_phone_links.now_playing(shell)
    own = [x for x in state.get('sessions') or [] if x.get('package') == package]
    playing = any(x.get('state') == 'playing' for x in own)
    return {'playing': playing and state.get('front') == package,
            'nowPlaying': next((x for x in own if x.get('state') == 'playing'), own[0] if own else None)}
