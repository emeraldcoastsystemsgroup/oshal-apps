/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Resolve the registered member-qualified Career screen in an application group before sending stage or queue navigation.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Explain the submitted-packet regeneration refusal separately from an unsuccessful draft generation.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Queue promotion without automatically generating documents; expose explicit generation as the next step.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Distinguish unavailable scoring configuration from a model change during the request.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Explain employer-detail verification, supported size and storage refusals when preparation stops.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Explain when employer details are unavailable before document preparation.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share explicit owner-only save, star, score and document-queue actions between open search and the job board; never submit an application from these preparation actions.
 */
(function(root){
  'use strict';
  async function post(url,body){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok||result.ok===false) throw new Error(result.error||('HTTP '+response.status));
    return result;
  }
  function requestId(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);}
  async function favorite(id,value){return post('/api/career-hunter/jobs/'+id+'/status',{favorite:value});}
  async function prepare(id,documents,options){return post('/api/career-hunter/jobs/'+id+'/generate',
    {documents,requestId:requestId(),...(options||{})});}
  async function save(id){
    await favorite(id,true);
    try{return {...await prepare(id,false),saved:true};}
    catch(error){return {saved:true,error:error.message};}
  }
  async function promote(id,options){
    return post('/api/career-hunter/jobs/'+id+'/status',{status:'promoted',favorite:true});
  }
  function navigate(tool,href){
    if(root.parent===root){root.location.href=href;return;}
    let target=tool;
    try{
      // Groups qualify borrowed surfaces; a standalone Career workspace keeps
      // the short name. Use the admitted rail instead of guessing its front door.
      const member='career-hunter--'+tool;
      if([...root.parent.document.querySelectorAll('[data-view]')].some(node=>node.getAttribute('data-view')==='tool-'+member))target=member;
    }catch(_){/* A different-origin host can still support the short-name contract. */}
    const query=new URL(href,root.location.href).searchParams;query.delete('v');
    root.parent.postMessage({type:'app-navigate',tool:target,...(query.size?{query:query.toString()}:{})},root.location.origin);
  }
  function poll(id,idempotency,update){
    let attempts=0,stopped=false,timer;
    const tick=async()=>{
      if(stopped)return;
      try{
        const response=await fetch('/api/career-hunter/jobs/'+id);
        if(!response.ok)throw new Error('HTTP '+response.status);
        const {job}=await response.json();
        if(job?.board?.requestId===idempotency&&job.board.completedAt){stopped=true;update(job);return;}
      }catch(_){/* A read hiccup cannot turn queued work into a completed job. */}
      if(++attempts>=120){stopped=true;update(null);return;}
      timer=setTimeout(tick,3000);
    };
    timer=setTimeout(tick,1000);
    return ()=>{stopped=true;clearTimeout(timer);};
  }
  async function monitor(check){
    const response=await fetch('/api/v1/agent/schedules');
    if(!response.ok)throw Error('Could not read your monitoring schedule (HTTP '+response.status+').');
    const data=await response.json(),schedule=(data.schedules||[]).find(s=>s.app==='career-hunter'&&s.name==='career-application-updates');
    if(!schedule?.id)throw Error(schedule?.reason||'Application email schedule unavailable.');
    let active=schedule.status==='active';
    if(!active||check){await post('/api/v1/agent/schedules/'+schedule.id+'/activate',{class:'person',configuration:{runBudgetMicros:1000000,dailyBudgetMicros:10000000,timeoutMs:60000}});active=true;}
    if(check)await post('/api/v1/agent/schedules/'+schedule.id+'/trigger',{});
    const read=await fetch('/api/career-hunter/jobs/updates');
    if(!read.ok)throw Error('Could not read application email status (HTTP '+read.status+').');
    const mail=await read.json();
    return {active,mail};
  }
  function message(reason){
    if(reason==='already_submitted')return 'This job is recorded as submitted. Its submission documents are read-only.';
    if(reason==='preparation_failed')return 'Document generation failed. Use Regenerate to try again.';
    if(['experience_selection_invalid','experience_selection_changed','experience_unavailable'].includes(reason))return 'Additional experience changed or could not be loaded. Reopen preparation and select its current entries.';
    if(reason==='model_identity_unavailable')return 'The scoring configuration could not be verified. Retry when the Career service is available.';
    if(reason==='model_identity_mismatch')return 'The scoring model changed during this request. Please retry to use the current configuration.';
    return ({profile_too_large_for_scoring:'The saved career profile is too large for one scoring request. Preparation stopped without changing your profile.',job_details_unavailable:'Employer details could not be loaded. Open the posting and retry when it is available.',job_context_too_large:'The employer description is too large to prepare in one request. Open the original posting to review it.',job_context_unavailable:'Saved employer details could not be verified. Open the original posting and retry.',job_context_limit_reached:'Saved job detail storage is full. Older details expire automatically; please try again later.',resume_required:'Upload your resume to prepare this application.',posting_not_found:'This posting is no longer available.',score_unavailable:'Scoring is unavailable. Please retry.',already_submitted:'This application is already submitted.',renderer_unavailable:'The PDF renderer is unavailable. Please check Career Settings.'})[reason]||'Could not prepare the documents. Please retry.';}
  function openApplication(id,tracked=false,step){const query=new URLSearchParams({view:tracked?'status':'queue',application:String(id)});if(step)query.set('step',step);navigate(tracked?'career-application-status':'career-submissions','/api/career-hunter/board-native?'+query);}
  root.CareerJobActions={favorite,prepare,save,promote,navigate,openApplication,poll,monitor,message};
})(typeof window==='undefined'?globalThis:window);
