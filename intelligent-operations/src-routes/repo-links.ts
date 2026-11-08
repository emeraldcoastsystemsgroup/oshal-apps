/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Link each recorded Kubernetes cluster to its GitOps repository (GitHub owner/repo, base branch, folder, optional workflow): one link per cluster per person, at most 64, validated like a promotion target; promotion panels preselect the link for the plan's cluster.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Parse and validate HTTPS GitHub repository URLs (RP-OPS-03), rejecting credentials, ports, query/fragment components, IP literals and internal hosts before saving a cluster link.
 */
// @ts-nocheck
import {hash} from './intake';
import {processingTransaction} from './pipeline';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');};
const safe=(v,re,max)=>typeof v==='string'&&v.length<=max&&re.test(v);

/** @description Parse and validate a pasted HTTPS GitHub repository URL without credentials, ports, query or internal hosts. */
export function parseRepoUrl(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.trim().length>512||/[\x00-\x20\x7f]/.test(raw.trim()))fail(400,'Enter an https://github.com/owner/repo URL.');
 let url;try{url=new URL(raw.trim());}catch{fail(400,'Enter a valid https://github.com/owner/repo URL.');}
 if(url.protocol!=='https:')fail(400,'Use an https:// repository URL.');
 if(url.username||url.password||url.port||url.search||url.hash)fail(400,'Repository URL must not contain credentials, ports, query strings or fragments.');
 const host=url.hostname.toLowerCase();
 if(host.startsWith('[')||/^\d+(\.\d+){3}$/.test(host)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))fail(400,'Repository URL must name github.com, never a literal IP or local address.');
 if(host!=='github.com')fail(400,'Cluster links support https://github.com/<owner>/<repo> repositories.');
 const parts=url.pathname.replace(/\/+$/,'').split('/').filter(Boolean);
 if(parts.length!==2)fail(400,'Repository URL path must be /<owner>/<repo>.');
 const owner=parts[0],repo=parts[1].replace(/\.git$/i,'');
 if(!safe(owner,/^[A-Za-z0-9-]{1,39}$/,39)||!safe(repo,/^[A-Za-z0-9._-]{1,100}$/,100)||repo.startsWith('.'))fail(400,'Use valid GitHub owner and repository names.');
 return {provider:'github',owner,repo,full_name:owner+'/'+repo,url:'https://github.com/'+owner+'/'+repo};
}

/** @description Validate one link: the cluster it belongs to and where its manifests live. */
export function repoLink(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['clusterScope','clusterName','owner','repo','repoUrl','baseBranch','folder','workflow'].includes(k)))fail(400,'Supply only the link fields.');
 const parsed=input.repoUrl!==undefined&&input.repoUrl!==null&&input.repoUrl!==''?parseRepoUrl(input.repoUrl):null;
 const owner=input.owner!==undefined?input.owner:parsed?.owner,repo=input.repo!==undefined?input.repo:parsed?.repo;
 if(parsed&&(owner!==parsed.owner||repo!==parsed.repo))fail(400,'Repository URL does not match owner and repository.');
 if(!safe(input.clusterScope,/^[^\x00-\x1f\x7f]{1,512}$/,512)||input.clusterScope.trim()!==input.clusterScope)fail(400,'Choose a recorded cluster.');
 if(!safe(input.clusterName,/^[^\x00-\x1f\x7f]{1,256}$/,256))fail(400,'Name the cluster.');
 if(!safe(owner,/^[A-Za-z0-9-]{1,39}$/,39)||!safe(repo,/^[A-Za-z0-9._-]{1,100}$/,100)||repo.startsWith('.'))fail(400,'Use the GitHub owner and repository names.');
 if(!safe(input.baseBranch,/^[A-Za-z0-9._-]{1,100}$/,100))fail(400,'Use a base branch name without slashes.');
 if(!safe(input.folder,/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,5}$/,200)||input.folder.split('/').some(p=>p==='.'||p==='..'))fail(400,'Use a relative folder inside the repository.');
 if(input.workflow!=null&&input.workflow!==''&&!safe(input.workflow,/^[A-Za-z0-9._-]{1,100}\.ya?ml$/,100))fail(400,'A workflow is a .yml file name in .github/workflows.');
 return {clusterScope:input.clusterScope,clusterName:input.clusterName,provider:'github',owner,repo,baseBranch:input.baseBranch,folder:input.folder,workflow:input.workflow||null};
}
/** @description Keep or replace the person's link for one cluster. */
export async function saveRepoLink(pool,owner,input){
 requireOwner(owner);const link=repoLink(input),id=hash(['repo-link-v1',link.clusterScope]);
 return processingTransaction(pool,async c=>{
  const previous=(await c.query('SELECT record FROM operations_repo_links WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0]?.record;
  const record={...link,id,updatedAt:new Date().toISOString()};
  if(previous){await c.query('UPDATE operations_repo_links SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,id,JSON.stringify(record)]);return {...record,replaced:true};}
  const count=(await c.query('SELECT count(*)::int AS n FROM operations_repo_links WHERE user_sub=$1',[owner])).rows[0].n;if(count>=64)fail(409,'Link at most 64 clusters.');
  await c.query('INSERT INTO operations_repo_links(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[owner,id,record.updatedAt,JSON.stringify(record)]);return {...record,replaced:false};
 });
}
/** @description Remove the person's link for one cluster. */
export async function removeRepoLink(pool,owner,input){
 requireOwner(owner);if(!input||typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id))fail(400,'Choose a link.');
 const r=await pool.query('DELETE FROM operations_repo_links WHERE user_sub=$1 AND id=$2',[owner,input.id]);if(!r.rowCount)fail(404,'The owned link is unavailable.');return {removed:input.id};
}
/** @description The person's links, newest first. */
export async function repoLinks(pool,owner){
 requireOwner(owner);return {items:(await pool.query('SELECT record FROM operations_repo_links WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 64',[owner])).rows.map(r=>r.record),limit:64};
}
