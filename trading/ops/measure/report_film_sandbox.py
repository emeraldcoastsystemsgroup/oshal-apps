#!/usr/bin/env python3
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Films a synthetic report through a throwaway kernel: the given oshald binary, a disposable database, this package from git, the real package sandbox, the installation's voice service and a real browser press. Nobody's data or session is involved, so it runs without acting as a person.
"""Prove a report film end to end in a throwaway installation.

Usage: report_film_sandbox.py --oshald BIN --bridge RUNNER --node-modules DIR --platform DIR --out DIR [--ref REF]
Prints one JSON summary. Everything it starts is stopped and removed on the way out; only --out stays.
"""
import argparse, json, os, re, secrets, shutil, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request, uuid
from pathlib import Path

HERE = Path(__file__).resolve()
STORE = HERE.parents[3]
SPEECH = {
    'OSHAL_TTS_PROVIDER': 'kokoro', 'OSHAL_TTS_MODEL': 'kokoro',
    'OSHAL_TTS_URL': 'http://127.0.0.1:8880/v1/audio/speech',
    'OSHAL_TTS_LOCAL_ENDPOINTS': json.dumps([{'url_prefix': 'http://127.0.0.1:8880/v1/audio/speech', 'addresses': ['127.0.0.1']}]),
}
ACCOUNTS = [
    {'label': 'Test brokerage …1111', 'equity': 25000.5, 'cash': 1200, 'strategyName': 'Synthetic long-term trend — whole shares — review',
     'authority': 'active', 'protectionAuthority': 'active',
     'activity': {'status': 'available', 'today': {'fills': 2, 'orders': 2, 'buyGross': 412.5, 'sellGross': 200},
                  'todayFills': [{'symbol': 'SPY', 'side': 'BUY', 'quantity': 1, 'price': 412.5, 'notional': 412.5},
                                 {'symbol': 'BIL', 'side': 'SELL', 'quantity': 2, 'price': 100, 'notional': 200}]},
     'positions': [{'symbol': 'SPY', 'qty': 40, 'marketValue': 16500}, {'symbol': 'BIL', 'qty': 70, 'marketValue': 7000}]},
    {'label': 'Test retirement …2222', 'equity': 9000, 'cash': 9000, 'strategyName': None, 'authority': 'off',
     'activity': {'status': 'available', 'today': {}, 'todayFills': []}, 'positions': []},
]


def run(*args, **kw):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True, **kw).stdout.strip()


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def call(base, token, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method, headers={
        'authorization': f'Bearer {token}', 'content-type': 'application/json', 'user-agent': 'curl/8'})
    try:
        with urllib.request.urlopen(request, timeout=90) as reply:
            return reply.status, json.loads(reply.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors='replace')[:400]


def wait_until(check, seconds, what):
    end = time.time() + seconds
    while time.time() < end:
        if check():
            return
        time.sleep(0.5)
    raise SystemExit(f'{what} did not happen in {seconds} s')


def start_database(name):
    run('docker', 'run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_USER=kernel', '-e', 'POSTGRES_PASSWORD=kernel',
        '-e', 'POSTGRES_DB=kernel', '-p', '127.0.0.1::5432', 'postgres:16')
    def ready():
        return subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'kernel', '-d', 'kernel', '-h', '127.0.0.1'],
                              capture_output=True).returncode == 0
    wait_until(ready, 60, 'the disposable database')
    return int(run('docker', 'port', name, '5432/tcp').rsplit(':', 1)[1].split()[0])


def sql(name, statement):
    return run('docker', 'exec', '-i', name, 'psql', '-U', 'kernel', '-d', 'kernel', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', statement)


def seed_report(name, base, token):
    """Trading saves the real rows for this owner; only the daily report's accounts are synthetic."""
    status, answer = call(base, token, 'POST', '/api/trading/paper/reports', {})
    if status != 200:
        raise SystemExit(f'saving the first report answered {status}: {answer}')
    status, tick = call(base, token, 'POST', '/api/trading/paper/reports/videos/tick', {})
    if status != 200:
        raise SystemExit(f'the first tick answered {status}: {tick}')
    session = tick['session']
    collection = 'pkg:intelligent-trades:trading_oshal_reports'
    scope, user = sql(name, f"select scope_key, body->>'user_sub' from documents where collection='{collection}' limit 1").split('|')
    report = dict(answer['report'], sessionDate=session, live=ACCOUNTS)
    report.pop('reportId', None)
    row = {'user_sub': user, 'report_id': f'daily-{session}', 'session_date': session, 'payload': json.dumps(report),
           'created_at': '2026-01-01T00:00:00.000Z'}
    key = json.dumps([user, row['report_id']])
    literal = json.dumps(row).replace("'", "''")
    sql(name, f"insert into documents (scope_key, collection, id, body) values ('{scope}', '{collection}', '{key}', '{literal}'::jsonb)")
    return session, tick


def probe(path):
    answer = json.loads(run('ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height:format=duration,size',
                            '-of', 'json', path))
    volume = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-'],
                            capture_output=True, text=True).stderr
    mean = re.search(r'mean_volume: (-?[\d.]+) dB', volume)
    return {'duration': float(answer['format']['duration']), 'bytes': int(answer['format']['size']),
            'streams': sorted(f"{s['codec_type']}:{s['codec_name']}" for s in answer['streams']),
            'width': next(s['width'] for s in answer['streams'] if s['codec_type'] == 'video'),
            'mean_volume_db': float(mean.group(1)) if mean else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('--oshald', '--bridge', '--node-modules', '--platform', '--out'):
        parser.add_argument(flag, required=True)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--python-path', default='')
    parser.add_argument('--connectors', default='')
    options = parser.parse_args()
    out = Path(options.out)
    out.mkdir(parents=True, exist_ok=True)
    name = 'oshal-film-proof-' + uuid.uuid4().hex[:8]
    root = Path(tempfile.mkdtemp(prefix='oshal-film-proof-'))
    root.chmod(0o700)
    kernel = None
    try:
        apps = root / 'apps'
        apps.mkdir()
        archive = subprocess.run(['git', '-C', STORE, 'archive', options.ref, 'trading'], check=True, capture_output=True).stdout
        subprocess.run(['tar', '-x', '-C', apps], input=archive, check=True)
        port, token = free_port(), secrets.token_urlsafe(32)
        database = start_database(name)
        for folder in ('package-data', 'application-files', 'home', 'kernel'):
            (root / folder).mkdir(mode=0o700)
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(root / 'home'), 'OSHAL_BIND': f'127.0.0.1:{port}',
               'OSHAL_POSTGRES': f'postgres://kernel:kernel@127.0.0.1:{database}/kernel', 'OSHAL_ADMIN_TOKEN': token,
               'OSHAL_VAULT_KEY': secrets.token_hex(32), 'OSHAL_DEPLOYMENT': 'home', 'OSHAL_APPLICATIONS_DIR': str(apps),
               'OSHAL_PACKAGE_DATA_DIR': str(root / 'package-data'), 'OSHAL_APPLICATION_FILES_DIR': str(root / 'application-files'),
               'OSHAL_JOURNAL_PATH': str(root / 'kernel/mesh.jsonl'), 'OSHAL_LEDGER_SPILL_PATH': str(root / 'kernel/spill.jsonl'),
               'OSHAL_PACKAGE_RUNTIME': '/usr/bin/node', 'OSHAL_BRIDGE_RUNNER': options.bridge,
               'OSHAL_PACKAGE_NODE_MODULES': options.node_modules, 'OSHAL_PLATFORM_DIR': options.platform, **SPEECH}
        if options.python_path:
            env['OSHAL_PACKAGE_PYTHON_PATH'] = options.python_path
        if options.connectors:
            env['OSHAL_CONNECTORS_DIR'] = options.connectors
        log = open(out / 'kernel.log', 'wb')
        kernel = subprocess.Popen([options.oshald, 'serve'], env=env, stdout=log, stderr=subprocess.STDOUT, cwd=root)
        base = f'http://127.0.0.1:{port}'
        def up():
            if kernel.poll() is not None:
                raise SystemExit(f'the kernel stopped with {kernel.returncode}; see {out / "kernel.log"}')
            try:
                return urllib.request.urlopen(base + '/readyz', timeout=2).status == 200
            except (urllib.error.URLError, OSError):
                return False
        wait_until(up, 120, 'the kernel')
        session, first = seed_report(name, base, token)
        film_dir = out / 'browser'
        walk = subprocess.run(['node', HERE.with_name('report_film_walk.cjs'), base, token, str(film_dir)],
                              capture_output=True, text=True, timeout=300, cwd=STORE,
                              env={'PATH': os.environ['PATH'], 'HOME': os.environ['HOME']})
        if walk.returncode:
            raise SystemExit('the browser walk failed:\n' + walk.stdout[-1500:] + walk.stderr[-1500:])
        films = sorted((root / 'package-data').rglob('*.mp4'))
        checks = {}
        for film in films:
            checks[film.name] = probe(film)
            shutil.copy2(film, out / film.name)
        notes = (out / 'kernel.log').read_text(errors='replace')
        print(json.dumps({'session': session, 'before_seed': first.get('waiting'), 'films': checks,
                          'speech_notes': notes.count('speech_synthesis'), 'browser': json.loads(walk.stdout.strip().splitlines()[-1])}, indent=1))
    finally:
        if kernel and kernel.poll() is None:
            kernel.terminate()
            try:
                kernel.wait(20)
            except subprocess.TimeoutExpired:
                kernel.kill()
        subprocess.run(['docker', 'stop', '-t', '2', name], capture_output=True)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
