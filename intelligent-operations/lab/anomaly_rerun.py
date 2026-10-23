"""Resume detection on the latest live anomaly run (after a fix or a failed pass) and append the outcome to its private receipt.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Rerun the installed detector on already streamed samples, read baselines and candidates, and evaluate firing candidates through percolation and reduction.
"""
import json,sys,time
sys.path.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
from portal import Portal,private_json
API='/api/intelligent-operations'
path=sorted(__import__('lab').STATE/'event-to-action'.glob('anomaly-live-*.json'))[-1]
r=json.loads(path.read_text());t0=r['window']['healthyFrom']
def step(name,**v): r['steps'].append({'step':name,'at':time.time(),**v});private_json(path,r)
with Portal() as p:
    d=p.call(API+'/anomaly/run',{});step('detection-rerun',candidates=d.get('candidates'),resolved=d.get('resolved'),failed=d.get('failed'),results=d.get('results'))
    page=p.call(API+'/anomaly');step('baselines-rerun',baselines=[{k:b.get(k) for k in ['name','resource','readiness','samples','lastScore','lastBaseline','firing','lastCandidate']} for b in page['baselines'] if b['name']=='frontend.error_ratio'])
    cand=next(s for s in p.call(API+'/records')['sources'] if s['source']=='urn:operations:source:lab-anomaly-candidates')
    mine=[e for e in p.call(API+'/records')['events'] if e.get('sourceId')==cand['id']]
    step('candidates-rerun',events=[{'id':e['id'],'status':e['normalized']['data']['status'],'alertType':e['normalized']['data']['alertType'],'time':e['normalized']['time'],'score':e['raw']['data'].get('score'),'confidence':e['raw']['data'].get('confidence'),'baseline':e['raw']['data'].get('baseline'),'decision':e['decision']} for e in mine])
    firing=[e['id'] for e in mine if e['normalized']['data']['status']=='firing']
    if firing:
        ev=p.call(API+'/pipeline/evaluate',{'deliveryIds':firing[:20]});step('evaluated-rerun',results=[{'deliveryId':x.get('deliveryId'),'outcome':x.get('outcome'),'reduction':(x.get('reduction') or {}).get('outcome'),'capture':(x.get('reduction') or {}).get('workId') is not None,'error':x.get('error')} for x in ev['results']])
print(path)
for s in r['steps'][-4:]:print(json.dumps(s)[:700])
