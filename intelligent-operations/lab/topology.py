#!/usr/bin/env python3
"""Collect a bounded namespace topology from the owned lab; no credentials enter the scan.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Use Kubernetes UIDs, owner references and EndpointSlices instead of name-derived identity and unconditional freshness stamps.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Retain bounded pod phase, readiness and container waiting/termination facts for operator inspection.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Record node capacity, allocatable, pressure conditions, kubelet/OS/runtime versions, roles, taints and addresses as bounded scalar facts so the Systems explorer can show what is in each cluster node.
"""
import argparse
from datetime import datetime, timezone
import json
import uuid
from pathlib import Path
import lab

KINDS={'Namespace':'namespace','Node':'node','Deployment':'workload','StatefulSet':'workload','DaemonSet':'workload','CronJob':'workload','ReplicaSet':'replica-set','Job':'job','Pod':'pod','Service':'service','Ingress':'ingress'}
RESOURCES=['deployments','statefulsets','daemonsets','cronjobs','replicasets','jobs','pods','services','ingresses','endpointslices']


def node_facts(obj):
    """Bounded scalar facts of a Node object: capacity, allocatable, pressure conditions, versions, roles, taints and addresses."""
    spec=obj.get('spec') or {};status=obj.get('status') or {};info=status.get('nodeInfo') or {};meta=obj.get('metadata') or {}
    capacity=status.get('capacity') or {};allocatable=status.get('allocatable') or {}
    conditions={c.get('type'):c.get('status') for c in status.get('conditions',[]) if c.get('type')}
    pressure=[t for t in ('MemoryPressure','DiskPressure','PIDPressure','NetworkUnavailable') if conditions.get(t)=='True']
    roles=sorted(k.split('/',1)[1] for k in (meta.get('labels') or {}) if k.startswith('node-role.kubernetes.io/'))
    taints=['{}={}:{}'.format(t.get('key'),t.get('value',''),t.get('effect')) for t in spec.get('taints') or []]
    addresses={a.get('type'):a.get('address') for a in status.get('addresses',[]) if a.get('type')}
    facts={'providerId':spec.get('providerID'),'capacityCpu':capacity.get('cpu'),'capacityMemory':capacity.get('memory'),'capacityPods':capacity.get('pods'),
           'allocatableCpu':allocatable.get('cpu'),'allocatableMemory':allocatable.get('memory'),'allocatablePods':allocatable.get('pods'),
           'kubeletVersion':info.get('kubeletVersion'),'osImage':info.get('osImage'),'containerRuntime':info.get('containerRuntimeVersion'),'architecture':info.get('architecture'),'kernelVersion':info.get('kernelVersion'),
           'internalIp':addresses.get('InternalIP'),'hostname':addresses.get('Hostname'),'roles':','.join(roles) or None,'taints':'; '.join(taints)[:1024] or None,
           'unschedulable':bool(spec.get('unschedulable')),'conditions':','.join(k+'='+str(v) for k,v in sorted(conditions.items()))[:1024] or None,'pressure':','.join(pressure) or None}
    return {k:v for k,v in facts.items() if v is not None}


def normalize(cluster_uid, namespace, objects, failures=None, observed_at=None, scan_id=None):
    """Input is actual API objects. Failed resource reads remain explicit, never successful emptiness."""
    if not cluster_uid or namespace!=lab.APP:raise ValueError('Only the explicitly owned lab namespace is accepted.')
    problems=list(failures or []);assets={};edges={};by_name={}
    def ident(kind,uid):return {'provider':'kubernetes','scope':cluster_uid,'kind':kind,'nativeId':uid}
    def add(kind,uid,name,health='unknown',properties=None):
        if not uid or not name:raise ValueError('Every observed object requires its native UID and name.')
        row={**ident(kind,uid),'name':name,'health':health,'properties':properties or {}}
        assets[(kind,uid)]=row;return row
    def edge(a,b,kind,evidence,properties=None):
        # This is a collection-local set, not event suppression or a processing lock.
        key=(a['kind'],a['nativeId'],kind,b['kind'],b['nativeId'])
        edges[key]={'from':ident(a['kind'],a['nativeId']),'to':ident(b['kind'],b['nativeId']),'type':kind,'evidence':evidence,'properties':properties or {}}
    cluster=add('cluster',cluster_uid,lab.CLUSTER)
    for obj in objects:
        kind=obj.get('kind');meta=obj.get('metadata') or {};ns=meta.get('namespace')
        if kind not in KINDS:continue
        if ns and ns!=namespace:raise ValueError('Cross-namespace object refused.')
        if kind=='Namespace' and meta.get('name')!=namespace:raise ValueError('Unexpected namespace object.')
        condition=next((c for c in (obj.get('status') or {}).get('conditions',[]) if c.get('type')=='Ready'),{})
        health={'True':'healthy','False':'degraded'}.get(condition.get('status'),'unknown') if kind in ('Node','Pod') else 'unknown'
        props={'kubernetesKind':kind,'namespace':ns,'resourceVersion':meta.get('resourceVersion'),'terminating':bool(meta.get('deletionTimestamp'))}
        if kind=='Pod':
            state=obj.get('status') or {};props.update({'phase':state.get('phase'),'readyStatus':condition.get('status'),'reason':condition.get('reason') or state.get('reason'),'nodeName':(obj.get('spec') or {}).get('nodeName')})
        if kind=='Node':props.update(node_facts(obj))
        row=add(KINDS[kind],meta.get('uid'),meta.get('name'),health,props);by_name[(kind,ns,meta['name'])]=row
    namespace_row=by_name.get(('Namespace',None,namespace))
    if not namespace_row:problems.append({'kind':'namespace','reason':'Namespace UID was not observed.'})
    for obj in objects:
        kind=obj.get('kind');meta=obj.get('metadata') or {};ns=meta.get('namespace');name=meta.get('name');row=by_name.get((kind,ns,name))
        if row:
            if namespace_row and ns:edge(row,namespace_row,'IN_NAMESPACE','metadata.namespace and observed namespace UID')
            if kind in ('Namespace','Node'):edge(row,cluster,'IN_CLUSTER','guarded cluster incarnation')
            for owner in meta.get('ownerReferences',[]):
                owner_kind=KINDS.get(owner.get('kind'));owner_uid=owner.get('uid')
                if owner_kind and owner_uid:edge(row,ident(owner_kind,owner_uid),'OWNED_BY','metadata.ownerReferences.uid')
            if kind=='Pod':
                node_name=(obj.get('spec') or {}).get('nodeName');node=by_name.get(('Node',None,node_name))
                if node:edge(row,node,'RUNS_ON','spec.nodeName resolved to the observed node UID')
                elif node_name:problems.append({'kind':'node-reference','reason':'A pod placement could not be resolved to an observed node UID.'})
                statuses=(obj.get('status') or {}).get('containerStatuses',[])+(obj.get('status') or {}).get('initContainerStatuses',[])+(obj.get('status') or {}).get('ephemeralContainerStatuses',[])
                for container in statuses:
                    native=container.get('containerID')
                    if not native:continue  # No runtime instance exists yet; do not fabricate one from its name.
                    state=container.get('state') or {};waiting=state.get('waiting') or {};terminated=state.get('terminated') or (container.get('lastState') or {}).get('terminated') or {}
                    facts={'podUid':meta['uid'],'namespace':ns,'image':container.get('image'),'restarts':container.get('restartCount'),'readyStatus':container.get('ready'),'phase':next((k for k in ['waiting','running','terminated'] if k in state),None),'waitingReason':waiting.get('reason'),'lastTerminationReason':terminated.get('reason'),'exitCode':terminated.get('exitCode')}
                    c=add('container',native,container['name'],{True:'healthy',False:'degraded'}.get(container.get('ready'),'unknown'),facts)
                    edge(c,row,'RUNS_ON','status.containerStatuses.containerID and pod metadata.uid')
            if kind=='Service':
                selector=(obj.get('spec') or {}).get('selector') or {}
                if selector:
                    for pod in objects:
                        pm=pod.get('metadata') or {};labels=pm.get('labels') or {}
                        if pod.get('kind')=='Pod' and pm.get('namespace')==ns and all(labels.get(k)==v for k,v in selector.items()):
                            target=by_name.get(('Pod',ns,pm.get('name')))
                            if target:edge(row,target,'SELECTS','service.spec.selector matches pod labels; membership is not a connectivity probe')
            if kind=='Ingress':
                spec=obj.get('spec') or {};backends=[spec.get('defaultBackend')]+[p.get('backend') for r in spec.get('rules',[]) for p in (r.get('http') or {}).get('paths',[])]
                for backend in backends:
                    service=(backend or {}).get('service') or {};target=by_name.get(('Service',ns,service.get('name')))
                    if target:edge(row,target,'ROUTES_TO','Ingress service backend resolved within its namespace')
        if kind=='EndpointSlice':
            if ns!=namespace:raise ValueError('Cross-namespace EndpointSlice refused.')
            service_name=(meta.get('labels') or {}).get('kubernetes.io/service-name');service=by_name.get(('Service',ns,service_name))
            if not service:
                problems.append({'kind':'endpoint-service','reason':'EndpointSlice service could not be resolved to an observed UID.'});continue
            for endpoint in obj.get('endpoints',[]):
                target=endpoint.get('targetRef') or {};uid=target.get('uid')
                if target.get('namespace',ns)!=ns:problems.append({'kind':'endpoint-reference','reason':'Cross-namespace endpoint target was not admitted.'});continue
                if target.get('kind')=='Pod' and uid:
                    edge(service,ident('pod',uid),'ROUTES_TO','EndpointSlice targetRef.uid',{'ready':(endpoint.get('conditions') or {}).get('ready'),'serving':(endpoint.get('conditions') or {}).get('serving')})
                else:problems.append({'kind':'endpoint-target','reason':'Endpoint has no supported native Pod UID; external endpoint discovery is pending.'})
    return {'scanId':scan_id or uuid.uuid4().hex,'collectionId':cluster_uid+'/'+namespace,'observedAt':observed_at or datetime.now(timezone.utc).isoformat(),'complete':not problems,'failures':problems,'assets':list(assets.values()),'relationships':list(edges.values())}


def capture():
    receipt=lab.guard();objects=[];failures=[]
    for resource,args in [('namespace',['get','namespace',lab.APP]),('nodes',['get','nodes'])]+[(r,['get',r,'-n',lab.APP]) for r in RESOURCES]:
        try:
            data=json.loads(lab.kubectl(*args,'-o','json'))
            if data.get('kind','').endswith('List'):
                if data.get('metadata',{}).get('continue'):raise ValueError('Unconsumed collection page.')
                objects.extend(data['items'])
            else:objects.append(data)
        except Exception:
            failures.append({'kind':resource,'reason':'The scoped Kubernetes read failed or returned an incomplete page.'})
    return normalize(receipt['kubeSystemUid'],lab.APP,objects,failures)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    scan=capture();raw=json.dumps(scan,indent=2)
    if len(json.dumps(scan).encode())>65536:raise ValueError('The namespace scan exceeds the admitted 64 KiB bound.')
    if args.output.is_symlink():raise ValueError('Refusing a linked output file.')
    args.output.write_text(raw+'\n');print('Observed',len(scan['assets']),'assets and',len(scan['relationships']),'relationships; complete:',scan['complete'])
