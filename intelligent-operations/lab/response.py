#!/usr/bin/env python3
"""Drive the response stage on the owned lab exactly as the browser does, under the operator's portal session.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Plan from the accepted canonical answer, approve exact artifacts, reserve and run one confirmed in-container exec, import the resolved alert, verify recovery and update the ticket; every receipt is written privately.
"""
import json
import time
from pathlib import Path
import collect
import evidence
import lab
import topology
from portal import Portal, private_json

API='/api/intelligent-operations'


def accepted_work(work):
    rows=[w for w in work.get('work',[]) if w.get('state')=='completed' and isinstance(w.get('answer'),str) and w['answer'].strip() and not w.get('resultUnavailable')]
    return sorted(rows,key=lambda w:-(w.get('phase') or {}).get('index',-1))[0] if rows else None


def action(portal,operation,account,body):
    return portal.call('/connectors/kubernetes/actions/'+operation+'?account='+account,body,confirmed=True)


def import_observation(portal,source_id,alert,status):
    labels=alert['labels'];event={'specversion':'1.0','id':alert['fingerprint']+'-'+status,'source':'urn:operations:source:lab-alertmanager','type':'operations.alert','time':alert.get('endsAt') if status=='resolved' and alert.get('endsAt','0001')[:4]!='0001' else alert['startsAt'],'dataschema':'urn:oshal:operations:alert:1','datacontenttype':'application/json',
        'data':{'environment':'operations-lab','alertType':labels['alertname'],'severity':labels.get('severity','warning'),'status':status,'resource':{'kind':'kubernetes-pod','scope':lab.guard()['kubeSystemUid'],'id':labels['pod_uid']}}}
    return portal.call(API+'/events',{'sourceId':source_id,'event':event})


def lab_source(portal):
    records=portal.call(API+'/records')
    for s in records['sources']:
        if s['source']=='urn:operations:source:lab-alertmanager': return s
    return portal.call(API+'/sources',{'name':'Lab Alertmanager','source':'urn:operations:source:lab-alertmanager','environment':'operations-lab'})


def run(directory,account='primary',container='pressure'):
    packet=json.loads((directory/'packet.json').read_text());ticket=json.loads((directory/'ticket.json').read_text())['ticket']
    scope=packet['scope'];receipt={'episode':scope['job'].removeprefix('cpu-pressure-'),'ticket':ticket,'packetSha256':packet['sha256'],'startedAt':time.time(),'steps':[]}
    out=directory/'response.json'
    def step(name,**values):
        receipt['steps'].append({'step':name,'at':time.time(),**values});private_json(out,receipt)
    with Portal() as portal:
        source=lab_source(portal);step('source',sourceId=source['id'])
        scan=topology.capture()
        if len(json.dumps(scan).encode())>65536: raise ValueError('The namespace scan exceeds the admitted 64 KiB bound.')
        saved=portal.call(API+'/topology/scans',{'sourceId':source['id'],'scan':scan});step('topology-scan',status=saved.get('status'),assets=len(scan['assets']))
        work=portal.call('/tickets/'+ticket+'/work')
        rows=sorted([w for w in work.get('work',[]) if w.get('state')=='completed' and isinstance(w.get('answer'),str) and w['answer'].strip() and not w.get('resultUnavailable')],key=lambda w:-(w.get('phase') or {}).get('index',-1))
        if not rows: raise RuntimeError('No completed canonical phase with a released answer.')
        target={'namespace':scope['namespace'],'pod':scope['pod'],'uid':scope['podUid'],'container':container};plan=None;refusals=[]
        for chosen in rows:
            try: plan=portal.call(API+'/executions/plans',{'ticketId':ticket,'workId':chosen['id'],'phase':(chosen.get('phase') or {}).get('name','unknown'),'answer':chosen['answer'],'target':target});break
            except RuntimeError as error: refusals.append({'phase':(chosen.get('phase') or {}).get('name'),'refusal':str(error)})
        step('plan-candidates',refusals=refusals)
        if not plan: raise RuntimeError('No completed phase answer yields an executable response file set: '+json.dumps(refusals))
        step('plan',planId=plan['id'],artifacts=[{'name':a['name'],'sha256':a['sha256'],'bytes':a['bytes']} for a in plan['artifacts']],ticketRevision=plan['ticketRevision'])
        for a in plan['artifacts']:
            data=portal.raw(API+'/executions/plans/'+plan['id']+'/artifacts/'+a['name'])
            if evidence.hashlib.sha256(data).hexdigest()!=a['sha256']: raise RuntimeError('Downloaded artifact digest mismatch: '+a['name'])
            (directory/('generated-'+a['name'])).write_bytes(data)
        step('downloads',count=len(plan['artifacts']))
        approval=portal.call(API+'/executions/approve',{'planId':plan['id']});step('approval',approvalId=approval['id'],expiresAt=approval['expiresAt'])
        execution=portal.call(API+'/executions/reserve',{'approvalId':approval['id'],'account':account});step('reserved',executionId=execution['id'])
        current=action(portal,'kubernetes-inspect-pod',account,execution['readback']['input'])
        if current.get('pod',{}).get('uid')!=target['uid']: raise RuntimeError('Pre-dispatch identity check failed.')
        result=action(portal,'kubernetes-exec',account,execution['dispatch']['input'])
        reported=portal.call(API+'/executions/report',{'executionId':execution['id'],'result':result});step('action',state=reported['state'],exitCode=result.get('exitCode'),outcome=result.get('outcome'))
        resolved=collect.wait_alert(receipt['episode'],'resolved',timeout=240);import_observation(portal,source['id'],resolved,'resolved');step('resolved-imported',fingerprint=resolved['fingerprint'])
        outcome=None
        for attempt in range(3):
            verification=portal.call(API+'/executions/verify',{'executionId':execution['id']})
            check=action(portal,'kubernetes-exec',account,verification['dispatch']['input'])
            readback=action(portal,'kubernetes-inspect-pod',account,verification['readback']['input'])
            verified=portal.call(API+'/executions/verify/report',{'executionId':execution['id'],'verificationId':verification['id'],'result':check,'readback':readback})
            outcome=verified['recovery'];step('verification',attempt=attempt,outcome=outcome['outcome'],reason=outcome['reason'],exitCode=check.get('exitCode'))
            if outcome['outcome']=='healthy': break
            time.sleep(10)
        if outcome['outcome']=='healthy':
            approved=portal.call('/tickets/'+ticket+'/approve',{},confirmed=True)
            updated=portal.call(API+'/executions/ticket-update',{'executionId':execution['id']})
            step('ticket-update',status=updated['ticketUpdate']['status'],revision=updated['ticketUpdate']['revision'],approvedStatus=approved.get('ticket',{}).get('status'))
        receipt['receipt']=portal.call(API+'/executions/'+execution['id']+'/receipt.json')
    receipt['finishedAt']=time.time();receipt['recovery']=outcome;private_json(out,receipt)
    print(json.dumps({k:receipt[k] for k in ['episode','ticket','recovery']},indent=2))
    return receipt


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('episode');parser.add_argument('--account',default='primary');args=parser.parse_args()
    evidence.required(args.episode,r'[a-f0-9]{16}')
    run(lab.STATE/'event-to-action'/args.episode,args.account)
