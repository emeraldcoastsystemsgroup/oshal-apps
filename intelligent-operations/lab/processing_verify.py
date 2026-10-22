#!/usr/bin/env python3
"""Verify actual native schedule ticks, queue draining and pause in the owned lab.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Identify new native receipts by stable IDs; native timestamp fields have different representations.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve an honest receipt for background evaluation without invoking the processing route manually.
"""
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from portal import Portal, private_json
from intake_verify import response
import lab


BASE = '/api/intelligent-operations'
SCHEDULES = '/api/v1/agent/schedules'


def schedule(portal):
    return next(s for s in portal.call(SCHEDULES)['schedules']
                if s['app'] == 'intelligent-operations' and s['name'] == 'operations-process-recorded-alerts')


def wait_for_decisions(portal, deliveries):
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        decisions = [d for d in portal.call(BASE+'/pipeline')['decisions'] if d['deliveryId'] in deliveries]
        if len(decisions) == len(deliveries):
            return decisions
        jobs = [j for j in portal.call(BASE+'/pipeline/processing')['jobs'] if j['id'] in deliveries]
        assert not any(j['state'] in ('retry', 'attention') for j in jobs), jobs
        print('Waiting for native scheduled tick:', len(decisions), '/', len(deliveries), flush=True)
        time.sleep(5)
    raise AssertionError('The native scheduler did not process the admitted cohort in 150 seconds.')


def verify():
    lab.guard()
    episode = 'scheduled-acceptance-' + uuid.uuid4().hex
    with Portal() as portal:
        before = portal.call(BASE+'/pipeline/processing')['config']
        assert not before['enabled'], 'Disable the previous acceptance worker before starting a new acceptance cohort.'
        initial = schedule(portal)
        assert initial['status'] != 'active', 'Pause the existing schedule before starting this acceptance.'
        source = portal.call(BASE+'/sources', {'name': 'Scheduled acceptance '+episode[-8:], 'source': 'urn:operations:'+episode, 'environment': 'operations-lab'})
        policy = {'name': episode, 'window': {'mode': 'sliding', 'seconds': 900}, 'rules': [
            {'name': 'Scheduled matching signal', 'enabled': True, 'capture': True, 'query': {'term': {'alertType': 'ScheduledAcceptance'}}}]}
        published = portal.call(BASE+'/pipeline/policies', {'sourceId': source['id'], 'policy': policy, 'expectedRevision': 0})
        def admit(i):
            event = {'specversion': '1.0', 'id': episode+'-'+str(i), 'source': source['source'],
                     'type': 'operations.alert', 'time': datetime.now(timezone.utc).isoformat(),
                     'dataschema': 'urn:oshal:operations:alert:1', 'datacontenttype': 'application/json',
                     'data': {'environment': 'operations-lab', 'alertType': 'ScheduledAcceptance' if i < 4 else 'FilteredAcceptance',
                              'severity': 'warning', 'status': 'firing',
                              'resource': {'kind': 'container', 'scope': 'cluster/operations-lab', 'id': episode}}}
            return portal.call(BASE+'/events', {'sourceId': source['id'], 'event': event})['id']
        deliveries = [admit(i) for i in range(6)]
        settings = {'enabled': True, 'sourceIds': [source['id']], 'batchSize': 10, 'maxAttempts': 8, 'retrySeconds': 30, 'expectedRevision': before['revision']}
        saved = portal.call(BASE+'/pipeline/processing-config', settings)
        job_id = initial['id']
        portal.call(SCHEDULES+'/'+job_id+'/activate', {'class': 'person'})
        print('Activated native personal schedule; no processing route or manual trigger called.', flush=True)
        try:
            decisions = wait_for_decisions(portal, deliveries)
            assert sum(d['reduction']['outcome'] == 'admitted' for d in decisions) == 1
            assert sum(d['reduction']['outcome'] == 'suppressed' for d in decisions) == 3
            assert sum(d['outcome'] == 'unmatched' for d in decisions) == 2
            ran = schedule(portal)
            assert ran['executionCount'] > initial['executionCount'], ran
            jobs = [j for j in portal.call(BASE+'/pipeline/processing')['jobs'] if j['id'] in deliveries]
            assert all(j['processing']['attempts'] == 1 and j['processing']['status'] == 'completed' and 'token' not in j['processing'] for j in jobs), jobs
            portal.call(SCHEDULES+'/'+job_id+'/deactivate', {})
            paused = schedule(portal)
            held = admit(6)
            for _ in range(13):
                time.sleep(5)
                assert not any(d['deliveryId'] == held for d in portal.call(BASE+'/pipeline')['decisions'])
            assert schedule(portal)['executionCount'] == paused['executionCount']
            print('Paused schedule left new work pending across a complete minute.', flush=True)
            portal.call(SCHEDULES+'/'+job_id+'/activate', {'class': 'person'})
            wait_for_decisions(portal, [held])
            code, _ = response(portal, BASE+'/pipeline/processing', token=False)
            assert code in (401, 403)
            proof = {'observedAt': datetime.now(timezone.utc).isoformat(), 'episode': episode, 'sourceId': source['id'],
                     'policyId': published['policy']['id'], 'scheduleId': job_id, 'scheduledOccurrences': 7,
                     'firstCohort': {'recorded': 6, 'matched': 4, 'filtered': 2, 'admitted': 1, 'suppressed': 3},
                     'personalSchedule': True, 'manualProcessingCalls': 0, 'manualScheduleTriggers': 0,
                     'pausedForSeconds': 65, 'pausePreservedPendingWork': True, 'resumeProcessedPendingWork': True,
                     'singleAttemptPerInitialDelivery': True, 'unauthenticatedStatus': code,
                     'acceptanceAlertsSynthetic': True, 'evidenceCollection': False, 'infrastructureExecution': False,
                     'finalWorkerEnabled': False, 'finalScheduleActive': False}
        finally:
            portal.call(SCHEDULES+'/'+job_id+'/deactivate', {})
            current = portal.call(BASE+'/pipeline/processing')['config']
            settings.update(enabled=False, expectedRevision=current['revision'])
            portal.call(BASE+'/pipeline/processing-config', settings)
        assert not portal.call(BASE+'/pipeline/processing')['config']['enabled']
        final = schedule(portal)
        assert final['status'] != 'active'
        prior_receipts = {r['id'] for r in initial['history']}
        ticks = [r for r in final['history'] if r['id'] not in prior_receipts]
        assert len(ticks) >= 2 and all(r['trigger'] == 'schedule' and r['outcome'] == 'completed' and r['routeStatus'] == 200 for r in ticks), ticks
        proof['nativeReceipts'] = [{k: r[k] for k in ('id', 'due', 'trigger', 'outcome', 'routeStatus')} for r in ticks]
        private_json(Path.home()/'.local/state/oshal-k8s/processing-acceptance.json', proof)
        print(json.dumps(proof, indent=2), flush=True)


if __name__ == '__main__':
    verify()
