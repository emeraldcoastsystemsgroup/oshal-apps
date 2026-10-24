/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Azure virtual machines, networks and subnets join the Azure scan and save through real SQL. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Cloud clusters (ADR0054): EKS, GKE and AKS answers map to clusters, node pools and regions with sizing and explicit health; the scans save through real SQL and read back in the graph; the shipped Systems panel reads all three clouds through the person's own connections (reads only, a fresh confirmation each) and saves one scan per provider. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs');
const C=require('../experience/cloud-inventory.js'),{saveScan,readGraph}=require('../routes/topology-store.js');

const EKS_CLUSTER={cluster:{name:'prod-east',arn:'arn:aws:eks:us-east-1:123456789012:cluster/prod-east',version:'1.31',status:'ACTIVE',resourcesVpcConfig:{vpcId:'vpc-0abc'}}};
const EKS_GROUPS=[{nodegroup:{nodegroupName:'general',status:'ACTIVE',instanceTypes:['m6i.xlarge'],scalingConfig:{minSize:3,maxSize:12,desiredSize:6},capacityType:'ON_DEMAND',health:{issues:[]}}},{nodegroup:{nodegroupName:'spot',status:'DEGRADED',instanceTypes:['m6i.large','m5.large'],scalingConfig:{minSize:0,maxSize:20,desiredSize:4},capacityType:'SPOT',health:{issues:[{code:'AsgInstanceLaunchFailures'}]}}}];
const GKE={clusters:[{name:'analytics',location:'us-central1',selfLink:'https://container.googleapis.com/v1/projects/acme-data/locations/us-central1/clusters/analytics',currentMasterVersion:'1.30.5-gke.1',status:'RUNNING',currentNodeCount:14,network:'default',nodePools:[{name:'default-pool',status:'RUNNING',initialNodeCount:4,config:{machineType:'e2-standard-8'},autoscaling:{enabled:true,minNodeCount:2,maxNodeCount:10}}]}]};
const AKS={value:[{id:'/subscriptions/0000-1111/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/payments',name:'payments',location:'westeurope',properties:{kubernetesVersion:'1.30.3',provisioningState:'Succeeded',powerState:{code:'Running'},agentPoolProfiles:[{name:'system',count:3,vmSize:'Standard_D4s_v5',mode:'System',provisioningState:'Succeeded',powerState:{code:'Running'}},{name:'user',count:5,vmSize:'Standard_D8s_v5',mode:'User',enableAutoScaling:true,minCount:2,maxCount:9,provisioningState:'Succeeded',powerState:{code:'Running'}}]}}]};

const VMS={value:[{id:'/subscriptions/0000-1111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/jump-1',name:'jump-1',location:'westeurope',properties:{hardwareProfile:{vmSize:'Standard_B2s'},storageProfile:{osDisk:{osType:'Linux'}},provisioningState:'Succeeded'}}]};
const VNETS={value:[{id:'/subscriptions/0000-1111/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/core',name:'core',location:'westeurope',properties:{addressSpace:{addressPrefixes:['10.20.0.0/16']},subnets:[{id:'/subscriptions/0000-1111/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/core/subnets/aks',name:'aks',properties:{addressPrefix:'10.20.1.0/24'}}]}}]};
test('Azure virtual machines and networks with subnets join the Azure scan with explicit unknown health',()=>{
 const vms=C.fromAzureVms(VMS.value),nets=C.fromAzureVnets(VNETS.value),s=C.scan('azure','0000-1111',[C.fromAks(AKS.value[0])],'2026-10-23T03:00:00.000Z',[],{vms,networks:nets});
 assert.deepEqual(s.assets.filter(a=>['virtual-machine','network','subnet'].includes(a.kind)).map(a=>[a.kind,a.name,a.health]),[['virtual-machine','jump-1','unknown'],['network','core','unknown'],['subnet','core / aks','unknown']]);
 assert.equal(s.assets.filter(a=>a.kind==='region').length,1,'one region asset for the shared location');assert.ok(s.relationships.some(r=>r.type==='IN_VPC'&&r.to.kind==='network'));assert.equal(s.assets.find(a=>a.kind==='virtual-machine').properties.size,'Standard_B2s');
});
test('EKS, GKE and AKS answers map to clusters, node pools and regions that save and read back through real SQL',async()=>{
 const eks=C.fromEks(EKS_CLUSTER,EKS_GROUPS,'us-east-1'),gke=C.fromGke(GKE.clusters[0]),aks=C.fromAks(AKS.value[0]);
 assert.deepEqual([eks.nodes,gke.nodes,aks.nodes],[10,14,8]);assert.equal(eks.pools[1].machine,'m6i.large,m5.large');assert.equal(eks.pools[1].issues,1);assert.equal(gke.pools[0].max,10);assert.equal(aks.status,'RUNNING');assert.equal(aks.pools[1].min,2);
 assert.deepEqual(['ACTIVE','RUNNING','Succeeded','DEGRADED','FAILED','CREATING',null].map(C.health),['healthy','healthy','healthy','degraded','degraded','unknown','unknown']);
 assert.equal(C.endpointRegion('https://eks.eu-west-2.amazonaws.com'),'eu-west-2');assert.equal(C.endpointRegion('https://evil.example/eks.us-east-1.amazonaws.com'),null);
 const at='2026-10-23T03:00:00.000Z',scans=[C.scan('aws','primary/us-east-1',[eks],at),C.scan('gcp','acme-data',[gke],at),C.scan('azure','0000-1111',[aks],at)];
 const s=scans[0];assert.deepEqual(s.assets.map(a=>a.kind),['cluster','region','node-pool','node-pool']);assert.equal(s.assets.find(a=>a.name==='prod-east / spot').health,'degraded');assert.deepEqual(s.relationships.map(r=>r.type).sort(),['IN_CLUSTER','IN_CLUSTER','IN_REGION']);assert.equal(s.collectionId,'cloud:aws/primary/us-east-1');
 const f=await fixture();try{const pool=f.caller('alice'),source=loadExperience().sourceDefinition({name:'clouds',environment:'prod',source:'https://console.example/clouds'});
  for(const scan of scans)await saveScan(pool,'alice',source,scan);
  const graph=await readGraph(pool,'alice',new Date().toISOString());const clusters=graph.assets.filter(a=>a.kind==='cluster');
  assert.deepEqual(clusters.map(c=>[c.provider,c.name,c.properties.nodeCount]).sort(),[['aws','prod-east',10],['azure','payments',8],['gcp','analytics',14]]);
  assert.equal(graph.assets.filter(a=>a.kind==='node-pool').length,5);assert.equal(graph.relationships.filter(r=>r.type==='IN_CLUSTER').length,5);
  assert.equal((await readGraph(f.caller('bob'),'bob',new Date().toISOString())).assets.length,0,'owner-scoped');
 }finally{await f.close();}
});

test('the shipped Systems panel reads all three clouds through the person\'s own connections and saves one scan per provider',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),source=loadExperience().sourceDefinition({name:'clouds',environment:'prod',source:'https://console.example/clouds'}),app=express(),proofs=new Set(),reads=[];app.use(express.json({limit:'1mb'}));
  app.get('/connectors',(_q,r)=>r.json({connections:[{connector:'amazonaws-com-eks',account:'ops',shared:false,status:'connected'},{connector:'gcp',account:'me',shared:false,status:'connected'},{connector:'azure',account:'me',shared:false,status:'expiring'}],httpServices:[{connector:'amazonaws-com-eks',configured:true,baseUrl:'https://eks.us-east-1.amazonaws.com'},{connector:'gcp',configured:true},{connector:'azure',configured:true}]}));
  app.post('/confirmations',(_q,r)=>{const id=randomUUID();proofs.add(id);r.json({confirmation:id});});
  app.post('/connectors/:connector/actions/:op',(q,r)=>{assert.ok(proofs.delete(q.headers['x-oshal-confirm']),'a fresh confirmation per read');reads.push(q.params.op);const ok=data=>r.json({status:200,data,transport:'native_connector_http',operation:q.params.op});
   switch(q.params.op){case 'amazonaws-com-eks-list-clusters':assert.equal(q.query.account,'ops');return ok({clusters:['prod-east']});case 'amazonaws-com-eks-describe-cluster':return ok(EKS_CLUSTER);case 'amazonaws-com-eks-list-nodegroups':return ok({nodegroups:['general','spot']});case 'amazonaws-com-eks-describe-nodegroup':return ok(EKS_GROUPS.find(g=>g.nodegroup.nodegroupName===q.body.nodegroupName));
    case 'gcp-list-clusters':assert.equal(q.body.project,'acme-data');return ok(GKE);case 'azure-list-subscriptions':return ok({value:[{subscriptionId:'0000-1111'}]});case 'azure-list-aks-clusters':assert.equal(q.body.subscriptionId,'0000-1111');return ok(AKS);case 'azure-list-vms':return ok(VMS);case 'azure-list-vnets':return ok(VNETS);default:return r.status(404).json({detail:'not a read'});}});
  app.use((q,_r,n)=>{q.oidc={user:{sub:'alice'}};n();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async name=>name==='sources'?[source]:[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#systems');await page.locator('#cloud-clusters summary').click();
  await page.waitForFunction(()=>document.getElementById('cloud-aws-account').value==='ops'&&document.getElementById('cloud-azure-account').value==='me');assert.match(await page.locator('#cloud-aws-note').innerText(),/Region us-east-1/);
  await page.locator('#cloud-gcp-project').fill('acme-data');await page.locator('#cloud-source').focus();await page.getByRole('button',{name:'Read my cloud clusters',exact:true}).click();
  await page.getByText('1 Azure virtual machine, 1 network (1 subnets) · 3 clusters · 32 nodes across 3 providers.',{exact:false}).waitFor();assert.match(await page.locator('#cloud-results').innerText(),/jump-1[\s\S]*0000-1111[\s\S]*westeurope[\s\S]*Standard_B2s[\s\S]*Linux/);const table=await page.locator('#cloud-results').innerText();
  assert.match(table,/Amazon EKS[\s\S]*prod-east[\s\S]*us-east-1[\s\S]*1\.31[\s\S]*ACTIVE[\s\S]*10[\s\S]*spot · m6i\.large,m5\.large × 4 \(0–20\)/);assert.match(table,/Google GKE[\s\S]*analytics[\s\S]*14/);assert.match(table,/Azure AKS[\s\S]*payments[\s\S]*westeurope[\s\S]*user · Standard_D8s_v5 × 5 \(2–9\)/);
  assert.ok(reads.every(op=>/-(list|describe)-/.test(op)),'reads only: '+reads.join(','));assert.ok(reads.includes('azure-list-vms')&&reads.includes('azure-list-vnets'));
  await page.getByRole('button',{name:'Save as inventory scans',exact:true}).click();await page.getByText('Saved 3 cloud inventory scans',{exact:false}).waitFor();
  const graph=await readGraph(pool,'alice',new Date().toISOString());assert.deepEqual(graph.assets.filter(a=>a.kind==='cluster').map(c=>c.name).sort(),['analytics','payments','prod-east']);assert.deepEqual(['virtual-machine','network','subnet'].map(k=>graph.assets.filter(a=>a.kind===k).length),[1,1,1]);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
