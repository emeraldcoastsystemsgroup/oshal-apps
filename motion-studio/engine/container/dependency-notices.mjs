/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain resolved dependency source/license metadata and available license texts from the locked build, without retaining builder paths.
 */
import {readFileSync,readdirSync,existsSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
const [metadataPath,output]=process.argv.slice(2);if(!metadataPath||!output)throw new Error('metadata and output required');
const metadata=JSON.parse(readFileSync(metadataPath,'utf8'));mkdirSync(output,{recursive:true});
const index=[];
for(const pkg of metadata.packages){
  const root=dirname(pkg.manifest_path),texts=new Set();
  for(const parent of [root,resolve(root,'..'),resolve(root,'../..')]){
    for(const name of readdirSync(parent,{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name))if(/^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)([-_.].*)?$/i.test(name))texts.add(join(parent,name));
  }
  if(pkg.license_file){const declared=resolve(root,pkg.license_file);if(!existsSync(declared))throw new Error('missing declared license: '+pkg.name);texts.add(declared);}
  if(!pkg.license&&!texts.size)throw new Error('missing dependency license: '+pkg.name);
  const destination=join(output,pkg.name+'-'+pkg.version+'-'+index.length);mkdirSync(destination);
  let number=0;for(const file of texts)copyFileSync(file,join(destination,(number++)+'-'+basename(file)));
  index.push({name:pkg.name,version:pkg.version,source:pkg.source||pkg.metadata?.oshal?.upstream||'original-package',modified:pkg.metadata?.oshal?.modified===true,modifications:pkg.metadata?.oshal?.modifications||[],license:pkg.license,licenseTexts:number,directory:basename(destination)});
}
writeFileSync(join(output,'INDEX.json'),JSON.stringify({schemaVersion:1,packages:index},null,2)+'\n');
