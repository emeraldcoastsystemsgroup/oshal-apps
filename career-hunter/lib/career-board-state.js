/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Treat the relationship tombstone as authoritative over retained saved receipts in lists, counts and decorations.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep original-owner saved stars and preparation receipts independent of application status in the owner's published generation.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = 'job-board-state.json';
function readBoardState(dir) {
  const file = path.join(dir, FILE);
  let stat;
  try { stat = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return {version:1,jobs:{}}; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Saved job state is unavailable');
  const data = JSON.parse(fs.readFileSync(file,'utf8'));
  if (data?.version !== 1 || !data.jobs || Array.isArray(data.jobs) || typeof data.jobs !== 'object'
      || Object.keys(data.jobs).length > 2000 || Object.entries(data.jobs).some(([id,v]) => !/^[1-9]\d{0,14}$/.test(id) || !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('Saved job state is invalid');
  return data;
}
function updateBoardState(dir, id, patch) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid posting');
  const state=readBoardState(dir);
  if (!state.jobs[id] && Object.keys(state.jobs).length>=2000) throw new Error('Saved job limit reached');
  const old=state.jobs[id] || {};
  state.jobs[id]={...old,...patch};
  const file=path.join(dir,FILE), temp=file+'.'+crypto.randomUUID()+'.tmp';
  const bytes=JSON.stringify(state)+'\n';if(Buffer.byteLength(bytes)>2*1024*1024){const error=new Error('Saved job storage is full.');error.status=409;throw error;}
  try { fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'}); fs.renameSync(temp,file); }
  finally { try { fs.unlinkSync(temp); } catch(e) { if(e.code!=='ENOENT') throw e; } }
  return state.jobs[id];
}
function favoriteIds(state,db) {
 const ids=Object.entries(state.jobs).filter(([,v])=>v.favorite===true).map(([id])=>Number(id));
 if(!db||!ids.length)return ids;
 return db.prepare(`SELECT posting_id FROM user_signals WHERE posting_id IN (${ids.map(()=>'?').join(',')}) AND COALESCE(status,'new')<>'dismissed'`).all(...ids).map(row=>row.posting_id);
}
function decorateJob(state, job) { const saved=state.jobs[job.id] || {},active=job.status!=='dismissed'; return {...job,favorite:active&&saved.favorite===true,board:active?saved:{...saved,favorite:false}}; }
module.exports={readBoardState,updateBoardState,favoriteIds,decorateJob};
