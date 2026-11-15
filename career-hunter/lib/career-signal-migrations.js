/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Apply the owner-only pipeline index migration on writable opens; reads retain old-schema compatibility without DDL.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0: also apply 002, the index of jobs marked "details needed" that New matches lists (needs ai_fit_score and ai_model); each migration is applied when its own indexes are missing.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const MIGRATIONS=[
 {file:'001-career-pipeline-order.sql',indexes:['idx_user_queue_order','idx_user_tracked_order'],columns:['status','posting_id','promoted_at','generated_at','applied_at']},
 {file:'002-career-needs-details.sql',indexes:['idx_user_needs_details'],columns:['posting_id','ai_fit_score','ai_model']},
];
function migrate(db){
 const columns=new Set(db.prepare("PRAGMA table_info(user_signals)").all().map(row=>row.name));
 for(const migration of MIGRATIONS){
  if(!migration.columns.every(name=>columns.has(name)))continue;
  const have=new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name IN (${migration.indexes.map(()=>'?').join(',')})`).all(...migration.indexes).map(row=>row.name));
  if(have.size===migration.indexes.length)continue;
  db.exec(fs.readFileSync(path.join(__dirname,'../migrations/sqlite',migration.file),'utf8'));
 }
}
module.exports={migrate};
