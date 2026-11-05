/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | A completed run is not a passing validation; bind live eligibility to exact persisted account, model, source data and costed evidence. */
'use strict';
const {PortfolioError}=require('../trading-portfolio-model');
const {hash,assertAccount,normalizePolicy}=require('./policies');
function assertValidated(run,config,account,registration){
 const c=normalizePolicy(config);assertAccount(c,account,registration);
 const v=run.result?.validation;
 if(run.status!=='completed'||!v?.passed||v.version!==c.validationVersion||v.strategyFingerprint!==hash(c)||v.dataFingerprint!==hash(run.history?.series)||hash(run.strategy?.config)!==hash(c))throw new PortfolioError(409,'daily_backtest_not_passed','This exact daily strategy has not passed its account-bound historical and held-out validation. Failed or missing validation cannot authorize live trading.');
 if(run.accountId!==account.accountId||run.connectionKey!==account.connectionKey)throw new PortfolioError(409,'daily_study_account_mismatch','Daily strategy study belongs to another account.');
 return v;
}
function assertAtCapital(run,config,capitalCents){
 if(!Number.isSafeInteger(capitalCents)||capitalCents<10000)throw new PortfolioError(422,'daily_capital_invalid','Daily validation requires the exact approved capital.');
 const proof=require('./replay').validateReplay(config,{series:run.history.series,startDate:run.startDate,endDate:run.endDate,startingCapital:capitalCents/100});
 if(!proof.validation.passed)throw new PortfolioError(409,'daily_capital_backtest_not_passed','The daily strategy fails validation at this exact capital cap: '+proof.validation.reasons.join(' '));
 return {...proof.validation,capitalCents,metrics:proof.result.metrics,holdout:proof.result.holdout,costs:proof.result.costs};
}
module.exports={assertValidated,assertAtCapital};
