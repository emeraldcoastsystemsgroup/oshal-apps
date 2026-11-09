#!/usr/bin/env python3
"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | 1.5.2: judge what the running search reports, not what
    |                                         | compose.yaml says. install-engine.sh pipes OpenSearch's
    |                                         | GET /_cluster/settings?include_defaults=true&flat_settings=true
    |                                         | into this guard with the three free-space watermarks
    |                                         | compose.yaml declares; it passes only when the values the
    |                                         | cluster applies (transient over persistent over the node's
    |                                         | own settings, which include_defaults reports under defaults)
    |                                         | are exactly those and cluster.blocks.create_index is not on.
    |                                         | On 2026-11-08 the engine's search ran the default 85/90/95 %
    |                                         | watermarks on a 91 % full disk with 310 GB free and held the
    |                                         | index-create block, so every new rule index came back HTTP 403.

Usage: <settings JSON on stdin> | python3 search-disk-guard.py <low> <high> <flood_stage>
Prints one JSON line and exits 0 when search judges disk by those free-space values and does not
block new indexes, 1 when it does not (each reason named), 2 on a usage error.
"""
import json
import sys

WATERMARK = 'cluster.routing.allocation.disk.watermark.'
LEVELS = ('low', 'high', 'flood_stage')
BLOCK = 'cluster.blocks.create_index'
MONITOR = 'cluster.routing.allocation.disk.threshold_enabled'
AUTO_RELEASE = 'cluster.blocks.create_index.auto_release'


def flatten(value, prefix=''):
    """Dotted keys for a settings section, whether OpenSearch answered it flat or nested."""
    if not isinstance(value, dict):
        return {prefix: value}
    flat = {}
    for key, child in value.items():
        flat.update(flatten(child, prefix + '.' + key if prefix else key))
    return flat


def effective(response, key):
    """The value the cluster applies: transient, else persistent, else the node's own or built-in default."""
    for section in ('transient', 'persistent', 'defaults'):
        found = flatten(response.get(section) or {})
        if key in found and found[key] is not None:
            return str(found[key])
    return None


def judge(response, expected):
    """Every reason search would still refuse a new rule index, or none; with what it applies now."""
    applied = {level: effective(response, WATERMARK + level) for level in LEVELS}
    problems = [
        WATERMARK + level + ' is ' + str(applied[level]) + ', not the ' + want + ' free space compose.yaml sets'
        for level, want in zip(LEVELS, expected) if applied[level] != want
    ]
    blocked = effective(response, BLOCK) == 'true'
    monitor, release = effective(response, MONITOR), effective(response, AUTO_RELEASE)
    if blocked:
        reason = BLOCK + ' is true: search refuses every new index, so each new rule index answers HTTP 403'
        if monitor == 'false' or release == 'false':
            reason += ' (and with ' + MONITOR + '=' + str(monitor) + ', ' + AUTO_RELEASE + '=' + str(release) + ' nothing lifts it)'
        problems.append(reason)
    return problems, {'watermarks': applied, 'createIndexBlock': blocked, 'diskMonitor': monitor, 'autoRelease': release}


def main(argv, stdin):
    """Read the settings answer, judge it and say so in one line."""
    if len(argv) != 4 or not all(argv[1:]):
        print('usage: <settings JSON> | search-disk-guard.py <low> <high> <flood_stage>', file=sys.stderr)
        return 2
    try:
        response = json.loads(stdin.read())
        if not isinstance(response, dict):
            raise ValueError('not a settings object')
    except ValueError as error:
        print(json.dumps({'status': 'failed', 'problems': ['search did not answer its settings: ' + str(error)[:200]]}))
        return 1
    problems, applied = judge(response, argv[1:])
    print(json.dumps({'status': 'failed' if problems else 'passed', **applied, **({'problems': problems} if problems else {})}))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv, sys.stdin))
