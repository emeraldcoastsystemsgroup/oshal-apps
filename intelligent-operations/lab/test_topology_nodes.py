"""CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Node facts are bounded scalars: capacity/allocatable, pressure conditions, versions, roles, taints and addresses; pods still place onto the observed node UID."""
import unittest
import topology


def node(name='worker1',uid='node-uid-1',pressure=False):
    return {'kind':'Node','metadata':{'name':name,'uid':uid,'labels':{'node-role.kubernetes.io/worker':'','kubernetes.io/arch':'arm64'}},
            'spec':{'providerID':'kind://docker/lab/'+name,'taints':[{'key':'dedicated','value':'ops','effect':'NoSchedule'}]},
            'status':{'capacity':{'cpu':'2','memory':'3145728Ki','pods':'110'},'allocatable':{'cpu':'2','memory':'3043328Ki','pods':'110'},
                      'conditions':[{'type':'Ready','status':'True'},{'type':'MemoryPressure','status':'True' if pressure else 'False'},{'type':'DiskPressure','status':'False'},{'type':'PIDPressure','status':'False'}],
                      'addresses':[{'type':'InternalIP','address':'172.18.0.3'},{'type':'Hostname','address':name}],
                      'nodeInfo':{'kubeletVersion':'v1.37.0','osImage':'Debian GNU/Linux 12','containerRuntimeVersion':'containerd://2.1.4','architecture':'arm64','kernelVersion':'7.0.0-1019-nvidia'}}}


class NodeFactsTests(unittest.TestCase):
    def test_node_facts_are_bounded_scalars_with_pressure_and_placement(self):
        pod={'kind':'Pod','metadata':{'name':'api-1','namespace':'operations-demo','uid':'pod-uid-1'},'spec':{'nodeName':'worker1'},'status':{'phase':'Running','conditions':[{'type':'Ready','status':'True'}]}}
        ns={'kind':'Namespace','metadata':{'name':'operations-demo','uid':'ns-uid'}}
        scan=topology.normalize('cluster-uid','operations-demo',[ns,node(pressure=True),pod])
        row=next(a for a in scan['assets'] if a['kind']=='node');p=row['properties']
        self.assertEqual((p['capacityCpu'],p['allocatableMemory'],p['capacityPods']),('2','3043328Ki','110'))
        self.assertEqual(p['pressure'],'MemoryPressure');self.assertIn('Ready=True',p['conditions']);self.assertEqual(p['roles'],'worker');self.assertEqual(p['taints'],'dedicated=ops:NoSchedule')
        self.assertEqual((p['internalIp'],p['hostname'],p['kubeletVersion'],p['architecture']),('172.18.0.3','worker1','v1.37.0','arm64'))
        self.assertLessEqual(len(p),24);self.assertTrue(all(v is None or isinstance(v,(str,bool,int,float)) for v in p.values()))
        self.assertTrue(any(e['type']=='RUNS_ON' and e['to']['nativeId']=='node-uid-1' and e['from']['nativeId']=='pod-uid-1' for e in scan['relationships']))
        bare=topology.node_facts({'kind':'Node','metadata':{'name':'n','uid':'u'}})
        self.assertEqual(bare,{'unschedulable':False},'absent facts are omitted, never fabricated')


if __name__=='__main__':
    unittest.main()
