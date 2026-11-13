/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Apply the owner-only pipeline index migration on writable opens; reads retain old-schema compatibility without DDL.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function migrate(db){
 const columns=new Set(db.prepare("PRAGMA table_info(user_signals)").all().map(row=>row.name));
 if(!['status','posting_id','promoted_at','generated_at','applied_at'].every(name=>columns.has(name)))return;
 const have=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_user_queue_order','idx_user_tracked_order')").all().map(row=>row.name));
 if(have.size===2)return;
 db.exec(fs.readFileSync(path.join(__dirname,'../migrations/sqlite/001-career-pipeline-order.sql'),'utf8'));
}
module.exports={migrate};
