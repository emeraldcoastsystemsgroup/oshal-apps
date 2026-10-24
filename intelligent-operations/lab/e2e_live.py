#!/usr/bin/env python3
"""One CPU-only run through every stage of Event-to-Action on the owned lab, with no hidden operator calls (R27).
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Send only ticket/work identity to response planning and require the kernel-verified accepted answer digest.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Setup also saves the operator's runbook for LabNodeCpuPressure (Your runbooks); the
  container comes from the live inventory.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Setup is explicit and recorded: publish the Lab Alertmanager rule
  (LabNodeCpuPressure, capture) and turn on processing, capture and automatic investigation for that source. Then one
  bounded CPU-pressure Job starts and the driver only watches while Prometheus fires, Alertmanager delivers through the
  kernel producer door, the scheduled tick admits, reduces, captures and starts the investigation, and the canonical
  workflow reaches its report gate. The person's decisions are explicit steps with fresh confirmations: approve the
  response plan's exact files and pod, run it once, and approve the report after recovery is measured; the resolved alert
  also arrives through the producer door. Every step and its timing go to deploy/evidence/e2e-live.json. Nothing outside
  the lab's demo namespace is touched.
"""
import hashlib
import json
import secrets
import time
from pathlib import Path
import lab
import pressure
from portal import Portal

API = '/api/intelligent-operations'
SOURCE_URI = 'urn:operations:source:lab-alertmanager'
POLICY = {'name': 'Lab CPU pressure', 'rules': [{'name': 'Lab CPU pressure', 'enabled': True, 'capture': True,
          'query': {'term': {'alertType': 'LabNodeCpuPressure'}}}], 'window': {'mode': 'sliding', 'seconds': 900}}
RUNBOOK = """# LabNodeCpuPressure: a lab drill workload above 0.45 CPU cores

Applies to pods of Jobs named cpu-pressure-<episode> in namespace operations-demo, container `pressure`
(image python:3.13-slim: `sh` and `python` are available; there is no curl). The workload is an intentional,
bounded drill, so ending it is safe.

Confirm: the alert's pod is a cpu-pressure-<episode> pod in operations-demo in the recorded inventory, and the
alert is firing.

Remediate (in the container, approval required): create the stop file `/run/pressure/stop`. `/run/pressure` is a
writable mount; the root filesystem is read-only. The CPU loop stops within a second. Script: `: > /run/pressure/stop`

Verify (read-only, in the container): read http://127.0.0.1:8080/metrics twice about 5 seconds apart and pass
only if operations_pressure_cpu_seconds_total did not increase by more than 0.05. The metric line carries labels,
for example operations_pressure_cpu_seconds_total{node="...",pod_uid="...",episode="..."} 12.3. Script:
python -c 'import urllib.request,time,re
def f(): return float(re.search(r"operations_pressure_cpu_seconds_total(?:\\{[^}]*\\})? ([0-9.eE+-]+)", urllib.request.urlopen("http://127.0.0.1:8080/metrics", timeout=3).read().decode()).group(1))
a=f(); time.sleep(5); b=f(); raise SystemExit(0 if b-a < 0.05 else 1)'

Rollback: none needed. To exercise the drill again, start a new episode; do not remove the stop file.

Recovery: require verify.sh to pass and a resolved alert for the same pod after the action.
"""
OUT = Path(__file__).resolve().parent.parent / 'deploy/evidence/e2e-live.json'


class Run:
    def __init__(self):
        self.receipt = {'kind': 'event-to-action-end-to-end', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'steps': []}
        self.t0 = time.time()

    def step(self, name, actor, **values):
        self.receipt['steps'].append({'step': name, 'actor': actor, 'seconds': round(time.time() - self.t0, 1), **values})
        OUT.write_text(json.dumps(self.receipt, indent=2) + '\n')
        print('%6.1fs %-34s %s' % (time.time() - self.t0, name, json.dumps(values)[:160]), flush=True)


def wait(what, probe, timeout, every=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(every)
    raise SystemExit('Timed out waiting for ' + what)


def action(p, operation, body):
    return p.call('/connectors/kubernetes/actions/' + operation + '?account=primary', body, confirmed=True)


def run(duration=900):
    r = Run()
    lab.guard()
    episode = secrets.token_hex(8)
    with Portal() as p:
        source = next(s for s in p.call(API + '/records')['sources'] if s['source'] == SOURCE_URI)
        mapping = p.call(API + '/ingest/mapping/' + source['id'])
        if not mapping.get('idLabel'):
            raise SystemExit('Run lab/producer_wire.py first.')
        tokens = [t for t in p.call('/api/v1/producer-tokens')['producerTokens'] if t['route'].endswith(source['id'])]
        r.step('setup:producer-wired', 'operator (earlier, lab/producer_wire.py)', producerTokenRef=tokens[0]['tokenId'][:12] if tokens else None, mapping={k: mapping[k] for k in ('resourceKind', 'idLabel')})
        published = None
        for revision in range(0, 50):
            try:
                published = p.call(API + '/pipeline/policies', {'sourceId': source['id'], 'policy': POLICY, 'expectedRevision': revision})
                break
            except RuntimeError as error:
                if '409' not in str(error):
                    raise
        r.step('setup:rule-published', 'operator', policy=(published or {}).get('policy', {}).get('id'))
        books = {b['alertType']: b for b in p.call(API + '/runbooks')['items']}
        held = books.get('LabNodeCpuPressure')
        if not held or held['markdown'] != RUNBOOK:
            held = p.call(API + '/runbooks', {'alertType': 'LabNodeCpuPressure', 'markdown': RUNBOOK, 'expectedRevision': held['revision'] if held else 0})
        r.step('setup:runbook', 'operator (Your runbooks)', alertType='LabNodeCpuPressure', revision=held['revision'], sha256=held['sha256'][:12])
        current = p.call(API + '/pipeline/processing')['config']
        saved = p.call(API + '/pipeline/processing-config', {'enabled': True, 'captureEvidence': True, 'autoInvestigate': True, 'correlate': False,
                                                             'sourceIds': [source['id']], 'batchSize': 10, 'maxAttempts': 8, 'retrySeconds': 30,
                                                             'expectedRevision': current['revision']})
        r.step('setup:processing-on', 'operator', revision=saved['revision'])
        before = {e['id'] for e in p.call(API + '/records')['events']}
        investigations_before = {i['id'] for i in p.call(API + '/investigations')['items']}

    pressure.start(episode)
    r.step('fault:cpu-pressure-job', 'lab', episode=episode, durationSeconds=duration)
    try:
        def firing():
            with Portal() as p:
                rows = [e for e in p.call(API + '/records')['events'] if e['id'] not in before and e.get('sourceId') == source['id']
                        and (e.get('normalized') or {}).get('data', {}).get('alertType') == 'LabNodeCpuPressure'
                        and (e.get('normalized') or {}).get('data', {}).get('status') == 'firing']
                return rows[0] if rows else None
        event = wait('the firing alert through the producer door', firing, 600)
        data = event['normalized']['data']
        r.step('alert:admitted-via-producer-door', 'Prometheus → Alertmanager → kernel producer door', eventId=event['id'], decision=event['decision'], podUid=data['resource']['id'])

        def started():
            with Portal() as p:
                rows = [i for i in p.call(API + '/investigations')['items'] if i['id'] not in investigations_before and i.get('deliveryId') == event['id']]
                return rows[0] if rows and rows[0].get('state') in ('started', 'start-refused', 'start-uncertain') else None
        inv = wait('the scheduled tick to reduce, capture and start the investigation', started, 600)
        r.step('investigation:started-by-tick', 'processing schedule', state=inv['state'], trigger=inv.get('trigger'), ticketId=inv.get('ticketId'), packetSha256=inv.get('packetSha256'))
        if inv['state'] != 'started':
            raise SystemExit('The investigation did not start: ' + str(inv.get('error')))
        ticket = inv['ticketId']

        def at_gate():
            with Portal() as p:
                t = (p.call('/tickets/' + ticket).get('ticket') or {})
                if t.get('status') in ('failed', 'cancelled'):
                    raise SystemExit('The canonical workflow ' + t['status'] + ' at ' + json.dumps(t.get('position')))
                return t if t.get('status') == 'awaiting_approval' else None
        gate = wait('the canonical workflow to reach its report gate', at_gate, 1200, every=15)
        r.step('workflow:report-gate', 'canonical workflow (investigate, review, revise)', position=gate.get('position'), revision=gate.get('revision'))

        with Portal() as p:
            graph = p.call(API + '/topology')
            pod = next((a for a in graph['assets'] if a['kind'] == 'pod' and a['nativeId'] == data['resource']['id']), None)
            if not pod:
                raise SystemExit('The alerting pod is not in the live inventory; is scheduled discovery on?')
            containers = [c for c in (pod['properties'].get('containers') or '').split(',') if c]
            target = {'namespace': pod['properties'].get('namespace'), 'pod': pod['name'], 'uid': pod['nativeId'], 'container': containers[0] if containers else None}
            if not target['container']:
                raise SystemExit('The live inventory does not name the pod\'s container.')
            r.step('target:from-live-inventory', 'Systems (scheduled discovery)', target=target)
            work = p.call('/tickets/' + ticket + '/work')
            rows = sorted([w for w in work.get('work', []) if w.get('state') == 'completed' and isinstance(w.get('answer'), str) and w['answer'].strip()],
                          key=lambda w: -(w.get('phase') or {}).get('index', -1))
            plan, refusals = None, []
            for chosen in rows:
                try:
                    candidate = p.call(API + '/executions/plans', {'ticketId': ticket, 'workId': chosen['id'], 'target': target})
                    if candidate.get('answerVerifiedByServer') is not True or candidate.get('answerSha256') != hashlib.sha256(chosen['answer'].encode()).hexdigest():
                        raise RuntimeError('The plan does not match the kernel-verified accepted answer.')
                    plan = candidate
                    break
                except RuntimeError as error:
                    refusals.append(str(error))
            if not plan:
                raise SystemExit('No completed phase yields an executable response file set: ' + json.dumps(refusals))
            r.step('plan:from-generated-files', 'operator reviews', planId=plan['id'], artifacts=[a['name'] for a in plan['artifacts']])
            approval = p.call(API + '/executions/approve', {'planId': plan['id']})
            r.step('decision:approve-plan', 'operator (person)', approvalId=approval['id'])
            execution = p.call(API + '/executions/reserve', {'approvalId': approval['id'], 'account': 'primary'})
            current = action(p, 'kubernetes-inspect-pod', execution['readback']['input'])
            if current.get('pod', {}).get('uid') != target['uid']:
                raise SystemExit('Pre-dispatch identity check failed.')
            result = action(p, 'kubernetes-exec', execution['dispatch']['input'])
            reported = p.call(API + '/executions/report', {'executionId': execution['id'], 'result': result})
            r.step('action:remediate.sh-once', 'operator (fresh confirmation, own Kubernetes connection)', state=reported['state'], exitCode=result.get('exitCode'))

        def resolved():
            with Portal() as p:
                rows = [e for e in p.call(API + '/records')['events'] if e.get('sourceId') == source['id']
                        and (e.get('normalized') or {}).get('data', {}).get('status') == 'resolved'
                        and (e.get('normalized') or {}).get('data', {}).get('resource', {}).get('id') == data['resource']['id']]
                return rows[0] if rows else None
        resolved_event = wait('the resolved alert through the producer door', resolved, 300)
        r.step('alert:resolved-via-producer-door', 'Prometheus → Alertmanager → kernel producer door', eventId=resolved_event['id'])

        with Portal() as p:
            outcome = None
            for attempt in range(3):
                verification = p.call(API + '/executions/verify', {'executionId': execution['id']})
                check = action(p, 'kubernetes-exec', verification['dispatch']['input'])
                readback = action(p, 'kubernetes-inspect-pod', verification['readback']['input'])
                verified = p.call(API + '/executions/verify/report', {'executionId': execution['id'], 'verificationId': verification['id'], 'result': check, 'readback': readback})
                outcome = verified['recovery']
                if outcome['outcome'] == 'healthy':
                    break
                time.sleep(10)
            r.step('recovery:verified', 'verify.sh + resolved signal + same pod', outcome=outcome['outcome'], reason=outcome.get('reason'))
            if outcome['outcome'] == 'healthy':
                approved = p.call('/tickets/' + ticket + '/approve', {}, confirmed=True)
                updated = p.call(API + '/executions/ticket-update', {'executionId': execution['id']})
                r.step('decision:approve-report-and-close', 'operator (person)', ticketStatus=updated['ticketUpdate']['status'], revision=updated['ticketUpdate']['revision'], approved=(approved.get('ticket') or {}).get('status'))
        r.receipt['result'] = 'passed' if outcome and outcome['outcome'] == 'healthy' else 'failed'
    finally:
        pressure.stop(episode)
        r.receipt['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        r.receipt['totalSeconds'] = round(time.time() - r.t0, 1)
        OUT.write_text(json.dumps(r.receipt, indent=2) + '\n')
        print('result', r.receipt.get('result'), 'in', r.receipt['totalSeconds'], 's')


if __name__ == '__main__':
    run()
