#!/usr/bin/env python3
"""Publish a redacted copy of a private response-drill receipt as package evidence.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep ticket, plan, digests, outcomes and timings; drop command output text and any session material before the receipt enters the repository.
"""
import json
from pathlib import Path
import lab


def redact(receipt):
    execution=(receipt.get('receipt') or {}).get('execution') or {}
    def receipt_only(record):
        if not record: return None
        return {k:record.get(k) for k in ['outcome','exitCode','observedAt','observedUid','transport','reportedAt','provenance','verifiedByServer','targetIdentityMatched'] if k in record}
    verifications=[{**{k:v.get(k) for k in ['index','state','outcome','reason','reportedAt'] if k in v},'check':receipt_only(v.get('check')),'readback':{k:(v.get('readback') or {}).get(k) for k in ['phase','identityMatched','provenance','verifiedByServer']},'signal':v.get('signal')} for v in execution.get('verifications',[])]
    return {'kind':'operations-response-drill','syntheticPressure':True,'episode':receipt['episode'],'ticket':receipt['ticket'],'packetSha256':receipt['packetSha256'],
            'steps':[{k:v for k,v in s.items() if k not in ('refusals',)} for s in receipt['steps']],
            'plan':(receipt.get('receipt') or {}).get('plan'),
            'execution':{**{k:execution.get(k) for k in ['id','planId','approvalId','ticketId','ticketRevision','state','createdAt','recovery','ticketUpdate','provenance','verifiedByServer'] if k in execution},'dispatch':{'operation':execution.get('dispatch',{}).get('operation'),'account':execution.get('dispatch',{}).get('account'),'argvDigestOnly':True},'action':receipt_only(execution.get('action')),'verifications':verifications},
            'labels':(receipt.get('receipt') or {}).get('labels'),'recovery':receipt.get('recovery'),'startedAt':receipt.get('startedAt'),'finishedAt':receipt.get('finishedAt')}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('episode');parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'deploy/evidence/response.json');args=parser.parse_args()
    receipt=json.loads((lab.STATE/'event-to-action'/args.episode/'response.json').read_text())
    text=json.dumps(redact(receipt),indent=2)+'\n'
    for forbidden in ['session','Bearer','password']:
        if forbidden in text: raise ValueError('Refusing to publish a receipt containing '+forbidden)
    args.output.write_text(text);print('wrote',args.output,len(text),'bytes')
