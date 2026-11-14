#!/usr/bin/env python3
"""Install the reviewed Career browser worker for one genuine original-owner node, or upgrade an installed one in place.

CHANGE LOG
4 | maintainer@emeraldcoastsystemsgroup.com | The device profile read is bounded at 4 MiB, not 32 KB: the kernel's profile now carries the jarvis_node section (107 KB on the Spark), so --upgrade --check-only, --upgrade and a fresh install all refused the real kernel as kernel_unreachable.
3 | maintainer@emeraldcoastsystemsgroup.com | --upgrade makes an installed helper current without a new enrolment (defect 16): it reuses the installed private settings file and enrolled device, copies the program from the delivered package (--package), rewrites only the unit's start line, restarts the service, and keeps the previous start line and program copy until the kernel's device profile reports the new fingerprint ready; otherwise it puts the previous start line back and restarts it. It refuses with no install, missing settings, a changed device or a helper still working, and --check-only compares the installed and delivered fingerprints without writing.
2 | maintainer@emeraldcoastsystemsgroup.com | Install the separately fingerprinted bounded submission step runtime.
2 | maintainer@emeraldcoastsystemsgroup.com | Install the fingerprinted local PNG shrinker with the browser worker so oversized confirmations remain retained.
1 | maintainer@emeraldcoastsystemsgroup.com | Validate the exact device's owner and browser binding, keep credentials private, stage pinned runtime code and prepare/start one per-person bare-metal user service without impersonating a person.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import time
import urllib.request
import urllib.parse

BOT = 'cb000000-0000-0000-0000-000000000004'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
HEX64 = re.compile(r'^[a-f0-9]{64}$')
FILES = ['lib/career-browser-worker.js', 'lib/career-submission-browser.js', 'lib/career-submission-steps.js',
         'lib/career-submission-queue.js', 'lib/career-submission-png.js', 'lib/autofill-bookmarklet.js',
         'bin/career-browser-worker.cjs']
SETTINGS = {'version', 'kernelUrl', 'nodeId', 'deviceToken', 'botId', 'profileDir', 'workDir', 'headless'}
PREFIX = 'oshal-career-browser-'
# The kernel's device profile carries the person's jarvis_node section (guides, sibling devices, memory scopes): 107 KB
# on the Spark on 2026-11-13, so the former 32 KB bound refused every real kernel. 4 MiB still bounds the read.
PROFILE_BOUND = 4 * 1024 * 1024


class Refused(Exception):
    """A closed, nonsecret reason an upgrade stopped; only these codes reach the output."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A device credential is never redirected away from its intended kernel."""
    def redirect_request(self, request, response, code, message, headers, newurl):
        raise ValueError('worker kernel profile redirected unexpectedly')


def validate_origin(kernel_url):
    url = urllib.parse.urlsplit(kernel_url)
    if (url.username or url.password or url.query or url.fragment or url.path not in ('', '/')
            or url.scheme not in ('https', 'http') or url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('worker configuration needs the intended secure kernel origin')


def validate(value):
    allowed = {'version', 'kernelUrl', 'nodeId', 'deviceToken', 'botId', 'owner', 'tenant'}
    if not isinstance(value, dict) or set(value) != allowed or value['version'] != 1:
        raise ValueError('worker configuration has unsupported fields')
    validate_origin(value['kernelUrl'])
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


def device_profile(kernel_url, node_id, token):
    """The device's own kernel profile, fetched with its header credential, bounded and never redirected."""
    request = urllib.request.Request(kernel_url.rstrip('/') + '/nodes/' + node_id + '/profile',
                                     headers={'x-oshal-node-token': token})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        raw = response.read(PROFILE_BOUND + 1)
    if len(raw) > PROFILE_BOUND:
        raise ValueError('device profile exceeded its bound')
    return json.loads(raw)


def exact_binding(node, owner, node_id, tenant=None):
    """The device is still the owner's browser-form node tied to the Career submission bot alone."""
    return (isinstance(node, dict) and node.get('owner') == owner and node.get('id') == node_id
            and (tenant is None or node.get('tenant') == tenant)
            and node.get('harness') == 'browser-form-v1' and node.get('supported_work_executor') == 'browser-form-v1'
            and (node.get('capabilities') or {}).get('browse') is True and node.get('bound_bots') == [BOT])


def pinned_modules(modules):
    for name in ('playwright', 'playwright-core'):
        package = json.loads((modules / name / 'package.json').read_text())
        if package.get('name') != name or package.get('version') != '1.59.1':
            raise ValueError('install the pinned official Playwright 1.59.1 runtime first')
    return modules


def stage_runtime(base, modules):
    runtime = base / 'runtime-1.59.1'
    if not runtime.exists():
        private_dir(runtime)
        for name in ('playwright', 'playwright-core'):
            shutil.copytree(modules / name, runtime / 'node_modules' / name)
        for path in [*runtime.rglob('*'), runtime]:
            path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o222)
    return runtime


def stage_release(base, source):
    """Copy the program into a content-addressed, read-only release; an existing copy must hold the same bytes."""
    releases = private_dir(base / 'releases')
    contents = [(name, (source / name).read_bytes()) for name in FILES]
    release = releases / hashlib.sha256(b''.join(data for _, data in contents)).hexdigest()
    if not release.exists():
        private_dir(release)
        for name, data in contents:
            target = release / name
            target.parent.mkdir(exist_ok=True, mode=0o700)
            target.write_bytes(data)
        for path in [*release.rglob('*'), release]:
            path.chmod(0o500 if path.is_dir() else 0o400)
    elif any((release / name).read_bytes() != data for name, data in contents):
        raise ValueError('an existing release copy differs from its package')
    return release


def fingerprint_of(executable, program, runtime):
    """The fingerprint the program reports under the unit's own environment (NODE_PATH, no browser override)."""
    environment = {**os.environ, 'NODE_PATH': str(runtime / 'node_modules')}
    environment.pop('CAREER_BROWSER_EXECUTABLE', None)
    fingerprint = subprocess.check_output([executable, str(program), '--fingerprint'], env=environment, text=True,
                                          timeout=120).strip()
    if not HEX64.fullmatch(fingerprint):
        raise ValueError('worker fingerprint was not produced')
    return fingerprint


def unit_text(executable, program, config, fingerprint, runtime, person):
    return ('[Unit]\nDescription=Approved Career browser submissions\nAfter=network-online.target oshal-native.service\n\n'
            '[Service]\nType=simple\nUMask=0077\nEnvironment=' + quote('NODE_PATH=' + str(runtime / 'node_modules'))
            + '\nExecStart=' + ' '.join(map(quote, [executable, program, config, '--expected-sha256', fingerprint]))
            + '\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths='
            + quote(person) + '\n\n[Install]\nWantedBy=default.target\n')


def install(args):
    if not args.config or not args.node_modules:
        raise ValueError('installation needs --config and --node-modules')
    supplied = Path(args.config).absolute()
    info = supplied.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_size > 8192:
        raise ValueError('worker configuration must be a bounded regular owner file')
    supplied.chmod(0o600)
    value = validate(json.loads(supplied.read_text()))
    node = device_profile(value['kernelUrl'], value['nodeId'], value['deviceToken'])
    if not exact_binding(node, value['owner'], value['nodeId'], value['tenant']):
        raise ValueError('device profile differs from the original owner or exact Career browser binding')
    modules = pinned_modules(Path(args.node_modules).resolve(strict=True))
    if args.check_only:
        print(json.dumps({'verified': True, 'owner': value['owner'], 'nodeId': value['nodeId'], 'botId': BOT}))
        return
    base = private_dir(Path.home() / '.local/state/oshal-native/career-browser')
    runtime = stage_runtime(base, modules)
    release = stage_release(base, Path(__file__).resolve().parent.parent)
    executable = shutil.which('node')
    if not executable:
        raise ValueError('Node.js is required')
    program = release / 'bin/career-browser-worker.cjs'
    fingerprint = fingerprint_of(executable, program, runtime)
    person = private_dir(private_dir(base / 'people') / value['owner'])
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
    service = PREFIX + value['owner'] + '.service'
    (units / service).write_text(unit_text(executable, program, config, fingerprint, runtime, person))
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    if args.start:
        subprocess.run(['systemctl', '--user', 'enable', '--now', service], check=True)
    # Only nonsecret operational identifiers enter output.
    print(json.dumps({'service': service, 'owner': value['owner'], 'nodeId': value['nodeId'],
                      'fingerprint': fingerprint, 'started': args.start}))


def existing_private_dir(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise Refused('no_install') from None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise Refused('install_not_private')
    return path


def find_install(owner):
    """The one installed person: named by --owner, or the only Career helper unit present."""
    units = Path.home() / '.config/systemd/user'
    names = sorted(p.name for p in units.glob(PREFIX + '*.service')) if units.is_dir() else []
    if owner is None:
        if len(names) != 1:
            raise Refused('owner_ambiguous' if names else 'no_install')
        owner = names[0][len(PREFIX):-len('.service')]
    if not UUID.fullmatch(owner):
        raise Refused('owner_invalid')
    service = PREFIX + owner + '.service'
    if service not in names or not stat.S_ISREG((units / service).lstat().st_mode):
        raise Refused('no_install')
    base = existing_private_dir(Path.home() / '.local/state/oshal-native/career-browser')
    person = existing_private_dir(existing_private_dir(base / 'people') / owner)
    return {'base': base, 'person': person, 'owner': owner, 'service': service, 'unit': units / service}


def installed_settings(person):
    """The installed settings file, checked as the worker checks it; its token is used, never printed."""
    config = person / 'worker.json'
    try:
        info = config.lstat()
    except FileNotFoundError:
        raise Refused('settings_missing') from None
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077
            or info.st_size > 8192):
        raise Refused('settings_invalid')
    try:
        value = json.loads(config.read_text())
        validate_origin(value['kernelUrl'])
    except (ValueError, KeyError, TypeError):
        raise Refused('settings_invalid') from None
    if (not isinstance(value, dict) or set(value) != SETTINGS or value['version'] != 1 or value['botId'] != BOT
            or not UUID.fullmatch(str(value['nodeId'])) or not isinstance(value['deviceToken'], str)
            or not 24 <= len(value['deviceToken']) <= 512 or value['profileDir'] != str(person / 'profile')
            or value['workDir'] != str(person / 'work') or value['headless'] is not True):
        raise Refused('settings_invalid')
    return config, value


def pinned_unit(found, config, runtime):
    """Read back the start line this installer wrote; a unit it did not write exactly is not rewritten."""
    text = found['unit'].read_text()
    starts = [line for line in text.splitlines() if line.startswith('ExecStart=')]
    words = shlex.split(starts[0][len('ExecStart='):]) if len(starts) == 1 else []
    if len(words) != 5 or words[3] != '--expected-sha256' or not HEX64.fullmatch(words[4]) or words[2] != str(config):
        raise Refused('unit_unrecognized')
    program = Path(words[1])
    if (program.parent.parent.parent != found['base'] / 'releases' or program.name != 'career-browser-worker.cjs'
            or text != unit_text(words[0], program, config, words[4], runtime, found['person'])):
        raise Refused('unit_unrecognized')
    return {'text': text, 'executable': words[0], 'program': program, 'fingerprint': words[4]}


def package_source(path):
    source = Path(path).resolve(strict=True)
    for name in FILES:
        info = (source / name).lstat()
        if not stat.S_ISREG(info.st_mode):
            raise Refused('package_incomplete')
    return source


def helper_idle(settings):
    """A restart mid-application would strand it; a pending result must be reported by the program that made it."""
    work = Path(settings['workDir'])
    names = [entry.name for entry in work.iterdir()] if work.is_dir() else []
    if any(name.endswith('.result.json') or name.endswith('.result.json.tmp') for name in names):
        raise Refused('helper_result_pending')
    if any(name.startswith('work-') for name in names):
        raise Refused('helper_busy')


def observe(settings, owner):
    try:
        node = device_profile(settings['kernelUrl'], settings['nodeId'], settings['deviceToken'])
    except Exception:
        return None
    return node if exact_binding(node, owner, settings['nodeId']) else None


def sees(node, fingerprint, after=None):
    """The kernel's own readiness (work_ready: lease, executor, generation, bot) for exactly this program."""
    generation = node.get('generation') if node else None
    return (isinstance(generation, list) and len(generation) == 32
            and all(type(b) is int and 0 <= b <= 255 for b in generation) and bytes(generation).hex() == fingerprint
            and node.get('status') == 'connected' and node.get('work_ready') is True
            and (after is None or (type(node.get('last_seen')) is int and node['last_seen'] > after)))


def restart_ready(found, settings, fingerprint, seconds):
    """Restart, then wait for a heartbeat newer than the restart that reports this fingerprint ready."""
    before = observe(settings, found['owner'])
    after = before.get('last_seen') if before and type(before.get('last_seen')) is int else 0
    if subprocess.run(['systemctl', '--user', 'daemon-reload'], stdout=subprocess.DEVNULL).returncode != 0:
        return False
    if subprocess.run(['systemctl', '--user', 'restart', found['service']], stdout=subprocess.DEVNULL).returncode != 0:
        return False
    deadline = time.monotonic() + seconds
    while not sees(observe(settings, found['owner']), fingerprint, after):
        if time.monotonic() >= deadline:
            return False
        time.sleep(1)
    return True


def replace_text(path, text, mode):
    temporary = path.with_name('.' + path.name + '.upgrade')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(text)
    os.chmod(temporary, mode)
    os.replace(temporary, path)


@contextlib.contextmanager
def upgrade_lock(base):
    descriptor = os.open(base / '.upgrade.lock', os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(descriptor)
        raise Refused('upgrade_running') from None
    try:
        yield
    finally:
        os.close(descriptor)


def switch(found, current, settings, fingerprint, program, runtime, seconds):
    """Re-pin, restart and confirm; on any miss put the previous start line back and restart it."""
    mode = stat.S_IMODE(found['unit'].stat().st_mode)
    replace_text(private_dir(found['base'] / 'unit-backups') / found['service'], current['text'], 0o600)
    config = found['person'] / 'worker.json'
    replace_text(found['unit'], unit_text(current['executable'], program, config, fingerprint, runtime, found['person']), mode)
    ready = False
    try:
        ready = restart_ready(found, settings, fingerprint, seconds)
    finally:
        if not ready:
            replace_text(found['unit'], current['text'], mode)
            back = restart_ready(found, settings, current['fingerprint'], seconds)
            print(json.dumps({'upgraded': False, 'rolledBack': True, 'previousReady': back, 'reason': 'new_program_not_ready',
                              'service': found['service'], 'owner': found['owner'], 'nodeId': settings['nodeId'],
                              'fingerprint': current['fingerprint'], 'attemptedFingerprint': fingerprint}))
    if not ready:
        raise SystemExit(1)


def upgrade(args):
    found = find_install(args.owner)
    with upgrade_lock(found['base']):
        config, settings = installed_settings(found['person'])
        runtime = found['base'] / 'runtime-1.59.1'
        try:
            pinned_modules(runtime / 'node_modules')
        except (OSError, ValueError):
            raise Refused('runtime_missing') from None
        current = pinned_unit(found, config, runtime)
        try:
            node = device_profile(settings['kernelUrl'], settings['nodeId'], settings['deviceToken'])
        except Exception:
            raise Refused('kernel_unreachable') from None
        if not exact_binding(node, found['owner'], settings['nodeId']):
            raise Refused('device_not_current')
        source = package_source(args.package or Path(__file__).resolve().parent.parent)
        report = {'service': found['service'], 'owner': found['owner'], 'nodeId': settings['nodeId']}
        if args.check_only:
            delivered = fingerprint_of(current['executable'], source / 'bin/career-browser-worker.cjs', runtime)
            print(json.dumps({'checkOnly': True, **report, 'installedFingerprint': current['fingerprint'],
                              'deliveredFingerprint': delivered, 'current': delivered == current['fingerprint'],
                              'kernelSeesInstalled': sees(node, current['fingerprint'])}))
            return
        helper_idle(settings)
        program = stage_release(found['base'], source) / 'bin/career-browser-worker.cjs'
        fingerprint = fingerprint_of(current['executable'], program, runtime)
        if fingerprint == current['fingerprint']:
            print(json.dumps({'upgraded': False, 'current': True, **report, 'fingerprint': fingerprint}))
            return
        switch(found, current, settings, fingerprint, program, runtime, args.ready_timeout)
        print(json.dumps({'upgraded': True, **report, 'previousFingerprint': current['fingerprint'],
                          'fingerprint': fingerprint, 'release': program.parent.parent.name, 'ready': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config')
    parser.add_argument('--node-modules')
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--upgrade', action='store_true', help='re-pin the installed helper to the delivered program in place')
    parser.add_argument('--owner', help='upgrade: the installed person id, when more than one is installed')
    parser.add_argument('--package', help='upgrade: the delivered career-hunter package to copy the program from')
    parser.add_argument('--ready-timeout', type=int, default=90, help='upgrade: seconds to wait for the kernel to see it ready')
    arguments = parser.parse_args()
    try:
        (upgrade if arguments.upgrade else install)(arguments)
    except Refused as refusal:
        raise SystemExit('Career browser worker upgrade refused: ' + str(refusal) + '; no credential was logged.')
    except Exception:
        raise SystemExit('Career browser worker installation refused; no credential was logged.')
