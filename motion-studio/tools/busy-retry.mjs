/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retry a request the server refused only because the person's project storage lock was held (503 motion_storage_busy / motion_transfer_busy, raised before anything is written). The server takes that lock without waiting and asks for a retry after retryAfterMs; the workbench never retried, so a manual edit made while the editor refreshed after a concierge change was lost with "Your project storage is busy. Retry shortly." (installed handoff run, 2026-10-29).
 */
const BUSY=new Set(['motion_storage_busy','motion_transfer_busy']);
/**
 * @description Fetch once, and again while the answer is a storage-busy refusal, waiting the server's retryAfterMs
 * (100 ms to 1 s, growing) for at most maxWaitMs in all. Any other answer, including other 503s, returns at once.
 * @param {Function} send Performs one request and resolves to a Response; called again for each retry.
 * @param {{maxWaitMs?:number,sleep?:Function}} options Total wait budget and a clock seam for tests.
 * @returns {Promise<{response:Response,text:string}>} The last answer and its body text.
 */
export async function fetchRetryingBusy(send,{maxWaitMs=8000,sleep=ms=>new Promise(done=>setTimeout(done,ms))}={}){
 let waited=0;
 for(let attempt=0;;attempt++){
  const response=await send(),text=await response.text();
  if(response.status!==503||waited>=maxWaitMs)return {response,text};
  let body;try{body=JSON.parse(text);}catch{return {response,text};}
  if(!BUSY.has(body?.error))return {response,text};
  const wait=Math.min(1000,Math.max(100,Number(body.retryAfterMs)||100)*(attempt+1),maxWaitMs-waited);
  await sleep(wait);waited+=wait;
 }
}
