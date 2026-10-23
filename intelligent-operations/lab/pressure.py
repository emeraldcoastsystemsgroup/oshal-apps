#!/usr/bin/env python3
"""Configure measured, bounded CPU pressure in the owned Operations lab.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Add CPU alert, credential-free workload and separate read-only collector authorization.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Mount a writable in-container stop control and record the pressure pod's container name so a namespace-scoped exec executor can stop the pressure and a verification command can measure the flat counter.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Bound the drill to a configurable duration (default 900 s, Job deadline duration + 240 s) so the canonical workflow and a reviewed response can complete while the pressure pod still exists.
"""
import json
import re
from pathlib import Path
import lab


DURATION = 900


def objects(episode, duration=DURATION):
    if not re.fullmatch(r'[a-f0-9]{16}', episode):
        raise ValueError('Episode must be sixteen hexadecimal characters.')
    if type(duration) is not int or not 60 <= duration <= 1800:
        raise ValueError('Bounded pressure duration only.')
    image = json.loads((lab.ROOT/'versions.json').read_text())['images']['workload']
    name = 'cpu-pressure-'+episode
    container = {'name': 'pressure', 'image': image, 'command': ['python', '/code/pressure.py'],
                 'ports': [{'containerPort': 8080}], 'env': [
                     {'name': 'node', 'valueFrom': {'fieldRef': {'fieldPath': 'spec.nodeName'}}},
                     {'name': 'pod_uid', 'valueFrom': {'fieldRef': {'fieldPath': 'metadata.uid'}}},
                     {'name': 'episode', 'value': episode},
                     {'name': 'DURATION', 'value': str(duration)}],
                 'resources': {'requests': {'cpu': '100m', 'memory': '32Mi'}, 'limits': {'cpu': '1', 'memory': '64Mi'}},
                 'securityContext': {'runAsNonRoot': True, 'runAsUser': 65534, 'readOnlyRootFilesystem': True,
                                     'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']},
                                     'seccompProfile': {'type': 'RuntimeDefault'}},
                 'volumeMounts': [{'name': 'code', 'mountPath': '/code', 'readOnly': True},
                                  {'name': 'control', 'mountPath': '/run/pressure'}]}
    job = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': lab.metadata(name, lab.APP),
           'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': duration + 240, 'ttlSecondsAfterFinished': 600,
                    'template': {'metadata': {'labels': {**lab.LABEL, 'app': 'cpu-pressure', 'episode': episode}},
                                 'spec': {'restartPolicy': 'Never', 'nodeSelector': {'kubernetes.io/hostname': lab.CLUSTER+'-worker2'},
                                          'automountServiceAccountToken': False, 'containers': [container],
                                          'volumes': [{'name': 'code', 'configMap': {'name': 'pressure-code'}},
                                                      {'name': 'control', 'emptyDir': {'sizeLimit': '1Mi'}}]}}}}
    return [lab.configmap('pressure-code', lab.APP, {'pressure.py': (lab.ROOT/'pressure_workload.py').read_text()}), job]


def monitoring():
    base = next(o for o in lab.manifests()['items'] if o['kind']=='ConfigMap' and o['metadata']['name']=='prometheus')
    base['data']['prometheus.yaml'] += '''  - job_name: bounded-node-pressure
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: [operations-demo]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: cpu-pressure
        action: keep
      - source_labels: [__meta_kubernetes_pod_phase]
        regex: Running
        action: keep
'''
    base['data']['rules.yaml'] += '''      - alert: LabNodeCpuPressure
        expr: rate(operations_pressure_cpu_seconds_total[20s]) > 0.45
        for: 10s
        labels: {severity: warning, environment: operations-lab}
        annotations: {summary: "Bounded workload consumes over 0.45 CPU cores on a lab worker"}
'''
    return base


def collector_roles():
    name = 'operations-evidence-collector'
    return [
        {'apiVersion': 'v1', 'kind': 'ServiceAccount', 'metadata': lab.metadata(name, lab.APP)},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role', 'metadata': lab.metadata(name, lab.APP),
         'rules': [{'apiGroups': [''], 'resources': ['pods'], 'verbs': ['get', 'list']}]},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding', 'metadata': lab.metadata(name, lab.APP),
         'roleRef': {'apiGroup': 'rbac.authorization.k8s.io', 'kind': 'Role', 'name': name},
         'subjects': [{'kind': 'ServiceAccount', 'name': name, 'namespace': lab.APP}]}]


def prepare():
    lab.guard()
    lab.kubectl('apply', '-f', '-', text=json.dumps({'apiVersion':'v1','kind':'List','items':[monitoring(), *collector_roles()]}))
    lab.kubectl('-n', lab.MON, 'rollout', 'restart', 'deployment/prometheus')
    lab.kubectl('-n', lab.MON, 'rollout', 'status', 'deployment/prometheus', '--timeout=90s')


def start(episode):
    lab.guard()
    lab.kubectl('create', '-f', '-', text=json.dumps({'apiVersion':'v1','kind':'List','items':[objects(episode)[1]]}))


def stop(episode):
    objects(episode)  # Validate before selecting the exact owned Job.
    lab.guard()
    lab.kubectl('-n', lab.APP, 'delete', 'job', 'cpu-pressure-'+episode, '--ignore-not-found=true', '--wait=true')


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare','start','stop'])
    parser.add_argument('--episode')
    args=parser.parse_args()
    if args.command=='prepare':
        prepare()
        lab.kubectl('apply','-f','-',text=json.dumps(objects('0'*16)[0]))
    elif args.command=='start': start(args.episode)
    else: stop(args.episode)
