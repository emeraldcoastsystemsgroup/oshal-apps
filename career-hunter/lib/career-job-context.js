/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read only exact original-owner employer context bound to the current posting, so document and interview views retain details fetched against a read-only shared corpus.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Honor expiry, complete listing bindings and authoritative replacements with the same Unicode/source-size checks as the Python hydrator.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A saved copy no longer expires after a day, as in the Python hydrator: the job page had fallen back to the short listing text 24 hours after the details were read.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {resolveContainedRegularFile}=require('../routes/career-resume-preview');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
// Python str.strip() whitespace, including NEL and U+001C..U+001F but excluding BOM.
const hasText=value=>typeof value==='string'&&/[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(value);
const number=value=>value===null||value===undefined||typeof value==='boolean'||typeof value==='object'||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value)||0;
function snapshot(row){
  const out={postingId:row.id,companyId:row.company_id};
  for(const [key,field] of Object.entries({atsJobId:'ats_job_id',title:'title',url:'url',location:'location',department:'department',jobType:'job_type',postedAt:'posted_at',postedDate:'posted_date',state:'state',city:'city'}))out[key]=String(row[field]||'');
  Object.assign(out,{remote:!!row.remote,lat:number(row.lat),lon:number(row.lon),listingSha256:hash(String(row.description||''))});
  for(const field of ['salary_min','salary_max','salary_currency','salary_period','salary_raw']){
    const value=row.salary_source==='ai_estimated'?null:row[field];
    out[field]=['salary_min','salary_max'].includes(field)?number(value):String(value||'');
  }
  return out;
}
function applyJobContext(dir,row){
  if(!Number.isSafeInteger(row?.id)||row.id<1||row.id>999999999999999)return row;
  const name=path.join(dir,'job-context',row.id+'.json');
  // lstat also detects broken symlinks, which existsSync alone treats as absent.
  try{fs.lstatSync(name);}catch(error){if(error.code==='ENOENT')return row;throw error;}
  const file=resolveContainedRegularFile(name,dir);
  if(!file)throw Error('job_context_unavailable');
  const stat=fs.lstatSync(file);if(stat.nlink!==1||stat.size>384*1024)throw Error('job_context_unavailable');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value?.version!==2)return row;
  const chars=typeof value.description==='string'?Array.from(value.description).length:0;
  if(!value.snapshot||typeof value.snapshot!=='object'||Array.isArray(value.snapshot)
    ||!hasText(value.description)||chars>64000
    ||value.description!==Buffer.from(value.description,'utf8').toString('utf8')
    ||value.descriptionSha256!==hash(value.description)||value.basis!=='employer-detail'
    ||value.truncated!==false||!Number.isInteger(value.sourceChars)||value.sourceChars!==chars
    ||!Number.isInteger(value.sourceBytes)||value.sourceBytes!==Buffer.byteLength(value.description,'utf8'))throw Error('job_context_unavailable');
  const expected=snapshot(row),context=row.description_context;
  if(context?.descriptionSha256===value.descriptionSha256&&value.descriptionSha256===expected.listingSha256
    &&context?.listingSha256===value.snapshot?.listingSha256)expected.listingSha256=context.listingSha256;
  if(!isDeepStrictEqual(value.snapshot,expected))return row;
  const stamp=value.retrievedAt,age=Date.now()-Date.parse(stamp);
  if(typeof stamp!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(stamp)||!Number.isFinite(age)
    ||stamp.slice(0,19)!==new Date(stamp).toISOString().slice(0,19)||age<0)return row;
  return {...row,description:value.description,description_context:{basis:value.basis,retrievedAt:stamp,descriptionSha256:value.descriptionSha256,
    sourceChars:value.sourceChars,sourceBytes:value.sourceBytes,truncated:false,listingSha256:value.snapshot.listingSha256}};
}
module.exports={applyJobContext};
