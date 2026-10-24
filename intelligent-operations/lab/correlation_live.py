#!/usr/bin/env python3
"""Temporal correlation on a live discovery feed, with a replaced pod, on the owned lab.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | R14 installed acceptance: record the graph before, replace one
  operations-demo api pod (its ReplicaSet recreates it), wait for scheduled discovery (ADR0049) to save the next live
  scan, then show that the graph now has the new pod and not the old one while the graph as of before still has the
  old one; correlate firing alerts for two pods sharing a node now (two groups: a shared node that is not itself affected does
  not merge incidents; status complete, so every live edge is fresh), the new pod with a pod on another node (two groups), and the old pod now (unresolved: no stale edge) and as of before (resolved). Only lab
  demo pods are touched; nothing else is run.
"""
import calendar
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from portal import Portal

API = '/api/intelligent-operations'
NS = 'operations-demo'
LAB = Path.home() / '.local/state/oshal-operations-lab'
ENV = {**os.environ, 'PATH': str(LAB / 'bin') + ':' + os.environ['PATH'], 'KUBECONFIG': str(LAB / 'kubeconfig')}
POLICY = {'id': 'live-runs-on-v1', 'types': ['RUNS_ON'], 'maxDepth': 4, 'maxVisited': 400, 'maxAgeSeconds': 900}


def kubectl(*args):
    return subprocess.run(['kubectl', '-n', NS, *args], env=ENV, check=True, capture_output=True, text=True).stdout


def pods():
    items = json.loads(kubectl('get', 'pods', '-o', 'json'))['items']
    return [{'name': p['metadata']['name'], 'uid': p['metadata']['uid'], 'node': p['spec'].get('nodeName'),
             'ready': any(c['type'] == 'Ready' and c['status'] == 'True' for c in p['status'].get('conditions', [])),
             'deleting': 'deletionTimestamp' in p['metadata']} for p in items]


def iso(t):
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + '.%03dZ' % int((t % 1) * 1000)


def placement(graph, uid):
    pod = next((a for a in graph['assets'] if a['kind'] == 'pod' and a['nativeId'] == uid), None)
    if not pod:
        return None
    edge = next((e for e in graph['relationships'] if e['type'] == 'RUNS_ON' and e['from'] == pod['id']), None)
    node = next((a for a in graph['assets'] if edge and a['id'] == edge['to']), None)
    return {'pod': pod['name'], 'health': pod['health'], 'node': node and node['name'], 'observedAt': pod.get('observedAt')}


def run(scope):
    receipt = {'kind': 'live-temporal-correlation', 'scope': scope, 'namespace': NS, 'policy': POLICY}
    with Portal() as p:
        discovery = p.call(API + '/topology/discovery')
        if not discovery.get('enabled') or discovery.get('namespace') != NS:
            raise SystemExit('Turn on scheduled discovery for ' + NS + ' first (lab/discovery_live.cjs).')
        before = pods()
        old = next(x for x in before if x['name'].startswith('api-') and x['ready'] and not x['deleting'])
        neighbour = next((x for x in before if x['node'] == old['node'] and x['uid'] != old['uid'] and not x['deleting']), None)
        t_before = time.time()
        receipt['before'] = {'at': iso(t_before), 'oldPod': old, 'graph': placement(p.call(API + '/topology'), old['uid'])}
        kubectl('delete', 'pod', old['name'], '--wait=true', '--timeout=120s')
        replaced_at = time.time()
        new = None
        for _ in range(60):
            new = next((x for x in pods() if x['name'].startswith('api-') and x['ready'] and not x['deleting']
                        and x['uid'] not in {b['uid'] for b in before}), None)
            if new:
                break
            time.sleep(5)
        if not new:
            raise SystemExit('The ReplicaSet did not recreate a ready api pod.')
        receipt['replacement'] = {'deletedAt': iso(replaced_at), 'newPod': new}
        saved = None
        for _ in range(48):
            time.sleep(15)
            last = (p.call(API + '/topology/discovery').get('lastResult') or {})
            if last.get('state') == 'saved' and calendar.timegm(time.strptime(last['attemptAt'][:19], '%Y-%m-%dT%H:%M:%S')) > replaced_at + 5:
                saved = last
                break
        receipt['discovery'] = saved
        if not saved:
            raise SystemExit('Scheduled discovery did not save a scan after the replacement.')
        t_now = time.time()
        now_graph, then_graph = p.call(API + '/topology'), p.call(API + '/topology?at=' + iso(t_before))
        receipt['graphNow'] = {'newPod': placement(now_graph, new['uid']), 'oldPod': placement(now_graph, old['uid'])}
        receipt['graphBefore'] = {'newPod': placement(then_graph, new['uid']), 'oldPod': placement(then_graph, old['uid'])}

        stamp = str(int(t_now))
        source = p.call(API + '/sources', {'name': 'Live correlation acceptance ' + stamp, 'environment': 'operations-lab',
                                           'source': 'urn:triagenorth:live-correlation:' + stamp})
        current = [x for x in pods() if not x['deleting']]
        by_node = {}
        for x in current:
            by_node.setdefault(x['node'], []).append(x)
        shared = next((v[:2] for v in by_node.values() if len(v) >= 2), None)
        elsewhere = next((x for x in current if x['node'] != new['node']), None)

        def alert(name, uid):
            event = {'specversion': '1.0', 'id': 'live-corr-' + stamp + '-' + name, 'source': source['source'], 'type': 'operations.alert',
                     'time': iso(time.time()), 'datacontenttype': 'application/json', 'dataschema': 'urn:oshal:operations:alert:1',
                     'data': {'environment': 'operations-lab', 'alertType': 'PodUnavailable', 'severity': 'warning', 'status': 'firing',
                              'resource': {'kind': 'kubernetes-pod', 'scope': scope, 'id': uid}}}
            r = p.call(API + '/events', {'sourceId': source['id'], 'event': event})
            return r['id']

        receipt['alerts'] = {'newPod': alert('new', new['uid']), 'oldPod': alert('old', old['uid']),
                             'sharedA': alert('shared-a', shared[0]['uid']), 'sharedB': alert('shared-b', shared[1]['uid']),
                             'elsewhere': alert('elsewhere', elsewhere['uid'])}
        together = p.call(API + '/topology/correlate', {'deliveryIds': [receipt['alerts']['sharedA'], receipt['alerts']['sharedB']], 'asOf': iso(t_now), 'policy': POLICY})
        apart = p.call(API + '/topology/correlate', {'deliveryIds': [receipt['alerts']['newPod'], receipt['alerts']['elsewhere']], 'asOf': iso(t_now), 'policy': POLICY})
        old_now = p.call(API + '/topology/correlate', {'deliveryIds': [receipt['alerts']['oldPod']], 'asOf': iso(t_now), 'policy': POLICY})
        old_then = p.call(API + '/topology/correlate', {'deliveryIds': [receipt['alerts']['oldPod']], 'asOf': iso(t_before), 'policy': POLICY})
        brief = lambda r: {'status': r.get('status'), 'method': r.get('method'), 'problems': r.get('problems'), 'groups': r.get('groups'), 'events': r.get('events'), 'asOf': r.get('asOf')}
        receipt['correlation'] = {'sameNodePairNow': brief(together), 'sharedPods': shared, 'newPodAndOtherNodeNow': brief(apart),
                                  'otherNodePod': elsewhere, 'oldPodNow': brief(old_now), 'oldPodBefore': brief(old_then)}
        resolved = lambda r: [e for e in r.get('events', []) if not e['assetId'].startswith('unresolved-')]
        receipt['checks'] = {
            'newPodPlacedNow': bool(receipt['graphNow']['newPod'] and receipt['graphNow']['newPod']['node'] == new['node']),
            'oldPodRetiredNow': receipt['graphNow']['oldPod'] is None,
            'oldPodPresentBefore': bool(receipt['graphBefore']['oldPod']),
            'newPodAbsentBefore': receipt['graphBefore']['newPod'] is None,
            # A shared node that is not itself affected does not merge incidents (affected-dependency paths only).
            'sameNodePodsStaySeparate': len(resolved(together)) == 2 and len(together.get('groups') or []) == 2,
            'newPodAndOtherNodeTwoGroups': len(resolved(apart)) == 2 and len(apart.get('groups') or []) == 2,
            'liveEdgesFreshNow': together.get('status') == 'complete' and apart.get('status') == 'complete',
            'oldPodUnresolvedNow': not resolved(old_now),
            'oldPodResolvedBefore': len(resolved(old_then)) == 1,
        }
    receipt['result'] = 'passed' if all(receipt['checks'].values()) else 'failed'
    out = Path(__file__).resolve().parent.parent / 'deploy/evidence/temporal-correlation-live.json'
    out.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'result': receipt['result'], 'checks': receipt['checks'], 'before': receipt['before']['graph'],
                      'now': receipt['graphNow']}, indent=1))


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else '0149aee8-c05f-4056-b6ed-c61ba36e5d9e')
