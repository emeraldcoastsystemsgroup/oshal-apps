#!/usr/bin/env python3
"""One explicit linked retry of the sealed local-monitoring investigation after a reviewed relay fix.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve the failed attempt and original packet while reserving one canonical child retry, without replaying alerts or granting execution.
"""
import datetime
import hashlib
import json
import os
from portal import Portal, private_json


def main():
    with Portal() as portal:
        original=json.loads((portal.state/'decision-real-incident.json').read_text())
        upgrade=json.loads((portal.state/'account-deadline-upgrade.json').read_text())
        assert upgrade['inferenceSeconds']==90 and upgrade['kernelRequestSeconds']==105
        parent=original['ticketId'];ticket=portal.call('/tickets/'+parent)['ticket']
        assert ticket['status']=='failed','Only the confirmed failed attempt may be retried.'
        previous=portal.call('/tickets/'+parent+'/workflow')
        assert previous['children']==[],'Review any existing linked work before retrying.'
        prepared=portal.call('/api/intelligent-operations/investigations',{'workId':original['workId']})
        assert prepared['ticketId']==parent and prepared['inputSha256']==original['inputSha256']
        start=prepared['startInput'];assert len(start['files'])==1
        wire=bytes(start['files'][0]['bytes']);assert hashlib.sha256(wire).hexdigest()==original['inputSha256']
        packet=json.loads(wire);assert packet['executionAuthorized'] is False and packet['rawStreamAccess'] is False
        receipt={'stage':'reserved','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 'parentTicketId':parent,'inputSha256':original['inputSha256'],
                 'accountRuntimeRevision':upgrade['runtimeRevision'],'priorProviderConsumption':'unknown: no successful usage receipt',
                 'executionAuthorized':False,'externalSends':0}
        state=portal.state/'decision-real-retry.json'
        fd=os.open(state,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as output:json.dump(receipt,output,indent=2)
        child=portal.call('/tickets/'+parent+'/children',{'kind':'intelligent-operations',
            'title':'Review captured local availability incident — linked relay-timeout retry',
            'description':'One explicit retry after the bounded account deadline correction. Parent '+parent+
                          ' remains failed. Same sealed packet SHA256 '+original['inputSha256']+
                          '. Diagnose and propose only; no infrastructure execution authorized.'})['ticket']
        receipt.update(stage='created',ticketId=child['id']);private_json(state,receipt)
        portal.call('/tickets/'+child['id']+'/start',start)
        receipt.update(stage='dispatched');private_json(state,receipt)
        print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()
