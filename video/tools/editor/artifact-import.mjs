/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read a protected owned MP4 handle with bounded streaming and verified source bytes before ordinary Video upload/probing.
 */
const MAX=100*1024*1024;
export async function readVideoArtifact(ref,fetcher=fetch){
 if(typeof ref!=='string'||!/^art_[A-Za-z0-9_-]{8,64}$/.test(ref))throw new Error('Choose one valid video artifact.');
 const path='/api/artifacts/handles/'+encodeURIComponent(ref),options={credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(20000)};
 const inspected=await fetcher(path,options);if(!inspected.ok)throw new Error('This video artifact is no longer available to you.');const metadata=await inspected.json();
 if(metadata.type!=='video/mp4'||!Number.isSafeInteger(metadata.size)||metadata.size<1||metadata.size>MAX||!/^[a-f0-9]{64}$/.test(metadata.sha256??''))throw new Error('Choose a verified MP4 artifact up to 100 MB.');
 const response=await fetcher(path+'/content',options);if(!response.ok||!response.body)throw new Error('This video artifact cannot be read.');
 const reader=response.body.getReader(),parts=[];let bytes=0;try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>metadata.size||bytes>MAX)throw new Error('This video artifact exceeds its verified size.');parts.push(value);}}finally{await reader.cancel();}
 if(bytes!==metadata.size)throw new Error('The video artifact is incomplete.');const data=new Uint8Array(bytes);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');if(sha256!==metadata.sha256)throw new Error('The video artifact changed. Choose it again.');
 const name=typeof metadata.name==='string'?metadata.name.replace(/[\u0000-\u001f\\/]/g,'').slice(0,120):'Imported clip.mp4';return{file:new File([data],name||'Imported clip.mp4',{type:'video/mp4'}),sha256,ref};
}
