/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Store reversible original-owner job exclusions and apply parameterized title, category, company and location feedback before pagination.
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILE='job-feedback.json',kinds=new Set(['job','title','keyword','company','location']);
function invalid(){return Object.assign(Error('Choose a reason and enter 2–120 characters.'),{status:400});}
function normalized(value){return typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';}
function read(dir){
  const file=path.join(dir,FILE);let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw Error('Job preferences are unavailable.');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.version!==1||!Array.isArray(data.rules)||data.rules.length>100||data.rules.some(r=>!kinds.has(r.kind)||typeof r.id!=='string'||!r.value||r.value.length>400))throw Error('Job preferences are invalid.');
  return data.rules;
}
function write(dir,rules){const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({version:1,rules})+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}return rules;}
function identity(job){return [job.company,job.title,job.location].map(normalized).join('\x1f');}
function update(dir,input,job){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','value','remove'].includes(k)))throw invalid();
  let rules=read(dir);
  if(input.remove!==undefined){if(typeof input.remove!=='string'||!rules.some(r=>r.id===input.remove))throw invalid();return write(dir,rules.filter(r=>r.id!==input.remove));}
  if(!kinds.has(input.kind))throw invalid();
  const display=input.kind==='job'?'This opening':input.kind==='company'?job.company:input.kind==='location'?job.location:input.value;
  const value=input.kind==='job'?identity(job):normalized(display);
  if(!value||value.length>(input.kind==='job'?400:120)||value.length<2)throw invalid();
  if(rules.some(r=>r.kind===input.kind&&r.value===value))return rules;
  if(rules.length>=100)throw Object.assign(Error('Remove an older preference before adding another.'),{status:400});
  rules.push({id:crypto.randomUUID(),kind:input.kind,value,label:String(display).trim(),postingId:job.id,createdAt:new Date().toISOString()});return write(dir,rules);
}
function predicate(rules){
  const clauses=[],args=[];
  for(const rule of rules||[]){
    if(rule.kind==='job'){clauses.push("(lower(trim(COALESCE(c.name,'')))||char(31)||lower(trim(COALESCE(p.title,'')))||char(31)||lower(trim(COALESCE(p.location,'')))) <> ?");args.push(rule.value);}
    else if(rule.kind==='company'){clauses.push("lower(trim(COALESCE(c.name,''))) <> ?");args.push(rule.value);}
    else if(rule.kind==='location'){clauses.push("instr(lower(COALESCE(p.location,'')),?)=0");args.push(rule.value);}
    else if(rule.kind==='title'){clauses.push("instr(lower(COALESCE(p.title,'')),?)=0");args.push(rule.value);}
    else if(rule.kind==='keyword'){clauses.push("instr(lower(COALESCE(p.title,'')||' '||COALESCE(c.industry,'')),?)=0");args.push(rule.value);}
  }
  return {sql:clauses.join(' AND '),args};
}
module.exports={read,update,predicate,identity,normalized};
