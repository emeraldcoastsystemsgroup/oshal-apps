#!/usr/bin/env python3
"""Verify live pressure recovery, isolated collection and the canonical report-review gate.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Check actual service receipts without approving reports or executing remediation.
"""
import json
from pathlib import Path
import tempfile
import collect
import evidence
import lab
from portal import Portal, private_json


def workflow_complete(projection, work):
    ticket = projection['ticket']
    if ticket['status'] != 'awaiting_approval' or ticket['position']['index'] != 3:
        raise ValueError('The report has not reached its human acceptance gate.')
    completed = {(w['phase']['index'], w['phase']['name']) for w in work['work']
                 if w['state'] == 'completed' and isinstance(w.get('answer'), str) and w['answer'].strip()}
    if completed != {(0, 'investigate'), (1, 'review'), (2, 'revise')}:
        raise ValueError('All three real worker results are required.')
    graph = projection['workflow']['nodeGraph']['nodes']
    if any(n.get('capabilities') for n in graph):
        raise ValueError('The investigation workflow must have no infrastructure capabilities.')
    if not any(n.get('approval') == {'approver': 'admin'} for n in graph):
        raise ValueError('Human report acceptance must remain in the workflow.')


def verify(directory):
    packet = json.loads((directory/'packet.json').read_text())
    body = dict(packet); sha = body.pop('sha256')
    if evidence.digest(body) != sha:
        raise ValueError('Evidence packet changed after capture.')
    episode = packet['scope']['job'].removeprefix('cpu-pressure-')
    evidence.required(episode, r'[a-f0-9]{16}')
    if lab.guard()['kubeSystemUid'] != packet['scope']['clusterUid']:
        raise ValueError('Wrong cluster for this evidence.')
    rows = [a for a in collect.alerts(collect.deliveries())
            if a.get('labels', {}).get('episode') == episode
            and a.get('fingerprint') == packet['alert']['fingerprint']
            and a.get('startsAt') == packet['alert']['startsAt']]
    if not {'firing', 'resolved'} <= {a.get('status') for a in rows}:
        raise ValueError('Matching firing and resolved deliveries are required.')
    if lab.kubectl('-n', lab.APP, 'get', 'job', packet['scope']['job'], '--ignore-not-found', '-o', 'name').strip():
        raise ValueError('The pressure Job still exists.')
    nodes = json.loads(lab.kubectl('get', 'nodes', '-o', 'json'))['items']
    if len(nodes) != 3 or not all(any(c['type'] == 'Ready' and c['status'] == 'True'
            for c in n['status']['conditions']) for n in nodes):
        raise ValueError('All owned lab nodes must be ready.')
    with tempfile.TemporaryDirectory(prefix='operations-verify-') as temp:
        _, refusals = collect.scoped_pods(Path(temp))
    ticket = json.loads((directory/'ticket.json').read_text())['ticket']
    with Portal() as p:
        projection = p.call('/tickets/'+ticket+'/workflow')
        work = p.call('/tickets/'+ticket+'/work')
        workflow_complete(projection, work)
        private_json(directory/'verified-workflow.json', projection)
        private_json(directory/'verified-work.json', work)
    result = {'episode': episode, 'ticket': ticket, 'packetSha256': sha,
              'firingAndResolved': True, 'pressureJobAbsent': True, 'allNodesReady': True,
              'collectorRefusals': refusals, 'completedModelPhases': 3,
              'reportState': 'awaiting_approval', 'infrastructureExecutedByAgent': False,
              'automaticPipeline': False}
    private_json(directory/'acceptance.json', result)
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    verify(parser.parse_args().directory)
