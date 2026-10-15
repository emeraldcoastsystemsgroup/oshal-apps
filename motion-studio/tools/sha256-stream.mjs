/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compute exact incremental SHA256 with fixed working buffers for complete browser archives.
 * Algorithm: NIST FIPS180-4 sections4.1.2,4.2.2,5.1.1,5.3.3,6.2.
 * https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
 */
const K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate=(n,s)=>(n>>>s)|(n<<(32-s));
export class Sha256 {
 #h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
 #w=new Uint32Array(64);#block=new Uint8Array(64);#used=0;#bytes=0;#result;
 #compress(bytes,offset=0){
  const w=this.#w,view=new DataView(bytes.buffer,bytes.byteOffset+offset,64);
  for(let t=0;t<16;t++)w[t]=view.getUint32(t*4,false);
  for(let t=16;t<64;t++){const x=w[t-15],y=w[t-2],s0=rotate(x,7)^rotate(x,18)^(x>>>3),s1=rotate(y,17)^rotate(y,19)^(y>>>10);w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;}
  let [a,b,c,d,e,f,g,h]=this.#h;
  for(let t=0;t<64;t++){const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(h+s1+choice+K[t]+w[t])>>>0,s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(s0+majority)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  const state=this.#h;state[0]=(state[0]+a)>>>0;state[1]=(state[1]+b)>>>0;state[2]=(state[2]+c)>>>0;state[3]=(state[3]+d)>>>0;state[4]=(state[4]+e)>>>0;state[5]=(state[5]+f)>>>0;state[6]=(state[6]+g)>>>0;state[7]=(state[7]+h)>>>0;
 }
 update(value){
  if(this.#result!==undefined)throw new Error('SHA256 is already finalized.');
  const bytes=value instanceof ArrayBuffer?new Uint8Array(value):value;
  if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(this.#bytes+bytes.byteLength))throw new TypeError('SHA256 requires bounded byte input.');
  this.#bytes+=bytes.byteLength;let offset=0;
  if(this.#used){const take=Math.min(bytes.length,64-this.#used);this.#block.set(bytes.subarray(0,take),this.#used);offset=take;this.#used+=take;if(this.#used===64){this.#compress(this.#block);this.#used=0;}}
  for(;offset+64<=bytes.length;offset+=64)this.#compress(bytes,offset);
  if(offset<bytes.length){this.#block.set(bytes.subarray(offset),this.#used);this.#used+=bytes.length-offset;}
  return this;
 }
 digest(){
  if(this.#result!==undefined)return this.#result;
  const block=this.#block;block[this.#used++]=0x80;
  if(this.#used>56){block.fill(0,this.#used);this.#compress(block);this.#used=0;}
  block.fill(0,this.#used,56);new DataView(block.buffer).setBigUint64(56,BigInt(this.#bytes)*8n,false);this.#compress(block);
  this.#result=Array.from(this.#h,n=>n.toString(16).padStart(8,'0')).join('');this.#block.fill(0);this.#w.fill(0);return this.#result;
 }
}
export function sha256Bytes(bytes){return new Sha256().update(bytes).digest();}
/** Blob slices keep working buffers bounded even when Blob.stream emits platform-dependent sizes. */
export async function sha256Blob(blob,{signal,chunkBytes=1048576,progress=()=>{}}={}){
 if(!blob||!Number.isSafeInteger(blob.size)||blob.size<0||!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>1048576)throw new TypeError('SHA256 requires a bounded Blob reader.');
 const digest=new Sha256();
 for(let offset=0;offset<blob.size;offset+=chunkBytes){if(signal?.aborted)throw new DOMException('Transfer stopped.','AbortError');const bytes=await blob.slice(offset,offset+chunkBytes).arrayBuffer();if(signal?.aborted)throw new DOMException('Transfer stopped.','AbortError');digest.update(bytes);progress(Math.min(offset+bytes.byteLength,blob.size),blob.size);}
 if(signal?.aborted)throw new DOMException('Transfer stopped.','AbortError');return digest.digest();
}
