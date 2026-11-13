# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.12.0 (T79, the device inventory, first slice): tv_apps says which
#   streaming apps an Android or Fire TV has, so Jarvis can answer "what can my TV play" and pick the app to use. It
#   reads the TV's package list once (pm list packages) and maps it through a closed list: the streaming apps Open a
#   Link knows (oshal_phone_links.STREAMING_APPS), Prime Video's own Fire TV package that Play a Show drives
#   (oshal_phone_play.SEARCH, measured on a Fire TV Stick, AFTMD001) and the oshal TV app. Every other package is only
#   counted, never named. Nothing on the TV is pressed, woken or opened.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0 (T79, the device inventory): tv_apps also says the TV's model and
#   maker, from two more reads (getprop ro.product.model and ro.product.manufacturer), each kept only when it is a plain
#   name, so the person's inventory can say that a TV saved here may be the one signed in with the oshal app. A property
#   that cannot be read is left out; it never fails the read. Still nothing is pressed, woken or opened.
"""Which streaming apps an Android or Fire TV has (lan-control tv_apps): its package list read once and mapped through
a closed list of known apps; nothing on the TV is pressed, woken or opened."""

import re

import oshal_phone_links
import oshal_phone_play

LIST_COMMAND = 'pm list packages'
# The two properties read beside the list, and the shape a value must have to be kept.
PROPERTIES = (('model', 'ro.product.model'), ('maker', 'ro.product.manufacturer'))
PROPERTY_VALUE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$')
PACKAGE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$')
# More packages of the same services than the links list opens: Prime Video's own Fire TV app (com.amazon.firebat).
MORE_PACKAGES = {key: (package,) for key, (package, _search) in oshal_phone_play.SEARCH.items()}
# key, name, packages (the first installed one is answered), in the order the answer lists them.
KNOWN_APPS = tuple(
    (key, oshal_phone_links.NAMES[key], packages + tuple(p for p in MORE_PACKAGES.get(key, ()) if p not in packages))
    for key, (packages, _sites) in oshal_phone_links.STREAMING_APPS.items()
) + (('oshal', 'oshal TV app', (oshal_phone_links.OSHAL_TV_APP,)),)


def installed_packages(text):
    """The package names in `pm list packages` output; any other line is ignored. Pure."""
    names = set()
    for line in str(text or '').splitlines():
        line = line.strip()
        if line.startswith('package:') and PACKAGE.match(line[len('package:'):].strip()):
            names.add(line[len('package:'):].strip())
    return names


def known_apps(installed):
    """The known apps among `installed`, one entry per app with its first installed package, and how many installed
    packages are none of them (counted, never named). Pure."""
    apps, known = [], set()
    for key, name, packages in KNOWN_APPS:
        known.update(packages)
        package = next((p for p in packages if p in installed), None)
        if package:
            apps.append({'key': key, 'name': name, 'package': package})
    return {'apps': apps, 'unknownCount': len(set(installed) - known)}


def read_property(ctx, shell, name):
    """One system property's value when it is a plain name, else empty; a failed read is empty, never a refusal."""
    try:
        lines = str(shell(f'getprop {name}') or '').strip().splitlines()
    except ctx.Refusal:
        return ''
    value = lines[0].strip() if lines else ''
    return value if PROPERTY_VALUE.match(value) else ''


def tv_apps(ctx, shell):
    """Which of the known apps this TV has, from one read of its package list, with its model and maker when they
    can be read; nothing is pressed. `shell(command)` runs one adb shell command on the TV and answers its output."""
    installed = installed_packages(shell(LIST_COMMAND))
    if not installed:
        raise ctx.Refusal('no_app_list', 'The TV answered without a list of its apps. Ask again in a moment.')
    found = known_apps(installed)
    for key, name in PROPERTIES:
        value = read_property(ctx, shell, name)
        if value:
            found[key] = value
    return found
