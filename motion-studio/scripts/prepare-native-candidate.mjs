/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prepare a complete private native package candidate with deterministic digests; never install, register, reload or deploy it.
 */
import {lstat,readdir,readFile,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
import {sourceIdentity,RUNTIME_FILES} from '../engine/package-identity.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=resolve(import.meta.dirname,'..');
const ignored=new Set(['target','node_modules','.git','__pycache__']);
async function inventory(root,prefix=''){
 const files=[];
 for(const entry of (await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=prefix?prefix+'/'+entry.name:entry.name,path=join(root,name),stat=await lstat(path);
  if(stat.isSymbolicLink())throw new Error('Candidate source contains a symlink: '+name);
  if(stat.isDirectory()){if(!ignored.has(entry.name))files.push(...await inventory(root,name));}
  else if(stat.isFile()){
   if(stat.nlink!==1)throw new Error('Candidate source contains a hard link: '+name);
   if(entry.name.startsWith('.env')||entry.name.endsWith('.log'))throw new Error('Candidate source contains local runtime data: '+name);
   files.push({path:name,bytes:await readFile(path),mode:stat.mode&0o111?0o755:0o644,sourceMode:stat.mode&0o777,executable:Boolean(stat.mode&0o111)});
  }else throw new Error('Candidate source is not a regular file: '+name);
 }
 return files;
}
function extractedBytes(name,bytes){
 if(!/\.(mjs|md|yaml)$/.test(name))return bytes;
 let text=bytes.toString('utf8');
 // These are source-layout references only. Production route/bot/authorization semantics stay identical.
 text=text.replaceAll('create/specs/functional-gaps/prototypes/motion-studio/','motion-studio/');
 if(name.startsWith('tests/')){text=text.replaceAll("'../../../../../..'","'../..'").replaceAll("'../../../../../../scripts/","'../../scripts/");if(name!=='tests/candidate-package.test.mjs')text=text.replaceAll("'package-definition.yaml'","'oshal-app.yaml'");}
 if(name==='package-definition.yaml')text=text.replace('Editable motion compositions with manual layers, keyframes, masks and owned raster sources; shared\n  original-person route tools. Source prototype pending full artifact/job integration and installed acceptance.','Editable motion compositions with layers, captions, keyframes, masks and owned photos.\n  Preview frames and export editable native JSON.');
 if(name==='scripts/prepare-native-candidate.mjs')return bytes; // The administrative helper remains the reviewed original source.
 return Buffer.from(text);
}
async function sourceGit(root){
 try{const commit=(await exec('git',['-C',root,'rev-parse','HEAD'])).stdout.trim(),status=(await exec('git',['-C',root,'status','--porcelain','--untracked-files=all','--','.'])).stdout;
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Invalid source commit');return{commit,clean:!status.trim(),changes:status.trim()?status.trimEnd().split('\n'):[]};
 }catch{return{commit:null,clean:false,changes:[],evidence:'Source is outside a Git checkout; file digests are authoritative.'};}
}
export async function prepareNativeCandidate(output,{sourceRoot=source}={}){
 output=resolve(output);sourceRoot=resolve(sourceRoot);
 if(output===sourceRoot||output.startsWith(sourceRoot+'/'))throw new Error('Candidate output must be outside its source.');
 const rootStat=await lstat(sourceRoot);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await realpath(sourceRoot)!==sourceRoot)throw new Error('Candidate source root must be a real directory.');
 const parent=dirname(output);if(await realpath(parent)!==parent)throw new Error('Candidate output parent must be a real directory.');
 const files=await inventory(sourceRoot),definitions=files.filter(f=>['package-definition.yaml','oshal-app.yaml'].includes(f.path));
 if(definitions.length!==1)throw new Error('Expected exactly one genuine source package manifest.');
 const git=await sourceGit(sourceRoot),identity=sourceIdentity(join(sourceRoot,'engine'));
 const expected=JSON.parse((await readFile(join(sourceRoot,'routes/engine-identity.json'),'utf8')));
 if(JSON.stringify(identity)!==JSON.stringify(expected))throw new Error('Engine source identity does not match the reviewed route binding.');
 // Exclusive output creation prevents overwriting any existing source, receipt or installation.
 await mkdir(output,{mode:0o700});const packageRoot=join(output,'motion-studio');
 try{
  await mkdir(packageRoot,{mode:0o755});const records=[];
  for(const file of files){const name=file.path==='package-definition.yaml'?'oshal-app.yaml':file.path,data=extractedBytes(file.path,file.bytes),path=join(packageRoot,name);await mkdir(dirname(path),{recursive:true,mode:0o755});await writeFile(path,data,{flag:'wx',mode:file.mode});records.push({path:name,bytes:data.length,sha256:hash(data),mode:file.mode,executable:file.executable});}
  records.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  // No engine byte is rewritten: the existing private worker/image remains the correct one for admission.
  for(const name of RUNTIME_FILES)if(hash(await readFile(join(packageRoot,'engine',name)))!==hash(await readFile(join(sourceRoot,'engine',name))))throw new Error('Extraction changed an engine source: '+name);
  const current=await inventory(sourceRoot);if(JSON.stringify(current.map(f=>[f.path,hash(f.bytes),f.sourceMode]))!==JSON.stringify(files.map(f=>[f.path,hash(f.bytes),f.sourceMode])))throw new Error('Candidate source changed during preparation.');
  const receipt={schemaVersion:1,sourceGit:git,package:'motion-studio',manifest:'oshal-app.yaml',engine:identity,sourceFiles:records,treeSha256:hash(JSON.stringify(records)),installed:false,
   prerequisites:['Node24 with node:sqlite','Managed pinned Sharp runtime','Package-private lasting directory','Matching private Motion engine relay and source identity','Native schema/auth/tool admission and original caller grants'],
   remaining:['Original-reader full-envelope stream/upload and public exports','Durable original-authority render jobs','Editable Video lineage','Admin source integration/registration/installation','Installed human/agent/source/grant/sandbox/host-drop acceptance','Whole-family upstream/Adobe fidelity']};
  await writeFile(join(output,'candidate-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return{packageRoot,receipt};
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3){process.stderr.write('Usage: node prepare-native-candidate.mjs <new-private-output-directory>\n');process.exitCode=2;}
 else{const result=await prepareNativeCandidate(process.argv[2]);process.stdout.write(JSON.stringify({packageRoot:result.packageRoot,treeSha256:result.receipt.treeSha256,engine:result.receipt.engine,installed:false})+'\n');}
}
