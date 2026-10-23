#!/usr/bin/env python3
"""Live automatic-investigation acceptance on the owned lab: a real fault, the installed detector and pipeline, and the native scheduled tick starting the investigation by itself.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | --watch-only: opt in and only watch the tick, for evidence that is already pending capture (the first run's schedule was suspended by a transient deny_tier).
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Opt the anomaly-candidate source into processing, evidence capture and automatic investigation; drive the real api error scenario through anomaly_live; then only watch: the per-minute native schedule must capture the evidence and start the canonical investigation through the kernel ticket-start port. Restore the previous processing settings afterwards and keep a private receipt.
"""
import json
import sys
import time
import anomaly_live
from portal import Portal, private_json
import lab

API='/api/intelligent-operations'


def settings(portal,**changes):
    current=portal.call(API+'/pipeline/processing')['config']
    body={k:current[k] for k in ['enabled','captureEvidence','sourceIds','batchSize','maxAttempts','retrySeconds']}
    body['autoInvestigate']=bool(current.get('autoInvestigate'))
    body.update(changes);body['expectedRevision']=current['revision']
    return current,portal.call(API+'/pipeline/processing-config',body)


def run(wait_seconds=600,fault=True):
    out=lab.STATE/'event-to-action'/('auto-investigate-live-'+time.strftime('%Y%m%dT%H%M%S')+'.json')
    receipt={'kind':'live-automatic-investigation','startedAt':time.time(),'steps':[]}
    def step(name,**values): receipt['steps'].append({'step':name,'at':time.time(),**values});private_json(out,receipt)
    with Portal() as portal:
        candidates=anomaly_live.source(portal,anomaly_live.CANDIDATES)
        before={i['id'] for i in portal.call(API+'/investigations')['items']}
        previous,saved=settings(portal,enabled=True,captureEvidence=True,autoInvestigate=True,sourceIds=[candidates['id']])
        step('opted-in',sourceId=candidates['id'],previous={k:previous.get(k) for k in ['enabled','captureEvidence','autoInvestigate','sourceIds','revision']},saved={k:saved.get(k) for k in ['enabled','captureEvidence','autoInvestigate','revision']} if isinstance(saved,dict) else saved)
    try:
        if fault:
            result=anomaly_live.run();step('fault-and-detection',window=result.get('window'),candidates=[s for s in result['steps'] if s['step'] in ('detection','evaluated')])
        deadline=time.time()+wait_seconds;seen={}
        while time.time()<deadline:
            with Portal() as portal:
                items=[i for i in portal.call(API+'/investigations')['items'] if i['id'] not in before]
                for i in items:
                    seen[i['id']]={k:i.get(k) for k in ['state','trigger','ticketId','startRequestedAt','startedAt','error','ticketStatus']}
                    seen[i['id']]['canonicalStatus']=(i.get('ticket') or {}).get('status')
                schedule=[x for x in portal.call('/api/v1/agent/schedules').get('schedules',[]) if x.get('app')=='intelligent-operations']
                step('watch',investigations=list(seen.values()),schedule=[{'status':x.get('status'),'last':[(h['outcome'],h.get('reason'),h.get('routeStatus')) for h in x.get('history',[])[:2]]} for x in schedule])
                if any(v['state'] in ('started','start-refused','start-uncertain') and v['trigger']=='scheduled-tick' for v in seen.values()):break
            time.sleep(20)
        receipt['result']='started-by-tick' if any(v['state']=='started' and v['trigger']=='scheduled-tick' for v in seen.values()) else ('refused' if any(v['state']=='start-refused' for v in seen.values()) else 'not-started')
    finally:
        with Portal() as portal:
            _,restored=settings(portal,enabled=previous['enabled'],captureEvidence=previous['captureEvidence'],autoInvestigate=False,sourceIds=previous['sourceIds'])
            step('restored',config={k:restored.get(k) for k in ['enabled','captureEvidence','autoInvestigate','sourceIds']} if isinstance(restored,dict) else restored)
        receipt['finishedAt']=time.time();private_json(out,receipt);print(receipt.get('result'),out,flush=True)
    return receipt


if __name__=='__main__':
    sys.exit(0 if run(fault='--watch-only' not in sys.argv).get('result')=='started-by-tick' else 1)
