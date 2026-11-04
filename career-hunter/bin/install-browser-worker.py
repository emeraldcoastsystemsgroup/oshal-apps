#!/usr/bin/env python3
"""Install the reviewed Career browser worker for one genuine original-owner node.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Validate the exact device's owner and browser binding, keep credentials private, stage pinned runtime code and prepare/start one per-person bare-metal user service without impersonating a person.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import urllib.request
import urllib.parse

BOT = 'cb000000-0000-0000-0000-000000000004'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
FILES = ['lib/career-browser-worker.js', 'lib/career-submission-browser.js',
         'lib/career-submission-queue.js', 'lib/autofill-bookmarklet.js',
         'bin/career-browser-worker.cjs']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A device credential is never redirected away from its intended kernel."""
    def redirect_request(self, request, response, code, message, headers, newurl):
        raise ValueError('worker kernel profile redirected unexpectedly')


def validate(value):
    allowed = {'version', 'kernelUrl', 'nodeId', 'deviceToken', 'botId', 'owner', 'tenant'}
    if not isinstance(value, dict) or set(value) != allowed or value['version'] != 1:
        raise ValueError('worker configuration has unsupported fields')
    url = urllib.parse.urlsplit(value['kernelUrl'])
    if (url.username or url.password or url.query or url.fragment or url.path not in ('', '/')
            or url.scheme not in ('https', 'http') or url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('worker configuration needs the intended secure kernel origin')
    if any(not UUID.fullmatch(str(value[key])) for key in ('nodeId', 'owner', 'tenant')):
        raise ValueError('worker configuration has invalid original-owner identifiers')
    if value['botId'] != BOT or not isinstance(value['deviceToken'], str) or not 24 <= len(value['deviceToken']) <= 512:
        raise ValueError('worker configuration does not name the Career browser binding')
    return value


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('worker directories must be private and owned by this user')
    return path


def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def install(args):
    supplied = Path(args.config).absolute()
    info = supplied.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_size > 8192:
        raise ValueError('worker configuration must be a bounded regular owner file')
    supplied.chmod(0o600)
    value = validate(json.loads(supplied.read_text()))
    request = urllib.request.Request(value['kernelUrl'].rstrip('/') + '/nodes/' + value['nodeId'] + '/profile',
                                     headers={'x-oshal-node-token': value['deviceToken']})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        raw = response.read(32769)
    if len(raw) > 32768:
        raise ValueError('device profile exceeded its bound')
    node = json.loads(raw)
    if (any(node.get(key) != value[key] for key in ('owner', 'tenant')) or node.get('id') != value['nodeId']
            or node.get('harness') != 'browser-form-v1' or node.get('supported_work_executor') != 'browser-form-v1'
            or node.get('capabilities', {}).get('browse') is not True or node.get('bound_bots') != [BOT]):
        raise ValueError('device profile differs from the original owner or exact Career browser binding')
    modules = Path(args.node_modules).resolve(strict=True)
    for name in ('playwright', 'playwright-core'):
        package = json.loads((modules / name / 'package.json').read_text())
        if package.get('name') != name or package.get('version') != '1.59.1':
            raise ValueError('install the pinned official Playwright 1.59.1 runtime first')
    if args.check_only:
        print(json.dumps({'verified': True, 'owner': value['owner'], 'nodeId': value['nodeId'], 'botId': BOT}))
        return
    base = private_dir(Path.home() / '.local/state/oshal-native/career-browser')
    runtime = base / 'runtime-1.59.1'
    if not runtime.exists():
        private_dir(runtime)
        for name in ('playwright', 'playwright-core'):
            shutil.copytree(modules / name, runtime / 'node_modules' / name)
        for path in [*runtime.rglob('*'), runtime]:
            path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o222)
    releases = private_dir(base / 'releases')
    source = Path(__file__).resolve().parent.parent
    import hashlib
    source_hash = hashlib.sha256(b''.join((source / name).read_bytes() for name in FILES)).hexdigest()
    release = releases / source_hash
    if not release.exists():
        private_dir(release)
        for name in FILES:
            target = release / name
            target.parent.mkdir(exist_ok=True, mode=0o700)
            target.write_bytes((source / name).read_bytes())
        for path in [*release.rglob('*'), release]:
            path.chmod(0o500 if path.is_dir() else 0o400)
    environment = {**os.environ, 'NODE_PATH': str(runtime / 'node_modules')}
    executable = shutil.which('node')
    if not executable:
        raise ValueError('Node.js is required')
    program = release / 'bin/career-browser-worker.cjs'
    fingerprint = subprocess.check_output([executable, str(program), '--fingerprint'], env=environment, text=True).strip()
    if not re.fullmatch('[a-f0-9]{64}', fingerprint):
        raise ValueError('worker fingerprint was not produced')
    people = private_dir(base / 'people')
    person = private_dir(people / value['owner'])
    settings = {key: value[key] for key in ('version', 'kernelUrl', 'nodeId', 'deviceToken', 'botId')}
    settings.update(profileDir=str(private_dir(person / 'profile')), workDir=str(private_dir(person / 'work')), headless=True)
    config = person / 'worker.json'
    if config.exists() and json.loads(config.read_text()) != settings:
        raise ValueError('an existing different worker configuration needs explicit review')
    if not config.exists():
        descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(settings, stream)
    units = Path.home() / '.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    service = 'oshal-career-browser-' + value['owner'] + '.service'
    unit = ('[Unit]\nDescription=Approved Career browser submissions\nAfter=network-online.target oshal-native.service\n\n'
            '[Service]\nType=simple\nUMask=0077\nEnvironment=' + quote('NODE_PATH=' + str(runtime / 'node_modules'))
            + '\nExecStart=' + ' '.join(map(quote, [executable, program, config, '--expected-sha256', fingerprint]))
            + '\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths='
            + quote(person) + '\n\n[Install]\nWantedBy=default.target\n')
    (units / service).write_text(unit)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    if args.start:
        subprocess.run(['systemctl', '--user', 'enable', '--now', service], check=True)
    # Only nonsecret operational identifiers enter output.
    print(json.dumps({'service': service, 'owner': value['owner'], 'nodeId': value['nodeId'],
                      'fingerprint': fingerprint, 'started': args.start}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--node-modules', required=True)
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    try:
        install(parser.parse_args())
    except Exception:
        raise SystemExit('Career browser worker installation refused; no credential was logged.')
