/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Retire only an unstarted owner approval, verifying native cancellation and the absence of any admitted work before permitting renewal. */
'use strict';const queue=require('./career-submission-queue'),native=require('./career-submission-native');
async function retire(dir,id,tickets,record){let saved=queue.read(dir).items[id];if(!saved)throw new queue.SubmissionError('submission_not_found','Submission not found.',404);
 if(saved.nativeTicketId){await native.sync(dir,id,tickets,record);saved=queue.read(dir).items[id];}
 if(saved.status!=='queued')throw new queue.SubmissionError('submission_outcome_review_required','Check the retained employer outcome before replacing this approval.');
 if(saved.nativeTicketId){const ticket=await tickets.getTicket(saved.nativeTicketId);if(!ticket)throw new queue.SubmissionError('submission_not_found','The original native ticket is unavailable.',404);
  if(!['cancelled','Cancelled'].includes(ticket.status))throw new queue.SubmissionError('native_cancel_required','Retire the original native ticket before renewing this approval.');
  const work=await tickets.getTicketWork(saved.nativeTicketId);if(!Array.isArray(work))throw new queue.SubmissionError('submission_unavailable','Native activity could not be verified.',503);
  if(work.length){queue.nativeUpdate(dir,id,{status:'unknown',reason:'Native work appeared before the approval was retired. Check the employer outcome; another submission is held.'});throw new queue.SubmissionError('submission_outcome_review_required','Native work exists. Check the employer outcome before another attempt.');}}
 return queue.publicItem(queue.cancel(dir,id));}
module.exports={retire};
