/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: GET /api/trading/paper/today, the one read behind the first screen. It answers, from the caller's saved records, whether each account is running or parked and in what, what it did today, and why its value moved, each with the time the record was made. It is handed the pool and a logger and nothing else, so it cannot reach a broker, a kernel order service or a price read; every statement is a SELECT.
 */
'use strict';
const {etParts}=require('../paper/market');
const {lastCompletedSession,nyseSessionClock}=require('../trading-portfolio-calendar');
const {connectedFacts}=require('./connected');
const {paperFacts}=require('./paper');

/** A JSON-lines logger for a caller that passes none (tests). */
const QUIET_LOG=Object.freeze({error(fields,message){process.stderr.write(JSON.stringify({level:'error',module:'trading-today',message,...(fields&&fields.err?{error:String(fields.err.message||fields.err)}:{})})+'\n');}});

/** @description The session facts of an instant, or nulls outside the verified 2024 to 2027 calendar. */
function sessionFacts(now){
 const year=now.getUTCFullYear();
 if(year<2024||year>2027)return {marketOpen:null,latestCompletedSession:null};
 return {marketOpen:nyseSessionClock(now).regular,latestCompletedSession:lastCompletedSession(now)||null};
}

/**
 * @description What the caller's saved records say about every account, for the first screen. Reads only: SELECT statements
 * on the caller's own rows, no broker call, no kernel order service, no price read and no write.
 * @param {{pool:object,log?:object}} ctx The package pool and, optionally, the route's logger. Nothing else is used.
 * @param {string} owner The admitted caller.
 * @param {Date} [now] The server clock.
 * @returns {Promise<object>} Connected and paper accounts with their state, plan, today's activity and value records.
 */
async function todayRead(ctx,owner,now=new Date()){
 const db={pool:ctx.pool,log:ctx.log||QUIET_LOG},session=sessionFacts(now);
 const connected=await connectedFacts(db,owner,now,session.latestCompletedSession);
 const paper=await paperFacts(db,owner,now,session.latestCompletedSession);
 return {ok:true,asOf:now.toISOString(),sessionDate:etParts(now).date,...session,connected:connected.accounts,paper:paper.accounts,archivedPaper:paper.archived,
  cut:{connected:connected.cut,paper:paper.cut},
  basis:{connected:'The last check each account\'s watcher saved. Not a new broker read.',paper:'Each simulated ledger. Prices only: interest and dividends are not added.'}};
}

module.exports={todayRead,sessionFacts};
