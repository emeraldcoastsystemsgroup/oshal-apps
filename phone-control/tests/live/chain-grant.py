#!/usr/bin/env python3
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T5: give the throwaway installation's own administrator the phone-control admin template, through the kernel's revision-bound preview and apply, so the browser half acts as a person who holds the app's role. Only ever pointed at the throwaway kernel chain-proof.sh started. Usage: chain-grant.py <base> <token>
import json, sys, urllib.error, urllib.request, uuid

base, token = sys.argv[1], sys.argv[2]
if not base.startswith('http://127.0.0.1:'):
    sys.exit('chain-grant only talks to the throwaway kernel on loopback')


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method,
                                     headers={'authorization': f'Bearer {token}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as reply:
            return reply.status, json.loads(reply.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors='replace')[:400]


status, me = call('GET', '/api/auth/user')
principal = me.get('id') or me.get('principal', {}).get('id') or me.get('principal_id')
if not principal:
    sys.exit(f'no principal id in /api/auth/user: {me}')
status, catalog = call('GET', '/api/authorization/composites')
assert status == 200, catalog
request = {'target': principal, 'assignment_id': 'phone-chain-admin', 'action': 'assign',
           'selection': {'kind': 'composite', 'app': 'phone-control', 'template': 'admin', 'optional_apps': []},
           'expected_revision': catalog['revision'], 'expected_plan_revision': None, 'expires_at': None,
           'reason': 'throwaway phone-control chain proof', 'idempotency_key': f'phone-chain-{uuid.uuid4().hex[:12]}'}
status, preview = call('POST', '/api/authorization/composites/preview', request)
assert status == 200, preview
plan = preview.get('plan_revision') or (preview.get('plan') or {}).get('plan_revision') or (preview.get('plan') or {}).get('revision')
apply = dict(request, expected_revision=preview.get('revision', catalog['revision']), expected_plan_revision=plan,
             idempotency_key=f'phone-chain-{uuid.uuid4().hex[:12]}')
status, applied = call('POST', '/api/authorization/composites/apply', apply)
assert status in (200, 201), applied
print(json.dumps({'principal': principal, 'revision': applied.get('revision')}))
