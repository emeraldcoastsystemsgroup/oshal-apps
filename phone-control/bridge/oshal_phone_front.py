# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.0 (Lane TV1; Roger, 2026-11-13, asked that Jarvis open an
#   application such as Netflix on his Roku and Samsung TVs and know where it is): three lan-control actions for a
#   Roku and a Samsung TV. launch_app opens one application by its id (Roku ECP POST /launch/<digits>, with a title's
#   contentId and mediaType when named; Samsung POST /api/v2/applications/<id>, then its paired remote channel when
#   that is refused) and answers what the TV reported in front afterwards. list_apps reads the ids (Roku /query/apps;
#   Samsung ed.installedApp.get, which not every TV answers). active_app says what is in front (a Roku names the
#   application, a screensaver and its player's state; a Samsung TV says running and visible for one named
#   application). Neither kind gives a picture or the text on its screen. A title on a Samsung TV is refused in words:
#   each application reads its own link format, and none could be checked against a stand-in.
"""A Roku or a Samsung TV for lan-control: open one application by its id (launch_app), list its applications
(list_apps) and say what is in front (active_app). Fixed paths and checked ids only; nothing here reads a screen.
`tv` in every function is oshal_phone_lan, whose ports, read-only GET and Samsung remote channel this module uses."""

import http.client
import json
import re
import time
from urllib.parse import quote
from xml.etree import ElementTree

ACTIONS = ('launch_app', 'list_apps', 'active_app')
KINDS = ('roku', 'samsung-tizen')
ROKU_APP = re.compile(r'^\d{1,10}$')
SAMSUNG_APP = re.compile(r'^(?:\d{1,20}|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)$')
CONTENT_ID = re.compile(r'^[A-Za-z0-9_.~:-]{1,255}$')
# Roku's deep-link media types (developer.roku.com, Implementing deep linking).
MEDIA_TYPES = ('movie', 'episode', 'season', 'series', 'shortFormVideo', 'tvSpecial', 'livefeed', 'sportsevent')
MAX_APP_ID = 80
MAX_APPS = 100
FRONT_WAIT_S = 8.0
FRONT_STEP_S = 0.5
LAUNCH_WAIT_S = 3.0
APPS_WAIT_S = 6.0
ROKU_CONTROL_OFF = ('This Roku does not take commands from the network. On the Roku open Settings, System, Advanced '
                    'system settings, Control by mobile apps, and set Network access to Default.')
ANDROID_WORDS = ('On an Android or Fire TV, applications are listed and opened through Phone & Device Control, and '
                 'now_playing says what is playing. This action is for a Roku or a Samsung TV.')


def need_app(ctx, kind, value):
    """The application's id in the one shape its kind of TV uses, or a refusal in words."""
    text = '' if value is None else str(value).strip()
    if not text:
        raise ctx.Refusal('app_required', 'Name the application by its id; list_apps reads the ids this TV has.')
    if kind == 'roku' and not ROKU_APP.match(text):
        raise ctx.Refusal('bad_app', 'A Roku application id is digits only; list_apps reads the ids this Roku has.')
    if kind != 'roku' and (len(text) > MAX_APP_ID or not SAMSUNG_APP.match(text)):
        raise ctx.Refusal('bad_app', 'A Samsung application id is digits or a dotted name such as org.tizen.browser.')
    return text


def need_title(ctx, kind, args):
    """(contentId, mediaType) of the title to open inside the application, both '' when none is named."""
    content = str(args.get('contentId') or '').strip()
    media = str(args.get('mediaType') or '').strip()
    if not content and not media:
        return '', ''
    if kind != 'roku':
        raise ctx.Refusal('samsung_title_not_built', 'A title cannot be opened directly on a Samsung TV yet: each '
                          'application reads its own link format. Open the application without a title.')
    if not CONTENT_ID.match(content):
        raise ctx.Refusal('bad_content', "A title is named by the application's own content id (letters, digits and "
                          '. _ ~ : - only, at most 255 characters), never a web address.')
    canonical = next((name for name in MEDIA_TYPES if name.lower() == media.lower()), '')
    if media and not canonical:
        raise ctx.Refusal('bad_media_type', 'mediaType is one of ' + ', '.join(MEDIA_TYPES) + '.')
    return content, canonical


def post(address, port, path, timeout=6.0):
    """The status of one POST with no body to a fixed path the caller checked, never through a proxy; 0 when
    nothing answers."""
    conn = http.client.HTTPConnection(address, port, timeout=timeout)
    try:
        conn.request('POST', path, body=b'', headers={'User-Agent': 'oshal-phone-bridge', 'Accept': '*/*'})
        response = conn.getresponse()
        response.read(1024)
        return response.status
    except (OSError, http.client.HTTPException, ValueError):
        return 0
    finally:
        conn.close()


def roku_refused(ctx, status, address, what):
    """Say in words why a Roku did not do it; nothing when it answered 2xx."""
    if status == 0:
        raise ctx.Refusal('tv_not_answering',
                          f'The Roku at {address} did not answer. Check it is on and on this Wi-Fi.')
    if status in (401, 403):
        raise ctx.Refusal('roku_control_off', ROKU_CONTROL_OFF)
    if not 200 <= status < 300:
        raise ctx.Refusal('roku_failed', f'The Roku answered HTTP {status} to {what}.')


def roku_xml(ctx, tv, address, path, tag):
    """The root element of one read-only ECP answer, or a refusal in words."""
    status, body = tv.http_get(address, tv.ROKU_PORT, path, 3.0)
    roku_refused(ctx, status, address, path)
    try:
        root = None if b'<!DOCTYPE' in body or b'<!ENTITY' in body else ElementTree.fromstring(body)
    except ElementTree.ParseError:
        root = None
    if root is None or root.tag != tag:
        raise ctx.Refusal('roku_failed', f'The Roku answered {path} with something that is not its {tag} list.')
    return root


def roku_apps(ctx, tv, address):
    """(applications with a digit id, how many other entries such as TV inputs) from /query/apps."""
    apps, other = [], 0
    for item in roku_xml(ctx, tv, address, '/query/apps', 'apps').findall('app'):
        app_id, name = str(item.get('id') or '').strip(), tv.clip(item.text, 60)
        if ROKU_APP.match(app_id) and name:
            apps.append({'id': app_id, 'name': name})
        else:
            other += 1
    return apps, other


def roku_front(ctx, tv, address):
    """What a Roku says is in front: the application (or its home screen) and a screensaver showing over it."""
    root = roku_xml(ctx, tv, address, '/query/active-app', 'active-app')
    app, saver = root.find('app'), root.find('screensaver')
    app_id = tv.clip(app.get('id'), 40) if app is not None else ''
    return {'id': app_id or None, 'name': tv.clip(app.text if app is not None else '', 60) or 'Roku',
            'home': not app_id,
            'screensaver': (tv.clip(saver.text, 60) or 'Screensaver') if saver is not None else None}


def milliseconds(text):
    match = re.match(r'^(\d{1,12}) ms$', str(text or '').strip())
    return int(match.group(1)) if match else None


def roku_player(tv, address):
    """What a Roku's media player says (state, the application playing, position), or None when it does not say."""
    status, body = tv.http_get(address, tv.ROKU_PORT, '/query/media-player', 3.0)
    if status != 200 or b'<!DOCTYPE' in body or b'<!ENTITY' in body:
        return None
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return None
    if root.tag != 'player':
        return None
    plugin = root.find('plugin')
    app = {'id': tv.clip(plugin.get('id'), 40), 'name': tv.clip(plugin.get('name'), 60)} if plugin is not None else None
    return {'state': tv.clip(root.get('state'), 20) or 'none', 'app': app,
            'positionMs': milliseconds(root.findtext('position')),
            'durationMs': milliseconds(root.findtext('duration'))}


def roku_launch(ctx, tv, address, app, content, media):
    """Open one installed application on a Roku, with a title when named, then read what came to the front."""
    known = next((item for item in roku_apps(ctx, tv, address)[0] if item['id'] == app), None)
    if not known:
        raise ctx.Refusal('app_not_installed',
                          f'This Roku has no application with id {app}. list_apps reads the ids it has.')
    query = '?contentId=' + quote(content, safe='') + ('&mediaType=' + media if media else '') if content else ''
    status = post(address, tv.ROKU_PORT, '/launch/' + app + query)
    if status == 404:
        raise ctx.Refusal('app_not_installed', f'The Roku answered that it has no application with id {app}.')
    roku_refused(ctx, status, address, 'the launch')
    front, end = None, time.monotonic() + FRONT_WAIT_S
    try:
        while True:
            front = roku_front(ctx, tv, address)
            if front['id'] == app or time.monotonic() >= end:
                break
            time.sleep(FRONT_STEP_S)
    except ctx.Refusal:
        front = None
    result = {'app': known, 'front': front, 'inFront': front['id'] == app if front else None}
    if content:
        result.update({'contentId': content}, **({'mediaType': media} if media else {}))
    return result


def samsung_state(ctx, tv, address, app):
    """What a Samsung TV says about one application: its name, whether it is running and whether it is visible."""
    status, body = tv.http_get(address, tv.SAMSUNG_REST_PORT, '/api/v2/applications/' + app, 3.0)
    if status == 404:
        raise ctx.Refusal('app_not_installed', f'The TV answered that it has no application with id {app}.')
    if status == 0:
        raise ctx.Refusal('tv_not_answering', f'The TV at {address} did not answer. Turn it on or press Wake first.')
    try:
        doc = json.loads(body.decode('utf-8', 'replace')) if status == 200 else None
    except ValueError:
        doc = None
    if not isinstance(doc, dict):
        raise ctx.Refusal('samsung_failed', f'The TV answered HTTP {status} about that application, not its state.')
    flag = lambda name: doc.get(name) if isinstance(doc.get(name), bool) else None  # noqa: E731
    named = {'id': app, 'name': tv.clip(doc.get('name'), 60) or app}
    if tv.clip(doc.get('version'), 20):
        named['version'] = tv.clip(doc.get('version'), 20)
    return {'app': named, 'running': flag('running'), 'visible': flag('visible'), 'inFront': flag('visible') is True}


def samsung_emit(ctx, tv, address, mac, event, data, wait):
    """Send one event on the TV's paired remote channel and answer the TV's event of the same name, or None."""
    channel, _ = tv.samsung_session(ctx, address, mac)
    try:
        params = dict({'event': event, 'to': 'host'}, **({'data': data} if data is not None else {}))
        tv.ws_send_json(channel, {'method': 'ms.channel.emit', 'params': params})
        deadline = time.monotonic() + wait
        while True:
            message = tv.ws_next_json(ctx, channel, deadline)
            if message is None or message.get('event') == event:
                return message
    finally:
        tv.ws_close(channel)


def samsung_launch(ctx, tv, address, mac, app):
    """Open one application on a Samsung TV: its REST port first, its paired remote channel when that is refused;
    then read whether the TV says it is running and visible."""
    status = post(address, tv.SAMSUNG_REST_PORT, '/api/v2/applications/' + app)
    missing = ctx.Refusal('app_not_installed', f'The TV answered that it has no application with id {app}.')
    if status == 404:
        raise missing
    via = 'rest'
    if not 200 <= status < 300:
        via = 'remote-channel'
        answer = samsung_emit(ctx, tv, address, mac, 'ed.apps.launch',
                              {'appId': app, 'action_type': 'DEEP_LINK', 'metaTag': ''}, LAUNCH_WAIT_S)
        if answer is not None and str(answer.get('data')) == '404':
            raise missing
    state, end = None, time.monotonic() + FRONT_WAIT_S
    try:
        while True:
            state = samsung_state(ctx, tv, address, app)
            if state['visible'] is True or time.monotonic() >= end:
                break
            time.sleep(FRONT_STEP_S)
    except ctx.Refusal:
        state = state or {'app': {'id': app, 'name': app}, 'running': None, 'visible': None, 'inFront': None}
    return dict(state, via=via)


def samsung_apps(ctx, tv, address, mac):
    """(applications with a usable id, how many other entries) a Samsung TV lists on its paired remote channel."""
    answer = samsung_emit(ctx, tv, address, mac, 'ed.installedApp.get', None, APPS_WAIT_S)
    data = answer.get('data') if answer else None
    rows = data.get('data') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ctx.Refusal('samsung_no_app_list', 'This TV did not list its applications; not every Samsung TV does. '
                          'An application still opens by its id.')
    apps, other = [], 0
    for row in rows:
        app_id = str(row.get('appId') or '') if isinstance(row, dict) else ''
        name = tv.clip(row.get('name'), 60) if isinstance(row, dict) else ''
        if name and len(app_id) <= MAX_APP_ID and SAMSUNG_APP.match(app_id):
            apps.append({'id': app_id, 'name': name})
        else:
            other += 1
    return apps, other


def listed(ctx, apps, other):
    """The list as one bridge line carries it: at most MAX_APPS applications, fewer when the line would be too long."""
    answer = {'apps': apps[:MAX_APPS], 'total': len(apps), 'otherCount': other}
    while answer['apps'] and len(json.dumps(answer, separators=(',', ':'))) > ctx.MAX_OUT - 600:
        answer['apps'].pop()
    if len(answer['apps']) < len(apps):
        answer['truncated'] = True
    return answer


def control(ctx, kind, address, mac, action, args):
    """One of ACTIONS on a Roku or a Samsung TV; an Android TV is refused in words before anything runs. Every
    argument is checked before anything is sent."""
    if kind not in KINDS or action not in ACTIONS:
        raise ctx.Refusal('roku_samsung_only', ANDROID_WORDS)
    import oshal_phone_lan as tv  # when called: oshal_phone_lan imports this module as it loads
    roku = kind == 'roku'
    if action == 'list_apps':
        return listed(ctx, *(roku_apps(ctx, tv, address) if roku else samsung_apps(ctx, tv, address, mac)))
    if action == 'active_app' and roku:
        return {'front': roku_front(ctx, tv, address), 'player': roku_player(tv, address)}
    if action == 'active_app':
        if not str(args.get('app') or '').strip():
            raise ctx.Refusal('app_required', 'A Samsung TV answers about one application at a time: name it by its '
                              'id (list_apps reads the ids), and it says whether that application is running and '
                              'in front.')
        return samsung_state(ctx, tv, address, need_app(ctx, kind, args.get('app')))
    app = need_app(ctx, kind, args.get('app'))
    content, media = need_title(ctx, kind, args)
    return roku_launch(ctx, tv, address, app, content, media) if roku else samsung_launch(ctx, tv, address, mac, app)
