#!/usr/bin/env python3
"""Closed CPU incident evidence schema and non-executing work proposals.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Project measured facts into credential-free, hashed agent input and fixed-target script proposals.
"""
import hashlib
import json
import re
from datetime import datetime, timezone


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def required(value, pattern):
    if not isinstance(value,str) or not re.fullmatch(pattern,value):
        raise ValueError('Evidence identity is missing or invalid.')
    return value


def packet(alert, pods, cluster_uid, episode):
    required(episode,r'[a-f0-9]{16}')
    labels=alert['labels']
    if labels.get('alertname')!='LabNodeCpuPressure' or labels.get('episode')!=episode or labels.get('environment')!='operations-lab':
        raise ValueError('Alert is outside this pressure episode.')
    node=required(labels.get('node'),r'operations-lab-worker2')
    uid=required(labels.get('pod_uid'),r'[a-f0-9-]{36}')
    matches=[p for p in pods['items'] if p['metadata']['uid']==uid and p['metadata']['namespace']=='operations-demo']
    if len(matches)!=1: raise ValueError('Exact alerted pod instance must be present.')
    pod=matches[0]
    if pod['spec']['nodeName']!=node or pod['metadata'].get('labels',{}).get('episode')!=episode:
        raise ValueError('Captured pod placement does not match alert identity.')
    owners=pod['metadata'].get('ownerReferences',[])
    if not any(o.get('kind')=='Job' and o.get('name')=='cpu-pressure-'+episode for o in owners):
        raise ValueError('Pressure Job ownership is required.')
    body={'schema':'oshal.operations.evidence.v1','observedAt':datetime.now(timezone.utc).isoformat(),
          'scope':{'environment':'operations-lab','clusterUid':required(cluster_uid,r'[a-f0-9-]{36}'),'namespace':'operations-demo',
                   'node':node,'podUid':uid,'pod':required(pod['metadata']['name'],r'cpu-pressure-[a-f0-9]{16}-[a-z0-9]+'),'job':'cpu-pressure-'+episode},
          'alert':{'type':'LabNodeCpuPressure','startsAt':alert['startsAt'],'status':'firing','fingerprint':alert['fingerprint']},
          'measurement':{'expression':'rate(operations_pressure_cpu_seconds_total[20s]) > 0.45','sustainedSeconds':10,
                         'meaning':'Measured process CPU consumption; not a Kubernetes MemoryPressure or DiskPressure condition.'},
          'pod':{'phase':pod['status'].get('phase'),'ready':any(c.get('type')=='Ready' and c.get('status')=='True' for c in pod['status'].get('conditions',[])),
                 'containers':[{'name':c['name'],'cpuLimit':c.get('resources',{}).get('limits',{}).get('cpu')} for c in pod['spec']['containers']]},
          'collection':{'mode':'namespace-read-only-collector','rawHash':digest({'alert':alert,'pod':pod}),
                        'excluded':['environment values','Secrets','ConfigMaps','service-account tokens','kubeconfig','arbitrary logs','unrelated pods']},
          'scenario':{'intentionalLabPressure':True,'cpuLimitCores':1,'workloadDeadlineSeconds':150,'jobDeadlineSeconds':180},
          'authority':{'clusterAccess':False,'tools':[],'scripts':'proposal-only','automaticRemediation':False}}
    return {**body,'sha256':digest(body)}


def scripts(value):
    scope=value['scope']; episode=required(scope['job'],r'cpu-pressure-[a-f0-9]{16}')
    uid=required(scope['clusterUid'],r'[a-f0-9-]{36}')
    header='''#!/usr/bin/env bash
# Operator-reviewed proposal. Never run by the evidence-only investigation agent.
set -euo pipefail
: "${OSHAL_LAB_KUBECONFIG:?Supply the owned lab kubeconfig explicitly}"
k=(kubectl --kubeconfig "$OSHAL_LAB_KUBECONFIG" --context kind-operations-lab)
server=$("${k[@]}" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
[[ "$server" == https://127.0.0.1:* ]] || exit 2
'''+f'''[[ "$("${{k[@]}}" get namespace kube-system -o jsonpath='{{.metadata.uid}}')" == '{uid}' ]] || exit 2
'''
    check=header+f'''"${{k[@]}}" -n operations-demo get job '{episode}' -o json
"${{k[@]}}" -n operations-demo get pods -l 'job-name={episode}' -o wide
'''
    recover=header+f'''[[ "${{OSHAL_APPROVE_JOB:-}}" == '{episode}' ]] || {{ echo 'Set OSHAL_APPROVE_JOB to this exact reviewed Job.'; exit 2; }}
"${{k[@]}}" -n operations-demo delete job '{episode}' --wait=true
# Verify the alert resolves in Alertmanager. Deletion alone does not prove recovery.
'''
    return {'inspect.sh':check,'stop-pressure.sh':recover,
            'rollback.md':'The proposed action only removes the disposable pressure Job. Restore a new bounded drill with pressure.py start --episode <new-episode>; do not recreate pressure as an automatic rollback.',
            'verify.md':'Require a resolved Alertmanager delivery for the same fingerprint and original start time, absence of the exact pressure Job, and ready lab nodes. Do not close on command exit alone.'}
