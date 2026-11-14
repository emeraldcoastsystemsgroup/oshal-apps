/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound the AWS anonymous proof exception to its exact host, path, fields, active check and public destination; prove Avature pagination normalization keeps existing filters.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {browserCheckPost,createReadPolicy}=require('../engine/jobhunter/browser_read_policy.cjs');
const {listingUrl}=require('../engine/jobhunter/browser_fetch.cjs');
const address='https://7d6e0277a337.6025a93a.eu-west-1.token.awswaf.com/7d6e0277a337/0de7f5976e41/14aa71687d42/mp_verify?region=eu-west-1';
const body=['solution_metadata','solution_data'].map(name=>'--fixture\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\nfixture\r\n').join('')+'--fixture--';
function request(patch={}){
  return {url:()=>address,method:()=>'POST',resourceType:()=>'fetch',isNavigationRequest:()=>false,
    headers:()=>({'content-type':'multipart/form-data; boundary=fixture'}),postData:()=>body,...patch};
}
async function admitted(req,settings={}){
  let allowed;
  await createReadPolicy({lookup:async()=>[{address:'8.8.8.8'}],...settings})({
    request:()=>req,abort:async()=>{allowed=false;},continue:async()=>{allowed=true;}});
  return allowed;
}
test('only an active anonymous browser check admits its exact AWS proof',async()=>{
  assert.equal(browserCheckPost(request(),new URL(address)),true);
  assert.equal(await admitted(request()),false);
  assert.equal(await admitted(request(),{browserCheck:()=>true}),true);
  assert.equal(await admitted(request(),{browserCheck:()=>true,lookup:async()=>[{address:'127.0.0.1'}]}),false);
});
test('forms, files, other hosts, paths, fields and oversized proofs remain refused',async()=>{
  const bad=[
    request({url:()=>address.replace('.com/','.com.evil/')}),
    request({url:()=>address.replace('/mp_verify','/applications')}),
    request({resourceType:()=>'document',isNavigationRequest:()=>true}),
    request({headers:()=>({'content-type':'application/json'})}),
    request({postData:()=>body.replace('solution_data','resume')}),
    request({postData:()=>body.replace('name="solution_data"','name="solution_data"; filename="resume.pdf"')}),
    request({postData:()=>body.repeat(10000)}),
  ];
  for(const req of bad)assert.equal(await admitted(req,{browserCheck:()=>true}),false);
});
test('Avature asks for one hundred results, keeping the employer filters and offset',()=>{
  const url=new URL(listingUrl('https://careers.fixture.example/en_US/careers/SearchJobs?9577=17276&jobOffset=25&jobRecordsPerPage=6'));
  assert.equal(url.pathname,'/en_US/careers/SearchJobs/');
  assert.equal(url.searchParams.get('9577'),'17276');
  assert.equal(url.searchParams.get('jobOffset'),'25');
  assert.equal(url.searchParams.get('jobRecordsPerPage'),'100');
  assert.equal(listingUrl('https://fixture.example/jobs?limit=6'),'https://fixture.example/jobs?limit=6');
});
