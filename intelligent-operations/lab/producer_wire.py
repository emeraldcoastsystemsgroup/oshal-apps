#!/usr/bin/env python3
"""Wire the lab's Alertmanager to Operations through the kernel producer door (kernel ADR-197, ADR0050).
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Under the operator's session: map the Lab Alertmanager source (pod
  alerts keyed by pod_uid in the lab cluster), revoke earlier lab producer tokens, issue one producer token for
  /ingest/alertmanager/<source> with a confirmation, keep it only in a Secret in the monitoring namespace, and add a
  second Alertmanager webhook (the recorder stays) that presents it as a bearer from a mounted file. The token is never
  printed or written outside that Secret. Rerunning lab.py setup restores the baseline Alertmanager without it.
"""
import json
import sys
import lab
from portal import Portal

API = '/api/intelligent-operations'
APP = 'intelligent-operations'
LABEL = 'Lab Alertmanager'
DOOR = 'http://oshal-kernel-service.oshal-install-lab.svc.cluster.local:38788/producers/v1/deliver'


def lab_source(portal):
    for s in portal.call(API + '/records')['sources']:
        if s['source'] == 'urn:operations:source:lab-alertmanager':
            return s
    return portal.call(API + '/sources', {'name': 'Lab Alertmanager', 'source': 'urn:operations:source:lab-alertmanager', 'environment': 'operations-lab'})


def alertmanager_config():
    current = json.loads(lab.kubectl('-n', lab.MON, 'get', 'configmap', 'alertmanager', '-o', 'json'))
    text = current['data']['alertmanager.yaml']
    marker = '      - url: http://event-recorder:8080/webhook\n        send_resolved: true\n'
    if marker not in text:
        raise SystemExit('Unexpected Alertmanager configuration; rerun lab.py setup first.')
    if DOOR not in text:
        text = text.replace(marker, marker + '      - url: ' + DOOR + '\n        send_resolved: true\n        max_alerts: 100\n'
                            '        http_config:\n          authorization:\n            type: Bearer\n            credentials_file: /producer/token\n')
    return text


def run():
    lab.guard()
    scope = lab.guard()['kubeSystemUid']
    with Portal() as p:
        source = lab_source(p)
        mapping = p.call(API + '/ingest/mapping', {'sourceId': source['id'], 'resourceKind': 'kubernetes-pod', 'idLabel': 'pod_uid', 'scope': scope})
        for t in p.call('/api/v1/producer-tokens')['producerTokens']:
            if t['label'] == LABEL and t['app'] == APP:
                p.call('/api/v1/producer-tokens/' + t['tokenId'], method='DELETE')
        issued = p.call('/api/v1/producer-tokens', {'app': APP, 'route': '/ingest/alertmanager/' + source['id'], 'label': LABEL}, confirmed=True)
        token = issued['token']
    secret = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 'operations-producer', 'namespace': lab.MON},
              'type': 'Opaque', 'stringData': {'token': token}}
    lab.kubectl('apply', '-f', '-', text=json.dumps(secret))
    del token, secret
    config = alertmanager_config()
    patch_cm = {'data': {'alertmanager.yaml': config}}
    lab.kubectl('-n', lab.MON, 'patch', 'configmap', 'alertmanager', '--type', 'merge', '-p', json.dumps(patch_cm))
    deployment = json.loads(lab.kubectl('-n', lab.MON, 'get', 'deployment', 'alertmanager', '-o', 'json'))
    spec = deployment['spec']['template']['spec']
    if not any(v['name'] == 'producer' for v in spec.get('volumes', [])):
        patch = [{'op': 'add', 'path': '/spec/template/spec/volumes/-', 'value': {'name': 'producer', 'secret': {'secretName': 'operations-producer', 'defaultMode': 0o400}}},
                 {'op': 'add', 'path': '/spec/template/spec/containers/0/volumeMounts/-', 'value': {'name': 'producer', 'mountPath': '/producer', 'readOnly': True}}]
        lab.kubectl('-n', lab.MON, 'patch', 'deployment', 'alertmanager', '--type', 'json', '-p', json.dumps(patch))
    lab.kubectl('-n', lab.MON, 'rollout', 'restart', 'deployment/alertmanager')
    lab.kubectl('-n', lab.MON, 'rollout', 'status', 'deployment/alertmanager', '--timeout=120s')
    print(json.dumps({'source': source['id'], 'mapping': {k: mapping[k] for k in ('resourceKind', 'idLabel', 'scope')},
                      'producerToken': {k: issued['producerToken'][k] for k in ('tokenId', 'app', 'route')}, 'door': DOOR}, indent=1))


if __name__ == '__main__':
    sys.exit(run())
