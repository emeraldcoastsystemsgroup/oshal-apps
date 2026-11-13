/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped owner status writer and read routes over isolated synthetic SQLite stores; all external kernel leaves are tripwires.
 */
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,loadCompiledModules} from './career-route-harness.mjs';
const require=createRequire(import.meta.url);
const Database=require('../../../scripts/toolchain/node_modules/better-sqlite3');
const root=mkdtempSync(join(tmpdir(),'career-prepare-writer-'));
const previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'}, {'better-sqlite3':Database});
const router=createRouter();let sequence=0;
modules.board.registerCareerBoardRoutes(router,{pool:{query:()=>{throw Error('No external SQL, kernel or submission ledger allowed.');}}});
const engine=readFileSync(new URL('../../engine/jobhunter/db.py',import.meta.url),'utf8');
export function writerFixture(status='new'){
 const sub='synthetic-prepare-'+(++sequence),paths=modules.store.userPaths(sub);
 mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
 const corpus=new Database(paths.corpusDb);
 corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1].replaceAll('corpus.',''));
 corpus.exec("INSERT OR IGNORE INTO companies(id,name) VALUES(1,'Example employer'); INSERT OR IGNORE INTO postings_corpus(id,company_id,ats_job_id,title,active) VALUES(1,1,'synthetic-1','Office manager',1)");corpus.close();
 const db=new Database(paths.userDb);db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);
 db.prepare('INSERT INTO user_signals(posting_id,status) VALUES(1,?)').run(status);db.close();
 return {sub,paths,call:(method,body,owner=sub)=>call(method,body,owner)};
}
function call(method,body,sub){
 const found=router.find(method,method==='POST'?'/jobs/1/status':'/jobs/1');
 return new Promise((resolve,reject)=>{
  const out={status:200};
  const res={status(code){out.status=code;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
  Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:{},headers:{}},res)).catch(reject);
 });
}
export function closeWriters(){
 if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;
 rmSync(root,{recursive:true,force:true});
}
