"""CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Test pressure resource boundaries and hostile collector input exclusion.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The drill is bounded by a configurable duration (deadline duration + 240 s, at most 1800 s) and mounts the in-container stop control; refuse unbounded or non-integer durations."""
import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lab'))
import pressure
import evidence
import pressure_verify as verify

EPISODE='0123456789abcdef'
UID='11111111-2222-4333-8444-555555555555'


def fixture():
    alert={'labels':{'alertname':'LabNodeCpuPressure','episode':EPISODE,'environment':'operations-lab','node':'operations-lab-worker2','pod_uid':UID},'startsAt':'2026-10-20T22:00:00Z','fingerprint':'0123456789abcdef','annotations':{'secret':'DO-NOT-MATERIALIZE'}}
    pod={'metadata':{'name':'cpu-pressure-'+EPISODE+'-abc12','namespace':'operations-demo','uid':UID,'labels':{'episode':EPISODE},'ownerReferences':[{'kind':'Job','name':'cpu-pressure-'+EPISODE}]},'spec':{'nodeName':'operations-lab-worker2','containers':[{'name':'pressure','env':[{'name':'TOKEN','value':'DO-NOT-MATERIALIZE'}],'resources':{'limits':{'cpu':'1'}}}]},'status':{'phase':'Running','conditions':[{'type':'Ready','status':'True'}]}}
    return alert,{'items':[pod]}


class EvidenceTests(unittest.TestCase):
    def test_review_gate_requires_completed_outputs_and_no_cluster_capabilities(self):
        projection={'ticket':{'status':'awaiting_approval','position':{'index':3}},'workflow':{'nodeGraph':{'nodes':[{'approval':{'approver':'admin'},'capabilities':[]}]}}}
        work={'work':[{'phase':{'index':i,'name':name},'state':'completed','answer':'evidence-based answer'} for i,name in enumerate(['investigate','review','revise'])]}
        verify.workflow_complete(projection,work)
        for index in range(3):
            broken=copy.deepcopy(work);broken['work'][index]['state']='failed'
            with self.assertRaises(ValueError): verify.workflow_complete(projection,broken)
        broken=copy.deepcopy(work);broken['work'][0]['answer']=None
        with self.assertRaises(ValueError): verify.workflow_complete(projection,broken)
        broken=copy.deepcopy(projection);broken['workflow']['nodeGraph']['nodes'][0]['capabilities']=['cluster-admin']
        with self.assertRaises(ValueError): verify.workflow_complete(broken,work)

    def test_pressure_is_bounded_without_credentials(self):
        job=pressure.objects(EPISODE)[1];spec=job['spec']['template']['spec'];container=spec['containers'][0]
        self.assertFalse(spec['automountServiceAccountToken']);self.assertEqual(spec['nodeSelector'],{'kubernetes.io/hostname':'operations-lab-worker2'})
        self.assertEqual(container['resources']['limits'],{'cpu':'1','memory':'64Mi'})
        self.assertEqual(job['spec']['activeDeadlineSeconds'],pressure.DURATION+240)
        self.assertLessEqual(pressure.DURATION,1800)
        with self.assertRaises(ValueError): pressure.objects(EPISODE,duration=1801)
        with self.assertRaises(ValueError): pressure.objects(EPISODE,duration='900')
        container=job['spec']['template']['spec']['containers'][0]
        self.assertIn({'name':'control','mountPath':'/run/pressure'},container['volumeMounts'])
        self.assertIn({'name':'control','emptyDir':{'sizeLimit':'1Mi'}},job['spec']['template']['spec']['volumes'])
        self.assertTrue(container['securityContext']['readOnlyRootFilesystem'])
        self.assertEqual(pressure.collector_roles()[1]['rules'],[{'apiGroups':[''],'resources':['pods'],'verbs':['get','list']}])
        with self.assertRaises(ValueError): pressure.objects('x; rm -rf /')

    def test_actual_cpu_measurement_rule_not_synthetic_fault_flag(self):
        config=pressure.monitoring()['data']
        self.assertIn('rate(operations_pressure_cpu_seconds_total[20s]) > 0.45',config['rules.yaml'])
        self.assertIn('for: 10s',config['rules.yaml'])
        self.assertIn('time.thread_time()-cpu_start',(pressure.lab.ROOT/'pressure_workload.py').read_text())

    def test_projection_discards_annotations_and_environment(self):
        alert,pods=fixture();value=evidence.packet(alert,pods,UID,EPISODE)
        self.assertNotIn('DO-NOT-MATERIALIZE',json.dumps(value))
        self.assertEqual(value['authority']['tools'],[]);self.assertFalse(value['authority']['clusterAccess'])
        body=copy.deepcopy(value);sha=body.pop('sha256');self.assertEqual(evidence.digest(body),sha)
        for field in ['episode','node','pod_uid','environment']:
            other=copy.deepcopy(alert);other['labels'][field]='wrong'
            with self.assertRaises(ValueError,msg=field): evidence.packet(other,pods,UID,EPISODE)
        other=copy.deepcopy(pods);other['items'][0]['spec']['nodeName']='foreign'
        with self.assertRaises(ValueError): evidence.packet(alert,other,UID,EPISODE)

    def test_scripts_bind_exact_target_and_require_operator_approval(self):
        alert,pods=fixture();packet=evidence.packet(alert,pods,UID,EPISODE);scripts=evidence.scripts(packet)
        self.assertIn('OSHAL_LAB_KUBECONFIG',scripts['inspect.sh']);self.assertIn(UID,scripts['inspect.sh'])
        self.assertIn('OSHAL_APPROVE_JOB',scripts['stop-pressure.sh'])
        self.assertNotIn('--all',scripts['stop-pressure.sh']);self.assertIn('cpu-pressure-'+EPISODE,scripts['stop-pressure.sh'])
        self.assertNotIn('delete',scripts['inspect.sh'])

if __name__=='__main__': unittest.main()
