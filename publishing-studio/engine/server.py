"""Private bounded pure-render stages over the original framed engine relay.

Namespaces come from the admitted package's captured original principal. This
sidecar is not an authentication service and never authorizes SQL or publication.
Opaque stages are temporary rendering buffers, never public artifact handles.
"""
import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import sys
import tempfile
import time
from worker import LIMITS, Refusal, validate, _child_limits

HERE = Path(__file__).resolve().parent
FRAME_BYTES = 1024 * 1024
CHUNK_BYTES = 65536
STAGE_TTL = 600
GLOBAL_BYTES = 128 * 1024 * 1024
OWNER_STAGES = 2
MAX_STAGES = 8
MAX_CONNECTIONS = 16
ACTIVE_CONNECTIONS = 0
STAGES = {}
ROOT = None
RENDER_SLOT = asyncio.Semaphore(1)
HEX = re.compile(r'^[0-9a-f]{64}$')
TOKEN = re.compile(r'^[0-9a-f]{64}$')


def identity():
    fingerprint = hashlib.sha256()
    files = ['worker.py', 'server.py', 'layout.typ', 'requirements.txt', 'source-lock.json',
             'prepare-runtime.py', 'container/Dockerfile', 'container/compose.yaml', 'install-engine.sh']
    lock = json.loads((HERE / 'source-lock.json').read_text())
    files += ['fonts/' + item['file'] for item in lock['fonts']]
    for name in sorted(files): fingerprint.update(name.encode() + b'\0' + (HERE / name).read_bytes() + b'\0')
    return {'protocol': 1, 'buildHash': fingerprint.hexdigest(), 'upstream': 'Typst/0.15.1+pypdf/6.20.1'}


def closed(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys): raise Refusal('publishing_engine_request_invalid')


def namespace(value):
    if not isinstance(value, str) or not HEX.fullmatch(value): raise Refusal('publishing_engine_request_invalid')


def owner_stage(args):
    namespace(args.get('namespace'))
    token = args.get('token')
    if not isinstance(token, str) or not TOKEN.fullmatch(token): raise Refusal('publishing_stage_missing')
    stage = STAGES.get(token)
    if stage is None or stage['namespace'] != args['namespace'] or stage['closed'] or stage['expires'] <= time.monotonic():
        raise Refusal('publishing_stage_missing')
    return stage


def stored_bytes():
    return sum(stage['reserved'] for stage in STAGES.values())


async def remove(token):
    stage = STAGES.pop(token, None)
    if stage is None: return
    stage['closed'] = True
    task = stage.get('task')
    if task and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    shutil.rmtree(stage['path'])


async def sweep():
    for token, stage in list(STAGES.items()):
        if stage['expires'] <= time.monotonic(): await remove(token)


async def produce(stage, model):
    child = None
    try:
        # Admission is bounded and refuses rather than silently queueing jobs.
        if RENDER_SLOT.locked(): raise Refusal('publishing_engine_busy')
        async with RENDER_SLOT:
            if stage['closed']: return
            model_path = stage['path'] / 'model.json'
            model_path.write_text(json.dumps(model, separators=(',', ':')))
            child = await asyncio.create_subprocess_exec(sys.executable, str(HERE / 'worker.py'),
                '--model', str(model_path), '--assets', str(stage['path'] / 'assets'), '--output', str(stage['path'] / 'output'),
                '--typst', os.environ.get('OSHAL_PUBLISHING_TYPST', ''),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}, preexec_fn=_child_limits, start_new_session=True)
            output, _ = await asyncio.wait_for(child.communicate(), LIMITS['deadlineSeconds'])
            if stage['closed']: return
            if len(output) > 65536 or child.returncode not in (0, 1): raise Refusal('publishing_engine_failed')
            result = json.loads(output)
            if result.get('ok') is not True:
                code = result.get('error')
                if not isinstance(code, str) or not re.fullmatch(r'publishing_[a-z0-9_]+', code): code = 'publishing_engine_failed'
                raise Refusal(code, result.get('details'))
            receipt = result['receipt']
            output_bytes = sum(item['bytes'] for item in receipt['outputs'])
            # Reserve worst-case output space before rendering; shrink only after
            # complete output validation. No concurrent upload can spend it.
            if output_bytes > LIMITS['totalOutputBytes']: raise Refusal('publishing_output_capacity')
            for item in receipt['outputs']:
                path = stage['path'] / 'output' / item['name']
                payload = path.read_bytes()
                if len(payload) != item['bytes'] or hashlib.sha256(payload).hexdigest() != item['sha256']:
                    raise Refusal('publishing_output_changed')
            stage['reserved'] = stage['assetBytes'] + output_bytes
            stage['receipt'], stage['state'] = receipt, 'ready'
    except asyncio.CancelledError:
        raise
    except Exception as error:
        if not stage['closed']:
            stage['state'] = 'failed'
            stage['error'] = error.code if isinstance(error, Refusal) else 'publishing_engine_failed'
            stage['details'] = error.details if isinstance(error, Refusal) else None
            stage['reserved'] = stage['assetBytes']
            if (stage['path'] / 'output').exists(): shutil.rmtree(stage['path'] / 'output')
    finally:
        if child is not None and child.returncode is None:
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            await child.wait()


async def command(args):
    await sweep()
    if not isinstance(args, dict): raise Refusal('publishing_engine_request_invalid')
    op = args.get('op')
    if op == 'open':
        closed(args, ('op', 'namespace', 'assets'))
        namespace(args['namespace'])
        assets = args['assets']
        if not isinstance(assets, list) or len(assets) > LIMITS['assets']: raise Refusal('publishing_asset_capacity')
        descriptors, total = {}, 0
        for item in assets:
            closed(item, ('id', 'sha256', 'bytes', 'mime'))
            if not isinstance(item['id'], str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', item['id']) or item['id'] in descriptors or not isinstance(item['sha256'], str) or not HEX.fullmatch(item['sha256']) or type(item['bytes']) is not int or not 1 <= item['bytes'] <= LIMITS['assetBytes'] or item['mime'] not in ('image/png', 'image/jpeg'):
                raise Refusal('publishing_asset_invalid')
            descriptors[item['id']] = item; total += item['bytes']
        if total > LIMITS['totalAssetBytes']: raise Refusal('publishing_asset_capacity')
        reserve = total + LIMITS['totalOutputBytes']
        if len(STAGES) >= MAX_STAGES or sum(stage['namespace'] == args['namespace'] for stage in STAGES.values()) >= OWNER_STAGES or stored_bytes() + reserve > GLOBAL_BYTES:
            raise Refusal('publishing_stage_quota')
        token = secrets.token_hex(32)
        path = ROOT / token; path.mkdir(mode=0o700); (path / 'assets').mkdir(mode=0o700)
        stage = {'token': token, 'namespace': args['namespace'], 'path': path, 'assets': descriptors, 'offsets': {key: 0 for key in descriptors},
                 'assetBytes': total, 'reserved': reserve, 'expires': time.monotonic() + STAGE_TTL, 'closed': False, 'state': 'uploading', 'task': None}
        STAGES[token] = stage
        return {'token': token, 'state': 'uploading', 'chunkBytes': CHUNK_BYTES, 'expiresInSeconds': STAGE_TTL}
    if op == 'write':
        closed(args, ('op', 'namespace', 'token', 'assetId', 'offset', 'dataBase64', 'sha256'))
        stage = owner_stage(args)
        if stage['state'] != 'uploading': raise Refusal('publishing_stage_state')
        key = args['assetId']
        if not isinstance(key, str) or key not in stage['assets'] or type(args['offset']) is not int or args['offset'] < 0 or args['offset'] % CHUNK_BYTES or not isinstance(args['dataBase64'], str) or len(args['dataBase64']) > ((CHUNK_BYTES + 2) // 3) * 4 or not isinstance(args['sha256'], str) or not HEX.fullmatch(args['sha256']):
            raise Refusal('publishing_chunk_invalid')
        try: payload = base64.b64decode(args['dataBase64'], validate=True)
        except ValueError: raise Refusal('publishing_chunk_invalid') from None
        end = args['offset'] + len(payload)
        descriptor = stage['assets'][key]
        if not payload or len(payload) > CHUNK_BYTES or (len(payload) != CHUNK_BYTES and end != descriptor['bytes']) or end > descriptor['bytes'] or base64.b64encode(payload).decode() != args['dataBase64'] or hashlib.sha256(payload).hexdigest() != args['sha256']:
            raise Refusal('publishing_chunk_invalid')
        path = stage['path'] / 'assets' / key
        if args['offset'] < stage['offsets'][key]:
            if end > stage['offsets'][key]: raise Refusal('publishing_chunk_conflict')
            with path.open('rb') as handle: handle.seek(args['offset']); prior = handle.read(len(payload))
            if prior != payload: raise Refusal('publishing_chunk_conflict')
        else:
            if args['offset'] != stage['offsets'][key]: raise Refusal('publishing_chunk_order')
            with path.open('ab' if path.exists() else 'xb') as handle: handle.write(payload)
            stage['offsets'][key] = end
        complete = stage['offsets'][key] == descriptor['bytes']
        if complete and hashlib.sha256(path.read_bytes()).hexdigest() != descriptor['sha256']:
            raise Refusal('publishing_asset_changed')
        return {'assetId': key, 'offset': args['offset'], 'bytes': len(payload), 'nextOffset': stage['offsets'][key], 'complete': complete}
    if op == 'render':
        closed(args, ('op', 'namespace', 'token', 'model'))
        stage = owner_stage(args)
        if stage['state'] != 'uploading': raise Refusal('publishing_stage_state')
        validate(args['model'])
        if args['model']['assets'] != list(stage['assets'].values()): raise Refusal('publishing_asset_changed')
        if any(stage['offsets'][key] != item['bytes'] for key, item in stage['assets'].items()): raise Refusal('publishing_asset_incomplete')
        if RENDER_SLOT.locked(): raise Refusal('publishing_engine_busy')
        stage['state'] = 'rendering'; stage['task'] = asyncio.create_task(produce(stage, args['model']))
        return {'state': 'rendering'}
    if op == 'status':
        closed(args, ('op', 'namespace', 'token')); stage = owner_stage(args)
        result = {'state': stage['state']}
        if stage['state'] == 'ready': result['receipt'] = stage['receipt']
        if stage['state'] == 'failed': result.update({'error': stage['error'], 'details': stage['details']})
        return result
    if op == 'read':
        closed(args, ('op', 'namespace', 'token', 'name', 'offset')); stage = owner_stage(args)
        if stage['state'] != 'ready': raise Refusal('publishing_stage_state')
        if type(args['offset']) is not int or args['offset'] < 0 or args['offset'] % CHUNK_BYTES: raise Refusal('publishing_chunk_invalid')
        matches = [item for item in stage['receipt']['outputs'] if item['name'] == args['name']]
        if len(matches) != 1: raise Refusal('publishing_output_missing')
        item = matches[0]
        if args['offset'] >= item['bytes']: raise Refusal('publishing_chunk_invalid')
        path = stage['path'] / 'output' / item['name']
        if path.stat().st_size != item['bytes']: raise Refusal('publishing_output_changed')
        with path.open('rb') as handle: handle.seek(args['offset']); payload = handle.read(CHUNK_BYTES)
        end = args['offset'] + len(payload)
        return {'name': item['name'], 'offset': args['offset'], 'bytes': len(payload), 'totalBytes': item['bytes'], 'sha256': hashlib.sha256(payload).hexdigest(),
                'outputSha256': item['sha256'], 'dataBase64': base64.b64encode(payload).decode(), 'complete': end == item['bytes'], 'nextOffset': None if end == item['bytes'] else end}
    if op == 'close':
        closed(args, ('op', 'namespace', 'token')); owner_stage(args); await remove(args['token']); return {'closed': True}
    raise Refusal('publishing_engine_request_invalid')


async def serve(reader, writer):
    global ACTIVE_CONNECTIONS
    # Refuse at admission, never queue readers with unbounded frame buffers.
    if ACTIVE_CONNECTIONS >= MAX_CONNECTIONS:
        writer.close()
        return
    ACTIVE_CONNECTIONS += 1
    build = identity()
    async def send(value):
        payload = json.dumps(value, separators=(',', ':')).encode() + b'\n'
        if len(payload) > FRAME_BYTES: raise Refusal('publishing_engine_response_limit')
        writer.write(payload); await asyncio.wait_for(writer.drain(), 10)
    try:
        await send({'bridge': build})
        raw = await asyncio.wait_for(reader.readline(), 10)
        if not raw.endswith(b'\n') or len(raw) > FRAME_BYTES: raise Refusal('publishing_engine_request_invalid')
        value = json.loads(raw); closed(value, ('id', 'cmd', 'args'))
        if type(value['id']) is not int or value['id'] != 1 or value['cmd'] != 'publishing': raise Refusal('publishing_engine_request_invalid')
        result = await command(value['args'])
        await send({'id': 1, 'buildHash': build['buildHash'], 'ok': True, 'result': result})
    except (Exception, asyncio.CancelledError) as error:
        try: await send({'id': 1, 'buildHash': build['buildHash'], 'ok': False, 'error': error.code if isinstance(error, Refusal) else 'publishing_engine_failed', 'details': error.details if isinstance(error, Refusal) else None})
        except Exception: pass
    finally:
        ACTIVE_CONNECTIONS -= 1
        writer.close()
        try: await asyncio.wait_for(writer.wait_closed(), 1)
        except Exception: pass


async def main():
    global ROOT
    with tempfile.TemporaryDirectory(prefix='publishing-engine-') as directory:
        ROOT = Path(directory); ROOT.chmod(0o700)
        server = await asyncio.start_server(serve, os.environ.get('PUBLISHING_ENGINE_HOST', '127.0.0.1'), int(os.environ.get('PUBLISHING_ENGINE_PORT', '7419')), limit=FRAME_BYTES + 1)
        async def reclaim():
            while True: await asyncio.sleep(5); await sweep()
        maintenance = asyncio.create_task(reclaim())
        current = asyncio.current_task()
        for sig in (signal.SIGTERM, signal.SIGINT): asyncio.get_running_loop().add_signal_handler(sig, current.cancel)
        print(json.dumps({'port': server.sockets[0].getsockname()[1], 'identity': identity()}), flush=True)
        try:
            async with server: await server.serve_forever()
        finally:
            maintenance.cancel(); await asyncio.gather(maintenance, return_exceptions=True)
            for token in list(STAGES): await remove(token)

if __name__ == '__main__':
    if '--identity' in sys.argv: print(json.dumps(identity()))
    else: asyncio.run(main())
