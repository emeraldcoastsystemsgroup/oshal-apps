#!/usr/bin/env python3
"""Bounded owned-lab drill: enable correlation, induce one Alertmanager CPU alert, then verify its exact ticket trace.

No workflow approval, connector message or remediation is performed. The CPU Job is deleted in a finally block.
"""
import json
import secrets
import time
from pathlib import Path
import lab
import pressure
from portal import Portal

API='/api/intelligent-operations'
OUT=Path(__file__).resolve().parent.parent/'deploy/evidence/incident-correlation-live.json'


def wait(label,probe,seconds=600):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        result=probe()
        if result:return result
        time.sleep(10)
    raise TimeoutError('Timed out waiting for '+label)


def run():
    lab.guard()
    episode=secrets.token_hex(8)
    with Portal() as p:
        records=p.call(API+'/records')
        source=next(x for x in records['sources'] if x['source']=='urn:operations:source:lab-alertmanager')
        before={x['id'] for x in records['events']}
        config=p.call(API+'/pipeline/processing')['config']
        assert config['enabled'] and config['captureEvidence'] and config['autoInvestigate'] and source['id'] in config['sourceIds']
        schedule=next(x for x in p.call('/api/v1/agent/schedules')['schedules'] if x.get('app')=='intelligent-operations')
        assert schedule['status']=='active'
        saved=p.call(API+'/pipeline/processing-config',{key:config[key] for key in ('enabled','captureEvidence','autoInvestigate','sourceIds','batchSize','maxAttempts','retrySeconds','correlationPolicy')}|{'correlate':True,'expectedRevision':config['revision']}) if not config['correlate'] else config
        print('Automatic correlation on at revision',saved['revision'],flush=True)

    started=time.monotonic()
    receipt=None
    try:
        pressure.start(episode)
        def firing():
            with Portal() as p:
                return next((x for x in p.call(API+'/records')['events'] if x['id'] not in before and x.get('sourceId')==source['id'] and (x.get('raw') or {}).get('data',{}).get('alertType')=='LabNodeCpuPressure' and (x.get('raw') or {}).get('data',{}).get('status')=='firing'),None)
        event=wait('firing Alertmanager delivery',firing)
        print('Firing delivery',event['id'][:12],flush=True)
        def linked():
            with Portal() as p:
                return next((x for x in p.call(API+'/investigations')['items'] if x.get('deliveryId')==event['id'] and x.get('ticketId')),None)
        investigation=wait('canonical investigation link',linked)
        ticket_id=investigation['ticketId']
        print('Canonical ticket',ticket_id,flush=True)
        def correlated():
            with Portal() as p:
                data=p.call(API+'/incidents/'+ticket_id+'/trace')['data']
                cohort=next((x for x in data['pipeline']['correlations'] if event['id'] in x.get('deliveryIds',[])),None)
                return (data,cohort) if cohort else None
        data,cohort=wait('stored correlation linked to the exact ticket',correlated)
        plans=data['responses']['items']
        approvals=sum(bool(plan.get('approval')) for plan in plans)
        executions=sum(len(plan.get('executions',[])) for plan in plans)
        receipt={'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'application':'intelligent-operations','scenario':'one bounded CPU-pressure Job in the owned operations-demo namespace','episode':episode,'secondsToLinkedCohort':round(time.monotonic()-started,1),'ticketId':ticket_id,'deliveryId':event['id'],'investigationId':investigation['id'],'correlationId':cohort['id'],'correlationStatus':cohort.get('status'),'correlationMethod':cohort.get('method'),'coverageProblems':len(cohort.get('problems',[])),'groups':len(cohort.get('groups',[])),'exactTrace':data['exact'],'filterDecisions':len(data['pipeline']['decisions']),'packetLinked':bool(data['investigations']['items'][0].get('packetSha256')),'truncatedSets':[k for k,v in data['limits'].items() if v],'processingConfigRevision':saved['revision'],'approvalsRecordedAtTrace':approvals,'executionsRecordedAtTrace':executions,'noApprovalOrExecution':approvals==0 and executions==0}
    finally:
        pressure.stop(episode)
        print('Bounded pressure Job removed',flush=True)
    receipt['pressureJobRemoved']=True
    OUT.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt),flush=True)


if __name__=='__main__':run()
