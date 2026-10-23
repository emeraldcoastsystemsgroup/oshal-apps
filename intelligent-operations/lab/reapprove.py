#!/usr/bin/env python3
"""Re-approve the operator's Operations assignment after a publish, then re-activate the processing schedule.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | A replaced role assignment invalidates the schedule activation made under the previous one (observed on the lab: replace alone -> next tick refused deny_tier and suspended). So: replace only when the assignment is not active, and after any replace always re-activate the schedule under the new assignment; never trust the schedule's status in the seconds before its next tick.
"""
import sys
import uuid
from portal import Portal

TARGET = '82e26285-3897-4819-8b59-8e1ea70ac473'
ASSIGNMENT = 'k8s-install-admin-operations'


def run():
    with Portal() as p:
        catalog = p.call('/api/authorization/composites')
        row = next(a for a in catalog['assignments'] if a.get('assignment', a)['id'] == ASSIGNMENT)
        replaced = False
        if row['status'] != 'active':
            body = {'target': TARGET, 'assignment_id': ASSIGNMENT, 'action': 'replace', 'expected_revision': catalog['revision'],
                    'reason': 'Operations release re-approval', 'idempotency_key': str(uuid.uuid4()),
                    'selection': {'kind': 'granular', 'app': 'intelligent-operations', 'role': 'operator'}}
            body['expected_plan_revision'] = p.call('/api/authorization/composites/preview', body)['plan_revision']
            p.call('/api/authorization/composites/apply', body)
            replaced = True
        schedule = next(x for x in p.call('/api/v1/agent/schedules').get('schedules', []) if x.get('app') == 'intelligent-operations')
        if replaced or schedule.get('status') != 'active':
            p.call('/api/v1/agent/schedules/' + schedule['id'] + '/activate', {'class': 'person'})
        print({'assignment': 'replaced' if replaced else row['status'], 'schedule': 're-activated' if replaced or schedule.get('status') != 'active' else 'active'})


if __name__ == '__main__':
    sys.exit(run())
