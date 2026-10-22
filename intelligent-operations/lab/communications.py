#!/usr/bin/env python3
"""One explicitly authorized local portal notification test per channel; never a retry loop.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Reserve and fsync the operator's one-time SMS/phone/Telegram test before standard confirmed native sends, preserving muted test routes and sanitized evidence.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import tempfile
from portal import Portal

AUTHORIZATION='4fa031e0fcb54f439129c3547fa0edaa'
KINDS=('sms','voice','telegram')
TOPICS={kind:'triagenorth-verify-'+kind for kind in KINDS}

def targets_from_env(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd) as source:
        info=os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_size>262144:
            raise ValueError('Use an owned bounded literal environment file.')
        values={}
        for line in source:
            match=re.match(r'^\s*(?:export\s+)?(TWILIO_TO_NUMBER|TELEGRAM_CHAT_ID)\s*=\s*(.*)$',line)
            if not match:continue
            key,raw=match.groups()
            if key in values:raise ValueError('A selected destination key is repeated.')
            parsed=shlex.split(raw,comments=True,posix=True)
            if len(parsed)!=1 or any(t in parsed[0] for t in ['${','$(','`']):raise ValueError('Use literal destination values.')
            values[key]=parsed[0]
    phone=values.get('TWILIO_TO_NUMBER','');chat=values.get('TELEGRAM_CHAT_ID','')
    if not re.fullmatch(r'\+[1-9][0-9]{6,14}',phone) or not re.fullmatch(r'-?[1-9][0-9]{0,18}',chat):
        raise ValueError('The existing phone and Telegram destinations must be explicit and valid.')
    return {'sms':phone,'voice':phone,'telegram':chat}

def persist(path,value):
    if path.is_symlink():raise ValueError('Refusing a linked test ledger.')
    fd,name=tempfile.mkstemp(prefix='.notification-ledger-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as output:
            json.dump(value,output,sort_keys=True);output.write('\n');output.flush();os.fsync(output.fileno())
        os.replace(name,path)
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(name):os.unlink(name)

def read_ledger(path):
    if not path.exists():return None
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077 or info.st_size>32768:
        raise ValueError('Test ledger must be an owned private bounded regular file.')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd) as source:value=json.load(source)
    if value.get('authorization')!=AUTHORIZATION or set(value.get('channels',{}))!=set(KINDS):raise ValueError('Test authorization ledger does not match.')
    for row in value['channels'].values():
        if not isinstance(row,dict) or row.get('state') not in {'pending','reserved-outcome-unknown','accepted','unconfirmed','uncertain'}:
            raise ValueError('Invalid test ledger; no additional send is authorized.')
        if row.get('attempts')!=(0 if row['state']=='pending' else 1):raise ValueError('Invalid test attempt count.')
    return value

def mute(portal,kind):
    body=portal.call('/api/notify/prefs',{'topic':TOPICS[kind],'channel':kind,'enabled':False})
    return any(p['topic']==TOPICS[kind] and p['enabled'] is False for p in body.get('prefs',[]))

def send_one(portal,path,ledger,kind,destination,message):
    row=ledger['channels'][kind]
    if row['state']!='pending':
        if not row.get('testRouteMuted',False):
            try:row['testRouteMuted']=mute(portal,kind);persist(path,ledger)
            except (RuntimeError,ValueError,OSError):pass
        return
    pref={'topic':TOPICS[kind],'channel':kind,'enabled':True}
    pref['telegramChatId' if kind=='telegram' else 'phone']=destination
    portal.call('/api/notify/prefs',pref)
    row.update(state='reserved-outcome-unknown',attempts=1,testRouteMuted=False)
    try:persist(path,ledger)  # Durable reservation must precede confirmation and any possible external send.
    except OSError:
        try:mute(portal,kind)
        except (RuntimeError,ValueError,OSError):pass
        raise
    try:
        answer=portal.call('/api/notify/test',{'topic':TOPICS[kind],'channel':kind,'message':message},confirmed=True)
        legacy=kind=='telegram' and 'accepted' not in answer and answer.get('ok') is True and answer.get('delivered') is True and answer.get('skipped') is False and answer.get('reason')=='transport_acknowledged'
        accepted=(answer.get('accepted') is True or legacy) and answer.get('channel')==kind
        row.update(state='accepted' if accepted else 'unconfirmed',apiAccepted=accepted,
                   deliveryState=answer.get('deliveryState','transport_acknowledged' if legacy else 'unknown'),humanReceiptVerified=False,
                   acknowledgementProtocol='legacy-telegram' if legacy else 'native-acceptance',
                   nativeResponse={k:answer[k] for k in ['accepted','ok','delivered','channel','reason','skipped','deliveryState'] if k in answer})
    except (RuntimeError,ValueError,OSError):
        row.update(state='uncertain',apiAccepted=False,humanReceiptVerified=False)
    finally:
        persist(path,ledger)
        try:row['testRouteMuted']=mute(portal,kind)
        except (RuntimeError,ValueError,OSError):row['testRouteMuted']=False
        persist(path,ledger)

def run_authorized_tests(portal,state,targets,ticket_id,selected=KINDS):
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',ticket_id):raise ValueError('Use an existing owned workflow ticket.')
    if set(targets)!=set(KINDS):raise ValueError('All three authorized destinations are required.')
    if not selected or len(set(selected))!=len(selected) or not set(selected)<=set(KINDS):raise ValueError('Select only an approved test channel.')
    path=state/('communications-'+AUTHORIZATION+'.json');lock=state/('communications-'+AUTHORIZATION+'.lock')
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as held:
        info=os.fstat(held.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise ValueError('Use an owned private test lock.')
        fcntl.flock(held,fcntl.LOCK_EX)
        current=portal.call('/api/notify/prefs');channels=current.get('channels',[])
        if not set(selected)<=set(channels):raise ValueError('Complete the selected native service rollout before testing.')
        workflow=portal.call('/tickets/'+ticket_id+'/workflow')['ticket'];fingerprints={k:hashlib.sha256(v.encode()).hexdigest() for k,v in targets.items()}
        ledger=read_ledger(path) or {'authorization':AUTHORIZATION,'ticketId':ticket_id,'targetFingerprints':fingerprints,'channels':{k:{'state':'pending','attempts':0} for k in KINDS}}
        if ledger.get('targetFingerprints')!=fingerprints or ledger.get('ticketId')!=ticket_id:raise ValueError('The original test targets or workflow changed; no additional send is authorized.')
        persist(path,ledger)
        spoken='This is the authorized TriageNorth phone alert test. Your investigation is '+workflow['status'].replace('_',' ')+'. The test is complete. Goodbye.'
        text='TriageNorth alert test: workflow '+ticket_id[:8]+' is '+workflow['status']+'. No infrastructure action was executed. One authorized test.'
        for kind in KINDS:
            if kind in selected:send_one(portal,path,ledger,kind,targets[kind],spoken if kind=='voice' else text)
        return {'authorization':AUTHORIZATION,'ticketId':ticket_id,'workflowState':workflow['status'],
                'channels':[{**ledger['channels'][kind],'channel':kind} for kind in KINDS],
                'allAccepted':all(r.get('apiAccepted') is True for r in ledger['channels'].values()),
                'allTestRoutesMuted':all(r.get('testRouteMuted') is True for r in ledger['channels'].values()),
                'humanReceiptVerified':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--ticket-id',required=True)
    parser.add_argument('--channel',choices=KINDS,help='Test just this approved channel when other service rollouts are pending; the same ledger still governs all three')
    parser.add_argument('--authorized-once',action='store_true',help='Only after explicit approval for exactly one SMS, brief call and Telegram to the existing configured targets')
    args=parser.parse_args()
    if not args.authorized_once:raise ValueError('Explicit one-time destination authorization is required before invocation.')
    with Portal() as portal:
        result=run_authorized_tests(portal,portal.state,targets_from_env(args.env_file),args.ticket_id,(args.channel,) if args.channel else KINDS)
        print(json.dumps(result,sort_keys=True))

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError):raise SystemExit('Notification acceptance stopped; inspect the private ledger and service standing. No automatic retry was made.') from None
